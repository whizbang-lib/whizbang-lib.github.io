---
title: 'Serializable Property Analyzer'
pageType: troubleshooting
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
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
codeReferences:
  - src/Whizbang.Generators/SerializablePropertyAnalyzer.cs
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Core/Attributes/WhizbangSerializableAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/SerializablePropertyAnalyzerTests.cs
lastMaintainedCommit: '01f07906'
---

# Serializable Property Analyzer

The `SerializablePropertyAnalyzer` is a Roslyn analyzer that detects non-serializable properties on `ICommand` and `IEvent` types. It ensures AOT compatibility by flagging `object`, `dynamic`, and non-generic interface properties that cannot be serialized without runtime reflection.

## Overview

This analyzer runs during compilation and checks:

1. **Direct properties** on message types (`ICommand`, `IEvent`, or `[WhizbangSerializable]`)
2. **Nested types** - recursively checks child type properties
3. **Collection elements** - validates element types in arrays and generic collections

Only **public** types are analyzed — non-public types can't be serialized by the generated JSON contexts anyway. Properties inherited from base classes are included in the check.

## Supported Diagnostics

| ID | Severity | Description |
|---|---|---|
| WHIZ060 | Error | Property uses non-serializable type `object` |
| WHIZ061 | Error | Property uses non-serializable type `dynamic` |
| [WHIZ062](whiz062.md) | Error | Property uses non-serializable interface type |
| WHIZ063 | Error | Nested type contains non-serializable property |

## Why This Matters

System.Text.Json with source generation (AOT) cannot serialize:

- **`object` properties** - Runtime type is unknown at compile time
- **`dynamic` properties** - Requires DLR and runtime reflection
- **Non-generic interfaces** - Cannot determine concrete type at compile time

Using these types in messages causes runtime serialization failures in AOT-compiled applications.

## Example: Valid vs Invalid Properties

### Valid (AOT-Compatible)

```csharp{title="Valid (AOT-Compatible)" description="Valid (AOT-Compatible)" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Valid", "AOT-Compatible"]}
public record CreateOrderCommand : ICommand {
  public Guid OrderId { get; init; }
  public string CustomerName { get; init; } = string.Empty;
  public decimal TotalAmount { get; init; }
  public List<OrderLineItem> Items { get; init; } = [];
  public IReadOnlyList<string> Tags { get; init; } = [];  // Generic interface is OK
}
```

Note that the analyzer flags non-generic interfaces only; a generic interface like `IDictionary<string, object>` is not flagged even though its `object` values would still fail AOT serialization at runtime — prefer concrete value types there too.

### Invalid (Causes Diagnostics)

```csharp{title="Invalid (Causes Diagnostics)" description="Invalid (Causes Diagnostics)" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "C#", "Invalid", "Causes"]}
public record BadCommand : ICommand {
  public object Payload { get; init; }          // WHIZ060
  public dynamic Data { get; init; }            // WHIZ061
  public IEnumerable Items { get; init; }       // WHIZ062 (non-generic)
}
```

## Nested Type Checking

The analyzer recursively validates nested types:

```csharp{title="Nested Type Checking" description="The analyzer recursively validates nested types:" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Nested", "Type"]}
public record OrderCreated : IEvent {
  [StreamId]
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

```csharp{title="Whizbang Serializable Attribute" description="Types marked with [WhizbangSerializable] are also analyzed:" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Whizbang", "Serializable"]}
[WhizbangSerializable]
public record ProductDto {
  public Guid Id { get; init; }
  public object Extra { get; init; }  // WHIZ060: Still flagged
}
```

## Configuration

The analyzer is enabled by default. To suppress specific diagnostics:

### Per-Property Suppression

```csharp{title="Per-Property Suppression" description="Per-Property Suppression" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Per-Property", "Suppression"]}
#pragma warning disable WHIZ060
public object LegacyData { get; init; }
#pragma warning restore WHIZ060
```

### Project-Wide Suppression

In an `.editorconfig` (`NoWarn` does not suppress Error-severity diagnostics):

```ini{title="Project-Wide Suppression" description="Project-Wide Suppression" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Project-Wide", "Suppression"]}
[*.cs]
dotnet_diagnostic.WHIZ060.severity = none
dotnet_diagnostic.WHIZ061.severity = none
dotnet_diagnostic.WHIZ062.severity = none
dotnet_diagnostic.WHIZ063.severity = none
```

## Related Diagnostics

- WHIZ060 - Property uses `object` type
- WHIZ061 - Property uses `dynamic` type
- [WHIZ062](whiz062.md) - Property uses non-generic interface
- WHIZ063 - Nested type contains non-serializable property

## See Also

- AOT Compatibility - AOT design principles
- [Messages](../../fundamentals/messages/messages.md) - ICommand and IEvent documentation
- [JSON Contexts](../../extending/source-generators/json-contexts.md) - How Whizbang generates AOT-compatible serialization
