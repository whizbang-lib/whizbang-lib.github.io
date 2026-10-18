---
title: 'WHIZ171: [InheritScope] with All-None Flags Is Redundant'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Info diagnostic when [InheritScope] sets both OnCreate and Always to ScopeFields.None, a declaration that asks to
  inherit nothing and is easy to misread.
version: 1.0.0
category: Diagnostics
severity: Info
tags:
  - diagnostics
  - scoping
  - inherit-scope
  - multi-tenancy
  - analyzer
codeReferences:
  - src/Whizbang.Generators/InheritScopeAnalyzer.cs
  - src/Whizbang.Generators/PerspectiveRunnerGenerator.cs
  - src/Whizbang.Core/Lenses/InheritScopeAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/InheritScopeAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/InheritScopeAnalyzerCoverageTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ171: [InheritScope] with All-None Flags Is Redundant

**Severity**: Info
**Category**: Security / Scope Inheritance

## Description

`[InheritScope]` has two flag properties: `OnCreate` (scope fields copied from the creating message when a row is
inserted, default `ScopeFields.Tenant`) and `Always` (fields copied on every apply, default `ScopeFields.None`). The
`InheritScopeAnalyzer` reports WHIZ171 when both resolve to `None`, which happens only when `OnCreate = ScopeFields.None`
is written explicitly, because `OnCreate` defaults to `Tenant`. A bare `[InheritScope]` is never reported.

A declaration that inherits nothing is legal, but it reads like a mistake: a reviewer cannot tell whether "no scope at
all" was intended. The diagnostic asks you to either say so or pick the fields you meant.

The check runs on any class that carries `[InheritScope]`, whether or not it implements `IPerspectiveFor<...>`, so on
a class that is not a perspective it can appear together with [WHIZ170](whiz170).

:::updated
**Omitting the attribute does not give tenant-only inheritance in this release.** The descriptor's description says
the framework default without the attribute is tenant-only. The perspective runner generator, however, treats a model
with no `[InheritScope]` as "copy every scope field on insert" (the legacy behavior), and a bare `[InheritScope]` as
`OnCreate = Tenant`. So if you meant tenant-only, write `[InheritScope]` with no arguments rather than removing it.
The runner reads only `OnCreate`, from the perspective model; see the placement note on [WHIZ170](whiz170).
:::

## Diagnostic Message

```
[InheritScope(OnCreate = None, Always = None)] on '{ClassName}' is equivalent to declaring no inheritance at all. Either omit the attribute or specify at least one inherited field.
```

## Common Causes

1. **`OnCreate = ScopeFields.None` written to "turn off" inheritance**, without a comment explaining why the row
   should carry no scope.
2. **A leftover from editing flags**, where every field was removed from `OnCreate` and `Always` was already `None`.
3. **Copying a template** that spelled out both properties as `None`.

## How to Fix

- **You meant tenant-only inheritance**: use `[InheritScope]` with no arguments (`OnCreate = Tenant`, `Always = None`).
- **You meant specific fields**: list them, for example `[InheritScope(OnCreate = ScopeFields.Tenant | ScopeFields.User)]`.
- **You really mean "inherit nothing"**: keep the declaration, add a comment saying why, and suppress WHIZ171 for that
  class.

### Before (causes WHIZ171)

```csharp{
title: "[InheritScope] with every flag set to None"
description: "Both OnCreate and Always are ScopeFields.None; the analyzer reports WHIZ171 at Info severity naming the class."
framework: "NET10"
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz171", "inherit-scope", "analyzer", "counter-example"]
testFile: "tests/Whizbang.Generators.Tests/InheritScopeAnalyzerTests.cs"
testMethod: "Analyzer_InheritScopeAllNone_ReportsAuth011Async"
githubUrl: "https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/InheritScopeAnalyzerTests.cs"
tests: ["InheritScopeAnalyzerTests.Analyzer_InheritScopeAllNone_ReportsAuth011Async"]
}
public class FooModel { public System.Guid Id { get; set; } }
public class FooEvent { public System.Guid StreamId { get; set; } }

[InheritScope(OnCreate = ScopeFields.None, Always = ScopeFields.None)]
public class FooProjection : IPerspectiveFor<FooModel, FooEvent> {
  public FooModel Apply(FooModel current, FooEvent e) => new();
}
```

### After (no WHIZ171)

```csharp{
title: "Bare [InheritScope]: tenant on create"
description: "The default form sets OnCreate to Tenant, so the all-None check does not fire."
framework: "NET10"
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz171", "inherit-scope", "analyzer", "tenant"]
testFile: "tests/Whizbang.Generators.Tests/InheritScopeAnalyzerTests.cs"
testMethod: "Analyzer_InheritScopeDefaultTenantOnly_NoAuth011Async"
githubUrl: "https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/InheritScopeAnalyzerTests.cs"
tests: ["InheritScopeAnalyzerTests.Analyzer_InheritScopeDefaultTenantOnly_NoAuth011Async"]
}
public class FooModel { public System.Guid Id { get; set; } }
public class FooEvent { public System.Guid StreamId { get; set; } }

[InheritScope]
public class FooProjection : IPerspectiveFor<FooModel, FooEvent> {
  public FooModel Apply(FooModel current, FooEvent e) => new();
}
```

## Suppressing

Suppress WHIZ171 only when "inherit nothing" is the intent, and say so in a comment. The diagnostic is reported on
the class declaration, so a `#pragma` around the class works:

```csharp{
title: "Suppress WHIZ171 where zero inheritance is intended"
description: "Documents why the row carries no scope and silences the notice for that class only."
framework: "NET10"
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz171", "suppression", "pragma"]
unverified: "suppression syntax, not exercised by a test"
}
// Rows of this model are deliberately unscoped: they are shared reference data.
#pragma warning disable WHIZ171
[InheritScope(OnCreate = ScopeFields.None, Always = ScopeFields.None)]
public class ReferenceDataModel {
  [StreamId]
  public Guid Id { get; set; }
}
#pragma warning restore WHIZ171
```

Or for a project or folder, in `.editorconfig`:

```ini{
title: "Disable WHIZ171 in .editorconfig"
description: "Sets the WHIZ171 severity to none for the files the section matches."
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz171", "suppression", "editorconfig"]
unverified: "suppression/config, not exercised by a test"
}
[*.cs]
dotnet_diagnostic.WHIZ171.severity = none
```

## Related

- [WHIZ170: [InheritScope] on a non-perspective type has no effect](whiz170)
- [Implementing Multi-Tenancy](../../fundamentals/security/implementing-multi-tenancy)
- [Scoping](../../fundamentals/security/scoping)
