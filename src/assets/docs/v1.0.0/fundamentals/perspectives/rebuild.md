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
testReferences:
  - tests/Whizbang.Core.Tests/Perspectives/PerspectiveRebuilderTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/RebuildProvenanceTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/PerspectiveRowDigestIntegrationTests.cs
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
