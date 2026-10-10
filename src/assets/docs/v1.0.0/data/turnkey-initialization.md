---
title: Turnkey Database Initialization
pageType: guide
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
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
  - src/Whizbang.Data.Postgres/WhizbangDatabaseInitializerService.cs
  - src/Whizbang.Data.Postgres/ISchemaInitializationRunner.cs
  - src/Whizbang.Data.Postgres/SchemaInitializationRegistration.cs
  - src/Whizbang.Data.Postgres/SchemaInitializationLock.cs
  - src/Whizbang.Data.Postgres/ISchemaInitializationObserver.cs
  - src/Whizbang.Data.Postgres/SchemaInitializationObservers.cs
  - src/Whizbang.Data.EFCore.Postgres/DbContextSchemaInitializationRunner.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperSchemaInitializationRunner.cs
  - src/Whizbang.Data.EFCore.Postgres/SchemaInitializationLog.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/Templates/DbContextSchemaExtensionTemplate.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/DbContextInitializationRegistryTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/SchemaInitializationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/SchemaInitializationConcurrencyTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupParity/StartupParityTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperSchemaStartupTests.cs
  - tests/Whizbang.Core.Component.Tests/Schema/SchemaInitializationRunnersTests.cs
lastMaintainedCommit: '01f07906'
---

# Turnkey Database Initialization

Whizbang provides a simple one-line initialization method that ensures your database schema is ready before your application starts. This prevents race conditions where background services might try to query the database before tables or extensions (like pgvector) are created.

## Quick Start

```csharp{title="Quick Start" description="Quick Start" category="Implementation" difficulty="BEGINNER" tags=["Data", "C#", "Quick", "Start"] tests=["DbContextInitializationRegistryTests.InitializeAllAsync_CallsAllRegisteredCallbacksAsync"]}
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
5. **Creates PostgreSQL functions** - `claim_work`, `store_outbox_messages`, `store_inbox_messages`, `register_message_associations`, etc.
6. **Registers perspective associations** - Populates routing metadata for event dispatching

## Why Use It

### Before (Manual Initialization)

```csharp{title="Before (Manual Initialization)" description="Before (Manual Initialization)" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Before", "Manual", "Initialization"] unverified="counter-example — error-prone manual per-DbContext pattern the turnkey call replaces"}
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

```csharp{title="After (Turnkey Initialization)" description="After (Turnkey Initialization)" category="Implementation" difficulty="BEGINNER" tags=["Data", "C#", "After", "Turnkey", "Initialization"] tests=["DbContextInitializationRegistryTests.InitializeAllAsync_CallsAllRegisteredCallbacksAsync"]}
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

In addition, `.WithDriver.Postgres` registers the `WhizbangDatabaseInitializerService` hosted service, which runs the same initialization and then signals `ISchemaReadyGate`. The Dapper driver registers the same service (see [Both drivers](#both-drivers)). Whizbang workers await this gate before issuing any SQL, so even if you forget the explicit `EnsureWhizbangInitializedAsync()` call, workers cannot race an uninitialized schema. The explicit call remains useful when your own startup code (seeding, health probes) needs the schema ready before `app.RunAsync()`.

:::updated
Non-blocking initialization is now the **turnkey default** (`SchemaInitializationOptions.NonBlockingSchemaInit = true`): the hosted service's `StartAsync` returns immediately and initialization runs in the **background**, so the host binds and answers liveness probes while migrations run. `ISchemaReadyGate` stays closed until initialization succeeds (fail-closed on failure), and the availability layer keeps the instance out of traffic in the meantime — `SchemaReadyHealthCheck` reports not-ready and `DatabaseAvailabilityMiddleware` returns 503 with a `Retry-After` header until the gate opens. Set `NonBlockingSchemaInit = false` to opt back into blocking inline initialization (host startup does not complete — no HTTP port, no workers — until migrations finish, and a migration failure aborts startup). An optional `MigrationTimeout` (default: none) caps a single background attempt so a hung migration fails the rollout instead of wedging forever.
:::

## Multiple DbContexts

If your application has multiple Whizbang DbContexts, they are all initialized automatically:

```csharp{title="Multiple DbContexts" description="If your application has multiple Whizbang DbContexts, they are all initialized automatically:" category="Implementation" difficulty="BEGINNER" tags=["Data", "C#", "Multiple", "DbContexts"] tests=["DbContextInitializationRegistryTests.InitializeAllAsync_CallsAllRegisteredCallbacksAsync", "DbContextInitializationRegistryTests.Count_ReturnsNumberOfRegisteredInitializersAsync"]}
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

## Idempotency {#idempotency}

All initialization operations are idempotent. It's safe to call `EnsureWhizbangInitializedAsync()` multiple times - existing tables and functions are not recreated.

The in-process guard that turns a repeat call into a no-op is keyed on the **host** (its root service provider), not on the process. A process that builds several hosts, each against its own database (a test suite with a host per test, or a composition root that hosts two services), initializes every one of them. Only the same host asking twice is skipped, and the skip is logged at Debug as "Whizbang database already initialized". Earlier versions kept a single process-wide flag, so every host after the first was skipped and started against a database with no schema at all; the first symptom was the duty elector failing on a missing `record_capability` function, surfaced as a Kestrel bind cancellation.

```csharp{title="Per-host initialization" description="Two hosts in one process each initialize their own database; the same host asking twice is a no-op." category="Configuration" difficulty="INTERMEDIATE" tags=["Data", "Initialization", "Idempotency", "Hosting"] tests=["WhizbangHostExtensionsTests.EnsureWhizbangInitializedAsync_TwoHostsInOneProcess_InitializesBothAsync", "WhizbangHostExtensionsTests.EnsureWhizbangInitializedAsync_SameHostTwice_InitializesOnceAsync", "DbContextInitializationRegistryTests.InitializeAllAsync_DifferentServiceProviders_EachInitializeAsync"]}
var first = BuildHost(connectionStringA);
var second = BuildHost(connectionStringB);

await first.EnsureWhizbangInitializedAsync();   // initializes database A
await second.EnsureWhizbangInitializedAsync();  // initializes database B — not "already initialized"
await first.EnsureWhizbangInitializedAsync();   // no-op for the same host
```

## Multi-Instance Initialization

When deploying multiple instances (pods) of the same service, Whizbang coordinates database initialization using PostgreSQL advisory locks to prevent concurrent schema modifications.

### How It Works

1. **Fast path (no lock)** — Each pod first compares stored schema hashes (in `wh_schema_migrations`) against the compile-time hashes. If nothing changed, initialization is skipped entirely — no lock is taken.
2. **Advisory lock acquisition** — On hash mismatch (or first run), the pod attempts a non-blocking, transaction-level advisory lock (`pg_try_advisory_xact_lock`) derived from the schema name. Transaction-level locks are PgBouncer-safe: the backend connection stays pinned for the transaction, and the lock auto-releases on commit or rollback. Only one pod can hold the lock at a time.
3. **Randomized exponential backoff** — If the lock is held by another pod, the waiting pod rolls back its transaction (freeing the pooled connection) and retries with exponential backoff (100ms → 200ms → 400ms → ... capped at 20 seconds) plus random jitter. This prevents a thundering herd when many pods start simultaneously.
4. **Schema initialization** — The pod that holds the lock re-checks hashes inside the lock (another pod may have just finished), then runs only the changed phases: CoreInfrastructure, Migrations, PerspectiveTables, Constraints, Associations, Registry, MessageTypeRegistry.
5. **Lock release** — The lock is transaction-scoped, so it is released automatically when the initialization transaction commits (or rolls back on failure), letting the next pod proceed.
6. **Retry indefinitely** — Pods retry forever until the lock is acquired. Only `CancellationToken` cancellation stops the retry loop.

### Idempotency Guarantees

All DDL operations are idempotent by design:

- Table creation uses `CREATE TABLE IF NOT EXISTS`
- Function creation uses `CREATE OR REPLACE FUNCTION`
- Migrations are hash-tracked — unchanged migrations are skipped automatically
- Constraints check for existing constraints before adding

This means even if two pods manage to overlap (e.g., the first pod crashes mid-initialization), the second pod will safely complete all remaining work without duplicating what was already done.

### Cancellation Safety

The advisory lock is transaction-scoped (`pg_try_advisory_xact_lock`), so it can never dangle — it dies with its transaction. The rollback path that releases the pinned connection during backoff always uses `CancellationToken.None`, so a cancelled pod still frees its pooled connection instead of leaving it stranded.

## Both drivers {#both-drivers}

{verified: StartupParityTests.TheGate_OpensOnceTheSchemaIsMigrated_AndNotBeforeAsync, DapperSchemaStartupTests.Registration_DoesNotTouchTheDatabaseAsync}

The EF Core and Dapper drivers start the same way. Registration only records what to initialize; one hosted
service, `WhizbangDatabaseInitializerService`, does the work at host start for every driver the host registered,
then opens `ISchemaReadyGate`. Each driver contributes an `ISchemaInitializationRunner` for its share, and
`AddWhizbangSchemaInitialization()` (called by both drivers) registers the service once, however many drivers
call it. `SchemaInitializationOptions` (blocking or not, `MigrationTimeout`, `InitRetryDelay`) apply to both.

| Stage | EF Core | Dapper |
|---|---|---|
| When | Hosted service at host start | Hosted service at host start |
| Blocking | `NonBlockingSchemaInit`, background by default | The same option |
| Wait for the database | The initializer's retry loop | `PostgresOptions` connection retry, then the initializer's retry loop |
| Lock | `pg_try_advisory_xact_lock` on the schema key, around one DDL transaction | The same key, held transaction-scoped on a connection of its own while each migration file runs in its own transaction |
| Register the instance | At start, before migrating | At start, before the lock is released |
| Managed-object cleanup | This instance's id, `Whizbang:Schema:Reconcile`, the host's logger; never fatal | The same |
| Schema-ready gate | Opened after the last runner | The same |
| Periodic cleanup re-run | A maintenance step, for every context including one you registered yourself | A maintenance step |
| Once-per-fleet claim | The claim store when registered, the claim table otherwise | The same |

The drivers still migrate with two engines: the EF Core driver generates its pass from the model, and the
Dapper driver runs `PostgresSchemaInitializer`. They share the lock key, so instances of either driver starting
together migrate one after the other.

:::breaking
**Upgrading a Dapper host.** The schema is no longer migrated when `AddWhizbangPostgres(..., initializeSchema: true)`
returns, and registration no longer connects to the database. Initialization runs at host start. Code that read
or wrote Whizbang tables between registration and host start must instead wait on the gate:

```csharp{title="Wait for the schema on Dapper" description="Code that needs the schema waits on ISchemaReadyGate instead of assuming registration migrated it" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "Dapper", "Startup", "Upgrade"] tests=["DapperSchemaStartupTests.HostStart_MigratesTheSchema_ThenOpensTheGateAsync"]}
builder.Services.AddWhizbangPostgres(connectionString, jsonOptions, initializeSchema: true, perspectiveEntries);

var app = builder.Build();
await app.StartAsync();

// The initializer runs in the background by default; wait for the schema before using it.
var gate = app.Services.GetRequiredService<ISchemaReadyGate>();
await gate.WaitForReadyAsync(CancellationToken.None);
```

A Dapper host without `initializeSchema` gets an open gate at start, since its schema was provisioned out of band.
:::

## Concurrent starts {#concurrent-starts}

{verified: StartupParityTests.ConcurrentStarts_AreSerializedByTheSchemaLockAsync, DapperSchemaStartupTests.HostStart_WaitsForTheSchemaLock_WhileAnotherSessionHoldsItAsync}

Instances starting together, on either driver, take the same schema initialization lock (the advisory key
`SchemaInitializationLockKey` derives from the schema name), so one migrates while the others wait. A start that
finds the lock held tells the registered observers, then waits for the holder to commit, roll back or die.

## Watching initialization {#watching-initialization}

{verified: StartupParityTests.ADatabaseThatComesUpLate_IsWaitedFor_ThenTheGateOpensAsync, SchemaInitializationObserversTests.LockContended_TellsEveryRegisteredObserverAsync}

Register an `ISchemaInitializationObserver` to see what initialization is waiting on. Every method has a default
that does nothing, so implement only what you watch:

```csharp{title="Watching initialization" description="An observer that logs a held lock and a failed attempt" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "Startup", "Observability"] tests=["StartupParityTests.ConcurrentStarts_AreSerializedByTheSchemaLockAsync", "StartupParityTests.ADatabaseThatComesUpLate_IsWaitedFor_ThenTheGateOpensAsync"]}
public sealed class StartupWatcher(ILogger<StartupWatcher> logger) : ISchemaInitializationObserver {
  public ValueTask OnSchemaLockContendedAsync(string schema, CancellationToken cancellationToken) {
    logger.LogInformation("Another instance is migrating {Schema}; waiting", schema);
    return ValueTask.CompletedTask;
  }

  public ValueTask OnAttemptFailedAsync(int attempt, Exception exception, CancellationToken cancellationToken) {
    logger.LogWarning(exception, "Schema initialization attempt {Attempt} failed; retrying", attempt);
    return ValueTask.CompletedTask;
  }
}

builder.Services.AddSingleton<ISchemaInitializationObserver, StartupWatcher>();
```

The initializer awaits each call before it carries on, so an observer that blocks holds startup; return promptly.
`OnAttemptFailedAsync` fires in the non-blocking mode, before the `InitRetryDelay` wait.

## See Also

- [EF Core JSON Configuration](./efcore-json-configuration.md)
- [Schema Migration](./schema-migration.md)
- [Managed Schema Objects](../fundamentals/perspectives/managed-schema-objects.md)
- [Database Readiness](../operations/workers/database-readiness.md)
