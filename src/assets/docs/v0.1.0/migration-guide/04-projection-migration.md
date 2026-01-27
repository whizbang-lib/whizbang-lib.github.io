---
title: "Projection Migration"
version: 0.1.0
category: Migration Guide
order: 5
description: "Converting Marten projections to Whizbang Perspectives"
tags: migration, projections, perspectives, marten, read-models
codeReferences:
  - src/Whizbang.Core/Perspectives/IPerspectiveFor.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveStore.cs
---

# Projection Migration: Marten → Whizbang Perspectives

This guide covers converting Marten projections to Whizbang Perspectives.

## Key Differences

| Aspect | Marten Projection | Whizbang Perspective |
|--------|-------------------|----------------------|
| Execution | Can be async | Synchronous (pure functions) |
| Mutation | Can mutate model | Must return new model |
| Side effects | Allowed | Not allowed |
| Multiple events | Separate `Apply` methods | Variadic interface |
| State | Can access external state | Only event + current model |

## Why Pure Functions?

Whizbang Perspectives are **pure functions** by design:

1. **Deterministic**: Same input always produces same output
2. **Testable**: No mocks needed, just input → output
3. **Replayable**: Can rebuild from any point in time
4. **Time-travel debugging**: Easy to debug historical state
5. **AOT-compatible**: No reflection needed

## Single-Stream Projection Migration

### Marten Single-Stream

```csharp
// Marten: Can mutate, can have side effects
public class OrderSummaryProjection : SingleStreamProjection<OrderSummary> {
    public OrderSummary Create(OrderCreated @event) {
        return new OrderSummary {
            Id = @event.OrderId,
            CustomerId = @event.CustomerId,
            Status = OrderStatus.Created,
            Total = @event.Items.Sum(i => i.Price * i.Quantity),
            CreatedAt = @event.Timestamp
        };
    }

    public void Apply(OrderItemAdded @event, OrderSummary model) {
        model.Total += @event.Price * @event.Quantity;
        model.ItemCount++;
    }

    public void Apply(OrderShipped @event, OrderSummary model) {
        model.Status = OrderStatus.Shipped;
        model.ShippedAt = @event.Timestamp;
    }

    public void Apply(OrderCancelled @event, OrderSummary model) {
        model.Status = OrderStatus.Cancelled;
        model.CancelledAt = @event.Timestamp;
    }
}
```

### Whizbang Perspective

```csharp
// Whizbang: Pure functions, returns new model
public class OrderSummaryPerspective :
    IPerspectiveFor<OrderSummary, OrderCreated, OrderItemAdded, OrderShipped, OrderCancelled> {

    public OrderSummary Apply(OrderSummary current, OrderCreated @event) {
        return new OrderSummary {
            Id = @event.OrderId,
            CustomerId = @event.CustomerId,
            Status = OrderStatus.Created,
            Total = @event.Items.Sum(i => i.Price * i.Quantity),
            ItemCount = @event.Items.Count,
            CreatedAt = @event.Timestamp
        };
    }

    public OrderSummary Apply(OrderSummary current, OrderItemAdded @event) {
        return current with {
            Total = current.Total + (@event.Price * @event.Quantity),
            ItemCount = current.ItemCount + 1
        };
    }

    public OrderSummary Apply(OrderSummary current, OrderShipped @event) {
        return current with {
            Status = OrderStatus.Shipped,
            ShippedAt = @event.Timestamp
        };
    }

    public OrderSummary Apply(OrderSummary current, OrderCancelled @event) {
        return current with {
            Status = OrderStatus.Cancelled,
            CancelledAt = @event.Timestamp
        };
    }
}
```

## Multi-Stream Projection Migration

### Marten Multi-Stream

```csharp
// Marten: Aggregates across streams
public class CustomerOrderStatsProjection :
    MultiStreamProjection<CustomerOrderStats, Guid> {

    public CustomerOrderStatsProjection() {
        Identity<OrderCreated>(e => e.CustomerId);
        Identity<OrderCompleted>(e => e.CustomerId);
    }

    public CustomerOrderStats Create(OrderCreated @event) {
        return new CustomerOrderStats {
            CustomerId = @event.CustomerId,
            TotalOrders = 1,
            TotalSpent = @event.Total
        };
    }

    public void Apply(OrderCreated @event, CustomerOrderStats model) {
        model.TotalOrders++;
        model.TotalSpent += @event.Total;
    }

    public void Apply(OrderCompleted @event, CustomerOrderStats model) {
        model.CompletedOrders++;
    }
}
```

### Whizbang Global Perspective

```csharp
// Whizbang: Global perspective with partition key
public class CustomerOrderStatsPerspective :
    IGlobalPerspectiveFor<CustomerOrderStats, Guid, OrderCreated, OrderCompleted> {

    public Guid GetPartitionKey(OrderCreated @event) => @event.CustomerId;
    public Guid GetPartitionKey(OrderCompleted @event) => @event.CustomerId;

    public CustomerOrderStats Apply(CustomerOrderStats current, OrderCreated @event) {
        if (current == null) {
            return new CustomerOrderStats {
                CustomerId = @event.CustomerId,
                TotalOrders = 1,
                TotalSpent = @event.Total
            };
        }

        return current with {
            TotalOrders = current.TotalOrders + 1,
            TotalSpent = current.TotalSpent + @event.Total
        };
    }

    public CustomerOrderStats Apply(CustomerOrderStats current, OrderCompleted @event) {
        return current with {
            CompletedOrders = current.CompletedOrders + 1
        };
    }
}
```

## Converting Mutation to Immutable

### Pattern: Mutation → `with` Expression

**Marten (mutation)**:

```csharp
public void Apply(OrderUpdated @event, OrderSummary model) {
    model.Title = @event.Title;
    model.Total = @event.Total;
    model.UpdatedAt = @event.Timestamp;
}
```

**Whizbang (immutable)**:

```csharp
public OrderSummary Apply(OrderSummary current, OrderUpdated @event) {
    return current with {
        Title = @event.Title,
        Total = @event.Total,
        UpdatedAt = @event.Timestamp
    };
}
```

### Pattern: Conditional Logic

**Marten (conditional mutation)**:

```csharp
public void Apply(PaymentReceived @event, OrderSummary model) {
    model.PaidAmount += @event.Amount;
    if (model.PaidAmount >= model.Total) {
        model.Status = OrderStatus.Paid;
    }
}
```

**Whizbang (conditional immutable)**:

```csharp
public OrderSummary Apply(OrderSummary current, PaymentReceived @event) {
    var newPaidAmount = current.PaidAmount + @event.Amount;
    var newStatus = newPaidAmount >= current.Total
        ? OrderStatus.Paid
        : current.Status;

    return current with {
        PaidAmount = newPaidAmount,
        Status = newStatus
    };
}
```

### Pattern: Collection Updates

**Marten (list mutation)**:

```csharp
public void Apply(ItemAdded @event, ShoppingCart model) {
    model.Items.Add(new CartItem(@event.ProductId, @event.Quantity));
}
```

**Whizbang (immutable collection)**:

```csharp
public ShoppingCart Apply(ShoppingCart current, ItemAdded @event) {
    var newItems = current.Items
        .Append(new CartItem(@event.ProductId, @event.Quantity))
        .ToList();

    return current with { Items = newItems };
}
```

## Model Definition Changes

### Use Records for Immutability

**Before (class with mutable properties)**:

```csharp
public class OrderSummary {
    public Guid Id { get; set; }
    public OrderStatus Status { get; set; }
    public decimal Total { get; set; }
}
```

**After (record with init properties)**:

```csharp
public sealed record OrderSummary {
    public required Guid Id { get; init; }
    public OrderStatus Status { get; init; }
    public decimal Total { get; init; }
    public int ItemCount { get; init; }
    public DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset? ShippedAt { get; init; }
}
```

## Async Operations

### Marten Async Projections

```csharp
// Marten: Can do async work in projections
public async Task Apply(OrderCreated @event, OrderSummary model, IQuerySession session) {
    var customer = await session.LoadAsync<Customer>(@event.CustomerId);
    model.CustomerName = customer?.Name;
}
```

### Whizbang: Move Async to Receptor

Perspectives must be pure. Move async logic to receptors:

```csharp
// Receptor enriches event before storing
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    private readonly ICustomerService _customers;

    public async ValueTask<OrderCreated> HandleAsync(CreateOrder message, CancellationToken ct) {
        var customer = await _customers.GetAsync(message.CustomerId, ct);

        return new OrderCreated(
            message.OrderId,
            message.CustomerId,
            CustomerName: customer.Name,  // Enrich at write time
            message.Items
        );
    }
}

// Perspective is pure (no async)
public class OrderSummaryPerspective : IPerspectiveFor<OrderSummary, OrderCreated> {
    public OrderSummary Apply(OrderSummary current, OrderCreated @event) {
        return new OrderSummary {
            Id = @event.OrderId,
            CustomerName = @event.CustomerName  // Already enriched
        };
    }
}
```

## Registration Changes

### Marten Projection Registration

```csharp
services.AddMarten(opts => {
    opts.Projections.Add<OrderSummaryProjection>(ProjectionLifecycle.Async);
    opts.Projections.Add<CustomerOrderStatsProjection>(ProjectionLifecycle.Inline);
});
```

### Whizbang Perspective Registration

```csharp
services.AddWhizbang(options => {
    // Perspectives are auto-discovered via source generators
    // Explicit registration if needed:
    options.AddPerspective<OrderSummaryPerspective>();
    options.AddPerspective<CustomerOrderStatsPerspective>();
});
```

## Testing Perspectives

Perspectives are easy to test because they're pure functions:

```csharp
[Test]
public void Apply_OrderCreated_CreatesNewSummaryAsync() {
    // Arrange
    var perspective = new OrderSummaryPerspective();
    var @event = new OrderCreated(
        Guid.CreateVersion7(),
        CustomerId: Guid.CreateVersion7(),
        Items: new[] { new OrderItem("SKU1", 2, 29.99m) }
    );

    // Act
    var result = perspective.Apply(null!, @event);

    // Assert
    await Assert.That(result.Status).IsEqualTo(OrderStatus.Created);
    await Assert.That(result.Total).IsEqualTo(59.98m);
}

[Test]
public void Apply_OrderShipped_UpdatesStatusAsync() {
    // Arrange
    var perspective = new OrderSummaryPerspective();
    var current = new OrderSummary {
        Id = Guid.CreateVersion7(),
        Status = OrderStatus.Created
    };
    var @event = new OrderShipped(current.Id, DateTimeOffset.UtcNow);

    // Act
    var result = perspective.Apply(current, @event);

    // Assert
    await Assert.That(result.Status).IsEqualTo(OrderStatus.Shipped);
    await Assert.That(result.ShippedAt).IsNotNull();
}
```

## Migration Checklist

- [ ] Replace `SingleStreamProjection<T>` with `IPerspectiveFor<T, TEvent...>`
- [ ] Replace `MultiStreamProjection<T, TKey>` with `IGlobalPerspectiveFor<T, TKey, TEvent...>`
- [ ] Convert mutation (`model.X = y`) to immutable (`current with { X = y }`)
- [ ] Move async operations to receptors
- [ ] Use `sealed record` for model types
- [ ] Add variadic event types to interface
- [ ] Implement `GetPartitionKey` for global perspectives
- [ ] Update tests to pure function assertions

---

*Previous: [Handler Migration](03-handler-migration.md) | Next: [Event Store Migration](05-event-store-migration.md)*
