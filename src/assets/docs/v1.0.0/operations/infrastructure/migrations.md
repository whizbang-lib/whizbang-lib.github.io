---
title: Migration Tracking
version: 1.0.0
category: Infrastructure
order: 5
description: >-
  Hash-based migration tracking with per-perspective change detection,
  blue-green table swaps, preview/rollback, and version auditing
tags: >-
  migrations, schema, hash-tracking, blue-green, rollback, preview,
  database, ddl, perspective-tracking
codeReferences:
  - src/Whizbang.Data.Dapper.Postgres/PostgresSchemaInitializer.cs
  - src/Whizbang.Core/Data/IMigrationProvider.cs
  - src/Whizbang.Data.Postgres/Migrations/000_MigrationTracking.sql
  - src/Whizbang.Data.EFCore.Postgres.Generators/Templates/DbContextSchemaExtensionTemplate.cs
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

## Pre-v1.0 Note

During pre-v1.0 development, migrations are **mutable** -- edit SQL files in place rather than creating new migration files. The hash tracking system handles re-execution automatically when content changes.
