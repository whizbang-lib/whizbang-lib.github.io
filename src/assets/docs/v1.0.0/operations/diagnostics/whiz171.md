---
title: 'WHIZ171: [InheritScope] With All-None Flags Gives Rows No Scope'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Info diagnostic when [InheritScope(OnCreate = None, Always = None)] is declared. Rows are written with an empty scope,
  not even a tenant, so lenses filtered by tenant or user do not return them.
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
  - src/Whizbang.Core/Lenses/InheritScopeAttribute.cs
  - src/Whizbang.Core/Lenses/ScopeInheritance.cs
testReferences:
  - tests/Whizbang.Generators.Tests/InheritScopeAnalyzerTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ171: [InheritScope] With All-None Flags Gives Rows No Scope

**Severity**: Info
**Category**: Security / Scope Inheritance

## Description

With both `OnCreate` and `Always` set to `ScopeFields.None`, the perspective runner writes the model's rows with an empty
scope: no tenant, no user, no principals. A lens filtered by tenant or user does not return them. That is right for
rows that are meant to be unscoped, and a mistake almost everywhere else.

It is not the same as leaving the attribute off. Without the attribute, a new row copies every scope field from the
message that created it (see [Scope Inheritance](../../fundamentals/security/scoping#scope-inheritance)).

## Diagnostic Message

```
[InheritScope(OnCreate = None, Always = None)] on '{Model}' gives its rows no scope, not even a tenant, so a lens filtered by tenant or user does not return them. Name the fields the rows should carry, or keep this if the rows are meant to be unscoped.
```

## How to Fix

Name the fields the rows should carry, or remove the attribute to record every field at creation. Keep it only if the
rows are deliberately unscoped.

### Before (causes WHIZ171)

```csharp{
title: "All-None scope inheritance"
description: "Rows of FooModel are written with no scope."
framework: "NET10"
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz171", "inherit-scope", "analyzer"]
testFile: "tests/Whizbang.Generators.Tests/InheritScopeAnalyzerTests.cs"
testMethod: "Analyzer_InheritScopeAllNone_ReportsWhiz171SayingRowsGetNoScopeAsync"
githubUrl: "https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/InheritScopeAnalyzerTests.cs"
tests: ["InheritScopeAnalyzerTests.Analyzer_InheritScopeAllNone_ReportsWhiz171SayingRowsGetNoScopeAsync"]
}
[InheritScope(OnCreate = ScopeFields.None, Always = ScopeFields.None)]
public class FooModel { public Guid Id { get; set; } }
```

### After (no WHIZ171)

```csharp{
title: "Tenant-only scope inheritance"
description: "Rows record their tenant; the analyzer reports nothing."
framework: "NET10"
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz171", "inherit-scope", "analyzer"]
testFile: "tests/Whizbang.Generators.Tests/InheritScopeAnalyzerTests.cs"
testMethod: "Analyzer_InheritScopeWithDefaults_IsNotReportedAsWhiz171Async"
githubUrl: "https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/InheritScopeAnalyzerTests.cs"
tests: ["InheritScopeAnalyzerTests.Analyzer_InheritScopeWithDefaults_IsNotReportedAsWhiz171Async"]
}
[InheritScope(OnCreate = ScopeFields.Tenant)]
public class FooModel { public Guid Id { get; set; } }
```

## Suppressing

When the rows are deliberately unscoped, suppress it on the model with `#pragma warning disable WHIZ171`, or project-wide
with `dotnet_diagnostic.WHIZ171.severity = none` in `.editorconfig`.

## Related

- [Scope Inheritance](../../fundamentals/security/scoping#scope-inheritance)
- [WHIZ170: [InheritScope] on a Perspective Class Has No Effect](whiz170)
