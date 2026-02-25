# GraphQL Setup

This guide covers installation and configuration of Whizbang's HotChocolate GraphQL integration.

## Installation

```bash
dotnet add package Whizbang.Transports.HotChocolate
```

## Basic Configuration

### Minimal Setup

```csharp
// Program.cs
var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddGraphQLServer()
    .AddWhizbangLenses()
    .AddQueryType<Query>();

var app = builder.Build();
app.MapGraphQL();
app.Run();
```

### With Scope Middleware

For multi-tenancy and security filtering:

```csharp
var builder = WebApplication.CreateBuilder(args);

// Add services
builder.Services.AddWhizbangScope();
builder.Services
    .AddGraphQLServer()
    .AddWhizbangLenses()
    .AddQueryType<Query>();

var app = builder.Build();

// Middleware order matters
app.UseAuthentication();
app.UseWhizbangScope();  // After auth, before GraphQL
app.MapGraphQL();

app.Run();
```

## Configuration Options

### WhizbangGraphQLOptions

Configure default behavior for all lenses:

```csharp
builder.Services
    .AddGraphQLServer()
    .AddWhizbangLenses(options => {
        options.DefaultScope = GraphQLLensScope.Data | GraphQLLensScope.SystemFields;
        options.DefaultPageSize = 25;
        options.MaxPageSize = 200;
    });
```

| Option | Default | Description |
|--------|---------|-------------|
| `DefaultScope` | `DataOnly` | Fields exposed by default |
| `DefaultPageSize` | `10` | Default page size for paging |
| `MaxPageSize` | `100` | Maximum allowed page size |

### WhizbangScopeOptions

Configure scope extraction from HTTP context:

```csharp
builder.Services.AddWhizbangScope(options => {
    // Claim types
    options.TenantIdClaimType = "tenant_id";
    options.UserIdClaimType = ClaimTypes.NameIdentifier;
    options.OrganizationIdClaimType = "org_id";
    options.CustomerIdClaimType = "customer_id";

    // Header names (fallback if claim not present)
    options.TenantIdHeaderName = "X-Tenant-Id";
    options.UserIdHeaderName = "X-User-Id";

    // Custom extensions
    options.ExtensionClaimMappings["region"] = "Region";
    options.ExtensionHeaderMappings["X-Region"] = "Region";
});
```

| Option | Default | Description |
|--------|---------|-------------|
| `TenantIdClaimType` | `"tenant_id"` | JWT claim for tenant ID |
| `TenantIdHeaderName` | `"X-Tenant-Id"` | HTTP header for tenant ID |
| `UserIdClaimType` | `ClaimTypes.NameIdentifier` | JWT claim for user ID |
| `RolesClaimType` | `ClaimTypes.Role` | JWT claim for roles |
| `GroupsClaimType` | `"groups"` | JWT claim for group memberships |

## Query Type Setup

Define your query type with lens resolvers:

```csharp
public class Query {
    [UsePaging(DefaultPageSize = 10, MaxPageSize = 100, IncludeTotalCount = true)]
    [UseProjection]
    [UseFiltering]
    [UseSorting]
    public IQueryable<PerspectiveRow<OrderReadModel>> GetOrders(
        [Service] IOrderLens lens) {
        return lens.Query;
    }

    [UsePaging]
    [UseFiltering]
    [UseSorting]
    public IQueryable<PerspectiveRow<ProductReadModel>> GetProducts(
        [Service] IProductLens lens) {
        return lens.Query;
    }
}
```

## Service Registration

Register your lens implementations:

```csharp
// If using EF Core
builder.Services.AddScoped<IOrderLens, EFCoreOrderLens>();
builder.Services.AddScoped<IProductLens, EFCoreProductLens>();

// Or use the generated registration from source generators
builder.Services.AddWhizbangLensQueries();
```

## What Gets Registered

`AddWhizbangLenses()` registers:

- `WhizbangFilterConvention` - Custom filtering for `PerspectiveRow<T>`
- `WhizbangSortConvention` - Custom sorting for nested data
- Default projection convention
- `WhizbangGraphQLOptions` singleton

`AddWhizbangScope()` registers:

- `IScopeContextAccessor` - AsyncLocal-based scope access
- `WhizbangScopeOptions` singleton (if configured)

## Next Steps

- [Lens Integration](lens-integration.md) - Configure `[GraphQLLens]` attributes
- [Filtering](filtering.md) - Query filtering examples
- [Scoping](scoping.md) - Multi-tenancy configuration
