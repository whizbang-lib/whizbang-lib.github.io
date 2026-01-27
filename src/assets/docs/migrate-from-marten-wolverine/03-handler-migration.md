# Migrate from Marten/Wolverine: Handler Migration

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

### After: Whizbang Receptor (Preferred: Tuple Return)

```csharp
public class CreateOrderReceptor : IReceptor<CreateOrderCommand, (OrderCreatedResult, OrderCreated)> {
  public ValueTask<(OrderCreatedResult, OrderCreated)> HandleAsync(
    CreateOrderCommand command,
    CancellationToken ct) {

    var orderId = Guid.NewGuid();
    var @event = new OrderCreated(orderId, command.CustomerId, command.Items);

    // Return tuple - OrderCreated is AUTO-PUBLISHED to perspectives + outbox
    return ValueTask.FromResult((new OrderCreatedResult(orderId), @event));
  }
}
```

:::tip[Auto-Cascade]
When a receptor returns a tuple or array containing `IEvent` instances, the framework automatically extracts and publishes them. This is the **preferred pattern** - no `IDispatcher` dependency needed for simple event publishing.
:::

:::note[Sync vs Async Receptors]
Handlers can be migrated to either **async** (`IReceptor<T, TResult>`) or **sync** (`ISyncReceptor<T, TResult>`) receptors. Use sync receptors when your handler performs pure computation without any `await` operations. See [Synchronous Handlers](#synchronous-handlers-no-async-operations) section below for when to use each pattern and matching examples.
:::

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

### After: Tuple Return with Auto-Cascade (Preferred)

```csharp
public class CreateOrderReceptor : IReceptor<CreateOrderCommand, (OrderCreatedResult, OrderCreated)> {
  public ValueTask<(OrderCreatedResult, OrderCreated)> HandleAsync(
    CreateOrderCommand command,
    CancellationToken ct) {

    var orderId = Guid.NewGuid();
    var @event = new OrderCreated(orderId, command.CustomerId, command.Amount);

    // Return tuple - OrderCreated is AUTO-PUBLISHED
    // A separate receptor listening for OrderCreated handles payment processing
    return ValueTask.FromResult((new OrderCreatedResult(orderId), @event));
  }
}

// Separate receptor handles payment when OrderCreated is published
public class PaymentReceptor : IReceptor<OrderCreated, Unit> {
  private readonly IPaymentService _paymentService;

  public PaymentReceptor(IPaymentService paymentService) {
    _paymentService = paymentService;
  }

  public async ValueTask<Unit> HandleAsync(OrderCreated @event, CancellationToken ct) {
    await _paymentService.ProcessPaymentAsync(@event.OrderId, @event.Amount, ct);
    return Unit.Value;
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

## Synchronous Handlers (No Async Operations)

:::new
For handlers that perform pure computation without any async operations, use `ISyncReceptor` to avoid `ValueTask.FromResult()` ceremony:
:::

### Before: Handler with No Async Operations

```csharp
public class CalculateTaxHandler : IHandle<CalculateTaxCommand> {
  public Task Handle(CalculateTaxCommand command) {
    var tax = command.Amount * command.TaxRate;
    // No async operations - just computation
    return Task.CompletedTask;
  }
}
```

### After: Sync Receptor (Clean Pattern)

```csharp
public class CalculateTaxReceptor : ISyncReceptor<CalculateTaxCommand, TaxResult> {
  public TaxResult Handle(CalculateTaxCommand command) {
    var tax = command.Amount * command.TaxRate;
    return new TaxResult(tax);
    // No ValueTask.FromResult() needed!
  }
}
```

### When to Use ISyncReceptor

| Use `ISyncReceptor` | Use `IReceptor` (async) |
|---------------------|-------------------------|
| Pure computation | Database access |
| In-memory transformations | External API calls |
| Validation logic | File I/O |
| ID generation | Message queue operations |
| Calculations | Any `await` operation |

### Sync Receptor with Events (Auto-Cascade Still Works)

```csharp
public class CreateOrderReceptor : ISyncReceptor<CreateOrder, (OrderResult, OrderCreated)> {
  public (OrderResult, OrderCreated) Handle(CreateOrder message) {
    var orderId = Guid.CreateVersion7();
    var total = message.Items.Sum(i => i.Quantity * i.UnitPrice);

    return (
      new OrderResult(orderId),
      new OrderCreated(orderId, message.CustomerId, total, DateTimeOffset.UtcNow)
    );
    // OrderCreated is AUTO-PUBLISHED - same as async!
  }
}
```

### Void Sync Receptor (Side Effects Only)

```csharp
public class LoggingReceptor : ISyncReceptor<OrderCreated> {
  private readonly ILogger<LoggingReceptor> _logger;

  public LoggingReceptor(ILogger<LoggingReceptor> logger) {
    _logger = logger;
  }

  public void Handle(OrderCreated @event) {
    _logger.LogInformation("Order {OrderId} created", @event.OrderId);
    // No return value, no Unit type needed
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

## Common Migration Scenarios

The following scenarios address patterns commonly found in Wolverine codebases.

### Scenario H01: IHandle Interface Implementation

**Wolverine Pattern (Before):**
```csharp
public class OrderInitializeHandler : IHandle<OrderInitializeCommand> {
  private readonly IOrderService _service;

  public OrderInitializeHandler(IOrderService service) {
    _service = service;
  }

  public async Task Handle(OrderInitializeCommand message, CancellationToken ct) {
    await _service.InitializeAsync(message, ct);
  }
}
```

**Whizbang Pattern (After):**
```csharp
public class OrderInitializeReceptor(IOrderService service)
    : IReceptor<OrderInitializeCommand, Unit> {
  public async ValueTask<Unit> HandleAsync(
      OrderInitializeCommand message,
      CancellationToken ct) {
    await service.InitializeAsync(message, ct);
    return Unit.Value;
  }
}
```

**Key Differences:**
- `IHandle<T>` becomes `IReceptor<T, TResult>` interface
- No `[WolverineHandler]` attribute needed - source generator discovers receptors
- Explicit return type (`Unit` for void operations)

**CLI Transformation:** `whizbang migrate apply` detects `IHandle<T>` implementations and transforms to `IReceptor<T, TResult>`.

---

### Scenario H02: Static Handler Methods

**Wolverine Pattern (Before):**
```csharp
public static class OrderHandlers {
  public static async Task Handle(CreateOrderCommand msg, IOrderService service, CancellationToken ct) {
    await service.CreateAsync(msg, ct);
  }

  public static async Task Handle(UpdateOrderCommand msg, IOrderService service, CancellationToken ct) {
    await service.UpdateAsync(msg, ct);
  }
}
```

**Whizbang Pattern (After):**
```csharp
// Separate receptor classes - no static methods
public class CreateOrderReceptor(IOrderService service)
    : IReceptor<CreateOrderCommand, OrderResult> {
  public async ValueTask<OrderResult> HandleAsync(CreateOrderCommand msg, CancellationToken ct) {
    return await service.CreateAsync(msg, ct);
  }
}

public class UpdateOrderReceptor(IOrderService service)
    : IReceptor<UpdateOrderCommand, OrderResult> {
  public async ValueTask<OrderResult> HandleAsync(UpdateOrderCommand msg, CancellationToken ct) {
    return await service.UpdateAsync(msg, ct);
  }
}
```

**Key Differences:**
- Convert static methods to instance-based receptor classes
- Each receptor is independently discoverable
- Cleaner organization by message type
- Dependencies injected via constructor

**CLI Transformation:** `whizbang migrate apply` extracts static handlers to separate receptor classes.

---

### Scenario H03: Handlers with Return Values

**Wolverine Pattern (Before):**
```csharp
public class StartActivityCommandHandler : IHandle<StartActivityCommand> {
  private readonly IActivityService _service;

  public StartActivityCommandHandler(IActivityService service) {
    _service = service;
  }

  // Wolverine infers return from method signature
  public async Task<ActivityStartedEvent> Handle(StartActivityCommand message, CancellationToken ct) {
    return await _service.StartActivityAsync(message, ct);
  }
}
```

**Whizbang Pattern (After):**
```csharp
public class StartActivityReceptor(IActivityService service)
    : IReceptor<StartActivityCommand, (ActivityResult, ActivityStartedEvent)> {
  public async ValueTask<(ActivityResult, ActivityStartedEvent)> HandleAsync(
      StartActivityCommand message,
      CancellationToken ct) {
    var @event = await service.StartActivityAsync(message, ct);
    return (new ActivityResult(@event.ActivityId), @event);
    // ActivityStartedEvent is AUTO-PUBLISHED
  }
}
```

**Key Differences:**
- RPC return is now a tuple containing both result and event
- Event is automatically published when returned in tuple
- Cleaner separation of response data vs domain events

---

### Scenario H04: In-Process Handler Invocation

**Wolverine Pattern (Before):**
```csharp
// Wolverine supports in-process invocation via IMessageBus
public class ActivityOrchestrator {
  private readonly IMessageBus _bus;

  public async Task<ActivityResult> OrchestrateAsync(StartActivityCommand command, CancellationToken ct) {
    // InvokeAsync runs handler in-process
    return await _bus.InvokeAsync<ActivityResult>(command, ct);
  }
}
```

**Whizbang Pattern (After):**
```csharp
// Use LocalInvokeAsync directly - no wrapper needed
public class ActivityOrchestrator(IDispatcher dispatcher)
    : IReceptor<StartActivityCommand, ActivityResult> {
  public async ValueTask<ActivityResult> HandleAsync(
      StartActivityCommand message,
      CancellationToken ct) {
    // LocalInvokeAsync provides in-process RPC semantics
    return await dispatcher.LocalInvokeAsync<StartActivityCommand, ActivityResult>(
        message, ct);
  }
}
```

**Key Differences:**
- No `LocalMessage<T>` wrapper needed
- `IDispatcher.LocalInvokeAsync<T>()` provides in-process execution
- Type-safe with compile-time result type checking

---

### Scenario H05: Handler with Notification Service

**Wolverine Pattern (Before):**
```csharp
public class OrderHandler : IHandle<OrderCommand> {
  private readonly IOrderService _service;
  private readonly INotificationService _notifications;

  public OrderHandler(IOrderService service, INotificationService notifications) {
    _service = service;
    _notifications = notifications;
  }

  public async Task Handle(OrderCommand msg, CancellationToken ct) {
    await _service.ProcessAsync(msg, ct);
    await _notifications.NotifyAsync(new OrderUpdatedNotification(msg.OrderId), ct);
  }
}
```

**Whizbang Pattern (After):**
```csharp
public class OrderReceptor(
    IOrderService service,
    INotificationService notifications)
    : IReceptor<OrderCommand, (OrderResult, OrderUpdated)> {

  public async ValueTask<(OrderResult, OrderUpdated)> HandleAsync(
      OrderCommand msg,
      CancellationToken ct) {
    await service.ProcessAsync(msg, ct);
    await notifications.NotifyAsync(new OrderUpdatedNotification(msg.OrderId), ct);

    var @event = new OrderUpdated(msg.OrderId);
    return (new OrderResult(msg.OrderId), @event);
  }
}
```

**Key Differences:**
- Same DI pattern for notification service
- Event returned in tuple for auto-publishing
- Notification service can be any implementation

---

### Scenario H06: Handler with Correlation Context

**Wolverine Pattern (Before):**
```csharp
public class OrderHandler : IHandle<CreateOrderCommand> {
  private readonly IMessageContext _context;

  public OrderHandler(IMessageContext context) {
    _context = context;
  }

  public async Task Handle(CreateOrderCommand msg, CancellationToken ct) {
    var correlationId = _context.CorrelationId;
    // Use correlation for downstream calls
  }
}
```

**Whizbang Pattern (After):**
```csharp
public class CreateOrderReceptor
    : IReceptor<MessageEnvelope<CreateOrderCommand>, OrderResult> {

  public ValueTask<OrderResult> HandleAsync(
      MessageEnvelope<CreateOrderCommand> envelope,
      CancellationToken ct) {
    // Access correlation from envelope hops
    var correlationId = envelope.CurrentHop?.CorrelationId;
    var command = envelope.Payload;

    // Process with full message context available
    return ValueTask.FromResult(new OrderResult(command.OrderId));
  }
}
```

**Key Differences:**
- Wrap message type in `MessageEnvelope<T>` to access context
- `Hops` property provides correlation, causation, and tracing info
- No separate token provider needed - context flows with envelope

---

### Scenario H07: Handler with Telemetry/Tracing

**Wolverine Pattern (Before):**
```csharp
public class OrderHandler : IHandle<CreateOrderCommand> {
  private readonly ActivitySource _activitySource;

  public OrderHandler(ActivitySource activitySource) {
    _activitySource = activitySource;
  }

  public async Task Handle(CreateOrderCommand msg, CancellationToken ct) {
    using var activity = _activitySource.StartActivity("CreateOrder");
    activity?.SetTag("orderId", msg.OrderId);

    // Process order
  }
}
```

**Whizbang Pattern (After):**
```csharp
public class CreateOrderReceptor(ActivitySource activitySource)
    : IReceptor<CreateOrderCommand, OrderResult> {

  public async ValueTask<OrderResult> HandleAsync(
      CreateOrderCommand msg,
      CancellationToken ct) {
    using var activity = activitySource.StartActivity("CreateOrder");
    activity?.SetTag("orderId", msg.OrderId);

    // Process order - same pattern works
    return new OrderResult(msg.OrderId);
  }
}
```

**Key Differences:**
- Same `ActivitySource` pattern works in Whizbang
- Consider using `ITraceStore` for persistent message tracing
- Whizbang provides built-in observability via `MessageEnvelope.Hops`

:::tip[Built-in Tracing]
Whizbang automatically tracks message flow via `MessageEnvelope.Hops`. For custom spans, inject `ActivitySource` as shown above.
:::

---

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
