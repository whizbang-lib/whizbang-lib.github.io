---
title: Polymorphic Discriminator
version: 1.0.0
category: Perspectives
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

```csharp
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

```sql
CREATE TABLE wh_per_form_field (
    id UUID PRIMARY KEY,
    stream_id UUID NOT NULL,
    data JSONB NOT NULL,
    settings_type VARCHAR(255),  -- Discriminator column
    -- ... other columns
);

CREATE INDEX idx_form_field_settings_type ON wh_per_form_field(settings_type);
```

## Querying with Discriminators

### Direct Column Query

Query the discriminator column directly:

```csharp
var textFields = await lens.QueryAsync<FormFieldModel>()
    .Where(r => r.Data.SettingsTypeName == "TextFieldSettings")
    .ToListAsync();
```

### Type-Safe Polymorphic API

Use the `WherePolymorphic` extension for type-safe queries:

```csharp
var textFields = await lens.QueryAsync<FormFieldModel>()
    .WherePolymorphic(m => m.Settings)
    .As<TextFieldSettings>(s => s.MaxLength > 100)
    .ToListAsync();
```

This generates SQL that uses both the discriminator column and JSONB for the filter:

```sql
SELECT * FROM wh_per_form_field
WHERE settings_type = 'TextFieldSettings'
  AND (data->'Settings'->>'MaxLength')::int > 100;
```

## Setting the Discriminator Value

Set the discriminator value when applying events to your perspective:

```csharp
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

```csharp
SettingsTypeName = @event.Settings.GetType().FullName
// e.g., "MyApp.Forms.TextFieldSettings"
```

## Collection Discriminators

For collections of polymorphic types, consider a separate perspective table:

```csharp
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

```csharp
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

```csharp
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

- [Polymorphic Types](/docs/v1.0.0/fundamentals/perspectives/polymorphic-types) - Analyzer for polymorphic detection
- [Physical Fields](/docs/v1.0.0/fundamentals/perspectives/physical-fields) - Physical column storage
- [EF Core JSON Configuration](/docs/v1.0.0/data/efcore-json-configuration) - JSON polymorphic serialization
