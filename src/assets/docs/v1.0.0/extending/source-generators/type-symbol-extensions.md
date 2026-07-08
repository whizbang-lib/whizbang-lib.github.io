---
title: Type Symbol Extensions
version: 1.0.0
category: Source Generators
order: 11
description: >-
  Roslyn INamedTypeSymbol extension methods for walking type hierarchies -
  properties, methods, and attribute discovery across inheritance chains
tags: >-
  source-generators, roslyn, type-hierarchy, properties, methods, attributes,
  aot, utilities
codeReferences:
  - src/Whizbang.Generators.Shared/Utilities/TypeSymbolExtensions.cs
lastMaintainedCommit: '01f07906'
---

# Type Symbol Extensions

The **TypeSymbolExtensions** class provides extension methods for `INamedTypeSymbol` that handle inheritance hierarchies in Roslyn source generators. These utilities walk type hierarchies to extract properties, methods, and attribute-decorated members, with deduplication where derived class members take precedence.

## Why Type Hierarchy Utilities?

When a source generator analyzes a type, it often needs access to members declared in base classes - not just those on the immediate type. Roslyn's `GetMembers()` only returns members declared on that specific type, so walking the hierarchy requires boilerplate code.

| Problem | Impact |
|---------|--------|
| **Missing base class properties** | Generated code omits inherited properties from serialization or mapping |
| **Duplicate members** | Overridden members appear twice without deduplication |
| **Inconsistent hierarchy walking** | Each generator implements its own traversal with subtle differences |
| **Attribute discovery misses** | Attributes on base class members not found |

**Solution**: Centralized, tested extension methods shared across all generators via ILMerge.

---

## Available Methods

### GetAllProperties

Gets all properties from a type and its base types, deduplicated by name. Derived class properties take precedence over base class properties with the same name.

```csharp{title="GetAllProperties" description="Walk the inheritance chain to collect all properties" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "GetAllProperties"]}
public static IEnumerable<IPropertySymbol> GetAllProperties(
    this INamedTypeSymbol typeSymbol,
    bool includeNonPublic = false,
    bool includeStatic = false,
    bool stopAtSystemObject = true)
```

**Parameters**:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `includeNonPublic` | `false` | Include non-public (private, protected, internal) properties |
| `includeStatic` | `false` | Include static properties |
| `stopAtSystemObject` | `true` | Stop walking before `System.Object` |

**Example**:

```csharp{title="GetAllProperties Example" description="Collect all public instance properties including inherited ones" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "GetAllProperties", "Example"]}
// Given this hierarchy:
// class BaseModel { public Guid Id { get; set; } }
// class OrderView : BaseModel { public string Status { get; set; } }

var typeSymbol = semanticModel.GetDeclaredSymbol(classDecl) as INamedTypeSymbol;

// Gets both Id (from BaseModel) and Status (from OrderView)
var allProperties = typeSymbol.GetAllProperties();
// => [Status, Id]

// Include non-public properties
var allWithPrivate = typeSymbol.GetAllProperties(includeNonPublic: true);

// Include static properties
var allWithStatic = typeSymbol.GetAllProperties(includeStatic: true);
```

**Deduplication**: When a derived class declares a property with the same name as a base class property (e.g., `new` or `override`), only the derived version is returned.

---

### GetAllPublicPropertyNames

Convenience method that returns just the property names as a string array. Calls `GetAllProperties()` internally with default parameters (public, instance, stops at `System.Object`).

```csharp{title="GetAllPublicPropertyNames" description="Get property names as a string array for code generation" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "GetAllPublicPropertyNames"]}
public static string[] GetAllPublicPropertyNames(
    this INamedTypeSymbol typeSymbol)
```

**Example**:

```csharp{title="GetAllPublicPropertyNames Example" description="Quick access to property names for template generation" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "GetAllPublicPropertyNames", "Example"]}
var propertyNames = typeSymbol.GetAllPublicPropertyNames();
// => ["Status", "Id"]

// Useful in code generation templates
foreach (var name in propertyNames) {
  sb.AppendLine($"    {name} = source.{name},");
}
```

---

### FindPropertyWithAttribute

Searches for the first property decorated with a specific attribute, walking from the most derived type up to base classes.

```csharp{title="FindPropertyWithAttribute" description="Find the first property with a given attribute in the hierarchy" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "FindPropertyWithAttribute"]}
public static IPropertySymbol? FindPropertyWithAttribute(
    this INamedTypeSymbol typeSymbol,
    string attributeFullName,
    bool includeNonPublic = true)
```

**Parameters**:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `attributeFullName` | (required) | Fully qualified attribute name (e.g., `"global::Whizbang.Core.StreamIdAttribute"`) |
| `includeNonPublic` | `true` | Include non-public properties in the search |

**Example**:

```csharp{title="FindPropertyWithAttribute Example" description="Find the property marked with [StreamId] in a type hierarchy" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "FindPropertyWithAttribute", "Example"]}
// Given:
// class BaseAggregate { [StreamId] public Guid Id { get; set; } }
// class Order : BaseAggregate { public string Status { get; set; } }

var streamIdProperty = typeSymbol.FindPropertyWithAttribute(
    "global::Whizbang.Core.StreamIdAttribute");

// Returns the Id property from BaseAggregate
// streamIdProperty.Name => "Id"
// streamIdProperty.Type.Name => "Guid"
```

**Use case**: The aggregate ID generator uses this to discover which property carries the `[StreamId]` attribute, even when it is declared on a base class.

---

### GetAllMethods

Gets all ordinary methods from a type and its base types, deduplicated by signature (method name + parameter types). Derived class methods take precedence.

```csharp{title="GetAllMethods" description="Walk the inheritance chain to collect all methods" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "GetAllMethods"]}
public static IEnumerable<IMethodSymbol> GetAllMethods(
    this INamedTypeSymbol typeSymbol,
    bool includeNonPublic = false,
    bool includeStatic = false)
```

**Parameters**:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `includeNonPublic` | `false` | Include non-public methods |
| `includeStatic` | `false` | Include static methods |

**Filtering**: Special methods (constructors, property accessors, operators, etc.) are automatically excluded - only `MethodKind.Ordinary` methods are returned.

**Example**:

```csharp{title="GetAllMethods Example" description="Collect all ordinary methods including inherited ones" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "GetAllMethods", "Example"]}
var allMethods = typeSymbol.GetAllMethods();

foreach (var method in allMethods) {
  Console.WriteLine($"{method.Name}({string.Join(", ", method.Parameters.Select(p => p.Type.Name))})");
}
```

**Deduplication**: Methods are deduplicated by a signature key of `Name(ParamType1,ParamType2,...)`. When a derived class overrides a base class method, only the derived version appears.

---

### FindMethodWithAttribute

Searches for the first method decorated with a specific attribute, walking from the most derived type up to base classes.

```csharp{title="FindMethodWithAttribute" description="Find the first method with a given attribute in the hierarchy" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "FindMethodWithAttribute"]}
public static IMethodSymbol? FindMethodWithAttribute(
    this INamedTypeSymbol typeSymbol,
    string attributeFullName,
    bool includeNonPublic = true)
```

**Example**:

```csharp{title="FindMethodWithAttribute Example" description="Find a method marked with a specific attribute" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "FindMethodWithAttribute", "Example"]}
var initMethod = typeSymbol.FindMethodWithAttribute(
    "global::Whizbang.Core.InitializeAttribute");

if (initMethod is not null) {
  // Generate initialization call
  sb.AppendLine($"    instance.{initMethod.Name}();");
}
```

---

### GetAllMethodsByName

Gets all methods with a specific name from a type and its base types. This is useful for finding all overloads of a method, such as all `Apply` methods on a perspective class.

```csharp{title="GetAllMethodsByName" description="Find all overloads of a method by name across the hierarchy" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "GetAllMethodsByName"]}
public static IEnumerable<IMethodSymbol> GetAllMethodsByName(
    this INamedTypeSymbol typeSymbol,
    string methodName,
    bool includeNonPublic = false)
```

**Example**:

```csharp{title="GetAllMethodsByName Example" description="Find all Apply method overloads on a perspective" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "GetAllMethodsByName", "Example"]}
// Given a perspective with multiple Apply overloads:
// public OrderView Apply(OrderView model, OrderCreated @event) { ... }
// public OrderView Apply(OrderView model, OrderUpdated @event) { ... }

var applyMethods = typeSymbol.GetAllMethodsByName("Apply");

foreach (var method in applyMethods) {
  var eventType = method.Parameters[1].Type;
  sb.AppendLine($"    // Handles {eventType.Name}");
}
```

**Use case**: The perspective discovery generator uses this to find all `Apply` overloads and generate the appropriate event routing code.

---

## Usage in Generators

### Perspective Property Mapping

```csharp{title="Perspective Property Mapping" description="Use GetAllProperties to generate column mappings for a perspective model" category="Internals" difficulty="ADVANCED" tags=["Extending", "Source-Generators", "Perspective", "Properties"]}
private static void _generateColumnMappings(
    INamedTypeSymbol modelType,
    StringBuilder sb) {

  // Get all properties including inherited ones
  var properties = modelType.GetAllProperties();

  foreach (var property in properties) {
    var columnName = _toSnakeCase(property.Name);
    sb.AppendLine($"    builder.Property(x => x.{property.Name})");
    sb.AppendLine($"        .HasColumnName(\"{columnName}\");");
  }
}
```

### Aggregate ID Discovery

```csharp{title="Aggregate ID Discovery" description="Use FindPropertyWithAttribute to locate the stream ID property" category="Internals" difficulty="ADVANCED" tags=["Extending", "Source-Generators", "Aggregate", "StreamId"]}
private static string? _getStreamIdPropertyName(INamedTypeSymbol typeSymbol) {
  var property = typeSymbol.FindPropertyWithAttribute(
      "global::Whizbang.Core.StreamIdAttribute");

  return property?.Name;
}
```

### Event Handler Discovery

```csharp{title="Event Handler Discovery" description="Use GetAllMethodsByName to discover all Apply overloads" category="Internals" difficulty="ADVANCED" tags=["Extending", "Source-Generators", "Event", "Handlers"]}
private static List<EventHandlerInfo> _discoverApplyMethods(
    INamedTypeSymbol perspectiveType) {

  return perspectiveType
      .GetAllMethodsByName("Apply", includeNonPublic: true)
      .Select(m => new EventHandlerInfo(
          MethodName: m.Name,
          EventType: m.Parameters[1].Type.ToDisplayString(
              SymbolDisplayFormat.FullyQualifiedFormat),
          ModelType: m.ReturnType.ToDisplayString(
              SymbolDisplayFormat.FullyQualifiedFormat)
      ))
      .ToList();
}
```

---

## ILMerge Integration

`TypeSymbolExtensions` lives in `Whizbang.Generators.Shared`, which is ILMerged into all generator assemblies:

```
Whizbang.Generators.dll
  +-- Whizbang.Generators.Shared (merged)
      +-- TypeSymbolExtensions.cs

Whizbang.Data.EFCore.Postgres.Generators.dll
  +-- Whizbang.Generators.Shared (merged)
      +-- TypeSymbolExtensions.cs (same code!)
```

This ensures consistent hierarchy-walking behavior across all generators.

---

## AOT Compatibility

All extension methods use only Roslyn's Symbol APIs - **no reflection**:

| API Used | Source | AOT Safe |
|----------|--------|----------|
| `INamedTypeSymbol.GetMembers()` | Roslyn | Yes |
| `INamedTypeSymbol.BaseType` | Roslyn | Yes |
| `IPropertySymbol.DeclaredAccessibility` | Roslyn | Yes |
| `ISymbol.GetAttributes()` | Roslyn | Yes |
| `ITypeSymbol.ToDisplayString()` | Roslyn | Yes |

These methods run entirely at compile time within source generators and produce no runtime overhead.

---

## Testing

```csharp{title="Testing" description="Unit tests verify hierarchy walking and deduplication" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "Testing"]}
[Test]
public async Task GetAllProperties_WithInheritance_IncludesBasePropertiesAsync() {
  var source = @"
    public class BaseModel {
      public System.Guid Id { get; set; }
    }
    public class OrderView : BaseModel {
      public string Status { get; set; }
    }
  ";

  var compilation = GeneratorTestHelper.CreateCompilation(source);
  var typeSymbol = compilation.GetTypeByMetadataName("OrderView")!;

  var properties = typeSymbol.GetAllProperties().ToList();

  await Assert.That(properties).HasCount().EqualTo(2);
  await Assert.That(properties[0].Name).IsEqualTo("Status");  // Derived first
  await Assert.That(properties[1].Name).IsEqualTo("Id");      // Base second
}

[Test]
public async Task GetAllProperties_WithOverride_DeduplicatesByNameAsync() {
  var source = @"
    public class BaseModel {
      public virtual string Name { get; set; }
    }
    public class DerivedModel : BaseModel {
      public new string Name { get; set; }  // Hides base
      public int Extra { get; set; }
    }
  ";

  var compilation = GeneratorTestHelper.CreateCompilation(source);
  var typeSymbol = compilation.GetTypeByMetadataName("DerivedModel")!;

  var properties = typeSymbol.GetAllProperties().ToList();

  // Only derived Name appears (deduplicated)
  await Assert.That(properties).HasCount().EqualTo(2);
  await Assert.That(properties.Select(p => p.Name))
      .IsEquivalentTo(new[] { "Extra", "Name" });
}
```

---

## Related Documentation

- [Attribute Utilities](./attribute-utilities.md) - Shared utilities for extracting attribute values
- [Perspective Discovery](./perspective-discovery.md) - Uses TypeSymbolExtensions for model analysis
- [Aggregate IDs](./aggregate-ids.md) - Uses FindPropertyWithAttribute for [StreamId] discovery
- [Source Generator Configuration](./configuration.md) - Generator project settings

---

*Version 1.0.0 - Foundation Release*
