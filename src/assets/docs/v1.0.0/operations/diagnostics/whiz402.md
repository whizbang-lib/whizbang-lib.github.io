---
title: 'WHIZ402: Multi-Model ILensQuery Auto-Detected'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Info diagnostic reported when the EF Core registration generator finds a multi-model ILensQuery whose model types
  all have perspectives, and generates its dependency injection registration.
version: 1.0.0
category: Diagnostics
severity: Info
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
testReferences:
  - tests/Whizbang.Generators.Tests/EFCoreServiceRegistrationGeneratorCoverageTests.cs
  - tests/Whizbang.Generators.Tests/EFCoreServiceRegistrationGeneratorTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ402: Multi-Model ILensQuery Auto-Detected

**Severity**: Info
**Category**: EF Core / Lens Registration

## Description

This is a discovery notice, not a problem. The EF Core service registration generator looks for parameters typed as
`ILensQuery<T1, T2, ...>` (two or more model types, from `Whizbang.Core.Lenses`). When every model type in a
combination is the model of a perspective that belongs to a `[WhizbangDbContext]`, it generates a transient
registration for that `ILensQuery<...>`, wired to each model's perspective table, and reports WHIZ402 to say so.

- It is reported once per distinct combination of model types, per `[WhizbangDbContext]` that knows all of them. The
  message names the consumer class of the first use the generator found.
- `{Arity}` is the number of model types in the combination.
- If any model type is not a known perspective model, [WHIZ401](whiz401) is reported instead and nothing is
  registered.
- A same-named `ILensQuery` interface from another namespace is not detected.
- The diagnostic has no source location.

## Diagnostic Message

```
Auto-detected ILensQuery<{ModelTypes}> (arity {Arity}) in '{ConsumerClass}'. Registration will be generated.
```

## What Produces It

A constructor parameter of a multi-model `ILensQuery` whose models (`ModelA` and `ModelB` here, each projected by a
perspective declared in the test's shared setup) belong to the DbContext:

```csharp{
title: "A consumer of ILensQuery<ModelA, ModelB>"
description: "Both models have perspectives in the DbContext, so the generator registers the combination and reports WHIZ402."
framework: "NET10"
category: "Diagnostics"
difficulty: "INTERMEDIATE"
tags: ["whiz402", "lenses", "multi-model", "registration"]
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

That test verifies the registration WHIZ402 announces (a transient `ILensQuery<ModelA, ModelB>` with a table name for
each model); it does not assert the notice itself. The coverage tests assert that WHIZ402 is **not** reported for
generic parameters that are not a Whizbang `ILensQuery`.

No action is needed. To stop seeing the notice, lower its severity.

## Suppressing

Suppressing is always safe: it hides the notice and changes nothing about what is generated. Because the diagnostic
has no source location, `#pragma warning disable WHIZ402` has no effect; set the severity in a global analyzer config
file:

```ini{
title: "Silence WHIZ402 in a global analyzer config"
description: "Sets the WHIZ402 severity to none for the whole project."
category: "Diagnostics"
difficulty: "BEGINNER"
tags: ["whiz402", "suppression", "globalconfig"]
unverified: "suppression/config, not exercised by a test"
}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ402.severity = none
```

## Related

- [WHIZ401: Multi-model ILensQuery references unknown perspective model](whiz401)
- [WHIZ400: Invalid type argument for ILensQuery](whiz400)
- [Multi-Model Queries](../../fundamentals/lenses/multi-model-queries)
