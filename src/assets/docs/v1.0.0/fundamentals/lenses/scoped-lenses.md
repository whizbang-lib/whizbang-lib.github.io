---
title: Scoped Lenses
version: 1.0.0
category: Core Concepts
order: 5
description: >-
  Scoped lens queries and factories for tenant-isolated, user-scoped, and
  permission-based data access with automatic WHERE clause generation
tags: 'lenses, scoping, multi-tenancy, security, queries, cqrs'
codeReferences:
  - src/Whizbang.Core/Lenses/IScopedLensFactory.cs
  - src/Whizbang.Core/Lenses/ScopedLensFactory.cs
  - src/Whizbang.Core/Lenses/ScopedLensQuery.cs
  - src/Whizbang.Core/Lenses/ScopeDefinition.cs
  - src/Whizbang.Core/Lenses/LensOptions.cs
  - src/Whizbang.Core/Lenses/FilterMode.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreFilterableLensQuery.cs
---

# Scoped Lenses

**Scoped Lenses** combine the query capabilities of [Lenses](./lenses.md) with the data isolation features of the [Scoping System](../../apis/graphql/scoping.md). They automatically apply tenant, user, organization, and principal-based filters to your queries without manual WHERE clauses.

## Overview

Scoped lenses solve a common problem in multi-tenant applications: ensuring queries only return data the caller is authorized to see. Instead of manually adding `WHERE TenantId = @CurrentTenant` to every query, scoped lenses apply these filters automatically based on configuration and runtime context.

**Key Components**:

| Component | Purpose |
|-----------|---------|
| `IScopedLensFactory` | Factory for creating lenses with scope filters applied |
| `ScopedLensFactory` | Default implementation that resolves lenses from DI |
| `IScopedLensQuery<T>` | Auto-scoping query for singleton services |
| `ScopedLensQuery<T>` | Implementation that creates fresh scopes per operation |
| `ScopeDefinition` | Defines a named scope configuration |
| `LensOptions` | Configuration container for scope definitions |
| `FilterMode` | How filters are applied (Equals vs In) |

---

## IScopedLensFactory

The `IScopedLensFactory` is the primary entry point for obtaining scoped lenses. It resolves lens instances from DI and automatically applies scope filters based on the current context.

### Primary API: Composable Filters

```csharp{title="Primary API: Composable Filters" description="Primary API: Composable Filters" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Primary", "API:"]}
public interface IScopedLensFactory {
  // Get lens with composable scope filters
  TLens GetLens<TLens>(ScopeFilter filters) where TLens : ILensQuery;

  // Get lens with filters + permission check
  TLens GetLens<TLens>(ScopeFilter filters, Permission requiredPermission) where TLens : ILensQuery;

  // Get lens with filters + any-of permissions
  TLens GetLens<TLens>(ScopeFilter filters, params Permission[] anyOfPermissions) where TLens : ILensQuery;
}
```

### Convenience Methods

For common patterns, use the convenience methods:

```csharp{title="Convenience Methods" description="For common patterns, use the convenience methods:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "Convenience", "Methods"]}
// No filtering (admin access)
factory.GetGlobalLens<TLens>();       // ScopeFilter.None

// Tenant isolation
factory.GetTenantLens<TLens>();       // ScopeFilter.Tenant

// Tenant + User isolation
factory.GetUserLens<TLens>();         // ScopeFilter.Tenant | ScopeFilter.User

// Tenant + Organization
factory.GetOrganizationLens<TLens>(); // ScopeFilter.Tenant | ScopeFilter.Organization

// Tenant + Customer
factory.GetCustomerLens<TLens>();     // ScopeFilter.Tenant | ScopeFilter.Customer

// Tenant + Principal membership
factory.GetPrincipalLens<TLens>();    // ScopeFilter.Tenant | ScopeFilter.Principal

// "My records OR shared with me"
factory.GetMyOrSharedLens<TLens>();   // ScopeFilter.Tenant | ScopeFilter.User | ScopeFilter.Principal
```

### Usage Examples

```csharp{title="Usage Examples" description="Usage Examples" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "Usage", "Examples"]}
public class OrderController : ControllerBase {
  private readonly IScopedLensFactory _lensFactory;

  public OrderController(IScopedLensFactory lensFactory) {
    _lensFactory = lensFactory;
  }

  [HttpGet]
  public async Task<IActionResult> GetOrders() {
    // Only returns orders for current tenant
    var lens = _lensFactory.GetTenantLens<IOrderLens>();
    var orders = await lens.GetAllAsync();
    return Ok(orders);
  }

  [HttpGet("my")]
  public async Task<IActionResult> GetMyOrders() {
    // Only returns orders owned by current user (within tenant)
    var lens = _lensFactory.GetUserLens<IOrderLens>();
    var orders = await lens.GetAllAsync();
    return Ok(orders);
  }

  [HttpGet("shared")]
  public async Task<IActionResult> GetMyOrSharedOrders() {
    // Returns user's orders OR orders shared with their groups
    var lens = _lensFactory.GetMyOrSharedLens<IOrderLens>();
    var orders = await lens.GetAllAsync();
    return Ok(orders);
  }
}
```

### Permission Checks

Combine scope filtering with permission verification:

```csharp{title="Permission Checks" description="Combine scope filtering with permission verification:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "Permission", "Checks"]}
// Throws AccessDeniedException if caller lacks permission
var lens = _lensFactory.GetLens<IOrderLens>(
  ScopeFilter.Tenant,
  Permission.Read("orders"));

// Caller must have at least one of these permissions
var lens = _lensFactory.GetLens<IReportLens>(
  ScopeFilter.Tenant | ScopeFilter.Principal,
  Permission.Read("reports"),
  Permission.Read("analytics"));
```

When permission checks fail:
1. An `AccessDenied` system event is emitted for audit logging
2. `AccessDeniedException` is thrown with details about the required permission

---

## ScopedLensQuery {#scoped-lens-query}

`IScopedLensQuery<TModel>` provides auto-scoping queries for use in **singleton services**, **background workers**, or **test fixtures** where you cannot inject scoped services directly.

### The Problem

When injecting `ILensQuery<T>` into a singleton service, you get a stale DbContext:

```csharp{title="The Problem" description="When injecting ILensQuery<T> into a singleton service, you get a stale DbContext:" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Lenses", "Problem"]}
// BAD: DbContext becomes stale in singleton
public class OrderProcessor : BackgroundService {
  private readonly ILensQuery<Order> _lens; // Injected once, never refreshed

  protected override async Task ExecuteAsync(CancellationToken ct) {
    while (!ct.IsCancellationRequested) {
      // This query uses a stale DbContext!
      var orders = await _lens.Query.ToListAsync();
    }
  }
}
```

### The Solution

Use `IScopedLensQuery<T>` which creates a fresh service scope for each operation:

```csharp{title="The Solution" description="Use IScopedLensQuery<T> which creates a fresh service scope for each operation:" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Lenses", "Solution"]}
// GOOD: Fresh scope per query
public class OrderProcessor : BackgroundService {
  private readonly IScopedLensQuery<Order> _scopedLens;

  public OrderProcessor(IScopedLensQuery<Order> scopedLens) {
    _scopedLens = scopedLens;
  }

  protected override async Task ExecuteAsync(CancellationToken ct) {
    while (!ct.IsCancellationRequested) {
      // Each query creates a fresh scope with new DbContext
      var orders = await _scopedLens.QueryAsync(
        lens => lens.Query.Where(o => o.Status == "pending"),
        ct).ToListAsync();

      await ProcessOrdersAsync(orders);
      await Task.Delay(TimeSpan.FromSeconds(30), ct);
    }
  }
}
```

### IScopedLensQuery Methods

```csharp{title="IScopedLensQuery Methods" description="IScopedLensQuery Methods" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "IScopedLensQuery", "Methods"]}
public interface IScopedLensQuery<TModel> where TModel : class {
  // Stream results with auto-scoping
  IAsyncEnumerable<PerspectiveRow<TModel>> QueryAsync(
    Func<ILensQuery<TModel>, IQueryable<PerspectiveRow<TModel>>> queryBuilder,
    CancellationToken cancellationToken = default);

  // Projection queries
  IAsyncEnumerable<TResult> QueryAsync<TResult>(
    Func<ILensQuery<TModel>, IQueryable<TResult>> queryBuilder,
    CancellationToken cancellationToken = default);

  // Fast ID lookup
  Task<TModel?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);

  // Materialized queries (ToListAsync, FirstOrDefaultAsync, etc.)
  Task<TResult> ExecuteAsync<TResult>(
    Func<ILensQuery<TModel>, CancellationToken, Task<TResult>> queryExecutor,
    CancellationToken cancellationToken = default);
}
```

### Usage Examples

```csharp{title="Usage Examples - ReportGenerator" description="Usage Examples - ReportGenerator" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Lenses", "Usage", "Examples"]}
public class ReportGenerator {
  private readonly IScopedLensQuery<OrderSummary> _orderLens;

  public ReportGenerator(IScopedLensQuery<OrderSummary> orderLens) {
    _orderLens = orderLens;
  }

  public async Task<decimal> CalculateTotalRevenueAsync(
    DateOnly startDate,
    DateOnly endDate,
    CancellationToken ct) {

    // ExecuteAsync for aggregations
    return await _orderLens.ExecuteAsync(
      async (lens, token) => await lens.Query
        .Where(o => o.Data.OrderDate >= startDate && o.Data.OrderDate <= endDate)
        .SumAsync(o => o.Data.Total, token),
      ct);
  }

  public async Task<OrderSummary?> GetOrderAsync(Guid orderId, CancellationToken ct) {
    // GetByIdAsync for single-item lookup
    return await _orderLens.GetByIdAsync(orderId, ct);
  }

  public async IAsyncEnumerable<OrderSummary> GetRecentOrdersAsync(
    [EnumeratorCancellation] CancellationToken ct) {

    // QueryAsync for streaming results
    await foreach (var row in _orderLens.QueryAsync(
      lens => lens.Query
        .OrderByDescending(o => o.Data.OrderDate)
        .Take(100),
      ct)) {
      yield return row.Data;
    }
  }
}
```

---

## Scope Definition {#scope-definition}

`ScopeDefinition` defines a named scope configuration for the legacy string-based API. While the composable `ScopeFilter` flags are preferred, scope definitions provide a way to define reusable, named scopes.

### Properties

```csharp{title="Properties" description="Properties" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "Properties"]}
public sealed class ScopeDefinition {
  // Unique name for this scope (e.g., "Tenant", "User", "Global")
  public string Name { get; }

  // Property name to filter by (e.g., "TenantId", "UserId")
  public string? FilterPropertyName { get; set; }

  // Key to retrieve filter value from context
  public string? ContextKey { get; set; }

  // Filter comparison mode (Equals or In)
  public FilterMode FilterMode { get; set; } = FilterMode.Equals;

  // When true, no filter is applied (admin/global access)
  public bool NoFilter { get; set; }

  // Optional interface type for filtered models
  public Type? FilterInterfaceType { get; set; }
}
```

### Defining Named Scopes

```csharp{title="Defining Named Scopes" description="Defining Named Scopes" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "Defining", "Named"]}
services.AddWhizbang(options => {
  // Tenant-only scope
  options.Lenses.DefineScope("Tenant", scope => {
    scope.FilterPropertyName = "TenantId";
    scope.ContextKey = "TenantId";
    scope.FilterInterfaceType = typeof(ITenantScoped);
  });

  // User scope (within tenant)
  options.Lenses.DefineScope("User", scope => {
    scope.FilterPropertyName = "UserId";
    scope.ContextKey = "UserId";
  });

  // Global/admin scope (no filtering)
  options.Lenses.DefineScope("Global", scope => {
    scope.NoFilter = true;
  });

  // Hierarchical scope (IN clause)
  options.Lenses.DefineScope("TenantHierarchy", scope => {
    scope.FilterPropertyName = "TenantId";
    scope.ContextKey = "TenantHierarchy";
    scope.FilterMode = FilterMode.In;
  });
});
```

### Using Named Scopes (Legacy API)

```csharp{title="Using Named Scopes (Legacy API)" description="Using Named Scopes (Legacy API)" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Using", "Named"]}
// Get lens using named scope
var lens = factory.GetLens<IOrderLens>("Tenant");
var globalLens = factory.GetLens<IOrderLens>("Global");
```

**Note**: Prefer the composable `ScopeFilter` flags over named scopes for new code.

---

## Configuration {#configuration}

`LensOptions` is the configuration container for lens scoping. It holds scope definitions and is configured at service registration time.

### LensOptions API

```csharp{title="LensOptions API" description="LensOptions API" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "LensOptions", "API"]}
public sealed class LensOptions {
  // Get all defined scopes
  public IReadOnlyList<ScopeDefinition> Scopes { get; }

  // Define a named scope
  public LensOptions DefineScope(string name, Action<ScopeDefinition> configure);

  // Get scope by name (case-insensitive)
  public ScopeDefinition? GetScope(string name);
}
```

### Configuration Example

```csharp{title="Configuration Example" description="Configuration Example" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "Configuration", "Example"]}
services.AddWhizbang(options => {
  // Chain multiple scope definitions
  options.Lenses
    .DefineScope("Tenant", scope => {
      scope.FilterPropertyName = "TenantId";
      scope.ContextKey = "TenantId";
      scope.FilterInterfaceType = typeof(ITenantScoped);
    })
    .DefineScope("User", scope => {
      scope.FilterPropertyName = "UserId";
      scope.ContextKey = "UserId";
    })
    .DefineScope("Global", scope => {
      scope.NoFilter = true;
    });
});
```

### Accessing Configuration at Runtime

```csharp{title="Accessing Configuration at Runtime" description="Accessing Configuration at Runtime" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "Accessing", "Configuration"]}
public class CustomLensFactory {
  private readonly LensOptions _options;

  public CustomLensFactory(LensOptions options) {
    _options = options;
  }

  public void ListScopes() {
    foreach (var scope in _options.Scopes) {
      Console.WriteLine($"Scope: {scope.Name}, Filter: {scope.FilterPropertyName}");
    }
  }

  public bool IsScopeDefined(string name) {
    return _options.GetScope(name) is not null;
  }
}
```

---

## Filter Modes {#filter-modes}

`FilterMode` specifies how scope filters are applied to queries. This affects the SQL WHERE clause generation.

### FilterMode Enum

```csharp{title="FilterMode Enum" description="FilterMode Enum" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "FilterMode", "Enum"]}
public enum FilterMode {
  // Filter using equality (WHERE property = @value)
  Equals = 0,

  // Filter using IN clause (WHERE property IN @values)
  In = 1
}
```

### Equals Mode (Default)

Use for single-value filtering:

```csharp{title="Equals Mode (Default)" description="Use for single-value filtering:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Equals", "Mode"]}
// Configuration
scope.FilterPropertyName = "TenantId";
scope.FilterMode = FilterMode.Equals;

// Generated SQL
// WHERE scope->>'TenantId' = 'tenant-123'
```

### In Mode

Use for hierarchical or multi-value filtering:

```csharp{title="In Mode" description="Use for hierarchical or multi-value filtering:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Mode"]}
// Configuration
scope.FilterPropertyName = "TenantId";
scope.ContextKey = "TenantHierarchy";  // Returns multiple values
scope.FilterMode = FilterMode.In;

// Generated SQL
// WHERE scope->>'TenantId' IN ('parent-tenant', 'child-1', 'child-2')
```

### Use Cases for IN Mode

**Tenant Hierarchies**: A parent tenant can see data from all child tenants:

```csharp{title="Use Cases for IN Mode" description="Tenant Hierarchies: A parent tenant can see data from all child tenants:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Cases", "Mode"]}
// Context provides hierarchy
scopeContext.Set("TenantHierarchy", new[] { "parent", "child-1", "child-2" });

// Scope definition
options.Lenses.DefineScope("TenantHierarchy", scope => {
  scope.FilterPropertyName = "TenantId";
  scope.ContextKey = "TenantHierarchy";
  scope.FilterMode = FilterMode.In;
});
```

**Region-based Access**: Access data from multiple regions:

```csharp{title="Use Cases for IN Mode (2)" description="Region-based Access: Access data from multiple regions:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Cases", "Mode"]}
scopeContext.Set("AllowedRegions", new[] { "us-west", "us-east" });

options.Lenses.DefineScope("Region", scope => {
  scope.FilterPropertyName = "Region";
  scope.ContextKey = "AllowedRegions";
  scope.FilterMode = FilterMode.In;
});
```

---

## EF Core Implementation {#ef-core-implementation}

`EFCoreFilterableLensQuery<TModel>` is the EF Core implementation that applies scope filters to queries. It implements `IFilterableLens` to receive filter information from `IScopedLensFactory`.

### How It Works

1. `IScopedLensFactory` resolves the lens from DI
2. If the lens implements `IFilterableLens`, the factory calls `ApplyFilter()`
3. The lens stores the filter info and applies it when `Query` is accessed
4. EF Core translates the LINQ expressions to PostgreSQL JSONB queries

### Filter Composition

```csharp{title="Filter Composition" description="Filter Composition" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Lenses", "Filter", "Composition"]}
public class EFCoreFilterableLensQuery<TModel> : ILensQuery<TModel>, IFilterableLens {
  private ScopeFilterInfo _filterInfo;

  public void ApplyFilter(ScopeFilterInfo filterInfo) {
    _filterInfo = filterInfo;
  }

  public IQueryable<PerspectiveRow<TModel>> Query {
    get {
      var query = _context.Set<PerspectiveRow<TModel>>().AsNoTracking();

      if (_filterInfo.IsEmpty) {
        return query;
      }

      // Tenant filter (always AND'd first)
      if (_filterInfo.Filters.HasFlag(ScopeFilter.Tenant) && _filterInfo.TenantId is not null) {
        query = query.Where(r => r.Scope.TenantId == _filterInfo.TenantId);
      }

      // Organization filter
      if (_filterInfo.Filters.HasFlag(ScopeFilter.Organization) && _filterInfo.OrganizationId is not null) {
        query = query.Where(r => r.Scope.OrganizationId == _filterInfo.OrganizationId);
      }

      // Customer filter
      if (_filterInfo.Filters.HasFlag(ScopeFilter.Customer) && _filterInfo.CustomerId is not null) {
        query = query.Where(r => r.Scope.CustomerId == _filterInfo.CustomerId);
      }

      // User + Principal with special OR logic
      var hasUserFilter = _filterInfo.Filters.HasFlag(ScopeFilter.User) && _filterInfo.UserId is not null;
      var hasPrincipalFilter = _filterInfo.Filters.HasFlag(ScopeFilter.Principal)
        && _filterInfo.SecurityPrincipals.Count > 0;

      if (_filterInfo.UseOrLogicForUserAndPrincipal && hasUserFilter && hasPrincipalFilter) {
        // "My records OR shared with me"
        query = query.FilterByUserOrPrincipals(_filterInfo.UserId, _filterInfo.SecurityPrincipals);
      } else {
        if (hasUserFilter) {
          query = query.Where(r => r.Scope.UserId == _filterInfo.UserId);
        }
        if (hasPrincipalFilter) {
          query = query.FilterByPrincipals(_filterInfo.SecurityPrincipals);
        }
      }

      return query;
    }
  }
}
```

### Generated SQL Examples

| Filter Combination | Generated WHERE Clause |
|-------------------|------------------------|
| `Tenant` | `WHERE scope->>'TenantId' = 'tenant-123'` |
| `Tenant \| User` | `WHERE scope->>'TenantId' = ? AND scope->>'UserId' = ?` |
| `Tenant \| Organization` | `WHERE scope->>'TenantId' = ? AND scope->>'OrganizationId' = ?` |
| `Tenant \| Principal` | `WHERE scope->>'TenantId' = ? AND scope->'AllowedPrincipals' ?| [...]` |
| `Tenant \| User \| Principal` | `WHERE scope->>'TenantId' = ? AND (scope->>'UserId' = ? OR scope->'AllowedPrincipals' ?| [...])` |

### IFilterableLens Interface

Implement this interface on custom lens implementations to support scope filtering:

```csharp{title="IFilterableLens Interface" description="Implement this interface on custom lens implementations to support scope filtering:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "IFilterableLens", "Interface"]}
public interface IFilterableLens {
  void ApplyFilter(ScopeFilterInfo filterInfo);
}

// Custom implementation
public class CustomLens<TModel> : ILensQuery<TModel>, IFilterableLens {
  private ScopeFilterInfo _filterInfo;

  public void ApplyFilter(ScopeFilterInfo filterInfo) {
    _filterInfo = filterInfo;
  }

  public IQueryable<PerspectiveRow<TModel>> Query {
    get {
      // Apply _filterInfo to your query implementation
    }
  }
}
```

---

## Best Practices

### DO

- Use composable `ScopeFilter` flags for new code
- Prefer convenience methods (`GetTenantLens`, `GetUserLens`) for common patterns
- Combine scope filtering with permission checks for defense in depth
- Use `IScopedLensQuery<T>` in singleton services and background workers
- Apply the most restrictive scope appropriate for each use case

### DON'T

- Don't bypass scoped lenses with raw SQL that ignores filters
- Don't cache lenses across requests (they contain request-specific filters)
- Don't use `GetGlobalLens` without strong justification (admin only)
- Don't mix legacy named scopes with composable flags unnecessarily

---

## Related Documentation

- [Lenses](./lenses.md) - Base lens concepts and query patterns
- [Scoping](../../apis/graphql/scoping.md) - Scope filters, PerspectiveScope, and ScopeFilterBuilder
- [Security](../security/security.md) - Permissions, roles, and access control
- [System Events](../events/system-events.md) - AccessDenied and other security events

---

*Version 1.0.0 - Foundation Release*
