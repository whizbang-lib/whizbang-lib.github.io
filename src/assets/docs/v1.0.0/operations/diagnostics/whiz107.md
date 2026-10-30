---
title: 'WHIZ107: Apply never receives a null model'
pageType: troubleshooting
verifiedAgainstCommit: 34936cf3
verifiedDate: 2026-10-30
description: >-
  Warning diagnostic when a perspective Apply tests its current model for null. The runner never passes a null model,
  so the test is never true; detect a stream's first event with ApplyContext.Current.IsFirstEventInStream instead.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - perspectives
  - apply
  - first-event
  - determinism
  - analyzer
codeReferences:
  - src/Whizbang.Generators/PerspectiveCurrentModelAnalyzer.cs
  - src/Whizbang.Core/Perspectives/ApplyContext.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectiveCurrentModelAnalyzerTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/FirstEventInStreamTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/ApplyContextTests.cs
lastMaintainedCommit: '34936cf3'
---

# WHIZ107: Apply never receives a null model

**Severity**: Warning
**Category**: Perspectives (`Whizbang.Perspectives`)

## Description

The generated perspective runner hands every `Apply` a model: the stored row, or, for a stream with no row, an empty
model it builds (see [What Apply receives when there is no row](../../fundamentals/perspectives/perspectives-with-actions#no-row-contract)).
A test of that model for null is therefore never true, and the branch it guards never runs.

Such a test is usually meant to detect a stream's first event ("no row yet, so this is the create"). It never did, and
row state is the wrong signal anyway: a purge, an eviction, a rebuild or a replay changes the row, so "no row" is true
for events that are not first and false for a first event applied again. The event's position in its stream does not
change, and `ApplyContext.Current.IsFirstEventInStream` reads it.

WHIZ107 is reported at each null test of the **current-model parameter** (the first parameter) inside a method named
`Apply` with two parameters on a perspective class. Every form is reported:

- `current is null` and `current is not null`
- `current == null` and `current != null`
- `null == current` and `null != current`

It is **not** reported for:

- a null test of a property of the model (`current.Name is null`) or of the event;
- a test of the model against something other than null (`current == _blank`, `current is { Name: null }`);
- a method that is not a perspective `Apply`, even one with the same shape.

{verified: PerspectiveCurrentModelAnalyzerTests.AnApplyThatTestsItsCurrentModelForNull_IsWarnedThatItNeverIsAsync, PerspectiveCurrentModelAnalyzerTests.EveryFormOfTheNullCheck_IsWarnedAsync, PerspectiveCurrentModelAnalyzerTests.ANullCheckOfAPropertyOrOfTheEvent_IsNotWarnedAsync, PerspectiveCurrentModelAnalyzerTests.ATestOfTheModelAgainstSomethingOtherThanNull_IsNotWarnedAsync, PerspectiveCurrentModelAnalyzerTests.ANullCheckOutsideAPerspectiveApply_IsNotWarnedAsync}

## Diagnostic Message

```text
Apply method '{MethodName}' tests its current model '{ParameterName}' for null, but the runner never passes a null model: a stream with no row gets an empty one. To detect the stream's first event, use ApplyContext.Current.IsFirstEventInStream.
```

## Common Causes

1. **A create-or-update `Apply`** that builds a new model when `current is null` and updates it otherwise.
2. **A first-seen value** (`CreatedAt`, an opening status) set only when the model is null.
3. **A defensive guard** copied from code written for a store that did pass null.

## How to Fix

Read `ApplyContext.Current.IsFirstEventInStream` where the null test was, and build on the model you are handed. The
fact is decided by the event's position, so every replay of the stream gives the same answer.

### Before (causes WHIZ107)

```csharp{title="Apply tests its current model for null (causes WHIZ107)" description="current is null is never true: the runner passes an empty model for a stream with no row" framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "Perspectives", "Apply", "WHIZ107"] tests=["PerspectiveCurrentModelAnalyzerTests.AnApplyThatTestsItsCurrentModelForNull_IsWarnedThatItNeverIsAsync"]}
using System;
using Whizbang.Core;
using Whizbang.Core.Perspectives;

public record Order {
  [StreamId] public Guid Id { get; init; }
  public DateTimeOffset CreatedAt { get; init; }
}

public record OrderPlaced : IEvent {
  [StreamId] public Guid OrderId { get; init; }
  public DateTimeOffset At { get; init; }
}

public class OrderPerspective : IPerspectiveFor<Order, OrderPlaced> {
  // WHIZ107: current is never null, so CreatedAt is never set
  public Order Apply(Order current, OrderPlaced @event) =>
    current is null ? new Order { Id = @event.OrderId, CreatedAt = @event.At } : current;
}
```

### After (no diagnostic)

```csharp{title="Apply reads the first-event fact" description="ApplyContext.Current.IsFirstEventInStream is true for the event at the stream's first position, on every replay" framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["Diagnostics", "Perspectives", "Apply", "WHIZ107"] tests=["FirstEventInStreamTests.TheEventThatOpensAStream_IsTheFirstEventInStreamAsync", "FirstEventInStreamTests.ARewind_ReproducesTheFirstEventFactAsync"]}
public class OrderPerspective : IPerspectiveFor<Order, OrderPlaced> {
  public Order Apply(Order current, OrderPlaced @event) =>
    ApplyContext.Current.IsFirstEventInStream
      ? current with { Id = @event.OrderId, CreatedAt = @event.At }
      : current;
}
```

A unit test that calls the `Apply` directly sets the fact with `ApplyContext.Enter(isFirstEventInStream: true)` and
passes an empty model instead of `null`; see
[Detecting a stream's first event](../../fundamentals/perspectives/perspectives-with-actions#first-event-in-stream).

{verified: ApplyContextTests.Enter_MakesTheFactCurrentUntilTheScopeIsDisposedAsync}

If an event must not create a row at all, return `ApplyResult<TModel>.None()` from an
[`IPerspectiveWithActionsFor`](../../fundamentals/perspectives/perspectives-with-actions) `Apply` instead of testing
for null.

## Related

- [Perspectives with Actions: What Apply receives when there is no row](../../fundamentals/perspectives/perspectives-with-actions#no-row-contract)
- [WHIZ108: An overwrite-only perspective's Apply must not read its current model](whiz108)
- [Perspectives: Purity Enforcement](../../fundamentals/perspectives/perspectives#purity-enforcement)
- [Error Reference](error-reference)
