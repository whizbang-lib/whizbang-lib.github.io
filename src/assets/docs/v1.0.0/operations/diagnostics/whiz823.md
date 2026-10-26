---
title: 'WHIZ823: Perspective Table Name Exceeds the Database Limit'
pageType: troubleshooting
verifiedAgainstCommit: 3f239747
verifiedDate: 2026-10-26
description: >-
  Build error from the schema generator (the Dapper driver's DDL) when a perspective model's table name,
  generated or set with [PerspectiveTable], is longer than the database allows (63 bytes on PostgreSQL).
  No table is generated for that perspective.
version: 1.0.0
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - perspectives
  - table-naming
  - identifier-limits
  - dapper
  - source-generator
codeReferences:
  - src/Whizbang.Generators.Shared/Utilities/PerspectiveTableNaming.cs
  - src/Whizbang.Generators/PerspectiveSchemaGenerator.cs
  - src/Whizbang.Generators.Shared/Utilities/IdentifierValidation.cs
  - src/Whizbang.Generators.Shared/Utilities/ConfigurationUtilities.cs
  - src/Whizbang.Core/Perspectives/PerspectiveTableAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectiveTableNamingDiagnosticsTests.cs
lastMaintainedCommit: '3f239747'
---

# WHIZ823: Perspective Table Name Exceeds the Database Limit

**Severity**: Error
**Category**: Identifier Limits

## Description

Every perspective's table is named from its model type, or by the model's `[PerspectiveTable]` (see
[Perspective Table Naming](../../fundamentals/perspectives/table-naming)). PostgreSQL truncates an identifier longer
than 63 bytes **without an error**, so two long names can become one table. The schema generator, which writes the
Dapper driver's `CREATE TABLE` statements, checks each name at build time and refuses one past the limit.

The check counts UTF-8 bytes and fails when the count is **greater than** the limit, so a 63-byte name passes. When it
fails, the generator reports WHIZ823 at the model's declaration and generates no table for that perspective; the
other perspectives are still generated.

WHIZ823 is the schema generator's form of [WHIZ820](whiz820), which the EF Core generator reports for the same
condition. In a project that references the EF Core driver, the schema generator leaves the check to the EF Core
generator, so you see WHIZ820 there and never both.

Earlier releases of the schema generator did not check the name, and PostgreSQL stored such a table under the first
63 bytes of its name.

## Diagnostic Message

```
Perspective model '{ModelType}' has table name '{TableName}' ({ByteCount} bytes), over the PostgreSQL limit of {Limit} bytes, which PostgreSQL would truncate. Shorten the model name, configure suffix stripping, or name the table with [PerspectiveTable].
```

`{ModelType}` is the model's CLR type name. `{Limit}` is 63, or the value of `WhizbangMaxIdentifierLength` when set.

## Common Causes

1. **A long, descriptive model type name.**
2. **A suffix that is not stripped**, because suffix stripping is off or the suffix is not in the list.
3. **Acronyms in the name**, each uppercase letter adding an underscore.
4. **A nested model type**, whose containing type's name is merged into the base name.
5. **A `[PerspectiveTable]` name** that is itself longer than the limit.

## How to Fix

{verified: PerspectiveTableNamingDiagnosticsTests.SchemaGenerator_WithAGeneratedNameOverTheLimit_ReportsWHIZ823AndCreatesNoTableAsync, PerspectiveTableNamingDiagnosticsTests.SchemaGenerator_WithANameAtTheLimit_ReportsNothingAsync, PerspectiveTableNamingDiagnosticsTests.SchemaGenerator_WithAManualNameOverTheLimit_ReportsWHIZ823Async, PerspectiveTableNamingDiagnosticsTests.SchemaGenerator_WithAWhizbangMaxIdentifierLength_UsesItAsTheLimitAsync}

- **Rename the model type.** The table name follows it.
- **Strip a suffix.** Add the model's suffix to `WhizbangTableNameSuffixesToStrip`, or turn stripping back on with
  `WhizbangStripTableNameSuffixes`.
- **Name the table yourself** with `[PerspectiveTable("wh_per_...")]` on the model. To keep a table an earlier release
  created under a truncated name, use the name as PostgreSQL stored it.
- **Only for a server built with a different identifier length**, set `WhizbangMaxIdentifierLength` (see
  [WHIZ820](whiz820#overriding-the-limit)). The schema generator reads it too.

A model whose table already holds rows keeps them when its name changes: the table is renamed in place at the next
start ([Renaming perspectives](../../fundamentals/perspectives/table-naming#renaming-perspectives)).

### Before

```csharp{title="A model name one byte over the limit" description="wh_per_ plus a 57-character name is 64 bytes, one over PostgreSQL's 63, so the schema generator reports WHIZ823 and creates no table." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "table-naming", "identifier-limits", "whiz823"] tests=["PerspectiveTableNamingDiagnosticsTests.SchemaGenerator_WithAGeneratedNameOverTheLimit_ReportsWHIZ823AndCreatesNoTableAsync"]}
public record Noted : IEvent;

// wh_per_zqqq...q: 64 bytes, WHIZ823
public record Zqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq(Guid Id);

public class BacklogPerspective : IPerspectiveFor<Zqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq, Noted> {
  public Zqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq Apply(
      Zqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq currentData, Noted @event) => currentData;
}
```

### After

```csharp{title="A name within the limit" description="[PerspectiveTable] gives the model a short table name; a generated name of 63 bytes or fewer also passes." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "table-naming", "perspective-table", "whiz823"] tests=["PerspectiveTableNamingDiagnosticsTests.SchemaGenerator_WithANameAtTheLimit_ReportsNothingAsync", "PerspectiveTableNameGoldenTests.SchemaGenerator_WithDefaultSettings_CreatesTheGoldenTableNamesAsync"]}
[PerspectiveTable("wh_per_fulfillment_backlog")]
public record BacklogSnapshotModel(Guid Id);
```

## Related

- [Perspective Table Naming](../../fundamentals/perspectives/table-naming#identifier-limit)
- [Database Identifier Limits](../infrastructure/database-limits)
- [WHIZ820: Table Name Exceeds Database Limit](whiz820) (EF Core generator)
- [WHIZ824: Invalid Perspective Table Name](whiz824)
- [WHIZ825: Two Perspective Models Share One Table Name](whiz825)
