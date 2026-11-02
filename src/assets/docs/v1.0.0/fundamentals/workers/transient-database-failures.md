---
title: Transient Database Failures in Worker Loops
pageType: concept
version: 1.0.0
category: Fundamentals
order: 11
description: >-
  Why no database failure inside one batch may end a background worker, how
  Whizbang classifies a deadlock, a serialization failure, a canceled statement
  or a lost connection, what the loops log when one happens, when a run of them
  escalates to one Error, and how to give a worker of your own the same
  treatment.
tags: 'workers, resilience, deadlock, backoff, background-service, logging, leases, alerting, escalation'
codeReferences:
  - src/Whizbang.Core/Workers/TransientDatabaseFailure.cs
  - src/Whizbang.Core/Workers/WorkerLoopRecovery.cs
  - src/Whizbang.Core/Workers/DatabaseFailureEscalation.cs
  - src/Whizbang.Core/Workers/DatabaseFailureEscalationOptions.cs
  - src/Whizbang.Core/Configuration/ProcessWideOptionsBinding.cs
  - src/Whizbang.Core/Workers/AdaptiveIdleBackoff.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
  - src/Whizbang.Core/Workers/ClaimWorker.cs
  - src/Whizbang.Core/Workers/InboxDrainWorker.cs
  - src/Whizbang.Core/Workers/OutboxDrainWorker.cs
  - src/Whizbang.Data.Postgres/PostgresDeadlockRetry.cs
testReferences:
  - tests/Whizbang.Core.Tests/Workers/TransientDatabaseFailureTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/WorkerLoopRecoveryTests.cs
  - tests/Whizbang.Core.Tests/Workers/DatabaseFailureEscalationTests.cs
  - tests/Whizbang.Core.Tests/Workers/DatabaseFailureEscalationOptionsTests.cs
  - tests/Whizbang.Core.Tests/Workers/DatabaseFailureEscalationWiringTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/ClaimWorkerCoverageTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/InboxDrainWorkerCoverageTests.TransientFailure.cs
  - tests/Whizbang.Core.Component.Tests/Workers/OutboxDrainWorkerCoverageTests.TransientFailure.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PerspectiveWorkerDeepPathChannelTests.TransientFailure.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PerspectiveWorkerDeepPathDrainTests.TransientFailure.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PerspectiveWorkerDeepPathDrainTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PerspectiveWorkerDeepPathChannelTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PerspectiveWorkerDeepPathChannelTests.AttemptLogLevel.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PerspectiveWorkerDeepPathDrainTests.StoredForm.cs
  - tests/Whizbang.Core.Component.Tests/Workers/InboxDrainWorkerCoverageTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/OutboxDrainWorkerCoverageTests.cs
  - tests/Whizbang.Core.Component.Tests/Signals/PollSignalSourceTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/PostgresDeadlockRetryTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/PostgresDeadlockRetryCoverageTests.cs
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

## What counts as transient {#what-counts-as-transient}

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

## One recovery, shared by every loop {#one-recovery-shared-by-every-loop}

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
| 67 | Warning | Perspective batch lost to a transient database failure (reason, SQLSTATE, stream ids); counts toward the worker's [run](#when-the-database-keeps-failing) | {verified: PerspectiveWorkerDeepPathDrainTests.DrainMode_TransientDatabaseFailure_IsReportedOnceAndTheLoopContinuesAsync, PerspectiveWorkerDeepPathChannelTests.Worker_TransientDatabaseFailureInAChannelBatch_IsReportedOnceAndTheLoopTakesTheNextBatchAsync} |
| 68 | Error | Perspective batch lost to a failure that is **not** the database's: a defect worth fixing; never counts toward a run | {verified: PerspectiveWorkerDeepPathDrainTests.DrainMode_FailureThatIsNotTheDatabases_IsReportedAsADefectAndTheLoopContinuesAsync} |
| 69 | Debug | How many unstarted rows the lost batch released | {verified: PerspectiveWorkerDeepPathDrainTests.DrainMode_TransientDatabaseFailure_IsReportedOnceAndTheLoopContinuesAsync} |
| 70 | Warning | The lost batch's streams could not be released; their leases lapse instead | {verified: PerspectiveWorkerDeepPathDrainTests.DrainMode_AStoreThatCannotReleaseTheLeases_SaysSoAndStillContinuesAsync} |

Event id 8, `Error processing perspective cursors`, is retired. It named no stream, said nothing
about what had failed, and the line after it was the host stopping.

These lines are about a whole batch the loop lost. A perspective whose apply fails for one stream
inside a batch that otherwise ran is a different line: event id 14, `Error processing perspective
cursor` (or `Drain mode: Error processing perspective` on the drain path), logged at **Warning** with
the exception. That failure is recorded against the stream's leased rows, which are backed off,
retried and dead-lettered at their bound, when the
[dead-letter record](../../operations/observability/logging-categories#dead-lettered-messages)
(event id 1901) is logged at Error. One failed attempt is not an alert; see
[retried attempts](../../operations/observability/logging-categories#retried-attempts).
{verified: PerspectiveWorkerDeepPathChannelTests.Worker_RunnerThrows_LogsTheAttemptAtWarningWithItsExceptionAsync, PerspectiveWorkerDeepPathDrainTests.DrainMode_OtherFailure_IsNotClassifiedAsStoredFormButParksItsRowsAsync}

### The other loops

| Worker | On a failed batch or tick | Verified |
|---|---|---|
| `ClaimWorker` | Reports the classification (event id 19 transient, at Warning; 2 otherwise) and lets its empty-poll backoff carry the wait | {verified: ClaimWorkerCoverageTests.ClaimTick_TransientDatabaseFailure_IsReportedWithItsReasonAndTheNextTickRunsAsync} |
| `InboxDrainWorker` | Reports (event id 7 transient, at Warning; 6 otherwise, at Error); the streams re-offer through the claim backstop | {verified: InboxDrainWorkerCoverageTests.DrainBatch_TransientDatabaseFailure_IsNamedAsSuchAndTheNextBatchDrainsAsync} |
| `OutboxDrainWorker` | Reports (event id 53 transient, at Warning; 54 otherwise, at Error); the streams re-offer through the claim backstop | {verified: OutboxDrainWorkerCoverageTests.DrainBatch_TransientDatabaseFailure_IsNamedAsSuchAndTheLoopTakesTheNextBatchAsync, OutboxDrainWorkerCoverageTests.DrainBatch_FailureThatIsNotTheDatabases_IsReportedAsADefectAndTheLoopContinuesAsync} |
| Poll signal sources | Hand the failed tick to `OnTickError`, log at Warning, and keep the timer's schedule | {verified: PollSignalSourceTests.Tick_TransientDatabaseFailure_IsHandedToOnTickErrorAndTheScheduleSurvivesAsync} |
| Flush workers | Retry inside `BatchFlusher`, then drop the batch with an Error line (event id 3) rather than fault; the rows behind it are claimed again when their leases expire. The drop is bounded by `MaxFlushAttempts` and has nothing to dead-letter (the items are bookkeeping, not messages); it stays at Error because that many consecutive failed flushes means the database cannot be reached ([failures that stay at Error](../../operations/observability/logging-categories#kept-at-error)) | |

The four worker loops in these tables (the perspective worker, the claim worker and the inbox and outbox drain
workers) log a transient database failure at **Warning**, with its reason and SQLSTATE, and report it to the
worker's [run of failures](#when-the-database-keeps-failing). A failure that is not the database's keeps its own
line (Error for event ids 6, 54 and 68; the claim worker's event id 2 was and stays a Warning) and is not part of a
run. The poll signal sources and the flush workers are not worker loops in this sense and
keep the lines above.
{verified: ClaimWorkerCoverageTests.ClaimTick_TransientDatabaseFailure_IsReportedWithItsReasonAndTheNextTickRunsAsync, InboxDrainWorkerCoverageTests.DrainBatch_TransientDatabaseFailure_IsNamedAsSuchAndTheNextBatchDrainsAsync, PerspectiveWorkerDeepPathDrainTests.DrainMode_FailureThatIsNotTheDatabases_IsReportedAsADefectAndTheLoopContinuesAsync}

## When the database keeps failing {#when-the-database-keeps-failing}

A Warning for each transient database failure is right for a failover that lasts a second: the batch goes back,
the loop retries, nothing is lost, and nobody needs to be woken. It is wrong for a database that has been down for
ten minutes, where the one thing an operator needs is a single line, at a level their alerting hears, that says so.
So each of the four worker loops follows its **run** of transient database failures:

- A run starts at the worker's first transient database failure and ends at its next success.
- Once the run has lasted at least `FailingFor` **and** counted at least `ConsecutiveFailures` failures, the
  worker logs **one Error**, EventId **1986** `DatabaseFailurePersisting`, naming how long the database has been
  failing. Failures after that log only their Warnings.
- The success that ends an escalated run logs **one Information line**, EventId **1987**
  `DatabaseFailureRecovered`.
- A run that never escalated ends without a line: its Warnings already told the story.

```mermaid{caption="A worker's run of transient database failures: each failure is a Warning, a run past both thresholds logs one Error, and the success that ends an escalated run logs one Information line; a run that never escalated ends silently." tests=["DatabaseFailureEscalationTests.ARunPastBothThresholds_LogsOneErrorNamingHowLongTheDatabaseHasBeenFailingAsync", "DatabaseFailureEscalationTests.FailuresAfterTheEscalation_DoNotLogItAgainAsync", "DatabaseFailureEscalationTests.ARecoveryAfterAnEscalation_LogsOneInformationLineAsync", "DatabaseFailureEscalationTests.ARecoveryWithoutAnEscalation_LogsNothingAsync"]}
stateDiagram-v2
    [*] --> Healthy
    Healthy --> Failing: transient failure (Warning)
    Failing --> Failing: another failure (Warning)
    Failing --> Healthy: success (no line)
    Failing --> Escalated: both thresholds met (one Error, 1986)
    Escalated --> Escalated: another failure (Warning only)
    Escalated --> Healthy: success (one Information, 1987)
```

| What happens | What is logged | Verified |
|---|---|---|
| A transient database failure | The worker's own line at Warning (event id 19, 7, 53 or 67), with the reason and SQLSTATE. Nothing else | {verified: DatabaseFailureEscalationTests.OneFailure_LogsNothingAsync, ClaimWorkerCoverageTests.ClaimTick_TransientDatabaseFailure_IsReportedWithItsReasonAndTheNextTickRunsAsync, InboxDrainWorkerCoverageTests.DrainBatch_TransientDatabaseFailure_IsNamedAsSuchAndTheNextBatchDrainsAsync, OutboxDrainWorkerCoverageTests.DrainBatch_TransientDatabaseFailure_IsNamedAsSuchAndTheLoopTakesTheNextBatchAsync, PerspectiveWorkerDeepPathChannelTests.Worker_TransientDatabaseFailureInAChannelBatch_IsReportedOnceAndTheLoopTakesTheNextBatchAsync, PerspectiveWorkerDeepPathDrainTests.DrainMode_TransientDatabaseFailure_IsReportedOnceAndTheLoopContinuesAsync} |
| The run passes both thresholds | One Error, EventId 1986, once per run however long it goes on | {verified: DatabaseFailureEscalationTests.ARunPastBothThresholds_LogsOneErrorNamingHowLongTheDatabaseHasBeenFailingAsync, DatabaseFailureEscalationTests.FailuresAfterTheEscalation_DoNotLogItAgainAsync} |
| A success ends an escalated run | One Information line, EventId 1987, with how long the run lasted and how many failures it counted | {verified: DatabaseFailureEscalationTests.ARecoveryAfterAnEscalation_LogsOneInformationLineAsync} |
| A success ends a run that never escalated | Nothing | {verified: DatabaseFailureEscalationTests.ARecoveryWithoutAnEscalation_LogsNothingAsync} |
| The database fails again after a success | A new run, counted and timed from nothing, which escalates again if it passes the threshold | {verified: DatabaseFailureEscalationTests.ASuccess_EndsTheRun_SoTheNextOneStartsFromNothingAsync, DatabaseFailureEscalationTests.ASecondRunPastTheThreshold_EscalatesAgainAsync} |
| A failure that is not the database's (event id 6, 54 or 68) | Its Error line, as before. It neither counts toward a run nor ends one | {verified: PerspectiveWorkerDeepPathDrainTests.DrainMode_FailureThatIsNotTheDatabases_IsReportedAsADefectAndTheLoopContinuesAsync, OutboxDrainWorkerCoverageTests.DrainBatch_FailureThatIsNotTheDatabases_IsReportedAsADefectAndTheLoopContinuesAsync} |

### Where each worker's run ends

| Worker | A run ends when | Verified |
|---|---|---|
| `ClaimWorker` | A claim returns | {verified: ClaimWorkerCoverageTests.ClaimTick_TransientFailurePastTheThreshold_EscalatesOnceAndSaysWhenItRecoversAsync} |
| `InboxDrainWorker` | A drain batch completes | {verified: InboxDrainWorkerCoverageTests.DrainBatch_TransientFailurePastTheThreshold_EscalatesOnceAndSaysWhenItRecoversAsync} |
| `OutboxDrainWorker` | A drain batch completes | {verified: OutboxDrainWorkerCoverageTests.DrainBatch_TransientFailurePastTheThreshold_EscalatesOnceAndSaysWhenItRecoversAsync} |
| `PerspectiveWorker` | A batch completes having contained no failure, the same condition that resets its backoff. Its consumer loops share one run, as they share the backoff: a run of failures is a statement about the database, not about one loop | {verified: PerspectiveWorkerDeepPathChannelTests.Worker_TransientFailurePastTheThreshold_EscalatesOnceAndSaysWhenItRecoversAsync} |

Each worker has its own run, so a database that stays down logs one Error per worker that meets it. The run's
length is measured from its first failure on the worker's `TimeProvider`.

### The two lines

| Field | `DatabaseFailurePersisting` | `DatabaseFailureRecovered` |
|---|---|---|
| EventId | `1986` | `1987` |
| Level | `Error` | `Information` |
| Category | The worker's own, for example `Whizbang.Core.Workers.InboxDrainWorker` | The same |
| `Worker` | The worker's name | The same |
| `FailingFor` | How long the run has lasted, from its first failure | How long the run lasted |
| `Failures` | How many failures in a row | The same, for the whole run |
| `Reason`, `SqlState` | The latest failure's [reason](#what-counts-as-transient) and SQLSTATE (`none` when the provider reported none) | |
| Exception | The latest failure's exception | |

```text{title="A run that escalated, then recovered" description="The one Error a worker logs once its run of transient database failures passes the threshold, and the one Information line when the database answers again" category="Observability" difficulty="INTERMEDIATE" tags=["workers", "logging", "DatabaseFailurePersisting", "DatabaseFailureRecovered", "EventId 1986", "EventId 1987"] tests=["DatabaseFailureEscalationTests.ARunPastBothThresholds_LogsOneErrorNamingHowLongTheDatabaseHasBeenFailingAsync", "DatabaseFailureEscalationTests.ARecoveryAfterAnEscalation_LogsOneInformationLineAsync"]}
fail: Whizbang.Core.Workers.InboxDrainWorker[1986]
      InboxDrainWorker has been failing on transient database failures for 00:01:01 (3 in a row; the
      latest connection_lost, SQLSTATE 57P01); it keeps retrying and logs once more when the database answers
info: Whizbang.Core.Workers.InboxDrainWorker[1987]
      InboxDrainWorker reached the database again after 00:01:30 of transient database failures (4 in a row)
```

Every worker logs both lines with the same EventIds and names, so one alert on `1986` (or
`DatabaseFailurePersisting`) covers all of them.

### The threshold

Two settings, both bound automatically from `Whizbang:DatabaseFailureEscalation` (see the
[configuration reference](../../operations/configuration/configuration-reference#database-failure-escalation)):

| Setting | Default | Why this default | Verified |
|---|---|---|---|
| `ConsecutiveFailures` | `3` | A single lost statement, or a pair of them, never makes a run on its own | {verified: DatabaseFailureEscalationOptionsTests.Defaults_AreThreeFailuresOverAMinuteAsync, DatabaseFailureEscalationOptionsTests.Turnkey_NoSetting_ResolvesTheDefaultsAsync} |
| `FailingFor` | `00:01:00` | Long enough that a failover of a few seconds logs only Warnings; short enough that a database that stays down is alerted on within about a minute | {verified: DatabaseFailureEscalationOptionsTests.Defaults_AreThreeFailuresOverAMinuteAsync, DatabaseFailureEscalationOptionsTests.Turnkey_NoSetting_ResolvesTheDefaultsAsync} |

```json{title="Raise the escalation threshold" description="A service whose database takes longer to fail over escalates after two minutes and five failures in a row" category="Configuration" difficulty="BEGINNER" tags=["workers", "logging", "configuration", "DatabaseFailureEscalationOptions"] tests=["DatabaseFailureEscalationOptionsTests.Turnkey_Settings_BindFromConfigurationAsync"]}
{
  "Whizbang": {
    "DatabaseFailureEscalation": {
      "ConsecutiveFailures": 5,
      "FailingFor": "00:02:00"
    }
  }
}
```

**Why both, and not either.** The two settings guard against opposite mistakes. A fast loop meets many failures in
a short failover: a loop that retries every two seconds counts twenty failures in a forty-second failover, so a
count alone would page on a blip. A loop that rarely runs can see two failures ten minutes apart, which says little about
the database, so a time alone would page on two unrelated hiccups. Requiring both means a run escalates only when
the database has been failing for a while *and* the worker has kept meeting it.
{verified: DatabaseFailureEscalationTests.ManyFailuresInsideTheTime_DoNotEscalateAsync, DatabaseFailureEscalationTests.AFewFailuresOverALongTime_DoNotEscalateAsync}

**Either one can be switched off with the other's help.** A `FailingFor` of `00:00:00` escalates on the count
alone; a `ConsecutiveFailures` of `1` escalates on the time alone.
{verified: DatabaseFailureEscalationTests.AZeroTime_EscalatesOnTheCountAloneAsync, DatabaseFailureEscalationTests.OneFailureAsTheCount_EscalatesOnTheTimeAloneAsync}

**Refused, not clamped.** A `ConsecutiveFailures` below `1` or a negative `FailingFor` cannot be met as written,
so the host refuses to start with an options validation error naming the key, for example
`Whizbang:DatabaseFailureEscalation:ConsecutiveFailures is 0; a run of failures is at least 1 long.` A setting that
does not take effect is never mistaken for one that does.
{verified: DatabaseFailureEscalationOptionsTests.Validator_RefusesFewerThanOneFailure_NamingTheKeyAsync, DatabaseFailureEscalationOptionsTests.Validator_RefusesANegativeTime_NamingTheKeyAsync, DatabaseFailureEscalationOptionsTests.Validator_BothWrong_NamesBothKeysAsync, DatabaseFailureEscalationOptionsTests.Turnkey_UnmeetableSetting_IsRefusedAtStartupAsync}

**One setting for every worker.** Each of the four workers, as `AddWhizbangWorkers` registers it, takes the bound
value. {verified: DatabaseFailureEscalationWiringTests.ClaimWorker_TakesTheConfiguredThresholdAsync, DatabaseFailureEscalationWiringTests.InboxDrainWorker_TakesTheConfiguredThresholdAsync, DatabaseFailureEscalationWiringTests.OutboxDrainWorker_TakesTheConfiguredThresholdAsync, DatabaseFailureEscalationWiringTests.PerspectiveWorker_TakesTheConfiguredThresholdAsync, DatabaseFailureEscalationOptionsTests.Turnkey_ThePlainInstanceIsTheBoundOneAsync}

### What is not a run

A retry that is bounded and reports its own outcome is not a worker loop's run, and does not report to it: the
inbox and outbox batchers' store retry (a Warning per attempt, then the
[dead-letter record](../../operations/observability/logging-categories#dead-lettered-messages) at its bound), the
outbox drain worker's continuation retry (EventId 59, at Warning; its last failure reaches the batch guard, EventId
53 above, which does report), the poll signal sources and the flush workers above, and schema initialization at
startup.

### In a worker of your own

`DatabaseFailureEscalation` is public. Create one per worker, share it between that worker's loops, and report to
it next to the recovery from [the loop above](#one-recovery-shared-by-every-loop):

```csharp{
title: "Escalate a worker loop's run of transient database failures"
description: "Report each transient failure after its Warning, and each iteration that reached the database and succeeded, so a run past the threshold logs one Error and its end one Information line."
framework: "NET10"
category: "Workers"
difficulty: "INTERMEDIATE"
tags: ["background-service", "resilience", "logging", "alerting"]
tests: ["DatabaseFailureEscalationTests.ARunPastBothThresholds_LogsOneErrorNamingHowLongTheDatabaseHasBeenFailingAsync", "DatabaseFailureEscalationTests.ARecoveryAfterAnEscalation_LogsOneInformationLineAsync"]
}
private readonly WorkerLoopRecovery _recovery = new(timeProvider);
private readonly DatabaseFailureEscalation _databaseFailures =
  new(nameof(MyWorker), escalationOptions, timeProvider, logger);

protected override async Task ExecuteAsync(CancellationToken stoppingToken) {
  while (!stoppingToken.IsCancellationRequested) {
    try {
      await _doOneBatchAsync(stoppingToken);
      _recovery.Recovered();
      _databaseFailures.Succeeded();         // ends the run; logs 1987 if it had escalated
    } catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) {
      break;
    } catch (Exception ex) {
      try {
        await _recovery.RecoverAsync(
          ex,
          (transient, cause) => {
            LogTransientBatchFailure(_logger, transient.Reason, transient.SqlState ?? "none", cause);
            _databaseFailures.Failed(transient);   // logs 1986 once the run passes the threshold
          },
          cause => LogBatchDefect(_logger, cause), // a defect is not part of the run
          stoppingToken);
      } catch (OperationCanceledException) {
        break;
      }
    }
  }
}
```

Take `DatabaseFailureEscalationOptions` as a constructor parameter to get the bound value; `AddWhizbangWorkers`
registers it.

## Retrying one operation {#deadlock-retry}

The loops above recover a whole batch. A single database operation that may lose a lock race, such
as a write two instances can make at once, can instead retry itself with `PostgresDeadlockRetry`.

```csharp{title="Retrying a write that can deadlock" description="The action runs again after a deadlock or serialization failure, up to the attempt limit." category="Fundamentals" difficulty="INTERMEDIATE" tags=["workers", "resilience", "deadlock"]}
await PostgresDeadlockRetry.ExecuteAsync(
  () => connection.ExecuteAsync(sql, parameters),
  maxAttempts: 3,
  logger,
  cancellationToken);
```

| Behavior | Detail | |
|---|---|---|
| What is retried | A deadlock (`40P01`) or a serialization failure (`40001`). PostgreSQL has already rolled the losing transaction back, so running it again is safe | {verified: PostgresDeadlockRetryTests.ExecuteAsync_DeadlockOnFirstAttempt_RetriesAndSucceedsAsync, PostgresDeadlockRetryTests.ExecuteAsync_SerializationFailure_RetriesAndSucceedsAsync} |
| What is not | Any other error, from PostgreSQL or not, propagates on the first attempt | {verified: PostgresDeadlockRetryTests.ExecuteAsync_NonDeadlockException_DoesNotRetryAsync, PostgresDeadlockRetryTests.ExecuteAsync_NonPostgresException_DoesNotRetryAsync} |
| The wait | About 50 ms before the second attempt, doubling each time, with ±25% jitter so two losers do not collide again | |
| Giving up | After `maxAttempts` (default 3) the last error is rethrown unchanged | {verified: PostgresDeadlockRetryTests.ExecuteAsync_DeadlockExhaustsAttempts_ThrowsOriginalExceptionAsync} |
| `maxAttempts` below one | Rejected with `ArgumentOutOfRangeException` before the action runs. It asks for no attempt at all, so the alternatives were to ignore the setting or to report a write as done when it never ran | {verified: PostgresDeadlockRetryCoverageTests.ExecuteAsync_WithNonPositiveMaxAttempts_ThrowsWithoutRunningTheActionAsync, PostgresDeadlockRetryCoverageTests.ExecuteAsyncOfT_WithNonPositiveMaxAttempts_ThrowsWithoutRunningTheActionAsync} |
| Cancellation | Honored during the wait between attempts | {verified: PostgresDeadlockRetryTests.ExecuteAsync_CancellationToken_HonoredBetweenRetriesAsync} |

## For operators

- **A 67 / 7 / 53 / 19 line is not a page.** It is a Warning: the database saying "not now". The work is
  still durable, its rows are unassigned again or their leases lapse, and the next attempt takes them.
  Watch the *rate*: a steady stream of them is worth investigating (lock contention, a saturated server,
  a connection limit), while one at the moment a new instance initialized schema is expected.
- **A 1986 line is the page.** `DatabaseFailurePersisting`, at Error: a worker has been failing on the
  database for longer than the [threshold](#when-the-database-keeps-failing). It is logged once per run per
  worker; a 1987 line, `DatabaseFailureRecovered`, says when it ended. An alert that keyed on 67, 7 or 53 at
  Error no longer fires; key it on 1986 instead.
- **A 68 / 6 / 54 line is a defect** in the framework or in a consumer's handler, and it will repeat
  until someone fixes it.
- **A 14 line is one failed apply attempt** for one stream, at Warning. It becomes an alert only when
  the stream's rows reach their bound and are dead-lettered (event id 1901).
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
