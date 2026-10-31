---
title: 'WHIZ116: Collective Apply does not match the shape the framework binds'
pageType: troubleshooting
verifiedAgainstCommit: d13ea0d0
verifiedDate: 2026-10-31
description: >-
  Error diagnostic when a method meant to be a collective-event handler (it carries [CollectiveApplyFor], or it
  implements ICollectiveApplyFor.Apply) does not match the shape the generator binds. Such a method was left out of
  the collective registry without a word, so its collective event never changed the model.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - collective-events
  - collective-apply-for
  - perspectives
  - analyzer
codeReferences:
  - src/Whizbang.Generators/Analyzers/CollectiveApplyShapeAnalyzer.cs
  - src/Whizbang.Generators/CollectiveApplyShape.cs
  - src/Whizbang.Core/Perspectives/CollectiveApplyForAttribute.cs
  - src/Whizbang.Core/Perspectives/ICollectiveApplyFor.cs
testReferences:
  - tests/Whizbang.Generators.Tests/CollectiveApplyShapeAnalyzerTests.cs
lastMaintainedCommit: 'd13ea0d0'
---

# WHIZ116: Collective Apply does not match the shape the framework binds

**Severity**: Error
**Category**: Perspectives (`Whizbang.Perspectives`)

## Description

A [collective-event handler](../../fundamentals/messaging/collective-events#handler-shapes) is found by its shape: a
method carrying `[CollectiveApplyFor]` that returns `ICollectiveSpec<TModel>` and takes the collective event,
optionally followed by the `ICollectiveQuery` context. The generator binds exactly these two shapes:

```text
ICollectiveSpec<TModel> Name(TEvent e)
ICollectiveSpec<TModel> Name(TEvent e, ICollectiveQuery query)
```

A method meant to be a handler that differs in any part used to be left out of the collective registry without a
word, so its collective event never changed the model. WHIZ116 reports it at the method's name, with the reason:

- the method carries `[CollectiveApplyFor]` but takes no parameters or more than two;
- its first parameter is not an `ICollectiveEvent`;
- its second parameter is not an `ICollectiveQuery` (or a type that implements it);
- it does not return `ICollectiveSpec<TModel>`;
- it implements `ICollectiveApplyFor<TModel, TEvent>.Apply` but has no `[CollectiveApplyFor]`. The interface documents
  the shape; the attribute is how the generator finds the handler.

A method that matches a shape, or that neither carries the attribute nor implements `ICollectiveApplyFor`, is not
reported.

{verified: CollectiveApplyShapeAnalyzerTests.AnAttributedMethodThatDoesNotMatchTheShape_IsAnErrorNamingWhatIsWrongAsync, CollectiveApplyShapeAnalyzerTests.AnICollectiveApplyForImplementationWithoutTheAttribute_IsAnErrorAsync, CollectiveApplyShapeAnalyzerTests.AnICollectiveApplyForImplementationWithTheAttribute_IsNotReportedAsync, CollectiveApplyShapeAnalyzerTests.AHandlerThatMatchesTheShape_OrAMethodThatIsNotOne_IsNotReportedAsync}

## Diagnostic Message

```text
Method '{MethodName}' on '{TypeName}' is meant to be a collective Apply but is never bound: {Reason}
```

`{Reason}` is one of:

```text
it takes {Count} parameters, and a collective Apply takes the collective event, optionally followed by the query context.
its first parameter, '{Type}', is not an ICollectiveEvent.
its second parameter, '{Type}', is not an ICollectiveQuery.
it returns '{Type}', not ICollectiveSpec<TModel>.
it implements ICollectiveApplyFor<{ModelType}, {EventType}>.Apply but has no [CollectiveApplyFor], and the attribute is how a collective handler is found.
```

## Common Causes

1. **The handler returns the model** instead of an `ICollectiveSpec<TModel>`, as a per-stream `Apply` would.
2. **The handler takes a per-stream event** (an `IEvent` that is not an `ICollectiveEvent`).
3. **A second parameter other than the query context**, such as the current model.
4. **`ICollectiveApplyFor` implemented without the attribute**, on the assumption that the interface alone registers
   the handler.

## How to Fix

Match one of the two shapes and carry the attribute. The `TModel` the handler updates comes from its return type, and
the event it handles from its first parameter.

### Before (causes WHIZ116)

```csharp{title="Collective handlers that are never bound (causes WHIZ116)" description="One handler returns the model instead of ICollectiveSpec, the other implements ICollectiveApplyFor without [CollectiveApplyFor]" framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Collective Events", "CollectiveApplyFor", "WHIZ116"] tests=["CollectiveApplyShapeAnalyzerTests.AnAttributedMethodThatDoesNotMatchTheShape_IsAnErrorNamingWhatIsWrongAsync", "CollectiveApplyShapeAnalyzerTests.AnICollectiveApplyForImplementationWithoutTheAttribute_IsAnErrorAsync"]}
using Whizbang.Core.Messaging;
using Whizbang.Core.Perspectives;

public record ArchiveOrders : CollectiveEventBase { }

public class OrderCollectives {
  // WHIZ116: it returns 'Order', not ICollectiveSpec<TModel>
  [CollectiveApplyFor]
  public Order Apply(ArchiveOrders e) => null!;
}

public class OrderArchive : ICollectiveApplyFor<Order, ArchiveOrders> {
  // WHIZ116: implements ICollectiveApplyFor<Order, ArchiveOrders>.Apply but has no [CollectiveApplyFor]
  public ICollectiveSpec<Order> Apply(ArchiveOrders evt, ICollectiveQuery query) =>
    new CollectiveSpec<Order>(s => s.SetProperty(o => o.Status, "Archived"));
}
```

### After (no diagnostic)

```csharp{title="Collective handlers in a bound shape" description="Each handler returns ICollectiveSpec<Order>, takes the collective event (and optionally the query context), and carries [CollectiveApplyFor]" framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Collective Events", "CollectiveApplyFor", "WHIZ116"] tests=["CollectiveApplyShapeAnalyzerTests.AHandlerThatMatchesTheShape_OrAMethodThatIsNotOne_IsNotReportedAsync", "CollectiveApplyShapeAnalyzerTests.AnICollectiveApplyForImplementationWithTheAttribute_IsNotReportedAsync"]}
public class OrderCollectives {
  [CollectiveApplyFor]
  public ICollectiveSpec<Order> Apply(ArchiveOrders e) =>
    new CollectiveSpec<Order>(s => s.SetProperty(o => o.Status, "Archived"));
}

public class OrderArchive : ICollectiveApplyFor<Order, ArchiveOrders> {
  [CollectiveApplyFor]
  public ICollectiveSpec<Order> Apply(ArchiveOrders evt, ICollectiveQuery query) =>
    new CollectiveSpec<Order>(s => s.SetProperty(o => o.Status, "Archived"));
}
```

`CollectiveSpec<TModel>` is a small record the consuming application owns; see
[Authoring a handler](../../fundamentals/messaging/collective-events#handler-shapes).

## If the Diagnostic Is Suppressed

The generator still leaves the method out of the collective registry, so the collective event is dispatched to no
handler for that model and the rows it should change stay as they were.

## Related

- [Collective events: handler shapes](../../fundamentals/messaging/collective-events#handler-shapes)
- [WHIZ106: Collective apply must not query other perspectives at apply time](whiz106)
- [Convention-bound parameters](convention-bound-parameters)
- [Error Reference](error-reference)
