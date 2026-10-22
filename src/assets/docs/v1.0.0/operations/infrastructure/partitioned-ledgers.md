---
title: Partitioned Ledgers
pageType: guide
version: 1.0.0
category: Infrastructure
order: 11
description: >-
  The built-in partition manager: which framework tables are partitioned by time, how partitions are created ahead
  and dropped past the retention window, the maintainer-duty gate, how to enable it, and how an existing table is
  converted once
tags: >-
  operations, partitioning, partitions, retention, wh_log, maintenance, postgres, storage, vacuum, maintainer duty
codeReferences:
  - src/Whizbang.Data.Postgres/Migrations/226_PartitionManager.sql
  - src/Whizbang.Data.Postgres/PartitionedTable.cs
  - src/Whizbang.Data.Postgres/PartitionMaintenance.cs
  - src/Whizbang.Data.EFCore.Postgres/PartitionMaintenanceStep.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperPartitionMaintenanceStep.cs
  - src/Whizbang.Core/Workers/MaintenancePartitioningOptions.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Partitioning/PartitionMaintainSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Partitioning/LogPartitionConversionTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Partitioning/PartitionMaintenanceStepTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperPartitionManagerSqlTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperPartitionMaintenanceStepTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/PartitionedTableTests.cs
  - tests/Whizbang.Core.Tests/Workers/PartitioningOptionsTests.cs
---

# Partitioned Ledgers

Retention on an append-only framework table used to be a batched `DELETE`. Every deleted row stays behind as a dead
tuple until vacuum reclaims it, the indexes keep pointing at it, and the delete itself writes WAL. A table that is
range-partitioned by time does retention differently: when a whole partition is past the window, the partition is
dropped. That is a catalog change, with no dead tuples, no index bloat and almost no WAL.

The built-in partition manager does this for the framework's own time-ordered tables. It is off by default.

## What is partitioned {#what-is-partitioned}

| Table | Partitioned by | Interval | Retention |
|---|---|---|---|
| `wh_log` | `logged_at`, primary key `(log_id, logged_at)` | weekly | `log_retention_days` (default 14), the window the row sweep used |

Every partitioned table also has a **default partition** (`<table>_default`) that catches a row no partition covers,
so a writer never fails because maintenance has fallen behind. The default partition is never dropped.

Other tables follow in later releases (`wh_signals`, `wh_lifecycle_completions`), and so do the staging and trace
tables of slim event metadata, which are created partitioned. The deduplication ledger and `wh_perspective_applied`
stay unpartitioned: the first is already bounded by its window, the second is a sliding window over streams rather
than a time-rolling log.

## Enabling it {#enabling-it}

{verified: PartitioningOptionsTests.Partitioning_BindsFromItsEnvironmentVariablesAsync, PartitioningOptionsTests.CreateAheadBelowOne_IsRejectedByNameAsync, PartitionMaintenanceStepTests.Disabled_ChangesNothingAsync}

| Key | Default | Environment variable | Meaning |
|---|---|---|---|
| `Whizbang:Workers:Maintenance:Partitioning:Enabled` | `false` | `Whizbang__Workers__Maintenance__Partitioning__Enabled` | Convert and maintain the partitioned tables |
| `Whizbang:Workers:Maintenance:Partitioning:CreateAhead` | `3` | `Whizbang__Workers__Maintenance__Partitioning__CreateAhead` | Intervals past the current one that each cycle makes sure exist; at least `1` |

```json{
title: "Turn on the partition manager"
description: "Enables partition maintenance and keeps four weeks of wh_log partitions ready ahead of the current one."
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["partitioning", "maintenance", "wh_log", "appsettings"]
tests: ["PartitioningOptionsTests.Partitioning_BindsFromItsEnvironmentVariablesAsync"]
}
{
  "Whizbang": {
    "Workers": {
      "Maintenance": {
        "Partitioning": {
          "Enabled": true,
          "CreateAhead": 4
        }
      }
    }
  }
}
```

While it is off, nothing is converted, created or dropped, and every table keeps its row-by-row retention. A
`CreateAhead` below 1 is rejected at startup, naming the key.

The option is also published to `wh_settings` every cycle as `partition_maintenance_enabled`, in both directions
([database-side settings](../configuration/configuration-reference#database-side-settings)). The row sweep reads it:
it leaves a partitioned table to the partition drop while the option is on, and goes back to deleting rows when it is
switched off, so a converted table stays bounded either way.

## What a cycle does {#what-a-cycle-does}

{verified: PartitionMaintainSqlTests.ACycle_CreatesTheCurrentAndAheadPartitions_AndASecondCreatesNothingAsync, PartitionMaintainSqlTests.APartitionWhollyPastTheWindow_IsDropped_OneStraddlingItIsKeptAsync, PartitionMaintainSqlTests.TheDefaultPartition_IsNeverDroppedAsync, PartitionMaintainSqlTests.RowsInTheDefaultPartition_MoveIntoThePartitionCreatedForThemAsync, PartitionMaintainSqlTests.DebugMode_KeepsExpiredPartitionsAsync}

The partition maintenance step runs last in each [maintenance cycle](../../fundamentals/workers/maintenance-steps).
For each registered table it calls two SQL functions:

1. `wh_partition_convert(table, column, interval, now)` converts a plain table, once (see below). On a converted
   table it returns at once.
2. `wh_partition_maintain(table, interval, ahead, keep, now)`:
   - makes sure the default partition exists;
   - creates the partition for the current interval and `CreateAhead` more, skipping any range an existing partition
     already covers, so a second cycle creates nothing. Rows the default partition caught for a new range move into
     it;
   - drops every partition whose range ended at or before `now - keep`. A partition that straddles that moment is
     kept whole, so rows are kept at least as long as the window and at most one interval longer;
   - under `debug_mode`, keeps every partition, as the row sweeps keep every row.

It returns one row per change: `created`, `dropped`, `emptied`, `deferred`, `kept` or `skipped`, and the step logs
each one.

### Intervals and names {#intervals-and-names}

{verified: PartitionMaintainSqlTests.WeeklyPartitions_StartOnMondayAsync, PartitionMaintainSqlTests.HourlyPartitions_AreNamedByTheHourAsync, PartitionMaintainSqlTests.AnIntervalThatIsNotWholeHours_IsRejectedAsync}

An interval is a whole number of hours with no month part (a month is not a fixed length). Boundaries are counted in
UTC from Monday 2000-01-03, so a weekly partition starts on a Monday at 00:00 UTC and a daily one at midnight UTC.
Partitions are named `<table>_p<yyyymmdd>` after the day they start, or `<table>_p<yyyymmdd>_<hhmm>` for an interval
shorter than a day.

## Locks, and why no writer waits {#locks}

{verified: PartitionMaintainSqlTests.AnExpiredPartition_IsEmptiedWithoutBlockingAnInsertInFlightAsync, PartitionMaintainSqlTests.AnExpiredPartitionInUse_IsDeferredAsync, PartitionMaintainSqlTests.ANewPartition_IsDeferredWhileARowIsBeingWrittenToTheDefaultAsync}

A writer inserts through the parent table. It holds a `ROW EXCLUSIVE` lock on the parent and on the one partition its
row lands in, nothing more.

- **Creating a partition** builds it as a standalone table and attaches it, which takes `SHARE UPDATE EXCLUSIVE` on
  the parent. Inserts do not conflict with that. It also locks the default partition, which only a row outside every
  partition touches.
- **Dropping a partition** needs the parent's exclusive lock, because detaching changes the parent's list of
  partitions. The manager takes it only if it is free at that instant (`NOWAIT`), and then holds it for a catalog
  change of milliseconds.
- **When a writer is on the table,** that lock is not free, so the manager does not wait for it. It **empties** the
  expired partition instead (`TRUNCATE`), which locks that partition alone, and detaches the empty partition on a
  later cycle. The data is gone on schedule either way.
- **When a reader is on the expired partition itself,** or a writer is on the default partition while a new partition
  needs creating, that step is **deferred** to the next cycle.

No lock is ever waited for, so the manager never makes a writer queue behind it.

`DETACH PARTITION ... CONCURRENTLY` is not used. PostgreSQL refuses it while the table has a default partition, and
it cannot run inside a transaction block, which a function call always is.

## Only the maintainer runs it {#the-duty-gate}

{verified: DapperPartitionMaintenanceStepTests.AnInstanceNotHoldingTheMaintainerDuty_DoesNoDdlAsync, DapperPartitionMaintenanceStepTests.TheMaintainerDutyHolder_RunsTheCycleAsync, PartitionMaintainSqlTests.AnotherCycleInFlightOnTheTable_SkipsItAsync}

Partition DDL runs only on the instance that holds the **maintainer duty** where role assignment manages it
([capabilities and duties](../startup/capabilities-and-duties)); every other instance skips the step without error.
Where role assignment does not manage the maintainer duty, every instance runs the step, and a per-table advisory
lock inside the SQL lets one through while the others skip that table for the cycle. Two instances never change one
table's partitions at once.

Changing a table needs its owner's rights. The EF Core driver runs the step on the schema-initialization connection
(`ConnectionStrings:<name>-init`) when one is configured, as the startup migrations do
([database roles](migrations#database-roles)), and on the context's own connection otherwise.

## Converting an existing table {#converting-an-existing-table}

{verified: LogPartitionConversionTests.Conversion_KeepsEveryRow_InTheLegacyPartitionAsync, LogPartitionConversionTests.EveryWriter_StillInserts_IncludingASessionThatWroteBeforeTheConversionAsync, LogPartitionConversionTests.Conversion_InterruptedPartway_LeavesTheTableAsItWas_AndTheNextCycleCompletesItAsync, LogPartitionConversionTests.Conversion_WhileAWriterHoldsTheTable_IsDeferredAsync, LogPartitionConversionTests.TheMarker_StopsTheConversionRunningAgainAsync, LogPartitionConversionTests.Conversion_CarriesTheTablesGrantsToTheParentAsync}

The first enabled cycle converts `wh_log`. Nothing is copied:

1. The table is renamed `wh_log_legacy`.
2. A partitioned parent named `wh_log` is created with the same columns, defaults, comments, grants and owner. Its
   primary key becomes `(log_id, logged_at)`, because PostgreSQL requires every unique key of a partitioned table to
   include the partition column, and it keeps drawing ids from the same sequence.
3. `wh_log_legacy` is attached as the oldest partition, covering everything before the start of the next week, and
   the parent's indexes are recreated under their original names, adopting the legacy table's indexes.
4. The default partition is added, and the next cycle's partitions start where the legacy partition ends.

Every function that writes `wh_log` keeps working unchanged against the parent, including a session that wrote before
the conversion. The legacy partition is dropped like any other once its range is past the window.

The conversion is **one transaction**. It takes the table's exclusive lock only if it is free (otherwise it returns
`deferred` and the next cycle tries again), and attaching checks every row against the range once, under that lock.
A failure anywhere rolls the whole conversion back, leaving the plain table as it was, and the next cycle starts
again. When it commits, it records the **conversion marker** `wh_log_partition_version = 1` in `wh_settings`; with
the marker present the conversion never runs again
([conversion markers](migrations#conversion-markers)).

## How a table registers {#how-a-table-registers}

{verified: PartitionedTableTests.TheLog_IsWeeklyByLoggedAt_KeptForItsRetentionSettingAsync, PartitionedTableTests.AFixedWindow_IsCarriedAsIsAsync, DapperPartitionMaintenanceStepTests.AFixedWindow_DropsWhatEndedBeforeItAsync, DapperPartitionMaintenanceStepTests.TheLogsWindow_IsReadFromItsSettingAsync}

A framework table joins the manager by registering a declaration in the driver's service registration; the manager
itself does not change. The declaration names the table, its `timestamptz` partition column, the interval, and where
the retention window comes from: a fixed span, or a `wh_settings` key holding days with a default for when the key
has no row. The window is read each cycle, so an operator's change applies to the next drop. A plain table is
converted on its first enabled cycle; a table its migration creates partitioned is maintained as it is. The
declaration is internal to the framework.
