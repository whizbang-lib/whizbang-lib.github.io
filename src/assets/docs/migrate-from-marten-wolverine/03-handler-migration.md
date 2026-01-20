# Handler Migration

This guide covers migrating Wolverine handlers to Whizbang Receptors.

## Overview

| Wolverine | Whizbang |
|-----------|----------|
| `IHandle<TMessage>` | `IReceptor<TMessage, TResult>` |
| `[WolverineHandler]` attribute | No attribute needed |
| Returns `void`/`Task` | Returns typed `TResult` |
| Runtime discovery | Compile-time source generation |

## Basic Handler Migration

### Before: Wolverine Handler

```csharp
public class CreateOrderHandler : IHandle<CreateOrderCommand> {
  private readonly IDocumentSession _session;

  public CreateOrderHandler(IDocumentSession session) {
    _session = session;
  }

  public async Task Handle(CreateOrderCommand command) {
    var order = new Order {
      Id = Guid.NewGuid(),
      CustomerId = command.CustomerId,
      Items = command.Items,
      Status = OrderStatus.Created
    };

    _session.Store(order);
    await _session.SaveChangesAsync();
  }
}
```

### After: Whizbang Receptor

```csharp
public class CreateOrderReceptor : IReceptor<CreateOrderCommand, OrderCreatedResult> {
  private readonly IEventStore _eventStore;
  private readonly IDispatcher _dispatcher;

  public CreateOrderReceptor(IEventStore eventStore, IDispatcher dispatcher) {
    _eventStore = eventStore;
    _dispatcher = dispatcher;
  }

  public async ValueTask<OrderCreatedResult> HandleAsync(
    CreateOrderCommand command,
    CancellationToken ct) {

    var orderId = Guid.NewGuid();
    var @event = new OrderCreated(orderId, command.CustomerId, command.Items);

    await _eventStore.AppendAsync(orderId, @event, ct);
    await _dispatcher.PublishAsync(@event, ct);

    return new OrderCreatedResult(orderId);
  }
}
```

## Key Migration Steps

### 1. Change Interface

Replace `IHandle<TMessage>` with `IReceptor<TMessage, TResult>`:

```csharp
// Before
public class MyHandler : IHandle<MyCommand>

// After
public class MyReceptor : IReceptor<MyCommand, MyResult>
```

### 2. Update Method Signature

Change from `Handle` to `HandleAsync` with return type:

```csharp
// Before
public async Task Handle(MyCommand command)

// After
public async ValueTask<MyResult> HandleAsync(MyCommand command, CancellationToken ct)
```

### 3. Replace IDocumentSession with IEventStore

```csharp
// Before
private readonly IDocumentSession _session;
_session.Store(entity);
await _session.SaveChangesAsync();

// After
private readonly IEventStore _eventStore;
await _eventStore.AppendAsync(streamId, @event, ct);
```

### 4. Replace IMessageBus with IDispatcher

```csharp
// Before
await _messageBus.PublishAsync(@event);
await _messageBus.SendAsync(command);

// After
await _dispatcher.PublishAsync(@event, ct);
await _dispatcher.SendAsync(command, ct);
```

### 5. Create Result Type

Define a result type for the receptor:

```csharp
public record OrderCreatedResult(Guid OrderId);
```

## Handlers with Dependencies

### Before: Cascading Messages

```csharp
public class OrderHandler : IHandle<CreateOrderCommand> {
  public async Task Handle(CreateOrderCommand command, IMessageBus bus) {
    var orderId = Guid.NewGuid();
    // ... create order logic

    // Cascade to payment processing
    await bus.SendAsync(new ProcessPaymentCommand(orderId, command.Amount));
  }
}
```

### After: Explicit Dispatch

```csharp
public class CreateOrderReceptor : IReceptor<CreateOrderCommand, OrderCreatedResult> {
  private readonly IEventStore _eventStore;
  private readonly IDispatcher _dispatcher;

  public CreateOrderReceptor(IEventStore eventStore, IDispatcher dispatcher) {
    _eventStore = eventStore;
    _dispatcher = dispatcher;
  }

  public async ValueTask<OrderCreatedResult> HandleAsync(
    CreateOrderCommand command,
    CancellationToken ct) {

    var orderId = Guid.NewGuid();
    var @event = new OrderCreated(orderId, command.CustomerId, command.Amount);

    await _eventStore.AppendAsync(orderId, @event, ct);
    await _dispatcher.PublishAsync(@event, ct);

    // Explicit command dispatch
    await _dispatcher.SendAsync(
      new ProcessPaymentCommand(orderId, command.Amount), ct);

    return new OrderCreatedResult(orderId);
  }
}
```

## Event Handlers

### Before: Event Handler

```csharp
public class OrderShippedHandler : IHandle<OrderShipped> {
  private readonly IDocumentSession _session;

  public async Task Handle(OrderShipped @event) {
    var order = await _session.LoadAsync<Order>(@event.OrderId);
    order.Status = OrderStatus.Shipped;
    order.ShippedAt = @event.ShippedAt;
    await _session.SaveChangesAsync();
  }
}
```

### After: Event Receptor

For side effects (sending notifications, external API calls):

```csharp
public class OrderShippedReceptor : IReceptor<OrderShipped, Unit> {
  private readonly INotificationService _notifications;

  public OrderShippedReceptor(INotificationService notifications) {
    _notifications = notifications;
  }

  public async ValueTask<Unit> HandleAsync(OrderShipped @event, CancellationToken ct) {
    await _notifications.SendOrderShippedEmail(@event.OrderId, ct);
    return Unit.Value;
  }
}
```

For state updates, use Perspectives instead (see [Projection Migration](./04-projection-migration.md)).

## Handlers Without Return Values

For handlers that don't need to return data, use `Unit`:

```csharp
public class LoggingReceptor : IReceptor<OrderCreated, Unit> {
  private readonly ILogger<LoggingReceptor> _logger;

  public LoggingReceptor(ILogger<LoggingReceptor> logger) {
    _logger = logger;
  }

  public ValueTask<Unit> HandleAsync(OrderCreated @event, CancellationToken ct) {
    _logger.LogInformation("Order {OrderId} created", @event.OrderId);
    return ValueTask.FromResult(Unit.Value);
  }
}
```

## Middleware/Pipeline Behaviors

### Before: Wolverine Middleware

```csharp
public class LoggingMiddleware {
  public async Task Before(ILogger logger, Envelope envelope) {
    logger.LogInformation("Handling {MessageType}", envelope.Message?.GetType().Name);
  }
}
```

### After: Whizbang Pipeline Behavior

```csharp
public class LoggingBehavior<TMessage, TResult> : IPipelineBehavior<TMessage, TResult>
  where TMessage : notnull {

  private readonly ILogger<LoggingBehavior<TMessage, TResult>> _logger;

  public LoggingBehavior(ILogger<LoggingBehavior<TMessage, TResult>> logger) {
    _logger = logger;
  }

  public async ValueTask<TResult> HandleAsync(
    TMessage message,
    PipelineDelegate<TMessage, TResult> next,
    CancellationToken ct) {

    _logger.LogInformation("Handling {MessageType}", typeof(TMessage).Name);
    var result = await next(message, ct);
    _logger.LogInformation("Handled {MessageType}", typeof(TMessage).Name);
    return result;
  }
}
```

Register behaviors:

```csharp
builder.Services.AddWhizbang(options => {
    options.AddPipelineBehavior(typeof(LoggingBehavior<,>));
});
```

## Automated Migration

Use the CLI tool to automate handler migration:

```bash
# Preview changes
whizbang migrate analyze --project ./src/MyService --type handlers

# Apply with review
whizbang migrate apply --project ./src/MyService --type handlers --guided
```

The tool will:
1. Find all `IHandle<T>` implementations
2. Generate corresponding `IReceptor<T, TResult>` classes
3. Create result types
4. Update DI registrations
5. Preserve your business logic

## Checklist

- [ ] Replace `IHandle<T>` with `IReceptor<T, TResult>`
- [ ] Update method signature to `HandleAsync` with `CancellationToken`
- [ ] Create result types for each receptor
- [ ] Replace `IDocumentSession` with `IEventStore`
- [ ] Replace `IMessageBus` with `IDispatcher`
- [ ] Convert middleware to pipeline behaviors
- [ ] Remove `[WolverineHandler]` attributes (no longer needed)
- [ ] Update using directives
- [ ] Run tests to verify behavior

## Next Steps

- [Projection Migration](./04-projection-migration.md) - Convert Marten projections to Perspectives
