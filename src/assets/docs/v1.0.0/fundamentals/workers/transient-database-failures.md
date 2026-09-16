---
title: Transient Database Failures in Worker Loops
pageType: concept
version: 1.0.0
category: Fundamentals
order: 11
description: >-
  Why no database failure inside one batch may end a background worker, how
  Whizbang classifies a deadlock, a serialization failure, a canceled statement
  or a lost connection, what the loops log when one happens, and how to give a
  worker of your own the same treatment.
tags: 'workers, resilience, deadlock, backoff, background-service, logging, leases'
codeReferences:
  - src/Whizbang.Core/Workers/TransientDatabaseFailure.cs
  - src/Whizbang.Core/Workers/WorkerLoopRecovery.cs
  - src/Whizbang.Core/Workers/AdaptiveIdleBackoff.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
  - src/Whizbang.Core/Workers/ClaimWorker.cs
  - src/Whizbang.Core/Workers/InboxDrainWorker.cs
  - src/Whizbang.Core/Workers/OutboxDrainWorker.cs
testReferences:
  - tests/Whizbang.Core.Tests/Workers/TransientDatabaseFailureTests.cs
  - tests/Whizbang.Core.Tests/Workers/WorkerLoopRecoveryTests.cs
  - tests/Whizbang.Core.Tests/Workers/PerspectiveWorkerDeepPathDrainTests.cs
  - tests/Whizbang.Core.Tests/Workers/PerspectiveWorkerDeepPathChannelTests.cs
  - tests/Whizbang.Core.Tests/Workers/InboxDrainWorkerCoverageTests.cs
  - tests/Whizbang.Core.Tests/Workers/OutboxDrainWorkerCoverageTests.cs
  - tests/Whizbang.Core.Tests/Signals/PollSignalSourceTests.cs
---

# Transient database failures in worker loops

A background worker whose `ExecuteAsync` throws takes the process with it. That is the .NET
default — `HostOptions.BackgroundServiceExceptionBehavior` is `StopHost` — and it is the right
default for a worker that cannot run at all, such as one missing a dependency at startup. It is the
wrong outcome for a deadlock.

Under load, two instances of a service will sometimes contend: one is running a batch while another,
just added to the fleet, takes the schema lock and runs DDL. The batch's statement loses the
deadlock. Nothing is wrong with the service, the data or the code — the next attempt wins — but a
loop that lets that exception out is gone, its host stops, its readiness and liveness probes fail,
and an orchestrator restarts the container. The fleet is down an instance for the length of a
restart, in the middle of the load that caused the contention.

**The rule: no failure inside one batch or one tick may end a worker loop.** Whizbang's workers
follow it, and two public types let a worker of your own follow it the same way.

## What counts as transient

`TransientDatabaseFailure.TryClassify` answers "is this the database having a moment?" It reads only
what every ADO.NET provider exposes through `DbException` — the SQLSTATE and the provider's own
transient flag — so `Whizbang.Core` takes no provider dependency, and it searches wrappers and
aggregates the way the stored-form classifier does.

| SQLSTATE | `Reason` | What it is | Verified |
|---|---|---|---|
| `40P01` | `deadlock` | Two transactions each waited on a lock the other held; the server ended one | {verified: TransientDatabaseFailureTests.ASqlStateThatPasses_ClassifiesByItsReasonAsync} |
| `40001` | `serialization_failure` | A serializable or repeatable-read transaction could not be serialized | {verified: TransientDatabaseFailureTests.ASqlStateThatPasses_ClassifiesByItsReasonAsync} |
| `57014` | `statement_canceled` | The server canceled the statement: a statement timeout, or an explicit cancel | {verified: TransientDatabaseFailureTests.ASqlStateThatPasses_ClassifiesByItsReasonAsync} |
| `55P03` | `lock_timeout` | A lock could not be taken within the lock timeout | {verified: TransientDatabaseFailureTests.ASqlStateThatPasses_ClassifiesByItsReasonAsync} |
| `08xxx`, `57P01`–`57P03` | `connection_lost` | The connection was lost or refused, or the server is going away | {verified: TransientDatabaseFailureTests.ASqlStateThatPasses_ClassifiesByItsReasonAsync} |
| `53xxx` | `insufficient_resources` | The server ran out of memory, disk, connections or another resource | {verified: TransientDatabaseFailureTests.ASqlStateThatPasses_ClassifiesByItsReasonAsync} |
| (none) | `command_timeout` | The provider wrapped a `TimeoutException`: the command's timeout elapsed on the client | {verified: TransientDatabaseFailureTests.ACommandTimeoutWrappedByTheProvider_IsACommandTimeoutAsync} |
| (none) | `connection_lost` | The provider wrapped an `IOException` or `SocketException`: the socket went away mid-command | {verified: TransientDatabaseFailureTests.ALostSocketBeneathTheProvider_IsALostConnectionAsync} |
| (any other) | `provider_transient` | No SQLSTATE this class names, but `DbException.IsTransient` is set | {verified: TransientDatabaseFailureTests.AProviderTransientFlag_PassesWithoutAKnownSqlStateAsync} |

Two deliberate non-answers. A `TimeoutException` that is *not* beneath a database exception is not
the database failing — it is a wait that elapsed in application code, and it is reported as a defect.
Neither is a constraint violation (`23505`) or a missing relation (`42P01`): those will fail again
next time and want fixing, not retrying.

```csharp{
title: "Ask whether a caught exception is the database having a moment"
description: "TryClassify finds a transient database failure anywhere in a chain of wrappers and aggregates, and names the reason and SQLSTATE for the log line."
framework: "NET10"
category: "Workers"
difficulty: "INTERMEDIATE"
tags: ["resilience", "deadlock", "sqlstate", "classification"]
tests: ["TransientDatabaseFailureTests.ADeadlockInsideAnAggregateOrAWrapper_IsStillFoundAsync", "TransientDatabaseFailureTests.ASqlStateThatPasses_ClassifiesByItsReasonAsync"]
}
if (TransientDatabaseFailure.TryClassify(ex, out var transient)) {
  // transient.Reason    → "deadlock"
  // transient.SqlState  → "40P01" (null when the provider reported none)
  // transient.Cause     → the DbException the classification was read from
}
```

## One recovery, shared by every loop

`WorkerLoopRecovery` is the single place a loop decides what to do with what it caught. It does not
own the log lines: each worker passes in its own `LoggerMessage` methods, so a worker keeps its own
event ids and wording while the decision of which one to use lives in one place.

- `Report(exception, reportTransient, reportDefect)` — for a loop that already has a cadence of its
  own (the claim poll has its empty-poll backoff; a drain worker has its batching window). It only
  chooses the line.
- `RecoverAsync(exception, reportTransient, reportDefect, cancellationToken)` — the same choice plus
  a bounded wait, for a loop with no cadence of its own.
- `Recovered()` — call it after an iteration that ran clean; the wait snaps back to its floor.

The wait doubles from 250 ms to a 30 s ceiling while failures keep coming, so a database that is
unreachable is asked about once a ceiling rather than as fast as the loop can spin. It is taken on
the `TimeProvider` you hand the recovery, which is what lets a test drive the backoff with
`FakeTimeProvider` instead of living through it.

```csharp{
title: "Give a worker loop of your own the same treatment"
description: "Catch per iteration, let the shared recovery pick the line and wait the backoff, and mark a clean iteration so the cadence recovers."
framework: "NET10"
category: "Workers"
difficulty: "INTERMEDIATE"
tags: ["background-service", "resilience", "backoff", "timeprovider"]
tests: ["WorkerLoopRecoveryTests.RecoverAsync_WaitsTheBackoffOnTheLoopsOwnClockAsync", "WorkerLoopRecoveryTests.Recovered_AGoodIteration_SnapsTheWaitBackToTheFloorAsync"]
}
private readonly WorkerLoopRecovery _recovery = new(timeProvider);

protected override async Task ExecuteAsync(CancellationToken stoppingToken) {
  while (!stoppingToken.IsCancellationRequested) {
    try {
      await _doOneBatchAsync(stoppingToken);
      _recovery.Recovered();
    } catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) {
      break;                                   // the host is stopping: leave
    } catch (Exception ex) {
      try {
        await _recovery.RecoverAsync(
          ex,
          (transient, cause) => LogTransientBatchFailure(_logger, transient.Reason, transient.SqlState ?? "none", cause),
          cause => LogBatchDefect(_logger, cause),
          stoppingToken);
      } catch (OperationCanceledException) {
        break;                                 // stopped while backing off
      }
    }
  }
}
```

Note the shape of the two cancellation arms. Shutdown is named explicitly, and the general handler is
left **unfiltered** on purpose: a statement the server cancels surfaces as an
`OperationCanceledException` with nothing cancelled locally, so the common filter
`when (ex is not OperationCanceledException)` lets exactly the failure you care about escape.

## What the framework's workers do

### The perspective worker

The consumer loop and the drain pass inside it give every failed batch the same treatment:

1. the batch's streams have their leased-but-unstarted rows released
   (`IWorkCoordinator.ReleaseUnstartedLeasesAsync`), so a sibling instance can take that work now
   rather than after the lease lapses. A store that does not implement the release leaves the rows to
   their leases, and says so;
2. the failure is reported **once**, with the classification, the SQLSTATE and the stream ids the
   batch was carrying, so one line tells an operator what failed and what was affected;
3. the loop waits the shared backoff and takes the next batch.

The drain pass is guarded separately from the loop, so a failed drain fetch costs the drained streams
and not the claimed per-event work that shares its batch.

| Event id | Level | Line | Verified |
|---|---|---|---|
| 67 | Error | Perspective batch lost to a transient database failure (reason, SQLSTATE, stream ids) | {verified: PerspectiveWorkerDeepPathDrainTests.DrainMode_TransientDatabaseFailure_IsReportedOnceAndTheLoopContinuesAsync, PerspectiveWorkerDeepPathChannelTests.Worker_TransientDatabaseFailureInAChannelBatch_IsReportedOnceAndTheLoopTakesTheNextBatchAsync} |
| 68 | Error | Perspective batch lost to a failure that is **not** the database's — a defect worth fixing | {verified: PerspectiveWorkerDeepPathDrainTests.DrainMode_FailureThatIsNotTheDatabases_IsReportedAsADefectAndTheLoopContinuesAsync} |
| 69 | Debug | How many unstarted rows the lost batch released | {verified: PerspectiveWorkerDeepPathDrainTests.DrainMode_TransientDatabaseFailure_IsReportedOnceAndTheLoopContinuesAsync} |
| 70 | Warning | The lost batch's streams could not be released; their leases lapse instead | {verified: PerspectiveWorkerDeepPathDrainTests.DrainMode_AStoreThatCannotReleaseTheLeases_SaysSoAndStillContinuesAsync} |

Event id 8, `Error processing perspective cursors`, is retired. It named no stream, said nothing
about what had failed, and the line after it was the host stopping.

### The other loops

| Worker | On a failed batch or tick | Verified |
|---|---|---|
| `ClaimWorker` | Reports the classification (event id 19 transient, 2 otherwise) and lets its empty-poll backoff carry the wait | {verified: ClaimWorkerCoverageTests.ClaimTick_TransientDatabaseFailure_IsReportedWithItsReasonAndTheNextTickRunsAsync} |
| `InboxDrainWorker` | Reports (event id 7 transient, 6 otherwise); the streams re-offer through the claim backstop | {verified: InboxDrainWorkerCoverageTests.DrainBatch_TransientDatabaseFailure_IsNamedAsSuchAndTheNextBatchDrainsAsync} |
| `OutboxDrainWorker` | Reports (event id 53 transient, 54 otherwise); the streams re-offer through the claim backstop | {verified: OutboxDrainWorkerCoverageTests.DrainBatch_TransientDatabaseFailure_IsNamedAsSuchAndTheLoopTakesTheNextBatchAsync} |
| Poll signal sources | Hand the failed tick to `OnTickError`, log at Warning, and keep the timer's schedule | {verified: PollSignalSourceTests.Tick_TransientDatabaseFailure_IsHandedToOnTickErrorAndTheScheduleSurvivesAsync} |
| Flush workers | Retry inside `BatchFlusher`, then drop the batch with a line rather than fault | |

## For operators

- **A 67 / 7 / 53 / 19 line is not a page.** It is the database saying "not now". The work is still
  durable, its rows are unassigned again or their leases lapse, and the next attempt takes them. Watch
  the *rate*: a steady stream of them is worth investigating (lock contention, a saturated server, a
  connection limit), while one at the moment a new instance initialized schema is expected.
- **A 68 / 6 / 54 line is a defect** in the framework or in a consumer's handler, and it will repeat
  until someone fixes it.
- **A 70 line** means a lost batch's rows will wait out their lease before a sibling can take them:
  latency, not loss.
- `BackgroundServiceExceptionBehavior` is deliberately left at its default. Do not set it to `Ignore`
  to paper over a worker that stops — the loops are correct on their own, and a worker that genuinely
  cannot run *should* stop the host loudly.

## See also

- [Idle Footprint](idle-footprint) — `AdaptiveIdleBackoff`, the same cadence controller the recovery
  uses, and the probe cadences it governs.
- [Worker Classification](worker-classification) — which workers are NOTIFY-driven, channel-driven or
  timer-driven.
