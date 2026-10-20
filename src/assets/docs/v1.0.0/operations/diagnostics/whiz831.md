---
title: 'WHIZ831: Stored-Form Migration Never Runs'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning when a custom IStoredFormMigration class can never run: its model is not any perspective's model,
  the generated code cannot create it, or its Order is not a compile-time constant.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - perspectives
  - stored-forms
  - migrations
  - source-generator
codeReferences:
  - src/Whizbang.Data.EFCore.Postgres.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCoreServiceRegistrationGenerator.cs
  - src/Whizbang.Core/Perspectives/IStoredFormMigration.cs
testReferences:
  - tests/Whizbang.Generators.Tests/StoredFormMigrationGenerationTests.cs
  - tests/Whizbang.Generators.Tests/StoredFormDiscoveryBranchTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ831: Stored-Form Migration Never Runs

**Severity**: Warning
**Category**: Stored-Form Migrations

## Description

A [custom stored-form migration](../../fundamentals/perspectives/stored-form-migrations#custom) is a class
implementing `IStoredFormMigration<TModel>`. The generator finds it at build time and emits a call that
creates it with its parameterless constructor and runs its SQL against the table of the perspective whose
model is `TModel`, in the place its `Order` says.

This warning means the generator found such a class but cannot emit that call, so **the migration is not
registered and never runs**. The stored documents it was meant to convert stay as they are.

An abstract class implementing the interface is a base for migrations, not one, and is passed over without a
warning.

## Diagnostic Message

```
{MigrationClass} is a stored-form migration that never runs: {Reason}
```

`{Reason}` is one of:

| Reason in the message | Cause |
|---|---|
| `{Model} is not the model of any perspective` | `TModel` is not the model of any `IPerspectiveFor<TModel, ...>` |
| `a generic class cannot be created by the generated code` | The class has type parameters |
| `it has no public or internal parameterless constructor` | Only constructors with parameters, or a private or protected parameterless one |
| `it is not visible to the generated code (make it public or internal)` | The class, or a class it is nested in, is private or protected |
| `its Order is not a compile-time constant (return a literal or a const), so the build cannot place it` | `Order` is computed, has a statement body other than a single `return`, or is an auto-property without an initializer (`{ get; }` or `{ get; set; }`) |

The build reads a stated `Order` from an expression body (`=> 10`), a getter that only returns it
(`get { return 10; }`), or an initializer (`{ get; } = 10`), using a literal or a `const`. A migration that
does not implement `Order` at all takes the interface default, 0, and is not reported.

## Common Causes

1. **The model was renamed or its perspective removed**, leaving a migration aimed at a type no perspective
   uses.
2. **A migration with constructor dependencies**: the generated code only calls a parameterless constructor.
3. **A private nested migration class.**
4. **An `Order` written as an auto-property** (`public int Order { get; set; }`) or computed from something.

## How to Fix

{verified: StoredFormMigrationGenerationTests.ADeclarationInsideACollectionElement_IsWHIZ832_AndAnOrphanMigrationWHIZ831Async, StoredFormMigrationGenerationTests.EdgeDeclarations_AreGeneratedOrReported_AndMigrationsThatCannotBeCreatedAreWHIZ831Async, StoredFormMigrationGenerationTests.AnOrderThatIsNotAConstant_IsWHIZ831_AndTheMigrationIsNotEmittedAsync, StoredFormDiscoveryBranchTests.CustomMigrationWithAPrivateParameterlessConstructor_IsWHIZ831Async}

- **Point it at a perspective's model**, or delete it if the model is gone.
- **Give it a public or internal parameterless constructor**, make it non-generic, and make it (and any class
  it is nested in) public or internal. Build the SQL from the `StoredFormMigrationTarget` passed to `BuildSql`
  rather than from injected services.
- **State `Order` as a constant**: `public int Order => 10;`, or remove it to take the default.

### Before

```csharp{title="A migration whose model no perspective uses" description="UnusedModel is not a perspective's model, so Orphan never runs and is reported as WHIZ831." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "stored-forms", "migrations", "whiz831"] testFile="StoredFormMigrationGenerationTests.cs" testMethod="ADeclarationInsideACollectionElement_IsWHIZ832_AndAnOrphanMigrationWHIZ831Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/StoredFormMigrationGenerationTests.cs" tests=["StoredFormMigrationGenerationTests.ADeclarationInsideACollectionElement_IsWHIZ832_AndAnOrphanMigrationWHIZ831Async"]}
public record UnusedModel(string Name);

// WHIZ831: TestApp.Orphan is a stored-form migration that never runs:
// TestApp.UnusedModel is not the model of any perspective
public sealed class Orphan : IStoredFormMigration<UnusedModel> {
  public string Name => "orphan";
  public string BuildSql(StoredFormMigrationTarget target) => "SELECT 1";
}
```

An `Order` the build cannot read is reported the same way:

```csharp{title="Orders the build cannot read" description="Each of these migrations is reported as WHIZ831 and is not emitted." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "stored-forms", "order", "whiz831"] testFile="StoredFormMigrationGenerationTests.cs" testMethod="AnOrderThatIsNotAConstant_IsWHIZ831_AndTheMigrationIsNotEmittedAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/StoredFormMigrationGenerationTests.cs" tests=["StoredFormMigrationGenerationTests.AnOrderThatIsNotAConstant_IsWHIZ831_AndTheMigrationIsNotEmittedAsync"]}
public sealed class Settable : IStoredFormMigration<VModel> {
  public string Name => "settable";
  public int Order { get; set; }  // not a constant
  public string BuildSql(StoredFormMigrationTarget target) => "SELECT 1";
}

public sealed class Text : IStoredFormMigration<VModel> {
  public string Name => "text";
  public int Order => "x".Length;  // computed
  public string BuildSql(StoredFormMigrationTarget target) => "SELECT 1";
}
```

### After

```csharp{title="A migration that runs" description="OrderModel is a perspective's model and the class has an implicit public parameterless constructor, so the migration is registered." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "stored-forms", "migrations", "whiz831"] testFile="StoredFormMigrationGenerationTests.cs" testMethod="Migrations_RunRenamesThenConversionsThenDefaultsThenRemovals_ThenCustomByNameWithoutAnOrderAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/StoredFormMigrationGenerationTests.cs" tests=["StoredFormMigrationGenerationTests.Migrations_RunRenamesThenConversionsThenDefaultsThenRemovals_ThenCustomByNameWithoutAnOrderAsync"]}
public class OrderPerspective : IPerspectiveFor<OrderModel, OrderEvent> {
  public OrderModel Apply(OrderModel currentData, OrderEvent @event) => currentData;
}

public sealed class AnotherOne : IStoredFormMigration<OrderModel> {
  public string Name => "2026-09-another";
  public string BuildSql(StoredFormMigrationTarget target) => "SELECT 1";
}
```

## Suppressing

The warning is reported at the custom migration class's name, so a `#pragma` region around that class silences
it for that migration only:

```csharp{title="Suppress WHIZ831 for one migration" description="A pragma region around a migration class kept on purpose." category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "stored-forms", "suppression", "whiz831"] unverified="suppression/config, not exercised by a test"}
#pragma warning disable WHIZ831
public sealed class Orphan : IStoredFormMigration<UnusedModel> {
  public string Name => "orphan";
  public string BuildSql(StoredFormMigrationTarget target) => "SELECT 1";
}
#pragma warning restore WHIZ831
```

A `[*.cs]` section in `.editorconfig` with `dotnet_diagnostic.WHIZ831.severity = none` also applies. To turn it off
for the whole project, set the severity in a global analyzer config, or add the ID to `<NoWarn>` in the project:

```ini{title="Suppress WHIZ831 project-wide" description="A global analyzer config turns the warning off for the whole project."}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ831.severity = none
```

Suppressing does not make the migration run. It is appropriate only for a class you keep on purpose and do not
expect to run, and even then deleting it is clearer.

## Related

- [Custom migrations](../../fundamentals/perspectives/stored-form-migrations#custom)
- [Ordering custom migrations](../../fundamentals/perspectives/stored-form-migrations#custom-order)
- [WHIZ830: Stored-Form Migration Cannot Be Generated](whiz830)
- [WHIZ832: Stored-Form Declaration Inside a Collection Element](whiz832)
- [WHIZ833: Stored-Form Migrations Share an Order](whiz833)
