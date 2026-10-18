---
title: 'WHIZ801: VectorField Invalid Type'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Error diagnostic defined for a [VectorField] attribute on a property that is not float[]. In this release the
  descriptor exists but no generator or analyzer reports it.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - vector
  - physical-field
  - perspectives
  - source-generator
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/PerspectiveSchemaGenerator.cs
  - src/Whizbang.Core/Perspectives/VectorFieldAttribute.cs
testReferences: []
lastMaintainedCommit: '9a416b5b'
---

# WHIZ801: VectorField Invalid Type

**Severity**: Error
**Category**: Physical Field Validation

## Description

`[VectorField(dimensions)]` marks a perspective model property as an embedding stored in a pgvector `vector` column.
The WHIZ801 descriptor states the rule for its property type: it must be `float[]` (`System.Single[]`). A vector
column holds single-precision values, so a property of any other type has no matching column representation.

:::updated
As shipped, the `WHIZ801` descriptor is defined in `DiagnosticDescriptors.cs` but nothing reports it, so you will not
see this error in a build. The schema generator reads `[VectorField]` without checking the property type and emits a
`vector(N)` column for it whatever the type is. Keep `[VectorField]` on `float[]` properties as described below; a
mismatch is not caught at build time today.
:::

## Diagnostic Message

```
[VectorField] on {ModelType}.{PropertyName} requires property type float[] or Single[]
```

## Common Causes

1. **A `double[]` embedding**, because the embedding client returns doubles.
2. **A collection type** such as `List<float>` or `IReadOnlyList<float>` in place of an array.
3. **The attribute on the wrong property**, for example on the text the embedding was computed from.

## How to Fix

Declare the property as `float[]` (nullable if the embedding may be absent) and convert values to `float` when you
assign them.

### Before (the rule WHIZ801 describes)

```csharp{
title: "[VectorField] on a double[] property"
description: "The descriptor's rule requires float[]; this property type does not satisfy it."
framework: "NET10"
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz801", "vector-field", "counter-example"]
unverified: "counter-example; WHIZ801 is defined but not reported, so no test emits it"
}
public record ProductSearchModel {
  [StreamId]
  public Guid Id { get; init; }

  // Not float[]: the WHIZ801 rule.
  [VectorField(1536)]
  public double[]? Embedding { get; init; }
}
```

### After

```csharp{
title: "[VectorField] on a float[] property"
description: "The property type the descriptor requires."
framework: "NET10"
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz801", "vector-field", "float-array"]
unverified: "WHIZ801 is defined but not reported, so no test covers the corrected form"
}
public record ProductSearchModel {
  [StreamId]
  public Guid Id { get; init; }

  [VectorField(1536)]
  public float[]? Embedding { get; init; }
}
```

A `float[]` property with `[VectorField]` is also exempt from the "use `List<T>` instead of an array" perspective
model warning (WHIZ200), so the array type is the intended one.

## Related

- [WHIZ802: VectorField invalid dimensions](whiz802)
- [WHIZ070: Missing Pgvector.EntityFrameworkCore package](whiz070)
- [WHIZ071: Missing Pgvector package](whiz071)
- [Vector Fields](../../fundamentals/perspectives/vector-fields)
- [Physical Fields](../../fundamentals/perspectives/physical-fields)
