---
title: Scoped Lens Queries
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Lenses
order: 3
description: >-
  Auto-scoping lens queries for singleton services, background workers, and batch operations
tags: 'lenses, scoped, singleton, background-worker, batch'
codeReferences:
  - src/Whizbang.Core/Lenses/IScopedLensQuery.cs
  - src/Whizbang.Core/Lenses/ScopedLensQuery.cs
  - src/Whizbang.Core/Lenses/ILensQueryFactory.cs
  - src/Whizbang.Core/Lenses/LensQueryFactory.cs
testReferences:
  - tests/Whizbang.Core.Tests/Lenses/ScopedLensQueryTests.cs
  - tests/Whizbang.Core.Tests/Lenses/LensQueryFactoryTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ScopedLensQueryIntegrationTests.cs
lastMaintainedCommit: '01f07906'
---

# Scoped Lens Queries

Scoped lens queries solve the challenge of using `ILensQuery<T>` from singleton services, background workers, or test fixtures where you cannot inject scoped services directly.

## The Problem: Singleton vs Scoped Services

`ILensQuery<T>` is registered as **transient** and requires a scoped `DbContext`. When you need to query from a singleton service (like a background worker), you cannot inject `ILensQuery<T>` directly:

```csharp{title="The Problem: Singleton vs Scoped Services" description="ILensQuery<T> is registered as transient and requires a scoped DbContext." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Problem:", "Singleton"] unverified="counter-example — anti-pattern showing why a transient/scoped ILensQuery cannot be injected into a singleton"}
// WRONG: Cannot inject transient ILensQuery into singleton
public class OrderProcessor : BackgroundService {
  private readonly ILensQuery<Order> _lens; // This doesn't work!

  public OrderProcessor(ILensQuery<Order> lens) {
    _lens = lens; // Throws: Cannot resolve scoped service from root provider
  }
}
```

## Solution 1: IScopedLensQuery (Auto-Scoping)

`IScopedLensQuery<T>` automatically creates a fresh service scope for each operation. It is safe to inject into singleton services:

```csharp{title="Solution 1: IScopedLensQuery (Auto-Scoping)" description="IScopedLensQuery<T> automatically creates a fresh service scope for each operation." category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Lenses", "Solution", "IScopedLensQuery"] tests=["ScopedLensQueryTests.ExecuteAsync_CreatesScope_AndDisposesAfterQueryAsync"]}
public class OrderProcessor : BackgroundService {
  private readonly IScopedLensQuery<Order> _lens;

  public OrderProcessor(IScopedLensQuery<Order> lens) {
    _lens = lens; // Safe - registered as singleton
  }

  protected override async Task ExecuteAsync(CancellationToken ct) {
    while (!ct.IsCancellationRequested) {
      // Each operation creates its own scope and DbContext
      var pendingOrders = await _lens.ExecuteAsync(
          async (lens, token) => await lens.DefaultScope.Query
              .Where(r => r.Data.Status == "Pending")
              .Select(r => r.Data)
              .ToListAsync(token),
          ct);

      foreach (var order in pendingOrders) {
        await ProcessOrderAsync(order);
      }

      await Task.Delay(TimeSpan.FromSeconds(30), ct);
    }
  }
}
```

### IScopedLensQuery Methods

```csharp{title="IScopedLensQuery Methods" description="IScopedLensQuery Methods" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "IScopedLensQuery", "Methods"] tests=["ScopedLensQueryTests.QueryAsync_CreatesScope_AndStreamResultsAsync", "ScopedLensQueryTests.QueryAsyncProjection_CreatesScope_AndStreamsResultsAsync", "ScopedLensQueryTests.GetByIdAsync_CreatesScope_AndDisposesAfterQueryAsync", "ScopedLensQueryTests.ExecuteAsync_CreatesScope_AndDisposesAfterQueryAsync"]}
public interface IScopedLensQuery<TModel> where TModel : class {
  // Streaming results (scope disposed after enumeration)
  IAsyncEnumerable<PerspectiveRow<TModel>> QueryAsync(
      Func<ILensQuery<TModel>, IQueryable<PerspectiveRow<TModel>>> queryBuilder,
      CancellationToken cancellationToken = default);

  // Projection queries
  IAsyncEnumerable<TResult> QueryAsync<TResult>(
      Func<ILensQuery<TModel>, IQueryable<TResult>> queryBuilder,
      CancellationToken cancellationToken = default);

  // Fast single-item lookup
  Task<TModel?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);

  // Materialized queries (ToListAsync, FirstOrDefaultAsync, etc.)
  Task<TResult> ExecuteAsync<TResult>(
      Func<ILensQuery<TModel>, CancellationToken, Task<TResult>> queryExecutor,
      CancellationToken cancellationToken = default);
}
```

### Usage Patterns

**Get by ID**:
```csharp{title="Usage Patterns" description="Usage Patterns" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Usage", "Patterns"] tests=["ScopedLensQueryTests.GetByIdAsync_CreatesScope_AndDisposesAfterQueryAsync"]}
var order = await _scopedLens.GetByIdAsync(orderId, ct);
```

**Execute materialized query**:
```csharp{title="Usage Patterns (2)" description="Execute materialized query:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Usage", "Patterns"] tests=["ScopedLensQueryTests.ExecuteAsync_CreatesScope_AndDisposesAfterQueryAsync"]}
var orders = await _scopedLens.ExecuteAsync(
    async (lens, token) => await lens.DefaultScope.Query
        .Where(r => r.Data.CustomerId == customerId)
        .Select(r => r.Data)
        .ToListAsync(token),
    ct);
```

**Stream results**:
```csharp{title="Usage Patterns (3)" description="Stream results:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Usage", "Patterns"] tests=["ScopedLensQueryTests.QueryAsync_CreatesScope_AndStreamResultsAsync"]}
await foreach (var row in _scopedLens.QueryAsync(
    lens => lens.DefaultScope.Query.Where(r => r.Data.Total > 100),
    ct)) {

  await ProcessOrderAsync(row.Data);
}
```

**Projection queries**:
```csharp{title="Usage Patterns (4)" description="Projection queries:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "Usage", "Patterns"] tests=["ScopedLensQueryTests.QueryAsyncProjection_CreatesScope_AndStreamsResultsAsync"]}
await foreach (var summary in _scopedLens.QueryAsync<OrderSummary>(
    lens => lens.DefaultScope.Query.Select(r => new OrderSummary {
      Id = r.Id,
      Total = r.Data.Total,
      CustomerName = r.Data.CustomerName
    }),
    ct)) {

  Console.WriteLine($"Order {summary.Id}: {summary.Total:C}");
}
```

## The Scope-First Query API

The `ILensQuery<T>` passed to your query builders uses a **scope-before-query** API. Select a scope first, then query through the returned access object. The bare `lens.Query` and `lens.GetByIdAsync()` members are marked `[Obsolete]` and delegate to `DefaultScope`.

### Query Scope {#query-scope}

`QueryScope` selects a predefined filter level; each value maps to `ScopeFilters` flags via `QueryScopeMapper.ToScopeFilter`:

```csharp{title="QueryScope Enum" description="Predefined query scope levels for the fluent scope-before-query API" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "QueryScope"] tests=["QueryScopeMapperTests.ToScopeFilter_Global_ReturnsScopeFilterNoneAsync", "QueryScopeMapperTests.ToScopeFilter_Tenant_ReturnsScopeFilterTenantAsync", "QueryScopeMapperTests.ToScopeFilter_Organization_ReturnsTenantAndOrganizationAsync", "QueryScopeMapperTests.ToScopeFilter_Customer_ReturnsTenantAndCustomerAsync", "QueryScopeMapperTests.ToScopeFilter_User_ReturnsTenantAndUserAsync", "QueryScopeMapperTests.ToScopeFilter_Principal_ReturnsTenantAndPrincipalAsync", "QueryScopeMapperTests.ToScopeFilter_UserOrPrincipal_ReturnsTenantUserAndPrincipalAsync"]}
public enum QueryScope {
  Global,           // No filtering - full access
  Tenant,           // Tenant only
  Organization,     // Tenant + Organization
  Customer,         // Tenant + Customer
  User,             // Tenant + User
  Principal,        // Tenant + security principal membership
  UserOrPrincipal   // Tenant + (User OR Principal) - "my records or shared with me"
}
```

### Scoped Lens Access {#scoped-lens-access}

`Scope()`, `ScopeOverride()`, and `DefaultScope` return an `IScopedLensAccess<TModel>` with scope filters pre-applied:

```csharp{title="IScopedLensAccess" description="Scope-filtered query access returned by the fluent scope API" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "IScopedLensAccess"]}
public interface IScopedLensAccess<TModel> where TModel : class {
  // Queryable access to perspective rows with scope filters pre-applied
  IQueryable<PerspectiveRow<TModel>> Query { get; }

  // Fast single-item lookup by ID within the applied scope
  Task<TModel?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
}

// Usage
var tenantOrders = lens.Scope(QueryScope.Tenant).Query;
var adminView = lens.Scope(QueryScope.Global).Query;
var order = await lens.DefaultScope.GetByIdAsync(orderId, ct);
```

### Default Scope {#default-scope}

`DefaultScope` uses the scope configured in `WhizbangCoreOptions.DefaultQueryScope` (default: `QueryScope.Tenant`). Any scope other than `Global` requires an ambient scope context (`IScopeContextAccessor.Current`); querying without one throws `InvalidOperationException`.

### Scoped Multi Lens Access {#scoped-multi-lens-access}

Multi-model lenses (`ILensQuery<T1, T2>` and higher) return `IScopedMultiLensAccess<T1, T2, ...>` from their scope methods, exposing `Query<T>()` and `GetByIdAsync<T>()` restricted to the declared model types. See [Multi-Model Queries](multi-model-queries.md).

## Solution 2: ILensQueryFactory (Batch Operations)

When you need multiple queries to share a single scope (for performance or transactional consistency), use `ILensQueryFactory<T>`:

```csharp{title="Solution 2: ILensQueryFactory (Batch Operations)" description="When you need multiple queries to share a single scope (for performance or transactional consistency), use" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "Solution", "ILensQueryFactory"] tests=["LensQueryFactoryTests.CreateScoped_ReturnsDisposableScopedQueryAsync", "LensQueryFactoryTests.ScopedQuery_SharesSameDbContext_WithinScopeAsync"]}
public class OrderReportService {
  private readonly ILensQueryFactory<Order> _factory;

  public OrderReportService(ILensQueryFactory<Order> factory) {
    _factory = factory;
  }

  public async Task<OrderReport> GenerateReportAsync(Guid customerId, CancellationToken ct) {
    // Create a scope for all queries in this batch
    using var scope = _factory.CreateScoped();
    var lens = scope.Value.DefaultScope;

    // All queries share the same DbContext
    var totalOrders = await lens.Query
        .Where(r => r.Data.CustomerId == customerId)
        .CountAsync(ct);

    var totalRevenue = await lens.Query
        .Where(r => r.Data.CustomerId == customerId)
        .SumAsync(r => r.Data.Total, ct);

    var recentOrders = await lens.Query
        .Where(r => r.Data.CustomerId == customerId)
        .OrderByDescending(r => r.Data.CreatedAt)
        .Take(5)
        .Select(r => r.Data)
        .ToListAsync(ct);

    return new OrderReport {
      TotalOrders = totalOrders,
      TotalRevenue = totalRevenue,
      RecentOrders = recentOrders
    };
  }
}
```

### LensQueryScope Disposal

The `LensQueryScope<T>` returned by `CreateScoped()` MUST be disposed to release the service scope:

```csharp{title="LensQueryScope Disposal" description="The LensQueryScope<T> returned by CreateScoped() MUST be disposed to release the service scope:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "LensQueryScope", "Disposal"] tests=["LensQueryFactoryTests.ScopedQuery_DisposesScope_WhenDisposedAsync", "LensQueryFactoryTests.MultipleScopedQueries_CreateSeparateScopesAsync"]}
// Correct: using statement ensures disposal
using var scope = _factory.CreateScoped();
var lens = scope.Value;
// ... use lens ...
// Scope disposed here, releasing DbContext

// Also correct: explicit disposal
var scope = _factory.CreateScoped();
try {
  var lens = scope.Value;
  // ... use lens ...
}
finally {
  scope.Dispose();
}
```

## When to Use Which

| Scenario | Use | Why |
|----------|-----|-----|
| Singleton/background service | `IScopedLensQuery<T>` | Auto-scoping per operation |
| Test fixtures | `IScopedLensQuery<T>` | Fresh scope per test operation |
| Single query | `IScopedLensQuery<T>` | Simple, automatic cleanup |
| Multiple queries, same data | `ILensQueryFactory<T>` | Share DbContext for consistency |
| Batch reports | `ILensQueryFactory<T>` | Reuse connection |
| Standard request-scoped | `ILensQuery<T>` | Direct injection works |

## Registration

Both scoped query types are registered automatically by the Whizbang source generator:

```csharp{title="Registration" description="Both scoped query types are registered automatically by the Whizbang source generator:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Registration"] unverified="generated DI registration emitted by the Whizbang source generator — not exercised by these lens unit tests"}
// Auto-generated registration
services.AddSingleton<IScopedLensQuery<Order>, ScopedLensQuery<Order>>();
services.AddSingleton<ILensQueryFactory<Order>, LensQueryFactory<Order>>();
```

## Important Notes

1. **Scope Lifecycle**: `IScopedLensQuery<T>` creates a new scope per operation. The scope is disposed after `ExecuteAsync` returns or after streaming enumeration completes.

2. **Streaming Behavior**: `QueryAsync` methods materialize results within the scope before yielding. This ensures the DbContext is not disposed mid-enumeration.

3. **Thread Safety**: Both `IScopedLensQuery<T>` and `ILensQueryFactory<T>` are thread-safe for parallel operations. Each operation gets its own scope.

4. **Performance**: For multiple queries in sequence, `ILensQueryFactory<T>` is more efficient (one scope vs many).

## See Also

- [Lens Query Factory](lens-query-factory.md) - DbContext sharing for parallel resolvers
- [Temporal Queries](temporal-query.md) - Time-travel and history queries
- [Raw SQL Access](raw-sql.md) - Direct SQL execution
