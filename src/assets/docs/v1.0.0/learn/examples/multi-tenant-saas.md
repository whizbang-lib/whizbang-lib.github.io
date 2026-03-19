---
title: Multi-Tenant SaaS
version: 1.0.0
category: Customization Examples
order: 1
description: >-
  Build multi-tenant SaaS applications with tenant isolation, per-tenant
  databases, and cross-tenant analytics
tags: 'multi-tenancy, saas, tenant-isolation, database-per-tenant'
---

# Multi-Tenant SaaS

Build **multi-tenant SaaS applications** with Whizbang featuring tenant isolation, per-tenant databases, cross-tenant analytics, and tenant-specific customizations.

---

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│  Multi-Tenant SaaS Architecture                            │
│                                                             │
│  ┌──────────────┐                                          │
│  │  HTTP Request│  X-Tenant-Id: tenant-a                   │
│  └──────┬───────┘                                          │
│         │                                                   │
│         ▼                                                   │
│  ┌────────────────────────────┐                            │
│  │  Tenant Identification     │                            │
│  │  Middleware                │                            │
│  └──────┬─────────────────────┘                            │
│         │                                                   │
│         ▼                                                   │
│  ┌────────────────────────────┐                            │
│  │  Tenant-Aware Dispatcher   │                            │
│  │  (Routes to tenant DB)     │                            │
│  └──────┬─────────────────────┘                            │
│         │                                                   │
│         ├──────────────┬──────────────┬─────────────┐      │
│         ▼              ▼              ▼             ▼      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ Tenant A │  │ Tenant B │  │ Tenant C │  │ Shared   │  │
│  │    DB    │  │    DB    │  │    DB    │  │    DB    │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
└────────────────────────────────────────────────────────────┘
```

**Key features**:
- ✅ Database per tenant (strongest isolation)
- ✅ Tenant context propagation
- ✅ Cross-tenant analytics
- ✅ Tenant-specific customizations
- ✅ Tenant onboarding automation

---

## Tenant Identification

### Tenant Context

**TenantContext.cs**:

```csharp
public class TenantContext {
  private static readonly AsyncLocal<string?> _tenantId = new();

  public static string? CurrentTenantId {
    get => _tenantId.Value;
    set => _tenantId.Value = value;
  }

  public static void Set(string tenantId) {
    if (string.IsNullOrWhiteSpace(tenantId)) {
      throw new ArgumentException("Tenant ID cannot be null or empty", nameof(tenantId));
    }
    _tenantId.Value = tenantId;
  }

  public static void Clear() {
    _tenantId.Value = null;
  }
}
```

### Tenant Middleware

**TenantIdentificationMiddleware.cs**:

```csharp
public class TenantIdentificationMiddleware {
  private readonly RequestDelegate _next;
  private readonly ILogger<TenantIdentificationMiddleware> _logger;

  public TenantIdentificationMiddleware(
    RequestDelegate next,
    ILogger<TenantIdentificationMiddleware> logger
  ) {
    _next = next;
    _logger = logger;
  }

  public async Task InvokeAsync(HttpContext context) {
    // 1. Extract tenant ID from header
    var tenantId = context.Request.Headers["X-Tenant-Id"].FirstOrDefault();

    // 2. Fallback: Extract from subdomain (e.g., tenant-a.example.com)
    if (string.IsNullOrWhiteSpace(tenantId)) {
      var host = context.Request.Host.Host;
      var parts = host.Split('.');
      if (parts.Length > 2) {
        tenantId = parts[0];
      }
    }

    // 3. Fallback: Extract from JWT claim
    if (string.IsNullOrWhiteSpace(tenantId)) {
      tenantId = context.User.FindFirst("tenant_id")?.Value;
    }

    if (string.IsNullOrWhiteSpace(tenantId)) {
      context.Response.StatusCode = 400;
      await context.Response.WriteAsJsonAsync(new {
        error = "Tenant ID is required"
      });
      return;
    }

    // 4. Set tenant context
    TenantContext.Set(tenantId);
    _logger.LogInformation("Request for tenant {TenantId}", tenantId);

    try {
      await _next(context);
    } finally {
      TenantContext.Clear();
    }
  }
}
```

**Program.cs registration**:

```csharp
app.UseMiddleware<TenantIdentificationMiddleware>();
```

---

## Database Per Tenant

### Tenant Database Resolver

**ITenantDatabaseResolver.cs**:

```csharp
public interface ITenantDatabaseResolver {
  string GetConnectionString(string tenantId);
}

public class TenantDatabaseResolver : ITenantDatabaseResolver {
  private readonly Dictionary<string, string> _tenantConnectionStrings;

  public TenantDatabaseResolver(IConfiguration configuration) {
    _tenantConnectionStrings = configuration
      .GetSection("Tenants")
      .Get<Dictionary<string, TenantConfig>>()
      ?.ToDictionary(
        kvp => kvp.Key,
        kvp => kvp.Value.ConnectionString
      ) ?? new Dictionary<string, string>();
  }

  public string GetConnectionString(string tenantId) {
    if (_tenantConnectionStrings.TryGetValue(tenantId, out var connectionString)) {
      return connectionString;
    }

    throw new InvalidOperationException($"Tenant {tenantId} not found");
  }
}

public record TenantConfig(
  string ConnectionString,
  string? CustomDomain,
  Dictionary<string, string>? Settings
);
```

**appsettings.json**:

```json
{
  "Tenants": {
    "tenant-a": {
      "ConnectionString": "Host=localhost;Database=tenant_a;Username=postgres;Password=postgres",
      "CustomDomain": "tenant-a.example.com",
      "Settings": {
        "MaxUsers": "100",
        "Features": "analytics,exports"
      }
    },
    "tenant-b": {
      "ConnectionString": "Host=localhost;Database=tenant_b;Username=postgres;Password=postgres",
      "CustomDomain": "tenant-b.example.com",
      "Settings": {
        "MaxUsers": "500",
        "Features": "analytics,exports,api-access"
      }
    }
  }
}
```

### Tenant-Aware Database Connection

**Program.cs**:

```csharp
builder.Services.AddScoped<NpgsqlConnection>(sp => {
  var tenantId = TenantContext.CurrentTenantId
    ?? throw new InvalidOperationException("Tenant context not set");

  var resolver = sp.GetRequiredService<ITenantDatabaseResolver>();
  var connectionString = resolver.GetConnectionString(tenantId);

  return new NpgsqlConnection(connectionString);
});

builder.Services.AddSingleton<ITenantDatabaseResolver, TenantDatabaseResolver>();
```

---

## Tenant-Aware Receptors

**CreateOrderReceptor.cs**:

```csharp
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
  private readonly NpgsqlConnection _db;  // Tenant-specific database
  private readonly IMessageContext _context;
  private readonly ILogger<CreateOrderReceptor> _logger;

  public async Task<OrderCreated> HandleAsync(
    CreateOrder command,
    CancellationToken ct = default
  ) {
    var tenantId = TenantContext.CurrentTenantId
      ?? throw new InvalidOperationException("Tenant context not set");

    _logger.LogInformation(
      "Creating order for tenant {TenantId}, customer {CustomerId}",
      tenantId,
      command.CustomerId
    );

    // Database operations automatically scoped to tenant
    await using var tx = await _db.BeginTransactionAsync(ct);

    try {
      // Insert order (tenant-specific table)
      await _db.ExecuteAsync(
        """
        INSERT INTO orders (order_id, customer_id, total_amount, tenant_id, created_at)
        VALUES (@OrderId, @CustomerId, @TotalAmount, @TenantId, NOW())
        """,
        new {
          OrderId = Guid.NewGuid().ToString("N"),
          CustomerId = command.CustomerId,
          TotalAmount = command.Items.Sum(i => i.Quantity * i.UnitPrice),
          TenantId = tenantId
        },
        transaction: tx
      );

      // ... rest of implementation

      await tx.CommitAsync(ct);
      return @event;
    } catch {
      await tx.RollbackAsync(ct);
      throw;
    }
  }
}
```

---

## Message Context Propagation

**Automatic tenant ID propagation in events**:

**TenantAwareMessageContext.cs**:

```csharp
public class TenantAwareMessageContext : IMessageContext {
  private readonly IMessageContext _inner;

  public TenantAwareMessageContext(IMessageContext inner) {
    _inner = inner;
  }

  public Guid MessageId => _inner.MessageId;
  public Guid? CorrelationId => _inner.CorrelationId;
  public Guid? CausationId => _inner.CausationId;
  public string? UserId => _inner.UserId;

  public IDictionary<string, string> Metadata {
    get {
      var metadata = new Dictionary<string, string>(_inner.Metadata);

      // Auto-inject tenant ID
      if (TenantContext.CurrentTenantId != null) {
        metadata["tenant_id"] = TenantContext.CurrentTenantId;
      }

      return metadata;
    }
  }
}
```

**Program.cs**:

```csharp
builder.Services.Decorate<IMessageContext, TenantAwareMessageContext>();
```

**Result**: All events automatically include `tenant_id` in metadata.

---

## Cross-Tenant Analytics

### Shared Analytics Database

**AnalyticsDbConnection.cs**:

```csharp
public class AnalyticsDbConnectionFactory {
  private readonly string _connectionString;

  public AnalyticsDbConnectionFactory(IConfiguration configuration) {
    _connectionString = configuration.GetConnectionString("AnalyticsDb")
      ?? throw new InvalidOperationException("AnalyticsDb connection string not configured");
  }

  public NpgsqlConnection CreateConnection() {
    return new NpgsqlConnection(_connectionString);
  }
}
```

### Cross-Tenant Analytics Perspective

**CrossTenantSalesPerspective.cs**:

```csharp
public class CrossTenantSalesPerspective : IPerspectiveOf<OrderCreated> {
  private readonly AnalyticsDbConnectionFactory _analyticsDbFactory;
  private readonly ILogger<CrossTenantSalesPerspective> _logger;

  public CrossTenantSalesPerspective(
    AnalyticsDbConnectionFactory analyticsDbFactory,
    ILogger<CrossTenantSalesPerspective> logger
  ) {
    _analyticsDbFactory = analyticsDbFactory;
    _logger = logger;
  }

  public async Task HandleAsync(
    OrderCreated @event,
    CancellationToken ct = default
  ) {
    // Extract tenant ID from event metadata
    var tenantId = @event.Metadata.GetValueOrDefault("tenant_id")
      ?? throw new InvalidOperationException("Tenant ID not found in event metadata");

    using var analyticsDb = _analyticsDbFactory.CreateConnection();
    await analyticsDb.OpenAsync(ct);

    // Aggregate across all tenants in shared analytics database
    await analyticsDb.ExecuteAsync(
      """
      INSERT INTO cross_tenant_daily_sales (date, tenant_id, total_orders, total_revenue)
      VALUES (CURRENT_DATE, @TenantId, 1, @TotalAmount)
      ON CONFLICT (date, tenant_id) DO UPDATE SET
        total_orders = cross_tenant_daily_sales.total_orders + 1,
        total_revenue = cross_tenant_daily_sales.total_revenue + @TotalAmount
      """,
      new {
        TenantId = tenantId,
        TotalAmount = @event.TotalAmount
      }
    );

    _logger.LogInformation(
      "Cross-tenant analytics updated for tenant {TenantId}: +${Amount}",
      tenantId,
      @event.TotalAmount
    );
  }
}
```

**Schema (shared analytics database)**:

```sql
CREATE TABLE cross_tenant_daily_sales (
  date DATE NOT NULL,
  tenant_id TEXT NOT NULL,
  total_orders BIGINT NOT NULL DEFAULT 0,
  total_revenue NUMERIC(12, 2) NOT NULL DEFAULT 0,
  PRIMARY KEY (date, tenant_id)
);

CREATE INDEX idx_cross_tenant_sales_date ON cross_tenant_daily_sales(date DESC);
CREATE INDEX idx_cross_tenant_sales_tenant ON cross_tenant_daily_sales(tenant_id);
```

---

## Tenant Onboarding

**TenantProvisioningService.cs**:

```csharp
public class TenantProvisioningService {
  private readonly NpgsqlConnection _masterDb;
  private readonly ILogger<TenantProvisioningService> _logger;

  public async Task ProvisionTenantAsync(
    string tenantId,
    string adminEmail,
    string companyName,
    CancellationToken ct = default
  ) {
    _logger.LogInformation("Provisioning tenant {TenantId}", tenantId);

    // 1. Create tenant database
    await _masterDb.ExecuteAsync(
      $"CREATE DATABASE tenant_{tenantId}"
    );

    // 2. Run migrations on new database
    var tenantConnectionString = $"Host=localhost;Database=tenant_{tenantId};Username=postgres;Password=postgres";
    using var tenantDb = new NpgsqlConnection(tenantConnectionString);
    await tenantDb.OpenAsync(ct);

    await ApplyMigrationsAsync(tenantDb, ct);

    // 3. Create admin user
    await tenantDb.ExecuteAsync(
      """
      INSERT INTO users (user_id, email, role, tenant_id, created_at)
      VALUES (@UserId, @Email, 'admin', @TenantId, NOW())
      """,
      new {
        UserId = Guid.NewGuid().ToString("N"),
        Email = adminEmail,
        TenantId = tenantId
      }
    );

    // 4. Create default settings
    await tenantDb.ExecuteAsync(
      """
      INSERT INTO tenant_settings (tenant_id, company_name, max_users, features, created_at)
      VALUES (@TenantId, @CompanyName, 100, 'basic', NOW())
      """,
      new {
        TenantId = tenantId,
        CompanyName = companyName
      }
    );

    _logger.LogInformation("Tenant {TenantId} provisioned successfully", tenantId);
  }

  private async Task ApplyMigrationsAsync(NpgsqlConnection db, CancellationToken ct) {
    var migrationFiles = Directory.GetFiles("Migrations", "*.sql").OrderBy(f => f);
    foreach (var file in migrationFiles) {
      var sql = await File.ReadAllTextAsync(file, ct);
      await db.ExecuteAsync(sql);
    }
  }
}
```

---

## Tenant-Specific Customizations

**Feature Flags per Tenant**:

```csharp
public class TenantFeatureService {
  private readonly ITenantDatabaseResolver _resolver;

  public async Task<bool> IsFeatureEnabledAsync(string feature) {
    var tenantId = TenantContext.CurrentTenantId
      ?? throw new InvalidOperationException("Tenant context not set");

    var connectionString = _resolver.GetConnectionString(tenantId);
    using var db = new NpgsqlConnection(connectionString);
    await db.OpenAsync();

    var features = await db.QuerySingleOrDefaultAsync<string>(
      "SELECT features FROM tenant_settings WHERE tenant_id = @TenantId",
      new { TenantId = tenantId }
    );

    return features?.Contains(feature) ?? false;
  }
}
```

**Usage**:

```csharp
public async Task<OrderCreated> HandleAsync(CreateOrder command, CancellationToken ct) {
  // Check if tenant has analytics feature
  var hasAnalytics = await _featureService.IsFeatureEnabledAsync("analytics");

  if (hasAnalytics) {
    // Publish additional analytics events
    await PublishAnalyticsEventAsync(@event, ct);
  }

  return @event;
}
```

---

## Key Takeaways

✅ **Database Per Tenant** - Strongest isolation, independent scaling
✅ **Tenant Context Propagation** - Automatic tenant ID in all messages
✅ **Cross-Tenant Analytics** - Shared database for platform-wide metrics
✅ **Tenant Onboarding** - Automated provisioning with migrations
✅ **Feature Flags** - Tenant-specific customizations

---

## Alternative Patterns

### Shared Database with Row-Level Security

```sql
-- PostgreSQL Row-Level Security
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON orders
  USING (tenant_id = current_setting('app.current_tenant')::text);

-- Set tenant before query
SET app.current_tenant = 'tenant-a';
SELECT * FROM orders;  -- Only returns tenant-a orders
```

**Pros**: Single database, simpler infrastructure
**Cons**: Weaker isolation, shared resources

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
