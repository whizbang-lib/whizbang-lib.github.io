# TypeFormatter: Type Name Formatting Utility

TypeFormatter is a static utility class that formats .NET Type objects into string representations according to TypeQualification flags. It handles namespace, assembly, version, culture, and public key token formatting with culture-invariant output.

## Overview

**TypeFormatter** provides:
- ✅ Culture-invariant type name formatting
- ✅ Respects all TypeQualification flags
- ✅ Handles null types safely
- ✅ Fully AOT-compatible (no reflection beyond Type.GetName)
- ✅ Used by source generators and message association APIs

## Quick Start

### Basic Formatting

```csharp
using Whizbang.Core;

var type = typeof(ECommerce.Contracts.Events.ProductCreatedEvent);

// Format with preset
var simple = TypeFormatter.FormatType(type, TypeQualification.Simple);
Console.WriteLine(simple);
// Output: "ProductCreatedEvent"

var fullyQualified = TypeFormatter.FormatType(type, TypeQualification.FullyQualified);
Console.WriteLine(fullyQualified);
// Output: "ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts"

// Format with custom flags
var custom = TypeFormatter.FormatType(
    type,
    TypeQualification.Namespace | TypeQualification.TypeName
);
Console.WriteLine(custom);
// Output: "ECommerce.Contracts.Events.ProductCreatedEvent"
```

### Formatting with Version Information

```csharp
// Full assembly qualification with version
var withVersion = TypeFormatter.FormatType(
    type,
    TypeQualification.FullyQualifiedWithVersion
);
Console.WriteLine(withVersion);
// Output: "ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null"

// Without version
var withoutVersion = TypeFormatter.FormatType(
    type,
    TypeQualification.FullyQualified
);
Console.WriteLine(withoutVersion);
// Output: "ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts"
```

## Formatting Rules

### Component Order

TypeFormatter outputs components in this order:
1. **GlobalPrefix** (`global::`) - if flag is set
2. **Namespace** (`MyApp.Events`) - if flag is set
3. **Dot separator** (`.`) - if both Namespace and TypeName are set
4. **TypeName** (`ProductCreatedEvent`) - if flag is set
5. **Comma separator** (`, `) - if TypeName and Assembly are set
6. **Assembly** (`MyApp`) - if flag is set
7. **Version** (`, Version=1.0.0.0`) - if flag is set
8. **Culture** (`, Culture=neutral`) - if flag is set
9. **PublicKeyToken** (`, PublicKeyToken=null`) - if flag is set

### Flag Combinations

```csharp
var type = typeof(OrderCreatedEvent);

// TypeName only
var name = TypeFormatter.FormatType(type, TypeQualification.TypeName);
// Result: "OrderCreatedEvent"

// Namespace + TypeName
var ns = TypeFormatter.FormatType(
    type,
    TypeQualification.Namespace | TypeQualification.TypeName
);
// Result: "MyApp.Events.OrderCreatedEvent"

// GlobalPrefix + TypeName
var global = TypeFormatter.FormatType(
    type,
    TypeQualification.GlobalPrefix | TypeQualification.TypeName
);
// Result: "global::OrderCreatedEvent"

// GlobalPrefix + Namespace + TypeName
var globalFull = TypeFormatter.FormatType(
    type,
    TypeQualification.GlobalPrefix | TypeQualification.Namespace | TypeQualification.TypeName
);
// Result: "global::MyApp.Events.OrderCreatedEvent"

// Assembly without TypeName (edge case)
var assemblyOnly = TypeFormatter.FormatType(type, TypeQualification.Assembly);
// Result: "MyApp"

// None flag
var empty = TypeFormatter.FormatType(type, TypeQualification.None);
// Result: ""
```

## Culture-Invariant Formatting

TypeFormatter uses `CultureInfo.InvariantCulture` for all formatting to ensure consistent output across locales:

```csharp
// Version, Culture, and PublicKeyToken always use InvariantCulture
var withVersion = TypeFormatter.FormatType(
    type,
    TypeQualification.FullyQualifiedWithVersion
);

// Formatted string interpolation uses InvariantCulture
// This ensures version numbers, hex strings, etc. are consistent
// Example: "Version=1.0.0.0" not "Version=1,0,0,0" (some locales use commas)
```

## Common Scenarios

### Scenario 1: Source Generator Output

**When**: Generating C# code that references types

```csharp
public string GenerateEventHandler(Type eventType) {
    // Use GlobalQualified to avoid namespace conflicts
    var typeName = TypeFormatter.FormatType(
        eventType,
        TypeQualification.GlobalQualified
    );

    return $@"
public class GeneratedHandler {{
    public void Handle({typeName} evt) {{
        // Handle event
    }}
}}
";
}

// Output:
// public class GeneratedHandler {
//     public void Handle(global::ECommerce.Contracts.Events.ProductCreatedEvent evt) {
//         // Handle event
//     }
// }
```

### Scenario 2: Logging and Diagnostics

**When**: Displaying type information in logs

```csharp
public void LogTypeInfo(Type type) {
    // Simple name for user-friendly output
    var simple = TypeFormatter.FormatType(type, TypeQualification.Simple);
    _logger.LogInformation("Processing: {TypeName}", simple);

    // Fully qualified for diagnostic details
    var full = TypeFormatter.FormatType(type, TypeQualification.FullyQualified);
    _logger.LogDebug("Full type: {FullType}", full);

    // With version for complete diagnostics
    var withVersion = TypeFormatter.FormatType(
        type,
        TypeQualification.FullyQualifiedWithVersion
    );
    _logger.LogTrace("Type with version: {VersionedType}", withVersion);
}

// Output:
// Information: Processing: ProductCreatedEvent
// Debug: Full type: ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts
// Trace: Type with version: ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null
```

### Scenario 3: Configuration and Serialization

**When**: Storing type names in configuration or serializing to JSON

```csharp
public class EventConfiguration {
    // Store fully qualified name for reliable deserialization
    public string EventType { get; set; } = null!;
}

public EventConfiguration CreateConfig(Type eventType) {
    return new EventConfiguration {
        EventType = TypeFormatter.FormatType(
            eventType,
            TypeQualification.FullyQualified
        )
    };
}

// Later: Deserialize
public Type GetEventType(EventConfiguration config) {
    // Use fully qualified name for reliable Type.GetType()
    return Type.GetType(config.EventType)
        ?? throw new InvalidOperationException($"Type not found: {config.EventType}");
}
```

### Scenario 4: Dynamic Type Display

**When**: Building UI that shows type information

```csharp
public class TypeDisplayInfo {
    public string SimpleName { get; init; } = null!;
    public string FullName { get; init; } = null!;
    public string AssemblyName { get; init; } = null!;
}

public TypeDisplayInfo GetDisplayInfo(Type type) {
    return new TypeDisplayInfo {
        SimpleName = TypeFormatter.FormatType(type, TypeQualification.Simple),
        FullName = TypeFormatter.FormatType(type, TypeQualification.NamespaceQualified),
        AssemblyName = TypeFormatter.FormatType(type, TypeQualification.Assembly)
    };
}

// Usage in UI:
// Simple: "ProductCreatedEvent"
// Full: "ECommerce.Contracts.Events.ProductCreatedEvent"
// Assembly: "ECommerce.Contracts"
```

## Edge Cases and Special Handling

### Empty Namespace

```csharp
// Type with no namespace (global namespace)
public class GlobalType { }

var formatted = TypeFormatter.FormatType(
    typeof(GlobalType),
    TypeQualification.NamespaceQualified
);
// Result: "GlobalType" (no leading dot)
```

### Generic Types

```csharp
var genericType = typeof(List<OrderCreatedEvent>);

var formatted = TypeFormatter.FormatType(
    genericType,
    TypeQualification.FullyQualified
);
// Result: "System.Collections.Generic.List`1, System.Collections"
// Note: Generic type parameters are shown as `1, `2, etc.
```

### Nested Types

```csharp
public class OuterClass {
    public class InnerClass { }
}

var nestedType = typeof(OuterClass.InnerClass);
var formatted = TypeFormatter.FormatType(
    nestedType,
    TypeQualification.NamespaceQualified
);
// Result: "MyApp.OuterClass+InnerClass"
// Note: Nested types use '+' separator
```

### Public Key Token

```csharp
// Strong-named assembly
var strongType = typeof(System.String);

var withToken = TypeFormatter.FormatType(
    strongType,
    TypeQualification.FullyQualifiedWithVersion
);
// Result: "System.String, System.Private.CoreLib, Version=8.0.0.0, Culture=neutral, PublicKeyToken=7cec85d7bea7798e"

// Non-strong-named assembly
var weakType = typeof(MyApp.CustomType);

var withoutToken = TypeFormatter.FormatType(
    weakType,
    TypeQualification.FullyQualifiedWithVersion
);
// Result: "MyApp.CustomType, MyApp, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null"
```

## Performance Considerations

### StringBuilder Allocation

TypeFormatter uses `StringBuilder` internally for efficient string building:

```csharp
// Efficient - single StringBuilder allocation
var formatted = TypeFormatter.FormatType(type, TypeQualification.FullyQualified);

// Less efficient - multiple string concatenations
var manual = type.Namespace + "." + type.Name + ", " + type.Assembly.GetName().Name;
```

### Caching Formatted Results

Since type formatting is deterministic, consider caching results:

```csharp
public class CachedTypeFormatter {
    private readonly ConcurrentDictionary<(Type, TypeQualification), string> _cache = new();

    public string FormatType(Type type, TypeQualification qualification) {
        return _cache.GetOrAdd(
            (type, qualification),
            key => TypeFormatter.FormatType(key.Item1, key.Item2)
        );
    }
}
```

## Integration with Message Associations

TypeFormatter is used extensively in message association APIs:

```csharp
// Format event type for lookup
var eventType = typeof(ProductCreatedEvent);
var simpleType = TypeFormatter.FormatType(eventType, TypeQualification.Simple);

// Find perspectives handling this event (simple name)
var perspectives = PerspectiveRegistrationExtensions.GetPerspectivesForEvent(
    simpleType,
    serviceName,
    MatchStrictness.SimpleName
);

// Format for storage in message associations
var storedType = TypeFormatter.FormatType(eventType, TypeQualification.FullyQualified);
```

## API Reference

### Method Signature

**Namespace**: `Whizbang.Core`

```csharp
public static class TypeFormatter {
    /// <summary>
    /// Formats a Type according to the specified TypeQualification flags.
    /// Uses culture-invariant formatting for consistent output.
    /// </summary>
    /// <param name="type">The Type to format</param>
    /// <param name="qualification">Flags controlling which components to include</param>
    /// <returns>Formatted type name string</returns>
    /// <exception cref="ArgumentNullException">Thrown if type is null</exception>
    public static string FormatType(Type type, TypeQualification qualification);
}
```

### Parameters

- **type**: The `Type` object to format (cannot be null)
- **qualification**: `TypeQualification` flags controlling output format

### Return Value

- Returns formatted type name as `string`
- Returns empty string if `qualification` is `TypeQualification.None`
- Never returns null

### Exceptions

- **ArgumentNullException**: Thrown if `type` parameter is null

## Best Practices

1. **Use FullyQualified for persistence** - Ensures reliable deserialization with `Type.GetType()`
2. **Use Simple for user-facing displays** - More readable in UI and logs
3. **Use GlobalQualified in generated code** - Avoids namespace conflicts with `global::`
4. **Cache formatted results** - Formatting is expensive, memoize when calling frequently
5. **Use culture-invariant output** - TypeFormatter already does this, safe for serialization
6. **Avoid formatting in hot paths** - Pre-format and cache if used repeatedly
7. **Consider version implications** - Decide if version matching matters for your use case

## Common Pitfalls

### ❌ Formatting Null Types

```csharp
// ❌ WRONG: Null type
Type? nullType = null;
var formatted = TypeFormatter.FormatType(nullType!, TypeQualification.Simple);
// Throws: ArgumentNullException

// ✅ CORRECT: Check for null first
if (type != null) {
    var formatted = TypeFormatter.FormatType(type, TypeQualification.Simple);
}
```

### ❌ Assuming Default Format

```csharp
// ❌ WRONG: Assuming ToString() matches formatted output
var toString = type.ToString();
var formatted = TypeFormatter.FormatType(type, TypeQualification.FullyQualified);
// These may not match!

// ✅ CORRECT: Always use TypeFormatter for consistent results
var formatted = TypeFormatter.FormatType(type, TypeQualification.FullyQualified);
```

### ❌ Hardcoding Type Names

```csharp
// ❌ WRONG: Hardcoded type name
var typeName = "ECommerce.Contracts.Events.ProductCreatedEvent, ECommerce.Contracts";

// ✅ CORRECT: Use TypeFormatter
var typeName = TypeFormatter.FormatType(
    typeof(ProductCreatedEvent),
    TypeQualification.FullyQualified
);
```

### ❌ Ignoring Culture in Manual Formatting

```csharp
// ❌ WRONG: Culture-dependent formatting
var version = type.Assembly.GetName().Version;
var formatted = $"Version={version}"; // May use locale-specific format

// ✅ CORRECT: Use TypeFormatter with InvariantCulture
var formatted = TypeFormatter.FormatType(type, TypeQualification.FullyQualifiedWithVersion);
```

## See Also

- [TypeQualification](/v1.0.0/core-concepts/type-qualification) - Flag enum controlling formatting
- [MatchStrictness](/v1.0.0/core-concepts/fuzzy-matching) - Fuzzy matching with formatted types
- [TypeMatcher](/v1.0.0/core-concepts/type-matching) - Matching formatted type strings
- [Perspectives](/v1.0.0/core-concepts/perspectives) - Message associations using formatted types
