---
title: 'WHIZ812: Perspective Model Declares a JSON Converter That Is Never Consulted'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning when a perspective model property declares [JsonConverter]. The stored document is read by Entity
  Framework's JSON materializer, which never consults it; declare a changed stored shape with [StoredForm].
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - perspectives
  - json-converter
  - stored-forms
  - source-generator
codeReferences:
  - src/Whizbang.Data.EFCore.Postgres.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCoreServiceRegistrationGenerator.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/DeclaredConverterInfo.cs
testReferences:
  - tests/Whizbang.Generators.Tests/DeclaredJsonConverterIgnoredTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ812: Perspective Model Declares a JSON Converter That Is Never Consulted

**Severity**: Warning
**Category**: Perspective Model Mapping

## Description

A perspective's document is stored with `ComplexProperty().ToJson()` and read back by Entity Framework's own
JSON materializer, which never consults `System.Text.Json.Serialization.JsonConverterAttribute`. A
`[JsonConverter]` on a model property therefore compiles, runs and does nothing. If you added it to keep rows
written in an older shape readable, those rows stay unreadable, and nothing else tells you so.

A changed stored shape is what [`[StoredForm]`](../../fundamentals/perspectives/stored-form-migrations) is
for: it rewrites the stored documents in place at startup, journaled, which also repairs the form for
anything reading the column directly. For a conversion it does not cover, write an `IStoredFormMigration`.

The EF Core service registration generator reports this once per declared converter. It looks at every
instance property of each perspective model it discovers, and at the properties of nested objects the model
holds directly (non-generic, non-special types, up to 8 levels), because those values live in the same
document. A model with no `[JsonConverter]` is not reported.

## Diagnostic Message

```
Property '{PropertyName}' on perspective model '{DeclaringType}' declares [JsonConverter(typeof({ConverterType}))], which a stored document never consults: the document is read by Entity Framework's JSON materializer, not by the serializer. If the stored shape changed, declare [StoredForm(Previously = typeof(...))] instead, which rewrites the stored documents in place.
```

`{DeclaringType}` and `{ConverterType}` are fully qualified (with a `global::` prefix). `{DeclaringType}` is
the type that declares the property, which is a nested type when the converter sits on a nested object.

## Common Causes

1. **A converter added to read rows stored in an older shape**, for example a value that used to be stored
   as a number and is now a `string`.
2. **A converter copied from a DTO or API contract** onto the read model.
3. **A converter on a nested object** that the model holds.

## How to Fix

{verified: DeclaredJsonConverterIgnoredTests.ADeclaredConverterIsReportedAsync, DeclaredJsonConverterIgnoredTests.AModelWithNoConverterIsNotReportedAsync, DeclaredJsonConverterIgnoredTests.ItIsAWarningNotAnErrorAsync}

- **If the stored shape changed**, remove the converter and declare the change with
  `[StoredForm(Previously = typeof(...))]`. See
  [A JSON converter is not a migration](../../fundamentals/perspectives/stored-form-migrations#json-converter).
- **If the change is one `[StoredForm]` cannot express**, write a
  [custom migration](../../fundamentals/perspectives/stored-form-migrations#custom).
- **If the converter was never needed**, remove it.

### Before

```csharp{title="A converter on a perspective model" description="The [JsonConverter] on Version is reported as WHIZ812: the stored document never consults it." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "json-converter", "stored-forms", "whiz812"] testFile="DeclaredJsonConverterIgnoredTests.cs" testMethod="ADeclaredConverterIsReportedAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/DeclaredJsonConverterIgnoredTests.cs" tests=["DeclaredJsonConverterIgnoredTests.ADeclaredConverterIsReportedAsync"]}
public sealed class LegacyVersionConverter : JsonConverter<string?> {
  public override string? Read(ref Utf8JsonReader reader, Type t, JsonSerializerOptions o) => null;
  public override void Write(Utf8JsonWriter writer, string? value, JsonSerializerOptions o) { }
}

public record ExportModel {
  public string Id { get; init; } = "";

  [JsonConverter(typeof(LegacyVersionConverter))]  // WHIZ812
  public string? Version { get; init; }
}

public class ExportPerspective : IPerspectiveFor<ExportModel, ExportEvent> {
  public ExportModel Apply(ExportModel currentData, ExportEvent eventData) => currentData;
}
```

### After

```csharp{title="No converter on the model" description="A model that declares no converter is not reported. Declare a changed stored shape with [StoredForm] instead." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "json-converter", "stored-forms", "whiz812"] testFile="DeclaredJsonConverterIgnoredTests.cs" testMethod="AModelWithNoConverterIsNotReportedAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/DeclaredJsonConverterIgnoredTests.cs" tests=["DeclaredJsonConverterIgnoredTests.AModelWithNoConverterIsNotReportedAsync"]}
public record ExportModel {
  public string Id { get; init; } = "";

  // If stored rows still hold a number here, declare it:
  // [StoredForm(Previously = typeof(int))]
  public string? Version { get; init; }
}
```

## Suppressing

The warning is reported at the model property that declares `[JsonConverter]`, so a `#pragma` region around
that property silences it for that converter only:

```csharp{title="Suppress WHIZ812 for one property" description="A pragma region around the property that declares the converter." category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "json-converter", "suppression", "whiz812"] unverified="suppression/config, not exercised by a test"}
public record ExportModel {
  public string Id { get; init; } = "";

#pragma warning disable WHIZ812
  [JsonConverter(typeof(LegacyVersionConverter))]
  public string? Version { get; init; }
#pragma warning restore WHIZ812
}
```

A `[*.cs]` section in `.editorconfig` with `dotnet_diagnostic.WHIZ812.severity = none` also applies. To turn it off
for the whole project, set the severity in a global analyzer config, or add the ID to `<NoWarn>` in the project:

```ini{title="Suppress WHIZ812 project-wide" description="A global analyzer config turns the warning off for the whole project."}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ812.severity = none
```

Suppressing is rarely right. The warning exists because a converter that silently does nothing looks like a
fix in review. Remove the converter instead, and only suppress if you keep it on purpose for some other
reader of the type and know the stored document ignores it.

## Related

- [Stored-Form Migrations](../../fundamentals/perspectives/stored-form-migrations)
- [A JSON converter is not a migration](../../fundamentals/perspectives/stored-form-migrations#json-converter)
- [WHIZ830: Stored-Form Migration Cannot Be Generated](whiz830)
- [WHIZ810: Perspective Model Contains Dictionary Property](whiz810)
