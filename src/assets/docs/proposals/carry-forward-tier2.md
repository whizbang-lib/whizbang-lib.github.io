---
title: Carry-forward / Tier-2 (Ephemeral Compaction)
category: Architecture & Design
order: 25
tags: ephemeral, compaction, carry-forward, compacted, snapshot-as-authority, tier-2, record-versioning
---

# Carry-forward / Tier-2 (Ephemeral Compaction)

**Archival & Compaction** (A1 — its own proposal) closed the books on **durable Sourced** streams. **E3 is its ephemeral twin.** Where A1's carry-forward is a durable event and the detail can be archived, E3 folds an **ephemeral** stream's detail into an authoritative **ephemeral summary** — a `Compacted<T>` — and drops the detail. Nothing is archived (the data was never durable); the summary *is* the new source of truth, and it stays ephemeral. This is the principled form of "snapshot-as-authority": the surviving state is a **legitimate new origin**, not a severed cache.

E3 implements the one disposition E2 declared but deferred: **`Disposition.Compact`**.

:::planned
E3 is a proposed capability (unreleased, not yet started). It consumes [E2](destruction-hooks-ttl) (the `PreDestruction` hook returns `Compact`; the reaper runs it on the critical path before the delete) and reuses E1's authoritative ephemeral snapshots + the reap-driven snapshot step. It is the **only place a model-based fold of a stream is well-defined** — A1 established that a Sourced stream has no canonical model, but an ephemeral Tier-2 stream *declares* one (the designated ephemeral perspective **is** the source of truth), so its model *is* the canonical carry-forward.
:::

## Why Tier-2 is the well-defined fold

A1's key correction was: **a stream has no model**, so the framework can't auto-fold a Sourced stream — only a domain-authored carry-forward or an archive can shrink it. Tier-2 is the exception A1 named as mechanism *(c)*: a stream whose **designated perspective is authoritative**. For such an ephemeral stream:

- there is exactly one canonical model (the authoritative perspective's), so the framework *can* fold to it;
- the events are ephemeral triggers, not durable facts, so discarding them after the fold loses nothing that was ever the source of truth;
- the surviving snapshot is authoritative by construction (E1 already makes ephemeral snapshots the rewind floor and forbids `RebuildFromEvents`).

So Tier-2 compaction = **snapshot the authoritative model as a `Compacted<T>`, then drop the folded detail** — shrinking an ephemeral stream while keeping it ephemeral.

## The `Compacted<T>` carry-forward

A compaction is written as a **compact event in the stream** — the carry-forward / new origin, à la Marten's `Compacted<T>` — not an out-of-band mutation:

```csharp{title="Compacting an ephemeral stream to its authoritative summary" description="A PreDestruction hook returns Compact; the reaper folds the detail into a Compacted<T> summary, then drops it." category="Architecture" difficulty="ADVANCED" tags=["ephemeral","compaction","carry-forward"] framework="NET10"}
// The authoritative ephemeral perspective's model IS the fold. A PreDestruction hook chooses Compact:
public ValueTask<DestructionResult> OnBeforeDestructionAsync(DestructionContext ctx, CancellationToken ct) =>
  ValueTask.FromResult(DestructionResult.Proceed(Disposition.Compact));   // fold, don't just delete

// The reaper folds the detail into a Compacted<PresenceModel> summary event (the new origin), commits it as
// the authoritative snapshot, then drops the compacted detail — the stream keeps at most one origin at its head.
```

Rules (mirroring A1's coalescing, which E3 shares):

- A new compact event **truncates everything before it, including any prior compact event** — a stream holds **at most one `Compacted<T>` origin at its head**; successive compactions **coalesce into one**. Idempotent.
- The compact event is an **authoritative ephemeral snapshot**, never a Sourced event — the [E1 no-laundering invariant](ephemeral-events#ephemeral-is-viral-it-taints-derived-read-state) holds: `Compact` shrinks an ephemeral stream while keeping it ephemeral; it does not "promote to durable."
- Replay after compaction goes back **only to the compact point** — there is no archive (the detail was ephemeral). The `Compacted<T>` snapshot is the floor.

## Snapshot-as-authority — mostly already built

E1 already did the load-bearing work: ephemeral perspectives snapshot on an aggressive single-slot cadence, the reap-driven step drives a snapshot before the reap, the coverage gate holds the reap until the snapshot floor exists, and `RebuildFromEvents` is refused for ephemeral streams (rewind reads the snapshot, never replays reaped bodies). **E3 reuses all of it** — the `Compacted<T>` fold *is* the aggressive snapshot, promoted to a first-class carry-forward with its own event identity, and the delete of the folded detail is the existing consumption-gated reap.

What E3 adds on top: the `Disposition.Compact` handler that writes the snapshot **as a `Compacted<T>` event at the stream head** (so the stream visibly carries its origin), and the coalescing rule above.

## Document-style per-record versioning

Because a `Compacted<T>` is authoritative and there is **no event log to rebuild from**, its schema can't evolve by replay. E3 adopts state-based storage's migration model instead — **document-style per-record versioning**:

- Each compacted record is **schema-version stamped** (reusing `SnapshotEnvelope`'s version).
- On a schema change, records are **upgraded, not rebuilt** — a developer-supplied per-record transform (`vN → vN+1`), applied by a **deploy-time batch runner** and/or **lazy-on-access** (upgrade the record the first time it's read).
- This reuses the [Schema Evolution](schema-evolution) upcasting machinery, but applied to the compacted record rather than to a replayable event stream.

This is the deliberate trade E1 named: ephemeral Tier-2 went state-based, so it migrates like state-based storage — never `RebuildFromEvents`.

## What E3 builds on, and what it defers

**Reuses (no new mechanism):** E2's `PreDestruction` hook + `Disposition.Compact` (declared there); E1's authoritative ephemeral snapshots, reap-driven snapshot step, coverage gate, and rewind guard; the `SnapshotEnvelope` version stamp; the [Schema Evolution](schema-evolution) upcasting seam for the per-record transform.

**Adds:** the `Compacted<T>` compact-event contract + the `Disposition.Compact` fold handler (snapshot → write `Compacted<T>` at the head → drop detail, coalescing); the per-record schema-version stamp + upgrade transform + a deploy-time / lazy record-upgrade runner.

**Defers / out of scope:** archival of the folded detail (there is none — the data was ephemeral; that is A1's Sourced concern); Sourced-stream compaction (A1); GDPR crypto-shred of a compacted record (G1 — orthogonal, applies to hot or archived data).

## Observability & tests

**OTel:** compactions attempted / succeeded; compacted-record created / size; records upgraded (batch + lazy) + duration; coalesced-compaction count; compact-point replay-floor gauge.

**Regression invariants to lock** (E1/E2 discipline — completion signals, not `Task.Delay`):
- **Compact commits the summary BEFORE dropping the detail** — inject a failure at the fold-commit boundary and assert no state loss (the detail survives if the summary didn't commit).
- **Coalescing** — successive compactions collapse to one head origin; a compact event truncates a prior compact event.
- **No laundering** — a `Compact` handler cannot emit a Sourced event from the ephemeral payload (analyzer + runtime).
- **Snapshot-as-authority** — an ephemeral compacted stream never `RebuildFromEvents`; rewind reads the `Compacted<T>` floor.
- **Record upgrade** — a schema-changed compacted record upgrades `vN → vN+1` (batch and lazy) and never replays from events.

## Build increments (docs-first, then TDD per slice)

1. **`Compacted<T>` contract + `Disposition.Compact` handler** — the reaper, on a `Compact` disposition, snapshots the authoritative model and writes it as a `Compacted<T>` event at the stream head, then drops the folded detail via the existing consumption-gated reap. Inert until a hook returns `Compact`.
2. **Coalescing** — a compact event truncates everything before it (including a prior compact event); successive compactions coalesce to one head origin; idempotent. (Reuses A1's coalescing lock shape.)
3. **Per-record schema-version stamp** — stamp the compacted record with its schema version (reusing `SnapshotEnvelope`); a forgotten-bump guard via the fingerprint subsystem.
4. **Record-upgrade transform + runner** — a developer per-record `vN → vN+1` transform, applied by a deploy-time batch runner and lazy-on-access; reuses the schema-evolution upcasting seam.
5. **Guards + observability** — lock no-laundering / snapshot-as-authority for compacted streams; OTel for compaction + record upgrades.

Increments 1–2 deliver the fold; 3–4 make a compacted record safely evolvable; 5 locks the invariants.
