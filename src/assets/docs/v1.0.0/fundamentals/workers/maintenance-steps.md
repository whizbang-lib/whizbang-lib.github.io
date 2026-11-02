---
title: Maintenance Steps
pageType: concept
version: 1.0.0
category: Fundamentals
order: 11
description: >-
  How a package adds work to the periodic maintenance cycle, and why work that
  reads or repairs stored state belongs there rather than on a timer of its own.
tags: 'workers, maintenance, housekeeping, settledness, extension, reindex'
codeReferences:
  - src/Whizbang.Core/Workers/IMaintenanceStep.cs
  - src/Whizbang.Core/Workers/MaintenanceWorker.cs
  - src/Whizbang.Data.Postgres/Migrations/221_LedgerRetention.sql
  - src/Whizbang.Data.Postgres/Migrations/238_LogSweepClearsTheDefaultPartition.sql
  - src/Whizbang.Data.Postgres/Migrations/279_CollectiveApplyProgress.sql
  - src/Whizbang.Core/Workers/RetentionSettingsBridge.cs
  - src/Whizbang.Core/Workers/QueueIndexReindexStep.cs
testReferences:
  - tests/Whizbang.Core.Tests/Workers/MaintenanceWorkerStepTests.cs
  - tests/Whizbang.Core.Tests/Workers/MaintenanceWorkerRetentionSyncTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/LedgerRetentionSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Partitioning/LogPartitionConversionTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperLedgerRetentionSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Collective/CollectiveApplyProgressSqlTests.cs
  - tests/Whizbang.Core.Tests/Workers/QueueIndexReindexStepTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueueIndexReindexSqlTests.cs
---

# Maintenance steps {#maintenance-steps}

{verified: MaintenanceWorkerStepTests.Cycle_RunsEveryRegisteredStep_InRegistrationOrderAsync, MaintenanceWorkerStepTests.Step_ReceivesTheCyclesScopedProviderAsync, MaintenanceWorkerStepTests.FailingStep_IsLogged_AndTheNextStepStillRunsAsync, MaintenanceWorkerStepTests.CanceledStep_PropagatesCancellationAsync}

The maintenance worker runs the framework's housekeeping on an interval: retention sweeps, dead-letter
recovery, integrity bookkeeping, the stuck-row sentinel. Before each cycle it has already decided three
things: the schema is ready, the service has settled (or the deferral limit forces the cycle anyway),
and it is the configured time.

A package that needs to read or repair stored state periodically wants exactly those decisions. A timer
of its own would have to make each of them again, and the usual way that goes wrong is a startup pass
that queries tables the schema pass has not created yet, or a sweep that lands in the middle of a bulk
load. So such work is written as a step, and the cycle runs it.

```csharp{
title: "A maintenance step"
description: "Registers periodic work that runs inside the maintenance cycle, after the schema is ready and the service has settled."
framework: "NET10"
category: "Workers"
difficulty: "INTERMEDIATE"
tags: ["maintenance", "workers", "housekeeping", "extension"]
tests: ["MaintenanceWorkerStepTests.Cycle_RunsEveryRegisteredStep_InRegistrationOrderAsync"]
}
public sealed class PruneExpiredDraftsStep : IMaintenanceStep {
  public string Name => "prune-expired-drafts";

  public async Task RunAsync(IServiceProvider services, CancellationToken cancellationToken) {
    var drafts = services.GetRequiredService<IDraftStore>();
    await drafts.PruneExpiredAsync(cancellationToken);
  }
}

services.TryAddEnumerable(ServiceDescriptor.Scoped<IMaintenanceStep, PruneExpiredDraftsStep>());
```

How steps run:

- **Last in the cycle, in registration order,** after the built-in housekeeping, so what a step reads
  has been through this cycle's own cleanup first.
- **In the cycle's service scope.** A step resolves scoped services, the work coordinator among them,
  from the provider it is given.
- **Best-effort per step.** A step that throws is logged by name and the next one runs; one broken step
  never switches the others off. It runs again next cycle.
- **Cancellation is shutdown** and propagates; it is never logged as a step failure.
- **Register with `TryAddEnumerable`** so a registration method called twice does not run the step twice.

The saga package's [stranded-saga sweep](../sagas/completion-orchestration#stranded-sagas) is a step.

## Queue-index rebuild {#queue-index-rebuild}

{verified: QueueIndexReindexStepTests.Run_RebuildsOneIndexPerCycleAsync, QueueIndexReindexStepTests.Run_DropsEveryInvalidLeftoverFirst_ThenRebuildsAsync, QueueIndexReindexStepTests.AddWhizbangWorkers_RegistersTheStepOnceAsync, QueueIndexReindexSqlTests.TheStep_ShrinksABloatedQueueIndexAsync}

The framework's own `queue-index-reindex` step rebuilds a bloated index on a queue table that churns to empty
(the outbox, the inbox and its work state, perspective events, active streams, the doorbell queue) with
`REINDEX INDEX CONCURRENTLY`. It is a step because it needs exactly what the cycle already decided: a settled
service, a ready schema, and the maintainer duty. Each run drops any invalid leftover of an interrupted rebuild
first, then rebuilds at most one index, the one with the most bytes to give back among those more than
`Whizbang:Workers:Maintenance:ReindexBloatThreshold` times their expected size (default `3.0`; `0` turns it off).
A claim per window keeps it to one rebuild per window across the fleet. `AddWhizbangWorkers` registers it once.

[Storage maintenance: rebuilding queue-table indexes](../../operations/infrastructure/storage-maintenance#queue-index-rebuild)
has the survey, the threshold, the leftovers and the reason for each rule.

## Ledger retention {#ledger-retention}

{verified: LedgerRetentionSqlTests.Log_OlderThanTheWindow_IsRemoved_YoungerIsKeptAsync, LedgerRetentionSqlTests.ScheduleRuns_OlderThanTheWindow_AreRemoved_ButTheNewestRunOfEachScheduleIsKeptAsync, LedgerRetentionSqlTests.StreamPurgeAudit_IsKeptForeverByDefault_AndBoundedWhenConfiguredAsync, LedgerRetentionSqlTests.IntegrityLedger_IsTrimmedToTheConfiguredCount_NewestKeptAsync, LedgerRetentionSqlTests.DebugMode_KeepsEveryLedgerRowAsync, DapperLedgerRetentionSqlTests.Maintenance_BoundsTheLogAndScheduleRuns_KeepingEachSchedulesNewestRunAsync}

The last task of the maintenance sweep bounds the framework ledgers that nothing else deletes from. Each task deletes in batches, so a large backlog is never one long delete, and each is skipped while `debug_mode` is on.

| Ledger | Task | Kept | Window setting (default) |
|---|---|---|---|
| `wh_log` | `purge_old_log_entries` | entries younger than the window | `LogDays` (14 days) |
| `wh_schedule_runs` | `purge_old_schedule_runs` | runs younger than the window, and **each schedule's newest run** whatever its age, so a dormant schedule keeps its last outcome | `ScheduleRunDays` (30 days) |
| `wh_stream_purge_audit` | `purge_old_stream_purge_audit` | everything by default, because the audit records what a purge destroyed; set a window to bound it | `StreamPurgeAuditDays` (0, keep forever) |
| `wh_integrity_ledger` | `trim_integrity_ledger` | the most recently touched entries, up to the cap | `IntegrityLedgerMaxEntries` (100000) |
| `wh_collective_apply_progress` | `purge_collective_apply_progress` | unfinished and abandoned records, every record of a collective whose work row is pending or that has an abandoned record, and finished records younger than the window (by `applied_at`) | `CollectiveApplyProgressDays` (7 days) |

Once `wh_log` is [partitioned](../../operations/infrastructure/partitioned-ledgers) and partition maintenance is
enabled, the partition manager drops whole weeks past the same `LogDays` window, and `purge_old_log_entries` deletes
only from `wh_log`'s default partition, which holds the entries no weekly partition covers and which no drop reaches
([row sweeps](../../operations/infrastructure/partitioned-ledgers#row-sweeps)). It then reports `ok (partitioned: the
default partition only; expired partitions are dropped)`, or `skipped (partitioned: no default partition)` when that
partition is missing. With partitioning switched off the row delete covers the whole table again, partitioned or not.
{verified: LogPartitionConversionTests.OnceConverted_RetentionDropsPartitions_InsteadOfDeletingRowsAsync, LogPartitionConversionTests.OnceManaged_TheRowDeleteSweepsOnlyTheDefaultPartition_AndLeavesPartitionsToTheDropAsync, LogPartitionConversionTests.OnceManaged_WithoutADefaultPartition_TheRowDeleteSkipsAsync, LogPartitionConversionTests.AConvertedLog_WithPartitioningSwitchedOff_IsStillBoundedByTheRowDeleteAsync}

**Collective apply progress** ([#1969](https://github.com/whizbang-lib/whizbang/issues/1969)). The collective sink
keeps one [progress record](../messaging/collective-events#resuming-an-apply) per collective event and handler, so a
retried apply resumes after its last committed batch. `purge_collective_apply_progress` deletes a finished record once
it is past the window, with three exceptions, each for a reason:

- **Never while the collective's work row is pending.** A collective re-delivered before its completion was written
  must still find its finished record, or it would apply again from its first row.
- **Never an abandoned record, and never a finished record of a collective that has one.** Those describe a
  [dead-lettered collective](../messaging/collective-events#dead-lettered-collectives): they let recovery resume and
  make a rewind fold the collective only into the rows it reached. They are deleted with the last dead letter of their
  collective, by a trigger on `wh_dead_letters`, not by this sweep. After that, a rewind folds that collective in full
  again.
- **Nothing under `debug_mode`,** like every task here.

A collective whose finished record was swept replays in full, which is right: it finished. The sweep adds no index: the
table holds a row per collective and handler, not per projection row.
{verified: CollectiveApplyProgressSqlTests.TheSweep_RemovesAFinishedRecordPastTheHorizon_AndKeepsAYoungerOneAsync, CollectiveApplyProgressSqlTests.TheSweep_HonorsTheConfiguredHorizonAsync, CollectiveApplyProgressSqlTests.TheSweep_KeepsAFinishedRecord_WhileItsWorkRowIsPendingAsync, CollectiveApplyProgressSqlTests.TheSweep_KeepsUnfinishedAndAbandonedRecords_AndTheFinishedRecordsOfADeadLetteredCollectiveAsync, CollectiveApplyProgressSqlTests.TheSweep_UnderDebugMode_KeepsEveryRecordAsync, CollectiveApplyProgressSqlTests.PurgingTheDeadLetter_SweepsItsAbandonedRecords_AndKeepsTheFinishedOnesAsync}

Each setting lives under `Whizbang:Workers:Maintenance:Retention` and is published to `wh_settings` before the sweep reads it (next section); the keys are listed under [Database-side settings](../../operations/configuration/configuration-reference#database-side-settings).

## Settings published before the sweep {#settings-published-before-the-sweep}

{verified: MaintenanceWorkerRetentionSyncTests.TheWrite_HappensBeforeTheSweepReadsItAsync, MaintenanceWorkerRetentionSyncTests.EachCycle_PublishesTheConfiguredValuesInOneWriteAsync, MaintenanceWorkerRetentionSyncTests.AFailedWrite_IsLoggedWithTheKeysAndTheCycleContinuesAsync, MaintenanceWorkerRetentionSyncTests.ACanceledWrite_PropagatesAsync}

The sweep runs in SQL and reads its retention windows from `wh_settings`, not from the host's options. So the
first thing each cycle does, before any sweep, is publish the host's database-side settings in one write:
`debug_mode` always, and every retention option that is set under `Whizbang:Workers:Maintenance:Retention` and
`Whizbang:Ephemeral`. An option left unset is not written, so a value stored in SQL stands.

- **Every cycle, not once at startup,** so a configuration change takes effect on the next cycle and a stale value
  cannot outlive the option that set it.
- **Best-effort.** A failed write is logged as a warning naming the keys it was publishing, and the cycle goes on;
  the sweep uses the values already stored.
- **Cancellation is shutdown** and propagates, as for any step.

The options, their environment-variable forms and the key each one publishes are listed under
[Database-side settings](../../operations/configuration/configuration-reference#database-side-settings).
