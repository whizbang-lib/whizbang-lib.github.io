---
title: 'WHIZ001: Receptor Discovered'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Informational notice that the source generator found a receptor and will register and route it. It
  needs no action; it confirms what the generated dispatcher will contain.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - receptors
  - dispatcher
  - source-generator
  - discovery
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/ReceptorDiscoveryGenerator.cs
testReferences:
  - tests/Whizbang.Generators.Tests/ReceptorDiscoveryGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/DiagnosticDescriptorsTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ001: Receptor Discovered

**Severity**: Info
**Category**: Whizbang.SourceGeneration

## Description

WHIZ001 is a discovery notice, not a problem. The `ReceptorDiscoveryGenerator` reports it once for every receptor it
will register with dependency injection and route through the generated dispatcher. Reading these notices in the build
output is the quickest way to confirm that a receptor you just wrote was picked up.

A class counts as a receptor when it implements one of `IReceptor<TMessage, TResponse>`, `IReceptor<TMessage>`,
`ISyncReceptor<TMessage, TResponse>` or `ISyncReceptor<TMessage>`. The generator deliberately skips open generic classes
(for example `MyReceptor<T>`), because a type parameter cannot be routed at compile time; those produce no WHIZ001.
The recovery receptors a `[Saga]` class gains are also reported, since they are registered the same way.

The names in the message are simple (unqualified) type names. A receptor with no response type (`IReceptor<TMessage>`
or `ISyncReceptor<TMessage>`) is reported with `void` as its response.

## Diagnostic Message

```text
Found receptor '{ReceptorName}' handling {MessageType} → {ResponseType}
```

## Common Causes

1. **A receptor was added or already exists** in a project that references the Whizbang generators. Every build lists
   each discovered receptor.

## How to Fix

Nothing to fix. If you expected a receptor and do **not** see its WHIZ001 line:

- Check that it implements one of the four receptor interfaces above with closed type arguments.
- Check that it is not an open generic class.
- If the build reports [WHIZ002](whiz002) instead, the generator found no receptors and no perspectives at all.

## Example

```csharp{title="A receptor that produces WHIZ001" description="Each closed receptor implementation is reported as discovered." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "WHIZ001", "Receptors", "Discovery"] tests=["ReceptorDiscoveryGeneratorTests.Generator_ReportsDiscoveredReceptorsAsync"] testFile="ReceptorDiscoveryGeneratorTests.cs" testMethod="Generator_ReportsDiscoveredReceptorsAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/ReceptorDiscoveryGeneratorTests.cs"}
using System.Threading;
using System.Threading.Tasks;
using Whizbang.Core;

namespace MyApp.Receptors;

public record TestCommand : ICommand;
public record TestResponse : IEvent;

// Reported as: Found receptor 'TestReceptor' handling TestCommand → TestResponse
public class TestReceptor : IReceptor<TestCommand, TestResponse> {
  public ValueTask<TestResponse> HandleAsync(TestCommand message, CancellationToken ct = default)
    => ValueTask.FromResult(new TestResponse());
}
```

## Suppressing

WHIZ001 is informational and is reported without a source location, so a `#pragma warning disable WHIZ001` region
cannot reach it. To hide it, set its severity in a global analyzer config file:

```ini{title="Silence WHIZ001 project-wide" description="Global analyzer config entry that hides the receptor discovery notice." category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "WHIZ001", "Suppression", "globalconfig"] unverified="suppression/config, not exercised by a test"}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ001.severity = none
```

Silencing it is safe: it only reports, and hiding it changes nothing about registration or routing. Keep it visible
while you are diagnosing a receptor that does not seem to be called.

## Related

- [WHIZ002: No Message Handlers Found](whiz002)
- [WHIZ080: Multiple Handlers for RPC Message](whiz080)
- [Receptors Guide](../../fundamentals/receptors/receptors)
- [Dispatcher](../../fundamentals/dispatcher/dispatcher)
