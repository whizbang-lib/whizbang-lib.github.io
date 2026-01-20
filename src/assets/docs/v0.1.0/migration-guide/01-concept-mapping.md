---
title: "Concept Mapping"
version: 0.1.0
category: Migration Guide
order: 2
description: "How Marten/Wolverine concepts translate to Whizbang equivalents"
tags: migration, marten, wolverine, concepts, mapping
codeReferences:
  - src/Whizbang.Core/IReceptor.cs
  - src/Whizbang.Core/IDispatcher.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveFor.cs
  - src/Whizbang.Core/Messaging/IEventStore.cs
---

# Concept Mapping: Marten/Wolverine → Whizbang

This guide maps concepts from the Marten/Wolverine ("Critter Stack") to their Whizbang equivalents.

## Core Concept Mapping Table

| Marten/Wolverine | Whizbang | Key Differences |
|------------------|----------|-----------------|
| `IDocumentStore` | `IEventStore` | Stream-based, generic `AppendAsync<TMessage>()` |
| `IDocumentSession` | Injected via DI | No session concept; use `IEventStore` directly |
| `session.Events.Append()` | `eventStore.AppendAsync<T>(streamId, envelope)` | Explicit stream ID, `MessageEnvelope` wrapper |
| `IHandle<TMessage>` | `IReceptor<TMessage, TResult>` | Returns typed result, source-generator discovered |
| `IHandle<TMessage>` (void) | `IReceptor<TMessage>` | Void receptor for side-effect-only handlers |
| `[WolverineHandler]` | *No attribute needed* | Source generator discovers `IReceptor` implementations |
| `SingleStreamProjection<T>` | `IPerspectiveFor<TModel, TEvent...>` | Pure function `Apply()`, variadic for multiple events |
| `MultiStreamProjection<T>` | `IGlobalPerspectiveFor<TModel>` | Global perspectives for cross-stream aggregation |
| Async projections (daemon) | `PerspectiveWorker` | Background worker with checkpointing |
| `UseDurableOutbox()` | Built-in outbox via `IWorkCoordinator` | Database-backed with configurable strategies |
| `IMessageBus` | `IDispatcher` | Three patterns: `SendAsync`, `LocalInvokeAsync`, `PublishAsync` |
| `AddMarten()` | `services.AddWhizbang()` | Fluent builder pattern |
| `UseWolverine()` | Implicit via source generators | Receptors auto-discovered at compile time |

## Handler/Receptor Mapping

### Wolverine Handler Patterns

```csharp
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

```csharp
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
        await _dispatcher.PublishAsync(new SendEmail(message.CustomerEmail), ct);
        return result;
    }
}
```

## Projection/Perspective Mapping

### Marten Single-Stream Projection

```csharp
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

```csharp
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

```csharp
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

```csharp
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

        var envelope = new MessageEnvelope<OrderCreated> {
            MessageId = MessageId.From(Guid.CreateVersion7()),
            Payload = @event
        };

        await _eventStore.AppendAsync(message.OrderId, envelope, ct);
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

```csharp
// Wolverine: Single pattern
await _bus.SendAsync(command);
await _bus.PublishAsync(@event);
await _bus.InvokeAsync<OrderCreated>(command);
```

### Whizbang Dispatcher

```csharp
// Whizbang: Three distinct patterns
// 1. SendAsync - Command with delivery receipt (can go over wire)
var receipt = await _dispatcher.SendAsync(command);

// 2. LocalInvokeAsync - In-process RPC (< 20ns, zero allocation)
var result = await _dispatcher.LocalInvokeAsync<CreateOrder, OrderCreated>(command);

// 3. PublishAsync - Event broadcasting (fire-and-forget)
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
