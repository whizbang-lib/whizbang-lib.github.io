---
title: 'WHIZ114: Two Apply methods handle the same event'
pageType: troubleshooting
verifiedAgainstCommit: '54643053'
verifiedDate: 2026-10-31
description: >-
  Error diagnostic when a perspective declares an explicit interface Apply and another Apply with the same parameters.
  The runner calls the interface's implementation, so the other Apply is dead code that looks like the handler.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - perspectives
  - apply
  - explicit-interface
  - strongly-typed-contract
  - analyzer
codeReferences:
  - src/Whizbang.Generators/Analyzers/PerspectiveContractAnalyzer.cs
  - src/Whizbang.Generators/PerspectiveRunnerGenerator.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectiveDuplicateApplyTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveRunnerInterfaceDispatchTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/ExplicitApplyRunnerTests.cs
lastMaintainedCommit: '54643053'
---

# WHIZ114: Two Apply methods handle the same event

**Severity**: Error
**Category**: Perspectives (`Whizbang.Perspectives`)

## Description

A perspective declares an explicit interface implementation of `Apply`
(`TModel IPerspectiveFor<TModel, TEvent>.Apply(...)`) **and** another `Apply` with the same parameters. The generated
runner and the [typed appliers](../../fundamentals/perspectives/typed-associations#apply-through-the-interface) call
`Apply` through the interface that lists the event, so they run the explicit implementation. The other `Apply` never
runs: it is dead code that looks like the handler.

The two often disagree. The usual shape is an `Apply` returning a bare `ModelAction` to purge the row, beside an
explicit `TModel Apply` added only so that the class compiles, which keeps the row. The runner runs the explicit one,
so the row is never purged, while a unit test that calls `perspective.Apply(model, @event)` on the class binds the
other method and sees the purge.

WHIZ114 is reported at the name of the `Apply` that never runs, whatever either method returns. When that `Apply` is
inherited from a base class, it is reported at the perspective's name and the message names the base class. An
explicit implementation with no other `Apply` for its event is not reported: a perspective may implement every `Apply`
explicitly.

{verified: PerspectiveDuplicateApplyTests.TheApplyBesideAnExplicitInterfaceApply_IsAnErrorAtTheOneThatNeverRunsAsync, PerspectiveDuplicateApplyTests.TheApplyBesideAnExplicitInterfaceApply_NeverRuns_WhateverItReturnsAsync, PerspectiveDuplicateApplyTests.AnInheritedApplyBesideAnExplicitInterfaceApply_IsAnErrorAtThePerspectiveAsync, PerspectiveDuplicateApplyTests.AnExplicitInterfaceApplyAlone_IsNotReportedAsync}

## Diagnostic Message

```text
'{PerspectiveName}' has an explicit interface Apply and another Apply for '{EventType}'. The runner calls the interface's implementation ('{InterfaceName}.Apply'), so '{NeverRuns}' never runs. Keep one Apply per event.
```

`{NeverRuns}` is the method that never runs, as `<return> Apply(<model>, <event>)`, followed by
` (inherited from '<BaseType>')` when it is inherited. For example:

```text
'PermissionProjection' has an explicit interface Apply and another Apply for 'OrderStatusChanged'. The runner calls the interface's implementation ('IPerspectiveFor<Order, OrderPlaced, OrderStatusChanged>.Apply'), so 'ModelAction Apply(Order, OrderStatusChanged)' never runs. Keep one Apply per event.
```

## Common Causes

1. **A purge or delete written as a bare `ModelAction` return** for an event `IPerspectiveFor` lists. The compiler
   demands a `TModel Apply` for the event, and an explicit one is added to satisfy it. The `ModelAction` method is also
   reported as [WHIZ115](whiz115).
2. **A refactor** that turned an explicit implementation into an ordinary method and left the old one behind.
3. **A base class** that already declares an `Apply` for an event the derived perspective implements explicitly.

## How to Fix

Keep exactly one `Apply` per event, returning what the interface that lists the event declares.

- **The event may delete or purge the row.** List it under `IPerspectiveWithActionsFor<TModel, ...>` and return
  `ApplyResult<TModel>`. `ApplyResult<TModel>` converts implicitly from `ModelAction`, so `return ModelAction.Purge;`
  stays one line. Remove the explicit implementation.
- **The event only updates the row.** Keep one `TModel Apply`, ordinary or explicit, and remove the other.

### Before (causes WHIZ114)

```csharp{title="Two Apply methods for one event (causes WHIZ114)" description="The runner calls the explicit Order Apply, so the ModelAction Apply beside it never runs and the row is never purged" framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "Apply", "WHIZ114"] tests=["PerspectiveDuplicateApplyTests.TheApplyBesideAnExplicitInterfaceApply_IsAnErrorAtTheOneThatNeverRunsAsync"]}
using Whizbang.Core;
using Whizbang.Core.Perspectives;

public class PermissionProjection : IPerspectiveFor<Order, OrderPlaced, OrderStatusChanged> {
  public Order Apply(Order current, OrderPlaced @event) => current;

  // WHIZ114: never runs, because the runner calls the explicit implementation below
  // WHIZ115: IPerspectiveFor declares Order, not ModelAction
  public ModelAction Apply(Order current, OrderStatusChanged @event) => ModelAction.Purge;

  // The interface's implementation: this is the Apply the runner calls, and it keeps the row
  Order IPerspectiveFor<Order, OrderPlaced, OrderStatusChanged>.Apply(Order current, OrderStatusChanged @event) => current;
}
```

### After (no diagnostic)

```csharp{title="One Apply per event, each returning its interface's shape" description="OrderStatusChanged moves to IPerspectiveWithActionsFor and returns ApplyResult, so return ModelAction.Purge converts implicitly and no explicit implementation is needed" framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "Apply", "WHIZ114"] tests=["PerspectiveRunnerInterfaceDispatchTests.EachEvent_IsAppliedThroughTheInterfaceThatListsItAsync", "PerspectiveDuplicateApplyTests.AnExplicitInterfaceApplyAlone_IsNotReportedAsync"]}
public class PermissionProjection :
    IPerspectiveFor<Order, OrderPlaced>,
    IPerspectiveWithActionsFor<Order, OrderStatusChanged> {
  public Order Apply(Order current, OrderPlaced @event) => current;

  public ApplyResult<Order> Apply(Order current, OrderStatusChanged @event) => ModelAction.Purge;
}
```

A perspective that prefers explicit implementations can implement every `Apply` explicitly; the runner calls each one
through its interface.

{verified: ExplicitApplyRunnerTests.APerspectiveThatImplementsApplyOnlyExplicitly_IsRunThroughItsInterfacesAsync, PerspectiveRunnerInterfaceDispatchTests.APerspectiveThatImplementsApplyOnlyExplicitly_GeneratesARunnerThatCompilesAsync}

## If the Diagnostic Is Suppressed

The runner runs the explicit implementation, the interface's own, and never the other `Apply`. A unit test that calls
the other `Apply` directly then tests a method production never runs.

## Related

- [Perspectives: the interfaces are the contract](../../fundamentals/perspectives/perspectives#strongly-typed-contract)
- [Perspectives with Actions: purging from a perspective that also returns models](../../fundamentals/perspectives/perspectives-with-actions#purge-beside-models)
- [WHIZ115: Apply returns a shape its interface does not declare](whiz115)
- [Error Reference](error-reference)
