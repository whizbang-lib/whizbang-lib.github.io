---
title: 'WHIZ200: An array of records stores the perspective model as one opaque document'
pageType: troubleshooting
verifiedAgainstCommit: 0e062d64
verifiedDate: 2026-10-31
description: >-
  Warning diagnostic when a perspective model holds an array of records at any depth. On the Entity Framework driver
  such a model is stored as one opaque document, so none of its fields can be indexed; List<T>, IList<T> or
  ImmutableList<T> keep it mapped.
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
  - src/Whizbang.Generators.Shared/Models/MappedPathDiscovery.cs
  - src/Whizbang.Generators/build/SoftwareExtravaganza.Whizbang.Generators.props
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectiveModelArrayAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveModelArrayAnalyzerCoverageTests.cs
lastMaintainedCommit: '0e062d64'
---

# WHIZ200: An array of records stores the perspective model as one opaque document

**Severity**: Warning
**Category**: Model Validation (`Whizbang.ModelValidation`)

## Description

On the Entity Framework driver a perspective model is stored on the mapped path, property by property, so its fields
can be indexed and filtered. Entity Framework cannot read an array of records back on that path, so a model that holds
one is stored as one opaque document instead. The model reads and writes correctly, but nothing inside it is a mapped
property, so none of its fields can be indexed. See
[Collections in read models](../../fundamentals/perspectives/perspectives.md#model-collections) for every collection
shape and the path it takes.

WHIZ200 tells you a model took the opaque path because of an array, so the loss of indexing is a choice you make rather
than a surprise.

{verified: PerspectiveModelArrayAnalyzerTests.AnArrayOfRecords_IsReportedAtItsProperty_SayingTheModelIsStoredOpaquelyAsync}

### When it is reported {#when-reported}

WHIZ200 is reported once for each property that is an array of non-primitive elements, at any depth of a perspective
model:

- at the top of the model (`Tag[] Tags`);
- inside a nested object (`Detail.Tags`);
- inside the elements of a list or of another array (`Groups.Tags`, where `Groups` is a `List<Group>` or a `Group[]`);
- an array of arrays, such as `int[][]`.

A perspective model is a type some perspective in the project projects: through `IPerspectiveFor`,
`IPerspectiveWithActionsFor` or `IGlobalPerspectiveFor`. A model several perspectives project is reported once per
property, not once per perspective.

The warning is reported at the property, and names it by its path from the model. When the model's source is in
another project, there is no property in this compilation to report at, so the warning is reported at the perspective
class that projects it, still naming the property.

WHIZ200 is reported only in a project that references `Whizbang.Data.EFCore.Postgres`, because the opaque form belongs
to the Entity Framework driver. A Dapper-only project is never told about it: the Dapper driver reads every model from
its serialized document. One limitation follows: a model declared in a contracts project that does not reference the
Entity Framework driver is not reported there.

{verified: PerspectiveModelArrayAnalyzerTests.AnArrayOfRecordsUnderANestedObject_IsReportedByItsPathAsync, PerspectiveModelArrayAnalyzerTests.AnArrayOfRecordsInsideACollectionElement_IsReportedByItsPathAsync, PerspectiveModelArrayAnalyzerTests.AnArrayOfArrays_IsReportedAsync, PerspectiveModelArrayAnalyzerTests.AGlobalPerspectivesModel_IsReportedAsync, PerspectiveModelArrayAnalyzerTests.AModelTwoPerspectivesProject_IsReportedOnceAsync, PerspectiveModelArrayAnalyzerTests.AModelFromAnotherAssembly_IsReportedAtThePerspectiveAsync, PerspectiveModelArrayAnalyzerTests.AProjectWithoutTheEntityFrameworkDriver_IsNotReportedAsync}

### What is not reported {#not-reported}

- **Arrays of primitives**: `string[]`, `Guid[]`, `int[]`, `byte[]`, `float[]`, an enum array, or an array of a
  nullable primitive such as `int?[]`. The mapped path stores these as a value and reads them back, so the model stays
  mapped and indexable.
- **`List<T>`, `IList<T>` and `ImmutableList<T>`** of records. These keep the model mapped.
- **A type no perspective projects**, whatever its name or attributes.

{verified: PerspectiveModelArrayAnalyzerTests.AnArrayOfPrimitives_IsNotReportedAsync, PerspectiveModelArrayAnalyzerTests.ACollectionTheMappedPathFills_IsNotReportedAsync, PerspectiveModelArrayAnalyzerTests.ATypeNoPerspectiveProjects_IsNotReported_WhateverItsNameAsync}

:::updated
WHIZ200 used to be titled "Perspective model should use List<T> instead of array". It reported every array,
primitives included, on any type named `...Model` with a `[StreamId]` property, said arrays break Entity Framework
change tracking, and fired in projects that never use the Entity Framework driver. A model holding an array of records
is now stored as one opaque document and reads back on both drivers, and an array of primitives stays mapped. So the
warning now reports only an array of records, at any depth of a model a perspective actually projects, only in a
project that references the Entity Framework driver, and says what it costs: the model's fields cannot be indexed. The
`...Model` name rule is gone, and the warning can be turned off for a whole project with
[`WhizbangOpaqueArrayWarning`](#turning-off).
:::

## Diagnostic Message

```text
Property '{0}' of perspective model '{1}' is an array of records ('{2}'), so the model is stored as one opaque document and none of its fields can be indexed. Declare it as List<{3}>, IList<{3}> or ImmutableList<{3}> to keep the document mapped and indexable.
```

| Placeholder | Meaning | Example |
|-------------|---------|---------|
| `{0}` | The property's path from the model | `Groups.Tags` |
| `{1}` | The perspective model | `OrderModel` |
| `{2}` | The array type | `Tag[]` |
| `{3}` | The element type | `Tag` |

## Common Causes

1. **A collection of child records declared as `T[]`** on the read model, such as line items or tags.
2. **A model shared with an API contract** that uses arrays.
3. **An array of records on a nested type**, such as the records inside a list element.

## How to Fix

Choose one:

- **Keep the model indexable**: declare the member as `List<T>`, `IList<T>` or `ImmutableList<T>`. The model stays on
  the mapped path and its fields can be indexed.
- **Accept opaque storage**: if nothing in the model is filtered or indexed, the opaque document is fine. It reads and
  writes correctly on both drivers. [Suppress the warning](#suppressing) for that property.

### Before (causes WHIZ200)

```csharp{title="Array of records on a perspective model (causes WHIZ200)" description="A Tag[] property on a model a perspective projects stores the model as one opaque document, and is reported as WHIZ200." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "Perspectives", "EF Core", "WHIZ200"] testFile="PerspectiveModelArrayAnalyzerTests.cs" testMethod="AnArrayOfRecords_IsReportedAtItsProperty_SayingTheModelIsStoredOpaquelyAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectiveModelArrayAnalyzerTests.cs" tests=["PerspectiveModelArrayAnalyzerTests.AnArrayOfRecords_IsReportedAtItsProperty_SayingTheModelIsStoredOpaquelyAsync"]}
using System;
using Whizbang.Core;
using Whizbang.Core.Perspectives;

public sealed record Tag(Guid TagId, string Label);

public record Noted([property: StreamId] Guid Id) : IEvent;

public class LedgerModel {
  [StreamId] public Guid Id { get; set; }
  public Tag[] Tags { get; set; } = [];  // WHIZ200
}

public class LedgerProjection : IPerspectiveFor<LedgerModel, Noted> {
  public LedgerModel Apply(LedgerModel currentData, Noted eventData) => currentData;
}
```

### After (no diagnostic)

```csharp{title="List of records on a perspective model" description="A List<T> of records keeps the model on the mapped path, so it is indexable and not reported." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "Perspectives", "EF Core", "WHIZ200"] testFile="PerspectiveModelArrayAnalyzerTests.cs" testMethod="ACollectionTheMappedPathFills_IsNotReportedAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectiveModelArrayAnalyzerTests.cs" tests=["PerspectiveModelArrayAnalyzerTests.ACollectionTheMappedPathFills_IsNotReportedAsync"]}
using System;
using System.Collections.Generic;
using Whizbang.Core;

public class LedgerModel {
  [StreamId] public Guid Id { get; set; }
  public List<Tag> Tags { get; set; } = [];
}
```

## Turning it off for a project {#turning-off}

The warning is on by default. For a project that treats warnings as errors and has chosen opaque storage for its
models, turn it off with an MSBuild property in the project file or `Directory.Build.props`:

```xml{title="Turn WHIZ200 off for a project" description="WhizbangOpaqueArrayWarning=false turns the warning off for every property in the project." category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "WHIZ200", "MSBuild"] tests=["PerspectiveModelArrayAnalyzerTests.TheBuildProperty_TurnsTheWarningOffAsync"]}
<PropertyGroup>
  <WhizbangOpaqueArrayWarning>false</WhizbangOpaqueArrayWarning>
</PropertyGroup>
```

Only `false` turns it off, in any letter case and ignoring surrounding spaces. Any other value, or no value, leaves it
on.

{verified: PerspectiveModelArrayAnalyzerTests.TheBuildProperty_TurnsTheWarningOffAsync, PerspectiveModelArrayAnalyzerTests.AnyOtherValueOrNoValue_LeavesTheWarningOnAsync, PerspectiveModelArrayAnalyzerTests.ThePackage_DeclaresTheBuildPropertyAsync}

## Suppressing {#suppressing}

To accept opaque storage for one property and keep the warning everywhere else, suppress it where it is reported.

With a pragma:

```csharp{title="Suppress WHIZ200 with a pragma" description="Disables WHIZ200 around a single array-of-records property." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "Perspectives", "WHIZ200", "Suppression"] testFile="PerspectiveModelArrayAnalyzerTests.cs" testMethod="APragma_SuppressesItForThatPropertyAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectiveModelArrayAnalyzerTests.cs" tests=["PerspectiveModelArrayAnalyzerTests.APragma_SuppressesItForThatPropertyAsync"]}
#pragma warning disable WHIZ200 // The model is read whole; nothing in it is filtered.
  public Tag[] Tags { get; set; } = [];
#pragma warning restore WHIZ200
```

With an attribute on the property:

```csharp{title="Suppress WHIZ200 with SuppressMessage" description="A SuppressMessage on the property suppresses WHIZ200 for that property alone." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "Perspectives", "WHIZ200", "Suppression"] testFile="PerspectiveModelArrayAnalyzerTests.cs" testMethod="ASuppressMessageOnTheProperty_SuppressesItForThatPropertyAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectiveModelArrayAnalyzerTests.cs" tests=["PerspectiveModelArrayAnalyzerTests.ASuppressMessageOnTheProperty_SuppressesItForThatPropertyAsync"]}
using System.Diagnostics.CodeAnalysis;

[SuppressMessage("Whizbang.ModelValidation", "WHIZ200:Array of records stores the model opaquely",
  Justification = "The model is read whole; nothing in it is filtered.")]
public Tag[] Tags { get; set; } = [];
```

{verified: PerspectiveModelArrayAnalyzerTests.APragma_SuppressesItForThatPropertyAsync, PerspectiveModelArrayAnalyzerTests.ASuppressMessageOnTheProperty_SuppressesItForThatPropertyAsync}

## Related

- [Collections in read models](../../fundamentals/perspectives/perspectives.md#model-collections)
- [WHIZ304](whiz304.md): a declared index on an opaquely stored model
- [Physical Fields](../../fundamentals/perspectives/physical-fields)
- [Perspectives](../../fundamentals/perspectives/perspectives)
