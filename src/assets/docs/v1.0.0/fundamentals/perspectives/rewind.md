---
title: Perspective Rewind
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
description: >-
  How Whizbang detects and repairs out-of-order (late-arriving) events in
  perspective processing — the RewindRequired flag, snapshot-or-full replay, the
  bounded catch-up loop, startup scan, and rewind observability.
order: 13
tags: >-
  perspectives, rewind, late-arriving-events, out-of-order, replay, snapshots,
  startup-scan, observability, operational
codeReferences:
  - src/Whizbang.Core/Perspectives/ReplayEventOrder.cs
  - src/Whizbang.Core/Perspectives/PerspectiveRewindOptions.cs
  - src/Whizbang.Core/Perspectives/PerspectiveSnapshotOptions.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
  - src/Whizbang.Core/Perspectives/PerspectiveRunnerBase.cs
  - src/Whizbang.Core/Events/System/SystemEvents.cs
  - src/Whizbang.Core/Observability/PerspectiveMetrics.cs
  - src/Whizbang.Data.Postgres/Migrations/022_StorePerspectiveEvents.sql
  - src/Whizbang.Data.Postgres/Migrations/005_CreateCompletePerspectiveCheckpointFunction.sql
  - src/Whizbang.Core/Attributes/OverwriteOnlyAttribute.cs
  - src/Whizbang.Core/Perspectives/LastInReplayOrder.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveSnapshotStore.cs
  - src/Whizbang.Core/Archival/ArchiveAwareEventStoreDecorator.cs
  - src/Whizbang.Core/Perspectives/ICollectiveReplayApplier.cs
  - src/Whizbang.Core/Perspectives/CollectiveReplayStart.cs
  - src/Whizbang.Core/Archival/IArchivedStreamExtents.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Core/Workers/StartupRewindSet.cs
  - src/Whizbang.Core/Workers/RewindRepeatGuard.cs
  - src/Whizbang.Core/Workers/PerspectiveCursorCache.cs
  - src/Whizbang.Data.Postgres/Migrations/455_StaleCopiesAboveTheNewestAreRewalked.sql
  - src/Whizbang.Core/Perspectives/StreamReadAnchor.cs
  - src/Whizbang.Core/Perspectives/ReplayFloor.cs
  - src/Whizbang.Core/Perspectives/FoldedVersionPrefix.cs
  - src/Whizbang.Data.Postgres/Migrations/466_FlaggedCursorsBelowTheirStreamAreQueued.sql
testReferences:
  - tests/Whizbang.Core.Unit.Perspectives.Tests/Perspectives/ReplayEventOrderTests.cs
  - tests/Whizbang.Core.Unit.Perspectives.Tests/Perspectives/PerspectiveRewindOptionsTests.cs
  - tests/Whizbang.Core.Unit.Perspectives.Tests/Perspectives/PerspectiveSnapshotAndRewindTests.cs
  - tests/Whizbang.Core.Component.Tests/Perspectives/PerspectiveRewindCompletionGapTests.cs
  - tests/Whizbang.Core.Tests/Observability/PerspectiveRewindMetricsTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PerspectiveWorkerRewindTests.cs
  - tests/Whizbang.Core.Tests/Observability/PerspectiveMetricsTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PerspectiveWorkerDeepPathDrainTests.StragglerDropped.cs
  - tests/Whizbang.Core.Tests/Events/System/StreamRewindEventTests.cs
  - tests/Whizbang.Core.Unit.Perspectives.Tests/Perspectives/OverwriteOnlyRewindTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PerspectiveWorkerDeepPathChannelTests.RewindFailure.cs
  - tests/Whizbang.Core.Unit.Perspectives.Tests/Perspectives/LastInReplayOrderTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveRunnerOverwriteOnlyTests.cs
  - tests/Whizbang.Core.Unit.Perspectives.Tests/Perspectives/CollectiveReplayRunnerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/CollectiveReplayRebuildIntegrationTests.cs
  - tests/Whizbang.Core.Unit.Perspectives.Tests/Perspectives/RewindDeletedArchiveTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/ArchiveReadThroughIntegrationTests.cs
  - tests/Whizbang.Core.Unit.Workers.Tests/Workers/StartupRewindSetTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PerspectiveWorkerStartupRewindBarrierTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PerspectiveWorkerStartupAndMaintenanceTests.cs
  - tests/Whizbang.Core.Unit.Workers.Tests/Workers/RewindRepeatGuardTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PerspectiveWorkerDeepPathChannelTests.RewindRepeat.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/PerspectiveRewindLoopTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Cursors/PerspectiveCursorOneOrderSqlTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PerspectiveWorkerDeepPathDrainTests.OneOrder.cs
  - tests/Whizbang.Core.Unit.Workers.Tests/Workers/PerspectiveCursorCacheReplayedThroughTests.cs
  - tests/Whizbang.Core.Unit.Perspectives.Tests/Perspectives/PerspectiveRewindWriteCheckTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/PerspectiveRewindLoopTests.IdOrder.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EventStoreReadAfterVersionTests.cs
  - tests/Whizbang.Core.Unit.Perspectives.Tests/Perspectives/StreamReadAnchorTests.cs
  - tests/Whizbang.Core.Unit.Perspectives.Tests/Perspectives/ReplayFloorTests.cs
  - tests/Whizbang.Core.Unit.Perspectives.Tests/Perspectives/FoldedVersionPrefixTests.cs
---

# Perspective Rewind

Rewind is the mechanism that keeps a perspective correct in the face of **out-of-order events**. Perspective events are ordered by their UUID7 `event_id` (UUID7 encodes a timestamp in its most-significant bits). When a **newly-stored** event has an `event_id` that is *older* than the position the perspective's cursor has already advanced past, the perspective would otherwise miss that event forever. Rewind detects this, replays the stream's events — restoring from a [snapshot](snapshots.md) when one is available — and re-applies them in correct chronological order so the read model converges on the right state.

Rewind builds on two neighbouring subsystems:

- [Snapshots](snapshots.md) — the periodic model-state captures a rewind restores from, so replay does not always start at event zero.
- [Stream Locking](stream-locking.md) — the per-stream lock a rewind holds so live event application cannot interleave with the replay.

## How Rewind Works

A rewind has two halves: **detection** (a SQL flag set when the late event lands) and **execution** (the C# worker + generated runner that replay the stream).

### Detection

Detection lives in the `store_perspective_events` SQL function, which inserts newly-arriving perspective-event work items. For each event that was *newly* stored (not a duplicate), it compares the event against the perspective cursor's last applied event **by stream version** (migration 578, [#2551](https://github.com/whizbang-lib/whizbang/issues/2551)), and keeps the earliest trigger by version. The snippet below is the original id comparison, kept for the shape of the flag; an id never decides lateness now: the received-event path below judges by origin order, and the cursor completion by version ([one order for a stream](#one-order-for-a-stream)):

```sql{title="Out-of-order detection" description="store_perspective_events flags RewindRequired when a newly-stored event is older than the cursor, keeping the earliest late event" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Rewind", "Detection"]}
-- Out-of-order detection: if event_id is older than the cursor's last_event_id,
-- the perspective missed this event and needs a rewind from snapshot.
IF EXISTS (
  SELECT 1 FROM wh_perspective_cursors pc
  WHERE pc.stream_id = v_event.v_stream_id
    AND pc.perspective_name = v_event.v_perspective_name
    AND pc.last_event_id IS NOT NULL
    AND v_event.v_event_id < pc.last_event_id
) THEN
  UPDATE wh_perspective_cursors
  SET status = status | 32,               -- RewindRequired flag (1 << 5)
      rewind_trigger_event_id = v_event.v_event_id
  WHERE stream_id = v_event.v_stream_id
    AND perspective_name = v_event.v_perspective_name
    AND (rewind_trigger_event_id IS NULL OR v_event.v_event_id < rewind_trigger_event_id);
END IF;
```

Two guarantees fall out of this:

- The **RewindRequired flag** is bit `32` (`1 << 5`) OR-ed onto the cursor `status`.
- `rewind_trigger_event_id` always holds the **earliest** late event seen — the `WHERE` clause only overwrites it with a *smaller* id — so the replay reaches back far enough to cover every late arrival.

There is a second, belt-and-suspenders detection path in `complete_perspective_cursor_work` (the function that records a runner's completion). After marking the events a runner actually processed, it looks for any still-unprocessed perspective event with an id *below* the cursor — an event that slipped in during processing and was never applied — and flags RewindRequired for it too. That same completion function **clears** `rewind_trigger_event_id`, `rewind_flagged_at`, and `rewind_first_flagged_at` on a successful run, resetting the cursor so a repaired stream does not rewind in a loop.

The **inbox emit chain** (`_emit_event_store_chain_for_inbox`, migration 100) declares the rewind for *received* events, the path every cross-service delivery and every stream-integrity backfill takes. This matters most for **reconciliation**: a backfilled event keeps its origin position, so the moment its work item is created the system already knows it slots below the cursor, while its freshly stamped local `commit_sequence` sits *above* the cursor, which makes the straggler invisible to any later runtime inversion comparison. Reconcile therefore **self-declares** the rewind at work-item creation; no heuristic detection is possible or needed.

**The straggler is found by origin order** ([#2551](https://github.com/whizbang-lib/whizbang/issues/2551), migration 574). A replay moves a received event only within its own origin's slots, so a stored event is a straggler exactly when it comes before its origin's latest event at or below the cursor's version, by origin position. An id decides nothing: an event whose id sorts above the cursor's but whose origin position is below it is a straggler, and an event of another origin with a lower id is not. The earliest straggler, and the earlier of it and an existing trigger, are chosen by stream version. See [receive order](../event-store/version-ordering#receive-order).
{verified: ReconcileRewindDeclarationSqlTests.InboxEmitChain_LateEventBelowCursor_DeclaresRewindOnTheCursorAsync, ReconcileRewindDeclarationSqlTests.InboxEmitChain_EventAboveCursor_DoesNotDeclareRewindAsync, ReconcileRewindDeclarationSqlTests.InboxEmitChain_AnotherOriginsEvent_WithALowerId_DoesNotDeclareRewindAsync}

### A rewind never reaches below the reap floor {#reap-floor}

A rewind replays stored events, so it can only start where they can still be read. An
[ephemeral](../events/ephemeral-events#reap-gates) stream keeps its pointer rows after the reap has deleted its bodies,
and a path that decides from those rows alone (the [origin-position fill](../../resilience/stream-integrity#filling-missing-origin-positions)
is one) can name a trigger whose body is gone. `_wh_rewind_perspectives_from` therefore starts each rewind at the
**reap floor** (#2591, migration 600): the first event at or after the trigger that still has a body and that the
perspective reads. When there is none, the rewind is skipped: the cursor is not flagged, its snapshots stay, and
nothing is queued. When the floor is above the trigger, the replay starts from the snapshot below the floor. That is the
best state available, not a full refold of the reaped history: the reaped events stay folded in the order they were
first applied, because their bodies are gone. See [the reap floor](../../resilience/stream-integrity#a-rewind-never-reaches-below-the-reap-floor)
for the cases and the counter, and [unreadable stored events](../../operations/workers/perspective-worker#unreadable-stored-events)
for what the worker does with a row queued without its body by any other path.
{verified: OriginPositionFillSqlTests.Fill_ThatReordersAStreamWhoseBodiesWereAllReaped_QueuesNoReplay_AndLeavesTheCursorAndItsSnapshotAsync, OriginPositionFillSqlTests.Fill_ThatReordersAStreamWhoseEarliestBodiesWereReaped_RewindsFromTheFirstEventWithABodyAsync, OriginPositionFillSqlTests.Rewind_FromAReapedTrigger_WithNothingReadableAfterIt_FlagsDeletesAndQueuesNothingAsync}

### A rewind starts only from an event the perspective reads {#read-floor}

The reap floor counts only events of a type the perspective's association rows name (#2601, migration 660). A trigger the
perspective does not read moves up to the first event at or after it that it does read, and a perspective with no
association rows reads nothing, so no rewind is raised for it. A rewind flagged from an unread event used to be queued
for a perspective no drain pair ever formed for, so it never ran. See
[the read floor](../../resilience/stream-integrity#a-rewind-starts-only-from-an-event-the-perspective-reads) for the
rules, why a perspective with no association rows reads nothing, and the one-off repair of what a database already holds.

### A flagged rewind with nothing to apply {#a-flagged-rewind-with-nothing-to-apply}
{verified: PerspectiveWorkerDeepPathDrainTests.DrainMode_AFlaggedCursorWhoseRowHoldsATypeThisServiceDoesNotRegister_IsRewound_AndItsRowCompletedAsync, PerspectiveWorkerDeepPathDrainTests.DrainMode_AFlaggedCursorWhoseRowHoldsAKnownTypeItDoesNotRead_IsRewound_AndItsRowCompletedAsync, PerspectiveWorkerDeepPathDrainTests.DrainMode_AnUnflaggedCursorsRowItDoesNotRead_IsLeftAsBefore_WithNoRewindAsync, PerspectiveWorkerDeepPathDrainTests.DrainMode_AFlaggedCursorWhoseRewindThrows_FailsItsRowsForTheBoundedRetryAsync, PerspectiveWorkerDeepPathDrainTests.DrainMode_AFlaggedCursorWhoseRewindDoesNotComplete_LeavesItsRowsPendingAsync, PerspectiveWorkerDeepPathDrainTests.DrainMode_AFlaggedCursorOfAPerspectiveWithNoRunnerHere_IsNotRewoundHereAsync, ReapedBodyBatchIsolationTests.ARewindFromAnEventThePerspectiveDoesNotRead_Completes_AndTheCursorIsNoLongerFlaggedAsync}

A drain pair forms only for an event its perspective applies, so a cursor flagged RewindRequired whose queued rows hold
no such event (a type this service does not register, or one it registers that the perspective does not read) would
never be rewound by the pair path. The drain therefore looks, after reading a batch, for the (stream, perspective) rows
their perspective does not apply, reads those streams' stored cursors in one batch, and for each one flagged with a
trigger runs the rewind from the stored trigger, in its own scope and under the pair's affinity gate, as a drain pair's
rewind runs (EventId 93, Information):

| The rewind | Its rows |
| --- | --- |
| Completes | Completed, and the cursor's completion reported, which clears the flag |
| Throws | Failed (EventId 58), so the bounded retry and the dead-letter bound apply |
| Does not complete (a stream lock held elsewhere) | Left for the next lease |

Only a flagged cursor takes this path, so a batch in which every row's perspective applies its event pays one lookup per
row and nothing else. An unflagged row of a type the perspective does not read is left as before: a newer instance may
read it during a rolling deploy. A perspective with no runner here is left to
[the cleanup step](#perspectives-no-longer-registered).

### Execution

The `PerspectiveWorker` picks up a stream whose cursor carries the RewindRequired flag and runs `_executeRewindPathAsync`:

1. **Acquire a stream lock** (`reason = "rewind"`) via `IPerspectiveStreamLocker`. If the lock is held by another instance, the worker logs and **defers** — the stream retries on a later cycle (it does not fail).
2. **Start a keepalive task** that renews the lock while the replay runs.
3. Call `runner.RewindAndRunAsync(streamId, perspectiveName, triggeringEventId, ct)`.
4. The generated runner looks for the **latest snapshot before the trigger** (see [Snapshot selection](#snapshot-selection)). If found, it restores that model and replays forward from the snapshot; if not, it replays from event zero (a full replay).
5. The replay is **in-memory** — events are applied without intermediate DB writes, so Lenses keep seeing the pre-replay model. It is not a single pass: a bounded **catch-up loop** re-reads the event store after each apply pass so events that land *during* the replay window are not lost (see [Catch-up loop](#catch-up-loop)).
6. A **single atomic write** of the model + cursor happens once the loop drains, and then the **keepalive stops and the lock is released** (always, in a `finally`).

```csharp{title="Rewind execution path" description="PerspectiveWorker acquires the rewind lock, runs the generated runner, and releases the lock in a finally" framework="NET10" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Rewind", "Execution"] unverified="PerspectiveWorker rewind lock-and-release execution path; its candidate class PerspectiveWorkerRewindTests has no code-tests-map entry"}
var lockAcquired = await _streamLocker.TryAcquireLockAsync(
    streamId, perspectiveName, _instanceProvider.InstanceId, "rewind", ct);
if (!lockAcquired) {
    // Another instance holds the lock — defer, retry next cycle
    return (Deferred, LockSkipped: true);
}
try {
    using var keepaliveCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
    var keepaliveTask = _startLockKeepaliveAsync(streamId, perspectiveName, keepaliveCts.Token);

    // Restore-from-snapshot-or-full-replay happens inside the runner
    var result = await runner.RewindAndRunAsync(streamId, perspectiveName, rewindTriggerEventId, ct);

    await keepaliveCts.CancelAsync();
} finally {
    await _streamLocker.ReleaseLockAsync(streamId, perspectiveName, _instanceProvider.InstanceId, ct);
}
```

### Snapshot selection {#snapshot-selection}

{verified: ReplayFloorTests, FoldedVersionPrefixTests, PerspectiveRewindLoopTests.AStreamWhoseFirstEventHasTheHighestId_WithASnapshotThere_ConvergesAfterOneRewindAsync, PerspectiveRewindLoopTests.TwoServices_AConsumerStreamWhoseFirstEventHasTheHighestId_ConvergesAfterOneRewind_AndAuditCyclesNeverRewindItAgainAsync}

Inside `RewindAndRunAsync`, the runner restores the nearest snapshot that sits before the late event **in the order the
replay folds the stream** ([replay ordering](#replay-ordering)), then replays from there:

- **What a snapshot holds.** A snapshot is taken at the event with the highest version it holds, and it holds every
  event of the stream up to that version. A live apply snapshots at the highest version it applied. A rewind snapshots
  at the highest version it read, and its intermediate snapshots are taken only where the fold so far is every event up
  to some version (a fold in origin order can hold version 5 before version 4).
- **The candidate.** The store returns the newest snapshot below the late event's version
  (`GetSnapshotFloorAsync`). Commit sequence and event id run backward against the stream for retroactively stamped
  rows and can name a snapshot later than the trigger (#1355).
- **The check.** The runner reads the stream as a full replay reads it and asks `ReplayFloor.Qualifies`: the events the
  snapshot holds must be exactly the first ones in replay order, and the late event must come after them. A
  single-origin stream replays in origin order, which can put an event above the snapshot's version before one it
  holds; such a snapshot holds a fold the replay never produces.
- If the candidate does not qualify, or none exists, or its serialization version is stale, the runner performs a
  **full replay**. It never falls back to a floor chosen in another order: that answer arrives exactly when the floor
  cannot be placed, and a wrong restore point leaves a read model with nothing pending to repair.
- **One exception: a refused tip falls back to the floor.** A perspective that applies ephemeral and durable events
  keeps a [tip snapshot](../events/ephemeral-events#the-tip-snapshot) beside its floor. When the candidate is that tip
  and it cannot be read, or `ReplayFloor.Qualifies` refuses it, the runner restores from the floor below it
  (`GetFloorSnapshotAsync`), judged by the same `ReplayFloor` rule; a floor that does not qualify either means a full
  replay, as before. The tip was only ever a shortcut past the floor, so falling back to the floor never drops the late
  event. A rewind also removes a tip at or above its late event (`DeleteTipSnapshotFromAsync`), as the
  trigger on the cursor table does when the rewind is flagged.
  {verified: TipSnapshotRunnerTests.ATipTheRewindCannotRead_FallsBackToTheFloor_InsteadOfDroppingTheLateEventAsync, TipSnapshotRunnerTests.ATipThatIsNoFloorInReplayOrder_FallsBackToTheFloorAsync, TipSnapshotRunnerTests.ALateEventBelowTheTip_RewindsFromTheFloor_AndTheTipThatMissedItGoesAsync, TipSnapshotSqlTests.ACursorFlaggedForALateEvent_DropsTheTipAtOrAboveIt_AndKeepsTheFloorAsync}
- When that replay needs archived history and the stream's archive was deleted, it refuses instead of replaying (see [A deleted archive](#deleted-archive)).

**Why the floor follows the replay's order (#2379).** A producer emitted three Started events and then a Completed
one within two seconds. The broker dead-lettered the Started events and recovery delivered them up to 85 minutes later,
so the consumer stored Completed at version 1 and the Started events at versions 2 to 4. A replay had folded version 2
then version 1 in origin order and snapshotted the result at version 1. Placed by version alone, that snapshot was a
floor for a trigger at version 2: the rewind restored it and folded the Started events after Completed. Judged by the
replay's order it is not (version 2 comes before version 1 there), the rewind replays in full, and the row ends as the
producer's order gives it: three Started, then Completed. The cost is one extra read of the stream for each rewind
that has a candidate snapshot.

The runner logs the decision it actually made at **Warning** (`Restoring … from snapshot at …` versus `… performing full replay …`). This is the authoritative record of the snapshot-vs-full outcome — the worker-emitted `replay_source`/`has_snapshot` observability signals report something subtly different (see [Snapshot-usage caveat](#snapshot-usage-caveat)).

Snapshots are created automatically during normal processing every `SnapshotEveryNEvents` events (default 100) and — during a rewind replay — at additional historical points every `RewindSnapshotIntervalEvents` events (default 10), so future rewinds for "very late" events still find something to roll back to. See [Perspective Snapshots](snapshots.md) for the store interface, `PerspectiveSnapshotOptions`, and tuning.

### A snapshot an archive covers {#archived-snapshot}

{verified: PerspectiveRewindWriteCheckTests.ARewindFromASnapshotTheArchiveCovers_ReadsThroughTheArchive_AboveTheSnapshotsVersionAsync, PerspectiveRewindWriteCheckTests.ARewindFromASnapshotNoArchiveCovers_ReadsOnlyTheHotEventsAfterItAsync, PerspectiveRewindWriteCheckTests.AMarkedSnapshotWithNoVersion_IsNotUsed_TheRewindReplaysFromTheStartAsync}

When part of the stream has been [archived](../events/archive-store#read-through), the snapshot the runner restores may
sit below the archive's cut: its row records how far the archive reaches (`archived_through_version`). The replay's
first pass then reads the archived events above the snapshot's version before the hot events after it
(`IEventStore.ReadPolymorphicThroughArchiveAsync`), so nothing between the snapshot and the cut is skipped. A snapshot no
archive covers reads only hot events, and a covered snapshot that records no stream version is not used: the rewind
replays from the start, which reads through the archive by its gap. A rewind to a perspective's latest snapshot never
needs the archive, because a prefix archive never takes it ([the archive rules](../events/archive-store#the-archive-rules)).

### A deleted archive {#deleted-archive}

{verified: RewindDeletedArchiveTests.ARewindFromTheStreamsStart_OfAStreamWhoseArchiveWasDeleted_IsRefused_AndNamesTheLateEventDroppedAsync, RewindDeletedArchiveTests.ARewindFromASnapshotAnArchiveCovers_OfAStreamWhoseArchiveWasDeleted_IsRefusedAsync, ArchiveReadThroughIntegrationTests.Rewind_WithoutASnapshot_OfAStreamWhosePrefixArchiveWasDeleted_IsRefused_AndLeavesTheRowAsItWasAsync}

A rewind reads through the archive whenever its replay needs archived history:

- **From the stream's start.** With no usable snapshot (none before the late event, one this build cannot read, a
  covered one that records no version, or no snapshot store at all), the replay starts at the stream's first event,
  and the event store reads the archived prefix back through the gap.
- **From a snapshot an archive covers.** The replay reads the archived events after the snapshot explicitly
  ([above](#archived-snapshot)).

When the stream's archive was [deleted](../events/archive-store#deleting-an-archive), that history is gone, and a
replay would fold the hot events alone and write a partial history as the row. So before it replays, the runner asks
the stream lifecycle ledger (`IArchivedStreamExtents`) how much of the stream's archive remains. When the answer is
`PrefixDeleted` or `WholeDeleted`, the rewind **refuses**:

- The row and the cursor are left as they are. Nothing is replayed or written.
- One Warning names the perspective, the stream, the late event and the deleted extent (`Refusing rewind of ... the
  replay needs the stream's archived history and its archive was deleted (PrefixDeleted) ...`). No "performing full
  replay" or "Restoring ... from snapshot" line is logged, because no replay runs.
- The late event is reported dropped (`PerspectiveCursorCompletion.DroppedStragglers`). The worker retires its pending
  work and counts it once on [`whizbang.perspective.stragglers_dropped`](#metrics), exactly as it does for an
  [ephemeral straggler](../events/ephemeral-events#runtime-guards).

| Choice | Reason | Verified |
|---|---|---|
| A rewind whose replay needs archived history refuses when that archive was deleted, whether it replays from the stream's start (no snapshot, a stale one, no snapshot store) or from a snapshot an archive covers, for a prefix and a whole deletion alike. | Rewinds always read through the archive (only rebuilds choose whether to), so a rewind behaves like a rebuild that opts in to archived data, and that rebuild [skips such a stream](rebuild#archived-data-deleted) and leaves its row as it is. Replaying the hot events alone would write part of the stream's history as the whole. | {verified: RewindDeletedArchiveTests.ARewindFromTheStreamsStart_OfAStreamWhoseArchiveWasDeleted_IsRefused_AndNamesTheLateEventDroppedAsync, RewindDeletedArchiveTests.ARewindFromASnapshotAnArchiveCovers_OfAStreamWhoseArchiveWasDeleted_IsRefusedAsync, ArchiveReadThroughIntegrationTests.Rewind_WithoutASnapshot_OfAStreamWhosePrefixArchiveWasDeleted_IsRefused_AndLeavesTheRowAsItWasAsync} |
| The rewind does not fall back to the stream's newest live snapshot, as a default rebuild does. | That snapshot sits after the late event, so restoring it would skip the very event the rewind exists to fold. Applying the late event onto the current row without a replay would fold it out of order, the defect a rewind corrects. | {verified: RewindDeletedArchiveTests.ARewindFromTheStreamsStart_OfAStreamWhoseArchiveWasDeleted_IsRefused_AndNamesTheLateEventDroppedAsync} |
| The late event is named in `DroppedStragglers`, so its work is retired and counted on `stragglers_dropped`. | Left pending, every claim would find the same event and refuse it again without end. The drop shares one completion with the ephemeral straggler's, so the worker treats both the same. | {verified: RewindDeletedArchiveTests.ARewindFromTheStreamsStart_OfAStreamWhoseArchiveWasDeleted_IsRefused_AndNamesTheLateEventDroppedAsync, PerspectiveRunnerTemplateInvariantTests.EphemeralRewind_SkippedRewindNamesTheStragglerItDropsAsync, PerspectiveWorkerDeepPathDrainTests.DrainMode_RunThatDropsAStragglerBelowTheRow_RetiresItAndAppliesTheRestAsync} |
| A refusal logs exactly one Warning, and the lines that announce a replay are logged only once the rewind knows it replays. | One event, one line: a second line announcing a full replay that never runs would mislead the reader. | {verified: RewindDeletedArchiveTests.ARewindFromTheStreamsStart_OfAStreamWhoseArchiveWasDeleted_IsRefused_AndNamesTheLateEventDroppedAsync} |
| A rewind from a snapshot no archive covers replays as before and never asks the ledger. | Every event after that snapshot is hot, so a deleted archive held nothing it needs, and a rewind that never reads the archive pays no lookup. | {verified: RewindDeletedArchiveTests.ARewindFromASnapshotNoArchiveCovers_ReplaysTheHotEvents_EvenWhenThePrefixArchiveWasDeleted_AndAsksTheLedgerNothingAsync} |
| A stream whose archive is intact (`Prefix`, `Whole`) or that was never archived (`None`) replays from its start as before. | The archive still holds the history, and the read-through returns it. | {verified: RewindDeletedArchiveTests.ARewindFromTheStreamsStart_OfAStreamWhoseArchiveWasNotDeleted_ReplaysFromItsStartAsync} |
| A host with no ledger registered (no archive) replays as before. | With no archive there is nothing to delete. | {verified: RewindDeletedArchiveTests.ARewindFromTheStreamsStart_InAHostWithNoArchiveLedger_ReplaysFromItsStartAsync} |

To bring the row up to date after a refusal, restore the stream's history if a copy exists, or accept the row as it
stands: the late event's effect on earlier state is lost with the deleted archive. A prefix archive deleted before
migration 274 left no record in the ledger, so a rewind cannot detect it, as a [rebuild cannot](rebuild#archived-data-deleted).

### Catch-up loop

The in-memory replay is **not a single pass**. `RunFromModelAsync` wraps the apply loop in a bounded catch-up loop: after applying a batch it re-reads the event store from the last event it applied, and if new events arrived during the apply window it applies those too. The loop exits when a read returns zero new events (the store is quiescent with respect to what the rewind has applied), and is bounded by `MAX_REWIND_CATCH_UP_ITERATIONS` (100) as a safety valve against a pathological append rate.

```csharp{title="Rewind catch-up loop" description="The runner re-reads the event store after each apply pass so events appended during the replay window are picked up, not dropped" framework="NET10" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Perspectives", "Rewind", "Catch-up"] unverified="Generated-runner catch-up loop; PerspectiveRewindCompletionGapTests that pins it has no code-tests-map entry"}
const int MAX_REWIND_CATCH_UP_ITERATIONS = 100;
var anchorEventId = replayFromEventId;   // snapshot event id, or null = from event zero
var iterations = 0;

while (true) {
    if (++iterations > MAX_REWIND_CATCH_UP_ITERATIONS) break; // sustained appends outrun apply

    // Read only the delta appended since the last event we applied.
    var events = await ReadPolymorphicAsync(streamId, anchorEventId, eventTypes, ct);
    if (events.Count == 0) break;         // quiescent — caught up to HEAD-at-commit

    foreach (var envelope in ReplayEventOrder.Order(events))   // the replay order, never by id
        (updatedModel, _) = ApplyEvent(perspective, updatedModel, envelope.Payload);

    // Advance the anchor so the next read returns only newer events.
    anchorEventId = lastSuccessfulEventId ?? events[^1].MessageId.Value;
}

// Single atomic write of model + cursor happens AFTER the loop drains.
```

This is the fix for an earlier defect: the original implementation read the event list **once** and applied that fixed set, so events appended between `PerspectiveRewindStarted` and `PerspectiveRewindCompleted` were silently dropped (a bulk import could complete the projection short a handful of items even though every event was durable). With the catch-up loop, the completed cursor reflects **HEAD-at-commit** rather than HEAD-when-the-replay-began. The behaviour is pinned by `PerspectiveRewindCompletionGapTests` (`FixedRewind_EventsAppendedDuringWindow_AreAppliedTooAsync` and `FixedRewind_NoLateAppends_StillTerminatesAsync`).

### Replay ordering: slotting reconciled events {#replay-ordering}

Each apply pass orders its batch in two steps (`ReplayEventOrder`).

**First, the local order**, one comparator per batch, chosen by what the batch can prove:

1. **Stream order**, when every event carries the version its stream appended it at (`LocalStreamVersion`, set by the replay read). This is the order the stream was written in and the order the live apply folded it in. A local `commit_sequence` only records when the stamper reached a row: rows stamped after the fact can carry sequences that run backward against their versions, and a replay in that order applied a stream's last write first and left the row holding an older value.
2. **Local commit order**, otherwise, when every event carries its local `commit_sequence` stamp (a store whose read does not carry the version). An id-ordered replay would silently undo newer writes, because same-millisecond UUIDv7 ids can disagree with the order events were stored in.
3. **Event-id order**, the fallback when any event is unstamped (stamper lag); a partial mix of comparators would interleave two orderings.

**Then, origin order within each origin's places (#2257).** An event received from another service carries its origin (`SourceServiceId`, non-empty) and its position there (`SourceCommitSequence`, positive). A receiver stores events in arrival order, which delivery across topics and partitions, and integrity redelivery, do not keep in the origin's order: an update the origin committed before a delete can arrive after it, and a reconciled straggler keeps its original origin slot but lands with an arrival-fresh **local** sequence. So the places each origin's events hold in the local order are kept, and that origin's events are dealt into those places in origin order (ties broken on the event id):

| Events in the batch | Replay order |
|---|---|
| One origin throughout | Pure origin order: the backfilled event lands at its intended position, so the final model equals what a never-missed history would have produced |
| One origin among local events | The origin's events take origin order in their own places; the local events keep theirs |
| Several origins | Each origin's events follow that origin's order in its own places; the interleaving of different origins stays the arrival order, the only order the receiver knows between them |
| No origins (local events only) | Pure local order |

{verified: ReplayEventOrderTests.Order_WhenCommitSequencesRunBackwardAgainstVersions_FollowsTheStreamsVersionsAsync, ReplayEventOrderTests.Order_WhenOneOriginStampsEveryEvent_FollowsOriginOrderOverVersionOrderAsync, ReplayEventOrderTests.Order_WhenAnOriginsEventsArriveOutOfOrderAmongLocalEvents_PutsThemInOriginOrderInTheirSlotsAsync, ReplayEventOrderTests.Order_WhenTwoOriginsInterleave_EachFollowsItsOwnOriginOrder_AndTheInterleavingIsArrivalAsync, ReplayEventOrderTests.Order_WhenStreamVersionsDecideTheLocalOrder_OriginEventsStillTakeOriginOrderInTheirSlotsAsync, ReplayEventOrderTests.Order_AMixedStream_GivesTheSameResultForEveryArrangementOfTheBatchAsync, ReplayEventOrderTests.Order_WhenOneOriginsSequencesTieInAMixedStream_BreaksOnTheIdAsync, PerspectiveApplyIdempotencyTests.RewindAndRun_StampsRunBackwardAgainstTheStream_FoldsInStreamOrderAsync}

**An origin's event with no origin position (#2379)** is still that origin's event. A producer that publishes before
its stamper reaches the row sends a position of 0; such an event is dealt into its origin's places too, merged among the
positioned ones on its id, which the origin minted in the order it produced its events: it goes before the first
positioned event whose id sorts after its own. Before, it kept its arrival place, so an older event delivered late (from
a dead letter, say) replayed after the newer one it preceded.
{verified: ReplayEventOrderTests.Order_WhenAnEventHasNoOriginSequence_TakesItsPlaceInTheOriginByIdAsync, ReplayEventOrderTests.Order_OneOriginsEventsWithNoOriginPosition_TakeTheirPlacesByIdAsync, ReplayEventOrderTests.Order_UnpositionedEventsOfAnOrigin_MergeByIdAmongItsPositionedOnesAsync, LastInReplayOrderTests}

Cross-origin events on one stream have **no defined total order** (concurrent writers, per-origin sequence spaces: the numbers collide by design), so origin sequences are only ever compared *within* one origin, and the places between origins are never reordered. Before #2257 a mixed stream fell back to local order entirely, so a single origin's reordered events in a stream that also held local events replayed in arrival order. The purge marker stays the backstop for what replay cannot reorder: see [purge stays purged](perspectives-with-actions#purge-stays-purged).

### A re-sequence rewinds from the start {#a-re-sequence-rewinds-from-the-start}

The [received-stream re-sequence](../../operations/infrastructure/resequencing-received-streams.md) stores a stream that
was stored out of its origin's order in the order a replay folds it. Afterwards every snapshot of the stream holds a fold
in the old order, so it removes them all, and flags every cursor on the stream (the collective sink's excepted) with the
stream's first event as the trigger, its replay frontier cleared and that trigger queued. The snapshot floor sits below
the trigger, and nothing sits below the first event, so the rewind replays the whole stream. A completion of work
claimed before the re-sequence cannot settle the flag: the queued trigger is below its cursor and is flagged again as a
straggler.
{verified: ReceivedStreamResequenceSqlTests.Resequence_RewindsEveryPerspectiveOfTheStreamFromItsStart_AndLeavesTheCollectiveSinkAloneAsync, ReceivedStreamResequenceSqlTests.Apply_ACompletionThatRacesTheFlag_LeavesTheRewindAskedForAsync}

### Below the row's position: the runner rewinds too {#below-position}

{verified: PerspectiveApplyIdempotencyTests.RunWithEvents_EventBelowTheRowsPositionNeverFolded_IsRewoundIntoTheRowAsync, PerspectiveApplyIdempotencyTests.RunWithEvents_TheRowsOwnLastEventRedelivered_IsDroppedWithoutARewindAsync, PerspectiveApplyIdempotencyTests.RunWithEvents_AnOlderFoldedEventRedelivered_RewindsAndLeavesTheRowAsItWasAsync, NeverAppliedEventsAreNotDroppedTests.NoCursorRow_RowAheadOfTheBatch_AnEventTheFilterDiscardsWasAnsweredByDetectionAsync}

The worker detects a late event against the stream's **cursor**. The generated runner's [idempotency filter](apply-exactly-once#idempotency-filter) compares against the **row's own recorded position**. A stream with no cursor row, or with a cursor behind the row, gives the worker nothing to compare, and the filter used to drop every event below the row's position as already applied, including events the row had never folded.

So the runner checks first. When a batch holds an event **strictly below** the row's recorded commit sequence, it rewinds from the earliest such event instead of filtering the batch, and logs `[diag.filter.rewind-below-position]`. Together with the worker's check, detection anchors on the **later of the cursor and the row's position**.

- **The row's own event, redelivered at its position,** is still dropped. That is the common, benign redelivery.
- **An older event the row did fold** cannot be told apart from one it never folded, so it is rewound too. The re-fold leaves the row exactly as it was. The cost of the conservative answer is a re-fold, never a changed row.
- **An unstamped event** is not compared by sequence; the filter defers on it and applies it, as before.

### A rewind covers what it replayed {#a-rewind-covers-what-it-replayed}

{verified: PerspectiveWorkerDeepPathDrainTests.DrainMode_EventsTheRewindAlreadyReplayed_DoNotRewindAgainAsync, PerspectiveCursorCacheReplayedThroughTests}

The rows that triggered a rewind stay pending until the completion flush deletes them, and the same events can be delivered again under new work rows. The cooldown cache recognizes a row only by its work id, so a redelivered row used to read as fresh, sit behind the cursor, and trigger another full replay on every lap of the drain loop.

The worker now remembers which events a completed rewind was run for, per stream and perspective. When any of them comes back, it is taken out of the batch before the inversion check: its rows are completed and its lifecycle signaled with nothing applied, and the worker logs that the events were already replayed. Only those events are covered. An event the rewind was not run for keeps its own inversion check, even when it sorts below where the rewind left the stream. The memory is bounded per stream and perspective, and forgotten with the stream's other cached state.

### A repeated rewind is settled {#a-repeated-rewind-is-settled}

{verified: PerspectiveWorkerDeepPathChannelTests.Rewind_AskedAgainOnAnUnchangedStream_IsSettledWithoutReplaying_CountedAndWarnedOnceAsync, PerspectiveWorkerDeepPathChannelTests.Rewind_AskedAgainAfterAnEventWasStored_ReplaysAgainAsync, PerspectiveWorkerDeepPathChannelTests.Rewind_OnAStreamWhoseVersionIsUnknown_AlwaysReplaysAsync, PerspectiveWorkerDeepPathChannelTests.Rewind_ThatDidNotComplete_IsNotRememberedAsAnOutcomeAsync, RewindRepeatGuardTests}

A rewind replays the stream's events. Asked again for the same trigger on a stream with nothing stored since the last
completed rewind, it reads the same events in the same order and can only reach the same state. A stream something
keeps flagging (for example one holding older copies stored after its newest, which replay in the same order every
time) would otherwise rewind forever: a full replay and a rewind-started and rewind-completed pair each time.

The worker remembers, per stream and perspective, the trigger and the stream's last version of its last completed
rewind. A request that matches both is settled with that rewind's completion without replaying: its rows complete and
the cursor's flag clears as they would after the rewind, `whizbang.perspective.rewind_repeats` counts it, and once the
repeats reach `PerspectiveRewindOptions.RepeatWarningThreshold` (10 by default) one warning names the perspective, the
stream and the trigger.

- **Same input, not same output.** Comparing the result would mean running the replay to find out it was pointless.
  The input (trigger and last version) is known before it runs, and a deterministic replay of the same input cannot
  differ.
- **Only when the version is known.** A stream whose last version the store cannot give is always replayed, and so is
  any rewind that did not complete: nothing proves those inputs unchanged.
- **Bounded memory.** At most 10,000 streams are remembered per worker; past that the memory is cleared, which costs at
  most one more rewind per stream.

### One order for a stream {#one-order-for-a-stream}

{verified: PerspectiveRewindLoopTests.AStuckCursorOnTheHighestIdAtTheLowestVersion_ConvergesAfterOneRewind_AndARequeuedCopyIsNotRewoundAsync, PerspectiveRewindLoopTests.AStuckCursorRepairedOnDeploy_IsResolvedByExactlyOneRewind_AndNeverASecondAsync, PerspectiveRewindWriteCheckTests.ARewind_ReportsTheReplayedEventLastByVersion_NotTheHighestIdAsync, PerspectiveCursorOneOrderSqlTests, PerspectiveWorkerDeepPathDrainTests.DrainMode_ACursorFlaggedForARewind_IsRewound_NotAppliedLiveAsync, PerspectiveWorkerDeepPathDrainTests.DrainMode_AnEventTheStoredReplayFrontierCovers_IsCompletedWithoutARewindAsync, PerspectiveWorkerDeepPathDrainTests.DrainMode_AfterAReplayFromTheStart_AnEventBelowItsFrontier_IsNotRewoundAgainAsync, PerspectiveCursorCacheReplayedThroughTests}

A stream's events have one order: their **version**, the position the local store appended each at, which is the
order a replay folds in. A replay's **commit-sequence frontier** (the highest commit sequence it read) says how far it
read. Every decision about a cursor uses these two, and nothing else.

**Why it matters.** A stream can hold events whose ids disagree with their versions: older copies of an event, stored
after a newer one (a redelivery that landed above the newest). The newest event then has the highest id and the
lowest version. When different steps used different orders, such a stream rewound forever (#2366):

1. A rewind reported the largest id it applied together with the largest commit sequence it applied: a position no
   event has.
2. `complete_perspective_cursor_work` set the cursor to that id unconditionally, moving it back to the highest-id
   event at the lowest version, and flagged a pending row as a straggler because its id sorted lower.
3. The drain path judged a copy queued again against the mixed position, found an inversion, and rewound. The
   rewind reported the same mixed position, and the cycle repeated.

**The rule, at each step:**

| Step | What it does now |
| --- | --- |
| A rewind's report | The replayed event last by version, with the replay's commit-sequence frontier. The row's checkpoint stays at the id frontier, which the runner's idempotency filter compares against. |
| The cursor completion (both paths) | Never moves the cursor back by version, and creates a missing cursor at the reported event when the store holds it. The immediate path (`complete_perspective_cursor_work`) and the batched path (`update_perspective_cursors`) agree; before, the immediate path only updated, so a stream completed only there never had a cursor. |
| A straggler | A pending row below the cursor **by version**, never by id. A row a completed replay read is never a straggler. |
| The rewind flag | Cleared only once the cursor is at or past its trigger by version, or a completed replay read the trigger. |
| The drain path | Honors the flag: a flagged cursor is resolved by a rewind, never by applying its pending events live and clearing the flag. |

**Why the immediate path creates a missing cursor.** The instant completion strategy reports every completion through
`complete_perspective_cursor_work` and never through the batched `update_perspective_cursors`. When only the batched
path created cursors, a stream completed instantly never got one: every apply read from the stream's start, and no
inversion or late arrival could be judged against a position. Both paths now create the same cursor, at the reported
event, and only when the store holds that event.
{verified: PerspectiveCursorOneOrderSqlTests.CompleteCursor_AStreamWithNoCursor_GetsTheSameCursorOnTheImmediateAndTheBatchedPathAsync, PerspectiveCursorOneOrderSqlTests.CompleteCursorWork_AStreamWithNoCursor_GetsOneAtTheReportedEventAsync, PerspectiveCursorOneOrderSqlTests.CompleteCursorWork_AnEventTheStoreDoesNotHold_CreatesNoCursorAsync}

**What a replay read stays read.** A rewind from the stream's start reads every event stamped at or below its frontier
(a commit sequence is assigned only after the event commits, so none can be missing). The cursor stores that frontier
(`wh_perspective_cursors.replayed_through_commit_sequence`, never lowered), and the worker holds it in its cursor cache.
A work row for an event at or below it, whether the rewind's own row not yet flushed or the same event queued again
under a new row, is completed without a rewind. Because the frontier is stored, this holds after a restart and after a
rewind on the claimed path too, not only in the memory of the instance that ran the rewind
([a rewind covers what it replayed](#a-rewind-covers-what-it-replayed) is the per-instance half). A rewind from a
snapshot reads only the events after the snapshot's version, which says nothing about a stamp below its frontier, so
it records none. On a flagged cursor, such covered rows are the one exception: they complete, and only the rest wait for
the rewind.

**Cursors already stuck.** Migration 455 repairs every cursor left in the stuck shape on deploy: flagged for a
trigger stored after the cursor's event (a higher version) whose id sorts below it. The repair only places the
cursor: it moves to the last event of its stream by version that sits before the first event still pending for it,
never back and never past pending work. It **keeps the flag**. A genuine late arrival the receive chain flagged has the
same id and version shape, and an older build may have retired its work row by a live apply that changed nothing, so a
flag the repair cleared could be a rewind still owed. The fixed code resolves each kept flag with exactly one rewind,
and nothing rewinds the stream again. A pair left with no pending work gets its trigger queued, so that rewind runs at
once instead of waiting for the stream's next event (and holding a blocking [startup scan](#startup-scan) meanwhile);
a trigger whose processed row is not purged yet (debug mode keeps it) has that row made pending again. The queueing is
bounded: one row per stuck pair with no pending work, none for any other cursor. `wh_settle_id_ordered_rewind_flags()`
runs once in the migration and is idempotent: a re-run finds every placed cursor out of the shape and queues nothing.

{verified: PerspectiveCursorOneOrderSqlTests.Repair_QueuesOneRowPerStuckPairWithNoPendingWork_NothingElse_AndARerunQueuesNothingAsync, PerspectiveCursorOneOrderSqlTests.Repair_ATriggerWhoseProcessedRowIsNotYetPurged_IsQueuedAgainOnThatRowAsync, PerspectiveCursorOneOrderSqlTests.Repair_AGenuineLateArrivalWhoseRowIsRetired_KeepsItsFlag_AndQueuesItsRewindAsync}

**Reading after the snapshot, by version.** {verified: PerspectiveRewindLoopTests.AStreamWhoseFirstEventHasTheHighestId_WithASnapshotThere_ConvergesAfterOneRewindAsync, PerspectiveRewindLoopTests.TwoServices_AConsumerStreamWhoseFirstEventHasTheHighestId_ConvergesAfterOneRewind_AndAuditCyclesNeverRewindItAgainAsync, EventStoreReadAfterVersionTests, StreamReadAnchorTests} The one order
holds for the reads a rewind makes too. A rewind restores the snapshot placed before its trigger (by version) and reads
the events after it, and the event store reads those after the snapshot event's **version**
([reading after an event](../events/event-store#read-after)). Each catch-up pass resumes after the event it read last
in stream order (`StreamReadAnchor`), not the highest id it read. Before #2379 both reads went by id. A stream whose
first event carried its highest id (version 1 stored first, the later versions minted earlier) then rewound forever
once a snapshot existed at version 1: the read after the snapshot's id returned nothing, nothing was applied, the cursor
stayed on version 2, the pending work stayed pending, and the next pass refused the live write and rewound again, about
900 times a minute. Now one rewind replays versions 2 onward and settles the stream.

Converging is not enough: the row must be the fold in the producer's order. The floor therefore follows the
replay's order too ([snapshot selection](#snapshot-selection)), and an origin's events without an origin position take
their places by id ([replay ordering](#replay-ordering)). The regression tests assert the row equals the fold in
producer order (three Started, then Completed) after exactly one rewind, and that it differs from the fold in stored
order.
{verified: PerspectiveRewindLoopTests.AStreamWhoseFirstEventHasTheHighestId_WithASnapshotThere_ConvergesAfterOneRewindAsync, PerspectiveRewindLoopTests.TwoServices_AConsumerStreamWhoseFirstEventHasTheHighestId_ConvergesAfterOneRewind_AndAuditCyclesNeverRewindItAgainAsync}

**Streams left looping.** A looping stream that still has pending work needs nothing on upgrade: its next claim
settles it with one rewind. One whose work was retired keeps its cursor below its stream's last version, flagged, with
nothing to claim, so the flag would wait for the stream's next event and hold a blocking
[startup scan](#startup-scan) meanwhile. Migration 485 runs `wh_queue_unreachable_rewinds()` once: for every cursor
flagged RewindRequired that sits below its stream's last version with no pending work, it queues the flag's trigger,
unleased (a processed row not purged yet is made pending again), and keeps the flag. A pair with pending work, a cursor
at its stream's last version, an unflagged cursor and a flag whose trigger its stream does not hold are left alone, and
a re-run queues nothing.
{verified: PerspectiveCursorOneOrderSqlTests.QueueUnreachable_QueuesOnePerFlaggedPairBelowItsStreamWithNoWork_NothingElse_AndARerunQueuesNothingAsync, PerspectiveCursorOneOrderSqlTests.QueueUnreachable_ATriggerWhoseProcessedRowIsNotYetPurged_IsQueuedAgainOnThatRowAsync, PerspectiveRewindLoopTests.AStreamWhoseFirstEventHasTheHighestId_WithItsWorkRetired_IsQueuedOnUpgrade_AndConvergesAfterOneRewindAsync}

**Reading between checkpoints, by version.** The read that hands a perspective's lifecycle receptors their batch
follows the same order: the events after the previous checkpoint's version through the new checkpoint's, in stream
order ([reading between checkpoints](../events/event-store#read-between)). Before #2381 it selected by id, so a stream
whose first event carried its highest id delivered the wrong events to `PostPerspective*` receptors. A checkpoint the
stream does not hold is compared by id.
{verified: EventStoreReadAfterVersionTests.GetEventsBetweenPolymorphicAsync_AfterTheFirstEvent_WhoseIdIsTheHighest_ReadsThroughTheUpperVersionAsync, InMemoryEventStoreReplayOrderTests.GetEventsBetweenPolymorphicAsync_BetweenTwoEvents_ReadsByTheirVersionsInStreamOrderAsync}

**What still compares ids, and why.** Three places keep event ids on purpose. The receive chain flags a stored event as
late when its id sorts below the cursor's: the question it asks is whether an event arrived after one minted later, and
the flag only asks for a rewind, which now converges by version. A model that opts into event-id ordering is guarded on
the id, by its own choice. The row's checkpoint is the id frontier the idempotency filter compares when no commit
sequence is available. None of them selects what a rewind reads or where a cursor moves.

The [repeat guard](#a-repeated-rewind-is-settled) stays as a backstop.

### Collective events in a rewind {#collective-events}

{verified: CollectiveReplayRunnerTests.ARewindWithoutASnapshot_FoldsTheCollectivesFromTheStreamsStart_WithoutMovingTheCheckpointAsync, CollectiveReplayRunnerTests.ARewindFromASnapshot_FoldsTheCollectivesCommittedAfterTheSnapshotsEventAsync, CollectiveReplayRebuildIntegrationTests.Rewind_FromASnapshot_FoldsTheCollectivesCommittedAfterItAsync, CollectiveReplayRebuildIntegrationTests.Rewind_FromASnapshot_DoesNotFoldAgainACollectiveCommittedBeforeItAsync, CollectiveReplayRunnerTests.ARewindsCatchUpPasses_FoldEachCollectiveOnce_AndNeverAnchorTheReadOnOneAsync}

A rewind folds the row's [collective events](../messaging/collective-events#collective-replay-from-a-start) as a
rebuild does, merged among the stream's events in commit order. A rewind from the stream's start folds every one; a
rewind from a snapshot folds only the ones the snapshot does not hold, as below. Each one folds only as far as the
live sink applied it: into every row once its apply completed, into the rows its committed batches reached while it is
partway or dead-lettered, and into none while it is queued and not started
([how far each collective folds](../messaging/collective-events#collective-replay-from-a-start)). A rewind that folds a
collective still in flight takes no final snapshot {verified: CollectiveReplayRebuildIntegrationTests.Rewind_WhileACollectiveIsQueuedAndNotStarted_DoesNotFoldIt_AsTheLiveRowDoesNotHoldItYetAsync, CollectiveReplayRebuildIntegrationTests.Rewind_WhileACollectiveIsMidApply_FoldsItOnlyIntoTheRowsItReachedAsync, CollectiveReplayRebuildIntegrationTests.Rewind_ThatMeetsACollectiveStillInFlight_TakesNoSnapshotAsync}. A collective moves neither the checkpoint nor the frontier below, and it never anchors the catch-up
read, which re-reads the row's own stream. Each collective folds once across the catch-up passes. The snapshot a
rewind ends with is the row at its last event, before the collectives committed after that event
([why](snapshots#a-replays-snapshot-and-collectives)).

A live snapshot of a row with collectives records a mark: every collective of the row stamped at or below it was
complete when the snapshot was taken. A rewind from such a snapshot starts from the mark, not the snapshot's event: it
folds the collectives stamped past the mark and every unstamped one, so a collective that was in flight when the
snapshot was taken folds once, whichever side of the snapshot's event it committed on. A snapshot written before
migration 275 records no mark and keeps the snapshot-event rule. See
[snapshots of a row with collectives](snapshots#collectives) (#1963).
{verified: CollectiveReplayRunnerTests.ARewindFromASnapshotThatRecordsItsCollectives_StartsFromItsMarkAsync, CollectiveReplayRebuildIntegrationTests.Rewind_FromASnapshotThatRecordsItsCollectives_FoldsACollectiveCommittedBeforeItsEvent_ThatWasInFlightAsync, CollectiveReplayRebuildIntegrationTests.Rewind_FromASnapshotThatRecordsItsCollectives_DoesNotFoldAgainACollectiveCommittedAfterItsEvent_ThatItHoldsAsync}

### Frontier checkpoint

The replay checkpoints at the **frontier** — the *maximum* event id and *maximum* local `commit_sequence` applied — not the origin-order-last event's stamp. The idempotency floor's meaning is "everything at or below this is applied", and under origin-order replay the final event applied can carry a *lower* local stamp than a backfilled straggler it slotted. A below-floor checkpoint would also be refused by the perspective store's cross-pod lost-update guard, silently discarding the very correction the rewind computed. The catch-up anchor is the event read last in stream order (#2379), and the store reads after its version, so a refetch never re-serves the window's tail and never skips past an event stored between. Pinned by `ReconcileRewindScenarioTests` (`RewindReplay_BackfilledStraggler_SlotsIntoOriginOrder_NewerWriterWinsAsync`, `Reconcile_OlderConflictingWriterBackfilled_DeclaredRewindRestoresIntendedOrderAsync`, `Reconcile_LateInitializer_DeclaredRewindMergesBothWritersInOriginOrderAsync`) and `ReconcileRewindDeclarationSqlTests`.

The row's checkpoint is the id frontier; the **cursor** the rewind reports is not. It is the replayed event last by version, with the commit-sequence frontier ([one order for a stream](#one-order-for-a-stream)).

## Overwrite-only perspectives {#overwrite-only}

:::new
`[OverwriteOnly]` marks a perspective whose every `Apply` builds the row from its event alone. A rewind of it applies only the stream's last event instead of the whole stream.
:::

Some perspectives fold nothing. Each `Apply` builds the row from the event it is handed and ignores the current model, so the row after any event is that event's: a user's whole permission set, a document's latest published version, a device's last reported state. The runner cannot know that by itself, so every rewind of such a perspective (a late event, an event [below the row's position](#below-position), a refused write, a row waking after eviction) replayed the whole stream: it loaded every event's body and applied every one of them, to produce a row only the last one decides.

That cost is linear in the stream's length, and it adds up. A service whose streams held hundreds of large events per user ran out of memory when several of those streams rewound side by side, each holding every event body to fold.

Mark the perspective with `[OverwriteOnly]` (namespace `Whizbang.Core.Attributes`) to tell the runner:

```csharp{title="An overwrite-only perspective" description="Every Apply builds the row from its event alone; the marker lets a rewind apply only the stream's last event" framework="NET10" category="Core Concepts" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Rewind", "OverwriteOnly"] tests=["OverwriteOnlyRewindTests.ARewindOfAnOverwriteOnlyPerspective_AppliesOnlyTheLastEvent_AndWritesTheRowAFullReplayWritesAsync", "PerspectiveRunnerOverwriteOnlyTests.AMarkedPerspective_IsOverwriteOnly_AndItsModelReturningAppliesDecideTheRowAloneAsync"]}
using Whizbang.Core.Attributes;
using Whizbang.Core.Perspectives;

[OverwriteOnly]
public sealed class PermissionSetPerspective : IPerspectiveFor<PermissionSetModel, PermissionsSet> {
  // Builds the row from the event alone; never reads currentData.
  public PermissionSetModel Apply(PermissionSetModel currentData, PermissionsSet @event) =>
    new() { UserId = @event.UserId, Revision = @event.Revision, Permissions = @event.Permissions };
}
```

The marker is **explicit**: the generator never infers it, even when no `Apply` of a perspective reads its model. An `Apply` of a marked perspective that does read its current-model parameter contradicts the marker and is reported as [WHIZ108](../../operations/diagnostics/whiz108).

{verified: PerspectiveRunnerOverwriteOnlyTests.AnUnmarkedPerspective_IsNotOverwriteOnly_EvenWhenNoApplyReadsItsModelAsync, OverwriteOnlyAnalyzerTests.AnOverwriteOnlyApplyThatReadsItsCurrentModel_IsWarnedAsync}

### What the rewind does {#overwrite-only-rewind}

The rewind of a marked perspective still **reads every event** of the stream, from the snapshot or from the start, exactly as a full replay reads it. It **applies one**: the last event in the order a full replay folds the stream (origin order, stream order, commit order or event-id order, chosen by the same rules as [Replay ordering](#replay-ordering)), applied to an empty model. The events before it are counted, never held in memory or applied. The row is written through the same write a full replay ends with, cursor, frontier and snapshot included, so the row it writes is the row a full replay writes. Each [catch-up pass](#catch-up-loop) over events appended while the rewind runs applies its own last event.

| A rewind of a 40-event stream | Unmarked perspective | `[OverwriteOnly]` perspective |
|---|---|---|
| Events read | 40 | 40 |
| Event bodies held to fold | 40 | 1 |
| `Apply` calls | 40 | 1 |
| Row written | the last event's | the same row |

The rewind still reports every event it read as replayed (`whizbang.perspective.rewind.events_replayed`, and the completion log's count), so the metric measures the stream, not the work saved.

{verified: OverwriteOnlyRewindTests.ARewindOfAnOverwriteOnlyPerspective_AppliesOnlyTheLastEvent_AndWritesTheRowAFullReplayWritesAsync, OverwriteOnlyRewindTests.TheLastEvent_IsTheLastInTheOrderAFullReplayFolds_NotTheLastReadAsync, OverwriteOnlyRewindTests.ARewindFromASnapshot_WritesTheRowAFullReplayFromThatSnapshotWritesAsync, OverwriteOnlyRewindTests.AnEventAppendedWhileTheRewindRuns_IsAppliedByTheCatchUpPass_AsAFullReplayAppliesItAsync, LastInReplayOrderTests.Last_IsTheEventAFullReplayFoldsLastAsync}

**Receptors of skipped events do not run.** A rewind rebuilds state; it does not re-deliver events. The events the rewind counts but does not apply run no receptor during the rewind.

{verified: OverwriteOnlyRewindTests.ARewind_RunsNoReceptorForTheEventsItSkipsAsync}

### When it replays in full {#overwrite-only-fallback}

The last event cannot always decide the row alone. The rewind then folds the stream in full and writes the row a full replay always wrote, as if the perspective were unmarked:

| The stream... | Why the last event is not enough |
|---|---|
| holds an event whose `Apply` returns an action, a tuple or an `ApplyResult<TModel>` | that `Apply` can purge or decline, which only a fold in order can honor |
| ends with an event whose `Apply` returns no model | the row is then what the events before it left |
| ends with an event whose `Apply` throws | the full fold logs and handles the failure as any replay does |
| starts purged | only the fold knows whether a later `Apply` resurrects the row |
| belongs to a model that has [collective events](../messaging/collective-events#collective-replay-from-a-start) | a collective committed after the last event changes the row the last event alone would write |

The check happens before anything is written, so a rewind that falls back never writes a partial row.

{verified: OverwriteOnlyRewindTests.AStreamHoldingAnEventThatCanPurge_IsReplayedInFull_AndEndsAsAFullReplayEndsAsync, OverwriteOnlyRewindTests.ALastEventWhoseApplyReturnsNoModel_IsReplayedInFull_AndWritesTheRowAFullReplayWritesAsync, PerspectiveRunnerOverwriteOnlyTests.AMarkedPerspectiveWhoseAppliesAllReturnActions_DecidesNothingAloneAsync}

**A model with collective events is folded in full.** The model has collectives when a collective replay applier is
registered and names a collective event for it. The rewind then folds every event and merges the collectives as any
rewind does, because the last event alone would drop the collectives committed after it. A marked perspective whose
model has no collectives keeps the last-event-only rewind, even when the service registers an applier for other
models.
{verified: CollectiveReplayRunnerTests.ARewindOfAnOverwriteOnlyPerspective_WhoseModelHasCollectives_FoldsEveryEventAndTheCollectivesAsync, CollectiveReplayRunnerTests.ARewindOfAnOverwriteOnlyPerspective_WhoseModelHasNoCollectives_StillAppliesOnlyTheLastEventAsync}

**An explicit rebuild still folds every event.** The marker shortens a rewind only. A [rebuild](rebuild.md) of an overwrite-only perspective reads and applies every event, because it must read every event anyway to route re-keyed ones.

## Perspectives no longer registered {#perspectives-no-longer-registered}
{verified: UnregisteredPerspectiveCleanupStepTests.Clean_RemovesTheCursorsRowsAndSnapshotsOfAPerspectiveNothingRuns_AndLeavesTheRestAsync, UnregisteredPerspectiveCleanupStepTests.Clean_TakesBatchesWithinTheCycleBudget_AndTheNextCycleTakesTheRestAsync, UnregisteredPerspectiveCleanupStepTests.Clean_IsSkipped_WhenTurnedOff_OrWithoutAPerspectiveRegistryAsync, UnregisteredPerspectiveCleanupStepTests.ThePostgresDriver_RegistersTheStepAsync}

A perspective removed from its service leaves its cursors, queued rows and snapshots behind, and a flagged one among
them holds a Blocking startup to its cap on every start, since nothing will ever rewind it (#2601). The Postgres
drivers register a maintenance step, `UnregisteredPerspectiveCleanupStep`, that removes them, a bounded batch at a time
(`wh_remove_unregistered_perspective_cursors`).

A perspective counts as **no longer registered** only when both hold:

- the running service's perspective registry does not list it, and
- no service's association rows name it.

Each service writes its perspectives' association rows at its startup and deletes the rest, so a name with none is one
no running service in the schema registers. This is not the rolling-deploy hedge for an unknown event type: an older
instance cannot tell an event type a newer instance reads, but a newer instance that runs a perspective has written its
association rows before it processes anything, so its cursors are never taken. The collective sink (`__collective__`) is
never touched, and a service with no perspective registry runs no perspectives and is skipped. The step runs in the
maintenance cycle, after startup, idle-gated like every step, and logs each cycle that removed anything at Warning
(`UnregisteredPerspectiveCleanupStep` EventId 1), naming the perspectives, and counts the cursors on
`whizbang.perspective.unregistered_cursors_removed`.

| Setting (`Whizbang:Workers:Perspective:UnregisteredPerspectiveCleanup:`) | Default | Meaning |
| --- | --- | --- |
| `Enabled` | `true` | Run the step; `false` keeps every leftover cursor |
| `BatchCursors` | `1000` | Cursors one batch removes, with their queued rows and snapshots |
| `MaxBatchesPerCycle` | `10` | Batches one maintenance cycle runs |

## Configuration

Rewind detection and execution are governed by `PerspectiveRewindOptions`:

```csharp{title="PerspectiveRewindOptions" description="Configuration record for rewind enablement, startup repair mode, concurrency, and the debounce knobs" framework="NET10" category="Configuration" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Rewind", "Configuration"] tests=["PerspectiveRewindOptionsTests.Defaults_AllFieldsHaveExpectedValuesAsync", "PerspectiveRewindOptionsTests.RewindStartupMode_HasExpectedValuesAsync"]}
public class PerspectiveRewindOptions {
  // Master switch for rewind detection and execution.
  // When disabled, out-of-order events are detected but not replayed. Default: true.
  public bool Enabled { get; set; } = true;

  // Scan for and repair streams needing rewind on service startup. Default: true.
  public bool StartupScanEnabled { get; set; } = true;

  // Whether lens reads wait for the startup rewinds or start at once. Default: Blocking.
  public RewindStartupMode StartupRewindMode { get; set; } = RewindStartupMode.Blocking;

  // Maximum concurrent rewind operations. Default: 3.
  public int MaxConcurrentRewinds { get; set; } = 3;

  // Debounce window before executing a rewind. Default: 5 seconds.
  public TimeSpan DebounceWindow { get; set; } = TimeSpan.FromSeconds(5);

  // Hard cap on debounce duration. Default: 30 seconds.
  public TimeSpan MaxDebounceWindow { get; set; } = TimeSpan.FromSeconds(30);
}

public enum RewindStartupMode { Blocking = 0, Background = 1 }
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `Enabled` | bool | `true` | Master switch for rewind detection and execution |
| `StartupScanEnabled` | bool | `true` | Scan for streams needing rewind on service startup |
| `StartupRewindMode` | `RewindStartupMode` | `Blocking` | `Blocking`: the consumer loops start at once and only lens reads (the read-model barrier) wait until the cursors flagged at scan time are rewound, for at most 100 polling intervals. `Background`: reads open after the scan and the rewinds run on the consumer loops. See [Startup modes](#startup-modes) |
| `MaxConcurrentRewinds` | int | `3` | Intended limit on parallel rewind operations |
| `DebounceWindow` | TimeSpan | `5s` | Intended window before a rewind executes (see [Debounce](#debounce)) |
| `MaxDebounceWindow` | TimeSpan | `30s` | Intended hard cap on the debounce window |

:::updated
At commit `0bc6065b`, `MaxConcurrentRewinds`, `DebounceWindow`, and `MaxDebounceWindow` are defined and unit-tested for their defaults, but no consuming code path reads them — only `StartupScanEnabled` and `StartupRewindMode` are honoured by `PerspectiveWorker`. Treat the debounce/concurrency knobs as present-but-not-yet-wired.
:::

The neighbouring `PerspectiveSnapshotOptions` (`Enabled=true`, `SnapshotEveryNEvents=100`, `MaxSnapshotsPerStream=5`, `RewindSnapshotIntervalEvents=10`) and `PerspectiveStreamLockOptions` (`LockTimeout=30s`, `KeepAliveInterval=10s`) govern the snapshot store a rewind restores from and the lock it holds during replay. See [Perspective Snapshots](snapshots.md) and [Perspective Stream Locking](stream-locking.md).

## Startup Scan {#startup-scan}
{verified: PerspectiveWorkerStartupAndMaintenanceTests.Startup_RewindScanClean_QueriesExactlyOnceAsync, PerspectiveWorkerStartupAndMaintenanceTests.Startup_RewindScanBlockingMode_StartsConsumersAndHoldsOnlyTheBarrierAsync, PerspectiveWorkerStartupAndMaintenanceTests.Startup_RewindScanDisabled_NeverQueriesAsync, PerspectiveWorkerStartupRewindBarrierTests.CleanScan_OpensTheBarrierAtOnce_WithNoRereadAsync}

On startup the worker runs `_scanAndRepairRewindsOnStartupAsync`, which queries `wh_perspective_cursors` for rows carrying the RewindRequired flag (`(status & 32) = 32`). This catches rewinds that were flagged but never executed, for example if the service crashed before processing them. The scan reads the cursor table **once**. When nothing is flagged it logs EventId 57 and the read-model barrier (`StartupScanComplete`) opens at once. If the scan itself throws, the worker logs a warning (EventId 56), the barrier opens, and the flagged rewinds are still processed by the consumer loops.

### Startup modes {#startup-modes}
{verified: PerspectiveWorkerStartupRewindBarrierTests.Blocking_BarrierHeldUntilEveryScanTimeCursorClears_RereadingOnlyThoseStreamsAsync, PerspectiveWorkerStartupRewindBarrierTests.Blocking_ThisWorkersRewindOfTheScanTimeCursor_OpensTheBarrierWithoutAPollAsync, PerspectiveWorkerStartupRewindBarrierTests.Blocking_FlagRaisedAfterTheScan_DoesNotExtendTheWaitAsync, PerspectiveWorkerStartupRewindBarrierTests.Blocking_ConsumerLoopsRunWhileTheBarrierIsHeldAsync, PerspectiveWorkerStartupRewindBarrierTests.Blocking_AtTheCap_OpensTheBarrierAndWarnsNamingWhatIsStillRewindingAsync, PerspectiveWorkerStartupRewindBarrierTests.Blocking_RereadThrows_LogsAndOpensTheBarrierAsync, PerspectiveWorkerStartupRewindBarrierTests.Blocking_RereadOnDisposedServices_SettlesTheBarrierCanceledAsync, PerspectiveWorkerStartupRewindBarrierTests.Blocking_StopWhileWaiting_SettlesTheBarrierCanceledAndStopsCleanlyAsync, PerspectiveWorkerStartupRewindBarrierTests.BackgroundMode_OpensTheBarrierAfterTheScan_WithNoRereadAsync}

`PerspectiveRewindOptions.StartupRewindMode` decides whether lens reads wait for the cursors the scan found flagged. In both modes the consumer loops start right after the scan, and the consumer loops are what perform the rewinds.

- **Blocking mode** (default): the scan records the cursors flagged **at that moment** (a fixed set of (stream, perspective) keys) and logs EventId 54. The consumer loops start right away; only the read-model barrier (`StartupScanComplete`) waits, and only for that scan-time set. A cursor leaves the set in one of two ways:
  - **this worker finishes its rewind**, leaving the cursor completed and no longer flagged: a signal, so the barrier opens without waiting for a poll when that was the last one;
  - **a by-key re-read finds it cleared**: once per polling interval (`PollingIntervalMilliseconds`), the worker re-reads only the streams still pending (`GetPerspectiveCursorsBatchAsync`), and a cursor no longer flagged, or gone because its stream was purged, leaves the set. This is what catches a rewind another instance performed.

  When the set is empty the barrier opens and EventId 55 reports how many of the flagged cursors cleared and how long that took. A cursor flagged **after** the scan never joins the set, so later flags cannot extend the wait; they are rewound by the consumer loops like any other. The wait is bounded: after **100 re-reads** without the set emptying, reads open anyway with a Warning (EventId 62) naming up to 20 of the stream/perspective pairs still rewinding and counting the rest. A pair whose queued row the drain fetched during the wait is named with how often that row was leased and how often it failed (`stream/perspective (queued row leased 62 times, 0 failures)`), so a rewind nothing runs is told from a slow one (#2601). A re-read that fails is logged (EventId 56) and opens reads, as a failed scan does. A worker stopped while waiting settles the barrier as canceled rather than opening it on unrepaired cursors.
- **Background mode**: the worker logs the summary and the barrier opens after the scan; the consumer loops pick the rewinds up with no re-read. Reads start sooner, but a projection may be briefly stale until its rewind runs. Unchanged by #2214.

**Why start the consumers and hold only the barrier.** The rewinds run on the existing path: a flagged cursor is rewound by the consumer loops, the same code that rewinds a cursor flagged at runtime, so startup has no second rewind mechanism to keep correct. Reads stay protected, because the read-model barrier is the seam lens resolution already waits on, and it does not open until every cursor that was flagged when the service started has been repaired or the cap is reached. And there is no dead wait: before [#2214](https://github.com/whizbang-lib/whizbang/issues/2214) the scan re-polled for flagged cursors **before** the consumer loops had started, so nothing could rewind them, and any flagged cursor held every lens read for the full bound of about 100 polling intervals on every start, with nothing rewound. Fixing the set at scan time is what keeps the wait finite on a busy service: new late events keep flagging cursors, and a wait for "no flagged cursors anywhere" could last as long as the traffic does. The cap of 100 is the bound the scan's re-poll loop always had.

{verified: StartupRewindSetTests.Construction_CountsDistinctKeysAndStreams_AndIsNotClearedAsync, StartupRewindSetTests.Construction_WithNothingFlagged_IsClearedAtOnceAsync, StartupRewindSetTests.MarkRewound_Completed_RemovesTheKey_AndTheLastOneClearsTheSetAsync, StartupRewindSetTests.MarkRewound_ForAKeyTheScanDidNotFlag_IsIgnoredAsync, StartupRewindSetTests.MarkRewound_ThatDidNotComplete_LeavesTheKeyAsync, StartupRewindSetTests.RemainingStreamIds_NamesEachRemainingStreamOnceAsync, StartupRewindSetTests.ClearUnflagged_RemovesKeysNoLongerFlaggedOrGone_KeepsFlagged_AndIgnoresNewFlagsAsync, StartupRewindSetTests.DescribeRemaining_ListsStreamAndPerspective_UpToTheLimitAsync, StartupRewindSetTests.DescribeRemaining_NamesHowOftenTheQueuedRowWasLeased_ForAKeyThatRecordedLeasesAsync}

## Observability

### Log entries

Rewind logs are split across **two logger categories** so their levels can be tuned independently.

**`Whizbang.Core.Workers.PerspectiveWorker`** — runtime rewind operations:

| Level | EventId | When |
|-------|---------|------|
| Warning | 52 | `Perspective rewind required for {PerspectiveName} stream {StreamId} — cursor at {CursorEventId}, late event {TriggerEventId} ({EventsBehind} events behind)` |
| Warning | 53 | `Perspective rewind completed for {PerspectiveName} stream {StreamId} — replayed {EventsReplayed} events in {DurationMs}ms (from {ReplaySource})` |
| Warning | 58 | `Perspective rewind failed for {PerspectiveName} stream {StreamId}, trigger event {TriggerEventId}. Its rows are failed and retried with backoff, and dead-lettered once their failures pass MaxPerspectiveEventAttempts.` See [Error Handling](#error-handling). |
| Warning | 43 | `Failed to acquire stream lock for rewind on {PerspectiveName} stream {StreamId}, deferring` |
| Information | 93 | `Cursor for stream {StreamId} / perspective {PerspectiveName} is flagged for a rewind (trigger {TriggerEventId}) and its {RowCount} queued row(s) hold no event it applies: rewinding from the stored trigger`. See [A flagged rewind with nothing to apply](#a-flagged-rewind-with-nothing-to-apply) |
| Warning | 94 | A queued row leased `LeasedWithoutFailureWarningAttempts` times with no failure. See [rows leased without a failure](../../operations/workers/perspective-worker#rows-leased-without-a-failure) |

> The EventId 53 `{ReplaySource}` token resolves to `"snapshot store available"` or `"no snapshot store"` — it reflects whether a snapshot store is configured, **not** whether this rewind actually restored from a snapshot (see [Snapshot-usage caveat](#snapshot-usage-caveat)). The *actual* snapshot-vs-full decision is on the runner's own Warning lines described under [Snapshot selection](#snapshot-selection).

**`Whizbang.Core.Workers.PerspectiveStartupScan`** — startup scan (configure independently):

| Level | EventId | When |
|-------|---------|------|
| Information | 54 | `Startup rewind scan started: {StreamCount} streams require rewind across {PerspectiveCount} perspectives` |
| Information | 55 | `Startup rewind scan completed: {ClearedCount} of {PerspectiveCount} flagged cursors on {StreamCount} streams cleared in {DurationMs}ms; lens reads resume` (Blocking mode, when every scan-time cursor cleared) |
| Information | 57 | `Startup rewind scan: no streams require rewind` |
| Warning | 56 | `Error during startup rewind scan — rewinds will be processed during normal polling` |
| Warning | 62 | `Startup rewind wait reached its cap after {DurationMs}ms: {RemainingCount} of {PerspectiveCount} flagged cursors are still rewinding, and lens reads resume now. Still rewinding: {StillRewinding}` (Blocking mode, after 100 re-reads; names up to 20 `stream/perspective` pairs, then "and N more") |

```json{title="Log levels to see all rewind + startup-scan messages" description="Enable both rewind logger categories so runtime rewinds and the startup scan are visible" category="Configuration" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Rewind", "Logging"]}
"Whizbang.Core.Workers.PerspectiveWorker": "Warning",
"Whizbang.Core.Workers.PerspectiveStartupScan": "Information"
```

### OTel metrics {#metrics}

Meter: **`Whizbang.Perspectives`** (defined in `PerspectiveMetrics`).

| Instrument | Type | Tags | Description |
|-----------|------|------|-------------|
| `whizbang.perspective.rewinds` | Counter | `perspective_name`, `has_snapshot` | Rewind operations that completed (the name is kept so existing panels keep reading) |
| `whizbang.perspective.rewinds_triggered` | Counter | `perspective_name` | Rewinds started, counted before the replay runs |
| `whizbang.perspective.rewinds_failed` | Counter | `perspective_name` | Rewinds that threw, including a rewind whose write was refused under every replay ([concurrent writers](perspectives.md#concurrent-writers-rewinds)) |
| `whizbang.perspective.rewinds_in_flight` | Gauge | | Rewinds running right now |
| `whizbang.perspective.rewind.duration` | Histogram (ms) | `perspective_name` | Replay duration |
| `whizbang.perspective.rewind.events_replayed` | Histogram | `perspective_name` | Events replayed per rewind |
| `whizbang.perspective.rewind.events_behind` | Histogram | `perspective_name` | Events behind the cursor when the rewind triggered |
| `whizbang.perspective.rows_leased_without_failure` | Counter | `perspective_name` | Queued rows leased past the warning bound with no failure recorded, each once per process ([rows leased without a failure](../../operations/workers/perspective-worker#rows-leased-without-a-failure)) |
| `whizbang.perspective.unregistered_cursors_removed` | Counter | | Cursors of perspectives no service runs that the maintenance cycle removed ([perspectives no longer registered](#perspectives-no-longer-registered)) |
| `whizbang.perspective.stragglers_dropped` | Counter | `perspective_name` | Late events a rewind dropped instead of replaying: an ephemeral perspective's, because no readable snapshot floor preceded them, or any perspective's, because the replay needed an archive that was [deleted](#deleted-archive) |

The `has_snapshot` tag on the `rewinds` counter reflects snapshot-**store** availability, not actual usage (see [Snapshot-usage caveat](#snapshot-usage-caveat)). A failed rewind also increments the shared `whizbang.perspective.errors` counter.

A rewind that drops its late event (an ephemeral perspective with no snapshot floor before it, or a replay that needs a [deleted archive](#deleted-archive)) still counts in `rewinds`; `stragglers_dropped` also counts it, once, so the two together tell a replay from a drop. See [Ephemeral Events](../events/ephemeral-events.md#runtime-guards).
{verified: PerspectiveMetricsTests.PerspectiveMetrics_StragglersDropped_CountsUnderItsNameWithThePerspectiveTagAsync, PerspectiveWorkerDeepPathDrainTests.DrainMode_RewindThatCompletes_CountsNoDroppedStragglerAsync}

### OTel span tags

Activity name: **`Perspective RewindAndRunAsync`** (emitted when perspective spans are enabled).

| Tag | Description |
|-----|-------------|
| `whizbang.perspective.name` | Perspective name |
| `whizbang.stream.id` | Stream being rewound |
| `whizbang.perspective.rewind_trigger_event_id` | Late event that triggered the rewind |
| `whizbang.perspective.rewind.events_behind` | Count at trigger time |
| `whizbang.perspective.rewind.events_replayed` | Count after completion |
| `whizbang.perspective.rewind.has_snapshot` | Whether a snapshot **store** was available |
| `whizbang.perspective.rewind.replay_source` | `"snapshot"` or `"full"` — derived from store availability, not actual replay path |

On failure, the span is set to `Error` status and tagged `whizbang.perspective.rewind.error` with the exception message.

#### Snapshot-usage caveat

The worker computes `hasSnapshot = _snapshotStore is not null` and feeds that single value into the `has_snapshot` metric tag, the span's `rewind.has_snapshot` / `rewind.replay_source` tags, and the EventId 53 log's replay-source token. That is **store availability**, not the decision the runner actually made: `replay_source` will read `"snapshot"` even when the runner performed a **full replay** because no qualifying snapshot existed for that stream, or the snapshot's serialization version was stale. When an operator needs the real answer:

- The runner's own **Warning** logs are authoritative — `Restoring {PerspectiveName} stream {StreamId} from snapshot at {SnapshotEventId} …` versus `… performing full replay …`.
- The `PerspectiveRewindStarted` system event's `HasSnapshot` property carries the runner's *actual* decision (it is set true only when a snapshot was loaded and applied), unlike the worker's store-availability tags.

### System events

The generated runner publishes a pair of system events around each perspective replay:

| Event | Properties | When |
|-------|-----------|------|
| `PerspectiveRewindStarted` | `StreamId`, `PerspectiveName`, `TriggeringEventId`, `ReplayFromSnapshotEventId`, `HasSnapshot`, `StartedAt` | Before replay begins |
| `PerspectiveRewindCompleted` | `StreamId`, `PerspectiveName`, `TriggeringEventId`, `FinalEventId`, `EventsReplayed`, `StartedAt`, `CompletedAt` | After replay finishes |

Both are marked `[AuditEvent(Exclude = true)]` — they run in a background context with no ambient user security, so they are excluded from the audit pipeline. Publish failures are swallowed at `Debug` level and never abort the rewind.

:::updated
Two stream-level bracketing events — `StreamRewindStarted` and `StreamRewindCompleted` (carrying `PerspectiveNames[]` and `TotalEventsReplayed`) — are defined in `SystemEvents.cs` and have serialization + type tests, but at commit `0bc6065b` no publishing call site exists. They are reserved/not-yet-emitted rather than live observability signals.
:::

## Error Handling {#error-handling}
{verified: PerspectiveWorkerDeepPathChannelTests.Rewind_ThatThrows_FailsItsRowsForRetry_InsteadOfCompletingThemAsync, PerspectiveWorkerDeepPathChannelTests.Rewind_ThatThrows_LogsTheAttemptAtWarningWithItsExceptionAsync}

Rewind failures are **isolated per stream**: one stream's rewind throwing does not crash the perspective worker or
the other groups in its batch. A rewind that throws (any exception other than cancellation):

- Counts in `whizbang.perspective.rewinds_failed` and sets `Error` status on the rewind span, tagged
  `whizbang.perspective.rewind.error`.
- Logs the attempt at **Warning** (EventId 58) with the perspective name, stream id, trigger event id and the
  exception.
- Stops the lock keepalive and releases the rewind lock.
- **Fails the group's rows for retry.** The exception reaches the group's failure handler, which records the failure
  against every leased row, reports the cursor failure and increments `whizbang.perspective.errors`. The rows are
  re-claimed after their backoff and the rewind is tried again; each failure counts toward
  `MaxPerspectiveEventAttempts`, so a rewind that keeps failing ends in a dead letter with the one
  [dead-letter record](../../operations/observability/logging-categories#dead-lettered-messages). The drain path
  treats a rewind that throws the same way.

Before, the per-event path logged the failure at Error and returned an empty completion: the group's rows were
completed with nothing applied, no failure was recorded, and the cursor kept its RewindRequired flag, so the next
work on the stream retried the rewind, failed again and discarded its rows too, with no bound. An alert keyed on
EventId 58 at Error stops firing; alert on the dead-letter record, EventId 1901. See
[Perspective Worker: a rewind that fails](../../operations/workers/perspective-worker#rewind-failures).

## The same-instance apply lock {#apply-lock}
{verified: PerspectiveApplyCoordinatorLifetimeTests.DistinctStreams_AfterEveryApplyReleases_CoordinatorHoldsNoEntriesAsync, PerspectiveApplyCoordinatorLifetimeTests.QueuedWaiter_KeepsTheKeysLock_AndStillSerializesWithTheNextAcquireAsync, PerspectiveApplyCoordinatorLifetimeTests.CanceledWaiter_ReleasesItsReference_SoTheLockIsDroppedWithTheHolderAsync}

Within one instance, a rewind and a live apply of the same stream and perspective never run at once:
`PerspectiveApplyCoordinator` holds one lock per (stream, perspective) key while an apply runs. A key's lock exists
only while a holder or a waiter references it. An acquire takes a reference before it waits; the holder's release,
or a wait that is canceled, gives it back; and the last reference out removes the key. A waiter queued on a key keeps
the lock alive, so a later acquire always waits on the same lock rather than being handed a fresh one. The
coordinator's memory therefore follows the applies in flight, not the number of distinct streams the process has
ever seen.

A wait that lasts longer than 30 seconds logs a Warning naming the key and the time waited, every 30 seconds, so a
holder that never releases is visible at once.

:::updated
The coordinator used to keep one lock for every key it had ever applied and never remove one, so a long-lived
process that projected many short streams held an idle lock per stream and perspective until it was restarted.
:::

## Security Context

Rewind system events fire as the **System user** across all tenants, published from the generated runner via the dispatcher's fluent security API:

```csharp{title="Rewind system-event dispatch" description="The generated runner publishes rewind events as the System principal with an explicit cross-tenant scope" framework="NET10" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Rewind", "Security"] unverified="Generated-runner system-event dispatch illustration; StreamRewindEventTests has no code-tests-map entry"}
await dispatcher.AsSystem().ForAllTenants()
    .PublishAsync(new PerspectiveRewindStarted(
        streamId, perspectiveName, triggeringEventId,
        replayFromEventId, hasSnapshot, startedAt));
```

`AsSystem()` establishes a system principal; `ForAllTenants()` sets an explicit cross-tenant scope, which is required here because the background rewind path has no ambient tenant context to inherit.

## Debounce

`PerspectiveRewindOptions` exposes a `DebounceWindow` (default 5s) and a `MaxDebounceWindow` hard cap (default 30s), and the cursor table carries a sliding `rewind_flagged_at` timestamp alongside a fixed `rewind_first_flagged_at` (preserved via `COALESCE` from the first detection). The intent is to coalesce a burst of late events on a hot stream into a **single** rewind rather than one per batch.

:::updated
At commit `0bc6065b` the debounce *columns and options exist* — `rewind_flagged_at` / `rewind_first_flagged_at` are **written** by the straggler-detection path in `complete_perspective_cursor_work` (not by the primary `store_perspective_events` detection) and **cleared** on successful completion — but no code path **reads** them as a hold-back gate, and nothing consumes `DebounceWindow` / `MaxDebounceWindow`. The coalescing behaviour described above is not wired in the current source — the scaffolding is present but the gate is inactive. Do not rely on a specific debounce window.
:::

## Related

- [Perspective Snapshots](snapshots.md) — the snapshot store a rewind restores from, and how snapshots are created and pruned.
- [Perspective Stream Locking](stream-locking.md) — the per-stream lock (`reason = "rewind"`) held during replay.
- [Perspective Rebuild](rebuild.md) — full read-model reconstruction (blue-green / in-place / selected streams), a distinct operation from late-event rewind.
