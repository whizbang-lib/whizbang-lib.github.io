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
tags: 'archive, archive-store, stream-end-of-life, tombstone, origin-generation, wh_event_archive, azure-blob, brotli, wh_archive_manifest'
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
| A whole-stream write leaves a tombstone, and no append reuses a version at or below its last version. | Downstream consumers saw those versions; a second event at the same version would make every reader of the stream wrong. | {verified: ArchiveStoreSqlTests.Tombstone_AnAppendAtOrBelowTheArchivedVersion_IsRefused_AboveItIsStoredAsync} |
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
| A prefix version of 0 is accepted, a negative one refused. | A new stream starts at version 1, but a stream a direct append created before migration 267 started at version 0 (see [Stream versions](event-store#stream-versions)), so 0 is a real prefix; a negative version names nothing. | {verified: ArchiveBatchTests.Prefix_AcceptsVersionZero_RefusesANegativeVersionAsync} |
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

## Statuses

| Status | Meaning |
|---|---|
| `archived` | The batch moved. |
| `nothing_to_archive` | The batch named no hot event. |
| `blocked`, `held`, `debug_skipped` | Refused; nothing moved. |
| `no_carry_forward`, `cursor_behind` | A prefix the truncate refused; nothing moved. |
| `restored`, `nothing_archived`, `version_conflict` | A restore's outcomes (below). |

## Tombstones

A whole-stream archive leaves the stream's [lifecycle](stream-end-of-life) row as its tombstone:
`state = 'Archived'`, `last_version`, `archive_locator` and `origin_generation`.
{verified: ArchiveStoreSqlTests.Write_WholeStream_LeavesATombstone_AndBumpsTheOriginGenerationAsync}

### Version reuse is refused

{verified: ArchiveStoreSqlTests.Tombstone_AnAppendAtOrBelowTheArchivedVersion_IsRefused_AboveItIsStoredAsync, ArchiveStoreSqlTests.Tombstone_TheEmitChainCannotReuseAnArchivedVersion_EitherAsync}

The emit chains and the direct append number a stream from its newest hot version. With nothing hot, the next
append would start again at the bottom and reuse a version the archive holds. A statement-level trigger on
`wh_event_store` refuses any insert at or below an archived stream's last version with SQLSTATE `WHA01`, naming the
stream, its archived version and the refused one.

| Choice | Reason | Verified |
|---|---|---|
| The last archived version itself is refused; the next version is stored. | The archive holds the last version; anything above it is new history. | {verified: ArchiveStoreSqlTests.Tombstone_AnAppendAtOrBelowTheArchivedVersion_IsRefused_AboveItIsStoredAsync} |
| The guard is a table trigger, so it covers the emit chains and the direct append alike. | It is the table's backstop, like the `(stream_id, version)` unique index: every write path is covered without each one repeating the check. | {verified: ArchiveStoreSqlTests.Tombstone_TheEmitChainCannotReuseAnArchivedVersion_EitherAsync} |
| One check per insert statement over the inserted rows, not one per row. | The emit chains insert a batch in one statement; the check costs one join over that batch. | {verified: ArchiveStoreSqlTests.Tombstone_TheEmitChainCannotReuseAnArchivedVersion_EitherAsync} |
| The refusal raises, so the whole write rolls back. | A backstop must never store a reused version. The friendly per-type answer to an append to an archived stream (refuse with a typed exception, restore first, or start a new generation) belongs to the write paths and comes with the append-to-archived policy; until then, archive a stream whole only when nothing will append to it. | {verified: ArchiveStoreSqlTests.Tombstone_TheEmitChainCannotReuseAnArchivedVersion_EitherAsync} |
| The tombstone outlives a deleted archive. | The versions were seen downstream whether or not the archived copy still exists. | {verified: ArchiveStoreSqlTests.Delete_RemovesTheArchivedCopy_TheTombstoneStillBlocksReuseAsync} |

### The ledger row {#the-ledger-row}

{verified: ArchiveStoreSqlTests.Write_WholeStream_WithNoLedgerRowYet_BuildsTheTombstoneFromTheEventsAsync, ArchiveStoreSqlTests.ApproxBytes_ArchiveSubtractsWhatLeft_RestoreAddsItBackAsync}

The archive store keeps the stream's [lifecycle ledger](stream-end-of-life#the-stream-lifecycle-ledger) row true to
the hot store:

| Choice | Reason | Verified |
|---|---|---|
| A stream with no ledger row yet (the backfill has not reached it) gets one built from its events by the ledger's own rules: the first event's type, tenant and time, the UTC hour of the newest event. A stream of only ephemeral events uses its first event. | The tombstone is what refuses version reuse, so it must exist whether or not the backfill got there first; reading the same rules as the ledger keeps the row identical to the one the backfill would have written. | {verified: ArchiveStoreSqlTests.Write_WholeStream_WithNoLedgerRowYet_BuildsTheTombstoneFromTheEventsAsync} |
| A prefix archive subtracts the bytes it moved from `approx_bytes` (never below 0); a whole-stream archive sets it to 0; a restore adds the restored bytes back. | `approx_bytes` measures the hot store, which the per-tenant size policy reads; archived bytes no longer cost hot storage. Bytes are counted as stored, as the backfill counts them, so the figure stays approximate. | {verified: ArchiveStoreSqlTests.ApproxBytes_ArchiveSubtractsWhatLeft_RestoreAddsItBackAsync} |
| A restore marks the stream `Active` (`Sealed` when it was sealed) before its events go back, and leaves the row with the stream's newest version. | The version-reuse guard reads the state, so the restore's own inserts pass it, and appends continue above the last version. | {verified: ArchiveStoreSqlTests.Restore_PutsTheStreamBackExactly_CursorsDigestsAndPositionsIncludedAsync, ArchiveStoreSqlTests.Write_WholeStream_WithNoLedgerRowYet_BuildsTheTombstoneFromTheEventsAsync} |
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

## Deleting an archive

`DeleteAsync` removes the archived events and parked cursors for good and returns how many events it deleted. The
tombstone stays, with its locator cleared, so the stream's versions are still never reused. It is an explicit
request, so `debug_mode` does not skip it.
{verified: ArchiveStoreSqlTests.Delete_RemovesTheArchivedCopy_TheTombstoneStillBlocksReuseAsync}

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
