---
title: 'WHIZ170: [InheritScope] on a Non-Perspective Type Has No Effect'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning diagnostic when a class carries [InheritScope] but does not implement IPerspectiveFor. Read this page
  before acting on it: the perspective runner reads the attribute from the perspective model, which this check flags.
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
  - tests/Whizbang.Generators.Tests/PerspectiveRunnerGeneratorTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ170: [InheritScope] on a Non-Perspective Type Has No Effect

**Severity**: Warning
**Category**: Security / Scope Inheritance

## Description

`[InheritScope]` declares which scope fields (tenant, user, and so on) a perspective row copies from the message that
creates it. The `InheritScopeAnalyzer` reports WHIZ170 for any class that carries `[InheritScope]` but does not
implement an `IPerspectiveFor<...>` interface. The intent is to catch an attribute placed on a class the perspective
runner never looks at, where it would be silently ignored.

The check runs on classes only, and only when `[InheritScope]` is present. It looks at every interface the class
implements, including inherited ones, so a class that reaches `IPerspectiveFor<...>` through a base class or another
interface is not reported.

:::updated
**The analyzer and the perspective runner disagree about where the attribute goes.** The perspective runner generator
reads `[InheritScope]` from the perspective's **model type** (the `TModel` in `IPerspectiveFor<TModel, ...>`), not
from the perspective class. A model class does not implement `IPerspectiveFor<...>`, so the placement that actually
takes effect is reported as WHIZ170, and the placement that silences WHIZ170 (on the perspective class) is not read
by the runner. Until the two agree, treat WHIZ170 on a perspective model as a false positive and suppress it for that
type (see [Suppressing](#suppressing)). The [multi-tenancy guide](../../fundamentals/security/implementing-multi-tenancy)
also places the attribute on the model.
:::

## Diagnostic Message

```
Class '{ClassName}' is decorated with [InheritScope] but does not implement IPerspectiveFor<...>. The attribute will be ignored at runtime.
```

## Common Causes

1. **The attribute is on an unrelated class**, such as a DTO, a service or a helper, that is neither a perspective nor
   a perspective model.
2. **The attribute is on a perspective model.** This is where the runner reads it, but the analyzer only accepts
   classes that implement `IPerspectiveFor<...>`, so it reports the model anyway (see the note above).
3. **The class used to be a perspective** and its `IPerspectiveFor<...>` interface was removed, leaving the attribute
   behind.

## How to Fix

First decide which kind of class carries the attribute:

- **Neither a perspective nor a perspective model**: remove `[InheritScope]`. Nothing reads it there.
- **A perspective model** (the `TModel` of some `IPerspectiveFor<TModel, ...>`): keep the attribute where it is, since
  that is the placement the runner reads, and suppress WHIZ170 for that class.
- **A perspective class**: the analyzer accepts it, but the runner does not read the attribute from the perspective
  class. Move it to the model and suppress WHIZ170 there.

### Before (causes WHIZ170)

```csharp{
title: "[InheritScope] on a plain class"
description: "A class that does not implement IPerspectiveFor carries [InheritScope]; the analyzer reports WHIZ170 naming the class."
framework: "NET10"
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz170", "inherit-scope", "analyzer", "counter-example"]
testFile: "tests/Whizbang.Generators.Tests/InheritScopeAnalyzerTests.cs"
testMethod: "Analyzer_InheritScopeOnNonPerspective_ReportsAuth010Async"
githubUrl: "https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/InheritScopeAnalyzerTests.cs"
tests: ["InheritScopeAnalyzerTests.Analyzer_InheritScopeOnNonPerspective_ReportsAuth010Async"]
}
using Whizbang.Core.Lenses;

namespace TestApp;

// Plain class: does NOT implement IPerspectiveFor<>. WHIZ170 is reported here.
[InheritScope(OnCreate = ScopeFields.Tenant | ScopeFields.User)]
public class PlainClass {
  public int X { get; set; }
}
```

### After (no WHIZ170)

The analyzer accepts the attribute on a class that implements `IPerspectiveFor<...>`:

```csharp{
title: "[InheritScope] on a perspective class"
description: "The analyzer reports no WHIZ170 when the decorated class implements IPerspectiveFor."
framework: "NET10"
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz170", "inherit-scope", "analyzer"]
testFile: "tests/Whizbang.Generators.Tests/InheritScopeAnalyzerTests.cs"
testMethod: "Analyzer_InheritScopeOnPerspective_NoAuth010Async"
githubUrl: "https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/InheritScopeAnalyzerTests.cs"
tests: ["InheritScopeAnalyzerTests.Analyzer_InheritScopeOnPerspective_NoAuth010Async"]
}
using Whizbang.Core.Lenses;
using Whizbang.Core.Perspectives;

namespace TestApp;

public class FooModel { public System.Guid Id { get; set; } }
public class FooEvent { public System.Guid StreamId { get; set; } }

[InheritScope(OnCreate = ScopeFields.Tenant)]
public class FooProjection : IPerspectiveFor<FooModel, FooEvent> {
  public FooModel Apply(FooModel current, FooEvent e) => new();
}
```

That placement silences the analyzer, but the runner generator does not read it. The placement the runner reads is
the model, as its own test shows: the generated runner for `OrderPerspective` carries the `Tenant | User` flags
declared on `OrderModel`.

```csharp{
title: "[InheritScope] on the perspective model, where the runner reads it"
description: "The runner generator takes the OnCreate flags from the model type; OrderModel is still reported as WHIZ170 by the analyzer."
framework: "NET10"
category: "Diagnostics"
difficulty: "INTERMEDIATE"
tags: ["whiz170", "inherit-scope", "perspective-model", "runner"]
testFile: "tests/Whizbang.Generators.Tests/PerspectiveRunnerGeneratorTests.cs"
testMethod: "PerspectiveRunnerGenerator_InheritScopeWithOnCreate_UsesConfiguredFlagsAsync"
githubUrl: "https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/PerspectiveRunnerGeneratorTests.cs"
tests: ["PerspectiveRunnerGeneratorTests.PerspectiveRunnerGenerator_InheritScopeWithOnCreate_UsesConfiguredFlagsAsync"]
}
[InheritScope(OnCreate = ScopeFields.Tenant | ScopeFields.User)]
public class OrderModel {
  [StreamId]
  public Guid Id { get; set; }
}

public class OrderPerspective : IPerspectiveFor<OrderModel, OrderCreatedEvent> {
  public OrderModel Apply(OrderModel currentData, OrderCreatedEvent @event) {
    return currentData;
  }
}
```

## Suppressing

The diagnostic is reported on the class declaration, so a `#pragma` around the class works. This is the appropriate
way to keep `[InheritScope]` on a perspective model while the analyzer and the runner disagree:

```csharp{
title: "Suppress WHIZ170 on a perspective model"
description: "Keeps the attribute on the model, where the runner reads it, and silences the analyzer for that class only."
framework: "NET10"
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz170", "suppression", "pragma"]
unverified: "suppression syntax, not exercised by a test"
}
#pragma warning disable WHIZ170 // [InheritScope] is read from the model by the perspective runner
[InheritScope(OnCreate = ScopeFields.Tenant | ScopeFields.User)]
public class OrderModel {
  [StreamId]
  public Guid Id { get; set; }
}
#pragma warning restore WHIZ170
```

To turn it off for a whole project or folder, use `.editorconfig`:

```ini{
title: "Disable WHIZ170 in .editorconfig"
description: "Sets the WHIZ170 severity to none for the files the section matches."
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz170", "suppression", "editorconfig"]
unverified: "suppression/config, not exercised by a test"
}
[*.cs]
dotnet_diagnostic.WHIZ170.severity = none
```

Do not suppress it on a class that is neither a perspective nor a perspective model: there the warning is correct and
the attribute does nothing.

## Related

- [WHIZ171: [InheritScope] with all-None flags is redundant](whiz171)
- [Implementing Multi-Tenancy](../../fundamentals/security/implementing-multi-tenancy)
- [Scoping](../../fundamentals/security/scoping)
- [Perspectives](../../fundamentals/perspectives/perspectives)
