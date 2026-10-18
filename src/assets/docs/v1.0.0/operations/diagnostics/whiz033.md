---
title: 'WHIZ033: Perspective Model Missing StreamId'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning diagnostic when a perspective's model type declares no [StreamId] property. No runner is generated for that
  perspective, so it never processes events.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - perspectives
  - streamid
  - perspective-runner
  - source-generator
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/PerspectiveRunnerGenerator.cs
  - src/Whizbang.Generators/PerspectiveRunnerRegistryGenerator.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectiveRunnerGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveRunnerGeneratorBranchTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ033: Perspective Model Missing StreamId

**Severity**: Warning
**Category**: Whizbang.SourceGeneration

## Description

A perspective's model is stored one row per stream, and the generated runner uses the model's `[StreamId]` property
to key that row. When the model type (the first type argument of `IPerspectiveFor`, `IPerspectiveWithActionsFor` or
`IGlobalPerspectiveFor`) has no property marked `[StreamId]`, the runner generator cannot build a runner. It reports
WHIZ033 on the perspective class instead of skipping it silently.

The consequence is larger than the warning level suggests: **the perspective gets no runner and is left out of the
perspective runner registry**, so at runtime it never applies any events. The project still compiles.

Details of the check:

- Only properties the model type **declares itself** are examined. A `[StreamId]` property inherited from a base
  class or base record is not found.
- A model that is not a named type (for example `string[]`) has no properties of its own and always triggers WHIZ033.
- Abstract perspective classes and classes with no event types are not checked.

The warning is reported at the perspective class declaration.

## Diagnostic Message

```text
Perspective '{PerspectiveName}' will not generate a runner because model '{ModelName}' has no property with [StreamId] attribute
```

## Common Causes

1. **The `[StreamId]` attribute was forgotten** on the model's identifier property.
2. **The `[StreamId]` property is declared on a base type** of the model, which the check does not look at.
3. **The model is an array or another type with no declared properties.**
4. **The attribute is a different `StreamId` type.** The check matches `Whizbang.Core.StreamIdAttribute` only.

## How to Fix

Mark the model property that identifies the stream with `[StreamId]`, on the model type itself. Use a named model
type (a class or record) rather than an array or collection.

### Before (causes WHIZ033)

```csharp{
title: "Model with no [StreamId]"
description: "OrderReadModel declares no [StreamId] property, so OrderPerspective gets no runner"
category: "Troubleshooting"
difficulty: "BEGINNER"
tags: ["Operations", "Diagnostics", "Perspectives", "StreamId"]
testFile: "tests/Whizbang.Generators.Tests/PerspectiveRunnerGeneratorTests.cs"
testMethod: "PerspectiveRunnerGenerator_ModelMissingStreamId_EmitsWarningAsync"
githubUrl: "https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectiveRunnerGeneratorTests.cs"
tests: ["PerspectiveRunnerGeneratorTests.PerspectiveRunnerGenerator_ModelMissingStreamId_EmitsWarningAsync"]
}
namespace TestNamespace {
  public record OrderCreatedEvent : IEvent {
    public string OrderId { get; init; } = "";
  }

  public record OrderReadModel {
    public string OrderId { get; init; } = "";  // No [StreamId]!
    public string Status { get; init; } = "";
  }

  public class OrderPerspective : IPerspectiveFor<OrderReadModel, OrderCreatedEvent> {
    public OrderReadModel Apply(OrderReadModel currentData, OrderCreatedEvent @event) {
      return currentData with { Status = "Created" };
    }
  }
}
```

### After (runner generated)

```csharp{
title: "Model with [StreamId]"
description: "OrderReadModel marks OrderId with [StreamId], so no WHIZ033 and a runner is generated"
category: "Troubleshooting"
difficulty: "BEGINNER"
tags: ["Operations", "Diagnostics", "Perspectives", "StreamId"]
testFile: "tests/Whizbang.Generators.Tests/PerspectiveRunnerGeneratorTests.cs"
testMethod: "PerspectiveRunnerGenerator_ModelHasStreamId_NoWarningAsync"
githubUrl: "https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectiveRunnerGeneratorTests.cs"
tests: ["PerspectiveRunnerGeneratorTests.PerspectiveRunnerGenerator_ModelHasStreamId_NoWarningAsync"]
}
namespace TestNamespace {
  public record OrderCreatedEvent : IEvent {
    public string OrderId { get; init; } = "";
  }

  public record OrderReadModel {
    [StreamId]
    public string OrderId { get; init; } = "";  // Has [StreamId]!
    public string Status { get; init; } = "";
  }

  public class OrderPerspective : IPerspectiveFor<OrderReadModel, OrderCreatedEvent> {
    public OrderReadModel Apply(OrderReadModel currentData, OrderCreatedEvent @event) {
      return currentData with { Status = "Created" };
    }
  }
}
```

## Suppressing

Suppressing WHIZ033 does not make the perspective work; it only hides the fact that it will never run. Fix the model
instead. The only case where suppressing is reasonable is a class that implements a perspective interface but is
deliberately never meant to run.

Although the warning points at the perspective's file and line, it is not attached to the compiled syntax tree, so a
`#pragma warning disable WHIZ033` region does not reach it. Use a global analyzer config file:

```ini{
title: "Silence WHIZ033"
description: "Project-wide suppression through a global analyzer config"
category: "Troubleshooting"
difficulty: "BEGINNER"
tags: ["Operations", "Diagnostics", "Suppressing"]
unverified: "suppression/config, not exercised by a test"
}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ033.severity = none
```

The same line works in an `.editorconfig` that sets `is_global = true`. Note that this turns the warning off for the
whole project, including for perspectives you add later.

## Related

- [WHIZ030: Perspective Event Missing StreamId](whiz030)
- [WHIZ031: Multiple StreamId Attributes](whiz031)
- [WHIZ027: Perspective Runner Generated](whiz027)
- [StreamId Attribute](../../extending/attributes/streamid)
- [Perspectives](../../fundamentals/perspectives/perspectives)
