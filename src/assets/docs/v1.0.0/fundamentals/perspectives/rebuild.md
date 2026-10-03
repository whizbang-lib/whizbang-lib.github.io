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
  - src/Whizbang.Core/Perspectives/PerspectiveRebuilder.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveTableSwapper.cs
  - src/Whizbang.Core/Perspectives/PerspectiveTableRedirect.cs
  - src/Whizbang.Data.Postgres/Perspectives/PostgresPerspectiveTableSwapper.cs
  - src/Whizbang.Core/Perspectives/System/PerspectiveStatusModel.cs
  - src/Whizbang.Core/Workers/PerspectiveMigrationWorker.cs
  - src/Whizbang.Core/Commands/System/SystemCommands.cs
  - src/Whizbang.Core/Events/System/SystemEvents.cs
testReferences:
  - tests/Whizbang.Core.Tests/Perspectives/PerspectiveRebuilderTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/PerspectiveRebuilderBlueGreenTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/BlueGreenRebuildIntegrationTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/Perspectives/PostgresPerspectiveTableSwapperTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/PerspectiveRebuilderIntegrationTests.cs
  - tests/Whizbang.Core.Tests/Commands/System/SystemCommandsTests.cs
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

## RebuildResult

```csharp{title="RebuildResult" description="RebuildResult" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "RebuildResult"] tests=["PerspectiveRebuilderTests.RebuildInPlaceAsync_WithRegisteredPerspective_ProcessesAllStreamsAsync", "PerspectiveRebuilderTests.RebuildInPlaceAsync_WithUnknownPerspective_ReturnsFailureAsync"]}
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
