---
title: 'WHIZ057: Raw Guid Parameter (retired)'
pageType: troubleshooting
verifiedAgainstCommit: 7e3d0a73
verifiedDate: 2026-10-19
description: >-
  Retired. WHIZ057 (Raw Guid Parameter) was declared but never reported. It is removed from the generator package and
  the ID is never reused.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - guid
  - whizbang-id
  - strongly-typed-id
  - analyzer
  - retired
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
testReferences:
  - tests/Whizbang.Generators.Tests/DiagnosticDescriptorsTests.cs
lastMaintainedCommit: '7e3d0a73'
---

# WHIZ057: Raw Guid Parameter (retired)

**Status**: Retired. Never reported.
**Former severity**: Warning

## Retired

WHIZ057 is **retired**. No generator or analyzer ever reported it, and its descriptor has been removed from the
generator package. The ID is **never reused**: it will not be given a new meaning, so a search or a suppression for
it can never match a different diagnostic. A test keeps every retired ID from being declared again
(`DiagnosticDescriptorsTests.RetiredDiagnosticIds_AreNeverDeclaredAgainAsync`).

## What It Described

WHIZ057 described a method parameter typed as a raw `Guid` where a strongly typed ID (an `IWhizbangId`, or a type
generated with `[WhizbangId]`) would fit. The `GuidUsageAnalyzer` listed it among its supported diagnostics but never
reported it, and it no longer lists it.

The message it would have shown:

```text
Consider using a strongly-typed ID instead of raw Guid for parameter '{Parameter}'. Raw Guid loses metadata about precision and ordering.
```

## Why There Is No Rule

A `Guid` parameter is often correct (an external API, a database key, a framework callback), and the analyzer has
no way to tell those apart from one that should be a strongly typed ID, so a rule would mostly warn on legitimate code.
The analyzer checks `Guid` creation instead: `Guid.NewGuid()` ([WHIZ055](whiz055)) and `Guid.CreateVersion7()`
([WHIZ056](whiz056)).

## If You Suppress It

A suppression of WHIZ057 has never had any effect. Delete it: remove any `#pragma warning disable WHIZ057` /
`#pragma warning restore WHIZ057` lines, any `dotnet_diagnostic.WHIZ057.severity` entry in `.editorconfig` or a
`.globalconfig`, and WHIZ057 from any `<NoWarn>` list.

## Related

- [WHIZ055: Guid.NewGuid() Usage](whiz055)
- [WHIZ056: Guid.CreateVersion7() Usage](whiz056)
- [WhizbangIds and TrackedGuid](../../fundamentals/identity/whizbang-ids)
