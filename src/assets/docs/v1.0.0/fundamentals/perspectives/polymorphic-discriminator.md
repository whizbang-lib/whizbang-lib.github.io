---
title: Polymorphic Discriminator
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Perspectives
codeReferences:
  - src/Whizbang.Core/Perspectives/PolymorphicDiscriminatorAttribute.cs
  - >-
    src/Whizbang.Data.EFCore.Postgres.Generators/EFCorePerspectiveConfigurationGenerator.cs
testReferences:
  - tests/Whizbang.Core.Tests/Perspectives/PolymorphicDiscriminatorAttributeTests.cs
lastMaintainedCommit: '01f07906'
---

# Polymorphic Discriminator

The `[PolymorphicDiscriminator]` attribute marks a property as a type discriminator for polymorphic JSON data. The source generator creates an indexed physical column, enabling efficient SQL queries without parsing JSON at query time.

## Overview

When your perspective models contain polymorphic types (abstract classes or `[JsonPolymorphic]` types), querying by derived type requires parsing JSON for every row. Discriminator columns solve this by storing the type information in an indexed column.

| Query Type | Without Discriminator | With Discriminator |
|------------|----------------------|-------------------|
| By derived type | JSONB path query (slow) | Indexed column (fast) |
| Performance | O(n) JSON parsing | O(log n) index lookup |

## Field Discriminator {#Field}

Use `[PolymorphicDiscriminator]` on a string property that stores the type discriminator value:

```csharp{title="Field Discriminator" description="Use [PolymorphicDiscriminator] on a string property that stores the type discriminator value:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Field", "Discriminator"] tests=["PolymorphicDiscriminatorAttributeTests.PolymorphicDiscriminatorAttribute_AttributeUsage_PropertyOnly_AllowsMultiple_IsInheritedAsync", "PolymorphicDiscriminatorAttributeTests.PolymorphicDiscriminatorAttribute_ColumnName_CanBeSetAsync"]}
public record FormFieldModel {
    [StreamId]
    public Guid FieldId { get; init; }

    // Discriminator column for the polymorphic Settings property
    [PolymorphicDiscriminator(ColumnName = "settings_type")]
    public string SettingsTypeName { get; init; }

    // Polymorphic property (abstract or [JsonPolymorphic])
    public AbstractFieldSettings Settings { get; init; }
}
```

### Attribute Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `ColumnName` | `string?` | `null` | Custom column name (defaults to snake_case of property) |

### Generated Schema

The source generator creates:

1. A physical column for the discriminator (e.g., `settings_type`)
2. A B-tree index on the discriminator column
3. Registration in the physical field registry

```sql{title="Generated Schema" description="Generated Schema" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Generated", "Schema"]}
CREATE TABLE wh_per_form_field (
    id UUID PRIMARY KEY,
    stream_id UUID NOT NULL,
    data JSONB NOT NULL,
    settings_type TEXT,  -- Discriminator column (TEXT: no max length, fits full type names)
    -- ... other columns
);

CREATE INDEX idx_form_field_settings_type ON wh_per_form_field(settings_type);
```

## Querying with Discriminators

### Direct Column Query

Query the discriminator column directly:

```csharp{title="Direct Column Query" description="Query the discriminator column directly:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Direct", "Column"] unverified="lens query illustration — exercises the query/lens layer, not the [PolymorphicDiscriminator] attribute tests"}
var textFields = await lens.Query
    .Where(r => r.Data.SettingsTypeName == "TextFieldSettings")
    .ToListAsync();
```

The discriminator property is registered as a physical field, so this query is translated to an indexed column lookup (`WHERE settings_type = 'TextFieldSettings'`).

### Type-Safe Polymorphic API

:::planned
A `WherePolymorphic(...).As<TDerived>(...)` extension for type-safe polymorphic queries is planned but not shipped at this commit. Use the direct discriminator-column query above.
:::

## Setting the Discriminator Value

Set the discriminator value when applying events to your perspective:

```csharp{title="Setting the Discriminator Value" description="Set the discriminator value when applying events to your perspective:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Setting", "Discriminator"] unverified="consumer FormFieldPerspective Apply illustration — domain perspective, not asserted by the attribute tests"}
public class FormFieldPerspective : IPerspectiveFor<FormFieldModel, FieldCreatedEvent> {
    public FormFieldModel Apply(FormFieldModel current, FieldCreatedEvent @event) {
        return current with {
            FieldId = @event.FieldId,
            Settings = @event.Settings,
            // Set discriminator to match the actual type
            SettingsTypeName = @event.Settings.GetType().Name
        };
    }
}
```

### Using Full Type Names

For disambiguation, use fully qualified type names:

```csharp{title="Using Full Type Names" description="For disambiguation, use fully qualified type names:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Using", "Full"] unverified="one-line consumer snippet setting a type name — nothing library-side to assert"}
SettingsTypeName = @event.Settings.GetType().FullName
// e.g., "MyApp.Forms.TextFieldSettings"
```

## Collection Discriminators

For collections of polymorphic types, consider a separate perspective table:

```csharp{title="Collection Discriminators" description="For collections of polymorphic types, consider a separate perspective table:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Collection", "Discriminators"] tests=["PolymorphicDiscriminatorAttributeTests.PolymorphicDiscriminatorAttribute_AttributeUsage_PropertyOnly_AllowsMultiple_IsInheritedAsync", "PolymorphicDiscriminatorAttributeTests.PolymorphicDiscriminatorAttribute_DefaultConstructor_HasDefaultValuesAsync"]}
// Main form perspective
public record FormModel {
    [StreamId]
    public Guid FormId { get; init; }
    public string Title { get; init; }
}

// Separate perspective for fields (one row per field)
public record FormFieldModel {
    [StreamId]
    public Guid FieldId { get; init; }

    public Guid FormId { get; init; }

    [PolymorphicDiscriminator]
    public string FieldTypeName { get; init; }

    public AbstractFieldSettings Settings { get; init; }
}
```

This enables efficient queries like "find all text fields across all forms."

## Best Practices

1. **Name discriminators clearly**: Use `{PropertyName}TypeName` or `{PropertyName}Discriminator`
2. **Use consistent values**: Either simple type names or fully qualified names, not both
3. **Index all discriminators**: The attribute automatically creates an index
4. **Consider collection patterns**: Use separate perspectives for collections of polymorphic types

## Common Patterns

### Multiple Polymorphic Properties

```csharp{title="Multiple Polymorphic Properties" description="Multiple Polymorphic Properties" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Multiple", "Polymorphic"] tests=["PolymorphicDiscriminatorAttributeTests.PolymorphicDiscriminatorAttribute_AttributeUsage_PropertyOnly_AllowsMultiple_IsInheritedAsync", "PolymorphicDiscriminatorAttributeTests.PolymorphicDiscriminatorAttribute_ColumnName_CanBeSetAsync"]}
public record ConfigModel {
    [PolymorphicDiscriminator(ColumnName = "input_type")]
    public string InputSettingsType { get; init; }
    public AbstractInputSettings InputSettings { get; init; }

    [PolymorphicDiscriminator(ColumnName = "output_type")]
    public string OutputSettingsType { get; init; }
    public AbstractOutputSettings OutputSettings { get; init; }
}
```

### Enum-Based Discriminators

While string discriminators are most flexible, you can use enums:

```csharp{title="Enum-Based Discriminators" description="While string discriminators are most flexible, you can use enums:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Enum-Based", "Discriminators"] unverified="uses [PhysicalField], not [PolymorphicDiscriminator] — physical-field indexing is verified on the Physical Fields page"}
public record FormFieldModel {
    [PhysicalField(Indexed = true)]
    public FieldType FieldType { get; init; }

    public AbstractFieldSettings Settings { get; init; }
}

public enum FieldType {
    Text,
    Number,
    Date,
    Dropdown
}
```

## See Also

- [Polymorphic Types](polymorphic-types.md) - Analyzer for polymorphic detection
- [Physical Fields](physical-fields.md) - Physical column storage
- [EF Core JSON Configuration](../../data/efcore-json-configuration.md) - JSON polymorphic serialization
