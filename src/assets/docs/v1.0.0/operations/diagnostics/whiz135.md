---
title: 'WHIZ135: Event type is both ephemeral and superseding'
pageType: troubleshooting
description: >-
  Error diagnostic when an event type is both [Ephemeral] and [Superseding], directly or through a base type or a
  profile interface. An ephemeral event is reaped once consumed and never kept in the log, so nothing can supersede it.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - superseding
  - ephemeral
  - events
  - analyzer
codeReferences:
  - src/Whizbang.Generators/SupersedingEventAnalyzer.cs
  - src/Whizbang.Generators/Utilities/SupersedingResolver.cs
  - src/Whizbang.Generators/Utilities/EphemeralResolver.cs
  - src/Whizbang.Core/Attributes/SupersedingAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/SupersedingEventAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/MessageTypeCatalogGeneratorTests.cs
---

# WHIZ135: Event type is both ephemeral and superseding

**Severity**: Error
**Category**: Superseding Events

## Description

`[Superseding]` keeps the newest event of each key in the durable log and reaps the older ones once they are consumed
([Superseding Events](../../fundamentals/events/superseding-events.md)). `[Ephemeral]` makes an event self-destruct once
consumed, by its own reaper, and never keeps it in the log
([Ephemeral Events](../../fundamentals/events/ephemeral-events.md)). The two contradict each other, so a type may carry
only one.

Both are resolved the way the generator resolves them: `[Superseding]` on the type or a base type, `[Ephemeral]` on the
type, a base type or a profile interface.

{verified: SupersedingEventAnalyzerTests.EphemeralAndSuperseding_ReportsWHIZ135ErrorAsync, SupersedingEventAnalyzerTests.EphemeralByAProfile_AndSupersedingByABase_ReportsWHIZ135Async}

| Choice | Reason | Verified |
|---|---|---|
| An error, not a warning. | There is nothing to accept: the type cannot be both. | {verified: SupersedingEventAnalyzerTests.EphemeralAndSuperseding_ReportsWHIZ135ErrorAsync} |
| If the error is suppressed, the generator registers the type as ephemeral only, never as superseding. | The superseded-event reaper refuses ephemeral rows anyway; registering nothing keeps the behavior of `[Ephemeral]` unchanged. | {verified: MessageTypeCatalogGeneratorTests.Generator_ASupersedingTypeAnAnalyzerRefuses_IsNotRegistered_SoEveryEventIsKeptAsync, SupersedingEventReaperSqlTests.Reap_AnEphemeralRowCarryingTheFlag_IsLeftToTheEphemeralReaperAsync} |

## Diagnostic Message

```
Event type '{TypeName}' is both [Ephemeral] and [Superseding]. An ephemeral event is reaped once consumed and never kept in the durable log, so nothing can supersede it: remove one of the two.
```

## How to Fix

- **Keep `[Ephemeral]`** when the event never needs to survive its consumption (presence, typing indicators).
- **Keep `[Superseding]`** when the newest event of each key must stay in the log (an embedding, a permission
  snapshot), and remove `[Ephemeral]` from the type, its base types or the profile interface it implements.

### Before (causes WHIZ135)

```csharp{title="An event that is both ephemeral and superseding" description="The two declarations contradict each other." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["superseding", "ephemeral", "WHIZ135"] tests=["SupersedingEventAnalyzerTests.EphemeralAndSuperseding_ReportsWHIZ135ErrorAsync"]}
[Ephemeral, Superseding]
public record PresenceReplaced : IEvent;  // WHIZ135
```

### After (no diagnostic)

```csharp{title="Superseding alone" description="The newest event of the stream is kept; the older ones are reaped once consumed." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["superseding", "WHIZ135"] tests=["SupersedingEventAnalyzerTests.SupersedingAlone_OrEphemeralAlone_NoWHIZ135Async"]}
[Superseding]
public record PresenceReplaced : IEvent;
```

## Related

- [WHIZ136: Superseding event type has more than one key](whiz136)
- [Superseding Events](../../fundamentals/events/superseding-events)
- [Ephemeral Events](../../fundamentals/events/ephemeral-events)
