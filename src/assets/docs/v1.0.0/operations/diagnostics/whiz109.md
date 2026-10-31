---
title: 'WHIZ109: Apply handles an event no perspective interface lists'
pageType: troubleshooting
verifiedAgainstCommit: d13ea0d0
verifiedDate: 2026-10-31
description: >-
  Error diagnostic when a perspective declares an Apply(TModel, TEvent) for an event that none of its perspective
  interfaces lists for that model. The runner routes only the events the interfaces list, so the method compiles and
  never runs.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - perspectives
  - apply
  - strongly-typed-contract
  - analyzer
codeReferences:
  - src/Whizbang.Generators/Analyzers/PerspectiveContractAnalyzer.cs
  - src/Whizbang.Generators/Utilities/PerspectiveContract.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectiveUnlistedApplyTests.cs
lastMaintainedCommit: 'd13ea0d0'
---

# WHIZ109: Apply handles an event no perspective interface lists

**Severity**: Error
**Category**: Perspectives (`Whizbang.Perspectives`)

## Description

A perspective's interfaces (`IPerspectiveFor`, `IPerspectiveWithActionsFor`, `IGlobalPerspectiveFor`) are the
[strongly-typed contract](../../fundamentals/perspectives/perspectives#strongly-typed-contract) the compiler checks,
and the generated runner delivers exactly the events they list. It never routes an event to a method because of the
method's name. An `Apply(TModel, TEvent)` for an event that no interface on the class lists for that model therefore
compiles and is never called: a handler meant to keep the row current silently does nothing.

WHIZ109 is reported for every such `Apply`, whatever its accessibility (`public`, `internal`, `protected` or
`private`):

- an `Apply` declared on the perspective is reported at the method's name;
- an `Apply` the perspective inherits from a base class is reported at the perspective's name, because the method may
  be declared in another assembly and it is the inheriting perspective's contract that fails to route it. The message
  names the base class;
- an `Apply` for an event that the class lists only for **another** model is reported too: the event is routed to the
  other model's `Apply`, never to this one;
- a global (multi-stream) perspective is held to the events its `IGlobalPerspectiveFor` interfaces list.

It is **not** reported for a method that cannot be a handler: a `static` method (the runner calls an instance), a
method whose first parameter is not one of the perspective's models, whose second parameter is not an event, or that
does not take exactly two parameters, and any method on a class that is not a perspective.

{verified: PerspectiveUnlistedApplyTests.AnApplyForAnEventNoInterfaceLists_IsAnErrorAtTheMethodAsync, PerspectiveUnlistedApplyTests.AnUnlistedApply_IsAnError_WhateverItsAccessibilityAsync, PerspectiveUnlistedApplyTests.AnInheritedUnlistedApply_IsAnErrorAtTheDerivedPerspectiveAsync, PerspectiveUnlistedApplyTests.AnOverriddenUnlistedApply_IsReportedOncePerPerspectiveAsync, PerspectiveUnlistedApplyTests.AnApplyForAnEventListedOnlyForAnotherModel_IsAnErrorAsync, PerspectiveUnlistedApplyTests.AGlobalPerspective_IsHeldToTheEventsItsInterfaceListsAsync, PerspectiveUnlistedApplyTests.MethodsThatCannotBeAnApply_AreNotReportedAsync, PerspectiveUnlistedApplyTests.AStaticApplyForAnUnlistedEvent_IsNotReported_BecauseOnlyInstanceMethodsAreHandlersAsync}

## Diagnostic Message

```text
Apply{InheritedFrom} on perspective '{PerspectiveName}' handles '{EventType}', which no perspective interface on '{PerspectiveName}' lists for model '{ModelType}', so the runner never routes the event to it. List '{EventType}' under IPerspectiveFor<{ModelType}, ...> (or IPerspectiveWithActionsFor<{ModelType}, ...> when it returns ApplyResult<{ModelType}>), or remove the method.
```

`{InheritedFrom}` is empty for the perspective's own method, and reads ` (inherited from '{BaseClass}')` for an
inherited one.

## Common Causes

1. **A new event was handled but not listed.** The `Apply` was added and the interface list was not extended.
2. **An event was removed from an interface list** while its `Apply` stayed behind.
3. **A base class carries handlers** for events the derived perspective does not list.
4. **The `Apply` was written for the wrong model** in a perspective that projects several models.

## How to Fix

List the event under a perspective interface for the model, or remove the method if the event is no longer handled.
Which interface depends on what the `Apply` returns:

- `TModel`: list it under `IPerspectiveFor<TModel, ...>`;
- `ApplyResult<TModel>` (the event may delete or purge the row): list it under `IPerspectiveWithActionsFor<TModel, ...>`.

A perspective may implement either interface **any number of times**, grouping its events however reads best, so the
fix never needs a second class. Each implementation takes up to 50 events.

### Before (causes WHIZ109)

```csharp{title="An Apply for an event no interface lists (causes WHIZ109)" description="OrderProjection lists OrderPlaced only, so the runner never routes OrderStatusChanged to its Apply" framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "Perspectives", "Apply", "WHIZ109"] tests=["PerspectiveUnlistedApplyTests.AnApplyForAnEventNoInterfaceLists_IsAnErrorAtTheMethodAsync"]}
using Whizbang.Core;
using Whizbang.Core.Perspectives;

public class OrderProjection : IPerspectiveFor<Order, OrderPlaced> {
  public Order Apply(Order current, OrderPlaced @event) => current with { Id = @event.OrderId };

  // WHIZ109: no interface on OrderProjection lists OrderStatusChanged, so this never runs
  public Order Apply(Order current, OrderStatusChanged @event) => current with { Status = @event.Status };
}
```

### After (no diagnostic)

```csharp{title="The event listed under a second IPerspectiveFor" description="Implementing IPerspectiveFor again lists OrderStatusChanged, and the runner routes it to the Apply" framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "Perspectives", "Apply", "WHIZ109"] tests=["PerspectiveUnlistedApplyTests.AnApplyForAListedEvent_IsNotReported_WhicheverInterfaceListsItAsync", "PerspectiveRunnerInterfaceDispatchTests.EachEvent_IsAppliedThroughTheInterfaceThatListsItAsync"]}
public class OrderProjection :
    IPerspectiveFor<Order, OrderPlaced>,
    IPerspectiveFor<Order, OrderStatusChanged> {
  public Order Apply(Order current, OrderPlaced @event) => current with { Id = @event.OrderId };

  public Order Apply(Order current, OrderStatusChanged @event) => current with { Status = @event.Status };
}
```

`IPerspectiveFor<Order, OrderPlaced, OrderStatusChanged>` lists the same two events in one interface; both forms are
equivalent.

## If the Diagnostic Is Suppressed

Nothing at run time catches it. The runner routes only the events the interfaces list, so the method is never called,
and if no interface on the perspective lists the event at all, the perspective never receives it.

## Related

- [Perspectives: the interfaces are the contract](../../fundamentals/perspectives/perspectives#strongly-typed-contract)
- [WHIZ113: Method looks like a misspelled Apply](whiz113)
- [WHIZ115: Apply returns a shape its interface does not declare](whiz115)
- [WHIZ117: Event is listed only by an interface that declares no Apply for it](whiz117)
- [Error Reference](error-reference)
