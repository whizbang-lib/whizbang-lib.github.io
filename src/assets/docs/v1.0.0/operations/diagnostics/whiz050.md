---
title: 'WHIZ050: Public API Missing Tests'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning descriptor for a public API member with no associated tests in the code-tests mapping. The descriptor
  is defined, but no Whizbang analyzer or generator reports it in this version.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - test-linking
  - code-tests-map
  - coverage
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
testReferences: []
lastMaintainedCommit: '9a416b5b'
---

# WHIZ050: Public API Missing Tests

**Severity**: Warning
**Category**: Test Linking

## Description

WHIZ050 is one of the test-linking descriptors (WHIZ050 to WHIZ052). It describes a public API member that has no
associated tests in the code-tests mapping, the map that links library symbols to the tests that exercise them.

In this version the descriptor is **declared but never reported**: no analyzer or source generator in the Whizbang
packages creates a WHIZ050 diagnostic. You will not see it in a build. The page exists so that the ID is documented
and so that a suppression you add for it is understood.

## Diagnostic Message

```text{title="WHIZ050 message format" description="The descriptor's message format, with placeholders named" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ050", "Diagnostics", "Test Linking"] unverified="message format read from the descriptor; no code reports it"}
Public {MemberKind} '{MemberName}' has no associated tests. Consider adding test coverage or marking with [ExcludeFromCodeCoverage].
```

## Common Causes

1. **None in this version.** Nothing reports WHIZ050, so no code you write can cause it.
2. The situation the descriptor describes is a public member with no entry in the code-tests mapping.

## How to Fix

No action is needed, because the diagnostic is not produced. The descriptor's own advice, should a future version
report it, is to add tests for the member or to mark it with `[ExcludeFromCodeCoverage]`.

There is no Before or After sample on this page: no code triggers WHIZ050, and a sample would claim behavior the
library does not have.

## Suppressing

Suppression has no effect today, because nothing reports the ID. If you want to pre-emptively silence it, the
standard mechanisms apply.

```csharp{title="Suppress WHIZ050 with a pragma" description="Standard pragma suppression for a warning ID" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ050", "Suppression", "Pragma"] unverified="suppression syntax; WHIZ050 is never reported, so there is nothing to suppress"}
#pragma warning disable WHIZ050
public class UntestedHelper {
}
#pragma warning restore WHIZ050
```

```ini{title="Suppress WHIZ050 in .editorconfig" description="Project-wide severity override" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ050", "Suppression", "EditorConfig"] unverified="suppression/config; not exercised by a test"}
[*.cs]
dotnet_diagnostic.WHIZ050.severity = none
```

## Related

- [WHIZ051: Invalid Test Reference](whiz051)
- [WHIZ052: Test Link Discovered](whiz052)
- [WHIZ054: Failed to Load Tests Map](whiz054)
