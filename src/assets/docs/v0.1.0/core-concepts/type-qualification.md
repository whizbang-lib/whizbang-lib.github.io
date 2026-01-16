# TypeQualification: Type Name Formatting Control

TypeQualification is a flag enum that controls how .NET type names are formatted in generated code. It enables fine-grained control over namespace, assembly, version, and other type name components.

## Overview

**TypeQualification** provides:
- ✅ Flag-based control over type name components
- ✅ Individual component flags for fine-grained control
- ✅ Composite presets for common scenarios
- ✅ Fully AOT-compatible (no reflection)
- ✅ Used by source generators and message association APIs

## Quick Start

### Using TypeQualification Flags

```csharp
using Whizbang.Core;

var type = typeof(ECommerce.Contracts.Events.ProductCreatedEvent);

// Simple type name only
var simple = TypeFormatter.FormatType(type, TypeQualification.Simple);
// Result: "ProductCreatedEvent"

// Namespace + type name
var namespaced = TypeFormatter.FormatType(type, TypeQualification.NamespaceQualified);
// Result: "ECommerce.Contracts.Events.ProductCreatedEvent"

// Namespace + type + assembly
var fullyQualified = TypeFormatter.FormatType(type, TypeQualification.FullyQualified);
// Result: "ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts"

// With version information
var withVersion = TypeFormatter.FormatType(type, TypeQualification.FullyQualifiedWithVersion);
// Result: "ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts, Version=1.0.0, Culture=neutral, PublicKeyToken=null"
```

### Combining Individual Flags

```csharp
// Custom combination: Namespace + Type + Assembly (no version)
var custom = TypeFormatter.FormatType(
    type,
    TypeQualification.Namespace | TypeQualification.TypeName | TypeQualification.Assembly
);
// Result: "ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts"

// With global prefix
var globalQualified = TypeFormatter.FormatType(
    type,
    TypeQualification.GlobalPrefix | TypeQualification.Namespace | TypeQualification.TypeName
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
| `Version` | 8 | Assembly version (e.g., "Version=1.0.0") |
| `Culture` | 16 | Culture info (e.g., "Culture=neutral") |
| `PublicKeyToken` | 32 | Public key token (e.g., "PublicKeyToken=null") |
| `GlobalPrefix` | 64 | Global namespace prefix (e.g., "global::") |

**Example - Combining Flags**:
```csharp
// Just namespace and type name
var flags = TypeQualification.Namespace | TypeQualification.TypeName;
var result = TypeFormatter.FormatType(typeof(OrderCreatedEvent), flags);
// Result: "MyApp.Events.OrderCreatedEvent"

// Type name with global prefix
var globalFlags = TypeQualification.GlobalPrefix | TypeQualification.TypeName;
var globalResult = TypeFormatter.FormatType(typeof(OrderCreatedEvent), globalFlags);
// Result: "global::OrderCreatedEvent"
```

### Composite Presets

Pre-defined combinations for common scenarios:

| Preset | Flags | Example Output |
|--------|-------|----------------|
| `Simple` | `TypeName` | `"ProductCreatedEvent"` |
| `NamespaceQualified` | `Namespace \| TypeName` | `"ECommerce.Contracts.Events.ProductCreatedEvent"` |
| `FullyQualified` | `Namespace \| TypeName \| Assembly` | `"ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts"` |
| `GlobalQualified` | `GlobalPrefix \| Namespace \| TypeName` | `"global::ECommerce.Contracts.Events.ProductCreatedEvent"` |
| `FullyQualifiedWithVersion` | All flags except `GlobalPrefix` | `"..., Version=1.0.0, Culture=neutral, PublicKeyToken=null"` |

**Example - Using Presets**:
```csharp
var type = typeof(ProductCreatedEvent);

// Simple preset
var simple = TypeFormatter.FormatType(type, TypeQualification.Simple);
// "ProductCreatedEvent"

// FullyQualified preset
var full = TypeFormatter.FormatType(type, TypeQualification.FullyQualified);
// "ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts"

// GlobalQualified preset
var global = TypeFormatter.FormatType(type, TypeQualification.GlobalQualified);
// "global::ECommerce.Contracts.Events.ProductCreatedEvent"
```

## Common Scenarios

### Scenario 1: Source Generator Output

**When**: Generating code that references types

```csharp
// Generate code with fully qualified type names
var messageType = TypeFormatter.FormatType(
    typeof(OrderCreatedEvent),
    TypeQualification.FullyQualified
);

var generatedCode = $@"
    if (messageType == typeof({messageType})) {{
        return HandleOrderCreated();
    }}
";
// Output:
// if (messageType == typeof(ECommerce.Contracts.Events.OrderCreatedEvent, ECommerce.Contracts)) {
//     return HandleOrderCreated();
// }
```

### Scenario 2: Message Association Lookup

**When**: Matching message types by name with different qualification levels

```csharp
// Lookup by simple name
var associations = GetMessageAssociations(serviceName)
    .Where(a => {
        var simpleName = TypeFormatter.FormatType(
            Type.GetType(a.MessageType)!,
            TypeQualification.Simple
        );
        return simpleName == "ProductCreatedEvent";
    });

// Lookup by fully qualified name
var fullyQualifiedAssociations = GetMessageAssociations(serviceName)
    .Where(a => {
        var fullName = TypeFormatter.FormatType(
            Type.GetType(a.MessageType)!,
            TypeQualification.FullyQualified
        );
        return fullName == "ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts";
    });
```

### Scenario 3: User-Facing Display

**When**: Showing type names in logs or UI

```csharp
public void LogEventProcessing(Type eventType) {
    // Simple name for user-friendly display
    var displayName = TypeFormatter.FormatType(eventType, TypeQualification.Simple);
    _logger.LogInformation("Processing event: {EventName}", displayName);
    // Output: "Processing event: ProductCreatedEvent"

    // Fully qualified for diagnostics
    var fullName = TypeFormatter.FormatType(eventType, TypeQualification.FullyQualified);
    _logger.LogDebug("Full event type: {EventType}", fullName);
    // Output: "Full event type: ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts"
}
```

### Scenario 4: Version-Aware Type Matching

**When**: Matching types across different assembly versions

```csharp
// Format without version information
var typeWithoutVersion = TypeFormatter.FormatType(
    type,
    TypeQualification.Namespace | TypeQualification.TypeName | TypeQualification.Assembly
);

// Format with version information
var typeWithVersion = TypeFormatter.FormatType(
    type,
    TypeQualification.FullyQualifiedWithVersion
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

TypeQualification uses the `[Flags]` attribute, enabling bitwise operations:

```csharp
// Check if a flag is set
bool hasNamespace = (qualification & TypeQualification.Namespace) == TypeQualification.Namespace;
// OR
bool hasNamespaceAlt = qualification.HasFlag(TypeQualification.Namespace);

// Add a flag
var withAssembly = qualification | TypeQualification.Assembly;

// Remove a flag
var withoutVersion = qualification & ~TypeQualification.Version;

// Toggle a flag
var toggled = qualification ^ TypeQualification.GlobalPrefix;
```

### Building Qualification Dynamically

```csharp
public TypeQualification BuildQualification(
    bool includeNamespace,
    bool includeAssembly,
    bool includeVersion) {

    var result = TypeQualification.TypeName; // Always include type name

    if (includeNamespace) {
        result |= TypeQualification.Namespace;
    }

    if (includeAssembly) {
        result |= TypeQualification.Assembly;
    }

    if (includeVersion) {
        result |= TypeQualification.Version | TypeQualification.Culture | TypeQualification.PublicKeyToken;
    }

    return result;
}

// Usage
var qual = BuildQualification(
    includeNamespace: true,
    includeAssembly: true,
    includeVersion: false
);
// Result: TypeQualification.Namespace | TypeQualification.TypeName | TypeQualification.Assembly
```

## Integration with TypeFormatter

TypeQualification is designed to work seamlessly with TypeFormatter:

```csharp
// TypeFormatter respects all flags
var formatted = TypeFormatter.FormatType(type, TypeQualification.FullyQualified);

// Empty result for None
var empty = TypeFormatter.FormatType(type, TypeQualification.None);
// Result: ""

// Handles combinations correctly
var custom = TypeFormatter.FormatType(
    type,
    TypeQualification.GlobalPrefix | TypeQualification.TypeName
);
// Result: "global::ProductCreatedEvent"
```

## API Reference

### Enum Definition

**Namespace**: `Whizbang.Core`

```csharp
[Flags]
public enum TypeQualification {
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
  FullyQualified = Namespace | TypeName | Assembly,
  GlobalQualified = GlobalPrefix | Namespace | TypeName,
  FullyQualifiedWithVersion = Namespace | TypeName | Assembly | Version | Culture | PublicKeyToken
}
```

### Usage with TypeFormatter

```csharp
// Format a type with qualification
string formatted = TypeFormatter.FormatType(Type type, TypeQualification qualification);

// Examples
var simple = TypeFormatter.FormatType(typeof(OrderCreatedEvent), TypeQualification.Simple);
var full = TypeFormatter.FormatType(typeof(OrderCreatedEvent), TypeQualification.FullyQualified);
var custom = TypeFormatter.FormatType(
    typeof(OrderCreatedEvent),
    TypeQualification.Namespace | TypeQualification.TypeName
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

```csharp
// ❌ WRONG: Missing TypeName
var qual = TypeQualification.Namespace | TypeQualification.Assembly;
var result = TypeFormatter.FormatType(type, qual);
// Result: ", MyAssembly" - Invalid!

// ✅ CORRECT: Include TypeName
var qual = TypeQualification.Namespace | TypeQualification.TypeName | TypeQualification.Assembly;
var result = TypeFormatter.FormatType(type, qual);
// Result: "MyNamespace.MyType, MyAssembly"
```

### ❌ Confusing Component Flags with Presets

```csharp
// ❌ WRONG: Trying to "remove" from a preset
var qualification = TypeQualification.FullyQualified & ~TypeQualification.Assembly;
// This works but is less clear

// ✅ CORRECT: Build from component flags
var qualification = TypeQualification.Namespace | TypeQualification.TypeName;
```

### ❌ Assuming Default Behavior

```csharp
// ❌ WRONG: Assuming default includes namespace
var formatted = TypeFormatter.FormatType(type, TypeQualification.TypeName);
// Result: "ProductCreatedEvent" - No namespace!

// ✅ CORRECT: Explicit about what you want
var formatted = TypeFormatter.FormatType(type, TypeQualification.NamespaceQualified);
// Result: "ECommerce.Contracts.Events.ProductCreatedEvent"
```

## See Also

- [TypeFormatter](/v0.1.0/core-concepts/type-formatting) - Formatting types according to qualification
- [MatchStrictness](/v0.1.0/core-concepts/fuzzy-matching) - Fuzzy matching with type qualification
- [TypeMatcher](/v0.1.0/core-concepts/type-matching) - Type matching utilities
- [Perspectives](/v0.1.0/core-concepts/perspectives) - Using type qualification in message associations
