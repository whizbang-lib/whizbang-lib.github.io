---
title: 'WHIZ401: Multi-Model ILensQuery References Unknown Perspective Model'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning diagnostic when a parameter typed as a multi-model ILensQuery names a model type that no perspective in the
  DbContext projects, so no registration is generated for that combination.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - lenses
  - multi-model
  - ef-core
  - registration
  - source-generator
codeReferences:
  - src/Whizbang.Data.EFCore.Postgres.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCoreServiceRegistrationGenerator.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreInfrastructureRegistration.cs
testReferences:
  - tests/Whizbang.Generators.Tests/EFCoreServiceRegistrationGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/EFCoreServiceRegistrationGeneratorCoverageTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ401: Multi-Model ILensQuery References Unknown Perspective Model

**Severity**: Warning
**Category**: EF Core / Lens Registration

## Description

When your code takes an `ILensQuery<T1, T2, ...>` (two or more model types, from `Whizbang.Core.Lenses`) as a
parameter, the EF Core service registration generator registers that combination for you, mapping each model type to
its perspective table. It can only do that when every model type is the model of a known perspective. WHIZ401 is
reported when one of them is not, and **no registration is generated** for that combination. Resolving the
`ILensQuery<...>` from dependency injection then fails at runtime unless you register it yourself.

Details of when it fires:

- Discovery looks at parameters whose type is `ILensQuery<...>` with at least two type arguments. Constructor
  parameters are the usual case. An interface with the same name declared in another namespace is ignored.
- The check runs per `[WhizbangDbContext]` class, against the perspectives that belong to that DbContext. With no
  `[WhizbangDbContext]` in the project, nothing is checked or reported.
- Repeated uses of the same combination are checked once, and the message names the consumer class of the first use the generator found.
- Only the first unknown model type in a combination is named.
- The diagnostic has no source location; it appears in the build output without a file and line.

## Diagnostic Message

```
ILensQuery<{ModelTypes}> in '{ConsumerClass}' references model type '{UnknownModel}' which is not a known perspective. Ensure an IPerspectiveFor<{UnknownModel}> exists or register manually.
```

## Common Causes

1. **No perspective projects that model yet.** The model type was added to the lens query before (or without) its
   `IPerspectiveFor<TModel, ...>`.
2. **The type is not a perspective model at all**, for example an event, a DTO or an entity from another store.
3. **The perspective belongs to a different DbContext.** With several `[WhizbangDbContext]` classes, a perspective
   matches only the DbContext whose keys it shares, and the combination is checked against each DbContext.

## How to Fix

- **Add the missing perspective**: implement `IPerspectiveFor<TModel, TEvent>` for the reported model. On the next
  build the combination is registered and [WHIZ402](whiz402) reports it.
- **Fix the type argument** if it named the wrong type.
- **Register the query manually** when the model is projected elsewhere, using
  `EFCoreInfrastructureRegistration.RegisterMultiLensQuery` with the table name for each model (see
  [Multi-Model Queries](../../fundamentals/lenses/multi-model-queries#registration)).

### Before (causes WHIZ401)

```csharp{
title: "A lens query over a model with no perspective"
description: "UnknownModel has no IPerspectiveFor, so WHIZ401 is reported and ILensQuery<ModelA, UnknownModel> is not registered."
framework: "NET10"
category: "Diagnostics"
difficulty: "INTERMEDIATE"
tags: ["whiz401", "lenses", "multi-model", "counter-example"]
testFile: "tests/Whizbang.Generators.Tests/EFCoreServiceRegistrationGeneratorTests.cs"
testMethod: "Generator_WithMultiModelLensQuery_UnknownModel_ReportsWHIZ401Async"
githubUrl: "https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/EFCoreServiceRegistrationGeneratorTests.cs"
tests: ["EFCoreServiceRegistrationGeneratorTests.Generator_WithMultiModelLensQuery_UnknownModel_ReportsWHIZ401Async"]
}
public record TestEvent : IEvent;
public record ModelA { public string Id { get; init; } = ""; }
public record UnknownModel { public string Id { get; init; } = ""; }

public class PerspectiveA : IPerspectiveFor<ModelA, TestEvent> {
  private readonly IPerspectiveStore<ModelA> _store;
  public PerspectiveA(IPerspectiveStore<ModelA> store) => _store = store;
  public ModelA Apply(ModelA currentData, TestEvent eventData) => currentData with { Id = "a" };
}

// No perspective for UnknownModel!

public class MyRepository {
  public MyRepository(ILensQuery<ModelA, UnknownModel> query) { }
}

[WhizbangDbContext]
public class TestDbContext : DbContext {
  public TestDbContext(DbContextOptions<TestDbContext> options) : base(options) { }
}
```

### After (no WHIZ401)

When both `ModelA` and `ModelB` have perspectives in the DbContext (the test declares `PerspectiveA` and
`PerspectiveB` in shared setup), the same kind of consumer gets a generated transient registration for
`ILensQuery<ModelA, ModelB>` with the table name of each model:

```csharp{
title: "A lens query whose models all have perspectives"
description: "Every model type is projected by a perspective in the DbContext, so the combination is registered."
framework: "NET10"
category: "Diagnostics"
difficulty: "INTERMEDIATE"
tags: ["whiz401", "lenses", "multi-model", "registration"]
testFile: "tests/Whizbang.Generators.Tests/EFCoreServiceRegistrationGeneratorTests.cs"
testMethod: "Generator_WithMultiModelLensQueryConstructorParam_GeneratesRegistrationAsync"
githubUrl: "https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/EFCoreServiceRegistrationGeneratorTests.cs"
tests: ["EFCoreServiceRegistrationGeneratorTests.Generator_WithMultiModelLensQueryConstructorParam_GeneratesRegistrationAsync"]
}
// Repository that uses multi-model ILensQuery
public class MyRepository {
  public MyRepository(ILensQuery<ModelA, ModelB> query) { }
}

[WhizbangDbContext]
public class TestDbContext : DbContext {
  public TestDbContext(DbContextOptions<TestDbContext> options) : base(options) { }
}
```

## Suppressing

Suppress WHIZ401 only when you register the combination yourself; otherwise the missing registration surfaces at
runtime instead of at build time.

Because the diagnostic has no source location, `#pragma warning disable WHIZ401` has no effect. Set the severity in a
global analyzer config file (an ordinary `.editorconfig` section applies to files, and this diagnostic is not reported
against a file):

```ini{
title: "Disable WHIZ401 in a global analyzer config"
description: "Sets the WHIZ401 severity to none for the whole project."
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz401", "suppression", "globalconfig"]
unverified: "suppression/config, not exercised by a test"
}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ401.severity = none
```

## Related

- [WHIZ402: Multi-model ILensQuery auto-detected](whiz402)
- [WHIZ400: Invalid type argument for ILensQuery](whiz400)
- [Multi-Model Queries](../../fundamentals/lenses/multi-model-queries)
- [EF Core Integration](../../data/efcore-integration)
