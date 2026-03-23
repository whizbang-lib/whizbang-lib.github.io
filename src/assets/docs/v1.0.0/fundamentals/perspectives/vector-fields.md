---
title: Vector Fields
version: 1.0.0
category: Perspectives
---

# Vector Fields

Vector fields enable similarity search in your perspectives using PostgreSQL's pgvector extension. Store embeddings from machine learning models and perform efficient nearest-neighbor queries directly in your database.

## Overview

Vector fields are a specialized type of physical field designed for storing and querying high-dimensional vectors (embeddings). They support various distance metrics and index types optimized for similarity search.

| Feature | Description |
|---------|-------------|
| **Storage** | Native pgvector `vector(N)` column type |
| **Indexing** | IVFFlat or HNSW for approximate nearest neighbor |
| **Distance metrics** | L2 (Euclidean), Cosine, Inner Product |
| **Integration** | Works with OpenAI, Sentence Transformers, and any embedding model |

## Defining Vector Fields

Use the `[VectorField]` attribute on `float[]` properties:

```csharp{title="Defining Vector Fields" description="Use the [VectorField] attribute on float[] properties:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Defining", "Vector"]}
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
| `Dimensions` | `int` | (required) | Number of dimensions in the vector |
| `DistanceMetric` | `VectorDistanceMetric` | `Cosine` | Distance metric for similarity |
| `Indexed` | `bool` | `true` | Whether to create a vector index |
| `IndexType` | `VectorIndexType` | `IVFFlat` | Index algorithm |
| `IndexLists` | `int` | `100` | Number of lists for IVFFlat |
| `ColumnName` | `string?` | `null` | Custom column name |

## VectorIndexType {#VectorIndexType}

`VectorIndexType` defines the index algorithm for vector columns. Each type offers different trade-offs between build time, memory usage, and query performance.

```csharp{title="VectorIndexType" description="VectorIndexType defines the index algorithm for vector columns." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "VectorIndexType"]}
public enum VectorIndexType {
    None = 0,      // No index - exact (sequential) search
    IVFFlat = 1,   // Inverted File Flat - balanced performance
    HNSW = 2       // Hierarchical Navigable Small World - best recall
}
```

### None

No index is created; queries perform exact sequential search. Use only for small datasets (under 10,000 rows) or when perfect recall is required.

```csharp{title="None" description="No index is created; queries perform exact sequential search." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "None"]}
[VectorField(1536, IndexType = VectorIndexType.None)]
public float[]? Embedding { get; init; }
```

### IVFFlat

Inverted File Flat index partitions vectors into clusters for faster approximate search. Good balance of build speed and query performance.

```csharp{title="IVFFlat" description="Inverted File Flat index partitions vectors into clusters for faster approximate search." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "IVFFlat"]}
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

```csharp{title="HNSW" description="Hierarchical Navigable Small World graph provides better recall and query performance at the cost of more memory and" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "HNSW"]}
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

```csharp{title="VectorDistanceMetric" description="VectorDistanceMetric defines the similarity measure used for vector comparisons." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "VectorDistanceMetric"]}
public enum VectorDistanceMetric {
    L2 = 0,           // Euclidean distance
    InnerProduct = 1, // Negative inner product
    Cosine = 2        // Cosine distance
}
```

### L2 (Euclidean Distance)

Measures the straight-line distance between vectors. Lower values indicate more similar vectors.

```csharp{title="L2 (Euclidean Distance)" description="Measures the straight-line distance between vectors." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Euclidean", "Distance"]}
[VectorField(1536, DistanceMetric = VectorDistanceMetric.L2)]
public float[]? Embedding { get; init; }
```

**PostgreSQL operator:** `<->`

**Formula:** `sqrt(sum((a[i] - b[i])^2))`

**Use when:** You need geometric distance, or your embeddings are not normalized.

### InnerProduct

Measures the dot product between vectors (negated for ordering). Higher original values indicate more similar vectors.

```csharp{title="InnerProduct" description="Measures the dot product between vectors (negated for ordering)." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "InnerProduct"]}
[VectorField(1536, DistanceMetric = VectorDistanceMetric.InnerProduct)]
public float[]? Embedding { get; init; }
```

**PostgreSQL operator:** `<#>`

**Note:** The result is negated so that ORDER BY works correctly (lower = more similar).

**Use when:** Your vectors are normalized, or you're working with models that output normalized embeddings.

### Cosine (Default)

Measures the angle between vectors. Lower values indicate more similar vectors (0 = identical, 2 = opposite).

```csharp{title="Cosine (Default)" description="Measures the angle between vectors." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Cosine", "Default"]}
[VectorField(1536, DistanceMetric = VectorDistanceMetric.Cosine)]
public float[]? Embedding { get; init; }
```

**PostgreSQL operator:** `<=>`

**Formula:** `1 - cosine_similarity(a, b)`

**Value range:** 0 (identical) to 2 (opposite)

**Use when:** Direction matters more than magnitude, or for text embeddings where normalization may vary.

## Storage Mode for Vectors

Vector fields are always stored as physical columns. Use `FieldStorageMode.Split` to avoid storing large vector arrays in JSONB:

```csharp{title="Storage Mode for Vectors" description="Vector fields are always stored as physical columns." category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Storage", "Mode"]}
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

## Querying Vectors

Use the lens query API with vector similarity search:

```csharp{title="Querying Vectors" description="Use the lens query API with vector similarity search:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Querying", "Vectors"]}
// Find similar products
var queryVector = await embeddingService.GetEmbeddingAsync("wireless headphones");

var results = await lens.QueryAsync<ProductSearchDto>()
    .OrderByVectorDistance(r => r.Data.ContentEmbedding, queryVector)
    .Take(10)
    .ToListAsync();
```

### With Filters

Combine vector search with traditional filters:

```csharp{title="With Filters" description="Combine vector search with traditional filters:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Filters"]}
var results = await lens.QueryAsync<ProductSearchDto>()
    .Where(r => r.Data.CategoryId == categoryId)
    .Where(r => r.Data.Price <= maxPrice)
    .OrderByVectorDistance(r => r.Data.ContentEmbedding, queryVector)
    .Take(10)
    .ToListAsync();
```

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

## Prerequisites

Vector fields require the pgvector extension in PostgreSQL:

```sql{title="Prerequisites" description="Vector fields require the pgvector extension in PostgreSQL:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Prerequisites"]}
CREATE EXTENSION IF NOT EXISTS vector;
```

Whizbang automatically creates this extension during database initialization if you have the necessary permissions.

## See Also

- [Physical Fields](physical-fields.md) - Physical column storage
- [Vector Search (Lenses)](../lenses/vector-search.md) - Vector query API
- [Perspective Registry](registry.md) - Table tracking
