---
title: 'WHIZ139: Read model keeps an allowed mixed-stream pair refused'
pageType: troubleshooting
verifiedAgainstCommit: 2fb623ec
verifiedDate: 2026-11-11
description: >-
  Warning diagnostic when a read model applies an (ephemeral, Sourced) pair that another read model allows to share a
  stream, without opting in itself, so the pair stays refused at run time.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - ephemeral
  - perspectives
  - mixed-streams
  - analyzer
codeReferences:
  - src/Whizbang.Generators/EphemeralAnalyzer.cs
  - src/Whizbang.Generators/Utilities/MixedStreamOptIn.cs
  - src/Whizbang.Core/Attributes/DangerouslyAllowMixedEphemeralAndSourcedEventsAttribute.cs
  - src/Whizbang.Core/Attributes/MixedStreams.cs
  - src/Whizbang.Core/Perspectives/MixedStreamAllowance.cs
testReferences:
  - tests/Whizbang.Generators.Tests/MixedStreamAllowanceGeneratorTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/MixedStreamAllowanceTests.cs
lastMaintainedCommit: '2fb623ec'
---

# WHIZ139: Read model keeps an allowed mixed-stream pair refused

**Severity**: Warning
**Category**: Ephemeral Events

## Description

One read model carries `[DangerouslyAllowMixedEphemeralAndSourcedEvents(Streams = MixedStreams.Allow)]`, which lets the
(ephemeral type, Sourced type) pairs it applies share a stream. Another read model applies one of those pairs too,
without that opt-in.

A pair is allowed only when every read model that applies both of its types opts in. A read model that applies the
ephemeral type refuses to rebuild a stream that holds it, so a read model applying both without opting in would
silently skip the Sourced events of every mixed stream on its next rebuild. One read model's opt-in must never break
another's rebuild, so the pair stays refused at run time: the store keeps refusing to mix it (WHIZ133), and the history
walk keeps counting it as a blocker. This diagnostic names the read model that keeps it so.

The analyzer reports once per such read model and pair, at the read model's declaration, after the whole compilation
is seen. The same rule is applied again at run time over every registered read model, so a read model in another
assembly keeps the pair refused as well, without a diagnostic in this one.

See [Allowing mixed streams](../../fundamentals/events/ephemeral-events#allowing-mixed-streams).

## Diagnostic Message

```
Read model '{ReadModel}' applies ephemeral event '{EphemeralType}' and Sourced event '{SourcedType}' without [DangerouslyAllowMixedEphemeralAndSourcedEvents(Streams = MixedStreams.Allow)], so streams holding both stay refused although '{AllowingReadModel}' allows them. Opt '{ReadModel}' in the same way if its rebuild may skip those streams, or stop applying one of the two.
```

## How to Fix

- **Opt the read model in** with `Streams = MixedStreams.Allow`, when it is fine for its full rebuild of a mixed stream
  to be refused (it then restores from its snapshot floor, as any ephemeral read model does).
- **Stop applying one of the two types** in that read model, for example by splitting it into a Sourced read model and
  an ephemeral one.
- **Drop the allowance** from the other read model, if the pair should not share a stream after all.

```csharp{title="A second read model keeps the pair refused" description="OrderTimeline applies PresencePing and OrderPlaced without Streams = MixedStreams.Allow, so WHIZ139 is reported on it." framework="NET10" category="Diagnostics" difficulty="ADVANCED" tags=["ephemeral", "perspectives", "WHIZ139", "mixed-streams"] testFile="MixedStreamAllowanceGeneratorTests.cs" testMethod="SecondReadModelWithoutAllow_ReportsWHIZ139OnItAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/MixedStreamAllowanceGeneratorTests.cs" tests=["MixedStreamAllowanceGeneratorTests.SecondReadModelWithoutAllow_ReportsWHIZ139OnItAsync"]}
[DangerouslyAllowMixedEphemeralAndSourcedEvents(Streams = MixedStreams.Allow)]
public class PresenceBoard
  : IPerspectiveFor<Model, PresencePing>, IPerspectiveFor<Model, OrderPlaced> {
  public Model Apply(Model current, PresencePing e) => current;
  public Model Apply(Model current, OrderPlaced e) => current;
}

[DangerouslyAllowMixedEphemeralAndSourcedEvents]
public class OrderTimeline  // WHIZ139
  : IPerspectiveFor<Model, PresencePing>, IPerspectiveFor<Model, OrderPlaced> {
  public Model Apply(Model current, PresencePing e) => current;
  public Model Apply(Model current, OrderPlaced e) => current;
}
```

No diagnostic is reported when every read model applying both types opts in, when none does, or for a read model that
applies only one of the two.
{verified: MixedStreamAllowanceGeneratorTests.EveryReadModelAllows_OrNoneDoes_NoWHIZ139Async}

## Suppressing

```ini{title="Disable WHIZ139 in .editorconfig" description="Turns WHIZ139 off for every C# file the section matches." category="Diagnostics" difficulty="BEGINNER" tags=["suppression", "editorconfig", "WHIZ139"] unverified="suppression/config, not exercised by a test"}
[*.cs]
dotnet_diagnostic.WHIZ139.severity = none
```

Suppressing the warning does not allow the pair: it stays refused at run time while any read model applying both
types lacks the opt-in.

## Related

- [WHIZ130: Perspective mixes ephemeral and Sourced Apply methods](whiz130)
- [WHIZ133: Stream mixes ephemeral and Sourced events](whiz133)
- [Ephemeral Events](../../fundamentals/events/ephemeral-events#allowing-mixed-streams)
