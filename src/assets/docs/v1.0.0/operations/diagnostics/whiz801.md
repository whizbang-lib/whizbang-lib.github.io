---
title: 'WHIZ801: VectorField Invalid Type'
pageType: troubleshooting
verifiedAgainstCommit: 7e3d0a73
verifiedDate: 2026-10-19
description: >-
  Error reported on a [VectorField] attribute whose property is not a one-dimensional float[] (System.Single[]), the only
  type a vector column can hold.
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
  - src/Whizbang.Core/Perspectives/VectorFieldAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/PerspectiveFieldAnalyzerTests.cs
lastMaintainedCommit: '7e3d0a73'
---

# WHIZ801: VectorField Invalid Type

**Severity**: Error
**Category**: Physical Field Validation

## Description

`[VectorField(dimensions)]` marks a perspective model property as an embedding stored in a pgvector `vector` column.
A vector column holds single-precision values, so the property must be `float[]` (`System.Single[]`). A property of
any other type has no matching column representation.

An analyzer checks every property that carries `[VectorField]` and reports WHIZ801 at the attribute when the property
type is anything other than a one-dimensional `float[]`. `double[]`, a single `float`, and collections such as
`List<float>` are all reported. A nullable `float[]?` is fine. Because WHIZ801 is an error, the build fails until the
type is fixed.

The same attribute can also report [WHIZ802](whiz802) when its dimensions are not positive.

## Diagnostic Message

```text
[VectorField] on {ModelType}.{PropertyName} requires property type float[] or Single[]
```

## Common Causes

1. **A `double[]` embedding**, because the embedding client returns doubles.
2. **A collection type** such as `List<float>` or `IReadOnlyList<float>` in place of an array.
3. **The attribute on the wrong property**, for example on the text the embedding was computed from.

## How to Fix

Declare the property as `float[]` (nullable if the embedding may be absent) and convert values to `float` when you
assign them.

### Before (reports WHIZ801)

```csharp{title="[VectorField] on a double[] property" description="The property is not float[], so WHIZ801 is reported at the attribute and the build fails." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["whiz801", "vector-field", "counter-example"] tests=["PerspectiveFieldAnalyzerTests.AVectorFieldOnAnotherType_ReportsWhiz801Async"]}
using Whizbang.Core.Perspectives;

public record ProductSearchModel {
  [VectorField(1536)]                     // WHIZ801: not float[]
  public double[] Embedding { get; init; } = [];
}
```

### After

```csharp{title="[VectorField] on a float[] property" description="The property type a vector column requires; nothing is reported." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["whiz801", "vector-field", "float-array"] tests=["PerspectiveFieldAnalyzerTests.AVectorFieldOnFloatArray_IsNotReportedAsync"]}
using Whizbang.Core.Perspectives;

public record ProductSearchModel {
  [VectorField(1536)]
  public float[] Embedding { get; init; } = [];
}
```

A `float[]` property with `[VectorField]` is also exempt from the "use `List<T>` instead of an array" perspective
model warning (WHIZ200), so the array type is the intended one.

## Suppressing

Do not suppress it. A suppressed WHIZ801 leaves a property the schema generator still maps to a `vector(N)` column,
which the property type cannot fill. Fix the type instead.

## Related

- [WHIZ802: VectorField invalid dimensions](whiz802)
- [WHIZ070: Missing Pgvector.EntityFrameworkCore package](whiz070)
- [WHIZ071: Missing Pgvector package](whiz071)
- [Vector Fields](../../fundamentals/perspectives/vector-fields)
- [Physical Fields](../../fundamentals/perspectives/physical-fields)
