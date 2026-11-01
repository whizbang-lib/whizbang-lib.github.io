---
title: Perspective Rebuild
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Perspectives
order: 10
description: >-
  Rebuild perspective read models using blue-green, in-place, or
  stream-level replay modes with progress tracking and cancellation
tags: >-
  perspectives, rebuild, blue-green, event-replay, migration,
  read-models, operational
codeReferences:
  - src/Whizbang.Core/Perspectives/IPerspectiveRebuilder.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveRowDigest.cs
  - src/Whizbang.Data.EFCore.Postgres/Perspectives/EFCorePostgresPerspectiveRowDigest.cs
  - src/Whizbang.Core/Perspectives/PerspectiveRebuilder.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveTableSwapper.cs
  - src/Whizbang.Core/Perspectives/PerspectiveTableRedirect.cs
  - src/Whizbang.Data.Postgres/Perspectives/PostgresPerspectiveTableSwapper.cs
  - src/Whizbang.Core/Perspectives/System/PerspectiveStatusModel.cs
  - src/Whizbang.Core/Workers/PerspectiveMigrationWorker.cs
  - src/Whizbang.Core/Commands/System/SystemCommands.cs
  - src/Whizbang.Core/Events/System/SystemEvents.cs
  - src/Whizbang.Core/Perspectives/RebuildArchivedData.cs
  - src/Whizbang.Core/Archival/IArchivedStreamExtents.cs
  - src/Whizbang.Core/Archival/ArchiveAwareEventStoreDecorator.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveRunner.cs
  - src/Whizbang.Data.Postgres/PostgresArchivedStreamExtents.cs
  - src/Whizbang.Data.Postgres/Migrations/273_RebuildParksTheCursorOfAStreamArchivedWhole.sql
  - src/Whizbang.Data.EFCore.Postgres/EFCorePostgresPerspectiveCheckpointCompleter.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperPostgresPerspectiveCheckpointCompleter.cs
  - src/Whizbang.Data.EFCore.Postgres/RebuildPerspectiveCommandReceptor.cs
testReferences:
  - tests/Whizbang.Core.Tests/Perspectives/PerspectiveRebuilderTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/RebuildProvenanceTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/PerspectiveRowDigestIntegrationTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/PerspectiveRebuilderBlueGreenTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/BlueGreenRebuildIntegrationTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/Perspectives/PostgresPerspectiveTableSwapperTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/PerspectiveRebuilderIntegrationTests.cs
  - tests/Whizbang.Core.Tests/Commands/System/SystemCommandsTests.cs
  - tests/Whizbang.Core.Tests/Commands/System/RebuildPerspectiveCommandSplitTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/ArchiveReadThroughIntegrationTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/PerspectiveRebuilderArchivedDataTests.cs
  - tests/Whizbang.Core.Tests/Archival/ArchiveAwareEventStoreDecoratorTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ArchivedStreamRebuildSqlTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperArchivedStreamRebuildTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/RebuildPerspectiveCommandReceptorCoverageTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Collective/CollectiveReplayOrderingTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/PerspectiveRewindWriteCheckTests.cs
lastMaintainedCommit: '01f07906'
---

# Perspective Rebuild

When a perspective's schema changes or data becomes stale, Whizbang provides multiple **rebuild modes** to reconstruct read models from event history.

## IPerspectiveRebuilder

```csharp{title="IPerspectiveRebuilder" description="IPerspectiveRebuilder" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "IPerspectiveRebuilder"] tests=["PerspectiveRebuilderTests.RebuildBlueGreenAsync_CompletesSuccessfullyAsync", "PerspectiveRebuilderTests.RebuildInPlaceAsync_WithRegisteredPerspective_ProcessesAllStreamsAsync", "PerspectiveRebuilderTests.RebuildStreamsAsync_WithSpecificStreams_OnlyProcessesThoseAsync", "PerspectiveRebuilderTests.GetRebuildStatusAsync_WithNoActiveRebuild_ReturnsNullAsync"]}
public interface IPerspectiveRebuilder {
  Task<RebuildResult> RebuildBlueGreenAsync(string perspectiveName, CancellationToken ct = default);
  Task<RebuildResult> RebuildInPlaceAsync(string perspectiveName, CancellationToken ct = default);
  Task<RebuildResult> RebuildStreamsAsync(string perspectiveName, IEnumerable<Guid> streamIds, CancellationToken ct = default);
  Task<RebuildStatus?> GetRebuildStatusAsync(string perspectiveName, CancellationToken ct = default);

  // Same three, recording who asked. Default implementations forward to the above, so an existing
  // implementation keeps compiling and simply records no origin.
  Task<RebuildResult> RebuildBlueGreenAsync(string perspectiveName, RebuildOrigin origin, CancellationToken ct = default);
  Task<RebuildResult> RebuildInPlaceAsync(string perspectiveName, RebuildOrigin origin, CancellationToken ct = default);
  Task<RebuildResult> RebuildStreamsAsync(string perspectiveName, IEnumerable<Guid> streamIds, RebuildOrigin origin, CancellationToken ct = default);
}
```

## Rebuild Modes

### Blue-Green {#blue-green}

{verified: PerspectiveRebuilderBlueGreenTests.BlueGreen_ReplaysIntoTheShadowTable_ThenSwapsItInAsync, PerspectiveRebuilderBlueGreenTests.BlueGreen_CatchesUpTheStreamsWrittenWhileItRan_AndTheLastOnesUnderTheWriteLockAsync, BlueGreenRebuildIntegrationTests.BlueGreen_ReadersSeeTheCompleteLiveTableThroughout_AndTheSwapInstallsTheRebuiltRowsAsync, PostgresPerspectiveTableSwapperTests.Swap_ReadersAreNotBlocked_AndAHeldWriterContinuesAgainstTheNewTableAsync}

Replays every stream into a **shadow table** while readers keep the live table, then swaps the shadow in
atomically. Use it when a consumer re-projects to fill a new column and must keep serving consistent reads
while it does: a reader sees the complete previous projection until the swap, and the complete rebuilt one
after it, never anything in between.

```csharp{title="Blue-Green" description="Replay into a shadow table, catch up, and swap it in atomically." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Blue-Green"] tests=["PerspectiveRebuilderBlueGreenTests.BlueGreen_ReplaysIntoTheShadowTable_ThenSwapsItInAsync"]}
var result = await rebuilder.RebuildBlueGreenAsync("OrderPerspective");
// Reads are served from the live table throughout; the swap is one transaction.
```

How it runs:

1. **Shadow table.** `wh_per_order_bg` is created with the live table's columns, defaults, constraints and
   indexes (a shadow left by a failed rebuild is replaced).
2. **Replay.** Every stream is replayed into the shadow table. The perspective store of the rebuild's own flow
   is redirected there (`PerspectiveTableRedirect`); every other flow, including the live perspective worker,
   keeps reading and writing the live table.
3. **Catch-up.** Writers keep writing the live table meanwhile, so the rebuild replays again the streams whose
   events were committed after it read them, judged by commit sequence: up to `MaxCatchUpPasses` times with the
   live table open. A collective event committed meanwhile can change any row, so it makes every stream count as
   changed.
4. **Swap.** One transaction closes the live table to writers (readers carry on), catches up the last streams,
   then renames: the live table to `wh_per_order_bg_old` (or drops it), the shadow table to the live name, and
   each index to the name it had on the live table, so the schema pass finds its indexes in place. A writer that
   was held back continues against the new table once the swap commits. The rename waits for readers in flight
   for at most `SwapLockTimeout`.

A rebuild that fails, or a swap that cannot get its locks in time, drops the shadow table and leaves the live
table exactly as it was.

```csharp{title="Blue-green options" description="Keep or drop the previous table, catch-up passes, and the swap's lock timeout." category="Configuration" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Blue-Green"] unverified="Options registration — configuration, asserted through PerspectiveRebuilderBlueGreenTests.BlueGreen_WithNoCatchUpPasses_LeavesEveryChangeToTheSwapAsync"}
services.Configure<BlueGreenRebuildOptions>(o => {
  o.KeepPreviousTable = true;                       // default: keep wh_per_order_bg_old as the way back
  o.MaxCatchUpPasses = 3;                           // default
  o.SwapLockTimeout = TimeSpan.FromSeconds(10);     // default
});
```

A kept previous table is replaced by the next blue-green rebuild of the same perspective; drop it yourself once
the rebuilt table is confirmed.

**Progress.** `GetRebuildStatusAsync` reports the phase (`Replaying`, `CatchingUp`, `Swapping`) and the streams
processed out of the phase's total while the rebuild runs.

**Drivers.** Both PostgreSQL drivers (EF Core and Dapper) register the swapper. A driver without one rebuilds
blue-green in place, as every driver did before, and logs a warning that it did.

**Best for**: Production re-projections where reads must stay consistent.

### In-Place

Truncate the active table and replay all events directly. Faster but causes temporary data unavailability during replay.

```csharp{title="In-Place" description="Truncate the active table and replay all events directly." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "In-Place"] tests=["PerspectiveRebuilderTests.RebuildInPlaceAsync_WithRegisteredPerspective_ProcessesAllStreamsAsync"]}
var result = await rebuilder.RebuildInPlaceAsync("OrderPerspective");
```

**Best for**: Development, staging, or maintenance windows.

### Selected Streams

Replay events for specific streams only. Useful for fixing individual corrupted or stale projections without rebuilding everything.

```csharp{title="Selected Streams" description="Replay events for specific streams only." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Selected", "Streams"] tests=["PerspectiveRebuilderTests.RebuildStreamsAsync_WithSpecificStreams_OnlyProcessesThoseAsync"]}
var corruptedStreams = new[] { orderId1, orderId2 };
var result = await rebuilder.RebuildStreamsAsync("OrderPerspective", corruptedStreams);
```

**Best for**: Targeted fixes for specific aggregates.

### Fold order and the recorded position {#fold-order}

{verified: PerspectiveRebuilderIntegrationTests.RebuildStreamsAsync_WhenCommitSequencesRunBackwardAgainstVersions_FoldsInVersionOrderAndWritesItAsync, PerspectiveRebuilderIntegrationTests.RebuildStreamsAsync_StampsRunBackward_EveryFieldEndsOnItsLastVersionAsync, PerspectiveRebuilderIntegrationTests.RebuildStreamsAsync_StampsRunBackward_RebuildingTwiceLeavesTheSameRowAsync, PerspectiveRebuilderIntegrationTests.RebuildStreamsAsync_StampsRunBackwardAndNoRowExists_CreatesTheVersionOrderRowAsync}

A rebuild folds each stream in the order it was written: its versions, as the [rewind](rewind) does. Folding by commit sequence was wrong for streams whose rows were stamped after the fact, because their sequences can run backward against their versions. Such a rebuild applied the last write first and left every field that a later event overwrote holding an older value, not only the field the rebuild was run to repair.

The rebuilt row records the **highest commit sequence among the events it folded** as its position, as the rewind's frontier does, not the sequence of the last event it applied. In stream order the last event can carry the lowest sequence on the stream. The perspective store refuses a write whose position sits below the stored one, so recording that sequence would fold the right value and then fail to write it, which matters most when repairing a row a commit-order rebuild left behind.

## Archived data {#archived-data}

{verified: PerspectiveRebuilderArchivedDataTests.RebuildArchivedData_DefaultsToSkip_OnTheEnumAndOnARebuildRequestAsync, PerspectiveRebuilderArchivedDataTests.Rebuild_ByDefault_SkipsAStreamArchivedWhole_AndReportsItSkippedNotFailedAsync, PerspectiveRebuilderArchivedDataTests.Rebuild_IncludeWhileLive_ReplaysAPrefixArchivedStreamFromItsStart_AndStillSkipsOneArchivedWholeAsync, PerspectiveRebuilderArchivedDataTests.Rebuild_IncludeAll_ReplaysAStreamArchivedWhole_AndOneArchivedThroughAPrefix_FromTheirStartAsync}

A rebuild re-derives rows from events, and some of a stream's events may be in the
[archive](../events/archive-store). Whether a rebuild reaches into the archive is chosen per rebuild, with
`RebuildArchivedData`. By default it does not.

| Value | What the rebuild may read |
|---|---|
| `Skip` (0, the default) | Nothing archived. A stream archived through a prefix starts from its newest live snapshot; a stream archived whole is skipped. |
| `IncludeWhileLive` (1) | The archived prefix of a stream that is still alive, read through the archive from the stream's start. A stream archived whole is still skipped. |
| `IncludeAll` (2) | Every archived event, a stream archived whole included. |

A stream is **alive** while it still has live (not archived) events, so only a prefix of it is archived. A stream
archived whole is not alive. How much of each stream is archived comes from the stream lifecycle ledger, which the
rebuild asks once per phase for the streams it is about to replay.

Set the choice on the operator's command, or on the `RebuildOrigin` you pass to the rebuilder:

```csharp{title="Choosing what a rebuild reads of the archive" description="A rebuild command and a direct rebuilder call that opt in to archived data; with neither set, the rebuild reads none." category="Perspectives" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Rebuild", "Archive"] tests=["RebuildPerspectiveCommandReceptorCoverageTests.HandleAsync_CarriesTheCommandsArchivedDataChoice_OnTheOriginAsync", "PerspectiveRebuilderArchivedDataTests.Rebuild_IncludeWhileLive_ReplaysAPrefixArchivedStreamFromItsStart_AndStillSkipsOneArchivedWholeAsync", "PerspectiveRebuilderArchivedDataTests.Rebuild_IncludeAll_ReplaysAStreamArchivedWhole_AndOneArchivedThroughAPrefix_FromTheirStartAsync"]}
// Through the system command: the receptor carries the choice onto the rebuild's origin.
await dispatcher.SendAsync(new RebuildPerspectiveCommand(
    PerspectiveNames: ["OrderPerspective"],
    IncludeStreamIds: [orderId]) {
  ArchivedData = RebuildArchivedData.IncludeWhileLive
});

// Directly on the rebuilder.
var result = await rebuilder.RebuildStreamsAsync(
    "OrderPerspective",
    [orderId],
    new RebuildOrigin(RequestedBy: "ops: incident 1234") { ArchivedData = RebuildArchivedData.IncludeAll });
```

### What each stream does {#archived-data-per-stream}

| Stream | `Skip` (default) | `IncludeWhileLive` | `IncludeAll` |
|---|---|---|---|
| Nothing archived | Replays from its start | Same | Same |
| Archived through a prefix (alive) | Restores its newest live snapshot and replays the hot events after it; **skipped** when it has no live snapshot | Replays from its start through the archive | Same as `IncludeWhileLive` |
| Archived whole (not alive) | **Skipped** | **Skipped** | Replays from its start through the archive; its cursor is [parked](#archived-data-parked-cursor) |

A skipped stream's row is left as it is. It is counted in [`RebuildResult.StreamsSkipped`](#reading-the-result),
never as a failure, and the rebuild logs how many streams it skipped and which choice skipped them. A host with no
archive registered rebuilds every stream from its start, as before.

### Why each choice {#archived-data-reasons}

| Choice | Reason | Verified |
|---|---|---|
| The default is `Skip`, and `Skip` is 0. | Reading the archive costs a restore-sized read per stream and may reach cold storage, so a rebuild does not do it unasked. An unset value (a command or origin built before the option existed, or no origin at all) is the safe one. | {verified: PerspectiveRebuilderArchivedDataTests.RebuildArchivedData_DefaultsToSkip_OnTheEnumAndOnARebuildRequestAsync, PerspectiveRebuilderArchivedDataTests.Rebuild_WithNoOrigin_ReadsNoArchivedDataAsync} |
| By default a stream archived whole is skipped and reported as skipped. | Its events are all archived, so rebuilding it would read only the archive. Skipping it also removes the cursor failure it used to cause. A rebuild of named streams that skipped them all succeeds, because nothing went wrong. | {verified: PerspectiveRebuilderArchivedDataTests.Rebuild_ByDefault_SkipsAStreamArchivedWhole_AndReportsItSkippedNotFailedAsync, ArchiveReadThroughIntegrationTests.Rebuild_WithoutIncludeAll_SkipsAStreamArchivedWhole_AndReportsItSkippedAsync} |
| By default a stream archived through a prefix starts from its newest live snapshot and reads no archived event. | The newest snapshot is always live: an archive refuses a prefix that reaches the newest snapshot any perspective holds for the stream. The snapshot plus the hot events after it is the whole stream without the archive. It runs the rewind's replay from a model, under the apply lock. | {verified: PerspectiveRebuilderArchivedDataTests.Rebuild_ByDefault_StartsAStreamArchivedThroughAPrefix_FromItsNewestLiveSnapshotAsync, ArchiveReadThroughIntegrationTests.Rebuild_ByDefault_StartsAStreamArchivedThroughAPrefix_FromItsNewestLiveSnapshot_AndReadsNoArchivedEventAsync} |
| A prefix stream with no live snapshot is skipped, not failed. | Without a snapshot the only start is the stream's start, which is archived. A hand-written runner that cannot start from a snapshot (the interface's default) skips such a stream the same way and keeps compiling. | {verified: PerspectiveRebuilderArchivedDataTests.Rebuild_ByDefault_SkipsAStreamArchivedThroughAPrefix_ThatHasNoLiveSnapshotAsync, PerspectiveRebuilderArchivedDataTests.Rebuild_ByDefault_WithARunnerThatCannotStartFromASnapshot_SkipsAPrefixArchivedStreamAsync, ArchiveReadThroughIntegrationTests.Rebuild_ByDefault_SkipsAStreamArchivedThroughAPrefix_WithNoLiveSnapshot_AndReportsItSkippedAsync} |
| Under `Skip` the event store's archive seam returns only hot events, on every read from the start. | `Skip` means no archived event is read at all, whichever reader the rebuild calls. | {verified: ArchiveAwareEventStoreDecoratorTests.ARebuildThatSkipsArchivedData_ReadsOnlyTheHotEvents_OnEveryReadPathAsync} |
| `IncludeWhileLive` replays a live stream from its start through the archive, and still skips a stream archived whole. | It is the rebuild an operator expects of a stream that is still in use: the same row as the stream never archived. A stream archived whole stays out, because rebuilding it means parking its cursor, which is a separate decision. | {verified: PerspectiveRebuilderArchivedDataTests.Rebuild_IncludeWhileLive_ReplaysAPrefixArchivedStreamFromItsStart_AndStillSkipsOneArchivedWholeAsync, ArchiveReadThroughIntegrationTests.Rebuild_IncludeWhileLive_AHotStream_AndOneArchivedThroughAPrefix_FoldToTheSameRowAsync, ArchiveReadThroughIntegrationTests.Rebuild_WithoutIncludeAll_SkipsAStreamArchivedWhole_AndReportsItSkippedAsync, ArchiveAwareEventStoreDecoratorTests.ARebuildThatIncludesArchivedData_ReadsThroughTheGapAsync} |
| `IncludeAll` also replays a stream archived whole, from its start through the archive. | For a rebuild that must cover every row a perspective holds, archived or not. | {verified: PerspectiveRebuilderArchivedDataTests.Rebuild_IncludeAll_ReplaysAStreamArchivedWhole_AndOneArchivedThroughAPrefix_FromTheirStartAsync, ArchiveReadThroughIntegrationTests.Rebuild_IncludeAll_RebuildsAStreamArchivedWhole_ParksItsCursor_AndTheRestoreBringsTheCursorBackAsync} |
| The choice travels on the request (`RebuildOrigin.ArchivedData`, `RebuildPerspectiveCommand.ArchivedData`) and is held ambient while the rebuild replays (`RebuildArchivedDataAccessor.Current`). | `RebuildOrigin` already goes everywhere a rebuild does: the rebuilder overloads, a run recorded for the streams' owners, the background queue and the rebuild events. Holding it ambient lets the readers the rebuild calls (the archive seam, the collective replay) honor it with no new parameter on every read. It applies only while the processing mode is `Rebuild`, and the previous value is put back afterwards. | {verified: RebuildPerspectiveCommandReceptorCoverageTests.HandleAsync_CarriesTheCommandsArchivedDataChoice_OnTheOriginAsync, PerspectiveRebuilderArchivedDataTests.Rebuild_HoldsItsArchivedDataChoice_AmbientForItsReaders_AndRestoresItAfterwardsAsync} |
| Both Postgres drivers register the ledger lookup (`IArchivedStreamExtents`). | The rebuild decides per stream from one lookup per phase, the same way on either driver. | {verified: ArchivedStreamRebuildSqlTests.TheDriver_RegistersTheArchivedStreamExtents_OnItsArchiveConnectionAsync, DapperArchivedStreamRebuildTests.AddWhizbangPostgres_RegistersTheArchivedStreamExtents_ThatNameTheStreamsArchivedWholeAndThroughAPrefixAsync} |

The tests live in `tests/Whizbang.Core.Tests/Perspectives/PerspectiveRebuilderArchivedDataTests.cs`,
`tests/Whizbang.Core.Tests/Archival/ArchiveAwareEventStoreDecoratorTests.cs`,
`tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/ArchiveReadThroughIntegrationTests.cs`,
`tests/Whizbang.Data.EFCore.Postgres.Tests/ArchivedStreamRebuildSqlTests.cs`,
`tests/Whizbang.Data.EFCore.Postgres.Tests/RebuildPerspectiveCommandReceptorCoverageTests.cs` and
`tests/Whizbang.Data.Dapper.Postgres.Tests/DapperArchivedStreamRebuildTests.cs`. Each fails if its choice flips.

### The parked cursor {#archived-data-parked-cursor}

{verified: ArchivedStreamRebuildSqlTests.Completer_TheCursorOfAStreamArchivedWhole_IsParked_AndTheRestoreBringsItBackAsync, ArchivedStreamRebuildSqlTests.Completer_TheCursorOfAHotStream_IsWrittenLive_AndNothingIsParkedAsync, DapperArchivedStreamRebuildTests.Completer_TheCursorOfAStreamArchivedWhole_IsParked_AndTheRestoreBringsItBackAsync, DapperArchivedStreamRebuildTests.Completer_TheCursorOfAHotStream_IsWrittenLiveAsync}

A stream rebuilt under `IncludeAll` while it is archived whole ends on an archived event, which the live cursor table
must not name: the EF Core schema's cursor foreign key refuses it, and on any schema the cursor would point at an
event no read finds. An archive of the whole stream already parks the stream's cursors in
`wh_event_archive_cursors`, and a restore puts them back, so the rebuilt cursor is written there.

Both drivers' rebuild cursor completers call `wh_complete_rebuilt_cursor` (migration 273):

- while the stream's lifecycle row is `Archived`, the rebuilt cursor moves the parked one to the rebuilt event, or
  parks a new one;
- for any other stream, it is upserted into `wh_perspective_cursors`, exactly as the completers wrote it before.

Parking keeps the exact position, so a restore brings back the cursor the rebuild recorded, with the events it
names, rather than one to work out again.

### Rewinds are unchanged {#archived-data-rewinds}

{verified: ArchiveAwareEventStoreDecoratorTests.ARewind_AndALiveRead_ReadThroughTheGap_WhateverARebuildWouldChooseAsync, CollectiveReplayOrderingTests.Interleave_InAReplay_ListsTheCollectiveStreamsArchivedWhole_WhateverARebuildWouldChooseAsync, ArchiveReadThroughIntegrationTests.Rewind_WithoutASnapshot_OfAStreamArchivedWhole_FoldsToTheSameRowAsTheHotCopyAsync, PerspectiveRewindWriteCheckTests.ARewindFromASnapshotTheArchiveCovers_ReadsThroughTheArchive_AboveTheSnapshotsVersionAsync}

The choice applies to rebuilds only. A [rewind](rewind) and a live read still read through the archive, and a rewind
past an archived snapshot still reads the archived events above it
([rewind past an archived snapshot](../events/archive-store#rewind-past-an-archived-snapshot)). A rewind repairs a
row the live path has already built, so it must fold every event the row was built from.

With `Whizbang:Archive:ReadThrough` set to `false`, nothing reads through the archive, so a rebuild that opts in folds
only what is hot.

## RebuildResult {#reading-the-result}

```csharp{title="RebuildResult" description="What a rebuild did: streams requested, refused, rebuilt and purged" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "RebuildResult"] tests=["PerspectiveRebuilderTests.RebuildInPlaceAsync_WithRegisteredPerspective_ProcessesAllStreamsAsync", "PerspectiveRebuilderTests.RebuildStreamsAsync_WhenEveryNamedStreamIsRefused_ReportsTheRefusalsAsAFailureAsync", "PerspectiveRebuilderIntegrationTests.RebuildStreamsAsync_ReportsHowManyRequestedStreamsItActuallyFoundAsync", "PerspectiveRebuilderArchivedDataTests.Rebuild_ByDefault_SkipsAStreamArchivedWhole_AndReportsItSkippedNotFailedAsync"]}
public record RebuildResult(
    string PerspectiveName,
    int StreamsProcessed,
    int EventsReplayed,
    TimeSpan Duration,
    bool Success,
    string? Error) {
  public int StreamsRequested { get; init; }
  public int StreamsRefused { get; init; }
  public int StreamsPurged { get; init; }
  public int StreamsSkipped { get; init; }
}
```

| Property | Meaning |
|---|---|
| `StreamsRequested` | How many stream ids you named, for a rebuild of selected streams. Zero for a whole-perspective rebuild. |
| `StreamsRefused` | Streams left alone because they are state-based (ephemeral or compacted), so not a rebuildable source of truth. |
| `StreamsProcessed` | Streams where events for this perspective were found and replayed. A named stream with no events does not count. |
| `StreamsPurged` | Rebuilt rows that ended purged. See [terminal purges](#terminal-purges). |
| `StreamsSkipped` | Streams left alone for their [archived data](#archived-data): under the default `Skip`, a stream archived whole or one archived through a prefix with no live snapshot; under `IncludeWhileLive`, a stream archived whole. Their rows are left as they are. |

**Naming streams and rebuilding none of them is a failure.** A rebuild of selected streams that refuses every one,
or finds no events for any, returns `Success = false` with an `Error` that says which. Read as a success, it hid 32
unrepaired rows behind a run that looked clean (#1162). A stream skipped for its archived data is the exception: it is
reported in `StreamsSkipped`, so a rebuild of named streams that skipped them all succeeds.

### Streams that end in a purge {#terminal-purges}

When a stream's last event always purges the row, the rebuild deletes the row without folding the events before it:
whatever they fold, the last apply throws away. One perspective carried 1,206 such streams and 126,947 events; none of
them is folded now. A rewind does the same for a batch that ends in one.

"Always purges" is decided at build time, and conservatively. Only an `Apply` whose whole body is the purge counts:

```csharp{title="An Apply that always purges" description="Only an unconditional purge lets a rebuild skip the fold" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Rebuild", "Purge"] tests=["PerspectiveRunnerTerminalPurgeTests.AnApplyThatCanOnlyPurge_IsATerminalPurgeAsync", "PerspectiveRunnerTerminalPurgeTests.AnApplyThatMightNotPurge_IsReplayedAsync"]}
// Always purges: a stream that ends here is deleted without folding.
public ApplyResult<Account> Apply(Account current, AccountClosed e) => ApplyResult<Account>.Purge();

// Purges only sometimes: replayed in full, because skipping it could delete a row that should survive.
public ApplyResult<Account> Apply(Account current, AccountRetired e) =>
  e.Hard ? ApplyResult<Account>.Purge() : ApplyResult<Account>.Update(current);
```

`ModelAction.Purge` and `(null, ModelAction.Purge)` count too. A body with any other statement, or a condition, is
replayed as before.

"Last" means last for the row. The list a rebuild replays already has the row's collective events interleaved and its
re-keyed events gathered in, so a collective that lands after the purge, or any event that does, means the purge is not
the last word and the stream is replayed. Each purged row is logged with the event that ended it
(`Rebuild of perspective {Perspective} left stream {StreamId} purged: terminal event {PurgedBy}`), and the cursor
completion carries it as `PurgedBy`.

{verified: PerspectiveRebuilderIntegrationTests.RebuildStreamsAsync_WhenTheLastEventAlwaysPurges_DeletesTheRowWithoutFoldingTheStreamAsync, PerspectiveRebuilderIntegrationTests.RebuildStreamsAsync_WhenAnEventFollowsThePurge_ReplaysTheStreamAsync, PerspectiveRebuilderIntegrationTests.RebuildStreamsAsync_WhenItFindsNoneOfTheRequestedStreams_DoesNotReportSuccessAsync}

## System Commands

Trigger rebuilds across distributed services via messaging:

```csharp{title="System Commands" description="Trigger rebuilds across distributed services via messaging:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "System", "Commands"] unverified="Dispatcher command-send illustration; RebuildPerspectiveCommand and CancelPerspectiveRebuildCommand are covered by SystemCommandsTests, outside this page's PerspectiveRebuilderTests candidate set"}
// Rebuild specific perspectives
await dispatcher.SendAsync(new RebuildPerspectiveCommand(
    PerspectiveNames: ["OrderPerspective", "InventoryPerspective"],
    Mode: RebuildMode.BlueGreen));

// Rebuild all perspectives in-place
await dispatcher.SendAsync(new RebuildPerspectiveCommand(
    Mode: RebuildMode.InPlace));

// Rebuild specific streams only
await dispatcher.SendAsync(new RebuildPerspectiveCommand(
    PerspectiveNames: ["OrderPerspective"],
    IncludeStreamIds: [orderId1, orderId2]));

// Rebuild specific streams, replaying an archived prefix through the archive
await dispatcher.SendAsync(new RebuildPerspectiveCommand(
    PerspectiveNames: ["OrderPerspective"],
    IncludeStreamIds: [orderId1, orderId2]) {
  ArchivedData = RebuildArchivedData.IncludeWhileLive
});

// Cancel an in-progress rebuild
await dispatcher.SendAsync(new CancelPerspectiveRebuildCommand("OrderPerspective"));
```

`ArchivedData` (default `Skip`) says what the rebuild may read of archived streams; see
[archived data](#archived-data).

### Large stream selections {#large-stream-selections}

`IncludeStreamIds` travels with the command, whole, to every hop: the outbox row, the broadcast transport
message, each receiving service's inbox, and (when [command auditing](../security/audit-logging#command-auditing)
is on) its audit record. Each id is about 39 bytes of JSON, so 100,000 ids is about 4 MB per hop, and on Azure
Service Bus Standard a list of more than about 6,500 ids exceeds the 256 KB message limit unless large-message
offloading is configured.

Keep one command to **500 streams or fewer**, the same bound an operator's stream redelivery request uses
(`RebuildPerspectiveCommand.DEFAULT_STREAMS_PER_COMMAND`, about 20 KB of ids). `SplitByStreams` turns a larger
selection into several such commands:

```csharp{
title: "Rebuilding a large stream selection in bounded commands"
description: "Splits one rebuild of many named streams into commands of at most 500 streams each, every one with its own request id derived from the caller's, and sends them."
framework: "NET10"
category: "Perspectives"
difficulty: "INTERMEDIATE"
tags: ["rebuild", "system-commands", "stream-selection", "message-size"]
tests: ["RebuildPerspectiveCommandSplitTests.SplitByStreams_ALargeSelection_BecomesCommandsOfAtMostTheChunkSize_InOrderAsync", "RebuildPerspectiveCommandSplitTests.SplitByStreams_DerivesEachRequestIdFromTheCallersAndTheChunkIndexAsync", "RebuildPerspectiveCommandSplitTests.SplitByStreams_ByDefault_NamesAtMostTheRedeliveryBoundPerCommandAsync"]
}
var requestId = Guid.CreateVersion7();
var rebuild = new RebuildPerspectiveCommand(
    PerspectiveNames: ["OrderPerspective"],
    Mode: RebuildMode.SelectedStreams,
    IncludeStreamIds: affectedOrderIds,   // 100,000 ids
    RequestId: requestId,
    RequestedBy: "ops: incident 1234");

foreach (var command in rebuild.SplitByStreams()) {
  // command.RequestId == RebuildPerspectiveCommand.ChunkRequestId(requestId, chunkIndex)
  await dispatcher.SendAsync(command);
}
```

- Each command names at most the chunk size (default 500; pass another to `SplitByStreams`) of the streams,
  in the order given; a stream named twice is rebuilt once.
- Each command's `RequestId` is `ChunkRequestId(requestId, chunkIndex)`: a name-based id of the chunk index
  within your request id, so it is the same every time the same request is split. Each chunk is its own run,
  and a chunk delivered twice finds its own run already recorded. Look for the rebuild events of every chunk id;
  a command with no `RequestId` splits into commands with none.
- `ExcludeStreamIds` is dropped from the chunks: a command that names streams ignores its exclusions anyway.
- A command that names no streams (a whole-perspective rebuild, or an empty list) is returned unchanged.
{verified: RebuildPerspectiveCommandSplitTests.SplitByStreams_AStreamNamedTwice_IsRebuiltOnceAsync, RebuildPerspectiveCommandSplitTests.ChunkRequestId_IsTheNameBasedIdOfTheChunkIndexWithinTheRequestAsync, RebuildPerspectiveCommandSplitTests.SplitByStreams_WithoutARequestId_LeavesEachChunkWithoutOneAsync, RebuildPerspectiveCommandSplitTests.SplitByStreams_KeepsEveryOtherField_AndDropsTheExclusionsTheIncludeListOverridesAsync, RebuildPerspectiveCommandSplitTests.SplitByStreams_NoStreamSelection_ReturnsTheCommandUnchangedAsync}

Command auditing records the **length** of `IncludeStreamIds` and `ExcludeStreamIds`, never the ids, so the
audit record stays small whatever the selection.

## System Events {#rebuild-events}

Every rebuild leaves a durable record. These are ordinary events, so they are queryable long after the
run, which matters because a rebuild is usually an operational action someone checks on later:

| Event | When |
|-------|------|
| `PerspectiveRebuildStarted` | Once the stream set is final, carrying `TotalStreams` |
| `PerspectiveRebuildProgress` | Every hundredth stream, and once when the last one is done |
| `PerspectiveRebuildCompleted` | Success, carrying `StreamsProcessed`, `EventsReplayed` and `Duration` |
| `PerspectiveRebuildFailed` | Failure, carrying the error and how far it got |

All four share one **rebuild stream id** per run, so a reader can group a single rebuild's events, and a
failure that happened before any work publishes `Failed` without a `Started` — a rebuild that never ran
cannot be mistaken for one that did. Subscribe via standard receptors for logging, alerting, or dashboards.

### Knowing whether your rebuild ran {#rebuild-provenance}

`RebuildPerspectiveCommand` is **broadcast to every service**, and each one rebuilds only the perspectives
it hosts: a requested name it does not host is skipped, which is normal and correct. The consequence is
that the acknowledgement cannot tell you whether *any* service owned the name you asked for. A name that
no service hosts is accepted and nothing happens.

Supply a `RequestId` and that becomes answerable. It is stamped onto every event the rebuild emits, so:

```csharp{title="Knowing whether your rebuild ran" description="Stamp a RequestId onto a broadcast rebuild so its events can be found afterwards; no PerspectiveRebuildStarted carrying that id means nothing ran." category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Rebuild", "Observability"] tests=["PerspectiveRebuilderIntegrationTests.RebuildStreamsAsync_PublishesStartedAndCompleted_CarryingTheOriginAsync", "RebuildProvenanceTests.RebuildStarted_CarriesTheOriginItWasGivenAsync"]}
var requestId = Guid.CreateVersion7();
await dispatcher.SendAsync(new RebuildPerspectiveCommand(
    PerspectiveNames: ["OrderPerspective"],
    IncludeStreamIds: [orderId1, orderId2],
    RequestId: requestId,
    RequestedBy: "ops: incident 1234"));

// Afterwards: no PerspectiveRebuildStarted carrying this id means nothing ran, anywhere.
```

`RebuildOrigin` also carries a `RebuildTrigger`, which separates an operator's repair from the framework's
own background work (`Requested`, `Migration`, `StartupScan`). `Unknown` is the zero value, so an event
stored before provenance existed does not claim somebody asked for it.

### Did it change anything? {#rebuild-row-digest}

Those events tell you a rebuild **ran**. They do not tell you whether anything **changed** — and a rebuild
that replays and writes back identical rows is indistinguishable, from the outside, from one that correctly
found nothing to do. For a rebuild of **named streams**, `IPerspectiveRowDigest` records the targeted rows
before and after, onto `PerspectiveRebuildCompleted.RowDigestBefore` / `RowDigestAfter`:

| Outcome | Record | Digest |
|---------|--------|--------|
| Never ran | absent | — |
| Ran, changed nothing | present | equal |
| Ran, changed rows | present | differs |

Scoped to selected streams deliberately: the targeted set is known and small, so the digest costs in
proportion to the repair. A whole-perspective rebuild would have to hash the table it is about to replace.

Two things worth knowing about what it measures. It digests the projected **content** and excludes the
per-write bookkeeping, so a moved digest means the data moved — whether the row was written at all is
already answered by its cursor. And on Postgres it leans on `jsonb` being stored normalized, so the same
content digests identically however the serializer happened to write it; nothing defines a canonical form
of its own. An empty targeted set yields no digest rather than a digest of nothing, which would otherwise
compare equal to another empty one and read as "changed nothing".

A digest is evidence about a rebuild, not part of it: if it cannot be computed the rebuild still succeeds
and the fields are simply absent, which reads as "not known".

## Migration-Triggered Rebuilds

When the migration system detects a **destructive schema change** (column type changed or removed), it records the perspective with status 4 (`MigratingInBackground`). The `PerspectiveMigrationWorker` background service picks this up on startup and automatically triggers a blue-green rebuild.

See [Migration Tracking](../../operations/infrastructure/migrations.md) for details.

## PerspectiveStatusModel

A built-in read model tracks all perspective health:

```csharp{title="PerspectiveStatusModel" description="A built-in read model tracks all perspective health:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "PerspectiveStatusModel"] unverified="PerspectiveStatusModel read-model definition has no mapped test and is outside this page's PerspectiveRebuilderTests candidate set"}
public sealed record PerspectiveStatusModel {
  [StreamId]
  public Guid Id { get; init; }

  [PhysicalField] [Indexed]
  public string PerspectiveName { get; init; } = "";

  [PhysicalField]
  public PerspectiveState State { get; init; }   // Active, Rebuilding, MigratingBlueGreen, Failed, Stale

  public string? SchemaHash { get; init; }
  public DateTimeOffset? LastRebuildStartedAt { get; init; }
  public DateTimeOffset? LastRebuildCompletedAt { get; init; }
  public TimeSpan? LastRebuildDuration { get; init; }
  public RebuildMode? LastRebuildMode { get; init; }
  public string? LastError { get; init; }
  public DateTimeOffset LastUpdatedAt { get; init; }
}
```

Query via Lens for operational dashboards.
