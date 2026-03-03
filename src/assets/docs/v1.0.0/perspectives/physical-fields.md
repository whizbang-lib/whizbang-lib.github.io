---
title: Physical Fields
version: 1.0.0
category: Perspectives
---

# Physical Fields

Physical fields allow you to store specific properties as dedicated database columns alongside or instead of JSONB storage. This enables native database indexing, type constraints, and optimized query performance for frequently accessed or filtered data.

## Overview

By default, Whizbang stores perspective model data in a single JSONB column. While flexible, JSONB queries can be slower for frequently filtered fields. Physical fields solve this by extracting selected properties to dedicated database columns that support native indexing.

| Feature | JSONB Only | Physical Fields |
|---------|------------|-----------------|
| Storage | Single column | Multiple columns |
| Indexing | GIN/JSONB path | B-tree, native types |
| Query performance | Good | Excellent for indexed fields |
| Schema flexibility | High | Moderate |
| Storage overhead | Low | Depends on mode |

## PhysicalFieldInfo {#PhysicalFieldInfo}

`PhysicalFieldInfo` is the generator model that captures metadata about physical fields discovered during source generation. It includes property name, column name, type information, indexing options, and vector-specific settings.

```csharp
public sealed record PhysicalFieldInfo(
    string PropertyName,      // Name of the property on the model
    string ColumnName,        // Database column name (snake_case)
    string TypeName,          // Fully qualified type name
    bool IsIndexed,           // Whether to create a database index
    bool IsUnique,            // Whether to apply UNIQUE constraint
    int? MaxLength,           // VARCHAR length for strings
    bool IsVector,            // Whether this is a vector field
    int? VectorDimensions,    // Dimension count for vectors
    GeneratorVectorDistanceMetric? VectorDistanceMetric,
    GeneratorVectorIndexType? VectorIndexType,
    int? VectorIndexLists     // IVFFlat list count
);
```

## PhysicalFieldRegistry {#PhysicalFieldRegistry}

`PhysicalFieldRegistry` is a runtime registry that maps model properties to their physical column names. Source generators populate this at startup, enabling the query translator to redirect `r.Data.PropertyName` queries to physical columns.

```csharp
// Register a physical field (done by generated code)
PhysicalFieldRegistry.Register<ProductModel>("Price", "price");

// Query uses unified syntax - automatically routes to physical column
var expensive = await lens.QueryAsync<ProductModel>()
    .Where(r => r.Data.Price >= 100.00m)  // Translated to: WHERE price >= 100
    .ToListAsync();
```

### Key Methods

| Method | Description |
|--------|-------------|
| `Register<TModel>(propertyName, columnName)` | Registers a physical field mapping |
| `TryGetMapping(modelType, propertyName, out mapping)` | Gets the column mapping if registered |
| `IsPhysicalField(modelType, propertyName)` | Checks if a property is a physical field |
| `GetMappingsForModel(modelType)` | Gets all mappings for a model type |

## PhysicalFieldQueryInterceptor {#PhysicalFieldQueryInterceptor}

`PhysicalFieldQueryInterceptor` is an EF Core query interceptor that integrates physical field translation into the query pipeline. It transforms LINQ expressions that access `r.Data.PropertyName` to use the underlying physical column.

```csharp
public class PhysicalFieldQueryInterceptor : IQueryExpressionInterceptor {
    public Expression QueryCompilationStarting(
        Expression queryExpression,
        QueryExpressionEventData eventData) {
        // Transforms r.Data.PropertyName to EF.Property(r, "column")
        return _visitor.Visit(queryExpression);
    }
}
```

## PhysicalFieldExpressionVisitor {#PhysicalFieldExpressionVisitor}

`PhysicalFieldExpressionVisitor` is the expression tree visitor that rewrites property access expressions for physical fields. It intercepts `r.Data.PropertyName` patterns and converts them to shadow property access.

**Before transformation:**
```csharp
.Where(r => r.Data.Price >= 50.00m)
```

**After transformation:**
```csharp
.Where(r => EF.Property<decimal>(r, "price") >= 50.00m)
```

## UseWhizbangPhysicalFields {#UseWhizbangPhysicalFields}

The `UseWhizbangPhysicalFields()` extension method enables physical field query translation on your DbContext. Call it when configuring your DbContext options.

```csharp
var optionsBuilder = new DbContextOptionsBuilder<MyDbContext>();
optionsBuilder
    .UseNpgsql(connectionString)
    .UseWhizbangPhysicalFields();
```

This registers the `PhysicalFieldQueryInterceptor` which automatically translates queries on physical fields.

## FieldStorageMode {#FieldStorageMode}

`FieldStorageMode` defines how physical fields are stored relative to JSONB in a perspective. Configure it using the `[PerspectiveStorage]` attribute on your model class.

| Mode | Description | Use Case |
|------|-------------|----------|
| `JsonOnly` | No physical columns; all data in JSONB only | Default, backwards compatible |
| `Extracted` | JSONB contains full model; physical columns are indexed copies | Fast queries with full JSONB flexibility |
| `Split` | Physical columns contain marked fields; JSONB contains remainder only | Storage efficiency, no duplication |

### JsonOnly (Default)

```csharp
// No attribute needed - this is the default
public record ProductDto {
    public decimal Price { get; init; }      // Stored in JSONB only
    public string Description { get; init; } // Stored in JSONB only
}
```

### Extracted Mode

Physical columns are indexed copies; JSONB still contains the full model. Ideal when you need fast indexed queries but also want full model access via JSONB.

```csharp
[PerspectiveStorage(FieldStorageMode.Extracted)]
public record ProductDto {
    [PhysicalField(Indexed = true)]
    public decimal Price { get; init; }      // In JSONB AND physical column

    public string Description { get; init; } // JSONB only
}
```

### Split Mode

Physical columns hold marked fields; JSONB holds only remaining fields. Avoids data duplication but requires reading both sources to reconstruct the model.

```csharp
[PerspectiveStorage(FieldStorageMode.Split)]
public record ProductSearchDto {
    [VectorField(1536)]
    public float[]? Embedding { get; init; }  // Physical column only

    public string Name { get; init; }          // JSONB only
}
```

## Defining Physical Fields

Use the `[PhysicalField]` attribute to mark properties for physical column storage:

```csharp
[PerspectiveStorage(FieldStorageMode.Extracted)]
public record ProductDto {
    [StreamId]
    public Guid ProductId { get; init; }

    [PhysicalField(Indexed = true)]
    public Guid CategoryId { get; init; }

    [PhysicalField(Indexed = true, MaxLength = 100)]
    public string Sku { get; init; }

    [PhysicalField(Unique = true)]
    public string ExternalId { get; init; }

    // Non-physical property stays in JSONB only
    public string Description { get; init; }
}
```

### Attribute Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `Indexed` | `bool` | `false` | Create a B-tree index on this column |
| `Unique` | `bool` | `false` | Apply UNIQUE constraint |
| `ColumnName` | `string?` | `null` | Custom column name (defaults to snake_case) |
| `MaxLength` | `int` | `-1` | VARCHAR length for strings (-1 = TEXT) |

## Query Syntax

Physical fields support unified query syntax - write queries against `r.Data.PropertyName` and Whizbang automatically routes to physical columns:

```csharp
// This query uses the indexed physical column automatically
var results = await lens.QueryAsync<ProductDto>()
    .Where(r => r.Data.CategoryId == categoryId)
    .Where(r => r.Data.Price >= 100.00m)
    .OrderBy(r => r.Data.Sku)
    .ToListAsync();
```

The generated SQL uses the physical columns:

```sql
SELECT * FROM wh_per_product
WHERE category_id = @p0
  AND price >= 100.00
ORDER BY sku;
```

## Best Practices

1. **Index selectively**: Only create indexes on frequently queried fields
2. **Use Extracted mode** when you need both indexed queries and full JSONB flexibility
3. **Use Split mode** for large fields (vectors, blobs) to avoid duplication
4. **String lengths**: Set `MaxLength` for strings that need constraints
5. **Unique constraints**: Use `Unique = true` for natural keys like SKU or email

## See Also

- [Vector Fields](/docs/v1.0.0/perspectives/vector-fields) - Vector similarity search with pgvector
- [Perspective Registry](/docs/v1.0.0/perspectives/registry) - Table tracking and renaming
- [Polymorphic Discriminator](/docs/v1.0.0/perspectives/polymorphic-discriminator) - Efficient polymorphic queries
