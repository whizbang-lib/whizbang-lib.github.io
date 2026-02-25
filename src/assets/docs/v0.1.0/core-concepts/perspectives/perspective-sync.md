---
title: "Perspective Synchronization"
version: 0.1.0
category: Core Concepts
order: 4
description: "Read-your-writes consistency for perspectives - wait for perspective updates before querying to ensure handlers see their own changes"
tags: perspectives, synchronization, read-your-writes, consistency, lenses, sync, awaiter, debugger-aware
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
  - src/Whizbang.Core/Lenses/ISyncAwareLensQuery.cs
---

# Perspective Synchronization

**Perspective Synchronization** enables **read-your-writes consistency** for perspectives. When a handler emits events, it can wait for perspectives to process those events before querying, ensuring the handler sees its own changes.

## The Problem

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

## Core Components

### SyncFilter - Fluent Filter Builder

Build synchronization filters with fluent AND/OR logic:

```csharp
using Whizbang.Core.Perspectives.Sync;

// Wait for all events in current scope
var options = SyncFilter.CurrentScope().Build();

// Wait for specific event types
var options = SyncFilter.ForEventTypes<OrderCreatedEvent>().Build();

// Wait for events on a specific stream
var options = SyncFilter.ForStream(orderId)
    .AndEventTypes<OrderCreatedEvent, OrderUpdatedEvent>()
    .Build();

// OR logic - wait for either event type
var options = SyncFilter.ForEventTypes<OrderCreatedEvent>()
    .OrEventTypes<OrderCancelledEvent>()
    .Build();
```

### Database-Based Sync

Perspective sync uses **database queries** to check if events have been processed. This works reliably across all deployment scenarios:

- Single instance deployments
- Multi-instance/scaled deployments
- Load-balanced environments
- Blue-green deployments

The sync inquiry is batched with regular work coordination calls via `process_work_batch`, making it efficient with no additional round-trips.

### Explicit EventId Tracking

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

#### Cross-Scope Sync with `[AwaitPerspectiveSync]`

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

The `IsFullySynced` property evaluates:
- If `ExpectedEventIds` is set: All expected IDs must be in `ProcessedEventIds`
- Otherwise: Falls back to `PendingCount == 0` (stream-wide query)

### PerspectiveSyncOptions

Configuration for synchronization:

```csharp
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

## Usage Approaches

### Approach 1: Sync-Aware Lens Queries

Wrap lens queries with synchronization:

```csharp
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

### Approach 2: Lifecycle Attribute

Declaratively wait before receptor execution:

```csharp
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

### Approach 3: Explicit Awaiter

Maximum control over synchronization:

```csharp
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

## API Response Consistency

Ensure API responses include just-created data:

```csharp
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

## Complex Filter Examples

### AND Logic

Wait for multiple conditions:

```csharp
// Stream AND specific event types
var options = SyncFilter.ForStream(orderId)
    .AndEventTypes<OrderCreatedEvent, PaymentProcessedEvent>()
    .Build();

// Current scope AND event types
var options = SyncFilter.CurrentScope()
    .AndEventTypes<OrderCreatedEvent>()
    .Build();
```

### OR Logic

Wait for any matching condition:

```csharp
// Either order created OR order cancelled
var options = SyncFilter.ForEventTypes<OrderCreatedEvent>()
    .OrEventTypes<OrderCancelledEvent>()
    .Build();
```

### Combined AND/OR

```csharp
// (OrderCreated AND PaymentProcessed) OR OrderCancelled
var options = SyncFilter.ForStream(orderId)
    .AndEventTypes<OrderCreatedEvent>()
    .And(SyncFilter.ForEventTypes<PaymentProcessedEvent>())
    .Or(SyncFilter.ForEventTypes<OrderCancelledEvent>())
    .WithTimeout(TimeSpan.FromSeconds(10));
```

---

## Debugger-Aware Timeout

By default, synchronization uses **debugger-aware timeouts**. When you hit a breakpoint:

- **Wall clock time** continues
- **Active time** pauses
- **No false timeouts** during debugging

This is controlled by `DebuggerAwareTimeout`:

```csharp
var options = SyncFilter.CurrentScope()
    .WithTimeout(TimeSpan.FromSeconds(5))
    .Build();

// options.DebuggerAwareTimeout is true by default
```

The system uses CPU time sampling to detect when execution is frozen at a breakpoint.

---

## Sync Outcomes

| Outcome | Description |
|---------|-------------|
| `Synced` | All matching events have been processed |
| `TimedOut` | Timeout reached before synchronization |
| `NoPendingEvents` | No events matched the filter |

---

## Best Practices

### Do: Use CurrentScope for Same-Request Consistency

```csharp
// Handler chain within same HTTP request - tracks all emitted events
SyncFilter.CurrentScope()
```

### Do: Use ForStream for Specific Stream Consistency

```csharp
// Wait for events on a specific stream
SyncFilter.ForStream(orderId)
```

### Don't: Over-synchronize

```csharp
// Avoid: Waiting for all events when you only need specific ones
SyncFilter.All()  // Too broad

// Better: Wait only for relevant event types
SyncFilter.ForEventTypes<OrderCreatedEvent>()
```

### Do: Set Appropriate Timeouts

```csharp
// Short timeout for real-time responses
.WithTimeout(TimeSpan.FromMilliseconds(500))

// Longer timeout for background processing
.WithTimeout(TimeSpan.FromSeconds(30))
```

---

## Industry Precedent

This pattern is well-established:

- **Kafka**: `acks=all` + consumer offset tracking
- **DynamoDB**: `ConsistentRead` option on queries
- **Cosmos DB**: `Session` and `BoundedStaleness` consistency levels
- **PostgreSQL**: `synchronous_commit` + replication lag monitoring
- **Marten**: `IDocumentSession.Query<T>().WaitForNonStaleResults()`

The key insight is tracking "what did I emit" vs "what has been processed" and bridging that gap on-demand.

---

## Related

- **Source Code**: [SyncFilter.cs](../../../code/Whizbang.Core/Perspectives/Sync/SyncFilter.cs)
- **Tests**: [SyncFilterBuilderTests.cs](../../../tests/Whizbang.Core.Tests/Perspectives/Sync/)
- **Concepts**: [Perspectives](../perspectives.md) | [Lenses](../lenses.md)
