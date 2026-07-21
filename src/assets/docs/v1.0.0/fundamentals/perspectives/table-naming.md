---
title: "Perspective Table Naming"
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: "Perspectives"
order: 7
description: >-
  Whizbang automatically generates database table names for perspectives using configurable
  naming conventions. Strips common suffixes like Projection, Model, and Dto by default,
  and supports MSBuild properties for customizing suffix stripping behavior.
tags: 'table-naming, naming-conventions, snake-case, suffix-stripping, perspectives, schema'
codeReferences:
  - src/Whizbang.Generators.Shared/Utilities/NamingConventionUtilities.cs
  - src/Whizbang.Generators.Shared/Models/TableNameConfig.cs
  - src/Whizbang.Generators.Shared/Utilities/ConfigurationUtilities.cs
  - src/Whizbang.Generators.Shared/Utilities/TypeNameUtilities.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Utilities/NamingConventionUtilitiesTests.cs
  - tests/Whizbang.Generators.Tests/Utilities/TypeNameUtilitiesTests.cs
  - tests/Whizbang.Generators.Tests/Utilities/ConfigurationUtilitiesTests.cs
lastMaintainedCommit: '01f07906'
---

# Perspective Table Naming

Whizbang automatically generates database table names for your perspectives using configurable naming conventions. By default, common suffixes like `Projection`, `Model`, and `Dto` are stripped to create cleaner, shorter table names.

## Default Behavior

Table names are derived from the perspective's **model type** -- the `TModel` in `IPerspectiveFor<TModel, ...>` -- not from the perspective class itself. Whizbang strips any configured suffix, converts the remaining name to snake_case, and adds the `wh_per_` prefix:

| Model Type Name | Default Table Name |
|--------------|-------------------|
| `OrderProjection` | `wh_per_order` |
| `CustomerDto` | `wh_per_customer` |
| `ProductReadModel` | `wh_per_product` |
| `ActivityView` | `wh_per_activity` |
| `InventoryModel` | `wh_per_inventory` |

### Why Strip Suffixes?

Suffixes like `Projection`, `Model`, `Dto`, and `View` describe what the class *is* in your codebase, but add no value in the database. Stripping them results in:

- **Shorter table names**: Easier to work with in SQL queries
- **Cleaner schema**: `wh_per_order` is clearer than `wh_per_order_projection`
- **Consistent naming**: Different teams may use `Dto` vs `Model` vs `View` - all become the same

## Configuring Suffix Stripping

### MSBuild Properties

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

### Disabling Suffix Stripping

To keep the full class name in table names:

```xml{title="Disabling Suffix Stripping" description="To keep the full class name in table names:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Disabling", "Suffix"]}
<PropertyGroup>
  <WhizbangStripTableNameSuffixes>false</WhizbangStripTableNameSuffixes>
</PropertyGroup>
```

With stripping disabled:

| C# Class Name | Table Name |
|--------------|------------|
| `OrderProjection` | `wh_per_order_projection` |
| `CustomerDto` | `wh_per_customer_dto` |

### Custom Suffixes

Add or modify the suffixes to strip:

```xml{title="Custom Suffixes" description="Add or modify the suffixes to strip:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Custom", "Suffixes"]}
<PropertyGroup>
  <!-- Add custom suffixes (first match wins - order longer suffixes first) -->
  <WhizbangTableNameSuffixesToStrip>ViewModel,ReadModel,Model,Projection,Dto,View,State</WhizbangTableNameSuffixesToStrip>
</PropertyGroup>
```

## Explicit Table Names

There is no per-perspective attribute for overriding the generated table name at this commit. The table name is always derived from the model type name plus the MSBuild suffix configuration. To control a table name:

- **Rename the model type** -- the table name follows it
- **Adjust the suffix list** -- add or remove suffixes project-wide via `WhizbangTableNameSuffixesToStrip`

## Naming Convention Details

### Conversion Rules

1. **PascalCase to snake_case**: `OrderDetails` → `order_details`
2. **Every uppercase letter gets an underscore** (acronyms are NOT collapsed): `APIResponse` → `a_p_i_response`
3. **Numbers preserved**: `Order2024` → `order2024`
4. **Suffix stripping**: `OrderProjection` → `order` (suffix removed before conversion)
5. **Nested model types**: the containing type name is merged in (`ActiveJob.Details` → base name `ActiveJobDetails`); when the nested name starts with the containing name (`ActiveAccount.ActiveAccountModel`), just the containing name is used to avoid duplication

### Examples

| Model Type Name | Suffix Stripped | Snake Case | Final Table |
|------------|----------------|------------|-------------|
| `OrderProjection` | `Order` | `order` | `wh_per_order` |
| `CustomerAccountDto` | `CustomerAccount` | `customer_account` | `wh_per_customer_account` |
| `ProductInventoryModel` | `ProductInventory` | `product_inventory` | `wh_per_product_inventory` |
| `APIUsageView` | `APIUsage` | `a_p_i_usage` | `wh_per_a_p_i_usage` |
| `Order2024Projection` | `Order2024` | `order2024` | `wh_per_order2024` |

Avoid consecutive-uppercase acronyms in model type names -- each uppercase letter becomes its own snake_case segment.

### Edge Cases

| Model Type Name | Notes | Table Name |
|------------|-------|------------|
| `Model` | Name is only a suffix - strips to empty | `wh_per_` (avoid this) |
| `OrderModelProjection` | Only the first matching suffix stripped (single pass) | `wh_per_order_model` |
| `OrderMODEL` | Suffix matching is case-sensitive - no strip | `wh_per_order_m_o_d_e_l` |

## Table Name Conflicts

If two perspective model types would generate the same table name, both perspectives end up mapped to the same table -- there is no compile-time duplicate-name diagnostic at this commit:

```csharp{title="Table Name Conflicts" description="Two model types that strip to the same base name collide on one table:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Table", "Name"] unverified="counter-example — colliding table names produce no compile-time diagnostic, nothing to assert"}
// Both model types generate wh_per_order
public class OrderPerspective : IPerspectiveFor<OrderDto, OrderCreatedEvent> { }
public class OrderAdminPerspective : IPerspectiveFor<OrderModel, OrderCreatedEvent> { }
// OrderDto -> Order -> wh_per_order; OrderModel -> Order -> wh_per_order
```

Resolve by renaming one of the model types so the stripped base names differ (e.g., `OrderModel` → `OrderAdminModel` gives `wh_per_order_admin`).

## Renaming Perspectives

Renaming the perspective **class** has no effect on the table name -- only the model type name matters. Two rename scenarios behave differently:

### Changing suffix configuration (registry-managed rename)

When suffix configuration changes the generated name for the **same model type**, the [perspective registry](registry.md) automatically renames the table on next application start:

1. Registry detects table name changed for the model's `clr_type_name`
2. Executes `ALTER TABLE IF EXISTS wh_per_customer_data RENAME TO wh_per_customer`
3. Data preserved, no migration needed

### Renaming the model type itself

Renaming the model type (e.g., `CustomerData` → `Customer`) changes the registry key, so the registry sees a **new** perspective and creates a fresh table -- the old table and its data are left behind. Plan a manual migration if you need the data carried over.

## Prefix Configuration

The `wh_per_` prefix is fixed at this commit. It is hardcoded in the source generators and schema initializers (`SchemaConfiguration` defaults to `PerspectivePrefix = "wh_per_"`, and all built-in providers pass that value). There is no supported runtime or MSBuild option to change it.

## Best Practices

1. **Use descriptive model type names**: `OrderSummaryDto` is better than `OrdSum`
2. **Let suffix stripping work**: Don't manually abbreviate names
3. **Avoid acronyms in model names**: `ApiUsage` gives `wh_per_api_usage`; `APIUsage` gives `wh_per_a_p_i_usage`
4. **Be consistent**: Pick one suffix convention (`Projection`, `Dto`, etc.) for your team
5. **Never name a model exactly a suffix**: `Model` or `Dto` alone strips to an empty table base name

## See Also

- [Perspective Registry](registry.md) - Automatic table tracking and renaming
- [Schema Migration](../../data/schema-migration.md) - Database schema management
- [Temporal Perspectives](temporal.md) - Append-only perspective pattern
