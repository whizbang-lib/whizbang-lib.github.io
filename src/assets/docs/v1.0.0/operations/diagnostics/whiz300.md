---
title: 'WHIZ300: Inconsistent Perspective Model Types'
description: >-
  Error diagnostic when a perspective class implements multiple perspective
  interfaces with different TModel types
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - perspectives
  - model-consistency
  - type-safety
  - analyzer
codeReferences:
  - src/Whizbang.Generators/Analyzers/PerspectiveModelConsistencyAnalyzer.cs
---

# WHIZ300: Inconsistent Perspective Model Types

**Severity**: Error
**Category**: Perspective Validation

## Description

This error is reported when a class implements multiple `IPerspectiveFor<TModel, TEvent>` and/or `IPerspectiveWithActionsFor<TModel, TEvent>` interfaces with different `TModel` types. All perspective interfaces on a single class must share the same model type for the perspective runner to function correctly.

The `PerspectiveModelConsistencyAnalyzer` catches this at compile time, preventing runtime failures in the perspective runner.

## Diagnostic Message

```
Perspective '{ClassName}' implements multiple perspective interfaces with different model types: {ModelTypes}. All perspective interfaces on a class must use the same TModel type.
```

## Common Causes

1. **Copy-paste error** - Copying interface declarations from another perspective and forgetting to change the model type
2. **Refactoring mistake** - Renaming or splitting a model type without updating all interface declarations
3. **Accidental mixing** - Adding an interface for a different aggregate's model to the wrong perspective class

## How to Fix

Ensure every `IPerspectiveFor` and `IPerspectiveWithActionsFor` interface on the class uses the same `TModel` type argument.

### Before (causes WHIZ300)

```csharp{title="Before (causes WHIZ300)" description="Perspective with mismatched model types across interfaces" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Before", "Causes"]}
// WHIZ300: Different model types (OrderView vs ProductView)
public class OrderPerspective :
    IPerspectiveFor<OrderView, OrderCreated>,
    IPerspectiveWithActionsFor<ProductView, ProductDeleted> {

  public OrderView Apply(OrderView model, OrderCreated @event) {
    return model with { OrderId = @event.OrderId };
  }

  public ProductView Apply(ProductView model, ProductDeleted @event) {
    return model with { IsDeleted = true };
  }
}
```

### Fix Option 1: Use the same model type

```csharp{title="Fix Option 1: Use the same model type" description="All interfaces share the same TModel" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Fix", "Option"]}
public class OrderPerspective :
    IPerspectiveFor<OrderView, OrderCreated>,
    IPerspectiveWithActionsFor<OrderView, OrderDeleted> {

  public OrderView Apply(OrderView model, OrderCreated @event) {
    return model with { OrderId = @event.OrderId };
  }

  public OrderView Apply(OrderView model, OrderDeleted @event) {
    return model with { IsDeleted = true };
  }
}
```

### Fix Option 2: Split into separate perspective classes

```csharp{title="Fix Option 2: Split into separate perspectives" description="Each perspective class handles a single model type" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Fix", "Option"]}
public class OrderPerspective :
    IPerspectiveFor<OrderView, OrderCreated> {

  public OrderView Apply(OrderView model, OrderCreated @event) {
    return model with { OrderId = @event.OrderId };
  }
}

public class ProductPerspective :
    IPerspectiveWithActionsFor<ProductView, ProductDeleted> {

  public ProductView Apply(ProductView model, ProductDeleted @event) {
    return model with { IsDeleted = true };
  }
}
```

## Valid Usage Examples

```csharp{title="Valid Usage Examples" description="Multiple interfaces with the same TModel type" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Valid", "Usage"]}
// All interfaces use OrderView as TModel - no WHIZ300
public class OrderPerspective :
    IPerspectiveFor<OrderView, OrderCreated>,
    IPerspectiveFor<OrderView, OrderUpdated>,
    IPerspectiveWithActionsFor<OrderView, OrderDeleted>,
    IPerspectiveWithActionsFor<OrderView, OrderCancelled> {

  public OrderView Apply(OrderView model, OrderCreated @event) {
    return model with { OrderId = @event.OrderId, Status = "Created" };
  }

  public OrderView Apply(OrderView model, OrderUpdated @event) {
    return model with { Status = @event.NewStatus };
  }

  public OrderView Apply(OrderView model, OrderDeleted @event) {
    return model with { IsDeleted = true };
  }

  public OrderView Apply(OrderView model, OrderCancelled @event) {
    return model with { Status = "Cancelled" };
  }
}
```

## Suppressing This Diagnostic

In rare cases where you intentionally want to suppress this error (e.g., testing analyzer behavior), use pragma suppression:

```csharp{title="Suppressing This Diagnostic" description="Use pragma directives to suppress WHIZ300 in rare cases" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Suppressing", "This"]}
#pragma warning disable WHIZ300 // Intentional inconsistent model types for testing
public class TestPerspective :
    IPerspectiveFor<OrderView, OrderCreated>,
    IPerspectiveWithActionsFor<ProductView, ProductDeleted> { }
#pragma warning restore WHIZ300
```

You can also suppress via `.editorconfig`:

```ini
[*.cs]
dotnet_diagnostic.WHIZ300.severity = none
```

## Why This Matters

The perspective runner processes events by routing them to the correct `Apply` method on a perspective class. Internally, it resolves a single `TModel` per perspective instance. When a class declares multiple perspective interfaces with different model types, the runner cannot determine which model to use, resulting in a runtime failure:

```
InvalidOperationException: Perspective 'OrderPerspective' declares inconsistent model types.
Expected all interfaces to use the same TModel, but found: OrderView, ProductView.
```

The WHIZ300 analyzer moves this error to compile time, providing immediate feedback in your IDE.

## Analyzer Details

| Property | Value |
|----------|-------|
| **Diagnostic ID** | WHIZ300 |
| **Category** | Whizbang.PerspectiveValidation |
| **Default Severity** | Error |
| **Enabled by Default** | Yes |
| **Analyzer** | `PerspectiveModelConsistencyAnalyzer` |
| **ID Range** | WHIZ300-399 (perspective interface validation) |

The analyzer registers on `ClassDeclaration` syntax nodes and inspects all implemented interfaces. It only triggers when a class implements two or more perspective interfaces (`IPerspectiveFor<,>` or `IPerspectiveWithActionsFor<,>`) and the first type argument (`TModel`) differs between them.

## AOT Compatibility

The analyzer is fully AOT-compatible:

- Runs at compile time via Roslyn's `DiagnosticAnalyzer` infrastructure
- Uses `INamedTypeSymbol.AllInterfaces` for type discovery (no reflection)
- Concurrent execution enabled for performance

## See Also

- [Perspective Discovery](../../extending/source-generators/perspective-discovery.md) - Compile-time perspective registration
- [WHIZ400: Invalid Type Argument for ILensQuery](whiz400.md) - Related compile-time type validation

---

*Version 1.0.0 - Foundation Release*
