---
title: Attribute Utilities
version: 1.0.0
category: Source Generators
order: 10
description: >-
  Shared utilities for extracting attribute values in Roslyn source generators -
  supports named arguments, constructor arguments, and mixed syntax
tags: >-
  source-generators, attributes, roslyn, aot, compile-time, utilities
codeReferences:
  - src/Whizbang.Generators.Shared/Utilities/AttributeUtilities.cs
  - src/Whizbang.Generators/MessageTagDiscoveryGenerator.cs
lastMaintainedCommit: '01f07906'
---

# Attribute Utilities

The **AttributeUtilities** class provides shared utilities for extracting attribute values in Roslyn source generators. It supports all C# attribute parameter patterns - named arguments, constructor arguments, and mixed syntax - while remaining fully AOT-compatible.

## Why Shared Utilities?

C# attributes can receive values through multiple syntax patterns:

```csharp{title="Why Shared Utilities?" description="C# attributes can receive values through multiple syntax patterns:" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "Why", "Shared"]}
// Named arguments
[AuditEvent(Tag = "order-created", Exclude = true)]
public record OrderCreated(Guid OrderId);

// Constructor arguments
[TenantTag("tenants")]
public record TenantCreated(Guid TenantId);

// Mixed syntax (named takes precedence)
[DomainTag("ignored", Tag = "inventory")]
public record InventoryUpdated(Guid ProductId);
```

Without shared utilities, each generator must implement its own extraction logic, leading to:

| Problem | Impact |
|---------|--------|
| **Code duplication** | Same extraction logic in multiple generators |
| **Inconsistent behavior** | Some generators miss constructor arguments |
| **Maintenance burden** | Fixing bugs requires changes in multiple places |
| **Testing overhead** | Each implementation needs its own tests |

**Solution**: Centralized utilities shared across ALL generators via ILMerge.

---

## How It Works

### 1. Roslyn AttributeData

The `AttributeData` type exposes attribute values through two properties:

```
AttributeData
├── NamedArguments      → KeyValuePairs for named arguments
│   └── [Tag = "value", Exclude = true]
└── ConstructorArguments → Indexed values from constructor
    └── ["value", true]  (positional)
```

### 2. Value Precedence

Named arguments always take precedence over constructor arguments:

```csharp{title="Value Precedence" description="Named arguments always take precedence over constructor arguments:" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "Value", "Precedence"]}
// Given this attribute usage:
[MyTag("from-ctor", Tag = "from-named")]

// AttributeUtilities returns "from-named" for Tag
// Named argument overrides constructor argument
```

### 3. Case-Insensitive Parameter Matching

Constructor parameters are matched case-insensitively to property names:

```csharp{title="Case-Insensitive Parameter Matching" description="Constructor parameters are matched case-insensitively to property names:" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "Case-Insensitive", "Parameter"]}
// Attribute definition
public class TenantTagAttribute : MessageTagAttribute {
  public TenantTagAttribute(string tag) {  // lowercase "tag"
    Tag = tag;                              // PascalCase "Tag"
  }
}

// Usage
[TenantTag("tenants")]

// AttributeUtilities.GetStringValue(attr, "Tag") returns "tenants"
// Matches "tag" parameter to "Tag" property
```

---

## Available Methods

### GetStringValue

Extracts a string property value from an attribute.

```csharp{title="GetStringValue" description="Extracts a string property value from an attribute." category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "GetStringValue"]}
public static string? GetStringValue(
    AttributeData attribute,
    string propertyName)
```

**Example**:

```csharp{title="GetStringValue (2)" description="GetStringValue" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "GetStringValue"]}
// Named argument
[NotificationTag(Tag = "orders")]
var tag = AttributeUtilities.GetStringValue(attr, "Tag");  // "orders"

// Constructor argument
[TenantTag("tenants")]
var tag = AttributeUtilities.GetStringValue(attr, "Tag");  // "tenants"

// Missing property
[NotificationTag]
var tag = AttributeUtilities.GetStringValue(attr, "Tag");  // null
```

---

### GetBoolValue

Extracts a boolean property value from an attribute.

```csharp{title="GetBoolValue" description="Extracts a boolean property value from an attribute." category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "GetBoolValue"]}
public static bool GetBoolValue(
    AttributeData attribute,
    string propertyName,
    bool defaultValue)
```

**Example**:

```csharp{title="GetBoolValue (2)" description="GetBoolValue" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "GetBoolValue"]}
// Named argument
[AuditEvent(Exclude = true)]
var exclude = AttributeUtilities.GetBoolValue(attr, "Exclude", false);  // true

// Constructor argument
[SelectiveAudit("payments", true)]
var exclude = AttributeUtilities.GetBoolValue(attr, "Exclude", false);  // true

// Missing property - returns default
[AuditEvent(Tag = "orders")]
var exclude = AttributeUtilities.GetBoolValue(attr, "Exclude", false);  // false
```

---

### GetIntValue

Extracts an integer property value from an attribute.

```csharp{title="GetIntValue" description="Extracts an integer property value from an attribute." category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "GetIntValue"]}
public static int GetIntValue(
    AttributeData attribute,
    string propertyName,
    int defaultValue)
```

**Example**:

```csharp{title="GetIntValue (2)" description="GetIntValue" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "GetIntValue"]}
// Named argument
[RetryPolicy(MaxAttempts = 5)]
var attempts = AttributeUtilities.GetIntValue(attr, "MaxAttempts", 3);  // 5

// Constructor argument
[PriorityTag("orders", 100)]
var priority = AttributeUtilities.GetIntValue(attr, "Priority", 0);  // 100

// Missing property - returns default
[NotificationTag(Tag = "orders")]
var priority = AttributeUtilities.GetIntValue(attr, "Priority", 50);  // 50
```

---

### GetStringArrayValue

Extracts a string array property value from an attribute.

```csharp{title="GetStringArrayValue" description="Extracts a string array property value from an attribute." category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "GetStringArrayValue"]}
public static string[]? GetStringArrayValue(
    AttributeData attribute,
    string propertyName)
```

**Example**:

```csharp{title="GetStringArrayValue (2)" description="GetStringArrayValue" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "GetStringArrayValue"]}
// Named argument
[NotificationTag(Properties = new[] { "OrderId", "CustomerId" })]
var props = AttributeUtilities.GetStringArrayValue(attr, "Properties");
// ["OrderId", "CustomerId"]

// Constructor argument
[SelectiveTag("users", new[] { "UserId", "Email" })]
var props = AttributeUtilities.GetStringArrayValue(attr, "Properties");
// ["UserId", "Email"]

// Missing property
[NotificationTag(Tag = "orders")]
var props = AttributeUtilities.GetStringArrayValue(attr, "Properties");
// null
```

---

## Usage in Generators

### MessageTagDiscoveryGenerator Example

```csharp{title="MessageTagDiscoveryGenerator Example" description="MessageTagDiscoveryGenerator Example" category="Internals" difficulty="ADVANCED" tags=["Extending", "Source-Generators", "MessageTagDiscoveryGenerator", "Example"]}
private static MessageTagInfo? _extractTagInfo(
    GeneratorSyntaxContext context,
    CancellationToken ct) {

  var typeDecl = (TypeDeclarationSyntax)context.Node;
  var typeSymbol = context.SemanticModel.GetDeclaredSymbol(typeDecl, ct);

  if (typeSymbol is null) {
    return null;
  }

  // Find the tag attribute
  var tagAttribute = typeSymbol.GetAttributes()
      .FirstOrDefault(a => _inheritsFromMessageTagAttribute(a.AttributeClass));

  if (tagAttribute is null) {
    return null;
  }

  // Extract values using shared utilities
  // Works with both constructor and named arguments!
  var tag = AttributeUtilities.GetStringValue(tagAttribute, "Tag") ?? "";
  var properties = AttributeUtilities.GetStringArrayValue(tagAttribute, "Properties");
  var extraJson = AttributeUtilities.GetStringValue(tagAttribute, "ExtraJson");

  // Skip excluded types
  var exclude = AttributeUtilities.GetBoolValue(tagAttribute, "Exclude", false);
  if (exclude) {
    return null;
  }

  return new MessageTagInfo(
      Tag: tag,
      Properties: properties,
      ExtraJson: extraJson,
      // ... other properties
  );
}
```

---

## Creating Custom Attributes

When creating custom attributes that inherit from Whizbang base attributes, you can use any C# parameter syntax:

### Named-Only Pattern

```csharp{title="Named-Only Pattern" description="Named-Only Pattern" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "Named-Only", "Pattern"]}
// Attribute with required init properties (C# 11+)
public class NotificationTagAttribute : MessageTagAttribute {
  public required string Tag { get; init; }
  public string[]? Properties { get; init; }
}

// Usage
[NotificationTag(Tag = "orders", Properties = ["OrderId"])]
public record OrderCreated(Guid OrderId);
```

### Constructor Pattern

```csharp{title="Constructor Pattern" description="Constructor Pattern" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "Constructor", "Pattern"]}
// Attribute with constructor parameter
public class TenantTagAttribute : MessageTagAttribute {
  public TenantTagAttribute(string tag) {
    Tag = tag;
  }
}

// Usage
[TenantTag("tenants")]
public record TenantCreated(Guid TenantId);
```

### Mixed Pattern

```csharp{title="Mixed Pattern" description="Mixed Pattern" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "Mixed", "Pattern"]}
// Attribute with constructor + optional named arguments
public class DomainTagAttribute : MessageTagAttribute {
  public DomainTagAttribute(string tag) {
    Tag = tag;
  }

  public string[]? Properties { get; set; }
}

// Usage - constructor for required, named for optional
[DomainTag("inventory", Properties = new[] { "ProductId" })]
public record InventoryUpdated(Guid ProductId, int Quantity);
```

---

## AOT Compatibility

All utilities use only Roslyn's `AttributeData` APIs - **no reflection**:

| API | Source | AOT Safe |
|-----|--------|----------|
| `AttributeData.NamedArguments` | Roslyn | Yes |
| `AttributeData.ConstructorArguments` | Roslyn | Yes |
| `AttributeData.AttributeConstructor` | Roslyn | Yes |
| `IParameterSymbol.Name` | Roslyn | Yes |

This ensures generators work with:
- Native AOT compilation
- Trimmed applications
- Single-file publishing

---

## ILMerge Integration

`AttributeUtilities` lives in `Whizbang.Generators.Shared`, which is ILMerged into all generator assemblies:

```
Whizbang.Generators.dll
├── Whizbang.Generators (main)
└── Whizbang.Generators.Shared (merged)
    └── AttributeUtilities.cs

Whizbang.Transports.HotChocolate.Generators.dll
├── Whizbang.Transports.HotChocolate.Generators (main)
└── Whizbang.Generators.Shared (merged)
    └── AttributeUtilities.cs (same code!)
```

This means:
- **Consistent behavior** across all generators
- **Single source of truth** for extraction logic
- **Bug fixes** benefit all generators automatically

---

## Testing

Comprehensive unit tests verify all extraction scenarios:

```csharp{title="Testing" description="Comprehensive unit tests verify all extraction scenarios:" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "Testing"]}
[Test]
public async Task GetStringValue_ConstructorArgument_ReturnsValueAsync() {
  var source = @"
    [TestAttribute(""my-tag"")]
    public class TestClass { }
  ";

  var compilation = GeneratorTestHelper.CreateCompilation(source);
  var typeSymbol = compilation.GetTypeByMetadataName("TestClass")!;
  var attribute = typeSymbol.GetAttributes()[0];

  var result = AttributeUtilities.GetStringValue(attribute, "Tag");

  await Assert.That(result).IsEqualTo("my-tag");
}

[Test]
public async Task GetStringValue_BothPresent_NamedTakesPrecedenceAsync() {
  var source = @"
    [TestAttribute(""constructor-value"", Tag = ""named-value"")]
    public class TestClass { }
  ";

  var compilation = GeneratorTestHelper.CreateCompilation(source);
  var typeSymbol = compilation.GetTypeByMetadataName("TestClass")!;
  var attribute = typeSymbol.GetAttributes()[0];

  var result = AttributeUtilities.GetStringValue(attribute, "Tag");

  // Named argument wins
  await Assert.That(result).IsEqualTo("named-value");
}
```

---

## Related Documentation

- [Message Tag Discovery](./message-registry.md) - Uses AttributeUtilities for tag extraction
- [Receptor Discovery](./receptor-discovery.md) - Generator patterns overview
- [Aggregate IDs](./aggregate-ids.md) - Another generator using attribute extraction
