---
title: Perspective Snapshots
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Perspectives
order: 11
description: >-
  Snapshot and rewind pattern for efficient late-arriving event processing -
  store model state at intervals, restore from snapshots instead of replaying
  from event zero
tags: >-
  perspectives, snapshots, rewind, late-arriving-events, replay,
  read-models, operational
codeReferences:
  - src/Whizbang.Core/Perspectives/IPerspectiveSnapshotStore.cs
  - src/Whizbang.Core/Perspectives/PerspectiveSnapshotOptions.cs
  - src/Whizbang.Core/Perspectives/SnapshotEnvelope.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperPerspectiveSnapshotStore.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCorePerspectiveSnapshotStore.cs
  - src/Whizbang.Data.Schema/Schemas/PerspectiveSnapshotsSchema.cs
  - src/Whizbang.Generators/Templates/PerspectiveRunnerTemplate.cs
  - src/Whizbang.Core/Perspectives/ICollectiveSnapshotFence.cs
  - src/Whizbang.Core/Perspectives/CollectiveReplayStart.cs
  - src/Whizbang.Data.Postgres/PostgresCollectiveSnapshotFence.cs
  - src/Whizbang.Data.Postgres/Migrations/275_SnapshotsRecordTheirCollectives.sql
  - src/Whizbang.Data.Postgres/Migrations/276_CollectiveSnapshotFence.sql
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EvictionCompanionCleanupSqlTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/EvictedRowRebuildTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/PerspectiveSnapshotAndRewindTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/SnapshotEnvelopeTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/Perspectives/DapperPerspectiveSnapshotStoreTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCorePerspectiveSnapshotStoreTests.cs
  - tests/Whizbang.Data.Schema.Tests/Schemas/PerspectiveSnapshotsSchemaTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/SplitClassSnapshotRewindTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/CollectiveReplayRunnerTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveRunnerSplitSnapshotTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/CollectiveReplayRebuildIntegrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Collective/CollectiveSnapshotFenceSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/SnapshotSelectionFollowsStreamOrderTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ArchivedStreamRebuildSqlTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperArchivedStreamRebuildTests.cs
lastMaintainedCommit: '01f07906'
---

# Perspective Snapshots

When a **late-arriving event** lands before the perspective's current cursor position, Whizbang must **rewind** the perspective and replay events from an earlier point. Without snapshots, this means replaying from event zero -- expensive for streams with thousands of events. The snapshot store captures model state at regular intervals so rewinds restore from the nearest snapshot instead.

## IPerspectiveSnapshotStore

```csharp{title="IPerspectiveSnapshotStore" description="Core interface for storing and retrieving perspective snapshots" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "IPerspectiveSnapshotStore"] tests=["EFCorePerspectiveSnapshotStoreTests.CreateSnapshotAsync_NewSnapshot_InsertsSuccessfullyAsync", "EFCorePerspectiveSnapshotStoreTests.GetLatestSnapshotAsync_MultipleSnapshots_ReturnsLatestBySequenceAsync", "EFCorePerspectiveSnapshotStoreTests.GetLatestSnapshotBeforeAsync_MixedSnapshots_ReturnsCorrectOneAsync", "EFCorePerspectiveSnapshotStoreTests.GetLatestSnapshotWithCommitSequenceAsync_ReturnsSnapshotCommitSequenceAsync", "EFCorePerspectiveSnapshotStoreTests.GetLatestSnapshotBeforeCommitSequenceAsync_ReturnsLatestBeforeAnchorAsync", "EFCorePerspectiveSnapshotStoreTests.HasAnySnapshotAsync_WithSnapshots_ReturnsTrueAsync", "EFCorePerspectiveSnapshotStoreTests.PruneOldSnapshotsAsync_KeepsNewestAsync", "EFCorePerspectiveSnapshotStoreTests.DeleteAllSnapshotsAsync_RemovesAllAsync"]}
public interface IPerspectiveSnapshotStore {
  Task CreateSnapshotAsync(Guid streamId, string perspectiveName, Guid snapshotEventId,
    JsonDocument snapshotData, CancellationToken ct = default);

  // Commit-sequence-aware overload (default implementation falls through to the
  // legacy method; the Dapper + EFCore stores persist snapshot_commit_sequence)
  Task CreateSnapshotAsync(Guid streamId, string perspectiveName, Guid snapshotEventId,
    long? snapshotCommitSequence, JsonDocument snapshotData, CancellationToken ct = default);

  Task<(Guid SnapshotEventId, JsonDocument SnapshotData)?> GetLatestSnapshotAsync(
    Guid streamId, string perspectiveName, CancellationToken ct = default);

  Task<(Guid SnapshotEventId, long? SnapshotCommitSequence, JsonDocument SnapshotData)?>
    GetLatestSnapshotWithCommitSequenceAsync(
      Guid streamId, string perspectiveName, CancellationToken ct = default);

  Task<(Guid SnapshotEventId, JsonDocument SnapshotData)?> GetLatestSnapshotBeforeAsync(
    Guid streamId, string perspectiveName, Guid beforeEventId, CancellationToken ct = default);

  Task<(Guid SnapshotEventId, long? SnapshotCommitSequence, JsonDocument SnapshotData)?>
    GetLatestSnapshotBeforeCommitSequenceAsync(
      Guid streamId, string perspectiveName, long beforeCommitSequence, CancellationToken ct = default);

  Task<bool> HasAnySnapshotAsync(Guid streamId, string perspectiveName,
    CancellationToken ct = default);

  Task PruneOldSnapshotsAsync(Guid streamId, string perspectiveName, int keepCount,
    CancellationToken ct = default);

  Task DeleteAllSnapshotsAsync(Guid streamId, string perspectiveName,
    CancellationToken ct = default);
}
```

The commit-sequence variants anchor snapshots to the event store's `commit_sequence` so rewind replay reproduces live-apply order even when UUIDv7 generation timing and commit order disagree. They have default interface implementations, so custom stores that only implement the legacy methods keep compiling.

## How Snapshots Work

The snapshot/rewind pattern follows this lifecycle:

1. **Normal processing**: Events arrive in order. After every N events (configurable), the perspective runner serializes the current model state and calls `CreateSnapshotAsync`.
2. **Late-arriving event detected**: The `PerspectiveWorker` sees `RewindRequired` status on a work item and identifies the `RewindTriggerEventId`.
3. **Restore from snapshot**: The runner calls `GetLatestSnapshotBeforeAsync` with the late event's ID to find the nearest safe restore point.
4. **Replay**: Events are replayed from the snapshot's position through the current cursor, including the late-arriving event in its correct chronological position.
5. **Pruning**: Old snapshots beyond the retention limit are pruned to control storage.

A snapshot is the model as it was applied, including the fields a `Split` model keeps only in their
columns, so a rewind from it writes those columns back with their values. See
[Reading promoted fields back](physical-fields.md#reading-promoted-fields-back).

## Methods

### CreateSnapshotAsync

Persists a snapshot of the perspective model state at a specific event position. The snapshot data is stored as serialized JSON. If a snapshot already exists for the same `(streamId, perspectiveName, snapshotEventId)` triple, it is replaced (upsert semantics).

```csharp{title="CreateSnapshotAsync" description="Create a snapshot after processing events" category="Usage" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Snapshots", "Create"] tests=["EFCorePerspectiveSnapshotStoreTests.CreateSnapshotAsync_NewSnapshot_InsertsSuccessfullyAsync", "EFCorePerspectiveSnapshotStoreTests.CreateSnapshotAsync_DuplicateEventId_UpsertsDataAsync"]}
// Snapshot is created automatically by the perspective runner
// after every N events (configured via PerspectiveSnapshotOptions)
await snapshotStore.CreateSnapshotAsync(
    streamId: orderId,
    perspectiveName: "OrderPerspective",
    snapshotEventId: lastProcessedEventId,
    snapshotData: JsonSerializer.SerializeToDocument(currentModel));
```

### GetLatestSnapshotAsync

Returns the most recent snapshot for a stream/perspective pair, ordered by sequence number. Returns `null` if no snapshots exist.

```csharp{title="GetLatestSnapshotAsync" description="Retrieve the latest snapshot for a stream" category="Usage" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Snapshots", "Query"] tests=["EFCorePerspectiveSnapshotStoreTests.GetLatestSnapshotAsync_MultipleSnapshots_ReturnsLatestBySequenceAsync", "EFCorePerspectiveSnapshotStoreTests.GetLatestSnapshotAsync_NoSnapshots_ReturnsNullAsync"]}
var snapshot = await snapshotStore.GetLatestSnapshotAsync(orderId, "OrderPerspective");
if (snapshot.HasValue) {
    var (eventId, data) = snapshot.Value;
    var model = data.Deserialize<OrderModel>();
    // Resume processing from eventId forward
}
```

### GetLatestSnapshotBeforeAsync

Finds the latest snapshot taken **before** a specified event ID. This is the key method for the rewind pattern -- it locates the safe restore point before the late-arriving event. Uses UUID7 comparison to determine temporal ordering.

```csharp{title="GetLatestSnapshotBeforeAsync" description="Find the nearest snapshot before a late-arriving event" category="Usage" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Snapshots", "Rewind"] tests=["EFCorePerspectiveSnapshotStoreTests.GetLatestSnapshotBeforeAsync_MixedSnapshots_ReturnsCorrectOneAsync", "EFCorePerspectiveSnapshotStoreTests.GetLatestSnapshotBeforeAsync_NoQualifyingSnapshot_ReturnsNullAsync"]}
// Late-arriving event detected at rewindTriggerEventId
var snapshot = await snapshotStore.GetLatestSnapshotBeforeAsync(
    orderId, "OrderPerspective", rewindTriggerEventId);

if (snapshot.HasValue) {
    // Restore model from snapshot, then replay events from snapshot position
    var (snapshotEventId, snapshotData) = snapshot.Value;
    var model = snapshotData.Deserialize<OrderModel>();
    // Replay all events after snapshotEventId through current cursor
} else {
    // No qualifying snapshot -- must replay from event zero
}
```

### HasAnySnapshotAsync

Cheap index-scan check for whether any snapshot exists for a stream/perspective pair. Used for **bootstrap detection** -- when an existing stream has processed events but no snapshots yet, the `PerspectiveWorker` triggers a one-time bootstrap to create the initial snapshot.

```csharp{title="HasAnySnapshotAsync" description="Check if snapshots exist for bootstrap detection" category="Usage" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Snapshots", "Bootstrap"] tests=["EFCorePerspectiveSnapshotStoreTests.HasAnySnapshotAsync_WithSnapshots_ReturnsTrueAsync", "EFCorePerspectiveSnapshotStoreTests.HasAnySnapshotAsync_NoSnapshots_ReturnsFalseAsync"]}
var hasSnapshots = await snapshotStore.HasAnySnapshotAsync(orderId, "OrderPerspective");
if (!hasSnapshots) {
    // First time -- bootstrap a snapshot from current state
    await runner.BootstrapSnapshotAsync(orderId, "OrderPerspective", lastProcessedEventId);
}
```

### PruneOldSnapshotsAsync

Deletes old snapshots, keeping only the most recent N per stream/perspective. Called after each new snapshot creation to bound storage growth.

```csharp{title="PruneOldSnapshotsAsync" description="Prune old snapshots to control storage" category="Usage" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Snapshots", "Pruning"] tests=["EFCorePerspectiveSnapshotStoreTests.PruneOldSnapshotsAsync_KeepsNewestAsync"]}
// Keep the 5 most recent snapshots, delete the rest
await snapshotStore.PruneOldSnapshotsAsync(orderId, "OrderPerspective", keepCount: 5);
```

### DeleteAllSnapshotsAsync

Removes all snapshots for a stream/perspective pair. Used during **perspective rebuild** to invalidate stale snapshots that no longer match the rebuilt model state.

```csharp{title="DeleteAllSnapshotsAsync" description="Delete all snapshots during a perspective rebuild" category="Usage" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Snapshots", "Rebuild"] tests=["EFCorePerspectiveSnapshotStoreTests.DeleteAllSnapshotsAsync_RemovesAllAsync", "EFCorePerspectiveSnapshotStoreTests.DeleteAllSnapshotsAsync_DifferentStreams_OnlyDeletesTargetAsync"]}
// During perspective rebuild, invalidate all existing snapshots
await snapshotStore.DeleteAllSnapshotsAsync(orderId, "OrderPerspective");
```

## PerspectiveSnapshotOptions

```csharp{title="PerspectiveSnapshotOptions" description="Configuration for snapshot frequency and retention" category="Configuration" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Snapshots", "Configuration"] unverified="configuration options POCO — property defaults have no behavioral test"}
public class PerspectiveSnapshotOptions {
  // Create a snapshot every N events processed (default: 100)
  public int SnapshotEveryNEvents { get; set; } = 100;

  // Maximum snapshots to keep per (stream, perspective) pair (default: 5)
  public int MaxSnapshotsPerStream { get; set; } = 5;

  // Snapshot cadence for EPHEMERAL perspectives (those applying at least one
  // ephemeral event) -- more aggressive to keep a fresh rewind floor within the
  // grace window before consumed bodies are reaped (default: 10)
  public int EphemeralSnapshotEveryNEvents { get; set; } = 10;

  // Maximum snapshots kept per (stream, perspective) for EPHEMERAL perspectives.
  // Single-slot: you can never rewind below the reap boundary (default: 1)
  public int EphemeralMaxSnapshotsPerStream { get; set; } = 1;

  // Whether snapshot creation is enabled (default: true)
  // When disabled, rewinds always replay from event zero
  public bool Enabled { get; set; } = true;

  // During a rewind replay, take an additional snapshot every N events applied,
  // placing restore points at multiple historical positions along the timeline.
  // Set to 0 to keep only the end-of-rewind snapshot. (default: 10)
  public int RewindSnapshotIntervalEvents { get; set; } = 10;

  // What to do when a stored snapshot's serialization version does not match
  // the current version. Default: RebuildFromEvents (discard the stale snapshot
  // and replay from events -- always correct since snapshots are a derived cache).
  // Other values: None (treat as error), LazyUpcast, UpgradeOnStartup.
  public SnapshotUpgradePolicy UpgradePolicy { get; set; } = SnapshotUpgradePolicy.RebuildFromEvents;
}
```

Configure via dependency injection:

```csharp{title="Configure Snapshot Options" description="Register snapshot options in DI" category="Configuration" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Snapshots", "DI"] unverified="configuration wiring (services.Configure) — no behavioral test"}
services.Configure<PerspectiveSnapshotOptions>(options => {
    options.SnapshotEveryNEvents = 50;   // More frequent snapshots
    options.MaxSnapshotsPerStream = 10;  // Keep more history
    options.Enabled = true;
});
```

## The Snapshot/Rewind Pattern

The rewind pattern handles late-arriving events that must be inserted at their correct chronological position in a perspective's event history.

### Why Events Arrive Late

In distributed systems, events may arrive out of order due to:
- Network partitions or retries
- Multi-service event production with clock skew
- Reprocessing from dead-letter queues

### Rewind Flow

1. **Detection**: The `PerspectiveWorker` detects a work item with `RewindRequired` status and a `RewindTriggerEventId`.
2. **Lock acquisition**: A [stream lock](stream-locking.md) is acquired to prevent concurrent event application during rewind.
3. **Snapshot lookup**: `GetLatestSnapshotBeforeAsync` finds the nearest snapshot before the late event.
4. **Restore**: The perspective model is restored from the snapshot's serialized JSON.
5. **Replay**: All events from the snapshot position through the current cursor are replayed in correct order, now including the late-arriving event.
6. **Lock release**: The stream lock is released, and normal processing resumes.

If no qualifying snapshot exists, the rewind replays from event zero. This is why snapshots are important for streams with many events -- they bound the replay cost.

### A replay's snapshot stops at its last event {#a-replays-snapshot-and-collectives}

{verified: CollectiveReplayRunnerTests.ARewindsSnapshot_IsTheRowAtItsLastEvent_BeforeTheCollectivesCommittedAfterItAsync, CollectiveReplayRunnerTests.ARebuildsSnapshot_IsTheRowAtItsLastEvent_BeforeTheCollectivesCommittedAfterItAsync, PerspectiveRunnerSplitSnapshotTests.Runner_TakesTheSnapshotBeforeTheWriteAtBothWritesThatSnapshotAsync, PerspectiveRunnerSplitSnapshotTests.Runner_CopiesTheRowAtItsLastEvent_OnlyWhenSnapshotsAreOnAsync}

A rewind and a rebuild fold the row's [collective events](../messaging/collective-events#collective-replay-from-a-start)
among the stream's events, so the row a replay writes can hold collectives committed after the stream's last event. A
snapshot is recorded at an event, and a later rewind from it folds the collectives committed after that event. So the
snapshot a replay takes, the rewind's final snapshot and a rebuild's snapshot alike, is the row **at its last event,
before the collectives committed after it fold**. The row itself is written with them.
The replay serializes that copy of the row when the first collective after a stream event folds, only when snapshots
are on, and drops it at the next stream event, so it keeps one copy at most.
{verified: PerspectiveRunnerSplitSnapshotTests.Runner_CopiesTheRowAtItsLastEvent_OnlyWhenSnapshotsAreOnAsync}

| Choice | Reason | Verified |
|---|---|---|
| The snapshot holds no collective committed after its event. | A rewind from it folds those collectives; a snapshot that already held them would have them folded twice. | {verified: CollectiveReplayRunnerTests.ARewindsSnapshot_IsTheRowAtItsLastEvent_BeforeTheCollectivesCommittedAfterItAsync, CollectiveReplayRunnerTests.ARebuildsSnapshot_IsTheRowAtItsLastEvent_BeforeTheCollectivesCommittedAfterItAsync} |
| Both writes that take a snapshot, the end of a rebuild's run and the end of a rewind, prefer the row at its last event, serialized before the write. | Each already captures its snapshot before the write; the row at the last event is the one to capture when collectives folded after it. | {verified: PerspectiveRunnerSplitSnapshotTests.Runner_TakesTheSnapshotBeforeTheWriteAtBothWritesThatSnapshotAsync} |

A live snapshot is different: it is the row as the live apply read it, while the collective sink applies collectives
on its own. How a live snapshot says which collectives it holds is the next section.

### Snapshots of a row with collectives {#collectives}

{verified: CollectiveReplayRunnerTests.ALiveSnapshot_OfARowWithCollectives_RecordsTheFencesMark_ReadBeforeTheRowAndAgainAfterItsWriteAsync, CollectiveReplayRunnerTests.ALiveSnapshot_IsDeferred_WhenACollectiveOfTheRowIsInFlightBeforeTheReadAsync, CollectiveReplayRunnerTests.ALiveSnapshot_IsDeferred_WhenACollectiveOfTheRowMovedByTheReadAfterTheWriteAsync, CollectiveReplayRebuildIntegrationTests.LiveApply_WithTheDriversFence_TakesASnapshotThatRecordsTheStoresMark_WhenNoCollectiveIsInFlightAsync, CollectiveReplayRebuildIntegrationTests.LiveApply_WithTheDriversFence_DefersTheSnapshot_WhileACollectiveOfTheRowIsQueuedAsync}

The [collective sink](../messaging/collective-events#apply-execution-scoped-bounded-indexed) applies a collective to
rows on its own, a key at a time and a batch at a time, each batch in a transaction of its own. A collective is
**complete** only after its last batch, when the worker completes its work row. A live snapshot is the row as the live
apply read it, so without more it cannot say which collectives it holds: it can hold a collective committed after its
event, or miss one committed before it, and a rewind from it would then fold that collective twice or not at all.

So a snapshot of a row whose model has collectives records a **mark**, H, in
`wh_perspective_snapshots.collectives_through_sequence` (migration 275): every collective of the row stamped with a
commit sequence at or below H was complete when the snapshot was taken. The snapshot is taken **prior to** any
collective still in flight: such a collective counts as past H, and the next snapshot, taken once it completes,
captures it. A rewind or a rebuild from the snapshot then folds exactly the collectives the snapshot does not hold.

#### How the mark is read {#collectives-fence}

The runner reads a fence, `ICollectiveSnapshotFence`, which both Postgres drivers register over the
`wh_collective_snapshot_fence` function (migration 276). The fence answers in one statement, so both of its answers come
from one view of the database:

- **The mark** is the event store's highest commit sequence (zero for a store with no stamped event). When nothing of
  the row is in flight, every collective of the row stamped at or below it is complete. A collective that commits later
  is stamped by a stamper call that starts after it commits, from a sequence already past the mark.
- **In flight** means a collective of the row's tenant and of one of the model's collective types that is not complete:
  its sink work row is still unprocessed (it may have applied some batches and not others), its event is still
  unstamped (its stamp will land above the mark while the row may already hold it), or, on the second read, it was
  stamped past the first read's mark (it completed between the two reads).

```mermaid{caption="A live snapshot of a row with collectives: the fence is read before the row and again after the write, and the snapshot records the first mark only when neither read saw a collective of the row in flight." tests=["CollectiveReplayRunnerTests.ALiveSnapshot_OfARowWithCollectives_RecordsTheFencesMark_ReadBeforeTheRowAndAgainAfterItsWriteAsync", "CollectiveReplayRunnerTests.ALiveSnapshot_IsDeferred_WhenACollectiveOfTheRowIsInFlightBeforeTheReadAsync", "CollectiveReplayRunnerTests.ALiveSnapshot_IsDeferred_WhenACollectiveOfTheRowMovedByTheReadAfterTheWriteAsync"]}
sequenceDiagram
    participant R as Perspective runner
    participant F as Collective snapshot fence
    participant S as Perspective store
    participant P as Snapshot store
    R->>F: Read (tenant, collective types)
    F-->>R: mark H, in flight?
    R->>S: Read the row
    R->>S: Apply the events, write the row
    R->>F: Read again, after H
    F-->>R: in flight?
    alt Neither read saw a collective of the row in flight
        R->>P: Snapshot with collectives_through_sequence = H
    else A collective of the row was in flight
        R->>R: Defer, count snapshots_deferred, stay due
    end
```

```csharp{title="ICollectiveSnapshotFence" description="The read a snapshot of a row with collectives makes, before the row is read and again after it is written" framework="NET10" category="Perspectives" difficulty="ADVANCED" tags=["Perspectives", "Snapshots", "Collective Events"] tests=["CollectiveSnapshotFenceSqlTests.Fence_WithNoCollectiveOfTheRowInFlight_IsQuiet_AndMarksTheStoresHighestCommitSequenceAsync", "CollectiveSnapshotFenceSqlTests.Fence_WithACollectiveOfTheRowStillQueued_IsInFlightAsync", "CollectiveSnapshotFenceSqlTests.Fence_AfterAMark_IsInFlight_WhenACollectiveOfTheRowWasStampedPastItAsync", "ArchivedStreamRebuildSqlTests.TheDriver_RegistersTheCollectiveSnapshotFence_OnItsArchiveConnectionAsync", "DapperArchivedStreamRebuildTests.AddWhizbangPostgres_RegistersTheCollectiveSnapshotFenceAsync"]}
namespace Whizbang.Core.Perspectives;

public interface ICollectiveSnapshotFence {
  // One statement, one view of the database. afterSequence is null on the read before the row,
  // and the first read's mark on the read after the write.
  Task<CollectiveSnapshotFenceReading> ReadAsync(
    string? tenantId,
    IReadOnlyList<string> collectiveEventTypes,
    long? afterSequence,
    CancellationToken cancellationToken = default);
}

// CompleteThroughSequence: the store's highest commit sequence, or null for a store with no stamped event.
// CollectiveInFlight: a collective of the row is queued, unstamped, or stamped past afterSequence.
public sealed record CollectiveSnapshotFenceReading(long? CompleteThroughSequence, bool CollectiveInFlight);
```

The store writes the mark with the snapshot, through a `CreateSnapshotAsync` overload that takes
`collectivesThroughSequence`, and reads it back with the snapshot (`PerspectiveSnapshotFloor.CollectivesThroughSequence`,
`GetLatestSnapshotFloorAsync`). Both are default interface methods, so a hand-written store keeps compiling: it writes
the snapshot without the mark, and its snapshots keep the older rule below.

#### A deferred snapshot {#collectives-deferred}

{verified: CollectiveReplayRunnerTests.ADeferredSnapshot_StaysDue_AndTheNextQuietApplyTakesItAsync}

If a collective of the row is in flight at either read, the snapshot is **not taken**. The deferral is counted in
[`whizbang.perspective.snapshots_deferred`](../../operations/observability/metrics#backlog-rewind), tagged with
`perspective_name`, and logged at Debug. The snapshot stays due, so the next apply of the stream takes it once the
row's collectives are at rest. Nothing is written on the collective sink's update path for any of this: the fence only
reads.

**The trade-off.** A tenant whose collectives on a model are almost never at rest keeps deferring that model's live
snapshots, and its rewinds start from older snapshots (or from the stream's start). A count of `snapshots_deferred`
that keeps rising for one perspective is that case.

#### Replays from a marked snapshot {#collectives-replay}

{verified: CollectiveReplayRunnerTests.ARewindFromASnapshotThatRecordsItsCollectives_StartsFromItsMarkAsync, CollectiveReplayRunnerTests.ADefaultRebuildFromTheNewestSnapshot_StartsFromItsMarkAsync, CollectiveReplayRebuildIntegrationTests.Rewind_FromASnapshotThatRecordsItsCollectives_FoldsACollectiveCommittedBeforeItsEvent_ThatWasInFlightAsync, CollectiveReplayRebuildIntegrationTests.Rewind_FromASnapshotThatRecordsItsCollectives_DoesNotFoldAgainACollectiveCommittedAfterItsEvent_ThatItHoldsAsync}

A [rewind](rewind#collective-events), and a default [rebuild from the newest snapshot](rebuild#archived-data), start
from the snapshot's mark. They fold the row's collectives stamped past H, and every collective still unstamped,
whatever their position against the snapshot's event; they fold none stamped at or below H. A snapshot that a replay
takes records the mark it holds: the mark it started from, raised to the commit sequence of every collective it folded
before the snapshot's event. After an unstamped collective folded before that event, no sequence describes what the
row holds, so that snapshot records no mark.

| Snapshot | A replay from it folds |
|---|---|
| Records a mark H | The row's collectives stamped past H, and every unstamped one |
| Records no mark (taken before migration 275, or by a store that writes none) | The collectives committed after the snapshot's event, as before |

#### Why each choice {#collectives-reasons}

| Choice | Reason | Verified |
|---|---|---|
| The fence is read before the row and again after the write, and the snapshot records the first read's mark. | The first read bounds what the row could hold when it was read; the second catches a collective that moved while the row was applied and written. Together they make the mark exact for the row as written, and the live write's row-version check already guarantees the snapshot is that row. | {verified: CollectiveReplayRunnerTests.ALiveSnapshot_OfARowWithCollectives_RecordsTheFencesMark_ReadBeforeTheRowAndAgainAfterItsWriteAsync, CollectiveReplayRebuildIntegrationTests.LiveApply_WithTheDriversFence_TakesASnapshotThatRecordsTheStoresMark_WhenNoCollectiveIsInFlightAsync} |
| A snapshot is taken prior to an in-flight collective: deferred, never recorded holding part of one. | Collectives exist for bulk-update speed, so the sink's update path writes nothing for snapshots. Without a per-batch record, a row partway through a collective cannot be described by any mark. | {verified: CollectiveReplayRunnerTests.ALiveSnapshot_IsDeferred_WhenACollectiveOfTheRowIsInFlightBeforeTheReadAsync, CollectiveReplayRebuildIntegrationTests.LiveApply_WithTheDriversFence_DefersTheSnapshot_WhileACollectiveOfTheRowIsQueuedAsync} |
| It always defers while a collective of the row is in flight, even one whose setters look idempotent. | Applying a collective twice is harmless only when the second application gives the same row as the first. A constant setter fails that when its `Where` reads a field another event changed between the two applications, and any collective fails it when it sits before events the row folded after it. The runner cannot prove either from the spec, so it does not try. | {verified: CollectiveReplayRunnerTests.ALiveSnapshot_IsDeferred_WhenACollectiveOfTheRowIsInFlightBeforeTheReadAsync, CollectiveReplayRunnerTests.ALiveSnapshot_IsDeferred_WhenACollectiveOfTheRowMovedByTheReadAfterTheWriteAsync} |
| A deferral is counted, and the deferred snapshot stays due. | A model that never gets a snapshot must be visible, and the next quiet apply should take the snapshot rather than wait a whole cadence. | {verified: CollectiveReplayRunnerTests.ADeferredSnapshot_StaysDue_AndTheNextQuietApplyTakesItAsync} |
| A store with no stamped event marks zero, and the second read looks past zero. | No collective was complete, so the snapshot holds none, and any collective stamped between the reads still counts as in flight. | {verified: CollectiveReplayRunnerTests.ALiveSnapshot_OfAStoreWithNoStampedEvent_RecordsAMarkOfZero_AndTheSecondReadLooksPastZeroAsync} |
| No fence is read and no mark recorded for a model without collectives, in a host without a fence, or by a rebuild. | Only a row with collectives can hold part of one. A rebuild folds every collective in commit order, so its snapshot holds exactly the ones before its event. A host without a fence keeps the older rule. | {verified: CollectiveReplayRunnerTests.ALiveSnapshot_OfAModelWithNoCollectives_ReadsNoFence_AndRecordsNoMarkAsync, CollectiveReplayRunnerTests.ALiveSnapshot_InAHostWithNoFence_RecordsNoMarkAsync, CollectiveReplayRunnerTests.ARebuildsSnapshot_ReadsNoFence_AndRecordsNoMarkAsync} |
| A [bootstrap](#bootstrap) snapshot is fenced for the tenant the row is stored under, and deferred when the store cannot say that tenant. | A bootstrap has no event to take the tenant from, and a fence read for the wrong tenant would mark collectives the row never received. | {verified: CollectiveReplayRunnerTests.ABootstrapSnapshot_OfARowWithCollectives_RecordsTheFencesMark_ForTheRowsTenantAsync, CollectiveReplayRunnerTests.ABootstrapSnapshot_IsDeferred_WhenACollectiveOfTheRowIsInFlightAsync, CollectiveReplayRunnerTests.ABootstrapSnapshot_OfARowWhoseTenantTheStoreDoesNotSay_IsDeferredAsync} |
| A replay from a marked snapshot folds the collectives stamped past the mark and every unstamped one, whatever their position against its event. | The mark, not the snapshot's event, says what the snapshot holds. Every collective it holds was stamped when it was taken, so an unstamped one is past it. | {verified: CollectiveReplayRunnerTests.AStart_FromASnapshotThatRecordsItsCollectives_FollowsTheStampedCollectivesAboveTheMark_OnlyAsync, CollectiveReplayRunnerTests.AStart_FromASnapshotThatRecordsItsCollectives_FollowsAnUnstampedCollective_WhateverItsIdAsync, CollectiveReplayRebuildIntegrationTests.Rewind_FromASnapshotThatRecordsItsCollectives_FoldsACollectiveCommittedBeforeItsEvent_ThatWasInFlightAsync, CollectiveReplayRebuildIntegrationTests.Rewind_FromASnapshotThatRecordsItsCollectives_DoesNotFoldAgainACollectiveCommittedAfterItsEvent_ThatItHoldsAsync} |
| A rewind and the default rebuild from the newest snapshot start from the same mark. | They run the same replay from a model, so they must agree on what the model holds. | {verified: CollectiveReplayRunnerTests.ARewindFromASnapshotThatRecordsItsCollectives_StartsFromItsMarkAsync, CollectiveReplayRunnerTests.ADefaultRebuildFromTheNewestSnapshot_StartsFromItsMarkAsync} |
| A replay's own snapshot records the mark it holds, or none after an unstamped collective folded before its event. | A later rewind from it must fold exactly the rest, and an unstamped collective cannot be described by a commit sequence. | {verified: CollectiveReplayRunnerTests.AReplaysSnapshot_RecordsTheMarkItHolds_TheStartsAndThatOfEverythingFoldedBeforeItsEventAsync, CollectiveReplayRunnerTests.AReplaysSnapshot_AfterAnUnstampedCollectiveFoldedBeforeItsEvent_RecordsNoMarkAsync} |
| A snapshot with no mark keeps the snapshot-event rule. | Snapshots written before migration 275, or by a store that writes no mark, cannot say more, and the snapshot-event rule is what they were taken under. | {verified: CollectiveReplayRunnerTests.ARewindFromASnapshot_FoldsTheCollectivesCommittedAfterTheSnapshotsEventAsync, PerspectiveSnapshotAndRewindTests.CreateSnapshotAsync_WithACollectivesMark_DefaultImpl_WritesTheSnapshotWithoutTheMarkAsync, PerspectiveSnapshotAndRewindTests.GetLatestSnapshotFloorAsync_DefaultImpl_WrapsTheNewestSnapshot_WithNoMarkAsync} |
| Both stores write the mark with the snapshot data, and the floor and the newest snapshot read it. | The mark describes that data, so it must land and be read in the same row. | {verified: SnapshotSelectionFollowsStreamOrderTests.SnapshotStore_RecordsTheCollectivesCompleteThroughMark_AndTheFloorAndTheNewestSnapshotCarryItAsync, DapperPerspectiveSnapshotStoreTests.SnapshotStore_RecordsTheCollectivesCompleteThroughMark_AndTheFloorAndTheNewestSnapshotCarryItAsync, PerspectiveSnapshotsSchemaTests.Table_HasCorrectColumnsAsync} |
| Each fence probe walks an index that holds only what it looks for: the unprocessed collective queue (migration 215) and the unstamped and stamped events (migration 046). | The fence runs twice per snapshot taken, so it must not scan the work queue or the event store. | {verified: CollectiveSnapshotFenceSqlTests.Fence_WithACollectiveOfTheRowStillQueued_IsInFlightAsync, CollectiveSnapshotFenceSqlTests.Fence_WithACollectiveOfTheRowCompleteButUnstamped_IsInFlightAsync} |
| The fence ignores other tenants and other collective types, and a row with no tenant sees only collectives with no tenant. | Only a collective that can reach the row can make its snapshot inexact; anything wider would defer snapshots for nothing. | {verified: CollectiveSnapshotFenceSqlTests.Fence_IgnoresAnotherTenantsCollectives_AndCollectivesOfOtherTypesAsync, CollectiveSnapshotFenceSqlTests.Fence_OfARowWithNoTenant_SeesOnlyCollectivesWithNoTenantAsync, CollectiveSnapshotFenceSqlTests.Fence_OfAnEmptyStore_IsQuiet_WithNoMarkAsync} |

**Cost.** Two fence reads per snapshot taken, and only for a model with collectives in a host that registers the fence.
The collective sink's update path pays nothing.

**Known related defects on the live path.** Two sink behaviors that predate the mark make a live row differ from what a
replay folds: a collective retried after the apply lock was busy is re-applied in full, so rows in batches that already
committed get it twice ([#1969](https://github.com/whizbang-lib/whizbang/issues/1969)), and a collective dead-lettered
after some batches committed is treated as complete by the fence while the live rows hold it in part
([#1970](https://github.com/whizbang-lib/whizbang/issues/1970)).

### Bootstrap

When the `PerspectiveWorker` encounters an existing stream that has processed events but has no snapshots (e.g., after enabling snapshots on an existing deployment), it performs a one-time **bootstrap**. The runner serializes the current model state into an initial snapshot, which subsequent rewinds can restore from.

### Snapshots of an evicted row

When [row retention](row-retention) evicts a perspective row (a row TTL, a row cap or a stream-group
cascade), the row's snapshots are not all discarded with it. For each perspective that folds the
model, the eviction keeps the **latest** snapshot of that stream (the one a rewind would restore: the
highest stream version) and deletes the older ones, and it deletes the perspective's cursor for the
stream. The next event on the stream then rebuilds the whole row by restoring that snapshot and
replaying the events after it. Snapshots of other perspectives on the same stream are untouched. See
[What an eviction removes](row-retention#what-an-eviction-removes).
{verified: EvictionCompanionCleanupSqlTests.Cascade_RemovesTheEvictedRowsCursors_KeepsItsLatestSnapshot_LeavesTheRestAsync, EvictionCompanionCleanupSqlTests.Eviction_KeepsTheSnapshotARewindCanPlace_NotANewerVersionlessOneAsync, EvictedRowRebuildTests.CappedPerspective_EvictedRowWithSnapshot_RestoresTheSnapshotAndReplaysTheTailAsync}

## Implementation

Whizbang ships two PostgreSQL implementations:

| Implementation | Package |
|----------------|---------|
| `DapperPerspectiveSnapshotStore` | `Whizbang.Data.Dapper.Postgres` |
| `EFCorePerspectiveSnapshotStore` | `Whizbang.Data.EFCore.Postgres` |

Both store snapshots in the `wh_perspective_snapshots` table with columns `stream_id`, `perspective_name`, `snapshot_event_id`, `snapshot_data` (JSONB), `sequence_number` (ordering), `created_at`, `snapshot_commit_sequence` (nullable commit-sequence anchor), and `collectives_through_sequence` (nullable; how far the row's collectives were complete when the snapshot was taken, see [snapshots of a row with collectives](#collectives)).

Snapshot blobs are wrapped in a versioned envelope (`SnapshotEnvelope`) stamped with the current serialization version; on read, a version mismatch is resolved per `PerspectiveSnapshotOptions.UpgradePolicy` (by default the stale snapshot is discarded and the perspective rebuilds from events).

## Tuning Guidelines

| Scenario | SnapshotEveryNEvents | MaxSnapshotsPerStream |
|----------|---------------------|-----------------------|
| Low-volume streams (< 100 events) | 50 | 3 |
| Medium-volume streams | 100 (default) | 5 (default) |
| High-volume streams (> 10k events) | 200-500 | 10 |
| Frequent late arrivals | 25-50 | 10 |

Lower `SnapshotEveryNEvents` values reduce rewind replay cost at the expense of more storage. Higher `MaxSnapshotsPerStream` values keep older restore points available for deeply out-of-order events.
