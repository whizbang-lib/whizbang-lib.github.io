---
title: Vector Fields
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Perspectives
codeReferences:
  - src/Whizbang.Core/Perspectives/VectorFieldAttribute.cs
  - src/Whizbang.Core/Perspectives/VectorDistanceMetric.cs
  - src/Whizbang.Core/Perspectives/VectorIndexType.cs
  - src/Whizbang.Data.EFCore.Postgres/VectorSearchExtensions.cs
  - src/Whizbang.Data.EFCore.Postgres/PhysicalFieldMaterializationInterceptor.cs
  - src/Whizbang.Data.EFCore.Postgres/SplitModeChangeTrackerHydrator.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCoreServiceRegistrationGenerator.cs
  - src/Whizbang.Data.Postgres/PostgresRequiredExtension.cs
  - src/Whizbang.Data.Postgres/PostgresSchemaRequirements.cs
testReferences:
  - tests/Whizbang.Core.Tests/Perspectives/VectorFieldAttributeTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/VectorDistanceMetricTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/VectorIndexTypeTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/VectorSearchExtensionsTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/VectorSearchIntegrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/SplitModeProductionTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Capabilities/RequiredVectorExtensionTests.cs
  - tests/Whizbang.Generators.Tests/VectorRequiredExtensionGenerationTests.cs
  - tests/Whizbang.Core.Tests/PostgresExtensions/PostgresSchemaRequirementsTests.cs
lastMaintainedCommit: '01f07906'
---

# Vector Fields

Vector fields enable similarity search in your perspectives using PostgreSQL's pgvector extension. Store embeddings from machine learning models and perform efficient nearest-neighbor queries directly in your database.

## Overview

Vector fields are a specialized type of physical field designed for storing and querying high-dimensional vectors (embeddings). They support various distance metrics and index types optimized for similarity search.

| Feature | Description |
|---------|-------------|
| **Storage** | Native pgvector `vector(N)` column type |
| **Indexing** | IVFFlat generated automatically (HNSW declared, not yet generated -- see below) |
| **Distance metrics** | L2 (Euclidean), Cosine, Inner Product |
| **Integration** | Works with OpenAI, Sentence Transformers, and any embedding model |

## Defining Vector Fields

Use the `[VectorField]` attribute on `float[]` properties:

```csharp{title="Defining Vector Fields" description="Use the [VectorField] attribute on float[] properties:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Defining", "Vector"] tests=["VectorFieldAttributeTests.VectorFieldAttribute_Constructor_AcceptsValidDimensionsAsync", "VectorFieldAttributeTests.VectorFieldAttribute_Properties_CanBeSetAsync"]}
[PerspectiveStorage(FieldStorageMode.Split)]
public record ProductSearchDto {
    [StreamId]
    public Guid ProductId { get; init; }

    // OpenAI text-embedding-ada-002 (1536 dimensions)
    [VectorField(1536)]
    public float[]? ContentEmbedding { get; init; }

    // With custom settings
    [VectorField(768, DistanceMetric = VectorDistanceMetric.Cosine, IndexType = VectorIndexType.HNSW)]
    public float[]? TitleEmbedding { get; init; }

    public string ProductName { get; init; }
}
```

### Attribute Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `Dimensions` | `int` | (required, >= 1) | Number of dimensions in the vector |
| `DistanceMetric` | `VectorDistanceMetric` | `Cosine` | Distance metric for similarity |
| `Indexed` | `bool` | `true` | Whether to create a vector index |
| `IndexType` | `VectorIndexType` | `IVFFlat` | Index algorithm |
| `IndexLists` | `int` | `100` | Number of lists for IVFFlat |
| `ColumnName` | `string?` | `null` | Custom column name (defaults to snake_case of the property name) |

:::updated
At commit `0bc6065b`, the generated index DDL honors only `Indexed` and `Dimensions`: when `Indexed` is true and `Dimensions <= 2000`, the EF Core Postgres generator emits `CREATE INDEX ... USING ivfflat (column vector_cosine_ops)` -- always IVFFlat with cosine ops. `IndexType`, `DistanceMetric`, and `IndexLists` are declared on the attribute but are **not yet consumed** by index generation (no HNSW DDL, no `WITH (lists = N)`, no L2/inner-product operator classes). For vectors over 2000 dimensions the index is skipped entirely (queries still work, unaccelerated) with a comment suggesting a manual HNSW index on pgvector >= 0.7.0. The distance metric you actually query with is chosen by the query extension method you call (see Querying Vectors below), not by the attribute.
:::

## VectorIndexType {#VectorIndexType}

`VectorIndexType` defines the index algorithm for vector columns. Each type offers different trade-offs between build time, memory usage, and query performance.

```csharp{title="VectorIndexType" description="VectorIndexType defines the index algorithm for vector columns." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "VectorIndexType"] tests=["VectorIndexTypeTests.VectorIndexType_HasThreeValuesAsync", "VectorIndexTypeTests.VectorIndexType_None_HasCorrectIntValueAsync", "VectorIndexTypeTests.VectorIndexType_IVFFlat_HasCorrectIntValueAsync", "VectorIndexTypeTests.VectorIndexType_HNSW_HasCorrectIntValueAsync"]}
public enum VectorIndexType {
    None = 0,      // No index - exact (sequential) search
    IVFFlat = 1,   // Inverted File Flat - balanced performance
    HNSW = 2       // Hierarchical Navigable Small World - best recall
}
```

### None

No index is created; queries perform exact sequential search. Use only for small datasets (under 10,000 rows) or when perfect recall is required.

```csharp{title="None" description="No index is created; queries perform exact sequential search." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "None"] tests=["VectorIndexTypeTests.VectorIndexType_None_IsDefinedAsync", "VectorFieldAttributeTests.VectorFieldAttribute_Properties_CanBeSetAsync"]}
[VectorField(1536, IndexType = VectorIndexType.None)]
public float[]? Embedding { get; init; }
```

### IVFFlat

Inverted File Flat index partitions vectors into clusters for faster approximate search. Good balance of build speed and query performance.

```csharp{title="IVFFlat" description="Inverted File Flat index partitions vectors into clusters for faster approximate search." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "IVFFlat"] tests=["VectorIndexTypeTests.VectorIndexType_IVFFlat_IsDefinedAsync", "VectorFieldAttributeTests.VectorFieldAttribute_Properties_CanBeSetAsync"]}
[VectorField(1536, IndexType = VectorIndexType.IVFFlat, IndexLists = 100)]
public float[]? Embedding { get; init; }
```

**Characteristics:**
- Faster build time than HNSW
- Lower memory usage
- Slightly lower recall than HNSW
- Requires tuning `IndexLists` parameter

**IndexLists tuning:**
- Small datasets: `sqrt(number of rows)`
- Large datasets: `number of rows / 1000`
- Default of 100 works well for datasets up to 1M rows

### HNSW

Hierarchical Navigable Small World graph provides better recall and query performance at the cost of more memory and slower build time.

```csharp{title="HNSW" description="Hierarchical Navigable Small World graph provides better recall and query performance at the cost of more memory and" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "HNSW"] tests=["VectorIndexTypeTests.VectorIndexType_HNSW_IsDefinedAsync", "VectorFieldAttributeTests.VectorFieldAttribute_Properties_CanBeSetAsync"]}
[VectorField(1536, IndexType = VectorIndexType.HNSW)]
public float[]? Embedding { get; init; }
```

**Characteristics:**
- Better recall than IVFFlat
- Faster queries for high-recall requirements
- Slower build time
- Higher memory usage
- Recommended for production workloads

## VectorDistanceMetric {#VectorDistanceMetric}

`VectorDistanceMetric` defines the similarity measure used for vector comparisons. Each metric corresponds to a PostgreSQL operator for ordering results by similarity.

```csharp{title="VectorDistanceMetric" description="VectorDistanceMetric defines the similarity measure used for vector comparisons." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "VectorDistanceMetric"] tests=["VectorDistanceMetricTests.VectorDistanceMetric_HasThreeValuesAsync", "VectorDistanceMetricTests.VectorDistanceMetric_L2_HasCorrectIntValueAsync", "VectorDistanceMetricTests.VectorDistanceMetric_InnerProduct_HasCorrectIntValueAsync", "VectorDistanceMetricTests.VectorDistanceMetric_Cosine_HasCorrectIntValueAsync"]}
public enum VectorDistanceMetric {
    L2 = 0,           // Euclidean distance
    InnerProduct = 1, // Negative inner product
    Cosine = 2        // Cosine distance
}
```

### L2 (Euclidean Distance)

Measures the straight-line distance between vectors. Lower values indicate more similar vectors.

```csharp{title="L2 (Euclidean Distance)" description="Measures the straight-line distance between vectors." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Euclidean", "Distance"] tests=["VectorDistanceMetricTests.VectorDistanceMetric_L2_IsDefinedAsync", "VectorFieldAttributeTests.VectorFieldAttribute_Properties_CanBeSetAsync"]}
[VectorField(1536, DistanceMetric = VectorDistanceMetric.L2)]
public float[]? Embedding { get; init; }
```

**PostgreSQL operator:** `<->`

**Formula:** `sqrt(sum((a[i] - b[i])^2))`

**Use when:** You need geometric distance, or your embeddings are not normalized.

### InnerProduct

Measures the dot product between vectors (negated for ordering). Higher original values indicate more similar vectors.

```csharp{title="InnerProduct" description="Measures the dot product between vectors (negated for ordering)." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "InnerProduct"] tests=["VectorDistanceMetricTests.VectorDistanceMetric_InnerProduct_IsDefinedAsync", "VectorFieldAttributeTests.VectorFieldAttribute_Properties_CanBeSetAsync"]}
[VectorField(1536, DistanceMetric = VectorDistanceMetric.InnerProduct)]
public float[]? Embedding { get; init; }
```

**PostgreSQL operator:** `<#>`

**Note:** The result is negated so that ORDER BY works correctly (lower = more similar).

**Use when:** Your vectors are normalized, or you're working with models that output normalized embeddings.

### Cosine (Default)

Measures the angle between vectors. Lower values indicate more similar vectors (0 = identical, 2 = opposite).

```csharp{title="Cosine (Default)" description="Measures the angle between vectors." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Cosine", "Default"] tests=["VectorDistanceMetricTests.VectorDistanceMetric_Cosine_IsDefinedAsync", "VectorFieldAttributeTests.VectorFieldAttribute_Constructor_HasDefaultValuesAsync"]}
[VectorField(1536, DistanceMetric = VectorDistanceMetric.Cosine)]
public float[]? Embedding { get; init; }
```

**PostgreSQL operator:** `<=>`

**Formula:** `1 - cosine_similarity(a, b)`

**Value range:** 0 (identical) to 2 (opposite)

**Use when:** Direction matters more than magnitude, or for text embeddings where normalization may vary.

## Storage Mode for Vectors

Vector fields are always stored as physical columns. Use `FieldStorageMode.Split` to avoid storing large vector arrays in JSONB:

```csharp{title="Storage Mode for Vectors" description="Vector fields are always stored as physical columns." category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Storage", "Mode"] unverified="consumer DTO illustrating Split storage mode; the no-JSONB-duplication behavior is covered only by SplitModeProductionTests, which is map-absent"}
[PerspectiveStorage(FieldStorageMode.Split)]
public record DocumentSearchDto {
    [StreamId]
    public Guid DocumentId { get; init; }

    // Vector in physical column only (not duplicated in JSONB)
    [VectorField(1536)]
    public float[]? Embedding { get; init; }

    // Other fields in JSONB only
    public string Title { get; init; }
    public string Content { get; init; }
}
```

In Split mode, EF Core materializes the `Data` model from JSONB only, so physical/vector column values are hydrated back into the model after materialization. The production hydration path is `SplitModeChangeTrackerHydrator` (hooked to the `ChangeTracker.Tracked` event, and acting only on rows a query materialized, so an entity you add or update on the same context is saved as usual); `PhysicalFieldMaterializationInterceptor` (an EF Core `IMaterializationInterceptor`) is kept as a fallback, since `InitializedInstance` fires before `ComplexProperty().ToJson()` populates `Data`.

## Querying Vectors

Vector similarity search is exposed through the `VectorSearchExtensions` LINQ extensions in `Whizbang.Data.EFCore.Postgres`, applied to a lens query's `Query` property (`IQueryable<PerspectiveRow<TModel>>`). One extension method exists per distance metric -- the method you call picks the pgvector operator:

| Method | Operator | Metric |
|--------|----------|--------|
| `OrderByCosineDistance` | `<=>` | Cosine |
| `OrderByL2Distance` | `<->` | L2 (Euclidean) |
| `OrderByInnerProductDistance` | `<#>` | Inner product |
| `WithinCosineDistance` / `WithinL2Distance` | `<=>` / `<->` | Threshold filter |

```csharp{title="Querying Vectors" description="Use the VectorSearchExtensions LINQ API for similarity search:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Querying", "Vectors"] tests=["VectorSearchExtensionsTests.OrderByCosineDistance_BuildsValidExpressionTreeAsync"]}
using Whizbang.Data.EFCore.Postgres;

// Find similar products
float[] queryVector = await embeddingService.GetEmbeddingAsync("wireless headphones");

var results = await productLensQuery.Query
    .OrderByCosineDistance(m => m.ContentEmbedding, queryVector)
    .Take(10)
    .ToListAsync();
```

The vector selector targets the **model** (`m => m.ContentEmbedding`, a `float[]?` property); overloads also accept a second column selector to compare two vector columns entirely in SQL.

### With Filters

Combine vector search with traditional filters:

```csharp{title="With Filters" description="Combine vector search with traditional filters:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Filters"] tests=["VectorSearchExtensionsTests.WithinCosineDistance_BuildsValidExpressionTreeAsync", "VectorSearchExtensionsTests.OrderByCosineDistance_BuildsValidExpressionTreeAsync"]}
var results = await productLensQuery.Query
    .Where(r => r.Data.CategoryId == categoryId)
    .Where(r => r.Data.Price <= maxPrice)
    .WithinCosineDistance(m => m.ContentEmbedding, queryVector, threshold: 0.5)
    .OrderByCosineDistance(m => m.ContentEmbedding, queryVector)
    .Take(10)
    .ToListAsync();
```

Using `[VectorField]` requires the `Pgvector.EntityFrameworkCore` package -- the `WHIZ070` compile-time diagnostic reports when it is missing.

## Common Embedding Dimensions

| Model | Dimensions |
|-------|------------|
| OpenAI text-embedding-ada-002 | 1536 |
| OpenAI text-embedding-3-small | 1536 |
| OpenAI text-embedding-3-large | 3072 |
| Sentence Transformers all-MiniLM-L6-v2 | 384 |
| Sentence Transformers all-mpnet-base-v2 | 768 |
| Cohere embed-english-v3.0 | 1024 |

## Best Practices

1. **Use Split mode** for perspectives with vectors to avoid JSONB duplication
2. **Choose HNSW** for production workloads requiring high recall
3. **Choose IVFFlat** for rapid prototyping or memory-constrained environments
4. **Tune IndexLists** based on your dataset size
5. **Use Cosine** for text embeddings unless you have specific requirements
6. **Normalize vectors** before storage if using InnerProduct

## Prerequisites: the pgvector extension {#pgvector-extension}
{verified: RequiredVectorExtensionTests.AvailableButNotInstalled_StartSucceeds_BecauseTheProbeFindsWhatTheDataSourceCreatedAsync, RequiredVectorExtensionTests.RefusedByTheServer_StartFails_NamingTheFeatureTheColumnAndTheFixAsync, RequiredVectorExtensionTests.AlreadyInstalled_IsLeftAlone_EvenForARoleThatCouldNotCreateItAsync, VectorRequiredExtensionGenerationTests.VectorFields_CreatePgvectorThroughTheHelperAtEverySite_AndNeverInlineAsync}

A vector column cannot exist without pgvector, so every vector column is an **explicit**
[capability requirement](../../operations/infrastructure/capabilities.md#requirement-sources) on
`postgres/vector`, whatever configuration says.

Whizbang creates the extension itself, before the data source is built, wherever the server allows:

| pgvector on the server | What happens at start |
|---|---|
| installed | left alone, even when the service's role could not create it |
| available, not installed | created; the [startup verdict](../../operations/infrastructure/capabilities.md#verdict) finds it Ready |
| refused (not allowlisted, no privilege, not installed on the server) | **start fails** with the verdict line, naming every vector column and the fix |

```text
capability postgres/vector on 'db': NotPermitted; NotAllowlisted. Fix: add VECTOR to the server's extension allowlist (azure.extensions on Azure Database for PostgreSQL). Required by: Vector fields on perspectives (wh_per_product.embedding, explicit)
```

The extension is created before anything probes it, because the capability probe opens its connections through
the same data source, so a server that only offers pgvector never fails start. To create it yourself instead (for
example with an administrator role during provisioning), run:

```sql{title="Create pgvector ahead of time" description="An operator with the right to create it runs this once; Whizbang then leaves the installed extension alone." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Prerequisites", "pgvector"]}
CREATE EXTENSION IF NOT EXISTS vector;
```

## See Also

- [Physical Fields](physical-fields.md) - Physical column storage
- [Vector Search (Lenses)](../lenses/vector-search.md) - Vector query API
- [Perspective Registry](registry.md) - Table tracking
