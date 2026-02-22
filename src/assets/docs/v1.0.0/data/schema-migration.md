# Schema Migration

Whizbang provides automatic schema management for perspective tables, with built-in drift detection and safe rename operations. This page covers how Whizbang handles schema changes across deployments.

## Automatic Schema Creation

When your application starts, Whizbang automatically creates all required infrastructure tables and perspective tables:

```csharp
// In your startup code
await dbContext.EnsureWhizbangDatabaseInitializedAsync();
```

This single call:
1. Creates infrastructure tables (`wh_inbox`, `wh_outbox`, `wh_event_store`, etc.)
2. Creates perspective tables for all discovered perspectives
3. Registers perspectives in the [perspective registry](/docs/v1.0.0/perspectives/registry)
4. Detects and logs any schema drift

## Schema Drift Detection

Schema drift occurs when your C# perspective definition doesn't match the database table. Whizbang detects this by comparing SHA-256 hashes of the schema definition.

### Detection Flow

```
┌─────────────────────┐
│  Compile Time       │
├─────────────────────┤
│ Generate schema     │
│ JSON from C# class  │
│ Compute SHA-256     │
│ hash of schema      │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Runtime            │
├─────────────────────┤
│ Compare hash with   │
│ stored hash in      │
│ perspective_registry│
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  If Different       │
├─────────────────────┤
│ Log drift warning   │
│ Update registry     │
└─────────────────────┘
```

### What Causes Drift

| Change Type | Example | Drift Detected? |
|-------------|---------|-----------------|
| Add property | Add `Email` to `CustomerData` | Yes |
| Remove property | Remove `Phone` from `CustomerData` | Yes |
| Change type | `int CustomerId` → `Guid CustomerId` | Yes |
| Add physical field | Add `[PhysicalField]` attribute | Yes |
| Add index | Add `[Index]` attribute | Yes |
| Rename property | `Name` → `FullName` | Yes |
| Reorder properties | Move `Email` before `Name` | No* |

*Property order doesn't affect the schema hash.

### Handling Drift

When drift is detected, Whizbang logs a warning:

```
[WRN] Schema drift detected for MyApp.CustomerProjection
      Expected hash: a1b2c3d4...
      Stored hash:   e5f6g7h8...
      Table: wh_per_customer
```

You have several options:

#### Option 1: Ignore (Default)

If the changes are backward-compatible (adding nullable columns), you can proceed safely:

```csharp
services.AddWhizbang(options => {
  options.Perspectives.OnSchemaDrift = SchemaDriftBehavior.LogWarning;
});
```

#### Option 2: Throw Exception

For strict environments where drift should block deployment:

```csharp
services.AddWhizbang(options => {
  options.Perspectives.OnSchemaDrift = SchemaDriftBehavior.ThrowException;
});
```

#### Option 3: Manual Migration

For breaking changes, create a migration:

```sql
-- Add new column
ALTER TABLE wh_per_customer
ADD COLUMN email VARCHAR(255);

-- Update existing rows if needed
UPDATE wh_per_customer
SET data = jsonb_set(data, '{email}', '"unknown@example.com"')
WHERE data->>'email' IS NULL;
```

## Automatic Table Renaming

When you rename a perspective class or change its [table naming](/docs/v1.0.0/perspectives/table-naming) configuration, Whizbang automatically renames the table:

### How It Works

1. Source generator computes new table name
2. Application starts and calls reconciliation
3. Registry finds existing entry for the CLR type
4. Detects table name mismatch
5. Executes `ALTER TABLE ... RENAME TO ...`
6. Updates registry with new name

### Example

```csharp
// Before: Table is wh_per_customer_dto
public class CustomerDto : IPerspectiveFor<CustomerData, CustomerEvent> { }

// After: You enable suffix stripping (default in v1.0.0)
// Table becomes wh_per_customer
public class CustomerDto : IPerspectiveFor<CustomerData, CustomerEvent> { }
```

On deployment:
```sql
-- Executed automatically
ALTER TABLE wh_per_customer_dto RENAME TO wh_per_customer;
```

### Rename Safety

The rename operation is safe because:
- It's atomic (single DDL statement)
- No data is modified or lost
- Indexes and constraints are preserved
- Registry tracks the change for auditing

## Multi-Environment Considerations

### Development vs Production

```csharp
services.AddWhizbang(options => {
  if (env.IsDevelopment()) {
    // Recreate tables on schema change (lose data)
    options.Perspectives.OnSchemaDrift = SchemaDriftBehavior.RecreateTable;
  } else {
    // Strict mode for production
    options.Perspectives.OnSchemaDrift = SchemaDriftBehavior.ThrowException;
  }
});
```

### CI/CD Pipeline

Include schema validation in your deployment pipeline:

```yaml
# Azure DevOps / GitHub Actions example
- name: Validate Schema
  run: |
    dotnet run --project MyApp.Api -- --validate-schema-only
    if [ $? -ne 0 ]; then
      echo "Schema drift detected! Run migrations before deploying."
      exit 1
    fi
```

## Infrastructure Schema

Whizbang infrastructure tables are versioned and migrated automatically:

| Table | Purpose |
|-------|---------|
| `wh_inbox` | Message deduplication |
| `wh_outbox` | Transactional messaging |
| `wh_event_store` | Event persistence |
| `wh_perspective_registry` | CLR type → table mapping |
| `wh_perspective_checkpoints` | Projection progress tracking |
| `wh_service_instances` | Distributed coordination |

### Migration Files

Infrastructure migrations are embedded in the Whizbang.Data.Postgres package:

```
Migrations/
├── 001_CreateComputePartitionFunction.sql
├── 002_CreateAcquireReceptorProcessingFunction.sql
├── ...
├── 030_DecompositionComplete.sql
└── 031_ReconcilePerspectiveRegistry.sql
```

Migrations are applied automatically and idempotently.

## Schema JSON Format

The registry stores full schema definitions as JSON:

```json
{
  "columns": [
    {
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "isPrimaryKey": true
    },
    {
      "name": "data",
      "type": "jsonb",
      "nullable": false
    },
    {
      "name": "customer_id",
      "type": "uuid",
      "nullable": true,
      "isPhysicalField": true
    }
  ],
  "indexes": [
    {
      "name": "idx_customer_customer_id",
      "columns": ["customer_id"],
      "type": "btree",
      "isUnique": false
    }
  ]
}
```

### Supported Column Types

| C# Type | PostgreSQL | JSON Key |
|---------|------------|----------|
| `Guid` | `UUID` | `"uuid"` |
| `string` | `TEXT` | `"text"` |
| `int` | `INTEGER` | `"integer"` |
| `long` | `BIGINT` | `"bigint"` |
| `bool` | `BOOLEAN` | `"boolean"` |
| `DateTime` | `TIMESTAMPTZ` | `"timestamptz"` |
| `byte[]` | `BYTEA` | `"bytea"` |
| JSON data | `JSONB` | `"jsonb"` |
| `Vector` | `VECTOR(n)` | `"vector"` |

### Index Types

| Index Type | PostgreSQL | Use Case |
|------------|------------|----------|
| `btree` | B-Tree | General queries, sorting |
| `gin` | GIN | JSONB containment, full-text |
| `ivfflat` | IVF Flat | Vector similarity (approximate) |
| `hnsw` | HNSW | Vector similarity (fast) |

## Rollback Strategies

### Preserve Old Table

Before making breaking changes, rename the old table:

```sql
-- Before deployment
ALTER TABLE wh_per_customer RENAME TO wh_per_customer_backup;

-- After verifying new version works
DROP TABLE wh_per_customer_backup;
```

### Dual-Write Period

For zero-downtime migrations:

1. Deploy new code that writes to both old and new tables
2. Backfill new table from old table
3. Switch reads to new table
4. Remove dual-write code
5. Drop old table

## Troubleshooting

### "Schema drift detected" Warning

**Cause**: C# class changed but database table wasn't updated.

**Solutions**:
1. For nullable additions: Safe to ignore
2. For breaking changes: Run migration
3. For development: Set `RecreateTable` behavior

### "Table rename failed"

**Cause**: Old table doesn't exist or name collision.

**Solutions**:
1. Check if table was already renamed manually
2. Check for existing table with new name
3. Run `SELECT * FROM wh_perspective_registry` to see current state

### "Perspective not found in registry"

**Cause**: First deployment or registry was cleared.

**Solutions**:
1. Expected on first run - table will be created
2. If registry was cleared, tables still exist but aren't tracked
3. Manually insert registry entries if needed

## See Also

- [Perspective Registry](/docs/v1.0.0/perspectives/registry) - CLR type tracking
- [Table Naming](/docs/v1.0.0/perspectives/table-naming) - Naming conventions
- [EF Core JSON Configuration](/docs/v1.0.0/data/efcore-json-configuration) - JSON column setup
