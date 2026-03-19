---
title: Lens Query Factory
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
---

# Lens Query Factory

The `ILensQueryFactory` provides thread-safe access to read models in scenarios where multiple queries may execute in parallel, such as HotChocolate GraphQL resolvers.

## The Problem: DbContext Concurrency

EF Core's `DbContext` is **not thread-safe**. When HotChocolate runs field resolvers in parallel within the same HTTP request scope, all resolvers share the same scoped `DbContext` instance:

```csharp
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

```csharp
// Each resolver gets its OWN DbContext - safe for parallel execution
public class CatalogQueries {
  public async Task<IEnumerable<Product>> GetProducts([Service] ILensQuery<Product> lens) {
    return await lens.Query.Select(r => r.Data).ToListAsync();
  }

  public async Task<IEnumerable<Order>> GetOrders([Service] ILensQuery<Order> lens) {
    return await lens.Query.Select(r => r.Data).ToListAsync();
  }
}
```

No special configuration needed - it just works.

## When to Use ILensQueryFactory

Use `ILensQueryFactory` when you need multiple queries to **share the same DbContext**, typically for:

- **Cross-model joins** - Joining data from different perspective tables
- **Transactional consistency** - Reading related data within a single transaction
- **Batch operations** - Multiple queries that should use one connection

```csharp
public class OrderWithCustomerQuery {
  public async Task<OrderWithCustomer?> GetOrderWithCustomer(
      Guid orderId,
      [Service] ILensQueryFactory factory) {

    // Both queries share the SAME DbContext
    var orderQuery = factory.GetQuery<Order>();
    var customerQuery = factory.GetQuery<Customer>();

    var result = await (
        from o in orderQuery.Query
        join c in customerQuery.Query on o.Data.CustomerId equals c.Id
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
| Cross-model joins | `ILensQueryFactory` | Shared DbContext |
| Batch reads | `ILensQueryFactory` | Shared DbContext |

### Pattern 1: Direct Injection (Most Common)

For most queries, inject `ILensQuery<T>` directly:

```csharp
[QueryType]
public class ProductQueries {
  public IQueryable<Product> GetProducts([Service] ILensQuery<Product> lens) =>
      lens.Query.Select(r => r.Data);

  public async Task<Product?> GetProduct(Guid id, [Service] ILensQuery<Product> lens) =>
      await lens.GetByIdAsync(id);
}
```

### Pattern 2: Factory for Joins

When joining across models, inject `ILensQueryFactory`:

```csharp
public class InventoryReportQuery {
  public async Task<IEnumerable<InventoryReport>> GetInventoryReport(
      [Service] ILensQueryFactory factory) {

    var products = factory.GetQuery<Product>();
    var inventory = factory.GetQuery<InventoryLevel>();

    return await (
        from p in products.Query
        join i in inventory.Query on p.Id equals i.Data.ProductId
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

For repository classes that need joins:

```csharp
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
        from o in _orders.Query
        join c in _customers.Query on o.Data.CustomerId equals c.Id
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

```csharp
builder.Services
  .AddWhizbang()
  .WithEFCore<MyDbContext>()
  .WithDriver.Postgres;

// ILensQuery<T> - transient (each injection = new DbContext)
// ILensQueryFactory - transient (each injection = new factory = new DbContext)
```

## AOT Compatibility

`ILensQueryFactory` is fully AOT-compatible:
- Uses dictionary lookup for table names (no reflection)
- All type information resolved at compile-time by source generators
- Works with NativeAOT publishing

## Important Notes

1. **Disposal**: `ILensQueryFactory` implements `IAsyncDisposable`. The DI container handles disposal automatically.

2. **Lifetime**: Both `ILensQuery<T>` and `ILensQueryFactory` are transient. Each injection creates a new instance.

3. **Thread Safety**: `ILensQuery<T>` is safe for parallel use because each injection gets its own DbContext. Do NOT share a single `ILensQuery<T>` instance across threads.

4. **Pooling**: DbContext instances come from EF Core's connection pool, so creating many contexts is efficient.

## Implementation Details

### ScopedDbContextFactory

The `ScopedDbContextFactory<TContext>` is a singleton implementation of `IDbContextFactory<T>` that creates DbContext instances via service scopes:

```csharp
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

```csharp
public sealed class EFCoreLensQueryFactory<TDbContext> : ILensQueryFactory
    where TDbContext : DbContext {

  private readonly TDbContext _context;
  private readonly IReadOnlyDictionary<Type, string> _tableNames;

  public EFCoreLensQueryFactory(
      IDbContextFactory<TDbContext> dbContextFactory,
      IReadOnlyDictionary<Type, string> tableNames) {

    _context = dbContextFactory.CreateDbContext();
    _tableNames = tableNames;
  }

  public ILensQuery<TModel> GetQuery<TModel>() where TModel : class {
    var tableName = _tableNames[typeof(TModel)];
    return new EFCorePostgresLensQuery<TModel>(_context, tableName);
  }

  public async ValueTask DisposeAsync() {
    await _context.DisposeAsync();
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

```csharp
public sealed class FactoryOwnedLensQuery<TModel> : ILensQuery<TModel>, IAsyncDisposable, IDisposable
    where TModel : class {

  private readonly ILensQueryFactory _factory;
  private readonly ILensQuery<TModel> _inner;

  public FactoryOwnedLensQuery(ILensQueryFactory factory) {
    _factory = factory;
    _inner = factory.GetQuery<TModel>();
  }

  public IQueryable<PerspectiveRow<TModel>> Query => _inner.Query;

  public Task<TModel?> GetByIdAsync(Guid id, CancellationToken ct = default) =>
      _inner.GetByIdAsync(id, ct);

  public async ValueTask DisposeAsync() {
    await _factory.DisposeAsync();
  }
}
```

This enables transient `ILensQuery<T>` registration:
- Each injection creates: Factory -> DbContext -> LensQuery
- DI container disposes `FactoryOwnedLensQuery`, which disposes factory, which disposes DbContext
- Thread-safe for parallel resolvers (each gets its own chain)

## See Also

- [Scoped Queries](/docs/lenses/scoped-queries) - Auto-scoping for singleton services
- [Temporal Queries](/docs/lenses/temporal-query) - Time-travel and history queries
- [Raw SQL Access](/docs/lenses/raw-sql) - Direct SQL execution
- [Vector Search](/docs/lenses/vector-search) - Similarity search
- [Perspectives](/docs/components/perspectives) - How read models are maintained
