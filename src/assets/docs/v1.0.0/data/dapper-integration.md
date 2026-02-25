---
title: Dapper Integration
version: 1.0.0
category: Data Access
order: 1
description: >-
  Lightweight, high-performance data access with Dapper for Whizbang
  perspectives and lenses - simple SQL, minimal overhead
tags: 'dapper, data-access, postgresql, sql, micro-orm'
codeReferences:
  - src/Whizbang.Data.Dapper.Postgres/IDbConnectionFactory.cs
  - src/Whizbang.Data.Dapper.Postgres/PostgresConnectionFactory.cs
  - samples/ECommerce/ECommerce.BFF.API/Perspectives/OrderSummaryPerspective.cs
  - samples/ECommerce/ECommerce.BFF.API/Lenses/OrderLens.cs
---

# Dapper Integration

**Dapper** is Whizbang's recommended micro-ORM for lightweight, high-performance data access in **Perspectives** and **Lenses**. It provides simple SQL execution with minimal overhead - perfect for read models.

## Why Dapper?

| Feature | Dapper | EF Core |
|---------|--------|---------|
| **Performance** | ~20x faster queries | Slower (change tracking overhead) |
| **Control** | Full SQL control | LINQ translated to SQL |
| **Learning curve** | Simple (just SQL) | Complex (LINQ, migrations, tracking) |
| **Use case** | Perspectives/Lenses | Complex domain models |
| **Recommended for** | ✅ Read models | Write models |

**Whizbang Philosophy**: Use **Dapper for reads** (perspectives, lenses), **EF Core for writes** (optional, if needed).

---

## Installation

```bash
dotnet add package Whizbang.Data.Dapper.Postgres
```

**Includes**:
- `IDbConnectionFactory` - Connection factory interface
- `PostgresConnectionFactory` - PostgreSQL implementation
- Dapper (latest version)
- Npgsql (PostgreSQL driver)

---

## IDbConnectionFactory

Whizbang uses **`IDbConnectionFactory`** pattern for database connections.

### Interface

```csharp
public interface IDbConnectionFactory {
    IDbConnection CreateConnection();
}
```

**Benefits**:
- ✅ **Testable**: Easy to mock for unit tests
- ✅ **Flexible**: Swap implementations (PostgreSQL, SQLite, etc.)
- ✅ **Connection pooling**: Npgsql handles pooling automatically
- ✅ **Minimal**: No dependencies on specific ORM

### PostgreSQL Implementation

```csharp
public class PostgresConnectionFactory : IDbConnectionFactory {
    private readonly string _connectionString;

    public PostgresConnectionFactory(string connectionString) {
        _connectionString = connectionString;
    }

    public IDbConnection CreateConnection() {
        return new NpgsqlConnection(_connectionString);
    }
}
```

### Registration

```csharp
// appsettings.json
{
  "ConnectionStrings": {
    "DefaultConnection": "Host=localhost;Database=whizbang;Username=postgres;Password=your_password"
  }
}

// Program.cs
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")!;

builder.Services.AddWhizbangDapper(connectionString);
// OR manually:
builder.Services.AddSingleton<IDbConnectionFactory>(
    new PostgresConnectionFactory(connectionString)
);
```

---

## Basic Usage

### Query Single Row

```csharp
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
                order_id,
                customer_id,
                total,
                status,
                created_at
            FROM order_summaries
            WHERE order_id = @OrderId
            """,
            new { OrderId = orderId },
            commandTimeout: 30,
            cancellationToken: ct
        );
    }
}
```

**Key Points**:
- Use `await using` for automatic disposal
- `QuerySingleOrDefaultAsync` returns null if not found
- Pass parameters as anonymous object
- Always pass `CancellationToken`

### Query Multiple Rows

```csharp
public async Task<OrderSummary[]> GetOrdersByCustomerAsync(
    Guid customerId,
    CancellationToken ct = default) {

    await using var conn = _db.CreateConnection();

    var orders = await conn.QueryAsync<OrderSummary>(
        """
        SELECT
            order_id,
            customer_id,
            total,
            status,
            created_at
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
```

### Execute Non-Query

```csharp
public class OrderSummaryPerspective : IPerspectiveOf<OrderCreated> {
    private readonly IDbConnectionFactory _db;

    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
        await using var conn = _db.CreateConnection();

        await conn.ExecuteAsync(
            """
            INSERT INTO order_summaries (
                order_id, customer_id, total, status, created_at
            ) VALUES (
                @OrderId, @CustomerId, @Total, @Status, @CreatedAt
            )
            """,
            new {
                @event.OrderId,
                @event.CustomerId,
                @event.Total,
                Status = "Created",
                @event.CreatedAt
            },
            commandTimeout: 30,
            cancellationToken: ct
        );
    }
}
```

---

## PostgreSQL-Specific Features

### JSONB Columns

```csharp
// Query JSONB column
public async Task<Product[]> GetProductsByCategoryAsync(
    string category,
    CancellationToken ct = default) {

    await using var conn = _db.CreateConnection();

    var products = await conn.QueryAsync<Product>(
        """
        SELECT
            product_id,
            name,
            price,
            metadata
        FROM products
        WHERE metadata->>'category' = @Category
        ORDER BY name
        """,
        new { Category = category },
        cancellationToken: ct
    );

    return products.ToArray();
}

// Store JSONB
public async Task UpdateProductMetadataAsync(
    Guid productId,
    Dictionary<string, string> metadata,
    CancellationToken ct = default) {

    await using var conn = _db.CreateConnection();

    await conn.ExecuteAsync(
        """
        UPDATE products
        SET metadata = @Metadata::jsonb
        WHERE product_id = @ProductId
        """,
        new {
            ProductId = productId,
            Metadata = JsonSerializer.Serialize(metadata)
        },
        cancellationToken: ct
    );
}
```

### Array Parameters

```csharp
public async Task<Product[]> GetProductsByIdsAsync(
    Guid[] productIds,
    CancellationToken ct = default) {

    await using var conn = _db.CreateConnection();

    var products = await conn.QueryAsync<Product>(
        """
        SELECT * FROM products
        WHERE product_id = ANY(@ProductIds)
        """,
        new { ProductIds = productIds },
        cancellationToken: ct
    );

    return products.ToArray();
}
```

### UPSERT (ON CONFLICT)

```csharp
public async Task UpsertInventoryAsync(
    Guid productId,
    int quantity,
    CancellationToken ct = default) {

    await using var conn = _db.CreateConnection();

    await conn.ExecuteAsync(
        """
        INSERT INTO inventory (product_id, available)
        VALUES (@ProductId, @Quantity)
        ON CONFLICT (product_id) DO UPDATE
        SET available = EXCLUDED.available
        """,
        new { ProductId = productId, Quantity = quantity },
        cancellationToken: ct
    );
}
```

---

## Transactions

### Basic Transaction

```csharp
public async Task CreateOrderWithItemsAsync(
    Order order,
    OrderItem[] items,
    CancellationToken ct = default) {

    await using var conn = _db.CreateConnection();
    await conn.OpenAsync(ct);

    await using var transaction = await conn.BeginTransactionAsync(ct);

    try {
        // Insert order
        await conn.ExecuteAsync(
            "INSERT INTO orders (order_id, customer_id, total, status, created_at) VALUES (@OrderId, @CustomerId, @Total, @Status, @CreatedAt)",
            order,
            transaction: transaction,
            cancellationToken: ct
        );

        // Insert order items
        foreach (var item in items) {
            await conn.ExecuteAsync(
                "INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (@OrderItemId, @OrderId, @ProductId, @Quantity, @UnitPrice)",
                item,
                transaction: transaction,
                cancellationToken: ct
            );
        }

        await transaction.CommitAsync(ct);

    } catch {
        await transaction.RollbackAsync(ct);
        throw;
    }
}
```

### Transaction Scope (Distributed Transactions)

```csharp
using var scope = new TransactionScope(TransactionScopeAsyncFlowOption.Enabled);

await using var conn = _db.CreateConnection();

// All operations in this scope are transactional
await conn.ExecuteAsync("INSERT INTO orders ...");
await conn.ExecuteAsync("INSERT INTO order_items ...");

scope.Complete();  // Commit
```

---

## Mapping

### Custom Type Mapping

```csharp
// Map custom types
SqlMapper.AddTypeHandler(new GuidTypeHandler());
SqlMapper.AddTypeHandler(new DateTimeOffsetTypeHandler());

public class GuidTypeHandler : SqlMapper.TypeHandler<Guid> {
    public override Guid Parse(object value) {
        return Guid.Parse((string)value);
    }

    public override void SetValue(IDbDataParameter parameter, Guid value) {
        parameter.Value = value.ToString();
    }
}
```

### Column Name Mapping

```csharp
// Explicit column mapping
public async Task<OrderSummary?> GetOrderAsync(Guid orderId) {
    await using var conn = _db.CreateConnection();

    return await conn.QuerySingleOrDefaultAsync<OrderSummary>(
        """
        SELECT
            order_id AS OrderId,
            customer_id AS CustomerId,
            total AS Total,
            status AS Status,
            created_at AS CreatedAt
        FROM order_summaries
        WHERE order_id = @OrderId
        """,
        new { OrderId = orderId }
    );
}
```

**Note**: Dapper matches columns to properties by name (case-insensitive).

---

## Performance Patterns

### Buffered vs Unbuffered

```csharp
// ✅ Buffered (default) - loads all rows into memory
var orders = await conn.QueryAsync<OrderSummary>(sql);

// ⚠️ Unbuffered - streams rows (use for large result sets)
var orders = await conn.QueryAsync<OrderSummary>(sql, buffered: false);

await foreach (var order in orders) {
    // Process one at a time (low memory)
}
```

### Batch Operations

```csharp
// ✅ Batch insert (single roundtrip)
await conn.ExecuteAsync(
    "INSERT INTO order_items (order_item_id, order_id, product_id, quantity) VALUES (@OrderItemId, @OrderId, @ProductId, @Quantity)",
    items  // Pass array - Dapper executes once per item
);

// ❌ Loop insert (multiple roundtrips)
foreach (var item in items) {
    await conn.ExecuteAsync("INSERT INTO order_items ...", item);  // Slow!
}
```

### Connection Pooling

Npgsql handles connection pooling automatically:

```
Connection String:
Host=localhost;Database=whizbang;Username=postgres;Password=pass;Minimum Pool Size=5;Maximum Pool Size=100
```

**Configuration**:
- `Minimum Pool Size`: Connections kept open (default: 1)
- `Maximum Pool Size`: Max connections (default: 100)
- `Connection Lifetime`: Max seconds before recreate (default: 0 = infinite)

---

## Testing

### Unit Tests with Mock

```csharp
public class OrderLensTests {
    [Test]
    public async Task GetOrderAsync_ExistingOrder_ReturnsOrderAsync() {
        // Arrange
        var mockDb = CreateMockDbConnectionFactory();
        var lens = new OrderLens(mockDb);

        var orderId = Guid.NewGuid();

        // Act
        var result = await lens.GetOrderAsync(orderId);

        // Assert
        await Assert.That(result).IsNotNull();
        await Assert.That(result!.OrderId).IsEqualTo(orderId);
    }

    private IDbConnectionFactory CreateMockDbConnectionFactory() {
        // Use in-memory database or mock
        return new InMemoryDbConnectionFactory(/* test data */);
    }
}
```

### Integration Tests with PostgreSQL

```csharp
public class OrderLensIntegrationTests {
    private IDbConnectionFactory _db;
    private OrderLens _lens;

    [Before(Test)]
    public async Task SetupAsync() {
        _db = CreateTestDatabase();  // Real PostgreSQL
        _lens = new OrderLens(_db);

        await SeedTestDataAsync();
    }

    [Test]
    public async Task GetOrdersByCustomerAsync_WithOrders_ReturnsAllAsync() {
        // Arrange
        var customerId = TestData.CustomerWithOrdersId;

        // Act
        var orders = await _lens.GetOrdersByCustomerAsync(customerId);

        // Assert
        await Assert.That(orders.Length).IsEqualTo(3);
    }

    private async Task SeedTestDataAsync() {
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "INSERT INTO order_summaries (order_id, customer_id, total, status, created_at) VALUES (@OrderId, @CustomerId, @Total, @Status, @CreatedAt)",
            new {
                OrderId = Guid.NewGuid(),
                CustomerId = TestData.CustomerWithOrdersId,
                Total = 100.00m,
                Status = "Created",
                CreatedAt = DateTimeOffset.UtcNow
            }
        );
    }
}
```

---

## Best Practices

### DO ✅

- ✅ Use `await using` for connections (automatic disposal)
- ✅ Pass `CancellationToken` to all async methods
- ✅ Use `QuerySingleOrDefaultAsync` for single row (returns null if not found)
- ✅ Use `QueryAsync` for multiple rows
- ✅ Use `ExecuteAsync` for non-queries (INSERT, UPDATE, DELETE)
- ✅ Use transactions for multi-statement operations
- ✅ Use batch operations for multiple inserts/updates
- ✅ Set `commandTimeout` for long-running queries
- ✅ Use parameterized queries (prevents SQL injection)
- ✅ Use connection pooling (automatic with Npgsql)

### DON'T ❌

- ❌ Forget `await using` (connection leak!)
- ❌ Use string concatenation for SQL (SQL injection risk)
- ❌ Ignore `CancellationToken` (can't cancel long queries)
- ❌ Open connections manually (let Dapper handle it)
- ❌ Use `Query` instead of `QueryAsync` (blocks thread)
- ❌ Use `Execute` instead of `ExecuteAsync` (blocks thread)
- ❌ Skip transactions for multi-statement operations (data inconsistency)
- ❌ Loop instead of batch (slow!)

---

## Common Patterns

### Pattern 1: Perspective Update

```csharp
public class OrderSummaryPerspective : IPerspectiveOf<OrderCreated> {
    private readonly IDbConnectionFactory _db;

    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
        await using var conn = _db.CreateConnection();

        await conn.ExecuteAsync(
            """
            INSERT INTO order_summaries (order_id, customer_id, total, status, created_at)
            VALUES (@OrderId, @CustomerId, @Total, @Status, @CreatedAt)
            ON CONFLICT (order_id) DO NOTHING
            """,
            new {
                @event.OrderId,
                @event.CustomerId,
                @event.Total,
                Status = "Created",
                @event.CreatedAt
            },
            cancellationToken: ct
        );
    }
}
```

### Pattern 2: Lens Query

```csharp
public class OrderLens : ILensQuery {
    private readonly IDbConnectionFactory _db;

    public async Task<OrderSummary[]> GetRecentOrdersAsync(
        int limit,
        CancellationToken ct = default) {

        await using var conn = _db.CreateConnection();

        var orders = await conn.QueryAsync<OrderSummary>(
            """
            SELECT * FROM order_summaries
            ORDER BY created_at DESC
            LIMIT @Limit
            """,
            new { Limit = limit },
            cancellationToken: ct
        );

        return orders.ToArray();
    }
}
```

### Pattern 3: Aggregation

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
```

---

## Further Reading

**Core Concepts**:
- [Perspectives](../core-concepts/perspectives.md) - Event-driven read models
- [Lenses](../core-concepts/lenses.md) - Query repositories

**Data Access**:
- [EF Core Integration](efcore-integration.md) - Full-featured ORM
- [Perspectives Storage](perspectives-storage.md) - Read model schema design
- [Event Store](event-store.md) - Event storage and replay

**Examples**:
- [ECommerce: BFF Perspectives](../examples/ecommerce/bff-pattern.md) - Real-world Dapper usage

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
