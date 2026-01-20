# Migrate from Marten/Wolverine: Projection Migration

This guide covers migrating Marten projections to Whizbang Perspectives.

## Overview

| Marten | Whizbang |
|--------|----------|
| `SingleStreamProjection<T>` | `IPerspectiveFor<TModel, TEvent...>` |
| `MultiStreamProjection<T>` | `IGlobalPerspectiveFor<TModel>` |
| Mutable `Apply(event, view)` | Immutable `Apply(current, event) => new` |
| Runtime registration | Source-generated discovery |

## Single Stream Projection Migration

### Before: Marten SingleStreamProjection

```csharp
public class OrderProjection : SingleStreamProjection<OrderView> {
  public OrderView Create(OrderCreated @event) {
    return new OrderView {
      Id = @event.OrderId,
      CustomerId = @event.CustomerId,
      Items = @event.Items,
      Status = OrderStatus.Created,
      CreatedAt = @event.CreatedAt
    };
  }

  public void Apply(OrderShipped @event, OrderView view) {
    view.Status = OrderStatus.Shipped;
    view.ShippedAt = @event.ShippedAt;
  }

  public void Apply(OrderCancelled @event, OrderView view) {
    view.Status = OrderStatus.Cancelled;
    view.CancelledAt = @event.CancelledAt;
    view.CancellationReason = @event.Reason;
  }
}
```

### After: Whizbang Perspective

```csharp
public class OrderPerspective
  : IPerspectiveFor<OrderView, OrderCreated, OrderShipped, OrderCancelled> {

  public OrderView Apply(OrderView? current, OrderCreated @event) {
    return new OrderView {
      Id = @event.OrderId,
      CustomerId = @event.CustomerId,
      Items = @event.Items,
      Status = OrderStatus.Created,
      CreatedAt = @event.CreatedAt
    };
  }

  public OrderView Apply(OrderView? current, OrderShipped @event) {
    ArgumentNullException.ThrowIfNull(current, "Order must exist before shipping");
    return current with {
      Status = OrderStatus.Shipped,
      ShippedAt = @event.ShippedAt
    };
  }

  public OrderView Apply(OrderView? current, OrderCancelled @event) {
    ArgumentNullException.ThrowIfNull(current, "Order must exist before cancellation");
    return current with {
      Status = OrderStatus.Cancelled,
      CancelledAt = @event.CancelledAt,
      CancellationReason = @event.Reason
    };
  }
}
```

## Key Differences

### 1. Interface Declaration

Marten uses inheritance; Whizbang uses a variadic interface listing all event types:

```csharp
// Marten
public class MyProjection : SingleStreamProjection<MyView>

// Whizbang - list all event types
public class MyPerspective : IPerspectiveFor<MyView, Event1, Event2, Event3>
```

### 2. Immutable Apply Pattern

Marten mutates the existing view; Whizbang returns a new instance:

```csharp
// Marten (mutable)
public void Apply(OrderShipped @event, OrderView view) {
  view.Status = OrderStatus.Shipped;
}

// Whizbang (immutable)
public OrderView Apply(OrderView? current, OrderShipped @event) {
  return current with { Status = OrderStatus.Shipped };
}
```

### 3. Create vs Apply

Marten has separate `Create` method; Whizbang uses `Apply` with nullable current:

```csharp
// Marten
public OrderView Create(OrderCreated @event) {
  return new OrderView { ... };
}

// Whizbang (current is null for first event)
public OrderView Apply(OrderView? current, OrderCreated @event) {
  // current is null - this is creation
  return new OrderView { ... };
}
```

## Multi-Stream Projection Migration

### Before: Marten MultiStreamProjection

```csharp
public class CustomerOrderSummaryProjection : MultiStreamProjection<CustomerOrderSummary, Guid> {
  public CustomerOrderSummaryProjection() {
    Identity<OrderCreated>(e => e.CustomerId);
    Identity<OrderCompleted>(e => e.CustomerId);
  }

  public CustomerOrderSummary Create(OrderCreated @event) {
    return new CustomerOrderSummary {
      CustomerId = @event.CustomerId,
      TotalOrders = 1,
      TotalSpent = @event.Amount
    };
  }

  public void Apply(OrderCreated @event, CustomerOrderSummary summary) {
    summary.TotalOrders++;
    summary.TotalSpent += @event.Amount;
  }

  public void Apply(OrderCompleted @event, CustomerOrderSummary summary) {
    summary.CompletedOrders++;
  }
}
```

### After: Whizbang Global Perspective

```csharp
public class CustomerOrderSummaryPerspective
  : IGlobalPerspectiveFor<CustomerOrderSummary, OrderCreated, OrderCompleted> {

  public Guid GetPartitionKey(OrderCreated @event) => @event.CustomerId;
  public Guid GetPartitionKey(OrderCompleted @event) => @event.CustomerId;

  public CustomerOrderSummary Apply(CustomerOrderSummary? current, OrderCreated @event) {
    if (current is null) {
      return new CustomerOrderSummary {
        CustomerId = @event.CustomerId,
        TotalOrders = 1,
        TotalSpent = @event.Amount
      };
    }

    return current with {
      TotalOrders = current.TotalOrders + 1,
      TotalSpent = current.TotalSpent + @event.Amount
    };
  }

  public CustomerOrderSummary Apply(CustomerOrderSummary? current, OrderCompleted @event) {
    ArgumentNullException.ThrowIfNull(current);
    return current with {
      CompletedOrders = current.CompletedOrders + 1
    };
  }
}
```

## View Model Requirements

### Use Records for Immutability

Whizbang perspectives work best with records:

```csharp
// Recommended: record with 'with' expression support
public record OrderView {
  public required Guid Id { get; init; }
  public required Guid CustomerId { get; init; }
  public required IReadOnlyList<OrderItem> Items { get; init; }
  public required OrderStatus Status { get; init; }
  public required DateTimeOffset CreatedAt { get; init; }
  public DateTimeOffset? ShippedAt { get; init; }
  public DateTimeOffset? CancelledAt { get; init; }
  public string? CancellationReason { get; init; }
}
```

### Migrating Mutable Classes

If your existing view is a mutable class:

```csharp
// Before: Mutable class
public class OrderView {
  public Guid Id { get; set; }
  public OrderStatus Status { get; set; }
  // ...
}

// After: Convert to record
public record OrderView {
  public required Guid Id { get; init; }
  public required OrderStatus Status { get; init; }
  // ...
}
```

## Perspective Purity Requirements

:::warning[Critical]
Perspective Apply methods MUST be pure functions. This is enforced at compile-time.
:::

**CRITICAL**: Perspective Apply methods MUST be pure functions:

- **No async/await** - Apply methods are synchronous
- **No database calls** - No DbContext, ILensQuery, or repository access
- **No HTTP calls** - No HttpClient or external API calls
- **No side effects** - No logging, no events, no external state mutation
- **Deterministic** - Same inputs always produce same outputs
- **Use event timestamps** - Not `DateTime.UtcNow` (use event's timestamp)

### Why Purity Matters

Perspectives may be replayed during:
- System recovery after failures
- Rebuilding read models from event history
- Testing with event replay

Non-pure Apply methods would produce different results on replay, corrupting your read models.

### Compile-Time Enforcement

Whizbang includes `PerspectivePurityAnalyzer` that emits errors for:
- **WHIZ100**: Apply returns Task (must be sync)
- **WHIZ101**: Apply uses await keyword
- **WHIZ102**: Apply calls database I/O
- **WHIZ103**: Apply calls HTTP/network
- **WHIZ104**: Apply uses DateTime.UtcNow (warning)

### Pure Service Injection

If migrated code needs computation services in Apply methods, use **class-level injection** with Pure Services:

```csharp
public class OrderPerspective : IPerspectiveFor<OrderView, OrderShipped> {
  private readonly IExchangeRateService _exchangeRates; // Must be [PureService]

  public OrderPerspective(IExchangeRateService exchangeRates) {
    _exchangeRates = exchangeRates;
  }

  public OrderView Apply(OrderView? current, OrderShipped @event) {
    var rate = _exchangeRates.GetRate(@event.Currency, @event.ShippedAt);
    return current! with {
      Status = OrderStatus.Shipped,
      TotalInUsd = current.Total * rate
    };
  }
}
```

Services injected into Perspectives MUST be registered as **Pure Services**:

```csharp
// Registration
services.AddPureService<IExchangeRateService, ExchangeRateService>();

// Or with attribute on the service class
[PureService]
public class ExchangeRateService : IExchangeRateService {
  // Implementation must be pure!
}
```

**Analyzer Behavior**:
- **WHIZ105**: Warning when perspective injects non-`[PureService]` dependency
- Developers can suppress warnings with `#pragma warning disable WHIZ105`

:::warning[Developer Scrutiny Required]
Pure services are a major area for careful review. Non-pure services injected into perspectives WILL break replay determinism. Only suppress WHIZ105 if you are 100% certain the service is truly pure.
:::

## Inline Projections

For simple projections without a dedicated class:

```csharp
builder.Services.AddWhizbang(options => {
    options.AddInlinePerspective<OrderSummaryView>(cfg => {
        cfg.On<OrderCreated>((current, e) => new OrderSummaryView {
            Id = e.OrderId,
            Status = "Created"
        });
        cfg.On<OrderShipped>((current, e) => current! with {
            Status = "Shipped"
        });
    });
});
```

## Registration

Perspectives are discovered automatically by source generators. No manual registration required.

For explicit registration (optional):

```csharp
builder.Services.AddWhizbang(options => {
    options.AddPerspective<OrderPerspective>();
    options.AddGlobalPerspective<CustomerOrderSummaryPerspective>();
});
```

## Common Migration Scenarios

The following scenarios address patterns commonly found in Marten codebases.

### Scenario P01: SingleStreamProjection Base Class

**Marten Pattern (Before):**
```csharp
public class OrderProjection : SingleStreamProjection<Order> {
  public Order Create(OrderCreatedEvent @event) {
    return new Order {
      Id = @event.StreamId,
      Title = @event.Title,
      Status = OrderStatus.Created
    };
  }

  public void Apply(OrderUpdatedEvent @event, Order model) {
    model.Title = @event.Title;
    model.Description = @event.Description;
  }
}
```

**Whizbang Pattern (After):**
```csharp
public class OrderPerspective
    : IPerspectiveFor<Order, OrderCreatedEvent, OrderUpdatedEvent> {

  public Order Apply(Order? current, OrderCreatedEvent @event) {
    return new Order {
      Id = @event.StreamId,
      Title = @event.Title,
      Status = OrderStatus.Created
    };
  }

  public Order Apply(Order? current, OrderUpdatedEvent @event) {
    ArgumentNullException.ThrowIfNull(current);
    return current with {
      Title = @event.Title,
      Description = @event.Description
    };
  }
}
```

**Key Differences:**
- No base class inheritance - implement interface directly
- Source generator discovers perspectives automatically
- Separate `Create` method merged into `Apply` with nullable `current`

**CLI Transformation:** `whizbang migrate apply` detects `SingleStreamProjection<T>` inheritance.

---

### Scenario P02: MultiStreamProjection Base Class

**Marten Pattern (Before):**
```csharp
public class CustomerProjection : MultiStreamProjection<Customer, Guid> {
  public CustomerProjection() {
    Identity<IEvent>(e => e.StreamId);
  }

  public Customer Create(CustomerCreatedEvent @event) {
    return new Customer {
      Id = @event.StreamId,
      Name = @event.Name,
      Version = 1
    };
  }

  public void Apply(CustomerUpdatedEvent @event, Customer model) {
    model.Name = @event.Name;
    model.Version++;
  }
}
```

**Whizbang Pattern (After):**
```csharp
public class CustomerPerspective
    : IGlobalPerspectiveFor<Customer, CustomerCreatedEvent, CustomerUpdatedEvent> {

  public Guid GetPartitionKey(CustomerCreatedEvent @event) => @event.StreamId;
  public Guid GetPartitionKey(CustomerUpdatedEvent @event) => @event.StreamId;

  public Customer Apply(Customer? current, CustomerCreatedEvent @event) {
    return new Customer {
      Id = @event.StreamId,
      Name = @event.Name,
      Version = 1
    };
  }

  public Customer Apply(Customer? current, CustomerUpdatedEvent @event) {
    ArgumentNullException.ThrowIfNull(current);
    return current with {
      Name = @event.Name,
      Version = current.Version + 1
    };
  }
}
```

**Key Differences:**
- Constructor `Identity<T>()` becomes `GetPartitionKey()` methods
- One `GetPartitionKey` method per event type
- Same immutable `Apply` pattern as single-stream

---

### Scenario P03: Identity/Partition Key Extraction

**Marten Pattern (Before):**
```csharp
public class CustomerSummaryProjection : MultiStreamProjection<CustomerSummary, Guid> {
  public CustomerSummaryProjection() {
    // Identity extraction in constructor
    Identity<OrderCreatedEvent>(e => e.CustomerId);
    Identity<OrderCompletedEvent>(e => e.CustomerId);
    Identity<OrderCancelledEvent>(e => e.CustomerId);
  }
  // ... Apply methods
}
```

**Whizbang Pattern (After):**
```csharp
public class CustomerSummaryPerspective
    : IGlobalPerspectiveFor<CustomerSummary, OrderCreatedEvent, OrderCompletedEvent, OrderCancelledEvent> {

  // Explicit partition key methods - one per event type
  public Guid GetPartitionKey(OrderCreatedEvent @event) => @event.CustomerId;
  public Guid GetPartitionKey(OrderCompletedEvent @event) => @event.CustomerId;
  public Guid GetPartitionKey(OrderCancelledEvent @event) => @event.CustomerId;

  // ... Apply methods
}
```

**Key Differences:**
- Constructor-based `Identity<T>()` becomes type-safe method overloads
- Compile-time verification that all event types have partition key extraction
- Clearer relationship between event and partition key

---

### Scenario P04: Nested Model + Projection Classes

**Marten Pattern (Before):**
```csharp
public static class TaskItemProjection {
  // Nested model class
  public class Model {
    public Guid Id { get; set; }
    public string Title { get; set; } = "";
    public TaskStatus Status { get; set; }
    public List<TaskStep> Steps { get; set; } = new();
  }

  // Nested projection class
  public class Projection : SingleStreamProjection<Model> {
    public Model Create(TaskCreatedEvent @event) {
      return new Model {
        Id = @event.StreamId,
        Title = @event.Title,
        Status = TaskStatus.Pending
      };
    }

    public void Apply(TaskStepAddedEvent @event, Model model) {
      model.Steps.Add(new TaskStep { Id = @event.StepId, Name = @event.Name });
    }
  }
}
```

**Whizbang Pattern (After):**
```csharp
// Flat structure - separate record and perspective
public record TaskItem {
  public required Guid Id { get; init; }
  public required string Title { get; init; }
  public required TaskStatus Status { get; init; }
  public required IReadOnlyList<TaskStep> Steps { get; init; }
}

public class TaskItemPerspective
    : IPerspectiveFor<TaskItem, TaskCreatedEvent, TaskStepAddedEvent> {

  public TaskItem Apply(TaskItem? current, TaskCreatedEvent @event) {
    return new TaskItem {
      Id = @event.StreamId,
      Title = @event.Title,
      Status = TaskStatus.Pending,
      Steps = []
    };
  }

  public TaskItem Apply(TaskItem? current, TaskStepAddedEvent @event) {
    ArgumentNullException.ThrowIfNull(current);
    return current with {
      Steps = [..current.Steps, new TaskStep { Id = @event.StepId, Name = @event.Name }]
    };
  }
}
```

**Key Differences:**
- Flatten nested static classes into separate types
- Model becomes a record at namespace level
- Projection becomes a perspective at namespace level
- Collection updates use spread syntax for immutability

---

### Scenario P05: Projection Model Interface

**Marten Pattern (Before):**
```csharp
// Some codebases use a marker interface for projection models
public interface IProjectionModel {
  Guid Id { get; set; }
}

public class ActiveTenant : IProjectionModel {
  public Guid Id { get; set; }
  public string Name { get; set; } = "";
  public TenantStatus Status { get; set; }
}
```

**Whizbang Pattern (After):**
```csharp
// No interface needed - just use a record
public record ActiveTenant {
  public required Guid Id { get; init; }
  public required string Name { get; init; }
  public required TenantStatus Status { get; init; }
}
```

**Key Differences:**
- No marker interface required
- Use `required` modifier for mandatory properties
- Use `init` for immutability
- Records provide `with` expression support automatically

---

### Scenario P06: Projection with Versioning

**Marten Pattern (Before):**
```csharp
public class Product {
  public Guid Id { get; set; }
  public string Name { get; set; } = "";
  public int Version { get; set; }
  public DateTimeOffset LastModified { get; set; }
}

public class ProductProjection : SingleStreamProjection<Product> {
  public void Apply(ProductUpdatedEvent @event, Product model) {
    model.Name = @event.Name;
    model.Version++;  // Increment version on each update
    model.LastModified = DateTimeOffset.UtcNow;
  }
}
```

**Whizbang Pattern (After):**
```csharp
public record Product {
  public required Guid Id { get; init; }
  public required string Name { get; init; }
  public required int Version { get; init; }
  public required DateTimeOffset LastModified { get; init; }
}

public class ProductPerspective
    : IPerspectiveFor<Product, ProductCreatedEvent, ProductUpdatedEvent> {

  public Product Apply(Product? current, ProductUpdatedEvent @event) {
    ArgumentNullException.ThrowIfNull(current);
    return current with {
      Name = @event.Name,
      Version = current.Version + 1,  // Explicit increment
      LastModified = @event.UpdatedAt  // Use event timestamp, not UtcNow!
    };
  }
}
```

**Key Differences:**
- Version increment is explicit in the `with` expression
- Immutable pattern makes version history trackable
- No side effects from `++` operator
- **Use event timestamp** instead of `DateTime.UtcNow` for deterministic replay

---

### Scenario P07: Cross-Service Duplicate Projections

**Marten Pattern (Before):**
```csharp
// In BffService
public class TaskItemProjection : SingleStreamProjection<TaskItem> { ... }

// In JobService (duplicate!)
public class TaskItemProjection : SingleStreamProjection<TaskItem> { ... }

// In TaskService (another duplicate!)
public class TaskItemProjection : SingleStreamProjection<TaskItem> { ... }
```

**Whizbang Pattern (After):**
```csharp
// In shared Contracts assembly
public record TaskItem {
  public required Guid Id { get; init; }
  public required string Title { get; init; }
  // ...
}

// Single perspective in one service (or shared library)
public class TaskItemPerspective
    : IPerspectiveFor<TaskItem, TaskCreatedEvent, TaskUpdatedEvent> {
  // Single source of truth
}

// Other services query via ILensQuery<TaskItem>
public class TaskQueryReceptor(IScopedLensQuery<TaskItem> taskQuery)
    : IReceptor<GetTaskQuery, TaskItem?> {

  public async ValueTask<TaskItem?> HandleAsync(GetTaskQuery query, CancellationToken ct) {
    return await taskQuery.GetByIdAsync(query.TaskId, ct);
  }
}
```

**Key Differences:**
- Single perspective definition (no duplication)
- Other services use `ILensQuery<T>` to query the projection
- Model record shared via contracts assembly
- Avoids synchronization issues from duplicate projections

:::warning[Duplicate Projections]
Cross-service duplicate projections can lead to data inconsistency. Consolidate to a single source of truth and use `ILensQuery<T>` for read access from other services.
:::

---

## Automated Migration

Use the CLI tool to automate projection migration:

```bash
# Preview changes
whizbang migrate analyze --project ./src/MyService --type projections

# Apply with review
whizbang migrate apply --project ./src/MyService --type projections --guided
```

The tool will:
1. Find all `SingleStreamProjection<T>` and `MultiStreamProjection<T>` classes
2. Generate corresponding `IPerspectiveFor<T, ...>` classes
3. Convert view classes to records
4. Transform mutable Apply methods to immutable returns

## Checklist

- [ ] Convert `SingleStreamProjection<T>` to `IPerspectiveFor<T, TEvent...>`
- [ ] Convert `MultiStreamProjection<T>` to `IGlobalPerspectiveFor<T, TEvent...>`
- [ ] Convert view classes to records with `init` properties
- [ ] Change `Apply(event, view)` to `Apply(view?, event) => new`
- [ ] Replace `Create(event)` with `Apply(null, event)`
- [ ] Add `GetPartitionKey` methods for global perspectives
- [ ] Handle nullable `current` parameter appropriately
- [ ] Update using directives
- [ ] Run tests to verify projections produce correct state

## Next Steps

- [Event Store Migration](./05-event-store-migration.md) - Migrate IDocumentStore to IEventStore
