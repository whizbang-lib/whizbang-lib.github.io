---
title: 'WHIZ050: Public API Missing Tests (retired)'
pageType: troubleshooting
verifiedAgainstCommit: 7e3d0a73
verifiedDate: 2026-10-19
description: >-
  Retired. WHIZ050 (Public API Missing Tests) was declared but never reported. It is removed from the generator
  package and the ID is never reused.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - test-linking
  - code-tests-map
  - coverage
  - retired
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
testReferences:
  - tests/Whizbang.Generators.Tests/DiagnosticDescriptorsTests.cs
lastMaintainedCommit: '7e3d0a73'
---

# WHIZ050: Public API Missing Tests (retired)

**Status**: Retired. Never reported.
**Former severity**: Warning

## Retired

WHIZ050 is **retired**. No generator or analyzer ever reported it, and its descriptor has been removed from the
generator package. The ID is **never reused**: it will not be given a new meaning, so a search or a suppression for
it can never match a different diagnostic. A test keeps every retired ID from being declared again
(`DiagnosticDescriptorsTests.RetiredDiagnosticIds_AreNeverDeclaredAgainAsync`).

## What It Described

WHIZ050 was one of three test-linking descriptors (WHIZ050 to WHIZ052). It described a public API member with no
associated tests in the code-tests mapping. No analyzer or generator ever reported it.

The message it would have shown:

```text
Public {Kind} '{Name}' has no associated tests. Consider adding test coverage or marking with [ExcludeFromCodeCoverage].
```

## Why There Is No Rule

Linking code to tests is done by the documentation tooling that builds the code-tests map, outside the compiler.
A compiler diagnostic cannot see that map reliably, so no build-time rule exists for it.

## If You Suppress It

A suppression of WHIZ050 has never had any effect. Delete it: remove any `#pragma warning disable WHIZ050` /
`#pragma warning restore WHIZ050` lines, any `dotnet_diagnostic.WHIZ050.severity` entry in `.editorconfig` or a
`.globalconfig`, and WHIZ050 from any `<NoWarn>` list.

## Related

- [WHIZ051: Invalid Test Reference (retired)](whiz051)
- [WHIZ052: Test Link Discovered (retired)](whiz052)
- [WHIZ054: Failed to Load Tests Map](whiz054)
