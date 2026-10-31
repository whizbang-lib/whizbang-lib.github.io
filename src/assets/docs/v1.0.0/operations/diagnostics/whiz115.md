---
title: 'WHIZ115: Apply returns a shape its interface does not declare'
pageType: troubleshooting
verifiedAgainstCommit: d13ea0d0
verifiedDate: 2026-10-31
description: >-
  Error diagnostic when an Apply for a listed event returns something the interface that lists the event does not
  declare: a bare ModelAction, the (TModel?, ModelAction) tuple, or the other interface family's return. Such an Apply
  is not the interface's, so it compiles only beside an explicit implementation that is what actually runs.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - perspectives
  - apply
  - model-action
  - apply-result
  - analyzer
codeReferences:
  - src/Whizbang.Generators/Analyzers/PerspectiveContractAnalyzer.cs
  - src/Whizbang.Generators/Utilities/PerspectiveContract.cs
  - src/Whizbang.Core/Perspectives/ApplyResult.cs
  - src/Whizbang.Core/Perspectives/ModelAction.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectiveApplyReturnShapeTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/ModelActionTests.cs
lastMaintainedCommit: 'd13ea0d0'
---

# WHIZ115: Apply returns a shape its interface does not declare

**Severity**: Error
**Category**: Perspectives (`Whizbang.Perspectives`)

## Description

Each perspective interface declares what its `Apply` returns:

| Interface | `Apply` returns |
|---|---|
| `IPerspectiveFor<TModel, ...>` | `TModel` |
| `IGlobalPerspectiveFor<TModel, TPartitionKey, ...>` | `TModel` |
| `IPerspectiveWithActionsFor<TModel, ...>` | `ApplyResult<TModel>` |

An `Apply` for a listed event that returns anything else is not the interface's implementation. It compiles only
because something else satisfies the interface (usually an explicit implementation added for the purpose, reported as
[WHIZ114](whiz114)), and that something else is what the generated runner calls. WHIZ115 reports the `Apply` at its
name:

- a bare `ModelAction` return, or the `(TModel?, ModelAction)` tuple, for an event `IPerspectiveFor` lists;
- the other family's return in either direction: `ApplyResult<TModel>` for an event only `IPerspectiveFor` lists, or
  `TModel` for an event only `IPerspectiveWithActionsFor` lists;
- an inherited `Apply` with such a return, reported at the perspective's name; the message names the base class.

It is **not** reported for:

- a `TModel?` return for an `IPerspectiveFor` event. Nullability does not take part in matching an interface member:
  the compiler warns (CS8766) and accepts the method as the implementation, so the analyzer does too;
- an event both families list, when the `Apply` returns either declared shape;
- an event listed only through a custom marker interface that declares no `Apply`; there is no declared shape to judge
  against, and [WHIZ117](whiz117) reports it instead.

{verified: PerspectiveApplyReturnShapeTests.ABareModelActionReturn_ForAnIPerspectiveForEvent_IsAnErrorNamingTheFixAsync, PerspectiveApplyReturnShapeTests.TheTupleReturn_IsAnErrorAsync, PerspectiveApplyReturnShapeTests.TheOtherFamilysReturn_IsAnError_InEitherDirectionAsync, PerspectiveApplyReturnShapeTests.AnInheritedNonInterfaceReturn_IsAnErrorAtTheDerivedPerspectiveAsync, PerspectiveApplyReturnShapeTests.ANullableModelReturn_ImplementsTheInterface_AndIsNotReportedAsync, PerspectiveApplyReturnShapeTests.AnEventListedByBothFamilies_AcceptsEitherDeclaredReturnAsync, PerspectiveApplyReturnShapeTests.AnEventListedOnlyByAMarkerWithNoApplyMember_HasNoDeclaredShapeToJudgeAsync}

## Diagnostic Message

```text
Apply{InheritedFrom} for '{EventType}' on perspective '{PerspectiveName}' returns '{ReturnType}', but the interface that lists '{EventType}' declares '{DeclaredReturn}', so this Apply is not the interface's and compiles only beside an explicit implementation that never runs. Return '{DeclaredReturn}'. To delete or purge, list '{EventType}' under IPerspectiveWithActionsFor<{ModelType}, ...> and return ApplyResult<{ModelType}>: 'return ModelAction.Purge;' converts implicitly.
```

`{InheritedFrom}` is empty for the perspective's own method, and reads ` (inherited from '{BaseClass}')` for an
inherited one.

## Common Causes

1. **A purge or delete returned from an `IPerspectiveFor` event.** `ModelAction` and the tuple look like natural
   returns, and an earlier `ModelAction` documentation example showed exactly this shape.
2. **An event moved between interface families** while its `Apply` kept the old return.
3. **A base class of handlers** written before the perspective chose its interfaces.

## How to Fix

Return what the interface listing the event declares.

- **The event may delete, purge or resurrect the row.** List it under `IPerspectiveWithActionsFor<TModel, ...>` and
  return `ApplyResult<TModel>`. `ApplyResult<TModel>` converts implicitly from the model, from `ModelAction` and from
  the `(TModel?, ModelAction)` tuple, so the body does not change: `return ModelAction.Purge;` and
  `return (current with { DeletedAt = @event.At }, ModelAction.Delete);` both stay one line.
- **The event only updates the row.** Return `TModel` and keep it under `IPerspectiveFor`.
- Delete any explicit implementation that existed only to make the class compile.

One class may implement `IPerspectiveFor` and `IPerspectiveWithActionsFor` side by side, each any number of times, so
the fix never needs a second perspective.

### Before (causes WHIZ115)

```csharp{title="A bare ModelAction for an IPerspectiveFor event (causes WHIZ115)" description="IPerspectiveFor declares Order Apply, so the ModelAction Apply is not the interface's and compiles only beside an explicit decoy" framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "ModelAction", "WHIZ115"] tests=["PerspectiveApplyReturnShapeTests.ABareModelActionReturn_ForAnIPerspectiveForEvent_IsAnErrorNamingTheFixAsync"]}
using Whizbang.Core;
using Whizbang.Core.Perspectives;

public class OrderProjection : IPerspectiveFor<Order, OrderPlaced, OrderStatusChanged> {
  public Order Apply(Order current, OrderPlaced @event) => current;

  // WHIZ115: returns ModelAction, but IPerspectiveFor declares Order
  public ModelAction Apply(Order current, OrderStatusChanged @event) => ModelAction.Purge;

  // WHIZ114: the explicit implementation the runner actually calls; it keeps the row
  Order IPerspectiveFor<Order, OrderPlaced, OrderStatusChanged>.Apply(Order current, OrderStatusChanged @event) => current;
}
```

### After (no diagnostic)

```csharp{title="The purging event listed under IPerspectiveWithActionsFor" description="OrderStatusChanged returns ApplyResult<Order>, and ModelAction.Purge converts to it implicitly" framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "ApplyResult", "WHIZ115"] tests=["PerspectiveRunnerInterfaceDispatchTests.EachEvent_IsAppliedThroughTheInterfaceThatListsItAsync", "ModelActionTests.TheDocumentedExample_ReturnsDeleteThroughTheInterfaceDeclaredShape_AndSetsNothingAsync"]}
public class OrderProjection :
    IPerspectiveFor<Order, OrderPlaced>,
    IPerspectiveWithActionsFor<Order, OrderStatusChanged> {
  public Order Apply(Order current, OrderPlaced @event) => current;

  public ApplyResult<Order> Apply(Order current, OrderStatusChanged @event) => ModelAction.Purge;
}
```

## If the Diagnostic Is Suppressed

The runner calls `Apply` through the interface that lists the event, so it runs the interface's implementation (the
explicit one) and never the method with the undeclared return. In the example above, the row is kept and never
purged.

{verified: PerspectiveApplyReturnShapeTests.AShapeOnlyASuppressedWhiz115Allows_IsNeverWhatTheRunnerCallsAsync}

## Related

- [Perspectives with Actions: purging from a perspective that also returns models](../../fundamentals/perspectives/perspectives-with-actions#purge-beside-models)
- [Perspectives: the interfaces are the contract](../../fundamentals/perspectives/perspectives#strongly-typed-contract)
- [WHIZ114: Explicit interface Apply never runs](whiz114)
- [WHIZ117: Event is listed only by an interface that declares no Apply for it](whiz117)
- [Error Reference](error-reference)
