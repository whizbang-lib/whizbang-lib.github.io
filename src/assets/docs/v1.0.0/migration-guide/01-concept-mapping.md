---
title: Concept Mapping
pageType: guide
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Migration Guide
order: 2
description: How Marten/Wolverine concepts translate to Whizbang equivalents
tags: 'migration, marten, wolverine, concepts, mapping'
codeReferences:
  - src/Whizbang.Core/IReceptor.cs
  - src/Whizbang.Core/IDispatcher.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveFor.cs
  - src/Whizbang.Core/Messaging/IEventStore.cs
  - src/Whizbang.Core/Perspectives/IGlobalPerspectiveFor.cs
testReferences:
  - tests/Whizbang.Core.Tests/Messaging/IEventStoreDefaultMethodTests.cs
  - tests/Whizbang.Core.Tests/Messaging/EventStoreAppendBatchTests.cs
  - tests/Whizbang.Core.Tests/Dispatcher/DispatcherLocalInvokeAndSyncTests.cs
  - tests/Whizbang.Core.Tests/Dispatcher/DispatcherDeliveryReceiptTests.cs
lastMaintainedCommit: '01f07906'
---

# Concept Mapping: Marten/Wolverine → Whizbang

This guide maps concepts from the Marten/Wolverine ("Critter Stack") to their Whizbang equivalents.

## Core Concept Mapping Table

| Marten/Wolverine | Whizbang | Key Differences |
|------------------|----------|-----------------|
| `IDocumentStore` | `IEventStore` | Stream-based, generic `AppendAsync<TMessage>()` |
| `IDocumentSession` | Injected via DI | No session concept; use `IEventStore` directly |
| `session.Events.Append()` | `eventStore.AppendAsync(streamId, @event)` | Explicit stream ID; envelope auto-resolved from the dispatch (or pass a `MessageEnvelope<T>` explicitly) |
| `IHandle<TMessage>` | `IReceptor<TMessage, TResult>` | Returns typed result, source-generator discovered |
| `IHandle<TMessage>` (void) | `IReceptor<TMessage>` | Void receptor for side-effect-only handlers |
| `[WolverineHandler]` | *No attribute needed* | Source generator discovers `IReceptor` implementations |
| `SingleStreamProjection<T>` | `IPerspectiveFor<TModel, TEvent...>` | Pure function `Apply()`, variadic for multiple events |
| `MultiStreamProjection<T>` | `IGlobalPerspectiveFor<TModel, TPartitionKey, TEvent…>` | Global perspectives for cross-stream aggregation, partitioned by an explicit key |
| Async projections (daemon) | `PerspectiveWorker` | Background worker with checkpointing |
| `UseDurableOutbox()` | Built-in outbox via `IWorkCoordinator` | Database-backed with configurable strategies |
| `IMessageBus` | `IDispatcher` | Three patterns: `SendAsync`, `LocalInvokeAsync`, `PublishAsync` |
| `AddMarten()` | `services.AddWhizbang()` | Fluent builder pattern |
| `UseWolverine()` | Implicit via source generators | Receptors auto-discovered at compile time |

## Handler/Receptor Mapping

### Wolverine Handler Patterns

```csharp{title="Wolverine Handler Patterns" description="Wolverine Handler Patterns" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Wolverine", "Handler", "Patterns"] unverified="other framework — migration before-state"}
// Wolverine: Attribute-based discovery
[WolverineHandler]
public class OrderHandler {
    // Sync handler
    public OrderCreated Handle(CreateOrder command) {
        return new OrderCreated(command.OrderId);
    }

    // Async handler
    public async Task<OrderShipped> HandleAsync(ShipOrder command) {
        return new OrderShipped(command.OrderId);
    }

    // Cascading via tuple return
    public (OrderCreated, SendEmail) Handle(CreateOrderWithNotification command) {
        return (
            new OrderCreated(command.OrderId),
            new SendEmail(command.CustomerEmail)
        );
    }
}
```

### Whizbang Receptor Equivalents

```csharp{title="Whizbang Receptor Equivalents" description="Whizbang Receptor Equivalents" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Whizbang", "Receptor", "Equivalents"] unverified="illustrative receptor definitions — user code, no framework behavior asserted"}
// Whizbang: Interface-based discovery (no attributes)
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    public ValueTask<OrderCreated> HandleAsync(
        CreateOrder message,
        CancellationToken ct = default) {
        return ValueTask.FromResult(new OrderCreated(message.OrderId));
    }
}

public class ShipOrderReceptor : IReceptor<ShipOrder, OrderShipped> {
    public async ValueTask<OrderShipped> HandleAsync(
        ShipOrder message,
        CancellationToken ct = default) {
        // Async operations here
        return new OrderShipped(message.OrderId);
    }
}

// Cascading: Use dispatcher to publish additional messages
public class CreateOrderWithNotificationReceptor : IReceptor<CreateOrderWithNotification, OrderCreated> {
    private readonly IDispatcher _dispatcher;

    public CreateOrderWithNotificationReceptor(IDispatcher dispatcher) {
        _dispatcher = dispatcher;
    }

    public async ValueTask<OrderCreated> HandleAsync(
        CreateOrderWithNotification message,
        CancellationToken ct = default) {

        var result = new OrderCreated(message.OrderId);
        await _dispatcher.PublishAsync(new SendEmail(message.CustomerEmail));
        return result;
    }
}
```

## Projection/Perspective Mapping

### Marten Single-Stream Projection

```csharp{title="Marten Single-Stream Projection" description="Marten Single-Stream Projection" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-Guide", "Marten", "Single-Stream", "Projection"] unverified="other framework — migration before-state"}
// Marten: Can mutate, can have side effects
public class OrderSummaryProjection : SingleStreamProjection<OrderSummary> {
    public OrderSummary Create(OrderCreated @event) {
        return new OrderSummary {
            Id = @event.OrderId,
            Status = OrderStatus.Created,
            Total = @event.Total
        };
    }

    public void Apply(OrderShipped @event, OrderSummary model) {
        model.Status = OrderStatus.Shipped;  // Mutation!
        model.ShippedAt = @event.Timestamp;
    }
}
```

### Whizbang Perspective Equivalent

```csharp{title="Whizbang Perspective Equivalent" description="Whizbang Perspective Equivalent" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Whizbang", "Perspective", "Equivalent"] unverified="illustrative perspective definition — user code, pure Apply shown"}
// Whizbang: Pure functions, returns new model
public class OrderSummaryPerspective :
    IPerspectiveFor<OrderSummary, OrderCreated, OrderShipped> {

    public OrderSummary Apply(OrderSummary current, OrderCreated @event) {
        return new OrderSummary {
            Id = @event.OrderId,
            Status = OrderStatus.Created,
            Total = @event.Total
        };
    }

    public OrderSummary Apply(OrderSummary current, OrderShipped @event) {
        return current with {
            Status = OrderStatus.Shipped,
            ShippedAt = @event.Timestamp
        };
    }
}
```

## Event Store Mapping

### Marten Event Store

```csharp{title="Marten Event Store" description="Marten Event Store" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Marten", "Event", "Store"] unverified="other framework — migration before-state"}
// Marten: Session-based
public class OrderService {
    private readonly IDocumentStore _store;

    public async Task CreateOrderAsync(CreateOrder command) {
        await using var session = _store.LightweightSession();

        var @event = new OrderCreated(command.OrderId, command.Items);
        session.Events.Append(command.OrderId, @event);

        await session.SaveChangesAsync();
    }
}
```

### Whizbang Event Store

```csharp{title="Whizbang Event Store" description="Whizbang Event Store" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Whizbang", "Event", "Store"] unverified="raw IEventStore.AppendAsync — verified in the Event Store docs, not by these migration tests"}
// Whizbang: Direct injection, explicit envelope
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    private readonly IEventStore _eventStore;

    public CreateOrderReceptor(IEventStore eventStore) {
        _eventStore = eventStore;
    }

    public async ValueTask<OrderCreated> HandleAsync(
        CreateOrder message,
        CancellationToken ct = default) {

        var @event = new OrderCreated(message.OrderId, message.Items);

        // Raw-message overload: the envelope (with tracing context) is resolved
        // automatically from the dispatch via IEnvelopeRegistry. An explicit
        // AppendAsync(streamId, MessageEnvelope<T>, ct) overload also exists.
        await _eventStore.AppendAsync(message.OrderId, @event, ct);
        return @event;
    }
}
```

## Transport Mapping

| Wolverine Transport | Whizbang Transport | Package |
|---------------------|--------------------|---------|
| `Wolverine.RabbitMQ` | `Whizbang.Transports.RabbitMQ` | `AddRabbitMQTransport()` |
| `Wolverine.AzureServiceBus` | `Whizbang.Transports.AzureServiceBus` | `AddAzureServiceBusTransport()` |
| `Wolverine.Kafka` | *Not yet available* | Planned |

## Dispatch Pattern Mapping

### Wolverine Message Bus

```csharp{title="Wolverine Message Bus" description="Wolverine Message Bus" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Wolverine", "Message", "Bus"] unverified="other framework — migration before-state"}
// Wolverine: Single pattern
await _bus.SendAsync(command);
await _bus.PublishAsync(@event);
await _bus.InvokeAsync<OrderCreated>(command);
```

### Whizbang Dispatcher

```csharp{title="Whizbang Dispatcher" description="Whizbang Dispatcher" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Whizbang", "Dispatcher"] tests=["DispatcherDeliveryReceiptTests.PublishAsync_EventWithStreamId_DeliveryReceiptHasStreamIdAsync"]}
// Whizbang: Three distinct patterns
// 1. SendAsync - Command with delivery receipt (can go over wire)
IDeliveryReceipt receipt = await _dispatcher.SendAsync(command);

// 2. LocalInvokeAsync - In-process RPC (ValueTask-based, pooled fast path)
var result = await _dispatcher.LocalInvokeAsync<CreateOrder, OrderCreated>(command);

// 3. PublishAsync - Event broadcasting (also returns a delivery receipt)
await _dispatcher.PublishAsync(@event);
```

## Key Differences Summary

1. **Discovery**: Wolverine uses attributes; Whizbang uses interfaces (source-generated)
2. **Projections**: Marten allows mutation; Whizbang requires pure functions
3. **Sessions**: Marten uses document sessions; Whizbang uses direct event store
4. **Dispatch**: Wolverine has unified bus; Whizbang has three specialized patterns
5. **AOT**: Wolverine has partial support; Whizbang is AOT-native

---

*Next: [Project Setup](02-project-setup.md)*
