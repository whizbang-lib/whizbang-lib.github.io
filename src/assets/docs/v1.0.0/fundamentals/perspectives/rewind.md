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
  - src/Whizbang.Core/Perspectives/PerspectiveRewindOptions.cs
  - src/Whizbang.Core/Perspectives/PerspectiveSnapshotOptions.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
  - src/Whizbang.Generators/Templates/PerspectiveRunnerTemplate.cs
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
testReferences:
  - tests/Whizbang.Core.Tests/Perspectives/PerspectiveRewindOptionsTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/PerspectiveSnapshotAndRewindTests.cs
  - tests/Whizbang.Core.Component.Tests/Perspectives/PerspectiveRewindCompletionGapTests.cs
  - tests/Whizbang.Core.Tests/Observability/PerspectiveRewindMetricsTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PerspectiveWorkerRewindTests.cs
  - tests/Whizbang.Core.Tests/Observability/PerspectiveMetricsTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PerspectiveWorkerDeepPathDrainTests.StragglerDropped.cs
  - tests/Whizbang.Core.Tests/Events/System/StreamRewindEventTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/OverwriteOnlyRewindTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/LastInReplayOrderTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveRunnerOverwriteOnlyTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/CollectiveReplayRunnerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/CollectiveReplayRebuildIntegrationTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/RewindDeletedArchiveTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/ArchiveReadThroughIntegrationTests.cs
---

# Perspective Rewind

Rewind is the mechanism that keeps a perspective correct in the face of **out-of-order events**. Perspective events are ordered by their UUID7 `event_id` (UUID7 encodes a timestamp in its most-significant bits). When a **newly-stored** event has an `event_id` that is *older* than the position the perspective's cursor has already advanced past, the perspective would otherwise miss that event forever. Rewind detects this, replays the stream's events — restoring from a [snapshot](snapshots.md) when one is available — and re-applies them in correct chronological order so the read model converges on the right state.

Rewind builds on two neighbouring subsystems:

- [Snapshots](snapshots.md) — the periodic model-state captures a rewind restores from, so replay does not always start at event zero.
- [Stream Locking](stream-locking.md) — the per-stream lock a rewind holds so live event application cannot interleave with the replay.

## How Rewind Works

A rewind has two halves: **detection** (a SQL flag set when the late event lands) and **execution** (the C# worker + generated runner that replay the stream).

### Detection

Detection lives in the `store_perspective_events` SQL function, which inserts newly-arriving perspective-event work items. For each event that was *newly* stored (not a duplicate), it compares the event's id against the perspective cursor's `last_event_id`:

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

The **inbox emit chain** (`_emit_event_store_chain_for_inbox`, migration 100) declares identically for *received* events — the path every cross-service delivery and every stream-integrity backfill takes. This matters most for **reconciliation**: a backfilled event keeps its ORIGINAL event id, so the moment its work item is created the system already knows it slots below the cursor — while its freshly-stamped local `commit_sequence` sits *above* the cursor, which makes the straggler permanently invisible to any later runtime inversion comparison. Reconcile therefore **self-declares** the rewind at work-item creation; no heuristic detection is possible or needed.

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

### Snapshot selection

Inside `RewindAndRunAsync`, the runner asks the [snapshot store](snapshots.md) for the nearest safe restore point before the late event, then replays from there:

- When the trigger's `commit_sequence` is known, it prefers `GetLatestSnapshotBeforeCommitSequenceAsync` (fully deterministic against the live-apply path).
- Otherwise it falls back to `GetLatestSnapshotBeforeAsync(streamId, perspectiveName, triggeringEventId)`.
- If no qualifying snapshot exists (or the snapshot's serialization version is stale), it performs a **full replay** from event zero.
- When that replay needs archived history and the stream's archive was deleted, it refuses instead of replaying (see [A deleted archive](#deleted-archive)).

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

    foreach (var envelope in events.OrderByMessageId())
        (updatedModel, _) = ApplyEvent(perspective, updatedModel, envelope.Payload);

    // Advance the anchor so the next read returns only newer events.
    anchorEventId = lastSuccessfulEventId ?? events[^1].MessageId.Value;
}

// Single atomic write of model + cursor happens AFTER the loop drains.
```

This is the fix for an earlier defect: the original implementation read the event list **once** and applied that fixed set, so events appended between `PerspectiveRewindStarted` and `PerspectiveRewindCompleted` were silently dropped (a bulk import could complete the projection short a handful of items even though every event was durable). With the catch-up loop, the completed cursor reflects **HEAD-at-commit** rather than HEAD-when-the-replay-began. The behaviour is pinned by `PerspectiveRewindCompletionGapTests` (`FixedRewind_EventsAppendedDuringWindow_AreAppliedTooAsync` and `FixedRewind_NoLateAppends_StillTerminatesAsync`).

### Replay ordering: slotting reconciled events {#replay-ordering}

Each apply pass sorts its batch with **one comparator, chosen by what the batch can prove**:

1. **Origin order** — when every event in the batch carries the *same, non-empty* `SourceServiceId` and a positive `SourceCommitSequence` (a single-origin stream, the normal cross-service shape). A reconciled straggler keeps its original origin slot but lands with an arrival-fresh **local** sequence — a local-order replay would apply it *last*, which is exactly the arrival-order failure the rewind exists to correct. Origin order slots the backfilled event at its intended position, so the final model equals what a never-missed history would have produced.
2. **Stream order** — otherwise, when every event carries the version its stream appended it at (`LocalStreamVersion`, set by the replay read). This is the order the stream was written in and the order the live apply folded it in. A local `commit_sequence` only records when the stamper reached a row: rows stamped after the fact can carry sequences that run backward against their versions, and a replay in that order applied a stream's last write first and left the row holding an older value.
3. **Local commit order** — otherwise, when every event carries its local `commit_sequence` stamp (a store whose read does not carry the version). An id-ordered replay would silently undo newer writes, because same-millisecond UUIDv7 ids can disagree with the order events were stored in.
4. **Event-id order** — the fallback when any event is unstamped (stamper lag); a partial mix of comparators would interleave two orderings.

{verified: ReplayEventOrderTests.Order_WhenCommitSequencesRunBackwardAgainstVersions_FollowsTheStreamsVersionsAsync, ReplayEventOrderTests.Order_WhenOneOriginStampsEveryEvent_FollowsOriginOrderOverVersionOrderAsync, PerspectiveApplyIdempotencyTests.RewindAndRun_StampsRunBackwardAgainstTheStream_FoldsInStreamOrderAsync}

Cross-origin events on one stream have **no defined total order** (concurrent writers, per-origin sequence spaces — the numbers collide by design), so mixed-origin batches deliberately fall to rule 2/3 rather than invent one. Origin sequences are only ever compared *within* one origin.

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

### Collective events in a rewind {#collective-events}

{verified: CollectiveReplayRunnerTests.ARewindWithoutASnapshot_FoldsTheCollectivesFromTheStreamsStart_WithoutMovingTheCheckpointAsync, CollectiveReplayRunnerTests.ARewindFromASnapshot_FoldsTheCollectivesCommittedAfterTheSnapshotsEventAsync, CollectiveReplayRebuildIntegrationTests.Rewind_FromASnapshot_FoldsTheCollectivesCommittedAfterItAsync, CollectiveReplayRebuildIntegrationTests.Rewind_FromASnapshot_DoesNotFoldAgainACollectiveCommittedBeforeItAsync, CollectiveReplayRunnerTests.ARewindsCatchUpPasses_FoldEachCollectiveOnce_AndNeverAnchorTheReadOnOneAsync}

A rewind folds the row's [collective events](../messaging/collective-events#collective-replay-from-a-start) as a
rebuild does, merged among the stream's events in commit order. A rewind from the stream's start folds every one; a
rewind from a snapshot folds only the ones the snapshot does not hold, as below. A collective moves neither the checkpoint nor the frontier below, and it never anchors the catch-up
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

The replay checkpoints at the **frontier** — the *maximum* event id and *maximum* local `commit_sequence` applied — not the origin-order-last event's stamp. The idempotency floor's meaning is "everything at or below this is applied", and under origin-order replay the final event applied can carry a *lower* local stamp than a backfilled straggler it slotted. A below-floor checkpoint would also be refused by the perspective store's cross-pod lost-update guard, silently discarding the very correction the rewind computed. The catch-up anchor advances the same way (max id of the read window), so a refetch never re-serves the window's tail. Pinned by `ReconcileRewindScenarioTests` (`RewindReplay_BackfilledStraggler_SlotsIntoOriginOrder_NewerWriterWinsAsync`, `Reconcile_OlderConflictingWriterBackfilled_DeclaredRewindRestoresIntendedOrderAsync`, `Reconcile_LateInitializer_DeclaredRewindMergesBothWritersInOriginOrderAsync`) and `ReconcileRewindDeclarationSqlTests`.

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

## Configuration

Rewind detection and execution are governed by `PerspectiveRewindOptions`:

```csharp{title="PerspectiveRewindOptions" description="Configuration record for rewind enablement, startup repair mode, concurrency, and the debounce knobs" framework="NET10" category="Configuration" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Rewind", "Configuration"] tests=["PerspectiveRewindOptionsTests.Defaults_AllFieldsHaveExpectedValuesAsync", "PerspectiveRewindOptionsTests.RewindStartupMode_HasExpectedValuesAsync"]}
public class PerspectiveRewindOptions {
  // Master switch for rewind detection and execution.
  // When disabled, out-of-order events are detected but not replayed. Default: true.
  public bool Enabled { get; set; } = true;

  // Scan for and repair streams needing rewind on service startup. Default: true.
  public bool StartupScanEnabled { get; set; } = true;

  // Whether startup rewinds block polling or run in the background. Default: Blocking.
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
| `StartupRewindMode` | `RewindStartupMode` | `Blocking` | `Blocking`: rewinds clear before serving reads. `Background`: rewinds run via normal polling |
| `MaxConcurrentRewinds` | int | `3` | Intended limit on parallel rewind operations |
| `DebounceWindow` | TimeSpan | `5s` | Intended window before a rewind executes (see [Debounce](#debounce)) |
| `MaxDebounceWindow` | TimeSpan | `30s` | Intended hard cap on the debounce window |

:::updated
At commit `0bc6065b`, `MaxConcurrentRewinds`, `DebounceWindow`, and `MaxDebounceWindow` are defined and unit-tested for their defaults, but no consuming code path reads them — only `StartupScanEnabled` and `StartupRewindMode` are honoured by `PerspectiveWorker`. Treat the debounce/concurrency knobs as present-but-not-yet-wired.
:::

The neighbouring `PerspectiveSnapshotOptions` (`Enabled=true`, `SnapshotEveryNEvents=100`, `MaxSnapshotsPerStream=5`, `RewindSnapshotIntervalEvents=10`) and `PerspectiveStreamLockOptions` (`LockTimeout=30s`, `KeepAliveInterval=10s`) govern the snapshot store a rewind restores from and the lock it holds during replay. See [Perspective Snapshots](snapshots.md) and [Perspective Stream Locking](stream-locking.md).

## Startup Scan

On startup the worker runs `_scanAndRepairRewindsOnStartupAsync`, which queries `wh_perspective_cursors` for rows carrying the RewindRequired flag (`(status & 32) = 32`). This catches rewinds that were flagged but never executed — for example if the service crashed before processing them.

- **Blocking mode** (default): after logging the scan summary, the worker re-queries `GetCursorsRequiringRewindAsync` on each polling interval (up to a bounded number of iterations) until no RewindRequired cursors remain, then reports completion. Repairs finish before reads are served.
- **Background mode**: the worker logs the summary and lets the normal channel-consumer loop pick the rewinds up. Faster startup, but projections may be briefly stale.

If the scan itself throws, the worker logs a warning and continues — the flagged rewinds are still processed during normal polling.

## Observability

### Log entries

Rewind logs are split across **two logger categories** so their levels can be tuned independently.

**`Whizbang.Core.Workers.PerspectiveWorker`** — runtime rewind operations:

| Level | EventId | When |
|-------|---------|------|
| Warning | 52 | `Perspective rewind required for {PerspectiveName} stream {StreamId} — cursor at {CursorEventId}, late event {TriggerEventId} ({EventsBehind} events behind)` |
| Warning | 53 | `Perspective rewind completed for {PerspectiveName} stream {StreamId} — replayed {EventsReplayed} events in {DurationMs}ms (from {ReplaySource})` |
| Error | 58 | `Perspective rewind failed for {PerspectiveName} stream {StreamId} — trigger event {TriggerEventId}. Stream will retry on next cycle.` |
| Warning | 43 | `Failed to acquire stream lock for rewind on {PerspectiveName} stream {StreamId}, deferring` |

> The EventId 53 `{ReplaySource}` token resolves to `"snapshot store available"` or `"no snapshot store"` — it reflects whether a snapshot store is configured, **not** whether this rewind actually restored from a snapshot (see [Snapshot-usage caveat](#snapshot-usage-caveat)). The *actual* snapshot-vs-full decision is on the runner's own Warning lines described under [Snapshot selection](#snapshot-selection).

**`Whizbang.Core.Workers.PerspectiveStartupScan`** — startup scan (configure independently):

| Level | EventId | When |
|-------|---------|------|
| Information | 54 | `Startup rewind scan started: {StreamCount} streams require rewind across {PerspectiveCount} perspectives` |
| Information | 55 | `Startup rewind scan completed: {StreamCount} streams, {PerspectiveCount} perspectives rewound in {DurationMs}ms` |
| Information | 57 | `Startup rewind scan: no streams require rewind` |
| Warning | 56 | `Error during startup rewind scan — rewinds will be processed during normal polling` |

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

## Error Handling

Rewind failures are **isolated per stream** — one stream's rewind throwing does not crash the perspective worker. In `_executeRewindPathAsync`, the call to `runner.RewindAndRunAsync` is wrapped in a `catch` for any non-cancellation exception, which:

- Logs at **Error** (EventId 58) with perspective name, stream id, and trigger event id.
- Increments `whizbang.perspective.errors`.
- Sets `Error` status on the OTel span.
- Returns a failure completion (`Status = None`) — the cursor's RewindRequired flag stays set, so the stream is retried on the next polling cycle.

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
