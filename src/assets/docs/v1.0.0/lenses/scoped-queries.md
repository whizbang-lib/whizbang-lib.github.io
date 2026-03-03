---
title: Scoped Lens Queries
version: 1.0.0
category: Lenses
order: 3
description: >-
  Auto-scoping lens queries for singleton services, background workers, and batch operations
tags: 'lenses, scoped, singleton, background-worker, batch'
codeReferences:
  - src/Whizbang.Core/Lenses/IScopedLensQuery.cs
  - src/Whizbang.Core/Lenses/ScopedLensQuery.cs
  - src/Whizbang.Core/Lenses/LensQueryFactory.cs
---

# Scoped Lens Queries

Scoped lens queries solve the challenge of using `ILensQuery<T>` from singleton services, background workers, or test fixtures where you cannot inject scoped services directly.

## The Problem: Singleton vs Scoped Services

`ILensQuery<T>` is registered as **transient** and requires a scoped `DbContext`. When you need to query from a singleton service (like a background worker), you cannot inject `ILensQuery<T>` directly:

```csharp
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

```csharp
public class OrderProcessor : BackgroundService {
  private readonly IScopedLensQuery<Order> _lens;

  public OrderProcessor(IScopedLensQuery<Order> lens) {
    _lens = lens; // Safe - registered as singleton
  }

  protected override async Task ExecuteAsync(CancellationToken ct) {
    while (!ct.IsCancellationRequested) {
      // Each operation creates its own scope and DbContext
      var pendingOrders = await _lens.ExecuteAsync(
          async (lens, token) => await lens.Query
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

```csharp
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
```csharp
var order = await _scopedLens.GetByIdAsync(orderId, ct);
```

**Execute materialized query**:
```csharp
var orders = await _scopedLens.ExecuteAsync(
    async (lens, token) => await lens.Query
        .Where(r => r.Data.CustomerId == customerId)
        .Select(r => r.Data)
        .ToListAsync(token),
    ct);
```

**Stream results**:
```csharp
await foreach (var row in _scopedLens.QueryAsync(
    lens => lens.Query.Where(r => r.Data.Total > 100),
    ct)) {

  await ProcessOrderAsync(row.Data);
}
```

**Projection queries**:
```csharp
await foreach (var summary in _scopedLens.QueryAsync<OrderSummary>(
    lens => lens.Query.Select(r => new OrderSummary {
      Id = r.Id,
      Total = r.Data.Total,
      CustomerName = r.Data.CustomerName
    }),
    ct)) {

  Console.WriteLine($"Order {summary.Id}: {summary.Total:C}");
}
```

## Solution 2: ILensQueryFactory (Batch Operations)

When you need multiple queries to share a single scope (for performance or transactional consistency), use `ILensQueryFactory<T>`:

```csharp
public class OrderReportService {
  private readonly ILensQueryFactory<Order> _factory;

  public OrderReportService(ILensQueryFactory<Order> factory) {
    _factory = factory;
  }

  public async Task<OrderReport> GenerateReportAsync(Guid customerId, CancellationToken ct) {
    // Create a scope for all queries in this batch
    using var scope = _factory.CreateScoped();
    var lens = scope.Value;

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

```csharp
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

```csharp
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

- [Lens Query Factory](/docs/lenses/lens-query-factory) - DbContext sharing for parallel resolvers
- [Temporal Queries](/docs/lenses/temporal-query) - Time-travel and history queries
- [Raw SQL Access](/docs/lenses/raw-sql) - Direct SQL execution
