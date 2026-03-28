---
title: PostgreSQL Data Provider
version: 1.0.0
category: Components
order: 1
description: PostgreSQL data provider for Whizbang applications
tags: data, postgres, postgresql, database
codeReferences:
  - src/Whizbang.Data.Postgres/PostgresOptions.cs
  - src/Whizbang.Data.Postgres/PostgresConnectionRetry.cs
  - src/Whizbang.Data.Postgres/PostgresReadinessExtensions.cs
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
    .WithDriver.Postgres(connectionString);
```

### Connection String

```
Host=localhost;Port=5432;Database=myapp;Username=postgres;Password=secret
```

### With Connection Retry {#connection-retry}

The PostgreSQL provider includes built-in connection retry with exponential backoff:

```csharp{title="With Connection Retry" description="The PostgreSQL provider includes built-in connection retry with exponential backoff:" category="Implementation" difficulty="BEGINNER" tags=["Data", "Connection", "Retry", "Connection-retry"]}
services.AddWhizbang()
    .WithEFCore<MyDbContext>()
    .WithDriver.Postgres(connectionString, options => {
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

## Readiness Checks {#readiness}

The provider includes database readiness checks for health monitoring:

```csharp{title="Readiness Checks" description="The provider includes database readiness checks for health monitoring:" category="Implementation" difficulty="BEGINNER" tags=["Data", "C#", "Readiness", "Checks"]}
services.AddHealthChecks()
    .AddPostgresReadinessCheck();
```

This verifies:
- Connection can be established
- Database exists and is accessible
- Required extensions are available (if configured)

## Features

### Event Store

PostgreSQL is the recommended backend for the Whizbang event store:

```csharp{title="Event Store" description="PostgreSQL is the recommended backend for the Whizbang event store:" category="Implementation" difficulty="BEGINNER" tags=["Data", "C#", "Event", "Store"]}
// Events stored in optimized JSONB columns
await eventStore.AppendAsync(streamId, new OrderCreatedEvent(...));
```

### Perspectives

Perspectives are stored as PostgreSQL tables with automatic schema generation:

```csharp{title="Perspectives" description="Perspectives are stored as PostgreSQL tables with automatic schema generation:" category="Implementation" difficulty="BEGINNER" tags=["Data", "Perspectives"]}
[PerspectiveStorage(StorageMode.Table)]
public class OrderPerspective : IPerspectiveFor<Order> {
    public Guid Id { get; set; }
    public string CustomerName { get; set; }
    public decimal Total { get; set; }
}
```

### Vector Search

For AI/ML workloads, enable pgvector support:

```csharp{title="Vector Search" description="For AI/ML workloads, enable pgvector support:" category="Implementation" difficulty="BEGINNER" tags=["Data", "C#", "Vector", "Search"]}
services.AddWhizbang()
    .WithEFCore<MyDbContext>()
    .WithDriver.Postgres(connectionString)
    .WithVectorSearch();
```

## Related Documentation

- [EF Core Integration](efcore-integration.md)
- [Event Store](event-store.md)
- [Perspectives](../fundamentals/perspectives/perspectives.md)
- [Vector Search](../fundamentals/lenses/vector-search.md)
