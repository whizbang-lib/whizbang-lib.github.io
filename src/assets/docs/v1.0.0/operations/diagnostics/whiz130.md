---
title: 'WHIZ130: Perspective mixes ephemeral and Sourced Apply methods'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning diagnostic when one perspective applies both ephemeral events and ordinary Sourced events, so it is neither
  safely rebuildable from the event log nor purely authoritative state.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - ephemeral
  - perspectives
  - event-sourcing
  - analyzer
codeReferences:
  - src/Whizbang.Generators/EphemeralAnalyzer.cs
  - src/Whizbang.Generators/Utilities/EphemeralResolver.cs
  - src/Whizbang.Core/Attributes/EphemeralAttribute.cs
  - src/Whizbang.Core/Attributes/DangerouslyAllowMixedEphemeralAndSourcedEventsAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/EphemeralAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/EphemeralAnalyzerOptInNameTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ130: Perspective mixes ephemeral and Sourced Apply methods

**Severity**: Warning
**Category**: Ephemeral Events

## Description

A perspective applies at least one **ephemeral** event and at least one **Sourced** (ordinary, event-sourced) event.

An event marked `[Ephemeral]` is a self-destructing trigger rather than a durable fact. A perspective fed by such an
event holds authoritative state: its read model is the source of truth and cannot be rebuilt by replaying a log,
because the ephemeral events are gone. A perspective fed only by Sourced events is the opposite: a cache that can be
rebuilt from the event store at any time. One perspective cannot be both, so mixing the two kinds is flagged.

The analyzer collects every event type the class applies through `IPerspectiveFor<...>` or
`IPerspectiveWithActionsFor<...>` (one interface with several events, or several single-event interfaces) and resolves
each event's mode the same way the source generator does: the event's own `[Ephemeral]`, then its base types, then its
interfaces. An event that is ephemeral only because it implements an interface carrying `[Ephemeral]` (a "profile"
interface) counts as ephemeral.

The perspective is not flagged when all of its events are ephemeral, when all are Sourced, or when the class carries
`[DangerouslyAllowMixedEphemeralAndSourcedEvents]`.

## Diagnostic Message

```
Perspective '{PerspectiveName}' applies both ephemeral event(s) ({EphemeralEvents}) and Sourced event(s) ({SourcedEvents}). A perspective cannot be both authoritative state (ephemeral) and a rebuildable cache (Sourced) — split it, or make the stream homogeneous.
```

## Common Causes

1. **A presence or signal event was added to an existing read model**, for example a "user is typing" ping applied by
   an order perspective.
2. **An event became ephemeral indirectly** because it now implements an interface that carries `[Ephemeral]`.
3. **Two concerns share one model**: durable business state and short-lived activity state.

## How to Fix

- **Split the perspective** into one that applies only the Sourced events (rebuildable) and one that applies only the
  ephemeral events (authoritative).
- **Make the stream homogeneous**: if the event should be durable, remove `[Ephemeral]` from it (or from the profile it
  inherits from); if the other events are really transient signals, mark them ephemeral too.
- **Accept the mix deliberately** with `[DangerouslyAllowMixedEphemeralAndSourcedEvents]` on the perspective class.
  This states that the perspective cannot be safely rebuilt from a log and that its ephemeral inputs self-destruct. It
  is matched by name, and it is the intended escape hatch for teams whose policy forbids `#pragma` and `.editorconfig`
  suppressions.

### Before (causes WHIZ130)

```csharp{title="Perspective mixing ephemeral and Sourced events" description="A perspective applying an [Ephemeral] event and a plain event reports WHIZ130." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["ephemeral", "perspectives", "WHIZ130"] testFile="EphemeralAnalyzerTests.cs" testMethod="PerspectiveMixesEphemeralAndSourcedApply_ReportsWHIZ130WarningAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/EphemeralAnalyzerTests.cs" tests=["EphemeralAnalyzerTests.PerspectiveMixesEphemeralAndSourcedApply_ReportsWHIZ130WarningAsync"]}
using Whizbang.Core;
using Whizbang.Core.Attributes;
using Whizbang.Core.Perspectives;

namespace TestApp;

public class Model { public System.Guid Id { get; set; } }

[Ephemeral]
public record PresencePing : IEvent;
public record OrderPlaced : IEvent;

public class MixedProjection  // WHIZ130
  : IPerspectiveFor<Model, PresencePing>, IPerspectiveFor<Model, OrderPlaced> {
  public Model Apply(Model current, PresencePing e) => current;
  public Model Apply(Model current, OrderPlaced e) => current;
}
```

### After (no diagnostic)

Split into perspectives of one mode each. A perspective whose events are all ephemeral is not flagged:

```csharp{title="Perspective applying only ephemeral events" description="Every applied event is ephemeral, so the perspective is homogeneous and WHIZ130 is not reported." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["ephemeral", "perspectives", "WHIZ130"] testFile="EphemeralAnalyzerTests.cs" testMethod="PerspectiveAllEphemeralApply_NoWHIZ130Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/EphemeralAnalyzerTests.cs" tests=["EphemeralAnalyzerTests.PerspectiveAllEphemeralApply_NoWHIZ130Async"]}
[Ephemeral]
public record PresenceGone : IEvent;

public class PresenceProjection
  : IPerspectiveFor<Model, PresencePing>, IPerspectiveFor<Model, PresenceGone> {
  public Model Apply(Model current, PresencePing e) => current;
  public Model Apply(Model current, PresenceGone e) => current;
}
```

Or keep the mix and say so explicitly:

```csharp{title="Deliberate mixed-mode perspective" description="The opt-in attribute silences WHIZ130 for a perspective that mixes modes on purpose." framework="NET10" category="Diagnostics" difficulty="ADVANCED" tags=["ephemeral", "perspectives", "opt-in", "WHIZ130"] testFile="EphemeralAnalyzerTests.cs" testMethod="MixedPerspectiveWithDangerousOptIn_NoWHIZ130Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/EphemeralAnalyzerTests.cs" tests=["EphemeralAnalyzerTests.MixedPerspectiveWithDangerousOptIn_NoWHIZ130Async"]}
[DangerouslyAllowMixedEphemeralAndSourcedEvents]
public class DeliberatelyMixedProjection
  : IPerspectiveFor<Model, PresencePing>, IPerspectiveFor<Model, OrderPlaced> {
  public Model Apply(Model current, PresencePing e) => current;
  public Model Apply(Model current, OrderPlaced e) => current;
}
```

## Suppressing

```csharp{title="Suppress WHIZ130 for one perspective" description="Disables WHIZ130 around one perspective declaration." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["suppression", "pragma", "WHIZ130"] unverified="suppression syntax, not exercised by a test"}
#pragma warning disable WHIZ130
public class MixedProjection
  : IPerspectiveFor<Model, PresencePing>, IPerspectiveFor<Model, OrderPlaced> {
  // ...
}
#pragma warning restore WHIZ130
```

```ini{title="Disable WHIZ130 in .editorconfig" description="Turns WHIZ130 off for every C# file the section matches." category="Diagnostics" difficulty="BEGINNER" tags=["suppression", "editorconfig", "WHIZ130"] unverified="suppression/config, not exercised by a test"}
[*.cs]
dotnet_diagnostic.WHIZ130.severity = none
```

Prefer `[DangerouslyAllowMixedEphemeralAndSourcedEvents]` over either: it records the decision on the perspective
itself, where a reviewer sees it, and it survives a warnings-as-errors policy that bans suppressions. Turning the rule
off project-wide hides every future mix, not just the one you reviewed. To make mixing a build failure instead, set the
severity to `error`.

## Related

- [WHIZ134: Ambiguous ephemeral composition](whiz134)
- [Perspectives](../../fundamentals/perspectives/perspectives)
- [Perspective Rebuild](../../fundamentals/perspectives/rebuild)
- [Snapshots](../../fundamentals/perspectives/snapshots)
