---
title: 'WHIZ132: Receptor turns an ephemeral message into a Sourced event'
pageType: troubleshooting
verifiedAgainstCommit: e70630af
verifiedDate: 2026-10-21
description: >-
  Warning diagnostic when a receptor handles an ephemeral message and returns or cascades an ordinary Sourced event,
  which turns data declared not to be kept into a durable fact in the event store.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - ephemeral
  - receptors
  - event-sourcing
  - analyzer
codeReferences:
  - src/Whizbang.Generators/EphemeralAnalyzer.cs
  - src/Whizbang.Generators/Utilities/EphemeralResolver.cs
  - src/Whizbang.Core/Attributes/EphemeralAttribute.cs
  - src/Whizbang.Core/Attributes/DangerouslyAllowSourcedEventsFromEphemeralInputAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/EphemeralLaunderingAnalyzerTests.cs
lastMaintainedCommit: 'e70630af'
---

# WHIZ132: Receptor turns an ephemeral message into a Sourced event

**Severity**: Warning
**Category**: Ephemeral Events

## Description

A receptor's input message is **ephemeral**, and its response returns or cascades at least one **Sourced** (ordinary,
event-sourced) event.

An event is marked `[Ephemeral]` because what it carries must not be kept: presence, typing indicators, or other
short-lived data. The ephemeral event self-destructs once it is consumed, but an event the receptor returns is
cascaded into the event store. If that event is Sourced, what the ephemeral message carried is now a durable fact
that is never reaped, which defeats the reason it was declared ephemeral. This is sometimes called laundering.

The rule is deliberately simple: any Sourced event in the response is reported, whether or not it copies data from
the input. Both `IReceptor<TMessage, TResponse>` and `ISyncReceptor<TMessage, TResponse>` are checked, and the
response is unwrapped the way the cascade unwraps it: tuples (nested ones too), arrays, collections such as
`List<T>` and `IEnumerable<T>`, `Routed<T>` and nullable values. A receptor that handles several ephemeral messages
gets one diagnostic for each. Message and event modes are resolved the same way as for [WHIZ130](whiz130): the type's
own `[Ephemeral]`, then its base types, then the profile interfaces it implements.
{verified: EphemeralLaunderingAnalyzerTests.EphemeralInput_ReturningASourcedEvent_ReportsWHIZ132WarningAsync, EphemeralLaunderingAnalyzerTests.SyncReceptor_ReturningASourcedEvent_ReportsWHIZ132Async, EphemeralLaunderingAnalyzerTests.CascadedShapes_TupleArrayListAndRouted_ReportOnlyTheSourcedEventsAsync, EphemeralLaunderingAnalyzerTests.EphemeralInputViaAProfileInterface_ReportsWHIZ132Async, EphemeralLaunderingAnalyzerTests.OneDiagnosticPerEphemeralInput_OnAReceptorHandlingSeveralAsync}

Nothing is reported when the response holds only ephemeral events, when the input is Sourced, when the receptor
returns nothing, or when the response's events are not known at build time: an interface such as `IEvent`, an
abstract base record or a generic type parameter may stand for either mode, so the analyzer does not guess.
{verified: EphemeralLaunderingAnalyzerTests.ReceptorsThatKeepNothingDurable_NoWHIZ132Async}

There is no runtime check for this rule; the build is the only place it is reported.

## Diagnostic Message

```
Receptor '{ReceptorName}' handles ephemeral message '{MessageType}' and returns or cascades Sourced event(s) ({SourcedEvents}). The ephemeral message self-destructs, but what it carried becomes a durable fact in the event store: return an ephemeral event instead, or mark the receptor [DangerouslyAllowSourcedEventsFromEphemeralInput] if keeping it is deliberate.
```

## Common Causes

1. **A presence or signal handler records a business event**, for example "user is typing" producing an
   "order viewed" event that copies the user and the time.
2. **An event became ephemeral** after the receptor was written, so a receptor that used to be Sourced-to-Sourced now
   launders.
3. **A response type was widened** to a tuple that includes a Sourced event alongside an ephemeral one.

## How to Fix

- **Return an ephemeral event** when the output is just as transient as the input.
- **Keep only what is meant to be durable.** If the Sourced event really is a business fact (an aggregate count, a
  decision), make sure it does not carry the ephemeral data, then accept the receptor explicitly with
  `[DangerouslyAllowSourcedEventsFromEphemeralInput]`. The long name is on purpose: the decision shows up in code
  review, it can be searched for, and it works for teams that treat warnings as errors and do not allow `#pragma` or
  `.editorconfig` suppressions. It is matched by name.

### Before (causes WHIZ132)

```csharp{title="Receptor laundering an ephemeral message" description="A receptor whose input is ephemeral and whose response is a Sourced event reports WHIZ132." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["ephemeral", "receptors", "WHIZ132"] testFile="EphemeralLaunderingAnalyzerTests.cs" testMethod="EphemeralInput_ReturningASourcedEvent_ReportsWHIZ132WarningAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/EphemeralLaunderingAnalyzerTests.cs" tests=["EphemeralLaunderingAnalyzerTests.EphemeralInput_ReturningASourcedEvent_ReportsWHIZ132WarningAsync"]}
[Ephemeral]
public record PresencePing : IEvent;
public record OrderPlaced : IEvent;

public class PresenceToOrder : IReceptor<PresencePing, OrderPlaced> {  // WHIZ132
  public ValueTask<OrderPlaced> HandleAsync(PresencePing message, CancellationToken cancellationToken = default) =>
    new(new OrderPlaced());
}
```

### After (no diagnostic)

Return an ephemeral event:

```csharp{title="Receptor keeping its output ephemeral" description="An ephemeral input producing an ephemeral event keeps nothing durable, so WHIZ132 is not reported." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["ephemeral", "receptors", "WHIZ132"] testFile="EphemeralLaunderingAnalyzerTests.cs" testMethod="ReceptorsThatKeepNothingDurable_NoWHIZ132Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/EphemeralLaunderingAnalyzerTests.cs" tests=["EphemeralLaunderingAnalyzerTests.ReceptorsThatKeepNothingDurable_NoWHIZ132Async"]}
[Ephemeral]
public record PresenceGone : IEvent;

public class EphemeralOut : ISyncReceptor<PresencePing, PresenceGone> {
  public PresenceGone Handle(PresencePing message) => new();
}
```

Or keep the Sourced event deliberately and say so:

```csharp{title="Deliberately producing a Sourced event from an ephemeral message" description="The opt-in attribute silences WHIZ132 on a receptor that keeps a durable fact on purpose." framework="NET10" category="Diagnostics" difficulty="ADVANCED" tags=["ephemeral", "receptors", "opt-in", "WHIZ132"] testFile="EphemeralLaunderingAnalyzerTests.cs" testMethod="DeliberateReceptor_WithTheOptIn_NoWHIZ132Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/EphemeralLaunderingAnalyzerTests.cs" tests=["EphemeralLaunderingAnalyzerTests.DeliberateReceptor_WithTheOptIn_NoWHIZ132Async", "EphemeralLaunderingAnalyzerTests.UnboundOptIn_StillSuppressesWHIZ132AndAnUnrelatedAttributeDoesNotAsync"]}
[DangerouslyAllowSourcedEventsFromEphemeralInput]
public class PresenceToOrder : ISyncReceptor<PresencePing, OrderPlaced> {
  public OrderPlaced Handle(PresencePing message) => new();
}
```

## Suppressing

```csharp{title="Suppress WHIZ132 for one receptor" description="Disables WHIZ132 around one receptor declaration." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["suppression", "pragma", "WHIZ132"] unverified="suppression syntax, not exercised by a test"}
#pragma warning disable WHIZ132
public class PresenceToOrder : ISyncReceptor<PresencePing, OrderPlaced> {
  // ...
}
#pragma warning restore WHIZ132
```

```ini{title="Disable WHIZ132 in .editorconfig" description="Turns WHIZ132 off for every C# file the section matches." category="Diagnostics" difficulty="BEGINNER" tags=["suppression", "editorconfig", "WHIZ132"] unverified="suppression/config, not exercised by a test"}
[*.cs]
dotnet_diagnostic.WHIZ132.severity = none
```

Prefer `[DangerouslyAllowSourcedEventsFromEphemeralInput]` over either: it records the decision on the receptor
itself, where a reviewer sees it. To make laundering a build failure instead, set the severity to `error`.

## Related

- [WHIZ130: Perspective mixes ephemeral and Sourced Apply methods](whiz130)
- [WHIZ131: Rebuild or rewind of an ephemeral-only perspective](whiz131)
- [Ephemeral events](../../fundamentals/events/ephemeral-events)
- [Receptors](../../fundamentals/receptors/receptors)
