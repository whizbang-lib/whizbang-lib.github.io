---
title: Handler Migration
version: 1.0.0
category: Migration Guide
order: 4
description: Converting Wolverine handlers to Whizbang Receptors
tags: 'migration, handlers, receptors, wolverine, conversion'
codeReferences:
  - src/Whizbang.Core/IReceptor.cs
  - src/Whizbang.Generators/ReceptorDiscoveryGenerator.cs
---

# Handler Migration: Wolverine → Whizbang Receptors

This guide covers converting Wolverine message handlers to Whizbang Receptors.

## Key Differences

| Aspect | Wolverine Handler | Whizbang Receptor |
|--------|-------------------|-------------------|
| Discovery | `[WolverineHandler]` attribute | `IReceptor<T>` interface |
| Return type | Method return type | Generic type parameter |
| Method name | `Handle` or `HandleAsync` | `HandleAsync` (always) |
| Async | Optional `Task<T>` | Always `ValueTask<T>` |
| Void handlers | Return `void` or `Task` | `IReceptor<TMessage>` |

## Basic Handler Migration

### Synchronous Handler

**Wolverine**:

```csharp
[WolverineHandler]
public class OrderHandler {
    public OrderCreated Handle(CreateOrder command) {
        // Business logic
        return new OrderCreated(Guid.CreateVersion7());
    }
}
```

**Whizbang**:

```csharp
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    public ValueTask<OrderCreated> HandleAsync(
        CreateOrder message,
        CancellationToken cancellationToken = default) {
        // Business logic
        return ValueTask.FromResult(new OrderCreated(Guid.CreateVersion7()));
    }
}
```

### Asynchronous Handler

**Wolverine**:

```csharp
[WolverineHandler]
public class OrderHandler {
    private readonly IOrderRepository _repository;

    public async Task<OrderCreated> HandleAsync(CreateOrder command) {
        var order = await _repository.CreateAsync(command);
        return new OrderCreated(order.Id);
    }
}
```

**Whizbang**:

```csharp
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    private readonly IOrderRepository _repository;

    public CreateOrderReceptor(IOrderRepository repository) {
        _repository = repository;
    }

    public async ValueTask<OrderCreated> HandleAsync(
        CreateOrder message,
        CancellationToken cancellationToken = default) {
        var order = await _repository.CreateAsync(message, cancellationToken);
        return new OrderCreated(order.Id);
    }
}
```

### Void Handler (Side Effects Only)

**Wolverine**:

```csharp
[WolverineHandler]
public class NotificationHandler {
    public async Task Handle(SendEmail command, IEmailService emailService) {
        await emailService.SendAsync(command.To, command.Subject, command.Body);
    }
}
```

**Whizbang**:

```csharp
public class SendEmailReceptor : IReceptor<SendEmail> {
    private readonly IEmailService _emailService;

    public SendEmailReceptor(IEmailService emailService) {
        _emailService = emailService;
    }

    public async ValueTask HandleAsync(
        SendEmail message,
        CancellationToken cancellationToken = default) {
        await _emailService.SendAsync(
            message.To,
            message.Subject,
            message.Body,
            cancellationToken);
    }
}
```

## Advanced Patterns

### Cascading Messages (Tuple Returns)

**Wolverine**:

```csharp
[WolverineHandler]
public class OrderHandler {
    public (OrderCreated, SendOrderConfirmation) Handle(CreateOrder command) {
        var orderId = Guid.CreateVersion7();
        return (
            new OrderCreated(orderId),
            new SendOrderConfirmation(command.CustomerEmail, orderId)
        );
    }
}
```

**Whizbang** (use dispatcher for cascading):

```csharp
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    private readonly IDispatcher _dispatcher;

    public CreateOrderReceptor(IDispatcher dispatcher) {
        _dispatcher = dispatcher;
    }

    public async ValueTask<OrderCreated> HandleAsync(
        CreateOrder message,
        CancellationToken cancellationToken = default) {

        var orderId = Guid.CreateVersion7();
        var orderCreated = new OrderCreated(orderId);

        // Publish cascading message
        await _dispatcher.PublishAsync(
            new SendOrderConfirmation(message.CustomerEmail, orderId),
            cancellationToken);

        return orderCreated;
    }
}
```

### Handler with Event Store

**Wolverine** (with Marten):

```csharp
[WolverineHandler]
public class OrderHandler {
    public async Task<OrderCreated> HandleAsync(
        CreateOrder command,
        IDocumentSession session) {

        var @event = new OrderCreated(Guid.CreateVersion7());
        session.Events.Append(command.OrderId, @event);
        await session.SaveChangesAsync();
        return @event;
    }
}
```

**Whizbang**:

```csharp
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    private readonly IEventStore _eventStore;

    public CreateOrderReceptor(IEventStore eventStore) {
        _eventStore = eventStore;
    }

    public async ValueTask<OrderCreated> HandleAsync(
        CreateOrder message,
        CancellationToken cancellationToken = default) {

        var streamId = Guid.CreateVersion7();
        var @event = new OrderCreated(streamId);

        var envelope = new MessageEnvelope<OrderCreated> {
            MessageId = MessageId.From(Guid.CreateVersion7()),
            Payload = @event
        };

        await _eventStore.AppendAsync(streamId, envelope, cancellationToken);
        return @event;
    }
}
```

### Multiple Handlers → Multiple Receptors

**Wolverine** (one class, multiple handlers):

```csharp
[WolverineHandler]
public class OrderHandlers {
    public OrderCreated Handle(CreateOrder command) { ... }
    public OrderShipped Handle(ShipOrder command) { ... }
    public OrderCancelled Handle(CancelOrder command) { ... }
}
```

**Whizbang** (one receptor per message):

```csharp
// Separate classes for each message type
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    public ValueTask<OrderCreated> HandleAsync(CreateOrder message, CancellationToken ct) { ... }
}

public class ShipOrderReceptor : IReceptor<ShipOrder, OrderShipped> {
    public ValueTask<OrderShipped> HandleAsync(ShipOrder message, CancellationToken ct) { ... }
}

public class CancelOrderReceptor : IReceptor<CancelOrder, OrderCancelled> {
    public ValueTask<OrderCancelled> HandleAsync(CancelOrder message, CancellationToken ct) { ... }
}
```

## Dependency Injection

### Wolverine Method Injection

**Wolverine** (dependencies injected per method):

```csharp
[WolverineHandler]
public class OrderHandler {
    public async Task<OrderCreated> HandleAsync(
        CreateOrder command,
        IOrderRepository repository,  // Method injection
        ILogger<OrderHandler> logger) {

        logger.LogInformation("Creating order");
        var order = await repository.CreateAsync(command);
        return new OrderCreated(order.Id);
    }
}
```

### Whizbang Constructor Injection

**Whizbang** (standard DI via constructor):

```csharp
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    private readonly IOrderRepository _repository;
    private readonly ILogger<CreateOrderReceptor> _logger;

    public CreateOrderReceptor(
        IOrderRepository repository,
        ILogger<CreateOrderReceptor> logger) {
        _repository = repository;
        _logger = logger;
    }

    public async ValueTask<OrderCreated> HandleAsync(
        CreateOrder message,
        CancellationToken cancellationToken = default) {

        _logger.LogInformation("Creating order");
        var order = await _repository.CreateAsync(message, cancellationToken);
        return new OrderCreated(order.Id);
    }
}
```

## Naming Conventions

| Wolverine | Whizbang |
|-----------|----------|
| `OrderHandler` | `CreateOrderReceptor`, `ShipOrderReceptor` |
| `Handle` | `HandleAsync` |
| `HandleAsync` | `HandleAsync` |
| Multiple handlers in one class | One receptor per message type |

## Migration Checklist

- [ ] Remove `[WolverineHandler]` attribute
- [ ] Implement `IReceptor<TMessage, TResult>` or `IReceptor<TMessage>`
- [ ] Rename method to `HandleAsync`
- [ ] Change return type to `ValueTask<TResult>` or `ValueTask`
- [ ] Add `CancellationToken` parameter
- [ ] Convert method injection to constructor injection
- [ ] Split multi-handler classes into separate receptors
- [ ] Update namespace usings

## Automated Migration

The `whizbang-migrate` tool can automate handler migration:

```bash
# Analyze handlers
whizbang migrate analyze --project ./MyApp.sln --filter handlers

# Preview transformations
whizbang migrate plan --project ./MyApp.sln --filter handlers

# Apply with review
whizbang migrate apply --mode guided --filter handlers
```

---

*Previous: [Project Setup](02-project-setup.md) | Next: [Projection Migration](04-projection-migration.md)*
