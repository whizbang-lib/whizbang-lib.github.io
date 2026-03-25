---
title: Lifecycle Coordinator
version: 1.0.0
category: Core Concepts
order: 11
description: >-
  Centralized lifecycle management for event processing - guarantees each stage
  fires exactly once per event, tracks live events, and coordinates multi-path
  completion via the WhenAll pattern
tags: 'lifecycle, coordinator, tracking, PostLifecycle, WhenAll, pipeline'
codeReferences:
  - src/Whizbang.Core/Lifecycle/ILifecycleCoordinator.cs
  - src/Whizbang.Core/Lifecycle/LifecycleCoordinator.cs
  - src/Whizbang.Core/Lifecycle/ILifecycleTracking.cs
  - src/Whizbang.Core/Lifecycle/LifecycleTrackingState.cs
  - src/Whizbang.Core/Lifecycle/DebugAwareStopwatch.cs
  - src/Whizbang.Core/Lifecycle/StageRecord.cs
---

# Lifecycle Coordinator

The `ILifecycleCoordinator` is the centralized owner of all lifecycle stage transitions. It guarantees that **each stage fires exactly once per event** and that `PostLifecycle` fires only after all processing paths complete.

## Why a Coordinator?

Without centralized coordination, lifecycle stages were invoked independently by each worker. This led to:
- **Duplicate hook firings** when multiple code paths called `ProcessTagsAsync` for the same stage
- **PostLifecycle firing from 3 places** (Dispatcher, TransportConsumer, PerspectiveWorker) with no guarantee of exactly-once
- **No cross-path coordination** for `Route.Both()` events that traverse local and distributed paths simultaneously

The coordinator solves all of these by being the single source of truth for stage transitions.

---

## Pipeline Diagram

Events flow through different workers depending on their dispatch path. Each worker is a **segment** of the lifecycle, with well-defined entry and exit points. The coordinator tracks events only while they are **live in-memory** — tracking is abandoned at persistence/transport boundaries and recreated at entry points.

```
Dispatcher                    OutboxWorker              TransportConsumer         PerspectiveWorker
─────────────────────────    ─────────────────────    ─────────────────────    ─────────────────────
ENTRY: dispatch               ENTRY: load from DB      ENTRY: receive            ENTRY: load from DB
  ┌─ LocalImmediateAsync       ┌─ PreOutboxAsync        ┌─ PreInboxAsync          ┌─ PrePerspectiveAsync
  ├─ LocalImmediateInline      ├─ PreOutboxInline       ├─ PreInboxInline         ├─ PrePerspectiveInline
  ├─ PostLifecycleAsync†       ├─ PostOutboxAsync       ├─ PostInboxAsync         ├─ PostPerspectiveAsync
  └─ PostLifecycleInline†      ├─ PostOutboxInline      ├─ PostInboxInline        ├─ PostPerspectiveInline
EXIT: done / WhenAll          ├─ PostLifecycleAsync‡   ├─ PostLifecycleAsync*    ├─ PostLifecycleAsync**
                              └─ PostLifecycleInline‡   └─ PostLifecycleInline*   └─ PostLifecycleInline**
                             EXIT: transport / WhenAll  EXIT: done / WhenAll      EXIT: done / WhenAll
```

| Symbol | Meaning |
|--------|---------|
| `†` | Fires if this is the only processing path (`Route.Local`), or via WhenAll |
| `‡` | Fires if no further processing (event leaves service), or via WhenAll |
| `*` | Fires for events WITHOUT perspectives, or via WhenAll |
| `**` | Fires AFTER ALL perspectives complete, or via WhenAll |

**Key insight**: `PostLifecycle` always fires at the **end** of whichever worker is the last to act on the event. The coordinator guarantees this happens exactly once.

---

## Core Concepts

### Live Tracking

The coordinator only tracks events that are **live** — actively being processed in-memory. This prevents memory leaks and avoids tracking events across persistence boundaries.

- **Entry points**: `BeginTracking()` when an event enters a worker (dispatch, DB load, transport receive)
- **Exit points**: `AbandonTracking()` when an event leaves a worker (persisted to DB, sent to transport, processing complete)

Between entry and exit, the worker advances the event through stages using `AdvanceToAsync()`.

### Exactly-Once Stage Firing

When a worker calls `tracking.AdvanceToAsync(stage)`, the coordinator:
1. Updates the current stage on the tracking instance
2. Resolves `IReceptorInvoker` from the scoped service provider
3. Invokes all receptors registered at that stage
4. Processes all message tags (tags fire at **every** stage as lifecycle observers)
5. Fires `ImmediateAsync` after the stage completes

Because stage transitions go through a single code path, there is no way for a stage to fire twice for the same event.

### PostLifecycle Guarantee

`PostLifecycleAsync` and `PostLifecycleInline` are special — they are the **final stages** in an event's lifecycle. The coordinator guarantees they fire exactly once per event, at the end of whichever worker is the last to process it:

| Scenario | Who fires PostLifecycle |
|----------|----------------------|
| Local dispatch (`Route.Local`) | Dispatcher |
| Distributed, no perspectives | TransportConsumer |
| Distributed, with perspectives | PerspectiveWorker |
| `Route.Both()` | Whichever completes last (via WhenAll) |

---

## WhenAll Pattern

When an event goes through **multiple processing paths** (e.g., `Route.Both()`), PostLifecycle must fire only after ALL paths complete. The coordinator tracks expected completions:

```
Route.Both() example:
  ┌─ Local path: Dispatcher processes → signals "local done"
  │
Event ──┤                                                     ──→ WhenAll ──→ PostLifecycle (once)
  │
  └─ Distributed path: Outbox → Transport → Inbox → Perspectives → signals "distributed done"
```

### Usage

```csharp{title="WhenAll Pattern" description="Coordinating PostLifecycle across multiple processing paths" category="Architecture" difficulty="ADVANCED" tags=["Lifecycle", "Coordinator", "WhenAll"]}
// At cascade time — register expected completions
coordinator.ExpectCompletionsFrom(eventId,
  PostLifecycleCompletionSource.Local,
  PostLifecycleCompletionSource.Distributed);

// In Dispatcher — signal local path complete
await coordinator.SignalSegmentCompleteAsync(
  eventId, PostLifecycleCompletionSource.Local, scopedProvider, ct);
// PostLifecycle does NOT fire yet — waiting for Distributed

// Later, in PerspectiveWorker — signal distributed path complete
await coordinator.SignalSegmentCompleteAsync(
  eventId, PostLifecycleCompletionSource.Distributed, scopedProvider, ct);
// NOW PostLifecycle fires — all paths complete
```

### Completion Sources

| Source | Meaning |
|--------|---------|
| `PostLifecycleCompletionSource.Local` | Local dispatch path completed |
| `PostLifecycleCompletionSource.Distributed` | Distributed path completed (outbox → inbox → perspectives) |
| `PostLifecycleCompletionSource.Outbox` | Outbox publishing completed (event left service) |

---

## Perspective WhenAll

When an event is processed by **multiple perspectives**, `PostAllPerspectivesAsync` must fire only after ALL perspectives complete. The coordinator tracks expected perspective completions per event:

```
Event arrives → 5 perspectives registered
  ├─ PerspectiveA completes → signal "A done" (1/5)
  ├─ PerspectiveB completes → signal "B done" (2/5)
  ├─ PerspectiveC completes → signal "C done" (3/5)
  ├─ PerspectiveD completes → signal "D done" (4/5)
  └─ PerspectiveE completes → signal "E done" (5/5) → PostAllPerspectivesAsync fires
```

### Key Behaviors

- **Terminal stages always fire**: `PostAllPerspectivesAsync/Inline` and `PostLifecycleAsync/Inline` fire at the end of every event lifecycle — even when zero perspectives exist. The WhenAll gate controls **timing** (wait for all to complete), not **whether** stages fire.
- **Cross-batch tracking**: Perspectives may be processed across multiple batch cycles. The coordinator preserves tracking state between batches so the WhenAll gate fires exactly once.
- **Registry-based expectations**: At startup, `PerspectiveWorker` builds a map from `IPerspectiveRunnerRegistry` (event type → all perspective names). This ensures expectations include ALL perspectives, not just those in the current batch.
- **Debounce cleanup**: Tracking entries have a sliding inactivity window. Each stage transition and perspective signal resets the timer, preventing premature cleanup while perspectives are still processing.

### Usage

```csharp{title="Perspective WhenAll" description="Coordinating PostAllPerspectives across multiple perspectives" category="Architecture" difficulty="ADVANCED" tags=["Lifecycle", "Coordinator", "Perspectives", "WhenAll"]}
// Register expected perspectives for an event
coordinator.ExpectPerspectiveCompletions(eventId, ["PerspectiveA", "PerspectiveB", "PerspectiveC"]);

// Each perspective signals completion after processing
coordinator.SignalPerspectiveComplete(eventId, "PerspectiveA");
coordinator.SignalPerspectiveComplete(eventId, "PerspectiveB");
coordinator.SignalPerspectiveComplete(eventId, "PerspectiveC");
// Returns true on last signal — all perspectives complete

// Check gate
if (coordinator.AreAllPerspectivesComplete(eventId)) {
  // Fire PostAllPerspectives + PostLifecycle
  await tracking.AdvanceToAsync(LifecycleStage.PostAllPerspectivesAsync, sp, ct);
  await tracking.AdvanceToAsync(LifecycleStage.PostAllPerspectivesInline, sp, ct);
  await tracking.AdvanceToAsync(LifecycleStage.PostLifecycleAsync, sp, ct);
  await tracking.AdvanceToAsync(LifecycleStage.PostLifecycleInline, sp, ct);
}
```

---

## Stale Tracking Cleanup

Tracking entries that never complete (e.g., a perspective fails permanently) are cleaned up via a debounce-style inactivity threshold:

- **`LastActivityUtc`**: Set on creation, reset on every stage transition and perspective signal
- **`CleanupStaleTracking(TimeSpan)`**: Removes entries inactive longer than the threshold
- **PerspectiveWorker**: Runs cleanup every 10th batch cycle with a 5-minute inactivity threshold
- **Complete entries preserved**: Entries marked `IsComplete` are never cleaned (they'll be abandoned normally)

---

## Observability

The coordinator emits OTel metrics via `LifecycleCoordinatorMetrics` (meter: `Whizbang.LifecycleCoordinator`):

| Metric | Type | Description |
|--------|------|-------------|
| `active_tracked_events` | UpDownCounter | Events currently in lifecycle tracking |
| `pending_perspective_states` | UpDownCounter | Events awaiting perspective WhenAll |
| `pending_when_all_states` | UpDownCounter | Events awaiting segment WhenAll |
| `perspective_completions_signaled` | Counter | Individual perspective signals |
| `all_perspectives_completed` | Counter | Events where all perspectives finished |
| `expectations_not_registered` | Counter | Events with no expectations (key mismatch detector) |
| `post_all_perspectives_fired` | Counter | PostAllPerspectives executions |
| `post_lifecycle_fired` | Counter | PostLifecycle executions |
| `stage_transitions` | Counter | Stage transitions (tag: `stage`) |
| `stale_tracking_cleaned` | Counter | Stale entries cleaned by inactivity threshold |

:::new
Lifecycle coordinator metrics are automatically registered via `AddWhizbang()`.
:::

---

## API Reference

### `ILifecycleCoordinator`

```csharp{title="ILifecycleCoordinator Interface" description="Centralized lifecycle stage coordination" category="API" difficulty="INTERMEDIATE" tags=["Lifecycle", "Coordinator", "API"]}
public interface ILifecycleCoordinator {
  // Begin tracking an event at the specified entry stage
  ILifecycleTracking BeginTracking(
    Guid eventId, IMessageEnvelope envelope,
    LifecycleStage entryStage, MessageSource source,
    Guid? streamId = null, Type? perspectiveType = null);

  // Get current tracking state for runtime inspection
  ILifecycleTracking? GetTracking(Guid eventId);

  // Register expected completions for WhenAll pattern
  void ExpectCompletionsFrom(Guid eventId, params PostLifecycleCompletionSource[] sources);

  // Signal a processing path completed
  ValueTask SignalSegmentCompleteAsync(
    Guid eventId, PostLifecycleCompletionSource source,
    IServiceProvider scopedProvider, CancellationToken ct);

  // Abandon tracking at exit point
  void AbandonTracking(Guid eventId);

  // Register expected perspective completions for per-event WhenAll
  void ExpectPerspectiveCompletions(Guid eventId, IReadOnlyList<string> perspectiveNames);

  // Signal a perspective completed — returns true when all complete
  bool SignalPerspectiveComplete(Guid eventId, string perspectiveName);

  // Check if all expected perspectives have completed (true if no expectations)
  bool AreAllPerspectivesComplete(Guid eventId);

  // Remove stale tracking entries (debounce-style inactivity threshold)
  int CleanupStaleTracking(TimeSpan inactivityThreshold);
}
```

### `ILifecycleTracking`

```csharp{title="ILifecycleTracking Interface" description="Per-event tracking handle for stage advancement" category="API" difficulty="INTERMEDIATE" tags=["Lifecycle", "Tracking", "API"]}
public interface ILifecycleTracking {
  Guid EventId { get; }
  LifecycleStage CurrentStage { get; }
  bool IsComplete { get; }

  // Advance to the next stage — invokes receptors, tags, ImmediateAsync
  ValueTask AdvanceToAsync(LifecycleStage stage, IServiceProvider scopedProvider, CancellationToken ct);

  // Batch advancement for game-loop workers
  static ValueTask AdvanceBatchAsync(
    IEnumerable<ILifecycleTracking> trackings,
    LifecycleStage stage, IServiceProvider scopedProvider, CancellationToken ct);
}
```

---

## How Workers Use the Coordinator

### PerspectiveWorker (Game Loop)

```csharp{title="PerspectiveWorker Integration" description="Batch-synchronized stage advancement" category="Architecture" difficulty="ADVANCED" tags=["Lifecycle", "PerspectiveWorker", "GameLoop"]}
// ENTRY: Begin tracking for each unique event in the batch
foreach (var (eventId, (envelope, streamId)) in batchProcessedEvents) {
  coordinator.BeginTracking(eventId, envelope,
    LifecycleStage.PrePerspectiveAsync, MessageSource.Local, streamId);
}

// Advance all events through stages together (game loop)
// ... perspective processing ...

// PostLifecycle: once per event (final stage)
foreach (var (eventId, (envelope, streamId)) in batchProcessedEvents) {
  var tracking = coordinator.GetTracking(eventId)!;
  await tracking.AdvanceToAsync(LifecycleStage.PostLifecycleAsync, scopedProvider, ct);
  await tracking.AdvanceToAsync(LifecycleStage.PostLifecycleInline, scopedProvider, ct);
  coordinator.AbandonTracking(eventId);  // EXIT: processing complete
}
```

### Dispatcher (Independent)

```csharp{title="Dispatcher Integration" description="Independent lifecycle for local dispatch" category="Architecture" difficulty="INTERMEDIATE" tags=["Lifecycle", "Dispatcher", "Local"]}
// ENTRY: Begin tracking
var tracking = coordinator.BeginTracking(
  messageId, envelope, LifecycleStage.PostLifecycleAsync, MessageSource.Local);

// Fire PostLifecycle
await tracking.AdvanceToAsync(LifecycleStage.PostLifecycleAsync, scopedProvider, ct);
await tracking.AdvanceToAsync(LifecycleStage.PostLifecycleInline, scopedProvider, ct);

// EXIT: processing complete
coordinator.AbandonTracking(messageId);
```

---

## Execution Modes

The coordinator supports two execution modes, matching the natural patterns of each worker:

| Mode | Workers | Behavior |
|------|---------|----------|
| **Game Loop** | PerspectiveWorker, TransportConsumer, OutboxWorker | All events in a batch advance through stages together. Enables batch optimization. |
| **Independent** | Dispatcher | Each event has its own lifecycle. Processes immediately, no batching. |

---

## Thread Safety

The coordinator is a **singleton** registered in DI. It uses `ConcurrentDictionary` for tracking state and atomic operations for WhenAll completion signaling. Multiple workers can concurrently:

- Begin/abandon tracking for different events
- Advance different events through stages
- Signal segment completion for WhenAll

---

## Registration

The coordinator is automatically registered when calling `AddWhizbang()`:

```csharp{title="Registration" description="Automatic registration via AddWhizbang" category="Configuration" difficulty="BEGINNER" tags=["Lifecycle", "DI", "Registration"]}
services.AddWhizbang(options => {
  // ILifecycleCoordinator is registered as singleton automatically
});
```

---

## Related Topics

- [Lifecycle Stages](lifecycle-stages.md) - All 22 lifecycle stages reference
- [Lifecycle Receptors](../receptors/lifecycle-receptors.md) - `[FireAt]` attribute and `ILifecycleContext`
- [Testing: Lifecycle Synchronization](../../operations/testing/lifecycle-synchronization.md) - Test patterns with lifecycle hooks
- [Message Tags](../messages/message-tags.md) - Tags fire at every stage as lifecycle observers
