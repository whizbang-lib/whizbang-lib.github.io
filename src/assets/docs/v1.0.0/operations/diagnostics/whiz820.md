---
title: 'WHIZ820: Table Name Exceeds Database Limit'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Build error when the table name generated for a perspective model is longer than the database allows
  (63 bytes on PostgreSQL). The perspective is left out of the generated model configuration.
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
testReferences:
  - tests/Whizbang.Generators.Tests/EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.cs
  - tests/Whizbang.Generators.Tests/EFCorePerspectiveConfigurationGeneratorCoverageTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ820: Table Name Exceeds Database Limit

**Severity**: Error
**Category**: Identifier Limits

## Description

Every perspective gets a table named after its model type: the `wh_per_` prefix plus the model name in
snake_case, after any configured suffix (`ReadModel`, `Model`, `Projection`, `Dto`, `View` by default) is
stripped. See [Perspective Table Naming](../../fundamentals/perspectives/table-naming). PostgreSQL silently
truncates an identifier longer than 63 bytes, so two long model names could end up on the same table. The
EF Core perspective configuration generator checks the name at build time instead.

The check counts UTF-8 bytes, not characters, and fails when the count is **greater than** the limit, so a
63-byte name passes. When it fails, the generator reports WHIZ820 and leaves that perspective out of the
generated model configuration; the other perspectives are still generated.

Every uppercase letter becomes its own snake_case segment, so acronyms grow the name: `APIUsage` becomes
`a_p_i_usage`.

## Diagnostic Message

```
Perspective model '{ModelType}' generates table name '{TableName}' ({ByteCount} bytes) which exceeds {Provider} limit of {Limit} bytes. Shorten the model name or configure suffix stripping.
```

`{ModelType}` is fully qualified. `{Provider}` is `PostgreSQL`, or `PostgreSQL (override: N)` when the limit
is overridden (see below).

## Common Causes

1. **A long, descriptive model type name**, such as one that spells out its purpose in full.
2. **A suffix that is not stripped**, because suffix stripping is off or the suffix is not in the list.
3. **Acronyms in the name**, each uppercase letter adding an underscore.
4. **A nested model type**, whose containing type's name is merged into the base name.

## How to Fix

{verified: EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.Generator_WithLongTableName_EmitsWHIZ820ErrorAsync, EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.Generator_WithShortTableName_DoesNotEmitWHIZ820ErrorAsync, EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.Generator_WithIdentifierError_ExcludesPerspectiveFromOutputAsync}

- **Rename the model type.** The table name follows it. There is no per-perspective attribute for an
  explicit table name.
- **Strip a suffix.** Add the model's suffix to `WhizbangTableNameSuffixesToStrip`, or turn stripping back
  on with `WhizbangStripTableNameSuffixes`.
- **Only for a server built with a different identifier length**, set `WhizbangMaxIdentifierLength` to that
  server's limit. A smaller value tightens the check, a larger one relaxes it.

Renaming the model of a perspective that already has data renames its table; see
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

### Overriding the limit

The generator reads `build_property.WhizbangMaxIdentifierLength` (a positive integer; anything else is
ignored). At this commit no Whizbang package registers it as a compiler-visible property, so declare that too:

```xml{title="Override the identifier limit" description="For a PostgreSQL server built with a different NAMEDATALEN only." tests=["EFCorePerspectiveConfigurationGeneratorCoverageTests.Generator_WithSmallMaxIdentifierOverride_ReportsWHIZ820AgainstOverrideAsync", "EFCorePerspectiveConfigurationGeneratorCoverageTests.Generator_WithLargeMaxIdentifierOverride_AllowsLongTableNameAsync"]}
<PropertyGroup>
  <WhizbangMaxIdentifierLength>128</WhizbangMaxIdentifierLength>
</PropertyGroup>
<ItemGroup>
  <CompilerVisibleProperty Include="WhizbangMaxIdentifierLength" />
</ItemGroup>
```

The override applies to table, column and index names alike. Raising it above what your server accepts brings
back the truncation this check prevents.

## Related

- [Perspective Table Naming](../../fundamentals/perspectives/table-naming)
- [Database Identifier Limits](../infrastructure/database-limits)
- [WHIZ821: Column Name Exceeds Database Limit](whiz821)
- [WHIZ822: Index Name Exceeds Database Limit](whiz822)
