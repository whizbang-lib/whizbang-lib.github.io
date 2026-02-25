---
title: Event Store Query
version: 1.0.0
category: Core Concepts
order: 10
description: >-
  Query raw events in the event store with full LINQ support and automatic scope
  filtering
tags: 'events, query, linq, ef-core, multi-tenancy'
codeReferences:
  - src/Whizbang.Core/Messaging/IEventStoreQuery.cs
  - src/Whizbang.Core/Messaging/IFilterableEventStoreQuery.cs
  - src/Whizbang.Core/Messaging/IScopedEventStoreQuery.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreFilterableEventStoreQuery.cs
---

# Event Store Query

## Overview

The Event Store Query feature provides `IQueryable<EventStoreRecord>` access to raw events in the event store. This enables powerful LINQ queries across events with automatic scope filtering for multi-tenancy.

## Key Features

- **Full LINQ Support**: Query events using standard LINQ operators (Where, OrderBy, Select, etc.)
- **Automatic Scope Filtering**: Events are filtered by tenant/user based on the current security context
- **Global Access**: Admin users can query all events with proper permissions
- **Singleton Service Support**: `IScopedEventStoreQuery` for use in background workers

## Basic Usage

### Scoped Access (Web APIs, Receptors)

```csharp
public class EventsController : ControllerBase {
  private readonly IScopedLensFactory _lensFactory;

  public EventsController(IScopedLensFactory lensFactory) {
    _lensFactory = lensFactory;
  }

  [HttpGet("stream/{streamId}")]
  public async Task<IActionResult> GetStreamEvents(Guid streamId) {
    // Get query filtered by tenant
    var query = _lensFactory.GetTenantEventStoreQuery();

    var events = await query.GetStreamEvents(streamId).ToListAsync();
    return Ok(events);
  }

  [HttpGet("recent")]
  public async Task<IActionResult> GetRecentEvents() {
    var query = _lensFactory.GetTenantEventStoreQuery();

    var events = await query.Query
        .Where(e => e.CreatedAt > DateTime.UtcNow.AddHours(-1))
        .OrderByDescending(e => e.CreatedAt)
        .Take(100)
        .ToListAsync();

    return Ok(events);
  }
}
```

### Global Access (Admin Operations)

```csharp
// Global access requires explicit permission
var globalQuery = _lensFactory.GetEventStoreQuery(
    ScopeFilter.None,
    Permission.Read("events:global"));

// Or use convenience method (no permission check)
var allEvents = _lensFactory.GetGlobalEventStoreQuery();
```

### Singleton Services (Background Workers)

```csharp
public class EventAnalyzerWorker : BackgroundService {
  private readonly IScopedEventStoreQuery _scopedQuery;

  public EventAnalyzerWorker(IScopedEventStoreQuery scopedQuery) {
    _scopedQuery = scopedQuery;
  }

  protected override async Task ExecuteAsync(CancellationToken stoppingToken) {
    // Auto-scoping ensures fresh DbContext per operation
    await foreach (var evt in _scopedQuery.QueryAsync(
        q => q.Query.Where(e => e.EventType == "OrderPlaced"),
        stoppingToken)) {
      // Process event
    }
  }
}
```

### Batch Operations (Manual Scope Control)

```csharp
var factory = serviceProvider.GetRequiredService<IEventStoreQueryFactory>();

using var scope = factory.CreateScoped();
var events = await scope.Value.Query
    .Where(e => e.StreamId == streamId)
    .ToListAsync();
```

## Available Methods

### IEventStoreQuery

| Property/Method | Description |
|-----------------|-------------|
| `Query` | `IQueryable<EventStoreRecord>` with automatic scope filtering |
| `GetStreamEvents(streamId)` | All events for a stream, ordered by version |
| `GetEventsByType(eventType)` | All events of a specific type |

### IScopedLensFactory (Event Store Methods)

| Method | Scope Filter | Description |
|--------|--------------|-------------|
| `GetEventStoreQuery(filters)` | Custom | Composable scope filters |
| `GetEventStoreQuery(filters, permission)` | Custom | With permission check |
| `GetGlobalEventStoreQuery()` | None | No filtering (admin) |
| `GetTenantEventStoreQuery()` | Tenant | Filter by TenantId |
| `GetUserEventStoreQuery()` | Tenant + User | Filter by TenantId and UserId |

## Scope Filtering

Event store queries support filtering by TenantId and UserId (the fields available in `MessageScope`).

```csharp
// Tenant-only filtering
var tenantQuery = _lensFactory.GetTenantEventStoreQuery();
// Generates: WHERE scope->>'TenantId' = 'tenant-123'

// Tenant + User filtering
var userQuery = _lensFactory.GetUserEventStoreQuery();
// Generates: WHERE scope->>'TenantId' = 'tenant-123' AND scope->>'UserId' = 'user-456'
```

> **Note**: Unlike perspective queries, event store queries do not support Organization, Customer, or Principal filtering because `MessageScope` only contains TenantId and UserId.

## Dapper Integration

For Dapper users, raw SQL access to the event store table is available:

```csharp
var events = await connection.QueryAsync<EventStoreRecord>(@"
    SELECT * FROM wh_event_store
    WHERE stream_id = @StreamId
    ORDER BY version",
    new { StreamId = streamId });
```

The table schema is:
- `event_id` (UUID) - Primary key
- `stream_id` (UUID) - Stream identifier (indexed)
- `aggregate_id`, `aggregate_type` - Backwards compatibility
- `version` (INT) - Sequence within stream
- `event_type` (VARCHAR) - Fully-qualified type name
- `event_data` (JSONB) - Event payload
- `metadata` (JSONB) - Envelope metadata
- `scope` (JSONB) - Multi-tenancy scope
- `created_at` (TIMESTAMPTZ) - Creation timestamp

## Best Practices

1. **Use Scoped Queries**: Prefer `IScopedLensFactory` methods for automatic scope filtering
2. **Limit Results**: Always use `Take()` or pagination for large result sets
3. **Use Specific Methods**: Prefer `GetStreamEvents()` over manual filtering when possible
4. **Permission Checks**: Use `GetEventStoreQuery(filters, permission)` for sensitive operations

## Related Topics

- [Event Store](event-store.md) - Event persistence and append operations
- [Scoped Lenses](scoped-lenses.md) - Scope filtering patterns
- [Multi-Tenancy](multi-tenancy.md) - Tenant isolation strategies
