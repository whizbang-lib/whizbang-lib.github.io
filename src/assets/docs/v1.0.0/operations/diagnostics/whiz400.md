---
title: 'WHIZ400: Invalid Type Argument for ILensQuery'
description: >-
  Error diagnostic when Query<T>() or GetByIdAsync<T>() is called with an invalid type argument on multi-generic ILensQuery
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - lenses
  - multi-model
  - type-safety
  - analyzer
---

# WHIZ400: Invalid Type Argument for ILensQuery

**Severity**: Error
**Category**: Type Safety

## Description

This error is reported when calling `Query<T>()` or `GetByIdAsync<T>()` on a multi-generic `ILensQuery<T1, T2, ...>` with a type argument that is not one of the interface's registered type parameters.

The analyzer catches this error at compile time, preventing runtime `ArgumentException` errors.

## Diagnostic Message

```
Type '{TypeName}' is not valid for ILensQuery<{TypeParams}>. Valid types are: {ValidTypes}.
```

## Common Causes

1. **Wrong type argument** - Using a type that wasn't registered with the multi-generic interface
2. **Copy-paste error** - Copying code from a resolver using different perspective types
3. **Refactoring mistake** - Changed the interface type parameters but not the query calls

## How to Fix

Ensure the type argument to `Query<T>()` or `GetByIdAsync<T>()` is one of the interface's type parameters.

### Before (causes WHIZ400)

```csharp{title="Before (causes WHIZ400)" description="Demonstrates before (causes WHIZ400)" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Before", "Causes"]}
public class OrderResolver {
  public async Task<ProductDto> GetProduct(
      [Service] ILensQuery<Order, Customer> query, // Only Order and Customer
      Guid productId,
      CancellationToken ct) {

    // WHIZ400: Product is not valid for ILensQuery<Order, Customer>
    return await query.GetByIdAsync<Product>(productId, ct);
  }
}
```

### Fix Option 1: Use the correct interface

```csharp{title="Fix Option 1: Use the correct interface" description="Demonstrates fix Option 1: Use the correct interface" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Fix", "Option"]}
public class OrderResolver {
  public async Task<ProductDto> GetProduct(
      [Service] ILensQuery<Order, Customer, Product> query, // Added Product
      Guid productId,
      CancellationToken ct) {

    // OK - Product is T3
    return await query.GetByIdAsync<Product>(productId, ct);
  }
}
```

### Fix Option 2: Use separate single-generic query

```csharp{title="Fix Option 2: Use separate single-generic query" description="Demonstrates fix Option 2: Use separate single-generic query" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Fix", "Option"]}
public class OrderResolver {
  public async Task<ProductDto> GetProduct(
      [Service] ILensQuery<Product> productQuery, // Separate query for Product
      Guid productId,
      CancellationToken ct) {

    return await productQuery.GetByIdAsync(productId, ct);
  }
}
```

## Valid Usage Examples

```csharp{title="Valid Usage Examples" description="Demonstrates valid Usage Examples" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Valid", "Usage"]}
// ILensQuery<Order, Customer>
query.Query<Order>();      // OK - T1
query.Query<Customer>();   // OK - T2

// ILensQuery<Order, Customer, Product>
query.Query<Order>();      // OK - T1
query.Query<Customer>();   // OK - T2
query.Query<Product>();    // OK - T3
query.GetByIdAsync<Order>(id);     // OK
query.GetByIdAsync<Customer>(id);  // OK
query.GetByIdAsync<Product>(id);   // OK
```

## Suppressing This Diagnostic

In rare cases where you intentionally want to suppress this error (e.g., testing runtime exception behavior), use pragma suppression:

```csharp{title="Suppressing This Diagnostic" description="In rare cases where you intentionally want to suppress this error (e." category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Suppressing", "This"]}
#pragma warning disable WHIZ400 // Intentional invalid type for testing
var result = query.Query<InvalidType>();
#pragma warning restore WHIZ400
```

## Why This Matters

Without compile-time validation, invalid type arguments would cause runtime `ArgumentException`:

```
ArgumentException: Type 'Product' is not valid for this ILensQuery<Order, Customer>.
Valid types are: Order, Customer
```

The WHIZ400 analyzer catches these errors during compilation, providing immediate feedback in your IDE and preventing runtime failures.

## Runtime Behavior

Even without the analyzer, the runtime implementation validates type arguments:

```csharp{title="Runtime Behavior" description="Even without the analyzer, the runtime implementation validates type arguments:" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Runtime", "Behavior"]}
public IQueryable<PerspectiveRow<T>> Query<T>() where T : class {
  if (typeof(T) == typeof(T1)) {
    return (IQueryable<PerspectiveRow<T>>)(object)_context.Set<PerspectiveRow<T1>>().AsNoTracking();
  }
  if (typeof(T) == typeof(T2)) {
    return (IQueryable<PerspectiveRow<T>>)(object)_context.Set<PerspectiveRow<T2>>().AsNoTracking();
  }
  throw new ArgumentException(
      $"Type '{typeof(T).Name}' is not valid for this ILensQuery<{typeof(T1).Name}, {typeof(T2).Name}>. " +
      $"Valid types are: {typeof(T1).Name}, {typeof(T2).Name}");
}
```

## AOT Compatibility

The analyzer and runtime validation are both AOT-compatible:

- `typeof(T) == typeof(T1)` comparisons are compile-time constants
- No reflection used at runtime
- Source-generated analyzer runs during compilation

## See Also

- [Multi-Model Queries](/docs/lenses/multi-model-queries) - Using multi-generic ILensQuery for LINQ joins
- [Lens Query Factory](/docs/lenses/lens-query-factory) - DbContext sharing patterns
