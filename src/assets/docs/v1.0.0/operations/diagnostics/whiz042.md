---
title: 'WHIZ042: No User Services Found (retired)'
pageType: troubleshooting
verifiedAgainstCommit: 7e3d0a73
verifiedDate: 2026-10-19
description: >-
  Retired. WHIZ042 (No User Services Found) was declared but never reported. It is removed from the generator package
  and the ID is never reused.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - service-registration
  - dependency-injection
  - source-generator
  - retired
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
testReferences:
  - tests/Whizbang.Generators.Tests/DiagnosticDescriptorsTests.cs
lastMaintainedCommit: '7e3d0a73'
---

# WHIZ042: No User Services Found (retired)

**Status**: Retired. Never reported.
**Former severity**: Info

## Retired

WHIZ042 is **retired**. No generator or analyzer ever reported it, and its descriptor has been removed from the
generator package. The ID is **never reused**: it will not be given a new meaning, so a search or a suppression for
it can never match a different diagnostic. A test keeps every retired ID from being declared again
(`DiagnosticDescriptorsTests.RetiredDiagnosticIds_AreNeverDeclaredAgainAsync`).

## What It Described

WHIZ042 was declared as an informational notice for a project in which the service registration generator finds
no lens or perspective class to register. The generator never reported it.

The message it would have shown:

```text
No user-defined lens or perspective services were found for service registration
```

## Why There Is No Rule

A project with no lenses or perspectives of its own is a valid state, not a problem. The generator still writes
`ServiceRegistrations.g.cs`, with `AddLensServices()` and `AddPerspectiveServices()` generated empty, so calling them
is safe.

If a class you expected is not registered, look for its [WHIZ040](whiz040) line in the build output (each registered
class produces one) and check whether it was skipped as abstract ([WHIZ041](whiz041)).

## If You Suppress It

A suppression of WHIZ042 has never had any effect. Delete it: remove any `#pragma warning disable WHIZ042` /
`#pragma warning restore WHIZ042` lines, any `dotnet_diagnostic.WHIZ042.severity` entry in `.editorconfig` or a
`.globalconfig`, and WHIZ042 from any `<NoWarn>` list.

## Related

- [WHIZ040: User Service Discovered](whiz040)
- [WHIZ041: Abstract Class Skipped](whiz041)
- [Service Registration](../configuration/service-registration)
- [Lens Services](../configuration/lens-services)
- [Perspective Services](../configuration/perspective-services)
