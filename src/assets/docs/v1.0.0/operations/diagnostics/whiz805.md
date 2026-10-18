---
title: 'WHIZ805: Split Mode No Physical Fields'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning diagnostic defined for a perspective model declared with Split storage but no [PhysicalField] or
  [VectorField] properties. In this release the descriptor exists but nothing reports it.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - physical-field
  - storage-mode
  - split
  - perspectives
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/PerspectiveSchemaGenerator.cs
  - src/Whizbang.Core/Perspectives/PerspectiveStorageAttribute.cs
testReferences: []
lastMaintainedCommit: '9a416b5b'
---

# WHIZ805: Split Mode No Physical Fields

**Severity**: Warning
**Category**: Physical Field Validation

## Description

`[PerspectiveStorage(FieldStorageMode.Split)]` on a perspective model moves each property marked `[PhysicalField]` or
`[VectorField]` into its own column and keeps only the remaining properties in the JSONB document. With no such
properties there is nothing to split out, which the descriptor describes as equivalent to the default `JsonOnly` mode. The
WHIZ805 descriptor flags that declaration as unnecessary.

:::updated
As shipped, the `WHIZ805` descriptor is defined in `DiagnosticDescriptors.cs` but nothing reports it, so you will not
see this warning in a build. The redundant declaration is not caught at build time today.
:::

## Diagnostic Message

```
Perspective '{Perspective}' uses Split mode but has no [PhysicalField] or [VectorField] attributes. This is equivalent to JsonOnly mode.
```

## Common Causes

1. **The physical fields were removed** (or never added) after the model was switched to Split mode.
2. **Split was chosen ahead of time**, before deciding which fields to promote.

## How to Fix

Either add the fields you meant to promote, or remove `[PerspectiveStorage]` so the model uses the default `JsonOnly`
mode.

### Before (the declaration WHIZ805 describes)

```csharp{
title: "Split storage with nothing to split"
description: "No property is promoted, so Split stores the model the same way as JsonOnly."
framework: "NET10"
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz805", "split", "storage-mode", "counter-example"]
unverified: "counter-example; WHIZ805 is defined but not reported, so no test emits it"
}
[PerspectiveStorage(FieldStorageMode.Split)]
public record ProductSearchDto {
  [StreamId]
  public Guid Id { get; init; }

  public string Name { get; init; } = string.Empty;
}
```

### After

```csharp{
title: "Split storage with a promoted field"
description: "The vector field lives in its own column; the rest stays in JSONB."
framework: "NET10"
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz805", "split", "storage-mode", "vector-field"]
unverified: "WHIZ805 is defined but not reported; Split mode is covered on the Physical Fields page"
}
[PerspectiveStorage(FieldStorageMode.Split)]
public record ProductSearchDto {
  [StreamId]
  public Guid Id { get; init; }

  [VectorField(1536)]
  public float[]? Embedding { get; init; }

  public string Name { get; init; } = string.Empty;
}
```

Or, if nothing needs promoting, drop the attribute:

```csharp{
title: "Default JsonOnly storage"
description: "Without [PerspectiveStorage] the model is stored as JsonOnly."
framework: "NET10"
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz805", "json-only", "storage-mode"]
unverified: "WHIZ805 is defined but not reported; the JsonOnly default is covered on the Physical Fields page"
}
public record ProductSearchDto {
  [StreamId]
  public Guid Id { get; init; }

  public string Name { get; init; } = string.Empty;
}
```

## Suppressing

There is nothing to suppress in this release. If a later release reports it and you keep Split mode on purpose (for
example, fields are about to be promoted), suppress it with `.editorconfig`:

```ini{
title: "Disable WHIZ805 in .editorconfig"
description: "Sets the WHIZ805 severity to none for the files the section matches."
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz805", "suppression", "editorconfig"]
unverified: "suppression/config, not exercised by a test"
}
[*.cs]
dotnet_diagnostic.WHIZ805.severity = none
```

or with `#pragma warning disable WHIZ805` around the model. Removing the attribute is usually the better choice, since
Split with no promoted fields gains nothing.

## Related

- [WHIZ803: PhysicalField complex type](whiz803)
- [WHIZ807: Physical fields discovered](whiz807)
- [WHIZ808: Split class model cannot be copied](whiz808)
- [Physical Fields: FieldStorageMode](../../fundamentals/perspectives/physical-fields#FieldStorageMode)
- [Vector Fields](../../fundamentals/perspectives/vector-fields)
