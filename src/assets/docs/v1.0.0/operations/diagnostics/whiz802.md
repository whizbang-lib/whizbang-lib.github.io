---
title: 'WHIZ802: VectorField Invalid Dimensions'
description: >-
  Error diagnostic when a [VectorField] attribute has invalid dimensions value
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - vector
  - physical-field
  - perspectives
  - source-generator
---

# WHIZ802: VectorField Invalid Dimensions

**Severity**: Error
**Category**: Physical Field Validation

## Description

This error occurs when a `[VectorField]` attribute is applied with an invalid dimensions value. The dimensions parameter must be a positive integer representing the number of elements in the vector.

## Diagnostic Message

```
[VectorField] on 'ProductDto.Embedding' has invalid dimensions -1. Dimensions must be a positive integer.
```

## Common Causes

1. **Zero dimensions** - Using `[VectorField(0)]`
2. **Negative dimensions** - Using `[VectorField(-1)]`
3. **Typo in dimensions** - Accidentally typing wrong number

## How to Fix

Specify a valid positive integer for the dimensions:

### Before (causes WHIZ802)

```csharp{title="Before (causes WHIZ802)" description="Demonstrates before (causes WHIZ802)" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Before", "Causes"]}
public record ProductDto {
  [StreamKey]
  public Guid ProductId { get; init; }
  public string Name { get; init; } = string.Empty;

  [VectorField(0)]  // WHIZ802: Invalid dimensions
  public float[]? Embedding { get; init; }
}
```

### After (error resolved)

```csharp{title="After (error resolved)" description="Demonstrates after (error resolved)" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "After", "Error"]}
public record ProductDto {
  [StreamKey]
  public Guid ProductId { get; init; }
  public string Name { get; init; } = string.Empty;

  [VectorField(1536)]  // Valid - matches embedding model output
  public float[]? Embedding { get; init; }
}
```

## Common Embedding Dimensions

Different embedding models produce vectors of specific dimensions:

| Model | Dimensions |
|-------|------------|
| OpenAI text-embedding-3-small | 1536 |
| OpenAI text-embedding-3-large | 3072 |
| OpenAI text-embedding-ada-002 | 1536 |
| Cohere embed-english-v3 | 1024 |
| Sentence Transformers (all-MiniLM-L6-v2) | 384 |

## Why Dimensions Matter

The dimensions parameter:

1. **Creates PostgreSQL column** - `vector(1536)` type with fixed size
2. **Enables similarity search** - pgvector uses dimensions for indexing
3. **Validates at insert** - PostgreSQL rejects vectors with wrong dimensions

## Example: Multiple Embedding Types

```csharp{title="Example: Multiple Embedding Types" description="Demonstrates example: Multiple Embedding Types" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Example:", "Multiple"]}
public record DocumentDto {
  [StreamKey]
  public Guid DocumentId { get; init; }
  public string Title { get; init; } = string.Empty;

  [VectorField(1536)]  // OpenAI embeddings
  public float[]? ContentEmbedding { get; init; }

  [VectorField(384)]   // Sentence transformer for summaries
  public float[]? SummaryEmbedding { get; init; }
}
```

## Suppressing This Diagnostic

This is an error diagnostic and should not be suppressed. Fix the dimensions value instead.

If you have a legitimate need:

```csharp{title="Suppressing This Diagnostic" description="If you have a legitimate need:" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Suppressing", "This"]}
#pragma warning disable WHIZ802
[VectorField(0)]  // Not recommended
public float[]? TestEmbedding { get; init; }
#pragma warning restore WHIZ802
```

## Related Diagnostics

- [WHIZ070](whiz070.md) - Missing Pgvector.EntityFrameworkCore package
- WHIZ801 - VectorField on invalid type (must be `float[]`)
- [WHIZ807](whiz807.md) - Physical fields discovered (info)

## See Also

- [Vector Search](../../extending/features/vector-search.md) - Complete vector search documentation
- [VectorField Attribute](../../extending/features/vector-search.md#vectorfield-attribute) - Attribute usage
- [Physical Fields](../../fundamentals/perspectives/physical-fields.md) - Physical field overview
