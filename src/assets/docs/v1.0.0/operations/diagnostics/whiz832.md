---
title: 'WHIZ832: Stored-Form Declaration Inside a Collection Element'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Warning when a [StoredForm] or [StoredFormRemoved] declaration sits on a type used as the element of a
  collection. It has no single document path, so nothing is generated; write an IStoredFormMigration.
version: 1.0.0
category: Diagnostics
severity: Warning
tags:
  - diagnostics
  - perspectives
  - stored-forms
  - collections
  - source-generator
codeReferences:
  - src/Whizbang.Data.EFCore.Postgres.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCoreServiceRegistrationGenerator.cs
  - src/Whizbang.Generators.Shared/Models/StoredFormDiscovery.cs
testReferences:
  - tests/Whizbang.Generators.Tests/StoredFormMigrationGenerationTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ832: Stored-Form Declaration Inside a Collection Element

**Severity**: Warning
**Category**: Stored-Form Migrations

## Description

The generator turns a [stored-form declaration](../../fundamentals/perspectives/stored-form-migrations) into
a statement that converts one key at one path in every stored document, such as `Status` or
`Shipping.Line1`. It walks the model's own and inherited properties and the properties of nested objects it
reaches through a property.

When it reaches a type through a **collection**, the declarations on that type have no single path: the value
sits inside each element of an array (`Lines[].Sku`). The generator does not generate those. It reports
WHIZ832 for each one instead of ignoring it silently. A dictionary's values count as collection elements too
(`Entries[].X`).

Nothing is generated for the declaration, so stored elements keep their old form until you convert them
yourself. Declarations elsewhere on the model are still generated.

It is reported once per declaration, however many `DbContext`s include the model.

## Diagnostic Message

```
The stored-form declaration on {Model}.{Path} is not generated: it is inside an element of the collection {Collection}. Write an IStoredFormMigration for it.
```

`{Path}` marks the element with `[]`, for example `TestApp.OrderModel.Lines[].Sku`, and `{Collection}` is the
path of the collection property (`Lines`).

## Common Causes

1. **A `[StoredForm]` on a property of a list element type**, such as an order line's `Sku`.
2. **A `[StoredFormRemoved]` on a type** that the model holds in a list or as a dictionary value.
3. **A type used both directly and in a collection**: the declaration is generated where the type is reached
   directly and reported where it is reached through the collection.

## How to Fix

{verified: StoredFormMigrationGenerationTests.ADeclarationInsideACollectionElement_IsWHIZ832_AndAnOrphanMigrationWHIZ831Async, StoredFormMigrationGenerationTests.EdgeDeclarations_AreGeneratedOrReported_AndMigrationsThatCannotBeCreatedAreWHIZ831Async}

Write a [custom migration](../../fundamentals/perspectives/stored-form-migrations#custom) for the model whose
`BuildSql` rewrites the elements of the collection, then remove the declaration (it is not generated either
way).

### Before

```csharp{title="A declaration on a list element" description="Sku sits inside each element of Lines, so the declaration is reported as WHIZ832 and nothing is generated for it." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "stored-forms", "collections", "whiz832"] testFile="StoredFormMigrationGenerationTests.cs" testMethod="ADeclarationInsideACollectionElement_IsWHIZ832_AndAnOrphanMigrationWHIZ831Async" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/StoredFormMigrationGenerationTests.cs" tests=["StoredFormMigrationGenerationTests.ADeclarationInsideACollectionElement_IsWHIZ832_AndAnOrphanMigrationWHIZ831Async"]}
public record OrderLine {
  [StoredForm(Previously = typeof(int))]  // WHIZ832: OrderModel.Lines[].Sku
  public string Sku { get; init; } = "";
}

public record OrderModel {
  [StreamId]
  public Guid Id { get; init; }

  public List<OrderLine> Lines { get; init; } = [];
}
```

### After

```csharp{title="A custom migration for the elements" description="The declaration is removed and a custom migration on the model converts the elements; the class shape is the one the generator registers." framework="NET10" category="Diagnostics" difficulty="ADVANCED" tags=["diagnostics", "stored-forms", "collections", "whiz832"] testFile="StoredFormMigrationGenerationTests.cs" testMethod="Migrations_RunRenamesThenConversionsThenDefaultsThenRemovals_ThenCustomByNameWithoutAnOrderAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/StoredFormMigrationGenerationTests.cs" unverified="illustrative: the SQL body is yours to write; the linked test verifies that a custom migration of this shape is registered"}
public record OrderLine {
  public string Sku { get; init; } = "";
}

public sealed class OrderLineSkuToText : IStoredFormMigration<OrderModel> {
  // Stable forever: the journal records the migration under this name.
  public string Name => "2026-10-order-line-sku-to-text";

  public string BuildSql(StoredFormMigrationTarget target) =>
    /* your UPDATE of target.QualifiedTable, rewriting each element of data -> 'Lines' */ "SELECT 1";
}
```

## Suppressing

The warning is reported by a source generator with no source location, so a `#pragma warning disable` region
cannot reach it, and neither can a file-scoped `.editorconfig` section. Set the severity in a global analyzer
config, or add the ID to `<NoWarn>` in the project:

```ini{title="Suppress WHIZ832 project-wide" description="A global analyzer config applies to diagnostics with no source location."}
# .globalconfig
is_global = true
dotnet_diagnostic.WHIZ832.severity = none
```

Suppress it only when a custom migration already converts those elements and you keep the declaration as a
note. Suppressing does not generate anything.

## Related

- [Stored-Form Migrations: declaring a migration](../../fundamentals/perspectives/stored-form-migrations#declaring)
- [Custom migrations](../../fundamentals/perspectives/stored-form-migrations#custom)
- [WHIZ830: Stored-Form Migration Cannot Be Generated](whiz830)
- [WHIZ831: Stored-Form Migration Never Runs](whiz831)
