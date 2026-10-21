---
title: 'WHIZ131: Rebuild or rewind of an ephemeral-only perspective'
pageType: troubleshooting
verifiedAgainstCommit: e70630af
verifiedDate: 2026-10-21
description: >-
  Error diagnostic when code asks to rebuild or rewind a perspective whose every applied event is ephemeral, so the
  replay has nothing to read and can never do anything.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - ephemeral
  - perspectives
  - rebuild
  - rewind
  - analyzer
codeReferences:
  - src/Whizbang.Generators/EphemeralAnalyzer.cs
  - src/Whizbang.Generators/Utilities/EphemeralResolver.cs
  - src/Whizbang.Core/Attributes/EphemeralAttribute.cs
  - src/Whizbang.Core/Commands/System/SystemCommands.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveRebuilder.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveRunner.cs
testReferences:
  - tests/Whizbang.Generators.Tests/EphemeralRebuildAnalyzerTests.cs
lastMaintainedCommit: 'e70630af'
---

# WHIZ131: Rebuild or rewind of an ephemeral-only perspective

**Severity**: Error
**Category**: Ephemeral Events

## Description

Code asks to rebuild or rewind a perspective, and every event that perspective applies is **ephemeral**.

An ephemeral event self-destructs: once it is consumed its body is reaped. A perspective fed only by ephemeral events
is therefore authoritative state, not a cache that can be rebuilt by replaying the event store. A rebuild or rewind of
it has nothing to replay, and the runtime refuses it: the rebuilder skips every state-based stream and reports that
nothing was rebuilt. The call can never do anything, so it is an error rather than a warning.

Three call sites are checked:

| Call site | Example |
|-----------|---------|
| Constructing `RebuildPerspectiveCommand` | `new RebuildPerspectiveCommand(["MyApp.PresenceProjection"])` |
| A rebuild on `IPerspectiveRebuilder` (or a type implementing it) | `rebuilder.RebuildInPlaceAsync("MyApp.PresenceProjection")` |
| A rewind on `IPerspectiveRunner` | `runner.RewindAndRunAsync(streamId, "MyApp.PresenceProjection", eventId)` |
{verified: EphemeralRebuildAnalyzerTests.RebuildCommand_NamingAnEphemeralOnlyPerspective_ReportsWHIZ131ErrorAsync, EphemeralRebuildAnalyzerTests.RebuilderCalls_NamingAnEphemeralOnlyPerspective_ReportWHIZ131Async, EphemeralRebuildAnalyzerTests.RebuilderImplementation_CalledDirectly_ReportsWHIZ131Async, EphemeralRebuildAnalyzerTests.RewindRequest_AgainstAnEphemeralOnlyPerspective_ReportsWHIZ131Async}

A perspective is named by a string, its CLR type name (`Namespace.Type`, or `Namespace.Outer+Nested` for a nested
type), which is the name the runtime registry matches. The analyzer resolves the forms it can know at build time: a
string literal or constant (an interpolated constant included), `typeof(T).FullName`, and
`TypeNameFormatter.FormatClrTypeName(typeof(T))`. For the command, every name in `PerspectiveNames` is checked, whether
it is passed by position, by name or in an object initializer, as an array or a collection expression. The diagnostic
is reported on the name itself.
{verified: EphemeralRebuildAnalyzerTests.RebuildCommand_ArrayCreationAndConstAndTypeofForms_EachReportWHIZ131Async, EphemeralRebuildAnalyzerTests.RebuildCommand_NamesSetInAnInitializer_ReportsWHIZ131Async, EphemeralRebuildAnalyzerTests.NestedPerspective_NamedWithItsClrName_ReportsWHIZ131Async, EphemeralRebuildAnalyzerTests.RebuildCommand_ReportsAtTheNameNotTheCommandAsync}

Nothing is reported when:

- the perspective mixes ephemeral and Sourced events: [WHIZ130](whiz130) covers that;
- the perspective applies only Sourced events, which rebuild normally;
- the name is only known at run time (a variable, a parameter, `typeof(T).Name`, `nameof(T)`, which is the simple name
  and not the name the registry matches), or it names no perspective. The runtime guard still refuses those.
{verified: EphemeralRebuildAnalyzerTests.MixedAndSourcedPerspectives_NoWHIZ131Async, EphemeralRebuildAnalyzerTests.NamesThatAreNotStaticallyAPerspective_NoWHIZ131Async, EphemeralRebuildAnalyzerTests.CallsThatAreNotARebuildOrRewind_NoWHIZ131Async}

An event's mode is resolved the same way as for WHIZ130: its own `[Ephemeral]`, then its base types, then the profile
interfaces it implements.

## Diagnostic Message

```
This {rebuild|rewind} of perspective '{PerspectiveName}' can never replay anything: every event it applies is ephemeral ({EphemeralEvents}), and ephemeral events self-destruct and have their bodies reaped. The perspective is authoritative state, not a rebuildable cache: remove the {rebuild|rewind}.
```

## Common Causes

1. **A maintenance job rebuilds every perspective by name**, and the list includes a presence or signal perspective.
2. **A perspective's events became ephemeral** after the rebuild call was written, for example because they now
   implement an `[Ephemeral]` profile interface.
3. **A repair script rewinds a stream** of a perspective that keeps short-lived state only.

## How to Fix

- **Remove the call.** The perspective's rows are its source of truth; there is no log to rebuild them from.
- **If the perspective should be rebuildable**, its events should be durable: remove `[Ephemeral]` from them (or from
  the profile they inherit it from).

### Before (causes WHIZ131)

```csharp{title="Rebuilding a perspective fed only by ephemeral events" description="A RebuildPerspectiveCommand naming a perspective whose every event is ephemeral reports WHIZ131 on the name." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["ephemeral", "perspectives", "rebuild", "WHIZ131"] testFile="EphemeralRebuildAnalyzerTests.cs" testMethod="RebuildCommand_NamingAnEphemeralOnlyPerspective_ReportsWHIZ131ErrorAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/EphemeralRebuildAnalyzerTests.cs" tests=["EphemeralRebuildAnalyzerTests.RebuildCommand_NamingAnEphemeralOnlyPerspective_ReportsWHIZ131ErrorAsync"]}
[Ephemeral]
public record PresencePing : IEvent;
[Ephemeral]
public record PresenceGone : IEvent;

public class PresenceProjection
  : IPerspectiveFor<Model, PresencePing>, IPerspectiveFor<Model, PresenceGone> {
  public Model Apply(Model current, PresencePing e) => current;
  public Model Apply(Model current, PresenceGone e) => current;
}

public static class Ops {
  public static RebuildPerspectiveCommand Make() => new(["TestApp.PresenceProjection"]);  // WHIZ131
}
```

### After (no diagnostic)

Rebuild only the perspectives that replay from the log:

```csharp{title="Rebuilding only perspectives that replay from the log" description="Naming a perspective that applies only Sourced events reports nothing." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["ephemeral", "perspectives", "rebuild", "WHIZ131"] testFile="EphemeralRebuildAnalyzerTests.cs" testMethod="MixedAndSourcedPerspectives_NoWHIZ131Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/EphemeralRebuildAnalyzerTests.cs" tests=["EphemeralRebuildAnalyzerTests.MixedAndSourcedPerspectives_NoWHIZ131Async"]}
public record OrderPlaced : IEvent;

public class OrderProjection : IPerspectiveFor<Model, OrderPlaced> {
  public Model Apply(Model current, OrderPlaced e) => current;
}

public static class Ops {
  public static RebuildPerspectiveCommand Make() => new(["TestApp.OrderProjection"]);
}
```

## Suppressing

There is no opt-in attribute: unlike [WHIZ130](whiz130), there is no trade-off to accept, because the call does
nothing. If generated or shared code must keep the call, suppress it where it is made:

```csharp{title="Suppress WHIZ131 at one call site" description="Disables WHIZ131 around one rebuild call." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["suppression", "pragma", "WHIZ131"] unverified="suppression syntax, not exercised by a test"}
#pragma warning disable WHIZ131
await rebuilder.RebuildInPlaceAsync("MyApp.PresenceProjection");
#pragma warning restore WHIZ131
```

## Related

- [WHIZ130: Perspective mixes ephemeral and Sourced Apply methods](whiz130)
- [WHIZ132: Receptor turns an ephemeral message into a Sourced event](whiz132)
- [Ephemeral events](../../fundamentals/events/ephemeral-events)
- [Perspective Rebuild](../../fundamentals/perspectives/rebuild)
