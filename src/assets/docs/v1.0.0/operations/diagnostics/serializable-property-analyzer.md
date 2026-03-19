---
title: 'Serializable Property Analyzer'
description: >-
  Roslyn analyzer that detects non-serializable properties on ICommand/IEvent types
  for AOT compatibility
version: 1.0.0
category: Diagnostics
tags:
  - diagnostics
  - analyzer
  - serialization
  - aot
  - source-generator
---

# Serializable Property Analyzer

The `SerializablePropertyAnalyzer` is a Roslyn analyzer that detects non-serializable properties on `ICommand` and `IEvent` types. It ensures AOT compatibility by flagging `object`, `dynamic`, and non-generic interface properties that cannot be serialized without runtime reflection.

## Overview

This analyzer runs during compilation and checks:

1. **Direct properties** on message types (`ICommand`, `IEvent`, or `[WhizbangSerializable]`)
2. **Nested types** - recursively checks child type properties
3. **Collection elements** - validates element types in arrays and generic collections

## Supported Diagnostics

| ID | Severity | Description |
|---|---|---|
| [WHIZ060](whiz060.md) | Error | Property uses non-serializable type `object` |
| [WHIZ061](whiz061.md) | Error | Property uses non-serializable type `dynamic` |
| [WHIZ062](whiz062.md) | Error | Property uses non-serializable interface type |
| [WHIZ063](whiz063.md) | Error | Nested type contains non-serializable property |

## Why This Matters

System.Text.Json with source generation (AOT) cannot serialize:

- **`object` properties** - Runtime type is unknown at compile time
- **`dynamic` properties** - Requires DLR and runtime reflection
- **Non-generic interfaces** - Cannot determine concrete type at compile time

Using these types in messages causes runtime serialization failures in AOT-compiled applications.

## Example: Valid vs Invalid Properties

### Valid (AOT-Compatible)

```csharp
public record CreateOrderCommand : ICommand {
  public Guid OrderId { get; init; }
  public string CustomerName { get; init; } = string.Empty;
  public decimal TotalAmount { get; init; }
  public List<OrderLineItem> Items { get; init; } = [];
  public IReadOnlyList<string> Tags { get; init; } = [];  // Generic interface is OK
}
```

### Invalid (Causes Diagnostics)

```csharp
public record BadCommand : ICommand {
  public object Payload { get; init; }          // WHIZ060
  public dynamic Data { get; init; }            // WHIZ061
  public IEnumerable Items { get; init; }       // WHIZ062 (non-generic)
}
```

## Nested Type Checking

The analyzer recursively validates nested types:

```csharp
public record OrderCreated : IEvent {
  [StreamKey]
  public Guid OrderId { get; init; }
  public CustomerInfo Customer { get; init; }  // Nested type checked
}

public record CustomerInfo {
  public string Name { get; init; } = string.Empty;
  public object Metadata { get; init; }  // WHIZ063: Nested violation
}
```

## Whizbang Serializable Attribute

Types marked with `[WhizbangSerializable]` are also analyzed:

```csharp
[WhizbangSerializable]
public record ProductDto {
  public Guid Id { get; init; }
  public object Extra { get; init; }  // WHIZ060: Still flagged
}
```

## Configuration

The analyzer is enabled by default. To suppress specific diagnostics:

### Per-Property Suppression

```csharp
#pragma warning disable WHIZ060
public object LegacyData { get; init; }
#pragma warning restore WHIZ060
```

### Project-Wide Suppression

In your `.csproj`:

```xml
<PropertyGroup>
  <NoWarn>$(NoWarn);WHIZ060;WHIZ061;WHIZ062;WHIZ063</NoWarn>
</PropertyGroup>
```

## Related Diagnostics

- [WHIZ060](whiz060.md) - Property uses `object` type
- [WHIZ061](whiz061.md) - Property uses `dynamic` type
- [WHIZ062](whiz062.md) - Property uses non-generic interface
- [WHIZ063](whiz063.md) - Nested type contains non-serializable property

## See Also

- [AOT Compatibility](../deployment/aot-compatibility.md) - AOT design principles
- [Messages](../../fundamentals/messages/messages.md) - ICommand and IEvent documentation
- [Source Generators](../../extending/source-generators/overview.md) - How Whizbang uses source generation
