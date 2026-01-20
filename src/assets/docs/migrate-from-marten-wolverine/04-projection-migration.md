# Projection Migration

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

## Async Perspectives

For perspectives that need async operations (rare):

```csharp
public class EnrichedOrderPerspective
  : IAsyncPerspectiveFor<EnrichedOrderView, OrderCreated> {

  private readonly IProductCatalog _catalog;

  public EnrichedOrderPerspective(IProductCatalog catalog) {
    _catalog = catalog;
  }

  public async ValueTask<EnrichedOrderView> ApplyAsync(
    EnrichedOrderView? current,
    OrderCreated @event,
    CancellationToken ct) {

    var productDetails = await _catalog.GetProductsAsync(@event.Items, ct);

    return new EnrichedOrderView {
      Id = @event.OrderId,
      Items = productDetails,
      Status = OrderStatus.Created
    };
  }
}
```

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
