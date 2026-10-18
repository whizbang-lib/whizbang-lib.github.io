---
title: 'WHIZ170: [InheritScope] on a Perspective Class Has No Effect'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning diagnostic when [InheritScope] is on a perspective class whose model is another type. The perspective
  runner reads the attribute from the model, so on the perspective class it is ignored.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - scoping
  - inherit-scope
  - multi-tenancy
  - perspectives
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

# WHIZ170: [InheritScope] on a Perspective Class Has No Effect

**Severity**: Warning
**Category**: Security / Scope Inheritance

## Description

`[InheritScope]` decides which scope fields a perspective row takes from the messages applied to it (see
[Scope Inheritance](../../fundamentals/security/scoping#scope-inheritance)). The perspective runner reads it from the
perspective's **model** type, the `TModel` of `IPerspectiveFor<TModel, ...>`, `IPerspectiveWithActionsFor<TModel, ...>`
or `IGlobalPerspectiveFor<TModel, ...>`. On the perspective class it is ignored, and rows get the default: every scope
field at creation, set once.

The analyzer reports WHIZ170 when a class carries `[InheritScope]` and implements one of those interfaces for a model
that is another type. It does not report the attribute on any other class, because that class may be the model of a
perspective in this compilation or in another assembly, which is where the attribute belongs. A perspective that is its
own model is not reported either.

## Diagnostic Message

```
'{PerspectiveClass}' is a perspective over '{Model}', and the perspective runner reads [InheritScope] from the model. Move the attribute to '{Model}'.
```

## Common Causes

1. **The attribute was put on the perspective** because it reads like perspective configuration.
2. **The model was split out of the perspective class** and the attribute stayed behind.

## How to Fix

Move the attribute to the model named in the message.

### Before (causes WHIZ170)

```csharp{
title: "[InheritScope] on the perspective class"
description: "The runner reads [InheritScope] from FooModel, so the attribute on FooProjection is ignored."
framework: "NET10"
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz170", "inherit-scope", "analyzer", "counter-example"]
testFile: "tests/Whizbang.Generators.Tests/InheritScopeAnalyzerTests.cs"
testMethod: "Analyzer_InheritScopeOnPerspectiveClass_ReportsWhiz170NamingTheModelAsync"
githubUrl: "https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/InheritScopeAnalyzerTests.cs"
tests: ["InheritScopeAnalyzerTests.Analyzer_InheritScopeOnPerspectiveClass_ReportsWhiz170NamingTheModelAsync"]
}
public class FooModel { public Guid Id { get; set; } }

[InheritScope(OnCreate = ScopeFields.Tenant)]
public class FooProjection : IPerspectiveFor<FooModel, FooEvent> {
  public FooModel Apply(FooModel current, FooEvent e) => new();
}
```

### After (no WHIZ170)

```csharp{
title: "[InheritScope] on the model"
description: "The attribute is on the model, where the runner reads it."
framework: "NET10"
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz170", "inherit-scope", "analyzer"]
testFile: "tests/Whizbang.Generators.Tests/InheritScopeAnalyzerTests.cs"
testMethod: "Analyzer_InheritScopeOnPerspectiveModel_IsNotReportedAsync"
githubUrl: "https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/InheritScopeAnalyzerTests.cs"
tests: ["InheritScopeAnalyzerTests.Analyzer_InheritScopeOnPerspectiveModel_IsNotReportedAsync"]
}
[InheritScope(OnCreate = ScopeFields.Tenant | ScopeFields.User)]
public class FooModel { public Guid Id { get; set; } }

public class FooProjection : IPerspectiveFor<FooModel, FooEvent> {
  public FooModel Apply(FooModel current, FooEvent e) => new();
}
```

## Suppressing

Do not suppress it: the attribute does nothing where it is, so the fix is to move it. The diagnostic is reported on the
class declaration, so `#pragma warning disable WHIZ170` around the class works if you need to.

## Related

- [Scope Inheritance](../../fundamentals/security/scoping#scope-inheritance)
- [WHIZ171: [InheritScope] With All-None Flags Gives Rows No Scope](whiz171)
- [Implementing Multi-Tenancy](../../fundamentals/security/implementing-multi-tenancy)
