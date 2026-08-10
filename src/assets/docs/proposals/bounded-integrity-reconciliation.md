---
title: Bounded Integrity Reconciliation (Sealed Prefixes & Deficit Exchange)
category: Architecture & Design
order: 30
tags: stream-integrity, anti-entropy, reconciliation, digest, sealed-prefix, watermark, deficit, backfill, tenant-scope, full-sweep, scheduling
---

# Bounded Integrity Reconciliation (Sealed Prefixes & Deficit Exchange)

Stream Integrity answers a real question — *do two services actually hold the same events?* — and answers it
correctly. But the **cost of asking** currently grows with accumulated history rather than with the size of
the discrepancy. A deployment that has been running for a year pays a year's worth of reconciliation to
discover that nothing is wrong.

This proposal changes the asymptote. The exchange becomes proportional to **what is missing**, not to what is
held; verified history is **sealed** and never re-examined on the hot path; and the expensive full
verification becomes a **scheduled, off-peak** operation instead of a counter that fires whenever it happens
to come round.

:::planned
This is a design proposal. Nothing here is implemented yet.
:::

## The problem, precisely

Four behaviours compound. Each is individually defensible; together they make reconciliation grow without
limit.

### 1. Drill-down re-sends everything, every cycle

The audit is already hierarchical, and that part works: it exchanges **type-level** digests first
(`ManifestLevel.Types`, `O(types)`), and only a *mismatched* type escalates to stream level. The escalation
is what is unbounded:

```csharp
Task<IReadOnlyList<StreamDigest>> GetStreamDigestsAsync(
  Guid? originServiceId,
  IReadOnlyList<string>? eventTypes,
  CancellationToken cancellationToken = default)
```

There is no *changed-since* parameter. When a type drills down, the origin ships **every stream digest it has
for that type** — chunked at `MaxDigestsPerManifest` — regardless of how few streams actually differ. If three
streams out of fifty thousand diverge, all fifty thousand digests cross the wire.

And the trigger is self-sustaining. A *persistent* divergence keeps the type mismatched, so the next audit
drills down again, and re-ships the same full set. The payload is regenerated on every cycle for as long as
the divergence exists — which is exactly when the system is least able to absorb it.

### 2. Divergence is the wrong question

A digest mismatch has many causes: a missing event, an extra event, a reclassification, a stale bucket. Only
one of them is actionable, and only one of them is bounded.

- **"Do our digests differ?"** is `O(all streams, forever)`. It never shrinks, and a healthy system still
  pays for it.
- **"Am I missing events I subscribe to?"** is `O(deficit)`. It is **zero** in the healthy case — a healthy
  system exchanges nothing at all.

The checkpoint path already works the second way: `IntegrityGapDetected` reports `ExpectedCount` versus
`ActualCount` over a bounded commit-sequence window. It is the manifest path that reaches for full-fold
comparison across all history.

### 3. Needing to *project* events is confused with *missing* them

Adding a perspective, or adding an `Apply` for an event type a perspective did not previously handle, means
that perspective needs the type's history — **from the local store**. It does not mean the service is missing
events.

Today the subscription-growth path does not make that distinction. On detecting new consumed types it goes
straight to a broadcast re-delivery request for their whole history, with no check against the local event
store first. The code is explicit about why it broadcasts:

> ONE broadcast (no Target — the expanding consumer cannot know which origins hold the history)

So a purely local concern — *this projection needs rebuilding* — is answered with a cross-service data
transfer, and the re-delivered events land in the inbox to be compared against digests the consumer already
holds.

### 4. The full sweep is counted, not scheduled

```csharp
var cycle = Interlocked.Increment(ref _cycleCount);
var sweep = _options.FullSweepEveryNthAudit > 0 && cycle % _options.FullSweepEveryNthAudit == 0;
```

The sweep is the heaviest operation in the subsystem: it recomputes the whole digest table
(`VerifyDigestTableAsync`) and then runs the exchange on recomputed digests end to end. It fires on **every
Nth audit**, at whatever wall-clock time the pod happened to start, and `_cycleCount` is **per-process** — so
a restarting fleet re-rolls the dice continuously, and a pod that restarts often can sweep far more often than
the setting implies.

## The shape of the fix

Four changes. They are coupled: the first three are only *safe* because the fourth backstops them, so they
should land together as one design even if they ship as separate increments.

### A. Seal verified prefixes

The digest algebra already supports this, and it is why the algorithm was chosen:

> Two-lane 64-bit XOR of `hashtextextended(event_id, seed)` with seeds 0/1: 128-bit-equivalent collision
> resistance, **self-inverse** (deletions need no bookkeeping), **arrival-order independent**

XOR is associative, commutative and self-inverse, therefore:

```
digest(≤Y) = digest(≤X) XOR digest(X < e ≤ Y)
```

A verified prefix can be collapsed into a **single sealed value** and never recomputed. Agreement on that
value is a genuine statement about the entire event-id set below it — not a sample, not a heuristic.

**New state**, one row per `(origin_service_id, scope_tenant, event_type)` — bounded by tenants × types, *not*
streams × history:

| column | meaning |
|---|---|
| `sealed_through_seq` | origin commit sequence the seal covers |
| `sealed_digest_lo` / `sealed_digest_hi` | XOR fold of every event at or below the watermark |
| `sealed_count` | event count below the watermark |
| `sealed_at` | when the seal last advanced |

Reconciliation then compares only the **open segment** above the seal. On agreement the seal advances by
folding the open segment in — `sealed ^= open`, `sealed_through_seq = watermark` — and the exchange cost
returns to zero.

**The ordinal must be the commit sequence, not a timestamp.** `wh_stream_digests` today carries `updated_at`,
a wall-clock write time, which cannot answer "is an event with a lower ordinal still in flight". The system
already has the right ordinal — `source_commit_sequence`, monotonic per origin, already stamped on inbox rows
and already the unit the checkpoint windows use.

**Safety rule:** only seal a prefix whose watermark is older than `AuditSettleWindowMinutes`. That is exactly
the boundary at which a not-yet-received event stops being in flight and becomes a genuine gap — the premise
gap detection already depends on. Sealing inside the settle window would seal over a straggler.

**Storage follows.** Once a prefix is sealed, the per-stream rows beneath it are redundant: they can be
collapsed into the sealed row, so digest storage stops growing with history as well as with traffic.

### B. Negotiate the scope; never let one side choose it

Today the requester asks for "digests for these types" and the **origin** decides how much that is — up to
every stream it has ever seen. Neither side knows the answer's size before it is built.

The request should carry the bound:

```
RequestIntegrityManifest {
  EventTypes    = [...]
  TenantScope   = ...            // segmentation, already a first-class key
  SinceSequence = <requester's sealed_through_seq>
  UntilSequence = <settle-window watermark>
  MaxDigests    = <requester's own ceiling>
}
```

The origin answers **only** what changed inside that window, and cannot exceed the stated ceiling. Both sides
agree on the question before either pays for the answer.

`scope_tenant` is already part of the digest primary key, so per-tenant segmentation needs no new dimension —
only that the request and the seal both carry it, so one noisy tenant cannot drag another's reconciliation
along with it.

### C. Ask "what am I missing?", and check locally first

Two rules:

1. **Local-first.** Before any cross-service request, consult the local event store. If the events are
   present, the need is a **local rebuild** of the projection, not a sync. This makes the new-perspective and
   new-`Apply` cases free — they stop being integrity events entirely.
2. **Deficit, not divergence.** Cross-service transfer is warranted only when the local store is genuinely
   short of events it subscribes to. Extra events, reordering and reclassification are *not* deficits and
   must not trigger a transfer.

### D. Schedule the sweep; do not count it

Replace the modulo counter with a **cron schedule** on the temporal engine — which already provides
DST/timezone-aware next-fire computation, DB-clock authority, misfire policies and a leased claim so exactly
one instance fires:

```csharp
public string? FullSweepCron { get; set; } = "0 3 * * *";   // nightly, off-peak
```

Two properties this must keep:

- **Splay it.** Fourteen services sweeping at `03:00:00` is the same storm with a nicer timestamp. The
  codebase already has the primitive for this — `StartupAuditMaxJitterSeconds`, used so a fleet deploy's
  startup audits de-synchronize. The nightly window needs the same treatment.
- **Defer under load.** When a DB-pressure signal is available, the sweep should stand down rather than run
  into a busy system. Because misfire policy defaults to *coalesce*, a deferred sweep folds into the next
  window instead of queueing up.

Retain the counter as a fallback for engines without the temporal driver.

## What this changes

| | today | proposed |
|---|---|---|
| healthy-system exchange | `O(streams)` per drill-down, repeatedly | **zero** |
| divergent-system exchange | `O(all streams of the type)`, every cycle | `O(streams changed since the seal)` |
| look-back on the hot path | unbounded — all history, forever | bounded — the open segment only |
| digest storage growth | grows with streams × history | grows with streams; sealed prefixes collapse |
| new perspective / new `Apply` | cross-service backfill of full history | **local rebuild**, no transfer |
| full verification | every Nth audit, arbitrary wall-clock, per-process counter | scheduled, off-peak, splayed, fleet-wide |

## Open questions

1. **Seal granularity.** `(origin, tenant, type)` is proposed. Per-stream seals would be finer but restore
   `O(streams)` storage; coarser seals lose per-tenant isolation. Is type-level the right unit?
2. **Detection latency for the sealed region.** A stream that diverged by *not changing* — a consumer that
   missed an event while the origin also stayed quiet — is invisible to a changed-since delta and is caught
   only by the scheduled sweep. With a nightly sweep that is a stated worst case of ~24 hours. Acceptable for
   anti-entropy, but it should be a **documented guarantee**, not an accident of scheduling.
3. **Seal invalidation.** Reclassification and stream close/truncate legitimately mutate history below a
   seal. Both already maintain digests by subtraction, so they must also reopen or re-fold the affected seal.
   Which operations must invalidate, and how far back?
4. **Local-first cost.** The local check must be cheaper than the transfer it avoids. Counting local events
   per `(tenant, type)` is exactly what the digest table already stores — is `sealed_count` plus the open
   segment sufficient, or is a store query needed?
5. **Migration.** Existing deployments have no seals. A first sweep establishes them; until then behaviour is
   today's. Should the first seal be established eagerly at upgrade, or lazily on the first successful
   exchange?

## Why this ordering

Sealing (A) is what makes the look-back finite, and it depends on nothing else. Scope negotiation (B) is what
makes a single exchange bounded, and it needs the seal to have something to negotiate *from*. Deficit-and-
local-first (C) is what makes the healthy case free. Scheduled sweeps (D) are what make the whole thing safe
to rely on — and (C) in particular is only sound *because* (D) backstops it.

Implemented in that order, each increment is independently useful, and no increment removes a safety property
before its replacement exists.
