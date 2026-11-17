---
title: Operational Retention
pageType: guide
version: 1.0.0
category: Infrastructure
order: 12
description: >-
  How the records cleanup and integrity keep about their own work rest for a configurable period and are then removed:
  every framework table classified as State or Rolling, the guard test that fails a table with no rule, the rolling
  sweep inside the maintenance cycle, Whizbang:OperationalRetention and its categories, the metrics, and the inventory
  of every table and how it is bounded
tags: >-
  operations, retention, maintenance, cleanup, integrity, operational records, rolling, state, rewrite log, restore
  requests, wh_integrity_origin_rewrites, wh_archive_restore_requests, guard test, metrics
codeReferences:
  - src/Whizbang.Data.Postgres/OperationalTableRegistry.cs
  - src/Whizbang.Data.Postgres/Migrations/451_OperationalRecordsRollOff.sql
  - src/Whizbang.Data.Postgres/CoordinatorRetentionSql.cs
  - src/Whizbang.Core/Workers/OperationalRetentionOptions.cs
  - src/Whizbang.Core/Workers/MaintenanceWorker.cs
  - src/Whizbang.Core/Observability/MaintenanceMetrics.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreWorkCoordinator.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperWorkCoordinator.RetentionSweeps.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/OperationalTableRegistryGuardTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/OperationalRetentionSweepSqlTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperOperationalRetentionTests.cs
  - tests/Whizbang.Core.Tests/Workers/OperationalRetentionOptionsTests.cs
  - tests/Whizbang.Core.Tests/Workers/MaintenanceWorkerOperationalRetentionTests.cs
---

# Operational Retention

Cleanup and integrity record their own work: repair ledgers, the origin rewrite log, delivery and answer records,
reports, finished queue rows, per-run maintenance records. A record that is never removed grows with time, so the
bookkeeping itself adds growth as the system scales, which is the opposite of what cleanup is for.

The rule is simple. **State that correctness depends on is kept. Everything else rests for a configurable period, so
it can be investigated, and is then removed.**

```mermaid{caption="Every framework table is classified: State is kept, Rolling rests then goes, and an unclassified table fails the build." tests=["OperationalTableRegistryGuardTests.EveryTableInTheSchema_IsClassifiedAsync", "OperationalRetentionSweepSqlTests.ARestoredRequest_IsRemovedPastTheRetention_AndAnOpenOrFailedOneStaysAsync"]}
flowchart LR
  T[A framework table] --> C{Classified in OperationalTableRegistry}
  C -->|State| K[Kept: bounded by lanes, types, epochs, streams, instances or work in flight]
  C -->|Rolling, own setting| O[Removed by its own retention setting]
  C -->|Rolling, swept here| S[Operational retention sweep: closed and past its category's resting period]
  C -->|missing| F[Guard test fails the build]
```

## Every table is classified {#every-table-is-classified}
{verified: OperationalTableRegistryGuardTests.TheGuard_ReadsTheRealSchemaAsync, OperationalTableRegistryGuardTests.EveryTableInTheSchema_IsClassifiedAsync, OperationalTableRegistryGuardTests.EveryRegistryEntry_IsATableInTheSchemaAsync, OperationalTableRegistryGuardTests.TheRegistry_NamesEachTableOnce_InNameOrder_AndEveryRollingTableHasACategoryAsync, OperationalTableRegistryGuardTests.APerspectiveTable_IsStateByItsPrefix_AndAnUnknownTableIsNotClassifiedAsync}

`OperationalTableRegistry` (in `Whizbang.Data.Postgres`) names every framework table once, with its class:

- **State** carries the key set it is bounded by: lanes, types, epochs, streams, instances, configuration, or work in
  flight that is removed when it completes.
- **Rolling** carries its retention category and what removes its rows: a setting of its own, or this page's sweep.

A guard test reads the tables of the schema the migrations actually built (every ordinary or partitioned `wh_` table,
partitions excluded because they follow their parent) and fails when one is not in the registry, or when the registry
names a table the schema no longer has. A migration that adds a table therefore cannot ship without saying how the
table is kept. Perspective tables (`wh_per_*`) are application read models, State by definition; the application names
them, so they are matched by prefix.

**Why the list is read from the schema, not written.** A hand-kept list of tables would be one more list to forget. The
test compares the registry with what the migrations created, so the only way to pass it is to classify the new table.

## Categories {#categories}

| Category | Holds | Configuration key |
|---|---|---|
| `RepairLedger` | Closed repair ledger rows and repair attempts | `Whizbang:OperationalRetention:RepairLedger` |
| `RewriteLog` | The origin rewrite log (`wh_integrity_origin_rewrites`) | `Whizbang:OperationalRetention:RewriteLog` |
| `Deliveries` | Delivery, answer and handled records | `Whizbang:OperationalRetention:Deliveries` |
| `Reports` | Drift, divergence and other reports | `Whizbang:OperationalRetention:Reports` |
| `PairHistory` | Pair halt history and instance exit history | `Whizbang:OperationalRetention:PairHistory` |
| `RecheckRuns` | Results of re-check runs | `Whizbang:OperationalRetention:RecheckRuns` |
| `Queues` | Finished queue rows | `Whizbang:OperationalRetention:Queues` |
| `MaintenanceRuns` | Per-run maintenance records and logs | `Whizbang:OperationalRetention:MaintenanceRuns` |
| `CarriedDetail` | The per-stream detail of what cuts carried: the carried columns of a stream's digest bucket (#2363). Cleared, not removed: the bucket's digest and the epochs' removed rows stay. See [carried detail rests, then rolls off](../../resilience/stream-integrity#carried-detail-rests-then-rolls-off) | `Whizbang:OperationalRetention:CarriedDetail` |

A category with no override rests for `Whizbang:OperationalRetention:Default`.

## What the sweep removes {#what-the-sweep-removes}
{verified: OperationalRetentionSweepSqlTests.TheRewriteLog_LosesItsRowsPastTheRetention_AndItsStartMovesWithThemAsync, OperationalRetentionSweepSqlTests.TheRewriteLog_IsRemovedOldestGenerationFirst_InBoundedBatchesAsync, OperationalRetentionSweepSqlTests.ARestoredRequest_IsRemovedPastTheRetention_AndAnOpenOrFailedOneStaysAsync, OperationalRetentionSweepSqlTests.ACategoryWithNoRetentionGiven_RemovesNothing_ButIsStillReportedAsync, OperationalTableRegistryGuardTests.TheSweep_RemovesExactlyTheTablesTheRegistryMarksSweptHereAsync, OperationalRetentionSweepSqlTests.AnAdvisoryFinding_UntouchedPastTheRetention_GoesAsync, OperationalRetentionSweepSqlTests.ADeadLetterSummary_GoesOnlyOnceItsDeadLettersAreGoneAsync, OperationalRetentionSweepSqlTests.AFinishedProbeCampaign_GoesOnceItsCohortIsGone_ARunningOneNeverAsync, OperationalRetentionSweepSqlTests.AStack_GoesWithItsLinks_OnceNothingNamesIt_AndThenItsUnusedFramesAsync, DapperRequestResponseExpiryTests.AnExpiredRecord_IsRemovedByTheMaintenanceStep_AndALiveOneStaysAsync}

Most Rolling tables were already bounded by a setting of their own, and they keep it (see the
[inventory](#inventory)). The sweep (`wh_sweep_operational_retention`, migrations 451 and 456) covers the Rolling tables that were
bounded by nothing, or only by a row count:

| Table | Category | Removed | Kept whatever its age |
|---|---|---|---|
| `wh_integrity_origin_rewrites` | `RewriteLog` | Generations older than the resting period, oldest first | Every generation newer than the newest one removed |
| `wh_archive_restore_requests` | `Queues` | `Restored` requests whose last update is older than the resting period | `Pending` and `Restoring` (work) and `Failed` (it holds back another automatic restore until one succeeds) |
| `wh_advisory_ledger` | `Reports` | Findings no scan touched for the resting period (migration 456, #2359) | A finding still detected: every scan touches it, and its row is what keeps a repeat inside the 7-day cooldown quiet |
| `wh_dead_letter_summary` | `Reports` | Clusters past the resting period with no dead letter left | A cluster with a dead letter left: the next aggregation would write it back |
| `wh_dlq_probe_campaigns` | `Reports` | Finished campaigns past the resting period whose fingerprint has no dead letter left | Running campaigns (work), and finished ones while their cohort has dead letters (a failed campaign spends the cohort's generation budget, a passed one lets its rows be re-driven) |
| `wh_stacks`, `wh_stack_links` | `Reports` | Stacks past the resting period that no dead letter and no daily history row names, with their links | Every stack something still names |
| `wh_stack_frames` | `Reports` | Frames past the resting period that no link names | Every frame a stack still uses |
| `wh_signal_cursors` | `Deliveries` | Cursors whose instance is no longer registered and that have not moved for the resting period (migration 457, #2360) | Every live pod's cursor, however idle: the signal log is kept down to the lowest live cursor, so removing one would let its pod miss signals |

**Why "nothing relies on it" and not age alone (#2359).** These tables were left unbounded because each row is also a
reference: a summary row is rebuilt from dead letters, a campaign is the evidence the recovery worker acts on, a stack is
named by dead letters and the daily history. Age alone would remove a row something still reads, and the next pass would
either write it back or act without it. So each is removed only when it is past the resting period **and** nothing names
it any more. If a removed stack recurs it is recorded again as new, which is right: it had not been seen for the whole
resting period.

`wh_request_response` is bounded differently: each record carries its own expiry, and the store's expiry, which nothing
called, now runs on every maintenance cycle (`RequestResponseExpiryStep`, registered by the Dapper driver with the store).

A row is removed only when it is past its resting period **and closed**: an open ledger bucket, an in-flight delivery or
a request still waiting is state until it resolves. A test fails when the SQL sweep and the registry disagree on which
tables are swept here.

### The rewrite log keeps its start honest {#the-rewrite-log-keeps-its-start-honest}

The origin answers how far its history was rewritten since a consumer's generation, and **vouches** for that answer only
when its log reaches back that far ([a rewrite lowers a seal only as far as it reached](../../resilience/stream-integrity#rewrite-floor)).
The log always had a row cap (`integrity_origin_rewrite_log_rows`, 10,000 generations). It now also loses generations
older than the `RewriteLog` resting period, from its oldest end, and moves its start
(`integrity_origin_rewrite_log_from`) up to the newest generation it removed. A consumer whose recorded generation is
behind that start is answered as unknown and resets its seal, exactly as one behind the row cap always did; it is never
vouched for falsely.

**Why by time as well as by count.** A row cap bounds the table but not the age of what it holds: on a quiet origin the
10,000 rows can span years. Consumers audit daily and record the generation each time, so a resting period of 14 days
loses nothing a live consumer can still ask about.

**Why the plan's floor is not used.** The plan asked the log to keep every entry newer than the oldest consumer seal
generation it can still be asked about. The origin cannot know that: consumer seals live in each consumer's own
database. The start-moves-with-the-log rule gives the same safety from the origin's side: what it can no longer answer,
it says it cannot answer.

## Configuration {#configuration}
{verified: OperationalRetentionOptionsTests.TheDefaults_RestFourteenDays_InBoundedBatchesAsync, OperationalRetentionOptionsTests.TheDefaultAndACategoryOverride_BindFromConfigurationAsync, OperationalRetentionOptionsTests.EveryCategory_HasItsOwnOverrideKeyAsync, OperationalRetentionOptionsTests.Validate_AValueBelowItsFloor_FailsNamingTheKeyAsync, OperationalRetentionOptionsTests.TheValidator_IsCheckedAtHostStartAsync}

Bound automatically from `Whizbang:OperationalRetention`; no registration call is needed.

| Key | Default | Meaning |
|---|---|---|
| `Whizbang:OperationalRetention:Enabled` | `true` | Run the sweep in the maintenance cycle |
| `Whizbang:OperationalRetention:Default` | `14.00:00:00` | Resting period of every category without its own. Must be positive |
| `Whizbang:OperationalRetention:<Category>` | unset (the default) | A category's own resting period, for each category above. Must be positive when set |
| `Whizbang:OperationalRetention:BatchSize` | `1000` | Rows removed per table per batch. Must be at least 1 |
| `Whizbang:OperationalRetention:MaxBatchesPerCycle` | `10` | Batches one maintenance cycle runs at most. Must be at least 1 |

```json{title="Operational retention" description="Keep operational records for 14 days, the rewrite log for 30, finished queue rows for one" framework="NET10" category="Configuration" difficulty="BEGINNER" tags=["operations", "retention", "maintenance"] tests=["OperationalRetentionOptionsTests.TheDefaultAndACategoryOverride_BindFromConfigurationAsync"]}
{
  "Whizbang": {
    "OperationalRetention": {
      "Default": "14.00:00:00",
      "RewriteLog": "30.00:00:00",
      "Queues": "1.00:00:00"
    }
  }
}
```

A value below its floor fails the host at start, naming the key: see
[operational retention setting below its floor](../diagnostics/error-reference#operational-retention-setting-below-its-floor).

Retention of telemetry itself (logs, traces and metrics in the observability backend) is not configured here: it
belongs to that backend.

## When it runs {#when-it-runs}
{verified: MaintenanceWorkerOperationalRetentionTests.TheCycle_SweepsWithEachCategorysRetention_AndTheBatchSizeAsync, MaintenanceWorkerOperationalRetentionTests.TheCycle_RepeatsWhileABatchCameBackFull_AndStopsWhenOneIsShortAsync, MaintenanceWorkerOperationalRetentionTests.TheCycle_NeverRunsMoreBatchesThanItsCapAsync, MaintenanceWorkerOperationalRetentionTests.Disabled_SweepsNothingAsync, MaintenanceWorkerOperationalRetentionTests.NoOptionsRegistered_SweepsWithTheDefaultsAsync, DapperOperationalRetentionTests.TheSweep_RunsOnTheDapperDriverAsync}

The sweep is one task of the [maintenance cycle](./maintenance) (`operational_retention`), so it runs behind the same
idle gate and never competes with live work; it is not a worker of its own. Each batch removes at most `BatchSize` rows
per table. The cycle runs another batch while any table came back with a full one, and stops at `MaxBatchesPerCycle`,
so a backlog drains over several cycles instead of holding one. Both drivers run it.

**Why inside maintenance.** Its cost scales with what expires, not with what is stored: each table is read through an
index on its age, and the counts it reports read only the Rolling rows, which the resting period bounds.

## Metrics {#metrics}
{verified: MaintenanceWorkerOperationalRetentionTests.TheCycle_ReportsRowsRemovedAndLeft_AndTheOldestAge_PerCategoryAsync, OperationalRetentionSweepSqlTests.AnEmptyTable_ReportsNoRows_AndNoAgeAsync}

Meter `Whizbang.Maintenance`, each tagged by `category` and nothing else (no table, stream or tenant):

| Instrument | Kind | Meaning |
|---|---|---|
| `whizbang.maintenance.operational_rows` | gauge | Rolling rows left after the last sweep (open rows, which are state, are not counted); a category's tables summed |
| `whizbang.maintenance.operational_oldest_age_seconds` | gauge | Age of the oldest Rolling row left; a category's oldest table. No measurement when the category is empty |
| `whizbang.maintenance.operational_rows_expired` | counter | Rows the sweep removed (`whizbang_maintenance_operational_rows_expired_total` in Prometheus) |

**Alert:** an oldest age above twice the category's resting period means the sweep is not keeping up.

```promql
max by (category) (whizbang_maintenance_operational_oldest_age_seconds) > 2 * 14 * 86400
```

## Inventory {#inventory}

Every framework table at migration 451, and how it is bounded. 112 tables: 80 State and 32 Rolling (2 swept here, 23
bounded by a setting of their own, 7 unbounded today and flagged as follow-ups). The registry is the source of truth; this table is
its explanation.

### Rolling tables

| Table | Category | Bound |
|---|---|---|
| `wh_advisory_ledger` | Reports | This sweep (#2359): findings no scan touched for the resting period |
| `wh_archive_restore_requests` | Queues | **Swept here**: `Restored` requests after the resting period |
| `wh_collective_apply_progress` | Deliveries | `collective_apply_progress_retention_days` (7) |
| `wh_dead_letter_summary` | Reports | This sweep (#2359): clusters with no dead letter left |
| `wh_dead_letters` | Deliveries | Recovered rows after `dead_letter_retention_days` (7); unresolved rows are work |
| `wh_dlq_probe_campaigns` | Reports | This sweep (#2359): finished campaigns whose cohort is gone |
| `wh_ephemeral_blockers` | Reports | Replaced on every history walk; bounded by type pairs |
| `wh_event_metadata_staging` | Queues | `metadata_staging_days` (2), daily partitions |
| `wh_instance_evictions` | PairHistory | `instance_eviction_retention_hours` (24) |
| `wh_instance_exits` | PairHistory | `instance_exit_retention_days` (30) |
| `wh_integrity_ledger` | RepairLedger | A bucket goes when it heals or is forgotten; open divergences capped at `integrity_ledger_max_entries` |
| `wh_integrity_ledger_tally` | MaintenanceRuns | Two progress windows |
| `wh_integrity_origin_rewrites` | RewriteLog | **Swept here** by age, and capped at `integrity_origin_rewrite_log_rows` |
| `wh_lifecycle_completions` | Deliveries | `LifecycleCompletionRetentionDays` (7), daily partitions |
| `wh_log` | MaintenanceRuns | `log_retention_days` (14), weekly partitions |
| `wh_message_deduplication` | Deliveries | `dedup_retention_days` (30), which is also how long a redelivery is recognized |
| `wh_multi_stream_run_streams` | Queues | Removed with its run |
| `wh_multi_stream_runs` | Queues | `MultiStreamCommandOptions.CompletedRunRetention` (7 days) |
| `wh_perspective_applied` | Deliveries | One hour |
| `wh_receptor_handled` | Deliveries | `StreamIntegrity:RepairReceptorLookback` (7 days), daily partitions |
| `wh_request_response` | Queues | Own expiry: `RequestResponseExpiryStep` every maintenance cycle (#2359) |
| `wh_routes` | Reports | `route_idle_days` (365) |
| `wh_schedule_runs` | MaintenanceRuns | `schedule_run_retention_days` (30), newest run per schedule kept |
| `wh_signals` | Deliveries | `SignalRetention` (7 days) and the lowest live cursor |
| `wh_stack_daily` | Reports | `StackHistoryRetentionDays` (90) |
| `wh_stack_frames`, `wh_stack_links`, `wh_stacks` | Reports | This sweep (#2359): stacks nothing names, with their links, then unused frames |
| `wh_table_rewrite_history` | MaintenanceRuns | 90 days and 1,000 rows |
| `wh_traces` | Reports | `trace_retention_days` (30), daily partitions |
| `wh_unique_emission_claims` | Deliveries | A claim's expiry plus one day |

### State tables

| Bounded by | Tables |
|---|---|
| Lanes, epochs and seals | `wh_digest_epoch_frontiers`, `wh_digest_epoch_removed` (what cuts removed, per lane, tenant, type and epoch, #2363), `wh_digest_epoch_seals`, `wh_digest_epochs`, `wh_integrity_consumer_seals` (one row per consumer service that reports its seal, #2363), `wh_integrity_seals` |
| Streams | `wh_active_streams`, `wh_apply_fold_watermarks`, `wh_archive_manifest`, `wh_event_archive`, `wh_event_archive_cursors`, `wh_event_archive_rows`, `wh_perspective_cursors`, `wh_perspective_snapshots`, `wh_receptor_processing`, `wh_stream_digests`, `wh_stream_lifecycle`, `wh_stream_purge_markers` |
| Event data | `wh_event_body`, `wh_event_store`, `wh_offload_claims` (offloaded bodies, expire after `PassiveExpiry`) |
| Types and origins | `wh_unsequenced_digest_totals` (one row per origin, tenant and type), `wh_consumed_types`, `wh_definition_lineage`, `wh_integrity_domain_claims`, `wh_integrity_known_origins`, `wh_integrity_pending_gaps`, `wh_subscription_backfills`, `wh_type_definitions`, `wh_type_history_walks` |
| Instances and roles | `wh_instance_capabilities`, `wh_managed_object_declarations`, `wh_notify_state`, `wh_partition_assignments`, `wh_role_assignments`, `wh_role_candidates`, `wh_service_instances` |
| Work in flight (removed on completion) | `wh_archive_object_deletions`, `wh_doorbell_queue`, `wh_fillfactor_rewrite_requests`, `wh_inbox`, `wh_inbox_state`, `wh_index_statistics_pending`, `wh_integrity_deliveries`, `wh_outbox`, `wh_perspective_events`, `wh_role_pending_work`, `wh_row_eviction_journal`, `wh_superseded_events`, `wh_table_rewrite_measurements`, `wh_unsequenced_digest_changes` (deleted by the fold that takes each change in) |
| Holds and cursors | `wh_event_destruction_hold`, `wh_housekeeping_deferrals`, `wh_integrity_drill_cursors`, `wh_integrity_origin_correction`, `wh_integrity_reattribution`, `wh_perspective_row_hold`, `wh_collective_ordering_heads` |
| Configuration and model | `wh_apply_paths`, `wh_archive_locations`, `wh_bootstrap_closure`, `wh_ephemeral_type_grace`, `wh_index_equivalents`, `wh_managed_objects`, `wh_message_associations`, `wh_message_type_registry`, `wh_mixed_stream_allowances`, `wh_perspective_forms`, `wh_perspective_registry`, `wh_physical_column_fills`, `wh_schedules`, `wh_schema_migrations`, `wh_schema_versions`, `wh_sequences`, `wh_service_config`, `wh_settings`, `wh_stored_form_migrations`, `wh_stream_type_policies` |
| One row | `wh_metadata_history_conversion`, `wh_published_partition_assignment`, `wh_receptor_handled_coverage`, `wh_standby_requests`, `wh_superseding_history` (retired, kept empty) |
| Evidence of deliberate destruction | `wh_stream_purge_audit` (#2360: kept by default; `stream_purge_audit_retention_days` can still set a period) |
| Application read models | every `wh_per_*` table |

### Follow-ups the inventory found {#follow-ups}

- **Unbounded Rolling tables** outside cleanup and integrity (`wh_advisory_ledger`, `wh_dead_letter_summary`,
  `wh_dlq_probe_campaigns`, the stack dictionary and `wh_request_response`): bounded since #2359, see
  [What the sweep removes](#what-the-sweep-removes).
- **Decided (#2360).** `wh_stream_purge_audit` is **State**: the audit of an operator's purge is evidence of deliberate
  destruction, kept by default (`stream_purge_audit_retention_days` = 0 keeps it; an operator may still set a period).
  `wh_signal_cursors` is **Rolling** and swept (above): every pod start added a cursor and nothing removed one, and a
  dead cursor also held the signal log's retention back. Finished `wh_subscription_backfills` rows stay **State**: a
  backfill is inserted only if none exists for its owner and type, so the finished row is the "already done" marker,
  and removing it would start the backfill again. {verified: OperationalTableRegistryGuardTests.TheDecidedTables_AreClassifiedAsDecidedAsync, OperationalRetentionSweepSqlTests.AFinishedSubscriptionBackfill_IsNeverSwept_ItIsTheAlreadyDoneMarkerAsync, OperationalRetentionSweepSqlTests.ASignalCursor_OfAGoneInstance_GoesPastTheRetention_ALivePodsNeverAsync}
- **`wh_partition_assignments`** and **`wh_receptor_processing`** have no current writer and look like leftovers.
