---
title: 'WHIZ803: PhysicalField Complex Type (retired)'
pageType: troubleshooting
verifiedAgainstCommit: 7e3d0a73
verifiedDate: 2026-10-19
description: >-
  Retired. WHIZ803 (PhysicalField Complex Type) was declared but never reported, and its advice is out of date. It is
  removed from the generator package and the ID is never reused.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - physical-field
  - jsonb
  - perspectives
  - source-generator
  - retired
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
testReferences:
  - tests/Whizbang.Generators.Tests/DiagnosticDescriptorsTests.cs
lastMaintainedCommit: '7e3d0a73'
---

# WHIZ803: PhysicalField Complex Type (retired)

**Status**: Retired. Never reported.
**Former severity**: Warning

## Retired

WHIZ803 is **retired**. No generator or analyzer ever reported it, and its descriptor has been removed from the
generator package. The ID is **never reused**: it will not be given a new meaning, so a search or a suppression for
it can never match a different diagnostic. A test keeps every retired ID from being declared again
(`DiagnosticDescriptorsTests.RetiredDiagnosticIds_AreNeverDeclaredAgainAsync`).

## What It Described

WHIZ803 was declared to warn that a `[PhysicalField]` on a complex type "may not benefit from indexing" and to
suggest simple types (string, int, decimal, bool, Guid). Nothing ever reported it.

The message it would have shown:

```text
[PhysicalField] on {ModelType}.{PropertyName} with type {Type} may not benefit from indexing. Consider using simple types.
```

## Why There Is No Rule

The advice no longer holds. A promoted property that holds an object, a record, a list, an array or a dictionary
becomes a `jsonb` column, which can carry a containment (GIN) index of its own, so a complex `[PhysicalField]` is a
supported choice. See
[Objects, lists and dictionaries: jsonb columns](../../fundamentals/perspectives/physical-fields#jsonb-columns). An
index the model's storage cannot reach is reported by [WHIZ304](whiz304).

## If You Suppress It

A suppression of WHIZ803 has never had any effect. Delete it: remove any `#pragma warning disable WHIZ803` /
`#pragma warning restore WHIZ803` lines, any `dotnet_diagnostic.WHIZ803.severity` entry in `.editorconfig` or a
`.globalconfig`, and WHIZ803 from any `<NoWarn>` list.

## Related

- [WHIZ805: Split mode with no physical fields](whiz805)
- [WHIZ807: Physical fields discovered](whiz807)
- [WHIZ304: Declared index cannot be reached for this model's storage](whiz304)
- [Physical Fields](../../fundamentals/perspectives/physical-fields)
- [JSONB Containment Queries](../../fundamentals/perspectives/jsonb-containment)
