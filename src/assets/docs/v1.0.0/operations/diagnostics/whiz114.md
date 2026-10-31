---
title: 'WHIZ114: Explicit interface Apply never runs'
pageType: troubleshooting
verifiedAgainstCommit: d13ea0d0
verifiedDate: 2026-10-31
description: >-
  Error diagnostic when a perspective implements a perspective interface's Apply explicitly and also declares an
  ordinary Apply with the same parameters. Two methods claim one event, and only one of them is ever the handler.
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
  - tests/Whizbang.Generators.Tests/PerspectiveDecoyApplyTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveRunnerInterfaceDispatchTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/ExplicitApplyRunnerTests.cs
lastMaintainedCommit: 'd13ea0d0'
---

# WHIZ114: Explicit interface Apply never runs

**Severity**: Error
**Category**: Perspectives (`Whizbang.Perspectives`)

## Description

A perspective declares an ordinary `Apply` for an event **and** an explicit interface implementation of `Apply`
(`TModel IPerspectiveFor<TModel, TEvent>.Apply(...)`) with the same parameters. Two methods now claim one event, and
which one runs depends on how it is called:

- the generated runner and the [typed appliers](../../fundamentals/perspectives/typed-associations) call `Apply`
  **through the interface that lists the event**, so they run the explicit implementation;
- code that calls `perspective.Apply(model, @event)` on the class, a unit test for example, binds the ordinary method.

One of the two is a decoy that satisfies the compiler and does not do what production does. The pattern usually
appears as an ordinary `Apply` returning a shape its interface does not declare (a bare `ModelAction` to purge the row)
beside an explicit `TModel Apply` added only so that the class compiles, which keeps the row the ordinary one meant to
purge. Earlier versions of the runner called the ordinary method by name, so the explicit one never ran, which is what
the diagnostic's title and message describe. Either way, the class says two different things about one event, and the
build now rejects it.

WHIZ114 is reported at the explicit implementation, whatever either method returns, and also when the ordinary
`Apply` is inherited from a base class. An explicit implementation with no ordinary counterpart is the interface's own
implementation and is not reported: a perspective may implement every `Apply` explicitly.

{verified: PerspectiveDecoyApplyTests.AnExplicitApplyHiddenByAnOrdinaryApply_IsAnErrorAtTheExplicitOneAsync, PerspectiveDecoyApplyTests.AnExplicitApplyHiddenByAnOrdinaryApplyWithTheSameReturn_IsStillADecoyAsync, PerspectiveDecoyApplyTests.AnExplicitApplyHiddenByAnInheritedOrdinaryApply_IsADecoyAsync, PerspectiveDecoyApplyTests.AnExplicitImplementationWithNoOrdinaryCounterpart_IsNotADecoyAsync}

## Diagnostic Message

```text
The explicit implementation of {InterfaceName}.Apply for '{EventType}' on perspective '{PerspectiveName}' never runs: the runner calls the perspective's own Apply for '{EventType}', which returns '{ReturnType}'. Keep one Apply per event, returning what the interface declares, and remove the explicit implementation.
```

## Common Causes

1. **A purge or delete written as a bare `ModelAction` return** for an event `IPerspectiveFor` lists. The compiler
   demands a `TModel Apply` for the event, and an explicit one is added to satisfy it. The ordinary `Apply` is also
   reported as [WHIZ115](whiz115).
2. **A refactor** that turned an explicit implementation into an ordinary method and left the old one behind.
3. **A base class** that already declares an ordinary `Apply` for an event the derived perspective implements
   explicitly.

## How to Fix

Keep exactly one `Apply` per event, returning what the interface that lists the event declares.

- **The event may delete or purge the row.** List it under `IPerspectiveWithActionsFor<TModel, ...>` and return
  `ApplyResult<TModel>`. `ApplyResult<TModel>` converts implicitly from `ModelAction`, so `return ModelAction.Purge;`
  stays one line. Remove the explicit implementation.
- **The event only updates the row.** Keep one `TModel Apply`, ordinary or explicit, and remove the other.

### Before (causes WHIZ114)

```csharp{title="An explicit Apply beside an ordinary one (causes WHIZ114)" description="The explicit TModel Apply exists only so the class compiles beside an Apply that returns a bare ModelAction" framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "Apply", "WHIZ114"] tests=["PerspectiveDecoyApplyTests.AnExplicitApplyHiddenByAnOrdinaryApply_IsAnErrorAtTheExplicitOneAsync"]}
using Whizbang.Core;
using Whizbang.Core.Perspectives;

public class PermissionProjection : IPerspectiveFor<Order, OrderPlaced, OrderStatusChanged> {
  public Order Apply(Order current, OrderPlaced @event) => current;

  // WHIZ115: IPerspectiveFor declares Order, not ModelAction
  public ModelAction Apply(Order current, OrderStatusChanged @event) => ModelAction.Purge;

  // WHIZ114: a second Apply for OrderStatusChanged, which keeps the row the one above purges
  Order IPerspectiveFor<Order, OrderPlaced, OrderStatusChanged>.Apply(Order current, OrderStatusChanged @event) => current;
}
```

### After (no diagnostic)

```csharp{title="One Apply per event, each returning its interface's shape" description="OrderStatusChanged moves to IPerspectiveWithActionsFor and returns ApplyResult, so return ModelAction.Purge converts implicitly and no explicit implementation is needed" framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "Apply", "WHIZ114"] tests=["PerspectiveRunnerInterfaceDispatchTests.EachEvent_IsAppliedThroughTheInterfaceThatListsItAsync", "PerspectiveDecoyApplyTests.AnExplicitImplementationWithNoOrdinaryCounterpart_IsNotADecoyAsync"]}
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

The runner runs the explicit implementation, the interface's own, and never the ordinary `Apply`. A unit test that
calls the ordinary `Apply` directly then tests a method production never runs.

## Related

- [Perspectives: the interfaces are the contract](../../fundamentals/perspectives/perspectives#strongly-typed-contract)
- [Perspectives with Actions: purging from a perspective that also returns models](../../fundamentals/perspectives/perspectives-with-actions#purge-beside-models)
- [WHIZ115: Apply returns a shape its interface does not declare](whiz115)
- [Error Reference](error-reference)
