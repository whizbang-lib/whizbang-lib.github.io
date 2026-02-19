# GraphQL Scoping

Whizbang's scope middleware provides automatic multi-tenancy and security filtering for GraphQL queries, ensuring users only see data they're authorized to access.

## Overview

The `WhizbangScopeMiddleware` extracts scope information from HTTP requests (JWT claims and headers) and makes it available to lens queries for automatic filtering.

```
HTTP Request
    │
    ├── JWT Claims (tenant_id, sub, groups, ...)
    ├── Headers (X-Tenant-Id, X-User-Id, ...)
    │
    ▼
WhizbangScopeMiddleware
    │
    ├── Extracts scope values
    ├── Creates IScopeContext
    │
    ▼
IScopeContextAccessor.Current
    │
    ▼
Lens Query (automatic filtering)
```

## Setup

### 1. Register Services

```csharp
builder.Services.AddWhizbangScope();
```

### 2. Add Middleware

```csharp
app.UseAuthentication();
app.UseWhizbangScope();  // After auth
app.MapGraphQL();
```

## Configuration

### Default Claim/Header Mappings

| Scope Value | Claim Type | Header Name |
|-------------|-----------|-------------|
| TenantId | `tenant_id` | `X-Tenant-Id` |
| UserId | `ClaimTypes.NameIdentifier` | `X-User-Id` |
| OrganizationId | `org_id` | `X-Organization-Id` |
| CustomerId | `customer_id` | `X-Customer-Id` |
| Roles | `ClaimTypes.Role` | - |
| Groups | `groups` | - |

### Custom Configuration

```csharp
builder.Services.AddWhizbangScope(options => {
    // Custom claim types
    options.TenantIdClaimType = "https://myapp.com/tenant_id";
    options.UserIdClaimType = "sub";
    options.GroupsClaimType = "https://myapp.com/groups";

    // Custom header names
    options.TenantIdHeaderName = "X-My-Tenant";

    // Extension mappings
    options.ExtensionClaimMappings["region"] = "Region";
    options.ExtensionClaimMappings["department"] = "Department";
});
```

## How Scoping Works

### 1. Scope Extraction

The middleware extracts scope from the request:

```csharp
// JWT claims take priority over headers
var tenantId = context.User?.FindFirst("tenant_id")?.Value
    ?? context.Request.Headers["X-Tenant-Id"];
```

### 2. Context Population

The scope context is populated with:

```csharp
scopeContextAccessor.Current = new RequestScopeContext {
    Scope = new PerspectiveScope {
        TenantId = "tenant-123",
        UserId = "user-456",
        OrganizationId = "org-789"
    },
    Roles = ["Admin", "User"],
    SecurityPrincipals = [
        SecurityPrincipalId.User("user-456"),
        SecurityPrincipalId.Group("sales-team")
    ],
    Claims = { ... }
};
```

### 3. Lens Filtering

Your lens implementation uses the scope context:

```csharp
public class ScopedOrderLens : IOrderLens {
    private readonly IScopeContextAccessor _scopeContextAccessor;
    private readonly DbContext _db;

    public IQueryable<PerspectiveRow<OrderReadModel>> Query {
        get {
            var context = _scopeContextAccessor.Current;
            var query = _db.Orders.AsQueryable();

            // Filter by tenant
            if (!string.IsNullOrEmpty(context?.Scope.TenantId)) {
                query = query.Where(o => o.Scope.TenantId == context.Scope.TenantId);
            }

            // Filter by allowed principals (array overlap)
            if (context?.SecurityPrincipals.Count > 0) {
                query = query.Where(o =>
                    o.Scope.AllowedPrincipals == null ||
                    o.Scope.AllowedPrincipals.Any(p =>
                        context.SecurityPrincipals.Contains(p)));
            }

            return query;
        }
    }
}
```

## Security Principal Filtering

### Row-Level Security

Each `PerspectiveRow` can have `AllowedPrincipals`:

```csharp
var order = new PerspectiveRow<OrderReadModel> {
    Data = orderData,
    Scope = new PerspectiveScope {
        TenantId = "tenant-123",
        AllowedPrincipals = [
            SecurityPrincipalId.User("user-456"),
            SecurityPrincipalId.Group("sales-team")
        ]
    }
};
```

### Query Filtering

The lens filters using "array overlap":

```sql
-- PostgreSQL example
WHERE scope->'AllowedPrincipals' ?| ARRAY['user:user-456', 'group:sales-team']
```

## Accessing Scope in Resolvers

### Via IScopeContextAccessor

```csharp
public class Query {
    public CurrentUser GetCurrentUser([Service] IScopeContextAccessor accessor) {
        var context = accessor.Current;
        return new CurrentUser {
            UserId = context?.Scope.UserId,
            TenantId = context?.Scope.TenantId,
            Roles = context?.Roles.ToList() ?? []
        };
    }
}
```

### Exposing Current Scope

```graphql
type Query {
  currentScope: ScopeInfo!
  orders(...): OrdersConnection
}

type ScopeInfo {
  tenantId: String
  userId: String
  organizationId: String
  roles: [String!]!
}
```

## Multi-Tenancy Patterns

### Tenant-Per-Row

Each row has a `TenantId` in its scope:

```csharp
[GraphQLLens(QueryName = "orders")]
public interface IOrderLens : ILensQuery<OrderReadModel> { }

// Lens filters by TenantId from context
```

### Tenant-Per-Database

Different databases per tenant (configured at startup):

```csharp
builder.Services.AddScoped<IOrderLens>(sp => {
    var context = sp.GetRequiredService<IScopeContextAccessor>().Current;
    var tenantId = context?.Scope.TenantId ?? "default";
    var connectionString = GetTenantConnectionString(tenantId);
    return new EFCoreOrderLens(connectionString);
});
```

## Permission Checks

### In Resolvers

```csharp
public class Query {
    public async Task<Order?> GetOrder(
        Guid id,
        [Service] IOrderLens lens,
        [Service] IScopeContextAccessor accessor) {

        var context = accessor.Current;

        // Check permission
        if (!context?.HasPermission(Permission.Read("orders")) ?? true) {
            throw new UnauthorizedAccessException();
        }

        return await lens.GetByIdAsync(id);
    }
}
```

### With Attributes

```csharp
[RequirePermission("orders:read")]
public IQueryable<PerspectiveRow<OrderReadModel>> GetOrders(
    [Service] IOrderLens lens) {
    return lens.Query;
}
```

## Testing Scoped Queries

```csharp
[Test]
public async Task Query_FiltersByTenantAsync() {
    // Arrange
    var scopeAccessor = new TestScopeContextAccessor();
    scopeAccessor.Current = new TestScopeContext {
        Scope = new PerspectiveScope { TenantId = "tenant-a" }
    };

    var lens = new ScopedOrderLens(scopeAccessor, db);

    // Add test data
    db.Orders.Add(CreateOrder("tenant-a"));
    db.Orders.Add(CreateOrder("tenant-b"));
    await db.SaveChangesAsync();

    // Act
    var results = await lens.Query.ToListAsync();

    // Assert
    Assert.That(results).AllSatisfy(r =>
        Assert.That(r.Scope.TenantId).IsEqualTo("tenant-a"));
}
```

## Best Practices

1. **Always filter by scope** - Never bypass scope filtering, even for admin queries
2. **Use row-level security** - Combine tenant filtering with principal filtering
3. **Validate scope values** - Don't trust scope values for authorization decisions alone
4. **Log scope context** - Include scope in audit logs for troubleshooting
5. **Test with multiple tenants** - Ensure queries don't leak data across tenants

## Related Documentation

- [Setup](setup.md) - Initial configuration
- [Filtering](filtering.md) - Query filtering
- [Security](/docs/v0.1.0/core-concepts/security) - Security principals and permissions
