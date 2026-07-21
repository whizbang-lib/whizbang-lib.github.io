---
title: 'WHIZ807: Physical Fields Discovered'
pageType: troubleshooting
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
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
testReferences:
  - tests/Whizbang.Generators.Tests/PhysicalFieldDiscoveryTests.cs
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
2. **Storage mode reported** - The message includes the model's configured `FieldStorageMode` (from `[PerspectiveStorage]`; defaults to `JsonOnly` when the attribute is absent)
3. **Columns generated** - Database columns will be created for these fields

## Example: Physical Field Discovery

```csharp{title="Example: Physical Field Discovery" description="Example: Physical Field Discovery" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Example:", "Physical"]}
[PerspectiveStorage(FieldStorageMode.Split)]
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

The diagnostic reports the storage mode (`FieldStorageMode`):

| Mode | Description |
|------|-------------|
| **JsonOnly** | Default. No physical columns semantics — all data in the JSONB column |
| **Extracted** | JSONB contains the full model; physical columns are indexed copies for query optimization |
| **Split** | Physical columns hold the marked fields; JSONB holds only the remaining fields |

## Generated Schema

Perspective tables use a fixed base shape (JSONB model + metadata + scope columns); physical field columns are appended to it. The table name derives from the **perspective class** name — `wh_per_` + snake_case, with common suffixes (`ReadModel`, `Model`, `Projection`, `Dto`, `View`) stripped by default. For a perspective class `ProductProjection` using the `ProductDto` model above, the generator produces:

```sql{title="Generated Schema" description="For the example above, the generator produces:" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Generated", "Schema"]}
CREATE TABLE IF NOT EXISTS wh_per_product (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_data JSONB NOT NULL,
  metadata JSONB NOT NULL,
  scope JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version BIGINT NOT NULL DEFAULT 0,
  status TEXT,                       -- [PhysicalField]
  price DECIMAL,                     -- [PhysicalField]
  embedding vector(1536)             -- [VectorField]
);

-- B-tree indexes for indexed physical fields
CREATE INDEX IF NOT EXISTS ix_wh_per_product_status ON wh_per_product(status);
CREATE INDEX IF NOT EXISTS ix_wh_per_product_price ON wh_per_product(price);

-- pgvector index for the vector field (IVFFlat + cosine by default)
CREATE INDEX IF NOT EXISTS ix_wh_per_product_embedding_vec ON wh_per_product USING ivfflat (embedding vector_cosine_ops);
```

Column names default to snake_case of the property name (override with `ColumnName`). Strings map to `TEXT` unless a `MaxLength` is set (then `VARCHAR(n)`).

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

```xml{title="Suppress (if too noisy)" description="Suppress (if too noisy)" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Suppress", "Too"] unverified="suppression/config — not exercised by a test"}
<PropertyGroup>
  <NoWarn>$(NoWarn);WHIZ807</NoWarn>
</PropertyGroup>
```

Or per-file:

```csharp{title="Suppress (if too noisy) (2)" description="Or per-file:" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Suppress", "Too"] unverified="suppression/config — not exercised by a test"}
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
