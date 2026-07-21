---
title: Attribute Utilities
pageType: reference
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
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
testReferences:
  - tests/Whizbang.Generators.Tests/Utilities/AttributeUtilitiesTests.cs
  - tests/Whizbang.Generators.Tests/MessageTagDiscoveryGeneratorTests.cs
lastMaintainedCommit: '01f07906'
---

# Attribute Utilities

The **AttributeUtilities** class provides shared utilities for extracting attribute values in Roslyn source generators. It supports all C# attribute parameter patterns - named arguments, constructor arguments, and mixed syntax - while remaining fully AOT-compatible.

## Why Shared Utilities?

C# attributes can receive values through multiple syntax patterns:

```csharp{title="Why Shared Utilities?" description="C# attributes can receive values through multiple syntax patterns:" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "Why", "Shared"] tests=["AttributeUtilitiesTests.GetStringValue_ExistingProperty_ReturnsValueAsync", "AttributeUtilitiesTests.GetStringValue_ConstructorArgument_ReturnsValueAsync", "AttributeUtilitiesTests.GetStringValue_BothPresent_NamedTakesPrecedenceAsync"]}
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

**Solution**: Centralized utilities shared across ALL generators via ILRepack.

---

## How It Works

### 1. Roslyn AttributeData

The `AttributeData` type exposes attribute values through two properties:

```mermaid{caption="AttributeData exposes attribute values through two properties — NamedArguments for named arguments and ConstructorArguments for positional ones — and AttributeUtilities reads both." tests=["AttributeUtilitiesTests.GetStringValue_ExistingProperty_ReturnsValueAsync", "AttributeUtilitiesTests.GetStringValue_ConstructorArgument_ReturnsValueAsync"]}
flowchart TD
    AD["AttributeData"]
    NA["NamedArguments<br/>KeyValuePairs for named arguments"]
    NAex["[Tag = #quot;value#quot;, Exclude = true]"]
    CA["ConstructorArguments<br/>Indexed values from constructor"]
    CAex["[#quot;value#quot;, true]  (positional)"]

    AD --> NA
    NA --> NAex
    AD --> CA
    CA --> CAex

    class AD,NA,CA layer-infrastructure
```

### 2. Value Precedence

Named arguments always take precedence over constructor arguments:

```csharp{title="Value Precedence" description="Named arguments always take precedence over constructor arguments:" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "Value", "Precedence"] tests=["AttributeUtilitiesTests.GetStringValue_BothPresent_NamedTakesPrecedenceAsync"]}
// Given this attribute usage:
[MyTag("from-ctor", Tag = "from-named")]

// AttributeUtilities returns "from-named" for Tag
// Named argument overrides constructor argument
```

### 3. Case-Insensitive Parameter Matching

Constructor parameters are matched case-insensitively to property names:

```csharp{title="Case-Insensitive Parameter Matching" description="Constructor parameters are matched case-insensitively to property names:" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "Case-Insensitive", "Parameter"] tests=["AttributeUtilitiesTests.GetStringValue_CaseInsensitiveMatch_ReturnsValueAsync"]}
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

```csharp{title="GetStringValue" description="Extracts a string property value from an attribute." category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "GetStringValue"] tests=["AttributeUtilitiesTests.GetStringValue_ExistingProperty_ReturnsValueAsync"]}
public static string? GetStringValue(
    AttributeData attribute,
    string propertyName)
```

**Example**:

```csharp{title="GetStringValue (2)" description="GetStringValue" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "GetStringValue"] tests=["AttributeUtilitiesTests.GetStringValue_ExistingProperty_ReturnsValueAsync", "AttributeUtilitiesTests.GetStringValue_ConstructorArgument_ReturnsValueAsync", "AttributeUtilitiesTests.GetStringValue_MissingProperty_ReturnsNullAsync"]}
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

```csharp{title="GetBoolValue" description="Extracts a boolean property value from an attribute." category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "GetBoolValue"] tests=["AttributeUtilitiesTests.GetBoolValue_ExistingProperty_ReturnsValueAsync"]}
public static bool GetBoolValue(
    AttributeData attribute,
    string propertyName,
    bool defaultValue)
```

**Example**:

```csharp{title="GetBoolValue (2)" description="GetBoolValue" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "GetBoolValue"] tests=["AttributeUtilitiesTests.GetBoolValue_ExistingProperty_ReturnsValueAsync", "AttributeUtilitiesTests.GetBoolValue_ConstructorArgument_ReturnsValueAsync", "AttributeUtilitiesTests.GetBoolValue_MissingProperty_ReturnsDefaultAsync"]}
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

```csharp{title="GetIntValue" description="Extracts an integer property value from an attribute." category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "GetIntValue"] tests=["AttributeUtilitiesTests.GetIntValue_ExistingProperty_ReturnsValueAsync"]}
public static int GetIntValue(
    AttributeData attribute,
    string propertyName,
    int defaultValue)
```

**Example**:

```csharp{title="GetIntValue (2)" description="GetIntValue" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "GetIntValue"] tests=["AttributeUtilitiesTests.GetIntValue_ExistingProperty_ReturnsValueAsync", "AttributeUtilitiesTests.GetIntValue_ConstructorArgument_ReturnsValueAsync", "AttributeUtilitiesTests.GetIntValue_MissingProperty_ReturnsDefaultAsync"]}
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

```csharp{title="GetStringArrayValue" description="Extracts a string array property value from an attribute." category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "GetStringArrayValue"] tests=["AttributeUtilitiesTests.GetStringArrayValue_NamedArgument_ReturnsValuesAsync"]}
public static string[]? GetStringArrayValue(
    AttributeData attribute,
    string propertyName)
```

**Example**:

```csharp{title="GetStringArrayValue (2)" description="GetStringArrayValue" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "GetStringArrayValue"] tests=["AttributeUtilitiesTests.GetStringArrayValue_NamedArgument_ReturnsValuesAsync", "AttributeUtilitiesTests.GetStringArrayValue_ConstructorArgument_ReturnsValuesAsync", "AttributeUtilitiesTests.GetStringArrayValue_MissingProperty_ReturnsNullAsync"]}
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

```csharp{title="MessageTagDiscoveryGenerator Example" description="MessageTagDiscoveryGenerator Example" category="Internals" difficulty="ADVANCED" tags=["Extending", "Source-Generators", "MessageTagDiscoveryGenerator", "Example"] tests=["MessageTagDiscoveryGeneratorTests.Generator_WithConstructorArgument_ExtractsTagAsync", "MessageTagDiscoveryGeneratorTests.Generator_WithMixedSyntax_ExtractsAllValuesAsync", "MessageTagDiscoveryGeneratorTests.Generator_WithProperties_GeneratesPropertyExtractorsAsync", "MessageTagDiscoveryGeneratorTests.Generator_WithExtraJson_GeneratesMergeCodeAsync"]}
// Simplified from _extractTagInfos in MessageTagDiscoveryGenerator.
// The real method yields one MessageTagInfo per tag attribute -
// a type can carry MULTIPLE MessageTagAttribute subclasses.
private static IEnumerable<MessageTagInfo> _extractTagInfos(
    GeneratorSyntaxContext context,
    CancellationToken ct) {

  var typeDecl = (TypeDeclarationSyntax)context.Node;
  var typeSymbol = context.SemanticModel.GetDeclaredSymbol(typeDecl, ct);

  if (typeSymbol is null || typeSymbol.DeclaredAccessibility != Accessibility.Public) {
    yield break;
  }

  // Find ALL MessageTagAttribute (or derived) attributes on the type
  var tagAttributes = typeSymbol.GetAttributes()
      .Where(a => _inheritsFromMessageTagAttribute(a.AttributeClass));

  foreach (var tagAttribute in tagAttributes) {
    // Extract values using shared utilities
    // Works with both constructor and named arguments!
    var tag = AttributeUtilities.GetStringValue(tagAttribute, "Tag") ?? "";
    var properties = AttributeUtilities.GetStringArrayValue(tagAttribute, "Properties");
    var extraJson = AttributeUtilities.GetStringValue(tagAttribute, "ExtraJson");

    // Skip attributes with Exclude = true
    var exclude = AttributeUtilities.GetBoolValue(tagAttribute, "Exclude", false);
    if (exclude) {
      continue;
    }

    yield return new MessageTagInfo(
        Tag: tag,
        Properties: properties,
        ExtraJson: extraJson
        // ... other properties (type names, attribute name, initializers)
    );
  }
}
```

---

## Creating Custom Attributes

When creating custom attributes that inherit from Whizbang base attributes, you can use any C# parameter syntax:

### Named-Only Pattern

```csharp{title="Named-Only Pattern" description="Named-Only Pattern" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "Named-Only", "Pattern"] tests=["MessageTagDiscoveryGeneratorTests.Generator_AttributeFactory_PreservesInitOnlyNamedArgumentsAsync"]}
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

```csharp{title="Constructor Pattern" description="Constructor Pattern" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "Constructor", "Pattern"] tests=["MessageTagDiscoveryGeneratorTests.Generator_WithConstructorArgument_ExtractsTagAsync"]}
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

```csharp{title="Mixed Pattern" description="Mixed Pattern" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "Mixed", "Pattern"] tests=["MessageTagDiscoveryGeneratorTests.Generator_WithMixedSyntax_ExtractsAllValuesAsync"]}
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

## ILRepack Integration

`AttributeUtilities` lives in `Whizbang.Generators.Shared`, which is merged into each generator assembly via ILRepack (`ILRepack.Lib.MSBuild.Task`, enabled with `ILRepackEnabled` in each generator's `.csproj`):

```mermaid{caption="ILRepack merges Whizbang.Generators.Shared — including AttributeUtilities — into every generator assembly, so each generator ships identical extraction code."}
flowchart TD
    subgraph DLL1["Whizbang.Generators.dll"]
        Main1["Whizbang.Generators (main)"]
        Shared1["Whizbang.Generators.Shared (merged)"]
        AU1["AttributeUtilities.cs"]
        Shared1 --> AU1
    end

    subgraph DLL2["Whizbang.Transports.HotChocolate.Generators.dll"]
        Main2["Whizbang.Transports.HotChocolate.Generators (main)"]
        Shared2["Whizbang.Generators.Shared (merged)"]
        AU2["AttributeUtilities.cs (same code!)"]
        Shared2 --> AU2
    end

    class Main1,Main2 layer-infrastructure
    class Shared1,Shared2,AU1,AU2 layer-core
```

This means:
- **Consistent behavior** across all generators
- **Single source of truth** for extraction logic
- **Bug fixes** benefit all generators automatically

---

## Testing

Comprehensive unit tests verify all extraction scenarios:

```csharp{title="Testing" description="Comprehensive unit tests verify all extraction scenarios:" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "Testing"] tests=["AttributeUtilitiesTests.GetStringValue_ConstructorArgument_ReturnsValueAsync", "AttributeUtilitiesTests.GetStringValue_BothPresent_NamedTakesPrecedenceAsync"]}
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
