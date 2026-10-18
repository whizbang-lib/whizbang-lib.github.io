---
title: 'WHIZ811: Perspective Model Contains Polymorphic Type'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Informational notice that a perspective model holds an abstract or [JsonPolymorphic] type, with a
  suggestion to add a [PolymorphicDiscriminator] column for type-based queries.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - perspectives
  - polymorphism
  - discriminator
  - analyzer
codeReferences:
  - src/Whizbang.Data.EFCore.Postgres.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/PerspectiveModelPolymorphicAnalyzer.cs
  - src/Whizbang.Generators.Shared/Models/PolymorphicModelDiscovery.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PerspectiveModelPolymorphicAnalyzerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PerspectiveModelPolymorphicAnalyzerCoverageTests.cs
  - tests/Whizbang.Generators.Tests/Analyzers/PerspectiveModelDictionaryAnalyzerBranchTests.cs
  - tests/Whizbang.Generators.Tests/Analyzers/SystemTypeWalkTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ811: Perspective Model Contains Polymorphic Type

**Severity**: Info
**Category**: Perspective Model Mapping

## Description

This is a discovery notice, not a problem report. The `PerspectiveModelPolymorphicAnalyzer` tells you that a
perspective model holds a polymorphic value: a property whose type is an abstract class, or a class or
interface marked `[JsonPolymorphic]`. A model like that is stored as a jsonb document written and read through
System.Text.Json polymorphic serialization, so asking "which rows hold a `TextFieldSettings`?" means reading
the JSON of every row. The notice suggests a
[`[PolymorphicDiscriminator]`](../../fundamentals/perspectives/polymorphic-discriminator) property, which
the generator promotes to its own indexed column.

The analyzer walks the model of every non-abstract class that implements `IPerspectiveFor<TModel, TEvent...>`
(or `IPerspectiveWithActionsFor` / `IPerspectiveBase` with a model and at least one event) and reports a
property when its type, or the element type of a `List<T>`, `IList<T>`, `ICollection<T>`, `IEnumerable<T>`,
`IReadOnlyList<T>`, `IReadOnlyCollection<T>`, `ImmutableList<T>` or `ImmutableArray<T>`, is polymorphic. It
also walks nested classes and structs and generic arguments.

It does **not** report:

- a sealed or concrete type, or a plain interface without `[JsonPolymorphic]`,
- an array of an abstract type (`LineItem[]`): array properties are not inspected,
- a property that is not public, or is static, an indexer, write-only, `[NotMapped]` or `[JsonIgnore]`
  (so a record's compiler-generated `EqualityContract` is never reported),
- members of non-collection `System` types,
- a class that is not a perspective's model.

Adding a `[PolymorphicDiscriminator]` property does **not** silence the notice: the abstract property is still
reported (the discriminator property itself never is). Each property is reported once, however many
perspective interfaces share the model.

## Diagnostic Message

```
Property '{PropertyName}' on perspective model '{DeclaringType}' is abstract type '{PolymorphicType}'. Consider using [PolymorphicDiscriminator] on a discriminator property for efficient type-based queries.
```

`{DeclaringType}` is the type that declares the property (a nested type when the property sits inside one).
The text says "abstract type" for a `[JsonPolymorphic]` class or interface as well.

## Common Causes

1. **A model property typed as an abstract base class**, such as `PaymentMethod? Payment`.
2. **A `[JsonPolymorphic]` class or interface** used as a property type.
3. **A collection of a polymorphic type**, such as `List<Shape>` or `IReadOnlyList<Shape>`.
4. **A nested object** whose own property is polymorphic.

## What Produces It

{verified: PerspectiveModelPolymorphicAnalyzerTests.PerspectiveModel_WithAbstractClassProperty_ReportsWHIZ811Async, PerspectiveModelPolymorphicAnalyzerTests.PerspectiveModel_WithDiscriminatorAndAbstractProperty_StillReportsWHIZ811ForAbstractPropertyOnlyAsync}

```csharp{title="An abstract property on a perspective model" description="Payment is typed as the abstract PaymentMethod, so WHIZ811 (Info) is reported for it." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "perspectives", "polymorphism", "whiz811"] testFile="PerspectiveModelPolymorphicAnalyzerTests.cs" testMethod="PerspectiveModel_WithAbstractClassProperty_ReportsWHIZ811Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Data.EFCore.Postgres.Tests/PerspectiveModelPolymorphicAnalyzerTests.cs" tests=["PerspectiveModelPolymorphicAnalyzerTests.PerspectiveModel_WithAbstractClassProperty_ReportsWHIZ811Async"]}
public abstract class PaymentMethod {
  public string Name { get; set; } = string.Empty;
}

public class TestModel {
  public Guid Id { get; set; }
  public PaymentMethod? Payment { get; set; }  // WHIZ811 (Info)
}

public record TestEvent(Guid Id);

public class TestPerspective : IPerspectiveFor<TestModel, TestEvent> {
  public TestModel Apply(TestModel? model, TestEvent evt) => model ?? new();
}
```

## How to Respond

- **If you query by derived type**, add a string property marked `[PolymorphicDiscriminator]` and set it to
  the type name when you apply events. See
  [Polymorphic Discriminator](../../fundamentals/perspectives/polymorphic-discriminator). The notice stays,
  so silence it once you have decided.
- **If you never query by type**, there is nothing to change. Silence the notice.

## Suppressing

The notice is reported on the property, so a pragma or `.editorconfig` entry works:

```csharp{title="Silence WHIZ811 for one property" description="A pragma around the reported property." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "suppression", "whiz811"] unverified="suppression syntax, not exercised by a test"}
#pragma warning disable WHIZ811
  public PaymentMethod? Payment { get; set; }
#pragma warning restore WHIZ811
```

```ini{title="Silence WHIZ811 in .editorconfig" description="Turns the notice off for the matched files."}
[*.cs]
dotnet_diagnostic.WHIZ811.severity = none
```

Suppressing is always safe: the notice reports nothing wrong, only a query optimization you may want.

## Related

- [Polymorphic Types in Perspectives](../../fundamentals/perspectives/polymorphic-types)
- [Polymorphic Discriminator](../../fundamentals/perspectives/polymorphic-discriminator)
- [WHIZ810: Perspective Model Contains Dictionary Property](whiz810)
- [WHIZ812: Perspective Model Declares a JSON Converter That Is Never Consulted](whiz812)
