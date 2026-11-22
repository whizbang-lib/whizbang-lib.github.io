---
title: Re-sequencing Received Streams
pageType: guide
version: 1.0.0
category: Infrastructure
order: 13
description: >-
  Store a received stream that was stored out of its origin's order back in that order, in place: each origin's events
  take the versions they already hold in the origin's order, local events stay put, the stream's perspectives replay it
  from its start, and the run is bounded, never waits on a writer, can be repeated, and has a dry run
tags: >-
  operations, streams, ordering, received events, origin order, re-sequence, repair, dry run, rewind,
  IReceivedStreamResequencer
codeReferences:
  - src/Whizbang.Core/Messaging/IReceivedStreamResequencer.cs
  - src/Whizbang.Core/Perspectives/ReceivedStreamOrder.cs
  - src/Whizbang.Core/Perspectives/ReplayEventOrder.cs
  - src/Whizbang.Data.Postgres/PostgresReceivedStreamResequencer.cs
  - src/Whizbang.Data.Postgres/Migrations/555_ReceivedStreamsAreResequencedInTheirOriginsOrder.sql
testReferences:
  - tests/Whizbang.Core.Unit.Perspectives.Tests/Perspectives/ReceivedStreamOrderTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ReceivedStreamResequenceSqlTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperStreamPurgeTests.cs
---

# Re-sequencing Received Streams

Before the receive-order fix (#1607), a receiver could store one producer stream's events out of the producer's order:
two inbox claims holding the same stream could store its later events first, so a stream's initializer ended up after
the field events it initializes. A replay already deals each origin's events back into that origin's order (see
[replay ordering](../../fundamentals/perspectives/rewind.md#replay-ordering)), but everything that reads a stream **by
version** still saw the stored order: a read from a version, a rewind's snapshot floor, a superseding comparison between
copies without origin sequences, and a driver whose reads carry no origin.

`IReceivedStreamResequencer`, registered by both Postgres drivers, stores such streams in the order a replay folds them.
Run it once, dry run first, on a receiver that stored events before the fix.

## The order {#the-order}

The order is the replay's own rule (`ReplayEventOrder`); the re-sequence calls the same code, so the stored order and
the replay order cannot disagree:

| Events in the stream | What the re-sequence stores |
|---|---|
| One origin throughout | That origin's order: by its commit sequence, and an event without one placed among the others by its id, which the origin minted in the order it produced its events |
| One origin among local events | The origin's events take its order in the versions they already hold; the local events keep their versions |
| Several origins | Each origin's events take that origin's order in its own versions, independently; which version belongs to which origin does not change, so the interleaving of origins stays as stored |
| No origins (local events only) | Nothing: a local stream's order is never an origin's to correct |

{verified: ReceivedStreamOrderTests.Resequence_ASingleOriginStoredAgainstItsSequences_IsStoredInTheOriginsOrderAsync, ReceivedStreamOrderTests.Resequence_FanOutChildrenWithoutSequences_AreStoredInTheirIdOrder_TheInitializerFirstAsync, ReceivedStreamOrderTests.Resequence_AMixedStream_ReordersTheOriginsEventsInTheirOwnSlots_AndLeavesLocalEventsInPlaceAsync, ReceivedStreamOrderTests.Resequence_SeveralOrigins_FixesEachOnesOrder_AndKeepsTheirInterleavingAsync, ReceivedStreamOrderTests.Resequence_AStreamAlreadyInItsOriginsOrder_MovesNothingAsync, ReceivedStreamOrderTests.Resequence_AnUnpositionedEvent_IsPlacedAmongThePositionedOnesByItsIdAsync}

The versions are only **permuted** among the events that move. The stream holds the same versions afterwards, gaps
included, so its first and last version, its length, its integrity digests (folded by event id) and its commit
sequences are all unchanged.
{verified: ReceivedStreamOrderTests.Resequence_KeepsTheStreamsVersionSet_GapsIncluded_AndReadsTheStreamInAnyOrderAsync, ReceivedStreamResequenceSqlTests.Resequence_ASingleOriginStoredOutOfOrder_IsStoredInTheOriginsOrderAsync, ReceivedStreamResequenceSqlTests.Apply_AStreamStartingAtVersionZero_IsRenumberedWithoutMeetingItselfAsync}

After a re-sequence, folding the stream in version order and folding it in replay order are the same fold, and a second
re-sequence moves nothing. This is checked over every arrangement of a stream that mixes two origins, events with and
without origin sequences, and a local event.
{verified: ReceivedStreamOrderTests.Resequence_OverEveryArrangement_StoresExactlyTheOrderAReplayFoldsAsync}

## Finding the streams {#finding-the-streams}

The run walks the store a window of streams at a time, in stream id order (`wh_received_stream_order_window`, migration
555). A stream is read only when the window marks it: for one origin, a later version holds a lower event id, or a later
event with an origin sequence holds a lower one. A stream in neither shape is already in its origins' order, so the
check never misses a stream the re-sequence would move. It can mark a stream whose order is right (positioned events in
their origin's order whose ids run backward); the re-sequence then reads it and moves nothing.
{verified: ReceivedStreamResequenceSqlTests.Window_MarksEveryStreamThePlannerWouldMove_AndNoStreamInOrder_OverEveryArrangementAsync, ReceivedStreamResequenceSqlTests.Resequence_AStreamTheWindowMarksWhoseOrderIsRight_IsNotMovedAsync, ReceivedStreamResequenceSqlTests.Resequence_StreamsAlreadyInOrder_AreExaminedAndLeftUntouchedAsync}

## On a live system {#on-a-live-system}

The re-sequence is built to run while the service runs:

- **One transaction per batch.** A batch examines at most `BatchSize` streams (100 by default) and holds at most that
  many stream locks until it commits.
- **It never waits for a writer.** It tries each stream's append lock (the lock every append and inbox store takes) and
  never waits for one. A stream being written is reported `Busy` and left for the next run.
- **It reads again under the lock.** The streams it holds are read again after the locks are taken, and the plan comes
  from that read. An append that arrives during the write waits for the batch to commit and lands after the stream's
  last version, which the re-sequence never changes.
- **It checks before it writes.** Every planned event must still be at the version the plan read. A path that removes
  an event without the stream's lock (between the read and the write) leaves the stream unwritten and reported
  `Changed`.
- **A crash loses nothing.** A batch that fails rolls back whole, renumbering included; batches already committed stay.
  Run it again: a stream already in its origins' order is not touched.
- **It can be bounded.** `MaxStreams` stops the run after that many streams, and the report's `ResumeAfterStreamId`
  says where the next run starts.

{verified: ReceivedStreamResequenceSqlTests.Resequence_AStreamBeingWritten_IsReportedBusy_AndARerunFixesItAsync, ReceivedStreamResequenceSqlTests.Apply_AnAppendDuringTheRun_WaitsForIt_AndLandsAfterTheStreamsLastVersionAsync, ReceivedStreamResequenceSqlTests.Resequence_AnEventRemovedByAPathThatTakesNoStreamLock_LeavesTheStreamForARerunAsync, ReceivedStreamResequenceSqlTests.Apply_APlanTheStreamNoLongerMatches_ChangesNothingAsync, ReceivedStreamResequenceSqlTests.Resequence_ACrashMidRun_RollsBackItsBatchWhole_AndARerunFinishesAsync, ReceivedStreamResequenceSqlTests.Resequence_ABoundedRun_StopsWhereItSays_AndResumesFromThereAsync}

## Running it {#running-it}

Resolve `IReceivedStreamResequencer` from a service's container and run a dry run first. A dry run takes no lock and
writes nothing; its report lists each stream it would re-sequence, every event's move, and how many perspectives and
snapshots the write would affect.

```csharp{title="IReceivedStreamResequencer" description="Re-sequence received streams stored out of their origin's order, dry run first" category="Operations" difficulty="INTERMEDIATE" tags=["Operations", "Infrastructure", "Streams", "IReceivedStreamResequencer", "Ordering"] tests=["ReceivedStreamResequenceSqlTests.DryRun_ReportsWhatItWouldChange_AndChangesNothingAsync", "ReceivedStreamResequenceSqlTests.Resequence_ABoundedRun_StopsWhereItSays_AndResumesFromThereAsync"]}
public sealed class ResequenceEndpoint(IReceivedStreamResequencer resequencer) {
  public async Task<string> ResequenceAsync(string operatorName, string reason, bool dryRun, Guid? resumeAfter) {
    var report = await resequencer.ResequenceAsync(new ReceivedStreamResequenceRequest {
      RequestedBy = operatorName,
      Reason = reason,
      DryRun = dryRun,                    // a dry run reads without locks and writes nothing
      MaxStreams = 10_000,                // optional: bound one run; null walks the whole store
      StartAfterStreamId = resumeAfter,   // where the previous bounded run stopped
    });
    return report.Format();               // one line for the run, one per stream re-sequenced or left alone
  }
}
```

| Request field | Meaning |
|---|---|
| `RequestedBy`, `Reason` | Who asked and why; required, recorded in the log |
| `DryRun` | Report what would change and change nothing |
| `BatchSize` | Streams per batch (one transaction); default 100 |
| `MaxStreams` | The most streams one run examines; null walks the whole store |
| `StartAfterStreamId` | Start after this stream: a previous report's `ResumeAfterStreamId` |
| `RunId` | Identifies the run in the log; a new id by default |

A request without who or why, or with a bound below 1, is refused before anything is read.
{verified: ReceivedStreamResequenceSqlTests.Request_WithoutWhoOrWhyOrAPositiveBound_IsRefusedAsync, ReceivedStreamResequenceSqlTests.Report_Format_SaysWhatChangedAndWhatWasLeftAloneAsync, ReceivedStreamResequenceSqlTests.Resequence_WithALogger_RecordsTheRunAndEachBatch_AndAnEmptyStoreWalksNothingAsync}

The run logs its start and each batch at Information, and its outcome at Warning, with every count. It works the same
on the EF Core and the Dapper driver. On Dapper it matters most: a Dapper read carries no origin, so a replay there
folds in stored order and only the re-sequence puts the stream right.
{verified: ReceivedStreamResequenceSqlTests.Resequence_WithANamedSchema_ReadsAndWritesThatSchemasTablesAsync, DapperStreamPurgeTests.Resequence_OnADapperMigratedDatabase_StoresAReceivedStreamInItsOriginsOrderAsync, DapperStreamPurgeTests.AddWhizbangPostgres_RegistersPurgeMarkersAndStreamPurger_BothOverloadsAsync}

## What a re-sequence changes {#what-a-re-sequence-changes}

For each stream it re-sequences, in the same transaction as the renumbering (`wh_resequence_stream`):

- **The moved events' versions**, and nothing else about them.
- **Snapshots.** Every snapshot of the stream is removed: each one holds a fold in the old order.
- **Perspectives.** Every perspective cursor on the stream, except the collective sink's, is flagged to rewind, with the
  stream's first event as the trigger and its replay frontier cleared, and that trigger is queued as work. With no
  snapshot below the first event, the [rewind](../../fundamentals/perspectives/rewind.md#a-re-sequence-rewinds-from-the-start)
  replays the whole stream in its new order. A worker that claimed work before the re-sequence and completes after it
  cannot settle the rewind: the queued trigger sits below its cursor and flags it again.

{verified: ReceivedStreamResequenceSqlTests.Resequence_RewindsEveryPerspectiveOfTheStreamFromItsStart_AndLeavesTheCollectiveSinkAloneAsync, ReceivedStreamResequenceSqlTests.Apply_ACompletionThatRacesTheFlag_LeavesTheRewindAskedForAsync, ReceivedStreamResequenceSqlTests.DryRun_ReportsWhatItWouldChange_AndChangesNothingAsync}

One case is not covered: if the event that becomes the stream's first is itself being applied by a worker at the moment
the re-sequence commits, that worker's completion consumes the queued trigger. For a stream stored before the fix, that
event was applied long ago.

**Audit records keep the stream position they recorded.** An `EventAudited` record states where its event was stored
when it was audited; that is a fact about the store at that time, and an audit trail is not rewritten. The record also
carries the event's id, which does not change, so the event is found by its id. The run's report (and its Warning log
line) lists every move with its old and new version.

Cached copies of a version (a stream position a client kept, a version-based wait) see the new numbering on their next
read.

## What is left alone {#what-is-left-alone}

An out-of-order stream in one of these shapes is reported with its reason and not touched:

| Reason | Why | What to do |
|---|---|---|
| `Busy` | Another transaction held the stream's lock: it was being written | Run again |
| `Changed` | An event moved or went between the read and the write, by a path that does not take the stream's lock | Run again |
| `Ephemeral` | The stream holds ephemeral events, whose history is reaped, so its perspectives cannot replay it from the start | Nothing; replay already folds origin order within what is kept |
| `Collective` | The stream holds collective events, whose sink queue follows the stored version | Nothing |
| `Archived` | Part of the stream's history is archived, and the archive keeps the versions it was written with | Nothing |

{verified: ReceivedStreamResequenceSqlTests.Resequence_EphemeralCollectiveAndArchivedStreams_AreLeftAloneAndReportedAsync, ReceivedStreamResequenceSqlTests.Resequence_AStreamBeingWritten_IsReportedBusy_AndARerunFixesItAsync, ReceivedStreamResequenceSqlTests.Resequence_AnEventRemovedByAPathThatTakesNoStreamLock_LeavesTheStreamForARerunAsync}

## Related

- [Perspective rewind: replay ordering](../../fundamentals/perspectives/rewind.md#replay-ordering): the rule the
  re-sequence stores
- [Purging streams: refiling composite children](purging-streams.md#refiling-composite-children): the other repair for
  receivers that stored events before a receive fix
- [Perspectives: rebuild](../../fundamentals/perspectives/perspectives.md#rebuild)
- [Migrations](migrations.md): migration 555 adds the window, the lock helper and the apply
