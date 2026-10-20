---
title: 'WHIZ140: Perspective shares stream event types with a group but joins none'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning diagnostic when a perspective applies event types that also feed a stream deletion group member, but joins
  no group and is not marked [StreamGroupIsolated], so its rows linger after the group evicts a stream.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - stream-groups
  - retention
  - perspectives
  - analyzer
codeReferences:
  - src/Whizbang.Generators/StreamGroupAnalyzer.cs
  - src/Whizbang.Core/Attributes/StreamGroupAttribute.cs
  - src/Whizbang.Core/Attributes/StreamGroupIsolatedAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/StreamGroupAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/StreamGroupAnalyzerCoverageTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ140: Perspective shares stream event types with a group but joins none

**Severity**: Warning
**Category**: Retention / Stream Groups

## Description

`[StreamGroup("key")]` on a perspective class makes it a member of a stream deletion group. Members of the same group
evict together: when one member's own retention (`[RowTtl]`, `[RowCap]`) evicts a stream's row, the same stream's rows
leave the other members in the same maintenance cycle. A perspective with no membership is never touched by a group's
cascade.

That makes it easy to forget a member. If a new perspective is added over the same streams and nobody adds the
`[StreamGroup]` attribute, its rows stay behind after the rest of the group has evicted the stream: the half-evicted
stream that groups exist to prevent.

WHIZ140 uses the events a perspective applies to detect this. At compilation end it collects the event types applied
by every grouped perspective, then reports each perspective that:

- applies at least one of those event types,
- has no `[StreamGroup]` membership (an empty key such as `[StreamGroup("")]` counts as no membership), and
- does not carry `[StreamGroupIsolated]`.

The message lists the grouped members it shares event types with, in ordinal order. Nothing is reported in a
compilation where no perspective joins a group.

```mermaid{caption="The ungrouped perspective applying the group's event types is flagged; the isolated one stated its choice." tests=["StreamGroupAnalyzerTests.UngroupedSharer_ReportsWHIZ140_IsolationMarkerSilencesItAsync"]}
flowchart LR
  E["ThreadTouched"]
  G["GroupedList<br/>[StreamGroup(&quot;chat&quot;)]"]
  F["ForgottenSibling<br/>no membership"]
  K["DeliberateKeeper<br/>[StreamGroupIsolated]"]
  E --> G
  E --> F
  E --> K
  F -.->|WHIZ140| W["rows linger after<br/>the group evicts"]
```

## Diagnostic Message

```
Perspective '{PerspectiveName}' applies event type(s) also feeding stream-group member(s) ({GroupedMembers}), but joins no group, so its rows will linger after siblings evict. Join the group, or mark [StreamGroupIsolated] to state the exclusion is deliberate.
```

## Common Causes

1. **A new perspective was added** over streams that an existing group already covers.
2. **A perspective was moved out of a group** without marking the exclusion.
3. **The perspective genuinely needs its own retention** but nobody recorded that decision.

## How to Fix

- **Join the group**: add `[StreamGroup("key")]` with the same key the other members use.
- **Mark the exclusion as deliberate**: add `[StreamGroupIsolated]` when this perspective should keep its rows on its
  own retention even after the group evicts the stream.

### Before (causes WHIZ140)

```csharp{title="Ungrouped perspective over a grouped stream" description="ForgottenSibling applies the same event as a grouped member but joins nothing, so WHIZ140 is reported on it." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["stream-groups", "retention", "perspectives", "WHIZ140"] testFile="StreamGroupAnalyzerTests.cs" testMethod="UngroupedSharer_ReportsWHIZ140_IsolationMarkerSilencesItAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/StreamGroupAnalyzerTests.cs" tests=["StreamGroupAnalyzerTests.UngroupedSharer_ReportsWHIZ140_IsolationMarkerSilencesItAsync"]}
using Whizbang.Core;
using Whizbang.Core.Attributes;
using Whizbang.Core.Perspectives;

namespace TestApp;

public class Model { public System.Guid Id { get; set; } }
public record ThreadTouched : IEvent;

[StreamGroup("chat")]
[RowTtl(Days = 60)]
public class GroupedList : IPerspectiveFor<Model, ThreadTouched> {
  public Model Apply(Model current, ThreadTouched e) => current;
}

public class ForgottenSibling : IPerspectiveFor<Model, ThreadTouched> {  // WHIZ140
  public Model Apply(Model current, ThreadTouched e) => current;
}
```

### After (no diagnostic)

The same test shows the isolation marker silencing the warning:

```csharp{title="Deliberately isolated perspective" description="[StreamGroupIsolated] states that keeping these rows is intended, so WHIZ140 is not reported." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["stream-groups", "retention", "perspectives", "WHIZ140"] testFile="StreamGroupAnalyzerTests.cs" testMethod="UngroupedSharer_ReportsWHIZ140_IsolationMarkerSilencesItAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/StreamGroupAnalyzerTests.cs" tests=["StreamGroupAnalyzerTests.UngroupedSharer_ReportsWHIZ140_IsolationMarkerSilencesItAsync"]}
[StreamGroupIsolated]
public class DeliberateKeeper : IPerspectiveFor<Model, ThreadTouched> {
  public Model Apply(Model current, ThreadTouched e) => current;
}
```

Joining the group instead (`[StreamGroup("chat")]`) also clears the warning.

## Suppressing

WHIZ140 is reported when the whole compilation has been analyzed, so it appears in builds and may not appear in the
editor while you type.

```csharp{title="Suppress WHIZ140 for one perspective" description="Disables WHIZ140 around one perspective declaration." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["suppression", "pragma", "WHIZ140"] unverified="suppression syntax, not exercised by a test"}
#pragma warning disable WHIZ140
public class ForgottenSibling : IPerspectiveFor<Model, ThreadTouched> {
  public Model Apply(Model current, ThreadTouched e) => current;
}
#pragma warning restore WHIZ140
```

```ini{title="Disable WHIZ140 in .editorconfig" description="Turns WHIZ140 off for every C# file the section matches." category="Diagnostics" difficulty="BEGINNER" tags=["suppression", "editorconfig", "WHIZ140"] unverified="suppression/config, not exercised by a test"}
[*.cs]
dotnet_diagnostic.WHIZ140.severity = none
```

Prefer `[StreamGroupIsolated]` to suppression. It says the same thing in code, it distinguishes "I chose to keep these
rows" from "I forgot to join", and it keeps the check active for the next perspective someone adds.

## Related

- [WHIZ141: Stream group has no announcing member with a row evictor](whiz141)
- [WHIZ142: Bridge on a sole stream-group membership](whiz142)
- [Perspectives](../../fundamentals/perspectives/perspectives)
- [Configuration Reference](../../operations/configuration/configuration-reference)
