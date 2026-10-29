---
title: Archive Store
pageType: concept
version: 1.0.0
category: Core Concepts
order: 16
description: >-
  IArchiveStore moves a stream's events out of the hot event store and back: copy then truncate in one
  transaction, a byte-identical read in version order, a tombstone that refuses version reuse, and an exact restore.
  The Postgres-table store is built in.
tags: 'archive, archive-store, stream-end-of-life, tombstone, origin-generation, wh_event_archive'
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
testReferences:
  - tests/Whizbang.Core.Tests/Archival/ArchiveBatchTests.cs
  - tests/Whizbang.Core.Tests/Archival/ArchiveLocatorTests.cs
  - tests/Whizbang.Core.Tests/Lifecycle/StreamPrefixTruncatorArchiveStoreTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ArchiveStoreSqlTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperArchiveStoreTests.cs
---

# Archive Store

A finished or long-idle stream costs the same bytes, index entries and vacuum work in the hot event store as a
stream written today. `IArchiveStore` moves a stream's events out of the hot store and keeps them readable, so hot
storage holds only streams someone still reads. It is the storage half of
[stream end-of-life](stream-end-of-life): the lifecycle decides *when* a stream is archived, the archive store
decides *where its events go and how they come back*.

The framework ships one store, the **Postgres-table store** (`wh_event_archive` in the service's own database),
registered by both Postgres drivers. A blob store replaces it by registering its own `IArchiveStore`.

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
| A prefix version of 0 is accepted, a negative one refused. | A directly appended stream starts at version 0, so 0 is a real prefix; a negative version names nothing. | {verified: ArchiveBatchTests.Prefix_AcceptsVersionZero_RefusesANegativeVersionAsync} |
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
| The stream becomes `Active`, its locator is cleared, and the generation is bumped. | Appends continue above the last version, and integrity re-verifies the history that came back. | {verified: ArchiveStoreSqlTests.Restore_PutsTheStreamBackExactly_CursorsDigestsAndPositionsIncludedAsync} |
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

## Related

- [Stream end-of-life](stream-end-of-life): when a stream is sealed, archived, compacted or purged.
- [Event streams](event-streams#truncating-a-stream-prefix): the gated prefix truncate a prefix archive runs.
- [Stream integrity](../../resilience/stream-integrity): the origin generation every archive bumps.
