---
title: Event Completion Awaiter
version: 1.0.0
category: Core Concepts
order: 5
description: >-
  Wait for events to be fully processed by ALL perspectives before returning
  from RPC calls - ensures complete processing before response
tags: >-
  perspectives, synchronization, event-completion, rpc, waiting, local-invoke,
  dispatch-options, all-perspectives
codeReferences:
  - src/Whizbang.Core/Perspectives/Sync/IEventCompletionAwaiter.cs
  - src/Whizbang.Core/Perspectives/Sync/EventCompletionAwaiter.cs
  - src/Whizbang.Core/Perspectives/Sync/ISyncEventTracker.cs
  - src/Whizbang.Core/Perspectives/Sync/SyncEventTracker.cs
  - src/Whizbang.Core/Dispatch/DispatchOptions.cs
---

# Event Completion Awaiter

**Event Completion Awaiter** enables waiting for events to be fully processed by **ALL perspectives** before returning. This is essential for RPC-style calls where you need to ensure complete processing before responding to the caller.

## The Problem

When using `LocalInvokeAsync` for RPC-style dispatching, the response returns immediately after cascade completes. However, perspectives may still be processing the cascaded events:

```
LocalInvokeAsync(CreateOrderCommand)
         │
         ▼
┌──────────────────────┐
│   Handler executes   │  ◄── Emits OrderCreatedEvent
│   Returns OrderId    │
└──────────────────────┘
         │
         ▼
┌──────────────────────┐
│   Cascade completes  │  ◄── Event sent to perspective worker
└──────────────────────┘
         │
         ▼
   Response returned!   ◄── But perspective hasn't processed yet!
         │
         │ (gap - perspectives still processing)
         ▼
┌──────────────────────┐
│ Perspective Worker   │  ◄── Processes OrderCreatedEvent async
│ OrderPerspective     │
│ ReportingPerspective │
└──────────────────────┘
```

**The solution**: Use `IEventCompletionAwaiter` or `DispatchOptions.WithPerspectiveWait()` to wait for all perspectives to finish.

---

## Event-Based vs Perspective-Based Waiting

Whizbang provides two distinct waiting semantics:

| Approach | Waits For | Use Case |
|----------|-----------|----------|
| `IPerspectiveSyncAwaiter` | **One specific perspective** | Query consistency - ensure a handler sees its own changes in a specific perspective |
| `IEventCompletionAwaiter` | **All perspectives** | RPC completion - ensure all processing is complete before responding |

### When to Use Each

**Use `IPerspectiveSyncAwaiter`** when:
- You need to query a specific perspective after emitting events
- You want read-your-writes consistency for one perspective
- You're using `[AwaitPerspectiveSync]` attribute on receptors

**Use `IEventCompletionAwaiter`** when:
- Making RPC calls via `LocalInvokeAsync`
- You need to ensure ALL perspectives have processed before responding
- The caller needs a guarantee that all side effects are complete

---

## Usage: DispatchOptions.WithPerspectiveWait()

The simplest way to wait for all perspectives is using `DispatchOptions`:

```csharp
using Whizbang.Core.Dispatch;

public class OrderService {
    private readonly IDispatcher _dispatcher;

    public async Task<Guid> CreateOrderAsync(CreateOrderRequest request, CancellationToken ct) {
        var command = new CreateOrderCommand {
            CustomerId = request.CustomerId,
            Items = request.Items
        };

        // Wait for ALL perspectives to process cascaded events
        var options = new DispatchOptions()
            .WithPerspectiveWait(timeout: TimeSpan.FromSeconds(30));

        var result = await _dispatcher.LocalInvokeAsync(command, options, ct);

        // At this point, ALL perspectives have processed the OrderCreatedEvent
        return result.GetResult<Guid>();
    }
}
```

### Configuration Options

```csharp
public sealed class DispatchOptions {
    // When true, LocalInvokeAsync waits for all perspectives to finish
    public bool WaitForPerspectives { get; set; } = false;

    // Timeout for waiting (default: 30 seconds)
    public TimeSpan PerspectiveWaitTimeout { get; set; } = TimeSpan.FromSeconds(30);

    // Fluent API
    public DispatchOptions WithPerspectiveWait(TimeSpan? timeout = null);
}
```

---

## Usage: IEventCompletionAwaiter

For more control, inject `IEventCompletionAwaiter` directly:

```csharp
using Whizbang.Core.Perspectives.Sync;

public class OrderOrchestrator {
    private readonly IDispatcher _dispatcher;
    private readonly IEventCompletionAwaiter _completionAwaiter;
    private readonly IScopedEventTracker _scopedTracker;

    public async Task<OrderResult> ProcessOrderAsync(CreateOrderCommand cmd, CancellationToken ct) {
        // Execute command
        var orderId = await _dispatcher.SendAsync(cmd, ct);

        // Get all event IDs emitted in this scope
        var emittedEvents = _scopedTracker.GetEmittedEvents();
        var eventIds = emittedEvents.Select(e => e.EventId).Distinct().ToList();

        if (eventIds.Count > 0) {
            // Wait for ALL perspectives to finish processing
            var success = await _completionAwaiter.WaitForEventsAsync(
                eventIds,
                timeout: TimeSpan.FromSeconds(30),
                ct);

            if (!success) {
                throw new PerspectiveSyncTimeoutException(
                    $"Timed out waiting for {eventIds.Count} events to be processed");
            }
        }

        return new OrderResult { OrderId = orderId, FullyProcessed = true };
    }
}
```

### API Reference

```csharp
public interface IEventCompletionAwaiter {
    /// <summary>
    /// Waits for events to be processed by ALL perspectives.
    /// Returns when no perspectives are still tracking any of the specified events.
    /// </summary>
    Task<bool> WaitForEventsAsync(
        IReadOnlyList<Guid> eventIds,
        TimeSpan timeout,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Checks if events have been fully processed by all perspectives.
    /// </summary>
    bool AreEventsFullyProcessed(IReadOnlyList<Guid> eventIds);
}
```

---

## How It Works

The event completion system uses per-perspective tracking:

```
Event emitted (EventId = abc123)
         │
         ▼
┌──────────────────────────────────────┐
│        SyncEventTracker              │
│ ┌──────────────────────────────────┐ │
│ │ Tracked Events (per-perspective) │ │
│ │  (abc123, OrderPerspective)      │ │
│ │  (abc123, ReportingPerspective)  │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
         │
         │  Perspective workers process event
         ▼
┌──────────────────────────────────────┐
│ OrderPerspective calls               │
│ MarkProcessedByPerspective(abc123,   │
│   "OrderPerspective")                │
│                                      │
│ Removes only: (abc123, OrderPersp.)  │
│ Still tracked: (abc123, Reporting)   │
└──────────────────────────────────────┘
         │
         │  When ALL perspectives done:
         ▼
┌──────────────────────────────────────┐
│ ReportingPerspective calls           │
│ MarkProcessedByPerspective(abc123,   │
│   "ReportingPerspective")            │
│                                      │
│ No more entries for abc123           │
│ → Signals WaitForAllPerspectivesAsync│
└──────────────────────────────────────┘
```

### Key Methods

| Method | Purpose |
|--------|---------|
| `MarkProcessedByPerspective(eventIds, perspectiveName)` | Called by perspective worker when done processing |
| `WaitForPerspectiveEventsAsync(eventIds, perspectiveName, timeout)` | Wait for ONE perspective (used by `IPerspectiveSyncAwaiter`) |
| `WaitForAllPerspectivesAsync(eventIds, timeout)` | Wait for ALL perspectives (used by `IEventCompletionAwaiter`) |

---

## Timeout Handling

When perspectives don't complete within the timeout:

```csharp
var options = new DispatchOptions()
    .WithPerspectiveWait(timeout: TimeSpan.FromSeconds(5));

try {
    await _dispatcher.LocalInvokeAsync(command, options, ct);
} catch (PerspectiveSyncTimeoutException ex) {
    // Handle timeout - perspectives are still processing
    _logger.LogWarning("Perspective processing timed out: {Message}", ex.Message);

    // Options:
    // 1. Return partial success with warning
    // 2. Queue for retry
    // 3. Return error to caller
}
```

---

## Best Practices

### Do: Use for External API Responses

```csharp
[HttpPost]
public async Task<IActionResult> CreateOrder(CreateOrderRequest request) {
    var options = new DispatchOptions().WithPerspectiveWait();
    var result = await _dispatcher.LocalInvokeAsync(
        new CreateOrderCommand(request), options, HttpContext.RequestAborted);

    // Safe to query any perspective - all are up to date
    return Ok(result.GetResult<Guid>());
}
```

### Do: Set Appropriate Timeouts

```csharp
// Short timeout for real-time APIs
.WithPerspectiveWait(TimeSpan.FromSeconds(5))

// Longer timeout for batch operations
.WithPerspectiveWait(TimeSpan.FromSeconds(60))
```

### Don't: Use When Not Needed

```csharp
// Fire-and-forget scenarios don't need to wait
await _dispatcher.SendAsync(command, ct); // No waiting

// Only wait when caller needs complete processing
var options = new DispatchOptions().WithPerspectiveWait();
await _dispatcher.LocalInvokeAsync(command, options, ct); // Waits
```

### Don't: Confuse with Perspective-Specific Sync

```csharp
// WRONG: Using event completion when you only need one perspective
var options = new DispatchOptions().WithPerspectiveWait();
await _dispatcher.LocalInvokeAsync(command, options, ct);
var order = await _orderLens.GetByIdAsync(orderId, ct);

// RIGHT: Use IPerspectiveSyncAwaiter for single-perspective consistency
await _syncAwaiter.WaitAsync(typeof(OrderPerspective),
    SyncFilter.CurrentScope().Build(), ct);
var order = await _orderLens.GetByIdAsync(orderId, ct);
```

---

## DI Registration

`IEventCompletionAwaiter` is automatically registered by `AddWhizbang()`:

```csharp
services.AddWhizbang(options => {
    // Configuration
});

// Resolving
var awaiter = serviceProvider.GetRequiredService<IEventCompletionAwaiter>();
```

---

## Related

- **[Perspective Synchronization](perspective-sync.md)** - Single-perspective consistency
- **Source Code**: [IEventCompletionAwaiter.cs](../../../code/Whizbang.Core/Perspectives/Sync/IEventCompletionAwaiter.cs)
- **Tests**: [EventCompletionAwaiterTests.cs](../../../tests/Whizbang.Core.Tests/Perspectives/Sync/EventCompletionAwaiterTests.cs)
