---
title: Archival & Compaction (Closing the Books)
category: Architecture & Design
order: 24
tags: archival, compaction, closing-the-books, carry-forward, cold-storage, sourced-streams, retention, period-close
---

# Archival & Compaction (Closing the Books)

[Destruction Hooks & TTL](destruction-hooks-ttl) (E2) gave *ephemeral* events a self-destruct lifecycle. **A1 addresses the other side: durable, Sourced streams that must stay short without losing anything.** This is the classic **"close the month / close the books"** pattern — at a period boundary you emit a **carry-forward (closing) event** that captures the opening balance for the next period, move the period's raw detail out of the hot store, and keep the live stream lean.

Two operations, deliberately orthogonal:

- **Compact** — write a domain-authored **closing event** (the carry-forward / new origin) and truncate the detail before it. A *hot-store* operation; it shrinks the live stream.
- **Archive** — move detail *off* to cold storage (preserved, auditable, out of the hot DB), filtered from hot reads but retrievable. A *cold-storage* operation.

Unlike ephemeral self-destruct, the data is **preserved, not destroyed** (≠ E1/E2) and **readable** (≠ G1 crypto-shred). Every accounting, ledger, inventory, and subscription-billing domain needs period close, which makes this arguably the most broadly useful retention strategy in the framework.

:::planned
A1 is a proposed capability (unreleased, not yet started). It **generalizes the E2 destruction-hook framework to Sourced streams**: a close is a destruction at `DestructionGranularity.Stream` with a new `PeriodClose` reason, so the same `PreDestruction` / `PostDestruction` receptors, the `Archive` disposition, and the consumption gate all carry over. It is scheduled by the [Temporal Engine](temporal-engine) (F2 — "close the month" is just a recurring schedule) and reuses E1's body-offload / partition infrastructure for cold storage. The **ephemeral** designated-model fold (`Compacted<T>` as authoritative snapshot) is a *different* mechanism — that is [Carry-forward / Tier-2](ephemeral-events) (E3).
:::

## The correction that shapes everything: a stream has no model

It is tempting to say "compact the stream to a snapshot." **You can't** — and getting this wrong is the trap Marten's `>1 single-stream projection` caveat warns about. A stream is a sequence of **heterogeneous state-changes**, not a state. Each **perspective** folds those events into its *own* model from its *own* view; the framework has no single canonical "the state of this stream" to fold to. So reducing a Sourced log is always one of three things, never a generic auto-fold:

- **(a) Domain-authored carry-forward (closing) event.** The *domain* emits a closing event — `MonthClosed { openingBalance: 140 }` — capturing what it deems sufficient to continue. The framework then gated-truncates the detail before it. This is "closing the books": the summary is **domain knowledge, not a framework fold** ("you can only answer questions you knew to ask before closing"). **A1 builds this.**
- **(b) Archive raw events (model-agnostic).** Move the heterogeneous events to cold storage and truncate hot — no fold needed, just relocation. Rebuilds rehydrate from cold. Pure storage economy. **A1 builds this.**
- **(c) Designated compaction model** *(only if the stream declares a canonical aggregate)*. Then the framework CAN fold to *that* model as the carry-forward. **Ephemeral Tier-2 (E3) is exactly this case** — the designated ephemeral perspective *is* the source of truth, so its model *is* the canonical fold. Out of scope for A1.

Per-perspective **snapshots stay separate** — they are the *only* place a model-based fold is well-defined, they are non-destructive, and they do not shrink the log. A1 never touches them.

## Compact ⟂ Archive — two axes, four compositions

`Compact` (hot) and `Archive` (cold) are independent. You pick per close:

| Composition | Hot store keeps | Detail ends up | When |
|---|---|---|---|
| **Compact + discard** | closing event only | gone | leanest; audit / full replay lost before the close point |
| **Compact + archive detail** | closing event only | preserved in cold | lean hot **and** full audit / replay from cold |
| **Archive detail (no compact)** | detail removed | preserved in cold | move off-DB, keep everything retrievable |
| **Archive old summaries** | — | old closing summaries → cold | shed even summarized state for very old periods |

(GDPR **CryptoShred** (G1) is a third, orthogonal erasure axis — it applies to hot *or* archived data.) Replay after a compact goes back **only to the close point**; full history needs the archived detail, if it was archived.

## Walkthrough — closing a month

Stream `account-123` holds 900 events feeding two perspectives, `Balance` and `TransactionList`. Close the month through sequence 900:

```csharp{title="Closing the books on a stream" description="The domain emits the carry-forward; the framework gates on consumption then truncates/archives." category="Architecture" difficulty="ADVANCED" tags=["archival","closing-the-books","carry-forward"] framework="NET10"}
// 1. The DOMAIN emits the carry-forward — it knows the balance carries, the txn list does not.
await dispatcher.AppendAsync("account-123", new MonthClosed { OpeningBalance = 140m }); // → seq 901

// 2. Close: framework verifies every perspective cursor >= 900 (consumption gate), then
//    archives + truncates events 1..900. The closing event (901) becomes the new origin.
await archivist.CloseStreamAsync("account-123", throughSequence: 900,
  new CloseOptions { Compact = true, Archive = ArchiveTarget.PostgresPartition });
```

Now `Balance` **resumes** from `MonthClosed` (`Apply` → 140, then seq 902+). `TransactionList` **cannot** resume from a summary that never carried each transaction — so either it **rehydrates from the archive**, or you **do not compact-discard** a stream feeding a full-history projection (the analyzer guard below flags it). The framework's job is *append-closing + gated-truncate/archive*; the **domain owns the carry-forward**.

## Mechanics

- **Closing event = a durable Sourced carry-forward** = a legitimate new origin. Rebuild replays from the closing event *forward*, never from the truncated/archived detail. This is why A1's carry-forward is **not** E2's `Disposition.Compact` (which produces an *ephemeral* `Compacted<T>`): a closed Sourced stream stays durable and replayable, just shorter.
- **Compaction is effected by the compact event + coalescing.** A new closing event truncates everything before it *including any prior closing event*, so a stream holds **at most one closing/origin event at its head**; successive closes with no intervening domain events **coalesce into one**. Idempotent, keeps the stream minimal.
- **Consumption-gated truncation.** Detail is only truncated/archived once **every** perspective cursor has passed the close point — the same `wh_perspective_cursors` gate the ephemeral reaper uses, so a projection mid-catch-up is never robbed of events it hasn't read. Stream-level (it affects *all* perspectives).
- **Archive store = pluggable, Postgres archive-partition by default.** Archived events move to a partition / `is_archived` marker (reusing E1's offload plumbing and PG partition move), **filtered from hot reads** by default and retrievable for audit / full replay. Blob offload is the pluggable target for scale.
- **Deliberate, opt-in log mutation.** Like Ephemeral, this bends "append-only forever" — the log is immutable *after* the close point (à la EventStoreDB scavenge / Kafka retention). Never a default; always a domain-triggered close.

## Stream identity on close — recommendation

The one open design fork: after a close, does the entity's history live on **one stream** (archived-marker) or **a new stream per period**?

**Recommendation — archived-marker on the same stream (default), new-stream-per-period as opt-in.** Keeping one `stream_id` per entity preserves the invariants everything else keys on: `UNIQUE(stream_id, version)`, the per-`(stream, perspective)` cursors and snapshots, and the cross-service `commit_sequence` / `origin_service_id` anchors all stay valid — only the *hot portion* of the one stream stays lean, exactly like Marten's `is_archived`. New-stream-per-period fragments an entity's identity across N streams, complicating cross-period reads, rebuilds, and cursor bookkeeping for a marginal benefit the archived-marker already delivers. Domains that genuinely want hard per-period isolation (e.g. a fresh stream each fiscal year for regulatory separation) opt in explicitly.

## Safe-by-construction guard

A stream feeding a **full-history projection** (one that needs every event, like `TransactionList`) must not be **compact-discarded** — the projection could never rebuild. A Roslyn analyzer (the E1 / WHIZ1xx band) flags a compact-discard close on a stream whose perspective set includes a non-resumable projection, mirroring the E1 rebuild guards. Compact + *archive* is always safe (the detail is retrievable); only compact + *discard* against a full-history reader is the hazard.

## What A1 builds on, and what it defers

**Reuses (no new mechanism):** the E2 `PreDestruction` / `PostDestruction` stages and `ILifecycleCoordinator` (a close is a stream-granularity destruction — the Pre-hook is where the domain emits its carry-forward + the archive commits, *before* the truncate); the E2 `Disposition.Archive` (declared there, implemented here); the E1 consumption gate + body-offload / partition infra; the F2 temporal engine (a "close the month" recurring schedule fires the close, same leased-claim / DB-clock path as every other schedule).

**Adds:** `DestructionReason.PeriodClose`; a stream-level `CloseStreamAsync` / `IStreamArchivist` + the gated-truncate-and-archive SQL primitive; the archive store (PG partition default); coalescing of successive closing events.

**Defers:** the ephemeral designated-model fold (`Compacted<T>` as authoritative snapshot) → **E3**; crypto-shred of hot *or* archived data → **G1**.

## Observability & tests

**OTel:** streams closed / compacted / archived by composition; events truncated + archived per close; consumption-gate wait before a close; archive-store write duration + size; rehydrate-from-archive count + latency; coalesced-close count.

**Regression invariants to lock** (E1/E2 discipline — completion signals, not `Task.Delay`):
- **Consumption gate holds a close** — a lagging perspective cursor blocks truncation until it passes the close point (no projection robbed of unread events).
- **Carry-forward + archive commit BEFORE truncate** — inject a failure at the archive-commit boundary and assert no detail is lost (kept hot, or fully in cold).
- **Resume-from-closing-event** — a `Balance`-style perspective rebuilds correctly from the closing event forward; a `TransactionList`-style perspective rehydrates from the archive or is analyzer-guarded.
- **Coalescing** — successive closes with no intervening domain event collapse to a single head origin.
- **Archived events are filtered from hot reads** yet retrievable for audit / full replay.
- **Cross-service anchor survives** — `commit_sequence` ordering stays valid after the detail it anchored is archived.

## Build increments (docs-first, then TDD per slice)

1. **Gated-truncate primitive** — `CloseStreamAsync(streamId, throughSequence, options)` + the SQL that verifies all perspective cursors ≥ the close point (consumption gate) then deletes events ≤ the point, *keeping* the domain's closing event. `DestructionReason.PeriodClose`. Discard-only first (no archive yet).
2. **Archive store** — cold-storage target: a Postgres archive partition / `is_archived` marker; the close writes detail there *before* truncate; hot reads filter it out; a retrieval path reads it back. Pluggable `IArchiveStore` (PG partition default, blob for scale).
3. **Compact event + coalescing** — a new closing event truncates prior detail *including a prior closing event*; successive closes coalesce to one head origin; idempotent.
4. **Close hook wiring** — the close fires `PreDestruction` (`Stream` granularity, `PeriodClose` reason) so a receptor can emit the carry-forward / run archive logic on the critical path, and `PostDestruction` (detached) for notify / metrics; reuses the E2 coordinator.
5. **Scheduled close** — an F2 recurring schedule ("close the month") triggers `CloseStreamAsync`; threshold (size/age) and manual triggers too.
6. **Analyzer guard + archive rehydration** — flag compact-discard against a full-history projection; the read/rebuild path rehydrates pre-close detail from the archive when a projection needs it.

Increments 1–2 are the load-bearing primitives; 3–4 make it a first-class close; 5–6 make it operable and safe.
