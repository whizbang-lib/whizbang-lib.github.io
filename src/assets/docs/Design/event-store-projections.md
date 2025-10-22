---
title: Event Store & Projection Architecture
category: Architecture & Design
order: 4
tags: event-store, projections, architecture, jsonb, snapshots
---

# Event Store & Projection Architecture

Whizbang implements a hybrid event store and projection architecture that separates event persistence from projection storage, enabling flexible schema evolution and high-performance querying.

## Core Architecture

### Hybrid Storage Design

**Events Table** (Immutable Event Stream):
```sql
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Architecture, Event-Store, SQL, JSONB]
description: SQL schema for events table with JSONB data storage
---
CREATE TABLE events (
    event_id BIGSERIAL PRIMARY KEY,
    stream_id VARCHAR(255) NOT NULL,
    stream_version INT NOT NULL,
    event_type VARCHAR(255) NOT NULL,
    event_data JSONB NOT NULL,
    metadata JSONB,
    tenant_id VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL,
    UNIQUE(stream_id, stream_version)
);
CREATE INDEX idx_stream ON events(stream_id);
CREATE INDEX idx_type ON events(event_type);
CREATE INDEX idx_tenant ON events(tenant_id) WHERE tenant_id IS NOT NULL;
```

**Projections Tables** (Mutable JSONB Documents):
```sql
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Architecture, Projections, SQL, JSONB]
description: SQL schema for projections table with mutable JSONB documents
---
CREATE TABLE projections (
    projection_name VARCHAR(255) NOT NULL,
    document_id VARCHAR(255) NOT NULL,
    document JSONB NOT NULL,
    tenant_id VARCHAR(100),
    version BIGINT NOT NULL,
    last_updated TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (projection_name, document_id, COALESCE(tenant_id, ''))
);
CREATE INDEX idx_projection_tenant ON projections(projection_name, tenant_id);
```

### Benefits of Hybrid Approach

1. **Events are immutable** - Perfect audit trail, never changes
2. **Projections are mutable** - Can be rebuilt, schema can evolve
3. **JSONB flexibility** - No schema migrations for projection changes
4. **Performance optimization** - Events optimized for append, projections for queries
5. **Independent scaling** - Different databases/drivers for events vs projections

## Projection Management

### Schema-Free Evolution

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Projections, Schema-Evolution, Domain-Models]
description: Schema evolution example showing projection changes without migrations
---
// V1 Projection
public class OrderSummaryProjection {
    public Guid OrderId { get; set; }
    public decimal Total { get; set; }
    public OrderStatus Status { get; set; }
}

// V2 Projection - Add fields without migration
public class OrderSummaryProjection {
    public Guid OrderId { get; set; }
    public decimal Total { get; set; }
    public OrderStatus Status { get; set; }
    public DateTime EstimatedDelivery { get; set; }  // New field
    public List<string> Tags { get; set; } = new();   // New collection
}
```

**No database migration required** - JSONB handles missing fields gracefully.

### Atomic Projection Rebuilds

Whizbang supports **zero-downtime projection rebuilds** using temporary table swapping:

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Projections, Configuration, Atomic-Operations]
description: Configuration for atomic projection rebuilds with zero downtime
---
services.AddProjection<OrderSummaryProjection>(options => {
    options.RebuildStrategy = RebuildStrategy.AtomicSwap;
});

// Rebuild process:
// 1. Create temporary table: projections_ordersummary_temp
// 2. Build new projection in temp table from events
// 3. Atomic swap: RENAME projections_ordersummary TO projections_ordersummary_old,
//                  projections_ordersummary_temp TO projections_ordersummary
// 4. Drop old table
```

### Projection Drivers

Projections use **driver-based storage** for flexibility:

```csharp
---
category: Design
difficulty: BEGINNER
tags: [Design, Configuration, Drivers, PostgreSQL, MongoDB]
description: Driver configuration for different projection storage backends
---
// PostgreSQL JSONB Driver (default)
services.AddWhizbang(options => {
    options.UsePostgresProjections(connectionString);
});

// SQL Server JSON Driver
services.AddWhizbang(options => {
    options.UseSqlServerProjections(connectionString);
});

// MongoDB Driver
services.AddWhizbang(options => {
    options.UseMongoProjections(connectionString);
});

// Custom Driver
services.AddWhizbang(options => {
    options.UseProjectionDriver<MyCustomDriver>();
});
```

## Snapshotting

### Smart Replay with Snapshots

Whizbang supports **snapshot-assisted replays** to reduce replay overhead:

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Aggregates, Snapshots, Performance]
description: Aggregate with automatic snapshotting for replay optimization
---
public class OrderAggregate : Aggregate {
    public Guid Id { get; private set; }
    public decimal Total { get; private set; }
    public List<OrderItem> Items { get; private set; } = new();
    
    // Automatic snapshots every 100 events
    [Snapshot(Every = 100)]
    public OrderSnapshot CreateSnapshot() {
        return new OrderSnapshot {
            Id = Id,
            Total = Total,
            Items = Items.ToList()
        };
    }
    
    // Restore from snapshot
    public void RestoreFromSnapshot(OrderSnapshot snapshot) {
        Id = snapshot.Id;
        Total = snapshot.Total;
        Items = snapshot.Items;
    }
}
```

### Snapshot Storage

```sql
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Snapshots, SQL, Performance]
description: SQL schema for snapshot storage with JSONB data
---
CREATE TABLE snapshots (
    stream_id VARCHAR(255) NOT NULL,
    snapshot_version BIGINT NOT NULL,
    snapshot_data JSONB NOT NULL,
    tenant_id VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (stream_id, snapshot_version)
);
```

### Replay Strategy

When replaying events for projection rebuilds:

1. **Find closest snapshot** ≤ starting event number
2. **Restore snapshot** if available
3. **Replay remaining events** from snapshot version to target
4. **Non-atomic replays only** - atomic replays always start from beginning

```csharp
---
category: Design
difficulty: ADVANCED
tags: [Design, Snapshots, Replay, Performance-Optimization]
description: Smart replay strategy using snapshots to reduce event processing
---
// Smart replay from event #50,000
var snapshot = await snapshotStore.GetLatestBefore(streamId, eventNumber: 50000);
if (snapshot != null && snapshot.Version >= 49900) { // Within 100 events
    aggregate.RestoreFromSnapshot(snapshot);
    var events = await eventStore.ReadFrom(streamId, snapshot.Version + 1, 50000);
} else {
    var events = await eventStore.ReadFrom(streamId, 0, 50000);
}
```

## Implementation Details

### Projection Handler Registration

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Projections, Event-Handlers, Domain-Logic]
description: Projection handler implementation for multiple event types
---
public class OrderSummaryProjection : IProjectionHandler<OrderPlaced>,
                                     IProjectionHandler<OrderUpdated>,
                                     IProjectionHandler<OrderShipped> {
    
    public async Task Handle(OrderPlaced @event, ProjectionContext context) {
        var summary = new OrderSummary {
            OrderId = @event.OrderId,
            Total = @event.Total,
            Status = OrderStatus.Placed,
            CustomerId = @event.CustomerId
        };
        
        await context.Store(summary.OrderId.ToString(), summary);
    }
    
    public async Task Handle(OrderUpdated @event, ProjectionContext context) {
        var summary = await context.Load<OrderSummary>(@event.OrderId.ToString());
        if (summary != null) {
            summary.Total = @event.NewTotal;
            summary.Items = @event.UpdatedItems;
            await context.Store(@event.OrderId.ToString(), summary);
        }
    }
}
```

### Projection Configuration

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Projections, Configuration, Multi-Tenancy]
description: Advanced projection configuration with partitioning and rebuild strategies
---
services.AddProjection<OrderSummaryProjection>(projection => {
    projection.ProjectionName = "order-summary";
    projection.PartitionBy = order => order.CustomerId; // Multi-tenant partitioning
    projection.SnapshotStrategy = SnapshotStrategy.Automatic;
    projection.RebuildStrategy = RebuildStrategy.AtomicSwap;
    projection.CheckpointStorage = CheckpointStorage.SameDatabase;
});
```

### Driver Interface

```csharp
---
category: Design
difficulty: ADVANCED
tags: [Design, Drivers, Interfaces, Architecture]
description: Projection driver interface for pluggable storage backends
---
public interface IProjectionDriver {
    Task Store<T>(string projectionName, string documentId, T document, string? tenantId = null);
    Task<T?> Load<T>(string projectionName, string documentId, string? tenantId = null);
    Task Delete(string projectionName, string documentId, string? tenantId = null);
    
    // Querying support
    Task<IEnumerable<T>> Query<T>(string projectionName, Expression<Func<T, bool>> predicate, string? tenantId = null);
    Task<IEnumerable<T>> QueryAll<T>(string projectionName, string? tenantId = null);
    
    // Rebuild support
    Task<string> CreateTemporaryProjectionTable(string projectionName);
    Task SwapProjectionTables(string projectionName, string temporaryTableName);
    Task DropProjectionTable(string tableName);
}
```

## Multi-Database Support

### Events and Projections in Different Databases

```csharp
---
category: Design
difficulty: ADVANCED
tags: [Design, Configuration, Multi-Database, Architecture]
description: Configuration for separating events and projections across different databases
---
services.AddWhizbang(options => {
    // Events in PostgreSQL
    options.UsePostgresEventStore("Host=events-db;Database=events");
    
    // Projections in MongoDB
    options.UseMongoProjections("mongodb://projections-cluster");
    
    // Or projections in separate PostgreSQL instance
    options.UsePostgresProjections("Host=projections-db;Database=projections");
});
```

### Performance Benefits

1. **Events database** optimized for writes (append-only)
2. **Projections database** optimized for reads (complex queries)
3. **Independent scaling** of read vs write workloads
4. **Different drivers** for different use cases

## Best Practices

### Projection Design

1. **Keep projections focused** - One projection per use case
2. **Denormalize for queries** - Include all needed data
3. **Use tenant partitioning** - For multi-tenant scenarios
4. **Version projections** - For breaking changes

### Snapshot Guidelines

1. **Snapshot long-lived aggregates** - Orders, customers, accounts
2. **Don't snapshot short-lived aggregates** - Shopping carts, sessions
3. **Consider snapshot frequency** - Balance storage vs replay speed
4. **Test snapshot restore** - Ensure snapshots work correctly

### Rebuild Strategies

1. **Use atomic swaps** for production rebuilds
2. **Use in-place updates** for development
3. **Monitor rebuild progress** with checkpoints
4. **Validate rebuilt projections** before swapping

---

## Related Documentation

- [**Concurrency Control**](./concurrency-control.md) - How concurrency is managed
- [**Multi-Tenancy**](./multi-tenancy.md) - Tenant isolation strategies
- [**Performance Optimization**](./performance-optimization.md) - Scaling and tuning