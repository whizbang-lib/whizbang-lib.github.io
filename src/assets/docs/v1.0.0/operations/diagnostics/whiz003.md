---
title: 'WHIZ003: Invalid Receptor Implementation'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Error diagnostic defined for a receptor implementation that cannot be registered. In this release no generator
  reports it; the ID is reserved.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - receptors
  - source-generator
  - reserved
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/ReceptorDiscoveryGenerator.cs
testReferences:
  - tests/Whizbang.Generators.Tests/DiagnosticDescriptorsTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ003: Invalid Receptor Implementation

**Severity**: Error
**Category**: Whizbang.SourceGeneration

## Description

WHIZ003 is defined to report a receptor implementation that has errors and cannot be registered. The descriptor
exists in the generator package, but **no generator or analyzer in this release reports it**. You should not see it
in a build. The only test that names it checks the descriptor's ID and severity, not a triggering source.

What the receptor generator does today with a class it cannot register is skip it silently:

- An **open generic** receptor class (for example `MyReceptor<T>`) is skipped, because its message type is unknown
  at compile time. It gets no [WHIZ001](whiz001) and no route.
- A class that does not implement one of `IReceptor<TMessage, TResponse>`, `IReceptor<TMessage>`,
  `ISyncReceptor<TMessage, TResponse>` or `ISyncReceptor<TMessage>` is not considered a receptor at all.

If none remain in the compilation (and there are no perspectives), [WHIZ002](whiz002) is reported instead.

## Diagnostic Message

```text
Invalid receptor '{ReceptorName}': {Reason}
```

## Common Causes

None in this release: no code path in the generators reports this ID.

## How to Fix

There is nothing to fix for WHIZ003 itself. If a receptor is not being called, look for its [WHIZ001](whiz001)
line in the build output. A missing line means the generator skipped the class for one of the reasons above: give it
closed type arguments and one of the four receptor interfaces.

Other receptor problems that **are** reported have their own codes, for example
[WHIZ080](whiz080) for a message type with more than one RPC handler.

## Related

- [WHIZ001: Receptor Discovered](whiz001)
- [WHIZ002: No Message Handlers Found](whiz002)
- [WHIZ080: Multiple Handlers for RPC Message](whiz080)
- [Receptors Guide](../../fundamentals/receptors/receptors)
