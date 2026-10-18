---
title: 'WHIZ141: Stream group has no announcing member with a row evictor'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning diagnostic when no member of a stream deletion group both announces its evictions and carries [RowTtl] or
  [RowCap], so nothing ever starts the group's cascade.
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
  - src/Whizbang.Core/Attributes/RowTtlAttribute.cs
  - src/Whizbang.Core/Attributes/RowCapAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/StreamGroupAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/StreamGroupAnalyzerCoverageTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ141: Stream group has no announcing member with a row evictor

**Severity**: Warning
**Category**: Retention / Stream Groups

## Description

A stream deletion group controls whether members evict a stream *together*, not *whether* a stream is evicted.
Something still has to evict first: a member's own `[RowTtl]` or `[RowCap]` removes a row, and because that member
announces its own evictions to the group, the other members follow.

WHIZ141 is reported for a group key when no member is both:

- **announcing** to that group (`Announce` is `true` on its `[StreamGroup]`, which is the default), and
- carrying a row evictor (`[RowTtl]` or `[RowCap]` on the perspective class).

Such a group is inert: its cascade never fires. The diagnostic is reported once on **each** member of the group, at
compilation end. A member that has an evictor but sets `Announce = false` does not count, because its evictions are
never announced to this group.

The check looks for the presence of `[RowTtl]` or `[RowCap]`; it does not inspect their values.

## Diagnostic Message

```
Stream group '{GroupKey}' has no announcing member with [RowTtl] or [RowCap] — nothing ever triggers its cascade. Give at least one announcing member a real evictor.
```

## Common Causes

1. **The group was declared before retention was configured**, so no member has `[RowTtl]` or `[RowCap]` yet.
2. **The only member with an evictor sets `Announce = false`.**
3. **The evictor was removed** from the member that used to drive the group.

## How to Fix

Give at least one announcing member a row evictor, `[RowTtl(...)]` or `[RowCap(...)]`. The attribute's own
documentation also recommends that every member keep a backstop retention of its own.

### Before (causes WHIZ141)

```csharp{title="Group with no evictor" description="Two members share the chat group but neither has [RowTtl] or [RowCap]; WHIZ141 is reported on both." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["stream-groups", "retention", "row-ttl", "WHIZ141"] testFile="StreamGroupAnalyzerTests.cs" testMethod="GroupWithNoAnnouncingEvictor_ReportsWHIZ141OnEachMemberAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/StreamGroupAnalyzerTests.cs" tests=["StreamGroupAnalyzerTests.GroupWithNoAnnouncingEvictor_ReportsWHIZ141OnEachMemberAsync"]}
using Whizbang.Core;
using Whizbang.Core.Attributes;
using Whizbang.Core.Perspectives;

namespace TestApp;

public class Model { public System.Guid Id { get; set; } }
public record ThreadTouched : IEvent;
public record ThreadClosed : IEvent;

[StreamGroup("chat")]
public class ListSide : IPerspectiveFor<Model, ThreadTouched> {  // WHIZ141
  public Model Apply(Model current, ThreadTouched e) => current;
}

[StreamGroup("chat")]
public class MachinerySide : IPerspectiveFor<Model, ThreadClosed> {  // WHIZ141
  public Model Apply(Model current, ThreadClosed e) => current;
}
```

### After (no diagnostic)

```csharp{title="Group with an announcing evictor" description="One member carries [RowTtl] and announces by default, so the group has a trigger." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["stream-groups", "retention", "row-ttl", "WHIZ141"] testFile="StreamGroupAnalyzerTests.cs" testMethod="GroupWithAnAnnouncingEvictor_NoWHIZ141Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/StreamGroupAnalyzerTests.cs" tests=["StreamGroupAnalyzerTests.GroupWithAnAnnouncingEvictor_NoWHIZ141Async"]}
[StreamGroup("chat")]
[RowTtl(Days = 60)]
public class EvictingLeader : IPerspectiveFor<Model, ThreadTouched> {
  public Model Apply(Model current, ThreadTouched e) => current;
}

[StreamGroup("chat")]
public class Follower : IPerspectiveFor<Model, ThreadClosed> {
  public Model Apply(Model current, ThreadClosed e) => current;
}
```

## Suppressing

WHIZ141 is reported when the whole compilation has been analyzed, so it appears in builds and may not appear in the
editor while you type. Because it is reported on every member, a `#pragma` must cover each member's declaration.

```csharp{title="Suppress WHIZ141 for one member" description="Disables WHIZ141 around one group member declaration." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["suppression", "pragma", "WHIZ141"] unverified="suppression syntax, not exercised by a test"}
#pragma warning disable WHIZ141
[StreamGroup("chat")]
public class ListSide : IPerspectiveFor<Model, ThreadTouched> {
  public Model Apply(Model current, ThreadTouched e) => current;
}
#pragma warning restore WHIZ141
```

```ini{title="Disable WHIZ141 in .editorconfig" description="Turns WHIZ141 off for every C# file the section matches." category="Diagnostics" difficulty="BEGINNER" tags=["suppression", "editorconfig", "WHIZ141"] unverified="suppression/config, not exercised by a test"}
[*.cs]
dotnet_diagnostic.WHIZ141.severity = none
```

Suppression rarely makes sense: an inert group does nothing, so either give it a trigger or remove the
`[StreamGroup]` attributes.

## Related

- [WHIZ140: Perspective shares stream event types with a group but joins none](whiz140)
- [WHIZ142: Bridge on a sole stream-group membership](whiz142)
- [Perspectives](../../fundamentals/perspectives/perspectives)
- [Configuration Reference](../../operations/configuration/configuration-reference)
