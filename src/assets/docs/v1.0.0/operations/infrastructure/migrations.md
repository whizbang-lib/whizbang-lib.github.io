---
title: Migration Tracking
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Infrastructure
order: 5
description: >-
  Hash-based migration tracking with per-perspective change detection,
  blue-green table swaps, preview/rollback, version auditing, and
  settings-gated data migrations
tags: >-
  migrations, schema, hash-tracking, blue-green, rollback, preview,
  database, ddl, perspective-tracking, data-migration, wh-settings
codeReferences:
  - src/Whizbang.Data.Dapper.Postgres/PostgresSchemaInitializer.cs
  - src/Whizbang.Core/Data/IMigrationProvider.cs
  - src/Whizbang.Data.Postgres/Migrations/000_MigrationTracking.sql
  - src/Whizbang.Data.EFCore.Postgres.Generators/Templates/DbContextSchemaExtensionTemplate.cs
  - src/Whizbang.Data.Postgres/Migrations/063_NormalizeClrTypeNamesV2.sql
  - src/Whizbang.Data.Postgres/Migrations/032_PerformMaintenance.sql
testReferences:
  - tests/Whizbang.Data.Dapper.Postgres.Tests/NormalizeClrTypeNamesMigrationTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/PostgresSchemaInitializerTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/PostgresSchemaInitializerBranchTests.cs
lastMaintainedCommit: '01f07906'
---

# Migration Tracking

Whizbang uses **hash-based migration tracking** to manage database schema changes automatically. Every SQL migration and perspective schema is tracked by its SHA-256 content hash, enabling skip-on-unchanged behavior, change detection, and operational tooling.

## How It Works

On each application startup, Whizbang:

1. **Creates tracking tables** (`wh_schema_versions`, `wh_schema_migrations`) if they don't exist
2. **Records the library version** and application version in `wh_schema_versions`
3. **Hash-checks each migration**: computes SHA-256, compares to stored hash
4. **Skips unchanged migrations** (status 3) or **re-executes changed ones** (status 2)
5. **Tracks each perspective individually** with `perspective:<Name>` keys

```
wh_schema_versions
  id | library_version  | application_version     | applied_at
  1  | 0.9.4-local.65   | MyApp.OrderService/1.0.0 | 2026-03-16 ...

wh_schema_migrations
  file_name                    | content_hash     | status | status_description
  006_CreateNormalizeEvent...  | a1b2c3d4...      | 3      | Skipped (hash unchanged)
  029_ProcessWorkBatch         | e5f6a7b8...      | 1      | First apply
  perspective:OrderModel       | c9d0e1f2...      | 1      | First apply
```

## Migration Statuses

| Status | Name | Meaning |
|--------|------|---------|
| 1 | Applied | Migration executed for the first time |
| 2 | Updated | Migration SQL changed, re-executed |
| 3 | Skipped | Hash unchanged, execution skipped |
| 4 | MigratingInBackground | Destructive change detected, background rebuild queued |
| -1 | Failed | Migration threw an exception |

## Per-Perspective Tracking

Each perspective schema (CREATE TABLE + indexes) is tracked individually. When a developer adds a `[PhysicalField]` or changes a model, the source generator produces updated DDL. On next startup:

- **Hash matches**: Skip (no DDL executed)
- **Additive change** (new column/index): Column-copy blue-green swap
- **Destructive change** (type change, column removal): Background event replay queued

This means unchanged perspectives have **zero startup cost** after first deployment.

## Strategy Detection

When a perspective's hash changes and the table already exists, Whizbang auto-detects the migration strategy:

| Strategy | Trigger | Action |
|----------|---------|--------|
| **DirectDDL** | New table or identical structure | Execute DDL directly |
| **ColumnCopy** | Additive changes only (new columns) | Blue-green swap with data copy |
| **EventReplay** | Destructive changes (type change, column removed) | Queue background rebuild |

## Preview (Dry Run)

Preview what would happen without executing:

```csharp{title="Preview (Dry Run)" description="Preview what would happen without executing:" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Infrastructure", "Preview", "Dry"]}
var initializer = new PostgresSchemaInitializer(connectionString, perspectiveEntries);
var plan = await initializer.PreviewAsync();

foreach (var step in plan.Steps) {
  Console.WriteLine($"{step.Name}: {step.Action}");
  if (step.AddedColumns != null)
    Console.WriteLine($"  + columns: {string.Join(", ", step.AddedColumns)}");
  if (step.RemovedColumns != null)
    Console.WriteLine($"  - columns: {string.Join(", ", step.RemovedColumns)}");
}
```

## Rollback

Restore a blue-green backup table:

```csharp{title="Rollback" description="Restore a blue-green backup table:" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Infrastructure", "Rollback"]}
var success = await initializer.RollbackAsync("perspective:OrderPerspective");
// Swaps: active -> discarded, backup -> active
```

## Backup Cleanup

Remove old backup tables:

```csharp{title="Backup Cleanup" description="Remove old backup tables:" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Infrastructure", "Backup", "Cleanup"]}
var dropped = await initializer.CleanupBackupsAsync(olderThanDays: 30);
// Drops tables matching *_bak_* with dates older than threshold
```

## Version Auditing

Both the Whizbang library version and the consuming application version are recorded:

- **library_version**: The Whizbang NuGet package version (e.g., `0.9.4`)
- **application_version**: The consuming app's assembly name and version (e.g., `MyApp.OrderService/1.0.0`)

This lets you query which app version last applied migrations to a database.

## Data Migrations vs. Schema Migrations

Hash tracking answers **"did the DDL / object *shape* change?"** — the SHA-256 is over the migration's SQL text, which for schema migrations mirrors the object it defines. That is exactly the wrong question for a **pure data migration** that rewrites *rows* without changing any table's shape: the hash can't tell whether the data still needs the fix, and re-scanning a large table on every startup is wasteful.

For those, gate the work on a **version marker row in `wh_settings`** instead of the migration hash:

```sql{title="Settings-gated data migration" description="Gate a one-time data rewrite on a wh_settings version, not the migration hash" category="Configuration" difficulty="ADVANCED" tags=["Operations", "Infrastructure", "Data-Migration", "Settings"]}
DO $migrate$
DECLARE v_version INTEGER;
BEGIN
  SELECT setting_value::INTEGER INTO v_version
  FROM __SCHEMA__.wh_settings WHERE setting_key = 'my_data_format_version';
  IF COALESCE(v_version, 1) >= 2 THEN
    RETURN;                       -- O(1) check; already migrated, no table scan
  END IF;

  -- ... one-time UPDATE(s) to normalize existing rows ...

  INSERT INTO __SCHEMA__.wh_settings (setting_key, setting_value, value_type, description)
  VALUES ('my_data_format_version', '2', 'integer', 'Encoding version of <column>.')
  ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW();
END
$migrate$;
```

The canonical example is `063_NormalizeClrTypeNamesV2.sql`, which normalizes stored CLR type names (both message and perspective types) to their `+`-nested form and records `clr_type_name_format_version = 3`. Because the migration file still ships and runs through the normal chain, the marker — not the file hash — is the source of truth for *data* state; bumping the marker (e.g. `2 → 3` when the normalization was extended to cover perspective types) makes the pass re-run once on already-migrated databases, and re-running after the current version is a cheap no-op.

### The `wh_settings` table

`wh_settings` (a `setting_key` / `setting_value` / `value_type` / `description` key-value table) is the home for two kinds of SQL-side entries:

- **Data-format version markers** — e.g. `clr_type_name_format_version` (above).
- **Operational tuning knobs** read by SQL functions — e.g. `perform_maintenance` reads `debug_mode`, `dedup_retention_days`, `stuck_inbox_retention_days`, and `abandoned_stream_hours` (the idle grace before an owner-less `wh_active_streams` row is purged).

Settings are seeded by migrations with `ON CONFLICT (setting_key) DO NOTHING` (so operator overrides survive re-runs). Keep C#-worker-coupled timing constants (retry backoff, work leases, liveness thresholds) *out* of this table — tuning them independently of the workers that assume them causes drift.

## Pre-v1.0 Note

During pre-v1.0 development, migrations are **mutable** -- edit SQL files in place rather than creating new migration files. The hash tracking system handles re-execution automatically when content changes.
