---
title: Idle Footprint
pageType: concept
version: 1.0.0
category: Fundamentals
order: 10
description: >-
  How an idle service stays quiet on its database: adaptive probe cadence for
  the durable signal tail, the backlog-age duty and the lifecycle monitor,
  why duty election stays cheap while contended, and the two passive meters
  that show the footprint.
tags: 'workers, idle, polling, backoff, duty-election, probes, metrics'
codeReferences:
  - src/Whizbang.Core/Workers/AdaptiveIdleBackoff.cs
  - src/Whizbang.Core/Observability/ProbeCadenceMetrics.cs
  - src/Whizbang.Core/Observability/InstanceLivenessMetrics.cs
  - src/Whizbang.Core/Observability/BacklogAgeWorker.cs
  - src/Whizbang.Data.Postgres/Notifications/PgDurableSignalTailWorker.cs
  - src/Whizbang.Data.Postgres/Notifications/PgRoleElector.cs
  - src/Whizbang.Data.Postgres/Notifications/PgInstanceLifecycleMonitor.cs
testReferences:
  - tests/Whizbang.Core.Tests/Workers/AdaptiveIdleBackoffTests.cs
  - tests/Whizbang.Core.Tests/Observability/ProbeCadenceMetricsTests.cs
  - tests/Whizbang.Core.Tests/Observability/BacklogAgeCadenceTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PgDurableSignalTailWorkerCadenceTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/RoleAssignmentSqlTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/DutyHolderWorkerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/CommitOrderStamperRoleTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PgInstanceLifecycleMonitorUnitTests.cs
---

# Idle footprint

A service with an empty queue should be close to silent on its database. Every periodic probe in Whizbang has a doorbell or a signal as its fast path; the poll behind it is a safety net, and a safety net can afford to relax while nothing is happening. This page describes the controls that make the probes back off when idle, why duty election stays cheap while another instance holds a duty, and the two meters that show the resulting footprint.

The problem this solves: an idle fleet of several instances was measured issuing tens of statements per second against a shared database from fixed-cadence probes alone (the durable signal tail scan, estimated depth counts, and, in earlier releases, advisory-lock retries in duty election). None of that traffic did anything. Each probe kept its cadence whether or not the previous tick had found work.

## One cadence controller: `AdaptiveIdleBackoff`

`AdaptiveIdleBackoff` is a pure cadence controller with no knobs of its own. It takes a floor (the cadence while work is being found, also the first idle delay), a ceiling (where the cadence converges while idle), and a multiplier (default 2). Each call to `Next(foundWork)` returns the delay to wait before the next probe:

- **Work found**: the floor, and the controller resets to the floor.
- **Nothing found**: the current idle delay, which then grows by the multiplier up to the ceiling.
- `Reset()` snaps the cadence back to the floor for an external wake (a signal, a doorbell) without recording a pass.

Floor and ceiling always come from options the worker already has, so no new configuration is introduced anywhere the controller is used.

```csharp{
title: "Drive a probe loop from AdaptiveIdleBackoff"
description: "The worker's existing cadence is the floor and an existing option is the ceiling; the delay before each probe comes from the outcome of the last one."
framework: "NET10"
category: "Workers"
difficulty: "INTERMEDIATE"
tags: ["idle-footprint", "adaptive-backoff", "polling", "workers"]
tests: ["AdaptiveIdleBackoffTests.IdlePasses_DoubleUpToTheCeilingAndStayThereAsync", "AdaptiveIdleBackoffTests.FindingWork_SnapsBackToTheFloorAsync", "AdaptiveIdleBackoffTests.Construction_StartsAtTheFloorAsync"]
}
var cadence = new AdaptiveIdleBackoff(floor: TimeSpan.FromSeconds(2), ceiling: options.PollingFallbackInterval);

while (!stoppingToken.IsCancellationRequested) {
  var delivered = await ScanOnceAsync(stoppingToken);
  var delay = cadence.Next(foundWork: delivered > 0);   // floor after work, else 2, 4, 8, ... up to the ceiling
  await Task.Delay(delay, timeProvider, stoppingToken);
}
```

```mermaid{caption="AdaptiveIdleBackoff: idle probes double the delay from the floor toward the ceiling; the first probe that finds work snaps back to the floor." tests=["AdaptiveIdleBackoffTests.IdlePasses_DoubleUpToTheCeilingAndStayThereAsync", "AdaptiveIdleBackoffTests.FindingWork_SnapsBackToTheFloorAsync", "AdaptiveIdleBackoffTests.CeilingEqualToFloor_NeverGrowsAsync"]}
stateDiagram-v2
    direction LR
    Floor : At the floor
    Growing : Idle, delay doubling
    Ceiling : At the ceiling
    [*] --> Floor
    Floor --> Growing : probe found nothing
    Growing --> Growing : probe found nothing (delay x 2)
    Growing --> Ceiling : delay reaches ceiling
    Ceiling --> Ceiling : probe found nothing
    Growing --> Floor : probe found work
    Ceiling --> Floor : probe found work
    Floor --> Floor : probe found work
```

## Where the controller is applied

| Probe | Floor | Ceiling | What counts as "found work" |
|---|---|---|---|
| Durable signal tail (`PgDurableSignalTailWorker`) | 2 s (the previous fixed cadence) | `WhizbangNotificationOptions.PollingFallbackInterval` (clamped to at least the floor) | The scan delivered at least one signal. A failed tick counts as idle: backing off is also the right response to a struggling database. |
| Backlog-age duty (`BacklogAgeWorker`) | `BacklogAgeOptions.Interval` | 4 x `Interval` | Any peeked entity showed depth. The decision is taken inside `PeekOnceAsync` and exposed as `NextInterval`, so it is provable without running the loop. |

{verified: PgDurableSignalTailWorkerCadenceTests.CreateBackoff_FloorsAtTwoSecondsAndCeilsAtThePollingFallbackAsync, PgDurableSignalTailWorkerCadenceTests.CreateBackoff_IdleScans_ReachTheCeilingInFourStepsAsync, PgDurableSignalTailWorkerCadenceTests.CreateBackoff_PollingFallbackBelowTheFloor_ClampsTheCeilingToTheFloorAsync, BacklogAgeCadenceTests.EmptyPeeks_StretchTheIntervalUpToFourTimesAsync, BacklogAgeCadenceTests.DepthAppearing_SnapsBackToTheConfiguredIntervalAsync, BacklogAgeCadenceTests.DepthOnAnyEntity_CountsAsFoundAsync}

With the default 30 s polling fallback, an idle durable signal tail runs 2, 4, 8, 16, 30 s and then holds at 30 s: one scan per instance per fallback interval instead of one every two seconds. A busy tail keeps the original 2 s cadence, and each tick still uses one connection as before.

The instance lifecycle monitor relaxes too, but under its own rule rather than this controller, because its cadence has to track how close any peer is to the liveness threshold: 5 s while any heartbeat row is past half the stale threshold, otherwise a sixth of the threshold clamped between 5 s and 30 s. See [Instance liveness](./instance-liveness.md#the-lifecycle-monitor-asks-the-two-signal-predicate). {verified: PgInstanceLifecycleMonitorUnitTests.ComputeTickInterval_FleetFresh_RelaxesToASixthOfTheThresholdAsync, PgInstanceLifecycleMonitorUnitTests.ComputeTickInterval_SomeoneHalfwayToTheThreshold_TicksFastAsync}

## Duty election stays cheap while contended {#duty-election}

Exclusive duties (`migrator`, `maintainer`, and the rest) are won through `IDutyElector`, and every duty is a [role assignment](/v1.0.0/operations/startup/capabilities-and-duties#role-assignment-the-default). Asking for a duty another instance holds costs one statement that reads the role row and writes nothing, so a contended attempt is cheap without any damping of its own.

| Choice | Reason | Verified |
|---|---|---|
| A vote for a duty with a live holder answers `contended` from a read of the role row, without the vote lock, and writes nothing (the candidacy row is written only when it is stale or the version changed). | A non-holder that asks again learns the same answer for the price of a read. | {verified: RoleAssignmentSqlTests.Elect_WhileAnotherHoldsALiveLease_IsContended_AndWritesNothingAsync} |
| The holder loop votes for every duty it does not hold in one statement per pass, once per renew interval (5 s by default). | One round trip per pass whatever the number of duties. | {verified: DutyHolderWorkerTests.APass_VotesForEveryRoleItDoesNotHold_InOneCallAsync} |
| A waiter is woken by the holder's release announcement (a `RoleReleasedSignal` on the [signal bus](/v1.0.0/fundamentals/signal-bus/signal-bus#coordination-signals), channel `wh_role_released`), not by polling faster. | A hand-off is noticed at once while the poll stays slow. | {verified: DutyHolderWorkerTests.TheHostedLoop_PassesOnItsInterval_WakesOnARelease_AndReleasesOnStopAsync, CommitOrderStamperRoleTests.AWaitingNonHolder_IsWokenByTheRolesRelease_NotItsRetryIntervalAsync} |

Earlier releases held a host's own duties, and the commit-order stamper's leadership, on session advisory locks and damped the retries with a per-duty suppression window (`DutyContentionBackoff`, counted on `whizbang.probes.suppressed_duty_attempts`). Both are gone with the session-lock elector (#2044): a contended vote is already a read, so there is nothing to suppress.

## Two passive meters

Both meters use [passive counters](/v1.0.0/operations/observability/metrics#passive-counters), so every series exists at zero from construction and a quiet fleet shows zeros rather than missing instruments. Both are registered in Core with `TryAddSingleton`, and every worker takes them as optional constructor parameters, so a host that does not register metrics runs exactly as before.

### `Whizbang.Probes` (`ProbeCadenceMetrics`)

| Metric | Tags | Meaning |
|---|---|---|
| `whizbang.probes.ticks` | `probe` in {`durable-signal-tail`, `instance-lifecycle`, `backlog-age`}, `outcome` in {`work`, `idle`} | One increment per probe tick. The `idle` series are the service's idle footprint; on an empty queue they should grow slowly. Every known probe's two series are touched at zero from construction. |

{verified: ProbeCadenceMetricsTests.KnownProbes_HaveBothOutcomeSeriesAtZeroFromConstructionAsync, ProbeCadenceMetricsTests.RecordTick_IncrementsTheSeriesForTheOutcomeAsync, ProbeCadenceMetricsTests.Meter_IsNamedForTheProbeDomainAsync}

### `Whizbang.Liveness` (`InstanceLivenessMetrics`)

`whizbang.liveness.watchdog_beats`, `whizbang.liveness.slow_beats`, `whizbang.liveness.deaths_announced` and `whizbang.liveness.deaths_retracted` belong to the heartbeat writer and the lifecycle monitor; they are documented with the rest of the liveness design in [Instance liveness](./instance-liveness.md#observability). The `idle` probe ticks and the liveness counters together answer "what is this fleet doing while nothing is happening?".

## Expected idle statement rate

Per instance, excluding the heartbeat itself and with default options: one durable signal tail scan per 30 s, one lifecycle scan per 25 s, one holder-loop vote per renew interval (5 s) covering every duty not held, a non-holder stamper's vote every `LeaderElectionRetry` (1.5 s), each a read while another instance holds the duty, and the backlog-age peek only on the admin plane. Under one statement per second.

## What stays as follow-up

Three periodic sources were left on their fixed cadence in this pass and are worth the same treatment:

- `PgCommitOrderStamperWorker`'s non-holder votes for the `commit-stamper` role every `LeaderElectionRetry` (1.5 s). Each vote is a read while the role is held, and a release wakes the waiter at once, but the cadence does not relax while idle.
- `TableStatisticsCollector`'s estimated depth counts (30 s).
- `ScheduleWorker`'s 5 s backstop poll.

`SignalBusHostedService` needed no change: its loopback probe re-runs only every `ReProbeIntervalMilliseconds` (300 s) and was not a contributor.

## Related

- [Instance liveness](./instance-liveness.md): the derived threshold, the writer watchdog, and the lifecycle monitor's own adaptive tick.
- [Worker classification](./worker-classification.md): which workers are NOTIFY-driven, channel-driven, or timer-driven.
- [PerspectiveWorker NOTIFY wake](./perspective-worker-notify.md): the same principle applied to the perspective drain (signal first, poll as a safety net).
- [Capabilities and Duties](/v1.0.0/operations/startup/capabilities-and-duties): how duties are won and recorded.
- [Metrics reference](/v1.0.0/operations/observability/metrics#probes): the full meter list.
