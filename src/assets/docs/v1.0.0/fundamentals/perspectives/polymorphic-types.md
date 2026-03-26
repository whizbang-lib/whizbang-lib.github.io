---
title: Polymorphic Types in Perspectives
version: 1.0.0
category: Perspectives
codeReferences:
  - src/Whizbang.Data.EFCore.Postgres.Generators/PerspectiveModelPolymorphicAnalyzer.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Core/Perspectives/PolymorphicDiscriminatorAttribute.cs
---

# Polymorphic Types in Perspectives

When your perspective models contain polymorphic types (abstract classes or types with `[JsonPolymorphic]`), Whizbang provides tools to enable efficient database queries without parsing JSON at query time.

## Overview

Polymorphic types in JSONB can be challenging to query efficiently. Whizbang's analyzer detects these patterns and suggests using discriminator columns for optimized queries.

| Approach | Query Performance | Type Safety | Maintenance |
|----------|------------------|-------------|-------------|
| JSONB path query | Slow (parses JSON) | Low | Easy |
| Discriminator column | Fast (indexed) | High | Moderate |

## PerspectiveModelPolymorphicAnalyzer {#PerspectiveModelPolymorphicAnalyzer}

The `PerspectiveModelPolymorphicAnalyzer` is a Roslyn analyzer that detects abstract or polymorphic type properties in perspective models. It reports an informational diagnostic (WHIZ811) suggesting the use of `[PolymorphicDiscriminator]` for efficient queries.

### What It Detects

The analyzer finds perspective models containing properties that are:

- **Abstract classes**: Cannot be directly instantiated, require derived types
- **Types with `[JsonPolymorphic]`**: System.Text.Json polymorphic serialization

### Example Warning

```csharp{title="Example Warning" description="Demonstrates example Warning" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Example", "Warning"]}
public record FormModel {
    public Guid FormId { get; init; }

    // WHIZ811: Property 'Settings' on 'FormModel' uses polymorphic type 'AbstractFieldSettings'.
    // Consider adding [PolymorphicDiscriminator] for efficient database queries.
    public AbstractFieldSettings Settings { get; init; }
}
```

### Recursive Detection

The analyzer recursively checks nested types, so it catches polymorphic properties in:

- Direct properties
- Properties of nested types
- Collection element types (e.g., `List<AbstractType>`)
- Generic type arguments

```csharp{title="Recursive Detection" description="- Direct properties - Properties of nested types - Collection element types (e." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Recursive", "Detection"]}
public record FormModel {
    // Analyzer checks FieldConfig for polymorphic properties
    public FieldConfig Config { get; init; }

    // Analyzer checks element type of list
    public List<AbstractFieldSettings> Fields { get; init; }
}
```

## Working with Polymorphic Types

### The Problem

Consider a form builder where fields can have different settings types:

```csharp{title="The Problem" description="Consider a form builder where fields can have different settings types:" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Perspectives", "Problem"]}
[JsonPolymorphic(TypeDiscriminatorPropertyName = "$type")]
[JsonDerivedType(typeof(TextFieldSettings), "text")]
[JsonDerivedType(typeof(NumberFieldSettings), "number")]
public abstract class AbstractFieldSettings {
    public bool Required { get; init; }
}

public class TextFieldSettings : AbstractFieldSettings {
    public int MaxLength { get; init; }
}

public class NumberFieldSettings : AbstractFieldSettings {
    public decimal? MinValue { get; init; }
    public decimal? MaxValue { get; init; }
}
```

Querying by derived type in JSONB requires parsing JSON at query time:

```sql{title="The Problem (2)" description="Querying by derived type in JSONB requires parsing JSON at query time:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Problem"]}
-- Slow: parses JSON for every row
SELECT * FROM wh_per_form
WHERE data->'Settings'->>'$type' = 'text';
```

### The Solution

Add a discriminator column that stores the type information:

```csharp{title="The Solution" description="Add a discriminator column that stores the type information:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Solution"]}
public record FormModel {
    [StreamId]
    public Guid FormId { get; init; }

    // Discriminator column for efficient queries
    [PolymorphicDiscriminator(ColumnName = "settings_type")]
    public string SettingsTypeName { get; init; }

    public AbstractFieldSettings Settings { get; init; }
}
```

Now queries use the indexed column:

```sql{title="The Solution (2)" description="Now queries use the indexed column:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Solution"]}
-- Fast: uses indexed column
SELECT * FROM wh_per_form
WHERE settings_type = 'text';
```

## Best Practices

1. **Add discriminators for queried types**: If you filter by polymorphic type, add a discriminator
2. **Skip rarely-queried types**: Not all polymorphic properties need discriminators
3. **Use meaningful names**: `SettingsTypeName` is clearer than `Type`
4. **Consider the polymorphic API**: Use `WherePolymorphic` for type-safe queries

## Suppressing the Analyzer

If you don't need to query by type, suppress the diagnostic:

```csharp{title="Suppressing the Analyzer" description="If you don't need to query by type, suppress the diagnostic:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Suppressing", "Analyzer"]}
#pragma warning disable WHIZ811
public AbstractFieldSettings Settings { get; init; }
#pragma warning restore WHIZ811
```

Or in `.editorconfig`:

```ini
[*.cs]
dotnet_diagnostic.WHIZ811.severity = none
```

## See Also

- [Polymorphic Discriminator](polymorphic-discriminator.md) - Using discriminator columns
- [Physical Fields](physical-fields.md) - Physical column storage
- [EF Core JSON Configuration](../../data/efcore-json-configuration.md) - JSON serialization settings
