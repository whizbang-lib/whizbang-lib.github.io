---
title: "Temporal Perspectives"
version: 1.0.0
category: "Perspectives"
order: 8
description: >-
  Temporal perspectives create append-only logs where each event creates a new row rather than
  updating existing rows. Ideal for activity feeds, audit logs, and full history tracking
  using the ITemporalPerspectiveFor interface.
tags: 'temporal-perspectives, append-only, audit-log, activity-feed, history, ITemporalPerspectiveFor'
codeReferences:
  - src/Whizbang.Core/Perspectives/ITemporalPerspectiveFor.cs
  - src/Whizbang.Core/Perspectives/ITemporalPerspectiveStore.cs
  - src/Whizbang.Core/Perspectives/TemporalActionType.cs
---

# Temporal Perspectives

Temporal perspectives create append-only logs where each event creates a NEW row rather than updating existing rows. This pattern is ideal for activity feeds, audit logs, and full history tracking.

## Overview

| Pattern | Interface | Storage | Use Case |
|---------|-----------|---------|----------|
| Standard | `IPerspectiveFor` | UPSERT (one row per stream) | Current state views |
| Temporal | `ITemporalPerspectiveFor` | INSERT (new row per event) | Activity feeds, audit logs |

## Defining a Temporal Perspective

```csharp{title="Defining a Temporal Perspective" description="Demonstrates defining a Temporal Perspective" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Defining", "Temporal"]}
public class ActivityPerspective :
    ITemporalPerspectiveFor<ActivityEntry, OrderCreatedEvent, OrderUpdatedEvent> {

  public ActivityEntry? Transform(OrderCreatedEvent @event) {
    return new ActivityEntry {
      SubjectId = @event.OrderId,
      Action = "created",
      Description = $"Order created for ${@event.TotalAmount}"
    };
  }

  public ActivityEntry? Transform(OrderUpdatedEvent @event) {
    return new ActivityEntry {
      SubjectId = @event.OrderId,
      Action = "updated",
      Description = $"Order status changed to {@event.NewStatus}"
    };
  }
}
```

### Key Differences from IPerspectiveFor

1. **Transform vs Apply**: `Transform(event)` instead of `Apply(currentData, event)`
2. **No current state**: Transform only receives the event, not existing data
3. **Nullable return**: Return `null` to skip an event (no entry created)
4. **Always INSERT**: Never updates existing rows

## Temporal Row Structure

Each temporal row includes:

```csharp{title="Temporal Row Structure" description="Each temporal row includes:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Temporal", "Row"]}
public class TemporalPerspectiveRow<TModel> {
  public Guid Id { get; }           // UUIDv7 for time-ordering
  public Guid StreamId { get; }     // Aggregate ID
  public Guid EventId { get; }      // Source event ID
  public TModel Data { get; }       // Transformed entry
  public PerspectiveMetadata Metadata { get; }
  public PerspectiveScope Scope { get; }

  // Temporal tracking (SQL Server patterns)
  public TemporalActionType ActionType { get; }  // Insert/Update/Delete
  public DateTime PeriodStart { get; }           // When recorded (system time)
  public DateTime PeriodEnd { get; }             // When superseded
  public DateTimeOffset ValidTime { get; }       // Business time from event
}
```

## Querying Temporal Data

### All History

```csharp{title="All History" description="Demonstrates all History" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "All", "History"]}
var allHistory = await temporalLens
    .TemporalAll()
    .Where(r => r.StreamId == orderId)
    .OrderBy(r => r.PeriodStart)
    .ToListAsync();
```

### Latest Per Stream

```csharp{title="Latest Per Stream" description="Demonstrates latest Per Stream" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Latest", "Per"]}
var latestStates = await temporalLens
    .LatestPerStream()
    .ToListAsync();
```

### Point-in-Time Query (As Of)

```csharp{title="Point-in-Time Query (As Of)" description="Demonstrates point-in-Time Query (As Of)" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Point-in-Time", "Query"]}
var stateLastWeek = await temporalLens
    .TemporalAsOf(DateTimeOffset.UtcNow.AddDays(-7))
    .ToListAsync();
```

### Time Range Queries

```csharp{title="Time Range Queries" description="Demonstrates time Range Queries" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Time", "Range"]}
// Rows active during a range
var activeRows = await temporalLens
    .TemporalFromTo(startTime, endTime)
    .ToListAsync();

// Rows fully contained in a range
var containedRows = await temporalLens
    .TemporalContainedIn(startTime, endTime)
    .ToListAsync();
```

### Convenience Methods

```csharp{title="Convenience Methods" description="Demonstrates convenience Methods" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Convenience", "Methods"]}
// Recent activity for a stream
var orderActivity = await temporalLens
    .RecentActivityForStream(orderId, limit: 20)
    .ToListAsync();

// Recent activity for a user
var userActivity = await temporalLens
    .RecentActivityForUser(userId, limit: 50)
    .ToListAsync();
```

## Action Types

The `TemporalActionType` enum tracks what happened:

```csharp{title="Action Types" description="The TemporalActionType enum tracks what happened:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Action", "Types"]}
public enum TemporalActionType {
  Insert,   // New entity created
  Update,   // Entity modified
  Delete    // Entity removed/soft-deleted
}
```

## Filtering Events

Return `null` from Transform to skip events:

```csharp{title="Filtering Events" description="Return null from Transform to skip events:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Filtering", "Events"]}
public ActivityEntry? Transform(OrderCreatedEvent @event) {
  // Only log high-value orders
  if (@event.TotalAmount < 100) {
    return null;  // Skip this event
  }

  return new ActivityEntry { ... };
}
```

## Bi-Temporal Support

Temporal perspectives support both system time and business time:

- **PeriodStart/PeriodEnd**: When the database recorded the change (system time)
- **ValidTime**: When the event occurred in business terms

This enables queries like "what did we know about this order on January 15th?"

## See Also

- Standard Perspectives
- ITemporalLensQuery Reference
