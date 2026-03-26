---
title: GraphQL Setup
version: 1.0.0
category: GraphQL
order: 2
description: >-
  Installation and configuration guide for Whizbang's HotChocolate GraphQL
  integration. Covers package installation, minimal setup, scope middleware
  configuration, and advanced GraphQL options.
tags: 'graphql, setup, installation, configuration, hotchocolate, asp-net'
codeReferences:
  - src/Whizbang.Transports.HotChocolate/Extensions/HotChocolateWhizbangExtensions.cs
  - src/Whizbang.Transports.HotChocolate/Configuration/WhizbangGraphQLOptions.cs
---

# GraphQL Setup

This guide covers installation and configuration of Whizbang's HotChocolate GraphQL integration.

## Installation

```bash{title="Installation" description="Demonstrates installation" category="API" difficulty="BEGINNER" tags=["Apis", "Graphql", "Installation"]}
dotnet add package Whizbang.Transports.HotChocolate
```

## Basic Configuration

### Minimal Setup

```csharp{title="Minimal Setup" description="Demonstrates minimal Setup" category="API" difficulty="BEGINNER" tags=["Apis", "Graphql", "Minimal", "Setup"]}
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

```csharp{title="With Scope Middleware" description="For multi-tenancy and security filtering:" category="API" difficulty="INTERMEDIATE" tags=["Apis", "Graphql", "Scope", "Middleware"]}
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

```csharp{title="WhizbangGraphQLOptions" description="Configure default behavior for all lenses:" category="API" difficulty="BEGINNER" tags=["Apis", "Graphql", "WhizbangGraphQLOptions"]}
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

```csharp{title="WhizbangScopeOptions" description="Configure scope extraction from HTTP context:" category="API" difficulty="INTERMEDIATE" tags=["Apis", "Graphql", "WhizbangScopeOptions"]}
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

```csharp{title="Query Type Setup" description="Define your query type with lens resolvers:" category="API" difficulty="INTERMEDIATE" tags=["Apis", "Graphql", "Query", "Type"]}
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

```csharp{title="Service Registration" description="Register your lens implementations:" category="API" difficulty="BEGINNER" tags=["Apis", "Graphql", "Service", "Registration"]}
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
