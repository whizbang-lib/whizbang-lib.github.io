---
title: 'WHIZ051: Invalid Test Reference'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning descriptor for a <tests> XML documentation tag that points at a test that does not exist. The
  descriptor is defined, but no Whizbang analyzer or generator reports it in this version.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - test-linking
  - xml-documentation
  - tests-tag
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
testReferences: []
lastMaintainedCommit: '9a416b5b'
---

# WHIZ051: Invalid Test Reference

**Severity**: Warning
**Category**: Test Linking

## Description

WHIZ051 describes a `<tests>` XML documentation tag on a symbol that names a test file or test method that cannot be
found. A `<tests>` tag is an explicit link from library code to the test that covers it, for example
`<tests>tests/MyProject.Tests/OrderServiceTests.cs:Submit_ValidOrder_PublishesEventAsync</tests>`.

In this version the descriptor is **declared but never reported**: no analyzer or source generator in the Whizbang
packages creates a WHIZ051 diagnostic, so a broken `<tests>` tag produces no compiler warning today.

## Diagnostic Message

```text{title="WHIZ051 message format" description="The descriptor's message format, with placeholders named" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ051", "Diagnostics", "Test Linking"] unverified="message format read from the descriptor; no code reports it"}
<tests> tag on '{SymbolName}' references test '{TestReference}' which was not found. Verify test file path and method name.
```

In the descriptor source the angle brackets are written as `&lt;tests&gt;` inside a C# string literal, not inside an
XML comment, so a compiler that reported this descriptor would print the escaped text `&lt;tests&gt;` rather than
`<tests>`.

## Common Causes

1. **None in this version.** Nothing reports WHIZ051.
2. The situation the descriptor describes: a `<tests>` tag whose file path or method name was mistyped, or whose test
   was renamed, moved or deleted.

## How to Fix

No action is needed for the build, because the diagnostic is not produced. It is still good practice to keep
`<tests>` tags accurate: check that the path is relative to the repository root and that the method name matches the
test exactly.

There is no Before or After sample on this page: no code triggers WHIZ051.

## Suppressing

Suppression has no effect today. The standard mechanisms apply if you want to silence it in advance.

```csharp{title="Suppress WHIZ051 with a pragma" description="Standard pragma suppression for a warning ID" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ051", "Suppression", "Pragma"] unverified="suppression syntax; WHIZ051 is never reported, so there is nothing to suppress"}
#pragma warning disable WHIZ051
/// <tests>tests/Legacy.Tests/LegacyTests.cs:Removed_TestAsync</tests>
public class LegacyService {
}
#pragma warning restore WHIZ051
```

```ini{title="Suppress WHIZ051 in .editorconfig" description="Project-wide severity override" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ051", "Suppression", "EditorConfig"] unverified="suppression/config; not exercised by a test"}
[*.cs]
dotnet_diagnostic.WHIZ051.severity = none
```

## Related

- [WHIZ050: Public API Missing Tests](whiz050)
- [WHIZ052: Test Link Discovered](whiz052)
- [WHIZ054: Failed to Load Tests Map](whiz054)
