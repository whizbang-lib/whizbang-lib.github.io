---
title: 'WHIZ113: Method looks like a misspelled Apply'
pageType: troubleshooting
verifiedAgainstCommit: d13ea0d0
verifiedDate: 2026-10-31
description: >-
  Error diagnostic when a perspective has a method with an Apply's parameters and return, a name one slip away from
  Apply, and nothing in the perspective calls it. The runner calls only Apply methods its interfaces declare, so the
  misspelled handler compiles and never runs.
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
  - src/Whizbang.Generators/Analyzers/PerspectiveApplyNearMissAnalyzer.cs
  - src/Whizbang.Generators/Utilities/PerspectiveContract.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectiveApplyNearMissTests.cs
lastMaintainedCommit: 'd13ea0d0'
---

# WHIZ113: Method looks like a misspelled Apply

**Severity**: Error
**Category**: Perspectives (`Whizbang.Perspectives`)

## Description

The generated runner calls only the `Apply` methods a perspective's interfaces declare. It never routes an event by a
method's name (see [the interfaces are the contract](../../fundamentals/perspectives/perspectives#strongly-typed-contract)),
so a handler named `Aply`, `ApplyEvent` or `OnApply` compiles and is never called.

WHIZ113 reports such a method at its name. The rule is deliberately narrow, so that an ordinary helper never trips it.
A method is reported only when **all** of these hold:

1. **Its name is one slip away from `Apply`.** Ignoring case, the name is within one edit of `Apply` (one letter
   inserted, removed or replaced, or two adjacent letters swapped), or it starts with `Apply` or `Applie`, or it ends
   with `Apply`. A method named exactly `Apply` is never a near miss.
2. **It has an `Apply`'s signature.** It is an instance method taking two parameters, one of the perspective's models
   and then an event, and it returns what an `Apply` returns: the model (nullable or not), `ApplyResult<TModel>`,
   `ModelAction` or `(TModel?, ModelAction)`. Its accessibility does not matter.
3. **It is not a contract.** It implements no interface member and overrides nothing. (An `abstract` or `virtual`
   declaration on a base perspective is reported at the declaration; its overrides are not reported again.)
4. **Nothing in the perspective calls it.** A method the perspective's own code calls, or takes as a method group, is a
   helper an `Apply` delegates to, not a lost handler. **These methods are skipped.**

Global (multi-stream) perspectives are checked against their own model. Classes that are not perspectives are never
checked.

### The name rule, case by case {#name-rule}

| Name | Reported | Why |
|---|---|---|
| `Aply`, `Appy` | Yes | one letter removed |
| `Aoply`, `Applu` | Yes | one letter replaced |
| `Aplpy` | Yes | two adjacent letters swapped |
| `apply`, `APPLY` | Yes | case is ignored |
| `Apply_`, `Apply1`, `ApplyEvent`, `ApplyingDiscount`, `Apply_Status` | Yes | starts with `Apply` |
| `Applied`, `Applies` | Yes | starts with `Applie` |
| `OnApply`, `TryApply` | Yes | ends with `Apply` |
| `Supply`, `Reply`, `Copy`, `Append`, `Application`, `Aplxy`, `Aplpx` | No | two or more edits away, and no `Apply` prefix or suffix |
| `Handle`, `When`, `Project`, `Transform`, `Evolve`, `Update` | No | unrelated names |

{verified: PerspectiveApplyNearMissTests.AMisspelledApplyThatNothingCalls_IsAnErrorAtTheMethodAsync, PerspectiveApplyNearMissTests.TheNameRule_DecidesExactlyTheseNamesAsync, PerspectiveApplyNearMissTests.ALegitimateName_IsNotReportedAsync, PerspectiveApplyNearMissTests.EveryApplyReturnShape_AndAnyAccessibility_IsCoveredAsync, PerspectiveApplyNearMissTests.AMethodWithoutAnApplysSignature_IsNotReported_WhateverItsNameAsync, PerspectiveApplyNearMissTests.AHelperTheApplyCalls_IsNotReportedAsync, PerspectiveApplyNearMissTests.AHelperReferencedAsAMethodGroup_IsNotReportedAsync, PerspectiveApplyNearMissTests.AMethodThatImplementsOrOverridesAContract_IsNotReportedAsync, PerspectiveApplyNearMissTests.AClassThatIsNotAPerspective_IsNotReportedAsync, PerspectiveApplyNearMissTests.AGlobalPerspective_IsCheckedAgainstItsModelAsync}

## Diagnostic Message

```text
Method '{MethodName}' on perspective '{PerspectiveName}' has the signature of an Apply for '{EventType}', but it is not named Apply and nothing calls it, so it never runs. Rename it to Apply and list '{EventType}' under a perspective interface, or call it from an Apply.
```

## Common Causes

1. **A typo** in the method name (`Aply`, `Appyl`).
2. **A naming convention from another framework**, such as `ApplyEvent`, `OnApply` or `Applied`.
3. **A helper whose caller was removed**, leaving a method that looks like a handler and is reached by nothing.

## How to Fix

Decide what the method is meant to be.

- **A handler.** Rename it to `Apply` and make sure an interface on the perspective lists its event; otherwise the
  renamed method is reported as [WHIZ109](whiz109).
- **A helper.** Call it from the `Apply` that handles the event. A helper the perspective calls is not reported,
  whatever its name.
- **Neither.** Remove it.

### Before (causes WHIZ113)

```csharp{title="A misspelled Apply that nothing calls (causes WHIZ113)" description="ApplyEvent has an Apply's signature but is not named Apply, so the runner never calls it" framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "Perspectives", "Apply", "WHIZ113"] tests=["PerspectiveApplyNearMissTests.AMisspelledApplyThatNothingCalls_IsAnErrorAtTheMethodAsync"]}
using Whizbang.Core;
using Whizbang.Core.Perspectives;

public class OrderProjection : IPerspectiveFor<Order, OrderPlaced> {
  public Order Apply(Order current, OrderPlaced @event) => current with { Id = @event.OrderId };

  // WHIZ113: named ApplyEvent, so it never runs
  public Order ApplyEvent(Order current, OrderStatusChanged @event) => current with { Status = @event.Status };
}
```

### After: a handler (no diagnostic)

```csharp{title="Renamed to Apply and listed" description="The method is named Apply and OrderStatusChanged is listed under IPerspectiveFor, so the runner routes the event to it" framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "Perspectives", "Apply", "WHIZ113"] tests=["PerspectiveApplyNearMissTests.ALegitimateName_IsNotReportedAsync", "PerspectiveUnlistedApplyTests.AnApplyForAListedEvent_IsNotReported_WhicheverInterfaceListsItAsync"]}
public class OrderProjection : IPerspectiveFor<Order, OrderPlaced, OrderStatusChanged> {
  public Order Apply(Order current, OrderPlaced @event) => current with { Id = @event.OrderId };

  public Order Apply(Order current, OrderStatusChanged @event) => current with { Status = @event.Status };
}
```

### After: a helper (no diagnostic)

```csharp{title="A near-miss name the Apply calls" description="ApplyStatus is called by the Apply for OrderStatusChanged, so it is a helper and is skipped" framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "Perspectives", "Apply", "WHIZ113"] tests=["PerspectiveApplyNearMissTests.AHelperTheApplyCalls_IsNotReportedAsync"]}
public class OrderProjection : IPerspectiveFor<Order, OrderStatusChanged> {
  public Order Apply(Order current, OrderStatusChanged @event) => ApplyStatus(current, @event);

  private Order ApplyStatus(Order current, OrderStatusChanged @event) => current with { Status = @event.Status };
}
```

## If the Diagnostic Is Suppressed

Nothing at run time catches it. The method is never called by the runner; whatever it was meant to project is
missing from the row.

## Related

- [Perspectives: the interfaces are the contract](../../fundamentals/perspectives/perspectives#strongly-typed-contract)
- [WHIZ109: Apply handles an event no perspective interface lists](whiz109)
- [Error Reference](error-reference)
