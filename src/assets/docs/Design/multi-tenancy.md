---
title: Multi-Tenancy
category: Architecture & Design
order: 8
tags: multi-tenancy, tenant-isolation, partitioning, data-isolation
---

# Multi-Tenancy

Whizbang provides comprehensive multi-tenancy support with flexible tenant isolation strategies, from single database with row-level security to complete database separation.

## Tenant Isolation Strategies

### Single Database with Tenant ID

**Row-level tenant isolation** using tenant ID columns:

```sql
-- Events table with tenant isolation
CREATE TABLE events (
    event_id BIGSERIAL PRIMARY KEY,
    stream_id VARCHAR(255) NOT NULL,
    stream_version INT NOT NULL,
    event_type VARCHAR(255) NOT NULL,
    event_data JSONB NOT NULL,
    metadata JSONB,
    tenant_id UUID NOT NULL,  -- Tenant isolation
    created_at TIMESTAMPTZ NOT NULL,
    UNIQUE(tenant_id, stream_id, stream_version)
);

-- Projections table with tenant isolation
CREATE TABLE projections (
    projection_name VARCHAR(255) NOT NULL,
    document_id VARCHAR(255) NOT NULL,
    document JSONB NOT NULL,
    tenant_id UUID NOT NULL,  -- Tenant isolation
    version BIGINT NOT NULL,
    last_updated TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (projection_name, document_id, tenant_id)
);

-- Row-level security policies
CREATE POLICY tenant_isolation_events ON events
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

CREATE POLICY tenant_isolation_projections ON projections  
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### Multiple Databases

**Complete database separation** per tenant:

```csharp
services.AddWhizbang(options => {
    options.MultiTenancy(tenancy => {
        tenancy.Strategy = TenancyStrategy.SeparateDatabases;
        tenancy.DatabaseProvider = (tenantId) => {
            return $"Host=db-server;Database=tenant_{tenantId};Username=app;Password=secret";
        };
        
        // Database creation for new tenants
        tenancy.AutoCreateDatabases = true;
        tenancy.DatabaseTemplate = "tenant_template";
    });
});
```

### Same Table with Partitioning

**Table partitioning** by tenant for performance:

```sql
-- Partitioned events table
CREATE TABLE events (
    event_id BIGSERIAL,
    stream_id VARCHAR(255) NOT NULL,
    stream_version INT NOT NULL,
    event_type VARCHAR(255) NOT NULL,
    event_data JSONB NOT NULL,
    metadata JSONB,
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
) PARTITION BY HASH (tenant_id);

-- Create partitions
CREATE TABLE events_p0 PARTITION OF events FOR VALUES WITH (MODULUS 4, REMAINDER 0);
CREATE TABLE events_p1 PARTITION OF events FOR VALUES WITH (MODULUS 4, REMAINDER 1);
CREATE TABLE events_p2 PARTITION OF events FOR VALUES WITH (MODULUS 4, REMAINDER 2);
CREATE TABLE events_p3 PARTITION OF events FOR VALUES WITH (MODULUS 4, REMAINDER 3);
```

## Tenant ID Definition

### Default Tenant ID Field

**Standard GUID-based tenant identification**:

```csharp
// Default: Look for TenantId property
public class Order : Aggregate {
    public Guid Id { get; private set; }
    public Guid TenantId { get; private set; } // Automatically detected
    public decimal Total { get; private set; }
    
    public Order(Guid tenantId, Guid id) {
        TenantId = tenantId;
        Id = id;
    }
}

// Strong-typed tenant ID
public record TenantId(Guid Value) : StrongTypeId<Guid>(Value);

public class Order : Aggregate {
    public Guid Id { get; private set; }
    public TenantId TenantId { get; private set; } // Strong type detected
    public decimal Total { get; private set; }
}
```

### Composite Tenant ID

**Multi-field tenant identification**:

```csharp
services.AddWhizbang(options => {
    options.MultiTenancy(tenancy => {
        tenancy.TenantIdComposition<Order>(composition => {
            composition.FromFields(order => new { 
                order.OrganizationId, 
                order.DivisionId 
            });
        });
        
        tenancy.TenantIdComposition<Customer>(composition => {
            composition.FromFields(customer => customer.CompanyId);
        });
    });
});

// Usage in aggregates
public class Order : Aggregate {
    public Guid Id { get; private set; }
    public Guid OrganizationId { get; private set; } // Part of tenant ID
    public Guid DivisionId { get; private set; }     // Part of tenant ID
    public Guid CustomerId { get; private set; }
}
```

### Custom Tenant Resolution

**Complex tenant identification logic**:

```csharp
services.AddWhizbang(options => {
    options.MultiTenancy(tenancy => {
        tenancy.TenantResolver<Order>(order => {
            // Custom logic to determine tenant
            if (order.OrganizationId == SpecialOrgId) {
                return $"special-{order.DivisionId}";
            }
            return order.OrganizationId.ToString();
        });
    });
});
```

## Tenant Context Management

### Tenant Context Propagation

```csharp
public interface ITenantContext {
    string? CurrentTenantId { get; }
    void SetTenant(string tenantId);
    void ClearTenant();
    bool HasTenant { get; }
}

// ASP.NET Core middleware
public class TenantContextMiddleware {
    public async Task InvokeAsync(HttpContext context, RequestDelegate next) {
        var tenantId = ExtractTenantId(context);
        
        if (tenantId != null) {
            _tenantContext.SetTenant(tenantId);
        }
        
        try {
            await next(context);
        } finally {
            _tenantContext.ClearTenant();
        }
    }
    
    private string? ExtractTenantId(HttpContext context) {
        // From header
        if (context.Request.Headers.TryGetValue("X-Tenant-ID", out var headerValue)) {
            return headerValue;
        }
        
        // From subdomain
        var host = context.Request.Host.Host;
        if (host.Contains('.')) {
            var subdomain = host.Split('.')[0];
            return subdomain != "www" ? subdomain : null;
        }
        
        // From route
        if (context.Request.RouteValues.TryGetValue("tenantId", out var routeValue)) {
            return routeValue?.ToString();
        }
        
        return null;
    }
}
```

### Tenant-Aware Command/Event Handling

```csharp
public class PlaceOrderHandler : ICommandHandler<PlaceOrder> {
    private readonly ITenantContext _tenantContext;
    private readonly IOrderRepository _repository;
    
    public async Task<OrderPlaced> Handle(PlaceOrder command) {
        var tenantId = _tenantContext.CurrentTenantId 
            ?? throw new InvalidOperationException("No tenant context");
        
        var order = new Order(
            tenantId: Guid.Parse(tenantId),
            orderId: command.OrderId,
            customerId: command.CustomerId,
            items: command.Items
        );
        
        await _repository.Save(order);
        
        return new OrderPlaced(
            command.OrderId,
            command.CustomerId,
            DateTimeOffset.UtcNow
        ) {
            TenantId = tenantId // Automatically added to event metadata
        };
    }
}
```

## Tenant-Aware Projections

### Projection-Level Isolation

```csharp
services.AddProjection<OrderSummaryProjection>(options => {
    options.TenantIsolation(isolation => {
        isolation.Strategy = ProjectionTenantStrategy.TenantSpecific;
        isolation.AllowCrossTenantQueries = false;
    });
});

public class OrderSummaryProjection : IProjectionHandler<OrderPlaced> {
    public async Task Handle(OrderPlaced @event, ProjectionContext context) {
        var tenantId = context.TenantId; // Automatically extracted
        
        var summary = new OrderSummary {
            OrderId = @event.OrderId,
            TenantId = tenantId,
            Total = @event.Total
        };
        
        // Stored with tenant isolation
        await context.Store(@event.OrderId.ToString(), summary);
    }
}
```

### Cross-Tenant Projections

**Global projections that aggregate across tenants**:

```csharp
services.AddProjection<GlobalAnalyticsProjection>(options => {
    options.TenantIsolation(isolation => {
        isolation.Strategy = ProjectionTenantStrategy.CrossTenant;
        isolation.RequireExplicitTenantAccess = true;
    });
});

public class GlobalAnalyticsProjection : IProjectionHandler<OrderPlaced> {
    public async Task Handle(OrderPlaced @event, ProjectionContext context) {
        // Access to all tenant data for analytics
        var analytics = await context.LoadGlobal<GlobalAnalytics>("summary");
        
        analytics ??= new GlobalAnalytics();
        analytics.TotalOrders++;
        analytics.TotalRevenue += @event.Total;
        analytics.OrdersByTenant[context.TenantId] = 
            analytics.OrdersByTenant.GetValueOrDefault(context.TenantId) + 1;
        
        await context.StoreGlobal("summary", analytics);
    }
}
```

## Driver Support for Multi-Tenancy

### PostgreSQL Driver

```csharp
public class PostgresTenantDriver : IEventStoreDriver {
    public async Task<IEnumerable<Event>> ReadEvents(string streamId, string? tenantId = null) {
        var sql = tenantId != null 
            ? "SELECT * FROM events WHERE stream_id = @streamId AND tenant_id = @tenantId ORDER BY stream_version"
            : "SELECT * FROM events WHERE stream_id = @streamId ORDER BY stream_version";
            
        return await _connection.QueryAsync<Event>(sql, new { streamId, tenantId });
    }
    
    public async Task AppendEvents(string streamId, IEnumerable<Event> events, string? tenantId = null) {
        if (tenantId == null) {
            throw new InvalidOperationException("Tenant ID required for event storage");
        }
        
        foreach (var @event in events) {
            @event.TenantId = tenantId;
        }
        
        await _connection.ExecuteAsync(
            "INSERT INTO events (stream_id, stream_version, event_type, event_data, tenant_id, created_at) " +
            "VALUES (@StreamId, @StreamVersion, @EventType, @EventData, @TenantId, @CreatedAt)",
            events
        );
    }
}
```

### Abstract Driver Interface

```csharp
public interface ITenantAwareDriver {
    Task<T> Load<T>(string id, string? tenantId = null);
    Task Save<T>(T entity, string? tenantId = null);
    Task<IEnumerable<T>> Query<T>(Expression<Func<T, bool>> predicate, string? tenantId = null);
    
    // Cross-tenant operations (require special permissions)
    Task<IEnumerable<T>> QueryAllTenants<T>(Expression<Func<T, bool>> predicate);
    Task<Dictionary<string, IEnumerable<T>>> QueryByTenant<T>(Expression<Func<T, bool>> predicate);
}
```

## Security and Authorization

### Tenant-Based Authorization

```csharp
services.AddWhizbang(options => {
    options.Authorization(auth => {
        auth.RequireTenantContext = true;
        auth.EnforceTenantIsolation = true;
        
        auth.AddPolicy("TenantAdmin", policy => {
            policy.RequireClaim("tenant_id");
            policy.RequireClaim("role", "admin");
        });
        
        auth.AddPolicy("CrossTenantRead", policy => {
            policy.RequireClaim("permission", "cross_tenant_read");
        });
    });
});

[Authorize("TenantAdmin")]
public class OrderController : ControllerBase {
    [HttpGet]
    public async Task<IActionResult> GetOrders() {
        // Automatically filtered by tenant context
        var orders = await _orderQuery.GetOrdersForCurrentTenant();
        return Ok(orders);
    }
    
    [HttpGet("all-tenants")]
    [Authorize("CrossTenantRead")]
    public async Task<IActionResult> GetOrdersAllTenants() {
        // Requires special permission
        var orders = await _orderQuery.GetOrdersAllTenants();
        return Ok(orders);
    }
}
```

### Row-Level Security Integration

```csharp
services.AddWhizbang(options => {
    options.UsePostgres(connectionString, postgres => {
        postgres.EnableRowLevelSecurity = true;
        postgres.TenantContextVariable = "app.current_tenant_id";
    });
});

// Automatically sets tenant context for all database operations
public class PostgresTenantConnectionFactory : IDbConnectionFactory {
    public async Task<IDbConnection> CreateConnection() {
        var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        
        var tenantId = _tenantContext.CurrentTenantId;
        if (tenantId != null) {
            await connection.ExecuteAsync(
                "SET app.current_tenant_id = @tenantId", 
                new { tenantId }
            );
        }
        
        return connection;
    }
}
```

## Configuration Examples

### Comprehensive Multi-Tenancy Setup

```csharp
services.AddWhizbang(options => {
    options.MultiTenancy(tenancy => {
        // Tenant identification
        tenancy.TenantIdField = "TenantId";
        tenancy.TenantIdType = typeof(Guid);
        
        // Storage strategy
        tenancy.Strategy = TenancyStrategy.SingleDatabaseWithIsolation;
        tenancy.EnableRowLevelSecurity = true;
        
        // Tenant context
        tenancy.TenantResolver = (httpContext) => {
            return httpContext.Request.Headers["X-Tenant-ID"].FirstOrDefault();
        };
        
        // Cross-tenant operations
        tenancy.AllowCrossTenantOperations = false;
        tenancy.RequireExplicitCrossTenantPermission = true;
        
        // Database partitioning
        tenancy.UsePartitioning = true;
        tenancy.PartitionCount = 16;
        
        // Tenant lifecycle
        tenancy.AutoCreateTenantData = true;
        tenancy.TenantDataTemplate = "default_tenant_template";
    });
    
    // Tenant-aware projections
    options.Projections(projections => {
        projections.DefaultTenantStrategy = ProjectionTenantStrategy.TenantSpecific;
        projections.AllowGlobalProjections = true;
        projections.RequireExplicitCrossTenantAccess = true;
    });
});
```

### Tenant Onboarding Workflow

```csharp
public class TenantOnboardingService {
    public async Task OnboardTenant(string tenantId, TenantConfiguration config) {
        // Create tenant-specific database resources
        await _tenantManager.CreateTenantResources(tenantId);
        
        // Initialize tenant data
        await _tenantManager.InitializeTenantData(tenantId, config);
        
        // Set up tenant-specific projections
        await _projectionManager.CreateTenantProjections(tenantId);
        
        // Emit tenant onboarded event
        await _eventPublisher.PublishAsync(new TenantOnboarded(
            tenantId,
            config,
            DateTimeOffset.UtcNow
        ));
    }
}
```

## Best Practices

### Tenant Design Guidelines

1. **Design for isolation** - Assume tenants can't see each other's data
2. **Validate tenant context** - Always check tenant context in handlers
3. **Use consistent tenant IDs** - Keep tenant identification simple
4. **Plan for scale** - Design partitioning strategy from the start
5. **Test cross-tenant security** - Verify isolation works correctly

### Performance Considerations

1. **Partition by tenant** - Use database partitioning for large tables
2. **Index tenant columns** - Include tenant_id in all indexes
3. **Connection pooling** - Consider tenant-specific connection pools
4. **Cache tenant data** - Cache tenant configuration and permissions
5. **Monitor per-tenant usage** - Track resource usage by tenant

### Security Best Practices

1. **Defense in depth** - Use multiple layers of tenant isolation
2. **Principle of least privilege** - Only grant necessary cross-tenant permissions
3. **Audit tenant access** - Log all cross-tenant operations
4. **Validate tenant ownership** - Check tenant context in all operations
5. **Regular security reviews** - Audit tenant isolation regularly

---

## Related Documentation

- [**Event Store & Projections**](./event-store-projections.md) - Storage architecture with tenant isolation
- [**Domain Ownership**](./domain-ownership.md) - How domain ownership works with tenants
- [**Performance Optimization**](./performance-optimization.md) - Scaling multi-tenant systems