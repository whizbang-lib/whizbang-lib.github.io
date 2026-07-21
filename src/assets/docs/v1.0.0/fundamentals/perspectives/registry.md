---
title: "Perspective Registry"
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: "Perspectives"
order: 6
description: >-
  The perspective registry is a system table that tracks the mapping between perspective model types
  and their database tables. Enables automatic schema management, drift detection via SHA-256
  hashing, and safe table renaming across deployments.
tags: 'perspective-registry, schema-management, drift-detection, table-mapping, perspectives'
codeReferences:
  - src/Whizbang.Data.Schema/Schemas/PerspectiveRegistrySchema.cs
  - src/Whizbang.Data.Postgres/Migrations/030_ReconcilePerspectiveRegistry.sql
  - src/Whizbang.Data.EFCore.Postgres.Generators/Templates/DbContextSchemaExtensionTemplate.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/EFCoreServiceRegistrationGenerator.cs
  - src/Whizbang.Generators.Shared/Utilities/SchemaHashUtilities.cs
testReferences:
  - tests/Whizbang.Generators.Tests/Utilities/SchemaHashUtilitiesTests.cs
  - tests/Whizbang.Generators.Tests/Utilities/NamingConventionUtilitiesTests.cs
  - tests/Whizbang.Generators.Tests/EFCoreServiceRegistrationGeneratorCoverageTests.cs
lastMaintainedCommit: '01f07906'
---

# Perspective Registry

The perspective registry is a system table that tracks the mapping between your perspective **model types** (the `TModel` in `IPerspectiveFor<TModel, ...>`) and their corresponding database tables. It enables automatic schema management, drift detection, and safe table renaming across deployments.

## Overview

When Whizbang creates perspective tables, it registers metadata about each perspective in the `wh_perspective_registry` table. This enables:

| Feature | Description |
|---------|-------------|
| **CLR Type Tracking** | Maps fully-qualified model type names to table names |
| **Schema Hashing** | SHA-256 hash of table schema for drift detection |
| **Auto-Rename** | Automatically renames tables when perspective names change |
| **Multi-Service** | Tracks which service owns each perspective |

## How It Works

### Registration Flow

```mermaid{caption="Perspective registry reconciliation flow — the source generator emits per-type metadata (CLR type, table name, schema JSON, schema hash) at compile time, then at startup the application calls reconcile_perspective_registry(), which inserts new types and detects renames and drift."}
flowchart TD
    Generator["Source Generator<br/>(compile time)<br/><br/>Generates metadata:<br/>- CLR type name<br/>- Table name<br/>- Schema JSON<br/>- Schema hash"]
    AppStart["Application Start<br/>(runtime)<br/><br/>Calls reconcile_perspective_registry()"]
    Database["Database<br/><br/>- Inserts new types<br/>- Detects renames<br/>- Detects drift"]

    Generator --> AppStart
    AppStart --> Database
```

### Registry Table Schema

```sql{title="Registry Table Schema" description="Registry Table Schema" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Registry", "Table"]}
CREATE TABLE wh_perspective_registry (
  id UUID PRIMARY KEY,
  clr_type_name VARCHAR(500) NOT NULL,    -- "MyApp.Contracts.OrderData" (model type)
  table_name VARCHAR(255) NOT NULL,        -- "wh_per_order_data"
  schema_json JSONB NOT NULL,              -- Full column/index definition
  schema_hash VARCHAR(64) NOT NULL,        -- SHA-256 of canonical schema
  service_name VARCHAR(255) NOT NULL,      -- "MyApp.Api"
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(clr_type_name, service_name)
);
```

## Reconciliation Actions

When your application starts, the reconciliation function compares registered perspectives against the database and returns actions taken:

| Action | When It Occurs |
|--------|----------------|
| `inserted` | New perspective type registered for the first time |
| `updated` | Existing type refreshed (timestamps updated) |
| `renamed` | Table name changed - executes `ALTER TABLE RENAME` |
| `drift_detected` | Schema hash differs from previous deployment |

### Example Output

```csharp{title="Example Output" description="Example Output" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Example", "Output"] unverified="startup log output sample — not executable code"}
// Startup logs show reconciliation results
[DBG] Registered new perspective: MyApp.Contracts.OrderData → wh_per_order_data
[WRN] Renamed perspective table: MyApp.Contracts.CustomerData from wh_per_customer_data → wh_per_customer
[WRN] Schema drift detected for perspective: MyApp.Contracts.ProductData (wh_per_product_data)
[DBG] Perspective registry reconciliation complete: 1 inserted, 4 updated, 1 renamed, 1 drift warnings
```

## Schema Drift Detection

Schema drift occurs when your C# perspective class changes but the database table wasn't updated. The registry detects this by comparing schema hashes.

### What Causes Drift

- Adding or removing physical field columns on your perspective model
- Changing physical field column types (e.g., `int` to `long`)
- Adding or removing indexes (e.g., via `[PhysicalField(indexed: true)]`)
- Changing vector field dimensions

### Handling Drift

Drift detection is **informational**: when the reconciliation function returns `drift_detected`, Whizbang logs a warning (`Schema drift detected for perspective: ...`) and continues startup. Reconciliation failures never abort initialization. When you see a drift warning you can:

1. **Run migrations** to update the table schema
2. **Recreate the table** if the changes are breaking
3. **Ignore** if the changes are backward-compatible

There is no configuration knob for drift behavior at this commit -- the warning is always logged, and no automatic migration is attempted.

## Automatic Table Renaming

Table names are generated from the perspective **model** type name (see [Table Naming](table-naming.md)). When the generated table name changes -- for example, after changing suffix-stripping configuration -- the registry automatically handles the rename:

### Before

```csharp{title="Before" description="Before" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Before"] tests=["NamingConventionUtilitiesTests.GenerateTableName_WhenStripDisabled_IncludesSuffixAsync"]}
// Model type CustomerData with suffix stripping disabled
public class CustomerPerspective : IPerspectiveFor<CustomerData, CustomerCreatedEvent> {
  // Table: wh_per_customer_data
}
```

### After

```csharp{title="After" description="After" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "After"] tests=["NamingConventionUtilitiesTests.StripConfigurableSuffixes_CustomSuffixes_StripsCustomSuffixAsync", "NamingConventionUtilitiesTests.GenerateTableName_WithModel_GeneratesCorrectTableNameAsync"]}
// "Data" added to WhizbangTableNameSuffixesToStrip in the project file
public class CustomerPerspective : IPerspectiveFor<CustomerData, CustomerCreatedEvent> {
  // Table: wh_per_customer
}
```

### What Happens

1. Application starts and calls `reconcile_perspective_registry()`
2. Registry finds existing entry for the model type `MyApp.Contracts.CustomerData`
3. Detects table name changed from `wh_per_customer_data` to `wh_per_customer`
4. Executes: `ALTER TABLE IF EXISTS wh_per_customer_data RENAME TO wh_per_customer`
5. Updates registry with new table name

This happens automatically - no manual migration required. If the rename fails (e.g., the old table no longer exists), the registry entry is still updated and the action is reported as `updated`.

Note that renaming the **model type itself** changes the registry key (`clr_type_name`), so the reconciler treats it as a brand-new perspective (`inserted`) rather than a rename -- the old table is left in place.

## Multi-Service Scenarios

In microservice architectures, multiple services may define perspectives. The registry tracks which service owns each perspective via the `service_name` column.

```csharp{title="Multi-Service Scenarios" description="In microservice architectures, multiple services may define perspectives." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Multi-Service", "Scenarios"] unverified="domain illustration of multi-service registration and the service_name unique constraint, not an isolated library API"}
// Service A: OrderService
public class OrderProjection : IPerspectiveFor<OrderData, OrderCreatedEvent> { }
// Registered as: clr_type_name = "OrderService.Contracts.OrderData",
//                table_name = "wh_per_order_data", service_name = "OrderService"

// Service B: AnalyticsService
public class OrderAnalyticsProjection : IPerspectiveFor<OrderAnalytics, OrderCreatedEvent> { }
// Registered as: clr_type_name = "AnalyticsService.Contracts.OrderAnalytics",
//                table_name = "wh_per_order_analytics", service_name = "AnalyticsService"
```

The unique constraint `(clr_type_name, service_name)` allows the same model type name in different services.

## Schema JSON Format

The registry stores the full schema definition as JSON for debugging and migration tooling:

```json{title="Schema JSON Format" description="The registry stores the full schema definition as JSON for debugging and migration tooling:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Schema", "JSON"] tests=["SchemaHashUtilitiesTests.ToCanonicalJson_Columns_SortedByNameAsync", "SchemaHashUtilitiesTests.ToCanonicalJson_Indexes_SortedByNameAsync", "SchemaHashUtilitiesTests.ToCanonicalJson_Properties_UsesCamelCaseAsync", "SchemaHashUtilitiesTests.ToCanonicalJson_NullValues_OmitsNullPropertiesAsync"]}
{
  "columns": [
    {"isPrimaryKey": true, "name": "id", "type": "uuid"},
    {"name": "created_at", "type": "timestamptz"},
    {"name": "customer_id", "nullable": true, "type": "uuid"},
    {"name": "data", "type": "jsonb"},
    {"name": "metadata", "type": "jsonb"},
    {"name": "scope", "type": "jsonb"},
    {"name": "updated_at", "type": "timestamptz"},
    {"name": "version", "type": "integer"}
  ],
  "indexes": [
    {"columns": ["customer_id"], "name": "idx_customer_customer_id", "type": "btree"},
    {"columns": ["data"], "name": "idx_customer_data_gin", "type": "gin"}
  ]
}
```

Columns and indexes are sorted alphabetically by name, `false`/`null` values are omitted (e.g., `nullable` only appears for nullable columns), and vector columns carry `isVector` and `vectorDimensions` properties.

### Schema Hash Algorithm

The schema hash is computed using:

1. Serialize schema to **canonical JSON** (alphabetically sorted columns/indexes, camelCase keys, no whitespace, lowercase types, `false`/`null` omitted)
2. Encode as UTF-8 bytes
3. Compute SHA-256 hash
4. Output as 64-character lowercase hex string

This ensures consistent hashes across deployments regardless of serialization order.

## Querying the Registry

You can query the registry directly for debugging:

```sql{title="Querying the Registry" description="You can query the registry directly for debugging:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Querying", "Registry"]}
-- All perspectives for a service
SELECT clr_type_name, table_name, schema_hash, updated_at
FROM wh_perspective_registry
WHERE service_name = 'MyApp.Api'
ORDER BY table_name;

-- Find perspectives with schema drift (compare with application metadata)
SELECT clr_type_name, table_name, schema_hash
FROM wh_perspective_registry
WHERE schema_hash != 'expected_hash_from_app';

-- Recently updated perspectives
SELECT clr_type_name, table_name, updated_at
FROM wh_perspective_registry
WHERE updated_at > NOW() - INTERVAL '1 hour';
```

## Configuration

The registry is automatically created as part of the Whizbang infrastructure schema. No additional configuration is required.

```csharp{title="Configuration" description="The registry is automatically created as part of the Whizbang infrastructure schema." category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Configuration"] unverified="database initialization API — configuration, not covered by registry unit tests"}
// Registry is included in standard initialization
await dbContext.EnsureWhizbangDatabaseInitializedAsync();
```

## See Also

- [Table Naming](table-naming.md) - Configure table name generation
- [Schema Migration](../../data/schema-migration.md) - Database schema management
- [Temporal Perspectives](temporal.md) - Append-only perspective pattern
