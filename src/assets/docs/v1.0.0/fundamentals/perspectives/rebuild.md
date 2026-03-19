---
title: Perspective Rebuild
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
  - src/Whizbang.Core/Perspectives/PerspectiveRebuilder.cs
  - src/Whizbang.Core/Workers/PerspectiveMigrationWorker.cs
  - src/Whizbang.Core/Commands/System/SystemCommands.cs
  - src/Whizbang.Core/Events/System/SystemEvents.cs
---

# Perspective Rebuild

When a perspective's schema changes or data becomes stale, Whizbang provides multiple **rebuild modes** to reconstruct read models from event history.

## IPerspectiveRebuilder

```csharp
public interface IPerspectiveRebuilder {
  Task<RebuildResult> RebuildBlueGreenAsync(string perspectiveName, CancellationToken ct = default);
  Task<RebuildResult> RebuildInPlaceAsync(string perspectiveName, CancellationToken ct = default);
  Task<RebuildResult> RebuildStreamsAsync(string perspectiveName, IEnumerable<Guid> streamIds, CancellationToken ct = default);
  Task<RebuildStatus?> GetRebuildStatusAsync(string perspectiveName, CancellationToken ct = default);
}
```

## Rebuild Modes

### Blue-Green

Create a new table, replay all events into it, then atomically swap with the old table. The old table is kept as a backup.

```csharp
var result = await rebuilder.RebuildBlueGreenAsync("OrderPerspective");
// App continues serving reads from old table during rebuild
// Swap is atomic — no downtime
```

**Best for**: Production deployments where zero-downtime is required.

### In-Place

Truncate the active table and replay all events directly. Faster but causes temporary data unavailability during replay.

```csharp
var result = await rebuilder.RebuildInPlaceAsync("OrderPerspective");
```

**Best for**: Development, staging, or maintenance windows.

### Selected Streams

Replay events for specific streams only. Useful for fixing individual corrupted or stale projections without rebuilding everything.

```csharp
var corruptedStreams = new[] { orderId1, orderId2 };
var result = await rebuilder.RebuildStreamsAsync("OrderPerspective", corruptedStreams);
```

**Best for**: Targeted fixes for specific aggregates.

## RebuildResult

```csharp
public record RebuildResult(
    string PerspectiveName,
    int StreamsProcessed,
    int EventsReplayed,
    TimeSpan Duration,
    bool Success,
    string? Error);
```

## System Commands

Trigger rebuilds across distributed services via messaging:

```csharp
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

// Cancel an in-progress rebuild
await dispatcher.SendAsync(new CancelPerspectiveRebuildCommand("OrderPerspective"));
```

## System Events

The rebuild system emits events for observability:

| Event | When |
|-------|------|
| `PerspectiveRebuildStarted` | Rebuild begins |
| `PerspectiveRebuildProgress` | Periodically during rebuild |
| `PerspectiveRebuildCompleted` | Rebuild finishes successfully |
| `PerspectiveRebuildFailed` | Rebuild fails |

Subscribe via standard receptors for logging, alerting, or dashboards.

## Migration-Triggered Rebuilds

When the migration system detects a **destructive schema change** (column type changed or removed), it records the perspective with status 4 (`MigratingInBackground`). The `PerspectiveMigrationWorker` background service picks this up on startup and automatically triggers a blue-green rebuild.

See [Migration Tracking](infrastructure/migrations) for details.

## PerspectiveStatusModel

A built-in read model tracks all perspective health:

```csharp
public record PerspectiveStatusModel {
  public Guid Id { get; init; }
  public string PerspectiveName { get; init; }
  public PerspectiveState State { get; init; }   // Active, Rebuilding, Failed, Stale
  public string? SchemaHash { get; init; }
  public DateTimeOffset? LastRebuildCompletedAt { get; init; }
  public TimeSpan? LastRebuildDuration { get; init; }
  public string? LastError { get; init; }
}
```

Query via Lens for operational dashboards.
