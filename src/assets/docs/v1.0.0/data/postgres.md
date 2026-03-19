---
title: PostgreSQL Data Provider
version: 1.0.0
category: Components
order: 1
description: PostgreSQL data provider for Whizbang applications
tags: data, postgres, postgresql, database
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

```bash
dotnet add package Whizbang.Data.EFCore.Postgres
```

## Configuration

### Basic Setup

```csharp
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

```csharp
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

```csharp
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

```csharp
// Events stored in optimized JSONB columns
await eventStore.AppendAsync(streamId, new OrderCreatedEvent(...));
```

### Perspectives

Perspectives are stored as PostgreSQL tables with automatic schema generation:

```csharp
[PerspectiveStorage(StorageMode.Table)]
public class OrderPerspective : IPerspectiveFor<Order> {
    public Guid Id { get; set; }
    public string CustomerName { get; set; }
    public decimal Total { get; set; }
}
```

### Vector Search

For AI/ML workloads, enable pgvector support:

```csharp
services.AddWhizbang()
    .WithEFCore<MyDbContext>()
    .WithDriver.Postgres(connectionString)
    .WithVectorSearch();
```

## Related Documentation

- [EF Core Integration](/data/efcore-integration)
- [Event Store](/core-concepts/event-store)
- [Perspectives](/core-concepts/perspectives)
- [Vector Search](/lenses/vector-search)
