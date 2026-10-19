---
title: 'WHIZ833: Stored-Form Migrations Share an Order'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning when two or more custom stored-form migrations of one perspective model explicitly state the same
  Order, so they run in class-name order, which renaming a class would change.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - perspectives
  - stored-forms
  - migrations
  - ordering
codeReferences:
  - src/Whizbang.Data.EFCore.Postgres.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCoreServiceRegistrationGenerator.cs
  - src/Whizbang.Core/Perspectives/IStoredFormMigration.cs
testReferences:
  - tests/Whizbang.Generators.Tests/StoredFormMigrationGenerationTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ833: Stored-Form Migrations Share an Order

**Severity**: Warning
**Category**: Stored-Form Migrations

## Description

[Custom stored-form migrations](../../fundamentals/perspectives/stored-form-migrations#custom-order) of one
table run after its generated migrations, lowest `Order` first. Migrations with the same `Order` still run
in a stable order, the full names of their classes, but that order is an accident of naming rather than a
decision: renaming a class would change it.

This warning is reported when two or more custom migrations of the same perspective model **explicitly state**
the same `Order`. It is reported once per shared value, listing every migration that shares it.

It is **not** reported for:

- migrations that state no `Order` (they all take the default, 0, and run in class-name order as they always
  have),
- migrations of different models that happen to use the same number,
- a migration already reported as [WHIZ831](whiz831), or one whose model is not a perspective's model.

An `Order` implemented explicitly (`int IStoredFormMigration.Order => 20;`) or inherited from a base class
counts as stated.

## Diagnostic Message

```
The stored-form migrations {MigrationClasses} of {Model} share Order {Order}, so they run in class-name order. Give each its own Order.
```

`{MigrationClasses}` is a comma-separated list in the order they will run, for example
`TestApp.C_Tied, TestApp.D_Tied`. `{Model}` is the perspective model whose table they run against.

## Common Causes

1. **Two migrations written in the same release** that both copied `Order => 20` from an example.
2. **A new migration slotted at a number already in use** instead of into a gap.

## How to Fix

{verified: StoredFormMigrationGenerationTests.TwoMigrationsOfOneTableSharingAnOrder_AreWHIZ833_OncePerSharedOrderAsync, StoredFormMigrationGenerationTests.CustomMigrations_RunByTheirOrder_ThenByClassNameAsync}

Decide which runs first and give each its own `Order`. Leave gaps (10, 20, 30) so a later migration can go
between two earlier ones.

Changing the `Order` of a migration that has already run somewhere does not run it again: a migration runs
once and is journaled under its `Name`. The new order applies to databases where it has not run yet.

### Before

```csharp{title="Two migrations of one table with the same Order" description="C_Tied and D_Tied both state Order 20 for OModel, so WHIZ833 is reported once." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "stored-forms", "order", "whiz833"] testFile="StoredFormMigrationGenerationTests.cs" testMethod="TwoMigrationsOfOneTableSharingAnOrder_AreWHIZ833_OncePerSharedOrderAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/StoredFormMigrationGenerationTests.cs" tests=["StoredFormMigrationGenerationTests.TwoMigrationsOfOneTableSharingAnOrder_AreWHIZ833_OncePerSharedOrderAsync"]}
public sealed class C_Tied : IStoredFormMigration<OModel> {
  public string Name => "c";
  int IStoredFormMigration.Order => 20;
  public string BuildSql(StoredFormMigrationTarget target) => "SELECT 1";
}

public sealed class D_Tied : IStoredFormMigration<OModel> {
  public string Name => "d";
  public int Order { get { return 20; } }
  public string BuildSql(StoredFormMigrationTarget target) => "SELECT 1";
}

// Not part of the warning: another model may use the same number.
public sealed class P_Same : IStoredFormMigration<PModel> {
  public string Name => "p";
  public int Order => 20;
  public string BuildSql(StoredFormMigrationTarget target) => "SELECT 1";
}
```

### After

```csharp{title="Each migration with its own Order" description="Distinct orders run lowest first, whatever the class names; migrations that state no Order are not reported." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "stored-forms", "order", "whiz833"] testFile="StoredFormMigrationGenerationTests.cs" testMethod="CustomMigrations_RunByTheirOrder_ThenByClassNameAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/StoredFormMigrationGenerationTests.cs" tests=["StoredFormMigrationGenerationTests.CustomMigrations_RunByTheirOrder_ThenByClassNameAsync"]}
public sealed class B_First : IStoredFormMigration<OModel> {
  public string Name => "b";
  public int Order { get; } = -10;
  public string BuildSql(StoredFormMigrationTarget target) => "SELECT 1";
}

public sealed class F_Arrow : IStoredFormMigration<OModel> {
  public string Name => "f";
  public int Order { get => 25; }
  public string BuildSql(StoredFormMigrationTarget target) => "SELECT 1";
}

public sealed class A_Last : IStoredFormMigration<OModel> {
  public string Name => "a";
  public int Order => Orders.LATE;  // const int LATE = 30
  public string BuildSql(StoredFormMigrationTarget target) => "SELECT 1";
}
```

## Suppressing

The warning is reported at the first class, in class-name order, of the migrations named in the message. A
`#pragma` region around that class silences it for that shared value:

```csharp{title="Suppress WHIZ833 for one shared Order" description="A pragma region around the first migration, by class name, of those that share an Order." category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "stored-forms", "suppression", "whiz833"] unverified="suppression/config, not exercised by a test"}
#pragma warning disable WHIZ833
public sealed class C_Tied : IStoredFormMigration<OModel> {
  public string Name => "c";
  int IStoredFormMigration.Order => 20;
  public string BuildSql(StoredFormMigrationTarget target) => "SELECT 1";
}
#pragma warning restore WHIZ833
```

A `[*.cs]` section in `.editorconfig` with `dotnet_diagnostic.WHIZ833.severity = none` also applies. To turn it off
for the whole project, set the severity in a global analyzer config, or add the ID to `<NoWarn>` in the project:

```ini{title="Suppress WHIZ833 project-wide" description="A global analyzer config turns the warning off for the whole project."}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ833.severity = none
```

Suppress it only when the migrations are truly independent and their relative order does not matter. If it
does matter, an explicit `Order` is the only thing that keeps it from changing on a rename.

## Related

- [Ordering custom migrations](../../fundamentals/perspectives/stored-form-migrations#custom-order)
- [Order within a table](../../fundamentals/perspectives/stored-form-migrations#order)
- [WHIZ831: Stored-Form Migration Never Runs](whiz831)
- [WHIZ830: Stored-Form Migration Cannot Be Generated](whiz830)
