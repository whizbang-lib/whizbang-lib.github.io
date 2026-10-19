---
title: 'WHIZ830: Stored-Form Migration Cannot Be Generated'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Build error when a [StoredForm] or [StoredFormRemoved] declaration describes a change the generator cannot
  turn into SQL. Nothing is generated for it; write an IStoredFormMigration instead.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - perspectives
  - stored-forms
  - migrations
  - source-generator
codeReferences:
  - src/Whizbang.Data.EFCore.Postgres.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCoreServiceRegistrationGenerator.cs
  - src/Whizbang.Generators.Shared/Models/StoredFormDiscovery.cs
  - src/Whizbang.Core/Perspectives/StoredFormAttribute.cs
  - src/Whizbang.Core/Perspectives/StoredFormRemovedAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/StoredFormMigrationGenerationTests.cs
  - tests/Whizbang.Generators.Tests/StoredFormDiscoveryBranchTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ830: Stored-Form Migration Cannot Be Generated

**Severity**: Error
**Category**: Stored-Form Migrations

## Description

A [stored-form declaration](../../fundamentals/perspectives/stored-form-migrations) tells the framework how
the documents already stored for a perspective changed shape: `[StoredForm(Previously = ...)]` for a type
change, `[StoredForm(PreviousName = ...)]` for a rename, `[StoredForm(DefaultWhenMissing = ...)]` for a
default, and `[StoredFormRemoved("Path")]` for a removed key. The generator turns each one into a journaled
SQL migration that runs at startup.

This error means one declaration describes something the generator has no conversion for. **Nothing is
generated for that declaration**, so without this error the stored documents would silently stay in the old
form. It is an error rather than a warning for that reason.

It is reported once per declaration, however many `DbContext`s include the model. It is reported at the property
carrying `[StoredForm]`, or at the `[StoredFormRemoved]` attribute for a removal.

## Diagnostic Message

```
The stored-form declaration on {Model}.{Path} cannot be generated: {Reason}. Write an IStoredFormMigration for it.
```

`{Reason}` is one of:

| Reason in the message | Declared |
|---|---|
| `no generated conversion from {From} to {To}` | `Previously` with a pair the generator does not convert, such as `Guid` to `int`, `bool` to `int`, or a class to `string` |
| `Previously is the property's current type ({Type})` | `Previously` naming the type the property already has |
| `a [Flags] enum over ulong cannot be converted from a string, because its combinations are computed in bigint` | `Previously = typeof(string)` on a `[Flags]` enum whose underlying type is `ulong` |
| `PreviousName '{Name}' is not a property key` | `PreviousName` that is not a valid key, such as one containing spaces |
| `the removed path is not a property key (keys separated by dots)` | `[StoredFormRemoved]` with an empty or invalid path, or with no path at all |
| `a default is written only for a string, number, bool or enum property` | `DefaultWhenMissing` on a property of another type, such as a nested object |
| `the default {Value} is not a value of the property's type ({Type})` | `DefaultWhenMissing` whose value does not fit the property, such as `"x"` or `2.5` on an `int`, or an enum member of another enum |
| `a default on a physical field of a Split model lives only in its column, which a document default cannot reach` | `DefaultWhenMissing` on a `[PhysicalField]` of a `[PerspectiveStorage(FieldStorageMode.Split)]` model |

The pairs the generator **does** convert are listed in
[What the generator converts](../../fundamentals/perspectives/stored-form-migrations#type-changes).

## Common Causes

1. **A type change between unrelated types**, such as an identifier that moved from `Guid` to `int`.
2. **A leftover `Previously`** after the property was changed back to its old type.
3. **A default of the wrong type**, such as a string literal on a numeric property.
4. **A default on a Split model's promoted field**, whose value lives only in its column.

## How to Fix

{verified: StoredFormMigrationGenerationTests.ADeclarationItCannotGenerate_IsWHIZ830_AndEmitsNothingAsync, StoredFormMigrationGenerationTests.ADefaultOnASplitPhysicalField_IsWHIZ830Async, StoredFormMigrationGenerationTests.EachTypeChange_BecomesAStepFromTheFormerTypeToTheCurrentAsync}

- **Correct the declaration** when it is a mistake (a wrong `Previously`, a default of the wrong type, a
  malformed path).
- **Otherwise remove it and write a
  [custom migration](../../fundamentals/perspectives/stored-form-migrations#custom)**: a class implementing
  `IStoredFormMigration<TModel>` whose `BuildSql` converts the stored documents. A custom migration covers any
  change.

### Before

```csharp{title="A type change the generator cannot convert" description="Guid to int has no generated conversion, so the build fails with WHIZ830 and nothing is emitted for Bad." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "stored-forms", "migrations", "whiz830"] testFile="StoredFormMigrationGenerationTests.cs" testMethod="ADeclarationItCannotGenerate_IsWHIZ830_AndEmitsNothingAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/StoredFormMigrationGenerationTests.cs" tests=["StoredFormMigrationGenerationTests.ADeclarationItCannotGenerate_IsWHIZ830_AndEmitsNothingAsync"]}
public record BadModel {
  [StreamId]
  public Guid Id { get; init; }

  // WHIZ830: no generated conversion from Guid to Int32
  [StoredForm(Previously = typeof(Guid))]
  public int Bad { get; init; }
}

public class BadPerspective : IPerspectiveFor<BadModel, BadEvent> {
  public BadModel Apply(BadModel currentData, BadEvent @event) => currentData;
}
```

### After

```csharp{title="A type change the generator converts" description="string to int is a generated conversion: numeric strings become numbers at startup." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "stored-forms", "migrations", "whiz830"] testFile="StoredFormMigrationGenerationTests.cs" testMethod="EachTypeChange_BecomesAStepFromTheFormerTypeToTheCurrentAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/StoredFormMigrationGenerationTests.cs" tests=["StoredFormMigrationGenerationTests.EachTypeChange_BecomesAStepFromTheFormerTypeToTheCurrentAsync"]}
public record OrderModel {
  [StreamId]
  public Guid Id { get; init; }

  [StoredForm(Previously = typeof(string))]
  public int Quantity { get; init; }
}
```

For a pair with no generated conversion, remove the declaration and write an `IStoredFormMigration<BadModel>`
instead; see [Custom migrations](../../fundamentals/perspectives/stored-form-migrations#custom).

## Related

- [Stored-Form Migrations](../../fundamentals/perspectives/stored-form-migrations)
- [The stored-form rewrite](../infrastructure/migrations#the-stored-form-rewrite)
- [WHIZ831: Stored-Form Migration Never Runs](whiz831)
- [WHIZ832: Stored-Form Declaration Inside a Collection Element](whiz832)
- [WHIZ833: Stored-Form Migrations Share an Order](whiz833)
- [WHIZ812: Perspective Model Declares a JSON Converter That Is Never Consulted](whiz812)
