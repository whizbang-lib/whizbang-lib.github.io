# Migrate from Marten/Wolverine: Outbox Migration

This guide covers migrating from Wolverine's durable outbox to Whizbang's `IWorkCoordinator`.

## Overview

| Wolverine | Whizbang |
|-----------|----------|
| `UseDurableOutbox()` | Built-in via `IWorkCoordinator` |
| `IMessageContext` | `IWorkCoordinator` |
| Message envelope persistence | Automatic with event store |

## Basic Outbox Usage

### Before: Wolverine Durable Outbox

```csharp
public class OrderHandler : IHandle<CreateOrderCommand> {
  public async Task Handle(CreateOrderCommand command, IMessageContext context) {
    var orderId = Guid.NewGuid();
    var @event = new OrderCreated(orderId, command.CustomerId);

    // Outbox ensures event is sent even if process crashes
    await context.SendAsync(new ProcessPaymentCommand(orderId));
    await context.PublishAsync(@event);
  }
}
```

### After: Whizbang Work Coordinator

```csharp
public class CreateOrderReceptor : IReceptor<CreateOrderCommand, OrderCreatedResult> {
  private readonly IEventStore _eventStore;
  private readonly IWorkCoordinator _workCoordinator;
  private readonly IDispatcher _dispatcher;

  public CreateOrderReceptor(
    IEventStore eventStore,
    IWorkCoordinator workCoordinator,
    IDispatcher dispatcher) {
    _eventStore = eventStore;
    _workCoordinator = workCoordinator;
    _dispatcher = dispatcher;
  }

  public async ValueTask<OrderCreatedResult> HandleAsync(
    CreateOrderCommand command,
    CancellationToken ct) {

    var orderId = Guid.NewGuid();
    var @event = new OrderCreated(orderId, command.CustomerId);

    // Begin coordinated work unit
    await using var work = await _workCoordinator.BeginAsync(ct);

    // Append event (persisted to outbox)
    await _eventStore.AppendAsync(orderId, @event, ct);

    // Schedule outgoing messages (persisted to outbox)
    await work.ScheduleAsync(new ProcessPaymentCommand(orderId));
    await work.ScheduleAsync(@event); // For publishing

    // Commit atomically - events and messages are sent together
    await work.CommitAsync(ct);

    return new OrderCreatedResult(orderId);
  }
}
```

## Work Coordinator Patterns

### Transactional Consistency

All operations within a work unit are atomic:

```csharp
await using var work = await _workCoordinator.BeginAsync(ct);

// These are all persisted together
await _eventStore.AppendAsync(orderStreamId, new OrderCreated(...), ct);
await _eventStore.AppendAsync(inventoryStreamId, new InventoryReserved(...), ct);
await work.ScheduleAsync(new NotifyCustomerCommand(...));

// If this fails, nothing is persisted
await work.CommitAsync(ct);
```

### Automatic Retry

Work coordinator handles transient failures:

```csharp
builder.Services.AddWhizbang(options => {
    options.ConfigureWorkCoordinator(wc => {
        wc.MaxRetries = 3;
        wc.RetryDelay = TimeSpan.FromSeconds(5);
        wc.ExponentialBackoff = true;
    });
});
```

### Message Scheduling

Schedule messages for future delivery:

```csharp
await using var work = await _workCoordinator.BeginAsync(ct);

// Send immediately after commit
await work.ScheduleAsync(new OrderConfirmation(orderId));

// Send after delay
await work.ScheduleAsync(
    new OrderReminderEmail(orderId),
    delay: TimeSpan.FromHours(24));

// Send at specific time
await work.ScheduleAsync(
    new OrderExpirationCheck(orderId),
    deliverAt: DateTimeOffset.UtcNow.AddDays(30));

await work.CommitAsync(ct);
```

## Saga/Process Manager Migration

### Before: Wolverine Saga

```csharp
public class OrderSaga : Saga {
  public Guid OrderId { get; set; }
  public bool PaymentReceived { get; set; }
  public bool InventoryReserved { get; set; }

  public void Handle(OrderCreated @event) {
    OrderId = @event.OrderId;
  }

  public async Task Handle(PaymentReceived @event, IMessageContext context) {
    PaymentReceived = true;
    await CheckCompletion(context);
  }

  public async Task Handle(InventoryReserved @event, IMessageContext context) {
    InventoryReserved = true;
    await CheckCompletion(context);
  }

  private async Task CheckCompletion(IMessageContext context) {
    if (PaymentReceived && InventoryReserved) {
      await context.PublishAsync(new OrderCompleted(OrderId));
      MarkCompleted();
    }
  }
}
```

### After: Whizbang Process Manager

```csharp
public record OrderProcessState {
  public Guid OrderId { get; init; }
  public bool PaymentReceived { get; init; }
  public bool InventoryReserved { get; init; }
  public bool IsComplete => PaymentReceived && InventoryReserved;
}

public class OrderProcessPerspective
  : IPerspectiveFor<OrderProcessState, OrderCreated, PaymentReceived, InventoryReserved> {

  public OrderProcessState Apply(OrderProcessState? current, OrderCreated @event) {
    return new OrderProcessState { OrderId = @event.OrderId };
  }

  public OrderProcessState Apply(OrderProcessState? current, PaymentReceived @event) {
    return current! with { PaymentReceived = true };
  }

  public OrderProcessState Apply(OrderProcessState? current, InventoryReserved @event) {
    return current! with { InventoryReserved = true };
  }
}

public class OrderCompletionReceptor : IReceptor<PaymentReceived, Unit>,
                                        IReceptor<InventoryReserved, Unit> {
  private readonly IEventStore _eventStore;
  private readonly IWorkCoordinator _workCoordinator;
  private readonly IPerspectiveReader _perspectives;

  public async ValueTask<Unit> HandleAsync(PaymentReceived @event, CancellationToken ct) {
    await CheckAndCompleteAsync(@event.OrderId, ct);
    return Unit.Value;
  }

  public async ValueTask<Unit> HandleAsync(InventoryReserved @event, CancellationToken ct) {
    await CheckAndCompleteAsync(@event.OrderId, ct);
    return Unit.Value;
  }

  private async Task CheckAndCompleteAsync(Guid orderId, CancellationToken ct) {
    var state = await _perspectives.GetAsync<OrderProcessState>(orderId, ct);

    if (state?.IsComplete == true) {
      await using var work = await _workCoordinator.BeginAsync(ct);
      await _eventStore.AppendAsync(orderId, new OrderCompleted(orderId), ct);
      await work.CommitAsync(ct);
    }
  }
}
```

## Outbox Monitoring

### Health Checks

```csharp
builder.Services.AddHealthChecks()
    .AddWhizbangOutbox(); // Monitors outbox queue depth

// Access metrics
app.MapGet("/metrics/outbox", async (IOutboxMetrics metrics) => {
    return new {
        PendingMessages = await metrics.GetPendingCountAsync(),
        OldestMessage = await metrics.GetOldestMessageAgeAsync(),
        ProcessingRate = metrics.GetProcessingRate()
    };
});
```

### Dashboard Integration

```csharp
builder.Services.AddWhizbang(options => {
    options.ConfigureWorkCoordinator(wc => {
        wc.EnableDashboard = true; // Enables /whizbang/outbox endpoint
    });
});
```

## Configuration Options

```csharp
builder.Services.AddWhizbang(options => {
    options.ConfigureWorkCoordinator(wc => {
        // Retry configuration
        wc.MaxRetries = 5;
        wc.InitialRetryDelay = TimeSpan.FromSeconds(1);
        wc.MaxRetryDelay = TimeSpan.FromMinutes(5);
        wc.ExponentialBackoff = true;

        // Processing configuration
        wc.BatchSize = 100;
        wc.ProcessingInterval = TimeSpan.FromSeconds(1);

        // Cleanup configuration
        wc.RetentionPeriod = TimeSpan.FromDays(7);
        wc.CleanupInterval = TimeSpan.FromHours(1);

        // Concurrency
        wc.MaxConcurrentProcessing = 10;
    });
});
```

## Database Schema

The work coordinator uses these tables (auto-created):

```sql
-- Outbox messages pending delivery
CREATE TABLE whizbang.outbox_messages (
    id UUID PRIMARY KEY,
    message_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    correlation_id TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    scheduled_at TIMESTAMPTZ,
    attempts INT DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    last_error TEXT
);

-- Successfully processed messages (for idempotency)
CREATE TABLE whizbang.processed_messages (
    message_id UUID PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL
);
```

## Checklist

- [ ] Replace `IMessageContext` with `IWorkCoordinator`
- [ ] Wrap related operations in `BeginAsync()`/`CommitAsync()`
- [ ] Convert saga state to perspective
- [ ] Convert saga handlers to receptors
- [ ] Configure retry and cleanup policies
- [ ] Set up outbox monitoring
- [ ] Test failure scenarios (process crash, network issues)
- [ ] Verify message idempotency

## Next Steps

- [Testing Migration](./08-testing-migration.md) - Update testing patterns
