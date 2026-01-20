# Migrate from Marten/Wolverine: Concept Mapping

This document maps core concepts between Marten/Wolverine and Whizbang.

## Core Concept Translations

| Marten/Wolverine | Whizbang | Key Differences |
|------------------|----------|-----------------|
| `IDocumentStore` | `IEventStore` | Stream-based, simple `AppendAsync(streamId, message, ct)` |
| `IHandle<TMessage>` | `IReceptor<TMessage, TResult>` | Returns typed result, source-generator discovered |
| `IHandle<TMessage>` (sync logic) | `ISyncReceptor<TMessage, TResult>` | For pure computation without async operations |
| `[WolverineHandler]` | *No attribute needed* | Source generator discovers `IReceptor`/`ISyncReceptor` |
| `SingleStreamProjection<T>` | `IPerspectiveFor<TModel, TEvent...>` | Pure function `Apply()`, multiple event types via variadic interface |
| `MultiStreamProjection<T>` | `IGlobalPerspectiveFor<TModel>` | Global perspectives for cross-stream aggregation |
| `UseDurableOutbox()` | Built-in outbox via `IWorkCoordinator` | Database-backed with configurable strategies |
| `IMessageBus.PublishAsync()` | `IDispatcher.PublishAsync()` | Fire-and-forget event broadcasting |
| `IMessageBus.SendAsync()` | `IDispatcher.SendAsync()` | Command dispatch with delivery receipt |
| `IMessageBus.InvokeAsync<T>()` | `IDispatcher.LocalInvokeAsync<T>()` | In-process RPC with typed result |
| `Guid.NewGuid()` / `Guid.CreateVersion7()` | `IWhizbangIdProvider.NewGuid()` | Inject interface, UUIDv7 via Medo, testable |

## Handler Migration

### Wolverine Handler (Before)
```csharp
public class OrderHandler {
  [WolverineHandler]
  public async Task Handle(CreateOrderCommand command, IDocumentSession session) {
    var order = new Order(command.CustomerId, command.Items);
    session.Store(order);
    await session.SaveChangesAsync();
  }
}
```

### Whizbang Receptor (After - Preferred: Tuple Return)
```csharp
public class CreateOrderReceptor(IWhizbangIdProvider idProvider)
    : IReceptor<CreateOrderCommand, (OrderCreatedResult, OrderCreated)> {

  public ValueTask<(OrderCreatedResult, OrderCreated)> ReceiveAsync(
      CreateOrderCommand command,
      CancellationToken ct) {
    var orderId = idProvider.NewGuid();
    var @event = new OrderCreated(orderId, command.CustomerId, command.Items);

    // Return tuple - OrderCreated is AUTO-PUBLISHED to perspectives + outbox
    return ValueTask.FromResult((new OrderCreatedResult(orderId), @event));
  }
}
```

The framework automatically extracts and publishes any `IEvent` instances from the return value. This pattern:
- **Eliminates dispatcher dependency** when only publishing events
- **Makes side effects explicit** in the return type
- **Enables easier testing** (assert return values, no mock setup needed)

## Projection Migration

### Marten Projection (Before)
```csharp
public class OrderProjection : SingleStreamProjection<OrderView> {
  public OrderView Create(OrderCreated @event) {
    return new OrderView {
      Id = @event.OrderId,
      CustomerId = @event.CustomerId,
      Status = OrderStatus.Created
    };
  }

  public void Apply(OrderShipped @event, OrderView view) {
    view.Status = OrderStatus.Shipped;
    view.ShippedAt = @event.ShippedAt;
  }
}
```

### Whizbang Perspective (After)
```csharp
public class OrderPerspective : IPerspectiveFor<OrderView, OrderCreated, OrderShipped> {
  // Creation event - nullable parameter, handles initial creation
  public OrderView Apply(OrderView? current, OrderCreated @event) {
    return new OrderView {
      Id = @event.OrderId,
      CustomerId = @event.CustomerId,
      Status = OrderStatus.Created
    };
  }

  // Update event - [MustExist] ensures model exists, non-nullable parameter
  [MustExist]
  public OrderView Apply(OrderView current, OrderShipped @event) {
    return current with {
      Status = OrderStatus.Shipped,
      ShippedAt = @event.ShippedAt
    };
  }
}
```

The `[MustExist]` attribute tells the generator to produce a null check before calling Apply:
```csharp
// Generated code
case OrderShipped typedEvent:
  if (currentModel == null)
    throw new InvalidOperationException(
      "OrderView must exist when applying OrderShipped in OrderPerspective");
  return perspective.Apply(currentModel, typedEvent);
```

## Key Differences

### 1. Discovery Mechanism
- **Wolverine**: Uses attributes and runtime reflection
- **Whizbang**: Uses source generators for compile-time discovery (AOT-compatible)

### 2. Return Types
- **Wolverine**: Handlers return `void` or `Task`
- **Whizbang**: Receptors return typed results via `IReceptor<TMessage, TResult>`

### 3. Projection Model
- **Marten**: Mutable projections with `Apply(event, view)` pattern
- **Whizbang**: Immutable perspectives with pure `Apply(current, event) => new` pattern

### 4. Event Store
- **Marten**: Document-centric with event sourcing bolted on
- **Whizbang**: Stream-first design with explicit stream IDs

### 5. Message Context
- **Wolverine**: `MessageContext` for accessing message metadata
- **Whizbang**: `MessageEnvelope<T>` with `Hops` for distributed tracing (auto-created by Dispatcher)

## Dispatcher Patterns

Whizbang provides three distinct dispatch patterns via `IDispatcher`:

### PublishAsync - Fire-and-Forget
```csharp
// Broadcast event to all interested subscribers
await _dispatcher.PublishAsync(new OrderCreated(orderId, customerId));
```

### SendAsync - Command Dispatch
```csharp
// Send command to single handler, await delivery acknowledgment
await _dispatcher.SendAsync(new ProcessPaymentCommand(orderId, amount));
```

### LocalInvokeAsync - In-Process RPC
```csharp
// Invoke handler in-process and get typed result
var result = await _dispatcher.LocalInvokeAsync<ProcessPaymentCommand, PaymentResult>(
    new ProcessPaymentCommand(orderId, amount));
```

## Automated Migration

The `whizbang migrate` CLI can automatically transform most patterns:

```bash
# Analyze what needs migration
whizbang migrate analyze --project ./src/MyService

# Apply transformations
whizbang migrate apply --project ./src/MyService --guided
```

The tool handles:
- Handler to Receptor transformation
- Projection to Perspective transformation
- `IDocumentStore` to `IEventStore` transformation
- Session removal (`LightweightSession`, `QuerySession`)
- `SaveChangesAsync` removal (each `AppendAsync` is atomic)
- `Guid.NewGuid()` / `Guid.CreateVersion7()` to `IWhizbangIdProvider.NewGuid()` (adds constructor injection)
- `[MustExist]` suggestions for Apply methods with non-nullable model parameter
- DI registration updates
- Using directive changes
