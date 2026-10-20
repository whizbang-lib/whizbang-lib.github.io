---
title: 'WHIZ020: WhizbangId Discovered (retired)'
pageType: troubleshooting
verifiedAgainstCommit: 7e3d0a73
verifiedDate: 2026-10-19
description: >-
  Retired. WHIZ020 (WhizbangId Discovered) was declared but never reported. It is removed from the generator package
  and the ID is never reused.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - whizbang-id
  - strongly-typed-ids
  - source-generator
  - discovery
  - retired
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
testReferences:
  - tests/Whizbang.Generators.Tests/DiagnosticDescriptorsTests.cs
lastMaintainedCommit: '7e3d0a73'
---

# WHIZ020: WhizbangId Discovered (retired)

**Status**: Retired. Never reported.
**Former severity**: Info

## Retired

WHIZ020 is **retired**. No generator or analyzer ever reported it, and its descriptor has been removed from the
generator package. The ID is **never reused**: it will not be given a new meaning, so a search or a suppression for
it can never match a different diagnostic. A test keeps every retired ID from being declared again
(`DiagnosticDescriptorsTests.RetiredDiagnosticIds_AreNeverDeclaredAgainAsync`).

## What It Described

WHIZ020 was declared as an informational notice meaning "a `[WhizbangId]` strongly typed ID was found and its value
object will be generated". The `WhizbangIdGenerator` never reported it.

The message it would have shown:

```text
Found [WhizbangId] on {TypeName} in namespace {Namespace}
```

## Why There Is No Rule

A notice adds nothing the build does not already show: the generated source for each ID (for example
`ProductId.g.cs`) is the evidence that it was generated. The problems worth reporting already have their own codes,
[WHIZ021](whiz021) for a struct that is not `partial` and [WHIZ024](whiz024) for the same ID name in two namespaces.

## If You Suppress It

A suppression of WHIZ020 has never had any effect. Delete it: remove any `#pragma warning disable WHIZ020` /
`#pragma warning restore WHIZ020` lines, any `dotnet_diagnostic.WHIZ020.severity` entry in `.editorconfig` or a
`.globalconfig`, and WHIZ020 from any `<NoWarn>` list.

## Related

- [WhizbangIds: Strongly-Typed Identity Values](../../fundamentals/identity/whizbang-ids)
- [WHIZ021: WhizbangId Must Be Partial](whiz021)
- [WHIZ024: Duplicate WhizbangId Type Name](whiz024)
