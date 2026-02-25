---
title: Lenses Component
version: 1.0.0
category: Components
order: 5
description: >-
  Read-only interfaces for querying data - the query side of Whizbang's CQRS
  implementation
tags: 'lenses, queries, read-model, cqrs, v0.1.0'
---

# Lenses Component

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Status](https://img.shields.io/badge/status-stable-green)

## Version History

:::new
**New in v1.0.0**: Basic query interface with Focus, View, Glimpse, Exists, and Scan methods
:::


## Overview

Lenses provide focused, read-only views into your data. They are the query side of Whizbang's CQRS implementation, offering a clean separation between reads and writes. In v1.0.0, lenses work with in-memory data and establish the foundation for more advanced query capabilities.

## What is a Lens?

A Lens:
- **Provides** read-only access to data
- **Focuses** on specific query needs
- **Never** modifies state
- **Abstracts** the underlying storage mechanism

Think of a lens as a window into your data - you can look through it from different angles to see different views, but you can't reach through it to change what you see.

## Core Interface (v1.0.0)

:::new
The basic lens interface pattern with five core methods:
:::

```csharp
public interface ILens {
    // Focus on a single item
    T Focus<T>(object id);
    
    // View a filtered collection
    IEnumerable<T> View<T>(Expression<Func<T, bool>> filter);
    
    // Glimpse a summary or partial view
    TSummary Glimpse<TSummary>(object id);
    
    // Check existence
    bool Exists(object id);
    
    // Scan all items (use sparingly)
    IEnumerable<T> Scan<T>();
}
```

## Domain-Specific Lenses

:::new
Create specific lens interfaces for your domain:
:::

```csharp
[WhizbangLens]  // Source generator discovers this
public interface IOrderLens : ILens {
    // Strongly-typed methods
    Order Focus(Guid orderId);
    IEnumerable<Order> ViewByCustomer(Guid customerId);
    IEnumerable<Order> ViewByStatus(OrderStatus status);
    OrderSummary Glimpse(Guid orderId);
    bool Exists(Guid orderId);
    IEnumerable<Order> Scan();
}

// Implementation for v1.0.0 (in-memory)
public class OrderLens : IOrderLens {
    private readonly Dictionary<Guid, Order> _orders;
    
    public OrderLens(IInMemoryStore<Order> store) {
        _orders = store.Collection;
    }
    
    public Order Focus(Guid orderId) {
        return _orders.TryGetValue(orderId, out var order) 
            ? order 
            : null;
    }
    
    public IEnumerable<Order> ViewByCustomer(Guid customerId) {
        return _orders.Values.Where(o => o.CustomerId == customerId);
    }
    
    public IEnumerable<Order> ViewByStatus(OrderStatus status) {
        return _orders.Values.Where(o => o.Status == status);
    }
    
    public OrderSummary Glimpse(Guid orderId) {
        var order = Focus(orderId);
        return order == null ? null : new OrderSummary {
            Id = order.Id,
            CustomerName = GetCustomerName(order.CustomerId),
            Total = order.Total,
            ItemCount = order.Items.Count,
            Status = order.Status.ToString()
        };
    }
    
    public bool Exists(Guid orderId) {
        return _orders.ContainsKey(orderId);
    }
    
    public IEnumerable<Order> Scan() {
        return _orders.Values;
    }
}
```

## Core Lens Methods Explained

### Focus - Single Item Retrieval

:::new
Retrieve a single item by its identifier:
:::

```csharp
public interface ICustomerLens : ILens {
    Customer Focus(Guid customerId);
}

// Usage in receptor
public class OrderReceptor : IReceptor<UpdateOrder> {
    public OrderUpdated Receive(UpdateOrder cmd, ICustomerLens lens) {
        var customer = lens.Focus(cmd.CustomerId);
        if (customer == null) {
            throw new CustomerNotFoundException(cmd.CustomerId);
        }
        
        if (!customer.IsActive) {
            throw new InactiveCustomerException();
        }
        
        return new OrderUpdated(cmd.OrderId, cmd.Changes);
    }
}
```

### View - Filtered Collections

:::new
Query multiple items with filters:
:::

```csharp
public interface IProductLens : ILens {
    IEnumerable<Product> View(Expression<Func<Product, bool>> filter);
    IEnumerable<Product> ViewByCategory(string category);
    IEnumerable<Product> ViewInPriceRange(decimal min, decimal max);
}

// Implementation
public class ProductLens : IProductLens {
    public IEnumerable<Product> ViewByCategory(string category) {
        return _products.Values.Where(p => p.Category == category);
    }
    
    public IEnumerable<Product> ViewInPriceRange(decimal min, decimal max) {
        return _products.Values.Where(p => p.Price >= min && p.Price <= max);
    }
}
```

### Glimpse - Summaries and Projections

:::new
Get lightweight summaries without full entity data:
:::

```csharp
public interface IInventoryLens : ILens {
    InventorySummary Glimpse(Guid productId);
    StockLevel GlimpseStock(Guid productId);
    IEnumerable<LowStockItem> GlimpseLowStock();
}

// Returns just what's needed
public InventorySummary Glimpse(Guid productId) {
    var product = _products[productId];
    return new InventorySummary {
        ProductId = product.Id,
        Name = product.Name,
        Available = product.Quantity - product.Reserved,
        Status = product.Quantity > 10 ? "In Stock" : "Low Stock"
    };
}
```

### Exists - Efficient Existence Checks

:::new
Check if an item exists without loading it:
:::

```csharp
public class OrderReceptor : IReceptor<AddItemToOrder> {
    public ItemAdded Receive(AddItemToOrder cmd, IOrderLens orderLens, IProductLens productLens) {
        if (!orderLens.Exists(cmd.OrderId)) {
            throw new OrderNotFoundException(cmd.OrderId);
        }
        
        if (!productLens.Exists(cmd.ProductId)) {
            throw new ProductNotFoundException(cmd.ProductId);
        }
        
        return new ItemAdded(cmd.OrderId, cmd.ProductId, cmd.Quantity);
    }
}
```

### Scan - Full Collection Access

:::new
Retrieve all items (use sparingly):
:::

```csharp
public interface IReportLens : ILens {
    IEnumerable<Order> ScanOrders();
    IEnumerable<Customer> ScanCustomers();
}

// Use with caution - can be expensive
public DailyReport GenerateReport(IReportLens lens) {
    var allOrders = lens.ScanOrders();
    return new DailyReport {
        TotalOrders = allOrders.Count(),
        TotalRevenue = allOrders.Sum(o => o.Total),
        AverageOrderValue = allOrders.Average(o => o.Total)
    };
}
```

## Composition Pattern

:::new
Lenses can be composed for complex queries:
:::

```csharp
public class OrderSearchLens : IOrderSearchLens {
    private readonly IOrderLens _orderLens;
    private readonly ICustomerLens _customerLens;
    private readonly IProductLens _productLens;
    
    public IEnumerable<OrderSearchResult> Search(OrderSearchCriteria criteria) {
        var orders = _orderLens.Scan();
        
        if (criteria.CustomerId.HasValue) {
            var customer = _customerLens.Focus(criteria.CustomerId.Value);
            orders = orders.Where(o => o.CustomerId == customer.Id);
        }
        
        if (!string.IsNullOrEmpty(criteria.ProductSku)) {
            var product = _productLens.ViewBySku(criteria.ProductSku).FirstOrDefault();
            orders = orders.Where(o => o.Items.Any(i => i.ProductId == product?.Id));
        }
        
        return orders.Select(o => MapToSearchResult(o));
    }
}
```

## Source Generation

:::new
Lenses are discovered and registered at compile time:
:::

```csharp
// Generated by Whizbang.Generators
public static partial class WhizbangGenerated {
    public static void RegisterLenses(IServiceCollection services) {
        services.AddScoped<IOrderLens, OrderLens>();
        services.AddScoped<ICustomerLens, CustomerLens>();
        services.AddScoped<IProductLens, ProductLens>();
        services.AddScoped<IInventoryLens, InventoryLens>();
    }
}
```

## Testing Lenses

```csharp
[Test]
public class OrderLensTests {
    private OrderLens _lens;
    private InMemoryStore<Order> _store;
    
    [SetUp]
    public void Setup() {
        _store = new InMemoryStore<Order>();
        _lens = new OrderLens(_store);
        
        // Add test data
        _store.Collection[Guid.Parse("123...")] = new Order {
            Id = Guid.Parse("123..."),
            CustomerId = Guid.Parse("456..."),
            Status = OrderStatus.Pending,
            Total = 99.99m
        };
    }
    
    [Test]
    public void Focus_ExistingOrder_ShouldReturnOrder() {
        var order = _lens.Focus(Guid.Parse("123..."));
        Assert.NotNull(order);
        Assert.Equal(99.99m, order.Total);
    }
    
    [Test]
    public void ViewByStatus_ShouldFilterCorrectly() {
        var pendingOrders = _lens.ViewByStatus(OrderStatus.Pending);
        Assert.Equal(1, pendingOrders.Count());
    }
    
    [Test]
    public void Exists_ExistingOrder_ShouldReturnTrue() {
        Assert.True(_lens.Exists(Guid.Parse("123...")));
    }
}
```

## IDE Features

```csharp
// IDE shows: "Used by: 5 receptors | Queries: 234 | Avg: 0.5ms"
public interface IOrderLens : ILens { }

// IDE shows: "Called 45 times | Last: 2s ago | Avg: 0.3ms"
public Order Focus(Guid orderId) { }

// IDE shows: "Warning: Scan can be expensive - consider using View with filters"
public IEnumerable<Order> Scan() { }
```

## Performance Characteristics

| Operation | Target | Actual |
|-----------|--------|--------|
| Focus (in-memory) | < 100ns | TBD |
| View (filtered) | < 1μs per item | TBD |
| Glimpse | < 500ns | TBD |
| Exists | < 50ns | TBD |
| Scan (1000 items) | < 1ms | TBD |

## Limitations in v1.0.0

:::info
These limitations are addressed in future versions:
:::

- **No pagination** - All results returned at once
- **Synchronous only** - No async/await support
- **In-memory only** - No database queries
- **No caching** - Queries execute every time

## Migration Path

### To v0.2.0 (Enhanced Queries)

:::planned
v0.2.0 adds pagination and async support:
:::

```csharp
// v0.2.0 - Pagination
public interface IOrderLens : ILens {
    PagedResult<Order> ViewByCustomer(Guid customerId, int page, int pageSize);
}

// v0.2.0 - Async enumeration
public interface IOrderLens : ILens {
    IAsyncEnumerable<Order> ScanAsync();
}
```

### To v0.4.0 (Database Queries)

:::planned
v0.4.0 adds real database support with SQL generation:
:::

```csharp
// v0.4.0 - SQL generation
[SqlOptimized]
public class OrderLens : IOrderLens {
    public Order Focus(Guid orderId) {
        // Generated SQL: SELECT * FROM Orders WHERE Id = @orderId
        return _db.QuerySingle<Order>("...", new { orderId });
    }
}
```

## Best Practices

1. **Keep lenses read-only** - Never modify state through a lens
2. **Use specific methods** - ViewByCustomer over generic View
3. **Avoid Scan** - Use filtered queries when possible
4. **Return summaries** - Use Glimpse for lightweight results
5. **Check existence** - Use Exists before Focus
6. **Compose lenses** - Combine for complex queries

## Related Documentation

- [Receptors](receptors.md) - Using lenses in receptors
- [Perspectives](perspectives.md) - Data that lenses query
- [Dispatcher](dispatcher.md) - How lenses are provided
- [Testing](../testing/foundation.md) - Testing lenses
- [Feature Evolution](../../roadmap/FEATURE-EVOLUTION.md) - How lenses evolve

## Next Steps

- See [v0.2.0 Enhancements](../../v0.2.0/enhancements/lenses.md) for pagination and async features
- See [v0.4.0 Database Support](../../v0.4.0/drivers/lenses.md) for SQL optimization
- Review [Examples](../examples/complex-queries.md) for query patterns
