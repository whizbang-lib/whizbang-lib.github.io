---
title: 'WHIZ052: Test Link Discovered (retired)'
pageType: troubleshooting
verifiedAgainstCommit: 7e3d0a73
verifiedDate: 2026-10-19
description: >-
  Retired. WHIZ052 (Test Link Discovered) was declared but never reported. It is removed from the generator package
  and the ID is never reused.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - test-linking
  - discovery
  - info
  - retired
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
testReferences:
  - tests/Whizbang.Generators.Tests/DiagnosticDescriptorsTests.cs
lastMaintainedCommit: '7e3d0a73'
---

# WHIZ052: Test Link Discovered (retired)

**Status**: Retired. Never reported.
**Former severity**: Info

## Retired

WHIZ052 is **retired**. No generator or analyzer ever reported it, and its descriptor has been removed from the
generator package. The ID is **never reused**: it will not be given a new meaning, so a search or a suppression for
it can never match a different diagnostic. A test keeps every retired ID from being declared again
(`DiagnosticDescriptorsTests.RetiredDiagnosticIds_AreNeverDeclaredAgainAsync`).

## What It Described

WHIZ052 was one of three test-linking descriptors (WHIZ050 to WHIZ052). It was an informational notice for a link
found between a code symbol and a test. No analyzer or generator ever reported it.

The message it would have shown:

```text
Found test link: {Type}.{Member} <- {Test} (via {Source})
```

## Why There Is No Rule

Code-to-test links are discovered by the documentation tooling that builds the code-tests map, outside the
compiler, so there is no build-time event to report.

## If You Suppress It

A suppression of WHIZ052 has never had any effect. Delete it: remove any `#pragma warning disable WHIZ052` /
`#pragma warning restore WHIZ052` lines, any `dotnet_diagnostic.WHIZ052.severity` entry in `.editorconfig` or a
`.globalconfig`, and WHIZ052 from any `<NoWarn>` list.

## Related

- [WHIZ050: Public API Missing Tests (retired)](whiz050)
- [WHIZ051: Invalid Test Reference (retired)](whiz051)
- [WHIZ054: Failed to Load Tests Map](whiz054)
