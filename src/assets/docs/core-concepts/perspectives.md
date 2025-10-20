---
title: Perspectives
category: Core Concepts  
order: 3
tags: perspectives, projections, views, event-driven, cqrs
description: Perspectives - how events create different views of your data in Whizbang
---

# Perspectives

## Overview

Perspectives are the components that react to events and update various views of your data. They handle all write operations in Whizbang, ensuring that state changes flow consistently from events to storage. The same perspective code works in both Event-Driven and Event-Sourced modes, making them a key part of Whizbang's unified architecture.

## What is a Perspective?

A Perspective:
- **Reacts** to events emitted by receptors
- **Updates** databases, caches, search indexes, and other stores
- **Maintains** different views of the same data
- **Executes** all write operations in the system

Think of perspectives as event handlers that maintain materialized views. Each perspective provides a different "perspective" on the events flowing through your system.

## The Core Interface

```csharp
public interface IPerspectiveOf<TEvent> {
    Task Update(TEvent @event);
}
```

Simple, yet powerful - perspectives react to specific events and update their views accordingly.

## How Perspectives Work

### In Event-Driven Mode
Events flow directly from receptors to perspectives in the same transaction:

```csharp
// Receptor emits event
public OrderCreated Receive(CreateOrder cmd) {
    return new OrderCreated(Guid.NewGuid(), cmd.CustomerId);
}

// Perspective immediately updates database
public class OrderPerspective : IPerspectiveOf<OrderCreated> {
    public async Task Update(OrderCreated e) {
        await db.Orders.Add(new Order { 
            Id = e.OrderId,
            CustomerId = e.CustomerId 
        });
        await db.SaveChanges();  // Immediate write
    }
}
```

### In Event-Sourced Mode
Events are first persisted to the ledger, then perspectives update asynchronously:

```csharp
// Same perspective code, different execution model
public class OrderPerspective : IPerspectiveOf<OrderCreated> {
    public async Task Update(OrderCreated e) {
        // Exact same code, but executed async from event stream
        await db.Orders.Add(new Order { 
            Id = e.OrderId,
            CustomerId = e.CustomerId 
        });
        await db.SaveChanges();
    }
}
```

## Multiple Perspectives Pattern

Different perspectives provide different views of the same events:

```csharp
// Order list for display
public class OrderListPerspective : IPerspectiveOf<OrderCreated> {
    public async Task Update(OrderCreated e) {
        await db.OrderList.Add(new OrderListItem {
            Id = e.OrderId,
            CustomerName = await GetCustomerName(e.CustomerId),
            Total = e.Total,
            Status = "New",
            CreatedAt = e.Timestamp
        });
    }
}

// Customer statistics
public class CustomerStatsPerspective : IPerspectiveOf<OrderCreated> {
    public async Task Update(OrderCreated e) {
        await db.CustomerStats.IncrementOrderCount(e.CustomerId);
        await db.CustomerStats.AddToTotalSpent(e.CustomerId, e.Total);
        await db.CustomerStats.UpdateLastOrderDate(e.CustomerId, e.Timestamp);
    }
}

// Search index
public class SearchPerspective : IPerspectiveOf<OrderCreated> {
    public async Task Update(OrderCreated e) {
        await searchIndex.Index(new SearchDocument {
            Id = e.OrderId.ToString(),
            Type = "order",
            CustomerId = e.CustomerId,
            Timestamp = e.Timestamp,
            Searchable = $"Order {e.OrderId} Customer {e.CustomerId}"
        });
    }
}

// Analytics/reporting
public class AnalyticsPerspective : IPerspectiveOf<OrderCreated> {
    public async Task Update(OrderCreated e) {
        await analytics.Track("OrderCreated", new {
            OrderId = e.OrderId,
            CustomerId = e.CustomerId,
            Total = e.Total,
            ItemCount = e.Items.Count
        });
    }
}
```

## Complex Perspective Patterns

### Multi-Event Perspectives

Perspectives can handle multiple event types to maintain complex views:

```csharp
public class OrderStatusPerspective : 
    IPerspectiveOf<OrderCreated>,
    IPerspectiveOf<OrderPaid>,
    IPerspectiveOf<OrderShipped>,
    IPerspectiveOf<OrderCancelled> {
    
    public async Task Update(OrderCreated e) {
        await db.OrderStatus.Add(new OrderStatus {
            OrderId = e.OrderId,
            Status = "Created",
            UpdatedAt = e.Timestamp
        });
    }
    
    public async Task Update(OrderPaid e) {
        await db.OrderStatus.UpdateStatus(e.OrderId, "Paid", e.Timestamp);
        await db.PaymentRecords.Add(new PaymentRecord {
            OrderId = e.OrderId,
            Amount = e.Amount,
            Method = e.PaymentMethod
        });
    }
    
    public async Task Update(OrderShipped e) {
        await db.OrderStatus.UpdateStatus(e.OrderId, "Shipped", e.Timestamp);
        await db.ShippingRecords.Add(new ShippingRecord {
            OrderId = e.OrderId,
            Carrier = e.Carrier,
            TrackingNumber = e.TrackingNumber
        });
    }
    
    public async Task Update(OrderCancelled e) {
        await db.OrderStatus.UpdateStatus(e.OrderId, "Cancelled", e.Timestamp);
        await db.CancellationReasons.Add(new CancellationReason {
            OrderId = e.OrderId,
            Reason = e.Reason,
            RefundAmount = e.RefundAmount
        });
    }
}
```

### Denormalized Views

Perspectives excel at maintaining denormalized views for query performance:

```csharp
public class OrderSummaryPerspective : 
    IPerspectiveOf<OrderCreated>,
    IPerspectiveOf<ItemAdded>,
    IPerspectiveOf<ItemRemoved> {
    
    public async Task Update(OrderCreated e) {
        // Create denormalized summary
        var customer = await customerService.GetCustomer(e.CustomerId);
        
        await db.OrderSummaries.Add(new OrderSummary {
            OrderId = e.OrderId,
            CustomerId = e.CustomerId,
            CustomerName = customer.Name,
            CustomerEmail = customer.Email,
            CustomerTier = customer.Tier,
            ItemCount = e.Items.Count,
            TotalAmount = e.Total,
            CreatedAt = e.Timestamp
        });
    }
    
    public async Task Update(ItemAdded e) {
        var summary = await db.OrderSummaries.Get(e.OrderId);
        summary.ItemCount++;
        summary.TotalAmount = e.NewTotal;
        summary.LastModified = e.Timestamp;
        await db.OrderSummaries.Update(summary);
    }
}
```

### Cache Invalidation

Perspectives handle cache updates and invalidation:

```csharp
public class CachePerspective : 
    IPerspectiveOf<OrderCreated>,
    IPerspectiveOf<OrderUpdated> {
    
    private readonly ICache cache;
    
    public async Task Update(OrderCreated e) {
        // Invalidate customer's order list cache
        await cache.Remove($"customer:{e.CustomerId}:orders");
        
        // Pre-warm order cache
        var order = new OrderCache {
            Id = e.OrderId,
            CustomerId = e.CustomerId,
            Total = e.Total
        };
        await cache.Set($"order:{e.OrderId}", order, TimeSpan.FromHours(1));
    }
    
    public async Task Update(OrderUpdated e) {
        // Invalidate all related caches
        await cache.Remove($"order:{e.OrderId}");
        await cache.Remove($"customer:{e.CustomerId}:orders");
        await cache.Remove("orders:recent");
    }
}
```

## Perspective Configuration

Configure perspectives behavior via the dispatcher:

```csharp
services.AddWhizbang()
    .UseDispatcher(dispatcher => {
        // Register all perspectives
        dispatcher.RegisterPerspectivesFromAssembly(typeof(Program).Assembly);
        
        // Configure perspective execution
        dispatcher.Perspectives
            .BufferSize(100)           // Buffer events for batch processing
            .MaxConcurrency(10)         // Parallel perspective execution
            .RetryPolicy(3, "exponential")
            .ErrorHandling(ErrorStrategy.DeadLetter);
            
        // Specific perspective configuration
        dispatcher.ForPerspective<AnalyticsPerspective>()
            .ExecuteAsync()             // Always async
            .WithPriority(Priority.Low);
    });
```

## Batch Processing

Perspectives can process events in batches for efficiency:

```csharp
public class BatchedPerspective : IBatchPerspectiveOf<OrderCreated> {
    public async Task UpdateBatch(IEnumerable<OrderCreated> events) {
        // Process multiple events efficiently
        var orders = events.Select(e => new Order {
            Id = e.OrderId,
            CustomerId = e.CustomerId,
            Total = e.Total
        }).ToList();
        
        // Single database round-trip
        await db.Orders.BulkInsert(orders);
        
        // Batch cache update
        var cacheUpdates = orders.Select(o => 
            new CacheEntry($"order:{o.Id}", o, TimeSpan.FromHours(1))
        );
        await cache.SetMany(cacheUpdates);
    }
}
```

## Idempotent Perspectives

Ensure perspectives are idempotent for reliability:

```csharp
public class IdempotentOrderPerspective : IPerspectiveOf<OrderCreated> {
    public async Task Update(OrderCreated e) {
        // Check if already processed
        var exists = await db.Orders.Exists(e.OrderId);
        if (exists) {
            return;  // Already processed, skip
        }
        
        // Process event
        await db.Orders.Add(new Order {
            Id = e.OrderId,
            CustomerId = e.CustomerId,
            ProcessedAt = DateTime.UtcNow
        });
    }
}
```

## Testing Perspectives

Perspectives are easy to test in isolation:

```csharp
[Fact]
public async Task OrderPerspective_CreatesOrder_WhenOrderCreatedEventReceived() {
    // Arrange
    var db = new InMemoryDatabase();
    var perspective = new OrderPerspective(db);
    var @event = new OrderCreated {
        OrderId = Guid.NewGuid(),
        CustomerId = Guid.NewGuid(),
        Total = 100.00m
    };
    
    // Act
    await perspective.Update(@event);
    
    // Assert
    var order = await db.Orders.Get(@event.OrderId);
    Assert.NotNull(order);
    Assert.Equal(@event.CustomerId, order.CustomerId);
    Assert.Equal(@event.Total, order.Total);
}

[Fact]
public async Task CachePerspective_InvalidatesCache_WhenOrderUpdated() {
    // Arrange
    var cache = new MockCache();
    cache.Set("order:123", new Order());
    var perspective = new CachePerspective(cache);
    
    // Act
    await perspective.Update(new OrderUpdated { OrderId = Guid.Parse("123") });
    
    // Assert
    Assert.False(await cache.Exists("order:123"));
}
```

## Best Practices

### Do's

✅ **Make perspectives idempotent**
```csharp
public async Task Update(OrderCreated e) {
    await db.Orders.Upsert(e.OrderId, order);  // Idempotent
}
```

✅ **Handle failures gracefully**
```csharp
public async Task Update(OrderCreated e) {
    try {
        await externalService.Notify(e);
    } catch (Exception ex) {
        await deadLetter.Queue(e, ex);
    }
}
```

✅ **Keep perspectives focused**
```csharp
// Each perspective has a single responsibility
public class EmailPerspective : IPerspectiveOf<OrderCreated> { }
public class InventoryPerspective : IPerspectiveOf<OrderCreated> { }
```

✅ **Use batching for performance**
```csharp
public async Task UpdateBatch(IEnumerable<OrderCreated> events) {
    await db.BulkInsert(events);
}
```

### Don'ts

❌ **Don't emit events from perspectives**
```csharp
// BAD - Perspectives react, they don't decide
public async Task Update(OrderCreated e) {
    await dispatcher.Send(new SendEmail());  // Don't do this!
}
```

❌ **Don't call other perspectives directly**
```csharp
// BAD - Let the dispatcher handle coordination
public async Task Update(OrderCreated e) {
    await otherPerspective.Update(e);  // Don't do this!
}
```

❌ **Don't make business decisions**
```csharp
// BAD - Business logic belongs in receptors
public async Task Update(OrderCreated e) {
    if (e.Total > 1000) {  // Business rule doesn't belong here
        await db.VipOrders.Add(e);
    }
}
```

## Advanced Patterns

### Temporal Perspectives

Maintain time-based views:

```csharp
public class DailyStatsPerspective : IPerspectiveOf<OrderCreated> {
    public async Task Update(OrderCreated e) {
        var date = e.Timestamp.Date;
        
        await db.DailyStats.Increment(date, stats => {
            stats.OrderCount++;
            stats.TotalRevenue += e.Total;
            stats.AverageOrderValue = stats.TotalRevenue / stats.OrderCount;
        });
    }
}
```

### Graph Perspectives

Update graph databases or relationship stores:

```csharp
public class GraphPerspective : IPerspectiveOf<OrderCreated> {
    public async Task Update(OrderCreated e) {
        await graph.CreateNode("Order", e.OrderId);
        await graph.CreateNode("Customer", e.CustomerId);
        await graph.CreateRelationship("PLACED_BY", e.OrderId, e.CustomerId);
        
        foreach (var item in e.Items) {
            await graph.CreateRelationship("CONTAINS", e.OrderId, item.ProductId);
        }
    }
}
```

### Machine Learning Perspectives

Feed ML models or feature stores:

```csharp
public class MLPerspective : IPerspectiveOf<OrderCreated> {
    public async Task Update(OrderCreated e) {
        await featureStore.Update("customer_features", e.CustomerId, new {
            LastOrderDate = e.Timestamp,
            OrderCount = await GetOrderCount(e.CustomerId) + 1,
            TotalSpent = await GetTotalSpent(e.CustomerId) + e.Total,
            PreferredCategory = await DeterminePreferredCategory(e.Items)
        });
        
        await mlPipeline.TriggerRetrain("customer_segmentation");
    }
}
```

## Summary

Perspectives are the write-side workhorses of Whizbang:

- **React to events** and update various stores
- **Same code** works in Event-Driven and Event-Sourced modes
- **Multiple perspectives** provide different views of the same data
- **Idempotent** and resilient by design
- **Testable** in isolation

Perspectives ensure that all state changes flow from events to storage in a consistent, maintainable way.

## Next Steps

- Learn about **[Lenses](/docs/core-concepts/lenses)** - Read-only query interfaces
- Explore **[Receptors](/docs/core-concepts/receptors)** - Event producers
- See **[Event-Driven Architecture](/docs/architecture-design/event-driven-architecture)** - Complete picture
- Review **[Testing Strategies](/docs/advanced/testing-strategies)** - Testing perspectives