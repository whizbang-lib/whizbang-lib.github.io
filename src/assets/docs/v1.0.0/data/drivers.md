---
title: Drivers Component
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
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
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreDriverSelectorTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreExtensionsTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/InMemoryDriverExtensionsTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PostgresDriverExtensionsTests.cs
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
// Connection string name comes from the [WhizbangDbContext] attribute
// or is derived from the DbContext class name
// (e.g. BffServiceDbContext -> "bffservice-db")
services.AddWhizbang().WithEFCore<MyDbContext>().WithDriver.Postgres;

// Explicit connection string name from IConfiguration
services.AddWhizbang().WithEFCore<MyDbContext>("my-database").WithDriver.Postgres;
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

## Choosing a Driver

| Driver | Backend | Use case |
|--------|---------|----------|
| `.WithDriver.Postgres` | PostgreSQL via EF Core | Production |
| `.WithDriver.InMemory` | EF Core InMemory provider | Unit/integration tests, prototyping |
| `AddWhizbangPostgres(...)` | PostgreSQL via Dapper | Raw-SQL persistence without EF Core |

## Best Practices

1. **Depend on abstractions** - inject `ILensQuery<T>` / `IPerspectiveStore<T>`, never a concrete store
2. **Select the driver once** - at composition root, per service
3. **Use InMemory in tests** - same abstractions, no database required
4. **Prefer the connection string convention** - let the `DbContext` name derive the connection string name; override with `WithEFCore<T>("name")` only when needed

## Related Documentation

- [Perspectives](../fundamentals/perspectives/perspectives.md) - Event-driven read models
- [Lenses](../fundamentals/lenses/lenses.md) - Query abstractions
- [EF Core Integration](efcore-integration.md) - DbContext configuration
- [Dapper Integration](dapper-integration.md) - Dapper-based PostgreSQL stores
- [Turnkey Initialization](turnkey-initialization.md) - What gets registered at startup
