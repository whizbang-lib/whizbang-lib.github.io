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
| `Guid.NewGuid()` / `Guid.CreateVersion7()` | `OrderId.New()` / `TrackedGuid.NewMedo()` | Strongly-typed IDs with UUIDv7 via Medo, no DI needed |

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
public class CreateOrderReceptor
    : ISyncReceptor<CreateOrderCommand, (OrderCreatedResult, OrderCreated)> {

  public (OrderCreatedResult, OrderCreated) Receive(CreateOrderCommand command) {
    var orderId = OrderId.New();  // UUIDv7 with sub-millisecond precision
    var @event = new OrderCreated(orderId, command.CustomerId, command.Items);

    // Return tuple - OrderCreated is AUTO-PUBLISHED to perspectives + outbox
    return (new OrderCreatedResult(orderId), @event);
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

## Common ID Generation Migration Scenarios

This section documents migration patterns for ID generation. Each scenario has a unique ID for traceability to automated migration tests.

---

### Scenario G01: Guid.NewGuid() to Strongly-Typed ID

**Marten/Wolverine Pattern (Before):**

```csharp
public class OrderHandler : IHandle<CreateOrderCommand> {
  private readonly IDocumentSession _session;

  public async Task Handle(CreateOrderCommand command, CancellationToken ct) {
    var orderId = Guid.NewGuid();

    _session.Events.StartStream<Order>(
        orderId,
        new OrderCreated(orderId, command.CustomerId, command.Items)
    );

    await _session.SaveChangesAsync(ct);
  }
}
```

**Whizbang Pattern (After):**

```csharp
public class CreateOrderReceptor
    : ISyncReceptor<CreateOrderCommand, (OrderCreatedResult, OrderCreated)> {

    public (OrderCreatedResult, OrderCreated) Receive(CreateOrderCommand command) {
        // Strongly-typed ID with UUIDv7 generation
        var orderId = OrderId.New();

        return (
            new OrderCreatedResult(orderId),
            new OrderCreated(orderId, command.CustomerId, command.Items)
        );
    }
}

// Define strongly-typed ID using Vogen
[ValueObject<Guid>]
public partial struct OrderId {
    public static OrderId New() => From(TrackedGuid.NewMedo());
}
```

**Key Differences:**

- `Guid.NewGuid()` becomes `OrderId.New()` (strongly-typed)
- Vogen generates compile-time value object with equality, serialization
- `TrackedGuid.NewMedo()` provides UUIDv7 with sub-millisecond precision
- Type system prevents mixing up IDs (e.g., `OrderId` vs `CustomerId`)

**CLI Transformation:**

- [x] Supported by `whizbang migrate apply`
- Suggests creating strongly-typed ID wrappers

**Test Coverage:**

- `TransformAsync_G01_GuidNewGuid_TransformsToIdProviderNewGuid`

---

### Scenario G02: CombGuid to TrackedGuid.NewMedo()

**Marten/Wolverine Pattern (Before):**

```csharp
using Marten.Schema.Identity;

public class StreamIdGenerator {
  public Guid GenerateStreamId() {
    // CombGuid generates sequential GUIDs for better database index performance
    return CombGuidIdGeneration.NewGuid();
  }
}

public class OrderHandler : IHandle<CreateOrderCommand> {
  private readonly StreamIdGenerator _idGenerator;

  public async Task Handle(CreateOrderCommand command, CancellationToken ct) {
    var orderId = _idGenerator.GenerateStreamId();
    // ...
  }
}
```

**Whizbang Pattern (After):**

```csharp
public class CreateOrderReceptor
    : ISyncReceptor<CreateOrderCommand, (OrderCreatedResult, OrderCreated)> {

    public (OrderCreatedResult, OrderCreated) Receive(CreateOrderCommand command) {
        // TrackedGuid.NewMedo() generates time-ordered UUIDv7
        // Equivalent to CombGuid but standardized and more precise
        var orderId = OrderId.New(); // Uses TrackedGuid.NewMedo() internally

        return (
            new OrderCreatedResult(orderId),
            new OrderCreated(orderId, command.CustomerId, command.Items)
        );
    }
}
```

**Key Differences:**

- `CombGuidIdGeneration.NewGuid()` → `TrackedGuid.NewMedo()`
- MEDO (monotonic, epoch-based, distributed, ordered) algorithm
- Better precision than CombGuid (sub-millisecond vs millisecond)
- Standardized UUIDv7 format per RFC 9562
- No external dependency (built into Whizbang.Core)

**CLI Transformation:**

- [x] Supported by `whizbang migrate apply`
- Direct replacement: `CombGuidIdGeneration.NewGuid()` → `TrackedGuid.NewMedo()`

**Test Coverage:**

- `TransformAsync_G02_CombGuidIdGeneration_TransformsToTrackedGuid`

---

### Scenario G03: Default StreamId Check Pattern

**Marten/Wolverine Pattern (Before):**

```csharp
public class OrderHandler : IHandle<CreateOrderCommand> {
  public async Task Handle(CreateOrderCommand command, CancellationToken ct) {
    var @event = new OrderCreated(/* ... */);

    // Pattern: Check if StreamId is default (not set), then generate
    if (@event.StreamId == default) {
      @event = @event with { StreamId = Guid.NewGuid() };
    }

        _session.Events.StartStream<Order>(@event.StreamId, @event);
        await _session.SaveChangesAsync(ct);
    }
}
```

**Whizbang Pattern (After):**

```csharp
public class CreateOrderReceptor
    : ISyncReceptor<CreateOrderCommand, (OrderCreatedResult, OrderCreated)> {

    public (OrderCreatedResult, OrderCreated) Receive(CreateOrderCommand command) {
        // Always generate ID upfront - never rely on default checks
        var orderId = OrderId.New();

        var @event = new OrderCreated(orderId, command.CustomerId, command.Items);

        return (new OrderCreatedResult(orderId), @event);
    }
}

// Event record with required OrderId - compiler prevents default values
public sealed record OrderCreated(
    OrderId OrderId,  // Required, non-nullable
    CustomerId CustomerId,
    IReadOnlyList<OrderItem> Items
) : IEvent;
```

**Key Differences:**

- No `default` checks needed - generate ID at creation time
- Strongly-typed IDs prevent accidental `default(Guid)` usage
- Record with required constructor parameters enforces initialization
- Compiler catches missing ID at compile time, not runtime

**CLI Transformation:**

- [x] Supported by `whizbang migrate apply`
- Warning: "Remove default StreamId checks - generate IDs at creation"

**Test Coverage:**

- `TransformAsync_G03_DefaultStreamIdCheck_RemovedWithWarning`

---

### Scenario G04: Collision Retry Pattern

**Marten/Wolverine Pattern (Before):**

```csharp
public class OrderHandler : IHandle<CreateOrderCommand> {
  private const int MaxRetryAttempts = 5;
  private readonly IDocumentSession _session;

  public async Task Handle(CreateOrderCommand command, CancellationToken ct) {
    for (var attempt = 0; attempt < MaxRetryAttempts; attempt++) {
      try {
        var orderId = Guid.NewGuid();

        _session.Events.StartStream<Order>(
            orderId,
            new OrderCreated(orderId, command.CustomerId, command.Items)
        );
        await _session.SaveChangesAsync(ct);
        return; // Success
      } catch (Exception ex) when (ex.Message.Contains("duplicate key")) {
        if (attempt == MaxRetryAttempts - 1) throw;
        // Retry with new ID on collision
      }
    }
  }
}
```

**Whizbang Pattern (After):**

```csharp
public class CreateOrderReceptor
    : ISyncReceptor<CreateOrderCommand, (OrderCreatedResult, OrderCreated)> {

    public (OrderCreatedResult, OrderCreated) Receive(CreateOrderCommand command) {
        // TrackedGuid.NewMedo() is virtually collision-free
        // - Time-based component ensures temporal ordering
        // - 62 bits of randomness per millisecond
        // - Collision probability: ~1 in 4.6 quintillion per millisecond
        var orderId = OrderId.New();

        return (
            new OrderCreatedResult(orderId),
            new OrderCreated(orderId, command.CustomerId, command.Items)
        );
    }
}
```

**Key Differences:**

- No retry logic needed with `TrackedGuid.NewMedo()`
- UUIDv7 combines timestamp + random for practical collision immunity
- Simpler, more maintainable code
- If retries are still needed (external reasons), use Polly policies at infrastructure level

**CLI Transformation:**

- [x] Supported by `whizbang migrate apply`
- Warning: "Consider if GUID collision retry is still needed with TrackedGuid"

**Test Coverage:**

- `TransformAsync_G04_CollisionRetry_SimplifiedWithWarning`

---

## Scenario Coverage Matrix: ID Generation

| Scenario | Pattern | CLI Support | Test |
|----------|---------|-------------|------|
| G01 | Guid.NewGuid() | ✅ Full | ✅ |
| G02 | CombGuidIdGeneration | ✅ Full | ✅ |
| G03 | Default StreamId Check | ⚠️ Warning | ✅ |
| G04 | Collision Retry | ⚠️ Warning | ✅ |

---

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
