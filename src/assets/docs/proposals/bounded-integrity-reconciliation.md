---
title: Bounded Integrity Reconciliation (Epoch Seals & Deficit Exchange)
category: Architecture & Design
order: 30
tags: stream-integrity, anti-entropy, reconciliation, digest, epoch, sealed-prefix, watermark, deficit, backfill, tenant-scope, full-sweep, scheduling
---

# Bounded Integrity Reconciliation (Epoch Seals & Deficit Exchange)

Stream Integrity answers a real question — *do two services actually hold the same events?* — and answers it
correctly. But the **cost of asking** currently grows with accumulated history rather than with the size of
the discrepancy. A deployment that has been running for a year pays a year's worth of reconciliation to
discover that nothing is wrong.

This proposal changes the asymptote. The exchange becomes proportional to **what is missing**, not to what is
held; verified history is **sealed into immutable epochs** and never re-examined on the hot path; and the
expensive full verification becomes a **scheduled, off-peak** operation that each side runs for itself.

:::planned
This is a design proposal. Nothing here is implemented yet. It has been through one adversarial review;
the epoch structure, the two-dimensional resume cursor, the deficit/alarm split, and the seal-coherence
section all came out of that review.
:::

## The problem, precisely

Four behaviors compound. Each is individually defensible; together they make reconciliation grow without
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

### 2. Divergence is the wrong question to drive repair

A digest mismatch has many causes: a missing event, an extra event, a reclassification, a stale bucket. Only
one of them is repairable by re-delivery, and only one of them is bounded.

- **"Do our digests differ?"** is `O(all streams, forever)`. It never shrinks, and a healthy system still
  pays for it.
- **"Am I missing events I subscribe to?"** is `O(deficit)`. It is **zero** in the healthy case.

The checkpoint path already works the second way: `IntegrityGapDetected` reports `ExpectedCount` versus
`ActualCount` over a bounded commit-sequence window. It is the manifest path that reaches for full-fold
comparison across all history.

This is *not* an argument for dropping the digest comparison — a mismatch at **equal counts** is corruption
or membership drift, which no deficit check can see, and it is precisely what the digest exists to catch.
The argument is that the two signals should drive **different actions** (§C).

### 3. The backfill ask is unbounded

When the consumed-type set grows, the service broadcasts a state-only re-delivery request for the new types.
Two parts of this are *right*, and the original draft of this proposal got them wrong: the consumed-type
registry records a **baseline** on first boot (`asBaseline: true` — adopting the feature does not trigger a
mass backfill), and a *genuinely* newly-consumed type has no local history to check, because unsubscribed
messages are discarded at the receive boundary. For a new type, the transfer is correct.

What is missing is the **bound**. The request asks for the type's entire history, with no statement of what
the requester already holds. The real cases:

- **Partial history.** A service that consumed type `T` from origin sequence `N` onward, and now needs
  earlier events, should ask for `< N` — not for everything.
- **A new perspective or a new `Apply` over an already-consumed type** triggers no backfill at all (the type
  is not newly consumed) — that is a **local rebuild**, and the design should say so explicitly so nobody
  "fixes" it into a transfer.

The rule: a backfill request must state the requester's local holdings (its floor and ceiling per
`(origin, tenant, type)`), and the origin must answer only the complement.

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

Worse, the sweep is **consumer-driven**: a sweeping consumer sends `UseRecompute = true`, forcing the *origin*
to recompute on the *consumer's* schedule. With N consumers, the origin performs N full recomputes per sweep
period, at times it does not control.

## The shape of the fix

Six sections: four mechanisms (A–D), one optimization of the same state (E), and one correctness protocol
the mechanisms require (F). They are coupled — the deficit and delta paths are only *safe* because the
scheduled sweep backstops them — so they should land as one design even if they ship as separate increments.

### A. Seal verified history into epochs

The digest algebra is why this works, and it is why the algorithm was chosen:

> Two-lane 64-bit XOR of `hashtextextended(event_id, seed)` with seeds 0/1: 128-bit-equivalent collision
> resistance, **self-inverse** (deletions need no bookkeeping), **arrival-order independent**

XOR is associative, commutative and self-inverse, so folds **compose**: the digest of any sequence range is
the XOR of the folds of its sub-ranges.

A naive design would keep one sealed watermark per bucket. Adversarial review killed that twice over:

1. **One watermark cannot serve many consumers.** Comparing folds requires both sides to fold the *same
   range*. Consumer A's seal sits at `X₁`, consumer B's at `X₂`; an origin with a single sealed/open split
   can answer "changed since *my* watermark" but not "since *yours*" — and N consumers advance independently,
   so they will never agree.
2. **The running fold cannot be split retroactively.** Today's `wh_stream_digests` row folds *all* of a
   stream's events into one value; `digest(≤X)` is not extractable from it. Establishing a seal from the
   existing table alone is impossible without a range recompute against the event store.

**Epochs solve both.** Partition each origin's sequence space into windows — epochs — and keep one immutable
fold per closed epoch:

| state | key | mutability |
|---|---|---|
| open epoch | `(origin, tenant, type, stream, epoch)` | write path folds into it, exactly as it folds into today's per-stream row — same row-level contention |
| closed epochs | `(origin, tenant, type, epoch)` | immutable; stream detail collapsed upward |
| deep seal | `(origin, tenant, type)` | XOR of all epochs older than the retained ring |

Any requested range is then the XOR of epoch folds — `O(epochs behind)` to serve **any** consumer at **any**
epoch boundary, with the origin holding **no per-consumer state**. A consumer too far behind the retained
ring falls back to the sweep path.

**Epoch closure is a sequence rule, not a clock rule.** An epoch closes when the origin's checkpoint
watermark has passed its upper bound by at least `AuditSettleWindowMinutes`. This converts the settle window
from a wall-clock membership test (whose answer depends on whose clock you ask) into a **sequence boundary**
both sides compute identically. Clock skew stops being able to change membership at all.

**The ordinal is the origin commit sequence, never a timestamp.** It is origin-assigned, travels with the
event, and is already queryable on retained consumer rows — `wh_event_store` carries
`origin_commit_sequence`, and the checkpoint recount (`CountReceivedFromOriginAsync`) already filters on it.

**Storage follows.** Closed epochs collapse: stream-level rows fold upward into the bucket-epoch row once the
epoch closes, and epochs older than the ring fold into the deep seal. Digest storage becomes
`O(streams active in the ring)` + `O(buckets × ring length)` — bounded by recent activity, not by history.

### B. Negotiate the scope; never let one side choose it

Today the requester names types and the **origin** decides how much that is — up to every stream it has ever
seen. Neither side knows the answer's size before it is built.

The request carries the bound:

```
RequestIntegrityManifest {
  EventTypes          = [...]
  TenantScope         = ...        // segmentation — already a first-class digest key
  SinceSequence       = <requester's last sealed epoch boundary>
  UntilSequence       = <origin checkpoint watermark minus settle>
  MaxDigests          = <requester's own ceiling>
  ResumeAfterStreamId = <null, or the cursor from a truncated answer>
}
```

**The answer carries its own coverage, in two dimensions.** Review found that a single `ComputedThrough`
sequence is ambiguous under truncation: digests are per-stream, `MaxDigests` caps the *stream count*, so
"covered through sequence Y" says nothing about *which streams* made it into a capped answer. The response
states both dimensions:

```
IntegrityManifest {
  Digests             = [...]
  ComputedThrough     = <sequence the answer covers>
  ResumeAfterStreamId = <null when complete; else: re-ask from here>
}
```

Streams are ordered deterministically (by stream id), so a truncated answer resumes exactly where it stopped.
The receiver may advance its seal **only when a window completes with a null cursor** — advancing on a
truncated answer would seal over the streams that never arrived, permanently, which is the one unrecoverable
mistake this protocol can make.

`scope_tenant` is already part of the digest primary key, so per-tenant segmentation needs no new dimension —
only that the request, the epochs and the seal all carry it, so one noisy tenant cannot drag another's
reconciliation along with it.

### C. Two signals, two actions — and a range-bounded backfill

1. **Deficit drives repair.** Cross-service transfer happens only when the local store is genuinely short of
   events it subscribes to, and the request is bounded by local holdings (§3): *"I hold `(floor, ceiling)`
   for this bucket; send the complement inside the negotiated window."*
2. **Equal-count digest mismatch drives alarm.** Same counts, different folds means corruption or membership
   drift — re-delivery cannot fix it and must not be asked to try. It lands in the durable divergence ledger
   and surfaces on the convergence gauges as the operator-attention case.
3. **Local rebuilds stay local.** A new perspective or new `Apply` over an already-consumed type is a
   projection rebuild from the local store. It is not an integrity event, and the design states that
   explicitly so the distinction survives future refactoring.

### D. Each side schedules its own heavy work

Replace the modulo counter with a **cron schedule** on the temporal engine — which already provides
DST/timezone-aware next-fire computation, DB-clock authority, misfire policies and a leased claim so exactly
one instance fires:

```csharp
public string? FullSweepCron { get; set; } = "0 3 * * *";   // nightly, off-peak
```

And **invert who does the recomputing**. An origin verifies *its own* digest table on *its own* schedule —
that is the existing `VerifyDigestTableAsync` half of the sweep. Consumers' sweeps then read the origin's
already-verified epochs; `UseRecompute = true` stops being something one service can impose on another and
becomes an explicit operator action. N consumers no longer cost the origin N recomputes.

Three properties to keep:

- **Splay it.** A fleet sweeping at `03:00:00` in unison is the same storm with a nicer timestamp. The
  codebase already has the primitive — `StartupAuditMaxJitterSeconds`, used so a fleet deploy's startup
  audits de-synchronize. The nightly window gets the same treatment.
- **Defer under load.** When a database-pressure signal exists, the sweep stands down rather than running
  into a busy system; misfire policy defaults to *coalesce*, so a deferred sweep folds into the next window
  instead of queueing. Until that signal ships this degrades gracefully to plain scheduling — the dependency
  is an enhancement, not a prerequisite.
- **Keep the counter as a fallback** for engines without the temporal driver.

### E. Answer from epochs, not from a live aggregation

The type-level rollup — the wire unit of the hierarchical audit — is recomputed **on every read**:

```sql
SELECT scope_tenant, event_type, bit_xor(digest_lo), bit_xor(digest_hi),
       SUM(event_count)::int, MAX(updated_at)
FROM wh_stream_digests
WHERE origin_service_id = ...
GROUP BY 1, 2
```

A full `bit_xor` aggregation across every stream row of the requested types, per request, per consumer:
**N × O(streams)** work to answer a question whose result did not change between askers.

With epochs the materialization falls out for free: closed epochs **are** the precomputed answer, and the
refresh folds only the **open epoch** — bounded by current activity. Serving a manifest becomes an `O(ring)`
read of immutable rows. There is no separate rollup cache to invalidate, because the epoch rows carry their
own coverage (§B) — a stale answer is impossible to misread as a fresh one, since the receiver sees exactly
which sequence window it was given.

**The staleness this introduces is free, up to a stated boundary.** `AuditSettleWindowMinutes` already means
both sides deliberately fold only events older than the settle window — an in-flight delivery must never read
as divergence — so the comparison is blind to fresh data *by design*. While epoch closure lags the watermark
by the settle window (§A's closure rule), precomputation adds **no staleness the protocol did not already
have**. That is also how the epoch length should be chosen: derived from the settle window and checkpoint
cadence, not guessed independently.

**Do not fold into the rollup on the write path.** XOR would permit it, but every stream of a type collapses
onto one row — a hot-row lock on the emit chain's critical path. The write path touches only the open epoch's
per-stream row (same contention as today); closure and collapse run on the existing maintenance cycle, not a
new background worker, because another always-on periodic database consumer is a cost every host pays.

| | aggregation cost |
|---|---|
| today | `O(streams)` per request, per consumer |
| epochs | fold the open epoch on the maintenance cadence; `O(ring)` immutable reads per request |

### F. Seal coherence: history legitimately mutates, and seals must survive it

This section exists because the review found the failure mode: **unilateral mutation below a seal is
permanent false divergence.** Whizbang deliberately allows history to change shape — and every such operation
happens on *one side only*:

- `close_stream` (archival/compaction) truncates events below a close point — and already **subtracts** them
  from the running digests.
- `reclassify_events_ephemeral` removes a type's events from the audited set — and already subtracts.
- Whether ephemeral-*born* events enter the fold at all must be pinned down during implementation; if they
  do, the tier-2 pointer prune is a third subtraction site.

The running folds handle these locally. The **peer's seal does not move** — so after a legitimate truncation,
the two sides' sealed folds disagree forever, the sweep re-detects it every night, and re-delivery cannot
repair it because the events are gone *by design*.

Two protocol elements close the hole:

1. **An origin generation.** When an origin mutates history below its own seal — a books-closing truncate, a
   restore from backup (which can regress or *fork* the commit sequence, invalidating every seal built on the
   old line) — it bumps a generation stamped on its checkpoints and manifests. Peers seeing a new generation
   re-seal from the announced floor on their next sweep, exactly parallel to how a closed stream's
   carry-forward event becomes its new origin.
2. **Sealed-region mismatch is an alarm, never repair fodder.** A mismatch below both watermarks *without* a
   generation change is possible data loss or corruption. It goes to the divergence ledger and the gauges for
   operator attention; it must never re-enter the repair loop, which by construction cannot fix it.

## What this changes

| | today | proposed |
|---|---|---|
| healthy-system exchange | `O(streams)` per drill-down, repeatedly | checkpoints + `O(types)` headers; **no stream payloads** |
| divergent-system exchange | `O(all streams of the type)`, every cycle | `O(streams changed in the open window)` |
| look-back on the hot path | unbounded — all history, forever | the retained epoch ring |
| digest storage growth | grows with streams × history | active ring only; closed epochs collapse |
| origin CPU per audit | `O(streams)` re-aggregated per request, per consumer | `O(ring)` immutable reads |
| origin CPU per sweep | N consumers × forced recompute | one self-scheduled verify |
| backfill request | full history, unbounded | complement of stated local holdings |
| new perspective / new `Apply` | already local — now stated as a design invariant | local rebuild, never a transfer |
| full verification | every Nth audit, arbitrary wall-clock, per-process counter | scheduled, off-peak, splayed, self-owned |

## Open questions

1. **Epoch length and ring size.** Closure is sequence-gated (§A), but the window width and how many closed
   epochs stay resident are tuning knobs. Derive from checkpoint cadence and settle window, or expose
   directly? What is the fallback when a consumer is further behind than the ring retains?
2. **Detection latency for the sealed region.** A bucket that diverged by *not changing* is invisible to any
   changed-since exchange and is caught only by the sweep. A nightly sweep makes that a stated worst case of
   ~24 hours. Acceptable for anti-entropy — but it must be a **documented guarantee**, not an accident of
   scheduling.
3. **Ephemeral events and the fold.** Do ephemeral-born events enter digests at emit? The answer decides
   whether the reaper and the tier-2 pointer prune are seal-invalidation sites, and it must be locked in a
   regression test either way.
4. **Local-holdings source for the backfill bound.** Floor/ceiling per `(origin, tenant, type)` — from the
   epoch table (cheap, coarse) or the event store (exact, a query)? The check must stay cheaper than the
   transfer it bounds.
5. **Enforce the cadence relationship.** Epoch closure lagging the settle window is what makes precomputation
   free. Should the framework derive one from the other outright, rather than exposing two knobs that can be
   configured into an unsafe combination?
6. **Migration.** Existing deployments have running folds and no epochs. The first self-sweep can establish
   an epoch-zero seal (everything before adoption) plus the open epoch. Eager at upgrade, or lazy on first
   successful exchange?

## Related work

- **Database-pressure run permit** — §D's defer-under-load is this signal's first concrete consumer; until it
  ships, the sweep degrades to plain scheduling.
- **Startup orchestration plan** — the audit storm on fleet bring-up is the integrity-specific slice of the
  broader synchronized-startup problem. This proposal's splay and epoch answers discharge that slice; the
  startup plan owns discovery, election and general storm control. The two should cross-reference, not
  duplicate.
- **Typed name forms** — the new protocol messages cross the same seams where wire-form/CLR-form type-name
  confusion has already caused a production bug; the new DTOs should be born with the strongly-typed forms.
- **Report stream population** — the opt-in report-publishing path still mints a new stream per report;
  bounding it is tracked separately and lands naturally with this proposal's report-path work.
- **Drain byte budgets** — the inbox fetch is byte-bounded; the outbox sibling is tracked separately. Both
  are damage-limiting for oversized control-plane payloads; this proposal removes the reason those payloads
  get large in the first place.

## Why this ordering

Epochs (A) make the look-back finite and depend on nothing else; the materialized answer (E) falls out of
them rather than landing after them. Scope negotiation (B) makes a single exchange bounded, and needs epochs
to negotiate *from*. Deficit-and-local-first (C) makes the healthy case free. Scheduled, self-owned sweeps
(D) make the whole thing safe to rely on — (C) is only sound *because* (D) backstops it. Seal coherence (F)
must land **with** (A), not after it: a seal that cannot survive `close_stream` is a false-divergence
generator from its first nightly sweep.

Implemented in that order, each increment is independently useful, and no increment removes a safety property
before its replacement exists.
