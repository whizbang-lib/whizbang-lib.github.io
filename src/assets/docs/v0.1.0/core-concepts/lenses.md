---
title: "Lenses Guide"
version: 0.1.0
category: Core Concepts
order: 4
description: "Master Whizbang Lenses - query-optimized repositories for fast, efficient access to read models maintained by Perspectives"
tags: lenses, queries, read-models, repositories, cqrs
codeReferences:
  - src/Whizbang.Core/ILensQuery.cs
  - samples/ECommerce/ECommerce.BFF.API/Lenses/OrderLens.cs
  - samples/ECommerce/ECommerce.BFF.API/Lenses/InventoryLens.cs
---

# Lenses Guide

**Lenses** are query-optimized repositories for reading data from read models (maintained by Perspectives). They complete the "Q" in CQRS - providing fast, efficient queries over denormalized data.

## Core Concept

A Lens is a **focused view** for querying specific read models:
- **Reads from denormalized tables** (updated by Perspectives)
- **Fast, simple queries** (no joins, no complexity)
- **Optimized for specific use cases** (customer orders, inventory levels, analytics)
- **Read-only** (no write operations)

## ILensQuery Interface

```csharp
namespace Whizbang.Core;

public interface ILensQuery {
    // Marker interface - no required methods
    // Implement query methods specific to your read model
}
```

**Key Characteristics**:
- **Marker interface**: Identifies lens implementations
- **No prescribed methods**: Define queries specific to your use case
- **Read-only**: Never mutates data
- **Async**: All methods return `Task<T>` or `ValueTask<T>`

---

## Relationship to Perspectives

**Perspectives** and **Lenses** work together to implement CQRS:

```
┌──────────── WRITE SIDE ─────────────┐
│                                      │
│  Command → Receptor → Event          │
│                                      │
└────────────┬─────────────────────────┘
             │
             │ dispatcher.PublishAsync()
             ↓
┌──────────── READ SIDE ──────────────┐
│                                      │
│  Event → Perspective → Read Model    │  ← Perspectives WRITE
│             ↓                        │
│  Read Model Table (denormalized)    │
│             ↓                        │
│  Lens → Query Read Model             │  ← Lenses READ
│             ↓                        │
│  Return DTO to Client                │
│                                      │
└──────────────────────────────────────┘
```

**Division of Labor**:
- **Perspectives**: Update read models (write-only)
- **Lenses**: Query read models (read-only)

---

## Basic Example

```csharp
using Whizbang.Core;
using Dapper;

public class OrderLens : ILensQuery {
    private readonly IDbConnectionFactory _db;

    public OrderLens(IDbConnectionFactory db) {
        _db = db;
    }

    public async Task<OrderSummary?> GetOrderAsync(
        Guid orderId,
        CancellationToken ct = default) {

        await using var conn = _db.CreateConnection();

        return await conn.QuerySingleOrDefaultAsync<OrderSummary>(
            """
            SELECT
                order_id AS OrderId,
                customer_id AS CustomerId,
                customer_email AS CustomerEmail,
                customer_name AS CustomerName,
                item_count AS ItemCount,
                total AS Total,
                status AS Status,
                created_at AS CreatedAt,
                shipped_at AS ShippedAt,
                cancelled_at AS CancelledAt
            FROM order_summaries
            WHERE order_id = @OrderId
            """,
            new { OrderId = orderId },
            commandTimeout: 30,
            cancellationToken: ct
        );
    }

    public async Task<OrderSummary[]> GetOrdersByCustomerAsync(
        Guid customerId,
        CancellationToken ct = default) {

        await using var conn = _db.CreateConnection();

        var orders = await conn.QueryAsync<OrderSummary>(
            """
            SELECT
                order_id AS OrderId,
                customer_id AS CustomerId,
                customer_email AS CustomerEmail,
                customer_name AS CustomerName,
                item_count AS ItemCount,
                total AS Total,
                status AS Status,
                created_at AS CreatedAt,
                shipped_at AS ShippedAt,
                cancelled_at AS CancelledAt
            FROM order_summaries
            WHERE customer_id = @CustomerId
            ORDER BY created_at DESC
            """,
            new { CustomerId = customerId },
            commandTimeout: 30,
            cancellationToken: ct
        );

        return orders.ToArray();
    }
}

// DTO returned by lens
public record OrderSummary(
    Guid OrderId,
    Guid CustomerId,
    string CustomerEmail,
    string CustomerName,
    int ItemCount,
    decimal Total,
    string Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset? ShippedAt,
    DateTimeOffset? CancelledAt
);
```

**Key Points**:
- Simple SQL (single table, no joins)
- Returns DTOs optimized for client
- Async methods with CancellationToken
- Nullable return for "not found" cases

---

## Query Patterns

### Pattern 1: Get by ID

```csharp
public async Task<OrderSummary?> GetOrderAsync(
    Guid orderId,
    CancellationToken ct = default) {

    await using var conn = _db.CreateConnection();

    return await conn.QuerySingleOrDefaultAsync<OrderSummary>(
        "SELECT * FROM order_summaries WHERE order_id = @OrderId",
        new { OrderId = orderId },
        cancellationToken: ct
    );
}
```

**Use Case**: Retrieve single entity by primary key.

### Pattern 2: List with Filtering

```csharp
public async Task<OrderSummary[]> GetOrdersByStatusAsync(
    string status,
    CancellationToken ct = default) {

    await using var conn = _db.CreateConnection();

    var orders = await conn.QueryAsync<OrderSummary>(
        """
        SELECT * FROM order_summaries
        WHERE status = @Status
        ORDER BY created_at DESC
        """,
        new { Status = status },
        cancellationToken: ct
    );

    return orders.ToArray();
}
```

**Use Case**: Filter and sort lists.

### Pattern 3: Pagination

```csharp
public async Task<PagedResult<OrderSummary>> GetOrdersPagedAsync(
    int pageNumber,
    int pageSize,
    CancellationToken ct = default) {

    await using var conn = _db.CreateConnection();

    var offset = (pageNumber - 1) * pageSize;

    // Get total count
    var totalCount = await conn.ExecuteScalarAsync<int>(
        "SELECT COUNT(*) FROM order_summaries",
        cancellationToken: ct
    );

    // Get page of results
    var orders = await conn.QueryAsync<OrderSummary>(
        """
        SELECT * FROM order_summaries
        ORDER BY created_at DESC
        LIMIT @PageSize OFFSET @Offset
        """,
        new { PageSize = pageSize, Offset = offset },
        cancellationToken: ct
    );

    return new PagedResult<OrderSummary>(
        Items: orders.ToArray(),
        TotalCount: totalCount,
        PageNumber: pageNumber,
        PageSize: pageSize
    );
}

public record PagedResult<T>(
    T[] Items,
    int TotalCount,
    int PageNumber,
    int PageSize
) {
    public int TotalPages => (int)Math.Ceiling(TotalCount / (double)PageSize);
    public bool HasPreviousPage => PageNumber > 1;
    public bool HasNextPage => PageNumber < TotalPages;
}
```

**Use Case**: Large result sets with pagination.

### Pattern 4: Aggregations

```csharp
public async Task<OrderStatistics> GetOrderStatisticsAsync(
    Guid customerId,
    CancellationToken ct = default) {

    await using var conn = _db.CreateConnection();

    return await conn.QuerySingleAsync<OrderStatistics>(
        """
        SELECT
            COUNT(*) AS TotalOrders,
            SUM(total) AS TotalSpent,
            AVG(total) AS AverageOrderValue,
            MAX(created_at) AS LastOrderDate
        FROM order_summaries
        WHERE customer_id = @CustomerId
        """,
        new { CustomerId = customerId },
        cancellationToken: ct
    );
}

public record OrderStatistics(
    int TotalOrders,
    decimal TotalSpent,
    decimal AverageOrderValue,
    DateTimeOffset LastOrderDate
);
```

**Use Case**: Analytics and dashboard widgets.

### Pattern 5: Search

```csharp
public async Task<OrderSummary[]> SearchOrdersAsync(
    string searchTerm,
    CancellationToken ct = default) {

    await using var conn = _db.CreateConnection();

    var orders = await conn.QueryAsync<OrderSummary>(
        """
        SELECT * FROM order_summaries
        WHERE
            customer_email ILIKE @SearchPattern
            OR customer_name ILIKE @SearchPattern
            OR status ILIKE @SearchPattern
        ORDER BY created_at DESC
        LIMIT 100
        """,
        new { SearchPattern = $"%{searchTerm}%" },
        cancellationToken: ct
    );

    return orders.ToArray();
}
```

**Use Case**: Free-text search across multiple columns.

---

## Multiple Lenses for Same Read Model

Different lenses can query the same read model with different methods:

```csharp
// Lens 1: Customer-focused queries
public class CustomerOrderLens : ILensQuery {
    public async Task<OrderSummary[]> GetOrdersByCustomerAsync(Guid customerId, CancellationToken ct = default) {
        // Query order_summaries filtered by customer_id
    }

    public async Task<OrderStatistics> GetCustomerOrderStatisticsAsync(Guid customerId, CancellationToken ct = default) {
        // Aggregate stats for customer
    }
}

// Lens 2: Admin-focused queries
public class AdminOrderLens : ILensQuery {
    public async Task<OrderSummary[]> GetAllOrdersAsync(int pageNumber, int pageSize, CancellationToken ct = default) {
        // Query all orders with pagination
    }

    public async Task<OrderSummary[]> GetOrdersByDateRangeAsync(DateOnly startDate, DateOnly endDate, CancellationToken ct = default) {
        // Query by date range
    }

    public async Task<decimal> GetTotalRevenueAsync(DateOnly date, CancellationToken ct = default) {
        // Sum total revenue for date
    }
}
```

**Pattern**: Organize lenses by **use case** (customer, admin, analytics).

---

## Complex Queries

While lenses prefer simple queries, you can handle complexity when needed:

### Joining Denormalized Tables

```csharp
public async Task<CustomerOrderHistory> GetCustomerOrderHistoryAsync(
    Guid customerId,
    CancellationToken ct = default) {

    await using var conn = _db.CreateConnection();

    // Join two denormalized read models
    var result = await conn.QueryAsync<CustomerOrderHistoryItem>(
        """
        SELECT
            os.order_id,
            os.total,
            os.status,
            os.created_at,
            ca.total_orders,
            ca.lifetime_value
        FROM order_summaries os
        JOIN customer_activity ca ON os.customer_id = ca.customer_id
        WHERE os.customer_id = @CustomerId
        ORDER BY os.created_at DESC
        """,
        new { CustomerId = customerId },
        cancellationToken: ct
    );

    return new CustomerOrderHistory(
        CustomerId: customerId,
        Orders: result.ToArray()
    );
}
```

**Note**: Even when joining, you're joining **denormalized read models**, not normalized write models. Still fast!

### JSON Querying (PostgreSQL)

```csharp
public async Task<Product[]> GetProductsByCategoryAsync(
    string category,
    CancellationToken ct = default) {

    await using var conn = _db.CreateConnection();

    // Query JSON column
    var products = await conn.QueryAsync<Product>(
        """
        SELECT * FROM product_catalog
        WHERE metadata->>'category' = @Category
        ORDER BY name
        """,
        new { Category = category },
        cancellationToken: ct
    );

    return products.ToArray();
}
```

---

## Dependency Injection

### Registration

**Manual**:
```csharp
builder.Services.AddTransient<ILensQuery, OrderLens>();
builder.Services.AddTransient<ILensQuery, InventoryLens>();

// Or register by interface name
builder.Services.AddTransient<IOrderLens, OrderLens>();
builder.Services.AddTransient<IInventoryLens, InventoryLens>();
```

**Auto-Discovery** (with Whizbang.Generators):
```csharp
builder.Services.AddDiscoveredLenses();  // Finds all ILensQuery implementations
```

### Lifetime

**Recommended**: `Transient` (new instance per request)

**Why?**
- May inject scoped services (e.g., `DbContext`)
- Stateless (no benefit to reusing instances)
- Lightweight (minimal allocation cost)

```csharp
builder.Services.AddTransient<IOrderLens, OrderLens>();
```

---

## Caching Strategies

### In-Memory Caching

```csharp
public class OrderLens : ILensQuery {
    private readonly IDbConnectionFactory _db;
    private readonly IMemoryCache _cache;

    public OrderLens(IDbConnectionFactory db, IMemoryCache cache) {
        _db = db;
        _cache = cache;
    }

    public async Task<OrderSummary?> GetOrderAsync(
        Guid orderId,
        CancellationToken ct = default) {

        // Try cache first
        if (_cache.TryGetValue(orderId, out OrderSummary? cached)) {
            return cached;
        }

        // Query database
        await using var conn = _db.CreateConnection();

        var order = await conn.QuerySingleOrDefaultAsync<OrderSummary>(
            "SELECT * FROM order_summaries WHERE order_id = @OrderId",
            new { OrderId = orderId },
            cancellationToken: ct
        );

        if (order is not null) {
            // Cache for 5 minutes
            _cache.Set(orderId, order, TimeSpan.FromMinutes(5));
        }

        return order;
    }
}
```

### Distributed Caching (Redis)

```csharp
public class OrderLens : ILensQuery {
    private readonly IDbConnectionFactory _db;
    private readonly IDistributedCache _cache;

    public async Task<OrderSummary?> GetOrderAsync(
        Guid orderId,
        CancellationToken ct = default) {

        var cacheKey = $"order:{orderId}";

        // Try distributed cache
        var cachedJson = await _cache.GetStringAsync(cacheKey, ct);

        if (cachedJson is not null) {
            return JsonSerializer.Deserialize<OrderSummary>(cachedJson);
        }

        // Query database
        await using var conn = _db.CreateConnection();

        var order = await conn.QuerySingleOrDefaultAsync<OrderSummary>(
            "SELECT * FROM order_summaries WHERE order_id = @OrderId",
            new { OrderId = orderId },
            cancellationToken: ct
        );

        if (order is not null) {
            // Cache in Redis
            var json = JsonSerializer.Serialize(order);
            await _cache.SetStringAsync(
                cacheKey,
                json,
                new DistributedCacheEntryOptions {
                    AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5)
                },
                ct
            );
        }

        return order;
    }
}
```

**Cache Invalidation**: Perspectives can invalidate cache when updating read models:

```csharp
public class OrderSummaryPerspective : IPerspectiveOf<OrderCreated> {
    private readonly IDbConnectionFactory _db;
    private readonly IDistributedCache _cache;

    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
        // Update database
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync("INSERT INTO order_summaries (...) VALUES (...)", @event, ct);

        // Invalidate cache
        await _cache.RemoveAsync($"order:{@event.OrderId}", ct);
    }
}
```

---

## Testing Lenses

### Unit Tests

```csharp
public class OrderLensTests {
    [Test]
    public async Task GetOrderAsync_ExistingOrder_ReturnsOrderSummaryAsync() {
        // Arrange
        var mockDb = CreateMockDb();  // Returns mock with test data
        var lens = new OrderLens(mockDb);

        var orderId = TestData.ExistingOrderId;

        // Act
        var result = await lens.GetOrderAsync(orderId, CancellationToken.None);

        // Assert
        await Assert.That(result).IsNotNull();
        await Assert.That(result!.OrderId).IsEqualTo(orderId);
        await Assert.That(result.Total).IsGreaterThan(0m);
    }

    [Test]
    public async Task GetOrderAsync_NonExistentOrder_ReturnsNullAsync() {
        // Arrange
        var mockDb = CreateMockDb();  // Returns null for non-existent order
        var lens = new OrderLens(mockDb);

        var orderId = Guid.NewGuid();  // Doesn't exist

        // Act
        var result = await lens.GetOrderAsync(orderId, CancellationToken.None);

        // Assert
        await Assert.That(result).IsNull();
    }

    [Test]
    public async Task GetOrdersPagedAsync_ValidPage_ReturnsPagedResultAsync() {
        // Arrange
        var mockDb = CreateMockDbWithOrders(25);  // 25 orders total
        var lens = new OrderLens(mockDb);

        // Act
        var result = await lens.GetOrdersPagedAsync(
            pageNumber: 2,
            pageSize: 10,
            CancellationToken.None
        );

        // Assert
        await Assert.That(result.Items.Length).IsEqualTo(10);  // Second page
        await Assert.That(result.TotalCount).IsEqualTo(25);
        await Assert.That(result.TotalPages).IsEqualTo(3);  // 25 / 10 = 3 pages
        await Assert.That(result.HasPreviousPage).IsTrue();   // Page 2 has previous
        await Assert.That(result.HasNextPage).IsTrue();       // Page 2 has next
    }
}
```

### Integration Tests

```csharp
public class OrderLensIntegrationTests {
    private IDbConnectionFactory _db;
    private OrderLens _lens;

    [Before(Test)]
    public async Task SetupAsync() {
        _db = CreateTestDatabase();  // Real PostgreSQL test database
        _lens = new OrderLens(_db);

        // Seed test data
        await SeedTestDataAsync();
    }

    [Test]
    public async Task GetOrdersByCustomerAsync_WithOrders_ReturnsAllCustomerOrdersAsync() {
        // Arrange
        var customerId = TestData.CustomerWithOrdersId;

        // Act
        var orders = await _lens.GetOrdersByCustomerAsync(customerId, CancellationToken.None);

        // Assert
        await Assert.That(orders.Length).IsEqualTo(3);  // Customer has 3 orders
        await Assert.That(orders.All(o => o.CustomerId == customerId)).IsTrue();
        await Assert.That(orders).IsSortedDescending(o => o.CreatedAt);  // Sorted by date
    }

    private async Task SeedTestDataAsync() {
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            """
            INSERT INTO order_summaries (order_id, customer_id, total, status, created_at)
            VALUES
                (@OrderId1, @CustomerId, 100.00, 'Created', '2024-12-01'),
                (@OrderId2, @CustomerId, 200.00, 'Shipped', '2024-12-05'),
                (@OrderId3, @CustomerId, 150.00, 'Delivered', '2024-12-10')
            """,
            new {
                OrderId1 = Guid.NewGuid(),
                OrderId2 = Guid.NewGuid(),
                OrderId3 = Guid.NewGuid(),
                CustomerId = TestData.CustomerWithOrdersId
            }
        );
    }
}
```

---

## Advanced Patterns

### Pattern: Lens with Multiple Read Models

```csharp
public class OrderDetailsLens : ILensQuery {
    private readonly IDbConnectionFactory _db;

    public async Task<OrderDetailsView> GetOrderDetailsAsync(
        Guid orderId,
        CancellationToken ct = default) {

        await using var conn = _db.CreateConnection();

        // Query 1: Order summary
        var summary = await conn.QuerySingleOrDefaultAsync<OrderSummary>(
            "SELECT * FROM order_summaries WHERE order_id = @OrderId",
            new { OrderId = orderId },
            ct
        );

        if (summary is null) {
            throw new NotFoundException($"Order {orderId} not found");
        }

        // Query 2: Order items (separate read model)
        var items = await conn.QueryAsync<OrderItemDetail>(
            "SELECT * FROM order_item_details WHERE order_id = @OrderId",
            new { OrderId = orderId },
            ct
        );

        // Query 3: Shipping info (separate read model)
        var shipping = await conn.QuerySingleOrDefaultAsync<ShippingInfo>(
            "SELECT * FROM shipping_info WHERE order_id = @OrderId",
            new { OrderId = orderId },
            ct
        );

        // Combine into single DTO
        return new OrderDetailsView(
            Summary: summary,
            Items: items.ToArray(),
            Shipping: shipping
        );
    }
}

public record OrderDetailsView(
    OrderSummary Summary,
    OrderItemDetail[] Items,
    ShippingInfo? Shipping
);
```

### Pattern: Graph QL Integration

```csharp
public class OrderQueries {
    private readonly IOrderLens _lens;

    public OrderQueries(IOrderLens lens) {
        _lens = lens;
    }

    [GraphQLName("order")]
    public async Task<OrderSummary?> GetOrderAsync(Guid orderId, CancellationToken ct) {
        return await _lens.GetOrderAsync(orderId, ct);
    }

    [GraphQLName("orders")]
    public async Task<PagedResult<OrderSummary>> GetOrdersPagedAsync(
        int pageNumber = 1,
        int pageSize = 20,
        CancellationToken ct = default) {

        return await _lens.GetOrdersPagedAsync(pageNumber, pageSize, ct);
    }
}
```

---

## Best Practices

### DO ✅

- ✅ Keep queries **simple** (single table or denormalized joins)
- ✅ Return **DTOs** specific to client needs
- ✅ Use **async methods** with CancellationToken
- ✅ Return **null** for "not found" (don't throw)
- ✅ Add **indexes** to read model tables for common queries
- ✅ Use **pagination** for large result sets
- ✅ Cache frequently accessed data
- ✅ Organize lenses by **use case** (customer, admin, analytics)
- ✅ Keep lenses **stateless**

### DON'T ❌

- ❌ Query normalized write models directly (use denormalized read models)
- ❌ Perform complex joins across many tables (defeats purpose of CQRS)
- ❌ Mutate data in lenses (read-only!)
- ❌ Call receptors from lenses (lenses are read-only)
- ❌ Return IQueryable (forces deferred execution, breaks abstraction)
- ❌ Store state in lens instances
- ❌ Throw exceptions for "not found" (return null instead)
- ❌ Return unbounded result sets (always paginate large datasets)

---

## Further Reading

**Core Concepts**:
- [Perspectives](perspectives.md) - Event listeners that maintain read models
- [Dispatcher](dispatcher.md) - How to invoke receptors and publish events
- [Receptors](receptors.md) - Command handlers that produce events

**Data Access**:
- [Dapper Integration](../data/dapper-integration.md) - Lightweight data access
- [EF Core Integration](../data/efcore-integration.md) - Full-featured ORM
- [Perspective Storage](../data/perspectives-storage.md) - Schema design patterns

**Examples**:
- [ECommerce: BFF Pattern](../examples/ecommerce/bff-pattern.md) - Real-world lens usage

---

*Version 0.1.0 - Foundation Release | Last Updated: 2024-12-12*
