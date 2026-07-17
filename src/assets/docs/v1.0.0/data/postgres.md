---
title: PostgreSQL Data Provider
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
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
testReferences:
  - tests/Whizbang.Data.Dapper.Postgres.Tests/PostgresConnectionRetryTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PostgresDriverExtensionsTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreExtensionsTests.cs
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
dotnet add package Whizbang.Data.EFCore.Postgres
```

## Configuration

### Basic Setup

```csharp{title="Basic Setup" description="Basic Setup" category="Implementation" difficulty="BEGINNER" tags=["Data", "C#", "Setup"]}
services.AddWhizbang()
    .WithEFCore<MyDbContext>()
    .WithDriver.Postgres;
```

`.WithDriver.Postgres` is a property, not a method — the connection string is resolved from configuration, not passed inline.

### Connection String

The connection string is read from `IConfiguration` under `ConnectionStrings:{name}`, where the name is derived from the DbContext class name by convention (e.g., `BffServiceDbContext` → `bffservice-db`). Override the name explicitly with `WithEFCore<MyDbContext>("my-database")`.

```
Host=localhost;Port=5432;Database=myapp;Username=postgres;Password=secret
```

### With Connection Retry {#connection-retry}

Two retry layers exist depending on the driver:

- **EF Core driver (turnkey)** — the generated `UseNpgsql` registration enables `EnableRetryOnFailure(maxRetryCount: 3, maxRetryDelay: 5s)` for transient command failures.
- **Dapper driver** — `AddWhizbangPostgres(...)` waits for the database at startup using `PostgresConnectionRetry` with exponential backoff, configured via `PostgresOptions`:

```csharp{title="With Connection Retry" description="Dapper driver startup connection retry with exponential backoff via PostgresOptions" category="Implementation" difficulty="BEGINNER" tags=["Data", "Connection", "Retry", "Connection-retry"]}
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
| `CommandTimeoutSeconds` | 5 | Command timeout for coordinator SQL calls |
| `MaxInFlightCommands` | 50 | Cap on concurrent work-coordinator calls per process |

## Schema Readiness {#readiness}

With the EF Core turnkey driver, schema initialization runs as a hosted service (`WhizbangDatabaseInitializerService`) during host startup. Workers await `ISchemaReadyGate` before issuing any SQL:

- On successful migration, the gate is marked ready and workers proceed
- On migration failure, the gate is never marked ready — startup throws and the host aborts rather than running on a broken schema

## Features

### Event Store

PostgreSQL is the recommended backend for the Whizbang event store:

```csharp{title="Event Store" description="PostgreSQL is the recommended backend for the Whizbang event store:" category="Implementation" difficulty="BEGINNER" tags=["Data", "C#", "Event", "Store"]}
// Events stored in optimized JSONB columns
await eventStore.AppendAsync(streamId, new OrderCreatedEvent(...));
```

### Perspectives

Perspectives are stored as PostgreSQL tables (`wh_per_*`) with automatic schema generation. Each table has the fixed `PerspectiveRow<TModel>` shape (id, data JSONB, metadata JSONB, scope JSONB, created_at, updated_at, version), plus optional physical columns:

```csharp{title="Perspectives" description="Perspective model with physical field storage configuration" category="Implementation" difficulty="BEGINNER" tags=["Data", "Perspectives"]}
// Storage mode is configured on the MODEL via [PerspectiveStorage]
[PerspectiveStorage(FieldStorageMode.Extracted)]
public record OrderSummaryDto {
    public Guid OrderId { get; init; }
    public string CustomerName { get; init; } = "";

    [PhysicalField(Indexed = true)]
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

```csharp{title="Vector Search" description="pgvector is enabled automatically when a model has a [VectorField] property" category="Implementation" difficulty="BEGINNER" tags=["Data", "C#", "Vector", "Search"]}
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
