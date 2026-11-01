---
title: Turnkey Database Initialization
pageType: guide
verifiedAgainstCommit: e7ae79b00
verifiedDate: 2026-10-22
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
  - src/Whizbang.Data.EFCore.Postgres/SchemaInitializationBarrier.cs
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
  - src/Whizbang.Data.EFCore.Postgres/SchemaStepRunner.cs
  - src/Whizbang.Data.EFCore.Postgres.Generators/Templates/DbContextSchemaExtensionTemplate.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/DbContextInitializationRegistryTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/SchemaInitializationBarrierTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/SchemaInitializationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/SchemaInitializationConcurrencyTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupParity/StartupParityTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperSchemaStartupTests.cs
  - tests/Whizbang.Core.Component.Tests/Schema/SchemaInitializationRunnersTests.cs
  - tests/Whizbang.Core.Tests/Schema/SchemaInitializationObserversTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/MigrationStepTransactionTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupPreflightHostTests.cs
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

### A second call waits for the one in progress {#a-second-call-waits}
{verified: DbContextInitializationRegistryTests.InitializeAllAsync_ASecondCallWhileTheFirstRuns_ReturnsOnlyOnceTheFirstHasFinishedAsync, DbContextInitializationRegistryTests.InitializeAllAsync_ASecondCallWhoseFirstFails_RunsItsOwnAttemptAsync, DbContextInitializationRegistryTests.InitializeAllAsync_TheHostsProviderAndItsRootScope_AreOneHostAsync, DbContextInitializationRegistryTests.InitializeAllAsync_ASecondCallsWait_EndsWithItsTokenAsync, StartupPreflightHostTests.ASecondInitialization_ReturnsOnlyOnceTheFirstHasFinishedAsync}

A host makes one initialization attempt at a time. A call to `EnsureWhizbangInitializedAsync()` made while the host's
own initialization (or any other call) is still running joins that attempt: it logs
`Whizbang database initialization is in progress; waiting for it to finish` at Information and returns only once the
attempt has finished, so the schema it returns to is the whole schema.

- **The attempt succeeded.** The waiting call returns, having run nothing itself.
- **The attempt failed.** The waiting call logs
  `The Whizbang database initialization this call waited for failed; this call runs one of its own` at Warning and runs
  an attempt of its own. A failed attempt never counts as initialized.
- **The wait is canceled.** The call's own cancellation token ends its wait; the attempt it was waiting for carries on.

The host's own provider (`app.Services`) and the root scope its hosted services are built from count as one host.
Earlier releases told them apart, so a call from `app.Services` made while the hosted initializer was migrating ran a
second initialization beside it, and a call made while one was in progress returned at once, before the schema was
ready.

#### A direct DbContext call waits too {#a-direct-call-waits}
{verified: SchemaInitializationBarrierTests.ASecondEntry_ForTheSameHostDatabaseAndSchema_WaitsForTheFirstToLeaveAsync, SchemaInitializationBarrierTests.EntriesForAnotherHostSchemaOrDatabase_DoNotWaitAsync, SchemaInitializationBarrierTests.NoHost_DoesNotWaitAsync, SchemaInitializationBarrierTests.ACanceledWait_LeavesTheBarrierAsItFoundItAsync, SchemaInitializationBarrierTests.AContext_IsBarriered_ByTheHostItWasBuiltFrom_ElseByThePassedProviderAsync, StartupPreflightHostTests.ADirectDbContextInitialization_WaitsForTheHostsOwn_AndAppliesNothingAsync}

A call to the generated `dbContext.EnsureWhizbangDatabaseInitializedAsync()` does not go through the host's attempt,
so the generated method has a barrier of its own: one initialization of a database and schema at a time per host,
whoever calls. A direct call made while another initialization of the same database and schema runs in the same host
(the hosted initializer's, or another direct call) logs
`Whizbang schema initialization of <schema> in database <database> is already running in this host; waiting for it to finish`
at Information, waits for it, then runs its own pass, which finds the schema current and returns on the fast path.

- **The host** is the application service provider the context was built from (what `AddDbContext` gives it), or
  the `serviceProvider` passed to the call when the context has none. Its scopes count as the same host.
- **The database and schema** are the connection's data source and database, as its connection string names them,
  and the schema being initialized. Another host, server, database or schema does not wait.
- **A context built by hand**, with no application service provider and none passed in, has no host and is not held
  by the barrier.
- **The wait is canceled** by the call's own token, and leaves the barrier as it found it.

```csharp{title="Initializing again from ApplicationStarted" description="A direct DbContext initialization made while the host's own is still running waits for it, then finds the schema current" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "Initialization", "Hosting", "Startup"] tests=["StartupPreflightHostTests.ADirectDbContextInitialization_WaitsForTheHostsOwn_AndAppliesNothingAsync"]}
app.Lifetime.ApplicationStarted.Register(() => _ = Task.Run(async () => {
  await using var scope = app.Services.CreateAsyncScope();
  var dbContext = scope.ServiceProvider.GetRequiredService<OrderDbContext>();
  // Waits while the hosted initializer is still migrating, then returns on the fast path.
  await dbContext.EnsureWhizbangDatabaseInitializedAsync();
}));
```

**Why wait and then run a pass, not join.** The key comes from the connection string, which cannot prove that two
calls target the same database, so a waiter does not take the first call's outcome as its own. When the schema is
current its pass returns on the fast path, without taking the schema lock. Earlier releases ran the direct call's pass beside the host's, applying
steps the host had not reached yet.
{verified: StartupPreflightHostTests.ADirectDbContextInitialization_WaitsForTheHostsOwn_AndAppliesNothingAsync}

**Why per host, not per process.** Two hosts in one process are two instances, as two processes are, and the
[schema lock](#concurrent-starts) already keeps their DDL apart, one step at a time. A barrier per process would
make a second instance wait for the first one's whole initialization instead of continuing a pass the first left part
way through, and when the first is held mid-pass, neither finishes.
{verified: SchemaInitializationBarrierTests.EntriesForAnotherHostSchemaOrDatabase_DoNotWaitAsync}

## Multi-Instance Initialization

When deploying multiple instances (pods) of the same service, Whizbang coordinates database initialization using PostgreSQL advisory locks to prevent concurrent schema modifications.

### How It Works

1. **Fast path (no lock)** — Each pod first compares stored schema hashes (in `wh_schema_migrations`) against the compile-time hashes. If nothing changed, initialization is skipped entirely — no lock is taken.
2. **Advisory lock acquisition** — On hash mismatch (or first run), the pod attempts a non-blocking, transaction-level advisory lock (`pg_try_advisory_xact_lock`) derived from the schema name. Transaction-level locks are PgBouncer-safe: the backend connection stays pinned for the transaction, and the lock auto-releases on commit or rollback. Only one pod can hold the lock at a time.
3. **Randomized exponential backoff** — If the lock is held by another pod, the waiting pod rolls back its transaction (freeing the pooled connection) and retries with exponential backoff (100ms → 200ms → 400ms → ... capped at 20 seconds) plus random jitter. This prevents a thundering herd when many pods start simultaneously.
4. **Schema initialization**: the pod that holds the lock re-checks hashes inside the lock (another pod may have just finished), records what the pass owes, then runs only the owed steps: the core tables, each changed migration file, each changed perspective table, the constraints, the associations and the registries.
5. **One transaction per step**: on the EF Core driver each step is a transaction of its own that takes the lock at its start, re-checks its own ledger row under it, and commits with that row, so a failure costs only that step and the retry resumes there. The lock is released by each step's commit or rollback; a pod waiting on it defers per step, and stops as soon as the schema is current. See [one transaction per step](../operations/infrastructure/migrations#one-transaction-per-step).
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
| Lock | `pg_try_advisory_xact_lock` on the schema key, taken at the start of each step's own transaction | The same key, held transaction-scoped on a connection of its own while each migration file runs in its own transaction |
| Register the instance | At the end of Preflight, after the bootstrap closure and before Elect ([why](../operations/infrastructure/migrations#which-instance-migrates)) | At start, before the lock is released |
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

{verified: StartupParityTests.ADatabaseThatComesUpLate_IsWaitedFor_ThenTheGateOpensAsync, SchemaInitializationObserversTests.LockContended_TellsEveryRegisteredObserverAsync, SchemaBootstrapPhaseTests.ABootstrapThatFindsTheLockHeld_WaitsForIt_ThenAppliesTheClosureAsync}

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
`OnAttemptFailedAsync` fires in the non-blocking mode, before the `InitRetryDelay` wait. On the EF Core driver,
`OnSchemaLockContendedAsync` is also called when the [bootstrap closure](../operations/infrastructure/migrations#bootstrap-waits-for-the-lock)
finds the schema lock held in Preflight.

### Each bootstrap retry {#bootstrap-retry-scheduled}

{verified: SchemaInitializationObserversTests.BootstrapRetryScheduled_TellsEveryRegisteredObserverTheAttemptAndTheDelayAsync, SchemaInitializationObserversTests.BootstrapRetryScheduled_WithNoProvider_TellsNobodyAsync, SchemaInitializationObserversTests.BootstrapRetryScheduled_IsANoOpForAnObserverThatDoesNotWatchItAsync, SchemaBootstrapPhaseTests.ATransientFailure_IsRetriedOnceItsDelayHasPassed_ThenTheClosureLandsAsync}

On the EF Core driver, `OnBootstrapRetryScheduledAsync` is called each time the bootstrap closure meets a
[transient database failure](../operations/infrastructure/migrations#bootstrap-failures) and is about to wait before
its next attempt: with the schema, which attempt failed (from 1), the failure, and the delay (1 second, doubling to a
30 second cap). Like the other methods it defaults to doing nothing. A failure that is not transient is not retried and
calls no observer here: it fails the attempt with a `SchemaBootstrapException`, which `OnAttemptFailedAsync` sees.

```csharp{title="Watching bootstrap retries" description="An observer that logs each transient bootstrap failure and the delay before the next attempt" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "Startup", "Observability", "Bootstrap"] tests=["SchemaInitializationObserversTests.BootstrapRetryScheduled_TellsEveryRegisteredObserverTheAttemptAndTheDelayAsync"]}
public sealed class BootstrapRetries(ILogger<BootstrapRetries> logger) : ISchemaInitializationObserver {
  public ValueTask OnBootstrapRetryScheduledAsync(
      string schema, int attempt, Exception exception, TimeSpan delay, CancellationToken cancellationToken) {
    logger.LogWarning(exception, "Bootstrap of {Schema} failed (attempt {Attempt}); retrying in {Delay}",
      schema, attempt, delay);
    return ValueTask.CompletedTask;
  }
}

builder.Services.AddSingleton<ISchemaInitializationObserver, BootstrapRetries>();
```

**Why it is called before the wait.** The wait is already scheduled on the initializer's clock when the observer
hears of it, so a test driving a fake clock can advance it by `delay` as soon as the call comes, and an observer sees
every retry before it happens rather than after.
{verified: SchemaBootstrapPhaseTests.ATransientFailure_IsRetriedOnceItsDelayHasPassed_ThenTheClosureLandsAsync}

### Each committed step {#step-committed}

{verified: SchemaInitializationObserversTests.StepCommitted_TellsEveryRegisteredObserverWhichStepAsync, SchemaInitializationObserversTests.StepCommitted_IsANoOpForAnObserverThatDoesNotWatchItAsync, MigrationStepTransactionTests.ASecondInstance_FinishesAPassPartWayThrough_AndNothingIsAppliedTwiceAsync}

The EF Core driver applies its schema pass [one step at a time](../operations/infrastructure/migrations#one-transaction-per-step),
and `OnSchemaStepCommittedAsync` is called once for each step that committed: a migration file (by its file name), a
perspective table (by its `perspective:<table>` ledger key), or one of the `core-infrastructure`, `constraints`,
`associations` and `registries` steps. Like the other methods it defaults to doing nothing.

```csharp{title="Counting committed schema steps" description="An observer that records each step of the schema pass as it commits, for a progress metric or a startup trace" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "Startup", "Observability", "Migrations"] tests=["SchemaInitializationObserversTests.StepCommitted_TellsEveryRegisteredObserverWhichStepAsync"]}
public sealed class StepProgress(ILogger<StepProgress> logger) : ISchemaInitializationObserver {
  private int _committed;

  public ValueTask OnSchemaStepCommittedAsync(string schema, string stepName, CancellationToken cancellationToken) {
    var count = Interlocked.Increment(ref _committed);
    logger.LogDebug("Schema {Schema}: step {Step} committed ({Count} so far)", schema, stepName, count);
    return ValueTask.CompletedTask;
  }
}

builder.Services.AddSingleton<ISchemaInitializationObserver, StepProgress>();
```

The call comes after the step's commit and before the next step takes the schema lock, so nothing is held while it
runs. It fires for every step that took the lock and committed, including one whose ledger row turned out to be
current already; it does not fire for a step the pass did not owe, or once another instance has finished the schema.
The [step lines](../operations/infrastructure/migrations#step-log-lines) in the log say which steps actually applied.

## See Also

- [EF Core JSON Configuration](./efcore-json-configuration.md)
- [Schema Migration](./schema-migration.md)
- [Managed Schema Objects](../fundamentals/perspectives/managed-schema-objects.md)
- [Database Readiness](../operations/workers/database-readiness.md)
