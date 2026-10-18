---
title: 'WHIZ052: Test Link Discovered'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Informational descriptor for a discovered link between code and a test. The descriptor is defined, but no
  Whizbang analyzer or generator reports it in this version.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - test-linking
  - discovery
  - info
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
testReferences: []
lastMaintainedCommit: '9a416b5b'
---

# WHIZ052: Test Link Discovered

**Severity**: Info
**Category**: Test Linking

## Description

WHIZ052 is an informational discovery notice. It describes a link found between a code symbol and a test, whether the
link came from a naming convention, from semantic analysis, or from a `<tests>` XML documentation tag.

In this version the descriptor is **declared but never reported**: no analyzer or source generator in the Whizbang
packages creates a WHIZ052 diagnostic. Nothing appears in build output for it.

## Diagnostic Message

```text{title="WHIZ052 message format" description="The descriptor's message format, with placeholders named" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ052", "Diagnostics", "Test Linking"] unverified="message format read from the descriptor; no code reports it"}
Found test link: {TypeName}.{MemberName} ← {TestReference} (via {LinkSource})
```

`{LinkSource}` is the way the link was found: convention, semantic analysis, or an XML tag, as the descriptor's
description lists them.

## Common Causes

1. **None in this version.** Nothing reports WHIZ052.

## How to Fix

Nothing to fix. WHIZ052 is informational, and it is not produced.

## Suppressing

Suppression has no effect today. If you want to silence it in advance, set its severity to `none`.

```csharp{title="Suppress WHIZ052 with a pragma" description="Standard pragma suppression for an informational ID" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ052", "Suppression", "Pragma"] unverified="suppression syntax; WHIZ052 is never reported, so there is nothing to suppress"}
#pragma warning disable WHIZ052
public class OrderService {
}
#pragma warning restore WHIZ052
```

```ini{title="Suppress WHIZ052 in .editorconfig" description="Project-wide severity override" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ052", "Suppression", "EditorConfig"] unverified="suppression/config; not exercised by a test"}
[*.cs]
dotnet_diagnostic.WHIZ052.severity = none
```

## Related

- [WHIZ050: Public API Missing Tests](whiz050)
- [WHIZ051: Invalid Test Reference](whiz051)
- [WHIZ054: Failed to Load Tests Map](whiz054)
