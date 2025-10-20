---
title: Lenses
category: Core Concepts
order: 4
tags: lenses, queries, read-model, cqrs, read-only
description: Lenses - read-only interfaces for querying data in Whizbang
---

# Lenses

## Overview

Lenses provide focused, read-only views into your data. They are the query side of Whizbang's CQRS implementation, offering a clean separation between reads and writes. Lenses work consistently across Event-Driven and Event-Sourced modes, always providing the current view of data regardless of how it's stored.

## What is a Lens?

A Lens:
- **Provides** read-only access to data
- **Focuses** on specific query needs
- **Never** modifies state
- **Abstracts** the underlying storage mechanism

Think of a lens as a window into your data - you can look through it from different angles to see different views, but you can't reach through it to change what you see.

## The Lens Interface Pattern

```csharp
public interface IOrderLens {
    // Focus on a single item
    Order Focus(Guid id);
    
    // View a filtered collection
    IEnumerable<Order> View(Expression<Func<Order, bool>> filter);
    
    // Glimpse a summary or partial view
    OrderSummary Glimpse(Guid id);
    
    // Check existence
    bool Exists(Guid id);
    
    // Scan all items (use sparingly)
    IEnumerable<Order> Scan();
}
```

## Core Lens Methods

### Focus - Single Item Retrieval
```csharp
public interface ICustomerLens {
    Customer Focus(Guid customerId);
    Task<Customer> FocusAsync(Guid customerId);
}

// Implementation
public class CustomerLens : ICustomerLens {
    private readonly IDatabase db;
    
    public Customer Focus(Guid customerId) {
        return db.Customers.FirstOrDefault(c => c.Id == customerId);
    }
}
```

### View - Filtered Collections
```csharp
public interface IOrderLens {
    IEnumerable<Order> View(Expression<Func<Order, bool>> filter);
    IEnumerable<Order> ViewByCustomer(Guid customerId);
    IEnumerable<Order> ViewByStatus(OrderStatus status);
}

// Implementation
public class OrderLens : IOrderLens {
    public IEnumerable<Order> View(Expression<Func<Order, bool>> filter) {
        return db.Orders.Where(filter);
    }
    
    public IEnumerable<Order> ViewByCustomer(Guid customerId) {
        return db.Orders.Where(o => o.CustomerId == customerId);
    }
}
```

### Glimpse - Summaries and Projections
```csharp
public interface IInventoryLens {
    InventorySummary Glimpse(Guid productId);
    StockLevel GlimpseStock(Guid productId);
    IEnumerable<LowStockItem> GlimpseLowStock();
}

// Implementation  
public class InventoryLens : IInventoryLens {
    public InventorySummary Glimpse(Guid productId) {
        var product = db.Products.Find(productId);
        return new InventorySummary {
            ProductId = product.Id,
            Name = product.Name,
            InStock = product.Quantity,
            Reserved = product.ReservedQuantity,
            Available = product.Quantity - product.ReservedQuantity
        };
    }
}
```

### Exists - Efficient Existence Checks
```csharp
public interface IProductLens {
    bool Exists(Guid productId);
    bool Exists(Expression<Func<Product, bool>> condition);
}

// Implementation
public class ProductLens : IProductLens {
    public bool Exists(Guid productId) {
        return db.Products.Any(p => p.Id == productId);
    }
    
    public bool Exists(Expression<Func<Product, bool>> condition) {
        return db.Products.Any(condition);
    }
}
```

## Lens Usage in Receptors

Lenses provide state for stateless receptors:

```csharp
public class OrderReceptor : IReceptor<CreateOrder> {
    public OrderCreated Receive(CreateOrder cmd, IOrderLens orderLens, ICustomerLens customerLens) {
        // Use lenses to validate
        if (!customerLens.Exists(cmd.CustomerId)) {
            throw new CustomerNotFoundException();
        }
        
        var customer = customerLens.Focus(cmd.CustomerId);
        if (!customer.IsActive) {
            throw new InactiveCustomerException();
        }
        
        // Check for duplicate orders
        if (orderLens.Exists(o => o.CustomerId == cmd.CustomerId && o.IsPending)) {
            throw new PendingOrderExistsException();
        }
        
        // Make decision based on lens data
        return new OrderCreated(
            Guid.NewGuid(),
            cmd.CustomerId,
            cmd.Items,
            CalculateTotal(cmd.Items, customer.Tier)
        );
    }
}
```

## Composite Lenses

Combine multiple data sources into a unified view:

```csharp
public interface ICheckoutLens {
    CheckoutContext PrepareCheckout(Guid customerId, List<CartItem> items);
}

public class CheckoutLens : ICheckoutLens {
    private readonly ICustomerLens customerLens;
    private readonly IInventoryLens inventoryLens;
    private readonly IPromotionLens promotionLens;
    private readonly ITaxLens taxLens;
    
    public CheckoutContext PrepareCheckout(Guid customerId, List<CartItem> items) {
        var customer = customerLens.Focus(customerId);
        var inventory = inventoryLens.CheckAvailability(items);
        var promotions = promotionLens.GetApplicable(customer, items);
        var tax = taxLens.Calculate(customer.Address, items);
        
        return new CheckoutContext {
            Customer = customer,
            Items = items,
            InventoryStatus = inventory,
            AppliedPromotions = promotions,
            TaxAmount = tax,
            Total = CalculateTotal(items, promotions, tax)
        };
    }
}
```

## Cached Lenses

Optimize read performance with caching:

```csharp
public class CachedProductLens : IProductLens {
    private readonly IProductLens innerLens;
    private readonly ICache cache;
    
    public Product Focus(Guid productId) {
        var cacheKey = $"product:{productId}";
        
        return cache.GetOrSet(cacheKey, () => {
            return innerLens.Focus(productId);
        }, TimeSpan.FromMinutes(5));
    }
    
    public IEnumerable<Product> ViewByCategory(string category) {
        var cacheKey = $"products:category:{category}";
        
        return cache.GetOrSet(cacheKey, () => {
            return innerLens.ViewByCategory(category).ToList();
        }, TimeSpan.FromMinutes(1));
    }
}
```

## Paged Queries

Support pagination for large result sets:

```csharp
public interface IOrderLens {
    PagedResult<Order> ViewPaged(int page, int pageSize, Expression<Func<Order, bool>> filter = null);
}

public class OrderLens : IOrderLens {
    public PagedResult<Order> ViewPaged(int page, int pageSize, Expression<Func<Order, bool>> filter = null) {
        var query = db.Orders.AsQueryable();
        
        if (filter != null) {
            query = query.Where(filter);
        }
        
        var totalCount = query.Count();
        var items = query
            .OrderByDescending(o => o.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToList();
        
        return new PagedResult<Order> {
            Items = items,
            Page = page,
            PageSize = pageSize,
            TotalCount = totalCount,
            TotalPages = (int)Math.Ceiling(totalCount / (double)pageSize)
        };
    }
}
```

## Aggregate Queries

Provide pre-calculated aggregations:

```csharp
public interface IStatisticsLens {
    OrderStatistics GetOrderStats(DateTime from, DateTime to);
    CustomerMetrics GetCustomerMetrics(Guid customerId);
    IEnumerable<TopProduct> GetTopProducts(int count);
}

public class StatisticsLens : IStatisticsLens {
    public OrderStatistics GetOrderStats(DateTime from, DateTime to) {
        var orders = db.Orders.Where(o => o.CreatedAt >= from && o.CreatedAt <= to);
        
        return new OrderStatistics {
            TotalOrders = orders.Count(),
            TotalRevenue = orders.Sum(o => o.Total),
            AverageOrderValue = orders.Average(o => o.Total),
            OrdersByStatus = orders.GroupBy(o => o.Status)
                .Select(g => new StatusCount { 
                    Status = g.Key, 
                    Count = g.Count() 
                }).ToList()
        };
    }
}
```

## Search Lenses

Integrate with search infrastructure:

```csharp
public interface ISearchLens {
    SearchResults<Product> SearchProducts(string query, SearchOptions options);
    IEnumerable<SearchSuggestion> GetSuggestions(string prefix);
}

public class ElasticSearchLens : ISearchLens {
    private readonly IElasticClient elastic;
    
    public SearchResults<Product> SearchProducts(string query, SearchOptions options) {
        var searchRequest = new SearchRequest<Product> {
            Query = new MultiMatchQuery {
                Query = query,
                Fields = new[] { "name", "description", "category" }
            },
            From = options.Offset,
            Size = options.Limit,
            Aggregations = new TermsAggregation("categories") {
                Field = "category.keyword"
            }
        };
        
        var response = elastic.Search<Product>(searchRequest);
        
        return new SearchResults<Product> {
            Items = response.Documents,
            TotalCount = response.Total,
            Facets = ExtractFacets(response.Aggregations),
            HighlightedTerms = ExtractHighlights(response.Hits)
        };
    }
}
```

## Lens Configuration

Configure lenses with the dispatcher:

```csharp
services.AddWhizbang()
    .UseDispatcher(dispatcher => {
        // Register lenses
        dispatcher.RegisterLensesFromAssembly(typeof(Program).Assembly);
        
        // Configure caching for all lenses
        dispatcher.Lenses
            .EnableCaching(TimeSpan.FromMinutes(5))
            .UseCacheProvider<RedisCache>();
            
        // Specific lens configuration
        dispatcher.ForLens<IProductLens>()
            .UseCaching(TimeSpan.FromMinutes(10))
            .WithImplementation<CachedProductLens>();
    });

// Manual registration
services.AddScoped<IOrderLens, OrderLens>();
services.AddScoped<ICustomerLens, CustomerLens>();
services.Decorate<IProductLens, CachedProductLens>();
```

## Testing Lenses

Lenses are easy to test and mock:

```csharp
[Fact]
public void OrderLens_ViewByCustomer_ReturnsCustomerOrders() {
    // Arrange
    var db = new InMemoryDatabase();
    var customerId = Guid.NewGuid();
    db.Orders.Add(new Order { CustomerId = customerId });
    db.Orders.Add(new Order { CustomerId = customerId });
    db.Orders.Add(new Order { CustomerId = Guid.NewGuid() });
    
    var lens = new OrderLens(db);
    
    // Act
    var orders = lens.ViewByCustomer(customerId);
    
    // Assert
    Assert.Equal(2, orders.Count());
    Assert.All(orders, o => Assert.Equal(customerId, o.CustomerId));
}

// Mocking in receptor tests
[Fact]
public void OrderReceptor_ThrowsException_WhenCustomerNotFound() {
    // Arrange
    var customerLens = Mock.Of<ICustomerLens>(l => 
        l.Exists(It.IsAny<Guid>()) == false
    );
    var receptor = new OrderReceptor();
    
    // Act & Assert
    Assert.Throws<CustomerNotFoundException>(() =>
        receptor.Receive(new CreateOrder(), null, customerLens)
    );
}
```

## Best Practices

### Do's

✅ **Keep lenses read-only**
```csharp
public interface IOrderLens {
    Order Focus(Guid id);  // Read-only methods only
}
```

✅ **Use specific method names**
```csharp
IEnumerable<Order> ViewPending();      // Clear intent
IEnumerable<Order> ViewByDateRange(DateTime from, DateTime to);
```

✅ **Optimize for common queries**
```csharp
// Pre-calculate common aggregations
CustomerDashboard GetCustomerDashboard(Guid customerId);
```

✅ **Return immutable data**
```csharp
public IReadOnlyList<Order> ViewRecent() {
    return db.Orders.OrderByDescending(o => o.CreatedAt)
        .Take(10)
        .ToList()
        .AsReadOnly();
}
```

### Don'ts

❌ **Don't include write operations**
```csharp
// BAD - Lenses are read-only
public interface IOrderLens {
    void Save(Order order);  // Don't do this!
}
```

❌ **Don't return mutable entities**
```csharp
// BAD - Returns mutable entity
public Order Focus(Guid id) {
    return db.Orders.Find(id);  // Can be modified
}

// GOOD - Return immutable view
public OrderView Focus(Guid id) {
    var order = db.Orders.Find(id);
    return new OrderView(order);  // Immutable copy
}
```

❌ **Don't perform business logic**
```csharp
// BAD - Business logic in lens
public IEnumerable<Order> ViewDiscounted() {
    return db.Orders.Where(o => {
        if (o.Total > 100) {  // Business rule!
            return true;
        }
    });
}
```

## Advanced Patterns

### Materialized View Lenses

Read from pre-computed materialized views:

```csharp
public class MaterializedOrderLens : IOrderLens {
    // Read from denormalized view maintained by perspectives
    public OrderSummary Glimpse(Guid orderId) {
        return db.OrderSummaries.Find(orderId);  // Pre-computed
    }
    
    public IEnumerable<Order> ViewTopOrders(int count) {
        return db.TopOrdersView.Take(count);  // Maintained by perspective
    }
}
```

### Cross-Service Lenses

Query data from multiple services:

```csharp
public class DistributedCustomerLens : ICustomerLens {
    private readonly IOrderService orderService;
    private readonly IPaymentService paymentService;
    
    public async Task<CustomerProfile> GetCompleteProfile(Guid customerId) {
        var customerTask = db.Customers.FindAsync(customerId);
        var ordersTask = orderService.GetCustomerOrders(customerId);
        var paymentsTask = paymentService.GetPaymentHistory(customerId);
        
        await Task.WhenAll(customerTask, ordersTask, paymentsTask);
        
        return new CustomerProfile {
            Customer = customerTask.Result,
            RecentOrders = ordersTask.Result,
            PaymentHistory = paymentsTask.Result
        };
    }
}
```

### Time-Travel Lenses

In Event-Sourced mode, query historical state:

```csharp
public interface IHistoricalLens {
    Order FocusAsOf(Guid orderId, DateTime pointInTime);
    IEnumerable<Order> ViewAsOf(DateTime pointInTime);
}

public class HistoricalOrderLens : IHistoricalLens {
    private readonly IEventStore eventStore;
    
    public Order FocusAsOf(Guid orderId, DateTime pointInTime) {
        var events = eventStore.GetEvents(orderId, untilTime: pointInTime);
        return RebuildOrder(events);
    }
}
```

## Summary

Lenses provide the read side of Whizbang's architecture:

- **Read-only interfaces** maintain clear separation of concerns
- **Focused methods** optimize for specific query needs  
- **Work consistently** across Event-Driven and Event-Sourced modes
- **Easy to test** and mock
- **Composable** for complex query scenarios

Lenses ensure that reading data is simple, efficient, and completely separate from writing data.

## Next Steps

- Explore **[Receptors](/docs/core-concepts/receptors)** - How commands are processed
- Learn about **[Perspectives](/docs/core-concepts/perspectives)** - How data is written
- See **[Event-Driven Architecture](/docs/architecture-design/event-driven-architecture)** - Complete architecture
- Review **[CQRS Implementation](/docs/usage-patterns/cqrs-implementation)** - Query patterns