---
title: Stream End of Life
pageType: concept
description: >-
  How Whizbang knows every stream's age, size and state without reading the event store: the stream lifecycle
  ledger, what writes it, what it costs on the append path, and the one-time backfill that seeds it for existing
  streams.
version: 1.0.0
category: Core Concepts
order: 16
tags: 'event-streams, stream-lifecycle, end-of-life, archive, storage, event-store'
codeReferences:
  - src/Whizbang.Data.Postgres/Migrations/260_StreamLifecycleLedger.sql
  - src/Whizbang.Data.Postgres/StreamLifecycleBackfill.cs
  - src/Whizbang.Data.EFCore.Postgres/StreamLifecycleBackfillMaintenanceStep.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperStreamLifecycleBackfillMaintenanceStep.cs
  - src/Whizbang.Data.EFCore.Postgres/PostgresDriverExtensions.cs
  - src/Whizbang.Data.Dapper.Postgres/ServiceCollectionExtensions.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StreamLifecycleLedgerSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StreamLifecycleBackfillSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StreamLifecycleBackfillMaintenanceStepTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Performance/StreamLifecycleEmitCostScenarioTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Operations/StreamPurgeTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperStreamLifecycleLedgerTests.cs
---

# Stream End of Life

The event store is most of a service's database, and nothing leaves it on its own. A stream that is finished, idle
for months, or past any reader's interest costs the same bytes, index entries and vacuum work as a stream written
today. Ending a stream's life (sealing it, archiving it, purging it, closing its books) starts with knowing which
streams are candidates, and answering that by reading the event store is the very cost the work exists to remove.

This page describes the part that answers it: the **stream lifecycle ledger**. Finalization, scheduled disposition,
archiving and end-of-life policies build on it and are added to this page as they ship.

## The stream lifecycle ledger {#the-stream-lifecycle-ledger}

`wh_stream_lifecycle` holds one row per stream. Every path that stores an event keeps the stream's row current, in
the same transaction as the event, so the row is never behind the store.

{verified: StreamLifecycleLedgerSqlTests.OutboxAppend_CreatesTheRow_FromTheStreamsFirstEventAsync, StreamLifecycleLedgerSqlTests.SecondAppend_AdvancesVersionAndBytes_AndKeepsWhatTheFirstEventSetAsync}

| Column | What it holds | Written by |
|---|---|---|
| `stream_id` | The stream (primary key). | the first append |
| `stream_type` | The `aggregate_type` of the stream's first event. | the first append, never changed |
| `tenant` | The tenant (scope `t`) of the stream's first event; null when it had none. | the first append, never changed |
| `first_appended_at` | When the first event was stored. | the first append, never changed |
| `last_appended_bucket` | The UTC hour of the newest append. | an append, only when the hour changes |
| `last_version` | The stream's newest version. | every append |
| `approx_bytes` | Approximate size of the stream's stored bodies (payload plus metadata). | every append adds its bytes |
| `state` | `Active`, `Sealed` or `Archived`. Every stream starts `Active`. | end-of-life work, never an append |
| `sealed_at` | When the stream was sealed. | finalization |
| `disposition_due_at` | When the stream's disposition is due; null while none is scheduled. | scheduled disposition |
| `archive_locator` | Where the archive store put the stream's archived events. | the archive store |
| `origin_generation` | The origin generation the stream's history was last mutated at; null until that happens. | the archive store |

Why each of these is the way it is:

- **The stream type is the first event's `aggregate_type`.** That is the decision the end-of-life plan made for what a
  stream's type is: an existing column, with no new declaration to keep in step. A later event of another type never
  renames the stream. On the outbox and inbox paths `aggregate_type` is the event type's name; on a direct append it is
  the aggregate type the caller names.
- **The tenant is the first event's.** A tenant size cap groups streams by tenant, and a stream belongs to one tenant;
  re-reading it on every append would be work for nothing. A stream with no tenant has `null`, not an empty string,
  because the absence of a tenant is not a tenant named `''`.
- **`state` is a stable string, constrained to three values.** Later slices and the archive store match on these values
  exactly, so a misspelled state is refused by `ck_stream_lifecycle_state` rather than stored.
  {verified: StreamLifecycleLedgerSqlTests.TheState_AcceptsOnlyItsNamedValuesAsync}
- **`origin_generation` is null until a history mutation.** Appends never write it; the archive store records the
  generation it bumped when it moves a stream's history. Null says "never mutated" without inventing a generation.
- **`approx_bytes` is approximate on purpose.** An append counts each body as its row holds it before TOAST compression
  (`pg_column_size` of the row the insert formed, on all three paths alike); the backfill counts what is stored, which
  is smaller for a body PostgreSQL compressed. The column ranks streams and tenants by size for a size cap; it is not
  an accounting figure, and measuring it exactly would cost a detoast on the hottest write path.

### What writes it {#what-writes-it}

Every path that inserts into `wh_event_store`:

| Path | How | Verified |
|---|---|---|
| The outbox emit chain (`_emit_event_store_chain`) | one set-based upsert per batch, in the statement that copies the events | {verified: StreamLifecycleLedgerSqlTests.OutboxAppend_CreatesTheRow_FromTheStreamsFirstEventAsync, StreamLifecycleLedgerSqlTests.Append_WritesOneLedgerRowPerStreamPerBatch_NotOnePerEventAsync} |
| The inbox emit chain (`_emit_event_store_chain_for_inbox`) | the same upsert, in its copy statement | {verified: StreamLifecycleLedgerSqlTests.InboxAppend_CreatesAndAdvancesTheRowAsync} |
| A direct append (`IEventStore.AppendAsync`, both drivers, through `wh_append_event`) | one upsert per appended event | {verified: StreamLifecycleLedgerSqlTests.DirectAppend_CreatesAndAdvancesTheRowAsync, StreamLifecycleLedgerSqlTests.DirectAppend_ThroughTheEventStore_CreatesTheRowAsync, DapperStreamLifecycleLedgerTests.AppendAsync_CreatesAndAdvancesTheStreamsRowAsync} |

A [stream purge](../../operations/infrastructure/purging-streams.md) removes the row with the stream's events: a purged
stream is gone, not archived, so no end-of-life sweep is left a row to act on.
{verified: StreamPurgeTests.Purge_RemovesEveryRowOfTheStreams_AndLeavesOthersAsync}

Prefix truncation (`wh_truncate_stream_prefix`) leaves the row as it is: the stream's newest version does not change,
and `approx_bytes` keeps counting the truncated bodies until the archive and policy work that truncates on purpose
adjusts it.

### What gets no row {#what-gets-no-row}

- **Ephemeral streams.** An event flagged ephemeral (`EventFlags.Ephemeral`) or a compaction origin
  (`EventFlags.Compacted`, which heads an ephemeral stream) does not create or advance a row. An ephemeral stream is
  reaped by its time to live and has no end of life to manage; a row per ephemeral stream would cost an upsert on every
  signal and a row the reaper would then have to delete. Streams never mix the two kinds
  ([WHIZ133](../../operations/diagnostics/whiz133.md)), so a stream's row describes all of it.
  {verified: StreamLifecycleLedgerSqlTests.EphemeralAndCompactionOriginEvents_CreateNoRow_WhileASourcedEventDoesAsync, DapperStreamLifecycleLedgerTests.AppendAsync_OfAnEphemeralEvent_CreatesNoRowAsync}
- **Events without a stream.** The empty stream id means "no stream"; there is nothing to finalize, archive or purge
  (a purge refuses the empty id too).
  {verified: StreamLifecycleLedgerSqlTests.EventsWithoutAStream_CreateNoRowAsync}

## Built for the append path {#built-for-the-append-path}

The emit chain is the hottest write path in the framework. The ledger is designed so that keeping it costs one row
write per stream per batch and nothing more.

- **One upsert per batch, set-based.** The outbox and inbox chains add the upsert to the statement that already copies
  the batch into the event store, grouped by stream: ten events on two streams are two row writes, not ten.
  {verified: StreamLifecycleLedgerSqlTests.Append_WritesOneLedgerRowPerStreamPerBatch_NotOnePerEventAsync}
- **No new lock.** Every write path already holds the stream's advisory lock (`wh_event_store:<stream id>`) before it
  stores, and the upsert touches only the rows of those streams, in stream id order. A batch on one stream never waits
  for a batch on another.
  {verified: StreamLifecycleLedgerSqlTests.ConcurrentBatchesOnDifferentStreams_NeitherWaitsForTheOtherAsync}
- **Heap-only updates.** PostgreSQL rewrites a row in place on its own page, with no index maintenance, when no indexed
  column changes and the page has room. So the only indexed columns besides the key are `state` and
  `disposition_due_at`, neither of which an append writes, and the table has `fillfactor = 45` so each page keeps room
  for a new version of every row on it (see [What it costs](#what-it-costs)). An append changes `last_version`, `approx_bytes` and, only when the UTC hour changes,
  `last_appended_bucket`.
  {verified: StreamLifecycleLedgerSqlTests.AppendWithinTheHour_IsAHeapOnlyUpdate_WhileAnIndexedColumnChangeIsNotAsync, StreamLifecycleLedgerSqlTests.TheLedger_IndexesOnlyItsKeyStateAndDueTime_AndLeavesRoomOnEachPageAsync}
- **An hour bucket, not a timestamp.** "Last appended" is used by idle-time policies measured in days. An hour is fine
  enough for that and lets the column stay unindexed but still meaningful; the bucket is the UTC hour whatever the
  session's time zone, and it only moves forward, so an append stamped by an instance whose clock is behind never moves
  it back.
  {verified: StreamLifecycleLedgerSqlTests.Bucket_AdvancesOnlyWhenTheHourChanges_AndAnEarlierClockNeverMovesItBackAsync}
- **Autovacuum on a fixed count.** Every batch leaves one dead row version per stream it touched. Like
  `wh_stream_digests`, the table vacuums after 10,000 dead rows rather than a fraction of its size.

### Finding the due streams {#finding-the-due-streams}

`idx_stream_lifecycle_due` is a partial index over `(disposition_due_at, stream_id)`, carrying `state`, holding only the
rows that have a disposition scheduled. An `Active` stream has none, so it has no entry and its appends never touch the
index. The disposition sweep's candidate query reads the due streams from this index alone and never reads the event
store:

```sql{title="The due-stream candidate query" description="Finds the streams whose disposition is due, in due order, from the partial index alone." category="Core Concepts" difficulty="ADVANCED" tags=["stream-lifecycle", "end-of-life", "partial-index", "sql"] tests=["StreamLifecycleLedgerSqlTests.DueStreamQuery_UsesThePartialIndex_AndNeverReadsTheEventStoreAsync"]}
SELECT l.stream_id, l.state, l.disposition_due_at
FROM wh_stream_lifecycle l
WHERE l.disposition_due_at <= @now
ORDER BY l.disposition_due_at
LIMIT @batch;
```

### What it costs {#what-it-costs}

Measured on the outbox emit chain (`StreamLifecycleEmitCostScenarioTests`): the same 500-event batches run through
the chain with the ledger and through the chain as it was before it (migration 216), on one database, alternating
three rounds so neither side runs on a warmer cache or a larger store. A perspective subscribes to the event, so the
chain does its whole job (event row, body, digest fold, projection work). Medians:

| Batch | Blocks before | Blocks after | Ledger's own blocks | Execution before | Execution after |
|---|---|---|---|---|---|
| 50 streams that already have rows, 10 events each | 31,921 | 32,186 (+0.8%) | 250 (5 per stream) | 58.2 ms | 61.0 ms (+5%) |
| 500 new streams, 1 event each | 33,298 | 36,278 (+9%) | 3,040 (6 per stream) | 56.8 ms | 66.0 ms (+16%) |

{verified: StreamLifecycleEmitCostScenarioTests.EmitChain_WithAndWithoutTheLedger_ReportAsync}

The cost follows the number of streams in a batch, never the number of events: a stream that already has a row costs
its key probe and one heap-only rewrite of its row, and a new stream costs one row insert and one key entry. A batch of
one event per brand-new stream is the worst case, and that is the price of knowing the stream exists without reading the
event store later. Every update of an existing stream's row in these runs was heap-only, including batches that
rewrote every row on their pages. The execution times are server-side (`EXPLAIN ANALYZE`) on a build server and are
reported for scale only; the scenario gates on the block and row counts, which do not depend on the machine.

**Why fillfactor 45.** Streams created together share the ledger's pages, and a bulk load appends to them together, so
one batch can rewrite every row on a page. The dead versions it leaves cannot be pruned until it commits, so the page
needs room for a second copy of every row on it. Measured with every row of a 2,000-row table updated twice, one
transaction each: 2,304 of 4,000 updates were heap-only at fillfactor 70, 3,243 at 60, 3,932 at 50 and all 4,000 at 45.
The table is about twice the size it would be packed full; at roughly 150 bytes a row that is a small fraction of the
event store it indexes.
{verified: StreamLifecycleLedgerSqlTests.OneBatchAppendingToEveryStreamOnItsPages_IsStillHeapOnlyAsync}

## The one-time backfill {#the-one-time-backfill}

The migration that adds the ledger (260) cannot compute rows for the streams already in the store: that is a read of
every stream, and inside the migration it would hold every stream it touched until the migration committed, bounded by
nothing but the size of the store. So the migration only records whether there is anything to do, and a maintenance
step does the work afterwards.

- **Gated on a version marker.** The `wh_settings` row `stream_lifecycle_backfill_version` is `0` while there is work
  and `1` when it is done. A store with no events when the migration runs is recorded as done at once, so a new
  database never runs the backfill; a finished store costs the step one keyed read per maintenance cycle.
  {verified: StreamLifecycleBackfillSqlTests.Migration_OnAnEmptyStore_RecordsTheBackfillAsDoneAsync, StreamLifecycleBackfillSqlTests.Backfill_OnceDone_ReadsNothingAndChangesNothingAsync, StreamLifecycleBackfillMaintenanceStepTests.Run_OnceDone_WritesNothingAsync}
- **A re-run of the migration never moves the marker.** The redefinition closure re-runs migration 260 whenever an
  earlier file defining one of its functions re-runs; that must neither restart a finished backfill nor finish an
  unfinished one.
  {verified: StreamLifecycleBackfillSqlTests.Migration_RunAgain_LeavesTheMarkerAsItFoundItAsync}
- **Batched.** `wh_backfill_stream_lifecycle_batch` visits at most a batch of streams (500 by default) in stream id
  order, one index probe per stream, each call its own transaction. A batch holds one advisory lock per stream until it
  commits, which is why the batch is bounded by count and not only by time. Each maintenance cycle runs at most 20
  batches and then yields the cycle.
  {verified: StreamLifecycleBackfillSqlTests.Backfill_SeedsEveryStreamFromItsEvents_AndRecordsThatItIsDoneAsync, StreamLifecycleBackfillMaintenanceStepTests.Run_StopsAtItsRoundLimit_AndTheNextRunContinuesWhereItStoppedAsync}
- **Resumable.** The cursor (`stream_lifecycle_backfill_cursor`, the last stream id committed) moves in the batch's own
  transaction: a batch that fails leaves it where it was and the next call repeats that batch. A missing cursor row
  starts the walk again from the beginning, which is safe because of the next point.
  {verified: StreamLifecycleBackfillSqlTests.Backfill_StoppedAfterOneBatch_ResumesAfterItsCursor_AndFinishesTheRestAsync, StreamLifecycleBackfillSqlTests.Backfill_WithItsCursorRowMissing_StartsFromTheBeginningAsync}
- **Idempotent.** Each row is computed whole from the stream's events and written over whatever is there, so running
  the backfill again writes the same rows. A row a live append created before the backfill reached its stream (it knew
  only that append) is corrected the same way.
  {verified: StreamLifecycleBackfillSqlTests.Backfill_RunAgainFromTheStart_WritesTheSameRowsAsync, StreamLifecycleBackfillSqlTests.Backfill_CorrectsARowALiveAppendCreatedBeforeItArrivedAsync}
- **Exact.** A batch takes each of its streams' append locks, in stream id order as the emit chain does, before it reads
  them, so an append in flight commits first and is counted.
  {verified: StreamLifecycleBackfillSqlTests.Backfill_TakesEachStreamsAppendLock_SoAnAppendInFlightIsNeverMissedAsync}
- **One instance at a time, never waiting.** The batch locks the cursor row with `SKIP LOCKED`; an instance that finds
  it held steps aside for the cycle instead of queueing behind the other.
  {verified: StreamLifecycleBackfillSqlTests.Backfill_WhileAnotherCallerHoldsTheCursor_ReportsBusyAndWritesNothingAsync, StreamLifecycleBackfillMaintenanceStepTests.Run_WhileAnotherInstanceHoldsTheCursor_StepsAsideAsync}

Both drivers register the step (`stream-lifecycle-backfill`) with no configuration. The Dapper step finds its schema
the way the Dapper work coordinator does: the connection string's `Search Path`, else the server's `current_schema()`.
{verified: StreamLifecycleBackfillMaintenanceStepTests.ThePostgresDriver_RegistersTheStepAsync, DapperStreamLifecycleLedgerTests.AddWhizbangPostgres_RegistersTheStepAsync}

The step logs once, at Information, when a run finishes the backfill, with the number of streams that run visited. It
logs at Debug when another instance holds the cursor, and says nothing on a cycle with nothing to do.

## Tests {#tests}

| Test class | What it locks |
|---|---|
| `StreamLifecycleLedgerSqlTests` | every write path creates and advances the row; one upsert per stream per batch; heap-only updates, including a batch that rewrites every row on its pages; the hour bucket; what gets no row; no cross-stream waits; the due-stream query's plan; the state values |
| `StreamLifecycleBackfillSqlTests` | the backfill: complete, batched, resumable, idempotent, exact, gated, and the migration's marker |
| `StreamLifecycleBackfillMaintenanceStepTests` | the EF Core step: runs to completion, stops at its round limit, idle when done, steps aside when busy, registered by the driver |
| `DapperStreamLifecycleLedgerTests` | the Dapper store's direct append and the Dapper step |
| `StreamPurgeTests` | a purge removes the stream's ledger row |
| `StreamLifecycleEmitCostScenarioTests` | the cost of the ledger on the outbox emit chain, measured with and without it |

## Related

- [Event Streams](event-streams.md): truncating a stream's prefix
- [Ephemeral Events](ephemeral-events.md): streams reaped by their time to live, which the ledger leaves out
- [Purging Streams](../../operations/infrastructure/purging-streams.md)
- [Stream Integrity](../../resilience/stream-integrity.md): the origin generation
