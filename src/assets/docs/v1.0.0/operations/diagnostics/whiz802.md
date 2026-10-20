---
title: 'WHIZ802: VectorField Invalid Dimensions'
pageType: troubleshooting
verifiedAgainstCommit: 7e3d0a73
verifiedDate: 2026-10-19
description: >-
  Error reported on a [VectorField] attribute whose dimensions value is zero or negative. A pgvector column needs a
  positive dimension count.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - vector
  - physical-field
  - perspectives
  - source-generator
  - analyzer
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/Analyzers/PerspectiveFieldAnalyzer.cs
  - src/Whizbang.Generators/PerspectiveSchemaGenerator.cs
  - src/Whizbang.Generators.Shared/Models/PhysicalFieldInfo.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/PerspectiveFieldAnalyzerTests.cs
lastMaintainedCommit: '7e3d0a73'
---

# WHIZ802: VectorField Invalid Dimensions

**Severity**: Error
**Category**: Physical Field Validation

## Description

`[VectorField(dimensions)]` takes the number of elements in the vector. The schema generator writes that number into
the column type (`vector(1536)`), and pgvector rejects a column whose dimension count is not greater than zero.

An analyzer checks every `[VectorField]` attribute and reports WHIZ802 at the attribute when the dimensions value is
less than 1. The message quotes the value it found. Because WHIZ802 is an error, the build fails until the value is
fixed, instead of the problem surfacing later when the generated DDL is applied.

The same attribute can also report [WHIZ801](whiz801) when the property is not `float[]`.

## Diagnostic Message

```text
[VectorField] on {ModelType}.{PropertyName} has invalid dimensions {Dimensions}. Dimensions must be a positive integer.
```

## Common Causes

1. **Zero dimensions**, for example `[VectorField(0)]` left as a placeholder.
2. **Negative dimensions**, for example `[VectorField(-1)]`.
3. **A typo or a wrong constant** used for the dimension count.

## How to Fix

Set dimensions to the number of values your embedding model produces (common sizes are 384, 1024, 1536 and 3072).
Vectors written to the column must have exactly that many elements.

### Before (reports WHIZ802)

```csharp{title="[VectorField] with zero dimensions" description="The dimensions value is not positive, so WHIZ802 is reported at the attribute and the build fails." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["whiz802", "vector-field", "counter-example"] tests=["PerspectiveFieldAnalyzerTests.AVectorFieldWithNonPositiveDimensions_ReportsWhiz802Async"]}
using Whizbang.Core.Perspectives;

public record ProductSearchModel {
  [VectorField(0)]                        // WHIZ802: invalid dimensions 0
  public float[] Embedding { get; init; } = [];
}
```

### After

```csharp{title="[VectorField] with a positive dimension count" description="A positive dimension count on a float[] property; nothing is reported." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["whiz802", "vector-field"] tests=["PerspectiveFieldAnalyzerTests.AVectorFieldOnFloatArray_IsNotReportedAsync"]}
using Whizbang.Core.Perspectives;

public record ProductSearchModel {
  [VectorField(1536)]                     // matches the embedding model's output
  public float[] Embedding { get; init; } = [];
}
```

## Why Dimensions Matter

The dimensions value:

1. **Sizes the PostgreSQL column**: `vector(1536)` is a fixed-size type.
2. **Drives similarity search**: pgvector indexes and compares vectors of that size.
3. **Is checked on insert**: PostgreSQL rejects a vector with a different number of elements.

## Suppressing

Do not suppress it. A suppressed WHIZ802 leaves a `vector(0)` or negative column type in the generated schema, which
PostgreSQL rejects when the DDL is applied. Fix the value instead.

## Related

- [WHIZ801: VectorField invalid type](whiz801)
- [WHIZ070: Missing Pgvector.EntityFrameworkCore package](whiz070)
- [WHIZ807: Physical fields discovered](whiz807)
- [Vector Search](../../extending/features/vector-search)
- [Vector Fields](../../fundamentals/perspectives/vector-fields#defining-vector-fields)
- [Physical Fields](../../fundamentals/perspectives/physical-fields)
