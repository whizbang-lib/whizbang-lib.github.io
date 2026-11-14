---
title: Storage Maintenance
pageType: guide
version: 1.0.0
category: Infrastructure
order: 10
description: >-
  How Whizbang keeps its own tables from bloating: autovacuum and fillfactor settings on the framework tables, and how
  a table that has already grown is rewritten, as the table rewrite strategy and AllowTableRewrite decide, including
  the online rewrite through pg_squeeze or pg_repack that the maintenance cycle drives within a per-cycle byte budget,
  how bloat is measured across the heap and its TOAST relation, the configured rewrite thresholds and the
  post-rewrite floor that stops a freshly rewritten table being rewritten again, and the concurrent rebuild
  of bloated indexes on the queue tables that churn to empty
tags: >-
  operations, storage, autovacuum, fillfactor, hot, vacuum, bloat, toast, postgres, maintenance, table rewrite,
  pg_squeeze, pg_repack, pgstattuple, brin, index, correlation, reindex, index bloat
codeReferences:
  - src/Whizbang.Data.Postgres/Migrations/088_ChurnTableAutovacuum.sql
  - src/Whizbang.Data.Postgres/Migrations/222_FrameworkTableAutovacuum.sql
  - src/Whizbang.Data.Postgres/Migrations/223_PerspectiveCursorFillFactor.sql
  - src/Whizbang.Data.Postgres/Migrations/234_PerspectiveAppliedAutovacuum.sql
  - src/Whizbang.Data.Postgres/Migrations/235_RetireTableRewritePolicySetting.sql
  - src/Whizbang.Core/Workers/TableRewriteStrategy.cs
  - src/Whizbang.Core/Startup/TableRewriteStartupStep.cs
  - src/Whizbang.Core/Workers/PgRepackTableRewriter.cs
  - src/Whizbang.Core/Workers/PgRepackClient.cs
  - src/Whizbang.Core/Workers/PgRepackOptions.cs
  - src/Whizbang.Core/Processes/ExternalProcessRunner.cs
  - src/Whizbang.Core/Messaging/TableRewriteTarget.cs
  - src/Whizbang.Data.Postgres/LibpqEnvironment.cs
  - src/Whizbang.Core/Workers/OnlineTableRewriteStep.cs
  - src/Whizbang.Core/Workers/PgSqueezeTableRewriter.cs
  - src/Whizbang.Data.Postgres/PgSqueezePrerequisites.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreWorkCoordinator.cs
  - src/Whizbang.Core/Observability/BloatMeasurement.cs
  - src/Whizbang.Core/Workers/ApproxBloatMeasurement.cs
  - src/Whizbang.Core/Workers/MaintenanceWorker.cs
  - src/Whizbang.Data.Postgres/Migrations/254_BloatMeasurementsRecordTheirMethod.sql
  - src/Whizbang.Data.Postgres/Migrations/258_EventStoreCreatedAtBrin.sql
  - src/Whizbang.Data.Postgres/OrphanedLifecycleEventsSql.cs
  - src/Whizbang.Core/Workers/QueueIndexReindexStep.cs
  - src/Whizbang.Core/Workers/MaintenanceWorkerOptionsValidator.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Data.Postgres/QueueIndexSql.cs
  - src/Whizbang.Core/Workers/TableRewriteSettings.cs
  - src/Whizbang.Core/Workers/OnlineRewriteTools.cs
  - src/Whizbang.Data.Postgres/Migrations/430_BloatIsMeasuredWithItsToast.sql
  - src/Whizbang.Data.Postgres/TableMaintenanceSql.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/FrameworkTableAutovacuumTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/PerspectiveCursorFillFactorTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/PerspectiveAppliedAutovacuumTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/TableRewritePolicyRetiredTests.cs
  - tests/Whizbang.Core.Tests/Workers/TableRewriteStrategyTests.cs
  - tests/Whizbang.Core.Tests/Startup/TableRewriteStartupStepTests.cs
  - tests/Whizbang.Core.Tests/Workers/PgRepackTests.cs
  - tests/Whizbang.Core.Tests/Processes/ExternalProcessRequestTests.cs
  - tests/Whizbang.Core.Tests/PostgresExtensions/LibpqEnvironmentTests.cs
  - tests/Whizbang.Core.Integration.Tests/Processes/ExternalProcessRunnerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ExternalTableRewriteTests.cs
  - tests/Whizbang.Core.Tests/Workers/OnlineTableRewriteStepTests.cs
  - tests/Whizbang.Core.Tests/PostgresExtensions/PgSqueezePrerequisitesTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/OnlineTableRewriteSqlTests.cs
  - tests/Whizbang.Core.Tests/Workers/MaintenanceWorkerBloatMeasurementTests.cs
  - tests/Whizbang.Core.Tests/Observability/BloatMeasurementMethodTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/TableBloatMeasurementSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/BrinIndexCandidatesTests.cs
  - tests/Whizbang.Core.Tests/Workers/QueueIndexReindexStepTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/QueueIndexReindexSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ToastAwareBloatEstimateSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/RewriteRegrowthFloorSqlTests.cs
  - tests/Whizbang.Core.Tests/Workers/TableRewriteSettingsTests.cs
---

# Storage Maintenance

PostgreSQL never rewrites a row in place: an update or a delete leaves the old version behind as a dead tuple until a
vacuum reclaims it. Whizbang's own tables churn constantly, so their vacuum settings decide whether they stay a stable
size or grow to cover every burst.

## Autovacuum on the framework tables {#autovacuum}

{verified: FrameworkTableAutovacuumTests.UpdateAndDeleteTables_VacuumAfterAFixedCountAsync, FrameworkTableAutovacuumTests.TheEventStore_VacuumsAfterAFixedNumberOfInsertsAsync, FrameworkTableAutovacuumTests.TheEventBodyToastTable_VacuumsAfterAFixedCountAsync, PerspectiveAppliedAutovacuumTests.TheLedger_VacuumsAfterAFixedNumberOfDeadRowsAsync, PerspectiveAppliedAutovacuumTests.TheLedger_VacuumsAfterAFixedNumberOfInsertsAsync}

By default PostgreSQL vacuums a table once a fraction of it is dead: 20% (5% on some managed servers). That fraction
grows with the table, so a table of ten million rows waits for hundreds of thousands of dead ones. Whizbang's
migrations set per-table storage parameters instead, so the server settings need no change:

| Tables | Setting | Why |
|---|---|---|
| `wh_inbox`, `wh_outbox`, `wh_perspective_events`, `wh_active_streams` | vacuum and analyze at 2% (migration 088) | queues whose rows are deleted as work completes; a small working set |
| `wh_perspective_cursors`, `wh_lifecycle_completions`, `wh_stream_digests`, `wh_message_deduplication` | vacuum after 10,000 dead rows, whatever the size (migration 222) | updated or deleted continuously, and they grow with the data |
| `wh_event_store` | vacuum after 10,000 inserts (migration 222) | append-heavy: vacuum keeps its visibility map current, so index-only scans do not fall back to the table |
| `wh_event_body`'s TOAST table | vacuum after 10,000 dead chunks (migration 222) | large bodies live in TOAST, and the ephemeral reaper leaves their dead chunks there |
| `wh_perspective_applied` | vacuum after 10,000 dead rows and after 10,000 inserts (migration 234) | the [applied-event ledger](../../fundamentals/perspectives/perspective-sync#applied-ledger) is a sliding window: every completed apply inserts a row and the rows an hour old are pruned, so it inserts and deletes at the same rate |

The settings are applied by migration on every database, with either driver, and re-applying them changes nothing.
To see them on a table:

```sql{title="Read a table's autovacuum settings" category="Operations" difficulty="BEGINNER"}
SELECT c.relname, c.reloptions, t.reloptions AS toast_reloptions
FROM pg_class c LEFT JOIN pg_class t ON t.oid = c.reltoastrelid
WHERE c.relname IN ('wh_event_store', 'wh_event_body', 'wh_perspective_cursors', 'wh_perspective_applied');
```

## Free space for updates {#fillfactor}

{verified: PerspectiveCursorFillFactorTests.TheCursorTable_KeepsTenPercentOfEachPageFreeAsync, PerspectiveCursorFillFactorTests.ATableHoldingRows_IsQueuedForARewriteAsync, PerspectiveCursorFillFactorTests.ApplyingTheMigrationAgain_ChangesNothing_AndQueuesNothingAsync}

An update whose new row version fits on the same page, and that changes no indexed column, is a heap-only (HOT)
update: it writes no index entries, and the old version is pruned inside the page without vacuum. A page packed full
leaves no room, so the new version lands on another page and every index gains an entry. `wh_perspective_cursors` is
rewritten on every batch a perspective applies, so migration 223 sets its `fillfactor` to 90, keeping 10% of each page
free for those updates.

A new fillfactor applies only to pages written from then on. When the migration changes it on a table that already
holds rows, it also queues the table in the `pending_table_rewrites` setting (through `wh_request_table_rewrite`), and
the table is rewritten after startup when the [table rewrite strategy](#table-rewrite-strategy) allows it (see
[Table rewrites run post-ready](./migrations#table-rewrites-run-post-ready-under-the-maintainer-duty)). A perspective table that declares
`[PerspectiveTableStorage(FillFactor = …)]` is queued the same way when a start changes the value (see
[Physical Fields: free space for updates](../../fundamentals/perspectives/physical-fields#perspective-fillfactor)).
The worker re-measures every queued table and rewrites only one whose size has crossed the bloat threshold, so a
queued request on a compact table is left until it is worth a rewrite. A perspective table whose fillfactor was
**lowered** is the exception: it is rewritten once by an online strategy whatever its bloat (see
[A lowered fillfactor is rewritten once](#fillfactor-decrease)).

```sql{title="Read the fillfactor and the queued rewrites" category="Operations" difficulty="BEGINNER"}
SELECT relname, reloptions FROM pg_class WHERE relname = 'wh_perspective_cursors';
SELECT setting_value FROM wh_settings WHERE setting_key = 'pending_table_rewrites';
```

### A lowered fillfactor is rewritten once {#fillfactor-decrease}

{verified: FillFactorDecreaseRewriteTests.AFillFactorDecrease_OnACompactTable_IsRewrittenOnceOnline_AndAnUpdateOfAnOldRowIsHotAsync, FillFactorDecreaseRewriteTests.WithNoOnlineStrategy_TheRequestWaits_VacuumFullNeverRuns_AndTheStartSaysSoAsync, FillFactorDecreaseRewriteTests.WithTheRewritePolicyOff_NothingIsRewrittenAsync, FillFactorDecreaseRewriteTests.AFillFactorIncrease_IsNotOffered_ForTheBloatRuleAloneDecidesAsync, FillFactorDecreaseRewriteTests.TheRequest_RecordsTheDecreaseFromWhereThePagesWerePackedAsync, OnlineTableRewriteStepTests.AFillFactorDecrease_IsClearedOnceRewritten_ThoughTheTableGrewAsync, OnlineTableRewriteStepTests.AFillFactorDecrease_ThatWasNotRewritten_StaysQueuedAsync, TableRewriteStartupStepTests.VacuumFull_NeverTakesAFillFactorDecrease_AndTheStartSaysItWaitsAsync, TableRewriteStartupStepTests.NoRewritePermitted_AFillFactorDecreaseWaits_AndTheStartSaysSoAsync, MaintenanceWorkerTableRewriteTests.AFillFactorDecrease_IsNotReportedAsBloatAsync}

A compact table that is given `[PerspectiveTableStorage(FillFactor = 90)]` gets almost nothing from it under the bloat
rule: it never measures as bloated, so it is never rewritten, and the rows already stored stay on pages packed full
until each one is moved by an update. Those are exactly the rows that matter, the ones updated now and then on pages
that are already full. So a request the schema pass queues because it **lowered** a table's fillfactor is honored
once, whatever the table's bloat:

| The table's fillfactor | What happens to the queued request |
|---|---|
| lowered (100 to 90, say) | rewritten **once** by an [online rewrite](#online-rewrite) (pg_squeeze, or pg_repack in process), within the cycle's byte budget; cleared once the rewrite ran |
| raised, or reset to a value at or above where the pages were packed | the bloat rule alone decides, as before |
| lowered, with no online tool in use (none chosen, or `Auto` with neither tool Ready) | waits; each start logs once which tables wait and what would rewrite them; `VACUUM FULL` never takes it |

How it works, and why:

- **The reason is recorded beside the queue.** The schema pass records the request through
  `wh_request_fillfactor_rewrite(table, from, to)`, which queues it as `wh_request_table_rewrite` does and, while the
  pages are packed fuller than the fillfactor in force, keeps a row in `wh_fillfactor_rewrite_requests` with the
  fillfactor the pages were packed at and the one in force. A later change keeps the first value, since the pages are
  still packed at it; a change back to it or above removes the row. `wh_tables_owed_fillfactor_rewrite()` lists the
  queued tables with a row, and the maintenance cycle reads it beside `wh_tables_needing_rewrite()`, which is unchanged.
- **Once, then cleared.** Rewritten at a lower fillfactor, a compact table grows, so the "cleared only when the ratio
  dropped" rule that guards a bloat rewrite would keep the request forever. A lowered-fillfactor request is cleared once
  its rewrite ran (`wh_clear_table_rewrite` deletes the row with the request), so the next cycle does not rewrite the
  table again for the same change. A rewrite that did not run (its prerequisites were not met, or it failed) stays
  queued, as any other does.
- **Online only, never `VACUUM FULL`.** The table is compact, so taking an `ACCESS EXCLUSIVE` lock unattended for it is
  never worth it, whatever `AllowTableRewrite` says. A table that is lowered and also bloated is offered for its bloat,
  under the usual rules for every strategy.
- **The same gate and budget.** It is done by the online rewrite step, so only when `TableRewriteStrategy` is
  `PgSqueeze`, `PgRepack` in process, `Online`, or `Auto` resolved to an online tool on that cycle (see
  [Table rewrite strategy](#table-rewrite-strategy)), only where that tool's capabilities are `Ready`, only on the
  maintainer duty's holder when the housekeeping gate admits the cycle, and only within
  `OnlineRewriteMaxBytesPerCycle`. With `VacuumFull`, `None`, or `Auto` with neither tool Ready, nothing is rewritten.
  pg_repack in `External` mode leaves it to your job: list the tables from `wh_tables_owed_fillfactor_rewrite()` as
  well as `wh_tables_needing_rewrite()`, and call `wh_clear_table_rewrite` after each.
- **Not held back by the [post-rewrite floor](#post-rewrite-floor).** The rewrite is owed whatever the table's bloat,
  so a table rewritten recently for its bloat is still rewritten once for a lowered fillfactor.
  {verified: RewriteRegrowthFloorSqlTests.AFillFactorDecrease_IsNotHeldBackByTheFloorAsync}

**This revisits the decision of #1594.** It decided that a fillfactor change records a rewrite request and the
rewriter acts on bloat alone, to be revisited once an online rewrite existed, because the only rewrite then was the
blocking `VACUUM FULL`. pg_squeeze and pg_repack now run from the maintenance cycle within a byte budget, so one
rewrite of such a table is cheap and does not block it, and #2300 replaces "wait for bloat" with "rewrite once" for a
lowered fillfactor. A raised fillfactor keeps #1594's rule: its pages already have at least the room the new value asks
for.

When no online strategy is chosen, each start logs, for example:

```text
Rewrite step: wh_per_order, wh_per_item wait for one rewrite to apply their lowered fillfactor to the rows already stored. Only an online rewrite performs it: set Whizbang:Workers:Maintenance:TableRewriteStrategy to PgSqueeze, or to PgRepack with its client, and the maintenance cycle rewrites them within its budget. VACUUM FULL is never used for it; the requests stay queued
```

```sql{title="Read the tables owed a rewrite for a lowered fillfactor" category="Operations" difficulty="BEGINNER" tests=["FillFactorDecreaseRewriteTests.TheRequest_RecordsTheDecreaseFromWhereThePagesWerePackedAsync"]}
SELECT * FROM wh_tables_owed_fillfactor_rewrite();
SELECT table_name, from_fillfactor, to_fillfactor, requested_at FROM wh_fillfactor_rewrite_requests;
```

## BRIN indexes {#brin-indexes}

{verified: BrinIndexCandidatesTests.TheEventStore_InItsProductionWriteOrder_CorrelatesNearOneAsync, BrinIndexCandidatesTests.ARetentionTable_FallsBelowNearOne_AfterOneRetentionPassAsync, BrinIndexCandidatesTests.TheOrphanedLifecycleQuery_ReadsTheWindowThroughTheBrinIndexAsync, BrinIndexCandidatesTests.TheOrphanedLifecycleQuery_WithoutTheBrinIndex_ScansTheStoreAsync, BrinIndexCandidatesTests.TheEventStoreCreatedAtBrinIndex_ExistsAsync, BrinIndexCandidatesTests.NoOtherCandidate_HasABrinIndexAsync, BrinIndexCandidatesTests.TheExistingBTree_IsKeptAsync}

A BRIN (block range) index stores one minimum and one maximum for each range of heap pages instead of one entry per
row, so it is a few pages per gigabyte of table. It narrows a range query only as far as the table's physical order
follows the column: PostgreSQL reports that order as `pg_stats.correlation`, from -1 to 1. Near 1, the rows of a time
window sit together and the index points at the few ranges that hold them. Lower, every range holds a spread of values
and the index points almost everywhere.

Whizbang has one BRIN index, on `wh_event_store.created_at` (migration 258). Four tables were candidates. Each was
seeded in the order production writes it and measured (`BrinIndexCandidatesTests`, which prints each figure in its run
log):

| Column | While the table grows | After one retention pass | Range query in the framework | Decision |
|---|---|---|---|---|
| `wh_event_store.created_at` | 0.98 | (no retention) | the startup orphaned-lifecycle window, last 30 minutes | **BRIN index** |
| `wh_event_store.commit_sequence` | 0.98 | (no retention) | cursor reads, in `commit_sequence` order | B-tree kept, no BRIN |
| `wh_log.logged_at` | 1.00 | 0.60 (14-day retention) | retention delete of the oldest rows | B-tree kept, no BRIN |
| `wh_lifecycle_completions.completed_at` | 1.00 | 0.27 (7-day retention) | retention delete of the oldest rows | B-tree kept, no BRIN |
| `wh_message_deduplication.first_seen_at` | 1.00 | 0.81 (30-day retention) | retention delete of the oldest rows | B-tree kept, no BRIN |

### Near 1 means 0.9 or more {#brin-near-one-threshold}

A column qualifies at a correlation of 0.9 or more and a range filter in the framework's own queries. Below that, the
ranges overlap enough that the index reads most of the table, and the planner, which prices a BRIN scan by the same
correlation, chooses the sequential scan anyway. The tests hold both sides: the event store measures at or above 0.9,
each retention table measures at or above 0.9 before retention (so the harness can see a high value on that table) and
below it after one pass.

### The event store's created_at {#brin-event-store-created-at}

Events are appended in time order. The one later write to an event row, the commit-order stamp, cannot be a heap-only
update, so it writes a new version of the row elsewhere; it happens moments after the insert, so the new version lands
near the tail, and the pages vacuum frees are refilled with rows only minutes younger. The seeded store, written through
the emit chain and stamped after each batch with vacuum between batches, measures 0.98.

On every start the perspective worker looks for events whose perspectives all finished but whose lifecycle never
completed, within the last 30 minutes (`created_at >= window start`, `OrphanedLifecycleEventsSql`). No other index on
`wh_event_store` leads with `created_at` for every event (`idx_event_store_ephemeral_reap` covers ephemeral events
only), so that query read the whole store on every start. With the BRIN index the planner reads the store's tail
through a bitmap scan; the test EXPLAINs the coordinator's own query text and asserts it, and a control on the same
store without the index shows the sequential scan it replaces.

A store whose events mostly leave (ephemeral pointers past their horizon, purged streams) frees old pages that new
events refill, and its correlation falls the way a retention table's does. The index then reads more ranges, and once
the planner prices it above a sequential scan it stops using it: the query is never worse than it was before the
index.

### The retention tables {#brin-retention-tables}

`wh_log`, `wh_lifecycle_completions` and `wh_message_deduplication` lose their oldest rows to retention. Vacuum makes
those pages free, and the next rows are written into them, so after each pass the newest rows sit at the start of the
table and the order rotates. One pass at the default retention measured 0.60, 0.27 and 0.81: the shorter the
retention, the larger the share each pass moves. Each keeps its B-tree, which serves the retention delete at any
physical order. When the [partition manager](./partitioned-ledgers) keeps `wh_log` or `wh_lifecycle_completions`,
expired partitions are dropped whole and a range query is pruned to the partitions it needs, so a BRIN index adds
nothing there either.

### commit_sequence {#brin-commit-sequence}

`commit_sequence` follows the heap order as closely as `created_at` (0.98), but its readers walk it: a cursor asks
for the events after its position in `commit_sequence` order, a few at a time. A BRIN index returns unordered pages,
so every read would sort its whole range first. The partial B-tree `idx_event_store_commit_sequence` returns them in
order and stops at the limit, so it stays and no BRIN index is added.

### Nothing is replaced {#brin-nothing-replaced}

No B-tree was dropped for a BRIN index. `idx_event_store_ephemeral_reap` stays because the ephemeral reap needs its
order and its covered columns, and the retention tables' B-trees stay for the reasons above. Unused-index reporting
(`whizbang.table.unused_index_bytes`) is where evidence for removing an index comes from; nothing is dropped on a guess.

### How the index is built {#brin-pages-per-range}

`pages_per_range` is the default 128, written out in the migration so the choice is visible: one range is 1 MB of
heap, so the index stays a few pages per gigabyte of store and a 30-minute window reads a few ranges more than it
needs. `autosummarize` stays off: the window is the store's newest pages, which are the unsummarized ones and which a
BRIN scan always reads, and vacuum (kept running on this table by the stamper's updates) summarizes the ranges behind
them. From PostgreSQL 16 a BRIN index does not prevent a heap-only update.

The index is built inside the migration's transaction, as other event-store indexes are. A BRIN build is one
sequential read of the table with no sort, the cheapest index build there is, and the first start of the release that
carries migration 258 pays it once.

```sql{title="Measure a column's physical order" category="Operations" difficulty="INTERMEDIATE"}
ANALYZE wh_event_store;
SELECT tablename, attname, correlation
FROM pg_stats
WHERE tablename IN ('wh_event_store', 'wh_log', 'wh_lifecycle_completions', 'wh_message_deduplication')
  AND attname IN ('created_at', 'commit_sequence', 'logged_at', 'completed_at', 'first_seen_at');
```

## A table that has already grown {#already-grown}

Autovacuum makes dead space reusable, but it never returns pages to the operating system. A table that bloated before
these settings, or during an import, keeps its size until it is rewritten. A rewrite takes an exclusive lock for its
whole duration with `VACUUM FULL`, so plan it for a quiet window or use an online tool such as `pg_repack` or
`pg_squeeze` (see [Postgres extensions](./postgres-extensions)). The maintenance cycle records each table that needs
a rewrite; the [table rewrite strategy](#table-rewrite-strategy) decides what happens to it.

## How bloat is measured {#how-bloat-is-measured}
{verified: MaintenanceWorkerBloatMeasurementTests.WithoutACapabilityRegistry_TheEstimateIsRecorded_AndNothingIsMeasuredAsync, MaintenanceWorkerBloatMeasurementTests.WhenReady_ACandidateIsMeasuredWithApprox_AndQueuedWithTheMeasuredRatioAsync, MaintenanceWorkerBloatMeasurementTests.WhenReady_AFalsePositiveEstimate_IsNotQueued_AndTheLogGivesBothFiguresAsync, MaintenanceWorkerBloatMeasurementTests.WhenReady_AMeasurementThatDisagreesWithItsEstimate_IsLoggedWithBothFiguresAsync, MaintenanceWorkerBloatMeasurementTests.WhenReady_AMeasurementThatFails_FallsBackToTheEstimate_AndSaysWhyAsync, TableBloatMeasurementSqlTests.Approx_OnAStaleEstimate_MeasuresTheTableLeanAsync, TableBloatMeasurementSqlTests.AMeasuredRequest_IsQueuedWithItsRatioAndMethod_AndTheQueueOrdersByTheMeasuredRatioAsync, OnlineTableRewriteStepTests.WhenPgstattupleIsReady_TheReMeasureIsApprox_AndItDecidesTheClearAsync, TableRewriteStartupStepTests.WhenPgstattupleIsReady_TheReMeasureIsApprox_AndItDecidesTheClearAsync, ToastAwareBloatEstimateSqlTests.AMostlyDeadToast_UnderALeanHeap_IsACandidateAsync, ToastAwareBloatEstimateSqlTests.AHealthyToastedTable_IsNotACandidate_AndItsEstimateReadsLeanAsync, ToastAwareBloatEstimateSqlTests.Approx_MeasuresTheToastRelationToo_SoItConfirmsTheEstimateAsync}

A table's bloat ratio is the worse of two ratios: its heap's size over its live rows times the bytes those rows should
need, and its TOAST relation's size over its live chunks times the space a packed chunk takes (see
[the heap and the TOAST relation](#bloat-heap-and-toast)). About 1.0 is lean. It is obtained one of three ways, and
every stored or reported ratio says which:

| Method | Obtained with | Cost | Used for |
|---|---|---|---|
| `estimate` | `pg_stats` row widths, the planner's row count and the TOAST relation's chunk count (`wh_estimate_table_bloat`) | a catalog read | every table, every statistics pass; the shortlist |
| `approx` | `pgstattuple_approx`, on the heap and on the TOAST relation | reads the visibility map and scans only the pages that are not all-visible | confirming a shortlisted table before it is queued, and the re-measure after its rewrite |
| `exact` | `pgstattuple` | scans the whole table | never run by the library; the name exists so a measurement an operator takes can be recorded as one |

The estimate guesses. Rows added since the last `ANALYZE` are not in the planner's row count, so a growing table can
read as bloated when it is not. So while the [`pgstattuple` capability](./postgres-extensions) is `Ready` on every
database the registry probed, the maintenance cycle measures each table the estimate puts over the rewrite threshold
with `pgstattuple_approx` before it enters the queue:

- **At or over the threshold:** queued with the measured ratio and the method `approx`. The queue is taken largest
  measured ratio first.
- **Under the threshold:** not queued, and the log gives both figures, for example
  `Table wh_inbox was estimated at 4.2x but measures 1.3x by approx, under the rewrite threshold of 3x; it is not queued`.
  The next cycle measures it again if the estimate still shortlists it.
- **More than 25% from its estimate,** either way: logged with both figures, so an estimate that keeps reading stale
  statistics is visible.
- **The measurement fails** (the role may not call `pgstattuple_approx`, or the call times out): a warning names the
  table and the failure, and the estimate stands in, exactly as without pgstattuple.

After a rewrite, "did it shrink" is answered by `pgstattuple_approx` too, so a table queued by a measurement is judged
by the same measurement. Without pgstattuple, or while it is anything other than `Ready`, nothing is measured and every
step works from the estimate as it always has.

```mermaid{caption="The estimate shortlists and pgstattuple_approx confirms: a table enters the rewrite queue only when the measurement agrees it is over the threshold." tests=["MaintenanceWorkerBloatMeasurementTests.WhenReady_ACandidateIsMeasuredWithApprox_AndQueuedWithTheMeasuredRatioAsync", "MaintenanceWorkerBloatMeasurementTests.WhenReady_AFalsePositiveEstimate_IsNotQueued_AndTheLogGivesBothFiguresAsync", "MaintenanceWorkerBloatMeasurementTests.WithoutACapabilityRegistry_TheEstimateIsRecorded_AndNothingIsMeasuredAsync"]}
flowchart TD
  E[Estimate over the threshold] --> R{pgstattuple Ready?}
  R -->|no| Q1[Queued from the estimate<br/>method estimate]
  R -->|yes| A[pgstattuple_approx]
  A -->|at or over the threshold| Q2[Queued with the measured ratio<br/>method approx]
  A -->|under the threshold| N[Not queued;<br/>both figures logged]
  A -->|failed| Q1
```

The queue's measurements are in `wh_table_rewrite_measurements`, one row per queued table with its ratio, its method
and the estimate it confirmed. A queued table with no row was queued from the estimate, as every request made before
this table existed was. Clearing a request removes its row.

```sql{title="Read the queued rewrites with their measurements" category="Operations" difficulty="BEGINNER"}
SELECT r.table_name, r.requested, COALESCE(m.bloat_ratio, r.bloat_ratio) AS ratio,
       COALESCE(m.method, 'estimate') AS method, m.estimated_ratio
FROM wh_tables_needing_rewrite() r
LEFT JOIN wh_table_rewrite_measurements m ON r.requested AND m.table_name = r.table_name
ORDER BY ratio DESC;
```

The measured ratio is on the estimate's scale: the heap over the live rows times the expected width, with
`pgstattuple_approx` counting the live rows. It is not the heap over the live tuples' own bytes, because the bytes of a
dropped column stay inside every row written before the drop: that ratio would call such a table lean, and a rewrite
that removed them would not read as an improvement.

The [`whizbang.table.bloat_ratio`](../observability/metrics#table-statistics) gauge carries the method as its
`method` tag: every table's estimate is `estimate`, and a table the cycle measured is a second series, `approx`. Its
`part` tag says which relation a value is for: `heap` and `toast` for the two halves of the estimate, and `table` for
a measurement, which is the worse of the two. [`whizbang.table.reclaimable_bytes`](../observability/metrics#table-rewrites)
reports, per part, the bytes a rewrite would free now.

### The heap and the TOAST relation {#bloat-heap-and-toast}
{verified: ToastAwareBloatEstimateSqlTests.AMostlyDeadToast_UnderALeanHeap_IsACandidateAsync, ToastAwareBloatEstimateSqlTests.AHealthyToastedTable_IsNotACandidate_AndItsEstimateReadsLeanAsync, ToastAwareBloatEstimateSqlTests.AnUntoastedTableWithoutNulls_ReadsAsTheHeapOnlyEstimateDidAsync, ToastAwareBloatEstimateSqlTests.AMostlyNullWideColumn_DoesNotHideHeapBloatAsync, ToastAwareBloatEstimateSqlTests.AToastNeverVacuumed_IsNotMeasured_ForItsLiveChunksAreUnknownAsync, ToastAwareBloatEstimateSqlTests.ASmallDeadToast_IsMeasuredAgainstTheMinimumRows_SoItIsNotOfferedAsync, ToastAwareBloatEstimateSqlTests.Approx_MeasuresTheToastRelationToo_SoItConfirmsTheEstimateAsync, ToastAwareBloatEstimateSqlTests.TheFillFactorQueue_OrdersByTheSameEstimateAsync}

PostgreSQL stores a value too large for the row (a large JSON document, for example) out of line, in the table's TOAST
relation, cut into chunks. An update or delete leaves the old chunks dead there exactly as it leaves the old row dead
in the heap, and a rewrite copies both. So the estimate measures both, from catalog reads only, and nothing scans a
table:

| Part | Ratio | Read from |
|---|---|---|
| Heap | heap bytes / (`reltuples` x expected row bytes) | `pg_relation_size`, `pg_class.reltuples`, `pg_stats` |
| TOAST | TOAST bytes / (live chunks x `block_size / 4`) | `pg_relation_size` and `pg_class.reltuples` of the TOAST relation |

- **The expected row bytes weigh each column by how often it is present:** the sum of
  `avg_width x (1 - null_frac)` over the columns, plus 28 bytes of tuple header and item pointer
  (`wh_expected_row_bytes`). `pg_stats.avg_width` is a column's average over the rows where it is not NULL, so
  without the weighting a wide column present on a few rows counted its full width against every row, and a bloated
  heap read as dense. A table without NULLs reads exactly as it did before.
- **A packed chunk takes a quarter of a page.** PostgreSQL sizes a TOAST chunk (`TOAST_MAX_CHUNK_SIZE`, 1,996 bytes of
  data at the default 8 kB block) so that exactly four chunk rows fill a page (`TOAST_TUPLES_PER_PAGE = 4`). Densely
  packed live chunks therefore occupy `block_size / 4` each, and a healthy TOAST relation reads at or below 1 (a
  value's last chunk is partial, so it reads a little under). The constant follows the server's block size rather
  than assuming 8 kB.
- **A chunk count VACUUM never took is no measure.** The live chunk count is the TOAST relation's `reltuples`, which
  only VACUUM keeps: `ANALYZE` never visits a TOAST relation. While it reads `-1` the TOAST ratio is not computed and
  the heap alone decides, rather than guessing a count.
- **The chunk count is floored at the row floor.** A heap with fewer than `table_rewrite_min_rows` rows (default
  1,000) is not measured, because page overhead dominates the per-row average. The TOAST relation is measured against
  at least that many chunks, so a small TOAST relation of a few pages never reads alarmingly bloated.
- **The worse of the two, not a combined ratio.** A rewrite copies both relations, and either one holding mostly empty
  pages is space the rewrite returns. A combined ratio would let a large lean heap hide a small, mostly dead TOAST
  relation, which is the case the heap-only estimate missed.
- **pgstattuple measures the TOAST relation too.** While pgstattuple is `Ready`, `wh_measure_table_bloat_approx`
  runs `pgstattuple_approx` on the heap and on the TOAST relation and returns the worse ratio on the same scale. A
  heap-only measurement would turn away every table the TOAST ratio shortlisted.

One function, `wh_estimate_table_bloat`, gives this estimate to every reader: the candidate scan
(`wh_tables_needing_rewrite`), the order of the [lowered-fillfactor](#fillfactor-decrease) queue
(`wh_tables_owed_fillfactor_rewrite`), and the re-measure after a rewrite.

```sql{title="Read a table's estimate, part by part" category="Operations" difficulty="INTERMEDIATE" tests=["ToastAwareBloatEstimateSqlTests.AMostlyDeadToast_UnderALeanHeap_IsACandidateAsync"]}
SELECT c.relname,
       wh_estimate_table_bloat(c.relname) AS bloat_ratio,
       pg_relation_size(c.oid) AS heap_bytes, c.reltuples AS live_rows,
       pg_relation_size(t.oid) AS toast_bytes, t.reltuples AS live_chunks
FROM pg_class c LEFT JOIN pg_class t ON t.oid = c.reltoastrelid
WHERE c.relname = 'wh_event_body';
```

What the catalog cannot show stays out of the estimate: alignment padding between columns and the page-level overhead
of headers and the fillfactor reserve are not in `pg_stats`. That is why a freshly rewritten table can read 1.5x to
2x and stay there, and why the [post-rewrite floor](#post-rewrite-floor) exists. `pgstattuple_approx` remains the
authority for those while it is `Ready`.

### Why it works this way {#bloat-measurement-decisions}

Each rule below is held by the tests named under it, which fail if the behavior is reversed.

#### Measurements live beside the queue, and a missing one reads as the estimate {#bloat-queue-measurements}
{verified: TableBloatMeasurementSqlTests.AMeasuredRequest_IsQueuedWithItsRatioAndMethod_AndTheQueueOrdersByTheMeasuredRatioAsync, TableBloatMeasurementSqlTests.AQueueRowWithoutAMethod_IsTheEstimate_AndAnUnknownMethodIsRefusedAsync}

The queue itself is the `pending_table_rewrites` list in `wh_settings`, which migrations append to through
`wh_request_table_rewrite`. Turning it into a table would change a contract every shipped migration relies on, so the
measurement is a row beside it in `wh_table_rewrite_measurements`, keyed by table. Every request recorded before the
method existed was queued from the estimate, so a queued table without a row, and a row written without a method, read
as `estimate`. Only the three stable names may be stored, because readers map the name back to the method.

#### The measured ratio is on the estimate's scale {#bloat-measured-ratio-scale}
{verified: TableBloatMeasurementSqlTests.Approx_OnATableCarryingDroppedColumnBytes_ReadsBloated_AndItsRewriteReadsAsAnImprovementAsync, TableBloatMeasurementSqlTests.Approx_OnAStaleEstimate_MeasuresTheTableLeanAsync}

The measured ratio is the heap's size over the live rows `pgstattuple_approx` counts, times the expected row width from
`pg_stats`. It is not the heap over the live tuples' own bytes: a dropped column's bytes stay inside every row written
before the drop, so that ratio would count them as live and call a table carrying them lean, and the rewrite that
removes them would not read as an improvement, leaving its request queued forever.

#### Disagreement is logged past a quarter of the estimate {#bloat-disagreement-tolerance}
{verified: MaintenanceWorkerBloatMeasurementTests.TheDisagreementTolerance_IsAQuarterOfTheEstimate_EitherWayAsync, MaintenanceWorkerBloatMeasurementTests.WhenReady_AMeasurementThatDisagreesWithItsEstimate_IsLoggedWithBothFiguresAsync}

A measurement more than 25% above or below its estimate is logged with both figures; exactly 25% is not. Closer than
that is the ordinary difference between a sampled row width and a counted row; further apart means the estimate was
reading stale statistics, which an operator should see.

#### A failed measurement queues from the estimate {#bloat-measurement-failure}
{verified: MaintenanceWorkerBloatMeasurementTests.WhenReady_AMeasurementThatFails_FallsBackToTheEstimate_AndSaysWhyAsync, TableBloatMeasurementSqlTests.Approx_WithoutTheExtension_FailsRatherThanAnsweringAsync}

When `pgstattuple_approx` fails (a role without the right to call it, a timeout, an extension dropped since the probe),
a warning names the table and the failure, and the table is queued from its estimate. That is exactly where the cycle
would be without pgstattuple, so the failure costs the confirmation and nothing else. The database function raises
rather than answering nothing when the extension is missing, so the failure is reported, never mistaken for a lean
table.

#### Ready means Ready on every probed database {#bloat-pgstattuple-ready}
{verified: MaintenanceWorkerBloatMeasurementTests.WhenPgstattupleIsReadyOnOneDatabaseButNotAnother_NothingIsMeasuredAsync, MaintenanceWorkerBloatMeasurementTests.WhilePgstattupleIsNotReady_TheEstimateIsRecorded_AndNothingIsMeasuredAsync, MaintenanceWorkerBloatMeasurementTests.WithoutACapabilityRegistry_TheEstimateIsRecorded_AndNothingIsMeasuredAsync}

The maintenance cycle does not know which probed database its work coordinator reads, so it measures only when
pgstattuple is `Ready` on every database the registry probed, the same rule the online rewrite uses for its tools. One
database without it, no registry, or a state the probe could not decide, and the cycle works from the estimate.

#### A rejected estimate is measured again {#bloat-rejected-remeasured}
{verified: MaintenanceWorkerBloatMeasurementTests.ARejectedFalsePositive_IsMeasuredAgainOnTheNextCycle_AndStillNotQueuedAsync, MaintenanceWorkerBloatMeasurementTests.WhenReady_AFalsePositiveEstimate_IsNotQueued_AndTheLogGivesBothFiguresAsync}

A rejection is not remembered. While the estimate still shortlists the table, each cycle measures it again, so a table
that does bloat later is queued on the next cycle that sees it. The cost is one `pgstattuple_approx` per cycle for such a
table, and it ends once `ANALYZE` brings the estimate back under the threshold.

#### Tables a migration requested are not measured {#bloat-requested-tables}
{verified: MaintenanceWorkerBloatMeasurementTests.WhenReady_ATableAlreadyQueued_IsNotMeasuredAgainAsync, TableBloatMeasurementSqlTests.AMeasuredRequest_IsQueuedWithItsRatioAndMethod_AndTheQueueOrdersByTheMeasuredRatioAsync}

A table already in the queue, including one a migration requested (for example after dropping a column), is not
measured again before its rewrite and keeps the method it was queued with, `estimate` for a migration's request. The
request is the decision; the rewrite's own re-measure is what judges it.

#### The exact scan never runs {#bloat-exact-never-runs}
{verified: TableBloatMeasurementSqlTests.Exact_IsNeverRunAsync, MaintenanceWorkerBloatMeasurementTests.WhenReady_ACandidateIsMeasuredWithApprox_AndQueuedWithTheMeasuredRatioAsync}

`pgstattuple` reads every page of the table, which on a large table is the cost the estimate exists to avoid. The
library asks only for `approx`, and the coordinator refuses `exact` with `NotSupportedException`. The `exact` name
exists so a measurement an operator takes by hand can be recorded as what it is.

## Rewrite thresholds {#rewrite-thresholds}
{verified: TableRewriteSettingsTests.TheThreshold_DefaultsByHowTheStartRewritesAsync, TableRewriteSettingsTests.EveryStart_PublishesAllThreeKeysAsync, TableRewriteSettingsTests.AConfiguredValue_WinsOverEveryDefaultAsync, TableRewriteSettingsTests.TheOptions_BindFromTheMaintenanceSectionAsync, TableRewriteSettingsTests.Validate_RejectsEachValueOutsideItsRangeByNameAsync, TableRewriteSettingsTests.TheValidator_RejectsTheTableRewriteSettingsByNameAsync, TableRewriteStartupStepTests.EveryStart_PublishesTheEffectiveSettings_BeforeReadingTheCandidatesAsync, TableRewriteStartupStepTests.AFailedPublish_IsLoggedWithTheSettings_AndTheStepGoesOnAsync, RewriteRegrowthFloorSqlTests.EveryStart_PutsBackAHandEditedSetting_WithTheEffectiveValueAsync}

The candidate scan runs in SQL, so it reads its three settings from `wh_settings`. Each comes from an option under
`Whizbang:Workers:Maintenance`:

| Option | Default | Valid values | `wh_settings` key | What it decides |
|---|---|---|---|---|
| `TableRewriteBloatThreshold` | unset: `2.0` when the start rewrites with an online tool, `3.0` otherwise | finite, greater than 1 | `table_rewrite_bloat_threshold` | the ratio at or above which a table is offered for a rewrite |
| `TableRewriteMinRows` | unset: `1000` | 0 or greater | `table_rewrite_min_rows` | the fewest rows a table must hold to be measured, and the fewest chunks its TOAST relation is measured against |
| `TableRewriteRegrowthFactor` | unset: `1.5` | finite, greater than 1 | `table_rewrite_regrowth_factor` | how far past its [post-rewrite floor](#post-rewrite-floor) a table must regrow to be offered again |

- **The threshold's default follows how the start rewrites.** With an online tool (`PgSqueeze`, `PgRepack`, `Online`,
  or `Auto` resolved to pg_squeeze or pg_repack on that start) a rewrite takes no long lock, so it is worth running at
  2.0. With a blocking `VACUUM FULL`, or detection only, the line stays at 3.0. A line as low as 2.0 is safe online
  because the [post-rewrite floor](#post-rewrite-floor) stops a table being rewritten again while it reads no worse
  than its last rewrite left it.
- **Written on every start, before the candidates are read.** The boot-time `Rewrite` step writes the effective value
  of all three, set or not, so configuration is the source of truth. A value edited by hand in `wh_settings` is put
  back on the next start. This differs from the [retention windows](../configuration/configuration-reference#database-side-settings),
  which are written only when set.
- **A failed write never fails the start.** It is logged as a warning naming the values it was writing, and the
  values already stored stand until the next start:
  `Rewrite step: the table-rewrite settings (table_rewrite_bloat_threshold=2, table_rewrite_min_rows=1000, table_rewrite_regrowth_factor=1.5) could not be written to wh_settings; the values already stored stand until the next start`.
- **An out-of-range value stops the host at startup,** naming the key. A threshold of 1 or less would rewrite every
  table, since a lean table reads about 1; a regrowth factor of 1 or less would offer a table its last rewrite left
  lean again at once.

:::updated
Earlier releases read the threshold and the row floor as migration 089 seeded them (a threshold of 3.0 for every
strategy) and never wrote them, so changing one took an `UPDATE` in every service database. From this release all
three settings are written on every start: **a value edited by hand in `wh_settings` is overwritten.** Move it to configuration before upgrading. On a
host that rewrites online, the threshold also drops from 3.0 to 2.0 unless `TableRewriteBloatThreshold` is set.
:::

```json{title="Rewrite thresholds set from configuration" description="Offers a table for rewrite at 2.5x, measures tables of 5,000 rows or more, and requires a rewritten table to regrow to twice its post-rewrite ratio." category="Configuration" difficulty="INTERMEDIATE" tags=["storage", "table-rewrite", "bloat", "maintenance", "configuration", "wh_settings"] tests=["TableRewriteSettingsTests.TheOptions_BindFromTheMaintenanceSectionAsync", "TableRewriteSettingsTests.AConfiguredValue_WinsOverEveryDefaultAsync"]}
{
  "Whizbang": {
    "Workers": {
      "Maintenance": {
        "TableRewriteBloatThreshold": 2.5,
        "TableRewriteMinRows": 5000,
        "TableRewriteRegrowthFactor": 2.0
      }
    }
  }
}
```

The same as environment variables:

```bash{title="Rewrite thresholds as environment variables" category="Configuration" difficulty="BEGINNER" tags=["storage", "table-rewrite", "configuration"] tests=["TableRewriteSettingsTests.TheOptions_BindFromTheMaintenanceSectionAsync"]}
Whizbang__Workers__Maintenance__TableRewriteBloatThreshold=2.5
Whizbang__Workers__Maintenance__TableRewriteMinRows=5000
Whizbang__Workers__Maintenance__TableRewriteRegrowthFactor=2.0
```

## Post-rewrite floor {#post-rewrite-floor}
{verified: RewriteRegrowthFloorSqlTests.ARewrittenTable_BelowItsRegrowthFloor_IsHeldBackAsync, RewriteRegrowthFloorSqlTests.ARewrittenTable_ThatRegrewPastItsFloor_IsOfferedAsync, RewriteRegrowthFloorSqlTests.OnlyTheLatestRewrite_SetsTheFloorAsync, RewriteRegrowthFloorSqlTests.TheFactor_IsReadFromItsSettingAsync, RewriteRegrowthFloorSqlTests.ATableWithoutHistory_IsOfferedAtTheThresholdAsync, RewriteRegrowthFloorSqlTests.AFillFactorDecrease_IsNotHeldBackByTheFloorAsync, RewriteRegrowthFloorSqlTests.TheQueueStatus_CountsTheQueue_AndTheTablesTheFloorHeldBackAsync}

The estimate cannot see page headers, alignment padding or the fillfactor reserve, so a table rewritten a moment ago
can read 1.5x to 2x and stay there. With the threshold at 2.0, such a table would be offered again on every cycle and
rewritten for nothing. So a table's latest rewrite sets a floor under it: a table whose last recorded rewrite left it
at a ratio F (`bloat_after` in the [rewrite history](#rewrite-history)) is offered only once it reads at least

```text
GREATEST(table_rewrite_bloat_threshold, F x table_rewrite_regrowth_factor)
```

A rewrite that left a table at 1.8 sets a floor of 2.7 at the default factor of 1.5: at 2.1 the table is over the
threshold but held back, and at 2.8 it is offered again. The churn on a table whose healthy reading sits above the
threshold stops, and a table that really regrows is still caught.

- **The latest rewrite sets it.** Only the newest history row with a `bloat_after` counts, so a rewrite that did
  better lowers the floor. A table with no history, or whose history aged past the history's 90-day bound, is offered
  at the threshold, as before.
- **The ratios compare.** `bloat_after` is on the estimate's scale whichever method took it, since a
  `pgstattuple_approx` measurement is kept on that scale ([the measured ratio](#bloat-measured-ratio-scale)).
- **A lowered fillfactor is not held back.** A table owed a rewrite for a [lowered fillfactor](#fillfactor-decrease)
  is rewritten once whatever its bloat, floor or not.
- **Held-back tables are counted, not hidden.** `wh_table_rewrite_queue_status()` returns the queue's length, the
  threshold and how many tables at or above the threshold the floor held back. The [online rewrite](#online-rewrite)
  puts that count in its cycle line, and the [`whizbang.table.rewrite.queue`](../observability/metrics#table-rewrites)
  gauge reports it as `state="held_by_floor"`. Each table's floor ratio is on
  [`whizbang.table.rewrite.floor`](../observability/metrics#table-rewrites).
- **The factor is a setting.** `TableRewriteRegrowthFactor` (default 1.5) sets it; see
  [Rewrite thresholds](#rewrite-thresholds).

```sql{title="Read the rewrite queue and the tables the floor holds back" category="Operations" difficulty="BEGINNER" tests=["RewriteRegrowthFloorSqlTests.TheQueueStatus_CountsTheQueue_AndTheTablesTheFloorHeldBackAsync"]}
SELECT requested, threshold, held_back FROM wh_table_rewrite_queue_status();
SELECT DISTINCT ON (table_name) table_name, bloat_after
FROM wh_table_rewrite_history WHERE bloat_after IS NOT NULL
ORDER BY table_name, id DESC;
```

### From estimate to rewrite {#rewrite-candidate-decision}

Put together, a table goes from its estimate to a rewrite like this:

```mermaid{caption="How a table becomes a rewrite: the worse of its heap and TOAST ratios is checked against the threshold and its post-rewrite floor, then the cycle's byte budget, and under Auto the first online tool that is Ready rewrites it." tests=["ToastAwareBloatEstimateSqlTests.AMostlyDeadToast_UnderALeanHeap_IsACandidateAsync", "ToastAwareBloatEstimateSqlTests.AToastNeverVacuumed_IsNotMeasured_ForItsLiveChunksAreUnknownAsync", "RewriteRegrowthFloorSqlTests.ARewrittenTable_BelowItsRegrowthFloor_IsHeldBackAsync", "RewriteRegrowthFloorSqlTests.ARewrittenTable_ThatRegrewPastItsFloor_IsOfferedAsync", "OnlineTableRewriteStepTests.Budget_SkipsATableThatWouldOverrunIt_AndTakesASmallerOneThatFitsAsync", "OnlineTableRewriteStepTests.Auto_WithPgSqueezeReady_RewritesThroughItAsync", "OnlineTableRewriteStepTests.Auto_WithOnlyPgRepackReadyInProcess_RepacksAsync", "OnlineTableRewriteStepTests.Auto_WithNoOnlineToolThatCanRun_DoesNothing_AndNeverRebuildsAsync"]}
flowchart TD
  T["wh_ table with at least<br/>table_rewrite_min_rows rows"] --> H["Heap ratio<br/>bytes / rows x null-weighted width"]
  T --> K{"TOAST chunk count<br/>taken by VACUUM?"}
  K -->|yes| X["TOAST ratio<br/>bytes / chunks x quarter page"]
  K -->|"no (-1)"| O["Heap alone decides"]
  H --> W["Worse of the two"]
  X --> W
  O --> W
  W --> L{"At or above<br/>table_rewrite_bloat_threshold?"}
  L -->|no| N["Not offered"]
  L -->|yes| F{"At or above the<br/>post-rewrite floor?"}
  F -->|no| HB["Held back;<br/>counted in the cycle line"]
  F -->|yes| C["Candidate,<br/>largest ratio first"]
  C --> B{"Heap plus TOAST fits<br/>the bytes left of the budget?"}
  B -->|no| D["Deferred to a later cycle"]
  B -->|yes| A{"Under Auto,<br/>which tool is Ready?"}
  A -->|pg_squeeze| SQ["Rewritten by pg_squeeze"]
  A -->|"else pg_repack in process"| RP["Rewritten by pg_repack"]
  A -->|neither| VF["No online rewrite:<br/>VACUUM FULL at boot if<br/>AllowTableRewrite, else reported"]

  style SQ fill:#d4edda,stroke:#28a745,stroke-width:2px
  style RP fill:#d4edda,stroke:#28a745,stroke-width:2px
  style HB fill:#fff3cd,stroke:#ffc107,stroke-width:2px
  style D fill:#fff3cd,stroke:#ffc107,stroke-width:2px
  style VF fill:#f8d7da,stroke:#dc3545,stroke-width:2px
```

Under `Auto` the tool is chosen once per maintenance cycle, before the queue is read: with neither tool Ready the cycle
does nothing, and the boot-time `Rewrite` step keeps its `VACUUM FULL` or report-only behavior. The explicit
strategies replace the last step with their own tool, as [Table rewrite strategy](#table-rewrite-strategy) describes.

## Table rewrite strategy {#table-rewrite-strategy}
{verified: TableRewriteStrategyTests.Resolve_EachCellOfTheMatrixAsync, TableRewriteStrategyTests.TheSetting_DefaultsToAuto_AndBindsFromConfigurationAsync, TableRewriteStartupStepTests.PgSqueeze_IsLeftToTheMaintenanceCycle_NotRunAtBootAsync, TableRewriteStartupStepTests.PgRepackInProcess_IsLeftToTheMaintenanceCycle_NotRunAtBootAsync, TableRewriteStrategyTests.Auto_WithAnOnlineToolThatCanRun_ResolvesToItAsync, TableRewriteStrategyTests.Auto_WithPgSqueezeUsableButNotRunnable_SaysWhatItNeeds_AndDoesNotPickItAsync, TableRewriteStartupStepTests.Auto_WithPgSqueezeReady_LeavesTheTablesToTheCycle_AndTakesNoneWithVacuumFullAsync, TableRewriteStartupStepTests.Auto_WithOnlyPgRepackReadyInProcess_LeavesTheTablesToTheCycleAsync, TableRewriteStartupStepTests.Auto_WithNoOnlineTool_KeepsVacuumFull_AndDoesNotThrowAsync}

`Whizbang:Workers:Maintenance:TableRewriteStrategy` (default `Auto`) chooses how the post-ready `Rewrite` step
reclaims the space of the tables the maintenance cycle recorded, together with `AllowTableRewrite` (default `false`),
the operator's permission for a blocking rewrite at boot:

| Strategy | What the server offers | `AllowTableRewrite = true` | `AllowTableRewrite = false` |
|---|---|---|---|
| `Auto` | pg_squeeze Ready | [online rewrite](#online-rewrite) through pg_squeeze from the maintenance cycle | [online rewrite](#online-rewrite) through pg_squeeze from the maintenance cycle |
| `Auto` | pg_squeeze not Ready; pg_repack and its client Ready, `Mode = InProcess` | [online rewrite](#online-rewrite) through [pg_repack](#pg-repack) from the maintenance cycle | [online rewrite](#online-rewrite) through [pg_repack](#pg-repack) from the maintenance cycle |
| `Auto` | neither | `VACUUM FULL` at boot | detect and report only |
| `PgSqueeze` | pg_squeeze usable | [online rewrite](#online-rewrite) from the maintenance cycle | [online rewrite](#online-rewrite) from the maintenance cycle |
| `PgSqueeze` | pg_squeeze not usable | start fails with the capability verdict (it warns when the probe cannot tell) | start fails with the capability verdict (it warns when the probe cannot tell) |
| `PgRepack`, `InProcess` | either | [online rewrite](#online-rewrite) through [pg_repack](#pg-repack) from the maintenance cycle | [online rewrite](#online-rewrite) through [pg_repack](#pg-repack) from the maintenance cycle |
| `PgRepack`, `External` | either | nothing is started; [your job runs pg_repack](#pg-repack) | nothing is started; [your job runs pg_repack](#pg-repack) |
| `Online` | either | from the maintenance cycle: pg_squeeze, else pg_repack in process, else a [blue-green rebuild](#blue-green-rewrite) of a perspective table | the same: `AllowTableRewrite` gates only `VACUUM FULL` |
| `VacuumFull` | either | `VACUUM FULL` at boot | detect and report only |
| `None` | either | nothing is rewritten | nothing is rewritten |

```mermaid{caption="How the Rewrite step resolves the table rewrite strategy against AllowTableRewrite; Auto takes an online tool when one is Ready, and every online rewrite Whizbang runs comes from the maintenance cycle." tests=["TableRewriteStrategyTests.Resolve_EachCellOfTheMatrixAsync","TableRewriteStrategyTests.Auto_WithAnOnlineToolThatCanRun_ResolvesToItAsync","TableRewriteStartupStepTests.Auto_WithNoOnlineTool_KeepsVacuumFull_AndDoesNotThrowAsync","PgRepackTests.Resolve_PgRepack_IsTheExplicitChoice_WhateverElseHoldsAsync","TableRewriteStrategyTests.ExplicitPgSqueeze_OnAServerThatDoesNotAllowlistIt_FailsStartWithTheFixAsync","TableRewriteStartupStepTests.PgSqueeze_IsLeftToTheMaintenanceCycle_NotRunAtBootAsync","TableRewriteStartupStepTests.PgRepackInProcess_IsLeftToTheMaintenanceCycle_NotRunAtBootAsync","PgRepackTests.External_TheRewriteStepSkips_AndStartsNothingAsync"]}
flowchart TD
  S{TableRewriteStrategy} -->|None| N[Nothing rewritten]
  S -->|PgRepack| M{PgRepack Mode}
  M -->|InProcess| O
  M -->|External| J[Your job runs pg_repack;<br/>tables stay queued for it]
  S -->|PgSqueeze| Q{pg_squeeze usable?}
  Q -->|no| F[Capability verdict<br/>stops start]
  Q -->|yes| O[Online rewrite from the<br/>maintenance cycle]
  S -->|Auto| T{pg_squeeze Ready, else<br/>pg_repack in process Ready?}
  T -->|one is| O
  T -->|neither| A
  S -->|VacuumFull| A{AllowTableRewrite?}
  A -->|true| V[VACUUM FULL at boot]
  A -->|false| R[Detect and report only]
```

- **`Auto` rewrites online where the server allows it.** Each maintenance cycle it takes pg_squeeze when it is
  `Ready` on every database the registry probed, else pg_repack run in process when the `pg_repack` extension and the
  `program/pg_repack` client are `Ready` and `TableRewrite:PgRepack:Mode` is `InProcess`, and rewrites through the
  [online rewrite](#online-rewrite) within `OnlineRewriteMaxBytesPerCycle`. The boot-time `Rewrite` step then reports,
  for example, `Auto: online rewrite through pg_squeeze, which is Ready here`, and takes no table with `VACUUM FULL`
  on that start. With neither tool Ready, `Auto` keeps the behavior earlier releases had: `VACUUM FULL` at boot when
  `AllowTableRewrite = true`, otherwise detect and report.
- **`Auto` requires nothing and never fails start.** It declares no capability requirement, so a server without
  either extension starts as before. Under `Auto` with the default `InProcess` mode the pg_repack client is still
  probed (`pg_repack --version`) at start, so the cycle knows whether it can run, but a missing client only means
  pg_repack is not chosen. In `External` mode it is not probed.
  {verified: OnlineTableRewriteStepTests.Auto_InProcess_ProbesTheClient_ButDoesNotRequireItAsync, OnlineTableRewriteStepTests.Auto_External_DoesNotProbeTheClientAsync}
- **`Auto` never starts a blue-green rebuild.** Rebuilding a perspective table from its events is opted into with
  `Online`; under `Auto` with neither tool Ready, the cycle rewrites nothing.
  {verified: OnlineTableRewriteStepTests.Auto_WithNoOnlineToolThatCanRun_DoesNothing_AndNeverRebuildsAsync, TableRewriteStrategyTests.Auto_NeverResolvesToAnOnlineRewrite_ABlueGreenRebuildIncludedAsync}
- **No per-table fallback within a cycle.** Under `Auto` and `Online` the tool is chosen for the cycle, not for each
  table. When pg_squeeze is chosen but refuses one table (no primary key or replica identity, no logical WAL, no free
  replication slot), the [prerequisite check](#online-rewrite-prerequisites) logs why and that table stays queued; it
  is not handed to pg_repack in the same cycle, and the attempt is counted `outcome="failed"` on
  [`whizbang.table.rewrites`](../observability/metrics#table-rewrites). Fix the prerequisite, or choose
  `TableRewriteStrategy = PgRepack` for a server where pg_squeeze cannot take such tables.
- **`PgSqueeze` requires the extension.** It is the first setting in the library that
  [declares a capability requirement](./capabilities#declaring-a-requirement): set explicitly on a server where
  pg_squeeze is not usable, the [capability verdict](./capabilities#validation) stops the host with the fix, for
  example the allowlist and `shared_preload_libraries` change it needs. Where the extension is available, it is
  [provisioned](./capabilities#provisioning) first. It never falls back to `VACUUM FULL`, and `AllowTableRewrite` does
  not gate it: choosing it is the opt-in.
- **No online rewrite runs at boot.** For `PgSqueeze` the `Rewrite` step reports
  `PgSqueeze: online rewrite through pg_squeeze; the maintenance cycle performs it, largest bloat first, up to Whizbang:Workers:Maintenance:OnlineRewriteMaxBytesPerCycle bytes per cycle`,
  and for `PgRepack` in process the same with `PgRepack: online rewrite through pg_repack`. It leaves the queue to
  the [online rewrite](#online-rewrite), so a rewrite after a long gap is spread over cycles rather than done all at
  once.
- **`None`** rewrites nothing; the maintenance cycle still records the tables that need it and reports the bloat.

```json{title="Opt in to online table rewrites" description="Selects pg_squeeze for table rewrites; start fails with the fix when the server does not allow the extension." category="Configuration" difficulty="INTERMEDIATE" tags=["storage", "table-rewrite", "pg_squeeze", "maintenance", "configuration"] tests=["TableRewriteStrategyTests.TheSetting_DefaultsToAuto_AndBindsFromConfigurationAsync", "TableRewriteStrategyTests.ExplicitPgSqueeze_OnAServerThatDoesNotAllowlistIt_FailsStartWithTheFixAsync"]}
{
  "Whizbang": {
    "Workers": {
      "Maintenance": {
        "TableRewriteStrategy": "PgSqueeze"
      }
    }
  }
}
```

On a server that does not allowlist pg_squeeze, start then stops with:

```text
capability postgres/pg_squeeze on 'orders': NotPermitted; NotAllowlisted. Fix: add PG_SQUEEZE to the server's extension allowlist (azure.extensions on Azure Database for PostgreSQL) and pg_squeeze to shared_preload_libraries, then restart the server. Required by: Online table rewrite (Whizbang:Workers:Maintenance:TableRewriteStrategy = PgSqueeze, explicit)
```

## pg_repack {#pg-repack}
{verified: PgRepackTests.InProcess_WithNoClient_FailsAnExplicitRequirementAsync, PgRepackTests.InProcess_WithNoClient_DegradesAnImplicitRequirement_AndTheRewriterHoldsBackAsync, PgRepackTests.External_NeverStartsAProcess_NotToProbe_NotToRewriteAsync, PgRepackTests.InProcess_Rewrite_PassesTheConnectionThroughTheEnvironmentOnlyAsync}

`TableRewriteStrategy = PgRepack` rewrites requested tables online with [pg_repack](https://reorg.github.io/pg_repack/),
which holds an ACCESS EXCLUSIVE lock only briefly at the start and the end of each table. It needs two things: the
`pg_repack` extension on the server (the capability `postgres/pg_repack`, provisioned like any other
[capability](./capabilities#provisioning)), and its client program, which does the work from outside the server. Prefer
it over pg_squeeze where the server cannot preload pg_squeeze or use logical decoding; prefer pg_squeeze where nothing
outside the server may run.

`Whizbang:Workers:Maintenance:TableRewrite:PgRepack:Mode` decides who runs the client:

| Mode | Who runs the client | The client program | Whizbang starts a process |
|---|---|---|---|
| `InProcess` (default) | the instance holding the maintainer duty, in the maintenance cycle's [online rewrite](#online-rewrite), once per requested table that fits the cycle's byte budget | a probed prerequisite, `program/pg_repack`, found on `PATH` or at `ClientPath` | yes: `pg_repack --version` at startup, and one run per table |
| `External` | a job you run (a container or a scheduled task) against the tables `wh_tables_needing_rewrite()` lists | not needed on the Whizbang host | never |

```mermaid{caption="Who runs pg_repack in each mode; in External mode Whizbang starts no process, and in process the maintenance cycle runs it within the byte budget." tests=["PgRepackTests.External_NeverStartsAProcess_NotToProbe_NotToRewriteAsync","PgRepackTests.InProcess_WithNoClient_FailsAnExplicitRequirementAsync","PgRepackTests.InProcess_WithNoClient_DegradesAnImplicitRequirement_AndTheRewriterHoldsBackAsync","OnlineTableRewriteStepTests.PgRepack_RewritesTheLargestBloatRatioFirst_WithinTheBudgetAsync","OnlineTableRewriteStepTests.PgRepack_External_DoesNothing_NotEvenScan_AndStartsNothingAsync"]}
flowchart TD
  M{PgRepack Mode} -->|External| E[Rewrite step skips<br/>tables stay queued<br/>your job runs pg_repack]
  M -->|InProcess| P{pg_repack --version<br/>at startup}
  P -->|answers| R[Ready: the maintenance cycle runs<br/>pg_repack per queued table,<br/>largest bloat first, within the budget]
  P -->|missing, Mode set explicitly| F[Capability verdict<br/>stops start]
  P -->|missing, Mode left at default| D[Warning; tables stay queued]
```

- **In process, the client is a prerequisite.** At startup Whizbang runs `pg_repack --version`. When the client is
  missing and `Mode` was set to `InProcess` explicitly, the [capability verdict](./capabilities#validation) stops the
  host with the fix; when `Mode` was left at its default, the verdict warns, the maintenance cycle logs that the client
  is not Ready and rewrites nothing, and the tables stay queued. Install the client at the same version as the extension: pg_repack refuses to run against a different
  one.
- **In process, the maintenance cycle runs it.** The boot-time `Rewrite` step does not: the cycle's
  [online rewrite](#online-rewrite) takes the queued tables largest bloat first within
  `OnlineRewriteMaxBytesPerCycle`, the same budget as pg_squeeze, and only when both the `pg_repack` extension and the
  `program/pg_repack` client are Ready.
- **External mode never starts a process,** not even to read the client's version. The `Rewrite` step reports
  `pg_repack runs as an external job (...Mode = External): Whizbang does not start it, and requested tables stay
  queued for that job` and the maintenance cycle keeps recording which tables need it.
- **Credentials never appear on the command line.** Process arguments are visible to every user on the host (`ps`,
  `/proc/<pid>/cmdline`), so the client is started with only its options and the table
  (`--no-superuser-check --no-kill-backend --table=<schema>.<table>`). The connection reaches it as the libpq
  environment variables `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` and, when set, the TLS and password
  file variables, which only the client's own user and an administrator can read, and which are never written to
  disk. The connection is the [schema-initialization connection](./migrations#database-roles) when one is configured,
  because pg_repack must run as the table's owner; without one, a table the application role does not own is reported
  and not attempted. A context configured with a data source has no password to hand over: libpq then reads the host's
  password file (`PGPASSFILE`, `~/.pgpass`) or service file.
- **`--no-superuser-check`** lets the table's owner repack it, which managed servers require, and
  **`--no-kill-backend`** makes pg_repack give up on a table it cannot lock in time rather than end the application's
  own sessions. A run that fails is logged with its exit code and error, and the table stays queued for the next
  cycle.
- **The request is cleared only after the re-measure improves,** as for every strategy: after the client exits,
  Whizbang analyzes the table and measures it again.

```json{title="Rewrite tables online with pg_repack, run in process" description="Selects pg_repack and requires its client on the host; start fails with the fix when it is missing." category="Configuration" difficulty="INTERMEDIATE" tags=["storage", "table-rewrite", "pg_repack", "maintenance", "configuration"] tests=["PgRepackTests.Options_BindFromConfigurationThroughAddWhizbangWorkersAsync", "PgRepackTests.InProcess_WithNoClient_FailsAnExplicitRequirementAsync"]}
{
  "Whizbang": {
    "Workers": {
      "Maintenance": {
        "TableRewriteStrategy": "PgRepack",
        "TableRewrite": {
          "PgRepack": {
            "Mode": "InProcess",
            "ClientPath": "/usr/lib/postgresql/16/bin/pg_repack"
          }
        }
      }
    }
  }
}
```

On a host without the client, start then stops with:

```text
capability program/pg_repack on '/usr/lib/postgresql/16/bin/pg_repack': Missing: An error occurred trying to start process '/usr/lib/postgresql/16/bin/pg_repack' with working directory '/app'. No such file or directory. Fix: install the pg_repack client program, the same version as the pg_repack extension, on this host's PATH or set Whizbang:Workers:Maintenance:TableRewrite:PgRepack:ClientPath to it; or set Whizbang:Workers:Maintenance:TableRewrite:PgRepack:Mode = External and run it as a job. Required by: Online table rewrite, in process (pg_repack client) (Whizbang:Workers:Maintenance:TableRewrite:PgRepack:Mode = InProcess, explicit)
```

In `External` mode, a job lists the queue and runs the client the same way, with the connection in its environment:

```bash{title="An external pg_repack job" description="Runs pg_repack against each table Whizbang has queued, with the connection in the environment." category="Operations" difficulty="ADVANCED" tags=["pg_repack", "table-rewrite", "external-job", "maintenance"] tests=["PgRepackTests.External_NeverStartsAProcess_NotToProbe_NotToRewriteAsync"]}
export PGHOST=db.internal PGDATABASE=orders PGUSER=orders_owner PGPASSFILE=/run/secrets/pgpass
for table in $(psql -Atc "SELECT table_name FROM wh_tables_needing_rewrite()"); do
  pg_repack --no-superuser-check --no-kill-backend --table="public.$table"
done
```

Candidates are re-measured whenever the queue is read, so a request whose table is lean again is no longer offered.

## Online rewrite from the maintenance cycle {#online-rewrite}
{verified: OnlineTableRewriteStepTests.Rewrites_TheLargestBloatRatioFirstAsync, OnlineTableRewriteStepTests.Budget_SkipsATableThatWouldOverrunIt_AndTakesASmallerOneThatFitsAsync, OnlineTableRewriteStepTests.NotImproved_LeavesTheRequestQueuedAsync, OnlineTableRewriteStepTests.PgSqueezeNotReadyOnEveryDatabase_RewritesNothing_AndSaysWhereAsync, OnlineTableRewriteStepTests.PgRepack_RewritesTheLargestBloatRatioFirst_WithinTheBudgetAsync, OnlineTableRewriteStepTests.PgRepack_ClearsOnlyWhatImprovedAsync, OnlineTableRewriteStepTests.PgRepack_ClientNotReady_RewritesNothing_AndSaysWhyAsync, OnlineTableRewriteStepTests.NothingQueued_RewritesNothing_AndSaysSoOnce_WithTheQueueAndTheThresholdAsync, OnlineTableRewriteStepTests.Summary_SaysHowManyThePostRewriteFloorHeldBackAsync, OnlineTableRewriteStepTests.Auto_WithPgSqueezeReady_RewritesThroughItAsync, OnlineTableRewriteStepTests.Auto_WithOnlyPgRepackReadyInProcess_RepacksAsync}

With `TableRewriteStrategy = PgSqueeze`, or `PgRepack` with its client [in process](#pg-repack), the maintenance cycle
rewrites queued tables online. `Auto` does the same with whichever of the two is `Ready`, pg_squeeze first, and
otherwise leaves the cycle idle (see [Table rewrite strategy](#table-rewrite-strategy)). `Online` does the same with whichever of the two is `Ready`, pg_squeeze first, and
falls back to a [blue-green rebuild](#blue-green-rewrite) of a perspective table when neither is. pg_squeeze (`squeeze.squeeze_table`) copies the table while it stays readable and
writable and holds an exclusive lock only for the final swap; pg_repack does the same from its client program, holding
an ACCESS EXCLUSIVE lock only briefly at the start and the end. Both are bounded by the same budget. It runs as a [maintenance step](../../fundamentals/workers/maintenance-steps) named
`online-table-rewrite`, so it runs where the rest of the cycle runs: on the holder of the maintainer duty, and only when
the housekeeping gate admits the cycle (the service is idle, or the cycle was deferred too long).

Each cycle:

1. **Checks that the strategy's capabilities are Ready**: pg_squeeze on every database the
   [capability registry](./capabilities) probed; for pg_repack, the `pg_repack` extension on every database and the
   `program/pg_repack` client on this host. Anything else (including `Provisionable`, an extension that provisioning
   is turned off for, and a client the probe could not decide) rewrites nothing and logs why; the queue is kept.
   pg_repack in `External` mode does nothing here, not even a scan. Under `Auto`, a cycle where neither tool is
   `Ready` does nothing and logs nothing: the boot-time `Rewrite` step already said what it does instead.
2. **Takes the queued tables** (`pending_table_rewrites`, which the cycle's bloat detection fills) that still measure
   at or over the [bloat threshold](#rewrite-thresholds) and their [post-rewrite floor](#post-rewrite-floor), and those
   owed one rewrite for a [lowered fillfactor](#fillfactor-decrease),
   **largest bloat ratio first** (the [measured ratio](#how-bloat-is-measured) where the
   table was queued with one), ties in name order.
3. **Spends a byte budget.** A table is rewritten only when its heap and its TOAST relation together
   (`pg_table_size`, which an online rewrite copies) fit what is left of `OnlineRewriteMaxBytesPerCycle`; one that does not fit is deferred to a later cycle, and the next smaller table that
   fits is taken. A table larger than the whole budget is never rewritten, and the log names the setting to raise.
4. **Rewrites each table and re-measures.** For pg_squeeze it checks the
   [prerequisites](#online-rewrite-prerequisites) for the table, then calls pg_squeeze. For pg_repack it starts the
   client with the connection in its environment, as [pg_repack](#pg-repack) describes. Either way it then runs
   `ANALYZE` and re-measures, with `pgstattuple_approx` while pgstattuple is `Ready`
   ([how bloat is measured](#how-bloat-is-measured)).
5. **Clears the request only when the rewrite improved the table**: the re-measured ratio is lower than the ratio that
   queued it. A [lowered-fillfactor](#fillfactor-decrease) request is cleared once its rewrite ran, since rewriting a
   compact table at a lower fillfactor makes it larger. A rewrite that did not help, a table whose prerequisites were not met, and a call that failed all stay
   queued for the next cycle, each with a warning naming the table.

```mermaid{caption="One maintenance cycle of the online rewrite: the strategy's capabilities must be Ready, tables go largest bloat first within the byte budget, and a request is cleared only when the rewrite improved the table." tests=["OnlineTableRewriteStepTests.PgSqueezeNotReadyOnEveryDatabase_RewritesNothing_AndSaysWhereAsync","OnlineTableRewriteStepTests.PgRepack_ClientNotReady_RewritesNothing_AndSaysWhyAsync","OnlineTableRewriteStepTests.Rewrites_TheLargestBloatRatioFirstAsync","OnlineTableRewriteStepTests.Budget_SkipsATableThatWouldOverrunIt_AndTakesASmallerOneThatFitsAsync","OnlineTableRewriteStepTests.NotImproved_LeavesTheRequestQueuedAsync","OnlineTableRewriteStepTests.Improved_ClearsTheRequestAsync","OnlineTableRewriteStepTests.PgRepack_ClearsOnlyWhatImprovedAsync"]}
flowchart TD
  R{pg_squeeze Ready, or<br/>pg_repack and its client Ready?} -->|no| K[Log why; queue kept]
  R -->|yes| Q[Queued tables,<br/>largest bloat ratio first]
  Q --> B{Fits the bytes left<br/>of the budget?}
  B -->|no| D[Deferred to a later cycle]
  B -->|yes| P{Prerequisites met?}
  P -->|no| L[Warn with the reason;<br/>stays queued]
  P -->|yes| S[pg_squeeze or pg_repack,<br/>ANALYZE, re-measure]
  S --> I{Ratio lower than<br/>when it was queued?}
  I -->|yes| C[Request cleared]
  I -->|no| L
```

| Key | Environment variable | Default | Meaning |
|---|---|---|---|
| `Whizbang:Workers:Maintenance:TableRewriteStrategy` | `Whizbang__Workers__Maintenance__TableRewriteStrategy` | `Auto` | `PgSqueeze`, or `PgRepack` in process, turns the online rewrite on; `Auto` turns it on when either tool is `Ready`. |
| `Whizbang:Workers:Maintenance:OnlineRewriteMaxBytesPerCycle` | `Whizbang__Workers__Maintenance__OnlineRewriteMaxBytesPerCycle` | `1073741824` (1 GiB) | The most bytes one cycle rewrites, through either tool, counting each table's heap and its TOAST relation (indexes are not counted). pg_squeeze and pg_repack each write a full copy of the table, plus the WAL for it, so this bounds the extra disk and WAL one cycle can cause. `0` rewrites nothing. |

```json{title="Online rewrite with a 4 GiB budget per cycle" description="Selects pg_squeeze for table rewrites and lets each maintenance cycle rewrite up to 4 GiB of queued tables." category="Configuration" difficulty="INTERMEDIATE" tags=["storage", "table-rewrite", "pg_squeeze", "maintenance", "configuration"] tests=["OnlineTableRewriteStepTests.TheBudget_DefaultsToOneGibibyte_AndBindsFromConfigurationAsync", "OnlineTableRewriteStepTests.Budget_SkipsATableThatWouldOverrunIt_AndTakesASmallerOneThatFitsAsync"]}
{
  "Whizbang": {
    "Workers": {
      "Maintenance": {
        "TableRewriteStrategy": "PgSqueeze",
        "OnlineRewriteMaxBytesPerCycle": 4294967296
      }
    }
  }
}
```

A cycle ends with one line, for example
`Online rewrite: 1 of 2 queued table(s) rewritten this cycle; 1 left queued; 0 held back by their post-rewrite floor`.

A cycle with nothing to rewrite says so once, at Information, so "nothing to do" can be told from "never ran":

```text
Online rewrite: no table needs a rewrite: 3 requested, none at or above 2x; 1 held back by their post-rewrite floor
```

The figures come from `wh_table_rewrite_queue_status()`: how many tables are in `pending_table_rewrites`, the
threshold in force, and how many tables reach the threshold but are held back by their
[post-rewrite floor](#post-rewrite-floor). Every cycle, empty or not, also reports the queue on
[`whizbang.table.rewrite.queue`](../observability/metrics#table-rewrites) and each attempt on
[`whizbang.table.rewrites`](../observability/metrics#table-rewrites).

**A requested table below the line is still not offered.** A table in `pending_table_rewrites` is offered only while
it measures at or above the threshold and its floor, as before. A replayed migration that requests an already
rewritten table again must not rewrite it again, and an external pg_repack job reads the same
`wh_tables_needing_rewrite()`, so the requests are reported in the line above rather than rewritten.
{verified: RewriteRegrowthFloorSqlTests.TheQueueStatus_CountsTheQueue_AndTheTablesTheFloorHeldBackAsync, TableRewriteRequestSqlTests.LeanTable_IsNotOfferedForRewrite_EvenWhenRequestedAsync}

### Prerequisites checked before each call {#online-rewrite-prerequisites}
{verified: PgSqueezePrerequisitesTests.EveryPrerequisiteMet_IsNothingUnmetAsync, PgSqueezePrerequisitesTests.TheFirstUnmetPrerequisite_IsTheOneReportedAsync, OnlineTableRewriteSqlTests.ThePrerequisiteQuery_ReadsTheServersFactsAsync, OnlineTableRewriteSqlTests.Squeeze_OnAServerWithoutPgSqueeze_IsReportedAndNotAttemptedAsync}

pg_squeeze does its work in a background worker, and a failure there surfaces as a bare error. So before each call one
catalog query reads what the call depends on, and the first unmet prerequisite is logged as
`Table <name> was not rewritten: <reason>` instead of calling pg_squeeze. The checks run, in order, on the connection
the rewrite uses (the [schema-initialization connection](./migrations#table-rewrites-run-post-ready-under-the-maintainer-duty)
when one is configured, otherwise the application's):

| Prerequisite | Read from | Fix |
|---|---|---|
| The table exists | `to_regclass` | none; the next cycle no longer offers it |
| pg_squeeze is installed in this database | `squeeze.squeeze_table` in `pg_proc` | let [provisioning](./capabilities#provisioning) create it, or `CREATE EXTENSION pg_squeeze` |
| The role may call it | `USAGE` on schema `squeeze`, `EXECUTE` on the function | grant both |
| `wal_level = logical` (below Postgres 19) | `wal_level`, `server_version_num` | set `wal_level = logical`, then restart the server |
| A free replication slot | `pg_replication_slots` against `max_replication_slots` | raise `max_replication_slots` (a restart), or drop an unused slot |
| A primary key or replica identity index | `pg_index` | every framework table has a primary key; this guards a table that lost it |
| The role may create a replication slot | `rolsuper` or `rolreplication` | `ALTER ROLE <role> WITH REPLICATION` |
| The role owns the table | `pg_has_role(..., 'MEMBER')` on the owner | configure the schema-initialization connection, whose role owns the tables |

### Privileges on a managed server {#online-rewrite-privileges}

What the role that runs the rewrite needs, read from pg_squeeze's source (version 1.9) rather than its README, which
does not say:

- **The REPLICATION attribute, or superuser.** `squeeze.squeeze_table` starts a background worker that connects as
  the calling role and creates a logical replication slot for the rewrite. From Postgres 15 that slot creation checks
  the caller's right to create slots, which only superuser and roles with `REPLICATION` have. The extension's own
  scheduler functions (`squeeze.start_worker`, `squeeze.stop_worker`) need superuser, but the library does not use
  them: it calls `squeeze_table` directly, which needs no superuser.
- **`EXECUTE` on the function.** The extension script does not revoke it from `PUBLIC`, so any role that may use the
  `squeeze` schema can call it by default.
- **Ownership is not checked by pg_squeeze**, which switches to the table owner for the index functions it runs. The
  library checks ownership itself: the `ANALYZE` that follows needs it, and a rewrite should run as the role that owns
  the table, as `VACUUM FULL` does.
- **Server parameters** (operator, at the server, each needing a restart): pg_squeeze in `shared_preload_libraries`,
  `wal_level = logical` below Postgres 19, and `max_replication_slots` with room for one more slot per rewrite in
  flight. On a managed server the extension must also be named in the extension allowlist.

On a managed server, the administrator role the platform gives you can usually grant `REPLICATION` to the
schema-initialization role, and logical replication is switched on through the platform's server parameters rather
than SQL. This was worked out from the extension's source and the platform's general rules, not yet confirmed on every
managed service: check the role with `SELECT rolreplication FROM pg_roles WHERE rolname = current_user` before
choosing `PgSqueeze`. Where the role cannot be given `REPLICATION`, the prerequisite check says so for each table and
the queue is kept; `VacuumFull` in a maintenance window remains the alternative.

## Blue-green rewrite of a perspective table {#blue-green-rewrite}

{verified: OnlineTableRewriteStepTests.Online_WithPgSqueezeReady_RewritesThroughIt_AndRebuildsNothingAsync, OnlineTableRewriteStepTests.Online_WithPgSqueezeNotReady_AndPgRepackReady_RepacksAsync, OnlineTableRewriteStepTests.Online_WithNoExtensionUsable_RebuildsThePerspectiveTable_AndAFrameworkTableWaitsAsync, OnlineTableRewriteStepTests.Online_RebuildsAtMostTheCycleLimit_LargestBloatFirstAsync, OnlineTableRewriteStepTests.Online_ATableWhoseDutyAnotherInstanceHolds_IsNotRebuiltAgain_AndStaysQueuedAsync, OnlineTableRewriteStepTests.Online_APerspectiveAlreadyRebuildingHere_IsNotRebuiltAgainAsync, OnlineTableRewriteStepTests.OnlyOnline_EverRebuildsAsync, TableRewriteStrategyTests.Auto_NeverResolvesToAnOnlineRewrite_ABlueGreenRebuildIncludedAsync, BlueGreenRebuildIntegrationTests.Online_WithNoExtension_RebuildsALoweredFillFactorTable_AtTheNewFillFactorAsync, BlueGreenRebuildIntegrationTests.Online_WithNoExtension_AFrameworkTableWaitsAsync, BlueGreenRebuildIntegrationTests.Online_SkipsATableWhoseDutyAnotherInstanceHolds_AndRebuildsItOnceReleasedAsync}

On a server that allowlists neither pg_squeeze nor pg_repack, a rewrite request waits indefinitely, and `VACUUM FULL` is
never run on its own. That is the right default for the framework's own tables, but a perspective table can be rewritten
without any extension: Whizbang can rebuild it from its events, [blue-green](../../fundamentals/perspectives/rebuild#blue-green),
into a shadow table that took the live table's storage settings first, swapped in under a lock bounded by
`SwapLockTimeout`. With `TableRewriteStrategy = Online` the maintenance cycle uses the cheapest strategy the server allows:

| Order | Strategy | Tables | Needs |
|---|---|---|---|
| 1 | pg_squeeze | any | the extension `Ready` |
| 2 | pg_repack | any | the extension and its client `Ready`, the client run in process |
| 3 | blue-green rebuild | perspective tables | nothing beyond Whizbang |
| - | `VACUUM FULL` | never under `Online` | an operator, by hand, or `VacuumFull` with `AllowTableRewrite` |

The rules, and why:

- **Last, because a replay costs more.** A rebuild reads every event of the perspective and writes every row again,
  which is more I/O than copying the rows, so it is used only where nothing cheaper is available. It still gives the
  outcome a rewrite exists for: the table rewritten at its declared fillfactor, with no extension and no long lock.
- **Explicit, never `Auto`.** `Online` is chosen on purpose, like `PgSqueeze`: `Auto` keeps decision #1671 and never
  starts an online rewrite of any kind. `Online` requires no extension, so it never stops a start.
- **Perspective tables only.** Only a table the perspective registry records exactly one perspective as writing
  (`wh_perspective_registry.perspective_names`) can be rebuilt. A framework table, or one several perspectives share,
  cannot be recreated from one perspective's events: it waits, and the cycle logs which tables wait and why.
- **The same gate and budget.** It runs as the online rewrite does: on the maintainer duty's holder, when the
  housekeeping gate admits the cycle, largest bloat first, within `OnlineRewriteMaxBytesPerCycle`. A request is one
  rebuild, cleared as any other rewrite is (when the table improved, or once for a
  [lowered fillfactor](#fillfactor-decrease)), and re-measured afterwards.
- **One rebuild per cycle by default.** `BlueGreenRewriteMaxPerCycle` (default `1`) bounds how many perspectives one
  cycle rebuilds, so several large ones are not replayed at once. A table left for the next cycle is logged with the
  setting.
- **Never two rebuilds of one table.** Two blue-green rebuilds of a table share its shadow, and creating the shadow drops
  one left behind, so a second rebuild would destroy the first one's replay. Every blue-green rebuild, an operator's or
  the cycle's, holds the table's duty `perspective-rebuild:<table>`
  ([one blue-green rebuild per table](../../fundamentals/perspectives/rebuild#one-blue-green-rebuild-per-table)). The
  cycle reads the role assignments (it never votes for the duty just to look) and passes over a table whose duty another
  instance holds, or whose perspective this instance is already rebuilding, without spending the limit or the budget; its
  request stays queued, since the rebuild in flight satisfies it for now. A rebuild that the cycle starts and that the
  duty then refuses (another instance took it in between, or the elector cannot answer) fails, counts as that cycle's
  rebuild, and stays queued.

```json{title="Rewrite with whatever the server allows" description="Selects Online: pg_squeeze, else pg_repack, else a blue-green rebuild of a perspective table, one per cycle." category="Configuration" difficulty="INTERMEDIATE" tags=["storage", "table-rewrite", "blue-green", "maintenance", "configuration"] tests=["OnlineTableRewriteStepTests.BlueGreenRewriteMaxPerCycle_DefaultsToOne_AndBindsFromConfigurationAsync", "OnlineTableRewriteStepTests.Online_WithNoExtensionUsable_RebuildsThePerspectiveTable_AndAFrameworkTableWaitsAsync"]}
{
  "Whizbang": {
    "Workers": {
      "Maintenance": {
        "TableRewriteStrategy": "Online",
        "BlueGreenRewriteMaxPerCycle": 1
      }
    }
  }
}
```

The rebuild is recorded on its `PerspectiveRebuild*` events with the trigger `TableRewrite`.

### Rewrite history {#rewrite-history}

{verified: FillFactorDecreaseRewriteTests.TheRewriteHistory_RecordsEachRewrite_AndStaysBoundedAsync, DapperTableMaintenanceTests.CompleteTableRewrite_ClearsTheRequest_AndRecordsTheStrategyAsync, OnlineTableRewriteStepTests.TheStrategyThatCarriedOutTheRequest_IsRecordedAsync, TableRewriteStartupStepTests.ARewriteAtBoot_RecordsItsStrategyAsync}

A request is deleted once it is carried out, so `wh_table_rewrite_history` records each completed rewrite: the table,
the strategy (`VacuumFull`, `PgSqueeze`, `PgRepack` or `BlueGreenRebuild`), the reason (`Bloat` or
`FillFactorDecrease`) and the bloat ratio before and after. Every strategy writes it the same way, through
`wh_complete_table_rewrite`, which records the rewrite and clears the request in one call. The history keeps itself
bounded: the write that adds a row deletes rows older than 90 days and all but the newest 1,000, so it needs no sweep of
its own.

```sql{title="Read what rewrote each table" category="Operations" difficulty="BEGINNER" tests=["FillFactorDecreaseRewriteTests.TheRewriteHistory_RecordsEachRewrite_AndStaysBoundedAsync"]}
SELECT table_name, strategy, reason, bloat_before, bloat_after, completed_at
FROM wh_table_rewrite_history ORDER BY completed_at DESC;
```

## Rebuilding queue-table indexes {#queue-index-rebuild}
{verified: QueueIndexReindexStepTests.Run_RebuildsOneIndexPerCycleAsync, QueueIndexReindexStepTests.Run_DropsEveryInvalidLeftoverFirst_ThenRebuildsAsync, QueueIndexReindexStepTests.Run_ARebuild_IsLoggedWithTheSizesAndTheEstimateAsync, QueueIndexReindexStepTests.Run_ARebuildThatDidNotRunOrFailed_IsLoggedAsync, QueueIndexReindexStepTests.Run_NothingOverTheLine_RebuildsNothingAsync, QueueIndexReindexSqlTests.TheStep_ShrinksABloatedQueueIndexAsync, QueueIndexReindexSqlTests.TheStep_DropsAnInvalidLeftover_AndStillRebuildsAsync}

A queue table fills during a burst and drains back to empty. Autovacuum keeps its heap in check, but a B-tree index
never returns its pages to the file: after a burst, an index on an empty table can stay the size it was at the peak,
and every scan of it walks those empty pages. Only a rebuild gives them back, and `REINDEX INDEX CONCURRENTLY` does it
while the table stays readable and writable.

So the maintenance cycle runs a [maintenance step](../../fundamentals/workers/maintenance-steps#queue-index-rebuild)
named `queue-index-reindex`. Each cycle:

1. **Does nothing at all** when `ReindexBloatThreshold` is `0`.
2. **Takes the window's claim,** so the fleet runs it once per window however many instances run maintenance. An
   instance that loses the claim, or a host with no claim store, does nothing.
3. **Surveys the B-tree indexes of the queue tables** in one catalog read: each index's size and the size a fresh index
   over the same rows should have.
4. **Stops if an index build is running on a queue table,** because an invalid index there may be that build's work in
   progress.
5. **Drops every invalid leftover** of an interrupted rebuild with `DROP INDEX CONCURRENTLY` ([leftovers](#queue-index-leftovers)).
6. **Rebuilds at most one index:** of the valid indexes more than `ReindexBloatThreshold` times their expected size
   and at least 1 MiB, the one with the most bytes to give back.

```mermaid{caption="One maintenance cycle of the queue-index rebuild: one claim per window, nothing while a build runs, leftovers dropped first, then at most one rebuild." tests=["QueueIndexReindexStepTests.Run_AThresholdOfZero_DoesNothing_NotEvenASurveyAsync","QueueIndexReindexStepTests.Run_WhenTheClaimIsLost_NothingIsSurveyedOrRebuiltAsync","QueueIndexReindexStepTests.Run_WhileABuildIsInProgress_NothingIsDroppedOrRebuiltAsync","QueueIndexReindexStepTests.Run_DropsEveryInvalidLeftoverFirst_ThenRebuildsAsync","QueueIndexReindexStepTests.Run_RebuildsOneIndexPerCycleAsync"]}
flowchart TD
  T{ReindexBloatThreshold 0?} -->|yes| X[Nothing]
  T -->|no| C{Won this window's claim?}
  C -->|no| X
  C -->|yes| S[Survey the queue-table indexes]
  S --> B{Index build running<br/>on a queue table?}
  B -->|yes| X
  B -->|no| D[Drop every invalid leftover]
  D --> O{Any valid index over the threshold<br/>and at least 1 MiB?}
  O -->|no| X
  O -->|yes| R[REINDEX INDEX CONCURRENTLY<br/>the one with the most bytes to give back]
```

A rebuild is logged twice. Before it starts, the index and why it was chosen, with how the ratio was obtained, so a
long rebuild is visible while it runs:
`Queue index rebuild: rebuilding wh_inbox_pkey on wh_inbox; it measured 5x its expected 8388608 bytes (estimate), over Whizbang:Workers:Maintenance:ReindexBloatThreshold (3)`.
When it finishes, the sizes before and after:
`Queue index rebuild: wh_inbox_pkey on wh_inbox rebuilt concurrently, 41943040 -> 8388608 bytes`.
A rebuild that fails is logged with the index and the error and does not fail the cycle; the copy it left is dropped
on the next one.

| Key | Environment variable | Default | Meaning |
|---|---|---|---|
| `Whizbang:Workers:Maintenance:ReindexBloatThreshold` | `Whizbang__Workers__Maintenance__ReindexBloatThreshold` | `3.0` | How many times its expected size an index may grow before it is rebuilt. `0` turns the rebuild off; any other value must be finite and greater than 1. |

```json{title="Rebuild queue indexes only past five times their expected size" description="Raises the queue-index rebuild threshold, so the maintenance cycle rebuilds an index on a queue table only once it is more than five times the size a fresh one would need." category="Configuration" difficulty="BEGINNER" tags=["storage", "reindex", "maintenance", "configuration"] tests=["QueueIndexReindexStepTests.TheThreshold_DefaultsToThree_AndBindsFromConfigurationAsync", "QueueIndexReindexStepTests.Run_TheThresholdIsTheOptionsAsync"]}
{
  "Whizbang": {
    "Workers": {
      "Maintenance": {
        "ReindexBloatThreshold": 5.0
      }
    }
  }
}
```

The step runs with the EF Core driver's work coordinator. A coordinator that does not survey its indexes (the Dapper
driver today) offers none, so the step does nothing there.

### Leftovers of an interrupted rebuild {#queue-index-leftovers}
{verified: QueueIndexReindexStepTests.Run_DropsEveryInvalidLeftoverFirst_ThenRebuildsAsync, QueueIndexReindexStepTests.Run_ALeftoverThatIsNotDropped_IsLogged_AndTheRebuildStillRunsAsync, QueueIndexReindexSqlTests.TheStep_DropsAnInvalidLeftover_AndStillRebuildsAsync}

`REINDEX CONCURRENTLY` builds a copy of the index named `<index>_ccnew`, swaps it in, and retires the original as
`<index>_ccold`. Interrupted part way (a restart, a canceled statement, a lost connection), it leaves one of them behind,
marked invalid. An invalid index is never used for reads but is still kept up to date on every write, so it costs
without helping. Each cycle drops every such leftover on the queue tables before it rebuilds anything. A leftover that
was not dropped, or whose drop failed, is logged by name, and the rebuild still runs.

To see them:

```sql{title="Find invalid indexes left by an interrupted rebuild" category="Operations" difficulty="BEGINNER"}
SELECT c.relname AS index_name, t.relname AS table_name, pg_relation_size(c.oid) AS bytes
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_class t ON t.oid = i.indrelid
WHERE NOT i.indisvalid;
```

### Why it works this way {#queue-index-decisions}

Each rule below is held by the tests named under it, which fail if the behavior is reversed.

#### Which tables are queue tables {#reindex-which-tables}
{verified: QueueIndexReindexSqlTests.TheSurvey_CoversEveryQueueTable_AndNoOtherAsync}

A queue table is one that churns to empty: a row is written per unit of work and deleted when that work completes, so
the table drains to nothing whenever the service is idle. Read from the migrations, those are `wh_outbox` and
`wh_inbox` (rows deleted on completion), `wh_inbox_state` (the inbox's work state, deleted with its inbox row),
`wh_perspective_events` (one row per event and perspective, deleted once processed), `wh_active_streams` (a row per
stream with work, removed when it completes) and `wh_doorbell_queue` (rows deleted as they are rung). The deduplication
window `wh_message_deduplication` is left out: it holds a fixed working set for its retention period and never drains.
The event-destruction hold is left out too: a cancel decision stays in it indefinitely. Only B-tree indexes are
surveyed, because the expected size below is a B-tree's.

#### The threshold: a line to cross, 3 by default, 0 to turn it off {#reindex-threshold}
{verified: QueueIndexReindexStepTests.Choose_AnIndexIsChosenOnlyWhenItsRatioExceedsTheThresholdAsync, QueueIndexReindexStepTests.Run_TheThresholdIsTheOptionsAsync, QueueIndexReindexStepTests.Run_AThresholdOfZero_DoesNothing_NotEvenASurveyAsync, QueueIndexReindexStepTests.TheThreshold_DefaultsToThree_AndBindsFromConfigurationAsync, QueueIndexReindexStepTests.TheThreshold_IsValidatedAsync, QueueIndexReindexStepTests.AnInvalidThresholdInConfiguration_FailsWhenTheOptionsAreReadAsync}

An index is rebuilt only when its ratio is strictly greater than the threshold; one exactly at it is not. The default,
3, is the same line a table is queued for rewrite at, so an index and its table are judged alike. `0` turns the step
off before it surveys anything or takes a claim. Any other value must be finite and greater than 1, and start fails
otherwise, naming the key: a freshly built index measures about 1, so a line at or below it would rebuild the same index
every cycle.

#### Indexes under 1 MiB are left alone {#reindex-size-floor}
{verified: QueueIndexReindexStepTests.Choose_TheSizeFloorAsync}

On a drained queue the expected size is two pages, so an index of a few pages already reads as several times too
large. Those pages are the noise in the estimate, not bloat worth a rebuild, and a rebuild would be undone by the next
burst. An index is rebuilt only when it is at least 1 MiB; one a page under is not.

#### The most bytes to give back first {#reindex-most-bytes-first}
{verified: QueueIndexReindexStepTests.Choose_TheMostReclaimableBytesFirst_NotTheHighestRatioAsync, QueueIndexReindexStepTests.Choose_TiesAreTakenByNameAsync}

Of the indexes over the line, the one rebuilt is the one whose size less its expected size is largest, not the one with
the highest ratio: on a nearly empty queue every small index reads as hugely bloated, and the ratio alone would spend
the cycle on a 2 MiB index while a 400 MiB one waits. Equal amounts are taken in name order, so the choice does not
depend on the order the catalog returns them in.

#### One index per cycle, once per fleet {#reindex-one-per-cycle}
{verified: QueueIndexReindexStepTests.Run_RebuildsOneIndexPerCycleAsync, QueueIndexReindexStepTests.Run_WhenTheClaimIsLost_NothingIsSurveyedOrRebuiltAsync, QueueIndexReindexStepTests.Run_WithNoClaimStore_SkipsAndSaysWhyAsync, QueueIndexReindexStepTests.TheClaimWindow_IsHalfTheMaintenanceIntervalAsync, QueueIndexReindexStepTests.TheClaimKey_NamesTheWindowAsync}

A rebuild reads the whole index and writes a new one, plus its WAL, so a cycle rebuilds at most one. The step runs where
the maintenance cycle runs (on the maintainer duty's holder when duties are assigned), and on top of that each run takes
a claim in `wh_unique_emission_claims` keyed by a window of half the maintenance interval (`IntervalMinutes`, at least
one minute's worth), as the integrity audit's claim is. Instances whose cycles fall in the same window share one
rebuild, and an instance's next cycle is never blocked by its own last claim. A host with no claim store skips the
step and says so at debug level, rather than have every instance rebuild.

#### Only invalid indexes named as a rebuild names its copies are dropped {#reindex-leftover-names}
{verified: QueueIndexReindexStepTests.Run_DropsOnlyInvalidIndexesNamedAsALeftoverAsync, QueueIndexReindexStepTests.TheLeftoverName_IsWhatAConcurrentRebuildNamesItsCopiesAsync, QueueIndexReindexSqlTests.Drop_RefusesAValidIndex_AndOneOffTheQueueTablesAsync}

A leftover is an index that is invalid and whose name ends in `_ccnew` or `_ccold`, optionally followed by digits
(Postgres numbers the name when the plain one is taken). A valid index with such a name is in use and is kept; an
invalid index with any other name is a failed build of some other kind, whose fix is the operator's, and is kept too.
The step drops only what a concurrent rebuild could have made. The coordinator checks again against the catalog before
it drops anything, and refuses a valid index, an index on any other table, and a name the catalog does not know.

#### Nothing is dropped or rebuilt while a build runs {#reindex-build-in-progress}
{verified: QueueIndexReindexStepTests.Run_WhileABuildIsInProgress_NothingIsDroppedOrRebuiltAsync, QueueIndexReindexSqlTests.WhileABuildIsRunning_TheSurveySaysSoAsync}

A rebuild in flight has the same invalid `_ccnew` index an interrupted one leaves. When `pg_stat_progress_create_index`
shows a build on a queue table, or a build in the database whose table this role is not allowed to see, the cycle
skips both the drops and the rebuild and logs the table. A rebuild that outlasts the claim window is therefore never
mistaken for a leftover by the next window's winner, and two rebuilds never wait on each other.

#### The expected size, and when it is not known {#reindex-expected-size}
{verified: QueueIndexReindexSqlTests.AnEmptyVacuumedQueueIndex_IsExpectedToNeedTwoPagesAsync, QueueIndexReindexSqlTests.AFreshlyBuiltIndex_ReadsAsAboutOneAsync, QueueIndexReindexSqlTests.AnIndexWithNoRowCount_HasNoExpectedSizeAsync, QueueIndexReindexStepTests.Choose_SkipsAnUnknownRatioAndAnInvalidIndexAsync, QueueIndexReindexStepTests.TheRatio_IsSizeOverExpected_AndUnknownWithoutAnExpectedSizeAsync}

The expected size is the leaf pages the index's rows need at its fill factor (90 unless set), plus the metapage, and
never less than two pages. A row's entry is an 8-byte header and the indexed columns' average widths from `pg_stats`
(or the type's fixed length) rounded up to 8 bytes, plus a 4-byte line pointer; a page holds its size less its header
and the B-tree's trailer. The row count is the index's own, which for a partial index counts only the rows it holds.
A freshly built index reads as about 1. An index with no row count recorded (never vacuumed or analyzed), or a column
with neither statistics nor a fixed width, has no expected size and is not judged until it has.

#### The ratio is the catalog estimate {#reindex-estimate-only}
{verified: QueueIndexReindexStepTests.Run_ARebuild_IsLoggedWithTheSizesAndTheEstimateAsync, QueueIndexReindexSqlTests.TheSurvey_CoversEveryQueueTable_AndNoOtherAsync}

The ratio is always the [catalog estimate](#how-bloat-is-measured), method `estimate`, and the log says so. The
pgstattuple extension's `pgstatindex` would measure an index exactly, but it reads every page of the index: the same
reads as the rebuild it would decide, and the kind of whole-relation scan the library never runs on its own (as the
`exact` table measurement is never run). On a drained queue the estimate is at its most reliable, since the row count
it starts from is close to zero.

#### The connection the rebuild runs on {#reindex-connection}
{verified: QueueIndexReindexSqlTests.UnderADataOnlyApplicationRole_OnlyTheInitConnectionDropsAndRebuildsAsync}

`REINDEX CONCURRENTLY` and `DROP INDEX CONCURRENTLY` cannot run inside a transaction and need the table owner's rights.
They run on the [schema-initialization connection](./migrations#table-rewrites-run-post-ready-under-the-maintainer-duty)
when one is configured, because its role owns the tables; otherwise on the application's connection, and only for a
table its role owns. A table it does not own is logged with the table and the role, and nothing is touched. Neither
statement has a timeout: a concurrent drop must wait for the transactions using the table, and one rebuild per cycle
already bounds the work.

## Related

- [Table rewrites run post-ready](./migrations#table-rewrites-run-post-ready-under-the-maintainer-duty)
- [Capabilities](./capabilities)
- [Maintenance cycle](./maintenance)

- [Maintenance steps: ledger retention](../../fundamentals/workers/maintenance-steps#ledger-retention)
- [Maintenance steps: queue-index rebuild](../../fundamentals/workers/maintenance-steps#queue-index-rebuild)
- [Database limits](./database-limits)
