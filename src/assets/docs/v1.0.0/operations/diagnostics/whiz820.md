---
title: 'WHIZ820: Table Name Exceeds Database Limit'
pageType: troubleshooting
verifiedAgainstCommit: 3f239747
verifiedDate: 2026-10-26
description: >-
  Build error when a perspective model's table name, generated or set with [PerspectiveTable], is longer
  than the database allows (63 bytes on PostgreSQL). The perspective is left out of the generated model
  configuration.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - perspectives
  - table-naming
  - identifier-limits
  - source-generator
codeReferences:
  - src/Whizbang.Data.EFCore.Postgres.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCorePerspectiveConfigurationGenerator.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/Limits/PostgresLimits.cs
  - src/Whizbang.Generators.Shared/Utilities/IdentifierValidation.cs
  - src/Whizbang.Generators.Shared/Utilities/NamingConventionUtilities.cs
  - src/Whizbang.Generators.Shared/Utilities/ConfigurationUtilities.cs
  - src/Whizbang.Generators.Shared/Utilities/PerspectiveTableNaming.cs
  - src/Whizbang.Core/Perspectives/PerspectiveTableAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveTableNamingDiagnosticsTests.cs
  - tests/Whizbang.Generators.Tests/EFCorePerspectiveConfigurationGeneratorCoverageTests.cs
lastMaintainedCommit: '3f239747'
---

# WHIZ820: Table Name Exceeds Database Limit

**Severity**: Error
**Category**: Identifier Limits

## Description

Every perspective gets a table named after its model type: the `wh_per_` prefix plus the model name in
snake_case, after any configured suffix (`ReadModel`, `Model`, `Projection`, `Dto`, `View` by default) is
stripped, or the name its `[PerspectiveTable]` sets. See
[Perspective Table Naming](../../fundamentals/perspectives/table-naming). PostgreSQL silently truncates an
identifier longer than 63 bytes, so two long model names could end up on the same table. The EF Core
perspective configuration generator checks the name at build time instead, a name set with
`[PerspectiveTable]` included.

The check counts UTF-8 bytes, not characters, and fails when the count is **greater than** the limit, so a
63-byte name passes. When it fails, the generator reports WHIZ820 and leaves that perspective out of the
generated model configuration; the other perspectives are still generated.

Every uppercase letter becomes its own snake_case segment, so acronyms grow the name: `APIUsage` becomes
`a_p_i_usage`.

WHIZ820 is reported at the model type's declaration. The schema generator, which writes the Dapper driver's
DDL, reports the same condition as [WHIZ823](whiz823); in a project that references the EF Core driver it
leaves the check to this one, so the error is reported once.

## Diagnostic Message

```
Perspective model '{ModelType}' generates table name '{TableName}' ({ByteCount} bytes) which exceeds {Provider} limit of {Limit} bytes. Shorten the model name, configure suffix stripping, or name the table with [PerspectiveTable].
```

`{ModelType}` is fully qualified. `{Provider}` is `PostgreSQL`, or `PostgreSQL (override: N)` when the limit
is overridden (see below).

## Common Causes

1. **A long, descriptive model type name**, such as one that spells out its purpose in full.
2. **A suffix that is not stripped**, because suffix stripping is off or the suffix is not in the list.
3. **Acronyms in the name**, each uppercase letter adding an underscore.
4. **A nested model type**, whose containing type's name is merged into the base name.
5. **A `[PerspectiveTable]` name** that is itself longer than the limit.

## How to Fix

{verified: EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.Generator_WithLongTableName_EmitsWHIZ820ErrorAsync, PerspectiveTableNamingDiagnosticsTests.EFCoreGenerator_WithAManualNameOverTheLimit_ReportsWHIZ820NamingTheAttributeAsync, EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.Generator_WithShortTableName_DoesNotEmitWHIZ820ErrorAsync, EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.Generator_WithIdentifierError_ExcludesPerspectiveFromOutputAsync}

- **Rename the model type.** The table name follows it.
- **Name the table yourself** with `[PerspectiveTable("wh_per_...")]` on the model. The name is used exactly
  as written, so it must fit the limit too, and must be `wh_per_` followed by lowercase letters, digits and
  underscores ([WHIZ824](whiz824)). See
  [Explicit table names](../../fundamentals/perspectives/table-naming#explicit-table-names).
- **Strip a suffix.** Add the model's suffix to `WhizbangTableNameSuffixesToStrip`, or turn stripping back
  on with `WhizbangStripTableNameSuffixes`.
- **Only for a server built with a different identifier length**, set `WhizbangMaxIdentifierLength` to that
  server's limit. A smaller value tightens the check, a larger one relaxes it.

Changing the table name of a model that already has data (through a suffix setting or `[PerspectiveTable]`)
renames its table in place at the next start, keeping its rows; see
[Renaming Perspectives](../../fundamentals/perspectives/table-naming#renaming-perspectives).

### Before

```csharp{title="A model name too long for a table" description="wh_per_very_long_model_name_that_will_definitely_exceed_the_sixty_three_byte_limit_for_postgres is 95 bytes, over PostgreSQL's 63." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "table-naming", "identifier-limits", "whiz820"] testFile="EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.cs" testMethod="Generator_WithLongTableName_EmitsWHIZ820ErrorAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.cs" tests=["EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.Generator_WithLongTableName_EmitsWHIZ820ErrorAsync"]}
public record VeryLongModelNameThatWillDefinitelyExceedTheSixtyThreeByteLimitForPostgres(string Name);

public class TestPerspective(IPerspectiveStore<VeryLongModelNameThatWillDefinitelyExceedTheSixtyThreeByteLimitForPostgres> store)
  : IPerspectiveFor<VeryLongModelNameThatWillDefinitelyExceedTheSixtyThreeByteLimitForPostgres, ProductCreated> {
  public VeryLongModelNameThatWillDefinitelyExceedTheSixtyThreeByteLimitForPostgres Apply(
      VeryLongModelNameThatWillDefinitelyExceedTheSixtyThreeByteLimitForPostgres currentData, ProductCreated @event) => currentData;
}

public record ProductCreated : IEvent;
```

### After

```csharp{title="A short model name" description="ProductDto becomes the table wh_per_product, well inside the limit." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "table-naming", "identifier-limits", "whiz820"] testFile="EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.cs" testMethod="Generator_WithShortTableName_DoesNotEmitWHIZ820ErrorAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.cs" tests=["EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.Generator_WithShortTableName_DoesNotEmitWHIZ820ErrorAsync"]}
public record ProductDto(string Name);

public class ProductPerspective(IPerspectiveStore<ProductDto> store)
  : IPerspectiveFor<ProductDto, ProductCreated> {
  public ProductDto Apply(ProductDto currentData, ProductCreated @event) => currentData;
}

public record ProductCreated : IEvent;
```

### After, with a manual name

```csharp{title="Keep the long model name and name its table" description="[PerspectiveTable] sets a 25-byte table name while the model keeps its descriptive type name." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "table-naming", "perspective-table", "whiz820"] tests=["PerspectiveTableNameGoldenTests.EFCoreDriver_WithDefaultSettings_MapsTheGoldenTableNamesAsync", "PerspectiveTableNamingTests.TableName_WithAManualName_UsesItWhateverTheSettingsAsync"]}
[PerspectiveTable("wh_per_long_named_product")]
public record VeryLongModelNameThatWillDefinitelyExceedTheSixtyThreeByteLimitForPostgres(string Name);
```

### Overriding the limit

Set `WhizbangMaxIdentifierLength` in the project (a positive integer; anything else is ignored). The generator
packages declare it a compiler-visible property, so the setting reaches the generator:

```xml{title="Override the identifier limit" description="For a PostgreSQL server built with a different NAMEDATALEN only." tests=["EFCorePerspectiveConfigurationGeneratorCoverageTests.Generator_WithSmallMaxIdentifierOverride_ReportsWHIZ820AgainstOverrideAsync", "EFCorePerspectiveConfigurationGeneratorCoverageTests.Generator_WithLargeMaxIdentifierOverride_AllowsLongTableNameAsync"]}
<PropertyGroup>
  <WhizbangMaxIdentifierLength>128</WhizbangMaxIdentifierLength>
</PropertyGroup>
```

The override applies to table, column and index names alike. Raising it above what your server accepts brings
back the truncation this check prevents.

## Related

- [Perspective Table Naming](../../fundamentals/perspectives/table-naming)
- [Database Identifier Limits](../infrastructure/database-limits)
- [WHIZ821: Column Name Exceeds Database Limit](whiz821)
- [WHIZ822: Index Name Exceeds Database Limit](whiz822)
- [WHIZ823: Perspective Table Name Exceeds the Database Limit](whiz823) (schema generator)
- [WHIZ824: Invalid Perspective Table Name](whiz824)
- [WHIZ825: Two Perspective Models Share One Table Name](whiz825)
