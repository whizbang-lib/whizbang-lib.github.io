---
title: Claim loop
order: 2
description: >-
  How ClaimWorker polls claim_work: wake sources, adaptive backoff, the command
  lane, row-bounded acquisition, breadth-first head probing, claim-latency
  feedback on the adaptive window, work stealing, the per-category outstanding
  budget with the perspective drain cap, and the release of unstarted leases by a
  stuck instance.
tags: 'work-coordinator, claim-loop, claim-work, acquisition, backpressure, work-stealing, command-lane'
codeReferences:
  - src/Whizbang.Core/Workers/ClaimWorker.cs
  - src/Whizbang.Core/Workers/AdaptiveClaimWindow.cs
  - src/Whizbang.Core/Workers/AdaptiveOutstandingBudget.cs
  - src/Whizbang.Core/Workers/ClaimCycleReport.cs
  - src/Whizbang.Core/Messaging/ClaimWorkRequest.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Data.Postgres/Migrations/145_BoundedAcquisitionRewrite.sql
  - src/Whizbang.Data.Postgres/Migrations/150_BucketAwareClaim.sql
  - src/Whizbang.Data.Postgres/Migrations/157_ClaimAcquisitionBounded.sql
  - src/Whizbang.Core/Signals/BasePollSignalSource.cs
  - src/Whizbang.Core/Signals/PollIdleBackoff.cs
testReferences:
  - tests/Whizbang.Core.Tests/Workers/ClaimWorkerAcquisitionBoundsTests.cs
  - tests/Whizbang.Core.Tests/Workers/AdaptiveClaimWindowLatencyTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/BoundedAcquisitionRewriteSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ClaimWorkPlanShapeTests.cs
  - tests/Whizbang.Core.Tests/Signals/PollSignalSourceIdleBackoffTests.cs
---

# Claim loop

`ClaimWorker` is the only worker that polls the database. Every other worker is producer/consumer-driven (channel reads, bounded buffers, on-demand). This page describes the claim loop's design and tunables.

## What it does

```
loop:
  await wake (semaphore released by NOTIFY signal | local channel produce | adaptive timeout)
  workBatch = await coordinator.ClaimWorkAsync(req, ct)
  if workBatch.OutboxWork ∪ InboxWork ∪ PerspectiveStreamIds is non-empty:
    consecutiveEmptyPolls = 0
    OnBatchClaimed(workBatch)         ← downstream wiring (channels)
  else:
    consecutiveEmptyPolls++
  await semaphore.WaitAsync(adaptivePollWaitMs)
```

Three things make this efficient:

1. **Empty-call short-circuit in `claim_work` SQL** — when no work exists, the function returns in ≤ 1 ms (vs the legacy 17 ms floor).
2. **Adaptive backoff** — empty polls double the wait until `PollingMaxIntervalMilliseconds` (10 s default).
3. **Wake semaphore** — `RequestImmediatePoll()` releases the wait so notifications and local producers wake the worker immediately.

## Adaptive backoff

```
empty-poll #0 → wait base (250 ms)
empty-poll #1 → wait 250 ms     (no backoff yet — first non-empty resets)
empty-poll #2 → wait 500 ms
empty-poll #3 → wait 1000 ms
empty-poll #4 → wait 2000 ms
empty-poll #5 → wait 4000 ms
empty-poll #6+ → wait 10 000 ms (cap)

ANY non-empty result → reset to base (250 ms)
```

The adaptive cap is auto-clamped at startup to `AbandonStaleInstanceThresholdSeconds × 1000 / 3` so the heartbeat budget stays satisfied.

### The store-backed pull sources back off too

The claim loop is not the only thing that polls. Each work category has a pull source that asks the
store "is there anything for this instance" on a fixed cadence (5 s) as a backstop for a missed
NOTIFY, plus a due-schedule probe. With every queue empty those probes were most of the transactions
a busy database committed: over a hundred a second, a third of the server's CPU with nothing to do.

A pull source now stretches its own cadence while it keeps finding nothing: three empty ticks at the
base interval, then the interval doubles per empty tick up to a ceiling of one minute. A tick that
finds work returns it to the base interval and restarts the count, and so does the push transport
flipping (unavailable tightens the cadence to 500 ms; available relaxes it), because that reschedule
sets a new base.

```
empty tick #1..#3 → 5 s     (base; lulls between bursts cost nothing)
empty tick #4     → 10 s
empty tick #5     → 20 s
empty tick #6     → 40 s
empty tick #7+    → 60 s    (ceiling)

work found, or the signaling gate flips → back to the base interval
```

The ceiling bounds how long a store can hold work the push transport failed to announce before a poll
finds it, and it applies only while nothing arrives; a service under load never leaves the base
cadence. {verified: PollSignalSourceIdleBackoffTests.EmptyTicksPastTheThreshold_DoubleTheIntervalUpToTheCeilingAsync, PollSignalSourceIdleBackoffTests.WorkFound_ReturnsToTheBaseIntervalAsync, PollSignalSourceIdleBackoffTests.RescheduleFromOutside_ResetsTheStreakAndBecomesTheNewBaseAsync}

What remains of the idle transaction rate after the backoff is connection churn, not queries. Each
probe opens a pooled connection and closes it, and the driver resets a returned connection with a
`DISCARD ALL` on its next use, which the server counts as a transaction of its own: several hundred a
second per database were measured with nothing else running. That is a connection-string decision
on the consumer's side (`No Reset On Close=true` removes the reset; take it only where nothing relies
on session state being cleared, which the framework's own connections do not), or a smaller pool with
longer-lived connections.

## Wake signals

Three sources can release the wake semaphore:

| Source | When |
|---|---|
| **NOTIFY listener** (`PgWorkNotificationListener.OnSignal`) | A peer (or this instance) commits `commit_handler_result` and emits `pg_notify('wh_work', ...)`. |
| **Local channel produce** | A producer in this process queues new work via `IOutboxChannelWriter.WriteAsync` and signals via `OnNewWorkAvailable`. |
| **Adaptive timeout** | The current backoff window expires. |

Wake is idempotent: multiple producers calling `RequestImmediatePoll()` between ticks coalesce into one wake (semaphore capacity = 1).

## RAISE NOTICE in-band signaling

When `claim_work` returns a full batch (more eligible work than `p_max_streams`), it `RAISE NOTICE 'whizbang.has_more=true'`. The C# claim worker can subscribe to `NpgsqlConnection.Notice` and use this as an in-band drain signal — skip the wait, re-poll immediately. This survives pgbouncer (it's a protocol message, not session state).

This is currently a hint; the polling loop's adaptive backoff will reset to base on the next non-empty result regardless.

## Distribution to channels

When `claim_work` returns work, the C# coordinator deserializes envelopes and produces an `OutboxWork`/`InboxWork`/`PerspectiveStreamIds` shape. `ClaimWorker.OnBatchClaimed` fires; downstream consumers (or DI-wired channel writers in production) route to:

- `OutboxWork` → `IWorkChannelWriter` → consumed by `OutboxPublishWorker`
- `InboxWork` → `IInboxChannelWriter` → consumed by inbox dispatch path
- `PerspectiveStreamIds` → `IPerspectiveChannelWriter` → consumed by `PerspectiveProcessWorker`

Stream order within a partition is preserved by the SQL function; the channel itself preserves FIFO.

## What the loop decides before each claim

The sections that follow describe the inputs `ClaimWorker` computes for every `claim_work` call and the one corrective action it takes on its own leases. Together they are the claim loop's acquisition contract with the store (migration 145).

```mermaid{caption="Per-cycle decisions in ClaimWorker: the row bound for inbox acquisition, whether stealing is allowed, whether new perspective leases pause, the claim-latency feedback on the window, and, on a sustained re-offer, the release of unstarted leases." tests=["ClaimWorkerAcquisitionBoundsTests.Claim_CarriesARowBoundScaledFromTheStreamWindowAsync", "ClaimWorkerAcquisitionBoundsTests.Claim_StealsOnlyAfterTwoConsecutiveEmptyInboxClaimsAsync", "ClaimWorkerAcquisitionBoundsTests.Claim_PausesPerspectiveAcquisitionWhileTheDrainBacklogIsAboveItsCapAsync", "ClaimWorkerAcquisitionBoundsTests.RepeatedReoffer_ReleasesOnlyTheStreamsNotInFlight_OncePerStreakAsync"]}
flowchart TD
    A[wake] --> B[MaxStreams from the adaptive claim window]
    B --> C{outstanding budget governs?}
    C -- yes --> D[MaxAcquireRows = budget headroom in inbox rows]
    C -- no --> E[MaxAcquireRows = window x rows-per-stream estimate]
    D --> F[cap at MaxOutstandingInboxRows, floor 1]
    E --> F
    F --> G{own inbox claims empty twice running?}
    G -- yes --> H[AllowSteal = true]
    G -- no --> I[AllowSteal = false]
    H --> J{perspective drain backlog above MaxPerspectiveDrainBacklog?}
    I --> J
    J -- yes --> K[MaxPerspectiveStreams = 0]
    J -- no --> L[MaxPerspectiveStreams = null]
    K --> M[claim_work]
    L --> M
    M --> N[ObserveLatency: a slow claim halves the window]
    N --> O{same work set re-offered 8 cycles running?}
    O -- yes --> P[release_unstarted_leases for streams not in flight]
    O -- no --> Q[distribute stream ids to the drainers]
    P --> Q
```

## Acquisition is bounded in rows, not streams
{verified: BoundedAcquisitionRewriteSqlTests.ClaimWork_BoundsAcquisitionByRowsNotByStreamsAsync, ClaimWorkerAcquisitionBoundsTests.Claim_CarriesARowBoundScaledFromTheStreamWindowAsync, ClaimWorkerAcquisitionBoundsTests.Claim_RowBound_NeverExceedsTheOutstandingCeilingAsync}

`claim_work` does two different things with pending inbox rows: it **acquires** unowned or abandoned rows for this instance (leasing them), and it **re-emits** the stream ids the instance already holds so the drainers keep moving. Until migration 145 one number, `p_max_streams`, capped both. As a cap on re-emission it is a stream count, which is what the per-stream drainer wants. As a cap on acquisition it was applied to **rows**, which turned a fat stream into one row per cycle and a backlog of singleton streams into a full batch of them.

Acquisition now has its own bound, in rows: `p_max_rows` on `claim_orphaned_inbox` and `claim_work`, carried from the worker as `ClaimWorkRequest.MaxAcquireRows`. `p_max_streams` stays the stream bound for re-emission. The worker computes the row bound every cycle:

- while the [outstanding budget](/v1.0.0/operations/workers/claim-backpressure) governs, the bound is the budget's **headroom** (the inbox rows this instance may still take on);
- otherwise it is the adaptive stream window scaled by the running rows-per-stream estimate;
- either way never above `MaxOutstandingInboxRows` and never below one.

A null `MaxAcquireRows` makes the store fall back to `MaxStreams`, so a coordinator that predates the parameter behaves as it did.

## Breadth-first head probe instead of ranking the backlog
{verified: BoundedAcquisitionRewriteSqlTests.ClaimOrphanedInbox_ManyStreams_KeepsTheBreadthFirstOrderAsync, BoundedAcquisitionRewriteSqlTests.ClaimOrphanedInbox_FewFatStreams_TakesTheSameRowsPerStreamAsync}

The old acquisition answered "the next N rows" by ranking **every** eligible pending row (`ROW_NUMBER()` over the whole pending set, a sort on the computed rank, then the `LIMIT`), and inside that scan every row ran correlated ownership probes. The cost of leasing a few dozen rows therefore grew with the size of the backlog rather than the size of the batch, and under a bulk ingest the acquisition functions became most of the database's execution time while each claim leased a handful of rows.

Migration 145 rewrites the selection so that the cost follows the batch:

- **Ownership is decided per stream, once.** Two hashed sets (the streams this instance owns and the streams any live instance owns) are built once per call from the small `wh_active_streams` table; rows are tested against those sets instead of probing ownership per row.
- **Commands first** (the command lane, below).
- **Events breadth-first with an early stop.** When pending streams outnumber the remaining batch, the probe takes the head row of each stream in arrival order and stops as soon as the batch is full; it never ranks the set. When the batch is larger than the number of streams, it takes `k = ceil(remaining / streams)` rows per stream through a `LATERAL` subquery, which does not rank the set either. Both shapes keep the breadth-first interleave the pump has always had, only cheaper.
- **Locking is unchanged.** Rows are locked under breadth-first order with `SKIP LOCKED`, so a concurrent claimer's rows are skipped, not waited on.

The result order is exactly what it was: commands, then `(stream_seq, received_at, message_id)`. Only the plan changed; on a copy of a large backlog the rewrite read two orders of magnitude fewer buffers for the same rows in the same order.

## The outbox and perspective acquisitions are bounded the same way
{verified: ClaimWorkPlanShapeTests.ClaimWork_AcquiringFromAnUnownedBacklog_ReadsAFewBatchesNotTheBacklogAsync, ClaimWorkPlanShapeTests.ClaimWork_AfterTheTablesFill_ReadsAFewBatchesNotTheBacklogAsync}

The inbox was the first acquisition bounded by its batch; the other two were still bounded by the
backlog, and under a bulk load that is where the database's time went. Measured, one claim poll read
tens of thousands of blocks and the queue tables were scanned whole several times per poll on every
instance, so the poll alone took most of the server's cores and the backlog grew because of it.
Adding instances made it worse, because every instance paid the backlog on every poll.

- **The outbox acquisition** orders pending singles by arrival and stops at its row bound, but no
  index carried that order over the pending rows, so the planner sorted every pending row to keep a
  batch. Migration 157 adds `idx_outbox_pending_arrival`, a covering partial index in
  `(created_at, message_id)` order over pending singles, and the same statement now walks it and
  stops.
- **The perspective acquisition** chose its most urgent streams by aggregating every claimable
  event. It now takes a bounded window of the most urgent events (a small multiple of the stream
  batch, walked in `(priority, event_id)` order from `idx_perspective_event_urgency`, also added by
  157), chooses streams from that window, and captures each chosen stream in full through a join
  back to the table, so per-stream ordering is exactly what it was.
- **The plans follow the tables.** The queue tables are empty between loads, and a session that
  polled while they were empty kept generic plans made for empty tables; once the tables filled, those
  plans scanned them whole, nested, and the same poll that takes well under a second on fresh plans
  did not finish inside the command timeout. `claim_work` runs under
  `plan_cache_mode = force_custom_plan`, which applies to everything it calls, so every poll plans
  for the tables as they are.

The test reproduces both shapes: it polls empty tables enough times for the session to settle on the
plans it will keep, fills every queue table with wide rows, polls again on the same session, and reads
from `pg_stat_user_tables` how many tuples each table gave up for that one call. A bounded poll reads
a few batches; one bounded by the backlog reads all of it.

## The re-offer is bounded by the batch too
{verified: ClaimWorkPlanShapeTests.ClaimWork_ReofferingWhatItHolds_IsPricedByTheBatchNotTheHoldingsAsync}

Acquisition is one half of a poll. The other half is the **re-offer**: a busy instance holds as many
leased rows as its budget allows, has already handed most of them to a drainer, and polls several
times a second to hand back the streams it holds so the drainers keep a current work list. With
acquisition bounded, that half was still priced by the holdings rather than by the batch, and on a
saturated database it was what remained of the poll's cost.

Migration 158 bounds each part of it:

- **The orphan guards** decide whether to call an acquisition at all. Each read
  `processed_at IS NULL AND (instance_id IS NULL OR lease_expiry < now)`, and a disjunction has no
  index order, so proving nothing was orphaned examined every pending row: on a busy instance, its
  whole holdings, three times a poll. Each guard now probes two index heads instead, unowned rows and
  the oldest live lease, so an instance whose leases are all live proves it at the first entry.
- **The outbox re-offer** ranked every held row with a window function the query never read, then
  sorted them all and kept a batch. It walks a covering index in holder-and-arrival order and stops.
- **The inbox and perspective re-offers** enumerate the streams the instance holds through a lane
  index, one index-only probe per stream, lane by lane in the order the batch is ordered: most urgent
  bucket first, commands before events, and for the inbox the fresh and retried classes side by side
  so the fresh-work share still holds. Each lane's walk starts at a stream id drawn per poll and
  wraps once, so a lane larger than the batch does not hand back the same streams on every poll.
- **The inbox event-store chain**, which gives an inbox event leased at store time its event-store
  row and its perspective work, re-checked every held event against the event store on every poll.
  It now reads only rows it has not finished with and stamps the ones whose event it finds there.

**A held inbox stream is handed back as one row per lane, not as every row it holds in that lane.**
The drainers have consumed stream ids and pulled a stream's rows on demand since the per-stream
drain landed, and the batch hooks fold a stream's returned rows to its most urgent number and oldest
arrival, so the further rows inside one lane carried nothing a caller read while ranking them was the
poll's whole cost. A stream whose rows span priority buckets or the command and event lanes is still
returned once per lane, and the fold over those rows is unchanged; what changes is that
`PriorityBatchEntry.PendingRows` counts the lanes a stream appears in (normally one) rather than its
rows in the batch. The perspective re-offer's small-streams-first tier is gone with it: that tier
guarded a batch of rows against one large stream, and the drain has been per stream with an unbounded
channel since the per-stream drain landed, so a large stream no longer displaces small ones.

Measured on a container, one steady-state poll returning 300 rows out of a batch of 100 per category,
summed over the outbox, inbox, perspective-event and event-store tables and their indexes:

| Held rows per table | Blocks before | Tuples before | Blocks after | Tuples after |
|---|---|---|---|---|
| 5,000 | 5,425 | 35,012 | 700 | 305 |
| 10,000 | 10,705 | 70,012 | 912 | 305 |
| 40,000 | 42,388 | 280,012 | 925 | 304 |

Eight times the holdings cost eight times as much before and 1.3 times as much after, and the tuples
a poll examines no longer depend on the holdings at all. The test asserts both ceilings per table,
once at a full budget of holdings and again at double it: blocks catch the heap fetches, and tuples
catch an index-only pass over the whole holdings, which is cheap in blocks and still grows with the
backlog.

## The command lane
{verified: BoundedAcquisitionRewriteSqlTests.ClaimOrphanedInbox_PicksAPendingCommandBeforeAnyEventWhateverTheBacklogAsync, BoundedAcquisitionRewriteSqlTests.ClaimWork_ReemitsCommandsAheadOfEventsAsync}

A command (`is_event = FALSE`) is a request someone is waiting on; an event is a fact nobody is. The claim used to serve the inbox in arrival order with no distinction between the two, so an interactive command that arrived behind a bulk fan-in of events waited for the whole fan-in to drain. Commands now form a **lane** that is picked before any event, in both halves of the claim:

- **Acquisition.** `claim_orphaned_inbox` ranks pending commands first, in per-stream arrival order, backed by a covering partial index over pending command rows (`idx_inbox_pending_commands`: `processed_at IS NULL AND is_event = FALSE`), and only then lets events fill the rest of the batch. Pending commands are few, so ranking the lane alone is cheap.
- **Re-emission.** `claim_work` orders the inbox streams the instance holds with `CASE WHEN is_event THEN 1 ELSE 0 END` ahead of the existing breadth-first class ordering, so a stream holding a command is handed to the drainer before streams holding only events, every cycle.

Ordering *within* a class is unchanged and per-stream FIFO is preserved: a command still waits behind earlier rows of its own stream.

## Claim latency feeds the adaptive window
{verified: AdaptiveClaimWindowLatencyTests.ObserveLatency_AClaimFarSlowerThanTheLearnedNorm_HalvesTheWindowAsync, AdaptiveClaimWindowLatencyTests.ObserveLatency_NormalClaims_LeaveTheWindowAloneAsync, AdaptiveClaimWindowLatencyTests.ObserveLatency_BeforeANormExists_DoesNotReactAsync, AdaptiveClaimWindowLatencyTests.ObserveLatency_SlowButStillFast_DoesNotReactAsync, AdaptiveClaimWindowLatencyTests.ObserveLatency_NeverBelowTheFloorAsync}

The churn signal tells the adaptive claim window whether a batch was too big to **drain**. It says nothing about whether the batch was too big to **acquire**. Acquisition cost grows with the pending backlog, and a loop that keeps asking for the same width while each claim takes seconds spends its time in the claim instead of in the drain. The claim's own duration is now a second input, `AdaptiveClaimWindow.ObserveLatency(elapsed)`, judged against a norm the window learns from the claims themselves. There is no operator knob, because the right number depends on the database, the batch and the backlog, none of which an operator can see from a configuration file.

| Rule | Value |
|---|---|
| Warm-up before the norm is trusted | 3 samples (a cold first claim is not a signal) |
| Norm | exponential moving average, newest sample weighted 0.2 |
| "Slow" | at least 250 ms **and** more than 4 x the norm |
| Response to a slow claim | halve the window, never below the floor; the slow sample is clamped to 4 x the norm before it enters the average, so one outlier does not double the norm and hide the next slow claim |
| Response to a normal claim | refine the norm only |

Latency never **grows** the window. Fast claims are the normal case, and growth stays with the churn signal, which knows whether the batch drained. When the window narrows on latency, the worker logs the before and after widths and the claim's duration.

## Work stealing after two empty own-residue claims
{verified: BoundedAcquisitionRewriteSqlTests.ClaimOrphanedInbox_IdleRank_TakesAnotherResiduesRowsOnlyWhenStealingIsAllowedAsync, ClaimWorkerAcquisitionBoundsTests.Claim_StealsOnlyAfterTwoConsecutiveEmptyInboxClaimsAsync, ClaimWorkerAcquisitionBoundsTests.Claim_StopsStealingOnceOwnWorkReturnsAsync}

Unowned rows are assigned to instances by residue: `partition_number % active_instance_count = rank`. When one rank's instance is alive but not progressing, its residue of the unowned backlog has no eligible acquirer while a healthy instance sits idle beside it. `p_allow_steal` (from `ClaimWorkRequest.AllowSteal`) lets an instance whose own residue is empty take unowned rows of **any** residue.

Stealing is a last resort, never a first move. The worker sets `AllowSteal` only after its own inbox claims have come back empty **twice running** (`STEAL_AFTER_EMPTY_CLAIMS = 2`) and clears it the moment its own work returns, so under normal load the residues stay disjoint and ownership stays stable. The store enforces the rule that matters for safety: stealing applies to **unowned** rows only, and never to a stream another live instance is mid-drain on. A stream in which another instance holds a live row lease is skipped whatever the flag says, because taking its next row would interleave one stream across two instances and break per-stream order. The check is a row-level probe on the steal path only, so the normal path pays nothing for it. {verified: BoundedAcquisitionRewriteSqlTests.ClaimOrphanedInbox_Steal_SkipsAStreamAnotherInstanceIsMidDrainAsync}

Permission is decided per cycle: the rows a stealer leaves behind in a stream still belong to their residue, and the stealer takes more only while its own residue keeps coming back empty. {verified: BoundedAcquisitionRewriteSqlTests.ClaimOrphanedInbox_IdleRank_TakesAnotherResiduesRowsOnlyWhenStealingIsAllowedAsync}

## The outstanding budget reads inbox rows only; perspective has its own cap
{verified: ClaimWorkerAcquisitionBoundsTests.Budget_ReadsInboxRowsOnly_SoAPerspectiveBacklogCannotCloseInboxHeadroomAsync, ClaimWorkerAcquisitionBoundsTests.Claim_PausesPerspectiveAcquisitionWhileTheDrainBacklogIsAboveItsCapAsync, ClaimWorkerAcquisitionBoundsTests.Claim_LeavesPerspectiveAcquisitionAloneWhileTheDrainBacklogIsUnderItsCapAsync, BoundedAcquisitionRewriteSqlTests.ClaimWork_PerspectiveBoundOfZero_LeasesNoNewPerspectiveWorkButKeepsReemittingHeldWorkAsync}

`AdaptiveOutstandingBudget` is **on by default**. It bounds the total inbox rows this instance holds across claims (the claim window bounds only each individual claim), and two changes made it safe to leave on:

- **It reads inbox rows only.** The budget samples inbox completions, so its headroom is read against `OutstandingWork.InboxRows`, never against outbox or perspective rows. Folding the three together let a perspective backlog close the inbox headroom (the inbox starved behind work it could not affect) and, in the other direction, let a large inbox holding hide behind a drained perspective set.
- **Perspective acquisition has its own cap, `MaxPerspectiveDrainBacklog`** (default 2,000 stream ids; `0` disables). The perspective drain channel is unbounded by design (a bounded channel deadlocked the drain in an earlier design), so without a cap a bulk ingest queued every perspective stream it touched in process memory ahead of a fixed-parallelism drain. While the channel holds more stream ids than the cap, the claim passes `MaxPerspectiveStreams = 0` (`p_max_perspective_streams`), which leases **no new** perspective work this cycle. Re-emission of perspective work already held is unaffected, so the drain keeps moving while acquisition waits, and the cap lifts as soon as the channel drains below it. A channel that cannot report its count behaves as if there were no cap.

The budget's headroom is also what becomes `MaxAcquireRows` while the budget governs (above), so a collapse of the budget bounds rows, not streams, and can no longer turn into one row per cycle.

## A stuck instance releases what it has not started
{verified: ClaimWorkerAcquisitionBoundsTests.RepeatedReoffer_ReleasesOnlyTheStreamsNotInFlight_OncePerStreakAsync, ClaimWorkerAcquisitionBoundsTests.RepeatedReoffer_DoesNotReleaseBeforeTheStreakAsync, ClaimWorkerAcquisitionBoundsTests.ProductiveClaim_ResetsTheReleaseStreak_SoALaterStuckRunReleasesAgainAsync, ClaimWorkerAcquisitionBoundsTests.RepeatedReoffer_StoreWithoutTheRelease_KeepsClaimingAsync, BoundedAcquisitionRewriteSqlTests.ReleaseUnstartedLeases_ReturnsOnlyTheNamedStreamsRefundsTheAttemptAndOpensThemToSiblingsAsync, BoundedAcquisitionRewriteSqlTests.ReleaseUnstartedLeases_NeverTouchesAnotherInstancesLeasesAsync}

Siblings cannot take work from a heartbeating instance; that is what [liveness](/v1.0.0/fundamentals/workers/instance-liveness) protects. The other side of that rule is a livelock: an instance whose consumers are stuck holds leased rows that nothing drains, and from outside it is indistinguishable from an idle service (modest CPU, no errors, no restarts) while the backlog it holds cannot move. The instance itself has to let go of what it is not working on.

`ClaimCycleReport` already tracks **re-offers**: a claim that returns exactly the previous claim's work set is not progress. When the same work set has been re-offered for **eight consecutive cycles** (`RELEASE_UNSTARTED_AFTER_REPEATS = 8`), the worker calls `IWorkCoordinator.ReleaseUnstartedLeasesAsync(instanceId, inboxStreamIds, perspectiveStreamIds)`, naming only the streams the drain channels report as **not in flight**. Streams a consumer is actively processing are never named, and emission is untouched, so anything that *is* draining keeps flowing. One release per streak; the streak resets on any productive claim, so a later stuck run releases again. The result, `UnstartedLeaseRelease(InboxReleased, PerspectiveReleased)`, is logged with the streak length and the stream counts.

The store side is `release_unstarted_leases(p_instance_id, p_inbox_stream_ids, p_perspective_stream_ids)` (migration 145). For rows leased to the calling instance in the named streams and not yet processed it refunds the optimistic attempt the claim charged (`attempts = GREATEST(attempts - 1, 0)`, since the rows never reached a receptor), clears `instance_id` and `lease_expiry`, and ends the instance's ownership of those streams in `wh_active_streams` so the unowned path opens to siblings. Two invariants:

- **The instance calls it on itself.** Nothing is ever taken from a heartbeating instance by anyone else; the function only touches rows whose `instance_id` is the caller's, so a sibling's leases are never affected.
- **A store without the function is not an error.** The default `IWorkCoordinator` implementation throws `NotImplementedException`; the worker logs that the rows stay leased to this instance until they lapse (the previous behavior) and keeps claiming.

## Configuration

| Knob | Default | Effect |
|---|---|---|
| `PollingIntervalMilliseconds` | 250 | Base poll cadence. |
| `PollingMaxIntervalMilliseconds` | 10 000 | Adaptive backoff cap. Clamped to ≤ stale-threshold/3. |
| `MaxStreamsPerBatch` | 1000 | Cap on what one call hands back: streams for inbox and perspective work, rows for outbox and receptor work. Acquisition has its own row bound (`MaxOutstandingInboxRows`, below). |
| `PartitionCount` | 10 000 | Modulo partition count. |
| `LeaseSeconds` | 300 | Lease duration on claimed work. |
| `AdaptiveOutstandingBudget` | true | Bound the total outstanding inbox rows across claims (per category, row-bound). `false` falls back to the churn-based claim window alone. |
| `MaxOutstandingInboxRows` | 10 000 | Ceiling on the acquisition row bound. |
| `MaxPerspectiveDrainBacklog` | 2 000 | Perspective drain channel backlog above which new perspective leases pause; `0` disables the cap. |

## Observability

`ClaimWorker.OnBatchClaimed` fires per non-empty tick — wire to your metrics for batch-size histograms.

The notification listener exposes `IsHealthy` + `OnHealthChanged`; expose via `/health/notifications` for ops dashboards.

## Failure modes

| Failure | Behavior |
|---|---|
| `ClaimWorkAsync` throws | Log warn, increment empty-poll counter (back off), retry on next tick. |
| Pooled connection unreachable | Existing `WorkerRetryOptions` exponential backoff. |
| Notification listener unhealthy | `OnHealthChanged(false)` fires; claim worker can flip to fast polling cadence (current implementation: subscribers can wire this; the default ClaimWorker doesn't yet). |

## Related

- [Notifications and pgbouncer](notifications-and-pgbouncer.md)
- [Configuration reference](configuration-reference.md)
- [Failure and recovery](failure-and-recovery.md)
- [Handler commit](handler-commit.md)
- [Claim backpressure](/v1.0.0/operations/workers/claim-backpressure): the outstanding budget and the adaptive claim window in depth.
- [Instance liveness](/v1.0.0/fundamentals/workers/instance-liveness): why siblings never take work from a heartbeating instance.
