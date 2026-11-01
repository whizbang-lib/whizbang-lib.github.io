---
title: Archive Store
pageType: concept
version: 1.0.0
category: Core Concepts
order: 17
description: >-
  IArchiveStore moves a stream's events out of the hot event store and back: copy then truncate in one
  transaction, a byte-identical read in version order, a tombstone that refuses version reuse, and an exact restore.
  The Postgres-table store is built in; the Azure Blob store is the production default.
tags: 'archive, archive-store, stream-end-of-life, tombstone, origin-generation, wh_event_archive, azure-blob, brotli, wh_archive_manifest, read-through, restore-request, append-to-archived'
codeReferences:
  - src/Whizbang.Core/Archival/IArchiveStore.cs
  - src/Whizbang.Core/Archival/ArchiveBatch.cs
  - src/Whizbang.Core/Archival/ArchiveLocator.cs
  - src/Whizbang.Core/Archival/ArchiveResults.cs
  - src/Whizbang.Core/Lifecycle/StreamPrefixTruncator.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Data.Postgres/PostgresTableArchiveStore.cs
  - src/Whizbang.Data.Postgres/Migrations/262_ArchiveStoreKeepsATombstone.sql
  - src/Whizbang.Data.EFCore.Postgres/PostgresDriverExtensions.cs
  - src/Whizbang.Data.Dapper.Postgres/ServiceCollectionExtensions.cs
  - src/Whizbang.Data.Postgres/PostgresArchiveConnection.cs
  - src/Whizbang.Data.Postgres/Migrations/268_ArchiveManifest.sql
  - src/Whizbang.Data.Postgres/Migrations/269_ArchiveObjectDeletionQueue.sql
  - src/Whizbang.Archive.AzureBlob/AzureBlobArchiveStore.cs
  - src/Whizbang.Archive.AzureBlob/AzureBlobArchiveOptions.cs
  - src/Whizbang.Archive.AzureBlob/AzureBlobArchiveServiceCollectionExtensions.cs
  - src/Whizbang.Archive.AzureBlob/ArchiveChunk.cs
  - src/Whizbang.Archive.AzureBlob/ArchiveObjectCorruptedException.cs
  - src/Whizbang.Archive.AzureBlob/ArchiveObjectDeletionStep.cs
  - src/Whizbang.Data.Postgres/Migrations/271_ArchiveReadThroughAndAppendPolicy.sql
  - src/Whizbang.Core/Archival/ArchiveAwareEventStoreDecorator.cs
  - src/Whizbang.Core/Archival/ArchivedStreamAutoRestore.cs
  - src/Whizbang.Core/Archival/AppendToArchivedPolicy.cs
  - src/Whizbang.Core/Archival/StreamArchivedException.cs
  - src/Whizbang.Core/Archival/ArchiveOptions.cs
  - src/Whizbang.Core/Archival/StreamLifecycleOptions.cs
  - src/Whizbang.Core/Archival/ArchiveOptionsBinder.cs
  - src/Whizbang.Core/Archival/StreamTypePolicy.cs
  - src/Whizbang.Data.Postgres/StreamArchivedRefusal.cs
  - src/Whizbang.Data.Postgres/StreamTypePolicyWriter.cs
  - src/Whizbang.Data.Postgres/ArchiveRestoreRequestStep.cs
  - src/Whizbang.Data.Postgres/SnapshotStreamOrderLookup.cs
  - src/Whizbang.Core/Perspectives/RebuildArchivedData.cs
  - src/Whizbang.Data.Postgres/Migrations/272_ArchivedStreamTypeIndex.sql
  - src/Whizbang.Data.Postgres/Migrations/273_RebuildParksTheCursorOfAStreamArchivedWhole.sql
  - src/Whizbang.Data.Postgres/Migrations/274_DeletedArchiveIsRecordedInTheLedger.sql
  - src/Whizbang.Data.Postgres/PostgresArchivedStreamExtents.cs
  - src/Whizbang.Data.Postgres/Collective/ArchivedCollectiveStreams.cs
  - src/Whizbang.Data.Postgres/Collective/CollectiveReplayApplier.cs
  - src/Whizbang.Data.Postgres/PostgresDeadLetterRecoveryService.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StreamSealingSqlTests.cs
  - tests/Whizbang.Core.Tests/Archival/ArchiveBatchTests.cs
  - tests/Whizbang.Core.Tests/Archival/ArchiveLocatorTests.cs
  - tests/Whizbang.Core.Tests/Lifecycle/StreamPrefixTruncatorArchiveStoreTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ArchiveStoreSqlTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperArchiveStoreTests.cs
  - tests/Whizbang.Archive.AzureBlob.Tests/ArchiveChunkTests.cs
  - tests/Whizbang.Archive.AzureBlob.Tests/AzureBlobArchiveRegistrationTests.cs
  - tests/Whizbang.Archive.AzureBlob.Tests/ArchiveObjectCorruptedExceptionTests.cs
  - tests/Whizbang.Archive.AzureBlob.Integration.Tests/AzureBlobArchiveStoreTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ArchiveAppendPolicySqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ArchiveRulesSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ArchiveRestoreRequestSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/ArchiveReadThroughIntegrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Performance/ArchivedStreamEmitCostScenarioTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperArchiveAppendPolicyTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperArchiveReadThroughTests.cs
  - tests/Whizbang.Core.Tests/Archival/ArchiveAwareEventStoreDecoratorTests.cs
  - tests/Whizbang.Core.Tests/Archival/ArchiveReadThroughRegistrationTests.cs
  - tests/Whizbang.Core.Tests/Archival/StreamArchivedRefusalTests.cs
  - tests/Whizbang.Core.Tests/Archival/StreamLifecycleOptionsBinderTests.cs
  - tests/Whizbang.Core.Tests/Workers/MaintenanceWorkerStreamTypePolicySyncTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/PerspectiveRewindWriteCheckTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/PerspectiveRebuilderArchivedDataTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ArchivedStreamRebuildSqlTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperArchivedStreamRebuildTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperArchiveRestoreRedriveTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/Collective/DapperArchivedCollectiveReplayTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Collective/CollectiveReplayOrderingTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Collective/ArchivedCollectiveStreamsQueryPlanTests.cs
---

# Archive Store

A finished or long-idle stream costs the same bytes, index entries and vacuum work in the hot event store as a
stream written today. `IArchiveStore` moves a stream's events out of the hot store and keeps them readable, so hot
storage holds only streams someone still reads. It is the storage half of
[stream end-of-life](stream-end-of-life): the lifecycle decides *when* a stream is archived, the archive store
decides *where its events go and how they come back*.

The framework ships two stores. The **Postgres-table store** (`wh_event_archive` in the service's own database) is
registered by both Postgres drivers, so archiving works with no setup. The **[Azure Blob store](#the-azure-blob-store)**
(package `Whizbang.Archive.AzureBlob`) is the production default: it moves archived events out of the database into
Brotli-compressed objects, and a host opts in with one registration call that replaces the table store.

## The contract

```csharp{
title: "IArchiveStore"
description: "The four operations every archive store implements: write a batch, read it back, restore it, delete it."
framework: "NET10"
category: "Core Concepts"
difficulty: "INTERMEDIATE"
tags: ["archive", "archive-store", "event-store", "stream-end-of-life"]
unverified: "interface declaration; each member is verified in its own section below"
}
public interface IArchiveStore {
  Task<ArchiveWriteResult> WriteAsync(ArchiveBatch batch, CancellationToken cancellationToken = default);
  IAsyncEnumerable<ArchivedEvent> ReadAsync(Guid streamId, long fromVersion = 0, CancellationToken cancellationToken = default);
  Task<ArchiveRestoreResult> RestoreAsync(Guid streamId, CancellationToken cancellationToken = default);
  Task<long> DeleteAsync(Guid streamId, CancellationToken cancellationToken = default);
}
```

Every store keeps four promises:

| Promise | Why | Verified |
|---|---|---|
| A write copies, then truncates, and either both happen or neither does. | A failure must never lose an event or leave it half-archived; the stream stays fully hot. | {verified: ArchiveStoreSqlTests.Write_AFailureBetweenCopyAndTruncate_LeavesTheStreamFullyHotAsync} |
| Every successful write bumps the origin generation. | Archiving changes the history a digest folds; without the bump, stream integrity would alarm on a deliberate change. | {verified: ArchiveStoreSqlTests.Write_WholeStream_LeavesATombstone_AndBumpsTheOriginGenerationAsync} |
| A whole-stream write leaves a tombstone, and no append reuses a version at or below its last version. | Downstream consumers saw those versions; a second event at the same version would make every reader of the stream wrong. | {verified: ArchiveStoreSqlTests.Tombstone_AnAppendAtOrBelowTheArchivedVersion_IsRefused_AboveItIsStoredAsync, ArchiveAppendPolicySqlTests.OutboxAppend_Refuse_DeadLettersThatEvent_AndTheRestOfTheBatchCommitsAsync} |
| A read returns each event exactly as the hot store held it, in version order. | Read-through, rewind and rebuild must produce the same model from an archived stream as from a hot one. | {verified: ArchiveStoreSqlTests.Write_ThenRead_ReturnsTheEventsByteIdenticalInVersionOrderAsync} |

## Batches

{verified: ArchiveBatchTests.Prefix_CarriesItsVersion_AndIsNotAWholeStreamBatchAsync, ArchiveBatchTests.WholeStream_HasNoVersion_AndSaysSoAsync}

An `ArchiveBatch` is **one stream**, and either a **prefix** through a version or the **whole stream**:

```csharp{
title: "Archive a prefix, or a whole stream"
description: "ArchiveBatch.Prefix keeps the truncate's carry-forward guard; ArchiveBatch.WholeStream archives every event and leaves a tombstone."
framework: "NET10"
category: "Core Concepts"
difficulty: "INTERMEDIATE"
tags: ["archive", "archive-batch", "tombstone", "prefix-truncate"]
tests: ["ArchiveStoreSqlTests.Write_ARefusedPrefix_KeepsTheTruncatesStatus_AndCopiesNothingAsync", "ArchiveStoreSqlTests.Write_WholeStream_LeavesATombstone_AndBumpsTheOriginGenerationAsync"]
}
var prefix = await archive.WriteAsync(ArchiveBatch.Prefix(streamId, throughVersion: 120));
var whole = await archive.WriteAsync(ArchiveBatch.WholeStream(streamId));

if (!whole.Archived) {
  logger.LogInformation("Stream {StreamId} kept hot: {Status}", streamId, whole.Status);
}
```

| Choice | Reason | Verified |
|---|---|---|
| A batch never spans streams. | The stream is the unit the archive keeps atomic and the unit a tombstone describes; a sweep sends one batch per stream, so one stream's refusal never holds back another's. | {verified: ArchiveBatchTests.Prefix_CarriesItsVersion_AndIsNotAWholeStreamBatchAsync} |
| Prefix and whole stream are separate requests, not "through the last version". | A prefix keeps the truncate's carry-forward guard, so it can never empty a stream by accident; only an explicit whole-stream request leaves a tombstone. | {verified: ArchiveStoreSqlTests.Write_ARefusedPrefix_KeepsTheTruncatesStatus_AndCopiesNothingAsync} |
| A prefix version of 0 is accepted by the batch, a negative one refused; the store then refuses any prefix below version 1 with `not_past_first_version`. | A negative version names nothing. A version of 0 is a real position (a stream a direct append created before migration 267 started there; see [Stream versions](event-store#stream-versions)), but a prefix through it would keep version 1 hot, and [read-through](#read-through) relies on every prefix archive removing version 1 (see [the archive rules](#the-archive-rules)). | {verified: ArchiveBatchTests.Prefix_AcceptsVersionZero_RefusesANegativeVersionAsync, ArchiveRulesSqlTests.Prefix_ThroughAVersionBelowOne_IsRefused_ThroughOneIsArchivedAsync} |
| The empty stream id is refused. | It is the store's "no stream" row (commands, unstreamed events); archiving it would sweep unrelated events. | {verified: ArchiveBatchTests.TheEmptyStreamId_IsRefusedByBothFormsAsync} |
| Chunking is the store's concern. | The Postgres store copies a batch in one statement; a blob store writes as many chunks as it needs before it truncates. The batch stays the same for both. | {verified: ArchiveStoreSqlTests.Write_ThenRead_ReturnsTheEventsByteIdenticalInVersionOrderAsync} |

## Writing an archive

{verified: ArchiveStoreSqlTests.Write_WholeStream_LeavesATombstone_AndBumpsTheOriginGenerationAsync}

`WriteAsync` returns an `ArchiveWriteResult`: the status, how many events moved, the tombstone's last version (whole
stream only), the locator and the origin generation after the write.

### A prefix

The prefix is copied into the archive, then the [gated prefix truncate](event-streams#truncating-a-stream-prefix)
runs with every guard it has: the consumption gate, the carry-forward guard, the hold guard and the cursor guard. If
the truncate refuses, the copy is undone in the same call and the truncate's own status is returned (`blocked`,
`no_carry_forward`, `held`, `cursor_behind`), so a caller reads one vocabulary whether it truncates or archives.
Cursors move onto the first surviving event and stranded snapshots go, exactly as the truncate does them. The stream
stays active; its lifecycle row records the locator so a reader can find the archived prefix.
{verified: ArchiveStoreSqlTests.Write_ARefusedPrefix_KeepsTheTruncatesStatus_AndCopiesNothingAsync}

### The whole stream

There is no surviving event for cursors to move onto, so a whole-stream write keeps two guards and handles the rest
itself:

| Choice | Reason | Verified |
|---|---|---|
| Refused with `blocked` while any perspective owes an event of the stream. | An archived event cannot be applied; unfinished work would be lost. | {verified: ArchiveStoreSqlTests.Write_WholeStream_UnprocessedWorkOrAnActiveHold_RefusesAndMovesNothingAsync} |
| Refused with `held` while an active destruction hold covers an event; a lapsed hold does not block and is removed. | A hold is a recorded decision to keep that event hot until its time passes. | {verified: ArchiveStoreSqlTests.Write_WholeStream_UnprocessedWorkOrAnActiveHold_RefusesAndMovesNothingAsync} |
| No carry-forward guard. | Emptying the stream is the point of a whole-stream request; the tombstone carries the stream's identity and last version instead. | {verified: ArchiveStoreSqlTests.Write_WholeStream_LeavesATombstone_AndBumpsTheOriginGenerationAsync} |
| Perspective cursors are parked in `wh_event_archive_cursors` as whole rows, and a restore puts them back. | No event is left for a cursor to point at (the EF Core schema's `fk_perspective_cursors_event` would refuse the delete), and dropping the cursor would make a restored perspective re-apply everything. | {verified: ArchiveStoreSqlTests.Write_WholeStream_LeavesATombstone_AndBumpsTheOriginGenerationAsync, DapperArchiveStoreTests.WholeStream_OnADapperMigratedDatabase_ArchivesAndRestoresAsync} |
| A rebuild of the stream while it is archived (only under `RebuildArchivedData.IncludeAll`) writes its cursor to the parked row, not to `wh_perspective_cursors`: `wh_complete_rebuilt_cursor` (migration 273) moves the parked cursor to the rebuilt event, or parks a new one, on both drivers. | The rebuilt cursor names an archived event, which the live table must not name; parked, it keeps its exact position and the restore brings it back with the events it names. See [the parked cursor](../perspectives/rebuild#archived-data-parked-cursor). | {verified: ArchivedStreamRebuildSqlTests.Completer_TheCursorOfAStreamArchivedWhole_IsParked_AndTheRestoreBringsItBackAsync, DapperArchivedStreamRebuildTests.Completer_TheCursorOfAStreamArchivedWhole_IsParked_AndTheRestoreBringsItBackAsync, ArchiveReadThroughIntegrationTests.Rebuild_IncludeAll_RebuildsAStreamArchivedWhole_ParksItsCursor_AndTheRestoreBringsTheCursorBackAsync} |
| Snapshots are kept. | They still describe the stream, and a later generation of it can start from the final snapshot. | {verified: ArchiveStoreSqlTests.Write_WholeStream_LeavesATombstone_AndBumpsTheOriginGenerationAsync} |
| The stream's digest buckets are removed outright, not subtracted. | Every event of the stream leaves, so every bucket is empty; subtracting would have to repeat each fold rule exactly, and a restore folds them back. | {verified: ArchiveStoreSqlTests.Write_WholeStream_LeavesATombstone_AndBumpsTheOriginGenerationAsync} |
| Finished work rows and lapsed holds of the stream are removed. | Finished work is history, and the guards above proved nothing unfinished is left. | {verified: ArchiveStoreSqlTests.Write_WholeStream_UnprocessedWorkOrAnActiveHold_RefusesAndMovesNothingAsync} |

### Outcomes every write shares

| Choice | Reason | Verified |
|---|---|---|
| The write takes the stream's append lock (the one the emit chains and the direct append take). | Nothing may be appended to the stream while it moves, or an event appended mid-archive could be left hot under a tombstone. | {verified: ArchiveStoreSqlTests.Write_WaitsForTheStreamsAppendLock_SoNothingIsAppendedWhileItMovesAsync} |
| Every archive bumps the origin generation once; a prefix whose truncate already bumped it moves it twice. | Integrity consumers reset their seals once per change they observe, so a second bump costs nothing, and a missing one would alarm. | {verified: ArchiveStoreSqlTests.Write_WholeStream_LeavesATombstone_AndBumpsTheOriginGenerationAsync} |
| A batch that names no hot event returns `nothing_to_archive` and bumps nothing. | Nothing moved, so integrity has nothing to re-verify; archiving twice is harmless. | {verified: ArchiveStoreSqlTests.Write_NothingHot_ReportsNothingToArchive_AndBumpsNothingAsync} |
| Under `debug_mode` every write returns `debug_skipped`. | Debug mode keeps forensic history, as it does for the truncate and the reaper. | {verified: ArchiveStoreSqlTests.Write_DebugMode_KeepsEverythingHotAsync} |
| A failure anywhere between the copy and the truncate rolls back both, and the generation is unchanged. | The copy and the truncate run in one transaction, so the detail is never lost and never half-archived. | {verified: ArchiveStoreSqlTests.Write_AFailureBetweenCopyAndTruncate_LeavesTheStreamFullyHotAsync} |

## The archive rules {#the-archive-rules}

{verified: ArchiveRulesSqlTests.Prefix_ThroughAVersionBelowOne_IsRefused_ThroughOneIsArchivedAsync, ArchiveRulesSqlTests.Prefix_ReachingAPerspectivesNewestSnapshot_IsRefused_StoppingBelowItIsArchivedAsync}

Two rules make [read-through](#read-through) cheap and a rewind to the latest snapshot independent of the archive. Both
are enforced by `wh_archive_stream` (migration 271), so every store that writes through it, the Postgres-table store
and the Azure Blob store alike, keeps them.

| Choice | Reason | Verified |
|---|---|---|
| A prefix always removes version 1: a prefix through a version below 1 is refused with `not_past_first_version`, and a prefix through version 1 takes version 1, and version 0 too on a stream numbered from 0. | A stream's first version is 1 on every write path, or 0 on a stream a direct append created before that change. With version 1 always archived, an archived stream always shows a gap at its start (its first hot version is above 1, or it has none), so a read from the start can tell it is archived from what it already read, without asking the archive. | {verified: ArchiveRulesSqlTests.Prefix_ThroughAVersionBelowOne_IsRefused_OnAStreamThatStartsAtOneAsync, ArchiveRulesSqlTests.Prefix_ThroughAVersionBelowOne_IsRefused_ThroughOneIsArchivedAsync, ArchiveAwareEventStoreDecoratorTests.AReadFromTheStart_OfALegacyStreamThatStartsAtZero_ArchivedThroughOne_ReadsThroughTheGapAsync} |
| A prefix never includes the newest snapshot any perspective holds for the stream: one that reaches it is refused with `snapshot_in_range` and moves nothing. | The snapshot's event and everything after it stay hot, so a rewind to a perspective's latest snapshot never needs the archive. | {verified: ArchiveRulesSqlTests.Prefix_ReachingAPerspectivesNewestSnapshot_IsRefused_StoppingBelowItIsArchivedAsync} |
| Refused, not shortened. | The caller gets exactly the archive it asked for or none, and chooses a cut below the snapshot itself; an archive that quietly moved less than asked would make the caller's own bookkeeping (and a later lifecycle policy's) wrong. | {verified: ArchiveRulesSqlTests.Prefix_ReachingAPerspectivesNewestSnapshot_IsRefused_StoppingBelowItIsArchivedAsync} |
| Only each perspective's newest snapshot counts; an older one in the range may go. | An older snapshot is not where a rewind starts; the prefix truncate removes the ones below the cut as it always has. | {verified: ArchiveRulesSqlTests.Prefix_AnOlderSnapshotInTheRange_DoesNotBlockTheCut_OnlyTheNewestPerPerspectiveDoesAsync} |
| A snapshot that records no version does not block a cut. | It cannot be placed in the stream, so no rewind selects it by version. | {verified: ArchiveRulesSqlTests.Prefix_ReachingAPerspectivesNewestSnapshot_IsRefused_StoppingBelowItIsArchivedAsync} |
| A whole-stream archive takes every event, snapshots or not. | It is the stream's end, not a cut with a hot tail; a rewind of it reads through the archive. | {verified: ArchiveRulesSqlTests.WholeStream_MarksEverySnapshotWithItsLastVersionAsync} |

### Snapshots record what an archive covers {#snapshots-record-what-an-archive-covers}

{verified: ArchiveRulesSqlTests.Prefix_MarksTheSnapshotsAtOrBelowItsCut_AndLeavesTheNewestUnmarkedAsync, ArchiveRulesSqlTests.WholeStream_MarksEverySnapshotWithItsLastVersionAsync, ArchiveRulesSqlTests.Restore_ClearsEverySnapshotsArchiveMarkAsync}

Every archive writes how far it reaches on the stream's snapshots it covers, in
`wh_perspective_snapshots.archived_through_version`, so the engine knows a rewind from one of them must read through
the archive.

| Choice | Reason | Verified |
|---|---|---|
| A prefix marks the snapshots at or below its cut with the cut; a whole stream marks all of them with its last version. | The events after a marked snapshot may be archived; after an unmarked one they are all hot. | {verified: ArchiveRulesSqlTests.Prefix_MarksTheSnapshotsAtOrBelowItsCut_AndLeavesTheNewestUnmarkedAsync, ArchiveRulesSqlTests.WholeStream_MarksEverySnapshotWithItsLastVersionAsync} |
| A restore clears the stream's marks, and only that stream's. | Everything the snapshots need is hot again. | {verified: ArchiveRulesSqlTests.Restore_ClearsEverySnapshotsArchiveMarkAsync} |
| The column is nullable with no default, added by migration 271 where the table exists and by the schema definition where it is created. | No row is rewritten, and a fresh database gets it from the start. | {verified: ArchiveRulesSqlTests.WholeStream_MarksEverySnapshotWithItsLastVersionAsync} |

## Statuses

| Status | Meaning |
|---|---|
| `archived` | The batch moved. |
| `nothing_to_archive` | The batch named no hot event. |
| `blocked`, `held`, `debug_skipped` | Refused; nothing moved. |
| `no_carry_forward`, `cursor_behind` | A prefix the truncate refused; nothing moved. |
| `not_past_first_version` | A prefix through a version below 1; nothing moved ([the archive rules](#the-archive-rules)). |
| `snapshot_in_range` | A prefix that reaches the newest snapshot a perspective holds for the stream; nothing moved ([the archive rules](#the-archive-rules)). |
| `restored`, `nothing_archived`, `version_conflict` | A restore's outcomes (below). |

## Tombstones

A whole-stream archive leaves the stream's [lifecycle](stream-end-of-life) row as its tombstone:
`state = 'Archived'`, `last_version`, `archive_locator` and `origin_generation`.
{verified: ArchiveStoreSqlTests.Write_WholeStream_LeavesATombstone_AndBumpsTheOriginGenerationAsync}

### Version reuse is refused

{verified: ArchiveStoreSqlTests.Tombstone_AnAppendAtOrBelowTheArchivedVersion_IsRefused_AboveItIsStoredAsync, ArchiveStoreSqlTests.Tombstone_TheEmitChainCannotReuseAnArchivedVersion_EitherAsync}

The emit chains and the direct append number a stream from its newest hot version. With nothing hot, the next
append would start again at the bottom and reuse a version the archive holds. Every write path therefore refuses an
append to a stream archived whole, per event, under the [policy its type declares](#appending-to-an-archived-stream).
Migration 262 refused it with a statement trigger on `wh_event_store` that failed the whole batch; migration 271
replaced the trigger with the per-event refusal below, so one archived stream never takes the other streams of a batch
down with it.

| Choice | Reason | Verified |
|---|---|---|
| A direct append to a stream archived through version N raises SQLSTATE `WHA01` naming N; once the stream is restored, the next append takes N + 1. | The archive holds the versions through N; anything above them is new history. | {verified: ArchiveStoreSqlTests.Tombstone_AnAppendAtOrBelowTheArchivedVersion_IsRefused_AboveItIsStoredAsync} |
| The emit chain dead-letters the refused event alone and stores the rest of the batch. | A batch carries events of many streams; refusing the batch for one archived stream would stall unrelated ones (262's trigger did). | {verified: ArchiveStoreSqlTests.Tombstone_TheEmitChainCannotReuseAnArchivedVersion_EitherAsync, ArchiveAppendPolicySqlTests.OutboxAppend_Refuse_DeadLettersThatEvent_AndTheRestOfTheBatchCommitsAsync} |
| A prefix-archived stream takes appends as before. | It stays `Active` with a hot tail, so it numbers from the tail and reuses nothing. | {verified: ArchiveAppendPolicySqlTests.PrefixArchivedStream_TakesAppendsAsUsual_OnEveryPathAsync} |
| The tombstone outlives a deleted archive. | The versions were seen downstream whether or not the archived copy still exists. | {verified: ArchiveStoreSqlTests.Delete_RemovesTheArchivedCopy_TheTombstoneStillBlocksReuseAsync} |

### The ledger row {#the-ledger-row}

{verified: ArchiveStoreSqlTests.Write_WholeStream_WithNoLedgerRowYet_BuildsTheTombstoneFromTheEventsAsync, ArchiveStoreSqlTests.ApproxBytes_ArchiveSubtractsWhatLeft_RestoreAddsItBackAsync}

The archive store keeps the stream's [lifecycle ledger](stream-end-of-life#the-stream-lifecycle-ledger) row true to
the hot store:

| Choice | Reason | Verified |
|---|---|---|
| A stream with no ledger row yet (the backfill has not reached it) gets one built from its events by the ledger's own rules: the first event's type, tenant and time, the UTC hour of the newest event. A stream of only ephemeral events uses its first event. | The tombstone is what refuses version reuse, so it must exist whether or not the backfill got there first; reading the same rules as the ledger keeps the row identical to the one the backfill would have written. | {verified: ArchiveStoreSqlTests.Write_WholeStream_WithNoLedgerRowYet_BuildsTheTombstoneFromTheEventsAsync} |
| A prefix archive subtracts the bytes it moved from `approx_bytes` (never below 0); a whole-stream archive sets it to 0; a restore adds the restored bytes back. | `approx_bytes` measures the hot store, which the per-tenant size policy reads; archived bytes no longer cost hot storage. Bytes are counted as stored, as the backfill counts them, so the figure stays approximate. | {verified: ArchiveStoreSqlTests.ApproxBytes_ArchiveSubtractsWhatLeft_RestoreAddsItBackAsync} |
| A restore marks the stream `Active` (`Sealed` when it was sealed) and leaves the row with the stream's newest version. | The write paths refuse an append only while the state reads `Archived`, so appends resume above the last version as soon as the restore commits. | {verified: ArchiveStoreSqlTests.Restore_PutsTheStreamBackExactly_CursorsDigestsAndPositionsIncludedAsync, ArchiveStoreSqlTests.Write_WholeStream_WithNoLedgerRowYet_BuildsTheTombstoneFromTheEventsAsync} |
| A [stream purge](../../operations/infrastructure/purging-streams) removes the archive, the parked cursors and the tombstone. | A purged stream never existed; nothing of it is left to restore or to guard. | {verified: ArchiveStoreSqlTests.Purge_AnArchivedStream_TakesItsArchiveParkedCursorsAndTombstoneAsync} |

## Locator format

{verified: ArchiveLocatorTests.ToString_WritesStoreAddressCodecAndFormat_InThatShapeAsync}

The tombstone records where an archive lives and how to read it as text:

```text
{store}://{address}?codec={codec}&format={format}
postgres-table://svc.wh_event_archive?codec=none&format=1
```

| Part | Meaning | Reason |
|---|---|---|
| `store` | The store that wrote the archive (`postgres-table`). Lowercase letters, digits and hyphens. | Once a blob store and the table store have both existed in one database, a reader must tell their archives apart. |
| `address` | Where in that store: a table for the Postgres store, a container and path for a blob store. Anything without `?`. | Each store owns its address space. It may itself contain `://`, which is why the text is not parsed as a URI (a URI parser would normalize it). |
| `codec` | How the archive's bytes are compressed: `none` or `brotli`. | Recorded per archive, so a store can change codec later without rewriting older archives. |
| `format` | The layout of the archived events, 1 or more; this release writes `1`. | The layout can change the same way. |

A locator that names an unknown codec, misses a part, or has a malformed store name is refused by
`ArchiveLocator.TryParse` rather than read as some default.
{verified: ArchiveLocatorTests.TryParse_RefusesWhatItCannotRead_RatherThanGuessingAsync, ArchiveLocatorTests.Codec_IsRecordedPerArchive_AndReadBackAsync, ArchiveLocatorTests.Address_KeepsSchemeLikeText_BecauseOnlyTheFirstSeparatorSplitsTheStoreAsync}

## Compression

| Choice | Reason | Verified |
|---|---|---|
| The Postgres-table store records `codec=none`. | Its rows keep their `jsonb` columns, which Postgres already compresses (TOAST); the copy never leaves the database; and the archive stays queryable in place by the existing readers (`GetArchivedEventsAsync`, the stream purge). | {verified: ArchiveStoreSqlTests.Write_WholeStream_LeavesATombstone_AndBumpsTheOriginGenerationAsync} |
| Brotli is the first codec for a byte-stream store, zstd later. | Brotli is in the base class library; zstd needs a new dependency. | {verified: ArchiveLocatorTests.Codec_IsRecordedPerArchive_AndReadBackAsync} |
| The Azure Blob store writes Brotli at quality 4 by default. | The measured point where more time stops buying bytes; see [its configuration](#azure-blob-configuration). | {verified: ArchiveChunkTests.Quality_IsPassedToTheEncoder_HigherQualityWritesFewerBytesAsync} |

## Reading an archive

```csharp{
title: "Read an archived stream from a version"
description: "ReadAsync streams the archived events in version order, each exactly as the hot store held it."
framework: "NET10"
category: "Core Concepts"
difficulty: "INTERMEDIATE"
tags: ["archive", "read", "byte-identical", "version-order"]
tests: ["ArchiveStoreSqlTests.Write_ThenRead_ReturnsTheEventsByteIdenticalInVersionOrderAsync"]
}
await foreach (var archived in archive.ReadAsync(streamId, fromVersion: 2)) {
  Console.WriteLine($"{archived.Version} {archived.EventType} {archived.EventDataJson}");
}
```

| Choice | Reason | Verified |
|---|---|---|
| Events come back in version order; `fromVersion` is inclusive. | Read-through serves load, rewind and rebuild, which all replay in order from a point. | {verified: ArchiveStoreSqlTests.Write_ThenRead_ReturnsTheEventsByteIdenticalInVersionOrderAsync} |
| Body, metadata and scope come back as the exact text the hot store returned. | The copy stays `jsonb` to `jsonb`, so a byte comparison between a hot read and an archived read is equal. | {verified: ArchiveStoreSqlTests.Write_ThenRead_ReturnsTheEventsByteIdenticalInVersionOrderAsync, DapperArchiveStoreTests.WholeStream_OnADapperMigratedDatabase_ArchivesAndRestoresAsync} |
| The read streams (`IAsyncEnumerable`). | A blob store reads chunk by chunk; a long stream is never held in memory whole. | {verified: ArchiveStoreSqlTests.Write_ThenRead_ReturnsTheEventsByteIdenticalInVersionOrderAsync} |
| Every pointer column comes back on `ArchivedEvent` (scope, aggregate id and type, created at, flags). | A rebuild needs them to make the same envelope the hot store would. | {verified: ArchiveStoreSqlTests.Write_ThenRead_ReturnsTheEventsByteIdenticalInVersionOrderAsync} |
| A row archived before the store kept every column reads its missing columns as null. | Rows copied by the earlier archiving truncate have no flags, and a reaped body was archived as null; a reader must see that, not a default. | {verified: ArchiveStoreSqlTests.Read_ARowArchivedBeforeTheStoreKeptEveryColumn_ReadsTheMissingOnesAsNullAsync} |

## Restoring an archive

{verified: ArchiveStoreSqlTests.Restore_PutsTheStreamBackExactly_CursorsDigestsAndPositionsIncludedAsync}

`RestoreAsync` puts the stream back as it was and deletes the archived copy.

| Choice | Reason | Verified |
|---|---|---|
| Each event returns at its original version and commit position, with its body. | A restored row keeps its commit sequence, so the commit-order stamper never stamps it again and nothing that follows the lanes reads it as new. | {verified: ArchiveStoreSqlTests.Restore_PutsTheStreamBackExactly_CursorsDigestsAndPositionsIncludedAsync} |
| Digests and sealed epochs are folded back with the emit chain's own rules (not ephemeral, not at-most-once, not a digest-exempt type). | The digest table must equal what it was before the archive, or integrity reports drift. | {verified: ArchiveStoreSqlTests.Restore_PutsTheStreamBackExactly_CursorsDigestsAndPositionsIncludedAsync} |
| Parked cursors return as they were; a cursor a perspective made since is kept. | The perspective resumes exactly where it stopped. | {verified: ArchiveStoreSqlTests.Restore_PutsTheStreamBackExactly_CursorsDigestsAndPositionsIncludedAsync} |
| The stream becomes `Active`, its locator is cleared, and the generation is bumped. A [sealed](stream-end-of-life.md#sealing-a-stream) stream becomes `Sealed` instead. | Appends continue above the last version, and integrity re-verifies the history that came back; a restore brings back a stream's events, not its life, so a stream that had ended stays ended. | {verified: ArchiveStoreSqlTests.Restore_PutsTheStreamBackExactly_CursorsDigestsAndPositionsIncludedAsync, StreamSealingSqlTests.Finalize_AnArchivedStream_StaysArchived_AndARestoreReturnsItSealedAsync} |
| A restored prefix goes back under its surviving tail. | A prefix archive and its restore are each other's inverse. | {verified: ArchiveStoreSqlTests.Restore_APrefix_UnderItsSurvivingTailAsync} |
| A second restore returns `nothing_archived` and bumps nothing. | Restore is idempotent. | {verified: ArchiveStoreSqlTests.Restore_IsIdempotent_TheSecondCallFindsNothingArchivedAsync} |
| A hot event at an archived version refuses the restore with `version_conflict`, and the archive is kept. | Two events at one version would break every reader; an operator decides which history is right. | {verified: ArchiveStoreSqlTests.Restore_AHotEventAtAnArchivedVersion_IsAVersionConflict_AndRestoresNothingAsync} |
| A row archived before the store kept commit positions is restored unflagged and stamped again. | Its original position was never recorded; the stamper gives it a new one. | {verified: ArchiveStoreSqlTests.Restore_ARowArchivedBeforeTheStoreKeptPositions_IsStoredUnflaggedForTheStamperAsync} |

## Deleting an archive {#deleting-an-archive}

`DeleteAsync` removes the archived events and parked cursors for good and returns how many events it deleted. The
tombstone stays, with its locator cleared, so the stream's versions are still never reused. It is an explicit
request, so `debug_mode` does not skip it.
{verified: ArchiveStoreSqlTests.Delete_RemovesTheArchivedCopy_TheTombstoneStillBlocksReuseAsync}

The delete is recorded on the stream's [ledger row](#the-ledger-row): `wh_delete_stream_archive` (migration 274) stamps
`archive_deleted_at` whenever the row named an archive. Both stores delete through it, so the record is the same for a
table archive and a blob archive.

| Choice | Reason | Verified |
|---|---|---|
| A deleted archive is recorded, not just forgotten. | Clearing the locator alone left a stream archived through a prefix reading exactly like one never archived, because it stays `Active`. A rebuild then replayed it from its first hot event and wrote a partial history as the row (#1958). With the record, a rebuild [reports the stream instead](../perspectives/rebuild#archived-data-deleted). | {verified: ArchivedStreamRebuildSqlTests.Extents_TellAStreamWhoseArchiveWasDeleted_FromOneThatNeverHadAnArchiveAsync} |
| `archive_deleted_at` is never cleared: nothing in the archive store writes it back to null, and a stream archived again after the delete still reads as deleted. | The deleted events are gone for good, so a stream archived again afterwards, or restored from that later archive, still lacks them. | {verified: ArchivedStreamRebuildSqlTests.Extents_TellAStreamWhoseArchiveWasDeleted_FromOneThatNeverHadAnArchiveAsync} |
| A delete of a stream with no archive (never archived, or restored in full) deletes nothing and stamps nothing. | Nothing was lost, so the stream still reads as one never archived. | {verified: ArchivedStreamRebuildSqlTests.Extents_TellAStreamWhoseArchiveWasDeleted_FromOneThatNeverHadAnArchiveAsync} |

The column is nullable with no default, and migration 274 adds no index: no row is rewritten, the rebuild looks the
ledger up by its key, and an append never writes the column, so the ledger's updates on the append path stay
heap-only.

A prefix archive deleted before migration 274 left no trace in the ledger and is not stamped by it, so it cannot be
detected. A whole-stream archive deleted before 274 left its row `Archived` with no locator, which the rebuild's lookup
reads as deleted too.

## Read-through {#read-through}

{verified: ArchiveReadThroughIntegrationTests.Load_AHotStream_AStreamArchivedWhole_AndOneArchivedThroughAPrefix_ReadTheSameEventsAsync, ArchiveReadThroughIntegrationTests.Rebuild_IncludeWhileLive_AHotStream_AndOneArchivedThroughAPrefix_FoldToTheSameRowAsync, ArchiveAwareEventStoreDecoratorTests.ARebuildThatSkipsArchivedData_ReadsOnlyTheHotEvents_OnEveryReadPathAsync, DapperArchiveReadThroughTests.Load_AHotStream_AStreamArchivedWhole_AndOneArchivedThroughAPrefix_ReadTheSameEventsAsync}

A load and a rewind of an archived stream return the same model as for the same stream never archived. A rebuild
reads the archive only when it opts in, with
[`RebuildArchivedData`](../perspectives/rebuild#archived-data). By default (`Skip`) it reads no archived event: a
stream archived through a prefix starts from its newest live snapshot, and a stream archived whole is skipped and
reported in `StreamsSkipped`. Under `IncludeWhileLive` a stream archived through a prefix replays from its start
through the archive and folds to the same row as the stream never archived; under `IncludeAll` a stream archived
whole does too, and its rebuilt cursor is parked with the stream.
The event store every driver registers wraps the driver's store in an archive seam (`ArchiveAwareEventStoreDecorator`)
whenever an `IArchiveStore` is registered, innermost in its decorator chain, so upcasters and every other decorator see
archived events exactly as they see hot ones, and every reader that goes through `IEventStore` (the perspective
runner, the replay reader, the collective replay applier, lifecycle receptors) reads through the archive with no
change of its own.

```mermaid{caption="Read-through by gap detection: only a read from the start that sees a gap asks the archive." tests=["ArchiveAwareEventStoreDecoratorTests.AReadFromTheStart_PastAGap_ReturnsTheArchivedEventsFirst_ThenTheHotOnes_OnEveryReadPathAsync","ArchiveAwareEventStoreDecoratorTests.AReadThatResumesAfterAnEvent_NeverReadsTheArchive_OnAnyReadPathAsync"]}
flowchart TD
  R[Read] --> S{From the start of the stream?}
  S -- "no: resumes after an event" --> H[Hot read only]
  S -- yes --> H2[Hot read]
  H2 --> G{Gap? no hot event, or first hot version above 1}
  G -- no --> D[Hot events]
  G -- yes --> A[Archived events below the first hot version] --> D2[then the hot events]
```

| Choice | Reason | Verified |
|---|---|---|
| A read from the start (a sequence read from version 0 or 1, an id read or a between-read with no starting event, a rebuild that opts in to archived data) asks the archive only when the hot read shows a gap: no hot event, or a first hot version above 1. | Zero added cost on a stream never archived: the gap is seen in what the hot read already returned. Every prefix archive removes version 1 ([the archive rules](#the-archive-rules)), so an archived stream always shows one. | {verified: ArchiveAwareEventStoreDecoratorTests.AReadFromTheStart_OfAStreamWithNoGap_NeverReadsTheArchiveAsync, ArchiveAwareEventStoreDecoratorTests.AReadFromTheStart_PastAGap_ReturnsTheArchivedEventsFirst_ThenTheHotOnes_OnEveryReadPathAsync} |
| A read that resumes after an event never asks the archive. | Perspective catch-up resumes after an event it applied, and archiving refuses while any perspective owes an event of the range, so a resume point is never inside the archive. | {verified: ArchiveAwareEventStoreDecoratorTests.AReadThatResumesAfterAnEvent_NeverReadsTheArchive_OnAnyReadPathAsync} |
| Measured: a resumed read and a from-the-start read of a stream never archived issue exactly the statements the undecorated store issues; a from-the-start read of an archived stream issues one more. | The promise is checked by counting the statements the driver runs, not inferred. | {verified: ArchiveReadThroughIntegrationTests.AResumedRead_IssuesNoStatementBeyondTheHotRead_AndAReadFromTheStartOfAnArchivedStreamIssuesOneMoreAsync} |
| Archived events come first, then the hot ones; an archived event at or above the first hot version is never returned. | Every archive takes a stream's lowest versions, and a restore in flight may hold an event both places for a moment. | {verified: ArchiveAwareEventStoreDecoratorTests.ArchivedEvents_AtOrAboveTheFirstHotVersion_AreNeverReturnedTwiceAsync} |
| Archived rows are decoded by the driver's own `DeserializeStreamEvents` (the drain's decoder) and carry their stream version and commit positions. | An archived event comes back exactly as a hot read returns it, and a replay orders archived and hot events together the way it ordered them before the archive. | {verified: ArchiveAwareEventStoreDecoratorTests.AnArchivedEvent_CarriesItsStreamPosition_SoAReplayOrdersItWithTheHotOnesAsync, DapperArchiveReadThroughTests.DeserializeStreamEvents_DecodesAStoredRow_AndSkipsATypeTheReaderDoesNotFoldAsync} |
| Every driver read now carries the event's stream version (`LocalStreamVersion`). | The seam sees a gap from the versions the hot read returns; a store that returns no versions never triggers a read-through. | {verified: ArchiveAwareEventStoreDecoratorTests.AHotReadThatCarriesNoVersions_NeverReadsTheArchiveAsync, DapperArchiveReadThroughTests.Load_TypedReads_OfAnArchivedStream_ReturnItsEventsAsync} |
| A read whose first event the reader skips (a type it does not fold, a reaped ephemeral body) asks the archive once and gets nothing back for a stream never archived. | The gap is judged on what the read returns; an extra probe on that rare read is cheaper than a probe on every read. | {verified: ArchiveAwareEventStoreDecoratorTests.AnArchivedRowWithoutABody_OrOfATypeTheReadDoesNotFold_IsSkippedAsync} |
| A typed read (`ReadAsync<T>`, `GetEventsBetweenAsync<T>`) returns the archived events stored as `T`. | The archive is decoded by type like the drain; a typed read over a stream of mixed types fails on the hot side too. | {verified: ArchiveReadThroughIntegrationTests.Load_TypedReads_OfAnArchivedStream_ReturnItsEventsAsync, DapperArchiveReadThroughTests.Load_TypedReads_OfAnArchivedStream_ReturnItsEventsAsync} |
| In a rebuild that reads no archived data (`RebuildArchivedData.Skip`, the default), every read from the start returns only the hot events. A rewind and a live read read through whatever a rebuild would choose. | The choice belongs to rebuilds; a rewind must fold every event its row was built from. | {verified: ArchiveAwareEventStoreDecoratorTests.ARebuildThatSkipsArchivedData_ReadsOnlyTheHotEvents_OnEveryReadPathAsync, ArchiveAwareEventStoreDecoratorTests.ARebuildThatIncludesArchivedData_ReadsThroughTheGapAsync, ArchiveAwareEventStoreDecoratorTests.ARewind_AndALiveRead_ReadThroughTheGap_WhateverARebuildWouldChooseAsync} |
| A collective replay also lists the tenant's collective streams archived whole, from the stream lifecycle ledger (`state = 'Archived'`, a registered collective type, the tenant), and reads them through the archive: always on a rewind, on a rebuild only under `IncludeAll`. | A stream archived whole has no hot row, so the hot event store cannot name it, and its collectives would be lost. Every registered collective type is asked, because collectives sharing an ordering key share a stream whose ledger type is its first event's. See [collective events](../messaging/collective-events#surviving-a-rebuild). | {verified: CollectiveReplayOrderingTests.Interleave_InAReplay_ListsTheCollectiveStreamsArchivedWhole_WhateverARebuildWouldChooseAsync, CollectiveReplayOrderingTests.Interleave_InARebuild_ListsTheCollectiveStreamsArchivedWhole_OnlyUnderIncludeAllAsync, DapperArchivedCollectiveReplayTests.AddCollectiveEventsDapper_TheReplayReadsTheTenantsArchivedCollectiveStreams_ListedFromTheLedgerAsync} |
| The lookup reads `idx_stream_lifecycle_archived_type` (migration 272): the archived streams by stream type, then tenant, partial on `state = 'Archived'`. | The ledger has a row per stream, and the only index that served the lookup before visited every archived row (8,571 to return 38 in the plan test). No append changes a row's type, tenant or state, so an append's ledger update stays heap-only. | {verified: ArchivedCollectiveStreamsQueryPlanTests.ArchivedCollectiveStreams_OnALargeLedger_ReadTheArchivedStreamIndex_WithAndWithoutATenantAsync} |
| With no archive store registered, the store is not decorated. | A host without an archive pays nothing. | {verified: ArchiveReadThroughRegistrationTests.WithoutAnArchiveStore_TheStore_IsNotDecoratedAsync} |
| `Whizbang:Archive:ReadThrough` (default `true`) turns reads through the archive off; appends still restore under AutoRestore. | Off returns only what is hot, for a host that reads archived streams some other way; the append policy belongs to the stream type, not to the read setting. | {verified: ArchiveReadThroughRegistrationTests.WithReadThroughOff_TheDecoratedStore_ReadsOnlyHotEvents_ButStillRestoresOnAppendAsync, ArchiveReadThroughIntegrationTests.Load_WithReadThroughOff_ReturnsOnlyTheHotEventsAsync} |

### Rewind past an archived snapshot {#rewind-past-an-archived-snapshot}

{verified: PerspectiveRewindWriteCheckTests.ARewindFromASnapshotTheArchiveCovers_ReadsThroughTheArchive_AboveTheSnapshotsVersionAsync, ArchiveReadThroughIntegrationTests.Rewind_WithoutASnapshot_OfAStreamArchivedWhole_FoldsToTheSameRowAsTheHotCopyAsync}

A rewind restores a snapshot and replays the events after it, which is a read that resumes after an event. When an
archive covers that snapshot (its `archived_through_version` is set), the events after it may be archived, so the
rewind asks for them explicitly: `IEventStore.ReadPolymorphicThroughArchiveAsync` reads the archived events above the
snapshot's version, then the hot events after its event. This is the rare, explicit path that does look the archive up.

| Choice | Reason | Verified |
|---|---|---|
| The rewind's snapshot floor carries the archive mark (`IPerspectiveSnapshotStore.GetSnapshotFloorAsync`), on both drivers. | The runner decides from the snapshot it restores, with no second lookup. | {verified: SnapshotSelectionFollowsStreamOrderTests.GetSnapshotFloor_CarriesTheArchiveMark_WhenAnArchiveCoversTheSnapshotAsync, DapperPerspectiveSnapshotStoreTests.GetSnapshotFloor_CarriesTheArchiveMark_WhenAnArchiveCoversTheSnapshotAsync} |
| Only the first replay pass reads through; a later pass resumes after the last event applied, which is hot. | The catch-up loop picks up appends made during the replay, never archived ones. | {verified: PerspectiveRewindWriteCheckTests.ARewindFromASnapshotTheArchiveCovers_ReadsThroughTheArchive_AboveTheSnapshotsVersionAsync} |
| An unmarked snapshot reads only hot events. | The control: the archive is looked up only when it can matter. | {verified: PerspectiveRewindWriteCheckTests.ARewindFromASnapshotNoArchiveCovers_ReadsOnlyTheHotEventsAfterItAsync} |
| A marked snapshot that records no version is not used; the rewind replays from the start, which reads through the archive by its gap. | Without a version there is no telling where the archived events after it begin, and folding events the snapshot already holds would count them twice. | {verified: PerspectiveRewindWriteCheckTests.AMarkedSnapshotWithNoVersion_IsNotUsed_TheRewindReplaysFromTheStartAsync} |
| A rewind with no snapshot, and a rebuild that opts in to archived data, read from the start through the gap. | They are reads from the start. A rebuild reads the archive only under `IncludeWhileLive` or `IncludeAll`, and parks the cursor of a stream archived whole; see [archived data](../perspectives/rebuild#archived-data). | {verified: ArchiveReadThroughIntegrationTests.Rewind_WithoutASnapshot_OfAStreamArchivedWhole_FoldsToTheSameRowAsTheHotCopyAsync, ArchiveReadThroughIntegrationTests.Rebuild_IncludeWhileLive_AHotStream_AndOneArchivedThroughAPrefix_FoldToTheSameRowAsync} |
| The upcasters apply to the explicit read as to the ordinary one. | An archived event is the likeliest to need an upcaster. | {verified: UpcastingEventStoreDecoratorTests.ReadPolymorphicThroughArchive_UpcastsLikeTheOrdinaryReadAsync} |

## Appending to an archived stream {#appending-to-an-archived-stream}

{verified: ArchiveAppendPolicySqlTests.DirectAppend_Refuse_ThrowsStreamArchivedException_AndStoresNothingAsync, ArchiveAppendPolicySqlTests.OutboxAppend_Refuse_DeadLettersThatEvent_AndTheRestOfTheBatchCommitsAsync, ArchiveAppendPolicySqlTests.OutboxAppend_AutoRestore_DeadLettersAwaitingRestore_AndQueuesOneRequestPerStreamAsync}

What an append to a stream archived whole does is declared per stream type
(`Whizbang:StreamLifecycle:Types:<StreamType>:AppendToArchived`). Every write path applies it per event, under the
stream lock it already holds, the way a [sealed stream refuses](stream-end-of-life#a-sealed-stream-refuses-appends):

| Write | `Refuse` (default) | `AutoRestore` |
|---|---|---|
| A direct append (`IEventStore.AppendAsync`) | `StreamArchivedException` (SQLSTATE `WHA01`), nothing stored | Restored inline through `IArchiveStore.RestoreAsync`, then retried once (SQLSTATE `WHA02` tells the driver) |
| An awaited outbox write (immediate and scoped strategies) | `StreamArchivedException`, the whole write rolls back and is withdrawn | Restored inline, then the same write is stored once more |
| An outbox or inbox write nobody awaits | The refused event alone is dead-lettered (`StreamArchived`, 26, held for review); the rest of the batch is stored | The refused event is dead-lettered (`AwaitingRestore`, 27) and the stream's [restore request](#restore-requests) is queued in the same transaction |

```csharp{
title: "Declare the append-to-archived policy of a stream type"
description: "appsettings for a service whose order streams restore themselves when a late event arrives; every other type refuses."
framework: "NET10"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["archive", "append-to-archived", "auto-restore", "configuration"]
unverified: "configuration shape; the binding is verified in StreamLifecycleOptionsBinderTests"
}
// appsettings.json
// "Whizbang": {
//   "StreamLifecycle": {
//     "Types": {
//       "Shop.Orders.OrderPlaced": { "AppendToArchived": "AutoRestore" }
//     }
//   }
// }
try {
  await eventStore.AppendAsync(streamId, new CartAbandoned(streamId));
} catch (StreamArchivedException ex) when (ex.Policy == AppendToArchivedPolicy.Refuse) {
  logger.LogWarning("Stream {StreamId} is archived through version {Version}", ex.StreamId, ex.ArchivedThroughVersion);
}
```

| Choice | Reason | Verified |
|---|---|---|
| The refusal is per event, never per batch. | A batch carries many streams; one archived stream must not stall the others. | {verified: ArchiveAppendPolicySqlTests.OutboxAppend_Refuse_DeadLettersThatEvent_AndTheRestOfTheBatchCommitsAsync, ArchiveAppendPolicySqlTests.InboxAppend_Refuse_DeadLettersTheRow_AndStoresTheRestAsync} |
| The default is `Refuse`. | Restoring a whole stream is real work; a host opts a type into it knowingly. | {verified: ArchiveAppendPolicySqlTests.DirectAppend_Refuse_ThrowsStreamArchivedException_AndStoresNothingAsync, StreamLifecycleOptionsBinderTests.AppendToArchived_IsReadPerStreamType_IgnoringCase_AndAnUnlistedTypeRefusesAsync} |
| The stream type is the ledger's `stream_type`: the type name of the stream's first event, without its assembly. | It is what every write path already reads under the stream lock, so no lookup is added. | {verified: ArchiveAppendPolicySqlTests.OutboxAppend_AutoRestore_DeadLettersAwaitingRestore_AndQueuesOneRequestPerStreamAsync} |
| The policy is read from the SQLSTATE (`WHA01` Refuse, `WHA02` AutoRestore), never from the message text. | A rewording of the message can never flip what the caller does. | {verified: StreamArchivedRefusalTests.ToException_ThePolicyComesFromTheSqlState_NeverFromTheWordingAsync} |
| An inline AutoRestore is retried once; a second refusal reaches the caller. | A restore that could not put the stream back (the archive was deleted, a version conflict) would refuse again; retrying in a loop would hide it. | {verified: ArchiveAwareEventStoreDecoratorTests.AnAppend_AutoRestore_WhoseRestoreDoesNotHelp_RaisesTheSecondRefusal_AfterOneRetryAsync} |
| An awaited outbox flush restores through the archive store its scope reaches; with no scope factory the refusal reaches the caller. | The strategy has no other way to the archive store, and adding one would be a new optional dependency. | {verified: ScopedWorkCoordinatorStrategyTests.FlushAsync_AnAutoRestoreRefusal_RestoresThroughTheScopesArchiveStore_OrReachesTheCallerWithoutOneAsync, ImmediateWorkCoordinatorStrategyTests.FlushAsync_AnAutoRestoreRefusal_RestoresTheStream_AndStoresTheWriteOnceMoreAsync} |
| A refused awaited write is withdrawn from the strategy, as a sealed one is. | The same write is refused until someone restores the stream; offering it to a later flush would fail that flush too. | {verified: ImmediateWorkCoordinatorStrategyTests.FlushAsync_RefusedForAnArchivedStream_TheNextFlushDoesNotWriteTheRefusedWorkAsync, ScopedWorkCoordinatorStrategyTests.FlushAsync_RefusedForAnArchivedStream_DisposalDoesNotWriteTheRefusedWorkAsync} |
| A sealed stream that is archived is refused as sealed. | A stream that ended stays ended; restoring it would not let the append in. | {verified: ArchiveAppendPolicySqlTests.SealedAndArchived_TheSealsRefusalWinsAsync} |
| `NewGeneration` is not a value yet; a configuration that names it fails the host's start with a message naming #1734. | Starting a new generation needs the final snapshot finalization takes, which ships with #1734; reading it as a default would silently refuse. | {verified: StreamLifecycleOptionsBinderTests.AppendToArchived_NewGeneration_IsRefusedAtStartup_Naming1734Async, StreamLifecycleOptionsBinderTests.Registration_APolicyThatCannotBeRead_FailsTheHostsStartupValidationAsync} |

An inline restore and its one retry need the write to own its transaction. Inside a transaction the caller opened, the
refusal has already aborted that transaction, so the retry cannot succeed in it; the restore itself runs on its own
connection and commits, and the caller's retry of its whole transaction then succeeds.

### The policy per stream type {#the-policy-per-stream-type}

{verified: ArchiveRestoreRequestSqlTests.SyncPolicies_ReplacesTheStoredSetWhole_AndIsIdempotentAsync, MaintenanceWorkerStreamTypePolicySyncTests.EveryTick_StoresTheConfiguredPolicies_EvenWhenTheSweepIsDeferredAsync}

A background write is refused inside the store, which cannot read this process's options, so the configured policies
are stored in `wh_stream_type_policies` (`wh_sync_stream_type_policies`), as retention windows are stored in
`wh_settings`.

| Choice | Reason | Verified |
|---|---|---|
| The maintenance worker stores them on every tick, before the sweep's idle gate, under the maintainer duty. | A policy must be in force soon after a start even on a service too busy for the sweep; a configuration change lands without a restart. | {verified: MaintenanceWorkerStreamTypePolicySyncTests.EveryTick_StoresTheConfiguredPolicies_EvenWhenTheSweepIsDeferredAsync} |
| Each write replaces the stored set whole; an empty configuration removes every row. | A type someone removed from configuration must stop restoring. | {verified: ArchiveRestoreRequestSqlTests.SyncPolicies_ReplacesTheStoredSetWhole_AndIsIdempotentAsync, MaintenanceWorkerStreamTypePolicySyncTests.NoTypesConfigured_StoresAnEmptySet_SoAStaleRowIsRemovedAsync} |
| A failed write is logged with the policies it left unstored, and the tick goes on; cancellation propagates. | The stored set stays in force until a later tick succeeds. | {verified: MaintenanceWorkerStreamTypePolicySyncTests.AFailedWrite_IsLogged_AndTheCycleRunsOnAsync} |
| The table admits only `Refuse` and `AutoRestore`. | A value the write paths do not know is refused where it is written. | {verified: ArchiveRestoreRequestSqlTests.SyncPolicies_ReplacesTheStoredSetWhole_AndIsIdempotentAsync} |
| Both coordinators store through the same writer. | The two drivers store the same rows. | {verified: ArchiveRestoreRequestSqlTests.SyncPolicies_ThroughTheCoordinator_StoresTheConfiguredSetAsync, DapperArchiveAppendPolicyTests.SyncStreamTypePolicies_ThroughTheCoordinator_StoresTheConfiguredSetAsync} |

### Restore requests {#restore-requests}

{verified: ArchiveRestoreRequestSqlTests.Step_RestoresEachQueuedStream_AndItsDeadLettersBecomeDueAsync, ArchiveRestoreRequestSqlTests.AwaitingRestore_AfterTheRestore_TheRecoveryServiceRedrivesTheEventIntoTheStreamAsync, DapperArchiveRestoreRedriveTests.AddWhizbangPostgres_AnAwaitingRestoreDeadLetter_IsRedrivenThroughTheOutbox_OnceItsRestoreCompletesAsync}

A background write under `AutoRestore` has no caller to wait for a restore, so it goes through the dead-letter queue
with deterministic state, never text matching:

```mermaid{caption="A restore request moves Pending, Restoring, then Restored or Failed; Restored makes its dead letters due." tests=["ArchiveRestoreRequestSqlTests.Claim_TakesTheOldestOpenRequests_AndALeftoverRestoringOneAsync","ArchiveRestoreRequestSqlTests.Restore_MarksTheRequestRestored_AndMakesItsDeadLettersDueAsync","ArchiveRestoreRequestSqlTests.Fail_MarksTheRequestFailed_AndLeavesItsDeadLettersHeldForReviewAsync"]}
stateDiagram-v2
  [*] --> Pending: background append refused (same transaction)
  Pending --> Restoring: maintenance step claims it
  Restoring --> Restored: any restore of the stream
  Restoring --> Failed: restore did not put the stream back
  Restored --> Pending: the stream is archived and refused again
  Failed --> Restored: a later restore of the stream
```

| Choice | Reason | Verified |
|---|---|---|
| The refused event is dead-lettered with `AwaitingRestore` (27) and held by its request: `recovery_status` HoldForReview and `operator_disposition` HoldIndefinitely while the request is Pending or Restoring. | Neither the recovery scan, the generation replay nor a canary campaign may redrive it before the stream is back; it would only be refused again. | {verified: ArchiveAppendPolicySqlTests.OutboxAppend_AutoRestore_DeadLettersAwaitingRestore_AndQueuesOneRequestPerStreamAsync, ArchiveAppendPolicySqlTests.InboxAppend_AutoRestore_DeadLettersAwaitingRestore_AndQueuesTheRequestAsync} |
| One request per stream (`wh_archive_restore_requests`, keyed by stream), queued in the transaction that dead-lettered the event. | A burst of writes to one archived stream restores it once; the request and the dead letter commit or roll back together. | {verified: ArchiveAppendPolicySqlTests.OutboxAppend_AutoRestore_DeadLettersAwaitingRestore_AndQueuesOneRequestPerStreamAsync} |
| A Restored request starts over as Pending; a Pending or Restoring one keeps its place; a Failed one stays Failed until a restore of the stream succeeds. | The stream was archived again since its last restore; an open request is already queued; a failed restore waits for a person rather than being retried blind on every write. | {verified: ArchiveRestoreRequestSqlTests.Queue_ARestoredRequestStartsOver_AFailedOneStaysFailedAsync} |
| A maintenance step (`ArchiveRestoreRequestStep`, registered by both drivers, maintainer duty) claims up to 20 open requests per cycle, oldest first, and restores each through `IArchiveStore`. | A table archive and a blob archive restore the same way; a restore copies a whole stream back, so a burst drains over a few cycles. | {verified: ArchiveRestoreRequestSqlTests.Step_RestoresEachQueuedStream_AndItsDeadLettersBecomeDueAsync, DapperArchiveAppendPolicyTests.AddWhizbangPostgres_RegistersTheRestoreRequestStep_AsAMaintenanceStepAsync} |
| A Restoring request is claimed again by the next pass. | The step runs one pass at a time under the maintainer duty, so a Restoring request a pass finds was left by one that stopped, and a restore is idempotent. | {verified: ArchiveRestoreRequestSqlTests.Claim_TakesTheOldestOpenRequests_AndALeftoverRestoringOneAsync} |
| Any restore of the stream completes its request (the step's, an inline one, an operator's): Restored, its AwaitingRestore dead letters due now for the recovery worker, its snapshots' marks cleared. A second restore of a stream already back completes it the same way. | The outcome is decided by the stream's state, whoever restored it. | {verified: ArchiveRestoreRequestSqlTests.Restore_MarksTheRequestRestored_AndMakesItsDeadLettersDueAsync, ArchiveRestoreRequestSqlTests.Restore_ASecondRestoreOfAStreamAlreadyBack_CompletesItsRequestAsync} |
| The dead letters are redriven by the existing recovery worker (policy `AfterRestore`: 3 attempts, 1 minute apart, then held for review), on both drivers. | Recovery re-enters each message through its own store, so the event takes the next version of the restored stream. Both drivers register the [recovery service](../../operations/dead-letter-queue/recovery#recovery-drivers); before, the Dapper driver registered none, and its dead letters became due and stayed put. | {verified: ArchiveRestoreRequestSqlTests.AwaitingRestore_AfterTheRestore_TheRecoveryServiceRedrivesTheEventIntoTheStreamAsync, DapperArchiveRestoreRedriveTests.AddWhizbangPostgres_AnAwaitingRestoreDeadLetter_IsRedrivenThroughTheOutbox_OnceItsRestoreCompletesAsync, DefaultDeadLetterRecoveryPolicyTests.GetPolicy_AwaitingRestore_RedrivesSoonAfterTheRestore_ThenHoldsAsync} |
| A restore that does not put the stream back marks the request Failed with the store's status (`nothing_archived`, `version_conflict`) or the exception's type and message, and its dead letters become ordinary held-for-review dead letters. | A person decides; the request records why. One stream's failure never holds back another's restore. | {verified: ArchiveRestoreRequestSqlTests.Fail_MarksTheRequestFailed_AndLeavesItsDeadLettersHeldForReviewAsync, ArchiveRestoreRequestSqlTests.Step_AnArchiveThatIsGone_FailsTheRequest_WithTheStoresStatusAsync, ArchiveRestoreRequestSqlTests.Step_ARestoreThatThrows_FailsThatRequest_AndStillRestoresTheNextAsync} |
| A purge removes the stream's request with its lifecycle row (`ON DELETE CASCADE`). | A purged stream is never restored. | {verified: ArchiveRestoreRequestSqlTests.Purge_RemovesTheStreamsRestoreRequest_WithItsLifecycleRowAsync} |

### What the append policy costs {#what-the-append-policy-costs}

{verified: ArchivedStreamEmitCostScenarioTests.EmitChain_With266sProbeAndWith271s_ReportAsync}

Every write path decides on one probe per batch of a partial index holding only the sealed and the archived streams
(`idx_stream_lifecycle_closed`), which replaces the seal's own probe, so the common case (no stream of the batch sealed
or archived) costs what the seal's check cost. Measured on a 500-event outbox batch against a ledger holding 2,000
sealed and 2,000 archived streams, the chain as migration 271 defines it against the chain as 266 defined it,
alternating three rounds, medians:

| Batch | Blocks, 266 | Blocks, 271 | The probe | Execution, 266 | Execution, 271 |
|---|---|---|---|---|---|
| 50 existing streams, 10 events each | 32,211 | 32,237 | 2 blocks | 64.4 ms | 61.8 ms |
| 500 new streams, one event each | 36,578 | 36,306 | 2 blocks | 68.4 ms | 67.3 ms |

The whole-chain differences are within the spread between rounds; the probe is the only added read. A batch that does
hold an archived stream pays for the refusal (a dead letter per refused event, and under AutoRestore one request row
per stream).

## Configuration {#configuration}

{verified: StreamLifecycleOptionsBinderTests.ReadThrough_DefaultsToTrue_AndBindsFalseAsync, StreamLifecycleOptionsBinderTests.AppendToArchived_IsReadPerStreamType_IgnoringCase_AndAnUnlistedTypeRefusesAsync}

| Key | Default | Environment variable | Purpose |
|---|---|---|---|
| `Whizbang:Archive:ReadThrough` | `true` | `Whizbang__Archive__ReadThrough` | A read from the start of a stream reads archived events back through its gap. |
| `Whizbang:StreamLifecycle:Types:<StreamType>:AppendToArchived` | `Refuse` | `Whizbang__StreamLifecycle__Types__<StreamType>__AppendToArchived` | `Refuse` or `AutoRestore`; `NewGeneration` ships with #1734. |

| Choice | Reason | Verified |
|---|---|---|
| Both are bound by hand and validated when the host starts; a value that is not a boolean, or not a policy name, fails the start naming the key. | A misread setting must fail where it is configured, not at the first archived write. | {verified: StreamLifecycleOptionsBinderTests.ReadThrough_AValueThatIsNotABoolean_IsRefusedNamingTheKeyAsync, StreamLifecycleOptionsBinderTests.Registration_APolicyThatCannotBeRead_FailsTheHostsStartupValidationAsync} |
| Policy names are matched ignoring case; a number is refused. | A number would bind a policy by its position, which nobody reading the configuration can check. | {verified: StreamLifecycleOptionsBinderTests.AppendToArchived_AnUnknownValueOrANumber_IsRefusedNamingTheKeyAndTheValuesAsync} |

## The Postgres-table store

`PostgresTableArchiveStore` keeps archived events in `wh_event_archive` (migration 085, extended by 262 with the
flags, commit position, origin lane and insert order a restore needs). Both drivers register it with `TryAdd`, so a
store registered first wins; the EF Core driver qualifies the table with the context's schema, the Dapper driver
resolves it through the connection's search path.
{verified: ArchiveStoreSqlTests.PrefixTruncate_ThroughTheDriversRegistration_ArchivesThroughTheStoreAsync, DapperArchiveStoreTests.AddWhizbangPostgres_RegistersTheTableArchiveStore_AndTheTruncateWritesThroughItAsync, ArchiveStoreSqlTests.Store_LogsEachOutcome_AndNamesItsSchemaInTheLocatorAsync}

### The prefix truncate archives through the store

{verified: StreamPrefixTruncatorArchiveStoreTests.ArchivingTruncate_WritesAPrefixBatchThroughTheStore_NotTheCoordinatorAsync}

`IStreamPrefixTruncator.TruncateAsync(streamId, throughVersion, archive: true)` writes a prefix batch through the
registered store. The truncator's destruction hook and destruction-stage receptors run around it as before.

| Choice | Reason | Verified |
|---|---|---|
| A store's `archived` reads as `truncated`, and the PostDestruction hook fires. | Callers of the truncate read one vocabulary: an archive that moved events is a truncate that happened. | {verified: StreamPrefixTruncatorArchiveStoreTests.ArchivingTruncate_WritesAPrefixBatchThroughTheStore_NotTheCoordinatorAsync} |
| A refusal keeps its name, and no PostDestruction hook fires. | Nothing was destroyed, so nothing is announced as destroyed. | {verified: StreamPrefixTruncatorArchiveStoreTests.ArchivingTruncate_TheStoreRefuses_TheRefusalKeepsItsName_AndNoPostHookFiresAsync} |
| A discarding truncate still goes to the coordinator. | It keeps nothing, so it never reaches the archive. | {verified: StreamPrefixTruncatorArchiveStoreTests.DiscardingTruncate_GoesToTheCoordinator_EvenWithAStoreRegisteredAsync} |
| With no store registered, an archiving truncate copies through the coordinator as it did before. | An engine without a store keeps working. | {verified: StreamPrefixTruncatorArchiveStoreTests.ArchivingTruncate_WithNoStoreRegistered_KeepsTheCoordinatorsCopyAsync} |
| On the Dapper driver an archiving truncate now works. | The store is shared SQL, so the Dapper driver, whose coordinator never implemented the truncate, archives through it. | {verified: DapperArchiveStoreTests.AddWhizbangPostgres_RegistersTheTableArchiveStore_AndTheTruncateWritesThroughItAsync} |

## The Azure Blob store {#the-azure-blob-store}

{verified: AzureBlobArchiveStoreTests.Write_WholeStream_ThenRead_ReturnsTheEventsByteIdenticalInVersionOrderAsync}

`AzureBlobArchiveStore` (package `Whizbang.Archive.AzureBlob`) is the production default. Archived events leave the
database: each archive becomes one or more **objects** in an Azure Blob container, Brotli-compressed JSON lines, and the
service database keeps only a small **manifest** row per object (`wh_archive_manifest`, migration 268) and the stream's
tombstone. The guards, the tombstone, the cursor parking, the origin generation and the restore are the table store's
own SQL, so both stores behave the same; only where the events rest differs.

```mermaid{caption="An Azure Blob archive write: the database moves the events and the store uploads them inside one transaction; the manifest rows commit with the truncate, so an object is part of an archive only once everything committed." tests=["AzureBlobArchiveStoreTests.Write_WholeStream_ThenRead_ReturnsTheEventsByteIdenticalInVersionOrderAsync", "AzureBlobArchiveStoreTests.Write_TheUploadFails_TheStreamStaysFullyHot_AndNothingIsListedAsync", "AzureBlobArchiveStoreTests.Write_ACrashAfterTheUploadBeforeTheCommit_IsRetriedWithoutADuplicateAsync"]}
sequenceDiagram
  participant S as AzureBlobArchiveStore
  participant D as Service database
  participant B as Blob container
  S->>D: BEGIN; wh_archive_stream (guards, copy into wh_event_archive, truncate, tombstone)
  D-->>S: archived (or a refusal: nothing moved, nothing uploaded)
  S->>D: read the staged rows in version order
  loop one object per MaxEventsPerChunk events
    S->>B: PUT {stream}/{first}-{last}-{sha256}.jsonl.br (Brotli, MD5 checked by the service)
  end
  S->>D: INSERT one wh_archive_manifest row per object; DELETE the staged rows
  S->>D: COMMIT
  Note over S,D: any failure before COMMIT rolls back: every event is hot again, and an uploaded object is named by no manifest row
```

### Registering the Azure Blob store {#registering-the-azure-blob-store}

{verified: AzureBlobArchiveRegistrationTests.Registration_ReplacesTheTableStore_WhetherItComesBeforeOrAfterTheDriverAsync, AzureBlobArchiveStoreTests.Registration_TheDriversPrefixTruncate_ArchivesThroughTheBlobStoreAsync}

```csharp{
title: "Make the Azure Blob store the archive store"
description: "One call reads Whizbang:Archive:AzureBlob and replaces the Postgres-table store; the identity comes from the TokenCredential the host registers."
framework: "NET10"
category: "Core Concepts"
difficulty: "BEGINNER"
tags: ["archive", "azure-blob", "registration", "managed-identity"]
nugetPackages: ["SoftwareExtravaganza.Whizbang.Archive.AzureBlob", "Azure.Identity"]
tests: ["AzureBlobArchiveRegistrationTests.ServiceUri_AuthenticatesWithTheRegisteredCredential_AndNoSecretInConfigurationAsync", "AzureBlobArchiveStoreTests.Registration_TheDriversPrefixTruncate_ArchivesThroughTheBlobStoreAsync"]
}
// appsettings: "Whizbang": { "Archive": { "AzureBlob": { "ServiceUri": "https://account.blob.core.windows.net" } } }
builder.Services.AddSingleton<TokenCredential>(new ManagedIdentityCredential());
builder.Services.AddWhizbangAzureBlobArchive(builder.Configuration);
```

| Choice | Reason | Verified |
|---|---|---|
| The registration replaces any `IArchiveStore` already registered, and a driver registered after it adds nothing. | The drivers add the table store only when no store is present, so the call works in either order and nothing can resolve the table store by accident. | {verified: AzureBlobArchiveRegistrationTests.Registration_ReplacesTheTableStore_WhetherItComesBeforeOrAfterTheDriverAsync} |
| Opting in is a registration call, not the presence of settings. | Moving a service's archive out of its database is a deployment decision; a stray setting must not do it, and a host that made the call with no account configured fails at startup instead of on its first archive. | {verified: AzureBlobArchiveRegistrationTests.CreateContainerClient_NeitherOrBothEndpoints_IsRefusedAsync} |
| A Postgres driver is required, and resolving the store without one fails naming what to register. | The manifest and the staged rows live in the service's database; each driver registers how a store reaches it (`PostgresArchiveConnection`), on the same connections and schema as its table store. | {verified: AzureBlobArchiveRegistrationTests.Resolution_WithoutAPostgresDriver_SaysWhatToRegisterAsync, ArchiveStoreSqlTests.PrefixTruncate_ThroughTheDriversRegistration_ArchivesThroughTheStoreAsync, DapperArchiveStoreTests.AddWhizbangPostgres_RegistersTheTableArchiveStore_AndTheTruncateWritesThroughItAsync} |
| `ServiceUri` authenticates with the `Azure.Core.TokenCredential` the host registers; there is no key setting for it, and a `ServiceUri` with no credential registered fails naming the credential. | No secret belongs in configuration or code: the host picks the identity (managed identity, workload identity) and the package takes no dependency on `Azure.Identity`. The store never falls back to anonymous access. | {verified: AzureBlobArchiveRegistrationTests.ServiceUri_AuthenticatesWithTheRegisteredCredential_AndNoSecretInConfigurationAsync, AzureBlobArchiveRegistrationTests.CreateContainerClient_ServiceUriWithNoCredential_IsRefused_NamingWhatIsMissingAsync} |
| `ConnectionString` is the other form, for the Azurite emulator or a key the host keeps in its own secret store; setting both or neither is refused. | Two accounts are ambiguous and none is a misconfiguration; the store never picks one silently. | {verified: AzureBlobArchiveRegistrationTests.CreateContainerClient_ConnectionString_UsesItAndTheContainerAsync, AzureBlobArchiveRegistrationTests.CreateContainerClient_NeitherOrBothEndpoints_IsRefusedAsync} |
| A setting that cannot be read (a quality that is not a number, a `ServiceUri` that is not absolute) fails naming the key; a blank one keeps the default. | A misread value would otherwise fall back to a default nobody chose. | {verified: AzureBlobArchiveRegistrationTests.Configuration_AValueThatCannotBeRead_IsRefused_NamingTheKeyAsync, AzureBlobArchiveRegistrationTests.Configuration_BindsEverySetting_AndKeepsTheDefaultsForWhatIsAbsentAsync} |

### Configuration {#azure-blob-configuration}

{verified: AzureBlobArchiveRegistrationTests.Configuration_BindsEverySetting_AndKeepsTheDefaultsForWhatIsAbsentAsync}

| Key | Type | Default | Environment variable | Purpose |
|-----|------|---------|----------------------|---------|
| `Whizbang:Archive:AzureBlob:ServiceUri` | `Uri?` | `null` | `Whizbang__Archive__AzureBlob__ServiceUri` | The Blob service endpoint; authenticates with the registered `TokenCredential` |
| `Whizbang:Archive:AzureBlob:ConnectionString` | `string?` | `null` | `Whizbang__Archive__AzureBlob__ConnectionString` | A storage connection string (Azurite, or an account key from the host's secret store); set this or `ServiceUri` |
| `Whizbang:Archive:AzureBlob:ContainerName` | `string` | `whizbang-archive` | `Whizbang__Archive__AzureBlob__ContainerName` | The container the objects are written to; created on the first write |
| `Whizbang:Archive:AzureBlob:CompressionLevel` | `int` | `4` | `Whizbang__Archive__AzureBlob__CompressionLevel` | The Brotli quality, 0 (fastest) to 11 (smallest); a value outside the range fails when the store is built |
| `Whizbang:Archive:AzureBlob:MaxEventsPerChunk` | `int` | `10000` | `Whizbang__Archive__AzureBlob__MaxEventsPerChunk` | The most events one object holds; 1 or more |

| Choice | Reason | Verified |
|---|---|---|
| Brotli quality 4 by default. | Measured on 10,000 event rows (13.3 MB of JSON lines): quality 4 wrote 1.90 MB in about 0.25 s; qualities 5 to 9 saved under 1% more for two to seven times the time; 11 saved 15% more but took 38 s per object. An archive is written by a maintenance sweep and read rarely, so the point where more time stops buying bytes is the right default. | {verified: ArchiveChunkTests.Quality_IsPassedToTheEncoder_HigherQualityWritesFewerBytesAsync, AzureBlobArchiveRegistrationTests.Configuration_BindsEverySetting_AndKeepsTheDefaultsForWhatIsAbsentAsync} |
| The quality range is Brotli's own, 0 to 11; 0 and 11 are accepted, -1 and 12 refused. | Anything else is not a Brotli quality. | {verified: AzureBlobArchiveRegistrationTests.Store_RefusesAQualityOrAChunkSizeOutOfRangeAsync, AzureBlobArchiveRegistrationTests.Store_AcceptsTheEdgesOfTheRangeAsync} |
| At most 10,000 events per object by default; one is the smallest chunk. | Neither a write nor a read holds more than one object's events in memory (about 13 MB of JSON at the measured row size), and a long stream becomes several objects that read in order. | {verified: AzureBlobArchiveStoreTests.Write_WholeStream_ThenRead_ReturnsTheEventsByteIdenticalInVersionOrderAsync, AzureBlobArchiveRegistrationTests.Store_AcceptsTheEdgesOfTheRangeAsync} |
| The container is created on the first write when it does not exist. | A fresh account or emulator starts without it, as the offload provider assumes too; the identity therefore needs the right to create the container (the Storage Blob Data Contributor role has it). | {verified: AzureBlobArchiveStoreTests.Write_WholeStream_ThenRead_ReturnsTheEventsByteIdenticalInVersionOrderAsync} |

### How a write works {#azure-blob-writes}

{verified: AzureBlobArchiveStoreTests.Write_TheUploadFails_TheStreamStaysFullyHot_AndNothingIsListedAsync, AzureBlobArchiveStoreTests.Write_ACrashAfterTheUploadBeforeTheCommit_IsRetriedWithoutADuplicateAsync}

| Choice | Reason | Verified |
|---|---|---|
| The write is one database transaction: `wh_archive_stream` moves the batch into `wh_event_archive` (every guard and the tombstone included), the objects are uploaded, the manifest rows are written and the staged rows removed, and only then does it commit. | The archive is all or nothing like the table store's: an upload that fails, or a process that dies before the commit, rolls the truncate back, so every event is hot again with every column, no tombstone is left and the generation is unchanged. | {verified: AzureBlobArchiveStoreTests.Write_TheUploadFails_TheStreamStaysFullyHot_AndNothingIsListedAsync} |
| An object becomes part of an archive only through its manifest row, and readers, restores and deletes never list the container. | The manifest commits with the truncate, so an object a failed attempt uploaded is named by nothing and can never be read as archived. | {verified: AzureBlobArchiveStoreTests.Write_ACrashAfterTheUploadBeforeTheCommit_IsRetriedWithoutADuplicateAsync} |
| An object's name carries the SHA-256 of its bytes, and an upload overwrites an object of the same name. | The encoding is deterministic, so a retry of the same events writes the same bytes under the same name: the container still holds one object, not two. A name can only ever hold the bytes it hashes to, so overwriting it is safe. | {verified: AzureBlobArchiveStoreTests.Write_ACrashAfterTheUploadBeforeTheCommit_IsRetriedWithoutADuplicateAsync, ArchiveChunkTests.Encode_IsDeterministic_SoARetryWritesTheSameObjectName_AndOtherEventsAnotherAsync} |
| Each upload sends an MD5 of its bytes, which the service checks before it stores them. | An object is stored exactly as it was sent, or the upload fails and the write rolls back. A single upload is atomic, so a partial object is never visible. | {verified: AzureBlobArchiveStoreTests.Write_WholeStream_ThenRead_ReturnsTheEventsByteIdenticalInVersionOrderAsync} |
| The transaction stays open, holding the stream's append lock, while the objects upload. | It is what makes the archive atomic. An append to that one stream waits for the upload; archived streams are cold, so nothing normally waits. Keep a database's `idle_in_transaction_session_timeout`, if set, above the time an upload of one stream can take. | {verified: AzureBlobArchiveStoreTests.Write_TheUploadFails_TheStreamStaysFullyHot_AndNothingIsListedAsync} |
| A refusal (`blocked`, `held`, a prefix the truncate refused, `nothing_to_archive`, `debug_skipped`) uploads nothing and keeps its status. | Nothing moved, so nothing is written. | {verified: AzureBlobArchiveStoreTests.Write_ARefusal_KeepsItsStatus_AndUploadsNothingAsync} |
| A prefix archive adds its own objects; a later prefix adds more. | Each archive is one batch, and the manifest lists every object of the stream in version order. | {verified: AzureBlobArchiveStoreTests.Write_TwoPrefixes_EachAddsItsObjects_AndAReadSpansThemAsync} |
| A write also moves any rows the table store archived for the stream into its objects. | After a service switches stores, its older archives move out of the database the next time each stream is archived, and the stream's archive ends in one place. | {verified: AzureBlobArchiveStoreTests.Read_EventsTheTableStoreArchived_ComeBackInVersionOrderWithTheObjectsAsync} |
| The tombstone records the stream's locator, `azure-blob://{container}/{stream}?codec=brotli&format=1`. | A reader can tell this store's archives from the table store's, as the [locator format](#locator-format) intends. | {verified: AzureBlobArchiveRegistrationTests.LocatorFor_NamesTheStoreTheContainerAndTheStream_WithBrotliAndFormat1Async} |

### Object format {#azure-blob-object-format}

{verified: ArchiveChunkTests.Brotli_RoundTrip_ReturnsEveryLineExactly_NullsAndEscapesIncludedAsync, ArchiveChunkTests.None_RoundTrip_IsPlainJsonLines_OnePerEventAsync}

An object is **format 1**: one JSON object per line, in version order, compressed by the codec its locator names, and
named `{stream}/{first version}-{last version}-{sha256}.jsonl.br` (versions zero-padded to ten digits, so a stream's
objects list in version order). Each line holds every column of `wh_event_archive` a restore needs:

```json{
title: "One line of an archive object (format 1)"
description: "Every stored column of one event; the body, metadata and scope are the exact jsonb text the hot store returned."
tags: ["archive", "azure-blob", "object-format", "json-lines"]
tests: ["ArchiveChunkTests.None_RoundTrip_IsPlainJsonLines_OnePerEventAsync"]
}
{"event_id":"0199a1b2-...","stream_id":"0199a1b2-...","version":1,"event_type":"Orders.LineAdded, Orders","event_data":"{\"Lines\": [3, 1, 2]}","metadata":"{\"a\": \"two\"}","scope":"{\"t\": \"tenant-1\"}","aggregate_id":"0199a1b2-...","aggregate_type":"Order","created_at":"2026-01-02T03:04:05+00:00","flags":0,"commit_sequence":101,"origin_service_id":null,"origin_commit_sequence":null,"insert_order":1001}
```

| Choice | Reason | Verified |
|---|---|---|
| The body, metadata and scope are stored as text, not re-serialized JSON. | They are the exact `jsonb` text the hot store returned, so a read compares byte for byte with a hot read, and a restore puts the same `jsonb` back. | {verified: ArchiveChunkTests.Brotli_RoundTrip_ReturnsEveryLineExactly_NullsAndEscapesIncludedAsync, AzureBlobArchiveStoreTests.Write_WholeStream_ThenRead_ReturnsTheEventsByteIdenticalInVersionOrderAsync} |
| Every column is written, a missing one as `null`. | A row the earlier archiving truncate copied has no flags or commit position; a reader must see null, not a default, and a restore must leave it for the stamper. | {verified: ArchiveChunkTests.None_RoundTrip_IsPlainJsonLines_OnePerEventAsync} |
| Each object's own locator, with its codec and format, is recorded in its manifest row, and an object is decoded by that codec. | The codec or layout can change later without rewriting older objects; decoding by any other codec is an error, never data. | {verified: ArchiveChunkTests.Decode_WithTheWrongCodec_FailsRatherThanReturningEventsAsync, AzureBlobArchiveStoreTests.Write_WholeStream_ThenRead_ReturnsTheEventsByteIdenticalInVersionOrderAsync} |
| A manifest row whose locator this store did not write (another store, another format, no container and name) is refused, not guessed at. | The manifest is shared database state; a row that is not one of this store's objects is a fault to report. | {verified: ArchiveChunkTests.TryReadObjectLocator_RefusesWhatThisStoreDidNotWrite_RatherThanGuessingAsync, AzureBlobArchiveStoreTests.Read_AManifestRowThisStoreDidNotWrite_IsRefusedAsync} |
| The JSON is written by a source-generated serializer. | No reflection (AOT), and the same bytes every time. | {verified: ArchiveChunkTests.Encode_IsDeterministic_SoARetryWritesTheSameObjectName_AndOtherEventsAnotherAsync} |

### Integrity {#azure-blob-integrity}

{verified: AzureBlobArchiveStoreTests.Read_ACorruptedObject_IsDetectedByItsHash_AndNothingIsDecodedAsync}

Every object is checked against the byte length and SHA-256 its manifest row recorded **before** a byte of it is
decoded. A mismatch throws `ArchiveObjectCorruptedException`, which names the stream, the object's locator and both
hashes.

| Choice | Reason | Verified |
|---|---|---|
| The hash is of the stored (compressed) bytes, and the length is checked too. | A changed byte is caught by the hash, a truncated object by its length, without decompressing anything first. | {verified: AzureBlobArchiveStoreTests.Read_ACorruptedObject_IsDetectedByItsHash_AndNothingIsDecodedAsync} |
| A read stops at the corrupted object and throws; it never skips it. | A replay that silently missed events would build a wrong model. | {verified: AzureBlobArchiveStoreTests.Read_ACorruptedObject_IsDetectedByItsHash_AndNothingIsDecodedAsync} |
| A restore that meets a corrupted object changes nothing: the stream stays archived and the manifest keeps the object. | An operator can repair the object (from storage redundancy or a backup) and restore again. | {verified: AzureBlobArchiveStoreTests.Read_ACorruptedObject_IsDetectedByItsHash_AndNothingIsDecodedAsync} |
| The exception is its own type, not the storage client's `RequestFailedException`. | It is a data fault, not a transient one: a retry policy that retries storage errors must not retry it, because the same read cannot succeed. | {verified: ArchiveObjectCorruptedExceptionTests.TheObjectsConstructor_NamesTheStreamTheObjectAndBothHashesAsync} |

### Reading, restoring and deleting {#azure-blob-reading-restoring-deleting}

{verified: AzureBlobArchiveStoreTests.Restore_PutsTheStreamBackExactly_AndRemovesItsObjectsAsync, AzureBlobArchiveStoreTests.Delete_RemovesTheObjectsAndTheManifest_TheTombstoneStaysAsync}

| Choice | Reason | Verified |
|---|---|---|
| A read downloads only the objects whose range reaches `fromVersion`, one at a time, and filters inside the first. | A read from a late version does not download the whole archive, and memory holds one object. | {verified: AzureBlobArchiveStoreTests.Write_WholeStream_ThenRead_ReturnsTheEventsByteIdenticalInVersionOrderAsync} |
| A read returns the objects, then any rows the table store still holds for the stream. | Every archive takes a stream's lowest hot versions and every write of this store moves the table rows into an object, so a table row is either the whole archive (written before the switch) or above every object: this order is version order. Archives written before the switch stay readable, restorable and deletable. | {verified: AzureBlobArchiveStoreTests.Read_EventsTheTableStoreArchived_ComeBackInVersionOrderWithTheObjectsAsync} |
| An object is read from the container its locator names, even after `ContainerName` changes. | Changing the setting moves new archives only; older objects are never stranded. | {verified: AzureBlobArchiveStoreTests.Read_AnObjectInTheContainerItsLocatorNames_AfterTheSettingChangedAsync} |
| A restore downloads and checks every object, stages its events back into `wh_event_archive`, removes the manifest rows and runs the table store's restore, all in one transaction under the stream's append lock. | The restore is the table store's own (exact versions and commit positions, digests, epochs, cursors, the tombstone back to `Active`), and it is all or nothing. | {verified: AzureBlobArchiveStoreTests.Restore_PutsTheStreamBackExactly_AndRemovesItsObjectsAsync} |
| A `version_conflict` (or `nothing_archived`) restore keeps the manifest and the objects and leaves nothing staged. | A refused restore must leave the archive exactly as it was. | {verified: AzureBlobArchiveStoreTests.Restore_AVersionConflict_KeepsTheArchiveAndItsObjectsAsync} |
| A restored or deleted archive's objects are queued for deletion in its transaction and deleted right after the commit; one that cannot be deleted is logged and stays queued for the [maintenance step](#purging-a-stream-archived-to-blob), and the call still succeeds. | Deleting objects before the commit could leave a manifest naming objects that are gone; queuing them in the transaction means none is ever left unreachable. | {verified: AzureBlobArchiveStoreTests.Delete_AnObjectThatCannotBeRemoved_IsLogged_AndTheDeleteStillCompletesAsync, AzureBlobArchiveStoreTests.Restore_PutsTheStreamBackExactly_AndRemovesItsObjectsAsync} |
| A delete returns the events its objects held plus any the table store held, and the tombstone stays without a locator. | Same contract as the table store's delete: the versions were seen downstream and are never reused. | {verified: AzureBlobArchiveStoreTests.Delete_RemovesTheObjectsAndTheManifest_TheTombstoneStaysAsync} |

### The manifest {#the-archive-manifest}

{verified: ArchiveStoreSqlTests.Purge_AStreamArchivedOutsideTheDatabase_TakesItsManifestRows_AndLeavesOthersAsync, ArchiveStoreSqlTests.Manifest_ARowForAStreamWithNoLifecycleRow_IsRefusedAsync}

`wh_archive_manifest` (migration 268) holds one row per object: the stream, the first and last version and the event
count, the object's locator, its byte length and SHA-256, the origin generation of the archive that wrote it and when.
The key is `(stream_id, first_version)`.

| Choice | Reason | Verified |
|---|---|---|
| The table is store-neutral: the locator names the store. | Another byte-stream store can list its objects the same way. | {verified: AzureBlobArchiveStoreTests.Write_WholeStream_ThenRead_ReturnsTheEventsByteIdenticalInVersionOrderAsync} |
| Each row references its stream's lifecycle row, `ON DELETE CASCADE`; a row for a stream with no lifecycle row is refused. | Every archive writes the lifecycle row first, so an orphan row is a bug. A [stream purge](../../operations/infrastructure/purging-streams) deletes the lifecycle row, which takes the manifest rows with it, so a purged stream can never be restored from an object that outlived it. The purge report does not count the cascaded rows. The key of a lifecycle row never changes, so the append path's updates to it queue no check. | {verified: ArchiveStoreSqlTests.Purge_AStreamArchivedOutsideTheDatabase_TakesItsManifestRows_AndLeavesOthersAsync, ArchiveStoreSqlTests.Manifest_ARowForAStreamWithNoLifecycleRow_IsRefusedAsync, AzureBlobArchiveStoreTests.Purge_QueuesTheObjects_AndTheStepDeletesThemAsync} |
| A purge queues the stream's objects for deletion in its own transaction, and a maintenance step deletes them. | The purge is one SQL transaction and cannot reach blob storage, so it records what to delete and the step does it; see [Purging a stream archived to blob](#purging-a-stream-archived-to-blob). | {verified: AzureBlobArchiveStoreTests.Purge_QueuesTheObjects_AndTheStepDeletesThemAsync} |

### Purging a stream archived to blob {#purging-a-stream-archived-to-blob}

{verified: AzureBlobArchiveStoreTests.Purge_QueuesTheObjects_AndTheStepDeletesThemAsync, ArchiveStoreSqlTests.Purge_QueuesTheObjectsItsManifestRowsNamed_InItsOwnTransactionAsync}

A [stream purge](../../operations/infrastructure/purging-streams) removes every byte of the stream, its archive objects
included. Every object a manifest row stops naming is queued in `wh_archive_object_deletions` (migration 269), and the
`archive-object-deletion` maintenance step that the package registers deletes the queued objects.

| Choice | Reason | Verified |
|---|---|---|
| The queue is written by a trigger on `wh_archive_manifest`, in the transaction that removes the rows: a purge (by the cascade from the lifecycle row), a restore or a delete. A purge that rolls back queues nothing. | The objects to delete are recorded atomically with the rows that named them, so a committed purge always has them queued and a rolled-back one never does. The trigger covers every way a row can go without redefining `wh_purge_streams`. | {verified: ArchiveStoreSqlTests.Purge_QueuesTheObjectsItsManifestRowsNamed_InItsOwnTransactionAsync} |
| Each queued row keeps the object's locator: the store, the container and the object name. | The step deletes from the container the object was written to, even after `ContainerName` changes. | {verified: ArchiveStoreSqlTests.Purge_QueuesTheObjectsItsManifestRowsNamed_InItsOwnTransactionAsync, AzureBlobArchiveStoreTests.Purge_QueuesTheObjects_AndTheStepDeletesThemAsync} |
| The step runs in the maintenance cycle, so under the maintainer duty when role assignment manages it, and deletes at most 100 due objects per cycle. | Deleting is fleet-wide work on shared state, done by one instance; a purge of many streams drains over several cycles instead of holding one cycle for a long run of storage calls. | {verified: AzureBlobArchiveRegistrationTests.Registration_AddsTheObjectDeletionStep_OnlyWithThePackageAsync, AzureBlobArchiveStoreTests.Purge_QueuesTheObjects_AndTheStepDeletesThemAsync} |
| A row is removed only once storage confirms the delete; an object that is already gone (404) counts as deleted. | Nothing is forgotten before it is really gone, and a delete that succeeded on a run whose confirmation was lost is not retried forever. | {verified: AzureBlobArchiveStoreTests.Step_AnObjectAlreadyGone_CountsAsDeletedAsync} |
| A failed delete stays queued: the attempt is counted, the error kept and logged as a warning naming the object, and the next try waits one minute, doubling each failure, at most one hour. | A storage outage is retried without hammering the service, and an object that keeps failing is visible in the log and in `last_error`. An hour caps the wait so a recovered account is cleaned up the same day. | {verified: AzureBlobArchiveStoreTests.Step_AFailingDelete_StaysQueued_AndIsRetriedAfterItsBackoffAsync} |
| An object whose stream's append lock is held (a write is archiving the stream) is left for a later cycle, without counting an attempt. | That write may be uploading an object of the same name: names follow content, so archiving the same events again after a restore writes the same name. | {verified: AzureBlobArchiveStoreTests.Step_AnObjectWhoseStreamIsBeingArchived_IsLeftForALaterRun_WithoutCountingAnAttemptAsync} |
| A write takes the names it uploads back out of the queue, in its transaction and under the stream's lock. | An object that is live again must never be deleted. | {verified: AzureBlobArchiveStoreTests.Restore_ThenArchiveTheSameEventsAgain_KeepsTheLiveObject_OutOfTheQueueAsync} |
| A service with only the Postgres-table store queues nothing and has no such step. | Its archive never leaves the database, so a purge already removed every byte. | {verified: ArchiveStoreSqlTests.Purge_OfATableStoreArchive_QueuesNothingAsync, AzureBlobArchiveRegistrationTests.Registration_AddsTheObjectDeletionStep_OnlyWithThePackageAsync} |

## Related

- [Stream end-of-life](stream-end-of-life): when a stream is sealed, archived, compacted or purged.
- [Event streams](event-streams#truncating-a-stream-prefix): the gated prefix truncate a prefix archive runs.
- [Stream integrity](../../resilience/stream-integrity): the origin generation every archive bumps.
- [Azure Blob offload provider](../offloads/providers/azure-blob): the same storage account conventions for message bodies.
