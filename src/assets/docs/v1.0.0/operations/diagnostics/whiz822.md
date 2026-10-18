---
title: 'WHIZ822: Index Name Exceeds Database Limit'
pageType: troubleshooting
verifiedAgainstCommit: 9a416b5b
verifiedDate: 2026-10-17
description: >-
  Build error when the index name generated for an indexed or unique physical field, ix_{table}_{column}, is
  longer than the database allows (63 bytes on PostgreSQL).
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - perspectives
  - physical-fields
  - indexes
  - identifier-limits
codeReferences:
  - src/Whizbang.Data.EFCore.Postgres.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCorePerspectiveConfigurationGenerator.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/Limits/PostgresLimits.cs
  - src/Whizbang.Generators.Shared/Utilities/IdentifierValidation.cs
testReferences:
  - tests/Whizbang.Generators.Tests/EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.cs
lastMaintainedCommit: '9a416b5b'
---

# WHIZ822: Index Name Exceeds Database Limit

**Severity**: Error
**Category**: Identifier Limits

## Description

When a [physical field](../../fundamentals/perspectives/physical-fields) is indexed, the EF Core perspective
configuration generator checks the index name `ix_{table}_{column}` against the database's identifier limit
(63 bytes on PostgreSQL, which silently truncates longer names). Because the name joins the table name and the
column name, it can be too long even when each part is within the limit on its own.

The check runs for a field that is indexed (`[Indexed]`) or unique
(`[PhysicalField(Unique = true)]`). A `[PolymorphicDiscriminator]` column is always indexed, so it is always
checked. The check counts UTF-8 bytes and fails when the count is **greater than** the limit. When it fails,
the generator reports WHIZ822 and leaves the whole perspective out of the generated model configuration.

## Diagnostic Message

```
Index '{IndexName}' for physical field '{PropertyName}' on perspective model '{ModelType}' ({ByteCount} bytes) exceeds {Provider} limit of {Limit} bytes. Shorten the table or column name.
```

`{ModelType}` is fully qualified. `{Provider}` is `PostgreSQL`, or `PostgreSQL (override: N)` when
`WhizbangMaxIdentifierLength` is set (see [WHIZ820](whiz820#overriding-the-limit)).

## Common Causes

1. **A long model name and a long property name together** on an indexed field.
2. **A unique field**, which is checked like an indexed one.
3. **A discriminator column** on a model with a long table name.

## How to Fix

{verified: EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.Generator_WithLongIndexName_EmitsWHIZ822ErrorAsync, EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.Generator_WithShortIndexName_DoesNotEmitWHIZ822ErrorAsync}

Shorten either part of `ix_{table}_{column}`:

- **The table name**: rename the model or strip its suffix (see [WHIZ820](whiz820#how-to-fix)).
- **The column name**: shorten the property, or set a shorter `ColumnName` on the attribute.

Count before you rename: `ix_` (3 bytes) + table name + `_` (1 byte) + column name must be 63 bytes or less.

### Before

```csharp{title="An indexed field whose index name is too long" description="The index ix_wh_per_long_model_name_for_table_that_will_cause_index_name_overflow_some_reasonably_long_property_name_for_column is 117 bytes." framework="NET10" category="Diagnostics" difficulty="INTERMEDIATE" tags=["diagnostics", "indexes", "identifier-limits", "whiz822"] testFile="EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.cs" testMethod="Generator_WithLongIndexName_EmitsWHIZ822ErrorAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.cs" tests=["EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.Generator_WithLongIndexName_EmitsWHIZ822ErrorAsync"]}
public record LongModelNameForTableThatWillCauseIndexNameOverflow {
  public string Name { get; init; } = "";

  [PhysicalField]
  [Indexed]
  public string SomeReasonablyLongPropertyNameForColumn { get; init; } = "";  // WHIZ822
}

public class TestPerspective(IPerspectiveStore<LongModelNameForTableThatWillCauseIndexNameOverflow> store)
  : IPerspectiveFor<LongModelNameForTableThatWillCauseIndexNameOverflow, ProductCreated> {
  public LongModelNameForTableThatWillCauseIndexNameOverflow Apply(
      LongModelNameForTableThatWillCauseIndexNameOverflow currentData, ProductCreated @event) => currentData;
}
```

The column (`some_reasonably_long_property_name_for_column`, 45 bytes) is within the limit, but the index name
is not. In this sample the table name itself is 68 bytes, so the same build also reports
[WHIZ820](whiz820).

### After

```csharp{title="An indexed field with a short index name" description="ix_wh_per_product_status is well inside the limit." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "indexes", "identifier-limits", "whiz822"] testFile="EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.cs" testMethod="Generator_WithShortIndexName_DoesNotEmitWHIZ822ErrorAsync" githubUrl="https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Generators.Tests/EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.cs" tests=["EFCorePerspectiveConfigurationGeneratorDiagnosticsTests.Generator_WithShortIndexName_DoesNotEmitWHIZ822ErrorAsync"]}
public record ProductDto {
  public string Name { get; init; } = "";

  [PhysicalField]
  [Indexed]
  public string Status { get; init; } = "";
}

public class ProductPerspective(IPerspectiveStore<ProductDto> store)
  : IPerspectiveFor<ProductDto, ProductCreated> {
  public ProductDto Apply(ProductDto currentData, ProductCreated @event) => currentData;
}
```

## Related

- [Physical Fields](../../fundamentals/perspectives/physical-fields)
- [Database Identifier Limits](../infrastructure/database-limits)
- [WHIZ820: Table Name Exceeds Database Limit](whiz820)
- [WHIZ821: Column Name Exceeds Database Limit](whiz821)
