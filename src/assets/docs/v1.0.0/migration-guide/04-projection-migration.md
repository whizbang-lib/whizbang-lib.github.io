---
title: Projection Migration
pageType: guide
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Migration Guide
order: 5
description: Converting Marten projections to Whizbang Perspectives
tags: 'migration, projections, perspectives, marten, read-models'
codeReferences:
  - src/Whizbang.Core/Perspectives/IPerspectiveFor.cs
  - src/Whizbang.Core/Perspectives/IGlobalPerspectiveFor.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveStore.cs
testReferences:
  - tests/Whizbang.Core.Tests/Perspectives/IPerspectiveForTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/IGlobalPerspectiveForTests.cs
  - tests/Whizbang.Migrate.Tests/Transformers/ProjectionToPerspectiveTransformerTests.cs
lastMaintainedCommit: '01f07906'
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

```csharp{title="Marten Single-Stream" description="Marten Single-Stream" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-Guide", "Marten", "Single-Stream"] unverified="other framework — migration before-state"}
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

```csharp{title="Whizbang Perspective" description="Whizbang Perspective" category="Reference" difficulty="ADVANCED" tags=["Migration-guide", "C#", "Whizbang", "Perspective"] tests=["IPerspectiveForTests.Perspective_ImplementingIPerspectiveFor_HasApplyMethodAsync", "IPerspectiveForTests.Perspective_ImplementingMultipleEventTypes_HasApplyForEachAsync", "IPerspectiveForTests.Perspective_ImplementingIPerspectiveFor_ApplyIsPureFunctionAsync"]}
// Whizbang: Pure functions, returns new model
// Event types must implement IEvent; up to 20 event types per perspective
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

```csharp{title="Marten Multi-Stream" description="Marten Multi-Stream" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-Guide", "Marten", "Multi-Stream"] unverified="other framework — migration before-state"}
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

```csharp{title="Whizbang Global Perspective" description="Whizbang Global Perspective" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Whizbang", "Global", "Perspective"] tests=["IGlobalPerspectiveForTests.GlobalPerspective_HasGetPartitionKeyMethod_ExtractsPartitionFromEventAsync", "IGlobalPerspectiveForTests.GlobalPerspective_MultipleEventTypes_HasGetPartitionKeyForEachAsync", "IGlobalPerspectiveForTests.GlobalPerspective_ApplyMethod_IsPureFunctionAsync"]}
// Whizbang: Global perspective with partition key
// GetPartitionKey mirrors Marten's Identity() method
// (variants currently support up to 3 event types)
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

```csharp{title="Pattern: Mutation → `with` Expression" description="Marten (mutation):" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Pattern:", "Mutation"] unverified="other framework — migration before-state"}
public void Apply(OrderUpdated @event, OrderSummary model) {
    model.Title = @event.Title;
    model.Total = @event.Total;
    model.UpdatedAt = @event.Timestamp;
}
```

**Whizbang (immutable)**:

```csharp{title="Pattern: Mutation → `with` Expression (2)" description="Whizbang (immutable):" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Pattern:", "Mutation"] tests=["IPerspectiveForTests.Perspective_ImplementingIPerspectiveFor_ApplyIsPureFunctionAsync"]}
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

```csharp{title="Pattern: Conditional Logic" description="Marten (conditional mutation):" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Pattern:", "Conditional", "Logic"] unverified="other framework — migration before-state"}
public void Apply(PaymentReceived @event, OrderSummary model) {
    model.PaidAmount += @event.Amount;
    if (model.PaidAmount >= model.Total) {
        model.Status = OrderStatus.Paid;
    }
}
```

**Whizbang (conditional immutable)**:

```csharp{title="Pattern: Conditional Logic (2)" description="Whizbang (conditional immutable):" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Pattern:", "Conditional", "Logic"] tests=["IPerspectiveForTests.Perspective_ImplementingIPerspectiveFor_ApplyIsPureFunctionAsync"]}
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

```csharp{title="Pattern: Collection Updates" description="Marten (list mutation):" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Pattern:", "Collection", "Updates"] unverified="other framework — migration before-state"}
public void Apply(ItemAdded @event, ShoppingCart model) {
    model.Items.Add(new CartItem(@event.ProductId, @event.Quantity));
}
```

**Whizbang (immutable collection)**:

```csharp{title="Pattern: Collection Updates (2)" description="Whizbang (immutable collection):" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Pattern:", "Collection", "Updates"] tests=["IPerspectiveForTests.Perspective_ImplementingIPerspectiveFor_ApplyIsPureFunctionAsync"]}
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

```csharp{title="Use Records for Immutability" description="Before (class with mutable properties):" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Use", "Records", "Immutability"] unverified="model definition — before-state mutable class, no behavior to assert"}
public class OrderSummary {
    public Guid Id { get; set; }
    public OrderStatus Status { get; set; }
    public decimal Total { get; set; }
}
```

**After (record with init properties)**:

```csharp{title="Use Records for Immutability - OrderSummary" description="After (record with init properties):" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Use", "Records", "Immutability"] unverified="model definition — record type declaration, no behavior to assert"}
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

```csharp{title="Marten Async Projections" description="Marten Async Projections" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Marten", "Async", "Projections"] unverified="other framework — migration before-state"}
// Marten: Can do async work in projections
public async Task Apply(OrderCreated @event, OrderSummary model, IQuerySession session) {
    var customer = await session.LoadAsync<Customer>(@event.CustomerId);
    model.CustomerName = customer?.Name;
}
```

### Whizbang: Move Async to Receptor

Perspectives must be pure. Move async logic to receptors:

```csharp{title="Whizbang: Move Async to Receptor" description="Perspectives must be pure." category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Whizbang:", "Move", "Async"]}
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

```csharp{title="Marten Projection Registration" description="Marten Projection Registration" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Marten", "Projection", "Registration"] unverified="other framework — migration before-state"}
services.AddMarten(opts => {
    opts.Projections.Add<OrderSummaryProjection>(ProjectionLifecycle.Async);
    opts.Projections.Add<CustomerOrderStatsProjection>(ProjectionLifecycle.Inline);
});
```

### Whizbang Perspective Registration

```csharp{title="Whizbang Perspective Registration" description="Whizbang Perspective Registration" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Whizbang", "Perspective", "Registration"] unverified="configuration — DI service registration, not covered by this page's perspective tests"}
// Perspectives are auto-discovered at compile time by source generators.
// The storage chain registers every discovered perspective automatically -
// there is no per-perspective registration call and no lifecycle enum:
services
    .AddWhizbang()
    .WithEFCore<AppDbContext>()
    .WithDriver.Postgres;
```

There is no equivalent of Marten's `ProjectionLifecycle.Inline`/`Async` choice: all perspectives are applied asynchronously (eventually consistent) by the perspective worker pipeline.

## Testing Perspectives

Perspectives are easy to test because they're pure functions:

```csharp{title="Testing Perspectives" description="Perspectives are easy to test because they're pure functions:" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Testing", "Perspectives"] tests=["IPerspectiveForTests.Perspective_ImplementingIPerspectiveFor_HasApplyMethodAsync", "IPerspectiveForTests.Perspective_ImplementingIPerspectiveFor_ApplyIsPureFunctionAsync"]}
[Test]
public async Task Apply_OrderCreated_CreatesNewSummaryAsync() {
    // Arrange
    var perspective = new OrderSummaryPerspective();
    var @event = new OrderCreated(
        TrackedGuid.NewMedo(),
        CustomerId: TrackedGuid.NewMedo(),
        Items: new[] { new OrderItem("SKU1", 2, 29.99m) }
    );

    // Act
    var result = perspective.Apply(null!, @event);

    // Assert
    await Assert.That(result.Status).IsEqualTo(OrderStatus.Created);
    await Assert.That(result.Total).IsEqualTo(59.98m);
}

[Test]
public async Task Apply_OrderShipped_UpdatesStatusAsync() {
    // Arrange
    var perspective = new OrderSummaryPerspective();
    var current = new OrderSummary {
        Id = TrackedGuid.NewMedo(),
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
- [ ] Ensure all event types implement `IEvent` (required by the interface constraints)
- [ ] Convert mutation (`model.X = y`) to immutable (`current with { X = y }`)
- [ ] Move async operations to receptors
- [ ] Use `sealed record` for model types
- [ ] Add variadic event types to interface
- [ ] Implement `GetPartitionKey` for global perspectives
- [ ] Update tests to pure function assertions

---

*Previous: [Handler Migration](03-handler-migration.md) | Next: [Event Store Migration](05-event-store-migration.md)*
