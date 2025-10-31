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

```csharp{
title: "Order Lens Interface"
description: "Basic lens interface pattern with core query methods"
framework: "NET8"
category: "Core Concepts"
difficulty: "BEGINNER"
tags: ["Lenses", "Interfaces", "CQRS"]
filename: "IOrderLens.cs"
usingStatements: ["System", "System.Collections.Generic", "System.Linq.Expressions"]
showLineNumbers: true
}
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
```csharp{
title: "Customer Lens Focus Method"
description: "Implementing the Focus method for single item retrieval"
framework: "NET8"
category: "Core Concepts"
difficulty: "BEGINNER"
tags: ["Lenses", "Focus", "Single Item"]
filename: "CustomerLens.cs"
usingStatements: ["System", "System.Threading.Tasks", "System.Linq"]
showLineNumbers: true
}
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
```csharp{
title: "Order Lens View Methods"
description: "Implementing View methods for filtered collections"
framework: "NET8"
category: "Core Concepts"
difficulty: "BEGINNER"
tags: ["Lenses", "View", "Filtering"]
filename: "OrderLens.cs"
usingStatements: ["System", "System.Collections.Generic", "System.Linq.Expressions", "System.Linq"]
showLineNumbers: true
}
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
```csharp{
title: "Inventory Lens Glimpse Methods"
description: "Implementing Glimpse methods for summaries and projections"
framework: "NET8"
category: "Core Concepts"
difficulty: "INTERMEDIATE"
tags: ["Lenses", "Glimpse", "Inventory", "Summaries"]
filename: "InventoryLens.cs"
usingStatements: ["System", "System.Collections.Generic"]
showLineNumbers: true
}
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
```csharp{
title: "Product Lens Exists Methods"
description: "Efficient existence checks with conditions"
framework: "NET8"
category: "Core Concepts"
difficulty: "BEGINNER"
tags: ["Lenses", "Exists", "Efficiency"]
filename: "ProductLens.cs"
usingStatements: ["System", "System.Linq.Expressions", "System.Linq"]
showLineNumbers: true
}
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

```csharp{
title: "Lens Usage in Receptors"
description: "Using lenses to provide state for stateless receptors"
framework: "NET8"
category: "Core Concepts"
difficulty: "INTERMEDIATE"
tags: ["Lenses", "Receptors", "Validation"]
filename: "OrderReceptor.cs"
usingStatements: ["System", "Whizbang"]
showLineNumbers: true
}
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

```csharp{
title: "Composite Checkout Lens"
description: "Combining multiple data sources into a unified view for checkout"
framework: "NET8"
category: "Core Concepts"
difficulty: "INTERMEDIATE"
tags: ["Lenses", "Composite", "Checkout"]
filename: "CheckoutLens.cs"
usingStatements: ["System", "System.Collections.Generic"]
showLineNumbers: true
}
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

```csharp{
title: "Cached Product Lens"
description: "Optimizing read performance with caching decorator pattern"
framework: "NET8"
category: "Performance"
difficulty: "INTERMEDIATE"
tags: ["Lenses", "Caching", "Performance"]
filename: "CachedProductLens.cs"
usingStatements: ["System", "System.Collections.Generic", "System.Linq"]
showLineNumbers: true
}
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

```csharp{
title: "Paged Query Lens"
description: "Supporting pagination for large result sets"
framework: "NET8"
category: "Core Concepts"
difficulty: "INTERMEDIATE"
tags: ["Lenses", "Pagination", "Performance"]
filename: "OrderLens.cs"
usingStatements: ["System", "System.Linq", "System.Linq.Expressions"]
showLineNumbers: true
}
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

```csharp{
title: "Statistics Aggregate Lens"
description: "Providing pre-calculated aggregations and metrics"
framework: "NET8"
category: "Analytics"
difficulty: "INTERMEDIATE"
tags: ["Lenses", "Statistics", "Aggregation"]
filename: "StatisticsLens.cs"
usingStatements: ["System", "System.Collections.Generic", "System.Linq"]
showLineNumbers: true
}
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

```csharp{
title: "ElasticSearch Lens"
description: "Integrating with search infrastructure for advanced queries"
framework: "NET8"
category: "Search"
difficulty: "ADVANCED"
tags: ["Lenses", "Search", "ElasticSearch"]
filename: "ElasticSearchLens.cs"
nugetPackages: ["Elasticsearch.Net", "NEST"]
usingStatements: ["System", "System.Collections.Generic", "Nest"]
showLineNumbers: true
}
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

```csharp{
title: "Lens Configuration"
description: "Configuring lenses with the Whizbang dispatcher"
framework: "NET8"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["Lenses", "Configuration", "Dependency Injection"]
filename: "Program.cs"
nugetPackages: ["Whizbang.Core", "Microsoft.Extensions.DependencyInjection"]
usingStatements: ["Microsoft.Extensions.DependencyInjection", "Whizbang"]
showLineNumbers: true
}
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

```csharp{
title: "Testing Lenses"
description: "Unit testing lenses with in-memory data and mocking"
framework: "NET8"
category: "Testing"
difficulty: "INTERMEDIATE"
tags: ["Lenses", "Testing", "Unit Tests", "Mocking"]
filename: "OrderLensTests.cs"
nugetPackages: ["xunit", "Moq"]
testFile: "OrderLensTests.cs"
testMethod: "OrderLens_ViewByCustomer_ReturnsCustomerOrders"
usingStatements: ["System", "System.Linq", "Xunit", "Moq"]
showLineNumbers: true
}
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
```csharp{
title: "Read-Only Lens Interface"
description: "Best practice: Keep lenses read-only"
framework: "NET8"
category: "Best Practices"
difficulty: "BEGINNER"
tags: ["Lenses", "Best Practices", "Read-Only"]
filename: "IOrderLens.cs"
usingStatements: ["System"]
}
public interface IOrderLens {
    Order Focus(Guid id);  // Read-only methods only
}
```

✅ **Use specific method names**
```csharp{
title: "Specific Method Names"
description: "Best practice: Use specific method names for clear intent"
framework: "NET8"
category: "Best Practices"
difficulty: "BEGINNER"
tags: ["Lenses", "Best Practices", "Method Naming"]
filename: "IOrderLens.cs"
usingStatements: ["System", "System.Collections.Generic"]
}
IEnumerable<Order> ViewPending();      // Clear intent
IEnumerable<Order> ViewByDateRange(DateTime from, DateTime to);
```

✅ **Optimize for common queries**
```csharp{
title: "Optimized Common Queries"
description: "Best practice: Optimize for common query patterns"
framework: "NET8"
category: "Best Practices"
difficulty: "INTERMEDIATE"
tags: ["Lenses", "Best Practices", "Performance"]
filename: "ICustomerLens.cs"
usingStatements: ["System"]
}
// Pre-calculate common aggregations
CustomerDashboard GetCustomerDashboard(Guid customerId);
```

✅ **Return immutable data**
```csharp{
title: "Return Immutable Data"
description: "Best practice: Return immutable data collections"
framework: "NET8"
category: "Best Practices"
difficulty: "BEGINNER"
tags: ["Lenses", "Best Practices", "Immutable"]
filename: "OrderLens.cs"
usingStatements: ["System", "System.Collections.Generic", "System.Linq"]
}
public IReadOnlyList<Order> ViewRecent() {
    return db.Orders.OrderByDescending(o => o.CreatedAt)
        .Take(10)
        .ToList()
        .AsReadOnly();
}
```

### Don'ts

❌ **Don't include write operations**
```csharp{
title: "Anti-Pattern: Write Operations"
description: "DON'T include write operations in lenses"
framework: "NET8"
category: "Anti-Patterns"
difficulty: "BEGINNER"
tags: ["Lenses", "Anti-Patterns", "Read-Only"]
filename: "IOrderLens.cs"
usingStatements: ["System"]
}
// BAD - Lenses are read-only
public interface IOrderLens {
    void Save(Order order);  // Don't do this!
}
```

❌ **Don't return mutable entities**
```csharp{
title: "Mutable vs Immutable Returns"
description: "BAD: Mutable entities vs GOOD: Immutable views"
framework: "NET8"
category: "Anti-Patterns"
difficulty: "INTERMEDIATE"
tags: ["Lenses", "Anti-Patterns", "Immutable"]
filename: "OrderLens.cs"
usingStatements: ["System"]
}
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
```csharp{
title: "Anti-Pattern: Business Logic"
description: "DON'T perform business logic in lenses"
framework: "NET8"
category: "Anti-Patterns"
difficulty: "INTERMEDIATE"
tags: ["Lenses", "Anti-Patterns", "Business Logic"]
filename: "OrderLens.cs"
usingStatements: ["System", "System.Collections.Generic", "System.Linq"]
}
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

```csharp{
title: "Materialized View Lens"
description: "Reading from pre-computed materialized views"
framework: "NET8"
category: "Advanced"
difficulty: "ADVANCED"
tags: ["Lenses", "Materialized Views", "Performance"]
filename: "MaterializedOrderLens.cs"
usingStatements: ["System", "System.Collections.Generic", "System.Linq"]
showLineNumbers: true
}
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

```csharp{
title: "Cross-Service Lens"
description: "Querying data from multiple distributed services"
framework: "NET8"
category: "Advanced"
difficulty: "ADVANCED"
tags: ["Lenses", "Distributed", "Microservices"]
filename: "DistributedCustomerLens.cs"
usingStatements: ["System", "System.Threading.Tasks"]
showLineNumbers: true
}
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

```csharp{
title: "Time-Travel Lens"
description: "Querying historical state in event-sourced systems"
framework: "NET8"
category: "Advanced"
difficulty: "ADVANCED"
tags: ["Lenses", "Event Sourcing", "Time Travel"]
filename: "HistoricalOrderLens.cs"
nugetPackages: ["Whizbang.EventSourcing"]
usingStatements: ["System", "System.Collections.Generic", "Whizbang"]
showLineNumbers: true
}
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