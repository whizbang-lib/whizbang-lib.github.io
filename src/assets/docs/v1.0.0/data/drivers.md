---
title: Drivers Component
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Components
order: 8
description: >-
  Storage driver selection for Whizbang persistence - the fluent
  WithDriver API, Postgres and InMemory drivers
tags: 'drivers, storage, postgres, in-memory, efcore, abstraction'
codeReferences:
  - src/Whizbang.Core/Perspectives/IDriverOptions.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreDriverSelector.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreExtensions.cs
  - src/Whizbang.Data.EFCore.Postgres/InMemoryDriverExtensions.cs
  - src/Whizbang.Data.EFCore.Postgres/PostgresDriverExtensions.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperWorkCoordinator.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperCoordinatorSchema.cs
  - src/Whizbang.Data.Dapper.Postgres/PostgresSchemaInitializer.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperWorkCoordinator.RetentionSweeps.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperWorkCoordinator.TableMaintenance.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperWorkCoordinator.FleetAndCatalog.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperWorkCoordinator.Coalesce.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperStreamIntegrityRefusal.cs
  - src/Whizbang.Data.Postgres/CoordinatorRetentionSql.cs
  - src/Whizbang.Data.Postgres/TableMaintenanceSql.cs
  - src/Whizbang.Data.Postgres/CoordinatorFleetSql.cs
  - src/Whizbang.Data.Postgres/CoordinatorCatalogSql.cs
  - src/Whizbang.Data.Postgres/CoalesceSql.cs
  - src/Whizbang.Data.Postgres/OrphanedLifecycleEventsSql.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreDriverSelectorTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreExtensionsTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/InMemoryDriverExtensionsTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PostgresDriverExtensionsTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperWorkCoordinatorNamedSchemaTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperCoordinatorSchemaTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperMaintenanceStepNamedSchemaTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperNamedSchemaRegistrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/WorkCoordinatorDriverParityTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperRetentionSweepTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperTableMaintenanceTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperFleetRecoveryTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperLifecycleAndCatalogTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperCoalesceTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperStreamIntegrityRefusalTests.cs
lastMaintainedCommit: '01f07906'
---

# Drivers Component

## Overview

Drivers are the storage-backend selection layer in Whizbang. Application code (perspectives, receptors, lenses) never talks to a specific database - it works against Whizbang abstractions (`IPerspectiveStore<T>`, `ILensQuery<T>`, `IEventStore`, `IInbox`, `IOutbox`). A **driver** wires those abstractions to a concrete backend at startup via a fluent builder chain:

```csharp{title="Driver Selection" description="Driver Selection" category="Implementation" difficulty="BEGINNER" tags=["Data", "C#", "Driver", "Selection"] tests=["EFCoreExtensionsTests.WithEFCore_CanChainToWithDriverAsync", "PostgresDriverExtensionsTests.Postgres_ReturnedBuilder_HasSameServicesAsync", "InMemoryDriverExtensionsTests.InMemory_WithValidEFCoreSelector_ReturnsWhizbangPerspectiveBuilderAsync"]}
// Production: PostgreSQL
services
    .AddWhizbang()
    .WithEFCore<MyDbContext>()
    .WithDriver.Postgres;

// Testing: EF Core InMemory provider
services
    .AddWhizbang()
    .WithEFCore<MyDbContext>()
    .WithDriver.InMemory;
```

Everything after `.WithDriver.` is an **extension property contributed by a driver package** - referencing `Whizbang.Data.EFCore.Postgres` is what makes `.Postgres` and `.InMemory` appear in IntelliSense.

## How the Fluent Chain Works

| Step | Type | Provided by |
|------|------|-------------|
| `AddWhizbang()` | `WhizbangBuilder` | `Whizbang.Core` |
| `.WithEFCore<TDbContext>()` | `EFCoreDriverSelector` | `Whizbang.Data.EFCore.Postgres` |
| `.WithDriver` | `IDriverOptions` | `EFCoreDriverSelector` (returns itself) |
| `.Postgres` / `.InMemory` | `WhizbangPerspectiveBuilder` | Driver extension properties |

### IDriverOptions

`IDriverOptions` is a marker interface that serves as the extension point for driver packages:

```csharp{title="IDriverOptions" description="IDriverOptions" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "IDriverOptions", "Interface"] tests=["EFCoreDriverSelectorTests.ImplementsIDriverOptions_InterfaceAsync", "EFCoreDriverSelectorTests.IDriverOptions_Services_ReturnsSameAsDirectPropertyAsync"]}
namespace Whizbang.Core.Perspectives;

public interface IDriverOptions {
    IServiceCollection Services { get; }
}
```

Driver packages add extension properties to it using C# 14 extension blocks:

```csharp{title="Driver Extension Property" description="Driver Extension Property" category="Implementation" difficulty="ADVANCED" tags=["Data", "C#", "Driver", "Extension"] tests=["PostgresDriverExtensionsTests.Postgres_WithNonEFCoreDriverOptions_ThrowsInvalidOperationExceptionAsync", "PostgresDriverExtensionsTests.Postgres_ReturnedBuilder_HasSameServicesAsync"]}
public static class PostgresDriverExtensions {
    extension(IDriverOptions options) {
        public WhizbangPerspectiveBuilder Postgres {
            get {
                if (options is not EFCoreDriverSelector selector) {
                    throw new InvalidOperationException(
                        "Postgres driver can only be used with EF Core storage. " +
                        "Call .WithEFCore<TDbContext>() before .WithDriver.Postgres");
                }
                // ... turnkey registration ...
                return new WhizbangPerspectiveBuilder(selector.Services);
            }
        }
    }
}
```

### EFCoreDriverSelector

`.WithEFCore<TDbContext>()` returns an `EFCoreDriverSelector`, which captures the `DbContext` type (and optional connection string name) and exposes `.WithDriver`:

```csharp{title="EFCoreDriverSelector" description="EFCoreDriverSelector" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "EFCoreDriverSelector"] tests=["EFCoreDriverSelectorTests.WithDriver_ReturnsIDriverOptionsAsync", "EFCoreDriverSelectorTests.Services_ReturnsCorrectServiceCollectionAsync"]}
public sealed class EFCoreDriverSelector : IDriverOptions {
    public IServiceCollection Services { get; }

    // Extension point for driver selection - returns itself as IDriverOptions
    public IDriverOptions WithDriver => this;
}
```

`WithEFCore<TDbContext>()` has two overloads:

```csharp{title="WithEFCore Overloads" description="WithEFCore Overloads" category="Implementation" difficulty="BEGINNER" tags=["Data", "C#", "WithEFCore"] tests=["EFCoreExtensionsTests.WithEFCore_WithValidBuilder_ReturnsEFCoreDriverSelectorAsync", "EFCoreExtensionsTests.WithEFCore_CanChainToWithDriverAsync"]}
// Connection string name comes from the [WhizbangDbContext] attribute,
// else "db" (ConnectionStrings:db, db-direct, db-init)
services.AddWhizbang().WithEFCore<MyDbContext>().WithDriver.Postgres;

// Explicit connection string name, for a second, separate database
services.AddWhizbang().WithEFCore<ReportingDbContext>("reporting").WithDriver.Postgres;
```

Both `WhizbangBuilder` (from `AddWhizbang()`) and `WhizbangPerspectiveBuilder` (from the source-generated `AddWhizbangPerspectives()`) support `.WithEFCore<TDbContext>()`.

## The Postgres Driver

`.WithDriver.Postgres` performs turnkey registration for a production PostgreSQL deployment:

- **DbContext + NpgsqlDataSource** - via source-generated registration callbacks (connection string resolution, JSON configuration)
- **Perspective storage** - `IPerspectiveStore<T>`, `ILensQuery<T>`, `IInbox`, `IOutbox`, and `IEventStore` for all discovered perspective models, using `PostgresUpsertStrategy` (native `ON CONFLICT` support)
- **Event store sync tracking** - decorator that enables perspective synchronization
- **Perspective runners** - `IPerspectiveRunnerRegistry`, all generated runners, and the `PerspectiveWorker`
- **Schema initialization** - hosted service that applies Whizbang schema migrations at startup (workers wait on a schema-ready gate)
- **Rebuild support** - checkpoint completer and runtime registration of the `RebuildPerspectiveCommand` receptor
- **Dead-letter queue** - `IDeadLetterStore` and `IDeadLetterRecoveryService`
- **LISTEN/NOTIFY** - Postgres notification listener with connection-string fallback conventions
- **Snapshots and metrics** - perspective snapshot store, table statistics collection for OpenTelemetry

### Bring your own DbContext {#bring-your-own-dbcontext}

Registering the DbContext yourself before `.WithDriver.Postgres` (your own `NpgsqlDataSource`, `AddDbContext`, or `AddDbContextFactory`) is supported. The driver logs "DbContext '...' already registered - skipping turnkey registration" and leaves your registration alone. Everything that does not depend on owning the DbContext is still registered. Two of those matter enough to name:

- **The library version.** `ILibraryVersionProvider` is registered from a build-time constant, so the [Assess step](../operations/startup/rolling-upgrades#assess) can compare this binary against the migration ledger. Without it the assessor stands down and the host never reports ready.
- **Notification credentials.** Under `UseNpgsql(NpgsqlDataSource)` Npgsql redacts the password from every connection-string surface, so the LISTEN/NOTIFY listener, the commit-order stamper, and the duty elector cannot authenticate from a string ("No password has been provided but the backend requires one"). When neither `Whizbang:Database` nor a credential-bearing `ConnectionStrings` entry is configured, the notification stack borrows your DbContext's data source (or, failing that, an `NpgsqlDataSource` registered in DI). Borrowed means used as-is and never disposed by the framework; the choice is logged once at Information. Set `Whizbang:Database:ConnectionStringKey` or call `AddWhizbangNotificationDataSource(...)` when you want a dedicated pool for notifications, which is also the right answer for multi-schema deployments that rely on a `search_path`.

```csharp{title="Consumer-owned DbContext and data source" description="The consumer registers its own NpgsqlDataSource and DbContext; the driver skips its turnkey DbContext registration but still supplies the library version and reuses the data source for notification connections." category="Configuration" difficulty="INTERMEDIATE" tags=["Data", "Drivers", "Postgres", "Notifications"] tests=["LibraryVersionRegistrationTests.Postgres_WhenTheConsumerRegisteredItsOwnDbContext_StillRegistersTheLibraryVersionAsync", "DutyElectionByoDataSourceE2ETests.Elector_UnderUseNpgsqlDataSource_WithNoNotificationConfiguration_AcquiresTheDutyAsync", "NotificationDataSourceAutoDiscoveryTests.AutoDiscovery_NoCredentialInConfiguration_ReusesTheApplicationsDataSourceAsync", "DbContextNotificationConnectionStringFallbackTests.GetDataSource_UseNpgsqlDataSource_ReturnsTheDbContextsDataSourceAsync"]}
var dataSource = new NpgsqlDataSourceBuilder(connectionString).Build();
services.AddSingleton(dataSource);
services.AddDbContext<OrdersDbContext>(o => o.UseNpgsql(dataSource));

services.AddWhizbang()
  .WithEFCore<OrdersDbContext>()
  .WithDriver.Postgres;   // "already registered - skipping turnkey registration" — and that is fine
```

## The InMemory Driver

`.WithDriver.InMemory` registers the same storage abstractions against the EF Core InMemory provider using `InMemoryUpsertStrategy` - fast and isolated, ideal for tests and prototyping:

```csharp{title="InMemory for Tests" description="InMemory for Tests" category="Implementation" difficulty="BEGINNER" tags=["Data", "C#", "InMemory", "Testing"] tests=["InMemoryDriverExtensionsTests.InMemory_WithValidEFCoreSelector_ReturnsWhizbangPerspectiveBuilderAsync", "InMemoryDriverExtensionsTests.InMemory_ReturnedBuilder_HasSameServicesAsync"]}
// In test setup
services
    .AddWhizbang()
    .WithEFCore<MyDbContext>()
    .WithDriver.InMemory;
```

:::updated
The InMemory driver rides on the **EF Core InMemory provider** - it is not a standalone key-value store. Both `.Postgres` and `.InMemory` require `.WithEFCore<TDbContext>()` first; using them on a non-EF Core selector throws `InvalidOperationException`.
:::

## Dapper-Based Alternative

For services that prefer raw-SQL persistence, the `Whizbang.Data.Dapper.Postgres` package registers Whizbang's PostgreSQL stores (event store, work coordinator, request/response store, sequence provider) via `AddWhizbangPostgres(...)` instead of the EF Core chain. See [Dapper Integration](dapper-integration.md).

### Which schema the Dapper work coordinator uses {#dapper-coordinator-schema}

{verified: DapperWorkCoordinatorNamedSchemaTests.WithNoSchemaGiven_TheConnectionStringsSearchPathConfiguresItAsync, DapperWorkCoordinatorNamedSchemaTests.WithNothingConfigured_TheServersDefaultIsAskedOnceAndKeptAsync, DapperWorkCoordinatorNamedSchemaTests.ASessionThatResolvesNoSchema_IsTakenAsPublicAsync, DapperCoordinatorSchemaTests.TheFirstSchemaTheSearchPathNames_IsTheSchemaAsync}

`DapperWorkCoordinator` qualifies every statement it sends with one schema, `public` included, so it never depends on the session's `search_path`. That matters behind a transaction-pooling PgBouncer, where a `SET search_path` from one session does not follow the next statement. It settles the schema once, in this order:

1. The `schema` constructor argument, when one is given.
2. The first schema the connection string's `Search Path` names. A quoted name is kept exactly; an unquoted name is lower-cased, as Postgres folds it; `$user` is skipped.
3. Otherwise the server's answer to `current_schema()` on first use, which honors a default set with `ALTER DATABASE ... SET search_path` or `ALTER ROLE ... SET search_path`. A session that resolves no schema at all is taken as `public`.

The answer is kept for the coordinator's lifetime, so the lookup costs one round trip at most.

:::warning
Before this release the coordinator called its functions unqualified and named `public` outright in its maintenance, orphan-inbox purge, pending-message discard and pending-stream statements. A Whizbang schema installed anywhere but the session's `search_path` failed with `42883` (function does not exist) or `42P01` (relation does not exist).
:::

### Installing into a named schema with the Dapper driver {#dapper-named-schema}

{verified: DapperNamedSchemaRegistrationTests.Registration_SearchPathNamesASchema_InstallsTablesAndFunctionsThereAsync, DapperNamedSchemaRegistrationTests.Registration_SearchPathNamesASchema_TheCoordinatorWorksAgainstItAsync}

`AddWhizbangPostgres` installs Whizbang into the schema the connection string names, by the same rule the coordinator uses:

1. The first schema the connection string's `Search Path` names. Startup creates it if it does not exist.
2. Otherwise the session's `current_schema()`.

The tables, the migrated functions, the startup readiness check and the coordinator all use that schema, so a host whose connection string carries `Search Path=orders` gets everything in `orders` and nothing in `public`.

```csharp{title="Dapper Driver in a Named Schema" description="Install Whizbang into the schema the connection string names" category="Configuration" difficulty="INTERMEDIATE" tags=["Data", "C#", "Dapper", "Schema"] tests=["DapperNamedSchemaRegistrationTests.Registration_SearchPathNamesASchema_InstallsTablesAndFunctionsThereAsync"]}
var connectionString = new NpgsqlConnectionStringBuilder(baseConnectionString) {
  SearchPath = "orders"
}.ConnectionString;

services.AddWhizbangPostgres(connectionString, jsonOptions, initializeSchema: true, PerspectiveSchemas.Entries);
```

:::warning
Before this release the registration rendered the migrations for `public` while the tables went wherever the session's search path pointed, and the readiness check looked only in `public`. A named schema ended up with functions in one schema and tables in another, or a startup that never became ready.
:::

### The Dapper maintenance steps use the same schema {#dapper-maintenance-schema}

{verified: DapperMaintenanceStepNamedSchemaTests.ThePremise_PublicIsEmpty_AndTheServerResolvesTheSessionUsersSchemaAsync, DapperMaintenanceStepNamedSchemaTests.ThePartitionStep_ConvertsTheLogInTheHostsSchemaAsync, DapperMaintenanceStepNamedSchemaTests.ThePhysicalColumnFillStep_FillsAndClaimsInTheHostsSchemaAsync, DapperMaintenanceStepNamedSchemaTests.TheManagedSchemaReconcileStep_ClaimsInTheHostsSchemaAsync}

The Dapper driver's maintenance steps act on the schema the host names, resolved exactly as the coordinator resolves
it when no `schema` argument is given: the first schema the connection string's `Search Path` names, else the
server's `current_schema()`. That covers:

- the [partition maintenance step](../operations/infrastructure/partitioned-ledgers#the-duty-gate), which converts and
  maintains the partitioned ledgers in that schema;
- the [physical-column fill step](../fundamentals/perspectives/physical-fields#rows-written-during-a-rolling-deploy),
  which fills the perspective tables in that schema;
- the [managed-schema reconcile step](../fundamentals/perspectives/managed-schema-objects#every-later-start), which
  reconciles that schema's managed objects.

The fill and reconcile steps also take their once-per-fleet claim in that schema and key it by that schema, so the
claim belongs to the services installed there rather than to whatever schema the session resolves first. A schema named only in
`Search Path` is honored even on a pooled connection whose session does not carry that `search_path`, such as one
behind a transaction-pooling PgBouncer.

:::updated
Before this release the partition and fill steps named `public` in every statement, and the reconcile step asked
the server for `current_schema()`. On a host whose Whizbang tables live in another schema the first two found no
tables (or another service's), and the reconcile step claimed and reconciled in whatever schema the session resolved
first, such as the session user's own schema ahead of a `Search Path` of `"$user", orders`.
:::

### What the Dapper work coordinator supports {#dapper-coordinator-parity}

{verified: WorkCoordinatorDriverParityTests.EveryDefaultBodiedMember_IsImplementedByDapper_OrAllowListedWithAReasonAsync, WorkCoordinatorDriverParityTests.TheAllowList_HoldsOnlyMembersDapperServesAtTheDefault_EachWithAReasonAsync, WorkCoordinatorDriverParityTests.EveryDefaultBodiedMember_IsImplementedByEFCoreAsync}

Many work-coordinator operations have a default that answers as if the store had nothing to do: an empty list, zero, or
`unsupported`. That default exists for engines without the primitive. A driver that serves it for an operation a
feature depends on runs the feature and does nothing, silently. That is the one outcome the drivers do not allow.

The rule, enforced by a test that reads every operation with a default from the interface, so a new one cannot slip
past it:

- **Every operation is implemented by the Dapper coordinator with the EF Core contract**, or
- **it is on an explicit allow-list with the reason it is not**, and a feature that depends on it is
  [refused at startup](#what-dapper-refuses-at-startup) when its configuration turns it on.

The test also fails when the allow-list names an operation Dapper now implements, so the list cannot go stale, and it
checks that the EF Core coordinator implements every operation.

Both coordinators run the same SQL: each statement lives once in the shared Postgres package and is qualified with the
coordinator's schema, so the drivers cannot drift. On the Dapper driver that covers:

| Area | What runs on Dapper |
|------|---------------------|
| Retention and storage | The offload-claim ledger and its sweep, the settled apply-path fold, the [ancient ephemeral pointer prune](../fundamentals/events/ephemeral-events.md), ephemeral reclassification and per-type grace, the lifecycle-completion cleanup, the exhausted orphan reap, [row retention](../fundamentals/perspectives/row-retention.md#dapper-driver) and the [prefix truncate](../fundamentals/events/event-streams.md#prefix-truncate-on-every-data-layer) |
| Table maintenance | The rewrite queue and its measurements, the bloat estimate and the approximate measurement, `VACUUM (FULL)`, external and pg_squeeze rewrites, the work-table vacuum, and the queue-index survey, drop and rebuild |
| Recovery and fleet | The stuck-row sentinels, the release of unprocessed inbox rows and unstarted leases, the service backlog the housekeeping gate reads, the broker dead-letter import, and the standby and eviction handshake |
| Type registry, lifecycle and cursors | The type-definition catalog, its lineage and its reconcile claim, the lifecycle completion marker and the startup orphan reconciliation, the cursor batch and rewind reads, the ephemeral snapshot targets, and the local service id |
| Coalescing | The pending groups, a group's singles, the fold and the deadline release |

The Dapper driver creates its schema on the application connection, so the role that runs the coordinator normally owns
the tables. There is no separate schema-initialization connection: a table maintenance statement on a table that role
does not own is reported and not run, exactly as the EF Core coordinator does when no `-init` connection is configured.

{verified: DapperRetentionSweepTests.PruneAncientEphemeralPointers_DisabledByDefault_ThenPrunesAllButTheNewestAsync, DapperTableMaintenanceTests.UnderARoleThatOwnsNoTable_NothingIsVacuumedRewrittenOrRebuilt_AndEachIsReportedAsync, DapperFleetRecoveryTests.ReleaseUnstartedLeases_ReturnsTheInstancesUnstartedRowsOfTheStreamsAsync, DapperLifecycleAndCatalogTests.OrphanedLifecycles_AreFoundUntilTheirCompletionIsRecordedAsync, DapperCoalesceTests.CompleteFold_StoresTheCompositeAndCompletesTheSinglesTogetherAsync}

:::updated
Before this release the Dapper coordinator left every one of these operations at its inert default. A retention setting such
as the pointer prune or the lifecycle-completion window was accepted and removed nothing, the maintenance cycle found
nothing to rewrite or vacuum, a coalesced message was parked and never shipped, and the startup lifecycle reconciliation
never replayed anything.
:::

### What the Dapper driver refuses at startup {#what-dapper-refuses-at-startup}

{verified: DapperStreamIntegrityRefusalTests.AHostThatConfiguresNothing_StartsWithEveryIntegritySwitchOffAsync, DapperStreamIntegrityRefusalTests.ASwitchConfiguredOn_RefusesTheHost_NamingTheFeatureTheKeyAndTheReasonAsync, DapperStreamIntegrityRefusalTests.AutoRepair_RefusesTheHostAsync, DapperStreamIntegrityRefusalTests.TheRefusal_IsCheckedAtHostStartAsync}

[Stream integrity](../resilience/stream-integrity.md) (checkpoints, gap detection, the digest audit and its epochs,
the paced repair drain, subscription-growth backfill and auto-repair) runs on the EF Core driver only. Its coordinator
operations are the ones left on the Dapper allow-list, because that code is being reworked.

So on a Dapper host every integrity switch defaults to **off**, where the EF Core driver ships several of them on, and a
host whose configuration turns one on fails at start through the standard options pipeline (`IValidateOptions` with
`ValidateOnStart`), with an error that names the feature, the key and the reason:

| Setting | Feature refused | Supported value on Dapper |
|---------|-----------------|---------------------------|
| `Whizbang:StreamIntegrity:CheckpointsEnabled` | Continuity checkpoints | `false` |
| `Whizbang:StreamIntegrity:GapDetectionEnabled` | Gap detection | `false` |
| `Whizbang:StreamIntegrity:AuditEnabled` | The scheduled digest audit | `false` |
| `Whizbang:StreamIntegrity:EpochClosureEnabled` | Digest epoch closure | `false` |
| `Whizbang:StreamIntegrity:RepairDrainEnabled` | The paced repair drain | `false` |
| `Whizbang:StreamIntegrity:BackfillOnSubscriptionGrowth` | Subscription-growth backfill (a redelivery of a new type's history) | `false` |
| `Whizbang:StreamIntegrity:RepairMode` | Auto-repair | `ReportOnly` |

```text{title="A Dapper host asked for integrity checkpoints" description="The start-time refusal names the key, the feature and why" category="Configuration" difficulty="BEGINNER" tags=["Data", "Dapper", "Stream Integrity", "Startup"] tests=["DapperStreamIntegrityRefusalTests.ASwitchConfiguredOn_RefusesTheHost_NamingTheFeatureTheKeyAndTheReasonAsync"]}
Whizbang:StreamIntegrity:CheckpointsEnabled is true, which turns on stream integrity checkpoints, but the Dapper driver
refuses it: stream integrity runs on the EF Core driver only; on the Dapper driver its coordinator operations are not
implemented, so the feature would do nothing. Set it to false, or use the EF Core driver.
```

The switches are read from configuration, so the result does not depend on whether `AddWhizbangPostgres` or
`AddWhizbangWorkers` is registered first. A value set in code with `services.Configure<StreamIntegrityOptions>(...)`
after both registrations is checked the same way.

:::breaking
A Dapper host that configured nothing starts as before, with integrity off. A Dapper host whose configuration turns an
integrity switch on, which did nothing on this driver, now fails at start until the switch is removed or set as the
table shows.
:::

## Choosing a Driver

| Driver | Backend | Use case |
|--------|---------|----------|
| `.WithDriver.Postgres` | PostgreSQL via EF Core | Production |
| `.WithDriver.InMemory` | EF Core InMemory provider | Unit/integration tests, prototyping |
| `AddWhizbangPostgres(...)` | PostgreSQL via Dapper | Raw-SQL persistence without EF Core; stream integrity is [refused](#what-dapper-refuses-at-startup) |

## Best Practices

1. **Depend on abstractions** - inject `ILensQuery<T>` / `IPerspectiveStore<T>`, never a concrete store
2. **Select the driver once** - at composition root, per service
3. **Use InMemory in tests** - same abstractions, no database required
4. **Prefer the connection string convention** - name the database's connection string `db` (with `db-direct` and `db-init`); name another only for a second, separate database with `WithEFCore<T>("name")`

## Related Documentation

- [Perspectives](../fundamentals/perspectives/perspectives.md) - Event-driven read models
- [Lenses](../fundamentals/lenses/lenses.md) - Query abstractions
- [EF Core Integration](efcore-integration.md) - DbContext configuration
- [Dapper Integration](dapper-integration.md) - Dapper-based PostgreSQL stores
- [Turnkey Initialization](turnkey-initialization.md) - What gets registered at startup
