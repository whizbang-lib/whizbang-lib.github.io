---
title: "Multi-Tenancy Patterns"
version: 0.1.0
category: Advanced Topics
order: 4
description: "Multi-tenancy architecture patterns - database-per-tenant, schema-per-tenant, row-level security"
tags: multi-tenancy, saas, database-per-tenant, row-level-security, isolation
---

# Multi-Tenancy Patterns

Comprehensive guide to **multi-tenancy architectures** with Whizbang - database-per-tenant, schema-per-tenant, row-level security, tenant context management, and migration strategies.

---

## Multi-Tenancy Comparison

| Pattern | Isolation | Cost | Complexity | Scale Limit |
|---------|-----------|------|------------|-------------|
| **Database Per Tenant** | ⭐⭐⭐⭐⭐ | High | Medium | ~1,000 tenants |
| **Schema Per Tenant** | ⭐⭐⭐⭐ | Medium | Medium | ~10,000 tenants |
| **Row-Level Security (RLS)** | ⭐⭐⭐ | Low | Low | ~100,000+ tenants |
| **Discriminator Column** | ⭐⭐ | Low | Low | ~100,000+ tenants |

---

## Pattern 1: Database Per Tenant

**Strongest isolation** - Each tenant has dedicated database.

### Architecture

```
┌────────────────────────────────────────────────────┐
│  Multi-Tenant SaaS Application                     │
│                                                     │
│  ┌──────────────────┐                              │
│  │  Tenant Resolver │                              │
│  │  - Header/JWT    │                              │
│  │  - Subdomain     │                              │
│  └────────┬─────────┘                              │
│           │                                         │
│           ▼                                         │
│  ┌──────────────────┐                              │
│  │ Connection Pool  │                              │
│  │  Manager         │                              │
│  └────────┬─────────┘                              │
│           │                                         │
│  ┌────────┼───────────────────────────┐            │
│  │        │                           │            │
│  ▼        ▼                           ▼            │
│ ┌─────┐ ┌─────┐                   ┌─────┐         │
│ │DB-A │ │DB-B │       ...         │DB-Z │         │
│ └─────┘ └─────┘                   └─────┘         │
└────────────────────────────────────────────────────┘
```

### Tenant Context (AsyncLocal)

**TenantContext.cs**:

```csharp
public static class TenantContext {
  private static readonly AsyncLocal<string?> _tenantId = new();

  public static string? CurrentTenantId {
    get => _tenantId.Value;
    set => _tenantId.Value = value;
  }

  public static string RequireTenantId() {
    return CurrentTenantId
      ?? throw new InvalidOperationException("No tenant context established");
  }
}
```

**Why AsyncLocal?**:
- ✅ Thread-safe
- ✅ Async-safe (flows through await calls)
- ✅ Request-scoped (automatically cleared after request)

### Tenant Identification Middleware

**TenantIdentificationMiddleware.cs**:

```csharp
public class TenantIdentificationMiddleware {
  private readonly RequestDelegate _next;

  public TenantIdentificationMiddleware(RequestDelegate next) {
    _next = next;
  }

  public async Task InvokeAsync(HttpContext context) {
    // Option 1: Custom header
    var tenantId = context.Request.Headers["X-Tenant-Id"].FirstOrDefault();

    // Option 2: Subdomain (e.g., acme.myapp.com -> acme)
    if (string.IsNullOrEmpty(tenantId)) {
      var host = context.Request.Host.Host;
      tenantId = host.Split('.').FirstOrDefault();
    }

    // Option 3: JWT claim
    if (string.IsNullOrEmpty(tenantId)) {
      tenantId = context.User.FindFirst("tenant_id")?.Value;
    }

    if (string.IsNullOrEmpty(tenantId)) {
      context.Response.StatusCode = 400;
      await context.Response.WriteAsync("Missing tenant identification");
      return;
    }

    // Set tenant context
    TenantContext.CurrentTenantId = tenantId;

    await _next(context);
  }
}
```

**Registration (Program.cs)**:

```csharp
app.UseMiddleware<TenantIdentificationMiddleware>();
```

### Tenant-Aware Database Connections

**TenantDbConnectionFactory.cs**:

```csharp
public interface ITenantDbConnectionFactory {
  Task<IDbConnection> CreateConnectionAsync(CancellationToken ct = default);
}

public class TenantDbConnectionFactory : ITenantDbConnectionFactory {
  private readonly IConfiguration _config;
  private readonly ILogger<TenantDbConnectionFactory> _logger;

  public async Task<IDbConnection> CreateConnectionAsync(CancellationToken ct = default) {
    var tenantId = TenantContext.RequireTenantId();
    var connectionString = GetConnectionString(tenantId);

    var connection = new NpgsqlConnection(connectionString);
    await connection.OpenAsync(ct);

    _logger.LogDebug("Opened connection to tenant database: {TenantId}", tenantId);

    return connection;
  }

  private string GetConnectionString(string tenantId) {
    // Option 1: Configuration-based
    var connectionString = _config[$"Tenants:{tenantId}:ConnectionString"];
    if (!string.IsNullOrEmpty(connectionString)) {
      return connectionString;
    }

    // Option 2: Template-based (same server, different database)
    var template = _config["Database:TenantTemplate"]
      ?? throw new InvalidOperationException("Missing tenant template connection string");

    return template.Replace("{TenantId}", tenantId);
  }
}
```

**appsettings.json**:

```json
{
  "Database": {
    "TenantTemplate": "Host=db.myapp.com;Database=tenant_{TenantId};Username=app;Password=***"
  }
}
```

### Tenant-Aware Receptors

**CreateOrderReceptor.cs**:

```csharp
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
  private readonly ITenantDbConnectionFactory _dbFactory;

  public async Task<OrderCreated> HandleAsync(
    CreateOrder command,
    CancellationToken ct = default
  ) {
    var tenantId = TenantContext.RequireTenantId();

    await using var connection = await _dbFactory.CreateConnectionAsync(ct);
    await using var tx = await connection.BeginTransactionAsync(ct);

    try {
      // Insert order (tenant-specific database)
      await connection.ExecuteAsync(
        """
        INSERT INTO orders (order_id, customer_id, total_amount, created_at)
        VALUES (@OrderId, @CustomerId, @TotalAmount, NOW())
        """,
        new {
          OrderId = orderId,
          CustomerId = command.CustomerId,
          TotalAmount = command.Items.Sum(i => i.Quantity * i.UnitPrice)
        },
        transaction: tx
      );

      // Insert outbox message
      await connection.ExecuteAsync(
        """
        INSERT INTO outbox (message_id, message_type, message_body, created_at)
        VALUES (@MessageId, @MessageType, @MessageBody::jsonb, NOW())
        """,
        transaction: tx
      );

      await tx.CommitAsync(ct);

      return new OrderCreated {
        OrderId = orderId,
        CustomerId = command.CustomerId,
        TenantId = tenantId,  // Include tenant in event
        CreatedAt = DateTime.UtcNow
      };
    } catch {
      await tx.RollbackAsync(ct);
      throw;
    }
  }
}
```

### Tenant Onboarding

**TenantOnboardingReceptor.cs**:

```csharp
public record CreateTenant : ICommand<TenantCreated> {
  public required string TenantId { get; init; }
  public required string Name { get; init; }
  public required string AdminEmail { get; init; }
}

public class TenantOnboardingReceptor : IReceptor<CreateTenant, TenantCreated> {
  private readonly IConfiguration _config;
  private readonly IDbConnection _adminDb;

  public async Task<TenantCreated> HandleAsync(
    CreateTenant command,
    CancellationToken ct = default
  ) {
    // 1. Create tenant database
    var adminConnectionString = _config["Database:AdminConnectionString"];
    await using var adminConn = new NpgsqlConnection(adminConnectionString);
    await adminConn.OpenAsync(ct);

    await adminConn.ExecuteAsync($"CREATE DATABASE tenant_{command.TenantId}");

    // 2. Run schema migrations
    var tenantConnectionString = _config["Database:TenantTemplate"]
      .Replace("{TenantId}", command.TenantId);

    await using var tenantConn = new NpgsqlConnection(tenantConnectionString);
    await tenantConn.OpenAsync(ct);

    await tenantConn.ExecuteAsync(File.ReadAllText("schema.sql"));

    // 3. Register tenant in admin database
    await _adminDb.ExecuteAsync(
      """
      INSERT INTO tenants (tenant_id, name, admin_email, created_at, status)
      VALUES (@TenantId, @Name, @AdminEmail, NOW(), 'active')
      """,
      new {
        TenantId = command.TenantId,
        Name = command.Name,
        AdminEmail = command.AdminEmail
      }
    );

    return new TenantCreated {
      TenantId = command.TenantId,
      Name = command.Name,
      CreatedAt = DateTime.UtcNow
    };
  }
}
```

---

## Pattern 2: Schema Per Tenant

**Medium isolation** - Shared database, separate schemas per tenant.

### Schema Management

**PostgreSQL schemas**:

```sql
-- Create tenant schemas
CREATE SCHEMA tenant_acme;
CREATE SCHEMA tenant_globex;

-- Create tables in each schema
CREATE TABLE tenant_acme.orders (
  order_id UUID PRIMARY KEY,
  customer_id TEXT NOT NULL,
  total_amount DECIMAL(18,2) NOT NULL,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE tenant_globex.orders (
  order_id UUID PRIMARY KEY,
  customer_id TEXT NOT NULL,
  total_amount DECIMAL(18,2) NOT NULL,
  created_at TIMESTAMP NOT NULL
);
```

### Tenant-Aware Connection

**SchemaPerTenantDbConnectionFactory.cs**:

```csharp
public class SchemaPerTenantDbConnectionFactory : ITenantDbConnectionFactory {
  private readonly IConfiguration _config;

  public async Task<IDbConnection> CreateConnectionAsync(CancellationToken ct = default) {
    var tenantId = TenantContext.RequireTenantId();
    var connectionString = _config["Database:ConnectionString"];

    var connection = new NpgsqlConnection(connectionString);
    await connection.OpenAsync(ct);

    // Set search_path to tenant schema
    await connection.ExecuteAsync($"SET search_path TO tenant_{tenantId}");

    return connection;
  }
}
```

### Tenant Onboarding (Schema)

```csharp
public async Task<TenantCreated> HandleAsync(
  CreateTenant command,
  CancellationToken ct = default
) {
  await using var connection = new NpgsqlConnection(_config["Database:ConnectionString"]);
  await connection.OpenAsync(ct);

  // 1. Create schema
  await connection.ExecuteAsync($"CREATE SCHEMA tenant_{command.TenantId}");

  // 2. Create tables in schema
  await connection.ExecuteAsync($"""
    CREATE TABLE tenant_{command.TenantId}.orders (
      order_id UUID PRIMARY KEY,
      customer_id TEXT NOT NULL,
      total_amount DECIMAL(18,2) NOT NULL,
      created_at TIMESTAMP NOT NULL
    )
    """);

  // 3. Register tenant
  await connection.ExecuteAsync(
    """
    INSERT INTO public.tenants (tenant_id, name, admin_email, created_at, status)
    VALUES (@TenantId, @Name, @AdminEmail, NOW(), 'active')
    """,
    new { TenantId = command.TenantId, Name = command.Name, AdminEmail = command.AdminEmail }
  );

  return new TenantCreated { TenantId = command.TenantId, CreatedAt = DateTime.UtcNow };
}
```

---

## Pattern 3: Row-Level Security (RLS)

**Lower isolation** - Shared database and schema, automatic row filtering.

### PostgreSQL RLS Setup

```sql
-- Enable RLS on table
CREATE TABLE orders (
  order_id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  total_amount DECIMAL(18,2) NOT NULL,
  created_at TIMESTAMP NOT NULL
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Create RLS policy
CREATE POLICY tenant_isolation_policy ON orders
  USING (tenant_id = current_setting('app.tenant_id')::text);

-- Grant access
GRANT SELECT, INSERT, UPDATE, DELETE ON orders TO app_user;
```

### Tenant Context (PostgreSQL)

**RLSDbConnectionFactory.cs**:

```csharp
public class RLSDbConnectionFactory : ITenantDbConnectionFactory {
  private readonly IConfiguration _config;

  public async Task<IDbConnection> CreateConnectionAsync(CancellationToken ct = default) {
    var tenantId = TenantContext.RequireTenantId();
    var connectionString = _config["Database:ConnectionString"];

    var connection = new NpgsqlConnection(connectionString);
    await connection.OpenAsync(ct);

    // Set tenant context for RLS
    await connection.ExecuteAsync(
      "SELECT set_config('app.tenant_id', @TenantId, false)",
      new { TenantId = tenantId }
    );

    return connection;
  }
}
```

### Automatic Tenant Filtering

With RLS enabled, all queries automatically filter by tenant:

```csharp
// This query automatically filters to current tenant
var orders = await connection.QueryAsync<OrderRow>(
  """
  SELECT * FROM orders
  WHERE customer_id = @CustomerId
  """,
  new { CustomerId = "cust-123" }
);

// Equivalent to:
// SELECT * FROM orders
// WHERE customer_id = 'cust-123' AND tenant_id = 'current-tenant'
```

---

## Pattern 4: Discriminator Column

**Lowest isolation** - Shared database/schema, manual tenant filtering.

### Schema

```sql
CREATE TABLE orders (
  order_id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,  -- Discriminator column
  customer_id TEXT NOT NULL,
  total_amount DECIMAL(18,2) NOT NULL,
  created_at TIMESTAMP NOT NULL
);

-- Index for tenant queries
CREATE INDEX idx_orders_tenant_id ON orders(tenant_id);
```

### Manual Filtering

**CreateOrderReceptor.cs**:

```csharp
public async Task<OrderCreated> HandleAsync(
  CreateOrder command,
  CancellationToken ct = default
) {
  var tenantId = TenantContext.RequireTenantId();

  await using var connection = new NpgsqlConnection(_config["Database:ConnectionString"]);
  await connection.OpenAsync(ct);

  // ALWAYS include tenant_id in INSERT
  await connection.ExecuteAsync(
    """
    INSERT INTO orders (order_id, tenant_id, customer_id, total_amount, created_at)
    VALUES (@OrderId, @TenantId, @CustomerId, @TotalAmount, NOW())
    """,
    new {
      OrderId = orderId,
      TenantId = tenantId,  // ⚠️ Critical: Include tenant ID
      CustomerId = command.CustomerId,
      TotalAmount = totalAmount
    }
  );

  return new OrderCreated { OrderId = orderId, TenantId = tenantId };
}

// ALWAYS include tenant_id in WHERE clause
var orders = await connection.QueryAsync<OrderRow>(
  """
  SELECT * FROM orders
  WHERE tenant_id = @TenantId AND customer_id = @CustomerId
  """,
  new { TenantId = tenantId, CustomerId = "cust-123" }
);
```

**⚠️ Risk**: Developers must remember to include `tenant_id` in every query (easy to forget).

---

## Cross-Tenant Analytics

**Shared analytics database** for reporting across tenants:

### Architecture

```
┌────────────────────────────────────────────────────────┐
│  Tenant Databases                                      │
│  ┌─────┐  ┌─────┐             ┌─────┐                 │
│  │DB-A │  │DB-B │    ...      │DB-Z │                 │
│  └──┬──┘  └──┬──┘             └──┬──┘                 │
│     │        │                   │                     │
│     └────────┼───────────────────┘                     │
│              │ Events                                  │
│              ▼                                          │
│  ┌───────────────────────────┐                         │
│  │ Analytics Worker          │                         │
│  │  - CrossTenantPerspective │                         │
│  └──────────┬────────────────┘                         │
│             │                                           │
│             ▼                                           │
│  ┌───────────────────────────┐                         │
│  │ Shared Analytics Database │                         │
│  │  - Aggregated metrics     │                         │
│  │  - All tenants            │                         │
│  └───────────────────────────┘                         │
└────────────────────────────────────────────────────────┘
```

### Cross-Tenant Perspective

**CrossTenantAnalyticsPerspective.cs**:

```csharp
public class CrossTenantAnalyticsPerspective : IPerspectiveOf<OrderCreated> {
  private readonly IDbConnection _analyticsDb;  // Shared analytics database

  public async Task HandleAsync(OrderCreated @event, CancellationToken ct = default) {
    // Insert into shared analytics database (includes tenant_id)
    await _analyticsDb.ExecuteAsync(
      """
      INSERT INTO order_analytics (order_id, tenant_id, customer_id, total_amount, created_at)
      VALUES (@OrderId, @TenantId, @CustomerId, @TotalAmount, @CreatedAt)
      """,
      new {
        OrderId = @event.OrderId,
        TenantId = @event.TenantId,  // Track which tenant
        CustomerId = @event.CustomerId,
        TotalAmount = @event.TotalAmount,
        CreatedAt = @event.CreatedAt
      }
    );
  }
}
```

### Analytics Queries

```csharp
// Query across all tenants
var metrics = await _analyticsDb.QueryAsync<TenantMetrics>(
  """
  SELECT
    tenant_id,
    COUNT(*) AS total_orders,
    SUM(total_amount) AS total_revenue,
    AVG(total_amount) AS avg_order_value
  FROM order_analytics
  WHERE created_at >= @StartDate
  GROUP BY tenant_id
  ORDER BY total_revenue DESC
  """,
  new { StartDate = DateTime.UtcNow.AddDays(-30) }
);
```

---

## Tenant Isolation Testing

**TenantIsolationTests.cs**:

```csharp
public class TenantIsolationTests {
  [Test]
  public async Task CreateOrder_DifferentTenants_IsolatedData() {
    // Arrange - Tenant A
    TenantContext.CurrentTenantId = "tenant-a";
    var receptorA = new CreateOrderReceptor(_dbFactory);
    var commandA = new CreateOrder { CustomerId = "cust-a", Items = [...] };

    // Act - Tenant A creates order
    var resultA = await receptorA.HandleAsync(commandA);

    // Arrange - Tenant B
    TenantContext.CurrentTenantId = "tenant-b";
    var receptorB = new CreateOrderReceptor(_dbFactory);
    var commandB = new CreateOrder { CustomerId = "cust-b", Items = [...] };

    // Act - Tenant B creates order
    var resultB = await receptorB.HandleAsync(commandB);

    // Assert - Tenant A cannot see Tenant B's order
    TenantContext.CurrentTenantId = "tenant-a";
    await using var connA = await _dbFactory.CreateConnectionAsync();
    var ordersA = await connA.QueryAsync<OrderRow>("SELECT * FROM orders");

    await Assert.That(ordersA).HasCount(1);
    await Assert.That(ordersA.Single().OrderId).IsEqualTo(resultA.OrderId);

    // Assert - Tenant B cannot see Tenant A's order
    TenantContext.CurrentTenantId = "tenant-b";
    await using var connB = await _dbFactory.CreateConnectionAsync();
    var ordersB = await connB.QueryAsync<OrderRow>("SELECT * FROM orders");

    await Assert.That(ordersB).HasCount(1);
    await Assert.That(ordersB.Single().OrderId).IsEqualTo(resultB.OrderId);
  }
}
```

---

## Migration Strategies

### Migrating from Discriminator to Database-Per-Tenant

**Step 1: Export tenant data**:

```csharp
var tenantIds = await _db.QueryAsync<string>("SELECT DISTINCT tenant_id FROM orders");

foreach (var tenantId in tenantIds) {
  var orders = await _db.QueryAsync<OrderRow>(
    "SELECT * FROM orders WHERE tenant_id = @TenantId",
    new { TenantId = tenantId }
  );

  await File.WriteAllTextAsync(
    $"export/tenant-{tenantId}-orders.json",
    JsonSerializer.Serialize(orders)
  );
}
```

**Step 2: Create tenant databases**:

```csharp
foreach (var tenantId in tenantIds) {
  await _adminDb.ExecuteAsync($"CREATE DATABASE tenant_{tenantId}");

  await using var tenantConn = new NpgsqlConnection(
    $"Host=localhost;Database=tenant_{tenantId};..."
  );
  await tenantConn.OpenAsync();

  await tenantConn.ExecuteAsync(File.ReadAllText("schema.sql"));
}
```

**Step 3: Import data**:

```csharp
foreach (var tenantId in tenantIds) {
  var orders = JsonSerializer.Deserialize<OrderRow[]>(
    await File.ReadAllTextAsync($"export/tenant-{tenantId}-orders.json")
  );

  await using var tenantConn = new NpgsqlConnection(
    $"Host=localhost;Database=tenant_{tenantId};..."
  );
  await tenantConn.OpenAsync();

  await tenantConn.ExecuteAsync(
    "INSERT INTO orders (order_id, customer_id, total_amount, created_at) VALUES (@OrderId, @CustomerId, @TotalAmount, @CreatedAt)",
    orders
  );
}
```

---

## Key Takeaways

✅ **Database Per Tenant** - Strongest isolation, higher cost (~1,000 tenants)
✅ **Schema Per Tenant** - Medium isolation, shared database (~10,000 tenants)
✅ **Row-Level Security** - Automatic filtering, lower isolation (~100K+ tenants)
✅ **Discriminator Column** - Manual filtering, lowest isolation (~100K+ tenants)
✅ **AsyncLocal Context** - Thread-safe, async-safe tenant tracking
✅ **Cross-Tenant Analytics** - Shared analytics database for reporting

---

## Decision Matrix

| Use Case | Recommended Pattern |
|----------|---------------------|
| **B2B SaaS (< 1K customers)** | Database Per Tenant |
| **B2B SaaS (1K-10K customers)** | Schema Per Tenant |
| **B2C SaaS (millions of users)** | RLS or Discriminator |
| **Strict compliance (HIPAA, etc.)** | Database Per Tenant |
| **Cost-sensitive** | RLS or Discriminator |

---

*Version 0.1.0 - Foundation Release | Last Updated: 2024-12-12*
