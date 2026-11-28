---
title: 'WHIZ143: Fan-out of a collective event'
pageType: troubleshooting
version: 1.0.0
category: Diagnostics
severity: Error
description: >-
  Error diagnostic when a perspective fans out a collective event, which the collective sink applies through its
  [CollectiveApplyFor] handlers and never as a fan-out.
tags:
  - diagnostics
  - perspectives
  - fan-out
  - collective-events
  - analyzer
codeReferences:
  - src/Whizbang.Generators/Analyzers/PerspectiveFanOutAnalyzer.cs
  - src/Whizbang.Generators/FanOutShape.cs
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Core/Perspectives/CollectiveApplyEntry.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Analyzers/PerspectiveFanOutAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveFanOutDiscoveryGeneratorTests.cs
---

# WHIZ143: Fan-out of a collective event

**Severity**: Error
**Category**: Perspective fan-out (`Whizbang.SourceGeneration`)

## Description

A [collective event](../../fundamentals/messaging/collective-events) already says which rows it changes: it carries its
own scope, and the collective sink applies it from its own row through the `[CollectiveApplyFor]` handlers of the models
it changes. The sink never applies a collective as a fan-out, so a fan-out declared for one would be silently ignored.
The build refuses it instead, and the generator leaves it out of the registry.

A fan-out is for an ordinary event of another stream, whose rows the consuming perspective chooses by a key.

## Diagnostic Message

```text
'{Perspective}' fans out {Event}, a collective event. A collective carries its own scope and is applied from its own row; apply it with a [CollectiveApplyFor] handler on {Model}, or fan out an event that is not collective.
```

## How to Fix

### Before (causes WHIZ143)

```csharp{title="WHIZ143: before" description="A fan-out of a collective event" framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "Fan-Out", "WHIZ143"] testFile="PerspectiveFanOutAnalyzerTests.cs" testMethod="Whiz143_AFanOutOfACollectiveEvent_IsAnErrorAsync" tests=["PerspectiveFanOutAnalyzerTests.Whiz143_AFanOutOfACollectiveEvent_IsAnErrorAsync"]}
public class OrderSummaryProjection : IPerspectiveFanOutFor<OrderSummary, TenantWide> { /* ... */ } // WHIZ143
```

### After (no diagnostic)

```csharp{title="WHIZ143: after" description="The collective applied by a handler" framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "Collective", "WHIZ143"] testFile="PerspectiveFanOutAnalyzerTests.cs" testMethod="AValidKey_ReportsNothingAsync" tests=["PerspectiveFanOutAnalyzerTests.AValidKey_ReportsNothingAsync"]}
[CollectiveApplyFor(typeof(TenantWide))]
public ICollectiveSpec<OrderSummary> Apply(TenantWide e, ICollectiveQuery q) =>
  new CollectiveSpec<OrderSummary>(s => s.SetProperty(o => o.CustomerName, e.Name));
```

## Related

- [Fan-out from another stream](../../fundamentals/perspectives/multi-stream#fan-out-from-another-stream)
- [Collective events: authoring a handler](../../fundamentals/messaging/collective-events#authoring-a-handler)
- [WHIZ129](whiz129): the other declaration the generator leaves out
