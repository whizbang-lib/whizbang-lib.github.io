---
title: 'WHIZ400: Invalid Type Argument for ILensQuery'
pageType: troubleshooting
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
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
codeReferences:
  - src/Whizbang.Data.EFCore.Postgres.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/LensQueryTypeArgumentAnalyzer.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCorePostgresLensQuery.cs
  - src/Whizbang.Data.EFCore.Postgres/MultiModelScopedAccess.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/LensQueryTypeArgumentAnalyzerTests.cs
lastMaintainedCommit: '01f07906'
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

```csharp{title="Before (causes WHIZ400)" description="Before (causes WHIZ400)" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Before", "Causes"] unverified="counter-example — the pattern WHIZ400 flags; detection verified by LensQueryTypeArgumentAnalyzerTests.GetByIdAsync_WithInvalidType_ReportsWHIZ400Async"}
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

```csharp{title="Fix Option 1: Use the correct interface" description="Fix Option 1: Use the correct interface" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Fix", "Option"] tests=["LensQueryTypeArgumentAnalyzerTests.ThreeGeneric_Query_WithT3_NoDiagnosticAsync"]}
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

```csharp{title="Fix Option 2: Use separate single-generic query" description="Fix Option 2: Use separate single-generic query" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Fix", "Option"] tests=["LensQueryTypeArgumentAnalyzerTests.SingleGenericILensQuery_NoDiagnosticAsync"]}
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

```csharp{title="Valid Usage Examples" description="Valid Usage Examples" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Valid", "Usage"] tests=["LensQueryTypeArgumentAnalyzerTests.Query_WithT1_NoDiagnosticAsync", "LensQueryTypeArgumentAnalyzerTests.Query_WithT2_NoDiagnosticAsync", "LensQueryTypeArgumentAnalyzerTests.ThreeGeneric_Query_WithT3_NoDiagnosticAsync", "LensQueryTypeArgumentAnalyzerTests.GetByIdAsync_WithT1_NoDiagnosticAsync"]}
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

```csharp{title="Suppressing This Diagnostic" description="In rare cases where you intentionally want to suppress this error (e." category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Suppressing", "This"] unverified="suppression/config — not exercised by a test"}
#pragma warning disable WHIZ400 // Intentional invalid type for testing
var result = query.Query<InvalidType>();
#pragma warning restore WHIZ400
```

## Why This Matters

Without compile-time validation, invalid type arguments would cause runtime `ArgumentException`:

```
ArgumentException: Type 'Product' is not valid. Valid types: Order, Customer
```

The WHIZ400 analyzer catches these errors during compilation, providing immediate feedback in your IDE and preventing runtime failures.

## Runtime Behavior

Even without the analyzer, the runtime implementation validates type arguments. Multi-generic lens queries delegate to `MultiModelScopedAccess<T1, T2, ...>`, which type-checks the argument against each registered type parameter:

```csharp{title="Runtime Behavior" description="Even without the analyzer, the runtime implementation validates type arguments:" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Runtime", "Behavior"]}
// MultiModelScopedAccess<T1, T2> (2-model case)
public IQueryable<PerspectiveRow<T>> Query<T>() where T : class {
  if (typeof(T) == typeof(T1)) {
    return (IQueryable<PerspectiveRow<T>>)(object)MultiModelScopeHelper.GetQuery<T1>(context, _filterInfo);
  }

  if (typeof(T) == typeof(T2)) {
    return (IQueryable<PerspectiveRow<T>>)(object)MultiModelScopeHelper.GetQuery<T2>(context, _filterInfo);
  }

  throw new ArgumentException($"Type '{typeof(T).Name}' is not valid. Valid types: {typeof(T1).Name}, {typeof(T2).Name}");
}
```

`GetByIdAsync<T>()` performs the same type check and throws `ArgumentException` with `Type '{T}' is not valid.` for an unregistered type.

## AOT Compatibility

The analyzer and runtime validation are both AOT-compatible:

- `typeof(T) == typeof(T1)` comparisons are compile-time constants
- No reflection used at runtime
- Source-generated analyzer runs during compilation

## See Also

- [Multi-Model Queries](../../fundamentals/lenses/multi-model-queries.md) - Using multi-generic ILensQuery for LINQ joins
- [Lens Query Factory](../../fundamentals/lenses/lens-query-factory.md) - DbContext sharing patterns
