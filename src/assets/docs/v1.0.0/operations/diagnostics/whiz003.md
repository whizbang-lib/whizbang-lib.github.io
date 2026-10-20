---
title: 'WHIZ003: Invalid Receptor Implementation (retired)'
pageType: troubleshooting
verifiedAgainstCommit: 7e3d0a73
verifiedDate: 2026-10-19
description: >-
  Retired. WHIZ003 (Invalid Receptor Implementation) was declared but never reported. It is removed from the generator
  package and the ID is never reused.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - receptors
  - source-generator
  - retired
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
testReferences:
  - tests/Whizbang.Generators.Tests/DiagnosticDescriptorsTests.cs
lastMaintainedCommit: '7e3d0a73'
---

# WHIZ003: Invalid Receptor Implementation (retired)

**Status**: Retired. Never reported.
**Former severity**: Error

## Retired

WHIZ003 is **retired**. No generator or analyzer ever reported it, and its descriptor has been removed from the
generator package. The ID is **never reused**: it will not be given a new meaning, so a search or a suppression for
it can never match a different diagnostic. A test keeps every retired ID from being declared again
(`DiagnosticDescriptorsTests.RetiredDiagnosticIds_AreNeverDeclaredAgainAsync`).

## What It Described

WHIZ003 was declared as an error for "a receptor implementation that has errors and cannot be registered". No
generator ever reported it.

The message it would have shown:

```text
Invalid receptor '{ReceptorName}': {Reason}
```

## Why There Is No Rule

There is no single "invalid receptor" condition to report. The receptor generator considers a class a receptor
only when it implements one of `IReceptor<TMessage, TResponse>`, `IReceptor<TMessage>`,
`ISyncReceptor<TMessage, TResponse>` or `ISyncReceptor<TMessage>` with closed type arguments; an open generic class
such as `MyReceptor<T>` is skipped because its message type is unknown at compile time. Problems that do make a
receptor unusable have their own codes, for example [WHIZ014](whiz014) for a constructor dependency injection cannot
satisfy and [WHIZ080](whiz080) for a message type with more than one RPC handler.

If a receptor is not being called, look for its [WHIZ001](whiz001) line in the build output. A missing line means the
generator did not consider the class a receptor.

## If You Suppress It

A suppression of WHIZ003 has never had any effect. Delete it: remove any `#pragma warning disable WHIZ003` /
`#pragma warning restore WHIZ003` lines, any `dotnet_diagnostic.WHIZ003.severity` entry in `.editorconfig` or a
`.globalconfig`, and WHIZ003 from any `<NoWarn>` list.

## Related

- [WHIZ001: Receptor Discovered](whiz001)
- [WHIZ002: No Message Handlers Found](whiz002)
- [WHIZ014: Receptor May Not Be Constructible by Dependency Injection](whiz014)
- [WHIZ080: Multiple Handlers for RPC Message](whiz080)
- [Receptors Guide](../../fundamentals/receptors/receptors)
