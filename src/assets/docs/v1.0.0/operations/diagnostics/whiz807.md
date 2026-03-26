---
title: 'WHIZ807: Physical Fields Discovered'
description: >-
  Informational diagnostic when physical fields are discovered on a perspective model
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - physical-field
  - vector-field
  - perspectives
  - source-generator
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/PerspectiveSchemaGenerator.cs
  - src/Whizbang.Generators.Shared/Models/PhysicalFieldInfo.cs
lastMaintainedCommit: '01f07906'
---

# WHIZ807: Physical Fields Discovered

**Severity**: Info
**Category**: Physical Field Discovery

## Description

This informational diagnostic is reported when the source generator discovers physical fields on a perspective model. Physical fields are properties marked with `[PhysicalField]` or `[VectorField]` that will be stored as dedicated database columns instead of within the JSONB model column.

## Diagnostic Message

```
Model 'ProductDto' has 2 physical field(s) in Split mode
```

## What This Means

When you see this diagnostic:

1. **Fields detected** - The generator found `[PhysicalField]` or `[VectorField]` attributes
2. **Storage mode applied** - The model will use Split storage mode
3. **Columns generated** - Database columns will be created for these fields

## Example: Physical Field Discovery

```csharp{title="Example: Physical Field Discovery" description="Example: Physical Field Discovery" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Example:", "Physical"]}
public record ProductDto {
  [StreamKey]
  public Guid ProductId { get; init; }

  public string Description { get; init; } = string.Empty;  // Stored in JSONB

  [PhysicalField]        // Physical column for queries
  public string Status { get; init; } = "draft";

  [PhysicalField]        // Physical column for filtering
  public decimal Price { get; init; }

  [VectorField(1536)]    // Vector column for similarity search
  public float[]? Embedding { get; init; }
}

// WHIZ807: Model 'ProductDto' has 3 physical field(s) in Split mode
```

## Storage Modes

The diagnostic reports the storage mode:

| Mode | Description |
|------|-------------|
| **JsonOnly** | All data in JSONB column (no physical fields) |
| **Split** | Physical fields as columns + remaining in JSONB |
| **Physical** | All fields as columns (no JSONB) |

## Generated Schema

For the example above, the generator produces:

```sql{title="Generated Schema" description="For the example above, the generator produces:" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Generated", "Schema"]}
CREATE TABLE product_perspectives (
  id UUID PRIMARY KEY,
  stream_key UUID NOT NULL,
  status VARCHAR NOT NULL,           -- [PhysicalField]
  price DECIMAL NOT NULL,            -- [PhysicalField]
  embedding vector(1536),            -- [VectorField]
  model JSONB NOT NULL               -- Remaining fields
);

CREATE INDEX idx_product_status ON product_perspectives(status);
CREATE INDEX idx_product_price ON product_perspectives(price);
```

## Why Physical Fields

Physical fields enable:

1. **Efficient queries** - Database indexes on physical columns
2. **SQL filtering** - `WHERE status = 'active'` without JSONB parsing
3. **Vector search** - Similarity queries with pgvector
4. **Computed columns** - Database-level calculations

## Controlling the Diagnostic

### View in Build Output

The diagnostic appears in verbose build output:

```bash{title="View in Build Output" description="The diagnostic appears in verbose build output:" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "View", "Build"]}
dotnet build -v detailed
```

### Suppress (if too noisy)

```xml{title="Suppress (if too noisy)" description="Suppress (if too noisy)" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Suppress", "Too"]}
<PropertyGroup>
  <NoWarn>$(NoWarn);WHIZ807</NoWarn>
</PropertyGroup>
```

Or per-file:

```csharp{title="Suppress (if too noisy) (2)" description="Or per-file:" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Suppress", "Too"]}
#pragma warning disable WHIZ807
```

## Related Diagnostics

- WHIZ801 - VectorField on invalid type
- [WHIZ802](whiz802.md) - VectorField invalid dimensions
- WHIZ803 - PhysicalField on complex type (may not benefit)
- WHIZ805 - Split mode with no physical fields

## See Also

- [Physical Fields](../../fundamentals/perspectives/physical-fields.md) - Physical field documentation
- [Vector Search](../../extending/features/vector-search.md) - Vector field usage
- Perspective Storage - Storage mode options
