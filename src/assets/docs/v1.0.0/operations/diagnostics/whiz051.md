---
title: 'WHIZ051: Invalid Test Reference (retired)'
pageType: troubleshooting
verifiedAgainstCommit: 7e3d0a73
verifiedDate: 2026-10-19
description: >-
  Retired. WHIZ051 (Invalid Test Reference) was declared but never reported. It is removed from the generator package
  and the ID is never reused.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - test-linking
  - xml-documentation
  - tests-tag
  - retired
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
testReferences:
  - tests/Whizbang.Generators.Tests/DiagnosticDescriptorsTests.cs
lastMaintainedCommit: '7e3d0a73'
---

# WHIZ051: Invalid Test Reference (retired)

**Status**: Retired. Never reported.
**Former severity**: Warning

## Retired

WHIZ051 is **retired**. No generator or analyzer ever reported it, and its descriptor has been removed from the
generator package. The ID is **never reused**: it will not be given a new meaning, so a search or a suppression for
it can never match a different diagnostic. A test keeps every retired ID from being declared again
(`DiagnosticDescriptorsTests.RetiredDiagnosticIds_AreNeverDeclaredAgainAsync`).

## What It Described

WHIZ051 was one of three test-linking descriptors (WHIZ050 to WHIZ052). It described a `<tests>` XML documentation
tag that names a test file or test method that cannot be found. No analyzer or generator ever reported it.

The message it would have shown:

```text
<tests> tag on '{Symbol}' references test '{Test}' which was not found. Verify test file path and method name.
```

## Why There Is No Rule

Test files are not part of the library compilation, so the compiler cannot check that a `<tests>` tag points at
a real test. `<tests>` tags are checked by the documentation tooling that builds the code-tests map, outside the
build.

## If You Suppress It

A suppression of WHIZ051 has never had any effect. Delete it: remove any `#pragma warning disable WHIZ051` /
`#pragma warning restore WHIZ051` lines, any `dotnet_diagnostic.WHIZ051.severity` entry in `.editorconfig` or a
`.globalconfig`, and WHIZ051 from any `<NoWarn>` list.

## Related

- [WHIZ050: Public API Missing Tests (retired)](whiz050)
- [WHIZ052: Test Link Discovered (retired)](whiz052)
- [WHIZ054: Failed to Load Tests Map](whiz054)
