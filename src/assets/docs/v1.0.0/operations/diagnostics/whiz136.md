---
title: 'WHIZ136: Superseding event type has more than one key'
pageType: troubleshooting
description: >-
  Error diagnostic when a superseding event type marks more than one property [SupersedingKey], on itself or its base
  types. The key decides which older event a newer one replaces, so it must be one property.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - superseding
  - events
  - analyzer
codeReferences:
  - src/Whizbang.Generators/SupersedingEventAnalyzer.cs
  - src/Whizbang.Generators/Utilities/SupersedingResolver.cs
  - src/Whizbang.Core/Attributes/SupersedingKeyAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/SupersedingEventAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/MessageTypeCatalogGeneratorTests.cs
---

# WHIZ136: Superseding event type has more than one key

**Severity**: Error
**Category**: Superseding Events

## Description

A superseding event replaces the older events of the same stream, type and key
([the key](../../fundamentals/events/superseding-events.md#the-key)). The key is one property marked
`[SupersedingKey]`. WHIZ136 is reported when a superseding type has two or more: on itself, on its base types, or one
on each. A record's primary-constructor parameter and the property it declares count once.

{verified: SupersedingEventAnalyzerTests.TwoKeys_ReportsWHIZ136Error_NamingBothAsync, SupersedingEventAnalyzerTests.AKeyOnTheBase_AndAnotherOnTheDerivedType_ReportsWHIZ136Async, SupersedingEventAnalyzerTests.AParameterKeyAndItsOwnProperty_CountOnce_NoWHIZ136Async}

| Choice | Reason | Verified |
|---|---|---|
| An error, not a warning. | With two keys the generator cannot tell which one decides what is superseded. | {verified: SupersedingEventAnalyzerTests.TwoKeys_ReportsWHIZ136Error_NamingBothAsync} |
| If the error is suppressed, the type is not registered as superseding, so every event of it is kept. | Reaping by a guessed key could delete an event that is still the newest of its real key; keeping events is the recoverable direction. | {verified: MessageTypeCatalogGeneratorTests.Generator_ASupersedingTypeAnAnalyzerRefuses_IsNotRegistered_SoEveryEventIsKeptAsync} |
| Keys on a type that is not superseding are not reported. | The attribute is read only for superseding types. | {verified: SupersedingEventAnalyzerTests.AParameterKeyAndItsOwnProperty_CountOnce_NoWHIZ136Async} |

## Diagnostic Message

```
Superseding event type '{TypeName}' marks more than one property [SupersedingKey] ({Properties}). A superseding event has one key: keep the attribute on one property, or combine the parts into one key property.
```

## How to Fix

- **Keep one key property.** If the state really is per pair of values, add one property that combines them (for
  example `$"{Owner}:{Model}"`) and mark that one.

### Before (causes WHIZ136)

```csharp{title="Two key properties" description="The key is ambiguous." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["superseding", "key", "WHIZ136"] tests=["SupersedingEventAnalyzerTests.TwoKeys_ReportsWHIZ136Error_NamingBothAsync"]}
[Superseding]
public record EmbeddingUpdated([property: SupersedingKey] string Model, [property: SupersedingKey] Guid Owner) : IEvent;  // WHIZ136
```

### After (no diagnostic)

```csharp{title="One key property" description="The model is the key; the owner is the stream." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["superseding", "key", "WHIZ136"] tests=["SupersedingEventAnalyzerTests.SupersedingAlone_OrEphemeralAlone_NoWHIZ135Async"]}
[Superseding]
public record EmbeddingUpdated([property: StreamId] Guid Owner, [property: SupersedingKey] string Model) : IEvent;
```

## Related

- [WHIZ135: Event type is both ephemeral and superseding](whiz135)
- [Superseding Events](../../fundamentals/events/superseding-events)
