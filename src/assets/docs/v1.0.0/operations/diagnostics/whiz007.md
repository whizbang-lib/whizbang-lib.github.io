---
title: 'WHIZ007: Perspective Discovered'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Informational notice that the source generators found a perspective and will register it and generate its table
  schema. No action is needed.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - perspectives
  - source-generator
  - discovery
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/PerspectiveDiscoveryGenerator.cs
  - src/Whizbang.Generators/PerspectiveSchemaGenerator.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectiveDiscoveryGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveDiscoveryGeneratorCoverageTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveSchemaGeneratorCoverageTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ007: Perspective Discovered

**Severity**: Info
**Category**: Whizbang.SourceGeneration

## Description

WHIZ007 is a discovery notice, not a problem. It confirms that a perspective was found and will be registered with
dependency injection. It has no source location.

Two generators report it, so a build that contains perspectives shows two forms of the message:

- **One per perspective interface** (`PerspectiveDiscoveryGenerator`). For each non-abstract class implementing
  `IPerspectiveFor<TModel, TEvent...>` or `IPerspectiveWithActionsFor<TModel, TEvent...>`, it reports the class's
  simple name and the events it listens to, comma-separated. A class that implements two such interfaces is reported
  twice, once per interface. Array event types keep their brackets (`OrderEvent[]`).
- **One summary per compilation** (`PerspectiveSchemaGenerator`), after it generates the perspective table schemas.
  This one reuses the same message text but fills it with the **number** of perspectives and the list of their class
  names, so it reads, for example, `Found perspective '2' listening to OrderPerspective, CustomerPerspective`.

Abstract classes produce neither form. Discovery does not depend on the events being valid: an event with a
missing or duplicate `[StreamId]` still lets the perspective be reported here, and is reported separately as
[WHIZ030](whiz030) or [WHIZ031](whiz031).

## Diagnostic Message

```text
Found perspective '{PerspectiveName}' listening to {EventTypes}
```

In the schema generator's summary, `{PerspectiveName}` is the perspective count and `{EventTypes}` is the list of
perspective class names.

## Common Causes

1. **A perspective was added or already exists** in a project that references the Whizbang generators.

## How to Fix

Nothing to fix. If you expected a perspective and do not see its WHIZ007 line, check that the class is not abstract
and that it implements `IPerspectiveFor` or `IPerspectiveWithActionsFor` with a model **and** at least one event type.

## Example

```csharp{title="A perspective that produces WHIZ007" description="Each non-abstract perspective interface is reported as discovered." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "WHIZ007", "Perspectives", "Discovery"] tests=["PerspectiveDiscoveryGeneratorTests.PerspectiveDiscoveryGenerator_GeneratesDiagnosticForDiscoveredPerspectiveAsync"] testFile="PerspectiveDiscoveryGeneratorTests.cs" testMethod="PerspectiveDiscoveryGenerator_GeneratesDiagnosticForDiscoveredPerspectiveAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectiveDiscoveryGeneratorTests.cs"}
using Whizbang.Core;
using Whizbang.Core.Perspectives;

namespace TestNamespace {
  // This test event has no [StreamId]; a real one needs it (see WHIZ030).
  public record OrderCreatedEvent : IEvent {
    public string OrderId { get; init; } = "";
  }

  public record OrderModel {
    public string OrderId { get; set; } = "";
  }

  // Reported as: Found perspective 'OrderPerspective' listening to OrderCreatedEvent
  public class OrderPerspective : IPerspectiveFor<OrderModel, OrderCreatedEvent> {
    public OrderModel Apply(OrderModel currentData, OrderCreatedEvent @event) {
      return currentData;
    }
  }
}
```

## Suppressing

WHIZ007 has no source location, so `#pragma warning disable WHIZ007` cannot reach it. Set its severity in a global
analyzer config file; this hides both forms:

```ini{title="Silence WHIZ007 project-wide" description="Global analyzer config entry that hides the perspective discovery notices." category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "WHIZ007", "Suppression", "globalconfig"] unverified="suppression/config, not exercised by a test"}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ007.severity = none
```

Silencing it is safe; registration and schema generation happen either way.

## Related

- [WHIZ008: Perspective Model Size Warning](whiz008)
- [WHIZ030: Perspective Event Missing StreamId](whiz030)
- [WHIZ031: Multiple StreamId Attributes](whiz031)
- [WHIZ002: No Message Handlers Found](whiz002)
- [Perspectives Guide](../../fundamentals/perspectives/perspectives)
