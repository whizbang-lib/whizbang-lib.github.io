---
title: 'WHIZ825: Two Perspective Models Share One Table Name'
pageType: troubleshooting
verifiedAgainstCommit: 3f239747
verifiedDate: 2026-10-26
description: >-
  Build error when two different perspective models resolve to the same table, by their generated names or by
  [PerspectiveTable]. Their rows would overwrite each other, so the build stops.
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
  - src/Whizbang.Generators/PerspectiveSchemaGenerator.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCorePerspectiveConfigurationGenerator.cs
  - src/Whizbang.Core/Perspectives/PerspectiveTableAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectiveTableNamingDiagnosticsTests.cs
  - tests/Whizbang.Generators.Tests/Utilities/PerspectiveTableNamingTests.cs
lastMaintainedCommit: '3f239747'
---

# WHIZ825: Two Perspective Models Share One Table Name

**Severity**: Error
**Category**: Identifier Limits

## Description

Each perspective model has one table, shared by every perspective of that model (see
[Perspective Table Naming](../../fundamentals/perspectives/table-naming#table-name-conflicts)). Two **different**
models in one table would overwrite each other's rows, so both generators report WHIZ825 when more than one model
resolves to the same table name. That happens when:

- two model names strip to the same base name (`OrderDto` and `OrderModel` both become `wh_per_order`), or
- two models name the same table with `[PerspectiveTable]`, or one names the table another model generates.

The error is reported once per shared table, at the second model's declaration, and lists every model on it. Several
perspectives of **one** model are not a conflict and are never reported.

Earlier releases reported nothing, and both models were mapped to one table.

## Diagnostic Message

```
Perspective table '{TableName}' is the table of more than one model ({ModelTypes}). Rename a model, or name its table with [PerspectiveTable].
```

`{ModelTypes}` lists the models, sorted and comma-separated.

## How to Fix

{verified: PerspectiveTableNamingDiagnosticsTests.SchemaGenerator_WithTwoModelsResolvingToOneTable_ReportsWHIZ825Async, PerspectiveTableNamingDiagnosticsTests.EFCoreGenerator_WithTwoModelsResolvingToOneTable_ReportsWHIZ825Async, PerspectiveTableNamingDiagnosticsTests.SchemaGenerator_WithTwoPerspectivesOfOneModel_CreatesItsTableOnceAsync, PerspectiveTableNamingTests.Collisions_ReportOneErrorPerSharedTable_NotPerPerspectiveOfOneModelAsync}

- **Rename one model** so the stripped names differ.
- **Or name one model's table** with `[PerspectiveTable("wh_per_...")]`.
- **If the two models hold the same data**, make them one model and let both perspectives fold it; they then share
  its table legitimately.

### Before

```csharp{title="Two models on one table" description="OrderDto and OrderModel both strip to Order and resolve to wh_per_order, so the build reports WHIZ825." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "table-naming", "whiz825", "counter-example"] tests=["PerspectiveTableNamingDiagnosticsTests.SchemaGenerator_WithTwoModelsResolvingToOneTable_ReportsWHIZ825Async"]}
public record Noted : IEvent;
public record OrderDto(Guid Id);
public record OrderModel(Guid Id);   // WHIZ825: wh_per_order is the table of Shop.OrderDto, Shop.OrderModel

public class OrderListPerspective : IPerspectiveFor<OrderDto, Noted> {
  public OrderDto Apply(OrderDto currentData, Noted @event) => currentData;
}
public class OrderAdminPerspective : IPerspectiveFor<OrderModel, Noted> {
  public OrderModel Apply(OrderModel currentData, Noted @event) => currentData;
}
```

### After

```csharp{title="One table per model" description="Naming the second model's table gives each model its own table." framework="NET10" category="Diagnostics" difficulty="BEGINNER" tags=["diagnostics", "table-naming", "perspective-table", "whiz825"] tests=["PerspectiveTableNamingTests.Collisions_ReportOneErrorPerSharedTable_NotPerPerspectiveOfOneModelAsync", "PerspectiveTableNamingTests.TableName_WithAManualName_UsesItWhateverTheSettingsAsync"]}
public record OrderDto(Guid Id);                 // wh_per_order

[PerspectiveTable("wh_per_order_admin")]
public record OrderModel(Guid Id);               // wh_per_order_admin
```

## Related

- [Perspective Table Naming](../../fundamentals/perspectives/table-naming#table-name-conflicts)
- [WHIZ820: Table Name Exceeds Database Limit](whiz820)
- [WHIZ823: Perspective Table Name Exceeds the Database Limit](whiz823)
- [WHIZ824: Invalid Perspective Table Name](whiz824)
