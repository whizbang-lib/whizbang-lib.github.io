---
title: PostgreSQL Data Provider
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Components
order: 1
description: PostgreSQL data provider for Whizbang applications
tags: data, postgres, postgresql, database
codeReferences:
  - src/Whizbang.Data.Postgres/PostgresOptions.cs
  - src/Whizbang.Data.Postgres/PostgresConnectionRetry.cs
  - src/Whizbang.Data.EFCore.Postgres/PostgresDriverExtensions.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreExtensions.cs
  - src/Whizbang.Data.Dapper.Postgres/ServiceCollectionExtensions.cs
  - src/Whizbang.Data.Postgres/Migrations/290_EventBodyLz4Compression.sql
testReferences:
  - tests/Whizbang.Data.Dapper.Postgres.Tests/PostgresConnectionRetryTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PostgresDriverExtensionsTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreExtensionsTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PostgresDriverRegistrationTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperGateWiringTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/EventBodyCompressionTests.cs
lastMaintainedCommit: '01f07906'
---

# PostgreSQL Data Provider

The PostgreSQL data provider enables Whizbang applications to use PostgreSQL as their primary data store, supporting event sourcing, perspectives, and advanced features like JSON columns and vector search.

## Overview

Whizbang provides first-class PostgreSQL support through:

- **EF Core Integration** - Full Entity Framework Core support with optimized configurations
- **Dapper Integration** - High-performance raw SQL queries
- **Connection Pooling** - Efficient connection management via Npgsql
- **JSON/JSONB Support** - Native PostgreSQL JSON column types
- **Vector Search** - pgvector integration for AI/ML workloads
- **UUIDv7 Support** - Time-ordered UUIDs for optimal indexing

## Installation

```bash{title="Installation" description="Installation" category="Implementation" difficulty="BEGINNER" tags=["Data", "Installation"]}
dotnet add package SoftwareExtravaganza.Whizbang.Data.EFCore.Postgres
```

## Configuration

### Basic Setup

```csharp{title="Basic Setup" description="Basic Setup" category="Implementation" difficulty="BEGINNER" tags=["Data", "C#", "Setup"] tests=["EFCoreExtensionsTests.WithEFCore_CanChainToWithDriverAsync", "PostgresDriverExtensionsTests.Postgres_ReturnedBuilder_HasSameServicesAsync"]}
services.AddWhizbang()
    .WithEFCore<MyDbContext>()
    .WithDriver.Postgres;
```

`.WithDriver.Postgres` is a property, not a method — the connection string is resolved from configuration, not passed inline.

### Connection String

The connection string is read from `IConfiguration` under `ConnectionStrings:db` (with `db-direct` and `db-init`, see [ConnectionStrings Conventions](../operations/configuration/configuration-reference#connectionstrings-conventions)). Name a second, separate database explicitly with `WithEFCore<ReportingDbContext>("reporting")`.

```
Host=localhost;Port=5432;Database=myapp;Username=postgres;Password=secret
```

### With Connection Retry {#connection-retry}

Two retry layers exist depending on the driver:

- **EF Core driver (turnkey)** — the generated `UseNpgsql` registration enables `EnableRetryOnFailure(maxRetryCount: 3, maxRetryDelay: 5s)` for transient command failures.
- **Dapper driver** — with `initializeSchema: true`, the schema initializer waits for the database at host start (never at registration) using `PostgresConnectionRetry` with exponential backoff, configured via `PostgresOptions`. A failure after that wait is retried by the initializer itself every `SchemaInitializationOptions.InitRetryDelay`, as on the EF Core driver ([Turnkey Initialization](turnkey-initialization.md#both-drivers)):

```csharp{title="With Connection Retry" description="Dapper driver startup connection retry with exponential backoff via PostgresOptions" category="Implementation" difficulty="BEGINNER" tags=["Data", "Connection", "Retry", "Connection-retry"] tests=["PostgresConnectionRetryTests.PostgresOptions_DefaultValues_AreCorrectAsync", "PostgresConnectionRetryTests.WaitForConnectionAsync_WithInvalidConnection_RetriesAndThrowsAsync"]}
services.AddWhizbangPostgres(
    connectionString,
    jsonOptions,
    initializeSchema: true,
    perspectiveEntries,
    configureOptions: options => {
        options.InitialRetryAttempts = 5;
        options.InitialRetryDelay = TimeSpan.FromSeconds(1);
        options.MaxRetryDelay = TimeSpan.FromSeconds(120);
        options.BackoffMultiplier = 2.0;
        options.RetryIndefinitely = true;
    });
```

| Property | Default | Description |
|----------|---------|-------------|
| `InitialRetryAttempts` | 5 | Initial retry attempts with warning logs |
| `InitialRetryDelay` | 1 second | Delay before first retry |
| `MaxRetryDelay` | 120 seconds | Maximum delay (caps exponential backoff) |
| `BackoffMultiplier` | 2.0 | Multiplier for exponential backoff |
| `RetryIndefinitely` | `true` | Continue retrying after initial attempts |
| `MaxInFlightCommands` | 50 | Cap on concurrent work-coordinator calls per process; feeds the `WorkCoordinatorGate`, see [In-Flight Command Cap](#max-in-flight-commands) |

### Command Timeout {#command-timeout}

The coordinator owns the timeout of its own SQL. A coordinator commit batch (handler results, composite
fan-outs) has been observed at 13 to 30 seconds under a bulk-import backlog; a timeout shorter than the
worst batch cancels the commit and loses its completions, the rows re-claim as lease expiries, and the
poison admission gate throttles the drain to one row per cycle.

- **EF Core driver:** every command the coordinator creates carries a fixed 180 second budget, the same
  value its `DbContext` uses, regardless of the `Command Timeout` in the consumer's connection string.
  Deliberate exceptions (vacuum, maintenance) set their own. A consumer connection string can therefore
  no longer cancel a commit batch.
- **Dapper driver:** coordinator commands use the connection string's `Command Timeout` (Npgsql's
  default is 30 seconds); maintenance and purge commands set 30 seconds.

`PostgresOptions.CommandTimeoutSeconds` is retired: no command ever read it. Each connection has its own
timeout key instead, named like its connection string (`Whizbang__Postgres__db__CommandTimeoutSeconds`,
`…__db-direct__…`, `…__db-init__…`); see [Command timeouts](../operations/configuration/configuration-reference#command-timeouts).

### In-Flight Command Cap {#max-in-flight-commands}

{verified: DapperGateWiringTests.MaxInFlightCommands_ReachesTheWorkCoordinatorGateAsync, PostgresDriverRegistrationTests.Postgres_CarriesMaxInFlightCommandsIntoTheWorkCoordinatorGateAsync}

`MaxInFlightCommands` (default 50) is the cap on concurrent work-coordinator calls per process. Both
drivers carry it into the `WorkCoordinatorGate` the worker pipeline builds: the EF Core driver
(`AddWhizbangPostgres` / `PostgresOptions`) and the Dapper driver (`AddWhizbangPostgres` with
`MaxInFlightCommands`) fill `WorkCoordinatorGateOptions.MaxConcurrent` from it when the
`Whizbang:WorkCoordinatorGate` configuration section has not set the cap itself. A cap set in that
section is the operator's explicit word and wins over this option. 0 or less disables the gate. Earlier
releases documented the option but never read it: the gate was built with a literal 50. A
`WorkCoordinatorGate` registered in DI before the worker pipeline still wins over both. The gate's
acquire deadline and the full precedence order are in the
[configuration reference](../operations/configuration/configuration-reference#workcoordinatorgateoptions).

## Schema Readiness {#readiness}

With the EF Core turnkey driver, schema initialization runs as a hosted service (`WhizbangDatabaseInitializerService`) during host startup. Workers await `ISchemaReadyGate` before issuing any SQL:

- On successful migration, the gate is marked ready and workers proceed
- On migration failure, the gate is never marked ready — startup throws and the host aborts rather than running on a broken schema

## Features

### Event Store

PostgreSQL is the recommended backend for the Whizbang event store:

```csharp{title="Event Store" description="PostgreSQL is the recommended backend for the Whizbang event store:" category="Implementation" difficulty="BEGINNER" tags=["Data", "C#", "Event", "Store"] unverified="raw IEventStore.AppendAsync — verified in the Event Store docs, not by the Postgres provider tests"}
// Events stored in optimized JSONB columns
await eventStore.AppendAsync(streamId, new OrderCreatedEvent(...));
```

### Event body storage {#event-body-storage}

{verified: EventBodyCompressionTests.BothBodyColumns_CompressWithLz4Async, EventBodyCompressionTests.TheBodyTable_KeepsTheServersToastTupleTargetAsync, EventBodyCompressionTests.ASecondBoot_LeavesTheCompressionAndTheTargetAsTheyAreAsync, EventBodyCompressionTests.ABodyInARowOverTheToastThreshold_IsStoredLz4CompressedAsync, EventBodyCompressionTests.ARowUnderTheToastThreshold_IsStoredUncompressedAsync}

An event's body and stored metadata live in `wh_event_body` (`event_id`, `event_data` JSONB, `metadata` JSONB). Both body columns compress with **lz4**, and the table keeps the server's `toast_tuple_target`. Migration 290 sets this; each column is altered only when it is not lz4 already, so applying the migration again takes no lock, and a server built without lz4 keeps pglz and logs a warning instead of failing the migration pass. Only bodies written after the migration are compressed with lz4: a stored value keeps the method it was written with until its row is rewritten.

**Why lz4, and why not a lower `toast_tuple_target`.** PostgreSQL considers compressing a row only once the whole row is over its toast threshold, about 2 KB, a constant compiled into the server. `toast_tuple_target` decides how far a row that is already over the threshold is shrunk; it never brings a smaller row into the toaster. Both were measured before the setting was chosen, on copies of `wh_event_body` loaded with the same generated rows (PostgreSQL 17; order-like JSON bodies of about 128 B to 8 KB of text, about 770 B of stored metadata per row):

| Body text | Row text | Stored body (default) | Compressed at default | Compressed at any target down to 128 |
|---|---|---|---|---|
| 241 B | 1,009 B | 255 B | no | no |
| 583 B | 1,352 B | 659 B | no | no |
| 784 B | 1,553 B | 896 B | no | no |
| 1,057 B | 1,825 B | 761 B | yes | yes |
| 2,147 B | 2,915 B | 1,221 B | yes | yes |
| 8,280 B | 9,048 B | 3,750 B | yes | yes |

On a mix in which 69% of rows are under 2 KB, the whole table (heap, TOAST and primary key) compared as follows:

| Setting | Total size | Full read of every body | Insert of every body | Buffers for 2,000 bodies read by id |
|---|---|---|---|---|
| pglz, default target (the server default) | 29.3 MB | 93 ms | 391 ms | 7,023 |
| **lz4, default target (chosen)** | **28.9 MB (-1.1%)** | **83 ms (-11%)** | **288 ms (-26%)** | **6,728 (-4%)** |
| lz4, target 1536 | 28.5 MB (-2.7%) | 89 ms | 282 ms | 7,848 (+12%) |
| lz4, target 1024 | 28.5 MB (-2.6%) | 96 ms | 295 ms | 8,645 (+23%) |
| lz4, target 512 to 128 | 28.8 MB (-1.7%) | 98 ms | 316 ms | 8,654 (+23%) |
| pglz, target 128 | 29.9 MB (+2.3%) | 106 ms | 429 ms | 8,647 (+23%) |

A lower target saves at most 1.6 points more than lz4 alone, and it does so by moving values out of line into the TOAST table, which every read of those events then pays for with extra buffers. lz4 alone is smaller, faster to write and faster to read, so it is the setting. Compressing the small rows, the majority of bodies, is not something a table setting can do; it belongs to dictionary compression, which is planned separately.

- `EventBodyCompressionTests.BothBodyColumns_CompressWithLz4Async` and `TheBodyTable_KeepsTheServersToastTupleTargetAsync` lock the two settings; `ASecondBoot_LeavesTheCompressionAndTheTargetAsTheyAreAsync` applies the migration again and checks both.
- `ABodyInARowOverTheToastThreshold_IsStoredLz4CompressedAsync` checks that a body in a row over the threshold is stored lz4-compressed and smaller than its text, and `ARowUnderTheToastThreshold_IsStoredUncompressedAsync` holds the measured limit: a 1 KB body with slim metadata is stored as it came.

### Perspectives

Perspectives are stored as PostgreSQL tables (`wh_per_*`) with automatic schema generation. Each table has the fixed `PerspectiveRow<TModel>` shape (id, data JSONB, metadata JSONB, scope JSONB, created_at, updated_at, version), plus optional physical columns:

```csharp{title="Perspectives" description="Perspective model with physical field storage configuration" category="Implementation" difficulty="BEGINNER" tags=["Data", "Perspectives"] unverified="perspective model + Apply — verified in the Perspectives docs, not by the Postgres provider tests"}
// Storage mode is configured on the MODEL via [PerspectiveStorage]
[PerspectiveStorage(FieldStorageMode.Extracted)]
public record OrderSummaryDto {
    public Guid OrderId { get; init; }
    public string CustomerName { get; init; } = "";

    [PhysicalField] [Indexed]
    public decimal Total { get; init; }
}

// The perspective applies events to the model via pure functions
public class OrderSummaryPerspective : IPerspectiveFor<OrderSummaryDto, OrderCreatedEvent> {
    public OrderSummaryDto Apply(OrderSummaryDto currentData, OrderCreatedEvent @event) {
        return new OrderSummaryDto {
            OrderId = @event.OrderId,
            CustomerName = @event.CustomerName,
            Total = @event.Total
        };
    }
}
```

### Vector Search

pgvector support is turnkey — marking any perspective model property with `[VectorField]` causes the generated registration to call `UseVector()` on the Npgsql data source and create the `vector` extension automatically:

```csharp{title="Vector Search" description="pgvector is enabled automatically when a model has a [VectorField] property" category="Implementation" difficulty="BEGINNER" tags=["Data", "C#", "Vector", "Search"] unverified="[VectorField] model + pgvector turnkey — verified in the Vector Search docs, not by the Postgres provider tests"}
[PerspectiveStorage(FieldStorageMode.Split)]
public record ProductSearchDto {
    [VectorField(1536)]
    public float[]? Embedding { get; init; }  // Stored as VECTOR(1536)
    public string Name { get; init; } = "";
}
```

## Related Documentation

- [EF Core Integration](efcore-integration.md)
- [Event Store](event-store.md)
- [Perspectives](../fundamentals/perspectives/perspectives.md)
- [Vector Search](../fundamentals/lenses/vector-search.md)
