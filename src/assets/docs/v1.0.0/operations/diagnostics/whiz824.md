---
title: 'WHIZ824: Invalid Perspective Table Name'
pageType: troubleshooting
verifiedAgainstCommit: 3f239747
verifiedDate: 2026-10-26
description: >-
  Build error when the name set with [PerspectiveTable] on a perspective model is not wh_per_ followed by
  lowercase ASCII letters, digits and underscores. No table is generated or mapped for that model.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - perspectives
  - table-naming
  - perspective-table
  - source-generator
codeReferences:
  - src/Whizbang.Generators.Shared/Utilities/PerspectiveTableNaming.cs
  - src/Whizbang.Core/Perspectives/PerspectiveTableAttribute.cs
  - src/Whizbang.Generators/PerspectiveSchemaGenerator.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCorePerspectiveConfigurationGenerator.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectiveTableNamingDiagnosticsTests.cs
  - tests/Whizbang.Generators.Tests/Utilities/PerspectiveTableNamingTests.cs
lastMaintainedCommit: '3f239747'
---

# WHIZ824: Invalid Perspective Table Name

**Severity**: Error
**Category**: Identifier Limits

## Description

`[PerspectiveTable]` names a perspective model's table exactly as written (see
[Explicit table names](../../fundamentals/perspectives/table-naming#explicit-table-names)). The name must be:

- `wh_per_`, the prefix the framework recognizes its perspective tables by,
- followed by **at least one** lowercase ASCII letter (`a` to `z`), digit or underscore, and nothing else.

The generated SQL writes the name unquoted, and PostgreSQL folds an unquoted name to lowercase, so a name with
uppercase letters would create one table and be read as another. Spaces, hyphens and other characters are not valid
unquoted identifiers at all.

Both generators check it. When the name is invalid, the generator reports WHIZ824 at the model's declaration: the
schema generator (Dapper DDL) generates no table for it, and the EF Core generator leaves it out of the generated model
configuration. A name that is valid but too long is [WHIZ823](whiz823) or [WHIZ820](whiz820) instead.

## Diagnostic Message

```
[PerspectiveTable("{TableName}")] on perspective model '{ModelType}' is not a valid table name: it must start with 'wh_per_' followed by lowercase letters, digits and underscores
```

A `null` argument is reported with an empty `{TableName}`.

## Common Causes

| Name | Why it is rejected |
|---|---|
| `Orders`, `orders` | No `wh_per_` prefix |
| `wh_per_` | Nothing after the prefix |
| `wh_per_Orders` | Uppercase letter |
| `wh_per_order-lines` | Hyphen |
| `wh_per_order lines` | Space |
| `""` or `null` | Empty |

{verified: PerspectiveTableNamingDiagnosticsTests.SchemaGenerator_WithAnInvalidManualName_ReportsWHIZ824Async, PerspectiveTableNamingDiagnosticsTests.SchemaGenerator_WithANullManualName_ReportsWHIZ824Async, PerspectiveTableNamingTests.IsValidManualName_AcceptsOnlyThePrefixAndLowercaseAsciiAsync}

## How to Fix

{verified: PerspectiveTableNamingDiagnosticsTests.SchemaGenerator_WithAnInvalidManualName_ReportsWHIZ824Async, PerspectiveTableNamingDiagnosticsTests.EFCoreGenerator_WithAnInvalidManualName_ReportsWHIZ824AndMapsNoTableAsync}

Write the name in lowercase snake_case after `wh_per_`, or remove the attribute to use the generated name.

### Before

```csharp{title="A manual name without the prefix" description="Backlog has no wh_per_ prefix and an uppercase letter, so both generators report WHIZ824." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "table-naming", "perspective-table", "whiz824"] tests=["PerspectiveTableNamingDiagnosticsTests.EFCoreGenerator_WithAnInvalidManualName_ReportsWHIZ824AndMapsNoTableAsync"]}
[PerspectiveTable("Backlog")]   // WHIZ824
public record Backlog(Guid Id);
```

### After

```csharp{title="A valid manual name" description="wh_per_ followed by lowercase letters and underscores." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "table-naming", "perspective-table", "whiz824"] tests=["PerspectiveTableNameGoldenTests.BothDrivers_WithSuffixStrippingOff_KeepTheManualNameAsync"]}
[PerspectiveTable("wh_per_fulfillment_backlog")]
public record BacklogSnapshotModel(Guid Id);
```

## Related

- [Perspective Table Naming](../../fundamentals/perspectives/table-naming#explicit-table-names)
- [WHIZ820: Table Name Exceeds Database Limit](whiz820)
- [WHIZ823: Perspective Table Name Exceeds the Database Limit](whiz823)
- [WHIZ825: Two Perspective Models Share One Table Name](whiz825)
