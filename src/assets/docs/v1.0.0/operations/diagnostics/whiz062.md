---
title: 'WHIZ062: Property Uses Non-Serializable Interface Type'
description: >-
  Error diagnostic when a message property uses a non-generic interface type
  that cannot be serialized for AOT
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - serialization
  - interface
  - aot
  - source-generator
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/SerializablePropertyAnalyzer.cs
---

# WHIZ062: Property Uses Non-Serializable Interface Type

**Severity**: Error
**Category**: Serialization Validation

## Description

This error occurs when a property on an `ICommand`, `IEvent`, or `[WhizbangSerializable]` type uses a non-generic interface type. Non-generic interfaces cannot be serialized with System.Text.Json source generation because the concrete type is not known at compile time.

## Diagnostic Message

```
Property 'Items' on 'CreateOrderCommand' uses interface type 'IEnumerable' which cannot be serialized for AOT. Use a concrete type or generic collection instead.
```

## Common Causes

1. **Using non-generic collection interfaces** - `IEnumerable`, `IList`, `ICollection` instead of their generic counterparts
2. **Custom non-generic interfaces** - User-defined interfaces without type parameters
3. **Legacy API compatibility** - Interfacing with older APIs that use non-generic types

## How to Fix

Replace non-generic interfaces with generic versions or concrete types:

### Before (causes WHIZ062)

```csharp{title="Before (causes WHIZ062)" description="Before (causes WHIZ062)" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Before", "Causes"]}
public record CreateOrderCommand : ICommand {
  public Guid OrderId { get; init; }
  public IEnumerable Items { get; init; }      // WHIZ062
  public IList LineItems { get; init; }        // WHIZ062
  public ICollection Tags { get; init; }       // WHIZ062
}
```

### After (error resolved)

```csharp{title="After (error resolved)" description="After (error resolved)" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "After", "Error"]}
public record CreateOrderCommand : ICommand {
  public Guid OrderId { get; init; }
  public IEnumerable<OrderItem> Items { get; init; } = [];
  public IList<LineItem> LineItems { get; init; } = [];
  public ICollection<string> Tags { get; init; } = [];
}
```

## Generic Interfaces Are Allowed

Generic interfaces with type parameters are serializable:

```csharp{title="Generic Interfaces Are Allowed" description="Generic interfaces with type parameters are serializable:" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Generic", "Interfaces"]}
public record ValidCommand : ICommand {
  // All OK - generic interfaces
  public IEnumerable<string> Tags { get; init; } = [];
  public IReadOnlyList<OrderItem> Items { get; init; } = [];
  public IDictionary<string, object> Metadata { get; init; } = new Dictionary<string, object>();
  public IReadOnlyCollection<Guid> Ids { get; init; } = [];
}
```

## Why This Matters

System.Text.Json with source generation requires knowing concrete types at compile time:

1. **Type Discovery** - Non-generic interfaces hide the actual runtime type
2. **AOT Compilation** - Cannot generate serialization code for unknown types
3. **Runtime Errors** - Would cause serialization failures in production

## Custom Interfaces

For custom interfaces, either:

1. **Make them generic** with type parameters
2. **Use concrete types** instead
3. **Mark with `[JsonDerivedType]`** for polymorphic serialization

### Example: Custom Interface Fix

```csharp{title="Example: Custom Interface Fix" description="Example: Custom Interface Fix" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Example:", "Custom"]}
// Before - non-generic interface
public interface IPaymentMethod { }

public record ProcessPaymentCommand : ICommand {
  public IPaymentMethod Payment { get; init; }  // WHIZ062
}

// After - use concrete type or generic wrapper
public record ProcessPaymentCommand : ICommand {
  public PaymentInfo Payment { get; init; }  // OK - concrete type
}
```

## Suppressing This Diagnostic

If you must use a non-generic interface:

```csharp{title="Suppressing This Diagnostic" description="If you must use a non-generic interface:" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Suppressing", "This"]}
#pragma warning disable WHIZ062
public IEnumerable LegacyItems { get; init; }
#pragma warning restore WHIZ062
```

Or in your `.csproj`:

```xml{title="Suppressing This Diagnostic (2)" description="Or in your `." category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Suppressing", "This"]}
<PropertyGroup>
  <NoWarn>$(NoWarn);WHIZ062</NoWarn>
</PropertyGroup>
```

## Related Diagnostics

- WHIZ060 - Property uses `object` type
- WHIZ061 - Property uses `dynamic` type
- WHIZ063 - Nested type contains non-serializable property
- [Serializable Property Analyzer](serializable-property-analyzer.md) - Analyzer overview

## See Also

- AOT Compatibility - AOT design principles
- [Messages](../../fundamentals/messages/messages.md) - ICommand and IEvent documentation
