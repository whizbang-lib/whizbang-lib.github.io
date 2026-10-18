---
title: 'WHIZ142: Bridge on a sole stream-group membership'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning diagnostic when a perspective sets Bridge on its only [StreamGroup] membership; bridging carries an
  eviction between a member's groups, so with one group it has no effect.
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
testReferences:
  - tests/Whizbang.Generators.Tests/StreamGroupAnalyzerTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ142: Bridge on a sole stream-group membership

**Severity**: Warning
**Category**: Retention / Stream Groups

## Description

A perspective can belong to several stream deletion groups, one `[StreamGroup]` attribute per membership, and each
membership has its own settings. `Bridge` (default `false`) decides whether an eviction this perspective **received**
through one of its other groups is re-announced into this group. It is how two groups that share a member are
deliberately joined into one chain of deletions.

With a single membership there is no other group to receive from, so `Bridge = true` does nothing. WHIZ142 reports it
because the setting suggests the author expected a cross-group effect that will not happen.

The check is made per perspective class: it fires when the class has exactly one non-empty `[StreamGroup]` and that
attribute sets `Bridge = true`.

## Diagnostic Message

```
Perspective '{PerspectiveName}' sets Bridge on its only [StreamGroup] membership. Bridging crosses between a member's groups; there is nothing to cross into.
```

## Common Causes

1. **A second membership was planned** but not added yet.
2. **A second membership was removed** and its bridge setting left on the remaining one.
3. **`Bridge` was mistaken for `Announce` or `Follow`.** Announcing this perspective's own evictions is `Announce`
   (default `true`); having this perspective's rows removed when the group announces a stream is `Follow`
   (default `true`).

## How to Fix

- Remove `Bridge = true` from the single membership, or
- Add the other `[StreamGroup]` membership the bridge was meant to connect to.

### Before (causes WHIZ142)

```csharp{title="Bridge on the only membership" description="A perspective with one [StreamGroup] that sets Bridge = true reports WHIZ142." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["stream-groups", "bridge", "WHIZ142"] testFile="StreamGroupAnalyzerTests.cs" testMethod="BridgeOnSoleMembership_ReportsWHIZ142Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/StreamGroupAnalyzerTests.cs" tests=["StreamGroupAnalyzerTests.BridgeOnSoleMembership_ReportsWHIZ142Async"]}
using Whizbang.Core;
using Whizbang.Core.Attributes;
using Whizbang.Core.Perspectives;

namespace TestApp;

public class Model { public System.Guid Id { get; set; } }
public record ThreadTouched : IEvent;

[StreamGroup("chat", Bridge = true)]
public class LonelyBridge : IPerspectiveFor<Model, ThreadTouched> {  // WHIZ142
  public Model Apply(Model current, ThreadTouched e) => current;
}
```

### After (no diagnostic)

```csharp{title="Bridge between two memberships" description="With two memberships the bridge has another group to carry evictions into, so WHIZ142 is not reported." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["stream-groups", "bridge", "WHIZ142"] testFile="StreamGroupAnalyzerTests.cs" testMethod="BridgeWithTwoMemberships_NoWHIZ142Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/StreamGroupAnalyzerTests.cs" tests=["StreamGroupAnalyzerTests.BridgeWithTwoMemberships_NoWHIZ142Async"]}
[StreamGroup("chat")]
[StreamGroup("audit", Bridge = true)]
[RowTtl(Days = 30)]
public class DualMember : IPerspectiveFor<Model, ThreadTouched> {
  public Model Apply(Model current, ThreadTouched e) => current;
}
```

## Suppressing

```csharp{title="Suppress WHIZ142 for one perspective" description="Disables WHIZ142 around one perspective declaration." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["suppression", "pragma", "WHIZ142"] unverified="suppression syntax, not exercised by a test"}
#pragma warning disable WHIZ142
[StreamGroup("chat", Bridge = true)]
public class LonelyBridge : IPerspectiveFor<Model, ThreadTouched> {
  public Model Apply(Model current, ThreadTouched e) => current;
}
#pragma warning restore WHIZ142
```

```ini{title="Disable WHIZ142 in .editorconfig" description="Turns WHIZ142 off for every C# file the section matches." category="Diagnostics" difficulty="BEGINNER" tags=["suppression", "editorconfig", "WHIZ142"] unverified="suppression/config, not exercised by a test"}
[*.cs]
dotnet_diagnostic.WHIZ142.severity = none
```

Suppressing is reasonable only briefly, while the second membership is being added. Otherwise removing `Bridge = true`
is the simpler and clearer fix.

## Related

- [WHIZ140: Perspective shares stream event types with a group but joins none](whiz140)
- [WHIZ141: Stream group has no announcing member with a row evictor](whiz141)
- [Perspectives](../../fundamentals/perspectives/perspectives)
