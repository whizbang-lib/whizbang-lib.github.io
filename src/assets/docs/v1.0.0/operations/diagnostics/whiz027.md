---
title: 'WHIZ027: Perspective Runner Generated'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Info diagnostic reported once for each perspective the source generator built a runner for, naming the perspective
  and the generated runner class.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - perspectives
  - perspective-runner
  - source-generator
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/PerspectiveRunnerGenerator.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectiveRunnerGeneratorTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ027: Perspective Runner Generated

**Severity**: Info
**Category**: Whizbang.SourceGeneration

## Description

Every perspective is executed by a generated runner class, so the perspective worker can apply events without
reflection. The perspective runner generator builds one runner for each non-abstract class that implements
`IPerspectiveFor<TModel, ...>`, `IPerspectiveWithActionsFor<TModel, ...>` or `IGlobalPerspectiveFor<TModel, ...>`
and whose model type declares a `[StreamId]` property. For each runner it adds, it reports WHIZ027.

The runner is named after the perspective with `Runner` appended. For a nested perspective the containing type's
name is included and the dot is removed: `OrderStatus.Projection` gets `OrderStatusProjectionRunner`.

WHIZ027 is a confirmation, not a problem. It is useful when you want to check that a perspective was picked up. A
perspective that is missing from the list was skipped: an abstract class, a class with no event types, or a model
with no `[StreamId]` property (which is reported as [WHIZ033](whiz033)).

The diagnostic has no source location.

## Diagnostic Message

```text
Generated perspective runner '{RunnerName}' for perspective '{PerspectiveName}'
```

## Common Causes

1. **A perspective was discovered and its runner generated.** This is the expected outcome for every valid
   perspective in the project.

## How to Fix

Nothing needs fixing. If a perspective you expected is not reported, look for [WHIZ033](whiz033) on that perspective,
and check that the class is not abstract and implements one of the perspective interfaces with at least one event
type.

### Example that produces WHIZ027

```csharp{
title: "A perspective that gets a runner"
description: "The model declares [StreamId], so OrderPerspectiveRunner is generated and WHIZ027 is reported"
category: "Troubleshooting"
difficulty: "BEGINNER"
tags: ["Operations", "Diagnostics", "Perspectives"]
testFile: "tests/Whizbang.Generators.Tests/PerspectiveRunnerGeneratorTests.cs"
testMethod: "PerspectiveRunnerGenerator_GeneratesDiagnosticAsync"
githubUrl: "https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectiveRunnerGeneratorTests.cs"
tests: ["PerspectiveRunnerGeneratorTests.PerspectiveRunnerGenerator_GeneratesDiagnosticAsync"]
}
namespace TestNamespace {
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
}
```

The build reports `Generated perspective runner 'OrderPerspectiveRunner' for perspective 'OrderPerspective'`.

## Suppressing

WHIZ027 has no source location, so a `#pragma warning disable WHIZ027` region cannot reach it. Turn it off in a
global analyzer config file:

```ini{
title: "Silence WHIZ027"
description: "Project-wide suppression through a global analyzer config"
category: "Troubleshooting"
difficulty: "BEGINNER"
tags: ["Operations", "Diagnostics", "Suppressing"]
unverified: "suppression/config, not exercised by a test"
}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ027.severity = none
```

The same line works in an `.editorconfig` that sets `is_global = true`. Suppressing is safe: the notice only confirms
generation and silencing it changes nothing about the runners. Problems with perspectives are reported by their own
warnings and errors (for example [WHIZ033](whiz033) and [WHIZ032](whiz032)), which this setting does not affect.

## Related

- [WHIZ028: Perspective Runner Registry Generated](whiz028)
- [WHIZ033: Perspective Model Missing StreamId](whiz033)
- [Perspective Discovery](../../extending/source-generators/perspective-discovery)
- [Perspectives](../../fundamentals/perspectives/perspectives)
- [Perspective Worker](../workers/perspective-worker)
