---
title: Claim Backpressure — Bounding Outstanding Work
pageType: concept
verifiedAgainstCommit: d7d70e528bd84569e4c3bfc3034a71956c6162f9
verifiedDate: 2026-08-23
version: 1.0.0
category: Workers
order: 5
description: >-
  Why bounding the size of each claim does not bound how much work an instance
  holds, and how the outstanding-row budget prevents a backlog from consuming
  its own retry budget. Covers AdaptiveOutstandingBudget, the rows-versus-streams
  distinction, cold-start behavior, stall handling, and the tuning knobs.
tags: >-
  claim-work, backpressure, leases, attempts, max-attempts-exceeded,
  outstanding-work, adaptive-claim-window, dead-letter, admission-control
codeReferences:
  - src/Whizbang.Core/Workers/AdaptiveOutstandingBudget.cs
  - src/Whizbang.Core/Workers/AdaptiveClaimWindow.cs
  - src/Whizbang.Core/Workers/ClaimWorker.cs
  - src/Whizbang.Core/Messaging/IInboxChannelWriter.cs
testReferences:
  - tests/Whizbang.Core.Tests/Workers/AdaptiveClaimWindowSampleSizeTests.cs
  - tests/Whizbang.Core.Tests/Workers/AdaptiveOutstandingBudgetTests.cs
  - tests/Whizbang.Core.Tests/Workers/AdaptiveOutstandingBudgetLeaseAwarenessTests.cs
---

## The failure

An instance claims work, leases it, and charges each row a retry attempt. If it claims more than it
can dispatch before the lease expires, those rows expire un-dispatched, are claimed again, are
charged again, and eventually dead-letter as `MaxAttemptsExceeded` — **having never reached a
receptor**. Pods are healthy, handlers are healthy, and nothing appears in the logs.

The rows carry their own evidence. `claim_orphaned_inbox` stamps an abandoned attempt as:

```
Attempt N ended without a reported outcome: lease held by instance <id> expired at <ts>
```

with `failure_reason = 6` (`LeaseExpired`). A thrash query keyed on `error IS NULL` will report
zero while this runs continuously.

## Cause 1 — acquisition was never bounded

`claim_work` computes a claim limit from the adaptive window and the outstanding budget, and passes
it to `claim_orphaned_perspective_events`. It did **not** pass it to `claim_orphaned_inbox` or
`claim_orphaned_outbox`.

Those functions were a single `UPDATE ... WHERE`, with no `LIMIT`. They leased **every eligible row
in one statement** and bumped `attempts` on each. An instance starting onto a large backlog acquired
all of it at once.

Meanwhile the limit that *was* computed bounded only re-emission. `claim_work`'s `eligible_inbox`
filters on `instance_id = p_instance_id`, so it returns work the instance **already holds** — the
limit governed the outflow, never the intake:

> At any batch size, throttling a valve downstream of the flood changes how fast the level rises,
> not whether it rises.

That is why narrowing the claim window changed the rate of lease saturation and then **plateaued
rather than converging**.

Both functions now take `p_max_rows` and select candidates oldest-first under
`FOR UPDATE ... SKIP LOCKED` before updating. The full ownership predicate lives in that candidate
selection rather than a cheap pre-filter: selecting by age and filtering for ownership afterwards
would let one instance's rows permanently occupy another instance's window, so it would claim
nothing while its own work waited behind them.

`LIMIT NULL` is unlimited in Postgres, so the parameter defaults to the previous behavior for any
caller that passes no bound.

## Cause 2 — outstanding was read from a truncated query

The budget bounds *total* outstanding work, so it must know how much the instance is holding. That
figure cannot come from the claim response.

`claim_work` truncates its `eligible_*` CTEs with `LIMIT p_max_streams`, and those CTEs match rows
already leased to the caller. So a count taken from the response **can never exceed the limit the
budget just produced**. The control loop reads its own output instead of the system state: headroom
looks abundant however much is held, every poll claims more, and the number being watched sits still.

Observed with the bound enabled and arithmetically correct: throughput fell to zero while the
instance held roughly **twelve times** the most the budget would ever have permitted.

`count_outstanding_work` (migration 123) answers the question directly and untruncated, in one
indexed round trip. It is read-only — no leases, no attempt bumps, nothing to strand.

It is deliberately **not** a counter kept in the worker. An in-memory figure stranded by a hung or
canceled task stays wrong until the process restarts; an earlier in-memory `IsInFlight` filter on
this same path proved unrecoverable in production for exactly that reason.

## Unmeasured is not zero

Every precondition must hold before the bound engages: the operator enabled it, drain is measurable
(a `WorkCompletionMeter` is registered), and the store can report outstanding work.

If any is missing the budget **does not engage at all**. Zero would be a measurement meaning "holds
nothing", which licenses a full-size claim; `null` means "never read". A budget sized from a number
nobody read is worse than no budget, because it throttles silently and presents as an unexplained
performance problem.

Because a silently-inactive bound is indistinguishable from a working one — which is how an earlier
version shipped, deployed, and looked correct while holding twelve times its limit — the state is
stated at startup:

```
ClaimWorker outstanding budget ACTIVE: floor=100 rows, ceiling=10000 rows, leaseSeconds=300, safetyFactor=0.5
ClaimWorker outstanding budget INACTIVE (no WorkCompletionMeter registered, so drain is unmeasurable) — ...
ClaimWorker outstanding budget DISENGAGED: the work coordinator does not report outstanding work — ...
```

A coordinator that cannot measure is asked **once**, then latched: it is a property of the backend,
not a transient condition, and re-probing would spend a query per poll to repeat the same warning.

## Sizing, cold start, and stalls

The budget permits `drainRate × leaseSeconds × safetyFactor` rows outstanding.

- **Rows, not streams.** Rows are the unit leases are held in, and rows-per-stream varies by orders
  of magnitude within one workload. `ClaimWorker` converts the row budget into the stream count the
  claim API takes, using a smoothed rows-per-stream estimate; a bad estimate shows up as overshoot
  next cycle and is re-bounded.
- **Cold start at the floor.** A restart carrying a large backlog has no drain history, and that is
  precisely the situation that produces one. Capacity is earned from observed completions.
- **The safety factor is deliberate headroom.** Lease expiry is a cliff, not a slope: at full
  computed capacity any slowdown tips straight into mass expiry.
- **Stalled means claim almost nothing.** Work held with nothing completing cannot be helped by more
  claims. Two guards keep that from deadlocking: an *unmeasured* zero rate is unknown rather than
  stalled, and the claim never sizes to zero — polling is the only thing that observes outstanding
  work, so a worker that stopped polling could never discover it had recovered. Re-offering rows it
  already holds charges no new attempt.

## The budget follows a slowdown at once {#lease-aware-budget}

{verified: AdaptiveOutstandingBudgetLeaseAwarenessTests.Observe_ARateCollapse_ShrinksTheBudgetOnTheNextSampleAsync, AdaptiveOutstandingBudgetLeaseAwarenessTests.Observe_ARateRise_IsStillSmoothedAsync, AdaptiveOutstandingBudgetLeaseAwarenessTests.Observe_AQuietInterval_StaysSmoothed_ButALowerPositiveRateTakesEffectAtOnceAsync}

The budget is only a bound if the drain rate it multiplies is the rate the consumer has *now*. The
estimate is exponentially smoothed so that one fast interval cannot license a large claim. Smoothing
a slowdown the same way had the opposite cost: after a handler slowed or the database began to
contend, the estimate kept most of the old rate for several intervals and the budget stayed sized to
it, so the instance went on holding `oldRate × leaseSeconds × safetyFactor` rows while completing
far fewer. Rows were leased that could not be completed inside their lease, which is exactly what
the bound exists to prevent, and at the ceiling every lease lapsed together.

The smoothing is asymmetric:

- **A positive sample below the estimate replaces it.** Capacity that has been lost is lost now. The
  next claim is sized to the observed rate, so `leased ≤ rate × leaseSeconds × safetyFactor` holds
  for any rate slower than the estimate, whatever the ceiling.
- **A sample above the estimate is still blended in.** Capacity is earned; one good interval is not
  evidence of sustained throughput.
- **A zero sample is still blended in.** One quiet interval is not a stall (the poll may simply have
  found nothing to complete), so the estimate decays rather than collapsing. A real stall is what the
  stalled guard above answers.

`ClaimWorker` converts the row budget to a stream count as before. Nothing changes in the conversion,
only in how fast the row figure tracks a slowdown.

## The adaptive claim window

{verified: AdaptiveClaimWindowSampleSizeTests.SampleSize_OneReofferedRow_DoesNotHalveTheWindowAsync, AdaptiveClaimWindowSampleSizeTests.SampleSize_NarrowerThanTheFloor_EarnsNoGrowthEitherAsync}

`AdaptiveClaimWindow` sizes each claim (in streams) from observed churn, the share of claimed rows
that arrived with `attempts > 1`. It starts at its floor (default 25 streams), never goes below it,
and never exceeds the configured batch size. A cycle whose churn is above the threshold (default
0.5) halves the window; only a completely clean cycle, once drain has been measured, grows it by the
additive step (default 25). An empty claim says nothing about capacity and is ignored.

A claim narrower than the window's floor is ignored as well: it neither shrinks nor grows the
window, because a sample that small is not a signal. One re-offered row in a claim of one read as
100 % churn, and a run of such claims could halve a wide window several times within a second, so
the window collapsed to its floor on noise rather than on overload.

## Tuning

| Option | Default |
|---|---|
| `AdaptiveOutstandingBudget` | `true` (on by default; see below) |
| `MinOutstandingInboxRows` | `100` (also the cold-start value) |
| `MaxOutstandingInboxRows` | `10000` |
| `OutstandingBudgetSafetyFactor` | `0.5` |

### What the budget counts

The budget samples **inbox** completions and reads its headroom against **inbox** rows only. An
earlier version counted leased work of every category as outstanding, so a perspective backlog on
its own read as a drain rate of zero, inbox headroom collapsed, and inbox acquisition starved while
the database sat idle. That is why the budget once shipped off by default. With the count scoped to
the category it measures, perspective acquisition is paced separately (it pauses while the drain
channel is above `MaxPerspectiveDrainBacklog`), and the budget is on by default. Converting row
headroom into a stream count (`streamsAffordable = headroom / rowsPerStream`) still floors at
`max(1, ...)`, so a collapsed budget claims one stream per cycle rather than nothing, and the
churn-based [adaptive claim window](#cause-1-acquisition-was-never-bounded) remains a bound of its own.

## Verifying it in a live system

Count rows whose abandonment marker was stamped after a known mark, bucketed by the **embedded**
lease-expiry timestamp, and **exclude the current minute** — a still-filling bucket reads as a
decline that is not real:

```sql{title="Abandoned-attempt rate by minute" description="Counts rows whose abandonment marker was stamped after a known mark, bucketed by the embedded lease-expiry timestamp and excluding the still-filling current minute." category="Operations" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "Backpressure", "Diagnostics"]}
SELECT to_char(ts,'HH24:MI') AS minute, count(*)
FROM (
  SELECT (substring(error from 'expired at ([0-9-]+ [0-9]{2}:[0-9]{2}:[0-9]{2})'))::timestamp AS ts
  FROM wh_inbox
  WHERE processed_at IS NULL
    AND error LIKE '%ended without a reported outcome%'
) t
WHERE ts > TIMESTAMP :mark
  AND ts < date_trunc('minute', now())
GROUP BY 1 ORDER BY 1;
```

A single clean sample is not sufficient: under the earlier design the rate fell substantially before
climbing back. Confirm across a full lease window.
