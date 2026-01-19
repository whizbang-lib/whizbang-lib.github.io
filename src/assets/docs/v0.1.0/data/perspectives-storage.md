---
title: "Perspectives Storage"
version: 0.1.0
category: Data Access
order: 3
description: "Read model schema design for perspectives - denormalization strategies, JSONB columns, indexing, and high-volume partitioning"
tags: perspectives, read-models, schema-design, denormalization, postgresql, jsonb, partitioning
codeReferences:
  - samples/ECommerce/ECommerce.BFF.API/Perspectives/OrderSummaryPerspective.cs
  - samples/ECommerce/ECommerce.BFF.API/Infrastructure/Migrations/
---

# Perspectives Storage

**Perspectives** are event-driven read models that maintain denormalized, query-optimized views of your domain. This guide covers schema design patterns, denormalization strategies, and PostgreSQL-specific features for building high-performance read models.

## Read Models vs Write Models

| Aspect | Write Models (Domain) | Read Models (Perspectives) |
|--------|----------------------|---------------------------|
| **Normalization** | Normalized (3NF) | Denormalized (flat) |
| **Purpose** | Enforce business rules | Optimize queries |
| **Updates** | Command-driven | Event-driven |
| **Consistency** | Immediate (strong) | Eventual (async) |
| **Technology** | EF Core (optional) | Dapper + PostgreSQL |
| **Schema** | Foreign keys, constraints | Flat, JSONB, indexes |

**Whizbang Philosophy**: Separate write models (domain aggregates) from read models (perspectives) for optimal performance.

---

## Design Principles

### 1. Denormalization

**Goal**: Minimize JOINs at query time by storing all data needed for a query in a single table.

```sql
-- ❌ Normalized (requires JOINs)
SELECT o.order_id, o.total, c.name, c.email
FROM orders o
INNER JOIN customers c ON o.customer_id = c.customer_id;

-- ✅ Denormalized (single table lookup)
SELECT order_id, total, customer_name, customer_email
FROM order_summaries
WHERE order_id = '...';
```

### 2. Query-Driven Design

**Start with queries, design schema to support them**:

```sql
-- Common queries drive schema design:
-- 1. Get order by ID
SELECT * FROM order_summaries WHERE order_id = ?;

-- 2. Get orders by customer
SELECT * FROM order_summaries WHERE customer_id = ? ORDER BY created_at DESC;

-- 3. Search orders
SELECT * FROM order_summaries WHERE customer_name ILIKE ? OR customer_email ILIKE ?;

-- Schema includes customer_id, customer_name, customer_email for direct lookup
```

### 3. Eventual Consistency

**Accept stale reads** for massive performance gains:

```
Command → Write Model → Event → Perspective Update (async)
                                      ↓
                                Read Model (slightly stale, but fast!)
```

**Typical lag**: < 100ms in most systems

---

## Schema Design Patterns

### Pattern 1: Flat Denormalized Table

**Use Case**: Simple read models with all data in columns.

```sql
CREATE TABLE order_summaries (
    order_id UUID PRIMARY KEY,

    -- Order data
    status VARCHAR(50) NOT NULL,
    total DECIMAL(18, 2) NOT NULL,
    item_count INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,

    -- Denormalized customer data
    customer_id UUID NOT NULL,
    customer_name VARCHAR(200) NOT NULL,
    customer_email VARCHAR(200) NOT NULL,

    -- Denormalized shipping data
    shipping_street VARCHAR(200),
    shipping_city VARCHAR(100),
    shipping_state VARCHAR(50),
    shipping_postal_code VARCHAR(20),

    -- Indexes for common queries
    INDEX idx_customer_id (customer_id),
    INDEX idx_created_at (created_at DESC),
    INDEX idx_status (status)
);
```

**Perspective Update**:
```csharp
public class OrderSummaryPerspective : IPerspectiveOf<OrderCreated> {
    private readonly IDbConnectionFactory _db;

    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
        await using var conn = _db.CreateConnection();

        await conn.ExecuteAsync(
            """
            INSERT INTO order_summaries (
                order_id, status, total, item_count, created_at, updated_at,
                customer_id, customer_name, customer_email,
                shipping_street, shipping_city, shipping_state, shipping_postal_code
            ) VALUES (
                @OrderId, @Status, @Total, @ItemCount, @CreatedAt, @UpdatedAt,
                @CustomerId, @CustomerName, @CustomerEmail,
                @ShippingStreet, @ShippingCity, @ShippingState, @ShippingPostalCode
            )
            ON CONFLICT (order_id) DO UPDATE SET
                status = EXCLUDED.status,
                updated_at = EXCLUDED.updated_at
            """,
            new {
                @event.OrderId,
                Status = "Created",
                @event.Total,
                ItemCount = @event.Items.Length,
                @event.CreatedAt,
                UpdatedAt = @event.CreatedAt,
                @event.CustomerId,
                @event.CustomerName,
                @event.CustomerEmail,
                @event.ShippingAddress.Street,
                @event.ShippingAddress.City,
                @event.ShippingAddress.State,
                @event.ShippingAddress.PostalCode
            },
            cancellationToken: ct
        );
    }
}
```

---

### Pattern 2: JSONB for Flexible Data

**Use Case**: Complex nested data, evolving schemas, metadata.

```sql
CREATE TABLE product_catalog (
    product_id UUID PRIMARY KEY,

    -- Core columns
    name VARCHAR(200) NOT NULL,
    sku VARCHAR(100) NOT NULL UNIQUE,
    price DECIMAL(18, 2) NOT NULL,
    available INT NOT NULL DEFAULT 0,

    -- JSONB for flexible metadata
    metadata JSONB NOT NULL DEFAULT '{}',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- GIN index for JSONB queries
    INDEX idx_metadata_gin ON product_catalog USING GIN (metadata)
);
```

**Example JSONB Content**:
```json
{
  "category": "Electronics",
  "subcategory": "Laptops",
  "brand": "TechCorp",
  "tags": ["featured", "sale", "new-arrival"],
  "specifications": {
    "cpu": "Intel i7",
    "ram": "16GB",
    "storage": "512GB SSD"
  },
  "images": [
    {"url": "https://...", "alt": "Front view"},
    {"url": "https://...", "alt": "Side view"}
  ]
}
```

**Query JSONB**:
```sql
-- Filter by category
SELECT * FROM product_catalog
WHERE metadata->>'category' = 'Electronics';

-- Filter by nested property
SELECT * FROM product_catalog
WHERE metadata->'specifications'->>'cpu' = 'Intel i7';

-- Array contains
SELECT * FROM product_catalog
WHERE metadata->'tags' @> '["featured"]';

-- Full-text search in JSONB
SELECT * FROM product_catalog
WHERE metadata->>'brand' ILIKE '%TechCorp%';
```

**Perspective Update**:
```csharp
public async Task UpdateAsync(ProductAdded @event, CancellationToken ct = default) {
    await using var conn = _db.CreateConnection();

    var metadata = new {
        category = @event.Category,
        subcategory = @event.Subcategory,
        brand = @event.Brand,
        tags = @event.Tags,
        specifications = @event.Specifications,
        images = @event.Images
    };

    await conn.ExecuteAsync(
        """
        INSERT INTO product_catalog (
            product_id, name, sku, price, available, metadata, created_at
        ) VALUES (
            @ProductId, @Name, @Sku, @Price, @Available, @Metadata::jsonb, @CreatedAt
        )
        """,
        new {
            @event.ProductId,
            @event.Name,
            @event.Sku,
            @event.Price,
            Available = @event.InitialStock,
            Metadata = JsonSerializer.Serialize(metadata),
            @event.CreatedAt
        },
        cancellationToken: ct
    );
}
```

---

### Pattern 3: Aggregated Data

**Use Case**: Pre-computed aggregations for analytics dashboards.

```sql
CREATE TABLE customer_statistics (
    customer_id UUID PRIMARY KEY,

    -- Aggregated metrics
    total_orders INT NOT NULL DEFAULT 0,
    total_spent DECIMAL(18, 2) NOT NULL DEFAULT 0,
    average_order_value DECIMAL(18, 2) NOT NULL DEFAULT 0,

    -- Temporal data
    first_order_at TIMESTAMPTZ,
    last_order_at TIMESTAMPTZ,

    -- Behavioral flags
    is_vip BOOLEAN NOT NULL DEFAULT FALSE,
    is_at_risk BOOLEAN NOT NULL DEFAULT FALSE,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Perspective Update** (incremental):
```csharp
public class CustomerStatisticsPerspective : IPerspectiveOf<OrderCreated> {
    private readonly IDbConnectionFactory _db;

    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
        await using var conn = _db.CreateConnection();

        await conn.ExecuteAsync(
            """
            INSERT INTO customer_statistics (
                customer_id, total_orders, total_spent, average_order_value,
                first_order_at, last_order_at, is_vip, updated_at
            ) VALUES (
                @CustomerId, 1, @Total, @Total, @OrderDate, @OrderDate, FALSE, NOW()
            )
            ON CONFLICT (customer_id) DO UPDATE SET
                total_orders = customer_statistics.total_orders + 1,
                total_spent = customer_statistics.total_spent + @Total,
                average_order_value = (customer_statistics.total_spent + @Total) / (customer_statistics.total_orders + 1),
                last_order_at = @OrderDate,
                is_vip = (customer_statistics.total_spent + @Total) > 10000,  -- VIP threshold
                updated_at = NOW()
            """,
            new {
                @event.CustomerId,
                @event.Total,
                OrderDate = @event.CreatedAt
            },
            cancellationToken: ct
        );
    }
}
```

**Query**:
```csharp
public async Task<CustomerStatistics?> GetCustomerStatsAsync(
    Guid customerId,
    CancellationToken ct = default) {

    await using var conn = _db.CreateConnection();

    return await conn.QuerySingleOrDefaultAsync<CustomerStatistics>(
        "SELECT * FROM customer_statistics WHERE customer_id = @CustomerId",
        new { CustomerId = customerId },
        cancellationToken: ct
    );
}
```

---

### Pattern 4: Time-Series Data

**Use Case**: High-volume temporal data (metrics, logs, analytics).

```sql
CREATE TABLE order_metrics (
    metric_id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),  -- Time-ordered

    -- Dimensions
    tenant_id UUID NOT NULL,
    customer_id UUID,
    product_id UUID,

    -- Metrics
    metric_type VARCHAR(50) NOT NULL,  -- 'order_created', 'order_shipped', etc.
    metric_value DECIMAL(18, 2),

    -- Temporal
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    date DATE NOT NULL GENERATED ALWAYS AS (DATE(timestamp)) STORED,

    -- Metadata
    metadata JSONB DEFAULT '{}'

) PARTITION BY RANGE (date);

-- Create partitions (monthly)
CREATE TABLE order_metrics_2024_12 PARTITION OF order_metrics
FOR VALUES FROM ('2024-12-01') TO ('2025-01-01');

CREATE TABLE order_metrics_2025_01 PARTITION OF order_metrics
FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

-- Indexes on partitions
CREATE INDEX idx_order_metrics_2024_12_timestamp ON order_metrics_2024_12 (timestamp DESC);
CREATE INDEX idx_order_metrics_2024_12_tenant_id ON order_metrics_2024_12 (tenant_id);
```

**Perspective Update**:
```csharp
public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
    await using var conn = _db.CreateConnection();

    await conn.ExecuteAsync(
        """
        INSERT INTO order_metrics (
            tenant_id, customer_id, metric_type, metric_value, timestamp, metadata
        ) VALUES (
            @TenantId, @CustomerId, 'order_created', @Total, @Timestamp, @Metadata::jsonb
        )
        """,
        new {
            @event.TenantId,
            @event.CustomerId,
            @event.Total,
            Timestamp = @event.CreatedAt,
            Metadata = JsonSerializer.Serialize(new {
                order_id = @event.OrderId,
                item_count = @event.Items.Length
            })
        },
        cancellationToken: ct
    );
}
```

**Query** (time-range with partition pruning):
```sql
-- Query specific time range (PostgreSQL automatically prunes partitions)
SELECT
    DATE(timestamp) AS date,
    COUNT(*) AS order_count,
    SUM(metric_value) AS total_revenue
FROM order_metrics
WHERE tenant_id = '...'
  AND metric_type = 'order_created'
  AND timestamp >= '2024-12-01'
  AND timestamp < '2025-01-01'
GROUP BY DATE(timestamp)
ORDER BY date;
```

---

## Indexing Strategies

### Primary Key

```sql
-- ✅ UUIDv7 (time-ordered, insert-friendly)
order_id UUID PRIMARY KEY DEFAULT uuid_generate_v7()

-- ❌ Random UUID (index fragmentation)
order_id UUID PRIMARY KEY DEFAULT gen_random_uuid()
```

### Lookup Indexes

```sql
-- Single-column indexes for common filters
CREATE INDEX idx_customer_id ON order_summaries (customer_id);
CREATE INDEX idx_status ON order_summaries (status);

-- Composite indexes for combined filters
CREATE INDEX idx_customer_status ON order_summaries (customer_id, status);

-- Descending indexes for ORDER BY DESC
CREATE INDEX idx_created_at_desc ON order_summaries (created_at DESC);
```

### JSONB Indexes

```sql
-- GIN index for JSONB queries
CREATE INDEX idx_metadata_gin ON products USING GIN (metadata);

-- Specific path index (more efficient)
CREATE INDEX idx_metadata_category ON products ((metadata->>'category'));
```

### Partial Indexes

```sql
-- Index only active orders (saves space)
CREATE INDEX idx_active_orders ON order_summaries (customer_id)
WHERE status IN ('Created', 'Processing', 'Shipped');

-- Index only recent orders (saves space)
CREATE INDEX idx_recent_orders ON order_summaries (created_at DESC)
WHERE created_at > NOW() - INTERVAL '90 days';
```

### Full-Text Search

```sql
-- Add tsvector column for full-text search
ALTER TABLE order_summaries
ADD COLUMN search_vector tsvector
GENERATED ALWAYS AS (
    setweight(to_tsvector('english', COALESCE(customer_name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(customer_email, '')), 'B')
) STORED;

-- GIN index for full-text search
CREATE INDEX idx_search_vector ON order_summaries USING GIN (search_vector);

-- Query
SELECT * FROM order_summaries
WHERE search_vector @@ to_tsquery('english', 'john & doe');
```

---

## Multi-Tenancy Patterns

### Pattern 1: Tenant Column + Row-Level Security

```sql
CREATE TABLE order_summaries (
    order_id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    -- ... other columns

    INDEX idx_tenant_id (tenant_id)
);

-- Row-Level Security (RLS)
ALTER TABLE order_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON order_summaries
USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

**Application**:
```csharp
public async Task<OrderSummary[]> GetOrdersAsync(
    Guid tenantId,
    CancellationToken ct = default) {

    await using var conn = _db.CreateConnection();
    await conn.OpenAsync(ct);

    // Set tenant context
    await conn.ExecuteAsync($"SET app.current_tenant_id = '{tenantId}'");

    // Query (RLS automatically filters by tenant_id)
    var orders = await conn.QueryAsync<OrderSummary>(
        "SELECT * FROM order_summaries ORDER BY created_at DESC",
        cancellationToken: ct
    );

    return orders.ToArray();
}
```

### Pattern 2: Schema-Per-Tenant

```sql
-- Create schema per tenant
CREATE SCHEMA tenant_abc123;
CREATE SCHEMA tenant_def456;

-- Same table structure in each schema
CREATE TABLE tenant_abc123.order_summaries (
    order_id UUID PRIMARY KEY,
    -- ... columns (no tenant_id needed!)
);

CREATE TABLE tenant_def456.order_summaries (
    order_id UUID PRIMARY KEY,
    -- ... columns
);
```

**Application**:
```csharp
public async Task<OrderSummary[]> GetOrdersAsync(
    string tenantSchemaName,
    CancellationToken ct = default) {

    await using var conn = _db.CreateConnection();

    // Query tenant-specific schema
    var orders = await conn.QueryAsync<OrderSummary>(
        $"SELECT * FROM {tenantSchemaName}.order_summaries ORDER BY created_at DESC",
        cancellationToken: ct
    );

    return orders.ToArray();
}
```

**Benefit**: Complete data isolation, easier to move tenants to separate databases.

---

## Materialized Views (Alternative to Perspectives)

**Materialized Views** are an alternative to perspectives for complex queries:

```sql
-- Create materialized view
CREATE MATERIALIZED VIEW order_daily_summary AS
SELECT
    DATE(created_at) AS order_date,
    status,
    COUNT(*) AS order_count,
    SUM(total) AS total_revenue,
    AVG(total) AS average_order_value
FROM order_summaries
GROUP BY DATE(created_at), status;

-- Index for fast lookups
CREATE INDEX idx_order_daily_summary_date ON order_daily_summary (order_date DESC);

-- Refresh (manual)
REFRESH MATERIALIZED VIEW order_daily_summary;

-- Refresh (concurrent - doesn't block reads)
REFRESH MATERIALIZED VIEW CONCURRENTLY order_daily_summary;
```

**Comparison**:

| Aspect | Perspectives (Event-Driven) | Materialized Views |
|--------|----------------------------|-------------------|
| **Updates** | Real-time (event-driven) | Manual/scheduled refresh |
| **Freshness** | < 100ms typical lag | Depends on refresh frequency |
| **Flexibility** | Custom business logic | SQL-only |
| **Performance** | Excellent (indexed table) | Excellent (indexed view) |
| **Use Case** | Real-time dashboards | Batch reports, analytics |

**Recommendation**: Use perspectives for real-time, materialized views for batch reports.

---

## Migration Strategies

### Strategy 1: Schema Migrations with EF Core

```csharp
// Migration: Add order_summaries table
public partial class AddOrderSummaries : Migration {
    protected override void Up(MigrationBuilder migrationBuilder) {
        migrationBuilder.Sql("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";");

        migrationBuilder.CreateTable(
            name: "order_summaries",
            columns: table => new {
                order_id = table.Column<Guid>(nullable: false, defaultValueSql: "uuid_generate_v7()"),
                status = table.Column<string>(maxLength: 50, nullable: false),
                total = table.Column<decimal>(type: "decimal(18,2)", nullable: false),
                created_at = table.Column<DateTimeOffset>(nullable: false, defaultValueSql: "NOW()"),
                customer_id = table.Column<Guid>(nullable: false),
                customer_name = table.Column<string>(maxLength: 200, nullable: false),
                customer_email = table.Column<string>(maxLength: 200, nullable: false)
            },
            constraints: table => {
                table.PrimaryKey("pk_order_summaries", x => x.order_id);
            }
        );

        migrationBuilder.CreateIndex(
            name: "ix_order_summaries_customer_id",
            table: "order_summaries",
            column: "customer_id"
        );

        migrationBuilder.CreateIndex(
            name: "ix_order_summaries_created_at",
            table: "order_summaries",
            column: "created_at",
            descending: true
        );
    }

    protected override void Down(MigrationBuilder migrationBuilder) {
        migrationBuilder.DropTable(name: "order_summaries");
    }
}
```

### Strategy 2: SQL Scripts

```sql
-- migrations/001_create_order_summaries.sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE order_summaries (
    order_id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    status VARCHAR(50) NOT NULL,
    total DECIMAL(18, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    customer_id UUID NOT NULL,
    customer_name VARCHAR(200) NOT NULL,
    customer_email VARCHAR(200) NOT NULL
);

CREATE INDEX idx_order_summaries_customer_id ON order_summaries (customer_id);
CREATE INDEX idx_order_summaries_created_at ON order_summaries (created_at DESC);
```

**Apply with psql**:
```bash
psql -U postgres -d whizbang -f migrations/001_create_order_summaries.sql
```

---

## Best Practices

### DO ✅

- ✅ **Denormalize aggressively** - Store all data needed for queries in one table
- ✅ **Use UUIDv7** for primary keys (time-ordered, insert-friendly)
- ✅ **Use JSONB** for flexible, evolving data
- ✅ **Index common filters** - customer_id, status, created_at
- ✅ **Use partial indexes** - Index only relevant data (active records, recent records)
- ✅ **Use GIN indexes** for JSONB queries
- ✅ **Use partitioning** for high-volume time-series data
- ✅ **Test query performance** with EXPLAIN ANALYZE
- ✅ **Monitor index usage** - Drop unused indexes

### DON'T ❌

- ❌ Normalize perspectives (defeats the purpose)
- ❌ Use random UUIDs (index fragmentation)
- ❌ Skip indexes on foreign keys (customer_id, product_id)
- ❌ Over-index (every index slows writes)
- ❌ Store BLOBs in PostgreSQL (use object storage)
- ❌ Use triggers for perspective updates (use events)
- ❌ Use materialized views for real-time data (use perspectives)

---

## Performance Tuning

### Query Analysis

```sql
-- Analyze query performance
EXPLAIN ANALYZE
SELECT * FROM order_summaries
WHERE customer_id = '...'
ORDER BY created_at DESC
LIMIT 10;
```

**Look for**:
- **Seq Scan** (bad) → Add index
- **Index Scan** (good)
- **Bitmap Heap Scan** (good for low selectivity)

### Index Usage Monitoring

```sql
-- Find unused indexes
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan AS index_scans
FROM pg_stat_user_indexes
WHERE idx_scan = 0
  AND indexrelname NOT LIKE 'pg_%'
ORDER BY schemaname, tablename;
```

### Table Bloat Monitoring

```sql
-- Check table bloat (dead rows)
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
    n_dead_tup AS dead_tuples
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
ORDER BY n_dead_tup DESC;

-- Fix bloat
VACUUM ANALYZE order_summaries;
```

---

## Further Reading

**Core Concepts**:
- [Perspectives](../core-concepts/perspectives.md) - Event-driven read models
- [Lenses](../core-concepts/lenses.md) - Query repositories

**Data Access**:
- [Dapper Integration](dapper-integration.md) - Lightweight data access
- [EF Core Integration](efcore-integration.md) - Full-featured ORM
- [Event Store](event-store.md) - Event storage and replay

**Messaging**:
- [Outbox Pattern](../messaging/outbox-pattern.md) - Reliable event publishing
- [Inbox Pattern](../messaging/inbox-pattern.md) - Exactly-once processing

**Examples**:
- [ECommerce: BFF Perspectives](../examples/ecommerce/bff-pattern.md) - Real-world perspective design

---

*Version 0.1.0 - Foundation Release | Last Updated: 2024-12-12*
