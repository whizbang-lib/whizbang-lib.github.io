---
title: 'WHIZ117: Event is listed only by an interface that declares no Apply for it'
pageType: troubleshooting
verifiedAgainstCommit: d13ea0d0
verifiedDate: 2026-10-31
description: >-
  Error diagnostic when a perspective lists an event only through IPerspectiveBase or a custom marker interface that
  extends it without declaring an Apply. The event counts as routed, yet no interface-declared Apply handles it.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - perspectives
  - marker-interface
  - strongly-typed-contract
  - analyzer
codeReferences:
  - src/Whizbang.Generators/Analyzers/PerspectiveContractAnalyzer.cs
  - src/Whizbang.Generators/Utilities/PerspectiveContract.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveBase.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectiveMarkerOnlyEventTests.cs
lastMaintainedCommit: 'd13ea0d0'
---

# WHIZ117: Event is listed only by an interface that declares no Apply for it

**Severity**: Error
**Category**: Perspectives (`Whizbang.Perspectives`)

## Description

`IPerspectiveBase<TModel, TEvent...>` is the marker the generators scan to discover a perspective's events.
`IPerspectiveFor`, `IPerspectiveWithActionsFor` and `IGlobalPerspectiveFor` each declare an `Apply` for every event
they list; the marker declares none. A custom interface that extends `IPerspectiveBase` without declaring an `Apply`
is a marker too.

An event a perspective lists **only** through such a marker is counted as routed: it is registered and associated with
the perspective. Yet no interface-declared `Apply` exists for it, so nothing the compiler checks handles the event, and
the [strongly-typed contract](../../fundamentals/perspectives/perspectives#strongly-typed-contract) has a hole.
WHIZ117 reports each such event at the perspective's name.

It is **not** reported for an event that a marker and a declaring interface both list: the declaring interface
supplies the `Apply`.

{verified: PerspectiveMarkerOnlyEventTests.AnEventListedOnlyByAMarkerWithNoApply_IsAnErrorAtThePerspectiveAsync, PerspectiveMarkerOnlyEventTests.AnEventListedByIPerspectiveBaseDirectly_IsAnErrorAsync, PerspectiveMarkerOnlyEventTests.AnEventAMarkerAndADeclaringInterfaceBothList_IsNotReportedAsync}

:::planned
Custom marker interfaces, a custom perspective interface that declares its own strongly-typed `Apply` contract, may be
supported in a future release; see
[whizbang-lib/whizbang#1943](https://github.com/whizbang-lib/whizbang/issues/1943). Until then, every event needs one of
the three interfaces that declare its `Apply`.
:::

## Diagnostic Message

```text
Perspective '{PerspectiveName}' lists '{EventType}' for model '{ModelType}' only through a marker interface that declares no Apply for it, so nothing strongly typed handles the event. List '{EventType}' under IPerspectiveFor<{ModelType}, ...>, IPerspectiveWithActionsFor<{ModelType}, ...> or IGlobalPerspectiveFor<{ModelType}, TPartitionKey, ...>, which declare its Apply. Custom marker interfaces may be supported in a future release.
```

## Common Causes

1. **A custom interface** that extends `IPerspectiveBase` to group a set of events under one name.
2. **`IPerspectiveBase` implemented directly**, although it is hidden from IntelliSense and documented as not for
   direct use.

## How to Fix

List the event under an interface that declares its `Apply`: `IPerspectiveFor` when the `Apply` returns the model,
`IPerspectiveWithActionsFor` when it returns `ApplyResult<TModel>`, or `IGlobalPerspectiveFor` for a multi-stream
perspective. A perspective may implement each family any number of times, so events can still be grouped however reads
best. Remove the marker, or keep it beside the declaring interface if other code uses it.

### Before (causes WHIZ117)

```csharp{title="An event listed only by a custom marker (causes WHIZ117)" description="IOrderMarker extends IPerspectiveBase without declaring Apply, so OrderStatusChanged has no interface-declared Apply" framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "Marker Interface", "WHIZ117"] tests=["PerspectiveMarkerOnlyEventTests.AnEventListedOnlyByAMarkerWithNoApply_IsAnErrorAtThePerspectiveAsync"]}
using Whizbang.Core;
using Whizbang.Core.Perspectives;

public interface IOrderMarker<TModel, TEvent> : IPerspectiveBase<TModel, TEvent>
  where TModel : class
  where TEvent : IEvent;

// WHIZ117: OrderStatusChanged is listed only through IOrderMarker
public class OrderProjection : IPerspectiveFor<Order, OrderPlaced>, IOrderMarker<Order, OrderStatusChanged> {
  public Order Apply(Order current, OrderPlaced @event) => current;
}
```

### After (no diagnostic)

```csharp{title="The event listed under IPerspectiveFor" description="IPerspectiveFor declares Apply for OrderStatusChanged, so the event has a strongly-typed handler" framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "Marker Interface", "WHIZ117"] tests=["PerspectiveMarkerOnlyEventTests.AnEventAMarkerAndADeclaringInterfaceBothList_IsNotReportedAsync"]}
public class OrderProjection :
    IPerspectiveFor<Order, OrderPlaced>,
    IPerspectiveFor<Order, OrderStatusChanged> {
  public Order Apply(Order current, OrderPlaced @event) => current;

  public Order Apply(Order current, OrderStatusChanged @event) => current with { Status = @event.Status };
}
```

## If the Diagnostic Is Suppressed

The event stays registered and associated with the perspective, while no interface-declared `Apply` handles it. What
happens to it is outside the contract the compiler checks, so do not rely on it.

## Related

- [Perspectives: the interfaces are the contract](../../fundamentals/perspectives/perspectives#strongly-typed-contract)
- [WHIZ109: Apply handles an event no perspective interface lists](whiz109)
- [WHIZ115: Apply returns a shape its interface does not declare](whiz115)
- [Error Reference](error-reference)
