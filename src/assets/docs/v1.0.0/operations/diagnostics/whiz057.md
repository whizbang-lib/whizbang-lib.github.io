---
title: 'WHIZ057: Raw Guid Parameter'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning descriptor for a raw Guid parameter where a strongly typed id would carry precision and ordering
  metadata. The GuidUsageAnalyzer declares it, but nothing reports it in this version.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - guid
  - whizbang-id
  - strongly-typed-id
  - analyzer
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/GuidUsageAnalyzer.cs
testReferences: []
lastMaintainedCommit: '9a416b5b'
---

# WHIZ057: Raw Guid Parameter

**Severity**: Warning
**Category**: Guid Usage

## Description

WHIZ057 describes a method parameter typed as a raw `Guid` where a strongly typed id (an `IWhizbangId`, or a type
generated with `[WhizbangId]`) would fit. A raw `Guid` loses the metadata that `TrackedGuid` and `[WhizbangId]` types
keep: which version it is, where it came from, and whether it is time-ordered.

The `GuidUsageAnalyzer` lists WHIZ057 among its supported diagnostics, but in this version **it never reports it**.
The analyzer only inspects `Guid.NewGuid()` and `Guid.CreateVersion7()` calls ([WHIZ055](whiz055) and
[WHIZ056](whiz056)); it does not look at parameters. You will not see WHIZ057 in a build.

## Diagnostic Message

```text{title="WHIZ057 message format" description="The descriptor's message format, with the placeholder named" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ057", "Guid", "Diagnostics"] unverified="message format read from the descriptor; no code reports it"}
Consider using a strongly-typed ID instead of raw Guid for parameter '{ParameterName}'. Raw Guid loses metadata about precision and ordering.
```

## Common Causes

1. **None in this version.** Nothing reports WHIZ057, so no code you write can cause it.

## How to Fix

No action is needed for the build. The descriptor's advice still applies as a design choice: prefer a strongly typed
id for parameters that carry an entity's identity. See
[WhizbangIds](../../fundamentals/identity/whizbang-ids) for defining one with `[WhizbangId]`.

There is no Before or After sample on this page: no code triggers WHIZ057, and a sample would claim behavior the
analyzer does not have.

## Suppressing

Suppression has no effect today, because nothing reports the ID. The standard mechanisms apply if you want to
silence it in advance.

```csharp{title="Suppress WHIZ057 with a pragma" description="Standard pragma suppression for a warning ID" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ057", "Suppression", "Pragma"] unverified="suppression syntax; WHIZ057 is never reported, so there is nothing to suppress"}
#pragma warning disable WHIZ057
public void Load(Guid externalId) {
}
#pragma warning restore WHIZ057
```

```ini{title="Suppress WHIZ057 in .editorconfig" description="Project-wide severity override" category="Diagnostics" difficulty="BEGINNER" tags=["WHIZ057", "Suppression", "EditorConfig"] unverified="suppression/config; not exercised by a test"}
[*.cs]
dotnet_diagnostic.WHIZ057.severity = none
```

## Related

- [WHIZ055: Guid.NewGuid() Usage](whiz055)
- [WHIZ056: Guid.CreateVersion7() Usage](whiz056)
- [WhizbangIds and TrackedGuid](../../fundamentals/identity/whizbang-ids)
