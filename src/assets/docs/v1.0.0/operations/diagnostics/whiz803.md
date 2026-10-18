---
title: 'WHIZ803: PhysicalField Complex Type'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning diagnostic defined for a [PhysicalField] on a complex type. In this release the descriptor exists but
  nothing reports it, and its advice predates complex promoted fields becoming jsonb columns.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - physical-field
  - jsonb
  - perspectives
  - source-generator
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/PerspectiveSchemaGenerator.cs
testReferences: []
lastMaintainedCommit: '9a416b5b'
---

# WHIZ803: PhysicalField Complex Type

**Severity**: Warning
**Category**: Physical Field Validation

## Description

The WHIZ803 descriptor warns that a `[PhysicalField]` on a complex type "may not benefit from indexing" and suggests
simple types (string, int, decimal, bool, Guid).

:::updated
As shipped, the `WHIZ803` descriptor is defined in `DiagnosticDescriptors.cs` but nothing reports it, so you will not
see this warning in a build. Its advice is also out of date: a promoted property that holds an object, a record, a
list, an array or a dictionary now becomes a `jsonb` column, which can carry a containment (GIN) index of its own. See
[Objects, lists and dictionaries: jsonb columns](../../fundamentals/perspectives/physical-fields#jsonb-columns).
:::

## Diagnostic Message

```
[PhysicalField] on {ModelType}.{PropertyName} with type {PropertyType} may not benefit from indexing. Consider using simple types.
```

## Common Causes

1. **Promoting an object or collection** to a physical column, for example a list of labels or a dictionary of filter
   values.

## How to Fix

Nothing needs fixing, because nothing reports this warning. When you promote a complex property, decide how it will
be queried:

- **Filtered by containment**: keep it as a `jsonb` column and declare a containment index, as the physical fields
  guide shows.
- **Filtered or sorted by one scalar inside it**: promote that scalar as its own property instead.

### A complex promoted field

```csharp{
title: "A promoted list stored as a jsonb column"
description: "The shape the WHIZ803 descriptor describes; today it becomes a jsonb column with a containment index."
framework: "NET10"
category: "Diagnostics"
difficulty: "INTERMEDIATE"
tags: ["whiz803", "physical-field", "jsonb", "containment"]
unverified: "WHIZ803 is defined but not reported; jsonb column behavior is verified on the Physical Fields page"
}
public sealed record Label(string Key, string Value);

[PerspectiveStorage(FieldStorageMode.Extracted)]
public class OrderGridModel {
  [StreamId]
  public Guid Id { get; set; }

  [PhysicalField] [Indexed(IndexKinds.Containment)]
  public List<Label> Labels { get; set; } = [];
}
```

## Suppressing

There is nothing to suppress in this release. If a later release reports it and you have chosen a complex promoted
field on purpose, suppress it for that property:

```csharp{
title: "Suppress WHIZ803 for one property"
description: "Pragma suppression around a deliberately complex promoted field."
framework: "NET10"
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz803", "suppression", "pragma"]
unverified: "suppression syntax, not exercised by a test"
}
#pragma warning disable WHIZ803
[PhysicalField] [Indexed(IndexKinds.Containment)]
public List<Label> Labels { get; set; } = [];
#pragma warning restore WHIZ803
```

Or project-wide in `.editorconfig`:

```ini{
title: "Disable WHIZ803 in .editorconfig"
description: "Sets the WHIZ803 severity to none for the files the section matches."
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz803", "suppression", "editorconfig"]
unverified: "suppression/config, not exercised by a test"
}
[*.cs]
dotnet_diagnostic.WHIZ803.severity = none
```

## Related

- [WHIZ805: Split mode with no physical fields](whiz805)
- [WHIZ807: Physical fields discovered](whiz807)
- [WHIZ304: Declared index cannot be reached for this model's storage](whiz304)
- [Physical Fields](../../fundamentals/perspectives/physical-fields)
- [JSONB Containment Queries](../../fundamentals/perspectives/jsonb-containment)
