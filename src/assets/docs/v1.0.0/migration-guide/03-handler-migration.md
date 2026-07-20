---
title: Handler Migration
pageType: guide
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Migration Guide
order: 4
description: Converting Wolverine handlers to Whizbang Receptors
tags: 'migration, handlers, receptors, wolverine, conversion'
codeReferences:
  - src/Whizbang.Core/IReceptor.cs
  - src/Whizbang.Core/IDispatcher.cs
  - src/Whizbang.Core/Messaging/IEventStore.cs
  - src/Whizbang.Generators/ReceptorDiscoveryGenerator.cs
testReferences:
  - tests/Whizbang.Core.Tests/Receptors/ReceptorTests.cs
  - tests/Whizbang.Core.Tests/Receptors/VoidReceptorTests.cs
  - tests/Whizbang.Core.Integration.Tests/DispatcherReceptorIntegrationTests.cs
  - tests/Whizbang.Migrate.Tests/Transformers/HandlerToReceptorTransformerTests.cs
lastMaintainedCommit: '01f07906'
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

```csharp{title="Synchronous Handler" description="Synchronous Handler" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Synchronous", "Handler"] unverified="other framework — migration before-state"}
[WolverineHandler]
public class OrderHandler {
    public OrderCreated Handle(CreateOrder command) {
        // Business logic
        return new OrderCreated(Guid.CreateVersion7());
    }
}
```

**Whizbang**:

```csharp{title="Synchronous Handler - CreateOrderReceptor" description="Synchronous Handler - CreateOrderReceptor" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Synchronous", "Handler", "CreateOrderReceptor"] tests=["ReceptorTests.Receive_ValidCommand_ShouldReturnTypeSafeResponseAsync"]}
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    public ValueTask<OrderCreated> HandleAsync(
        CreateOrder message,
        CancellationToken cancellationToken = default) {
        // Business logic
        // TrackedGuid.NewMedo() produces a time-ordered UUIDv7 (implicitly converts to Guid)
        return ValueTask.FromResult(new OrderCreated(TrackedGuid.NewMedo()));
    }
}
```

### Asynchronous Handler

**Wolverine**:

```csharp{title="Asynchronous Handler" description="Asynchronous Handler" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Asynchronous", "Handler"] unverified="other framework — migration before-state"}
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

```csharp{title="Asynchronous Handler - CreateOrderReceptor" description="Asynchronous Handler - CreateOrderReceptor" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Asynchronous", "Handler", "CreateOrderReceptor"] tests=["ReceptorTests.Receive_AsyncOperation_ShouldCompleteAsynchronouslyAsync", "ReceptorTests.Receive_ValidCommand_ShouldReturnTypeSafeResponseAsync"]}
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

```csharp{title="Void Handler (Side Effects Only)" description="Void Handler (Side Effects Only)" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Void", "Handler", "Side"] unverified="other framework — migration before-state"}
[WolverineHandler]
public class NotificationHandler {
    public async Task Handle(SendEmail command, IEmailService emailService) {
        await emailService.SendAsync(command.To, command.Subject, command.Body);
    }
}
```

**Whizbang**:

```csharp{title="Void Handler (Side Effects Only) - SendEmailReceptor" description="Void Handler (Side Effects Only) - SendEmailReceptor" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Void", "Handler", "Side"] tests=["VoidReceptorTests.VoidReceptor_AsynchronousCompletion_ShouldCompleteAsync"]}
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

```csharp{title="Cascading Messages (Tuple Returns)" description="Cascading Messages (Tuple Returns)" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Cascading", "Messages", "Tuple"] unverified="other framework — migration before-state"}
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

```csharp{title="Cascading Messages (Tuple Returns) - CreateOrderReceptor" description="Whizbang (use dispatcher for cascading):" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Cascading", "Messages", "Tuple"]}
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    private readonly IDispatcher _dispatcher;

    public CreateOrderReceptor(IDispatcher dispatcher) {
        _dispatcher = dispatcher;
    }

    public async ValueTask<OrderCreated> HandleAsync(
        CreateOrder message,
        CancellationToken cancellationToken = default) {

        Guid orderId = TrackedGuid.NewMedo();
        var orderCreated = new OrderCreated(orderId);

        // Publish cascading message (routed through the outbox automatically)
        await _dispatcher.PublishAsync(
            new SendOrderConfirmation(message.CustomerEmail, orderId));

        return orderCreated;
    }
}
```

### Handler with Event Store

**Wolverine** (with Marten):

```csharp{title="Handler with Event Store" description="Wolverine (with Marten):" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Handler", "Event", "Store"] unverified="other framework — migration before-state"}
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

```csharp{title="Handler with Event Store - CreateOrderReceptor" description="Handler with Event Store - CreateOrderReceptor" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Handler", "Event", "Store"] unverified="raw IEventStore.AppendAsync — verified in the Event Store docs, not by these receptor tests"}
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    private readonly IEventStore _eventStore;

    public CreateOrderReceptor(IEventStore eventStore) {
        _eventStore = eventStore;
    }

    public async ValueTask<OrderCreated> HandleAsync(
        CreateOrder message,
        CancellationToken cancellationToken = default) {

        Guid streamId = TrackedGuid.NewMedo();
        var @event = new OrderCreated(streamId);

        // The message overload creates (or retrieves) the envelope automatically,
        // preserving tracing context (hops, correlation, causation).
        await _eventStore.AppendAsync(streamId, @event, cancellationToken);
        return @event;
    }
}
```

> **Note**: In most Whizbang applications you don't need to append manually at all — events returned from a receptor are automatically cascaded to the event store and outbox by the dispatcher (see [Outbox Migration](07-outbox-migration.md)).

### Multiple Handlers → Multiple Receptors

**Wolverine** (one class, multiple handlers):

```csharp{title="Multiple Handlers → Multiple Receptors" description="Wolverine (one class, multiple handlers):" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Multiple", "Handlers"] unverified="other framework — migration before-state"}
[WolverineHandler]
public class OrderHandlers {
    public OrderCreated Handle(CreateOrder command) { ... }
    public OrderShipped Handle(ShipOrder command) { ... }
    public OrderCancelled Handle(CancelOrder command) { ... }
}
```

**Whizbang** (one receptor per message):

```csharp{title="Multiple Handlers → Multiple Receptors - CreateOrderReceptor" description="Whizbang (one receptor per message):" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Multiple", "Handlers"] unverified="structural illustration — one receptor per message type, bodies elided"}
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

```csharp{title="Wolverine Method Injection" description="Wolverine (dependencies injected per method):" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Wolverine", "Method", "Injection"] unverified="other framework — migration before-state"}
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

```csharp{title="Whizbang Constructor Injection" description="Whizbang (standard DI via constructor):" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Whizbang", "Constructor", "Injection"]}
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
- [ ] Implement `IReceptor<TMessage, TResponse>` or `IReceptor<TMessage>`
- [ ] Rename method to `HandleAsync`
- [ ] Change return type to `ValueTask<TResponse>` or `ValueTask`
- [ ] Add `CancellationToken` parameter
- [ ] Convert method injection to constructor injection
- [ ] Split multi-handler classes into separate receptors
- [ ] Use `TrackedGuid.NewMedo()` (from `Whizbang.Core.ValueObjects`) for new IDs
- [ ] Update namespace usings

## Automated Migration

The `whizbang-migrate` tool can automate handler migration:

```bash{title="Automated Migration" description="The whizbang-migrate tool can automate handler migration:" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "Bash", "Automated", "Migration"]}
# Analyze the project (finds Wolverine handlers and Marten projections)
whizbang-migrate analyze --project ./MyApp.sln

# Preview transformations without modifying files
whizbang-migrate apply --project ./MyApp.sln --dry-run --include '**/*Handler.cs'

# Apply handler transformations
whizbang-migrate apply --project ./MyApp.sln --include '**/*Handler.cs'
```

---

*Previous: [Project Setup](02-project-setup.md) | Next: [Projection Migration](04-projection-migration.md)*
