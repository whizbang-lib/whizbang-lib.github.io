---
title: Migration Tracking
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
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

```csharp{title="Preview (Dry Run)" description="Preview what would happen without executing:" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Infrastructure", "Preview", "Dry"] tests=["PostgresSchemaInitializerTests.PreviewAsync_FreshDatabase_ShowsAllAsApplyAsync", "PostgresSchemaInitializerTests.PreviewAsync_AfterInitialize_ShowsAllAsSkipAsync", "PostgresSchemaInitializerTests.PreviewAsync_WithChangedPerspective_ShowsUpdateWithColumnDiffAsync"]}
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

```csharp{title="Rollback" description="Restore a blue-green backup table:" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Infrastructure", "Rollback"] tests=["PostgresSchemaInitializerTests.RollbackAsync_WithBackupTable_RestoresItAsync", "PostgresSchemaInitializerTests.RollbackAsync_WithNoBackup_ReturnsFalseAsync"]}
var success = await initializer.RollbackAsync("perspective:OrderPerspective");
// Swaps: active -> discarded, backup -> active
```

## Backup Cleanup

Remove old backup tables:

```csharp{title="Backup Cleanup" description="Remove old backup tables:" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Infrastructure", "Backup", "Cleanup"] tests=["PostgresSchemaInitializerTests.CleanupBackupsAsync_WithOldBackup_DropsItAsync", "PostgresSchemaInitializerTests.CleanupBackupsAsync_WithRecentBackup_KeepsItAsync"]}
var dropped = await initializer.CleanupBackupsAsync(olderThanDays: 30);
// Drops tables matching *_bak_* with dates older than threshold
```

## Version Auditing

Both the Whizbang library version and the consuming application version are recorded:

- **library_version**: The Whizbang NuGet package version (e.g., `0.9.4`)
- **application_version**: The consuming app's assembly name and version (e.g., `MyApp.OrderService/1.0.0`)

This lets you query which app version last applied migrations to a database.

### An older instance never overwrites a newer one

The recorded library version is not only for auditing — the applier reads it before running anything.

The decision to run a migration comes from comparing hashes, and hash inequality is **symmetric**: it says the content *differs*, never which side is newer. Because pre-v1 migration files are edited in place rather than superseded, that leaves a gap during a rolling deployment. An instance from the previous version that restarts after a newer one has migrated computes a different hash for its own older copy, and would re-apply it through `CREATE OR REPLACE` — returning objects to an earlier definition beneath the instances still running against them, with no error raised anywhere.

The [redefinition closure](#how-it-works) does not cover this. It re-runs every *later* file defining the same objects, and an older instance does not have those files.

So before applying, the runner compares its own library version against the version recorded on the ledger row, using **Semantic Versioning precedence**:

| Recorded against the row | Result |
|---|---|
| An older version | Applied normally — the ordinary upgrade path |
| The same version | Applied — this is how a drifted hash is repaired and how the redefinition closure re-runs |
| A **newer** version | **Skipped**, with a warning naming both versions |
| Nothing, or an unreadable version | Applied — a row predating version tracking must not leave a schema permanently unmigratable |

If the *running build's own* version is unreadable it applies nothing at all: a build that cannot state what it is has no business writing DDL.

Precedence follows the specification, including the parts that are easy to get wrong and that matter most before 1.0, when every release carries a pre-release label:

- a pre-release ranks **below** the release it precedes, so `1.0.0` outranks `1.0.0-rc.1`;
- numeric pre-release identifiers compare **numerically**, so `alpha.10` outranks `alpha.2` — comparing them as text inverts the answer;
- build metadata (`+sha.abc`) takes no part in precedence at all.

An instance that skips on this rule is not broken and needs no intervention: it is correctly declining to undo work done by a newer deployment.

### Stale duplicate overloads are swept automatically

Before `drop_all_overloads` resolved its own schema (it filtered by `current_schema()`, which pooled EF connections reduce to `public`), a signature change in a **multi-schema** deployment silently left the old overload beside the new one. Databases migrated through those prerelease versions can carry duplicates that make unqualified calls ambiguous and the next return-type change fail with `42P13`.

The initializer now detects this: when a framework-defined function name has more than one overload in the schema, the migrations defining that name are forced back into the run — their `drop_all_overloads` clears every overload and each file recreates its single canonical definition, with the redefinition closure re-running any later file defining the same object. One extra catalog query on a hash-clean boot; a clean database never re-runs anything. Consumer-defined functions with intentional overloads never trigger it — the check is intersected with the framework's own migration objects.

Log line to look for on an affected database's first boot after upgrading: `re-running to sweep stale duplicate overload(s)`.

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
- **Operational tuning knobs** read by SQL functions — e.g. `perform_maintenance` reads `debug_mode`, `dedup_retention_days`, `stuck_inbox_retention_days`, `abandoned_stream_hours` (the idle grace before an owner-less `wh_active_streams` row is purged), and `ephemeral_rewind_grace_seconds`. Later migrations redefine `perform_maintenance` in place, so the authoritative knob list is whatever the latest redefinition reads.

Settings are seeded by migrations with `ON CONFLICT (setting_key) DO NOTHING` (so operator overrides survive re-runs). Keep C#-worker-coupled timing constants (retry backoff, work leases, liveness thresholds) *out* of this table — tuning them independently of the workers that assume them causes drift.

## Pre-v1.0 Note

During pre-v1.0 development, migrations are **mutable** -- edit SQL files in place rather than creating new migration files. The hash tracking system handles re-execution automatically when content changes.
