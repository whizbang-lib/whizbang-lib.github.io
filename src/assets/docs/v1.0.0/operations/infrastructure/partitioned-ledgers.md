---
title: Partitioned Ledgers
pageType: guide
version: 1.0.0
category: Infrastructure
order: 11
description: >-
  The built-in partition manager: which framework tables are partitioned by time or by time-ordered id, how
  partitions are created ahead and dropped past the retention window, the maintainer-duty gate, how to enable it,
  how an existing table is converted once, the autovacuum settings each partition carries, how unconsumed signals are
  carried past a drop, handing partition creation to pg_partman, and what the row sweeps still do
tags: >-
  operations, partitioning, partitions, retention, wh_log, wh_signals, wh_lifecycle_completions, uuidv7, maintenance,
  postgres, storage, vacuum, maintainer duty, pg_partman, create_parent, run_maintenance
codeReferences:
  - src/Whizbang.Data.Postgres/Migrations/226_PartitionManager.sql
  - src/Whizbang.Data.Postgres/Migrations/233_PartitionSignalsAndLifecycleCompletions.sql
  - src/Whizbang.Data.Postgres/Migrations/237_PartitionsCarryTheLedgersAutovacuumSettings.sql
  - src/Whizbang.Data.Postgres/Migrations/238_LogSweepClearsTheDefaultPartition.sql
  - src/Whizbang.Data.Postgres/Migrations/239_PartitionDropsCarryUnconsumedSignals.sql
  - src/Whizbang.Data.Postgres/Migrations/246_PartitionManagementByPgPartman.sql
  - src/Whizbang.Core/Workers/PartitionManagementStrategy.cs
  - src/Whizbang.Data.Postgres/PartitionStrategyAnnouncer.cs
  - src/Whizbang.Data.Postgres/PartitionedTable.cs
  - src/Whizbang.Data.Postgres/PartitionMaintenance.cs
  - src/Whizbang.Data.EFCore.Postgres/PartitionMaintenanceStep.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperPartitionMaintenanceStep.cs
  - src/Whizbang.Core/Workers/MaintenancePartitioningOptions.cs
  - src/Whizbang.Data.Postgres/Notifications/PgDurableSignalRetentionWorker.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreWorkCoordinator.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Partitioning/PartitionMaintainSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Partitioning/LogPartitionConversionTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Partitioning/UuidPartitionSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Partitioning/SignalPartitionConversionTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Partitioning/SignalPartitionCarryForwardTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Partitioning/LifecycleCompletionPartitionConversionTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreWorkCoordinatorLifecycleAndJanitorTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Partitioning/PartitionMaintenanceStepTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperPartitionManagerSqlTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperPartitionMaintenanceStepTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/PartitionedTableTests.cs
  - tests/Whizbang.Core.Tests/Workers/PartitioningOptionsTests.cs
  - tests/Whizbang.Core.Tests/Workers/PartitionManagementStrategyTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Partitioning/PgPartmanPartitionSqlTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/PgPartmanPartitionMaintenanceTests.cs
---

# Partitioned Ledgers

Retention on an append-only framework table used to be a batched `DELETE`. Every deleted row stays behind as a dead
tuple until vacuum reclaims it, the indexes keep pointing at it, and the delete itself writes WAL. A table that is
range-partitioned by time does retention differently: when a whole partition is past the window, the partition is
dropped. That is a catalog change, with no dead tuples, no index bloat and almost no WAL.

The built-in partition manager does this for the framework's own time-ordered tables. It is off by default. Where
pg_partman is installed, it can create the partitions instead ([pg_partman](#pg-partman)); expired partitions are
always dropped by the built-in manager.

```mermaid{caption="A partitioned ledger: writers insert into the parent, maintenance creates partitions ahead and drops those wholly past the window, and the row sweep clears only the default partition while the table is managed." tests=["PartitionMaintainSqlTests.ACycle_CreatesTheCurrentAndAheadPartitions_AndASecondCreatesNothingAsync", "PartitionMaintainSqlTests.APartitionWhollyPastTheWindow_IsDropped_OneStraddlingItIsKeptAsync", "SignalPartitionConversionTests.OnceManaged_TheSweepLeavesPartitionsToTheDrop_AndClearsOnlyTheDefaultAsync", "LogPartitionConversionTests.OnceManaged_TheRowDeleteSweepsOnlyTheDefaultPartition_AndLeavesPartitionsToTheDropAsync"]}
flowchart LR
  W[Writer] -->|INSERT| P[(Parent table)]
  P --> L[legacy: everything before the conversion]
  P --> D1[p20261022]
  P --> D2[p20261023]
  P --> D3[p20261024, created ahead]
  P --> DEF[default: rows no partition covers]
  M[Maintenance cycle] -->|create ahead| D3
  M -->|drop when wholly past the window| L
  S[Row sweep] -->|only while managed| DEF
```

## What is partitioned {#what-is-partitioned}

| Table | Partitioned by | Interval | Retention |
|---|---|---|---|
| `wh_log` | `logged_at`, primary key `(log_id, logged_at)` | weekly | `log_retention_days` (default 14), the window the row sweep used |
| `wh_signals` | `created_at`, primary key `(id, created_at)` | daily | `SignalRetention` (default 7 days), the durable-signal window ([signal bus](../../fundamentals/signal-bus/signal-bus#retention)) |
| `wh_lifecycle_completions` | `event_id` range, primary key `event_id` unchanged | daily | `LifecycleCompletionRetentionDays` (default 7); `0` keeps every partition |

Every partitioned table also has a **default partition** (`<table>_default`) that catches a row no partition covers,
so a writer never fails because maintenance has fallen behind. The default partition is never dropped.

The staging and trace tables of slim event metadata follow in a later release, created partitioned. The
deduplication ledger and `wh_perspective_applied` stay unpartitioned: the first is already bounded by its window, the
second is a sliding window over streams rather than a time-rolling log.

## Enabling it {#enabling-it}

{verified: PartitioningOptionsTests.Partitioning_BindsFromItsEnvironmentVariablesAsync, PartitioningOptionsTests.CreateAheadBelowOne_IsRejectedByNameAsync, PartitionMaintenanceStepTests.Disabled_ChangesNothingAsync}

| Key | Default | Environment variable | Meaning |
|---|---|---|---|
| `Whizbang:Workers:Maintenance:Partitioning:Enabled` | `false` | `Whizbang__Workers__Maintenance__Partitioning__Enabled` | Convert and maintain the partitioned tables |
| `Whizbang:Workers:Maintenance:Partitioning:CreateAhead` | `3` | `Whizbang__Workers__Maintenance__Partitioning__CreateAhead` | Intervals past the current one that each cycle makes sure exist; at least `1` |
| `Whizbang:Workers:Maintenance:Partitioning:Strategy` | `Auto` | `Whizbang__Workers__Maintenance__Partitioning__Strategy` | Who creates partitions: `Auto`, `BuiltIn` or `PgPartman` ([pg_partman](#pg-partman)) |

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
For each registered table it calls two SQL functions (three where [pg_partman](#pg-partman) creates the partitions):

1. `wh_partition_convert(table, column, interval, now)` converts a plain table, once (see below). On a converted
   table it returns at once.
2. `wh_partition_maintain(table, interval, ahead, keep, now)`:
   - makes sure the default partition exists;
   - creates the partition for the current interval and `CreateAhead` more, skipping any range an existing partition
     already covers, so a second cycle creates nothing. Rows the default partition caught for a new range move into
     it;
   - drops every partition whose range ended at or before `now - keep`. A partition that straddles that moment is
     kept whole, so rows are kept at least as long as the window and at most one interval longer. Before it drops
     one, it carries the rows the table still needs into the current partition; only `wh_signals` has such rows
     ([signals](#signals));
   - under `debug_mode`, keeps every partition, as the row sweeps keep every row.

It returns one row per change: `created`, `tuned`, `carried`, `dropped`, `emptied`, `deferred`, `kept` or `skipped`,
and the step logs each one. `carried` comes before the `dropped` or `emptied` row of the same partition, and only when
rows moved.

### Autovacuum settings {#autovacuum-settings}

{verified: LifecycleCompletionPartitionConversionTests.PartitionsTheManagerCreates_CarryTheLedgersAutovacuumSettingsAsync, LifecycleCompletionPartitionConversionTests.TheConversionsDefaultPartition_GetsTheSettingsOnTheNextCycleAsync, LifecycleCompletionPartitionConversionTests.APartitionAnOperatorTuned_KeepsItsOwnSettingsAsync, LifecycleCompletionPartitionConversionTests.APartitionInUse_IsTunedOnALaterCycle_WithoutWaitingAsync, DapperPartitionManagerSqlTests.TheLifecycleCompletionsPartitions_CarryTheLedgersAutovacuumSettingsAsync}

Autovacuum runs per partition, and a partitioned parent cannot hold autovacuum settings of its own. So a table's
settings have to be on each partition, or a new partition vacuums at the server's defaults (a share of the table,
20% unless the server is tuned).

The manager declares the settings each table's partitions carry, and writes them into every partition it creates,
the default partition included:

| Table | Partition settings |
|---|---|
| `wh_lifecycle_completions` | `autovacuum_vacuum_scale_factor = 0`, `autovacuum_vacuum_threshold = 10000`: vacuum after a fixed 10,000 dead rows, the values the plain table had |
| `wh_log`, `wh_signals` | none; the server's defaults |

A partition made without them, such as the default partition a conversion adds, gets them on the next cycle, which
reports it as `tuned`. A partition that already sets any of the declared keys is left as it is, so a value an
operator set on one partition by hand stands. Changing a partition's settings waits on a running vacuum of that
partition, so the manager takes that lock only if it is free and otherwise reports the partition `deferred` and tries
again next cycle. The legacy partition keeps the settings the plain table had.

### Intervals and names {#intervals-and-names}

{verified: PartitionMaintainSqlTests.WeeklyPartitions_StartOnMondayAsync, PartitionMaintainSqlTests.HourlyPartitions_AreNamedByTheHourAsync, PartitionMaintainSqlTests.AnIntervalThatIsNotWholeHours_IsRejectedAsync}

An interval is a whole number of hours with no month part (a month is not a fixed length). Boundaries are counted in
UTC from Monday 2000-01-03, so a weekly partition starts on a Monday at 00:00 UTC and a daily one at midnight UTC.
Partitions are named `<table>_p<yyyymmdd>` after the day they start, or `<table>_p<yyyymmdd>_<hhmm>` for an interval
shorter than a day.

## pg_partman {#pg-partman}

{verified: PartitionManagementStrategyTests.Resolve_EachCellAsync, PgPartmanPartitionMaintenanceTests.Auto_WithPgPartmanReady_RunsItsPassUntilTheReboundIsDone_ThenTheBuiltInPassAsync, PgPartmanPartitionMaintenanceTests.Auto_WhenPgPartmanIsNotPermitted_KeepsTheBuiltInManager_AndSaysSoOnceAsync, PgPartmanPartitionMaintenanceTests.ExplicitPgPartman_WithoutTheExtension_FailsTheCycleNamingTheSettingAsync}

`Whizbang:Workers:Maintenance:Partitioning:Strategy` decides who **creates** partitions. Whoever creates them, the
built-in manager **drops** them.

| Value | Creates partitions | When pg_partman cannot be used |
|---|---|---|
| `Auto` (default) | pg_partman where it is already Ready on every database probed, otherwise the built-in manager | The built-in manager, and the cycle says why. Auto never installs pg_partman |
| `BuiltIn` | the built-in manager, even where pg_partman is Ready | n/a |
| `PgPartman` | pg_partman | Start fails with the [capability verdict](capabilities#verdict)'s fix; a cycle that still cannot reach it fails |

`PgPartman` declares `[RequiresPostgresExtension("pg_partman", Feature = "Partition management")]`, so choosing it
is an explicit requirement: pg_partman is [provisioned](capabilities#provisioning) where the server allows it, and a
server that does not allowlist it, or lacks it, stops start:

```text
capability postgres/pg_partman on 'orders': NotPermitted, 5.5.0. Fix: add PG_PARTMAN to the server's extension allowlist (azure.extensions on Azure Database for PostgreSQL). Required by: Partition management (Whizbang:Workers:Maintenance:Partitioning:Strategy = PgPartman, explicit)
```

`Auto` and `BuiltIn` put no requirement in force, so the default never installs or requires pg_partman. Where
pg_partman is available but not installed, `Auto` keeps the built-in manager and says how to opt in.

```json{
title: "Hand partition creation to pg_partman"
description: "Turns the partition manager on and makes pg_partman create the partitions; start fails with the fix where the server cannot provide it."
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["partitioning", "pg_partman", "maintenance", "capabilities"]
tests: ["PartitionManagementStrategyTests.TheSetting_DefaultsToAuto_AndBindsFromConfigurationAsync", "PartitionManagementStrategyTests.ExplicitPgPartman_OnAServerThatDoesNotAllowlistIt_FailsStartWithTheFixAsync"]
}
{
  "Whizbang": {
    "Workers": {
      "Maintenance": {
        "Partitioning": {
          "Enabled": true,
          "Strategy": "PgPartman"
        }
      }
    }
  }
}
```

### What a pg_partman cycle does {#pg-partman-cycle}

{verified: PgPartmanPartitionSqlTests.TheFirstPass_RegistersTheTableOnce_FromTheFirstUncoveredInterval_AndMaintainsItAsync, PgPartmanPartitionSqlTests.AUuidKey_IsRegisteredWithTheVersion7EncoderAsync, PgPartmanPartitionSqlTests.RetentionSetOnTheTable_IsTurnedBackOff_SoTheBuiltInDropCarriesSignalsFirstAsync, PgPartmanPartitionMaintenanceTests.AReboundThatNeverCompletes_IsLeftAfterThreeStepsAsync}

Between the conversion and the built-in pass, each table gets a pg_partman pass, `wh_partition_partman`:

1. **Re-bound the oldest partition, once.** A converted table's oldest partition is bounded below by `MINVALUE`.
   pg_partman cannot read that bound: its maintenance logs a `WARNING` and skips the whole table. The pass bounds it
   from the smallest value of the key instead (`'-infinity'`, or `00000000-0000-0000-0000-000000000000` for a uuid
   key), which holds exactly the same rows. It takes three steps, each committed on its own, and none holds a lock a
   writer waits on during a scan: add a check of the new range without validating it, validate it (a scan under
   `SHARE UPDATE EXCLUSIVE`), then detach and re-attach the partition under the new bound, which the validated check
   lets PostgreSQL accept without scanning again. The step repeats the pass while it reports `rebounding`, at most
   three times a cycle; a step whose lock is not free is `deferred` to the next cycle. Until the table is re-bounded
   it is not given to pg_partman.
2. **Register it, once.** `create_parent` with `p_premake` = `CreateAhead`, starting at the first interval no
   partition covers (so pg_partman never overlaps a partition the conversion or the built-in manager made), no
   default table of its own (the manager keeps `<table>_default`), automatic maintenance off, and, for a uuid key,
   pg_partman's version-7 encoder and decoder. Reported as `registered`.
3. **Keep its settings.** Every cycle `premake` follows `CreateAhead`, partitions are made from the clock rather than
   from the newest row (`infinite_time_partitions`), and `retention` stays off. A change is reported as `configured`.
4. **Maintain it.** `run_maintenance` for that table alone. Reported as `maintained`, at Debug.

Then the built-in pass runs as before: it creates anything still missing, tunes [autovacuum
settings](#autovacuum-settings) on the partitions pg_partman made, carries unconsumed signals and drops expired
partitions.

```mermaid{caption="A cycle where pg_partman creates partitions: the conversion, the pg_partman pass (re-bound once, register once, keep its settings, run_maintenance), then the built-in pass, which creates what pg_partman missed and drops expired partitions after carrying unconsumed signals." tests=["PgPartmanPartitionMaintenanceTests.Auto_WithPgPartmanReady_RunsItsPassUntilTheReboundIsDone_ThenTheBuiltInPassAsync", "PgPartmanPartitionSqlTests.AConvertedTablesOldestPartition_IsReboundedFromTheSmallestKey_InThreeStepsAsync", "PgPartmanPartitionSqlTests.TheFirstPass_RegistersTheTableOnce_FromTheFirstUncoveredInterval_AndMaintainsItAsync"]}
sequenceDiagram
  participant M as Maintenance step
  participant C as wh_partition_convert
  participant P as wh_partition_partman
  participant G as pg_partman
  participant B as wh_partition_maintain
  M->>C: convert (once)
  loop while rebounding, at most 3
    M->>P: pass
    P->>P: re-bound MINVALUE partition (one step)
  end
  P->>G: create_parent (once)
  P->>G: part_config: premake, clock-made, no retention
  P->>G: run_maintenance(table)
  M->>B: built-in pass
  B->>B: create what is missing (a miss is logged)
  B->>B: carry unconsumed signals, then drop expired partitions
```

### Why the built-in manager still drops {#pg-partman-retention}

{verified: PgPartmanPartitionSqlTests.RetentionSetOnTheTable_IsTurnedBackOff_SoTheBuiltInDropCarriesSignalsFirstAsync, SignalPartitionCarryForwardTests.ALiveInstanceBehindTheWindow_KeepsEveryUnconsumedSignalAcrossTheDrop_AndReceivesThemInOrderAsync}

pg_partman's retention is kept off for every table it is given, and set back off if anyone sets it. pg_partman
would drop a `wh_signals` partition by age alone, and with it the signals a live instance has not consumed yet; the
built-in drop carries those signals into the current partition first ([signals](#signals)), in the same step and
under the same locks. The built-in drop also reads each table's window from `wh_settings` every cycle, keeps every
partition under `debug_mode`, and never waits for a lock. One drop path for every table keeps those guarantees in
one place.

### What it reports {#pg-partman-reporting}

{verified: PgPartmanPartitionMaintenanceTests.Auto_WithPgPartmanReady_RunsItsPassUntilTheReboundIsDone_ThenTheBuiltInPassAsync, PgPartmanPartitionMaintenanceTests.Auto_WhenThePgPartmanPassFails_ReportsIt_AndTheBuiltInManagerKeepsTheTableAsync, PgPartmanPartitionMaintenanceTests.Auto_WhenPgPartmanIsNotPermitted_KeepsTheBuiltInManager_AndSaysSoOnceAsync}

- `Partition management: <reason>`, at Information, when the choice is first made and whenever it changes, for
  example `Partition management: Auto: pg_partman is NotPermitted, so the built-in manager creates and drops
  partitions`.
- `pg_partman reported for <table>: <message>`, at Warning, for every notice pg_partman raises. pg_partman reports a
  table it skipped only as a `WARNING`, so this is how a skipped table becomes visible.
- `pg_partman did not create <partition> of <table>; the built-in manager created it`, at Warning, for each
  partition the built-in pass had to create after pg_partman maintained the table.
- Under `Auto`, a pass that fails is logged at Warning with the error (`pg_partman pass failed for <table>; the
  built-in manager keeps it this cycle`) and the built-in pass runs. Under `PgPartman` the error fails the cycle.

pg_partman decides what to create from the database server's clock, not the cycle's moment. pg_partman 5.2 or later
is needed for a uuid key (`wh_lifecycle_completions`), which uses its version-7 encoder.

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
  later cycle. The data is gone on schedule either way, except the rows carried forward first
  ([signals](#signals)); carrying writes through the parent and takes it in `ROW EXCLUSIVE` mode, which a writer does
  not conflict with, and only if that lock is free at once.
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

### Time-ordered ids {#time-ordered-ids}

{verified: UuidPartitionSqlTests.AUuidBound_IsTheFirstIdOfItsMoment_AndReadsBackAsThatMomentAsync, UuidPartitionSqlTests.ACycle_CreatesDailyIdPartitions_AndAVersion7IdLandsInItsDayAsync, UuidPartitionSqlTests.APartitionWhollyPastTheWindow_IsDropped_OneStraddlingItIsKeptAsync, UuidPartitionSqlTests.AVersion4Id_LandsInTheDefaultPartitionAsync}

A table can also be partitioned by a `uuid` key, as `wh_lifecycle_completions` is by `event_id`. Framework ids are
UUIDv7: the first 48 bits are the moment the id was made, in Unix milliseconds, and PostgreSQL compares uuids byte by
byte. So the first id of a moment is that moment's milliseconds followed by zeros, and the ids made in one day are
exactly the range from that day's first id to the next day's. The manager reads the key's type from the catalog and
writes each boundary moment as the matching id, for example 2026-10-21 00:00 UTC as
`01a15bc1-f400-0000-0000-000000000000`. Intervals, names, the window and the locks are the same as for a timestamp
key.

An id that is not time-ordered (a version-4 id, whose first bits are random) is still accepted. No daily partition
covers it, so it lands in the default partition, which nothing drops; the row sweep keeps clearing that partition by
its own timestamp column ([row sweeps](#row-sweeps)).

## Converting an existing table {#converting-an-existing-table}

{verified: LogPartitionConversionTests.Conversion_KeepsEveryRow_InTheLegacyPartitionAsync, SignalPartitionConversionTests.Conversion_KeepsEverySignal_AndTheKeyGainsCreatedAtAsync, SignalPartitionConversionTests.ADurableSignal_IsStillPublishedAndDelivered_AfterConversionAsync, LifecycleCompletionPartitionConversionTests.Conversion_KeepsEveryCompletion_AndAVersion4IdMovesToTheDefaultPartitionAsync, EFCoreWorkCoordinatorLifecycleAndJanitorTests.LifecycleCompletions_AfterPartitioning_AreStillRecordedOnce_AndFoundByEventIdAsync, LogPartitionConversionTests.EveryWriter_StillInserts_IncludingASessionThatWroteBeforeTheConversionAsync, LogPartitionConversionTests.Conversion_InterruptedPartway_LeavesTheTableAsItWas_AndTheNextCycleCompletesItAsync, LogPartitionConversionTests.Conversion_WhileAWriterHoldsTheTable_IsDeferredAsync, LogPartitionConversionTests.TheMarker_StopsTheConversionRunningAgainAsync, LogPartitionConversionTests.Conversion_CarriesTheTablesGrantsToTheParentAsync}

The first enabled cycle converts each registered table that is still plain: `wh_log`, `wh_signals` and
`wh_lifecycle_completions`. Nothing is copied. For `wh_log`:

1. The table is renamed `wh_log_legacy`.
2. A partitioned parent named `wh_log` is created with the same columns, defaults, comments, grants and owner. Its
   primary key becomes `(log_id, logged_at)`, because PostgreSQL requires every unique key of a partitioned table to
   include the partition column, and it keeps drawing ids from the same sequence.
3. The default partition is added. A row whose key is at or past the start of the next interval (a time from a clock
   running ahead, or an id that is not time-ordered) moves into it, so one such row cannot fail the next step.
4. `wh_log_legacy` is attached as the oldest partition, covering everything before the start of the next week, and
   the parent's indexes are recreated under their original names, adopting the legacy table's indexes. The next
   cycle's partitions start where the legacy partition ends.

`wh_signals` converts the same way, daily: its primary key becomes `(id, created_at)`. Nothing references a signal
by its id alone; each instance's tail cursor compares ids (`id > cursor ORDER BY id`, and `MAX(id)` for a new
instance), which the parent's key, led by `id`, still answers in every partition. `wh_lifecycle_completions` is
partitioned by its key, `event_id`, so the key stays as it is and a second completion for one event is still
refused; its legacy partition covers every id below the first id of the next day.

Every function that writes these tables keeps working unchanged against the parent, including a session that wrote
before the conversion: a durable signal is still published and delivered, and a lifecycle completion is still
recorded once and found by its event id. The legacy partition is dropped like any other once its range is past the
window.

The conversion is **one transaction**. It takes the table's exclusive lock only if it is free (otherwise it returns
`deferred` and the next cycle tries again), and attaching checks every row against the range once, under that lock.
A failure anywhere rolls the whole conversion back, leaving the plain table as it was, and the next cycle starts
again. When it commits, it records the table's **conversion marker** (`wh_log_partition_version`,
`wh_signals_partition_version`, `wh_lifecycle_completions_partition_version`, each `= 1`) in `wh_settings`; with the
marker present the conversion never runs again
([conversion markers](migrations#conversion-markers)).

## Signals: carried past a drop {#signals}

{verified: SignalPartitionCarryForwardTests.ALiveInstanceBehindTheWindow_KeepsEveryUnconsumedSignalAcrossTheDrop_AndReceivesThemInOrderAsync, SignalPartitionCarryForwardTests.ADeadInstancesCursor_CarriesNothing_AndThePartitionIsDroppedAsync, SignalPartitionCarryForwardTests.WithNoLag_NothingIsCarried_AndThePartitionIsDroppedAsync, SignalPartitionCarryForwardTests.ALiveInstanceBehind_KeepsItsSignals_WhenTheTableIsInUseAndThePartitionIsOnlyEmptiedAsync}

Each instance tails `wh_signals` from its own cursor and delivers every signal with an id past it, in id order. The row
sweep never deletes past the slowest cursor, but a partition drop removes a whole day by age. So before the manager
drops (or empties) a `wh_signals` partition, it moves the signals a **live** instance has not consumed into the
current partition, then drops the old one:

- **What moves:** the rows of the expiring partition whose `id` is past the slowest live instance's cursor.
- **Who counts as live:** an instance registered in `wh_service_instances`. The stale-instance reap removes a dead
  instance's registration, after which its cursor holds nothing back, so one dead instance never keeps the table
  growing.
- **How:** `UPDATE ... SET created_at = now` through the parent, where `now` is the cycle's moment. PostgreSQL moves
  each row into the partition for that moment (or the default partition, if that day's partition does not exist yet).
  The `id` is unchanged, so the tail's `id > cursor ORDER BY id` still delivers the carried signals in order. The
  dead tuples the move leaves in the old partition go away with the drop.
- **Cost:** normally nothing. With no live cursor, or no instance behind, no row moves and the partition is dropped
  as before. The move runs in the same step and under the same locks as the drop.
- **Trade-off:** a carried signal starts a fresh `SignalRetention` window, so an instance that stays registered but
  never advances keeps its undelivered signals one day at a time.

```mermaid{caption="A wh_signals partition past the window: the signals past the slowest live cursor move to the current partition with their ids unchanged, then the old partition is dropped; a dead instance's cursor is not counted." tests=["SignalPartitionCarryForwardTests.ALiveInstanceBehindTheWindow_KeepsEveryUnconsumedSignalAcrossTheDrop_AndReceivesThemInOrderAsync", "SignalPartitionCarryForwardTests.ADeadInstancesCursor_CarriesNothing_AndThePartitionIsDroppedAsync", "SignalPartitionCarryForwardTests.WithNoLag_NothingIsCarried_AndThePartitionIsDroppedAsync"]}
flowchart LR
  OLD["Expired partition: ids 101, 102, 103"] -->|"id past the slowest live cursor (101)"| CUR["Current partition: 102, 103, created_at = now"]
  OLD -->|"then dropped"| GONE["Dropped: 101 and the dead tuples"]
  LIVE["Live instance, cursor 101"] -.->|"counts"| OLD
  DEAD["Unregistered instance, cursor 50"] -.->|"ignored"| OLD
  CUR -->|"tail: id > 101 ORDER BY id"| LIVE
```

## Row sweeps {#row-sweeps}

{verified: LogPartitionConversionTests.OnceConverted_RetentionDropsPartitions_InsteadOfDeletingRowsAsync, LogPartitionConversionTests.OnceManaged_TheRowDeleteSweepsOnlyTheDefaultPartition_AndLeavesPartitionsToTheDropAsync, LogPartitionConversionTests.OnceManaged_WithoutADefaultPartition_TheRowDeleteSkipsAsync, DapperPartitionManagerSqlTests.TheLog_OnceManaged_IsSweptInItsDefaultPartitionOnlyAsync, SignalPartitionConversionTests.OnceManaged_TheSweepLeavesPartitionsToTheDrop_AndClearsOnlyTheDefaultAsync, SignalPartitionConversionTests.AConvertedTable_WithPartitioningSwitchedOff_IsStillSweptByRowAsync, EFCoreWorkCoordinatorLifecycleAndJanitorTests.CleanupLifecycleCompletionsAsync_OncePartitionedAndManaged_SweepsOnlyTheDefaultPartitionAsync, EFCoreWorkCoordinatorLifecycleAndJanitorTests.CleanupLifecycleCompletionsAsync_PartitionedWithMaintenanceSwitchedOff_SweepsByRowAsync, LifecycleCompletionPartitionConversionTests.TheSweepRelation_IsTheTable_UntilItIsPartitionedAndManaged_ThenItsDefaultPartitionAsync}

Each table keeps its row sweep, and the sweep decides each run what it may delete from:

| Table state | `wh_log` sweep | `wh_signals` sweep | `wh_lifecycle_completions` sweep |
|---|---|---|---|
| Plain, or partitioned with `Partitioning:Enabled` off | every row past the window | every row past the window that every instance has delivered | every row whose `completed_at` is past the window |
| Partitioned and maintained | the default partition only | the default partition only | the default partition only |

Once the manager keeps a table, its expired partitions are dropped whole, so a row delete there would only leave dead
tuples in the partition that straddles the window. The default partition is the exception: it holds rows no
partition covers (a version-4 event id, or a row written while maintenance had fallen behind), and no drop ever
reaches it, so each sweep keeps clearing it with its usual predicate (for `wh_log`, `logged_at` past
`log_retention_days`). The `wh_log` sweep reports its status as `ok (partitioned: the default partition only; expired
partitions are dropped)`, or `skipped (partitioned: no default partition)` when the partition is missing.
`wh_partition_sweep_relation(table)` answers which relation that is: the table, its default partition, or nothing.

Two differences from the row sweep follow from dropping by range:

- **Signals.** The signal sweep never deletes past the slowest instance's cursor, whether or not that instance is
  still registered. A partition drop goes by age, and carries forward only what a live instance still needs
  ([signals](#signals)), so a dead instance's cursor holds back the sweep but not the drop.
- **Lifecycle completions.** The row sweep goes by `completed_at`; the partition drop goes by the time in the event
  id, which is never later. A completion is only looked up for events of the last 30 minutes, far inside the window,
  so dropping by the event's time loses nothing the reconcile reads.

## How a table registers {#how-a-table-registers}

{verified: PartitionedTableTests.TheLog_IsWeeklyByLoggedAt_KeptForItsRetentionSettingAsync, PartitionedTableTests.TheSignals_AreDailyByCreatedAt_KeptForTheDurableSignalWindowAsync, PartitionedTableTests.TheLifecycleCompletions_AreDailyByEventId_KeptForTheirRetentionDaysAsync, PartitionedTableTests.TheFrameworkTables_TakeTheirWindowsFromTheConfiguredOptionsAsync, DapperPartitionMaintenanceStepTests.AnIndefiniteWindow_DropsNothingAsync, PartitionedTableTests.AFixedWindow_IsCarriedAsIsAsync, DapperPartitionMaintenanceStepTests.AFixedWindow_DropsWhatEndedBeforeItAsync, DapperPartitionMaintenanceStepTests.TheLogsWindow_IsReadFromItsSettingAsync}

A framework table joins the manager by registering a declaration in the driver's service registration; the manager
itself does not change. The declaration names the table, its partition column (a `timestamptz`, or a time-ordered
`uuid`), the interval, and where the retention window comes from: a fixed span taken from an option at startup
(`SignalRetention`, `LifecycleCompletionRetentionDays`), a `wh_settings` key holding days with a default for when the
key has no row (read each cycle, so an operator's change applies to the next drop), or no window at all, which keeps
every partition. A plain table is
converted on its first enabled cycle; a table its migration creates partitioned is maintained as it is. The
declaration is internal to the framework.
