---
title: Stream End of Life
pageType: concept
description: >-
  How Whizbang knows every stream's age, size and state without reading the event store (the stream lifecycle
  ledger, what writes it, what it costs on the append path, and the one-time backfill that seeds it), and how a stream
  is sealed, by a finalizer or a terminal event, so it refuses every later append.
version: 1.0.0
category: Core Concepts
order: 16
tags: 'event-streams, stream-lifecycle, end-of-life, archive, storage, event-store, sealing, terminal-event, finalize'
codeReferences:
  - src/Whizbang.Data.Postgres/Migrations/272_ArchivedStreamTypeIndex.sql
  - src/Whizbang.Data.Postgres/Migrations/260_StreamLifecycleLedger.sql
  - src/Whizbang.Data.Postgres/StreamLifecycleBackfill.cs
  - src/Whizbang.Data.EFCore.Postgres/StreamLifecycleBackfillMaintenanceStep.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperStreamLifecycleBackfillMaintenanceStep.cs
  - src/Whizbang.Data.EFCore.Postgres/PostgresDriverExtensions.cs
  - src/Whizbang.Data.Dapper.Postgres/ServiceCollectionExtensions.cs
  - src/Whizbang.Data.Postgres/Migrations/266_SealedStreamsRefuseAppends.sql
  - src/Whizbang.Data.Postgres/Migrations/274_DeletedArchiveIsRecordedInTheLedger.sql
  - src/Whizbang.Core/Lifecycle/IStreamFinalizer.cs
  - src/Whizbang.Core/Lifecycle/TerminalEvents.cs
  - src/Whizbang.Core/Attributes/TerminalEventAttribute.cs
  - src/Whizbang.Core/Messaging/StreamSealedException.cs
  - src/Whizbang.Data.Postgres/PostgresStreamFinalizer.cs
  - src/Whizbang.Data.Postgres/StreamSealedRefusal.cs
  - src/Whizbang.Generators/MessageTypeCatalogGenerator.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Collective/ArchivedCollectiveStreamsQueryPlanTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StreamLifecycleLedgerSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StreamLifecycleBackfillSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StreamLifecycleBackfillMaintenanceStepTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Performance/StreamLifecycleEmitCostScenarioTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Operations/StreamPurgeTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperStreamLifecycleLedgerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ArchiveStoreSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ArchivedStreamRebuildSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StreamSealingSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Performance/StreamSealingEmitCostScenarioTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperStreamSealingTests.cs
  - tests/Whizbang.Core.Tests/Messaging/StreamSealedRefusalTests.cs
  - tests/Whizbang.Core.Tests/Lifecycle/TerminalEventsTests.cs
  - tests/Whizbang.Generators.Tests/MessageTypeCatalogGeneratorTests.cs
  - tests/Whizbang.Core.Tests/Messaging/ImmediateWorkCoordinatorStrategyTests.cs
  - tests/Whizbang.Core.Tests/Messaging/ScopedWorkCoordinatorStrategyTests.cs
---

# Stream End of Life

The event store is most of a service's database, and nothing leaves it on its own. A stream that is finished, idle
for months, or past any reader's interest costs the same bytes, index entries and vacuum work as a stream written
today. Ending a stream's life (sealing it, archiving it, purging it, closing its books) starts with knowing which
streams are candidates, and answering that by reading the event store is the very cost the work exists to remove.

This page describes the part that answers it, the **stream lifecycle ledger**, and the first step of a stream's end of
life built on it: [sealing a stream](#sealing-a-stream), so it refuses every later append. Scheduled disposition,
archiving and end-of-life policies build on the same row and are added to this page as they ship.

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
| `state` | `Active`, `Sealed` or `Archived`. Every stream starts `Active`. | end-of-life work and a terminal event, never another append |
| `sealed_at` | When the stream was [sealed](#sealing-a-stream); null while it is open. | finalization or a terminal event, once |
| `sealed_reason` | Why the stream was sealed: the finalizer's reason, or the terminal event that ended it. | with `sealed_at`, once |
| `disposition_due_at` | When the stream's disposition is due; null while none is scheduled. | scheduled disposition |
| `archive_locator` | Where the [archive store](archive-store.md) put the stream's archived events. | the archive store |
| `archive_deleted_at` | When the stream's archive was [deleted](archive-store.md#deleting-an-archive); null when no archive of it ever was. Never cleared (migration 274). | the archive store's delete |
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
and `approx_bytes` keeps counting the truncated bodies. An archiving truncate goes through the
[archive store](archive-store.md#the-ledger-row), which subtracts the bytes it moved and adds them back on a restore.

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
  column changes and the page has room. So the only indexed columns besides the key are `state`,
  `disposition_due_at` and `sealed_at` (the predicate of the [sealed streams' index](#what-sealing-costs)), none of
  which an ordinary append writes, and the table has `fillfactor = 45` so each page keeps room
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

### Finding the archived streams of a type {#finding-archived-streams-by-type}

{verified: ArchivedCollectiveStreamsQueryPlanTests.ArchivedCollectiveStreams_OnALargeLedger_ReadTheArchivedStreamIndex_WithAndWithoutATenantAsync}

A collective replay lists a tenant's collective streams that are archived whole, which have no row in the hot store
(see [archived collective streams](../messaging/collective-events#archived-collective-streams)).
`idx_stream_lifecycle_archived_type` (migration 272) answers it: an index over `(stream_type, tenant)`, partial on
`state = 'Archived'`, so it holds only the archived rows the lookup asks for. A tenant is compared with `=` and no
tenant with `IS NULL`, so each lookup is a range of the index. Only an archive and a restore change a row's state, and
no append changes its type or tenant, so an append's ledger update stays heap-only.

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

## Sealing a stream {#sealing-a-stream}

Sealing is the first step of a stream's end of life: the stream keeps every event it holds and stays readable, but it
stops growing. Its lifecycle row becomes `Sealed`, with `sealed_at` and `sealed_reason`, and every later append to the
stream is refused, on every write path. A stream is sealed in one of two ways:

- a developer **finalizes** it with `IStreamFinalizer.FinalizeAsync(streamId, reason)`;
- an event whose type carries **`[TerminalEvent]`** is stored on it.

```mermaid{caption="A stream's lifecycle state: sealing stops appends, and a sealed stream that is archived and restored comes back sealed." tests=["StreamSealingSqlTests.Finalize_SealsTheStream_WithTheTimeAndTheReasonAsync", "StreamSealingSqlTests.TerminalEvent_OnTheOutbox_SealsTheStream_InTheTransactionThatStoresItAsync", "StreamSealingSqlTests.Finalize_AnArchivedStream_StaysArchived_AndARestoreReturnsItSealedAsync"]}
stateDiagram-v2
  [*] --> Active: first Sourced event
  Active --> Sealed: FinalizeAsync, or a terminal event is stored
  Active --> Archived: whole-stream archive
  Sealed --> Archived: whole-stream archive (sealed_at kept)
  Archived --> Archived: FinalizeAsync records the seal
  Archived --> Active: restore, never sealed
  Archived --> Sealed: restore, sealed
```

### Finalizing a stream {#finalizing-a-stream}

Both Postgres drivers register `IStreamFinalizer` (`PostgresStreamFinalizer`) with no configuration. Each call runs
`wh_finalize_stream` on a connection of its own, so the seal commits on its own.

```csharp{title="Finalize a stream" description="Seals an account's stream when the account is closed; every later append to it is refused." category="Core Concepts" difficulty="INTERMEDIATE" tags=["stream-lifecycle", "end-of-life", "finalize", "sealing"] tests=["StreamSealingSqlTests.Finalize_SealsTheStream_WithTheTimeAndTheReasonAsync", "StreamSealingSqlTests.Finalize_IsIdempotent_TheSecondCallKeepsTheFirstSealAsync"]}
public sealed class AccountCloser(IStreamFinalizer finalizer) {
  public async Task CloseAsync(Guid accountId, CancellationToken ct) {
    var result = await finalizer.FinalizeAsync(accountId, "Account closed by the owner", ct);
    if (result.Status == StreamFinalizeStatus.NothingToSeal) {
      // The account's stream holds no Sourced event: there was nothing to close.
    }
  }
}
```

| Status | Meaning | `SealedAt`, `Reason` |
|---|---|---|
| `Sealed` | This call sealed the stream. | this call's time and reason |
| `AlreadySealed` | The stream was sealed before; nothing changed. | the first seal's time and reason |
| `NothingToSeal` | The stream holds no Sourced event (never written, or ephemeral). | null |

Why it behaves this way:

| Choice | Reason | Verified |
|---|---|---|
| Finalizing is idempotent: a sealed stream keeps its first seal's time and reason and returns `AlreadySealed`. | A seal records when and why a stream ended; a retry or a second caller must not rewrite history, and must still learn that the stream is sealed. | {verified: StreamSealingSqlTests.Finalize_IsIdempotent_TheSecondCallKeepsTheFirstSealAsync, DapperStreamSealingTests.Finalize_ThroughTheRegisteredFinalizer_SealsTheStream_AndTheNextAppendThrowsAsync} |
| A reason is required: null, empty or white space throws `ArgumentException`, and the SQL function raises `22023` for a caller that is not the finalizer. | The reason is stored on the stream and carried by every refusal, so a seal without one would explain nothing to the caller it refuses. | {verified: StreamSealingSqlTests.Finalize_WithoutAReason_IsRefusedAsync} |
| The empty stream id is refused with `ArgumentException`, and the function answers `nothing_to_seal` for it. | The empty stream id means "no stream"; it holds every stream-less event, and sealing it would refuse them all. | {verified: StreamSealingSqlTests.Finalize_WithoutAReason_IsRefusedAsync, StreamSealingSqlTests.Finalize_AStreamWithNoSourcedEvent_HasNothingToSealAsync} |
| A stream with no Sourced event returns `NothingToSeal` and writes no row. | Only a stream the ledger counts can be sealed; see [ephemeral streams](#ephemeral-streams-are-never-sealed). | {verified: StreamSealingSqlTests.Finalize_AStreamWithNoSourcedEvent_HasNothingToSealAsync} |
| A stream the [backfill](#the-one-time-backfill) has not reached gets its row, built from its events by the ledger's rules, then sealed. | The seal is what refuses appends, so it must exist whether or not the backfill got there first; the backfill later rewrites the counted columns and leaves the seal alone. | {verified: StreamSealingSqlTests.Finalize_AStreamWithNoLedgerRowYet_BuildsItFromTheEvents_AndSealsItAsync} |
| The seal takes the stream's append lock (`wh_event_store:<stream id>`), the one every write path takes. | An append in flight is stored before the stream closes, and nothing is appended after it: there is no window in which a seal and an append interleave. | {verified: StreamSealingSqlTests.Finalize_WaitsForTheStreamsAppendLockAsync} |
| The seal time is the host's registered `TimeProvider` (the system clock when none is registered). | It is the clock the write paths stamp their events with, so `sealed_at` and the stream's event times compare; a test host's fake clock decides it. | {verified: StreamSealingSqlTests.ThePostgresDriver_RegistersTheFinalizer_OnItsDataSource_WithTheRegisteredClockAsync, DapperStreamSealingTests.Finalize_ThroughTheRegisteredFinalizer_SealsTheStream_AndTheNextAppendThrowsAsync} |
| An archived stream stays `Archived` and records `sealed_at` and `sealed_reason`; a [restore](archive-store.md#restoring-an-archive) returns it `Sealed`, not `Active`. | The row is the archive's tombstone, which refuses version reuse by its state; the seal is `sealed_at`, so it survives the archive, and a restore brings the events back, not the stream's life. | {verified: StreamSealingSqlTests.Finalize_AnArchivedStream_StaysArchived_AndARestoreReturnsItSealedAsync} |
| A host's own `IStreamFinalizer` registration wins (`TryAddSingleton`). | The same rule as the driver's other stores. | {verified: StreamSealingSqlTests.ThePostgresDriver_RegistersTheFinalizer_OnItsDataSource_WithTheRegisteredClockAsync} |

### Terminal events {#terminal-events}

A terminal event ends its stream. Declare it on the event type:

```csharp{title="Declare a terminal event" description="Storing an AccountClosed event seals the account's stream in the same transaction." category="Core Concepts" difficulty="BEGINNER" tags=["stream-lifecycle", "terminal-event", "sealing", "attributes"] tests=["StreamSealingSqlTests.TerminalEvent_DirectAppend_SealsTheStream_AndTheNextAppendThrowsAsync", "TerminalEventsTests.IsTerminal_AnAttributedTypeInThisAssembly_IsRegisteredByTheGeneratorAsync"]}
[TerminalEvent]
public sealed record AccountClosed([property: StreamId] Guid AccountId, string Reason) : IEvent;
```

The message-type catalog generator registers each terminal type (`TerminalEvents.Register`) and stamps it on the
catalog entry, so the dispatch path, the receive path and a direct append all stamp `EventFlags.Terminal` (bit `64`,
name `Terminal`) without reflection. The path that stores the event seals the stream in the same statement, with
`sealed_reason = 'Terminal event <type> (event <id>)'`.

| Choice | Reason | Verified |
|---|---|---|
| The event and the seal commit together: a rollback undoes both. | There is never a stored terminal event on an open stream, or a sealed stream without the event that sealed it. | {verified: StreamSealingSqlTests.TerminalEvent_OnTheOutbox_SealsTheStream_InTheTransactionThatStoresItAsync} |
| An event that sorts after the terminal event in the same write (version order is message id order) is refused, as if the stream had been sealed before the write. | The terminal event takes the stream's last version; anything after it would be an append to an ended stream, however the batch happened to group them. | {verified: StreamSealingSqlTests.OutboxBatch_EventsAfterATerminalEvent_AreDeadLettered_AndTheOnesBeforeItAreStoredAsync} |
| The attribute is inherited: an event derived from a terminal event is terminal. | A specialization of an ending event still ends the stream. | {verified: MessageTypeCatalogGeneratorTests.Generator_TerminalEvent_StampsTheEntryAndRegistersTheTypeAsync, TerminalEventsTests.IsTerminal_AnAttributedTypeInThisAssembly_IsRegisteredByTheGeneratorAsync} |
| `[TerminalEvent]` on a command does nothing. | A command is never stored on a stream, so it cannot end one. | {verified: MessageTypeCatalogGeneratorTests.Generator_TerminalEvent_StampsTheEntryAndRegistersTheTypeAsync} |
| A received terminal event seals the receiver's copy of its stream. | The receiving service stores the producer's stream; once the producer's stream has ended, its copy has too. The receive path reads the flag from the receiver's catalog by type name, because a received payload is JSON. | {verified: StreamSealingSqlTests.TerminalEvent_OnTheInbox_SealsTheStream_AndLaterRowsAreRefusedAsync, EventFlagsDeriverTests.Derive_ByWireName_ATerminalTypeTheCatalogKnows_CarriesTheTerminalBitAsync, EventMarkerResolverCoverageTests.Resolve_ATerminalEntry_StampsTheTerminalBit_AndAPlainEntryDoesNotAsync} |
| A direct append keeps the terminal bit with the kind bits it stores. | `wh_append_event` seals on it; the routing bits stay out, because a direct append creates no routing work. | {verified: DirectAppendKindTests.Of_ATerminalEvent_KeepsTheTerminalBitAsync, DapperStreamSealingTests.AppendAsync_TerminalEvent_SealsTheStream_AndTheNextAppendThrowsStreamSealedExceptionAsync} |
| A flags value written as names reads `Terminal` in any naming policy. | Writers that serialize `EventFlags` as names must not have the bit refused (#1612). | {verified: StringEventFlagsStoreTests.StoreOutbox_FlagsWrittenAsNames_KeepsEveryBitAsync} |

### A sealed stream refuses appends {#a-sealed-stream-refuses-appends}

Every write path checks the seal under the stream's append lock, before it stores:

| Path | What happens to an event on a sealed stream | Verified |
|---|---|---|
| A direct append (`IEventStore.AppendAsync`, both drivers) | `wh_append_event` raises SQLSTATE `WHS01`, which the store rethrows as `StreamSealedException` (`StreamId`, `SealedAt`, `Reason`). Nothing is stored. | {verified: StreamSealingSqlTests.DirectAppend_ToASealedStream_ThrowsStreamSealedException_AndStoresNothingAsync, DapperStreamSealingTests.AppendAsync_TerminalEvent_SealsTheStream_AndTheNextAppendThrowsStreamSealedExceptionAsync} |
| An outbox write its caller awaits (the immediate and scoped strategies' flush, which the dispatcher awaits) | `store_outbox_messages` raises SQLSTATE `WHS01`, which both coordinators rethrow as `StreamSealedException`; the whole write rolls back and the strategy withdraws it, as it does a [mixed-stream refusal](../../operations/diagnostics/whiz133.md). | {verified: StreamSealingSqlTests.StoreOutboxMessages_AnAwaitedWriteToASealedStream_ThrowsStreamSealedException_AndStoresNothingAsync, StreamSealingSqlTests.StoreOutboxMessages_AnAwaitedWriteAfterATerminalEventInTheSameWrite_ThrowsAsync, DapperStreamSealingTests.StoreOutboxMessagesAsync_AnAwaitedWriteToASealedStream_ThrowsStreamSealedExceptionAsync, ImmediateWorkCoordinatorStrategyTests.FlushAsync_RefusedForASealedStream_TheNextFlushDoesNotWriteTheRefusedWorkAsync, ScopedWorkCoordinatorStrategyTests.FlushAsync_RefusedForASealedStream_DisposalDoesNotWriteTheRefusedWorkAsync} |
| Any other outbox write (`_emit_event_store_chain`: the batch flushes, the handler commit, dead-letter recovery) | The refused event alone is moved to the dead-letter queue with reason `StreamSealed` (25); the rest of the batch is stored. | {verified: StreamSealingSqlTests.OutboxAppend_ToASealedStream_DeadLettersThatEvent_AndTheRestOfTheBatchCommitsAsync, StreamSealingSqlTests.StoreOutboxMessages_ToASealedStream_DeadLettersTheEvent_ThroughTheCoordinatorAsync, DapperStreamSealingTests.StoreOutboxMessagesAsync_ToASealedStream_DeadLettersTheEvent_AndStoresTheRestAsync} |
| The inbox (`_emit_event_store_chain_for_inbox`) | The refused row is recorded in the dead-letter queue with reason `StreamSealed` and its lease row is completed in place; the claim's other rows are stored. | {verified: StreamSealingSqlTests.InboxAppend_ToASealedStream_DeadLettersTheRow_AndStoresTheRestAsync} |

The exception's message and the dead letter's error text are the same words:

```text
Stream 0199f0a1-0000-7000-8000-000000000001 was sealed at 2026-10-29T12:10:00.000000Z and refuses appends. Reason: Account closed by the owner
```

| Choice | Reason | Verified |
|---|---|---|
| The outbox and inbox refuse per event, never per batch. | One sealed stream must not take other streams' events down with it. The archive tombstone's guard raises from a statement trigger (`WHA01`) and fails the whole batch; this check sits in the emit chains instead, so it can dead-letter one event and store the rest. | {verified: StreamSealingSqlTests.OutboxAppend_ToASealedStream_DeadLettersThatEvent_AndTheRestOfTheBatchCommitsAsync, StreamSealingSqlTests.InboxAppend_ToASealedStream_DeadLettersTheRow_AndStoresTheRestAsync} |
| The check is in the emit chain itself, not only in its callers. | Every outbox writer reaches the event store through the chain, so none can go around the check. | {verified: StreamSealingSqlTests.StoreOutboxMessages_ToASealedStream_DeadLettersTheEvent_ThroughTheCoordinatorAsync, StreamSealingSqlTests.OutboxAppend_ToASealedStream_DeadLettersThatEvent_AndTheRestOfTheBatchCommitsAsync} |
| A write whose caller awaits it raises; a write nobody awaits is dead-lettered. | Who is told depends on who is waiting, as for the [mixed-stream refusal](../../operations/diagnostics/whiz133.md): a caller that awaits the write can act on the exception (it carries the stream, the seal time and the reason), so it gets it and nothing of the write is kept; a background write has no caller to tell, so the refused event goes where an operator sees it and the rest of the batch is not held hostage. The awaited flush's flag (`OutboxMessage.RaiseOnMixedStream`, set by the immediate and scoped strategies) asks for both raises. An awaited event that is both sealed and mixed is reported as sealed. | {verified: StreamSealingSqlTests.StoreOutboxMessages_AnAwaitedWriteToASealedStream_ThrowsStreamSealedException_AndStoresNothingAsync, StreamSealingSqlTests.StoreOutboxMessages_TheSameWriteNotAwaited_IsDeadLettered_AndAnAwaitedWriteToAnOpenStreamIsStoredAsync} |
| An awaited write's control: the same awaited write to an open stream is stored. | Proves the raise is the seal's doing, not the flag's. | {verified: StreamSealingSqlTests.StoreOutboxMessages_TheSameWriteNotAwaited_IsDeadLettered_AndAnAwaitedWriteToAnOpenStreamIsStoredAsync} |
| The strategy withdraws a write refused for a sealed stream instead of offering it to a later flush or the disposal safety net. | A sealed stream refuses the same write every time; keeping it would fail every later flush. | {verified: ImmediateWorkCoordinatorStrategyTests.FlushAsync_RefusedForASealedStream_TheNextFlushDoesNotWriteTheRefusedWorkAsync, ScopedWorkCoordinatorStrategyTests.FlushAsync_RefusedForASealedStream_DisposalDoesNotWriteTheRefusedWorkAsync} |
| `StreamSealed` dead letters are held for review, never retried. | A sealed stream refuses the same event every time it is re-driven. | {verified: DefaultDeadLetterRecoveryPolicyTests.GetPolicy_StreamSealed_HoldsForReviewWithoutRetryAsync} |
| The message ends with the reason; the time is UTC to the microsecond. | `StreamSealedException` reads its three fields back from the message (the detail is redacted by Npgsql by default), so the reason may hold any text and the time reads back exactly as the ledger holds it. A message in another shape keeps its text and leaves the fields empty. | {verified: StreamSealedRefusalTests.RunAsync_StoreRefusesASealedStream_ThrowsStreamSealedException_WithTheStreamTimeAndReasonAsync, StreamSealedRefusalTests.ToException_AMessageWithoutTheExpectedShape_KeepsTheMessage_AndLeavesTheFieldsEmptyAsync} |
| The seal is `sealed_at`, not the state. | A sealed stream that is archived reads `Archived` and still refuses appends after a restore. | {verified: StreamSealingSqlTests.Finalize_AnArchivedStream_StaysArchived_AndARestoreReturnsItSealedAsync} |

### Ephemeral streams are never sealed {#ephemeral-streams-are-never-sealed}

An ephemeral stream has no lifecycle row ([what gets no row](#what-gets-no-row)), so there is nothing to seal: it
ends by its time to live. Finalizing one returns `NothingToSeal`, and the terminal flag on an ephemeral event (or a
compaction origin) seals nothing and refuses nothing after it.
{verified: StreamSealingSqlTests.Finalize_AStreamWithNoSourcedEvent_HasNothingToSealAsync, StreamSealingSqlTests.TerminalFlag_OnAnEphemeralEvent_SealsNothingAsync}

### What sealing costs {#what-sealing-costs}

Every append asks "is a stream of this batch sealed?" before it stores. `idx_stream_lifecycle_sealed` answers it: a
partial index on `stream_id` holding only the sealed streams, so the probe is as small as the number of sealed
streams, whatever the size of the ledger. The index is partial on `sealed_at`, which an append never writes, so an
append's ledger update stays heap-only. The outbox chain notes whether the batch carries a terminal event in the read
that finds the batch's streams for their locks, so nothing re-reads the batch; only a batch with a sealed stream or a
terminal event pays for the refusal. Since migration 271 the same probe also answers whether a stream of the batch is
[archived](archive-store#appending-to-an-archived-stream): it reads `idx_stream_lifecycle_closed`, a partial index holding
the sealed and the archived streams, in place of `idx_stream_lifecycle_sealed`, so the check still costs one probe per
stream of the batch.
{verified: StreamSealingSqlTests.SealedProbe_ReadsOnlyThePartialIndexOfSealedStreamsAsync, StreamLifecycleLedgerSqlTests.AppendWithinTheHour_IsAHeapOnlyUpdate_WhileAnIndexedColumnChangeIsNotAsync, StreamLifecycleLedgerSqlTests.TheLedger_IndexesOnlyItsKeyStateAndDueTime_AndLeavesRoomOnEachPageAsync}

Measured as the ledger was ([What it costs](#what-it-costs)): the same 500-event batches through the outbox chain with
the check (migration 266) and without it (migration 260), alternating three rounds, with 2,000 sealed streams in the
ledger besides and none of them in the batches. Medians:

| Batch | Blocks before | Blocks after | The check's probe | Execution before | Execution after |
|---|---|---|---|---|---|
| 50 streams that already have rows, 10 events each | 32,348 | 32,356 | 2 blocks | 63.8 ms | 66.1 ms |
| 500 new streams, 1 event each | 36,526 | 36,418 | 201 blocks | 68.6 ms | 70.1 ms |

The whole chain's block counts move between rounds by more than the check costs (the ledger's own blocks vary by a few
dozen from one round to the next, because each round appends to other streams), so the probe is also measured on its own
with `EXPLAIN (ANALYZE, BUFFERS)`: 2 blocks for a batch of 50 streams and 201 for a batch of 500 new ones, under 0.6% of
the batch's blocks, and never anything per event or anything in the event store. The scenario gates on that: at most two
blocks per stream in the batch. The execution times are server-side, on a build server, and are reported for scale only.

{verified: StreamSealingEmitCostScenarioTests.EmitChain_WithAndWithoutTheSealCheck_ReportAsync}

## Tests {#tests}

| Test class | What it locks |
|---|---|
| `StreamLifecycleLedgerSqlTests` | every write path creates and advances the row; one upsert per stream per batch; heap-only updates, including a batch that rewrites every row on its pages; the hour bucket; what gets no row; no cross-stream waits; the due-stream query's plan; the state values |
| `StreamLifecycleBackfillSqlTests` | the backfill: complete, batched, resumable, idempotent, exact, gated, and the migration's marker |
| `StreamLifecycleBackfillMaintenanceStepTests` | the EF Core step: runs to completion, stops at its round limit, idle when done, steps aside when busy, registered by the driver |
| `DapperStreamLifecycleLedgerTests` | the Dapper store's direct append and the Dapper step |
| `StreamPurgeTests` | a purge removes the stream's ledger row |
| `ArchiveStoreSqlTests` | the archive store's tombstone, built from the events when the stream has no row yet; `approx_bytes` after an archive and a restore |
| `StreamLifecycleEmitCostScenarioTests` | the cost of the ledger on the outbox emit chain, measured with and without it |
| `StreamSealingSqlTests` | finalizing (idempotent, reason required, nothing to seal, the backfill's missing row, the append lock, archived streams, the driver's registration and clock); terminal events on every path; the refusal on every path, per event; the sealed streams' index |
| `DapperStreamSealingTests` | the Dapper store's refusal and terminal seal, the registered finalizer, and the Dapper coordinator's dead letter |
| `StreamSealedRefusalTests` | `StreamSealedException` read back from the store's refusal, and from a message in another shape |
| `TerminalEventsTests`, `MessageTypeCatalogGeneratorTests` | `[TerminalEvent]` registered by the generator, inherited, never on a command |
| `StreamSealingEmitCostScenarioTests` | the cost of the sealed-stream check on the outbox emit chain, measured with and without it |

## Related

- [Event Streams](event-streams.md): truncating a stream's prefix
- [Ephemeral Events](ephemeral-events.md): streams reaped by their time to live, which the ledger leaves out
- [Purging Streams](../../operations/infrastructure/purging-streams.md)
- [Stream Integrity](../../resilience/stream-integrity.md): the origin generation
- [Archive Store](archive-store.md): where archived events go, the tombstone an archived stream keeps, and the restore
