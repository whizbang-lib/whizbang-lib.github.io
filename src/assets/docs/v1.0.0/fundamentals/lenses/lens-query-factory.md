---
title: Lens Query Factory
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Lenses
order: 2
description: >-
  Thread-safe DbContext management for parallel GraphQL resolvers and cross-model joins
tags: 'lenses, factory, dbcontext, thread-safety, graphql, hotchocolate'
codeReferences:
  - src/Whizbang.Core/Lenses/ILensQueryFactory.cs
  - src/Whizbang.Core/Lenses/FactoryOwnedLensQuery.cs
  - src/Whizbang.Data.EFCore.Postgres/ScopedDbContextFactory.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreLensQueryFactory.cs
testReferences:
  - tests/Whizbang.Core.Tests/Lenses/FactoryOwnedLensQueryTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreLensQueryFactoryTests.cs
lastMaintainedCommit: '01f07906'
---

# Lens Query Factory

The `ILensQueryFactory` provides thread-safe access to read models in scenarios where multiple queries may execute in parallel, such as HotChocolate GraphQL resolvers.

## The Problem: DbContext Concurrency

EF Core's `DbContext` is **not thread-safe**. When HotChocolate runs field resolvers in parallel within the same HTTP request scope, all resolvers share the same scoped `DbContext` instance:

```csharp{title="The Problem: DbContext Concurrency" description="EF Core's DbContext is not thread-safe." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Problem:", "DbContext"]}
// GraphQL query that triggers parallel execution
{
  products { id name }      // Resolver 1 - uses DbContext
  orders { id total }       // Resolver 2 - uses SAME DbContext (parallel!)
  customers { id email }    // Resolver 3 - uses SAME DbContext (parallel!)
}
```

This causes the error:
> "A second operation was started on this context instance before a previous operation completed"

## The Solution: Automatic Thread Safety

Whizbang solves this automatically. When you configure `.AddWhizbang().WithEFCore<T>().WithDriver.Postgres`, it registers `ILensQuery<T>` as **transient** with each injection receiving its own DbContext:

```csharp{title="The Solution: Automatic Thread Safety" description="Whizbang solves this automatically." category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "Solution:", "Automatic"]}
// Each resolver gets its OWN DbContext - safe for parallel execution
public class CatalogQueries {
  public async Task<IEnumerable<Product>> GetProducts([Service] ILensQuery<Product> lens) {
    return await lens.DefaultScope.Query.Select(r => r.Data).ToListAsync();
  }

  public async Task<IEnumerable<Order>> GetOrders([Service] ILensQuery<Order> lens) {
    return await lens.DefaultScope.Query.Select(r => r.Data).ToListAsync();
  }
}
```

No special configuration needed - it just works.

## When to Use ILensQueryFactory

Use `ILensQueryFactory` when you need multiple queries to **share the same DbContext**, typically for:

- **Cross-model joins** - Joining data from different perspective tables
- **Transactional consistency** - Reading related data within a single transaction
- **Batch operations** - Multiple queries that should use one connection

:::updated
At the current commit, the non-generic `ILensQueryFactory` is the **internal building block** behind every transient `ILensQuery<T>` injection (via `FactoryOwnedLensQuery<T>`) — it is **not registered in DI for direct injection**. For cross-model LINQ joins with a shared DbContext, inject the multi-model `ILensQuery<T1, T2, ...>` instead — see [Multi-Model Queries](multi-model-queries.md). To use the factory directly, construct `EFCoreLensQueryFactory<TDbContext>` yourself or register `ILensQueryFactory` in your own composition root.
:::

```csharp{title="When to Use ILensQueryFactory" description="Cross-model join with a shared DbContext via a lens query factory" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "When", "ILensQueryFactory"]}
public class OrderWithCustomerQuery {
  public async Task<OrderWithCustomer?> GetOrderWithCustomer(
      Guid orderId,
      ILensQueryFactory factory) {

    // Both queries share the SAME DbContext
    var orderQuery = factory.GetQuery<Order>();
    var customerQuery = factory.GetQuery<Customer>();

    var result = await (
        from o in orderQuery.DefaultScope.Query
        join c in customerQuery.DefaultScope.Query on o.Data.CustomerId equals c.Id
        where o.Id == orderId
        select new OrderWithCustomer {
          Order = o.Data,
          Customer = c.Data
        }
    ).FirstOrDefaultAsync();

    return result;
  }
}
```

## Usage Patterns

| Scenario | Approach | DbContext Behavior |
|----------|----------|-------------------|
| Parallel resolvers | `ILensQuery<T>` | Each gets own DbContext |
| Single resolver | `ILensQuery<T>` | Gets own DbContext |
| Cross-model joins | `ILensQuery<T1, T2, ...>` | Shared DbContext |
| Batch reads | `ILensQueryFactory<T>` (`CreateScoped()`) | Shared scope/DbContext |

### Pattern 1: Direct Injection (Most Common)

For most queries, inject `ILensQuery<T>` directly:

```csharp{title="Pattern 1: Direct Injection (Most Common)" description="For most queries, inject ILensQuery<T> directly:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Pattern", "Direct"]}
[QueryType]
public class ProductQueries {
  public IQueryable<Product> GetProducts([Service] ILensQuery<Product> lens) =>
      lens.DefaultScope.Query.Select(r => r.Data);

  public async Task<Product?> GetProduct(Guid id, [Service] ILensQuery<Product> lens) =>
      await lens.DefaultScope.GetByIdAsync(id);
}
```

### Pattern 2: Multi-Model Lens for Joins (Recommended)

When joining across models, inject the multi-model `ILensQuery<T1, T2>` — it shares a single DbContext across the declared model types and IS registered in DI:

```csharp{title="Pattern 2: Multi-Model Lens for Joins" description="When joining across models, inject the multi-model ILensQuery:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "Pattern", "Multi-Model"]}
public class InventoryReportQuery {
  public async Task<IEnumerable<InventoryReport>> GetInventoryReport(
      [Service] ILensQuery<Product, InventoryLevel> lens) {

    var scoped = lens.DefaultScope;

    return await (
        from p in scoped.Query<Product>()
        join i in scoped.Query<InventoryLevel>() on p.Id equals i.Data.ProductId
        select new InventoryReport {
          ProductName = p.Data.Name,
          Quantity = i.Data.Quantity,
          ReorderPoint = i.Data.ReorderPoint
        }
    ).ToListAsync();
  }
}
```

### Pattern 3: Repository with Factory

For repository classes that need joins via the raw factory (requires the factory to be constructed or registered by your application — see the callout above):

```csharp{title="Pattern 3: Repository with Factory" description="For repository classes that need joins:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "Pattern", "Repository"]}
public class OrderRepository {
  private readonly ILensQuery<Order> _orders;
  private readonly ILensQuery<Customer> _customers;

  // Factory injected once - multiple GetQuery calls share DbContext
  public OrderRepository(ILensQueryFactory factory) {
    _orders = factory.GetQuery<Order>();
    _customers = factory.GetQuery<Customer>();
  }

  public async Task<OrderSummary?> GetOrderSummaryAsync(Guid orderId) {
    return await (
        from o in _orders.DefaultScope.Query
        join c in _customers.DefaultScope.Query on o.Data.CustomerId equals c.Id
        where o.Id == orderId
        select new OrderSummary {
          OrderId = o.Id,
          CustomerName = c.Data.Name,
          Total = o.Data.Total
        }
    ).FirstOrDefaultAsync();
  }
}
```

## How It Works

Under the hood, Whizbang uses a `ScopedDbContextFactory<T>` that:

1. Registers `DbContext` as **scoped** (normal EF Core pattern)
2. Registers `IDbContextFactory<T>` as **singleton** using `ScopedDbContextFactory`
3. Each `CreateDbContext()` call creates a new service scope
4. The scope (and its DbContext) is tracked and disposed when the context is garbage collected

This approach:
- Avoids `AddPooledDbContextFactory` scope validation issues
- Works correctly with scope validation enabled
- Provides thread-safe DbContext instances for parallel resolvers

## Registration

The factory is automatically registered when using the Whizbang fluent API:

```csharp{title="Registration" description="The factory is automatically registered when using the Whizbang fluent API:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Registration"]}
builder.Services
  .AddWhizbang()
  .WithEFCore<MyDbContext>()
  .WithDriver.Postgres;

// ILensQuery<T>        - transient (each injection = new factory = new DbContext)
// IScopedLensQuery<T>  - singleton (auto-scoping per operation)
// ILensQueryFactory<T> - singleton (CreateScoped() batch scopes)
// The non-generic ILensQueryFactory is created internally per ILensQuery<T> injection
```

## AOT Compatibility

`ILensQueryFactory` is fully AOT-compatible:
- Uses dictionary lookup for table names (no reflection)
- All type information resolved at compile-time by source generators
- Works with NativeAOT publishing

## Important Notes

1. **Disposal**: `ILensQueryFactory` implements `IAsyncDisposable` and `IDisposable`. When a factory backs a transient `ILensQuery<T>`, the DI container disposes the wrapping `FactoryOwnedLensQuery<T>`, which disposes the factory and its DbContext.

2. **Lifetime**: `ILensQuery<T>` is transient — each injection creates a fresh factory + DbContext internally.

3. **Thread Safety**: `ILensQuery<T>` is safe for parallel use because each injection gets its own DbContext. Do NOT share a single `ILensQuery<T>` instance across threads.

4. **Pooling**: DbContext instances come from EF Core's connection pool, so creating many contexts is efficient.

## Implementation Details

### ScopedDbContextFactory

The `ScopedDbContextFactory<TContext>` is a singleton implementation of `IDbContextFactory<T>` that creates DbContext instances via service scopes:

```csharp{title="ScopedDbContextFactory" description="The ScopedDbContextFactory<TContext> is a singleton implementation of IDbContextFactory<T> that creates DbContext" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "ScopedDbContextFactory"]}
public sealed class ScopedDbContextFactory<TContext> : IDbContextFactory<TContext>
    where TContext : DbContext {

  private readonly IServiceScopeFactory _scopeFactory;
  private readonly ConditionalWeakTable<TContext, IServiceScope> _scopes = new();

  public TContext CreateDbContext() {
    var scope = _scopeFactory.CreateScope();
    var context = scope.ServiceProvider.GetRequiredService<TContext>();

    // Track the scope with the context for cleanup when GC'd
    _scopes.Add(context, scope);

    return context;
  }
}
```

**Why not `AddPooledDbContextFactory`?**

EF Core's `AddPooledDbContextFactory` registers scoped option configurations internally, causing "Cannot resolve scoped service from root provider" errors when scope validation is enabled. `ScopedDbContextFactory` avoids this by:

- Creating scopes explicitly for each `CreateDbContext()` call
- Tracking scopes via `ConditionalWeakTable` for automatic cleanup
- Working correctly with scope validation enabled

### EFCoreLensQueryFactory

The `EFCoreLensQueryFactory<TDbContext>` is the EF Core implementation of `ILensQueryFactory`:

```csharp{title="EFCoreLensQueryFactory" description="The EFCoreLensQueryFactory<TDbContext> is the EF Core implementation of ILensQueryFactory:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "EFCoreLensQueryFactory"]}
public sealed class EFCoreLensQueryFactory<TDbContext> : ILensQueryFactory
    where TDbContext : DbContext {

  private readonly TDbContext _context;
  private readonly IReadOnlyDictionary<Type, string> _tableNames;
  private readonly IScopeContextAccessor _scopeContextAccessor;
  private readonly IOptions<WhizbangCoreOptions> _whizbangOptions;
  private bool _disposed;

  public EFCoreLensQueryFactory(
      IDbContextFactory<TDbContext> dbContextFactory,
      IReadOnlyDictionary<Type, string> tableNames,
      IScopeContextAccessor scopeContextAccessor,
      IOptions<WhizbangCoreOptions> whizbangOptions) {

    _context = dbContextFactory.CreateDbContext();
    _tableNames = tableNames;
    _scopeContextAccessor = scopeContextAccessor;
    _whizbangOptions = whizbangOptions;
  }

  public ILensQuery<TModel> GetQuery<TModel>() where TModel : class {
    ObjectDisposedException.ThrowIf(_disposed, this);

    if (!_tableNames.TryGetValue(typeof(TModel), out var tableName)) {
      throw new KeyNotFoundException(
          $"No table name registered for model type '{typeof(TModel).Name}'.");
    }

    return new EFCorePostgresLensQuery<TModel>(
        _context, tableName, _scopeContextAccessor, _whizbangOptions);
  }

  public void Dispose() { /* disposes _context once */ }

  public async ValueTask DisposeAsync() {
    if (!_disposed) {
      await _context.DisposeAsync();
      _disposed = true;
    }
  }
}
```

Key characteristics:
- Owns a single DbContext from the pool
- Multiple `GetQuery<T>()` calls return queries sharing that DbContext
- Registered as **transient** - each injection gets fresh factory + DbContext
- Table names come from source-generated dictionary (no reflection)

### FactoryOwnedLensQuery

The `FactoryOwnedLensQuery<TModel>` wraps a factory to provide the standard `ILensQuery<T>` interface while managing factory disposal:

```csharp{title="FactoryOwnedLensQuery" description="The FactoryOwnedLensQuery<TModel> wraps a factory to provide the standard ILensQuery<T> interface while managing" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "FactoryOwnedLensQuery"]}
public sealed class FactoryOwnedLensQuery<TModel>(ILensQueryFactory factory)
    : ILensQuery<TModel>, IAsyncDisposable, IDisposable
    where TModel : class {

  private readonly ILensQueryFactory _factory = factory;
  private readonly ILensQuery<TModel> _inner = factory.GetQuery<TModel>();
  private bool _disposed;

  // Fluent scope API delegates to the inner query
  public IScopedLensAccess<TModel> Scope(QueryScope scope) => _inner.Scope(scope);
  public IScopedLensAccess<TModel> ScopeOverride(QueryScope scope, ScopeFilterOverride overrideValues) =>
      _inner.ScopeOverride(scope, overrideValues);
  public IScopedLensAccess<TModel> DefaultScope => _inner.DefaultScope;

  // Legacy members (obsolete) also delegate
  public IQueryable<PerspectiveRow<TModel>> Query => _inner.Query;
  public Task<TModel?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
      _inner.GetByIdAsync(id, cancellationToken);

  public void Dispose() { /* disposes factory once, synchronously */ }

  public async ValueTask DisposeAsync() {
    if (!_disposed) {
      await _factory.DisposeAsync();
      _disposed = true;
    }
  }
}
```

This enables transient `ILensQuery<T>` registration:
- Each injection creates: Factory -> DbContext -> LensQuery
- DI container disposes `FactoryOwnedLensQuery`, which disposes factory, which disposes DbContext
- Thread-safe for parallel resolvers (each gets its own chain)

## See Also

- [Scoped Queries](scoped-queries.md) - Auto-scoping for singleton services
- [Temporal Queries](temporal-query.md) - Time-travel and history queries
- [Raw SQL Access](raw-sql.md) - Direct SQL execution
- [Vector Search](vector-search.md) - Similarity search
- [Perspectives](../perspectives/perspectives.md) - How read models are maintained
