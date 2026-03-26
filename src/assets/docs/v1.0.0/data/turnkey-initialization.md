---
title: Turnkey Database Initialization
version: 1.0.0
category: Data Access
order: 5
description: >-
  One-line database initialization that creates infrastructure tables,
  perspective tables, indexes, PostgreSQL extensions, and functions before
  application startup to prevent race conditions.
tags: 'turnkey-initialization, database-setup, startup, ef-core, postgresql, schema-creation'
codeReferences:
  - src/Whizbang.Data.EFCore.Postgres/DbContextInitializationRegistry.cs
  - src/Whizbang.Data.EFCore.Postgres/WhizbangHostExtensions.cs
  - src/Whizbang.Data.EFCore.Postgres/WhizbangDatabaseInitializerService.cs
  - src/Whizbang.Data.EFCore.Postgres/SchemaInitializationLog.cs
---

# Turnkey Database Initialization

Whizbang provides a simple one-line initialization method that ensures your database schema is ready before your application starts. This prevents race conditions where background services might try to query the database before tables or extensions (like pgvector) are created.

## Quick Start

```csharp{title="Quick Start" description="Demonstrates quick Start" category="Implementation" difficulty="BEGINNER" tags=["Data", "Quick", "Start"]}
var app = builder.Build();

// Initialize Whizbang database BEFORE starting the app
await app.EnsureWhizbangInitializedAsync();

await app.RunAsync();
```

## What It Does

`EnsureWhizbangInitializedAsync()` performs the following for each registered `[WhizbangDbContext]`:

1. **Creates core infrastructure tables** - Inbox, Outbox, EventStore, and other Whizbang tables
2. **Creates perspective tables** - Tables for your `PerspectiveRow<TModel>` types
3. **Adds constraints and indexes** - Foreign keys, composite primary keys, GIN indexes on JSONB columns
4. **Installs PostgreSQL extensions** - Creates `vector` extension if any perspectives have `[VectorField]` columns
5. **Creates PostgreSQL functions** - `process_work_batch`, `register_message_associations`, etc.
6. **Registers perspective associations** - Populates routing metadata for event dispatching

## Why Use It

### Before (Manual Initialization)

```csharp{title="Before (Manual Initialization)" description="Demonstrates before (Manual Initialization)" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "Before", "Manual", "Initialization"]}
// Error-prone: Must remember to do this for each DbContext
// Risk: Code might run in the wrong order or be forgotten
{
  using var scope = app.Services.CreateScope();
  var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
  var dbContext = scope.ServiceProvider.GetRequiredService<MyDbContext>();
  await dbContext.EnsureWhizbangDatabaseInitializedAsync(logger);
}
await app.RunAsync();
```

### After (Turnkey Initialization)

```csharp{title="After (Turnkey Initialization)" description="Demonstrates after (Turnkey Initialization)" category="Implementation" difficulty="BEGINNER" tags=["Data", "After", "Turnkey", "Initialization"]}
// Simple: One line initializes ALL registered DbContexts
// Safe: Runs before app starts, preventing race conditions
await app.EnsureWhizbangInitializedAsync();
await app.RunAsync();
```

## How It Works

The source generator automatically registers each `[WhizbangDbContext]`-annotated DbContext with `DbContextInitializationRegistry`. When you call `EnsureWhizbangInitializedAsync()`, it:

1. Iterates through all registered DbContexts
2. Resolves each DbContext from the service provider
3. Calls `EnsureWhizbangDatabaseInitializedAsync()` on each

This is AOT-compatible with no reflection - all registration happens via source-generated module initializers.

## Multiple DbContexts

If your application has multiple Whizbang DbContexts, they are all initialized automatically:

```csharp{title="Multiple DbContexts" description="If your application has multiple Whizbang DbContexts, they are all initialized automatically:" category="Implementation" difficulty="BEGINNER" tags=["Data", "Multiple", "DbContexts"]}
// Both DbContexts are initialized with one call
builder.Services.AddWhizbang()
    .WithEFCore<OrderDbContext>()
    .WithDriver.Postgres;

builder.Services.AddWhizbang()
    .WithEFCore<InventoryDbContext>()
    .WithDriver.Postgres;

var app = builder.Build();
await app.EnsureWhizbangInitializedAsync(); // Initializes both!
await app.RunAsync();
```

## Logging

Initialization progress is logged at `Information` level:

```
info: Whizbang.Initialization[0]
      Initializing 1 Whizbang DbContext(s)...
info: Whizbang.Initialization[0]
      Initializing ChatDbContext...
info: Whizbang.Initialization[0]
      All Whizbang DbContext(s) initialized successfully
```

## Idempotency

All initialization operations are idempotent. It's safe to call `EnsureWhizbangInitializedAsync()` multiple times - existing tables and functions are not recreated.

## Multi-Instance Initialization

When deploying multiple instances (pods) of the same service, Whizbang coordinates database initialization using PostgreSQL advisory locks to prevent concurrent schema modifications.

### How It Works

1. **Advisory lock acquisition** — Each pod attempts to acquire a non-blocking advisory lock (`pg_try_advisory_lock`) based on the schema name. Only one pod can hold the lock at a time.
2. **Randomized exponential backoff** — If the lock is held by another pod, the waiting pod retries with exponential backoff (100ms → 200ms → 400ms → ... capped at 20 seconds) plus random jitter. This prevents a thundering herd when many pods start simultaneously.
3. **Schema initialization** — The pod that holds the lock runs all 7 initialization phases (tables, migrations, perspectives, constraints, associations, registry, maintenance).
4. **Lock release** — After initialization completes (or fails), the lock is released so the next pod can proceed.
5. **Retry indefinitely** — Pods retry forever until the lock is acquired. Only `CancellationToken` cancellation stops the retry loop.

### Idempotency Guarantees

All DDL operations are idempotent by design:

- Table creation uses `CREATE TABLE IF NOT EXISTS`
- Function creation uses `CREATE OR REPLACE FUNCTION`
- Migrations are hash-tracked — unchanged migrations are skipped automatically
- Constraints check for existing constraints before adding

This means even if two pods manage to overlap (e.g., the first pod crashes mid-initialization), the second pod will safely complete all remaining work without duplicating what was already done.

### Cancellation Safety

The advisory lock unlock always uses `CancellationToken.None` to ensure the lock is released even if the original cancellation token has been cancelled. This prevents a cancelled pod from leaving a dangling lock that would block all other pods indefinitely.

## See Also

- [EF Core JSON Configuration](./efcore-json-configuration.md)
- [Schema Migration](./schema-migration.md)
