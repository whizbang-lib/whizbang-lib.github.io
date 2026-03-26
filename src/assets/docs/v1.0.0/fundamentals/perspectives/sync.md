---
title: Perspective Sync
version: 1.0.0
category: Perspectives
codeReferences:
  - src/Whizbang.Core/Perspectives/Sync/SyncInquiry.cs
  - src/Whizbang.Core/Perspectives/Sync/SyncInquiryResult.cs
  - src/Whizbang.Core/Perspectives/Sync/IPerspectiveSyncAwaiter.cs
  - src/Whizbang.Core/Perspectives/Sync/PerspectiveSyncOptions.cs
---

# Perspective Sync

Perspective sync enables you to wait for perspectives to catch up with specific events before reading data. This is essential for read-your-writes consistency in event-sourced systems where perspectives are updated asynchronously.

:::updated
This page provides a quick reference for `SyncInquiry`, `SyncInquiryResult`, and `PerspectiveSyncAwaiter`. For the comprehensive guide covering `SyncFilter`, `ISyncEventTracker`, cross-scope sync, the type registry system, debugger-aware timeouts, and `[AwaitPerspectiveSync]`, see [Perspective Synchronization](perspective-sync.md).
:::

## Overview

When you dispatch a command that publishes events, the perspective may not be immediately updated. Sync inquiries let you check whether specific events have been processed and wait for the perspective to catch up.

| Pattern | Use Case |
|---------|----------|
| Fire-and-forget | Background processing, eventual consistency acceptable |
| Sync after command | UI needs to show updated data immediately |
| Cross-scope sync | API call needs data from previous request |

## SyncInquiry {#SyncInquiry}

`SyncInquiry` is a query object that checks whether specific events have been processed by a perspective. Pass it to the work coordinator's batch function to query the `wh_perspective_events` table.

```csharp{title="SyncInquiry" description="SyncInquiry is a query object that checks whether specific events have been processed by a perspective." category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "SyncInquiry"]}
public sealed record SyncInquiry {
    // Required: Stream to check
    public required Guid StreamId { get; init; }

    // Required: Perspective name to check
    public required string PerspectiveName { get; init; }

    // Optional: Specific event IDs to check
    public Guid[]? EventIds { get; init; }

    // Optional: Filter by event types
    public string[]? EventTypeFilter { get; init; }

    // Optional: Include pending event IDs in result (for debugging)
    public bool IncludePendingEventIds { get; init; }

    // Optional: Include processed event IDs in result
    public bool IncludeProcessedEventIds { get; init; }

    // Optional: Discover pending events from outbox
    public bool DiscoverPendingFromOutbox { get; init; }

    // Auto-generated correlation ID
    public Guid InquiryId { get; init; }
}
```

### Creating a Sync Inquiry

```csharp{title="Creating a Sync Inquiry" description="Demonstrates creating a Sync Inquiry" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Creating", "Sync"]}
// Check if specific events have been processed
var inquiry = new SyncInquiry {
    StreamId = orderId,
    PerspectiveName = "OrderPerspective",
    EventIds = [eventId1, eventId2]
};

// Check all events of certain types
var inquiry = new SyncInquiry {
    StreamId = orderId,
    PerspectiveName = "OrderPerspective",
    EventTypeFilter = ["OrderCreatedEvent", "OrderUpdatedEvent"]
};
```

## SyncInquiryResult {#SyncInquiryResult}

`SyncInquiryResult` contains the result of a sync inquiry, indicating how many events are pending and whether synchronization is complete.

```csharp{title="SyncInquiryResult" description="SyncInquiryResult contains the result of a sync inquiry, indicating how many events are pending and whether" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "SyncInquiryResult"]}
public sealed record SyncInquiryResult {
    // Correlation ID from the inquiry
    public required Guid InquiryId { get; init; }

    // Stream that was queried
    public Guid StreamId { get; init; }

    // Number of events still pending (not yet processed)
    public required int PendingCount { get; init; }

    // Number of events that have been processed
    public int ProcessedCount { get; init; }

    // True when all requested events have been processed
    public bool IsFullySynced { get; }

    // Pending event IDs (if IncludePendingEventIds was true)
    public Guid[]? PendingEventIds { get; init; }

    // Processed event IDs (if IncludeProcessedEventIds was true)
    public Guid[]? ProcessedEventIds { get; init; }

    // Expected event IDs for explicit tracking
    public Guid[]? ExpectedEventIds { get; init; }
}
```

### Checking Sync Status

```csharp{title="Checking Sync Status" description="Demonstrates checking Sync Status" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Checking", "Sync"]}
var result = await workCoordinator.CheckSyncAsync(inquiry);

if (result.IsFullySynced) {
    // All events have been processed - safe to read
    var order = await lens.GetAsync<OrderPerspective>(orderId);
}
else {
    // Still pending
    Console.WriteLine($"Waiting for {result.PendingCount} events");
}
```

## IsFullySynced Logic

The `IsFullySynced` property uses different logic depending on whether explicit event tracking is enabled:

### With Explicit Event Tracking

When `ExpectedEventIds` is set, `IsFullySynced` returns `true` only when ALL expected events are found in `ProcessedEventIds`:

```csharp{title="With Explicit Event Tracking" description="When ExpectedEventIds is set, IsFullySynced returns true only when ALL expected events are found in ProcessedEventIds:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Explicit", "Event"]}
// Explicit tracking prevents false positives
var inquiry = new SyncInquiry {
    StreamId = orderId,
    PerspectiveName = "OrderPerspective",
    EventIds = [eventId1, eventId2],
    IncludeProcessedEventIds = true
};

// IsFullySynced checks: Are ALL expected events in ProcessedEventIds?
```

This prevents the false positive where `PendingCount == 0` because events haven't reached `wh_perspective_events` yet (still in outbox).

### Without Explicit Tracking (Legacy)

When `ExpectedEventIds` is null or empty, falls back to simple check:

```csharp{title="Without Explicit Tracking (Legacy)" description="When ExpectedEventIds is null or empty, falls back to simple check:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Without", "Explicit"]}
// Legacy behavior
public bool IsFullySynced => PendingCount == 0;
```

## Using PerspectiveSyncAwaiter

The `PerspectiveSyncAwaiter` provides a high-level API for waiting on perspective sync:

```csharp{title="Using PerspectiveSyncAwaiter" description="The PerspectiveSyncAwaiter provides a high-level API for waiting on perspective sync:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Using", "PerspectiveSyncAwaiter"]}
// Wait for perspective to catch up with tracked events
await syncAwaiter.WaitForPerspectiveAsync<OrderPerspective>(
    orderId,
    timeout: TimeSpan.FromSeconds(5)
);

// Now safe to read
var order = await lens.GetAsync<OrderPerspective>(orderId);
```

### With Event Tracking

```csharp{title="With Event Tracking" description="Demonstrates with Event Tracking" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Event", "Tracking"]}
// Track events during command handling
using var tracker = scopedEventTracker.BeginTracking();

await dispatcher.DispatchAsync(new CreateOrderCommand { ... });

// Wait for tracked events to be processed
await syncAwaiter.WaitForPerspectiveAsync<OrderPerspective>(
    orderId,
    tracker.GetTrackedEventIds(),
    timeout: TimeSpan.FromSeconds(5)
);
```

## Cross-Scope Sync

For scenarios where you need to sync across different scopes or requests (e.g., between API calls), use the `DiscoverPendingFromOutbox` option:

```csharp{title="Cross-Scope Sync" description="For scenarios where you need to sync across different scopes or requests (e." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Cross-Scope", "Sync"]}
var inquiry = new SyncInquiry {
    StreamId = orderId,
    PerspectiveName = "OrderPerspective",
    EventTypeFilter = ["OrderCreatedEvent"],
    DiscoverPendingFromOutbox = true  // Find events still in outbox
};
```

This queries the outbox to find events that haven't been processed yet, enabling sync when you don't know the specific event IDs.

## Common Patterns

### Read-Your-Writes Consistency

```csharp{title="Read-Your-Writes Consistency" description="Demonstrates read-Your-Writes Consistency" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Read-Your-Writes", "Consistency"]}
public async Task<OrderDto> CreateOrderAsync(CreateOrderRequest request) {
    using var tracker = _eventTracker.BeginTracking();

    // Dispatch command
    var orderId = await _dispatcher.DispatchAsync(
        new CreateOrderCommand(request.CustomerId, request.Items)
    );

    // Wait for perspective
    await _syncAwaiter.WaitForPerspectiveAsync<OrderPerspective>(
        orderId,
        tracker.GetTrackedEventIds()
    );

    // Return fresh data
    return await _lens.GetAsync<OrderDto>(orderId);
}
```

### Timeout Handling

```csharp{title="Timeout Handling" description="Demonstrates timeout Handling" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Timeout", "Handling"]}
try {
    await syncAwaiter.WaitForPerspectiveAsync<OrderPerspective>(
        orderId,
        timeout: TimeSpan.FromSeconds(5)
    );
}
catch (TimeoutException) {
    // Perspective didn't catch up in time
    // Options: retry, return stale data with warning, or fail
    _logger.Warning("Perspective sync timeout for order {OrderId}", orderId);
    throw new ServiceUnavailableException("Order data temporarily unavailable");
}
```

### Conditional Sync

```csharp{title="Conditional Sync" description="Demonstrates conditional Sync" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Conditional", "Sync"]}
// Only sync for specific operations
if (request.RequiresFreshData) {
    await syncAwaiter.WaitForPerspectiveAsync<OrderPerspective>(orderId);
}

return await lens.GetAsync<OrderDto>(orderId);
```

## Best Practices

1. **Track specific events**: Use explicit event IDs when possible for reliable sync
2. **Set reasonable timeouts**: 5-10 seconds is typical; longer for complex operations
3. **Handle timeouts gracefully**: Return stale data or retry rather than failing
4. **Use sparingly**: Not all reads require sync - evaluate consistency requirements
5. **Monitor sync latency**: Track how long sync takes to identify bottlenecks

## Debugging

Enable detailed logging for sync operations:

```csharp{title="Debugging" description="Enable detailed logging for sync operations:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Debugging"]}
var inquiry = new SyncInquiry {
    StreamId = orderId,
    PerspectiveName = "OrderPerspective",
    EventIds = [eventId1, eventId2],
    IncludePendingEventIds = true,    // See which events are pending
    IncludeProcessedEventIds = true   // See which events are done
};

var result = await workCoordinator.CheckSyncAsync(inquiry);
_logger.Debug(
    "Sync status: Pending={Pending}, Processed={Processed}, EventIds={PendingIds}",
    result.PendingCount,
    result.ProcessedCount,
    result.PendingEventIds
);
```

## See Also

- [Work Coordination](../../messaging/work-coordination.md) - Batch processing and coordination
- [Outbox Pattern](../../messaging/outbox-pattern.md) - Reliable event publishing
- [Perspective Registry](registry.md) - Perspective metadata
