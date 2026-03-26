---
title: "Perspective Table Naming"
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
---

# Perspective Table Naming

Whizbang automatically generates database table names for your perspectives using configurable naming conventions. By default, common suffixes like `Projection`, `Model`, and `Dto` are stripped to create cleaner, shorter table names.

## Default Behavior

When you define a perspective, Whizbang converts the class name to snake_case and adds the `wh_per_` prefix:

| C# Class Name | Default Table Name |
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

  <!-- Suffixes to strip (default list shown) -->
  <WhizbangTableNameSuffixesToStrip>Model,Projection,ReadModel,Dto,View</WhizbangTableNameSuffixesToStrip>
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
  <!-- Add custom suffixes -->
  <WhizbangTableNameSuffixesToStrip>Model,Projection,ReadModel,Dto,View,ViewModel,State</WhizbangTableNameSuffixesToStrip>
</PropertyGroup>
```

## Explicit Table Names

Override the generated name using the `[Perspective]` attribute:

```csharp{title="Explicit Table Names" description="Override the generated name using the [Perspective] attribute:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Explicit", "Table"]}
// Explicit table name - ignores all conventions
[Perspective("custom_orders")]
public class OrderProjection : IPerspectiveFor<OrderData, OrderCreatedEvent> {
  // Table: wh_per_custom_orders
}
```

This is useful when:
- You need a specific table name for compatibility
- The generated name would be ambiguous
- You're renaming a perspective and want to preserve the old table name

## Naming Convention Details

### Conversion Rules

1. **PascalCase to snake_case**: `OrderDetails` → `order_details`
2. **Acronyms preserved**: `APIResponse` → `api_response`
3. **Numbers preserved**: `Order2024` → `order2024`
4. **Suffix stripping**: `OrderProjection` → `order` (suffix removed before conversion)

### Examples

| Class Name | Suffix Stripped | Snake Case | Final Table |
|------------|----------------|------------|-------------|
| `OrderProjection` | `Order` | `order` | `wh_per_order` |
| `CustomerAccountDto` | `CustomerAccount` | `customer_account` | `wh_per_customer_account` |
| `ProductInventoryModel` | `ProductInventory` | `product_inventory` | `wh_per_product_inventory` |
| `APIUsageView` | `APIUsage` | `api_usage` | `wh_per_api_usage` |
| `Order2024Projection` | `Order2024` | `order2024` | `wh_per_order2024` |

### Edge Cases

| Class Name | Notes | Table Name |
|------------|-------|------------|
| `Model` | Only suffix, no stripping | `wh_per_model` |
| `OrderModelProjection` | Only last suffix stripped | `wh_per_order_model` |
| `Dto` | Only suffix, no stripping | `wh_per_dto` |

## Table Name Conflicts

If two perspectives would generate the same table name, you'll get a compile-time error:

```csharp{title="Table Name Conflicts" description="If two perspectives would generate the same table name, you'll get a compile-time error:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Table", "Name"]}
// Both would generate wh_per_order
public class OrderProjection : IPerspectiveFor<OrderData, OrderCreatedEvent> { }
public class OrderDto : IPerspectiveFor<OrderSummary, OrderCreatedEvent> { }
// Error: WB1001 - Duplicate perspective table name 'wh_per_order'
```

Resolve by using explicit names:

```csharp{title="Table Name Conflicts - OrderProjection" description="Resolve by using explicit names:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Table", "Name"]}
[Perspective("order_details")]
public class OrderProjection : IPerspectiveFor<OrderData, OrderCreatedEvent> { }

[Perspective("order_summary")]
public class OrderDto : IPerspectiveFor<OrderSummary, OrderCreatedEvent> { }
```

## Renaming Perspectives

When you rename a perspective class, the [perspective registry](registry.md) automatically handles the table rename:

### Before

```csharp{title="Before" description="Demonstrates before" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Before"]}
public class CustomerDataProjection : IPerspectiveFor<CustomerData, CustomerEvent> { }
// Table: wh_per_customer_data
```

### After

```csharp{title="After" description="Demonstrates after" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "After"]}
public class CustomerProjection : IPerspectiveFor<CustomerData, CustomerEvent> { }
// Table: wh_per_customer
```

On next application start:
1. Registry detects table name changed
2. Executes `ALTER TABLE wh_per_customer_data RENAME TO wh_per_customer`
3. Data preserved, no migration needed

## Prefix Configuration

The `wh_per_` prefix is part of Whizbang's schema configuration:

```csharp{title="Prefix Configuration" description="The wh_per_ prefix is part of Whizbang's schema configuration:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Prefix", "Configuration"]}
services.AddWhizbang(options => {
  options.Schema.InfrastructurePrefix = "wh_";    // Default
  options.Schema.PerspectivePrefix = "wh_per_";   // Default
});
```

Changing prefixes affects all table names:

| Prefix | Table Name |
|--------|------------|
| `wh_per_` (default) | `wh_per_order` |
| `app_view_` | `app_view_order` |
| `proj_` | `proj_order` |

## Best Practices

1. **Use descriptive class names**: `OrderSummaryProjection` is better than `OrderProj`
2. **Let suffix stripping work**: Don't manually abbreviate names
3. **Use explicit names sparingly**: Only when conventions don't fit
4. **Be consistent**: Pick one suffix convention (`Projection`, `Dto`, etc.) for your team
5. **Document custom names**: If using `[Perspective("...")]`, explain why

## See Also

- [Perspective Registry](registry.md) - Automatic table tracking and renaming
- [Schema Migration](../../data/schema-migration.md) - Database schema management
- [Temporal Perspectives](temporal.md) - Append-only perspective pattern
