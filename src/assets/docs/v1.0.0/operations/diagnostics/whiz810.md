---
title: 'WHIZ810: Perspective Model Contains Dictionary Property'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning when a perspective model, or an object it holds, has a dictionary property that the mapped
  JSON document cannot store. Replace it with a list of key/value objects or promote it to a jsonb column.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - perspectives
  - dictionary
  - ef-core
  - analyzer
codeReferences:
  - src/Whizbang.Data.EFCore.Postgres.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/PerspectiveModelDictionaryAnalyzer.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PerspectiveModelDictionaryAnalyzerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PerspectiveModelDictionaryAnalyzerCoverageTests.cs
  - tests/Whizbang.Generators.Tests/Analyzers/PerspectiveModelDictionaryAnalyzerBranchTests.cs
  - tests/Whizbang.Generators.Tests/Analyzers/SystemTypeWalkTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ810: Perspective Model Contains Dictionary Property

**Severity**: Warning
**Category**: Perspective Model Mapping

## Description

A perspective's model is stored as a JSON document that Entity Framework Core maps with
`ComplexProperty().ToJson()`. That mapping does not support dictionary types: the descriptor records that
EF Core 10 throws a `NullReferenceException` for them. This warning points at a dictionary property before
the model reaches the database.

The `PerspectiveModelDictionaryAnalyzer` reports it when a non-abstract class implements
`IPerspectiveFor<TModel, TEvent...>` (or `IPerspectiveWithActionsFor` / `IPerspectiveBase` with a model and at
least one event) and `TModel` has a property whose type is `Dictionary<TKey, TValue>`,
`IDictionary<TKey, TValue>` or `IReadOnlyDictionary<TKey, TValue>`. The walk also covers:

- properties of nested classes and structs the model holds (`Nested.Metadata`),
- generic arguments, so `List<Dictionary<string, string>>` and `List<Nested>` where `Nested` holds a
  dictionary are both found.

It deliberately does **not** report:

- a static, indexer or write-only property,
- a property marked `[NotMapped]`, System.Text.Json `[JsonIgnore]` or Newtonsoft `[JsonIgnore]`,
- a top-level `[PhysicalField]` whose column is `jsonb` (the default for a dictionary, or
  `ColumnType = "jsonb"`), because that value is stored in its own column and kept out of the mapped
  document. A physical field declared with another column type, such as `ColumnType = "hstore"`, is still
  reported.
- members of non-collection `System` types, and a `KeyValuePair<TKey, TValue>` (it is not a dictionary),
- a class that is not a perspective's model.

A perspective that implements several interfaces over the same model reports each property once.

## Diagnostic Message

```
Property '{PropertyName}' on perspective model '{DeclaringType}' uses Dictionary<{KeyType}, {ValueType}> which is not supported by EF Core's ComplexProperty().ToJson(). Use List<{SuggestedElementType}> with Key/Value properties instead.
```

`{DeclaringType}` is the type that declares the property, which is the nested type (not the model) when
the dictionary sits inside a nested object. `{SuggestedElementType}` is rendered as
`KeyValuePair<{KeyType}, {ValueType}>`. The text says `Dictionary` for `IDictionary` and
`IReadOnlyDictionary` properties too.

## Common Causes

1. **A free-form bag of attributes** modeled as `Dictionary<string, string>` on the read model.
2. **A dictionary inside a nested object** or inside a list element, which the analyzer reaches through the
   model.
3. **An interface-typed property** (`IDictionary<string, object>`, `IReadOnlyDictionary<string, int>`).

## How to Fix

{verified: PerspectiveModelDictionaryAnalyzerTests.PerspectiveModel_WithDictionary_ReportsDiagnosticAsync, PerspectiveModelDictionaryAnalyzerTests.PerspectiveModel_WithList_NoDiagnosticAsync, PerspectiveModelDictionaryAnalyzerTests.PerspectiveModel_DictionaryPromotedToAJsonbColumn_NoDiagnosticAsync}

Pick one:

- **Use a list of key/value objects.** Declare a small class with `Key` and `Value` properties and hold a
  `List<>` of it. This is the shape the analyzer accepts in its tests.
- **Promote the dictionary to a jsonb column** with `[PhysicalField]`. A dictionary's default column type
  is `jsonb`, and a jsonb physical field is kept out of the mapped document. See
  [jsonb columns](../../fundamentals/perspectives/physical-fields#jsonb-columns).
- **If the value is not meant to be stored**, mark it `[NotMapped]` or `[JsonIgnore]`.

### Before

```csharp{title="A dictionary on a perspective model" description="The Attributes dictionary is reported as WHIZ810." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "perspectives", "dictionary", "whiz810"] testFile="PerspectiveModelDictionaryAnalyzerTests.cs" testMethod="PerspectiveModel_WithDictionary_ReportsDiagnosticAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Data.EFCore.Postgres.Tests/PerspectiveModelDictionaryAnalyzerTests.cs" tests=["PerspectiveModelDictionaryAnalyzerTests.PerspectiveModel_WithDictionary_ReportsDiagnosticAsync"]}
public class TestModel {
  public Guid Id { get; set; }
  public Dictionary<string, string> Attributes { get; set; } = new();  // WHIZ810
}

public record TestEvent(Guid Id);

public class TestPerspective : IPerspectiveFor<TestModel, TestEvent> {
  public TestModel Apply(TestModel? model, TestEvent evt) => model ?? new();
}
```

### After

```csharp{title="A list of key/value objects" description="The same data held as a list of a Key/Value class is not reported." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "perspectives", "dictionary", "whiz810"] testFile="PerspectiveModelDictionaryAnalyzerTests.cs" testMethod="PerspectiveModel_WithList_NoDiagnosticAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Data.EFCore.Postgres.Tests/PerspectiveModelDictionaryAnalyzerTests.cs" tests=["PerspectiveModelDictionaryAnalyzerTests.PerspectiveModel_WithList_NoDiagnosticAsync"]}
public class ScopeExtension {
  public string Key { get; set; } = string.Empty;
  public string Value { get; set; } = string.Empty;
}

public class TestModel {
  public Guid Id { get; set; }
  public List<ScopeExtension> Extensions { get; set; } = new();
}
```

Or keep the dictionary and promote it to its own jsonb column:

```csharp{title="A dictionary promoted to a jsonb column" description="A [PhysicalField] dictionary defaults to a jsonb column and is not reported." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "perspectives", "physical-fields", "jsonb"] testFile="PerspectiveModelDictionaryAnalyzerTests.cs" testMethod="PerspectiveModel_DictionaryPromotedToAJsonbColumn_NoDiagnosticAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Data.EFCore.Postgres.Tests/PerspectiveModelDictionaryAnalyzerTests.cs" tests=["PerspectiveModelDictionaryAnalyzerTests.PerspectiveModel_DictionaryPromotedToAJsonbColumn_NoDiagnosticAsync"]}
public class TestModel {
  public Guid Id { get; set; }

  [PhysicalField]  // or [PhysicalField(ColumnType = "jsonb")]
  public Dictionary<string, string[]> Fields { get; set; } = new();
}
```

## Suppressing

The warning is reported on the property, so a pragma around it works:

```csharp{title="Suppress WHIZ810 for one property" description="A pragma around the reported property." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "suppression", "whiz810"] unverified="suppression syntax, not exercised by a test"}
#pragma warning disable WHIZ810
  public Dictionary<string, string> Attributes { get; set; } = new();
#pragma warning restore WHIZ810
```

Or in `.editorconfig`:

```ini{title="Suppress WHIZ810 in .editorconfig" description="Turns the warning off for the matched files."}
[*.cs]
dotnet_diagnostic.WHIZ810.severity = none
```

Suppress it only when the property is kept out of the mapping in a way the analyzer cannot see, such as a
Fluent API `Ignore()` in `OnModelCreating` (the analyzer reads attributes only). Otherwise the warning is
describing a model that will fail when Entity Framework maps it.

## Related

- [Physical Fields: jsonb columns](../../fundamentals/perspectives/physical-fields#jsonb-columns)
- [Perspectives](../../fundamentals/perspectives/perspectives)
- [WHIZ811: Perspective Model Contains Polymorphic Type](whiz811)
- [WHIZ812: Perspective Model Declares a JSON Converter That Is Never Consulted](whiz812)
