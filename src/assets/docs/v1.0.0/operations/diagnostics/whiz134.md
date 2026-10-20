---
title: 'WHIZ134: Ambiguous ephemeral composition'
pageType: troubleshooting
verifiedAgainstCommit: 03c5bb93
verifiedDate: 2026-10-20
description: >-
  Error diagnostic when a type inherits [Ephemeral] from two or more unrelated profile interfaces whose settings
  disagree, with no attribute on the type or a base class to settle which one applies.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - ephemeral
  - events
  - composition
  - analyzer
codeReferences:
  - src/Whizbang.Generators/EphemeralAnalyzer.cs
  - src/Whizbang.Generators/Utilities/EphemeralResolver.cs
  - src/Whizbang.Core/Attributes/EphemeralAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/EphemeralAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/EphemeralResolverCoverageTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ134: Ambiguous ephemeral composition

**Severity**: Error
**Category**: Ephemeral Events

## Description

`[Ephemeral]` can be placed on an event, on a base record, or on an interface, so a team can define a reusable
ephemeral "profile" once and have events opt in by implementing it. The effective settings for a type are resolved at
build time, most specific first: the type's own `[Ephemeral]`, then its base classes, then its interfaces.

WHIZ134 is reported when that walk reaches the interfaces and finds two or more profiles that disagree, and neither is
more specific than the other. Without this error the generator would pick one by a fixed but arbitrary rule (interface
name order), so the type's runtime behavior would depend on how its interfaces happen to be named.

Specifically, the type is flagged when all of these hold:

1. The type itself has no `[Ephemeral]`, and no base class has one.
2. Two or more of its interfaces carry `[Ephemeral]`.
3. After dropping any profile interface that another profile interface extends (the extending one is more specific),
   the remaining profiles do not all have the same `Destruction` and `Storage` values.

The check applies to every class and struct, not only events.

```mermaid{caption="A type implementing two sibling profiles that disagree is ambiguous; a refined profile that extends another is not." tests=["EphemeralAnalyzerTests.TwoConflictingProfiles_ReportsWHIZ134ErrorAsync", "EphemeralAnalyzerTests.RefinedProfileInheritance_NoWHIZ134Async"]}
flowchart LR
  subgraph Ambiguous["WHIZ134"]
    P1["IPresenceProfile<br/>WhenConsumed, TtlRow"]
    P2["ISessionProfile<br/>AfterTtl, TtlRow"]
    A["record Ambiguous"]
    A --> P1
    A --> P2
  end
  subgraph Refined["No diagnostic"]
    B1["IBaseProfile<br/>WhenConsumed, TtlRow"]
    B2["IRefinedProfile<br/>AfterTtl, TtlRow"]
    R["record Refined"]
    R --> B2
    B2 --> B1
  end
```

## Diagnostic Message

```
Type '{TypeName}' inherits [Ephemeral] from two or more profiles that disagree, and nothing more specific breaks the tie. Declare an explicit [Ephemeral(...)] on '{TypeName}' to resolve it.
```

## Common Causes

1. **An event implements two profile interfaces** written for different purposes, such as a presence profile and a
   session profile.
2. **A profile's settings were changed** so that two profiles that used to agree now differ.
3. **A refinement was declared as a sibling** instead of extending the profile it refines.

## How to Fix

- **Declare `[Ephemeral(...)]` on the type** with the settings you want. The type's own attribute is the most specific
  and always wins.
- **Put `[Ephemeral]` on a base class** of the type; a base class attribute also settles the tie.
- **Make one profile extend the other** when one is a refinement of the other; the extending profile is then the more
  specific one and is chosen.
- **Align the profiles** if they were meant to have the same `Destruction` and `Storage`.

### Before (causes WHIZ134)

```csharp{title="Event composing two conflicting profiles" description="Two sibling profile interfaces with different Destruction and Storage values, and nothing on the type to choose between them." framework="NET10" category="Diagnostics" difficulty="ADVANCED" tags=["ephemeral", "composition", "profiles", "WHIZ134"] testFile="EphemeralAnalyzerTests.cs" testMethod="TwoConflictingProfiles_ReportsWHIZ134ErrorAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/EphemeralAnalyzerTests.cs" tests=["EphemeralAnalyzerTests.TwoConflictingProfiles_ReportsWHIZ134ErrorAsync"]}
using Whizbang.Core;
using Whizbang.Core.Attributes;

namespace TestApp;

[Ephemeral(Destruction = Destruction.WhenConsumed, Storage = TransientStorage.TtlRow)]
public interface IPresenceProfile : IEvent { }

[Ephemeral(Destruction = Destruction.AfterTtl, Storage = TransientStorage.TtlRow)]
public interface ISessionProfile : IEvent { }

public record Ambiguous : IPresenceProfile, ISessionProfile;  // WHIZ134
```

### After (no diagnostic)

```csharp{title="Explicit [Ephemeral] settles the tie" description="The type's own attribute is the most specific declaration, so the conflicting profiles no longer matter." framework="NET10" category="Diagnostics" difficulty="ADVANCED" tags=["ephemeral", "composition", "profiles", "WHIZ134"] testFile="EphemeralAnalyzerTests.cs" testMethod="ConflictingProfilesWithOwnOverride_NoWHIZ134Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/EphemeralAnalyzerTests.cs" tests=["EphemeralAnalyzerTests.ConflictingProfilesWithOwnOverride_NoWHIZ134Async"]}
[Ephemeral(Destruction = Destruction.WhenConsumed, Storage = TransientStorage.TtlRow)]
public record Resolved : IPresenceProfile, ISessionProfile;
```

## Related

- [WHIZ130: Perspective mixes ephemeral and Sourced Apply methods](whiz130)
- [Events](../../fundamentals/events/events)
- [Snapshots](../../fundamentals/perspectives/snapshots)
