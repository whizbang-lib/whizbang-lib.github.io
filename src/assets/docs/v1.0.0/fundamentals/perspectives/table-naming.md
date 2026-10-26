---
title: "Perspective Table Naming"
pageType: concept
verifiedAgainstCommit: 3f239747
verifiedDate: 2026-10-26
version: 1.0.0
category: "Perspectives"
order: 7
description: >-
  Every perspective table is named from its model type, by one rule the Dapper and EF Core drivers share:
  the wh_per_ prefix, configurable suffix stripping and snake_case. [PerspectiveTable] names a table by hand,
  names past PostgreSQL's 63-byte limit are build errors, and a table whose name changes is renamed in place
  at the next start with its rows.
tags: 'table-naming, naming-conventions, snake-case, suffix-stripping, perspective-table, perspectives, schema, rename'
codeReferences:
  - src/Whizbang.Core/Perspectives/PerspectiveTableAttribute.cs
  - src/Whizbang.Generators.Shared/Utilities/PerspectiveTableNaming.cs
  - src/Whizbang.Generators.Shared/Utilities/NamingConventionUtilities.cs
  - src/Whizbang.Generators.Shared/Utilities/PerspectiveRegistryPayload.cs
  - src/Whizbang.Generators.Shared/Models/TableNameConfig.cs
  - src/Whizbang.Generators.Shared/Utilities/ConfigurationUtilities.cs
  - src/Whizbang.Generators.Shared/Utilities/TypeNameUtilities.cs
  - src/Whizbang.Generators/PerspectiveSchemaGenerator.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCorePerspectiveConfigurationGenerator.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/Templates/DbContextSchemaExtensionTemplate.cs
  - src/Whizbang.Data.Dapper.Postgres/PostgresSchemaInitializer.cs
  - src/Whizbang.Data.Postgres/Migrations/243_PerspectiveTablesFollowTheirModelBeforeCreate.sql
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectiveTableNameGoldenTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveTableNamingDiagnosticsTests.cs
  - tests/Whizbang.Generators.Tests/Utilities/PerspectiveTableNamingTests.cs
  - tests/Whizbang.Generators.Tests/Utilities/PerspectiveRegistryPayloadTests.cs
  - tests/Whizbang.Generators.Tests/Utilities/NamingConventionUtilitiesTests.cs
  - tests/Whizbang.Generators.Tests/Utilities/TypeNameUtilitiesTests.cs
  - tests/Whizbang.Generators.Tests/Utilities/ConfigurationUtilitiesTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/PerspectiveTableAttributeTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperPerspectiveTableRenameTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/PerspectiveTableRenameTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupParity/StartupMigrationStepsTests.cs
lastMaintainedCommit: '3f239747'
---

# Perspective Table Naming

Every perspective stores its rows in a table named after its **model type**, the `TModel` in
`IPerspectiveFor<TModel, ...>`. The Dapper and EF Core drivers name a model's table by the same rule, so one model has
one table whichever driver builds it, and every perspective of that model shares it. You can name a table by hand
with `[PerspectiveTable]`. A name that cannot be used as written is a build error, and a table whose name changes is
renamed in place at the next start, keeping its rows.

:::breaking
**Upgrading a Dapper service.** Earlier releases of the Dapper driver named a perspective's table from the
**perspective class** (`OrderSummaryPerspective` became `wh_per_order_summary_perspective`). It now uses the model,
as the EF Core driver always has (`OrderSummaryModel` becomes `wh_per_order_summary`). On the next start, each
existing table is **renamed in place** to the new name with its rows and indexes, and two perspectives of one model
now share one table. Nothing is dropped. See [Upgrading from the perspective-class names](#upgrading-dapper-names)
for what to check before you deploy.
:::

## The naming rule {#naming-rule}
{verified: PerspectiveTableNameGoldenTests.EFCoreDriver_WithDefaultSettings_MapsTheGoldenTableNamesAsync, PerspectiveTableNameGoldenTests.SchemaGenerator_WithDefaultSettings_CreatesTheGoldenTableNamesAsync, PerspectiveTableNameGoldenTests.BothDrivers_WithDefaultSettings_NameEveryModelTheSameAsync}

A model's table name is, in order:

1. The name its `[PerspectiveTable]` sets, exactly as written, when it has one ([below](#explicit-table-names)).
2. Otherwise, the model's base name with one configured suffix stripped, converted to snake_case, after the `wh_per_`
   prefix.

The perspective class plays no part. Both generators read the rule from one shared helper, so the EF Core
generator's `ToTable(...)` and the schema generator's `CREATE TABLE` (the Dapper driver's DDL) always agree.

| Model Type | Table, on either driver |
|--------------|-------------------|
| `OrderModel` | `wh_per_order` |
| `StockLevelProjection` | `wh_per_stock_level` |
| `CustomerDto` | `wh_per_customer` |
| `ProductReadModel` | `wh_per_product` |
| `ShipmentView` | `wh_per_shipment` |
| `CustomerLoyaltyTierSummaryModel` | `wh_per_customer_loyalty_tier_summary` |
| `Picking.Model` (nested) | `wh_per_picking` |
| `ActiveAccount.ActiveAccountModel` (nested) | `wh_per_active_account` |
| `PagedSnapshotModel<LineItem>` (closed generic) | `wh_per_paged_snapshot` |

### Nested model types

A model declared inside another type takes the containing type's name into its base name:

- When the nested name does **not** start with the containing name, the two are joined: `Picking.Model` has the base
  name `PickingModel`, which strips to `wh_per_picking`.
- When the nested name **starts with** the containing name, only the containing name is used, so it is not repeated:
  `ActiveAccount.ActiveAccountModel` has the base name `ActiveAccount`, giving `wh_per_active_account`.

Only the immediately containing type is used. A generic model's type arguments are not part of the name.

### Why strip suffixes?

Suffixes like `Projection`, `Model`, `Dto` and `View` describe what the type *is* in your codebase and add nothing in
the database. Stripping them gives shorter names that are easier to query, and the same table name whichever of those
conventions a team uses.

## Configuring suffix stripping

### MSBuild properties

Configure suffix stripping in your project file:

```xml{title="MSBuild Properties" description="Configure suffix stripping in your project file:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "MSBuild", "Properties"]}
<PropertyGroup>
  <!-- Enable/disable suffix stripping (default: true) -->
  <WhizbangStripTableNameSuffixes>true</WhizbangStripTableNameSuffixes>

  <!-- Suffixes to strip (default list shown; first match wins, so put longer
       suffixes like ReadModel before their substrings like Model) -->
  <WhizbangTableNameSuffixesToStrip>ReadModel,Model,Projection,Dto,View</WhizbangTableNameSuffixesToStrip>
</PropertyGroup>
```

Both properties apply to generated names on both drivers. They never change a name set with
[`[PerspectiveTable]`](#explicit-table-names).

### Disabling suffix stripping

To keep the full model name in table names:

```xml{title="Disabling Suffix Stripping" description="To keep the full model name in table names:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Disabling", "Suffix"]}
<PropertyGroup>
  <WhizbangStripTableNameSuffixes>false</WhizbangStripTableNameSuffixes>
</PropertyGroup>
```

With stripping disabled:

| Model Type | Table Name |
|--------------|------------|
| `OrderModel` | `wh_per_order_model` |
| `CustomerDto` | `wh_per_customer_dto` |

### Custom suffixes

Add or modify the suffixes to strip:

```xml{title="Custom Suffixes" description="Add or modify the suffixes to strip:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Custom", "Suffixes"]}
<PropertyGroup>
  <!-- Add custom suffixes (first match wins - order longer suffixes first) -->
  <WhizbangTableNameSuffixesToStrip>ViewModel,ReadModel,Model,Projection,Dto,View,State</WhizbangTableNameSuffixesToStrip>
</PropertyGroup>
```

Changing either property changes the generated names, and the affected tables are renamed in place at the next start
([Renaming perspectives](#renaming-perspectives)).

## Explicit table names {#explicit-table-names}
{verified: PerspectiveTableAttributeTests.PerspectiveTableAttribute_Constructor_KeepsTheNameAsWrittenAsync, PerspectiveTableAttributeTests.PerspectiveTableAttribute_AttributeUsage_OneOnAClassOrStruct_NotInheritedAsync, PerspectiveTableNameGoldenTests.BothDrivers_WithSuffixStrippingOff_KeepTheManualNameAsync, PerspectiveTableNamingTests.TableName_WithAManualName_UsesItWhateverTheSettingsAsync, PerspectiveTableNamingTests.IsValidManualName_AcceptsOnlyThePrefixAndLowercaseAsciiAsync}

Put `[PerspectiveTable("wh_per_...")]` on the **model** to choose its table name yourself:

```csharp{title="Name a perspective table by hand" description="The model's table is wh_per_fulfillment_backlog on both drivers, whatever the suffix settings." framework="NET10" category="Perspectives" difficulty="BEGINNER" tags=["perspective-table", "table-naming", "attributes", "perspectives"] tests=["PerspectiveTableNameGoldenTests.BothDrivers_WithSuffixStrippingOff_KeepTheManualNameAsync", "PerspectiveTableNameGoldenTests.EFCoreDriver_WithDefaultSettings_MapsTheGoldenTableNamesAsync", "PerspectiveTableNameGoldenTests.SchemaGenerator_WithDefaultSettings_CreatesTheGoldenTableNamesAsync"]}
using Whizbang.Core.Perspectives;

[PerspectiveTable("wh_per_fulfillment_backlog")]
public record BacklogSnapshotModel(Guid Id);

public class BacklogPerspective : IPerspectiveFor<BacklogSnapshotModel, StockChanged> {
  public BacklogSnapshotModel Apply(BacklogSnapshotModel currentData, StockChanged @event) => currentData;
}
```

The rules:

- **It goes on the model**, a class, record or struct, not on the perspective class. It is not inherited, and a model
  carries at most one.
- **The name is used exactly as written.** `WhizbangStripTableNameSuffixes` and `WhizbangTableNameSuffixesToStrip`
  do not alter it.
- **It must be a valid perspective table name:** `wh_per_` followed by at least one lowercase ASCII letter, digit or
  underscore. The framework recognizes its perspective tables by that prefix, and the generated SQL writes the name
  unquoted, which PostgreSQL folds to lowercase, so only such a name reaches every statement unchanged. Anything else
  is [WHIZ824](../../operations/diagnostics/whiz824).
- **It must fit the identifier limit**, 63 bytes on PostgreSQL ([below](#identifier-limit)).
- **Every perspective of the model shares the table.** Two models on one table is
  [WHIZ825](../../operations/diagnostics/whiz825).
- **Every driver honors it.** The Dapper and EF Core drivers create and map the same name.

Adding the attribute to a model that already has a table, or changing its name, renames that table in place at the
next start ([Renaming perspectives](#renaming-perspectives)).

## The identifier limit {#identifier-limit}
{verified: PerspectiveTableNamingDiagnosticsTests.SchemaGenerator_WithAGeneratedNameOverTheLimit_ReportsWHIZ823AndCreatesNoTableAsync, PerspectiveTableNamingDiagnosticsTests.SchemaGenerator_WithANameAtTheLimit_ReportsNothingAsync, PerspectiveTableNamingDiagnosticsTests.SchemaGenerator_WithAManualNameOverTheLimit_ReportsWHIZ823Async, PerspectiveTableNamingDiagnosticsTests.EFCoreGenerator_WithAManualNameOverTheLimit_ReportsWHIZ820NamingTheAttributeAsync, PerspectiveTableNamingDiagnosticsTests.SchemaGenerator_WithAWhizbangMaxIdentifierLength_UsesItAsTheLimitAsync}

PostgreSQL truncates an identifier longer than 63 bytes **without an error**, so two long names can silently become
one table. Whizbang checks every perspective table name, generated or manual, at build time instead. The check counts
UTF-8 bytes and fails when the count is greater than the limit, so a name of exactly 63 bytes passes.

| Generator | Diagnostic | What happens to the perspective |
|---|---|---|
| Schema generator (Dapper DDL) | [WHIZ823](../../operations/diagnostics/whiz823) | No table is generated for it |
| EF Core perspective configuration generator | [WHIZ820](../../operations/diagnostics/whiz820) | Left out of the generated model configuration |

In a project that references the EF Core driver, the schema generator leaves these checks to the EF Core generator,
so each problem is reported once. `WhizbangMaxIdentifierLength` sets a different limit for a server built with one
(see [WHIZ820](../../operations/diagnostics/whiz820#overriding-the-limit)); both generators read it.

To fix a name over the limit, shorten the model name, strip a suffix, or name the table with `[PerspectiveTable]`.

## Naming convention details

### Conversion rules

1. **PascalCase to snake_case**: `OrderDetails` → `order_details`
2. **Every uppercase letter gets an underscore** (acronyms are NOT collapsed): `APIResponse` → `a_p_i_response`
3. **Numbers preserved**: `Order2024` → `order2024`
4. **Suffix stripping**: `OrderProjection` → `order` (suffix removed before conversion)
5. **Nested model types**: the containing type name is merged in ([above](#nested-model-types))

### Examples

| Model Type Name | Suffix Stripped | Snake Case | Final Table |
|------------|----------------|------------|-------------|
| `OrderProjection` | `Order` | `order` | `wh_per_order` |
| `CustomerAccountDto` | `CustomerAccount` | `customer_account` | `wh_per_customer_account` |
| `ProductInventoryModel` | `ProductInventory` | `product_inventory` | `wh_per_product_inventory` |
| `APIUsageView` | `APIUsage` | `a_p_i_usage` | `wh_per_a_p_i_usage` |
| `Order2024Projection` | `Order2024` | `order2024` | `wh_per_order2024` |

Avoid consecutive-uppercase acronyms in model type names: each uppercase letter becomes its own snake_case segment.

### Edge cases

| Model Type Name | Notes | Table Name |
|------------|-------|------------|
| `Model` | Name is only a suffix - strips to empty | `wh_per_` (avoid this) |
| `OrderModelProjection` | Only the first matching suffix stripped (single pass) | `wh_per_order_model` |
| `OrderMODEL` | Suffix matching is case-sensitive - no strip | `wh_per_order_m_o_d_e_l` |

## Table name conflicts {#table-name-conflicts}
{verified: PerspectiveTableNamingDiagnosticsTests.SchemaGenerator_WithTwoModelsResolvingToOneTable_ReportsWHIZ825Async, PerspectiveTableNamingDiagnosticsTests.EFCoreGenerator_WithTwoModelsResolvingToOneTable_ReportsWHIZ825Async, PerspectiveTableNamingDiagnosticsTests.SchemaGenerator_WithTwoPerspectivesOfOneModel_CreatesItsTableOnceAsync, PerspectiveTableNamingTests.Collisions_ReportOneErrorPerSharedTable_NotPerPerspectiveOfOneModelAsync}

Two perspectives of the **same** model share its table on both drivers; that is not a conflict. Two **different**
models resolving to one table would overwrite each other's rows, so it is a build error,
[WHIZ825](../../operations/diagnostics/whiz825):

```csharp{title="Two models on one table" description="OrderDto and OrderModel both strip to Order, so both resolve to wh_per_order and the build reports WHIZ825." framework="NET10" category="Perspectives" difficulty="BEGINNER" tags=["table-naming", "whiz825", "counter-example", "perspectives"] tests=["PerspectiveTableNamingDiagnosticsTests.SchemaGenerator_WithTwoModelsResolvingToOneTable_ReportsWHIZ825Async"]}
public record OrderDto(Guid Id);
public record OrderModel(Guid Id);

// Both resolve to wh_per_order: WHIZ825
public class OrderListPerspective : IPerspectiveFor<OrderDto, Noted> {
  public OrderDto Apply(OrderDto currentData, Noted @event) => currentData;
}
public class OrderAdminPerspective : IPerspectiveFor<OrderModel, Noted> {
  public OrderModel Apply(OrderModel currentData, Noted @event) => currentData;
}
```

Resolve it by renaming one model so the stripped names differ (`OrderModel` → `OrderAdminModel` gives
`wh_per_order_admin`), or by naming one table with `[PerspectiveTable]`.

## Renaming perspectives {#renaming-perspectives}
{verified: DapperPerspectiveTableRenameTests.Initializer_WhenTheModelsTableNameChanges_RenamesTheExistingTableInPlaceAndKeepsItsRowsAsync, DapperPerspectiveTableRenameTests.Initializer_WhenBothTablesExist_LeavesBothAndWarnsAsync, DapperPerspectiveTableRenameTests.Initializer_WhenAReleasedBuildLeftTheTableUnderItsPerspectiveName_FollowsItWithNoRegistryRowAsync, DapperPerspectiveTableRenameTests.Initializer_WhenTwoPerspectivesOfOneModelLeftTwoTables_RenamesTheRegisteredOneAndWarnsAboutTheOtherAsync, DapperPerspectiveTableRenameTests.Initializer_WhenAFormerNameIsAnotherModelsTable_LeavesItToThatModelAsync, PerspectiveTableRenameTests.Initialize_WhenTheModelsTableNameChanged_RenamesTheTableInPlaceAndKeepsItsRowsAsync, PerspectiveTableRenameTests.Initialize_WhenBothTablesExist_LeavesBothInPlaceAsync}

Renaming the perspective **class** has no effect on the table name; only the model matters. When a model's table name
changes, because a suffix setting changed or `[PerspectiveTable]` was added or edited, the existing table is
**renamed in place at the next start**, before the perspective tables are created:

```mermaid{caption="Perspective table rename at startup: both drivers call wh_follow_perspective_table_renames before the perspective pass, so the old table is renamed to the model's new name with its rows and indexes before CREATE TABLE IF NOT EXISTS runs; the registry reconcile then records the new name." tests=["DapperPerspectiveTableRenameTests.Initializer_WhenTheModelsTableNameChanges_RenamesTheExistingTableInPlaceAndKeepsItsRowsAsync", "PerspectiveTableRenameTests.Initialize_WhenTheModelsTableNameChanged_RenamesTheTableInPlaceAndKeepsItsRowsAsync"]}
flowchart TD
    Migrations["Migration files<br/>(243 defines wh_follow_perspective_table_renames)"]
    Follow["wh_follow_perspective_table_renames<br/>per model: registry row, then former names"]
    Exists{"Model's new table<br/>already exists?"}
    Rename["ALTER TABLE old RENAME TO new<br/>+ matching indexes<br/>log: renamed, keeping its rows"]
    Keep["Leave both tables<br/>log a warning naming the model and both tables"]
    Create["Perspective tables<br/>CREATE TABLE IF NOT EXISTS"]
    Reconcile["reconcile_perspective_registry<br/>records the new name"]

    Migrations --> Follow --> Exists
    Exists -- no --> Rename --> Create
    Exists -- yes --> Keep --> Create
    Create --> Reconcile
```

### What is renamed

For each model in the generated registry payload, `wh_follow_perspective_table_renames` looks for the tables its rows
may be under, other than its table now:

1. **The table its registry row names**, keyed by the model's CLR type and the service.
2. **The name a released Dapper build gave it.** Those builds named the table from the perspective class and never
   wrote the registry, so there is no row to follow. The schema generator now writes each perspective's former name
   into the registry payload (`FormerTableName`), as PostgreSQL stored it, cut to 63 bytes, and the rename follows it.

A former name that the payload maps to **another model** is that model's table now and is never taken.

For each table found, while the model's new name does not exist yet:

- The table is renamed with `ALTER TABLE ... RENAME TO`. Its rows, columns, constraints and grants stay with it.
- **Its indexes are renamed with it**: every index on the table whose name carries the old table name (the primary key
  included) or the part of it past `wh_per_` (such as `idx_order_summary_...`), when the new index name is free and
  fits in 63 bytes. An index that cannot be renamed keeps its old name and keeps working.
- The driver logs at Information: `Renamed the perspective table of {Model} from {OldTable} to {NewTable}, keeping its rows`.

The registry row itself is left to `reconcile_perspective_registry`, which still runs after the perspective pass and
records the new name. On a fresh database there is nothing to rename and the function returns nothing.

### Nothing is dropped or merged

When the model's new table **already exists**, or a model left two old tables, the extra table is kept as it is. No
table is dropped, no rows are merged or moved, and the driver logs a warning:

```text{title="The warning when two tables exist for one model" description="Logged by both drivers when a model's table could not be renamed because the new name already exists." tests=["DapperPerspectiveTableRenameTests.Initializer_WhenBothTablesExist_LeavesBothAndWarnsAsync"]}
The perspective table of {Model} was not renamed from {OldTable} to {NewTable}: both tables exist. Nothing was dropped or merged; move the rows you need from the old table by hand, then drop it
```

The model reads and writes `{NewTable}` only. Compare the two, copy any rows you need from `{OldTable}`, then drop it.
Until the old table is gone, the warning can appear again whenever the rename runs.

On the Dapper driver the two event IDs are `1719` (`PerspectiveTableRenamed`) and `1720`
(`PerspectiveTableRenameBlocked`).

### How each driver runs it

- **Dapper.** `PostgresSchemaInitializer` calls the function for every registered payload after the migration files
  and the `BeforePerspectives` application objects, and before the perspective DDL. A table renamed this start whose
  DDL differs only by its name is not treated as changed DDL: its statements re-run as they are, with no copy or
  replay, and its `wh_schema_migrations` row reads `Renamed from <old name>`. When the DDL also changed, the table goes
  through the usual changed-table path after the rename and keeps its rows.
- **EF Core.** The schema pass has **one extra step**, `perspective-renames`, between the migration files and the
  perspective tables. It is recorded and skipped like every other step, so `Y` in the
  [step log lines](../../operations/infrastructure/migrations#step-log-lines) counts one more step than before. See
  [Migrations](../../operations/infrastructure/migrations#step-log-lines).

Before this change, the rename was attempted only by the registry reconcile, which runs **after** the perspective
pass. By then `CREATE TABLE IF NOT EXISTS` had already built the new name as an empty table, the rename failed, and
the rows stayed under the old name where nothing read them. That happened on both drivers; running the rename first
fixes it.

### Migration 243

`243_PerspectiveTablesFollowTheirModelBeforeCreate.sql` adds the function:

```sql{title="wh_follow_perspective_table_renames" description="Renames each perspective table whose model now maps to a new name; returns one row per table it renamed or had to leave." category="Perspectives" difficulty="ADVANCED" tags=["perspectives", "migrations", "rename", "postgres"] tests=["DapperPerspectiveTableRenameTests.Initializer_WhenTheModelsTableNameChanges_RenamesTheExistingTableInPlaceAndKeepsItsRowsAsync", "DapperPerspectiveTableRenameTests.Initializer_WhenBothTablesExist_LeavesBothAndWarnsAsync"]}
wh_follow_perspective_table_renames(
  p_perspectives JSONB,              -- the generated registry payload
  p_service_name VARCHAR DEFAULT NULL
)
RETURNS TABLE (
  o_action VARCHAR,                  -- 'renamed' or 'both_exist'
  o_clr_type_name VARCHAR,           -- the model
  o_old_table_name VARCHAR,
  o_new_table_name VARCHAR
)
```

Both drivers call it from the same payload; you never call it yourself.

### Renaming the model type itself

Renaming the model type (for example `CustomerData` → `Customer`) changes the registry key, so the renamed model is a
new perspective to the registry, and its rows are not followed. To keep using the existing table, name it on the
renamed model with `[PerspectiveTable("wh_per_customer_data")]`. Otherwise plan a manual migration of the rows.

## Upgrading from the perspective-class names {#upgrading-dapper-names}
{verified: PerspectiveTableNameGoldenTests.SchemaGenerator_RegistryPayload_NamesTheTableEachPerspectiveHadBeforeAsync, PerspectiveTableNamingTests.FormerDapperTableName_IsThePerspectiveClassName_AsPostgresStoredIt_OrNullWhenUnchangedAsync, DapperPerspectiveTableRenameTests.Initializer_WhenAReleasedBuildLeftTheTableUnderItsPerspectiveName_FollowsItWithNoRegistryRowAsync, DapperPerspectiveTableRenameTests.Initializer_WhenTwoPerspectivesOfOneModelLeftTwoTables_RenamesTheRegisteredOneAndWarnsAboutTheOtherAsync}

This applies to services on the **Dapper** driver. EF Core services already used the model-based names; for them the
only change is the extra startup step and the new diagnostics.

| Perspective class | Model | Table before | Table now |
|---|---|---|---|
| `OrderPerspective` | `OrderModel` | `wh_per_order_perspective` | `wh_per_order` |
| `CustomerPerspective` | `CustomerDto` | `wh_per_customer_perspective` | `wh_per_customer` |
| `ActiveAccount.ActiveAccountProjection` | `ActiveAccount.ActiveAccountModel` | `wh_per_active_account_active_account` | `wh_per_active_account` |
| `ProductCatalogProjection` | `ProductReadModel` | `wh_per_product_catalog` | `wh_per_product` |

What to expect and check:

1. **Tables are renamed on the next start**, with their rows and indexes. Anything outside Whizbang that names a
   perspective table (hand-written SQL, reports, dashboards, grants scripts) needs the new name. Build once and read
   the generated names, or read the Information log lines at the first start.
2. **Two perspectives of one model now share one table.** A released build gave each its own table. At the upgrade,
   the table the registry names for the model is renamed (or, with no registry row, the first one found in payload
   order), and every other one is left in place, unread, with the warning above. If its rows differ from the kept
   table's, move the ones you need by hand, then drop it.
3. **Names past 63 bytes are now build errors.** PostgreSQL used to truncate them silently. A model whose name is over
   the limit now fails the build with WHIZ823. To keep the table the database already has, name it with
   `[PerspectiveTable]`, using the name as PostgreSQL stored it.
4. **Two different models that resolve to one name are now build errors** (WHIZ825). Rename one, or name its table.

## Prefix configuration

The `wh_per_` prefix is fixed. It is hardcoded in the source generators and schema initializers
(`SchemaConfiguration` defaults to `PerspectivePrefix = "wh_per_"`, and all built-in providers pass that value), and a
name set with `[PerspectiveTable]` must start with it. There is no supported runtime or MSBuild option to change it.

## Best practices

1. **Use descriptive model type names**: `OrderSummaryDto` is better than `OrdSum`
2. **Let suffix stripping work**: don't abbreviate names by hand
3. **Avoid acronyms in model names**: `ApiUsage` gives `wh_per_api_usage`; `APIUsage` gives `wh_per_a_p_i_usage`
4. **Be consistent**: pick one suffix convention (`Projection`, `Dto`, and so on) for your team
5. **Never name a model exactly a suffix**: `Model` or `Dto` alone strips to an empty base name
6. **Reach for `[PerspectiveTable]` for a reason**: a name the convention cannot produce, a name over the limit, or a
   table you want to keep through a model rename

## See also

- [Perspective Registry](registry.md) - Automatic table tracking
- [Schema Migration](../../data/schema-migration.md) - Database schema management
- [Migrations](../../operations/infrastructure/migrations.md) - The startup pass and its steps
- [Database Identifier Limits](../../operations/infrastructure/database-limits.md)
- [WHIZ820](../../operations/diagnostics/whiz820), [WHIZ823](../../operations/diagnostics/whiz823),
  [WHIZ824](../../operations/diagnostics/whiz824), [WHIZ825](../../operations/diagnostics/whiz825)
- [Temporal Perspectives](temporal.md) - Append-only perspective pattern
