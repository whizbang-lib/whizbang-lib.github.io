---
title: 'WHIZ704: DbContext overrides OnConfiguring'
pageType: troubleshooting
verifiedAgainstCommit: '9ea505e81'
verifiedDate: 2026-11-26
description: >-
  Error when a [WhizbangDbContext] declares its own OnConfiguring override, which the generated partial class already
  declares; the configuration moves to OnConfiguringExtended.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - ef-core
  - dbcontext
  - whizbang-id
  - source-generator
codeReferences:
  - src/Whizbang.Data.EFCore.Postgres.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCoreServiceRegistrationGenerator.cs
  - src/Whizbang.Data.EFCore.Postgres/Perspectives/WhizbangIdConvention.cs
testReferences:
  - tests/Whizbang.Generators.Tests/EFCoreServiceRegistrationGeneratorTests.cs
lastMaintainedCommit: '9ea505e81'
---

# WHIZ704: DbContext overrides OnConfiguring

**Severity**: Error
**Category**: Source Generation / EF Core

## Description

The partial class Whizbang generates for a `[WhizbangDbContext]` overrides `OnConfiguring`. It calls the base context's
`OnConfiguring`, then `OnConfiguringExtended`, then gives the options what strongly-typed ids need when they do not
carry the Whizbang options extension: the query postprocessor that sets an id inside a document in the form the fleet
reads, the migrations model differ that moves an id's column by name, and the interceptor that learns the name the
server gives the database ([Ids in a perspective document](../../fundamentals/identity/whizbang-ids#stored-form)).

WHIZ704 is reported at an `OnConfiguring` override in your part of the class. A second override would not compile, so
the generator leaves its own out and reports this instead.

## Diagnostic Message

```
'{DbContext}' overrides OnConfiguring, which Whizbang generates for it; move this configuration into 'partial void OnConfiguringExtended(DbContextOptionsBuilder optionsBuilder)', which the generated OnConfiguring calls
```

## How to Fix

Move the body of your override into `OnConfiguringExtended`. The generated `OnConfiguring` calls it before Whizbang's
own configuration, so a provider you set there gets what strongly-typed ids need.

### Before (causes WHIZ704)

```csharp{title="A context that overrides OnConfiguring" description="The override collides with the OnConfiguring the generated partial declares." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "ef-core", "error"] testFile="EFCoreServiceRegistrationGeneratorTests.cs" testMethod="Generator_WithDbContextThatOverridesOnConfiguring_ReportsWhiz704Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/EFCoreServiceRegistrationGeneratorTests.cs" tests=["EFCoreServiceRegistrationGeneratorTests.Generator_WithDbContextThatOverridesOnConfiguring_ReportsWhiz704Async"]}
[WhizbangDbContext]
public partial class OrdersDbContext : DbContext {
  protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder) =>  // WHIZ704
    optionsBuilder.EnableSensitiveDataLogging();
}
```

### After

```csharp{title="The configuration in OnConfiguringExtended" description="The generated OnConfiguring calls the hook, then configures what strongly-typed ids need." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "ef-core"] testFile="EFCoreServiceRegistrationGeneratorTests.cs" testMethod="Generator_WithDiscoveredDbContext_GeneratesOnConfiguringThatConfiguresAfterTheBaseAndTheHookAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/EFCoreServiceRegistrationGeneratorTests.cs" tests=["EFCoreServiceRegistrationGeneratorTests.Generator_WithDiscoveredDbContext_GeneratesOnConfiguringThatConfiguresAfterTheBaseAndTheHookAsync"]}
[WhizbangDbContext]
public partial class OrdersDbContext : DbContext {
  partial void OnConfiguringExtended(DbContextOptionsBuilder optionsBuilder) =>
    optionsBuilder.EnableSensitiveDataLogging();
}
```

A base context of yours may still override `OnConfiguring`: the generated override calls it first.

## Related

- [WhizbangIds: Ids in a perspective document](../../fundamentals/identity/whizbang-ids#stored-form)
- [WHIZ703: No DbContext Found](whiz703)
