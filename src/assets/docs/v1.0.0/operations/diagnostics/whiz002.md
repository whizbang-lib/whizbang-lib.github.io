---
title: 'WHIZ002: No Message Handlers Found'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Informational notice that the compilation contains no receptor and no perspective. Outside test projects the
  generator then skips dispatcher generation for that project.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - receptors
  - perspectives
  - dispatcher
  - source-generator
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/ReceptorDiscoveryGenerator.cs
testReferences:
  - tests/Whizbang.Generators.Tests/ReceptorDiscoveryGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/ReceptorDiscoveryGeneratorCoverageTests.cs
  - tests/Whizbang.Generators.Tests/ReceptorDiscoveryMalformedSourceTests.cs
  - tests/Whizbang.Generators.Tests/UnnamedAssemblyFallbackTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ002: No Message Handlers Found

**Severity**: Info
**Category**: Whizbang.SourceGeneration

## Description

The `ReceptorDiscoveryGenerator` found **no** message handler of any kind in this compilation: no receptor
(`IReceptor` or `ISyncReceptor`, including saga recovery receptors) and no perspective (`IPerspectiveFor<TModel, TEvent...>`
or `IPerspectiveWithActionsFor<TModel, TEvent...>`). It is reported once per compilation, with no source location.

A project that has perspectives but no receptors does **not** get WHIZ002; the generator still emits an empty
dispatcher for it so commands can be routed to other services through the outbox.

The notice matters because of what follows it. When WHIZ002 fires in a project whose assembly name does not contain
`Test`, the generator stops there and emits none of its dispatcher sources (for example `DispatcherRegistrations.g.cs`,
`Dispatcher.g.cs`, `ReceptorRegistry.g.cs`). Code in that project that calls the generated registration will then
fail to compile. In an assembly whose name contains `Test` (case-insensitive), generation continues so tests can
register receptors at runtime.

## Diagnostic Message

```text
No IReceptor or IPerspectiveFor implementations were found in the compilation
```

## Common Causes

1. **The project has no handlers yet**, for example a shared contracts library that only declares messages.
2. **Handlers live in a different project** than the one being built, so this compilation genuinely has none.
3. **The only receptor is an open generic class** (`MyReceptor<T>`), which the generator skips.
4. **A class does not actually implement a receptor interface**, for example it has a `HandleAsync` method but no
   `IReceptor<...>` in its base list.

## How to Fix

- **Contracts or utility project**: nothing to fix. The notice is expected; suppress it if it is noise.
- **Handlers expected here**: implement `IReceptor<TMessage, TResponse>` (or another receptor interface) with closed
  type arguments, or add a perspective. Each one found is then reported as [WHIZ001](whiz001) or
  [WHIZ007](whiz007).

### Before (produces WHIZ002)

```csharp{title="A compilation with no handlers" description="No receptor or perspective, so the generator reports WHIZ002." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "WHIZ002", "Receptors", "Discovery"] tests=["ReceptorDiscoveryGeneratorTests.Generator_WithNoReceptors_GeneratesInfoAsync"] testFile="ReceptorDiscoveryGeneratorTests.cs" testMethod="Generator_WithNoReceptors_GeneratesInfoAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/ReceptorDiscoveryGeneratorTests.cs"}
namespace MyApp;

public class SomeClass {
  public string Name { get; set; } = string.Empty;
}
```

### After (no WHIZ002)

A perspective alone is enough to count as a message handler:

```csharp{title="A perspective suppresses WHIZ002" description="A compilation with a perspective and no receptor does not report WHIZ002." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "WHIZ002", "Perspectives", "Discovery"] tests=["ReceptorDiscoveryGeneratorTests.Generator_WithPerspectiveButNoReceptor_DoesNotWarnAsync"] testFile="ReceptorDiscoveryGeneratorTests.cs" testMethod="Generator_WithPerspectiveButNoReceptor_DoesNotWarnAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/ReceptorDiscoveryGeneratorTests.cs"}
using System;
using Whizbang.Core;
using Whizbang.Core.Perspectives;

namespace MyApp.Perspectives;

public record TestEvent : IEvent;

public record TestModel {
  public Guid Id { get; set; }
}

public class TestPerspective : IPerspectiveFor<TestModel, TestEvent> {
  public TestModel Apply(TestModel currentData, TestEvent @event) {
    return currentData;
  }
}
```

## Suppressing

WHIZ002 has no source location, so `#pragma warning disable WHIZ002` cannot reach it. Set its severity in a global
analyzer config file instead:

```ini{title="Silence WHIZ002 project-wide" description="Global analyzer config entry that hides the no-handlers notice." category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "WHIZ002", "Suppression", "globalconfig"] unverified="suppression/config, not exercised by a test"}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ002.severity = none
```

Suppress it in projects that are meant to have no handlers (message contracts, shared libraries). Do not suppress it
in a service that should be handling messages: there it is the first sign that the dispatcher was not generated.
Suppressing it does not change the generator's behavior; dispatcher sources are still skipped.

## Related

- [WHIZ001: Receptor Discovered](whiz001)
- [WHIZ007: Perspective Discovered](whiz007)
- [Receptors Guide](../../fundamentals/receptors/receptors)
- [Perspectives Guide](../../fundamentals/perspectives/perspectives)
- [Dispatcher](../../fundamentals/dispatcher/dispatcher)
