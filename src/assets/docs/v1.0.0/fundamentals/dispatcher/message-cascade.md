---
title: Automatic Message Cascade
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Core Concepts
order: 3
description: >-
  How receptor return values cascade automatically: MessageExtractor, route
  wrappers, outbox auto-cascade, event-store-only mode, the deferred event
  channel, and the deterministic identity of emitted events (a retry is not a republish)
tags: 'dispatcher, cascade, outbox, routing, message-extractor, emission-identity, idempotency'
codeReferences:
  - src/Whizbang.Core/Dispatcher.cs
  - src/Whizbang.Core/Dispatch/Route.cs
  - src/Whizbang.Core/Messaging/IDeferredOutboxChannel.cs
  - src/Whizbang.Core/Messaging/DeferredOutboxChannel.cs
  - src/Whizbang.Core/Messaging/EmissionIdentity.cs
  - src/Whizbang.Core/Observability/CascadeEnvelopeWrapper.cs
  - src/Whizbang.Core/Observability/MessageDispatchContext.cs
  - src/Whizbang.Core/Observability/WorkCoordinatorMetrics.cs
  - src/Whizbang.Core/Workers/OutboxDrainWorker.cs
testReferences:
  - tests/Whizbang.Core.Tests/Dispatcher/DispatcherCascadeTests.cs
  - tests/Whizbang.Core.Tests/Dispatcher/DispatcherRoutedCascadeTests.cs
  - tests/Whizbang.Core.Tests/Messaging/DeferredOutboxChannelTests.cs
  - tests/Whizbang.Core.Tests/Messaging/EmissionIdentityTests.cs
  - tests/Whizbang.Core.Tests/Dispatcher/DispatcherEmissionIdentityTests.cs
  - tests/Whizbang.Core.Tests/Observability/MessageEnvelopeHandlerNameTests.cs
  - tests/Whizbang.Core.Tests/Observability/WorkCoordinatorMetricsTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreOutboxEmissionDedupTests.cs
  - tests/Whizbang.Core.Tests/Workers/OutboxDrainWorkerTests.cs
---

# Automatic Message Cascade {#automatic-message-cascade}

How messages returned from receptors cascade onward automatically. For dispatch basics see the [Dispatcher overview](dispatcher); for the individual patterns see [Dispatch Patterns](dispatch-patterns).

Whizbang automatically extracts and dispatches `IMessage` instances (both `IEvent` and `ICommand`) from receptor return values. This enables a cleaner pattern where receptors can return tuples or arrays containing messages without explicit `PublishAsync` or `SendAsync` calls.

### The Problem (Without Auto-Cascade)

```csharp{title="The Problem (Without Auto-Cascade)" description="The Problem (Without Auto-Cascade)" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Problem", "Without"] unverified="illustrative before-pattern (manual publish), no assertion"}
// ❌ VERBOSE: Explicit PublishAsync required
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    private readonly IDispatcher _dispatcher;

    public async ValueTask<OrderCreated> HandleAsync(
        CreateOrder command,
        CancellationToken ct = default) {

        // Business logic...
        var @event = new OrderCreated(command.OrderId, command.CustomerId);

        // Manual publishing required
        await _dispatcher.PublishAsync(@event);

        return @event;
    }
}
```

### The Solution (With Auto-Cascade)

```csharp{title="The Solution (With Auto-Cascade)" description="The Solution (With Auto-Cascade)" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Solution", "Auto-Cascade"] tests=["DispatcherCascadeTests.LocalInvokeAsync_TupleWithEvent_AutoPublishesEventAsync"]}
// ✅ CLEAN: Framework auto-publishes events from return value
public class CreateOrderReceptor : IReceptor<CreateOrder, (OrderResult, OrderCreated)> {

    public ValueTask<(OrderResult, OrderCreated)> HandleAsync(
        CreateOrder command,
        CancellationToken ct = default) {

        var result = new OrderResult(command.OrderId);
        var @event = new OrderCreated(command.OrderId, command.CustomerId);

        // Return tuple - framework automatically publishes OrderCreated
        return ValueTask.FromResult((result, @event));
    }
}
```

**What happens**:
1. Receptor returns `(OrderResult, OrderCreated)` tuple
2. Dispatcher extracts `OrderCreated` (implements `IEvent`)
3. Dispatcher automatically publishes `OrderCreated` to all perspectives
4. Caller receives the full tuple result

### Supported Return Types

The auto-cascade feature supports several return patterns:

**Tuple with Event**:
```csharp{title="Supported Return Types" description="Tuple with Event:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Supported", "Return"] tests=["DispatcherCascadeTests.LocalInvokeAsync_TupleWithEvent_AutoPublishesEventAsync", "MessageExtractorTests.ExtractEvents_WithValueTuple_ExtractsOnlyEventsAsync"]}
public class OrderReceptor : IReceptor<CreateOrder, (OrderResult, OrderCreated)> {
    public ValueTask<(OrderResult, OrderCreated)> HandleAsync(
        CreateOrder command, CancellationToken ct = default) {

        return ValueTask.FromResult((
            new OrderResult(command.OrderId),
            new OrderCreated(command.OrderId, command.CustomerId)
        ));
    }
}
// Result: OrderCreated auto-published
```

**Tuple with Multiple Events**:
```csharp{title="Supported Return Types - ShipOrderReceptor" description="Tuple with Multiple Events:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Supported", "Return"] tests=["MessageExtractorTests.ExtractEvents_WithValueTuple_ExtractsOnlyEventsAsync"]}
public class ShipOrderReceptor : IReceptor<ShipOrder, (ShipResult, OrderShipped, InventoryUpdated)> {
    public ValueTask<(ShipResult, OrderShipped, InventoryUpdated)> HandleAsync(
        ShipOrder command, CancellationToken ct = default) {

        return ValueTask.FromResult((
            new ShipResult(command.OrderId),
            new OrderShipped(command.OrderId),
            new InventoryUpdated(command.ProductId, -command.Quantity)
        ));
    }
}
// Result: Both OrderShipped and InventoryUpdated auto-published
```

**Array of Events**:
```csharp{title="Supported Return Types - NotifyReceptor" description="Array of Events:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Supported", "Return"] tests=["MessageExtractorTests.ExtractEvents_WithEventArray_ReturnsAllEventsAsync", "DispatcherEventCascaderTests.CascadeFromResultAsync_EventArray_DispatchesAllEventsAsync"]}
public class NotifyReceptor : IReceptor<SendNotifications, IEvent[]> {
    public ValueTask<IEvent[]> HandleAsync(
        SendNotifications command, CancellationToken ct = default) {

        var events = new List<IEvent> {
            new EmailSent(command.CustomerId)
        };

        if (command.Amount >= 1000m) {
            events.Add(new HighValueAlert(command.OrderId));
        }

        return ValueTask.FromResult(events.ToArray());
    }
}
// Result: All events in array auto-published
```

**Nested Tuples**:
```csharp{title="Supported Return Types - ComplexReceptor" description="Nested Tuples:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Supported", "Return"] unverified="verified by DispatcherCascadeTests.LocalInvokeAsync_NestedTupleWithEvents_AutoPublishesAllEventsAsync, which is outside the current coverage map"}
public class ComplexReceptor : IReceptor<ComplexCommand, (Result, (Event1, Event2))> {
    public ValueTask<(Result, (Event1, Event2))> HandleAsync(
        ComplexCommand command, CancellationToken ct = default) {

        return ValueTask.FromResult((
            new Result(command.Id),
            (new Event1(command.Id), new Event2(command.Id))
        ));
    }
}
// Result: Both Event1 and Event2 auto-published (recursive extraction)
```

### How It Works

The auto-cascade system uses the `ITuple` interface for efficient, AOT-compatible message extraction:

```mermaid{caption="MessageExtractor.ExtractMessages walks the receptor result — yielding IMessage instances directly and recursing through tuples and enumerables — before each extracted message is published to its receptors." tests=["MessageExtractorTests.ExtractEvents_WithSingleEvent_ReturnsSingleEventAsync", "MessageExtractorTests.ExtractEvents_WithTuple_ExtractsOnlyEventsAsync", "MessageExtractorTests.ExtractEvents_WithEventEnumerable_ReturnsAllEventsAsync", "MessageExtractorTests.ExtractEvents_WithCommandArray_ReturnsAllCommandsAsync"]}
graph TB
    R["Receptor Returns"]
    X1["Dispatcher receives result"]
    X2["MessageExtractor.ExtractMessages(result)"]
    K1["Checks if result implements IMessage (IEvent or ICommand) → yield return"]
    K2["Checks if result implements ITuple → extract each item recursively"]
    K3["Checks if result implements IEnumerable&lt;IMessage&gt; → yield return each"]
    K4["Checks if result implements IEnumerable&lt;IEvent&gt; → yield return each"]
    K5["Checks if result implements IEnumerable&lt;ICommand&gt; → yield return each"]
    F1["For each extracted IMessage:<br/>GetUntypedReceptorPublisher(messageType).Invoke(message)"]
    F2["All receptors for that message type invoked"]

    R --> X1 --> X2
    X2 --> K1 --> F1
    X2 --> K2 --> F1
    X2 --> K3 --> F1
    X2 --> K4 --> F1
    X2 --> K5 --> F1
    F1 --> F2

    style X2 fill:#d4edda,stroke:#28a745
    style F2 fill:#d4edda,stroke:#28a745
```

**Key Points**:
- **Zero reflection**: Uses `ITuple` interface (compile-time type info)
- **AOT compatible**: Works with Native AOT and trimming
- **Recursive**: Handles nested tuples and arrays
- **Selective**: Only extracts types implementing `IMessage` (events AND commands)
- **Non-messages ignored**: DTOs and value objects pass through unchanged

### Cascades Through All Dispatch Paths

Auto-cascade works with all dispatch methods and message types:

```csharp{title="Cascades Through All Dispatch Paths" description="Auto-cascade works with all dispatch methods and message types:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Cascades", "Through"] tests=["DispatcherCascadeTests.LocalInvokeAsync_TupleWithEvent_AutoPublishesEventAsync"]}
// Via LocalInvokeAsync - Events auto-published
var result = await _dispatcher.LocalInvokeAsync<CreateOrder, (OrderResult, OrderCreated)>(command);
// OrderCreated auto-published ✓

// Via LocalInvokeAsync - Commands auto-dispatched
var result = await _dispatcher.LocalInvokeAsync<ProcessPayment, (PaymentResult, SendNotification)>(command);
// SendNotification command auto-dispatched ✓

// Via SendAsync
var receipt = await _dispatcher.SendAsync(command);
// Any returned IEvent or ICommand auto-cascaded ✓
```

### Mixed Events and Commands

Receptors can return both events and commands in a single tuple:

```csharp{title="Mixed Events and Commands" description="Receptors can return both events and commands in a single tuple:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Mixed", "Events"] tests=["MessageExtractorTests.ExtractEvents_WithMixedEventsAndCommands_ReturnsAllAsync"]}
public class ProcessOrderReceptor : IReceptor<ProcessOrder, (OrderResult, OrderProcessed, SendInvoice)> {
    public ValueTask<(OrderResult, OrderProcessed, SendInvoice)> HandleAsync(
        ProcessOrder command, CancellationToken ct = default) {

        var result = new OrderResult(command.OrderId, ProcessStatus.Completed);
        var orderEvent = new OrderProcessed(command.OrderId, DateTime.UtcNow);
        var invoiceCommand = new SendInvoice(command.OrderId, command.CustomerId);

        // Return tuple with both event AND command
        return ValueTask.FromResult((result, orderEvent, invoiceCommand));
    }
}
// Result: OrderProcessed event published to perspectives
// Result: SendInvoice command dispatched to invoice receptor
```

### Best Practices

**DO**: Return messages (events and commands) alongside business results in tuples
```csharp{title="Best Practices" description="DO: Return messages (events and commands) alongside business results in tuples" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Best", "Practices"] tests=["DispatcherCascadeTests.LocalInvokeAsync_TupleWithEvent_AutoPublishesEventAsync", "MessageExtractorTests.ExtractEvents_WithMixedEventsAndCommands_ReturnsAllAsync"]}
// ✅ GOOD: Event returned with result
public ValueTask<(OrderResult, OrderCreated)> HandleAsync(
    CreateOrder command, CancellationToken ct) {
    return ValueTask.FromResult((
        new OrderResult(command.OrderId),
        new OrderCreated(command.OrderId, command.CustomerId)
    ));
}

// ✅ GOOD: Command returned triggers follow-up action
public ValueTask<(PaymentResult, SendReceipt)> HandleAsync(
    ProcessPayment command, CancellationToken ct) {
    return ValueTask.FromResult((
        new PaymentResult(command.OrderId, PaymentStatus.Success),
        new SendReceipt(command.OrderId, command.CustomerId)  // Command auto-dispatched
    ));
}
```

**DON'T**: Return messages AND manually dispatch them
```csharp{title="Best Practices (2)" description="DON'T: Return messages AND manually dispatch them" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Best", "Practices"] unverified="counter-example — anti-pattern, nothing to assert"}
// ❌ BAD: Double publishing!
public async ValueTask<(OrderResult, OrderCreated)> HandleAsync(
    CreateOrder command, CancellationToken ct) {

    var @event = new OrderCreated(command.OrderId, command.CustomerId);

    // DON'T DO THIS - framework already auto-publishes from return value
    await _dispatcher.PublishAsync(@event);

    return (new OrderResult(command.OrderId), @event);
}
```

**DON'T**: Return empty arrays to avoid cascade
```csharp{title="Best Practices (3)" description="DON'T: Return empty arrays to avoid cascade" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Best", "Practices"] tests=["MessageExtractorTests.ExtractEvents_WithEmptyArray_ReturnsEmptyAsync"]}
// ⚠️ UNNECESSARY: Empty arrays are handled gracefully
public ValueTask<(OrderResult, IMessage[])> HandleAsync(
    CreateOrder command, CancellationToken ct) {

    return ValueTask.FromResult((
        new OrderResult(command.OrderId),
        Array.Empty<IMessage>()  // Fine - no messages dispatched
    ));
}
```

### Auto-Cascade to Outbox {#auto-cascade-to-outbox}

By default, cascaded events are dispatched to local receptors only. To cascade events to the outbox for cross-service delivery, use the `Route` wrapper:

**Route Wrappers**: {#routed-message-cascading}
```csharp{title="Auto-Cascade to Outbox" description="Route Wrappers: {#routed-message-cascading}" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Auto-Cascade", "Outbox"] tests=["RouteTests.Local_WithValue_ReturnsRoutedWithLocalModeAsync", "RouteTests.LocalNoPersist_WithValue_ReturnsRoutedWithLocalNoPersistModeAsync", "RouteTests.EventStoreOnly_WithValue_ReturnsRoutedWithEventStoreOnlyModeAsync", "RouteTests.Outbox_WithValue_ReturnsRoutedWithOutboxModeAsync", "RouteTests.Both_WithValue_ReturnsRoutedWithBothModeAsync", "DispatcherRoutedCascadeTests.CascadeFromResult_WithRouteLocal_InvokesLocalReceptorAsync"]}
// Cascade to local receptors AND persist to event store (default)
return (result, new OrderCreated(orderId));

// Explicit local + event store (same as default)
return (result, Route.Local(new OrderCreated(orderId)));

// Cascade to local receptors only - NO persistence (ephemeral)
return (result, Route.LocalNoPersist(new OrderCreated(orderId)));

// Persist to event store only - NO local receptors (audit events)
return (result, Route.EventStoreOnly(new AuditEvent(userId, action)));

// Cascade to outbox only (cross-service)
return (result, Route.Outbox(new OrderCreated(orderId)));

// Cascade to both local and outbox
return (result, Route.Both(new OrderCreated(orderId)));
```

:::new
**New**: `Route.Local()` now includes automatic event store persistence. Events are stored to `wh_event_store` and perspective events are created. Use `Route.LocalNoPersist()` for the previous behavior (local receptors only, no persistence).
:::

### Event Store Only Mode {#event-store-only}

`Route.EventStoreOnly()` persists events to the event store without invoking local receptors or sending via transport. This is useful for:

- **Audit events**: Record actions without triggering business logic
- **Historical events**: Import or replay events into the store
- **Deferred processing**: Store events for later perspective rebuilds

```csharp{title="Event Store Only Mode" description="- Audit events: Record actions without triggering business logic - Historical events: Import or replay events into the" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Event", "Store"] tests=["RouteTests.EventStoreOnly_WithValue_ReturnsRoutedWithEventStoreOnlyModeAsync", "RouteTests.EventStoreOnly_HasFlag_EventStoreAsync", "RouteTests.EventStoreOnly_DoesNotHaveFlag_LocalDispatchAsync"]}
public class AuditReceptor : IReceptor<ProcessOrder, (OrderResult, Routed<AuditEvent>)> {
    public ValueTask<(OrderResult, Routed<AuditEvent>)> HandleAsync(
        ProcessOrder command, CancellationToken ct = default) {

        var result = new OrderResult(command.OrderId);

        // Audit event stored to event store only - no local receptors invoked
        var auditEvent = new AuditEvent(
            UserId: command.UserId,
            Action: "OrderProcessed",
            ResourceId: command.OrderId
        );

        return ValueTask.FromResult((result, Route.EventStoreOnly(auditEvent)));
    }
}
// Result: AuditEvent persisted to wh_event_store
// Result: Perspective events created for downstream projections
// Result: NO local receptors invoked
// Result: NO transport publishing (destination=null)
```

**How It Works**:
1. Event is written to `wh_outbox` with `destination=null`
2. `process_work_batch` stores event in `wh_event_store` and creates perspective events
3. `TransportPublishStrategy` skips transport (null destination = bypass)
4. Event is marked as published (completed)

**Example: Cross-Service Event Publishing**:
```csharp{title="Event Store Only Mode - CreateOrderReceptor" description="Example: Cross-Service Event Publishing:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Event", "Store"] tests=["RouteTests.Both_WithValue_ReturnsRoutedWithBothModeAsync", "RouteTests.Both_HasFlag_LocalDispatchAsync", "RouteTests.Both_HasFlag_OutboxAsync"]}
public class CreateOrderReceptor : IReceptor<CreateOrder, (OrderResult, Routed<OrderCreated>)> {
    public ValueTask<(OrderResult, Routed<OrderCreated>)> HandleAsync(
        CreateOrder command, CancellationToken ct = default) {

        var result = new OrderResult(command.OrderId);
        var @event = new OrderCreated(command.OrderId, command.CustomerId);

        // Wrap with Route.Both() to cascade to local perspectives AND outbox
        return ValueTask.FromResult((result, Route.Both(@event)));
    }
}
// Result: OrderCreated published to local perspectives
// Result: OrderCreated queued in outbox for remote services
```

**How It Works**:
1. Receptor returns a `Routed<TEvent>` wrapped event
2. Dispatcher extracts the event and its routing mode
3. For `DispatchModes.Local` or `DispatchModes.Both`: Publishes to local receptors
4. For `DispatchModes.Outbox` or `DispatchModes.Both`: Calls `CascadeToOutboxAsync`
5. For `DispatchModes.EventStoreOnly`: Persists to event store only (no local dispatch, no transport)
6. Generated dispatcher uses type-switch dispatch (zero reflection, AOT compatible)

### DispatchModes Flags Enum

`DispatchModes` (note the plural — `Whizbang.Core.Dispatch.DispatchModes`) is a `[Flags]` enum composed from three base flags: `LocalDispatch` (1), `Outbox` (2), and `EventStore` (4). The named convenience values combine these flags:

{verified: RouteTests.Local_HasFlag_LocalDispatchAsync, RouteTests.Local_HasFlag_EventStoreAsync, RouteTests.Both_HasFlag_OutboxAsync, RouteTests.EventStoreOnly_HasFlag_EventStoreAsync}

| Mode | Value | Flags Composition | Local Receptors | Event Store | Outbox |
|------|-------|-------------------|-----------------|-------------|--------|
| `None` | 0 | _(none)_ | No | No | No |
| `LocalNoPersist` | 1 | `LocalDispatch` | Yes | No | No |
| `Local` | 5 | `LocalDispatch \| EventStore` | Yes | Yes | No |
| `Outbox` | 2 | `Outbox` | No | Yes (via outbox) | Yes |
| `Both` | 3 | `LocalDispatch \| Outbox` | Yes | Yes (via outbox) | Yes |
| `EventStoreOnly` | 4 | `EventStore` | No | Yes | No |

Each `Route.*()` factory method maps to one of these modes:

{verified: RouteTests.Local_WithValue_ReturnsRoutedWithLocalModeAsync, RouteTests.LocalNoPersist_WithValue_ReturnsRoutedWithLocalNoPersistModeAsync, RouteTests.Outbox_WithValue_ReturnsRoutedWithOutboxModeAsync, RouteTests.Both_WithValue_ReturnsRoutedWithBothModeAsync, RouteTests.EventStoreOnly_WithValue_ReturnsRoutedWithEventStoreOnlyModeAsync, RouteTests.None_ReturnsRoutedNoneAsync}

| Route Method | DispatchModes | Description |
|---|---|---|
| `Route.Local(value)` | `Local` | Local receptors + event store persistence |
| `Route.LocalNoPersist(value)` | `LocalNoPersist` | Local receptors only, no persistence (ephemeral) |
| `Route.Outbox(value)` | `Outbox` | Outbox for cross-service transport |
| `Route.Both(value)` | `Both` | Local receptors + outbox transport |
| `Route.EventStoreOnly(value)` | `EventStoreOnly` | Event store only, no local dispatch |
| `Route.None()` | _(RoutedNone)_ | No dispatch; used in discriminated union tuples |

**Generated Code Pattern**: {#cascade-to-outbox}
```csharp{title="Event Store Only Mode (3)" description="Generated Code Pattern: {#cascade-to-outbox}" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Dispatcher", "Event", "Store"] unverified="illustrative generated code (source-generator output)"}
// Generated by Whizbang.Generators
protected override Task CascadeToOutboxAsync(
    IMessage message, Type messageType,
    IMessageEnvelope? sourceEnvelope = null, Guid? eventId = null) {
    if (messageType == typeof(OrderCreated)) {
        return PublishToOutboxAsync((OrderCreated)message, messageType, MessageId.New());
    }
    if (messageType == typeof(PaymentProcessed)) {
        return PublishToOutboxAsync((PaymentProcessed)message, messageType, MessageId.New());
    }
    // ... other event types
    return Task.CompletedTask;
}
```

**Key Points**:
- **Zero reflection**: Source generators create compile-time type-switch dispatch
- **AOT compatible**: Works with Native AOT and trimming
- **Automatic**: No manual `PublishAsync` or `SendAsync` calls needed
- **Configurable**: Per-event routing via `Route.Local()`, `Route.LocalNoPersist()`, `Route.EventStoreOnly()`, `Route.Outbox()`, `Route.Both()`, `Route.None()`

:::new
**New in 0.1.0**: Auto-cascade to outbox enables automatic cross-service event publishing from receptor return values without explicit outbox writes.
:::

:::new
**New**: `Route.LocalNoPersist()` and `Route.EventStoreOnly()` provide fine-grained control over event persistence and local dispatch.
:::

### Comparison: Manual vs Auto-Cascade

| Approach | Lines of Code | Injection Dependencies | Error Surface |
|----------|--------------|----------------------|---------------|
| Manual `PublishAsync`/`SendAsync` | More | Requires `IDispatcher` | Higher (can forget) |
| Auto-cascade (tuple return) | Fewer | None | Lower (automatic) |

:::new
**New in 0.1.0**: Auto-cascade now supports both `IEvent` and `ICommand` types. Commands returned from receptors are automatically dispatched to their respective receptors.
:::

### Security Context in Cascade {#cascade-security-context}

When events are cascaded to receptors (via auto-cascade or `CascadeMessageAsync`), **security context automatically propagates** from the source envelope to the new DI scope created for receptor execution.

This ensures cascaded receptors have access to:
- `IMessageContext.UserId` - Original user who initiated the request
- `IMessageContext.TenantId` - Tenant context from the source message
- `IScopeContextAccessor.Current` - Full security scope
- `UserContextManager.TenantContext` - Tenant-scoped context

**Example Flow**:
```csharp{title="Security Context in Cascade" description="Example Flow:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Security", "Context"] unverified="illustrative user-domain flow — security context shown via comments, no assertion"}
// 1. HTTP request with UserId = "user@test.com", TenantId = "tenant-123"
public class OrderCommandHandler : IReceptor<CreateOrder, OrderCreated> {
    private readonly IMessageContext _context;

    public OrderCommandHandler(IMessageContext context) {
        _context = context;
    }

    public ValueTask<OrderCreated> HandleAsync(CreateOrder cmd) {
        // ✅ Security context available: _context.UserId = "user@test.com"
        return ValueTask.FromResult(new OrderCreated(cmd.OrderId));
    }
}

// 2. Event auto-cascades to OrderCreatedReceptor
public class OrderCreatedReceptor : IReceptor<OrderCreated> {
    private readonly IMessageContext _context;
    private readonly UserContextManager _userContext;

    public OrderCreatedReceptor(
        IMessageContext context,
        UserContextManager userContext) {
        _context = context;
        _userContext = userContext;
    }

    public ValueTask HandleAsync(OrderCreated evt) {
        // ✅ Security context propagated from command handler!
        //    _context.UserId = "user@test.com"
        //    _context.TenantId = "tenant-123"
        //    _userContext.TenantContext is set correctly

        return ValueTask.CompletedTask;
    }
}
```

**How It Works**:

The generated `GetUntypedReceptorPublisher` method creates a new DI scope for each cascade and establishes security context before invoking receptors:

```csharp{title="Security Context in Cascade (2)" description="The generated GetUntypedReceptorPublisher method creates a new DI scope for each cascade and establishes security" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Dispatcher", "Security", "Context"] unverified="illustrative generated code (source-generator output)"}
// Generated by Whizbang.Generators
protected override Func<object, IMessageEnvelope?, CancellationToken, Task>?
    GetUntypedReceptorPublisher(Type eventType) {

    if (eventType == typeof(OrderCreated)) {
        async Task PublishToReceptorsUntyped(
            object evt,
            IMessageEnvelope? sourceEnvelope,
            CancellationToken cancellationToken) {

            var scope = _scopeFactory.CreateScope();
            try {
                // ✅ Establish security context from source envelope
                if (sourceEnvelope is not null) {
                    await SecurityContextHelper.EstablishFullContextAsync(
                        sourceEnvelope,
                        scope.ServiceProvider,
                        cancellationToken);
                }

                // Now receptors can access UserId, TenantId via IMessageContext
                var receptors = scope.ServiceProvider
                    .GetServices<IReceptor<OrderCreated>>();

                foreach (var receptor in receptors) {
                    await receptor.HandleAsync((OrderCreated)evt, cancellationToken);
                }
            } finally {
                await scope.DisposeAsync();
            }
        }

        return PublishToReceptorsUntyped;
    }
    // ... other event types
}
```

**Null Envelope Scenarios**:

Some cascade paths don't have a source envelope:
- **RPC Local Invoke** (`CascadeExcludingResponse`) - No envelope available, receptors run without security context
- **System-initiated events** - Timer/scheduler triggers have no user context

In these cases, receptors run without security context, which is expected behavior. If you need security context in these scenarios, establish it explicitly before dispatch using `AsSystem()` or `RunAs()`.

**Key Points**:
- **Automatic propagation**: No manual context passing required
- **New scope per cascade**: Each cascade creates an isolated DI scope
- **AOT compatible**: Zero reflection, compile-time type-switch dispatch
- **Transitive propagation**: Nested dispatches from cascaded receptors inherit security context

:::new
**New**: Security context now automatically propagates through all cascade paths, enabling cascaded receptors to access user and tenant context from the original request.
:::

---

## Emission identity {#emission-identity}
{verified: DispatcherEmissionIdentityTests.CascadeMessageAsync_RetryOfSameHandling_DerivesTheSameEventIdsAsync, EmissionIdentityTests.Derive_SameInputs_ReturnsSameIdAsync, EFCoreOutboxEmissionDedupTests.StoreOutboxMessagesAsync_SameMessageStoredTwice_CountsTheSkippedRowByTypeAsync}

**A retry is not a republish.** A handler's emissions and the completion of the inbox row that drove them are separate commits. When a row is dispatched a second time (its first run's completion never committed, or its lease lapsed and the claim cycle re-offered it), the handler runs again and emits again. With a fresh id minted per emission, every copy is a legitimately new message: appended to the event store, placed in the outbox, published to the transport, and fanned out to every subscriber. Under a bulk operation that shape multiplies: the same bodies are written many times each, at the claim re-offer cadence.

The dispatcher now derives the identity of a cascaded event **from the handling itself**, so the second run produces the same ids and the store's primary keys turn the duplicate into a counted no-op.

### The five inputs

`EmissionIdentity.Derive(sourceMessageId, serviceName, handlerName, emittedTypeName, ordinal)` takes exactly what makes an emission unique across a fleet:

| Input | Why it is part of the identity |
|---|---|
| Source message id | Which handling. Two different inbound messages must never collide. |
| Producing service name | Two services handling the same message must not collide on the wire. |
| Handler name (the inbox row within the service) | Two handler rows of one message in one service must not collide. Threaded in process through `MessageDispatchContext.HandlerName` (`[JsonIgnore]`; persisted and transported envelopes are byte-identical to before). |
| Emitted type name, rendered by `TypeNameFormatter` | The same handling can emit several types. |
| Ordinal within the handling | The same type emitted twice in one handling. `EmissionSequence.Next(handlingKey)` hands out 0, 1, 2, ... per source envelope instance (a `ConditionalWeakTable`, so nothing leaks); a retry materializes a fresh envelope, restarts at zero, and re-derives the same sequence. |

```csharp{
title: "Derive an emission id from the handling"
description: "Identical inputs always yield the identical id; changing any one input (source, service, handler, type, ordinal) yields a different id. The dispatcher calls this for every cascaded event that has a source envelope."
framework: "NET10"
category: "Messaging"
difficulty: "ADVANCED"
tags: ["emission-identity", "idempotency", "cascade", "uuidv7", "retry"]
tests: ["EmissionIdentityTests.Derive_SameInputs_ReturnsSameIdAsync", "EmissionIdentityTests.Derive_DifferentOrdinal_ReturnsDifferentIdAsync", "EmissionIdentityTests.Derive_DifferentHandler_ReturnsDifferentIdAsync", "EmissionIdentityTests.Derive_DifferentService_ReturnsDifferentIdAsync", "EmissionIdentityTests.Derive_DifferentEmittedType_ReturnsDifferentIdAsync", "EmissionIdentityTests.Derive_DifferentSource_ReturnsDifferentIdAsync", "EmissionIdentityTests.Sequence_SameKey_HandsOutConsecutiveOrdinalsFromZeroAsync"]
}
Guid eventId = EmissionIdentity.Derive(
  sourceMessageId: inbound.MessageId.Value,
  serviceName: instanceProvider.ServiceName,
  handlerName: inbound.DispatchContext?.HandlerName,
  emittedTypeName: TypeNameFormatter.Format(typeof(OrderCreated)),
  ordinal: EmissionSequence.Next(inbound));   // 0 for the first OrderCreated of this handling, 1 for the next

// Re-run the same handling (a retry) and the same five inputs come back: the id is identical.
```

### Layout: UUIDv7-shaped, derived entropy
{verified: EmissionIdentityTests.Derive_ResultIsVersion7ShapedWithRfcVariantAsync, EmissionIdentityTests.Derive_ResultIsAcceptedByTheMessageIdValueObjectAsync, EmissionIdentityTests.Derive_InheritsFirst48BitsOfSourceAsync, EmissionIdentityTests.Derive_TwoOrdinals_ShareThePrefixAndDifferInTheHashAsync}

| Bytes | Content |
|---|---|
| 0 to 5 | The first 48 bits of the **source** message id (its UUIDv7 millisecond timestamp when the source is a framework id), so derived ids stay time-local to the message that caused them and keep index locality |
| 6 | Version nibble `7` over the top four bits of the hash |
| 7 | Hash |
| 8 | RFC variant `10xx` over the top two bits of the hash |
| 9 to 15 | Hash |

The hash is SHA-256 over the UTF-8 canonical string `whizbang.emission.v1\n{source:N}\n{service}\n{handler}\n{emittedType}\n{ordinal}`; 74 bits of it land in the id.

Why version 7 rather than the "custom" version 8: the `[WhizbangId]` value objects (`MessageId.From(Guid)`) reject any id that is not v7, and `TrackedGuid` extracts timestamps only from v7. RFC 9562 allows a v7 id's non-timestamp bits to be implementation-chosen data, so a derived v7 is compliant and passes every existing gate exactly like a minted one.

### Where the dispatcher mints
{verified: DispatcherEmissionIdentityTests.CascadeMessageAsync_NoSourceEnvelope_MintsFreshTimeOrderedIdsAsync, DispatcherEmissionIdentityTests.CascadeMessageAsync_SourceWithoutMessageId_MintsFreshIdsAsync, DispatcherEmissionIdentityTests.CascadeMessageAsync_SiblingHandlerRowOfSameMessage_DerivesDistinctEventIdsAsync, DispatcherEmissionIdentityTests.CascadeMessageAsync_TwoServicesHandlingSameMessage_DeriveDistinctEventIdsAsync, DispatcherEmissionIdentityTests.CascadeMessageAsync_DifferentEmittedTypes_DeriveDistinctEventIdsAsync}

Both cascade paths (the result cascade and `CascadeMessageAsync`, which the generated receptor invokers use) mint through one private method. A **root emission**, with no source envelope or a source without a message id, keeps today's behavior: a fresh time-ordered `TrackedGuid`. Everything else derives. The generated `CascadeToOutboxAsync` override already converts the event id it is handed into the outbox `MessageId`, so the derived id reaches the outbox row with no generator change.

**Nested cascades are anchored.** A local cascade hands in-process receptors a `CascadeEnvelopeWrapper` that reports the *inbound* message's id and handler. Without care, a nested receptor emitting the same type as the top-level handler would derive the same id and be silently deduplicated away. The wrapper therefore carries `EmissionAnchor`: the cascaded event's own id (or, for a cascaded command, which has no event id, the next ordinal-derived id of the handling). Emissions through an anchored wrapper derive from the anchor; an unanchored wrapper falls back to the inbound message id. {verified: DispatcherEmissionIdentityTests.CascadeMessageAsync_LocalDispatch_HandsReceptorsAWrapperAnchoredOnTheCascadedEventAsync, DispatcherEmissionIdentityTests.CascadeMessageAsync_LocalDispatchOfACommand_AnchorsOnAnOrdinalOfTheHandlingAsync, DispatcherEmissionIdentityTests.CascadeMessageAsync_EmissionThroughAnAnchoredWrapper_DerivesFromTheAnchorNotTheInboundMessageAsync, DispatcherEmissionIdentityTests.CascadeMessageAsync_EmissionThroughAnUnanchoredWrapper_FallsBackToTheInboundMessageIdAsync}

Each derivation is logged at Debug: `[CASCADE] Emission id derived from source {SourceMessageId} ordinal {Ordinal}: {EventId}`. {verified: DispatcherEmissionIdentityTests.CascadeMessageAsync_DerivedId_IsLoggedAtDebugWithSourceAndOrdinalAsync}

### The store turns the duplicate into a counted no-op
{verified: EFCoreOutboxEmissionDedupTests.StoreOutboxMessagesAsync_SameMessageStoredTwice_CountsTheSkippedRowByTypeAsync, EFCoreOutboxEmissionDedupTests.StoreOutboxMessagesAsync_MixedBatch_CountsOnlyTheRowsThatAlreadyExistedAsync, EFCoreOutboxEmissionDedupTests.StoreOutboxMessagesAsync_WithoutMetricsOrLogger_StillDeduplicatesQuietlyAsync, EFCoreOutboxEmissionDedupTests.StoreOutboxMessagesAsync_InsideAnOpenTransaction_StoresAndCountsOnTheSameConnectionAsync, WorkCoordinatorMetricsTests.WCMetrics_OutboxEmissionDeduplicated_CountsPerMessageTypeAsync}

No SQL change was needed for the deduplication itself: `store_outbox_messages` already inserts with `ON CONFLICT ON CONSTRAINT wh_outbox_pkey DO NOTHING` and returns `(message_id, stream_id, was_newly_created)` per row. What changed is that the EF Core work coordinator now reads those result rows, and for every `was_newly_created = false` it adds one to the passive counter **`whizbang.work_coordinator.outbox.emission_deduplicated`** (meter `Whizbang.WorkCoordinator`, tag `message_type`) and logs a Debug line naming the row. The Dapper coordinator still deduplicates through the same primary key; only the count is not recorded on that driver.

Read the counter as a symptom, not a cost: a sustained non-zero rate means rows are being re-dispatched *after* their emissions committed, which points at the completion path (leases lapsing before completion flushes land, or completion commits failing), not at the handler.

```mermaid{caption="A retry re-derives the same emission ids, so the outbox primary key rejects the second copy and the coordinator counts it on whizbang.work_coordinator.outbox.emission_deduplicated instead of republishing." tests=["DispatcherEmissionIdentityTests.CascadeMessageAsync_RetryOfSameHandling_DerivesTheSameEventIdsAsync", "EFCoreOutboxEmissionDedupTests.StoreOutboxMessagesAsync_SameMessageStoredTwice_CountsTheSkippedRowByTypeAsync"]}
sequenceDiagram
    autonumber
    participant I as Inbox row (message M, handler H)
    participant D as Dispatcher
    participant S as store_outbox_messages
    I->>D: first dispatch of M
    D->>D: OrderCreated id = Derive(M, service, H, type, 0)
    D->>S: store {id}
    S-->>D: was_newly_created = true (published downstream)
    Note over I: completion never lands; lease lapses; M is re-offered
    I->>D: second dispatch of M (fresh envelope, sequence restarts at 0)
    D->>D: OrderCreated id = Derive(M, service, H, type, 0)  (same id)
    D->>S: store {id}
    S-->>D: was_newly_created = false
    D->>D: emission_deduplicated{message_type} + 1, Debug log; nothing republished
```

### Explicit `PublishAsync` inside a handler still mints
{verified: DispatcherEmissionIdentityTests.CascadeMessageAsync_NoSourceEnvelope_MintsFreshTimeOrderedIdsAsync}

Derivation applies to **cascaded** emissions: events returned from a receptor (auto-cascade) or passed through `CascadeMessageAsync` with a source envelope. An explicit `PublishAsync` call from inside a handler is deliberately left non-deterministic. The ambient initiating context carries no handler identity, so two handler rows of one message in one service that both `PublishAsync` the same type would derive identical ids and one of them would be dropped, which is a worse failure than a republish. Until the handler name is threaded into the initiating context, prefer returning events from the receptor when retry safety matters; that path is covered.

### Source service id on published envelopes {#source-service-id}
{verified: OutboxDrainWorkerTests.OutboxDrainWorker_LocalServiceIdLookupFailsOnceAtStartup_ResolvesBeforeTheNextBatchAsync, OutboxDrainWorkerTests.OutboxDrainWorker_LocalServiceIdResolvedAtStartup_DoesNotLookItUpAgainAsync, OutboxDrainWorkerTests.OutboxDrainWorker_LocalServiceIdEmptyAtStartup_WarnsAndRetriesBeforeEachBatchAsync, OutboxDrainWorkerTests.OutboxDrainWorker_LocalServiceIdLookupKeepsFailing_RecordsEachRetryAtDebugAsync}

A related identity fix on the publish side. `OutboxDrainWorker` used to resolve the local service id once at startup; a failed or empty lookup left `Guid.Empty` for the life of the process, every published envelope carried the all-zero `SourceServiceId`, consumers copied it into `wh_inbox.source_service_id` verbatim, and the SQL fallback (`COALESCE`) only ever caught `NULL`. Now:

- The worker resolves the id **before each batch while it is still empty**. On a non-empty answer it stores it, logs EventId 51 at Information (`local service identity resolved to {ServiceId}`) and never looks it up again. A lookup that keeps failing logs EventId 52 at Debug before each retry.
- If startup returned an empty id without throwing, EventId 50 warns that envelopes publish with an empty `SourceServiceId` until a later batch resolves it. The throwing case keeps the existing startup warning and does not double-log.
- On the consumer side, `store_inbox_messages` (migration 146) treats an all-zero `source_service_id` as **unknown**, so the existing fallback to the receiving service's own id applies to envelopes produced by older instances.

---

## Deferred Event Channel {#deferred-event-channel}

When `PublishAsync` is called **outside an active transaction context** (for example from a PostPerspective handler), the event cannot join the current outbox transaction. Instead it is queued on the process-wide, thread-safe `IDeferredOutboxChannel` and written to the outbox in the **next lifecycle loop**: the work coordinator drains the channel (`DrainAll()`) at the start of each cycle and signals that pending work exists so the write happens promptly.

```csharp{
title: "IDeferredOutboxChannel"
description: "In-memory channel for events deferred to the next lifecycle loop"
category: "Architecture"
difficulty: "ADVANCED"
tags: ["Dispatcher", "Cascade", "Outbox", "Deferred"]
tests: ["DeferredOutboxChannelTests.QueueAsync_AddsMessageToPending_SuccessfullyAsync", "DeferredOutboxChannelTests.DrainAll_ReturnsAllQueuedMessages_AndClearsChannelAsync", "DeferredOutboxChannelTests.QueueAsync_PreservesMessageOrder_FIFOAsync"]
}
public interface IDeferredOutboxChannel {
  // Queue a message for deferred outbox write in the next lifecycle loop
  ValueTask QueueAsync(OutboxMessage message, CancellationToken ct = default);

  // Drain all queued messages; called by the work coordinator each cycle
  IReadOnlyList<OutboxMessage> DrainAll();

  // Whether pending messages exist
  bool HasPending { get; }
}
```
