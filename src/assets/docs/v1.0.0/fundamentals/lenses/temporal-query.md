---
title: Temporal Lens Queries
version: 1.0.0
category: Lenses
order: 4
description: >-
  Time-travel queries, history tracking, and activity feeds for temporal (append-only) perspectives
tags: 'lenses, temporal, history, time-travel, activity-feed, audit'
codeReferences:
  - src/Whizbang.Core/Lenses/ITemporalLensQuery.cs
  - src/Whizbang.Core/Lenses/TemporalPerspectiveRow.cs
lastMaintainedCommit: '01f07906'
---

# Temporal Lens Queries

Temporal lens queries enable time-travel, history tracking, and activity feed patterns for append-only perspectives. These follow EF Core's temporal table patterns for SQL Server and provide equivalent functionality for PostgreSQL.

## Overview

While standard `ILensQuery<T>` works with `PerspectiveRow<T>` (one row per stream, UPSERT pattern), `ITemporalLensQuery<T>` works with `TemporalPerspectiveRow<T>` (one row per event, INSERT pattern):

```
Standard Perspective (UPSERT):
┌─────────────────────────────────────┐
│ Stream: Order-123                   │
│ ───────────────────────────────────│
│ [Row 1] ← Latest state only        │
└─────────────────────────────────────┘

Temporal Perspective (INSERT):
┌─────────────────────────────────────┐
│ Stream: Order-123                   │
│ ───────────────────────────────────│
│ [Row 1] OrderCreated     10:00 AM  │
│ [Row 2] ItemAdded        10:05 AM  │
│ [Row 3] ItemAdded        10:07 AM  │
│ [Row 4] OrderShipped     2:30 PM   │
│ [Row 5] OrderDelivered   Next Day  │
└─────────────────────────────────────┘
```

## ITemporalLensQuery Interface

```csharp{title="ITemporalLensQuery Interface" description="ITemporalLensQuery Interface" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "ITemporalLensQuery", "Interface"]}
public interface ITemporalLensQuery<TModel> : ILensQuery where TModel : class {
  // Full history
  IQueryable<TemporalPerspectiveRow<TModel>> TemporalAll();

  // Latest state per stream
  IQueryable<TemporalPerspectiveRow<TModel>> LatestPerStream();

  // Point-in-time queries
  IQueryable<TemporalPerspectiveRow<TModel>> TemporalAsOf(DateTimeOffset systemTime);
  IQueryable<TemporalPerspectiveRow<TModel>> TemporalFromTo(
      DateTimeOffset startTime, DateTimeOffset endTime);
  IQueryable<TemporalPerspectiveRow<TModel>> TemporalContainedIn(
      DateTimeOffset startTime, DateTimeOffset endTime);

  // Activity feeds
  IQueryable<TemporalPerspectiveRow<TModel>> RecentActivityForStream(Guid streamId, int limit = 50);
  IQueryable<TemporalPerspectiveRow<TModel>> RecentActivityForUser(string userId, int limit = 50);
}
```

## TemporalPerspectiveRow Structure

Each row in a temporal perspective contains:

```csharp{title="TemporalPerspectiveRow Structure" description="Each row in a temporal perspective contains:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "TemporalPerspectiveRow", "Structure"]}
public class TemporalPerspectiveRow<TModel> where TModel : class {
  // Identity
  public Guid Id { get; init; }           // Unique row ID (UUIDv7)
  public Guid StreamId { get; init; }     // Aggregate/entity ID
  public Guid EventId { get; init; }      // Source event ID

  // Data
  public TModel Data { get; init; }       // The log entry model (JSONB)

  // Metadata
  public PerspectiveMetadata Metadata { get; set; }  // Event type, correlation, etc.
  public PerspectiveScope Scope { get; set; }        // Tenant, user, org

  // Temporal fields
  public TemporalActionType ActionType { get; init; } // Insert/Update/Delete
  public DateTime PeriodStart { get; init; }          // When recorded (system time)
  public DateTime PeriodEnd { get; init; }            // When superseded
  public DateTimeOffset ValidTime { get; init; }      // When it happened (business time)
}
```

### Time Concepts

**System Time** (`PeriodStart`/`PeriodEnd`):
- When the database recorded the change
- Used for time-travel queries ("what did we know at time X?")
- Managed automatically by the database

**Business Time** (`ValidTime`):
- When the event occurred in business terms
- Comes from the event timestamp
- Used for activity feeds ("what happened at time X?")

## Query Patterns

### Full History

Get all events for a stream:

```csharp{title="Full History" description="Get all events for a stream:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Full", "History"]}
var history = await temporalLens
    .TemporalAll()
    .Where(r => r.StreamId == orderId)
    .OrderBy(r => r.PeriodStart)
    .ToListAsync();

foreach (var entry in history) {
  Console.WriteLine($"{entry.ValidTime}: {entry.Metadata.EventType} - {entry.ActionType}");
}
```

### Latest State Per Stream

Get current state of multiple aggregates:

```csharp{title="Latest State Per Stream" description="Get current state of multiple aggregates:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Latest", "State"]}
var currentOrders = await temporalLens
    .LatestPerStream()
    .Where(r => r.Data.Status == "Pending")
    .Select(r => r.Data)
    .ToListAsync();
```

### Point-in-Time Query (AsOf)

See the state as it was at a specific time:

```csharp{title="Point-in-Time Query (AsOf)" description="See the state as it was at a specific time:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Point-in-Time", "Query"]}
// What did the order look like last week?
var lastWeekState = await temporalLens
    .TemporalAsOf(DateTimeOffset.UtcNow.AddDays(-7))
    .Where(r => r.StreamId == orderId)
    .FirstOrDefaultAsync();
```

### Time Range Queries

**FromTo** - Rows active during a range (overlapping):

```csharp{title="Time Range Queries" description="FromTo - Rows active during a range (overlapping):" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Time", "Range"]}
// All activity during Q4
var q4Activity = await temporalLens
    .TemporalFromTo(
        new DateTimeOffset(2024, 10, 1, 0, 0, 0, TimeSpan.Zero),
        new DateTimeOffset(2025, 1, 1, 0, 0, 0, TimeSpan.Zero))
    .ToListAsync();
```

**ContainedIn** - Rows that started AND ended within a range:

```csharp{title="Time Range Queries (2)" description="ContainedIn - Rows that started AND ended within a range:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Time", "Range"]}
// Entries fully within December
var decemberOnly = await temporalLens
    .TemporalContainedIn(
        new DateTimeOffset(2024, 12, 1, 0, 0, 0, TimeSpan.Zero),
        new DateTimeOffset(2024, 12, 31, 23, 59, 59, TimeSpan.Zero))
    .ToListAsync();
```

### Activity Feeds

**Recent activity for a stream** (order history):

```csharp{title="Activity Feeds" description="Recent activity for a stream (order history):" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Activity", "Feeds"]}
var orderHistory = await temporalLens
    .RecentActivityForStream(orderId, limit: 20)
    .ToListAsync();
```

**Recent activity for a user** (user dashboard):

```csharp{title="Activity Feeds (2)" description="Recent activity for a user (user dashboard):" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lenses", "Activity", "Feeds"]}
var userActivity = await temporalLens
    .RecentActivityForUser(userId, limit: 50)
    .ToListAsync();
```

## Use Cases

### Audit Trail

Track all changes to sensitive data:

```csharp{title="Audit Trail" description="Track all changes to sensitive data:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "Audit", "Trail"]}
public class AccountAuditService {
  private readonly ITemporalLensQuery<AccountActivityLog> _lens;

  public async Task<IEnumerable<AuditEntry>> GetAuditTrailAsync(
      Guid accountId, CancellationToken ct) {

    var history = await _lens
        .TemporalAll()
        .Where(r => r.StreamId == accountId)
        .OrderByDescending(r => r.ValidTime)
        .Select(r => new AuditEntry {
          Timestamp = r.ValidTime,
          Action = r.Metadata.EventType,
          UserId = r.Scope.UserId,
          Details = r.Data.Description
        })
        .ToListAsync(ct);

    return history;
  }
}
```

### Activity Dashboard

Show recent activity across all entities:

```csharp{title="Activity Dashboard" description="Show recent activity across all entities:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "Activity", "Dashboard"]}
public class DashboardService {
  private readonly ITemporalLensQuery<ActivityLog> _lens;

  public async Task<IEnumerable<ActivityItem>> GetRecentActivityAsync(
      string userId, CancellationToken ct) {

    return await _lens
        .RecentActivityForUser(userId, limit: 20)
        .Select(r => new ActivityItem {
          Icon = GetIconForEventType(r.Metadata.EventType),
          Title = r.Data.Title,
          Description = r.Data.Description,
          TimeAgo = GetTimeAgo(r.ValidTime),
          Link = r.Data.EntityLink
        })
        .ToListAsync(ct);
  }
}
```

### Compliance Reporting

Generate reports showing data state at audit time:

```csharp{title="Compliance Reporting" description="Generate reports showing data state at audit time:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "Compliance", "Reporting"]}
public class ComplianceReport {
  public async Task<IEnumerable<OrderSnapshot>> GetOrdersAsOfAuditDateAsync(
      DateTimeOffset auditDate, CancellationToken ct) {

    return await _lens
        .TemporalAsOf(auditDate)
        .Where(r => r.Data.Total > 10000) // High-value orders
        .Select(r => new OrderSnapshot {
          OrderId = r.StreamId,
          Total = r.Data.Total,
          Status = r.Data.Status,
          StateAsOf = auditDate
        })
        .ToListAsync(ct);
  }
}
```

### Undo/Restore

Restore previous state by querying history:

```csharp{title="Undo/Restore" description="Restore previous state by querying history:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lenses", "Undo", "Restore"]}
public async Task<TModel?> GetPreviousStateAsync<TModel>(
    ITemporalLensQuery<TModel> lens,
    Guid streamId,
    CancellationToken ct) where TModel : class {

  // Get second-to-last entry (skip current)
  var previousState = await lens
      .TemporalAll()
      .Where(r => r.StreamId == streamId)
      .OrderByDescending(r => r.PeriodStart)
      .Skip(1) // Skip current
      .Select(r => r.Data)
      .FirstOrDefaultAsync(ct);

  return previousState;
}
```

## Comparison to EF Core Temporal Tables

Whizbang's temporal queries follow the same patterns as EF Core's SQL Server temporal table support:

| EF Core (SQL Server) | Whizbang | Purpose |
|---------------------|----------|---------|
| `TemporalAll()` | `TemporalAll()` | Full history |
| `TemporalAsOf(dt)` | `TemporalAsOf(dto)` | Point-in-time |
| `TemporalFromTo(s,e)` | `TemporalFromTo(s,e)` | Range (overlapping) |
| `TemporalContainedIn(s,e)` | `TemporalContainedIn(s,e)` | Range (contained) |
| N/A | `LatestPerStream()` | Current state |
| N/A | `RecentActivityForStream()` | Activity feed |
| N/A | `RecentActivityForUser()` | User activity |

The main difference is that Whizbang's temporal perspectives are explicit (you define them as append-only), while EF Core's temporal tables are a database feature that can be applied to any table.

## Performance Considerations

1. **Indexes**: Temporal tables should have indexes on:
   - `StreamId` + `PeriodStart DESC` (for stream history)
   - `Scope_UserId` + `ValidTime DESC` (for user activity)
   - `PeriodStart` (for time-range queries)

2. **Limits**: Always use limits for activity feeds to avoid scanning entire history.

3. **Archiving**: For high-volume systems, consider archiving old temporal data to a separate table.

## See Also

- [Lens Queries](lenses.md) - Standard lens queries
- [Perspectives](../perspectives/perspectives.md) - How perspectives maintain read models
- [Event Store](../../data/event-store.md) - Source events for temporal data
