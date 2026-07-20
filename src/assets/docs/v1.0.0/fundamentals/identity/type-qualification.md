---
title: "TypeQualifications: Type Name Formatting Control"
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: "Core Concepts"
order: 29
description: >-
  TypeQualifications is a flag enum that controls how .NET type names are formatted in generated code.
  Provides fine-grained control over namespace, assembly, version, and other type name components
  with composite presets for common scenarios.
tags: 'type-qualification, type-formatting, flags, source-generators, identity, aot'
codeReferences:
  - src/Whizbang.Core/TypeQualification.cs
  - src/Whizbang.Core/TypeFormatter.cs
testReferences:
  - tests/Whizbang.Core.Tests/TypeQualificationTests.cs
  - tests/Whizbang.Core.Tests/TypeFormatterTests.cs
lastMaintainedCommit: '01f07906'
---

# TypeQualifications: Type Name Formatting Control

TypeQualifications is a flag enum that controls how .NET type names are formatted in generated code. It enables fine-grained control over namespace, assembly, version, and other type name components. (The enum name is plural — `TypeQualifications` — while its source file is `TypeQualification.cs`.)

## Overview

**TypeQualifications** provides:
- ✅ Flag-based control over type name components
- ✅ Individual component flags for fine-grained control
- ✅ Composite presets for common scenarios
- ✅ Fully AOT-compatible (no reflection)
- ✅ Used by source generators and message association APIs

## Quick Start

### Using TypeQualifications Flags

```csharp{title="Using TypeQualifications Flags" description="Using TypeQualifications Flags" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Using", "TypeQualifications"] tests=["TypeFormatterTests.FormatType_Simple_ReturnsTypeNameOnlyAsync", "TypeFormatterTests.FormatType_NamespaceQualified_ReturnsFullNamespaceAsync", "TypeFormatterTests.FormatType_FullyQualified_ReturnsTypeWithAssemblyAsync", "TypeFormatterTests.FormatType_FullyQualifiedWithVersion_IncludesVersionInfoAsync"]}
using Whizbang.Core;

var type = typeof(ECommerce.Contracts.Events.ProductCreatedEvent);

// Simple type name only
var simple = TypeFormatter.FormatType(type, TypeQualifications.Simple);
// Result: "ProductCreatedEvent"

// Namespace + type name
var namespaced = TypeFormatter.FormatType(type, TypeQualifications.NamespaceQualified);
// Result: "ECommerce.Contracts.Events.ProductCreatedEvent"

// Namespace + type + assembly
var fullyQualified = TypeFormatter.FormatType(type, TypeQualifications.FullyQualified);
// Result: "ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts"

// With version information
var withVersion = TypeFormatter.FormatType(type, TypeQualifications.FullyQualifiedWithVersion);
// Result: "ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null"
```

### Combining Individual Flags

```csharp{title="Combining Individual Flags" description="Combining Individual Flags" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Combining", "Individual"] tests=["TypeFormatterTests.FormatType_FullyQualified_ReturnsTypeWithAssemblyAsync", "TypeFormatterTests.FormatType_GlobalQualified_AddsGlobalPrefixAsync"]}
// Custom combination: Namespace + Type + Assembly (no version)
var custom = TypeFormatter.FormatType(
    type,
    TypeQualifications.Namespace | TypeQualifications.TypeName | TypeQualifications.Assembly
);
// Result: "ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts"

// With global prefix
var globalQualified = TypeFormatter.FormatType(
    type,
    TypeQualifications.GlobalPrefix | TypeQualifications.Namespace | TypeQualifications.TypeName
);
// Result: "global::ECommerce.Contracts.Events.ProductCreatedEvent"
```

## Component Flags

### Individual Component Flags

Each flag controls a specific part of the type name:

| Flag | Value | Description |
|------|-------|-------------|
| `None` | 0 | Empty string (no components) |
| `TypeName` | 1 | Type name only (e.g., "ProductCreatedEvent") |
| `Namespace` | 2 | Namespace prefix (e.g., "ECommerce.Contracts.Events") |
| `Assembly` | 4 | Assembly name (e.g., "ECommerce.Contracts") |
| `Version` | 8 | Assembly version (e.g., "Version=1.0.0.0") |
| `Culture` | 16 | Culture info (e.g., "Culture=neutral") |
| `PublicKeyToken` | 32 | Public key token (e.g., "PublicKeyToken=null") |
| `GlobalPrefix` | 64 | Global namespace prefix (e.g., "global::") |

**Example - Combining Flags**:
```csharp{title="Individual Component Flags" description="Example - Combining Flags:" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "Individual", "Component"] tests=["TypeFormatterTests.FormatType_NamespaceQualified_ReturnsFullNamespaceAsync", "TypeFormatterTests.FormatType_CustomCombination_WorksCorrectlyAsync"]}
// Just namespace and type name
var flags = TypeQualifications.Namespace | TypeQualifications.TypeName;
var result = TypeFormatter.FormatType(typeof(OrderCreatedEvent), flags);
// Result: "MyApp.Events.OrderCreatedEvent"

// Type name with global prefix
var globalFlags = TypeQualifications.GlobalPrefix | TypeQualifications.TypeName;
var globalResult = TypeFormatter.FormatType(typeof(OrderCreatedEvent), globalFlags);
// Result: "global::OrderCreatedEvent"
```

### Composite Presets

Pre-defined combinations for common scenarios:

| Preset | Flags | Example Output |
|--------|-------|----------------|
| `Simple` | `TypeName` | `"ProductCreatedEvent"` |
| `NamespaceQualified` | `Namespace \| TypeName` | `"ECommerce.Contracts.Events.ProductCreatedEvent"` |
| `AssemblyQualified` | `TypeName \| Assembly` | `"ProductCreatedEvent, ECommerce.Contracts"` |
| `FullyQualified` | `Namespace \| TypeName \| Assembly` | `"ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts"` |
| `GlobalQualified` | `GlobalPrefix \| Namespace \| TypeName` | `"global::ECommerce.Contracts.Events.ProductCreatedEvent"` |
| `FullyQualifiedWithVersion` | All flags except `GlobalPrefix` | `"..., Version=1.0.0.0, Culture=neutral, PublicKeyToken=null"` |

**Example - Using Presets**:
```csharp{title="Composite Presets" description="Example - Using Presets:" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Composite", "Presets"] tests=["TypeFormatterTests.FormatType_Simple_ReturnsTypeNameOnlyAsync", "TypeFormatterTests.FormatType_FullyQualified_ReturnsTypeWithAssemblyAsync", "TypeFormatterTests.FormatType_GlobalQualified_AddsGlobalPrefixAsync"]}
var type = typeof(ProductCreatedEvent);

// Simple preset
var simple = TypeFormatter.FormatType(type, TypeQualifications.Simple);
// "ProductCreatedEvent"

// FullyQualified preset
var full = TypeFormatter.FormatType(type, TypeQualifications.FullyQualified);
// "ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts"

// GlobalQualified preset
var global = TypeFormatter.FormatType(type, TypeQualifications.GlobalQualified);
// "global::ECommerce.Contracts.Events.ProductCreatedEvent"
```

## Common Scenarios

### Scenario 1: Source Generator Output

**When**: Generating code that references types

```csharp{title="Scenario 1: Source Generator Output" description="When: Generating code that references types" category="Implementation" difficulty="ADVANCED" tags=["Fundamentals", "Identity", "Scenario", "Source"] tests=["TypeFormatterTests.FormatType_GlobalQualified_AddsGlobalPrefixAsync"]}
// Generate code with global::-qualified type names (avoids namespace conflicts)
var messageType = TypeFormatter.FormatType(
    typeof(OrderCreatedEvent),
    TypeQualifications.GlobalQualified
);

var generatedCode = $@"
    if (message is {messageType} orderCreated) {{
        return HandleOrderCreated(orderCreated);
    }}
";
// Output:
// if (message is global::ECommerce.Contracts.Events.OrderCreatedEvent orderCreated) {
//     return HandleOrderCreated(orderCreated);
// }
```

### Scenario 2: Message Association Lookup

**When**: Matching message types by name with different qualification levels

```csharp{title="Scenario 2: Message Association Lookup" description="When: Matching message types by name with different qualification levels" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Scenario", "Message"] tests=["TypeFormatterTests.FormatType_Simple_ReturnsTypeNameOnlyAsync", "TypeFormatterTests.FormatType_FullyQualified_ReturnsTypeWithAssemblyAsync"]}
// Lookup by simple name
var associations = GetMessageAssociations(serviceName)
    .Where(a => {
        var simpleName = TypeFormatter.FormatType(
            Type.GetType(a.MessageType)!,
            TypeQualifications.Simple
        );
        return simpleName == "ProductCreatedEvent";
    });

// Lookup by fully qualified name
var fullyQualifiedAssociations = GetMessageAssociations(serviceName)
    .Where(a => {
        var fullName = TypeFormatter.FormatType(
            Type.GetType(a.MessageType)!,
            TypeQualifications.FullyQualified
        );
        return fullName == "ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts";
    });
```

### Scenario 3: User-Facing Display

**When**: Showing type names in logs or UI

```csharp{title="Scenario 3: User-Facing Display" description="When: Showing type names in logs or UI" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Scenario", "User-Facing"] tests=["TypeFormatterTests.FormatType_Simple_ReturnsTypeNameOnlyAsync", "TypeFormatterTests.FormatType_FullyQualified_ReturnsTypeWithAssemblyAsync"]}
public void LogEventProcessing(Type eventType) {
    // Simple name for user-friendly display
    var displayName = TypeFormatter.FormatType(eventType, TypeQualifications.Simple);
    _logger.LogInformation("Processing event: {EventName}", displayName);
    // Output: "Processing event: ProductCreatedEvent"

    // Fully qualified for diagnostics
    var fullName = TypeFormatter.FormatType(eventType, TypeQualifications.FullyQualified);
    _logger.LogDebug("Full event type: {EventType}", fullName);
    // Output: "Full event type: ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts"
}
```

### Scenario 4: Version-Aware Type Matching

**When**: Matching types across different assembly versions

```csharp{title="Scenario 4: Version-Aware Type Matching" description="When: Matching types across different assembly versions" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Scenario", "Version-Aware"] tests=["TypeFormatterTests.FormatType_FullyQualified_ReturnsTypeWithAssemblyAsync", "TypeFormatterTests.FormatType_FullyQualifiedWithVersion_IncludesVersionInfoAsync"]}
// Format without version information
var typeWithoutVersion = TypeFormatter.FormatType(
    type,
    TypeQualifications.Namespace | TypeQualifications.TypeName | TypeQualifications.Assembly
);

// Format with version information
var typeWithVersion = TypeFormatter.FormatType(
    type,
    TypeQualifications.FullyQualifiedWithVersion
);

// Compare without version
bool matchesIgnoringVersion = TypeMatcher.Matches(
    typeWithoutVersion,
    "ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts",
    MatchStrictness.Exact
);
```

## Flag Enum Mechanics

### Bitwise Operations

TypeQualifications uses the `[Flags]` attribute, enabling bitwise operations:

```csharp{title="Bitwise Operations" description="TypeQualifications uses the [Flags] attribute, enabling bitwise operations:" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Bitwise", "Operations"] tests=["TypeQualificationTests.TypeQualification_ComponentFlags_CanBeCombinedAsync", "TypeQualificationTests.TypeQualification_IndividualFlags_HaveDistinctValuesAsync"]}
// Check if a flag is set
bool hasNamespace = (qualification & TypeQualifications.Namespace) == TypeQualifications.Namespace;
// OR
bool hasNamespaceAlt = qualification.HasFlag(TypeQualifications.Namespace);

// Add a flag
var withAssembly = qualification | TypeQualifications.Assembly;

// Remove a flag
var withoutVersion = qualification & ~TypeQualifications.Version;

// Toggle a flag
var toggled = qualification ^ TypeQualifications.GlobalPrefix;
```

### Building Qualification Dynamically

```csharp{title="Building Qualification Dynamically" description="Building Qualification Dynamically" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Building", "Qualification"] tests=["TypeQualificationTests.TypeQualification_ComponentFlags_CanBeCombinedAsync"]}
public TypeQualifications BuildQualification(
    bool includeNamespace,
    bool includeAssembly,
    bool includeVersion) {

    var result = TypeQualifications.TypeName; // Always include type name

    if (includeNamespace) {
        result |= TypeQualifications.Namespace;
    }

    if (includeAssembly) {
        result |= TypeQualifications.Assembly;
    }

    if (includeVersion) {
        result |= TypeQualifications.Version | TypeQualifications.Culture | TypeQualifications.PublicKeyToken;
    }

    return result;
}

// Usage
var qual = BuildQualification(
    includeNamespace: true,
    includeAssembly: true,
    includeVersion: false
);
// Result: TypeQualifications.Namespace | TypeQualifications.TypeName | TypeQualifications.Assembly
```

## Integration with TypeFormatter

TypeQualifications is designed to work seamlessly with TypeFormatter:

```csharp{title="Integration with TypeFormatter" description="TypeQualifications is designed to work seamlessly with TypeFormatter:" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Integration", "TypeFormatter"] tests=["TypeFormatterTests.FormatType_FullyQualified_ReturnsTypeWithAssemblyAsync", "TypeFormatterTests.FormatType_None_ReturnsEmptyStringAsync", "TypeFormatterTests.FormatType_CustomCombination_WorksCorrectlyAsync"]}
// TypeFormatter respects all flags
var formatted = TypeFormatter.FormatType(type, TypeQualifications.FullyQualified);

// Empty result for None
var empty = TypeFormatter.FormatType(type, TypeQualifications.None);
// Result: ""

// Handles combinations correctly
var custom = TypeFormatter.FormatType(
    type,
    TypeQualifications.GlobalPrefix | TypeQualifications.TypeName
);
// Result: "global::ProductCreatedEvent"
```

## API Reference

### Enum Definition

**Namespace**: `Whizbang.Core`

```csharp{title="Enum Definition" description="Namespace: `Whizbang." category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Enum", "Definition"] tests=["TypeQualificationTests.TypeQualification_IndividualFlags_HaveDistinctValuesAsync", "TypeQualificationTests.TypeQualification_None_HasValueZeroAsync", "TypeQualificationTests.TypeQualification_Simple_MapsToTypeNameOnlyAsync", "TypeQualificationTests.TypeQualification_NamespaceQualified_MapsToNamespaceAndTypeNameAsync", "TypeQualificationTests.TypeQualification_FullyQualified_MapToCorrectFlagsAsync", "TypeQualificationTests.TypeQualification_GlobalQualified_IncludesGlobalPrefixAsync", "TypeQualificationTests.TypeQualification_FullyQualifiedWithVersion_IncludesAllComponentsAsync"]}
[Flags]
public enum TypeQualifications {
  None = 0,

  // Component flags (individual bits)
  TypeName = 1 << 0,           // 1
  Namespace = 1 << 1,          // 2
  Assembly = 1 << 2,           // 4
  Version = 1 << 3,            // 8
  Culture = 1 << 4,            // 16
  PublicKeyToken = 1 << 5,     // 32
  GlobalPrefix = 1 << 6,       // 64

  // Composite presets (combinations)
  Simple = TypeName,
  NamespaceQualified = Namespace | TypeName,
  AssemblyQualified = TypeName | Assembly,
  FullyQualified = Namespace | TypeName | Assembly,
  GlobalQualified = GlobalPrefix | Namespace | TypeName,
  FullyQualifiedWithVersion = Namespace | TypeName | Assembly | Version | Culture | PublicKeyToken
}
```

### Usage with TypeFormatter

```csharp{title="Usage with TypeFormatter" description="Usage with TypeFormatter" category="Implementation" difficulty="INTERMEDIATE" tags=["Fundamentals", "Identity", "Usage", "TypeFormatter"] tests=["TypeFormatterTests.FormatType_Simple_ReturnsTypeNameOnlyAsync", "TypeFormatterTests.FormatType_FullyQualified_ReturnsTypeWithAssemblyAsync", "TypeFormatterTests.FormatType_NamespaceQualified_ReturnsFullNamespaceAsync"]}
// Format a type with qualification
string formatted = TypeFormatter.FormatType(Type type, TypeQualifications qualification);

// Examples
var simple = TypeFormatter.FormatType(typeof(OrderCreatedEvent), TypeQualifications.Simple);
var full = TypeFormatter.FormatType(typeof(OrderCreatedEvent), TypeQualifications.FullyQualified);
var custom = TypeFormatter.FormatType(
    typeof(OrderCreatedEvent),
    TypeQualifications.Namespace | TypeQualifications.TypeName
);
```

## Best Practices

1. **Use composite presets for common cases** - `Simple`, `FullyQualified`, etc. are easier to read
2. **Combine individual flags for custom needs** - Use bitwise OR for specific combinations
3. **Default to FullyQualified for generated code** - Avoids ambiguity in generated source
4. **Use Simple for user-facing displays** - More readable in logs and UI
5. **Consider IgnoreVersion for matching** - Combine with MatchStrictness for flexible type matching
6. **Use GlobalPrefix in generated code** - Avoids namespace conflicts with `global::`
7. **Cache formatted results when possible** - Formatting is deterministic, can be memoized

## Common Pitfalls

### ❌ Forgetting TypeName Flag

```csharp{title="❌ Forgetting TypeName Flag" description="❌ Forgetting TypeName Flag" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "Forgetting", "TypeName"] unverified="counter-example — the wrong branch omits TypeName and is intentionally invalid; the correct FullyQualified formatting is verified in the API Reference examples"}
// ❌ WRONG: Missing TypeName
var qual = TypeQualifications.Namespace | TypeQualifications.Assembly;
var result = TypeFormatter.FormatType(type, qual);
// Result: ", MyAssembly" - Invalid!

// ✅ CORRECT: Include TypeName
var qual = TypeQualifications.Namespace | TypeQualifications.TypeName | TypeQualifications.Assembly;
var result = TypeFormatter.FormatType(type, qual);
// Result: "MyNamespace.MyType, MyAssembly"
```

### ❌ Confusing Component Flags with Presets

```csharp{title="❌ Confusing Component Flags with Presets" description="❌ Confusing Component Flags with Presets" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "Confusing", "Component"] unverified="counter-example — pitfall illustrating flag-arithmetic style, not an assertable behavior; NamespaceQualified equivalence is verified in the Composite Presets examples"}
// ❌ WRONG: Trying to "remove" from a preset
var qualification = TypeQualifications.FullyQualified & ~TypeQualifications.Assembly;
// This works but is less clear

// ✅ CORRECT: Build from component flags
var qualification = TypeQualifications.Namespace | TypeQualifications.TypeName;
```

### ❌ Assuming Default Behavior

```csharp{title="❌ Assuming Default Behavior" description="❌ Assuming Default Behavior" category="Implementation" difficulty="BEGINNER" tags=["Fundamentals", "Identity", "Assuming", "Default"] unverified="counter-example — pitfall contrasting an assumed vs actual result; the underlying Simple/NamespaceQualified formatting is verified in the API Reference examples"}
// ❌ WRONG: Assuming default includes namespace
var formatted = TypeFormatter.FormatType(type, TypeQualifications.TypeName);
// Result: "ProductCreatedEvent" - No namespace!

// ✅ CORRECT: Explicit about what you want
var formatted = TypeFormatter.FormatType(type, TypeQualifications.NamespaceQualified);
// Result: "ECommerce.Contracts.Events.ProductCreatedEvent"
```

## See Also

- [TypeFormatter](type-formatting.md) - Formatting types according to qualification
- [MatchStrictness](fuzzy-matching.md) - Fuzzy matching with type qualification
- [TypeMatcher](type-matching.md) - Type matching utilities
- [Perspectives](../perspectives/perspectives.md) - Using type qualification in message associations
