---
title: Idle Footprint
pageType: concept
version: 1.0.0
category: Fundamentals
order: 10
description: >-
  How an idle service stays quiet on its database: adaptive probe cadence for
  the durable signal tail, the backlog-age duty and the lifecycle monitor,
  contention damping in duty election, and the two passive meters that show
  the footprint.
tags: 'workers, idle, polling, backoff, duty-election, probes, metrics'
codeReferences:
  - src/Whizbang.Core/Workers/AdaptiveIdleBackoff.cs
  - src/Whizbang.Core/Startup/DutyContentionBackoff.cs
  - src/Whizbang.Core/Observability/ProbeCadenceMetrics.cs
  - src/Whizbang.Core/Observability/InstanceLivenessMetrics.cs
  - src/Whizbang.Core/Observability/BacklogAgeWorker.cs
  - src/Whizbang.Data.Postgres/Notifications/PgDurableSignalTailWorker.cs
  - src/Whizbang.Data.Postgres/Notifications/PgDutyElector.cs
  - src/Whizbang.Data.Postgres/Notifications/PgInstanceLifecycleMonitor.cs
testReferences:
  - tests/Whizbang.Core.Tests/Workers/AdaptiveIdleBackoffTests.cs
  - tests/Whizbang.Core.Tests/Startup/DutyContentionBackoffTests.cs
  - tests/Whizbang.Core.Tests/Observability/ProbeCadenceMetricsTests.cs
  - tests/Whizbang.Core.Tests/Observability/BacklogAgeCadenceTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PgDurableSignalTailWorkerCadenceTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/DutyElectionContentionBackoffTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PgInstanceLifecycleMonitorUnitTests.cs
---

# Idle footprint

A service with an empty queue should be close to silent on its database. Every periodic probe in Whizbang has a doorbell or a signal as its fast path; the poll behind it is a safety net, and a safety net can afford to relax while nothing is happening. This page describes the controls that make the probes back off when idle, how duty election stops re-asking a question whose answer cannot have changed, and the two meters that show the resulting footprint.

The problem this solves: an idle fleet of several instances was measured issuing tens of statements per second against a shared database from fixed-cadence probes alone (the durable signal tail scan, estimated depth counts, advisory-lock retries in duty election). None of that traffic did anything. Each probe kept its cadence whether or not the previous tick had found work.

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

## Duty election stops re-asking: `DutyContentionBackoff`

Exclusive duties (`migrator`, `maintainer`, and the rest) are won through `IDutyElector` by taking a session advisory lock. Several callers retry on a tight loop by design, because a leader duty must fail over quickly when its holder dies. On an idle fleet that turned into a steady stream of `pg_try_advisory_lock` round trips that could never succeed while the holder was healthy.

`DutyContentionBackoff` damps that without changing the callers. After an attempt comes back **contended** (another instance holds the duty), the elector opens a suppression window for that duty; while the window is open, further attempts for the same duty are answered from memory as `Contended`, with a detail string that says how long the window has left and how many contended attempts preceded it. Consecutive contentions double the window from a 2 s floor up to a ceiling, and a grant, a refusal that is not contention, or an unavailable coordination connection resets the window and the streak.

{verified: DutyContentionBackoffTests.RecordContended_OpensAWindowOfTheFloorAsync, DutyContentionBackoffTests.ConsecutiveContentions_DoubleTheWindowUpToTheCeilingAsync, DutyContentionBackoffTests.Reset_ClosesTheWindowAndForgetsTheStreakAsync, DutyContentionBackoffTests.WindowEnd_IsNotSuppressedAsync}

In `PgDutyElector`:

- Windows are kept **per duty**; contention on one duty never delays an attempt at another.
- The ceiling is `WhizbangNotificationOptions.PollingFallbackInterval` (at least the 2 s floor), which is already the bound on how long any doorbell-less recovery may take on the host. No new option is introduced.
- `IsBackingOff(duty, out remaining)` is the public seam for callers and tests that want to know whether the next attempt would reach the database.
- Every suppressed attempt is counted on `whizbang.probes.suppressed_duty_attempts{duty}` and logged at Debug.

{verified: DutyElectionContentionBackoffTests.SecondAttemptInsideTheWindow_IsAnsweredFromMemoryAsync, DutyElectionContentionBackoffTests.WindowExpiry_ReachesTheDatabaseAgainAndDoublesOnContinuedContentionAsync, DutyElectionContentionBackoffTests.Windows_AreKeptPerDutyAsync, DutyElectionContentionBackoffTests.ContentionBackoffCeiling_IsThePollingFallbackIntervalAsync, DutyElectionContentionBackoffTests.IsBackingOff_UnknownDuty_IsFalseAsync}

**The trade-off, stated plainly.** A holder that releases its duty inside a window is not noticed until the window ends, so failover after a holder's death is at most one polling fallback interval slower than the caller's own cadence. A dead holder releases its session lock server-side, and the window that was open when it died is the last one; the next real attempt wins and closes the window. {verified: DutyElectionContentionBackoffTests.HolderReleases_TheNextRealAttemptWinsAndClosesTheWindowAsync}

## Two passive meters

Both meters use [passive counters](/v1.0.0/operations/observability/metrics#passive-counters), so every series exists at zero from construction and a fleet that never suppressed anything shows zeros rather than missing instruments. Both are registered in Core with `TryAddSingleton`, and every worker takes them as optional constructor parameters, so a host that does not register metrics runs exactly as before.

### `Whizbang.Probes` (`ProbeCadenceMetrics`)

| Metric | Tags | Meaning |
|---|---|---|
| `whizbang.probes.ticks` | `probe` in {`durable-signal-tail`, `instance-lifecycle`, `backlog-age`}, `outcome` in {`work`, `idle`} | One increment per probe tick. The `idle` series are the service's idle footprint; on an empty queue they should grow slowly. Every known probe's two series are touched at zero from construction. |
| `whizbang.probes.suppressed_duty_attempts` | `duty` | Duty attempts answered from memory while a contention window was open, so no lock round trip was made. |

{verified: ProbeCadenceMetricsTests.KnownProbes_HaveBothOutcomeSeriesAtZeroFromConstructionAsync, ProbeCadenceMetricsTests.RecordTick_IncrementsTheSeriesForTheOutcomeAsync, ProbeCadenceMetricsTests.SuppressedDutyAttempts_AreCountedPerDutyAsync, ProbeCadenceMetricsTests.Meter_IsNamedForTheProbeDomainAsync}

### `Whizbang.Liveness` (`InstanceLivenessMetrics`)

`whizbang.liveness.watchdog_beats`, `whizbang.liveness.slow_beats`, `whizbang.liveness.deaths_announced` and `whizbang.liveness.deaths_retracted` belong to the heartbeat writer and the lifecycle monitor; they are documented with the rest of the liveness design in [Instance liveness](./instance-liveness.md#observability). The `idle` probe ticks and the liveness counters together answer "what is this fleet doing while nothing is happening?".

## Expected idle statement rate

Per instance, excluding the heartbeat itself and with default options: one durable signal tail scan per 30 s, one lifecycle scan per 25 s, duty probes bounded by one per 30 s per duty, and the backlog-age peek only on the admin plane. Well under one statement per second.

## What stays as follow-up

Three periodic sources were left on their fixed cadence in this pass and are worth the same treatment:

- `PgCommitOrderStamperWorker`'s non-holder leader-election retry takes its own `pg_try_advisory_lock` on its own lock and does not go through `PgDutyElector`, so the contention damping above does not reach it.
- `TableStatisticsCollector`'s estimated depth counts (30 s).
- `ScheduleWorker`'s 5 s backstop poll.

`SignalBusHostedService` needed no change: its loopback probe re-runs only every `ReProbeIntervalMilliseconds` (300 s) and was not a contributor.

## Related

- [Instance liveness](./instance-liveness.md): the derived threshold, the writer watchdog, and the lifecycle monitor's own adaptive tick.
- [Worker classification](./worker-classification.md): which workers are NOTIFY-driven, channel-driven, or timer-driven.
- [PerspectiveWorker NOTIFY wake](./perspective-worker-notify.md): the same principle applied to the perspective drain (signal first, poll as a safety net).
- [Capabilities and Duties](/v1.0.0/operations/startup/capabilities-and-duties): how duties are won and recorded.
- [Metrics reference](/v1.0.0/operations/observability/metrics#probes): the full meter list.
