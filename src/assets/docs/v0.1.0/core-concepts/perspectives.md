---
title: "Perspectives Guide"
version: 0.1.0
category: Core Concepts
order: 3
description: "Master Whizbang Perspectives - event listeners that maintain eventually consistent read models optimized for queries"
tags: perspectives, read-models, cqrs, eventual-consistency, event-driven
codeReferences:
  - src/Whizbang.Core/IPerspectiveOf.cs
  - samples/ECommerce/ECommerce.BFF.API/Perspectives/OrderSummaryPerspective.cs
  - samples/ECommerce/ECommerce.BFF.API/Perspectives/InventoryPerspective.cs
---

# Perspectives Guide

**Perspectives** are event listeners that maintain **read models** (projections) optimized for queries. They embody the "Q" in CQRS (Command Query Responsibility Segregation) - separate models for reading data.

## Core Concept

A Perspective is analogous to a **viewpoint** or **lens through which you see data**:
- **Listens to events** (domain events)
- **Updates denormalized data** (read models)
- **Optimized for queries** (no joins, fast reads)
- **Eventually consistent** (updates after command completes)

## IPerspectiveOf Interface

```csharp
namespace Whizbang.Core;

public interface IPerspectiveOf<in TEvent>
    where TEvent : notnull {

    Task UpdateAsync(
        TEvent @event,
        CancellationToken cancellationToken = default
    );
}
```

**Type Parameters**:
- `TEvent`: The event type this perspective listens to

**Key Characteristics**:
- **Event-driven**: Triggered automatically when events are published
- **Stateless**: Like receptors, no instance state except injected dependencies
- **Eventually consistent**: Updates happen asynchronously after command
- **Idempotent**: Same event processed multiple times = same result

---

## Basic Example

```csharp
using Whizbang.Core;
using Dapper;

public record OrderCreated(
    Guid OrderId,
    Guid CustomerId,
    OrderLineItem[] Items,
    decimal Total,
    DateTimeOffset CreatedAt
);

public class OrderSummaryPerspective : IPerspectiveOf<OrderCreated> {
    private readonly IDbConnectionFactory _db;
    private readonly ILogger<OrderSummaryPerspective> _logger;

    public OrderSummaryPerspective(
        IDbConnectionFactory db,
        ILogger<OrderSummaryPerspective> logger) {
        _db = db;
        _logger = logger;
    }

    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
        await using var conn = _db.CreateConnection();

        // Insert denormalized order summary
        await conn.ExecuteAsync(
            """
            INSERT INTO order_summaries (
                order_id, customer_id, item_count, total, status, created_at
            ) VALUES (
                @OrderId, @CustomerId, @ItemCount, @Total, @Status, @CreatedAt
            )
            """,
            new {
                @event.OrderId,
                @event.CustomerId,
                ItemCount = @event.Items.Length,
                @event.Total,
                Status = "Created",
                @event.CreatedAt
            },
            commandTimeout: 30,
            cancellationToken: ct
        );

        _logger.LogInformation(
            "Updated order summary for {OrderId}, customer {CustomerId}, total {Total:C}",
            @event.OrderId, @event.CustomerId, @event.Total
        );
    }
}
```

---

## CQRS Pattern

Whizbang implements CQRS with:
- **Write side**: Commands → Receptors → Events
- **Read side**: Events → Perspectives → Read Models → Lenses

```
┌─────────────── WRITE SIDE ───────────────┐
│                                           │
│  CreateOrder Command                      │
│       ↓                                   │
│  CreateOrderReceptor                      │
│       ↓                                   │
│  OrderCreated Event                       │
│                                           │
└───────────────┬───────────────────────────┘
                │
                │ dispatcher.PublishAsync()
                ↓
┌─────────────── READ SIDE ────────────────┐
│                                           │
│  OrderCreated Event                       │
│       ↓                                   │
│  OrderSummaryPerspective.UpdateAsync()   │
│       ↓                                   │
│  order_summaries table (denormalized)    │
│       ↓                                   │
│  OrderLens.GetOrderAsync() ← Query       │
│                                           │
└───────────────────────────────────────────┘
```

**Benefits**:
- **Optimized reads**: Denormalized data, no joins
- **Scalability**: Read and write databases can scale independently
- **Flexibility**: Multiple read models for different use cases
- **Performance**: Queries are simple, fast lookups

---

## Multiple Perspectives

**Key Pattern**: One event can trigger **multiple perspectives**.

```csharp
// Event published once
await _dispatcher.PublishAsync(orderCreated);

// Triggers multiple perspectives automatically
```

### Example: OrderCreated Event

```csharp
// Perspective 1: Order Summary (for UI)
public class OrderSummaryPerspective : IPerspectiveOf<OrderCreated> {
    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
        // Update order_summaries table for customer order history
        await _db.ExecuteAsync(
            "INSERT INTO order_summaries (...) VALUES (...)",
            @event
        );
    }
}

// Perspective 2: Inventory Impact (for stock management)
public class InventoryPerspective : IPerspectiveOf<OrderCreated> {
    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
        // Update inventory_levels table to reflect pending reservations
        foreach (var item in @event.Items) {
            await _db.ExecuteAsync(
                "UPDATE inventory_levels SET pending = pending + @Quantity WHERE product_id = @ProductId",
                new { ProductId = item.ProductId, Quantity = item.Quantity }
            );
        }
    }
}

// Perspective 3: Analytics (for reporting)
public class OrderAnalyticsPerspective : IPerspectiveOf<OrderCreated> {
    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
        // Update analytics_daily_sales table for dashboards
        await _db.ExecuteAsync(
            "INSERT INTO analytics_daily_sales (date, order_count, total_sales) VALUES (CURRENT_DATE, 1, @Total) ON CONFLICT (date) DO UPDATE SET order_count = order_count + 1, total_sales = total_sales + @Total",
            new { @event.Total }
        );
    }
}

// Perspective 4: Customer Activity (for personalization)
public class CustomerActivityPerspective : IPerspectiveOf<OrderCreated> {
    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
        // Update customer_activity table for recommendations
        await _db.ExecuteAsync(
            "UPDATE customer_activity SET last_order_date = @CreatedAt, order_count = order_count + 1 WHERE customer_id = @CustomerId",
            new { @event.CustomerId, @event.CreatedAt }
        );
    }
}
```

**Result**: Publishing `OrderCreated` updates **four separate read models** automatically.

---

## Listening to Multiple Events

A single perspective can listen to **multiple event types**:

```csharp
public class OrderSummaryPerspective :
    IPerspectiveOf<OrderCreated>,
    IPerspectiveOf<OrderShipped>,
    IPerspectiveOf<OrderCancelled> {

    private readonly IDbConnectionFactory _db;

    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "INSERT INTO order_summaries (order_id, customer_id, total, status, created_at) VALUES (@OrderId, @CustomerId, @Total, 'Created', @CreatedAt)",
            new {
                @event.OrderId,
                @event.CustomerId,
                @event.Total,
                @event.CreatedAt
            },
            cancellationToken: ct
        );
    }

    public async Task UpdateAsync(OrderShipped @event, CancellationToken ct = default) {
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "UPDATE order_summaries SET status = 'Shipped', shipped_at = @ShippedAt WHERE order_id = @OrderId",
            new {
                @event.OrderId,
                @event.ShippedAt
            },
            cancellationToken: ct
        );
    }

    public async Task UpdateAsync(OrderCancelled @event, CancellationToken ct = default) {
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "UPDATE order_summaries SET status = 'Cancelled', cancelled_at = @CancelledAt WHERE order_id = @OrderId",
            new {
                @event.OrderId,
                @event.CancelledAt
            },
            cancellationToken: ct
        );
    }
}
```

**Pattern**: One read model, multiple events that update it over time.

---

## Read Model Design

### Denormalization

Read models are **denormalized** for query performance:

**Write Model** (normalized):
```sql
-- Normalized schema (write side)
CREATE TABLE orders (
    order_id UUID PRIMARY KEY,
    customer_id UUID NOT NULL,
    status VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE order_items (
    order_item_id UUID PRIMARY KEY,
    order_id UUID NOT NULL,
    product_id UUID NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(order_id)
);

CREATE TABLE customers (
    customer_id UUID PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL
);

CREATE TABLE products (
    product_id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10,2) NOT NULL
);
```

**Read Model** (denormalized):
```sql
-- Denormalized schema (read side)
CREATE TABLE order_summaries (
    order_id UUID PRIMARY KEY,
    customer_id UUID NOT NULL,
    customer_email VARCHAR(255) NOT NULL,    -- Denormalized from customers
    customer_name VARCHAR(255) NOT NULL,      -- Denormalized from customers
    item_count INT NOT NULL,
    total DECIMAL(10,2) NOT NULL,
    status VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    shipped_at TIMESTAMPTZ NULL,
    cancelled_at TIMESTAMPTZ NULL
);

-- Simple index for fast lookups
CREATE INDEX idx_order_summaries_customer_id ON order_summaries(customer_id);
CREATE INDEX idx_order_summaries_created_at ON order_summaries(created_at DESC);
```

**Query Performance**:
```sql
-- ❌ SLOW: Normalized (requires joins)
SELECT o.order_id, c.email, c.full_name, SUM(oi.quantity * oi.unit_price) AS total
FROM orders o
JOIN customers c ON o.customer_id = c.customer_id
JOIN order_items oi ON o.order_id = oi.order_id
WHERE o.customer_id = '...'
GROUP BY o.order_id, c.email, c.full_name;

-- ✅ FAST: Denormalized (single table lookup)
SELECT order_id, customer_email, customer_name, total
FROM order_summaries
WHERE customer_id = '...';
```

### Multiple Read Models

Different perspectives for different use cases:

```csharp
// Read Model 1: Order summary for customer order history UI
public class OrderSummary {
    public Guid OrderId { get; set; }
    public Guid CustomerId { get; set; }
    public string CustomerEmail { get; set; } = string.Empty;
    public string CustomerName { get; set; } = string.Empty;
    public int ItemCount { get; set; }
    public decimal Total { get; set; }
    public string Status { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; }
}

// Read Model 2: Order details for admin dashboard
public class OrderDetails {
    public Guid OrderId { get; set; }
    public Guid CustomerId { get; set; }
    public OrderLineItem[] Items { get; set; } = [];
    public decimal Subtotal { get; set; }
    public decimal Tax { get; set; }
    public decimal ShippingCost { get; set; }
    public decimal Total { get; set; }
    public string Status { get; set; } = string.Empty;
    public string ShippingAddress { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? ShippedAt { get; set; }
}

// Read Model 3: Analytics for reporting
public class DailySalesAnalytics {
    public DateOnly Date { get; set; }
    public int OrderCount { get; set; }
    public decimal TotalSales { get; set; }
    public decimal AverageOrderValue { get; set; }
}
```

Each read model has its own **perspective** and **table schema** optimized for its queries.

---

## Data Access Patterns

### Dapper (Lightweight)

```csharp
public class OrderSummaryPerspective : IPerspectiveOf<OrderCreated> {
    private readonly IDbConnectionFactory _db;

    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
        await using var conn = _db.CreateConnection();

        await conn.ExecuteAsync(
            """
            INSERT INTO order_summaries (
                order_id, customer_id, customer_email, customer_name,
                item_count, total, status, created_at
            ) VALUES (
                @OrderId, @CustomerId, @CustomerEmail, @CustomerName,
                @ItemCount, @Total, @Status, @CreatedAt
            )
            """,
            new {
                @event.OrderId,
                @event.CustomerId,
                @event.CustomerEmail,
                @event.CustomerName,
                ItemCount = @event.Items.Length,
                @event.Total,
                Status = "Created",
                @event.CreatedAt
            },
            cancellationToken: ct
        );
    }
}
```

### EF Core (Full-Featured)

```csharp
public class OrderSummaryPerspective : IPerspectiveOf<OrderCreated> {
    private readonly OrderReadDbContext _dbContext;

    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
        var summary = new OrderSummaryEntity {
            OrderId = @event.OrderId,
            CustomerId = @event.CustomerId,
            CustomerEmail = @event.CustomerEmail,
            CustomerName = @event.CustomerName,
            ItemCount = @event.Items.Length,
            Total = @event.Total,
            Status = "Created",
            CreatedAt = @event.CreatedAt
        };

        _dbContext.OrderSummaries.Add(summary);
        await _dbContext.SaveChangesAsync(ct);
    }
}
```

---

## Dependency Injection

### Registration

**Manual**:
```csharp
builder.Services.AddTransient<IPerspectiveOf<OrderCreated>, OrderSummaryPerspective>();
builder.Services.AddTransient<IPerspectiveOf<OrderCreated>, InventoryPerspective>();
```

**Auto-Discovery** (with Whizbang.Generators):
```csharp
builder.Services.AddDiscoveredPerspectives();  // Finds all IPerspectiveOf implementations
```

### Lifetime

**Recommended**: `Transient` (new instance per event)

**Why?**
- May inject scoped services (e.g., `DbContext`)
- Stateless (no benefit to reusing instances)
- Isolated error handling (one failing perspective doesn't affect others)

```csharp
builder.Services.AddTransient<IPerspectiveOf<OrderCreated>, OrderSummaryPerspective>();
```

---

## Error Handling

### Idempotency

Perspectives should be **idempotent** (processing same event multiple times = same result):

```csharp
public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
    await using var conn = _db.CreateConnection();

    // Use UPSERT to handle duplicate events
    await conn.ExecuteAsync(
        """
        INSERT INTO order_summaries (order_id, customer_id, total, status, created_at)
        VALUES (@OrderId, @CustomerId, @Total, @Status, @CreatedAt)
        ON CONFLICT (order_id) DO NOTHING  -- Ignore duplicates
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
```

**PostgreSQL patterns**:
- `ON CONFLICT ... DO NOTHING` - Ignore duplicates
- `ON CONFLICT ... DO UPDATE` - Update if exists

### Failure Handling

```csharp
public class OrderSummaryPerspective : IPerspectiveOf<OrderCreated> {
    private readonly IDbConnectionFactory _db;
    private readonly ILogger<OrderSummaryPerspective> _logger;

    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
        try {
            await using var conn = _db.CreateConnection();

            await conn.ExecuteAsync(
                "INSERT INTO order_summaries (...) VALUES (...)",
                @event,
                cancellationToken: ct
            );

            _logger.LogInformation(
                "Updated order summary for {OrderId}",
                @event.OrderId
            );

        } catch (Exception ex) when (ex is not OperationCanceledException) {
            // Log error but don't throw - allow other perspectives to continue
            _logger.LogError(
                ex,
                "Failed to update order summary for {OrderId}",
                @event.OrderId
            );

            // Options:
            // 1. Swallow error (eventual consistency - will be retried)
            // 2. Throw (fails entire publish operation)
            // 3. Store in dead letter queue for manual review

            // For most cases: swallow and rely on event replay
        }
    }
}
```

**Strategies**:
1. **Swallow errors**: Log and continue (eventual consistency via event replay)
2. **Throw errors**: Fail entire publish operation (transactional consistency)
3. **Dead letter queue**: Store failed events for manual review/retry

---

## Event Sourcing Integration

Perspectives can rebuild from event history:

```csharp
public class RebuildPerspectiveWorker : BackgroundService {
    private readonly IEventStore _eventStore;
    private readonly IPerspectiveOf<OrderCreated> _perspective;

    protected override async Task ExecuteAsync(CancellationToken ct) {
        // Truncate read model
        await TruncateReadModelAsync(ct);

        // Replay all events
        await foreach (var @event in _eventStore.GetAllEventsAsync<OrderCreated>(ct)) {
            await _perspective.UpdateAsync(@event, ct);
        }
    }

    private async Task TruncateReadModelAsync(CancellationToken ct) {
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync("TRUNCATE TABLE order_summaries", cancellationToken: ct);
    }
}
```

**Use cases**:
- Rebuild corrupted read models
- Add new perspectives to existing event history
- Time-travel queries (rebuild to specific point in time)

---

## Testing Perspectives

### Unit Tests

```csharp
public class OrderSummaryPerspectiveTests {
    [Test]
    public async Task UpdateAsync_OrderCreated_InsertsRowAsync() {
        // Arrange
        var mockDb = CreateMockDb();
        var logger = new NullLogger<OrderSummaryPerspective>();
        var perspective = new OrderSummaryPerspective(mockDb, logger);

        var @event = new OrderCreated(
            OrderId: Guid.NewGuid(),
            CustomerId: Guid.NewGuid(),
            CustomerEmail: "test@example.com",
            CustomerName: "John Doe",
            Items: [new OrderLineItem(Guid.NewGuid(), 2, 19.99m)],
            Total: 39.98m,
            CreatedAt: DateTimeOffset.UtcNow
        );

        // Act
        await perspective.UpdateAsync(@event, CancellationToken.None);

        // Assert
        var summary = await mockDb.QuerySingleOrDefaultAsync<OrderSummary>(
            "SELECT * FROM order_summaries WHERE order_id = @OrderId",
            new { @event.OrderId }
        );

        await Assert.That(summary).IsNotNull();
        await Assert.That(summary!.CustomerId).IsEqualTo(@event.CustomerId);
        await Assert.That(summary.Total).IsEqualTo(39.98m);
        await Assert.That(summary.Status).IsEqualTo("Created");
    }

    [Test]
    public async Task UpdateAsync_Idempotent_DuplicateEventsIgnoredAsync() {
        // Arrange
        var mockDb = CreateMockDb();
        var logger = new NullLogger<OrderSummaryPerspective>();
        var perspective = new OrderSummaryPerspective(mockDb, logger);

        var @event = new OrderCreated(/* ... */);

        // Act - process same event twice
        await perspective.UpdateAsync(@event, CancellationToken.None);
        await perspective.UpdateAsync(@event, CancellationToken.None);  // Duplicate!

        // Assert - only one row exists
        var count = await mockDb.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM order_summaries WHERE order_id = @OrderId",
            new { @event.OrderId }
        );

        await Assert.That(count).IsEqualTo(1);  // Not 2!
    }
}
```

---

## Advanced Patterns

### Pattern: Aggregated Analytics

```csharp
public class DailySalesAnalyticsPerspective : IPerspectiveOf<OrderCreated> {
    private readonly IDbConnectionFactory _db;

    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
        await using var conn = _db.CreateConnection();

        // Upsert daily aggregates
        await conn.ExecuteAsync(
            """
            INSERT INTO analytics_daily_sales (
                date, order_count, total_sales, average_order_value
            ) VALUES (
                CURRENT_DATE, 1, @Total, @Total
            )
            ON CONFLICT (date) DO UPDATE SET
                order_count = analytics_daily_sales.order_count + 1,
                total_sales = analytics_daily_sales.total_sales + @Total,
                average_order_value = (analytics_daily_sales.total_sales + @Total) / (analytics_daily_sales.order_count + 1)
            """,
            new { @event.Total },
            cancellationToken: ct
        );
    }
}
```

### Pattern: Cross-Service Perspective (via Transport)

```csharp
// Service A: Order Service publishes OrderCreated
await _dispatcher.SendAsync(orderCreated);  // Stored in outbox

// Background worker publishes to Azure Service Bus
await _transport.PublishAsync(orderCreated);

// Service B: Inventory Service perspective subscribes
public class InventoryPerspective : IPerspectiveOf<OrderCreated> {
    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
        // Update inventory read model in different service
        await _db.ExecuteAsync(
            "UPDATE inventory_summaries SET pending_orders = pending_orders + 1 WHERE product_id = ANY(@ProductIds)",
            new { ProductIds = @event.Items.Select(i => i.ProductId).ToArray() },
            cancellationToken: ct
        );
    }
}
```

---

## Best Practices

### DO ✅

- ✅ Make perspectives **idempotent** (same event multiple times = same result)
- ✅ Use **UPSERT** (`ON CONFLICT ... DO UPDATE/NOTHING`)
- ✅ Denormalize for query performance
- ✅ Create **multiple read models** for different use cases
- ✅ Log errors but **don't throw** (eventual consistency)
- ✅ Use **transient lifetime** for perspectives
- ✅ Keep perspectives **stateless**
- ✅ Index read model tables for fast queries
- ✅ Test idempotency explicitly

### DON'T ❌

- ❌ Perform complex joins in read models (defeats purpose of denormalization)
- ❌ Call receptors from perspectives (perspectives are read-only)
- ❌ Store state in perspective instances
- ❌ Throw exceptions for transient errors (breaks eventual consistency)
- ❌ Normalize read models (use denormalized schemas)
- ❌ Mix write and read logic in same perspective
- ❌ Ignore duplicate event handling (must be idempotent)

---

## Further Reading

**Core Concepts**:
- [Dispatcher](dispatcher.md) - How to publish events to perspectives
- [Lenses](lenses.md) - Query interfaces for read models
- [Receptors](receptors.md) - Command handlers that produce events

**Data Access**:
- [Dapper Integration](../data/dapper-integration.md) - Lightweight data access
- [EF Core Integration](../data/efcore-integration.md) - Full-featured ORM
- [Perspective Storage](../data/perspectives-storage.md) - Schema design patterns

**Examples**:
- [ECommerce: BFF Pattern](../examples/ecommerce/bff-pattern.md) - Real-world perspectives

---

*Version 0.1.0 - Foundation Release | Last Updated: 2024-12-12*
