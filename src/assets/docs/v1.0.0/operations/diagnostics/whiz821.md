---
title: 'WHIZ821: Column Name Exceeds Database Limit'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Build error when the column generated for a physical field is longer than the database allows (63 bytes on
  PostgreSQL). The perspective is left out of the generated model configuration.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - perspectives
  - physical-fields
  - identifier-limits
  - source-generator
codeReferences:
  - src/Whizbang.Data.EFCore.Postgres.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCorePerspectiveConfigurationGenerator.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/Limits/PostgresLimits.cs
  - src/Whizbang.Generators.Shared/Utilities/IdentifierValidation.cs
testReferences:
  - tests/Whizbang.Generators.Tests/EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ821: Column Name Exceeds Database Limit

**Severity**: Error
**Category**: Identifier Limits

## Description

A [physical field](../../fundamentals/perspectives/physical-fields) gets its own column on the perspective's
table. The column is named by the attribute's `ColumnName`, or by the property name in snake_case when none is
given. PostgreSQL silently truncates an identifier longer than 63 bytes, so the EF Core perspective
configuration generator checks every such column name at build time.

The check covers each property marked `[PhysicalField]`, `[VectorField]` or `[PolymorphicDiscriminator]`. It
counts UTF-8 bytes and fails when the count is **greater than** the limit. When it fails, the generator
reports WHIZ821 and leaves the whole perspective out of the generated model configuration.

## Diagnostic Message

```
Physical field '{PropertyName}' on perspective model '{ModelType}' generates column name '{ColumnName}' ({ByteCount} bytes) which exceeds {Provider} limit of {Limit} bytes. Shorten the property name.
```

`{ModelType}` is fully qualified. `{Provider}` is `PostgreSQL`, or `PostgreSQL (override: N)` when
`WhizbangMaxIdentifierLength` is set (see [WHIZ820](whiz820#overriding-the-limit)).

## Common Causes

1. **A long property name** on a promoted field, which becomes an even longer snake_case column name.
2. **A long explicit `ColumnName`** on the attribute.
3. **Acronyms in the property name**, each uppercase letter adding an underscore.

## How to Fix

{verified: EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.Generator_WithLongColumnName_EmitsWHIZ821ErrorAsync, EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.Generator_WithShortColumnName_DoesNotEmitWHIZ821ErrorAsync}

- **Shorten the property name**, as the message says.
- **Or keep the property name and give the column a shorter one** with `ColumnName`, which
  `[PhysicalField]`, `[VectorField]` and `[PolymorphicDiscriminator]` all accept.

Renaming the column of a field that already holds data is a schema change; see
[Stored-Form Migrations: physical columns](../../fundamentals/perspectives/stored-form-migrations#physical-columns).

### Before

```csharp{title="A physical field whose column name is too long" description="The column very_long_property_name_that_will_exceed_the_sixty_three_byte_limit_for_postgres_column_names is 93 bytes." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "physical-fields", "identifier-limits", "whiz821"] testFile="EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.cs" testMethod="Generator_WithLongColumnName_EmitsWHIZ821ErrorAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.cs" tests=["EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.Generator_WithLongColumnName_EmitsWHIZ821ErrorAsync"]}
public record ProductDto {
  public string Name { get; init; } = "";

  [PhysicalField]
  [Indexed]
  public string VeryLongPropertyNameThatWillExceedTheSixtyThreeByteLimitForPostgresColumnNames { get; init; } = "";  // WHIZ821
}

public class ProductPerspective(IPerspectiveStore<ProductDto> store)
  : IPerspectiveFor<ProductDto, ProductCreated> {
  public ProductDto Apply(ProductDto currentData, ProductCreated @event) => currentData;
}
```

Because this field is also indexed, its index name (`ix_{table}_{column}`) is too long as well, and the same
build reports [WHIZ822](whiz822).

### After

```csharp{title="A physical field with a short column name" description="Status becomes the column status." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "physical-fields", "identifier-limits", "whiz821"] testFile="EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.cs" testMethod="Generator_WithShortColumnName_DoesNotEmitWHIZ821ErrorAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.cs" tests=["EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.Generator_WithShortColumnName_DoesNotEmitWHIZ821ErrorAsync"]}
public record ProductDto {
  public string Name { get; init; } = "";

  [PhysicalField]
  [Indexed]
  public string Status { get; init; } = "";
}
```

## Related

- [Physical Fields](../../fundamentals/perspectives/physical-fields)
- [Database Identifier Limits](../infrastructure/database-limits)
- [WHIZ820: Table Name Exceeds Database Limit](whiz820)
- [WHIZ822: Index Name Exceeds Database Limit](whiz822)
