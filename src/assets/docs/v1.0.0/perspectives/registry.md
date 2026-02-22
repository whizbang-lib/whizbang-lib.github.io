# Perspective Registry

The perspective registry is a system table that tracks the mapping between your C# perspective types and their corresponding database tables. It enables automatic schema management, drift detection, and safe table renaming across deployments.

## Overview

When Whizbang creates perspective tables, it registers metadata about each perspective in the `wh_perspective_registry` table. This enables:

| Feature | Description |
|---------|-------------|
| **CLR Type Tracking** | Maps fully-qualified C# type names to table names |
| **Schema Hashing** | SHA-256 hash of table schema for drift detection |
| **Auto-Rename** | Automatically renames tables when perspective names change |
| **Multi-Service** | Tracks which service owns each perspective |

## How It Works

### Registration Flow

```
┌─────────────────────┐
│  Source Generator   │
│  (compile time)     │
├─────────────────────┤
│ Generates metadata: │
│ - CLR type name     │
│ - Table name        │
│ - Schema JSON       │
│ - Schema hash       │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Application Start  │
│  (runtime)          │
├─────────────────────┤
│ Calls reconcile_    │
│ perspective_        │
│ registry()          │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Database           │
├─────────────────────┤
│ - Inserts new types │
│ - Detects renames   │
│ - Detects drift     │
└─────────────────────┘
```

### Registry Table Schema

```sql
CREATE TABLE wh_perspective_registry (
  id UUID PRIMARY KEY,
  clr_type_name VARCHAR(500) NOT NULL,    -- "MyApp.OrderProjection, MyApp"
  table_name VARCHAR(255) NOT NULL,        -- "wh_per_order"
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

```csharp
// Startup logs show reconciliation results
[INF] Perspective registry reconciliation complete:
[INF]   - inserted: MyApp.NewOrderProjection -> wh_per_new_order
[INF]   - renamed: MyApp.CustomerDto -> wh_per_customer (was: wh_per_customer_dto)
[INF]   - drift_detected: MyApp.ProductView (schema changed)
```

## Schema Drift Detection

Schema drift occurs when your C# perspective class changes but the database table wasn't updated. The registry detects this by comparing schema hashes.

### What Causes Drift

- Adding or removing properties from your perspective model
- Changing property types (e.g., `int` to `long`)
- Adding new indexes via attributes
- Removing physical fields

### Handling Drift

When drift is detected, Whizbang logs a warning. You can then:

1. **Run migrations** to update the table schema
2. **Recreate the table** if the changes are breaking
3. **Ignore** if the changes are backward-compatible

```csharp
// Configure drift handling behavior
services.AddWhizbang(options => {
  options.Perspectives.OnSchemaDrift = SchemaDriftBehavior.LogWarning;
  // Other options: ThrowException, AutoMigrate (future)
});
```

## Automatic Table Renaming

When you rename a perspective class or change its table name, the registry automatically handles the rename:

### Before

```csharp
[Perspective("customer_dto")]  // Old name
public class CustomerDto : IPerspectiveFor<CustomerData, CustomerCreatedEvent> {
  // ...
}
```

### After

```csharp
[Perspective("customer")]  // New name (or rely on suffix stripping)
public class CustomerDto : IPerspectiveFor<CustomerData, CustomerCreatedEvent> {
  // ...
}
```

### What Happens

1. Application starts and calls `reconcile_perspective_registry()`
2. Registry finds existing entry for `MyApp.CustomerDto`
3. Detects table name changed from `wh_per_customer_dto` to `wh_per_customer`
4. Executes: `ALTER TABLE wh_per_customer_dto RENAME TO wh_per_customer`
5. Updates registry with new table name

This happens automatically - no manual migration required.

## Multi-Service Scenarios

In microservice architectures, multiple services may define perspectives. The registry tracks which service owns each perspective via the `service_name` column.

```csharp
// Service A: OrderService
public class OrderProjection : IPerspectiveFor<OrderData, OrderCreatedEvent> { }
// Registered as: OrderService.OrderProjection, wh_per_order, "OrderService"

// Service B: AnalyticsService
public class OrderProjection : IPerspectiveFor<OrderAnalytics, OrderCreatedEvent> { }
// Registered as: AnalyticsService.OrderProjection, wh_per_order, "AnalyticsService"
```

The unique constraint `(clr_type_name, service_name)` allows the same type name in different services.

## Schema JSON Format

The registry stores the full schema definition as JSON for debugging and migration tooling:

```json
{
  "columns": [
    {"name": "id", "type": "uuid", "nullable": false, "isPrimaryKey": true},
    {"name": "data", "type": "jsonb", "nullable": false},
    {"name": "customer_id", "type": "uuid", "nullable": true, "isPhysicalField": true}
  ],
  "indexes": [
    {"name": "idx_customer_customer_id", "columns": ["customer_id"], "type": "btree"}
  ]
}
```

### Schema Hash Algorithm

The schema hash is computed using:

1. Serialize schema to **canonical JSON** (sorted keys, no whitespace, lowercase types)
2. Encode as UTF-8 bytes
3. Compute SHA-256 hash
4. Output as 64-character lowercase hex string

This ensures consistent hashes across deployments regardless of serialization order.

## Querying the Registry

You can query the registry directly for debugging:

```sql
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

```csharp
// Registry is included in standard initialization
await dbContext.EnsureWhizbangDatabaseInitializedAsync();
```

## See Also

- [Table Naming](/docs/v1.0.0/perspectives/table-naming) - Configure table name generation
- [Schema Migration](/docs/v1.0.0/data/schema-migration) - Database schema management
- [Temporal Perspectives](/docs/v1.0.0/perspectives/temporal) - Append-only perspective pattern
