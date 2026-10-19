---
title: 'WHIZ805: Split Mode No Physical Fields'
pageType: troubleshooting
verifiedAgainstCommit: 7e3d0a73
verifiedDate: 2026-10-19
description: >-
  Warning reported on [PerspectiveStorage(FieldStorageMode.Split)] when the model has no [PhysicalField] or
  [VectorField] property, its own or inherited, so it is stored exactly as JsonOnly.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - physical-field
  - storage-mode
  - split
  - perspectives
  - analyzer
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/Analyzers/PerspectiveFieldAnalyzer.cs
  - src/Whizbang.Generators/PerspectiveSchemaGenerator.cs
  - src/Whizbang.Core/Perspectives/PerspectiveStorageAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/PerspectiveFieldAnalyzerTests.cs
lastMaintainedCommit: '7e3d0a73'
---

# WHIZ805: Split Mode No Physical Fields

**Severity**: Warning
**Category**: Physical Field Validation

## Description

`[PerspectiveStorage(FieldStorageMode.Split)]` on a perspective model moves each property marked `[PhysicalField]` or
`[VectorField]` into its own column and keeps only the remaining properties in the JSONB document. With no such
property there is nothing to split out, and the model is stored exactly as the default `JsonOnly` mode stores it.

An analyzer checks every type that carries `[PerspectiveStorage(FieldStorageMode.Split)]` and reports WHIZ805 at that
attribute when neither the type nor any of its base types declares a `[PhysicalField]` or `[VectorField]` property.
A field inherited from a base record counts, so a model that gets its physical field from a base type is not reported.
`JsonOnly` and `Extracted` models are never reported.

## Diagnostic Message

```text
Model '{ModelName}' is stored Split but has no [PhysicalField] or [VectorField] property, so it is stored exactly as JsonOnly. Mark the fields that need columns, or use JsonOnly.
```

## Common Causes

1. **The physical fields were removed** (or never added) after the model was switched to Split mode.
2. **Split was chosen ahead of time**, before deciding which fields to promote.

## How to Fix

Either mark the fields that need their own columns, or remove `[PerspectiveStorage]` (or set it to `JsonOnly`) so
the model uses JSONB-only storage.

### Before (reports WHIZ805)

```csharp{title="Split storage with nothing to split" description="No property is promoted, so WHIZ805 is reported on the attribute." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["whiz805", "split", "storage-mode", "counter-example"] tests=["PerspectiveFieldAnalyzerTests.ASplitModelWithNoPhysicalField_ReportsWhiz805Async"]}
using Whizbang.Core.Perspectives;

[PerspectiveStorage(FieldStorageMode.Split)]   // WHIZ805: nothing to split
public record ProductSearchModel {
  public string Name { get; init; } = "";
}
```

### After: promote a field

```csharp{title="Split storage with a promoted field" description="A [PhysicalField] (or [VectorField]) property gives Split something to store in its own column; nothing is reported." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["whiz805", "split", "storage-mode", "physical-field"] tests=["PerspectiveFieldAnalyzerTests.ASplitModelWithAPhysicalOrVectorField_IsNotReportedAsync"]}
using Whizbang.Core.Perspectives;

[PerspectiveStorage(FieldStorageMode.Split)]
public record ProductSearchModel {
  [PhysicalField] public string Name { get; init; } = "";
}
```

### After: use JsonOnly

```csharp{title="JsonOnly storage" description="A model with nothing to promote, stored as JsonOnly; nothing is reported." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["whiz805", "json-only", "storage-mode"] tests=["PerspectiveFieldAnalyzerTests.AJsonOnlyModelWithNoPhysicalField_IsNotReportedAsync"]}
using Whizbang.Core.Perspectives;

[PerspectiveStorage(FieldStorageMode.JsonOnly)]   // or remove the attribute: JsonOnly is the default
public record ProductSearchModel {
  public string Name { get; init; } = "";
}
```

## Suppressing

If you keep Split mode on purpose (for example, fields are about to be promoted), suppress it with `.editorconfig`:

```ini{title="Disable WHIZ805 in .editorconfig" description="Sets the WHIZ805 severity to none for the files the section matches." category="Diagnostics" difficulty="BEGINNER" tags=["whiz805", "suppression", "editorconfig"] unverified="suppression/config, not exercised by a test"}
[*.cs]
dotnet_diagnostic.WHIZ805.severity = none
```

or with `#pragma warning disable WHIZ805` around the model. Removing the attribute is usually the better choice, since
Split with no promoted fields gains nothing.

## Related

- [WHIZ807: Physical fields discovered](whiz807)
- [WHIZ808: Split class model cannot be copied](whiz808)
- [Physical Fields: FieldStorageMode](../../fundamentals/perspectives/physical-fields#FieldStorageMode)
- [Vector Fields](../../fundamentals/perspectives/vector-fields)
