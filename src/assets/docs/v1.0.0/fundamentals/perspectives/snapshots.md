---
title: Perspective Snapshots
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
  - src/Whizbang.Data.Dapper.Postgres/DapperPerspectiveSnapshotStore.cs
---

# Perspective Snapshots

When a **late-arriving event** lands before the perspective's current cursor position, Whizbang must **rewind** the perspective and replay events from an earlier point. Without snapshots, this means replaying from event zero -- expensive for streams with thousands of events. The snapshot store captures model state at regular intervals so rewinds restore from the nearest snapshot instead.

## IPerspectiveSnapshotStore

```csharp{title="IPerspectiveSnapshotStore" description="Core interface for storing and retrieving perspective snapshots" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "IPerspectiveSnapshotStore"]}
public interface IPerspectiveSnapshotStore {
  Task CreateSnapshotAsync(Guid streamId, string perspectiveName, Guid snapshotEventId,
    JsonDocument snapshotData, CancellationToken ct = default);

  Task<(Guid SnapshotEventId, JsonDocument SnapshotData)?> GetLatestSnapshotAsync(
    Guid streamId, string perspectiveName, CancellationToken ct = default);

  Task<(Guid SnapshotEventId, JsonDocument SnapshotData)?> GetLatestSnapshotBeforeAsync(
    Guid streamId, string perspectiveName, Guid beforeEventId, CancellationToken ct = default);

  Task<bool> HasAnySnapshotAsync(Guid streamId, string perspectiveName,
    CancellationToken ct = default);

  Task PruneOldSnapshotsAsync(Guid streamId, string perspectiveName, int keepCount,
    CancellationToken ct = default);

  Task DeleteAllSnapshotsAsync(Guid streamId, string perspectiveName,
    CancellationToken ct = default);
}
```

## How Snapshots Work

The snapshot/rewind pattern follows this lifecycle:

1. **Normal processing**: Events arrive in order. After every N events (configurable), the perspective runner serializes the current model state and calls `CreateSnapshotAsync`.
2. **Late-arriving event detected**: The `PerspectiveWorker` sees `RewindRequired` status on a work item and identifies the `RewindTriggerEventId`.
3. **Restore from snapshot**: The runner calls `GetLatestSnapshotBeforeAsync` with the late event's ID to find the nearest safe restore point.
4. **Replay**: Events are replayed from the snapshot's position through the current cursor, including the late-arriving event in its correct chronological position.
5. **Pruning**: Old snapshots beyond the retention limit are pruned to control storage.

## Methods

### CreateSnapshotAsync

Persists a snapshot of the perspective model state at a specific event position. The snapshot data is stored as serialized JSON. If a snapshot already exists for the same `(streamId, perspectiveName, snapshotEventId)` triple, it is replaced (upsert semantics).

```csharp{title="CreateSnapshotAsync" description="Create a snapshot after processing events" category="Usage" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Snapshots", "Create"]}
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

```csharp{title="GetLatestSnapshotAsync" description="Retrieve the latest snapshot for a stream" category="Usage" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Snapshots", "Query"]}
var snapshot = await snapshotStore.GetLatestSnapshotAsync(orderId, "OrderPerspective");
if (snapshot.HasValue) {
    var (eventId, data) = snapshot.Value;
    var model = data.Deserialize<OrderModel>();
    // Resume processing from eventId forward
}
```

### GetLatestSnapshotBeforeAsync

Finds the latest snapshot taken **before** a specified event ID. This is the key method for the rewind pattern -- it locates the safe restore point before the late-arriving event. Uses UUID7 comparison to determine temporal ordering.

```csharp{title="GetLatestSnapshotBeforeAsync" description="Find the nearest snapshot before a late-arriving event" category="Usage" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Snapshots", "Rewind"]}
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

```csharp{title="HasAnySnapshotAsync" description="Check if snapshots exist for bootstrap detection" category="Usage" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Snapshots", "Bootstrap"]}
var hasSnapshots = await snapshotStore.HasAnySnapshotAsync(orderId, "OrderPerspective");
if (!hasSnapshots) {
    // First time -- bootstrap a snapshot from current state
    await runner.BootstrapSnapshotAsync(orderId, "OrderPerspective", lastProcessedEventId);
}
```

### PruneOldSnapshotsAsync

Deletes old snapshots, keeping only the most recent N per stream/perspective. Called after each new snapshot creation to bound storage growth.

```csharp{title="PruneOldSnapshotsAsync" description="Prune old snapshots to control storage" category="Usage" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Snapshots", "Pruning"]}
// Keep the 5 most recent snapshots, delete the rest
await snapshotStore.PruneOldSnapshotsAsync(orderId, "OrderPerspective", keepCount: 5);
```

### DeleteAllSnapshotsAsync

Removes all snapshots for a stream/perspective pair. Used during **perspective rebuild** to invalidate stale snapshots that no longer match the rebuilt model state.

```csharp{title="DeleteAllSnapshotsAsync" description="Delete all snapshots during a perspective rebuild" category="Usage" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Snapshots", "Rebuild"]}
// During perspective rebuild, invalidate all existing snapshots
await snapshotStore.DeleteAllSnapshotsAsync(orderId, "OrderPerspective");
```

## PerspectiveSnapshotOptions

```csharp{title="PerspectiveSnapshotOptions" description="Configuration for snapshot frequency and retention" category="Configuration" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Snapshots", "Configuration"]}
public class PerspectiveSnapshotOptions {
  // Create a snapshot every N events processed (default: 100)
  public int SnapshotEveryNEvents { get; set; } = 100;

  // Maximum snapshots to keep per (stream, perspective) pair (default: 5)
  public int MaxSnapshotsPerStream { get; set; } = 5;

  // Whether snapshot creation is enabled (default: true)
  // When disabled, rewinds always replay from event zero
  public bool Enabled { get; set; } = true;
}
```

Configure via dependency injection:

```csharp{title="Configure Snapshot Options" description="Register snapshot options in DI" category="Configuration" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Snapshots", "DI"]}
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

### Bootstrap

When the `PerspectiveWorker` encounters an existing stream that has processed events but has no snapshots (e.g., after enabling snapshots on an existing deployment), it performs a one-time **bootstrap**. The runner serializes the current model state into an initial snapshot, which subsequent rewinds can restore from.

## Implementation

Whizbang ships a Dapper/Npgsql implementation:

| Implementation | Package |
|----------------|---------|
| `DapperPerspectiveSnapshotStore` | `Whizbang.Data.Dapper.Postgres` |

The implementation stores snapshots in the `wh_perspective_snapshots` table with columns for `stream_id`, `perspective_name`, `snapshot_event_id`, `snapshot_data` (JSONB), and `sequence_number` for ordering.

## Tuning Guidelines

| Scenario | SnapshotEveryNEvents | MaxSnapshotsPerStream |
|----------|---------------------|-----------------------|
| Low-volume streams (< 100 events) | 50 | 3 |
| Medium-volume streams | 100 (default) | 5 (default) |
| High-volume streams (> 10k events) | 200-500 | 10 |
| Frequent late arrivals | 25-50 | 10 |

Lower `SnapshotEveryNEvents` values reduce rewind replay cost at the expense of more storage. Higher `MaxSnapshotsPerStream` values keep older restore points available for deeply out-of-order events.
