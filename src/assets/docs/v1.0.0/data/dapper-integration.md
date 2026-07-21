---
title: Dapper Integration
pageType: guide
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Data Access
order: 1
description: >-
  Lightweight, high-performance data access with Dapper for Whizbang
  perspectives and lenses - simple SQL, minimal overhead
tags: 'dapper, data-access, postgresql, sql, micro-orm'
codeReferences:
  - src/Whizbang.Core/Data/IDbConnectionFactory.cs
  - src/Whizbang.Data.Dapper.Postgres/PostgresConnectionFactory.cs
  - src/Whizbang.Data.Dapper.Postgres/ServiceCollectionExtensions.cs
testReferences:
  - tests/Whizbang.Data.Dapper.Postgres.Tests/ServiceCollectionExtensionsTests.cs
lastMaintainedCommit: '01f07906'
---

# Dapper Integration

**Dapper** is the micro-ORM behind Whizbang's `Whizbang.Data.Dapper.Postgres` driver, which implements Whizbang's PostgreSQL persistence (event store, work coordinator, perspective store, sequence provider). The same package's `IDbConnectionFactory` abstraction is also useful in your own application for lightweight, high-performance SQL - custom read services, reporting queries, and hand-tuned lens implementations.

## Why Dapper?

| Feature | Dapper | EF Core |
|---------|--------|---------|
| **Performance** | Faster (no change tracking) | Change tracking overhead |
| **Control** | Full SQL control | LINQ translated to SQL |
| **Learning curve** | Simple (just SQL) | Complex (LINQ, migrations, tracking) |
| **Use case** | Hand-tuned SQL queries | LINQ-based lens queries |

**Whizbang perspective note**: shipped perspectives implement `IPerspectiveFor<TModel, TEvent...>` with pure `Apply` methods - the framework persists perspective models for you (via the Dapper or EF Core driver). You do not write SQL inside a perspective. Use direct Dapper SQL for custom queries outside the perspective pipeline. See [Drivers](drivers.md).

---

## Installation

```bash{title="Installation" description="Installation" category="Implementation" difficulty="BEGINNER" tags=["Data", "Installation"]}
dotnet add package Whizbang.Data.Dapper.Postgres
```

**Includes**:
- `PostgresConnectionFactory` - PostgreSQL implementation of `IDbConnectionFactory` (the interface itself lives in `Whizbang.Core.Data`)
- Whizbang's Dapper-based PostgreSQL stores (event store, work coordinator, perspective store, sequence provider)
- Dapper
- Npgsql (PostgreSQL driver)

---

## IDbConnectionFactory

Whizbang uses the **`IDbConnectionFactory`** pattern (defined in `Whizbang.Core.Data`) for database connections.

### Interface

```csharp{title="Interface" description="Interface" category="Implementation" difficulty="BEGINNER" tags=["Data", "Interface"] unverified="IDbConnectionFactory contract definition — a single-method abstraction with no behavior to verify directly"}
namespace Whizbang.Core.Data;

public interface IDbConnectionFactory {
    Task<IDbConnection> CreateConnectionAsync(CancellationToken cancellationToken = default);
}
```

**Benefits**:
- ✅ **Testable**: Easy to mock for unit tests
- ✅ **Flexible**: Swap implementations (PostgreSQL, SQLite, etc.)
- ✅ **Connection pooling**: Npgsql handles pooling automatically
- ✅ **Minimal**: No dependencies on specific ORM

### PostgreSQL Implementation

The PostgreSQL factory opens the connection before returning it, ensuring proper async initialization:

```csharp{title="PostgreSQL Implementation" description="PostgreSQL Implementation" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "PostgreSQL", "Implementation"] unverified="Npgsql connection-factory setup — opens a live connection, exercised only through integration fixtures, not a unit-tested surface"}
public class PostgresConnectionFactory : IDbConnectionFactory {
    private readonly string _connectionString;

    public PostgresConnectionFactory(string connectionString) {
        ArgumentNullException.ThrowIfNull(connectionString);
        _connectionString = connectionString;
    }

    public async Task<IDbConnection> CreateConnectionAsync(CancellationToken cancellationToken = default) {
        var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        return connection;
    }
}
```

### Registration

```csharp{title="Registration" description="Registration" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "Registration"] tests=["ServiceCollectionExtensionsTests.AddWhizbangPostgres_InitializeSchemaFalse_DoesNotInitializeAsync", "ServiceCollectionExtensionsTests.AddWhizbangPostgres_InitializeSchemaTrue_NoPerspective_InitializesInfraOnlyAsync"]}
// appsettings.json
{
  "ConnectionStrings": {
    "DefaultConnection": "Host=localhost;Database=whizbang;Username=postgres;Password=your_password"
  }
}

// Program.cs
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")!;

// Registers the connection factory plus all Whizbang PostgreSQL stores
builder.Services.AddWhizbangPostgres(connectionString, jsonOptions);

// OR register just the factory manually:
builder.Services.AddSingleton<IDbConnectionFactory>(
    new PostgresConnectionFactory(connectionString)
);
```

---

## Basic Usage

### Query Single Row

```csharp{title="Query Single Row" description="Query Single Row" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Query", "Single", "Row"] unverified="consumer Dapper QuerySingleOrDefaultAsync example against a user table — outside Whizbang's tested surface"}
public class OrderQueries {
    private readonly IDbConnectionFactory _db;

    public OrderQueries(IDbConnectionFactory db) {
        _db = db;
    }

    public async Task<OrderSummary?> GetOrderAsync(
        Guid orderId,
        CancellationToken ct = default) {

        using var conn = await _db.CreateConnectionAsync(ct);

        return await conn.QuerySingleOrDefaultAsync<OrderSummary>(
            new CommandDefinition(
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
            )
        );
    }
}
```

**Key Points**:
- `CreateConnectionAsync` returns an **already-opened** connection - wrap it in `using` for disposal
- `QuerySingleOrDefaultAsync` returns null if not found
- Pass parameters as anonymous object
- Pass the `CancellationToken` via Dapper's `CommandDefinition`

### Query Multiple Rows

```csharp{title="Query Multiple Rows" description="Query Multiple Rows" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Query", "Multiple", "Rows"] unverified="consumer Dapper QueryAsync example against a user table — outside Whizbang's tested surface"}
public async Task<OrderSummary[]> GetOrdersByCustomerAsync(
    Guid customerId,
    CancellationToken ct = default) {

    using var conn = await _db.CreateConnectionAsync(ct);

    var orders = await conn.QueryAsync<OrderSummary>(
        new CommandDefinition(
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
        )
    );

    return orders.ToArray();
}
```

### Execute Non-Query

```csharp{title="Execute Non-Query" description="Execute Non-Query" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "Execute", "Non-Query"] unverified="consumer Dapper ExecuteAsync INSERT example against a user table — outside Whizbang's tested surface"}
public class OrderSummaryWriter {
    private readonly IDbConnectionFactory _db;

    public async Task InsertAsync(OrderCreated @event, CancellationToken ct = default) {
        using var conn = await _db.CreateConnectionAsync(ct);

        await conn.ExecuteAsync(
            new CommandDefinition(
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
            )
        );
    }
}
```

---

## PostgreSQL-Specific Features

### JSONB Columns

```csharp{title="JSONB Columns" description="JSONB Columns" category="Implementation" difficulty="ADVANCED" tags=["Data", "C#", "JSONB", "Columns"] unverified="consumer Dapper jsonb query/update example — PostgreSQL/Dapper behavior, outside Whizbang's tested surface"}
// Query JSONB column
public async Task<Product[]> GetProductsByCategoryAsync(
    string category,
    CancellationToken ct = default) {

    using var conn = await _db.CreateConnectionAsync(ct);

    var products = await conn.QueryAsync<Product>(
        new CommandDefinition(
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
        )
    );

    return products.ToArray();
}

// Store JSONB
public async Task UpdateProductMetadataAsync(
    Guid productId,
    Dictionary<string, string> metadata,
    CancellationToken ct = default) {

    using var conn = await _db.CreateConnectionAsync(ct);

    await conn.ExecuteAsync(
        new CommandDefinition(
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
        )
    );
}
```

### Array Parameters

```csharp{title="Array Parameters" description="Array Parameters" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Array", "Parameters"] unverified="consumer Dapper array-parameter (ANY) example — Dapper/Npgsql behavior, outside Whizbang's tested surface"}
public async Task<Product[]> GetProductsByIdsAsync(
    Guid[] productIds,
    CancellationToken ct = default) {

    using var conn = await _db.CreateConnectionAsync(ct);

    var products = await conn.QueryAsync<Product>(
        new CommandDefinition(
            """
            SELECT * FROM products
            WHERE product_id = ANY(@ProductIds)
            """,
            new { ProductIds = productIds },
            cancellationToken: ct
        )
    );

    return products.ToArray();
}
```

### UPSERT (ON CONFLICT)

```csharp{title="UPSERT (ON CONFLICT)" description="UPSERT (ON CONFLICT)" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "UPSERT", "CONFLICT"] unverified="consumer Dapper ON CONFLICT upsert example — PostgreSQL/Dapper behavior, outside Whizbang's tested surface"}
public async Task UpsertInventoryAsync(
    Guid productId,
    int quantity,
    CancellationToken ct = default) {

    using var conn = await _db.CreateConnectionAsync(ct);

    await conn.ExecuteAsync(
        new CommandDefinition(
            """
            INSERT INTO inventory (product_id, available)
            VALUES (@ProductId, @Quantity)
            ON CONFLICT (product_id) DO UPDATE
            SET available = EXCLUDED.available
            """,
            new { ProductId = productId, Quantity = quantity },
            cancellationToken: ct
        )
    );
}
```

---

## Transactions

### Basic Transaction

```csharp{title="Basic Transaction" description="Basic Transaction" category="Implementation" difficulty="BEGINNER" tags=["Data", "C#", "Transaction"] unverified="consumer Dapper ADO.NET transaction example — outside Whizbang's tested surface"}
public async Task CreateOrderWithItemsAsync(
    Order order,
    OrderItem[] items,
    CancellationToken ct = default) {

    // Connection is already open when returned by the factory
    using var conn = await _db.CreateConnectionAsync(ct);
    using var transaction = conn.BeginTransaction();

    try {
        // Insert order
        await conn.ExecuteAsync(
            new CommandDefinition(
                "INSERT INTO orders (order_id, customer_id, total, status, created_at) VALUES (@OrderId, @CustomerId, @Total, @Status, @CreatedAt)",
                order,
                transaction: transaction,
                cancellationToken: ct
            )
        );

        // Insert order items
        foreach (var item in items) {
            await conn.ExecuteAsync(
                new CommandDefinition(
                    "INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (@OrderItemId, @OrderId, @ProductId, @Quantity, @UnitPrice)",
                    item,
                    transaction: transaction,
                    cancellationToken: ct
                )
            );
        }

        transaction.Commit();

    } catch {
        transaction.Rollback();
        throw;
    }
}
```

### Transaction Scope (Distributed Transactions)

```csharp{title="Transaction Scope (Distributed Transactions)" description="Transaction Scope (Distributed Transactions)" category="Implementation" difficulty="BEGINNER" tags=["Data", "C#", "Transaction", "Scope", "Distributed"] unverified="consumer System.Transactions TransactionScope example — outside Whizbang's tested surface"}
using var scope = new TransactionScope(TransactionScopeAsyncFlowOption.Enabled);

using var conn = await _db.CreateConnectionAsync(ct);

// All operations in this scope are transactional
await conn.ExecuteAsync("INSERT INTO orders ...");
await conn.ExecuteAsync("INSERT INTO order_items ...");

scope.Complete();  // Commit
```

---

## Mapping

### Custom Type Mapping

```csharp{title="Custom Type Mapping" description="Custom Type Mapping" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Custom", "Type", "Mapping"] unverified="Dapper SqlMapper.AddTypeHandler example — Dapper API, outside Whizbang's tested surface"}
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

```csharp{title="Column Name Mapping" description="Column Name Mapping" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Column", "Name", "Mapping"] unverified="Dapper column-alias mapping example — Dapper API, outside Whizbang's tested surface"}
// Explicit column mapping
public async Task<OrderSummary?> GetOrderAsync(Guid orderId, CancellationToken ct = default) {
    using var conn = await _db.CreateConnectionAsync(ct);

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

```csharp{title="Buffered vs Unbuffered" description="Buffered vs Unbuffered" category="Implementation" difficulty="BEGINNER" tags=["Data", "C#", "Buffered", "Unbuffered"] unverified="Dapper buffered/unbuffered query example — Dapper API, outside Whizbang's tested surface"}
// ✅ Buffered (default) - loads all rows into memory
var orders = await conn.QueryAsync<OrderSummary>(sql);

// ⚠️ Unbuffered - streams rows (use for large result sets)
// Requires a DbConnection (e.g. NpgsqlConnection)
await foreach (var order in dbConn.QueryUnbufferedAsync<OrderSummary>(sql)) {
    // Process one at a time (low memory)
}
```

### Batch Operations

```csharp{title="Batch Operations" description="Batch Operations" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Batch", "Operations"] unverified="Dapper batch-execute vs per-item loop example — Dapper API, outside Whizbang's tested surface"}
// ✅ Batch insert - pass a collection and Dapper executes the statement once per item
await conn.ExecuteAsync(
    "INSERT INTO order_items (order_item_id, order_id, product_id, quantity) VALUES (@OrderItemId, @OrderId, @ProductId, @Quantity)",
    items
);

// ❌ Manual loop with per-item overhead
foreach (var item in items) {
    await conn.ExecuteAsync("INSERT INTO order_items ...", item);  // Slow!
}

// For true bulk loads on PostgreSQL, prefer Npgsql's binary COPY
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

```csharp{title="Unit Tests with Mock" description="Unit Tests with Mock" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Unit", "Tests", "Mock"] unverified="consumer test-authoring scaffolding for a user lens — not a Whizbang test"}
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

```csharp{title="Integration Tests with PostgreSQL" description="Integration Tests with PostgreSQL" category="Implementation" difficulty="ADVANCED" tags=["Data", "C#", "Integration", "Tests", "PostgreSQL"] unverified="consumer integration-test scaffolding for a user lens — not a Whizbang test"}
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
        using var conn = await _db.CreateConnectionAsync();
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

- ✅ Use `using` for connections (automatic disposal - the factory returns them already opened)
- ✅ Pass `CancellationToken` via Dapper's `CommandDefinition`
- ✅ Use `QuerySingleOrDefaultAsync` for single row (returns null if not found)
- ✅ Use `QueryAsync` for multiple rows
- ✅ Use `ExecuteAsync` for non-queries (INSERT, UPDATE, DELETE)
- ✅ Use transactions for multi-statement operations
- ✅ Use batch operations for multiple inserts/updates
- ✅ Set `commandTimeout` for long-running queries
- ✅ Use parameterized queries (prevents SQL injection)
- ✅ Use connection pooling (automatic with Npgsql)

### DON'T ❌

- ❌ Forget `using` (connection leak!)
- ❌ Use string concatenation for SQL (SQL injection risk)
- ❌ Ignore `CancellationToken` (can't cancel long queries)
- ❌ Re-open connections returned by `CreateConnectionAsync` (they arrive open)
- ❌ Use `Query` instead of `QueryAsync` (blocks thread)
- ❌ Use `Execute` instead of `ExecuteAsync` (blocks thread)
- ❌ Skip transactions for multi-statement operations (data inconsistency)
- ❌ Loop instead of batch (slow!)

---

## Common Patterns

### Pattern 1: Idempotent Projection Writer

:::updated
Whizbang perspectives do not write SQL - they implement `IPerspectiveFor<TModel, TEvent...>` with pure `Apply` methods and the framework persists the model. Use this pattern only for **custom** projections maintained outside the perspective pipeline.
:::

```csharp{title="Pattern 1: Idempotent Projection Writer" description="Pattern 1: Idempotent Projection Writer" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Pattern", "Projection", "Update"] unverified="consumer custom-projection Dapper upsert example — outside the Whizbang perspective pipeline and its tested surface"}
public class OrderSummaryWriter {
    private readonly IDbConnectionFactory _db;

    public async Task WriteAsync(OrderCreated @event, CancellationToken ct = default) {
        using var conn = await _db.CreateConnectionAsync(ct);

        await conn.ExecuteAsync(
            new CommandDefinition(
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
            )
        );
    }
}
```

### Pattern 2: Lens Query

```csharp{title="Pattern 2: Lens Query" description="Pattern 2: Lens Query" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Pattern", "Lens", "Query"] unverified="consumer Dapper lens-query example against a user table — outside Whizbang's tested surface"}
public class OrderLens : ILensQuery {
    private readonly IDbConnectionFactory _db;

    public async Task<OrderSummary[]> GetRecentOrdersAsync(
        int limit,
        CancellationToken ct = default) {

        using var conn = await _db.CreateConnectionAsync(ct);

        var orders = await conn.QueryAsync<OrderSummary>(
            new CommandDefinition(
                """
                SELECT * FROM order_summaries
                ORDER BY created_at DESC
                LIMIT @Limit
                """,
                new { Limit = limit },
                cancellationToken: ct
            )
        );

        return orders.ToArray();
    }
}
```

### Pattern 3: Aggregation

```csharp{title="Pattern 3: Aggregation" description="Pattern 3: Aggregation" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Pattern", "Aggregation"] unverified="consumer Dapper aggregation-query example against a user table — outside Whizbang's tested surface"}
public async Task<OrderStatistics> GetOrderStatisticsAsync(
    Guid customerId,
    CancellationToken ct = default) {

    using var conn = await _db.CreateConnectionAsync(ct);

    return await conn.QuerySingleAsync<OrderStatistics>(
        new CommandDefinition(
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
        )
    );
}
```

---

## Further Reading

**Core Concepts**:
- [Perspectives](../fundamentals/perspectives/perspectives.md) - Event-driven read models
- [Lenses](../fundamentals/lenses/lenses.md) - Query repositories

**Data Access**:
- [EF Core Integration](efcore-integration.md) - Full-featured ORM
- [Perspectives Storage](perspectives-storage.md) - Read model schema design
- [Event Store](event-store.md) - Event storage and replay

**Examples**:
- ECommerce: BFF Perspectives - Real-world Dapper usage

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
