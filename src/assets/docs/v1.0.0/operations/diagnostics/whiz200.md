---
title: 'WHIZ200: Perspective model should use List<T> instead of array'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning diagnostic when a perspective model has an array property. EF Core change tracking grows collections in
  place, which fails on fixed-size arrays; List<T> avoids the error.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - perspectives
  - model-validation
  - ef-core
  - collections
  - analyzer
codeReferences:
  - src/Whizbang.Generators/PerspectiveModelArrayAnalyzer.cs
  - src/Whizbang.Generators.Shared/Models/PhysicalFieldScalar.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectiveModelArrayAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveModelArrayAnalyzerCoverageTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ200: Perspective model should use List<T> instead of array

**Severity**: Warning
**Category**: Model Validation (`Whizbang.ModelValidation`)

## Description

Perspective models are persisted through EF Core. EF Core's change-tracking snapshot adds items to collections
through `IList.Add()`, which throws "Collection was of a fixed size" on an array. Declaring the property as
`List<T>` avoids that failure.

The `PerspectiveModelArrayAnalyzer` reports WHIZ200 once for each array-typed property of a class or record it
treats as a perspective model, including properties inherited from a base class. A type is treated as a perspective
model when either:

- it carries an attribute whose full name ends in `.PerspectiveAttribute`, or
- its name ends in `Model` and it declares a property marked `[StreamId]`.

The analyzer does not look for an `IPerspectiveFor<...>` that uses the type. A model named, say, `OrderView` with no
such attribute is not checked, and a `...Model` type with a `[StreamId]` property is checked even if no perspective
uses it.

These array properties are deliberately **not** reported:

- a property marked `[VectorField]` (embeddings are `float[]` by design and handled by the generator);
- a property marked `[PhysicalField]` whose column is `jsonb`, declared with `ColumnType = "jsonb"` or defaulted.
  Arrays default to a `jsonb` column except `byte[]`, `float[]` and `double[]`, so `[PhysicalField] Guid[]` is
  silent while `[PhysicalField] double[]` and `[PhysicalField(ColumnType = "uuid[]")] Guid[]` are still reported.

## Diagnostic Message

```text
Property '{PropertyName}' in perspective model '{ModelName}' uses array type '{ArrayType}'. Use 'List<{ElementType}>' instead to avoid EF Core change tracking errors.
```

## Common Causes

1. **A tags or id list declared as `string[]` or `Guid[]`** on the read model.
2. **A model shared with an API contract** that uses arrays.
3. **An array inherited from a base model class.**

## How to Fix

Change the property type to `List<T>`. Alternatively, if the array is promoted with `[PhysicalField]`, keep it in a
`jsonb` column, which the generated model reads and writes as one converted value.

### Before (causes WHIZ200)

```csharp{title="Array property on a perspective model (causes WHIZ200)" description="An int[] property on a ...Model type with a [StreamId] property is reported as WHIZ200." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "Perspectives", "EF Core", "WHIZ200"] testFile="PerspectiveModelArrayAnalyzerTests.cs" testMethod="Analyzer_ArrayInStreamIdModel_ReportsWHIZ200WarningAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectiveModelArrayAnalyzerTests.cs" tests=["PerspectiveModelArrayAnalyzerTests.Analyzer_ArrayInStreamIdModel_ReportsWHIZ200WarningAsync"]}
using System;
using Whizbang.Core;

public class CustomerModel {
  [StreamId]
  public Guid Id { get; set; }
  public int[] OrderIds { get; set; }  // WHIZ200
}
```

### After (no diagnostic)

```csharp{title="List<T> property on a perspective model" description="A List<T> collection property is not an array and is not reported." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "Perspectives", "EF Core", "WHIZ200"] testFile="PerspectiveModelArrayAnalyzerTests.cs" testMethod="Analyzer_ListProperty_NoWarningAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectiveModelArrayAnalyzerTests.cs" tests=["PerspectiveModelArrayAnalyzerTests.Analyzer_ListProperty_NoWarningAsync"]}
using System;
using System.Collections.Generic;
using Whizbang.Core;

public class CustomerModel {
  [StreamId]
  public Guid Id { get; set; }
  public List<int> OrderIds { get; set; } = [];
}
```

## Suppressing

Suppress only for a property you have confirmed is never grown in place by change tracking, such as one promoted
to its own native column that you replace as a whole value. In most cases switching to `List<T>` is simpler and
safer than suppressing.

For one property:

```csharp{title="Suppress WHIZ200 with a pragma" description="Disables WHIZ200 around a single array property." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "Perspectives", "WHIZ200", "Suppression"] testFile="PerspectiveModelArrayAnalyzerTests.cs" testMethod="Analyzer_WithPragmaSuppress_NoVisibleWarningAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectiveModelArrayAnalyzerTests.cs" tests=["PerspectiveModelArrayAnalyzerTests.Analyzer_WithPragmaSuppress_NoVisibleWarningAsync"]}
#pragma warning disable WHIZ200
  public string[] Tags { get; set; }
#pragma warning restore WHIZ200
```

For a whole project, in `.editorconfig`:

```ini
[*.cs]
dotnet_diagnostic.WHIZ200.severity = none
```

## Related

- [Physical Fields](../../fundamentals/perspectives/physical-fields)
- [Vector Fields](../../fundamentals/perspectives/vector-fields)
- [Perspectives](../../fundamentals/perspectives/perspectives)
