---
title: 'WHIZ028: Perspective Runner Registry Generated'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Info diagnostic reported when the source generator emits the perspective runner registry, the static lookup the
  perspective worker uses to find each perspective's runner without reflection.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - perspectives
  - perspective-runner
  - registry
  - aot
  - source-generator
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/PerspectiveRunnerRegistryGenerator.cs
testReferences: []
lastMaintainedCommit: '9a416b5b'
---

# WHIZ028: Perspective Runner Registry Generated

**Severity**: Info
**Category**: Whizbang.SourceGeneration

## Description

Besides one runner per perspective (see [WHIZ027](whiz027)), the build generates a single `PerspectiveRunnerRegistry`
class in the `<AssemblyName>.Generated` namespace (file `PerspectiveRunnerRegistry.g.cs`). It provides `GetRunner()`
and `AddPerspectiveRunners()` so the perspective worker can look up runners with no reflection, which keeps the
application compatible with Native AOT. When the registry is emitted, WHIZ028 reports how many runners it contains.

The count includes every non-abstract perspective class (single-stream through `IPerspectiveBase`, or multi-stream
through `IGlobalPerspectiveFor`) whose model declares a `[StreamId]` property. Perspectives whose model has no
`[StreamId]` are left out of the registry without a message from this generator; the runner generator reports them
as [WHIZ033](whiz033).

WHIZ028 is not reported when:

- the project has no qualifying perspectives (no registry is generated), or
- two perspectives share a name. The generator then reports [WHIZ032](whiz032) and generates no registry at all.

The diagnostic has no source location.

## Diagnostic Message

```text
Generated perspective runner registry with {RunnerCount} runner(s) for zero-reflection lookup (AOT-compatible)
```

## Common Causes

1. **The project contains at least one valid perspective** and the registry was generated for it. This is the
   expected outcome.

## How to Fix

Nothing needs fixing. If the count is lower than the number of perspectives you wrote, look for
[WHIZ033](whiz033) on the missing ones. If WHIZ028 is absent from a project that has perspectives, look for
[WHIZ032](whiz032).

### Example that produces WHIZ028

```csharp{
title: "A project with one perspective"
description: "One valid perspective, so the registry is generated with 1 runner"
category: "Troubleshooting"
difficulty: "BEGINNER"
tags: ["Operations", "Diagnostics", "Perspectives"]
unverified: "no test asserts WHIZ028; the registry output itself is asserted by PerspectiveRunnerRegistryGeneratorTests"
}
public record OrderEvent : IEvent {
  public string OrderId { get; init; } = "";
}

public record OrderReadModel {
  [StreamId]
  public string OrderId { get; init; } = "";
}

public class OrderPerspective : IPerspectiveFor<OrderReadModel, OrderEvent> {
  public OrderReadModel Apply(OrderReadModel currentData, OrderEvent @event) {
    return currentData;
  }
}
```

The build reports `Generated perspective runner registry with 1 runner(s) for zero-reflection lookup (AOT-compatible)`.

## Suppressing

WHIZ028 has no source location, so a `#pragma warning disable WHIZ028` region cannot reach it. Turn it off in a
global analyzer config file:

```ini{
title: "Silence WHIZ028"
description: "Project-wide suppression through a global analyzer config"
category: "Troubleshooting"
difficulty: "BEGINNER"
tags: ["Operations", "Diagnostics", "Suppressing"]
unverified: "suppression/config, not exercised by a test"
}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ028.severity = none
```

The same line works in an `.editorconfig` that sets `is_global = true`. Suppressing is safe; it does not change what
is generated. The name collision that prevents the registry is an error ([WHIZ032](whiz032)) and is not affected.

## Related

- [WHIZ027: Perspective Runner Generated](whiz027)
- [WHIZ032: Perspective Name Collision](whiz032)
- [WHIZ033: Perspective Model Missing StreamId](whiz033)
- [Perspective Worker](../workers/perspective-worker)
- [Native AOT](../deployment/native-aot)
