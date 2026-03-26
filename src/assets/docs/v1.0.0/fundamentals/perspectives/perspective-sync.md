---
title: Perspective Synchronization
version: 1.0.0
category: Core Concepts
order: 4
description: >-
  Read-your-writes consistency for perspectives - wait for perspective updates
  before querying to ensure handlers see their own changes
tags: >-
  perspectives, synchronization, read-your-writes, consistency, lenses, sync,
  awaiter, debugger-aware
codeReferences:
  - src/Whizbang.Core/Perspectives/Sync/SyncFilter.cs
  - src/Whizbang.Core/Perspectives/Sync/IPerspectiveSyncAwaiter.cs
  - src/Whizbang.Core/Perspectives/Sync/PerspectiveSyncAwaiter.cs
  - src/Whizbang.Core/Perspectives/Sync/PerspectiveSyncOptions.cs
  - src/Whizbang.Core/Perspectives/Sync/SyncInquiry.cs
  - src/Whizbang.Core/Perspectives/Sync/SyncInquiryResult.cs
  - src/Whizbang.Core/Perspectives/Sync/IScopedEventTracker.cs
  - src/Whizbang.Core/Perspectives/Sync/ISyncEventTracker.cs
  - src/Whizbang.Core/Perspectives/Sync/SyncEventTracker.cs
  - src/Whizbang.Core/Perspectives/Sync/ITrackedEventTypeRegistry.cs
  - src/Whizbang.Core/Perspectives/Sync/TrackedEventTypeRegistry.cs
  - src/Whizbang.Core/Perspectives/Sync/IEventCompletionAwaiter.cs
  - src/Whizbang.Core/Perspectives/Sync/EventCompletionAwaiter.cs
  - src/Whizbang.Core/Lenses/ISyncAwareLensQuery.cs
lastMaintainedCommit: '01f07906'
---

# Perspective Synchronization

**Perspective Synchronization** enables **read-your-writes consistency** for perspectives. When a handler emits events, it can wait for perspectives to process those events before querying, ensuring the handler sees its own changes.

:::updated
This is the comprehensive guide for perspective synchronization. For a quick reference covering just `SyncInquiry`, `SyncInquiryResult`, and `PerspectiveSyncAwaiter`, see [Perspective Sync (Quick Reference)](sync.md).
:::

## The Problem {#problem}

In event-sourced systems, perspective updates happen asynchronously via background workers. This creates a delay (typically 2-30 seconds) where perspectives aren't yet queryable:

```
Handler A emits OrderCreatedEvent
         │
         ▼
┌──────────────────────┐
│   Event Store        │  ◄── Event stored immediately
└──────────────────────┘
         │
         │ (2-30 second gap)
         ▼
┌──────────────────────┐
│   Perspective Worker │  ◄── Updates perspective async
└──────────────────────┘
         │
         ▼
Handler B queries OrderPerspective  ◄── May not see the order!
```

**The solution**: Wait for perspective synchronization before querying.

---

## Core Components {#core-components}

### SyncFilter - Fluent Filter Builder {#sync-filter}

Build synchronization filters with fluent AND/OR logic:

```csharp{title="SyncFilter - Fluent Filter Builder" description="Build synchronization filters with fluent AND/OR logic:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "SyncFilter", "Fluent"]}
using Whizbang.Core.Perspectives.Sync;

// Wait for all events in current scope
var options = SyncFilter.CurrentScope().Build();

// Wait for specific event types
var options = SyncFilter.ForEventTypes<OrderCreatedEvent>().Build();

// Wait for events on a specific stream (supports up to 10 event types)
var options = SyncFilter.ForStream(orderId)
    .AndEventTypes<OrderCreatedEvent, OrderUpdatedEvent, OrderShippedEvent>()
    .Build();

// OR logic - wait for either event type
var options = SyncFilter.ForEventTypes<OrderCreatedEvent>()
    .OrEventTypes<OrderCancelledEvent>()
    .Build();
```

### Database-Based Sync {#database-sync}

Perspective sync uses **database queries** to check if events have been processed. This works reliably across all deployment scenarios:

- Single instance deployments
- Multi-instance/scaled deployments
- Load-balanced environments
- Blue-green deployments

The sync inquiry is batched with regular work coordination calls via `process_work_batch`, making it efficient with no additional round-trips.

### ISyncEventTracker {#event-tracking}

The `ISyncEventTracker` interface tracks events emitted during a scope for synchronization purposes.

### Explicit EventId Tracking {#explicit-event-tracking}

When events are emitted within a scope, the `IScopedEventTracker` immediately captures their EventIds. This enables **explicit EventId tracking** for sync operations:

```
Handler emits OrderCreatedEvent
         │
         ▼
┌──────────────────────┐
│ IScopedEventTracker  │  ◄── Captures EventId immediately
│ [eventId: abc123]    │
└──────────────────────┘
         │
         ▼
┌──────────────────────┐
│   Sync Inquiry       │  ◄── Sends ExpectedEventIds=[abc123]
│   to Database        │
└──────────────────────┘
         │
         ▼
┌──────────────────────┐
│   IsFullySynced      │  ◄── Checks: Are ALL expected events
│   Evaluation         │      in ProcessedEventIds?
└──────────────────────┘
```

This prevents **false positives** when events are still in the outbox and haven't reached the perspective table yet. The sync awaiter compares explicit EventIds rather than just checking `PendingCount == 0`.

#### Cross-Scope Sync with `[AwaitPerspectiveSync]` {#cross-scope-sync}

When using `[AwaitPerspectiveSync]` attributes, the incoming event being processed was emitted in a **different scope** (the original command handler). The attribute handler automatically passes the incoming event's ID to `WaitForStreamAsync`:

```
Scope A (Command Handler):              Scope B (Receptor):
┌────────────────────────┐              ┌────────────────────────┐
│ emits OrderCreatedEvent│              │ [AwaitPerspectiveSync] │
│ EventId = abc123       │──────────────►│ handles OrderCreated   │
└────────────────────────┘              │ waits for abc123       │
                                        └────────────────────────┘
                                                   │
                                                   ▼
                                        ┌────────────────────────┐
                                        │ WaitForStreamAsync     │
                                        │ eventIdToAwait=abc123  │
                                        └────────────────────────┘
```

This ensures the receptor waits for **the specific event it's processing**, not just any events on the stream. Without this, cross-scope sync would fail because:
1. The receptor's scope tracker has no events (they were emitted elsewhere)
2. A stream-wide query would return `PendingCount = 0` (no rows in perspective table yet)
3. `IsFullySynced` would incorrectly return `true`

#### SyncInquiryResult Properties

| Property | Description |
|----------|-------------|
| `PendingCount` | Number of events pending processing |
| `ProcessedCount` | Number of events already processed |
| `ProcessedEventIds` | Array of EventIds that have been processed |
| `ExpectedEventIds` | Array of EventIds we expect to be processed |
| `IsFullySynced` | True when ALL expected events are processed |

#### IsFullySynced Property {#is-fully-synced}

The `IsFullySynced` property evaluates:
- If `ExpectedEventIds` is set: All expected IDs must be in `ProcessedEventIds`
- Otherwise: Falls back to `PendingCount == 0` (stream-wide query)

### Type Registry System {#type-registry}

The type registry system automatically discovers which event types each perspective tracks, enabling the sync system to know which perspectives need to process a given event.

#### ITrackedEventTypeRegistry

The registry interface provides a simple API to query tracked event types:

```csharp{title="ITrackedEventTypeRegistry" description="The registry interface provides a simple API to query tracked event types:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "ITrackedEventTypeRegistry"]}
public interface ITrackedEventTypeRegistry {
  /// <summary>
  /// Checks if the given event type should be tracked for sync.
  /// </summary>
  bool ShouldTrack(Type eventType);

  /// <summary>
  /// Gets the first perspective name that tracks this event type.
  /// </summary>
  string? GetPerspectiveName(Type eventType);

  /// <summary>
  /// Gets all perspective names that track this event type.
  /// </summary>
  IReadOnlyList<string> GetPerspectiveNames(Type eventType);
}
```

#### TrackedEventTypeRegistry Implementation

The default implementation supports two modes:

**Static Mode** - Uses a dictionary provided at construction:

```csharp{title="TrackedEventTypeRegistry Implementation" description="Static Mode - Uses a dictionary provided at construction:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "TrackedEventTypeRegistry", "Implementation"]}
// Explicit mappings
var mappings = new Dictionary<Type, string[]> {
  [typeof(OrderCreatedEvent)] = ["OrderPerspective", "ReportingPerspective"],
  [typeof(PaymentProcessedEvent)] = ["PaymentPerspective"]
};

var registry = new TrackedEventTypeRegistry(mappings);
```

**Dynamic Mode** - Reads from `SyncEventTypeRegistrations` (default):

```csharp{title="TrackedEventTypeRegistry Implementation (2)" description="Dynamic Mode - Reads from SyncEventTypeRegistrations (default):" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "TrackedEventTypeRegistry", "Implementation"]}
// Registered via AddWhizbang() - reads from static registrations
var registry = new TrackedEventTypeRegistry();

// Supports module initializers that register after construction
```

The dynamic mode enables source-generated code to register mappings after the registry is constructed, supporting module initializers and split compilation.

### Automatic Type Registration {#auto-registration}

The `SyncEventTypeRegistrations` class provides a static, thread-safe registry for event type mappings. Source generators populate this registry during static initialization.

#### How Auto-Registration Works

```
1. Source Generator Scans Code
   ↓
   [AwaitPerspectiveSync(typeof(OrderPerspective), EventTypes = [typeof(OrderCreatedEvent)])]
   public class NotificationHandler : IReceptor<OrderCreatedEvent> { }
   ↓
2. Generator Emits Registration Code
   ↓
   [ModuleInitializer]
   internal static void InitializeSyncEventTypeRegistry() {
     SyncEventTypeRegistrations.Register(typeof(OrderCreatedEvent), "OrderPerspective");
   }
   ↓
3. Module Initializer Runs at Startup
   ↓
4. TrackedEventTypeRegistry Reads Mappings
```

#### SyncEventTypeRegistryGenerator

The source generator (`SyncEventTypeRegistryGenerator`) discovers all `[AwaitPerspectiveSync]` attributes and generates registration code:

```csharp{title="SyncEventTypeRegistryGenerator" description="The source generator (SyncEventTypeRegistryGenerator) discovers all [AwaitPerspectiveSync] attributes and generates" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Perspectives", "SyncEventTypeRegistryGenerator"]}
// Input: Attribute on receptor
[AwaitPerspectiveSync(typeof(OrderPerspective),
    EventTypes = [typeof(OrderCreatedEvent), typeof(OrderUpdatedEvent)])]
public class Handler : IReceptor<OrderCreatedEvent> { }

// Output: Generated registration (SyncEventTypeRegistry.g.cs)
[ModuleInitializer]
internal static void InitializeSyncEventTypeRegistry() {
  SyncEventTypeRegistrations.Register(
      typeof(global::MyApp.OrderCreatedEvent),
      "MyApp.OrderPerspective");
  SyncEventTypeRegistrations.Register(
      typeof(global::MyApp.OrderUpdatedEvent),
      "MyApp.OrderPerspective");
}
```

**Key Features**:
- Fully qualified type names prevent ambiguity
- CLR format for perspective names (`Namespace.Type` or `Namespace.Parent+Nested`)
- Multiple perspectives can track the same event type
- Thread-safe concurrent registration

For more details, see the [Source Generators](../../apis/graphql/index.md) documentation.

### Event Tracker Implementation {#tracker-implementation}

`SyncEventTracker` is the singleton implementation of `ISyncEventTracker`. It provides thread-safe, cross-scope event tracking using concurrent dictionaries.

#### Architecture

The tracker maintains three tracking modes:

**1. Per-Perspective Tracking**

Events are keyed by `(EventId, PerspectiveName)` to allow the same event to be tracked for multiple perspectives:

```csharp{title="Architecture" description="Events are keyed by (EventId, PerspectiveName) to allow the same event to be tracked for multiple perspectives:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Architecture"]}
// Internal structure
ConcurrentDictionary<(Guid EventId, string PerspectiveName), TrackedSyncEvent>

// Example entries:
(abc123, "OrderPerspective")   → TrackedSyncEvent
(abc123, "ReportingPerspective") → TrackedSyncEvent
```

**2. Perspective-Specific Waiters**

Used by `IPerspectiveSyncAwaiter` to wait for a single perspective:

```csharp{title="Architecture (2)" description="Used by IPerspectiveSyncAwaiter to wait for a single perspective:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Architecture"]}
await tracker.WaitForPerspectiveEventsAsync(
    eventIds: [eventId],
    perspectiveName: "OrderPerspective",
    timeout: TimeSpan.FromSeconds(5)
);
```

**3. All-Perspectives Waiters**

Used by `IEventCompletionAwaiter` to wait for all perspectives:

```csharp{title="Architecture (3)" description="Used by IEventCompletionAwaiter to wait for all perspectives:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Architecture"]}
await tracker.WaitForAllPerspectivesAsync(
    eventIds: [eventId],
    timeout: TimeSpan.FromSeconds(30)
);
```

#### Thread-Safe Completion

The tracker uses `TaskCompletionSource<bool>` with race condition protection:

```csharp{title="Thread-Safe Completion" description="The tracker uses TaskCompletionSource<bool> with race condition protection:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Thread-Safe", "Completion"]}
// Registering a waiter
var tcs = new TaskCompletionSource<bool>(
    TaskCreationOptions.RunContinuationsAsynchronously);

var waiters = _perspectiveWaiters.GetOrAdd(
    (eventId, perspectiveName),
    _ => new ConcurrentBag<TaskCompletionSource<bool>>());

waiters.Add(tcs);

// Race condition fix: Check again after registering
if (!_trackedEvents.ContainsKey((eventId, perspectiveName))) {
  tcs.TrySetResult(true);  // Event already processed
}

await tcs.Task;
```

**Why this matters**: If `MarkProcessedByPerspective` runs between the initial check and registering the waiter, the event is already processed but the TCS wasn't signaled. The second check catches this and signals immediately, avoiding a timeout.

#### Completion Semantics

**MarkProcessedByPerspective** - Per-perspective completion:

```csharp{title="Completion Semantics" description="MarkProcessedByPerspective - Per-perspective completion:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Completion", "Semantics"]}
tracker.MarkProcessedByPerspective(
    eventIds: [eventId],
    perspectiveName: "OrderPerspective");

// Removes only (eventId, "OrderPerspective")
// Still tracked: (eventId, "ReportingPerspective")
```

**Signaling Logic**:
1. Remove `(eventId, perspectiveName)` entry
2. Signal perspective-specific waiters
3. If NO entries remain for `eventId`, signal all-perspectives waiters

### Sync Context and Accessor {#sync-context}

The `SyncContext` provides handlers with information about the perspective sync that was performed before invocation.

#### SyncContext Properties

```csharp{title="SyncContext Properties" description="SyncContext Properties" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "SyncContext", "Properties"]}
public sealed class SyncContext {
  public Guid StreamId { get; init; }
  public Type PerspectiveType { get; init; }
  public SyncOutcome Outcome { get; init; }
  public int EventsAwaited { get; init; }
  public TimeSpan ElapsedTime { get; init; }

  // Convenience properties
  public bool IsSuccess => Outcome == SyncOutcome.Synced;
  public bool IsTimedOut => Outcome == SyncOutcome.TimedOut;
  public string? FailureReason { get; init; }
}
```

#### Using SyncContext in Handlers

Inject `SyncContext` to access sync results (particularly useful with `FireAlways` behavior):

```csharp{title="Using SyncContext in Handlers" description="Inject SyncContext to access sync results (particularly useful with FireAlways behavior):" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Using", "SyncContext"]}
[AwaitPerspectiveSync(typeof(OrderPerspective),
    FireBehavior = SyncFireBehavior.FireAlways)]
public class GetOrderHandler : IReceptor<GetOrderQuery, Order?> {
  private readonly ILensQuery<Order> _orderLens;
  private readonly ILogger<GetOrderHandler> _logger;
  private readonly SyncContext? _syncContext;

  public GetOrderHandler(
      ILensQuery<Order> orderLens,
      ILogger<GetOrderHandler> logger,
      SyncContext? syncContext = null) {
    _orderLens = orderLens;
    _logger = logger;
    _syncContext = syncContext;
  }

  public async Task<Order?> HandleAsync(GetOrderQuery query, CancellationToken ct) {
    if (_syncContext?.IsTimedOut == true) {
      _logger.LogWarning(
          "Perspective sync timed out after {Elapsed}ms, returning potentially stale data",
          _syncContext.ElapsedTime.TotalMilliseconds);
      // Return potentially stale data or throw
    }

    if (_syncContext?.IsSuccess == true) {
      _logger.LogDebug(
          "Perspective synced successfully ({EventCount} events in {Elapsed}ms)",
          _syncContext.EventsAwaited,
          _syncContext.ElapsedTime.TotalMilliseconds);
    }

    return await _orderLens.GetByIdAsync(query.OrderId, ct);
  }
}
```

#### ISyncContextAccessor

The accessor provides ambient access to the current sync context:

```csharp{title="ISyncContextAccessor" description="The accessor provides ambient access to the current sync context:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "ISyncContextAccessor"]}
public interface ISyncContextAccessor {
  SyncContext? Current { get; set; }
}

public class SyncContextAccessor : ISyncContextAccessor {
  private static readonly AsyncLocal<SyncContextHolder> _syncContextCurrent = new();

  // Static accessor for singleton services
  public static SyncContext? CurrentContext { get; set; }

  // Instance accessor for scoped services
  public SyncContext? Current { get; set; }
}
```

**Usage Patterns**:

**Scoped Services** - Inject `ISyncContextAccessor`:

```csharp{title="ISyncContextAccessor - MyService" description="Scoped Services - Inject ISyncContextAccessor:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "ISyncContextAccessor"]}
public class MyService {
  private readonly ISyncContextAccessor _syncContextAccessor;

  public void DoWork() {
    var context = _syncContextAccessor.Current;
    if (context?.IsSuccess == true) {
      // Handle success
    }
  }
}
```

**Singleton Services** - Use static accessor:

```csharp{title="ISyncContextAccessor - MySingletonService" description="Singleton Services - Use static accessor:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "ISyncContextAccessor"]}
public class MySingletonService {
  public void DoWork() {
    var context = SyncContextAccessor.CurrentContext;
    if (context?.IsSuccess == true) {
      // Handle success
    }
  }
}
```

### Scoped Event Tracker Accessor {#scoped-tracker-accessor}

`ScopedEventTrackerAccessor` provides ambient access to the current scope's `IScopedEventTracker` using `AsyncLocal<T>`.

#### Why AsyncLocal?

**The Problem**: Singleton services (like `Dispatcher`) cannot inject scoped dependencies directly:

```csharp{title="Why AsyncLocal?" description="The Problem: Singleton services (like Dispatcher) cannot inject scoped dependencies directly:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Why", "AsyncLocal?"]}
// ❌ WRONG - DI error
public class Dispatcher {
  public Dispatcher(IScopedEventTracker tracker) { }  // Cannot inject scoped into singleton!
}
```

**The Solution**: Use `AsyncLocal<T>` for ambient access:

```csharp{title="Why AsyncLocal? - Dispatcher" description="The Solution: Use AsyncLocal<T> for ambient access:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Why", "AsyncLocal?"]}
// ✅ CORRECT - Ambient access via AsyncLocal
public class Dispatcher {
  public void Send(IMessage message) {
    var tracker = ScopedEventTrackerAccessor.CurrentTracker;
    if (tracker != null) {
      // Use tracker to record events
    }
  }
}
```

#### Implementation

```csharp{title="Implementation" description="Implementation" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Implementation"]}
public static class ScopedEventTrackerAccessor {
  private static readonly AsyncLocal<IScopedEventTracker?> _current = new();

  public static IScopedEventTracker? CurrentTracker {
    get => _current.Value;
    set => _current.Value = value;
  }
}
```

**Key Properties**:
- Thread-safe via `AsyncLocal<T>` (per async execution context)
- Automatically flows through async/await calls
- Cleared when scope is disposed
- Returns `null` outside of a scope

#### Automatic Lifetime Management

The tracker is automatically set when resolved from a DI scope:

```csharp{title="Automatic Lifetime Management" description="The tracker is automatically set when resolved from a DI scope:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Automatic", "Lifetime"]}
// In DI registration
services.AddScoped<IScopedEventTracker>(sp => {
  var tracker = new ScopedEventTracker();
  ScopedEventTrackerAccessor.CurrentTracker = tracker;  // Set ambient
  return tracker;
});

// Cleared on scope disposal
```

### Event Tracking Interfaces {#event-tracking}

Two interfaces provide event tracking at different scopes:

#### IScopedEventTracker - Request-Scoped Tracking

Tracks events emitted within the current request/operation scope:

```csharp{title="IScopedEventTracker - Request-Scoped Tracking" description="Tracks events emitted within the current request/operation scope:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "IScopedEventTracker", "Request-Scoped"]}
public interface IScopedEventTracker {
  // Track event emitted in this scope
  void TrackEmittedEvent(Guid streamId, Type eventType, Guid eventId);

  // Get all events emitted in this scope
  IReadOnlyList<TrackedEvent> GetEmittedEvents();

  // Get events matching a filter
  IReadOnlyList<TrackedEvent> GetEmittedEvents(SyncFilterNode filter);

  // Check if all matching events are processed
  bool AreAllProcessed(SyncFilterNode filter, IReadOnlySet<Guid> processedEventIds);
}
```

**Usage**: Query events within the same request for `SyncFilter.CurrentScope()`:

```csharp{title="IScopedEventTracker - Request-Scoped Tracking (2)" description="Usage: Query events within the same request for `SyncFilter." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "IScopedEventTracker", "Request-Scoped"]}
// Handler emits events
await _eventStore.AppendAsync(streamId, new OrderCreatedEvent());

// Later in same request
var events = _scopedTracker.GetEmittedEvents();
// Returns: [OrderCreatedEvent with its EventId]
```

#### ISyncEventTracker - Cross-Scope Tracking

Singleton service tracking events across all requests:

```csharp{title="ISyncEventTracker - Cross-Scope Tracking" description="Singleton service tracking events across all requests:" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Perspectives", "ISyncEventTracker", "Cross-Scope"]}
public interface ISyncEventTracker {
  // Track event for perspective sync (cross-scope)
  void TrackEvent(Type eventType, Guid eventId, Guid streamId, string perspectiveName);

  // Get pending events for a specific perspective
  IReadOnlyList<TrackedSyncEvent> GetPendingEvents(
      Guid streamId,
      string perspectiveName,
      Type[]? eventTypes = null);

  // Mark events as processed by specific perspective
  void MarkProcessedByPerspective(IEnumerable<Guid> eventIds, string perspectiveName);

  // Wait for specific perspective (with optional per-awaiter tracking)
  Task<bool> WaitForPerspectiveEventsAsync(
      IReadOnlyList<Guid> eventIds,
      string perspectiveName,
      TimeSpan timeout,
      Guid? awaiterId = null,
      CancellationToken ct = default);

  // Wait for ALL perspectives (with optional per-awaiter tracking)
  Task<bool> WaitForAllPerspectivesAsync(
      IReadOnlyList<Guid> eventIds,
      TimeSpan timeout,
      Guid? awaiterId = null,
      CancellationToken ct = default);

  // Wait for events to be marked as processed
  Task<bool> WaitForEventsAsync(
      IReadOnlyList<Guid> eventIds,
      TimeSpan timeout,
      Guid? awaiterId = null,
      CancellationToken ct = default);

  // Unregister a specific awaiter, cancelling its pending waits
  void UnregisterAwaiter(Guid awaiterId);
}
```

:::updated
The `awaiterId` parameter and `UnregisterAwaiter` method enable per-awaiter cleanup on cancellation. See [Awaiter Identity](#awaiter-identity).
:::

**Usage**: Cross-request synchronization and event completion:

```csharp{title="ISyncEventTracker - Cross-Scope Tracking (2)" description="Usage: Cross-request synchronization and event completion:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "ISyncEventTracker", "Cross-Scope"]}
// Request 1 emits event
_syncTracker.TrackEvent(
    typeof(OrderCreatedEvent),
    eventId,
    streamId,
    "OrderPerspective");

// Request 2 waits for processing (different scope)
await _syncTracker.WaitForPerspectiveEventsAsync(
    [eventId],
    "OrderPerspective",
    TimeSpan.FromSeconds(5));
```

#### Per-Awaiter Cleanup {#per-awaiter-cleanup}

When multiple awaiters wait on the same events and some cancel, the `awaiterId` parameter enables precise cleanup without affecting other awaiters:

```csharp{title="Per-Awaiter Cleanup" description="When multiple awaiters wait on the same events and some cancel, the awaiterId parameter enables precise cleanup without" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Per-Awaiter", "Cleanup"]}
var awaiterId = Guid.NewGuid();

// Start waiting with a tracked awaiter ID
var task = _syncTracker.WaitForPerspectiveEventsAsync(
    [eventId], "OrderPerspective", TimeSpan.FromSeconds(30), awaiterId);

// If the awaiter is cancelled (e.g., request aborted), clean up just this awaiter
_syncTracker.UnregisterAwaiter(awaiterId);
// Returns false (cancelled) without affecting other awaiters on the same events
```

Internally, waiter registrations are keyed by `awaiterId` using `ConcurrentDictionary<Guid, TaskCompletionSource<bool>>`, enabling O(1) removal on cancellation.

### Awaiter Identity {#awaiter-identity}

:::new
All awaiter classes implement `IAwaiterIdentity`, providing a unique `AwaiterId` for per-awaiter tracking and cleanup.
:::

```csharp{title="Awaiter Identity" description="Awaiter Identity" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Awaiter", "Identity"]}
public interface IAwaiterIdentity {
  Guid AwaiterId { get; }
}
```

Both `IPerspectiveSyncAwaiter` and `IEventCompletionAwaiter` extend this interface:

```csharp{title="Awaiter Identity - IPerspectiveSyncAwaiter" description="Both IPerspectiveSyncAwaiter and IEventCompletionAwaiter extend this interface:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Awaiter", "Identity"]}
public interface IPerspectiveSyncAwaiter : IAwaiterIdentity { ... }
public interface IEventCompletionAwaiter : IAwaiterIdentity { ... }
```

The `AwaiterId` is automatically generated at construction and passed to `ISyncEventTracker` wait methods. When an awaiter is cancelled or disposed, `UnregisterAwaiter(AwaiterId)` removes only that awaiter's waiter registrations — other awaiters waiting on the same events are unaffected.

This pattern applies to all awaiter classes in the library, including testing utilities like `MessageAwaiter`, `LifecycleStageAwaiter`, and `MultiHostPerspectiveAwaiter`.

### Explicit Event ID Tracking {#explicit-event-tracking}

The sync system tracks explicit EventIds to prevent false positives when events are still in the outbox.

#### The Problem

Without explicit EventId tracking:

```
Handler emits OrderCreatedEvent
         │
         ▼
Event stored in outbox (EventId = abc123)
         │
         ▼
Sync query: "Are there pending events on stream X?"
         │
         ▼
Perspective table has NO rows yet (event still in outbox)
         │
         ▼
Query returns PendingCount = 0
         │
         ▼
IsFullySynced = true  ❌ FALSE POSITIVE!
```

#### The Solution

Track EventIds explicitly and send them to the database:

```csharp{title="The Solution" description="Track EventIds explicitly and send them to the database:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Solution"]}
// 1. Capture EventId when emitted
_scopedTracker.TrackEmittedEvent(streamId, typeof(OrderCreatedEvent), eventId);

// 2. Include in sync inquiry
var inquiry = new SyncInquiry {
  StreamId = streamId,
  PerspectiveType = "OrderPerspective",
  ExpectedEventIds = [eventId]  // Explicit IDs we're waiting for
};

// 3. Database checks if EventId is in ProcessedEventIds
var result = await _processWorkBatch(inquiry);

// 4. IsFullySynced only true when EventId appears in ProcessedEventIds
return result.ProcessedEventIds.Contains(eventId);
```

#### IncludeProcessedEventIds Option

The `SyncInquiry` includes a flag to request processed EventIds:

```csharp{title="IncludeProcessedEventIds Option" description="The SyncInquiry includes a flag to request processed EventIds:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "IncludeProcessedEventIds", "Option"]}
public sealed class SyncInquiry {
  public Guid StreamId { get; init; }
  public string PerspectiveType { get; init; }
  public Type[]? EventTypes { get; init; }
  public Guid[]? ExpectedEventIds { get; init; }
  public bool IncludeProcessedEventIds { get; init; } = true;  // Request EventIds
}
```

When `IncludeProcessedEventIds = true`, the database returns:

```csharp{title="IncludeProcessedEventIds Option - SyncInquiryResult" description="When IncludeProcessedEventIds = true, the database returns:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "IncludeProcessedEventIds", "Option"]}
public sealed class SyncInquiryResult {
  public int PendingCount { get; init; }
  public int ProcessedCount { get; init; }
  public Guid[] ProcessedEventIds { get; init; }  // Actual processed EventIds
  public Guid[] ExpectedEventIds { get; init; }   // EventIds we're waiting for

  // True only when ALL expected IDs are in ProcessedEventIds
  public bool IsFullySynced =>
      ExpectedEventIds?.Length > 0
          ? ExpectedEventIds.All(id => ProcessedEventIds.Contains(id))
          : PendingCount == 0;  // Fallback to count-based check
}
```

### Cross-Scope Synchronization {#cross-scope-sync}

Cross-scope sync enables one handler to wait for events emitted by another handler in a different scope.

#### The Challenge

When using `[AwaitPerspectiveSync]` attributes, the incoming event was emitted in a **different scope**:

```
Scope A (Command Handler):              Scope B (Event Receptor):
┌────────────────────────┐              ┌────────────────────────┐
│ Handles CreateOrder    │              │ [AwaitPerspectiveSync] │
│ Emits OrderCreated     │              │ Handles OrderCreated   │
│ EventId = abc123       │──────────────►│ Wants to wait for sync │
│ _scopedTracker: [abc] │              │ _scopedTracker: []     │
└────────────────────────┘              └────────────────────────┘
                                                   │
                                                   ▼
                                        ❌ No events in scope!
                                        ❌ Cannot use CurrentScope filter
```

#### The Solution: DiscoverPendingFromOutbox

The attribute handler automatically discovers pending events from the database outbox:

```csharp{title="The Solution: DiscoverPendingFromOutbox" description="The attribute handler automatically discovers pending events from the database outbox:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Solution:", "DiscoverPendingFromOutbox"]}
// Attribute handler logic (simplified)
var incomingEventId = message.GetEventId();  // abc123 from the event being processed

// Option 1: If EventTypes specified, query outbox
if (attribute.EventTypes?.Length > 0) {
  var pendingEventIds = await _discoverPendingFromOutbox(
      streamId,
      attribute.PerspectiveType,
      attribute.EventTypes);

  // Returns: [abc123] from outbox query
}

// Option 2: If no EventTypes, use the incoming event's ID
var eventIdsToAwait = pendingEventIds?.Any() == true
    ? pendingEventIds
    : [incomingEventId];

// Now wait for these specific EventIds
await _perspectiveSyncAwaiter.WaitForStreamAsync(
    streamId,
    typeof(OrderPerspective),
    eventIdsToAwait);
```

**DiscoverPendingFromOutbox** queries the database for events that:
1. Match the stream ID
2. Match the event types (if specified)
3. Are in the outbox (not yet processed by the perspective)

This enables cross-scope sync even though the events weren't emitted in the current scope.

### AwaitPerspectiveSyncAttribute API {#await-attribute-api}

The `[AwaitPerspectiveSync]` attribute configures perspective synchronization on a receptor class. It can be applied multiple times to wait for multiple perspectives.

```csharp{title="AwaitPerspectiveSyncAttribute API" description="Attribute properties for configuring perspective sync" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "AwaitPerspectiveSyncAttribute", "API"]}
[AttributeUsage(AttributeTargets.Class, AllowMultiple = true)]
public sealed class AwaitPerspectiveSyncAttribute(Type perspectiveType) : Attribute {
    public static int DefaultTimeoutMs { get; set; } = 5000;

    public Type PerspectiveType { get; }
    public Type[]? EventTypes { get; init; }
    public int TimeoutMs { get; init; } = -1;
    public int EffectiveTimeoutMs { get; }
    public SyncFireBehavior FireBehavior { get; init; } = SyncFireBehavior.FireOnSuccess;
}
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `PerspectiveType` | `Type` | (required) | The perspective type to wait for |
| `EventTypes` | `Type[]?` | `null` | Event types to wait for. If null/empty, waits for ALL pending events on the stream. |
| `TimeoutMs` | `int` | `-1` | Timeout in ms for this sync operation. `-1` uses `DefaultTimeoutMs`. |
| `EffectiveTimeoutMs` | `int` | (computed) | Returns `TimeoutMs` if explicitly set, otherwise `DefaultTimeoutMs`. |
| `FireBehavior` | `SyncFireBehavior` | `FireOnSuccess` | Controls handler invocation behavior on sync completion or timeout. |
| `DefaultTimeoutMs` (static) | `int` | `5000` | Global default timeout. Individual attributes can override via `TimeoutMs`. |

### Fire Behavior Control {#fire-behavior}

`SyncFireBehavior` controls what happens after perspective sync completes (or times out).

#### Behavior Options

```csharp{title="Behavior Options" description="Behavior Options" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Behavior", "Options"]}
public enum SyncFireBehavior {
  /// <summary>
  /// Only invoke handler if sync completes successfully. Throw on timeout.
  /// </summary>
  FireOnSuccess = 0,  // Default

  /// <summary>
  /// Invoke handler regardless of sync outcome. Use SyncContext for status.
  /// </summary>
  FireAlways = 1,

  /// <summary>
  /// Invoke handler on each event completion (streaming mode - future).
  /// </summary>
  FireOnEachEvent = 2  // Reserved
}
```

#### FireOnSuccess (Default)

Handler only executes if sync completes:

```csharp{title="FireOnSuccess (Default)" description="Handler only executes if sync completes:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "FireOnSuccess", "Default"]}
[AwaitPerspectiveSync(typeof(OrderPerspective))]  // Default: FireOnSuccess
public class Handler : IReceptor<OrderCreatedEvent> {
  public async ValueTask HandleAsync(OrderCreatedEvent evt, CancellationToken ct) {
    // Only reached if perspective sync succeeded
    // Perspective is guaranteed up-to-date
    var order = await _orderLens.GetByIdAsync(evt.OrderId, ct);
  }
}
```

**Timeout Behavior**: Throws `PerspectiveSyncTimeoutException`

#### FireAlways

Handler always executes, inject `SyncContext` to check outcome:

```csharp{title="FireAlways" description="Handler always executes, inject SyncContext to check outcome:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "FireAlways"]}
[AwaitPerspectiveSync(typeof(OrderPerspective),
    FireBehavior = SyncFireBehavior.FireAlways)]
public class Handler : IReceptor<GetOrderQuery, Order?> {
  private readonly SyncContext? _syncContext;

  public async Task<Order?> HandleAsync(GetOrderQuery query, CancellationToken ct) {
    if (_syncContext?.IsTimedOut == true) {
      // Sync timed out - return stale data or handle gracefully
      _logger.LogWarning("Perspective sync timed out, returning stale data");
    }

    return await _orderLens.GetByIdAsync(query.OrderId, ct);
  }
}
```

**Use Cases**:
- Query handlers that can tolerate stale data
- Scenarios where partial results are acceptable
- Handlers that need custom timeout handling

### Dispatcher Integration {#dispatcher-integration}

The `Dispatcher` integrates with perspective sync through the `_awaitPerspectiveSyncIfNeededAsync` method, which is called before invoking receptors locally.

:::info Events Only
**Important**: Perspective sync only applies to `IEvent` messages. If a receptor has `[AwaitPerspectiveSync]` but handles a command (`ICommand`) or plain `IMessage`, the sync is **skipped** because perspectives only process events. This prevents timeouts when dispatching commands that happen to have sync attributes on their receptors.
:::

#### Integration Points

The method is called from all local invocation paths:

```csharp{title="Integration Points" description="The method is called from all local invocation paths:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Integration", "Points"]}
// LocalInvokeAsync with return value
public async ValueTask<TResult> LocalInvokeAsync<TMessage, TResult>(TMessage message) {
  var invoker = GetReceptorInvoker<TResult>(message, messageType);

  // Check for [AwaitPerspectiveSync] and wait if needed
  await _awaitPerspectiveSyncIfNeededAsync(message, messageType);

  var result = await invoker(message);
  return result;
}

// LocalInvokeAsync with DispatchOptions
public async ValueTask<TResult> LocalInvokeAsync<TMessage, TResult>(
    TMessage message,
    DispatchOptions options) {
  var invoker = GetReceptorInvoker<TResult>(message, messageType);

  // Check for [AwaitPerspectiveSync] and wait if needed
  await _awaitPerspectiveSyncIfNeededAsync(message, messageType, options.CancellationToken);

  var result = await invoker(message);

  // Also wait for all perspectives if requested
  await _waitForPerspectivesIfNeededAsync(options);

  return result;
}

// Void LocalInvokeAsync
public async ValueTask LocalInvokeAsync<TMessage>(TMessage message) {
  var invoker = GetVoidReceptorInvoker(message, messageType);

  await _awaitPerspectiveSyncIfNeededAsync(message, messageType);

  await invoker(message);
}
```

#### Implementation Logic

```csharp{title="Implementation Logic" description="Implementation Logic" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Perspectives", "Implementation", "Logic"]}
private async ValueTask _awaitPerspectiveSyncIfNeededAsync(
    object message,
    Type messageType,
    CancellationToken ct = default) {

  // Short-circuit if no receptor registry
  if (_receptorRegistry is null) {
    return;
  }

  // Get receptors for LocalImmediateInline stage
  var receptors = _receptorRegistry.GetReceptorsFor(
      messageType,
      LifecycleStage.LocalImmediateInline);

  // Find first receptor with [AwaitPerspectiveSync] attributes
  var syncReceptor = receptors.FirstOrDefault(r => r.SyncAttributes is { Count: > 0 });
  if (syncReceptor?.SyncAttributes is null) {
    return;
  }

  // Process each sync attribute
  foreach (var attr in syncReceptor.SyncAttributes) {
    var perspectiveType = attr.PerspectiveType;
    var streamId = _streamIdExtractor?.ExtractStreamId(message, messageType);

    if (streamId == null) {
      continue;
    }

    // Determine EventIds to await (from scope or from incoming event)
    var eventIdsToAwait = await _determineEventIdsToAwaitAsync(
        message,
        streamId.Value,
        perspectiveType,
        attr.EventTypes);

    // Wait for perspective sync
    var result = await _perspectiveSyncAwaiter.WaitAsync(
        perspectiveType,
        SyncFilter.ForStream(streamId.Value)
            .AndEventTypes(attr.EventTypes)
            .WithTimeout(attr.Timeout)
            .Build(),
        ct);

    // Handle result based on FireBehavior
    if (result.Outcome == SyncOutcome.TimedOut &&
        attr.FireBehavior == SyncFireBehavior.FireOnSuccess) {
      throw new PerspectiveSyncTimeoutException(...);
    }

    // Store sync context for handler injection
    if (_syncContextAccessor != null) {
      _syncContextAccessor.Current = new SyncContext {
        StreamId = streamId.Value,
        PerspectiveType = perspectiveType,
        Outcome = result.Outcome,
        EventsAwaited = result.EventsAwaited,
        ElapsedTime = result.ElapsedTime
      };
    }
  }
}
```

**Key Features**:
- Zero overhead when no `[AwaitPerspectiveSync]` attributes present
- Supports multiple sync attributes on same receptor
- Automatic EventId discovery for cross-scope scenarios
- SyncContext population for handler injection
- Respects FireBehavior for timeout handling

### PerspectiveSyncOptions {#options}

Configuration for synchronization:

```csharp{title="PerspectiveSyncOptions" description="Configuration for synchronization:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "PerspectiveSyncOptions", "Options"]}
public sealed class PerspectiveSyncOptions {
    // Filter tree (supports AND/OR combinations)
    public SyncFilterNode Filter { get; init; }

    // Timeout configuration
    public TimeSpan Timeout { get; init; } = TimeSpan.FromSeconds(5);

    // Debugger-aware timeout (prevents false timeouts when breakpointed)
    public bool DebuggerAwareTimeout { get; init; } = true;
}
```

---

## Perspective-Based vs Event-Based Waiting {#comparison}

Whizbang provides two distinct waiting semantics for different use cases:

| Approach | Service | Waits For | Use Case |
|----------|---------|-----------|----------|
| **Perspective-Based** | `IPerspectiveSyncAwaiter` | One specific perspective | Query consistency - ensure a handler sees its own changes |
| **Event-Based** | `IEventCompletionAwaiter` | All perspectives | RPC completion - ensure all processing complete before response |

### When to Use Each

**Perspective-Based (`IPerspectiveSyncAwaiter`):**
- You need to query a specific perspective after emitting events
- You want read-your-writes consistency for one perspective only
- Using `[AwaitPerspectiveSync]` attribute on receptors

```csharp{title="When to Use Each" description="Perspective-Based (IPerspectiveSyncAwaiter): - You need to query a specific perspective after emitting events - You" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "When", "Each"]}
// Wait for OrderPerspective to catch up, then query
await _syncAwaiter.WaitAsync(typeof(OrderPerspective),
    SyncFilter.CurrentScope().Build(), ct);
var order = await _orderLens.GetByIdAsync(orderId, ct);
```

**Event-Based (`IEventCompletionAwaiter`):**
- Making RPC calls via `LocalInvokeAsync`
- Need guarantee ALL perspectives have processed before responding
- Caller needs complete side-effect confirmation

```csharp{title="When to Use Each (2)" description="Event-Based (IEventCompletionAwaiter): - Making RPC calls via LocalInvokeAsync - Need guarantee ALL perspectives have" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "When", "Each"]}
// Wait for ALL perspectives before returning RPC response
var options = new DispatchOptions().WithPerspectiveWait();
await _dispatcher.LocalInvokeAsync(command, options, ct);
```

For details on event-based waiting, see [Event Completion Awaiter](event-completion.md).

---

## Usage Approaches {#usage}

### Approach 1: Sync-Aware Lens Queries {#sync-aware-lens}

Wrap lens queries with synchronization:

```csharp{title="Approach 1: Sync-Aware Lens Queries" description="Wrap lens queries with synchronization:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Approach", "Sync-Aware"]}
using Whizbang.Core.Lenses;
using Whizbang.Core.Perspectives.Sync;

public class OrderHandler : IReceptor<OrderCreatedEvent> {
    private readonly ILensQuery<Order> _orderLens;
    private readonly IPerspectiveSyncAwaiter _syncAwaiter;

    public async ValueTask HandleAsync(OrderCreatedEvent evt, CancellationToken ct) {
        // Option 1: Fluent wrapper with generic type parameters (recommended)
        var syncQuery = _orderLens.WithSync<Order, OrderPerspective>(
            _syncAwaiter,
            SyncFilter.CurrentScope().Build());

        var order = await syncQuery.GetByIdAsync(evt.OrderId, ct);

        // Option 2: Direct extension method with generic type parameters
        var order = await _orderLens.GetByIdAsync<Order, OrderPerspective>(
            evt.OrderId,
            _syncAwaiter,
            SyncFilter.CurrentScope().Build(),
            ct);

        // Option 3: Using Type parameter (for dynamic scenarios)
        var order = await _orderLens.GetByIdAsync(
            evt.OrderId,
            _syncAwaiter,
            typeof(OrderPerspective),
            SyncFilter.CurrentScope().Build(),
            ct);
    }
}
```

### Approach 2: Lifecycle Attribute {#attribute}

Declaratively wait before receptor execution:

```csharp{title="Approach 2: Lifecycle Attribute" description="Declaratively wait before receptor execution:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Approach", "Lifecycle"]}
using Whizbang.Core.Messaging;
using Whizbang.Core.Perspectives.Sync;

// Wait for specific event types
[FireAt(LifecycleStage.PostDistributeInline)]
[AwaitPerspectiveSync(typeof(OrderPerspective),
    EventTypes = [typeof(OrderCreatedEvent)])]
public class NotificationHandler : IReceptor<OrderCreatedEvent> {
    private readonly ILensQuery<Order> _orderLens;

    public async ValueTask HandleAsync(OrderCreatedEvent evt, CancellationToken ct) {
        // Perspective is guaranteed caught up due to attribute
        var order = await _orderLens.GetByIdAsync(evt.OrderId, ct);
        await _notifications.SendOrderConfirmation(order.Data);
    }
}

// Wait for ALL events the perspective handles (auto-discovered)
[FireAt(LifecycleStage.PostDistributeInline)]
[AwaitPerspectiveSync(typeof(OrderPerspective))]
public class FullSyncHandler : IReceptor<OrderCreatedEvent> {
    // Handler code
}
```

### Approach 3: Explicit Awaiter {#explicit-awaiter}

Maximum control over synchronization:

```csharp{title="Approach 3: Explicit Awaiter" description="Maximum control over synchronization:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Approach", "Explicit"]}
using Whizbang.Core.Perspectives.Sync;

public class ReconciliationHandler : IReceptor<ReconcileOrdersCommand> {
    private readonly IPerspectiveSyncAwaiter _syncAwaiter;
    private readonly ILensQuery<Order> _orderLens;

    public async ValueTask HandleAsync(ReconcileOrdersCommand cmd, CancellationToken ct) {
        var result = await _syncAwaiter.WaitAsync(
            typeof(OrderPerspective),
            SyncFilter.ForStream(cmd.OrderId)
                .AndEventTypes<OrderCreatedEvent>()
                .WithTimeout(TimeSpan.FromSeconds(10)),
            ct);

        switch (result.Outcome) {
            case SyncOutcome.Synced:
                _logger.LogInformation("Synced {Count} events in {Elapsed}ms",
                    result.EventsAwaited, result.ElapsedTime.TotalMilliseconds);
                break;
            case SyncOutcome.TimedOut:
                _logger.LogWarning("Sync timed out, proceeding with eventual consistency");
                break;
            case SyncOutcome.NoPendingEvents:
                _logger.LogDebug("No pending events matched filter");
                break;
        }

        var order = await _orderLens.GetByIdAsync(cmd.OrderId, ct);
    }
}
```

---

## API Response Consistency {#api-response}

Ensure API responses include just-created data:

```csharp{title="API Response Consistency" description="Ensure API responses include just-created data:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "API", "Response"]}
[HttpPost]
public async Task<IActionResult> CreateOrder(CreateOrderRequest request) {
    var orderId = await _dispatcher.SendAsync(new CreateOrderCommand {
        CustomerId = request.CustomerId,
        Items = request.Items
    });

    // Wait for all events emitted in this request (using generic type parameters)
    var order = await _orderLens.GetByIdAsync<Order, OrderPerspective>(
        orderId,
        _syncAwaiter,
        SyncFilter.CurrentScope().Build(),
        cancellationToken);

    return Ok(order);
}
```

---

## Complex Filter Examples {#filters}

### AND Logic

Wait for multiple conditions:

```csharp{title="AND Logic" description="Wait for multiple conditions:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Logic"]}
// Stream AND specific event types (supports up to 10 types)
var options = SyncFilter.ForStream(orderId)
    .AndEventTypes<OrderCreatedEvent, PaymentProcessedEvent, ShippingStartedEvent>()
    .Build();

// Current scope AND event types
var options = SyncFilter.CurrentScope()
    .AndEventTypes<OrderCreatedEvent>()
    .Build();
```

### OR Logic

Wait for any matching condition:

```csharp{title="OR Logic" description="Wait for any matching condition:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Logic"]}
// Either order created OR order cancelled
var options = SyncFilter.ForEventTypes<OrderCreatedEvent>()
    .OrEventTypes<OrderCancelledEvent>()
    .Build();
```

### Combined AND/OR

```csharp{title="Combined AND/OR" description="Combined AND/OR" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Combined"]}
// (OrderCreated AND PaymentProcessed) OR OrderCancelled
var options = SyncFilter.ForStream(orderId)
    .AndEventTypes<OrderCreatedEvent>()
    .And(SyncFilter.ForEventTypes<PaymentProcessedEvent>())
    .Or(SyncFilter.ForEventTypes<OrderCancelledEvent>())
    .WithTimeout(TimeSpan.FromSeconds(10));
```

---

## Debugger-Aware Timeout {#debugger-aware}

By default, synchronization uses **debugger-aware timeouts**. When you hit a breakpoint:

- **Wall clock time** continues
- **Active time** pauses
- **No false timeouts** during debugging

This is controlled by `DebuggerAwareTimeout`:

```csharp{title="Debugger-Aware Timeout" description="This is controlled by DebuggerAwareTimeout:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Debugger-Aware", "Timeout"]}
var options = SyncFilter.CurrentScope()
    .WithTimeout(TimeSpan.FromSeconds(5))
    .Build();

// options.DebuggerAwareTimeout is true by default
```

The system uses CPU time sampling to detect when execution is frozen at a breakpoint.

---

## Sync Outcomes {#outcomes}

| Outcome | Description |
|---------|-------------|
| `Synced` | All matching events have been processed |
| `TimedOut` | Timeout reached before synchronization |
| `NoPendingEvents` | No events matched the filter |

---

## Best Practices {#best-practices}

### Do: Use CurrentScope for Same-Request Consistency

```csharp{title="Do: Use CurrentScope for Same-Request Consistency" description="Do: Use CurrentScope for Same-Request Consistency" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Do:", "CurrentScope"]}
// Handler chain within same HTTP request - tracks all emitted events
SyncFilter.CurrentScope()
```

### Do: Use ForStream for Specific Stream Consistency

```csharp{title="Do: Use ForStream for Specific Stream Consistency" description="Do: Use ForStream for Specific Stream Consistency" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Do:", "ForStream"]}
// Wait for events on a specific stream
SyncFilter.ForStream(orderId)
```

### Don't: Over-synchronize

```csharp{title="Don't: Over-synchronize" description="Don't: Over-synchronize" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Don't:", "Over-synchronize"]}
// Avoid: Waiting for all events when you only need specific ones
SyncFilter.All()  // Too broad

// Better: Wait only for relevant event types
SyncFilter.ForEventTypes<OrderCreatedEvent>()
```

### Do: Set Appropriate Timeouts

```csharp{title="Do: Set Appropriate Timeouts" description="Do: Set Appropriate Timeouts" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Do:", "Set"]}
// Short timeout for real-time responses
.WithTimeout(TimeSpan.FromMilliseconds(500))

// Longer timeout for background processing
.WithTimeout(TimeSpan.FromSeconds(30))
```

---

## Industry Precedent {#industry-precedent}

This pattern is well-established:

- **Kafka**: `acks=all` + consumer offset tracking
- **DynamoDB**: `ConsistentRead` option on queries
- **Cosmos DB**: `Session` and `BoundedStaleness` consistency levels
- **PostgreSQL**: `synchronous_commit` + replication lag monitoring
- **Marten**: `IDocumentSession.Query<T>().WaitForNonStaleResults()`

The key insight is tracking "what did I emit" vs "what has been processed" and bridging that gap on-demand.

---

## Related

- **[Event Completion Awaiter](event-completion.md)** - Wait for ALL perspectives (RPC completion)
- **Source Code**: [SyncFilter.cs](../../../code/Whizbang.Core/Perspectives/Sync/SyncFilter.cs)
- **Tests**: [SyncFilterBuilderTests.cs](../../../tests/Whizbang.Core.Tests/Perspectives/Sync/)
- **Concepts**: [Perspectives](perspectives.md) | [Lenses](../lenses/lenses.md)
