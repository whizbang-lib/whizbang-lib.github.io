---
title: Multi-Model Queries
version: 1.0.0
category: Lenses
order: 4
description: >-
  LINQ joins across multiple perspective types using ILensQuery<T1, T2, ...> with shared DbContext
tags: 'lenses, multi-model, joins, linq, graphql, hotchocolate'
codeReferences:
  - src/Whizbang.Core/Lenses/ILensQuery.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCorePostgresLensQuery.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreInfrastructureRegistration.cs
---

# Multi-Model Queries

Multi-model queries enable LINQ joins across multiple perspective types using a shared `DbContext`. This is essential for GraphQL resolvers that need to combine data from different perspectives efficiently.

## The Problem: Separate DbContexts Cannot Join

When using single-generic `ILensQuery<T>`, each injection gets its own `DbContext`. This prevents LINQ joins across perspective types:

```csharp{title="The Problem: Separate DbContexts Cannot Join" description="When using single-generic ILensQuery<T>, each injection gets its own DbContext." category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "Problem:", "Separate"]}
// WRONG: Cannot join - different DbContexts
public class OrderResolver {
  public async Task<OrderWithCustomer> GetOrderWithCustomer(
      [Service] ILensQuery<Order> orders,
      [Service] ILensQuery<Customer> customers,
      Guid orderId,
      CancellationToken ct) {

    // This FAILS - EF Core cannot join queries from different DbContexts!
    var result = await (
        from o in orders.Query
        join c in customers.Query on o.Data.CustomerId equals c.Id
        where o.Id == orderId
        select new OrderWithCustomer(o.Data, c.Data)
    ).FirstOrDefaultAsync(ct);

    return result;
  }
}
```

## Solution: Multi-Generic ILensQuery

Use `ILensQuery<T1, T2>` (or up to 10 type parameters) to get a shared `DbContext` for all perspective types:

```csharp{title="Solution: Multi-Generic ILensQuery" description="Use ILensQuery<T1, T2> (or up to 10 type parameters) to get a shared DbContext for all perspective types:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "Solution:", "Multi-Generic"]}
// CORRECT: Shared DbContext enables LINQ joins
public class OrderResolver {
  public async Task<OrderWithCustomer> GetOrderWithCustomer(
      [Service] ILensQuery<Order, Customer> query,
      Guid orderId,
      CancellationToken ct) {

    var result = await (
        from o in query.Query<Order>()
        join c in query.Query<Customer>() on o.Data.CustomerId equals c.Id
        where o.Id == orderId
        select new OrderWithCustomer(o.Data, c.Data)
    ).FirstOrDefaultAsync(ct);

    return result;
  }
}
```

## Available Interfaces

Multi-generic interfaces support 2-10 type parameters:

```csharp{title="Available Interfaces" description="Multi-generic interfaces support 2-10 type parameters:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Available", "Interfaces"]}
public interface ILensQuery<T1, T2> : ILensQuery, IAsyncDisposable
    where T1 : class
    where T2 : class {

  IQueryable<PerspectiveRow<T>> Query<T>() where T : class;
  Task<T?> GetByIdAsync<T>(Guid id, CancellationToken ct = default) where T : class;
}

// Also available: ILensQuery<T1, T2, T3> through ILensQuery<T1, ..., T10>
```

## Type Safety

The `Query<T>()` method validates that `T` is one of the registered type parameters:

- **Compile-time**: The WHIZ400 analyzer reports errors for invalid types
- **Runtime**: Throws `ArgumentException` if type is not registered

```csharp{title="Type Safety" description="- Compile-time: The WHIZ400 analyzer reports errors for invalid types - Runtime: Throws ArgumentException if type is" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Type", "Safety"]}
// Using ILensQuery<Order, Customer>
query.Query<Order>();     // OK - Order is T1
query.Query<Customer>();  // OK - Customer is T2
query.Query<Product>();   // ERROR: WHIZ400 - Product is not T1 or T2
```

## Registration

Register multi-generic queries using `RegisterMultiLensQuery`:

```csharp{title="Registration" description="Register multi-generic queries using RegisterMultiLensQuery:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Registration"]}
// In your startup or source-generated code
EFCoreInfrastructureRegistration.RegisterMultiLensQuery<MyDbContext, Order, Customer>(
    services,
    new Dictionary<Type, string> {
      { typeof(Order), "orders_perspective" },
      { typeof(Customer), "customers_perspective" }
    });
```

> **Note**: Requires `IDbContextFactory<MyDbContext>` to be registered (via `AddDbContextFactory` or Whizbang's internal `ScopedDbContextFactory`).

## Transient Lifecycle

Multi-generic `ILensQuery` is registered as **Transient**:

- Each injection gets its own instance with its own `DbContext`
- Prevents concurrency errors in parallel GraphQL resolvers
- The `DbContext` is disposed when the `ILensQuery` is disposed

```csharp{title="Transient Lifecycle" description="- Each injection gets its own instance with its own DbContext - Prevents concurrency errors in parallel GraphQL" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "Transient", "Lifecycle"]}
// Each resolver invocation gets a fresh instance
public class OrderResolver {
  public async Task<Order> GetOrder(
      [Service] ILensQuery<Order, Customer> query, // Fresh instance
      Guid id,
      CancellationToken ct) {

    return await query.GetByIdAsync<Order>(id, ct);
  }

  public async Task<Customer> GetCustomer(
      [Service] ILensQuery<Order, Customer> query, // Different instance
      Guid id,
      CancellationToken ct) {

    return await query.GetByIdAsync<Customer>(id, ct);
  }
}
```

## Join Patterns

### Simple Join

```csharp{title="Simple Join" description="Demonstrates simple Join" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Simple", "Join"]}
var ordersWithCustomers = await (
    from o in query.Query<Order>()
    join c in query.Query<Customer>() on o.Data.CustomerId equals c.Id
    select new { Order = o.Data, Customer = c.Data }
).ToListAsync(ct);
```

### Left Join

```csharp{title="Left Join" description="Demonstrates left Join" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "Left", "Join"]}
var ordersWithOptionalCustomers = await (
    from o in query.Query<Order>()
    join c in query.Query<Customer>() on o.Data.CustomerId equals c.Id into customers
    from c in customers.DefaultIfEmpty()
    select new {
      Order = o.Data,
      Customer = c != null ? c.Data : null
    }
).ToListAsync(ct);
```

### Multiple Joins

```csharp{title="Multiple Joins" description="Demonstrates multiple Joins" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "Multiple", "Joins"]}
// Using ILensQuery<Order, Customer, Product>
var fullOrderDetails = await (
    from o in query.Query<Order>()
    join c in query.Query<Customer>() on o.Data.CustomerId equals c.Id
    join p in query.Query<Product>() on o.Data.ProductId equals p.Id
    select new {
      Order = o.Data,
      Customer = c.Data,
      Product = p.Data
    }
).ToListAsync(ct);
```

## AOT Compatibility

Multi-generic `ILensQuery` is fully AOT-compatible:

- No reflection at runtime
- `typeof(T) == typeof(T1)` comparisons are compile-time constants
- Source-generated registration code

## Disposal

Multi-generic `ILensQuery` implements `IAsyncDisposable` to properly dispose the shared `DbContext`:

```csharp{title="Disposal" description="Multi-generic ILensQuery implements IAsyncDisposable to properly dispose the shared DbContext:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Disposal"]}
// In DI scenarios, disposal is automatic
// For manual use:
await using var query = serviceProvider.GetRequiredService<ILensQuery<Order, Customer>>();
var result = await query.Query<Order>().ToListAsync();
// DbContext disposed when query is disposed
```

## See Also

- [WHIZ400 Diagnostic](/docs/diagnostics/whiz400) - Invalid type argument errors
- [Lens Query Factory](/docs/lenses/lens-query-factory) - DbContext sharing for parallel resolvers
- [Scoped Queries](/docs/lenses/scoped-queries) - Auto-scoping for singleton services
