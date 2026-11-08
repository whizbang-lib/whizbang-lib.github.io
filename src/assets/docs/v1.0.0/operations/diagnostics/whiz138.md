---
title: "WHIZ138: Superseding group's types disagree on their key"
pageType: troubleshooting
description: >-
  Error diagnostic when the event types of one superseding group disagree on their key: some declare a
  [SupersedingKey] and some do not, or their keys are of different types.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - superseding
  - analyzer
codeReferences:
  - src/Whizbang.Generators/SupersedingEventAnalyzer.cs
  - src/Whizbang.Core/Attributes/SupersedingAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/SupersedingEventAnalyzerTests.cs
---

# WHIZ138: Superseding group's types disagree on their key

**Severity**: Error
**Category**: Superseding Events

## Description

In a [superseding group](../../fundamentals/events/superseding-events#superseding-groups) the newest event of any type
replaces the older events of every type in the group with the same key. The key must therefore mean the same thing for
each type: every type in the group has no `[SupersedingKey]`, or every type has a key of the same type. WHIZ138 is
reported on each type of a group whose key disagrees with the others. A key of a nullable value type (`Guid?`) agrees with
the same type's key (`Guid`), since both are stored as the same text.
{verified: SupersedingEventAnalyzerTests.AGroupWhoseTypesDisagreeOnTheKey_ReportsWHIZ138OnEachAsync, SupersedingEventAnalyzerTests.AGroupWhoseTypesAgree_OrTypesOutsideAnyGroup_NoWHIZ138Async}

The check covers the types of one compilation. Types in other assemblies that use the same group name are not compared.

## Diagnostic Message

```
Superseding event type '{Type}' is in group '{Group}' with {its key}, but other types in the group have {their key}. The types of a group supersede each other by key: give every one no [SupersedingKey], or a key of the same type.
```

## How to Fix

### Before (causes WHIZ138)

```csharp{title="A group whose types disagree on the key" description="One type is keyed by region, the other has no key." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["superseding", "WHIZ138"] tests=["SupersedingEventAnalyzerTests.AGroupWhoseTypesDisagreeOnTheKey_ReportsWHIZ138OnEachAsync"]}
[Superseding(Group = "price")]
public sealed record PriceSet([property: StreamId] Guid ProductId, [property: SupersedingKey] Guid RegionId, decimal Price) : IEvent;  // WHIZ138

[Superseding(Group = "price")]
public sealed record PriceReset([property: StreamId] Guid ProductId, decimal Price) : IEvent;  // WHIZ138
```

### After (no diagnostic)

```csharp{title="A group whose types agree on the key" description="Both types are keyed by region." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["superseding", "WHIZ138"] tests=["SupersedingEventAnalyzerTests.AGroupWhoseTypesAgree_OrTypesOutsideAnyGroup_NoWHIZ138Async"]}
[Superseding(Group = "price")]
public sealed record PriceSet([property: StreamId] Guid ProductId, [property: SupersedingKey] Guid RegionId, decimal Price) : IEvent;

[Superseding(Group = "price")]
public sealed record PriceReset([property: StreamId] Guid ProductId, [property: SupersedingKey] Guid RegionId, decimal Price) : IEvent;
```

## Related

- [Superseding events: superseding groups](../../fundamentals/events/superseding-events#superseding-groups)
- [WHIZ135: Event type is both ephemeral and superseding](whiz135)
- [WHIZ136: Superseding event type has more than one key](whiz136)
