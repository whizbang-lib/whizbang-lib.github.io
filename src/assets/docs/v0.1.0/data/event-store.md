---
title: "Event Store"
version: 0.1.0
category: Data Access
order: 4
description: "Event sourcing and stream storage - event streams, replay, checkpoints, snapshots, and temporal queries"
tags: event-sourcing, event-store, streams, replay, checkpoints, snapshots, postgresql
codeReferences:
  - src/Whizbang.Core/EventStore/IEventStore.cs
  - src/Whizbang.Core/Coordination/IWorkCoordinator.cs
  - src/Whizbang.Data.Postgres/Schema/event_store.sql
---

# Event Store

The **Event Store** is the append-only log of all domain events in your system. It provides event sourcing capabilities, stream-based processing, and time-travel queries for rebuilding read models from any point in history.

## Event Sourcing Fundamentals

**Event Sourcing** stores state changes as a sequence of events rather than current state:

```
Traditional State Storage:        Event Sourcing:
┌──────────────────────┐         ┌──────────────────────┐
│  Order Table         │         │  Event Stream        │
├──────────────────────┤         ├──────────────────────┤
│ order_id: abc        │         │ OrderCreated         │
│ status: Shipped      │   ←──   │ OrderPaid            │
│ total: $100          │         │ OrderShipped         │
└──────────────────────┘         └──────────────────────┘
  (current state)                  (full history)
```

**Benefits**:
- **Complete Audit Trail**: Every state change recorded forever
- **Temporal Queries**: "What was the order status at 2PM yesterday?"
- **Replay**: Rebuild read models from events
- **Debugging**: Reproduce exact system state for troubleshooting
- **Analytics**: Mine event history for business insights

---

## Event Stream Schema

### Core Tables

```sql
-- Event stream (append-only)
CREATE TABLE wh_events (
    event_id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),  -- Time-ordered
    stream_id UUID NOT NULL,                               -- Aggregate/entity ID
    stream_type VARCHAR(200) NOT NULL,                     -- 'Order', 'Customer', etc.

    event_type VARCHAR(200) NOT NULL,                      -- 'OrderCreated', 'OrderShipped', etc.
    event_data JSONB NOT NULL,                             -- Event payload
    event_metadata JSONB DEFAULT '{}',                     -- Context (user, tenant, correlation)

    sequence_number BIGINT NOT NULL,                       -- Position in stream (1, 2, 3, ...)
    global_sequence BIGSERIAL NOT NULL UNIQUE,             -- Global ordering across all streams

    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Composite unique constraint (one sequence per stream)
    CONSTRAINT uq_stream_sequence UNIQUE (stream_id, sequence_number)
);

-- Indexes
CREATE INDEX idx_events_stream_id ON wh_events (stream_id, sequence_number);
CREATE INDEX idx_events_stream_type ON wh_events (stream_type);
CREATE INDEX idx_events_event_type ON wh_events (event_type);
CREATE INDEX idx_events_timestamp ON wh_events (timestamp DESC);
CREATE INDEX idx_events_global_sequence ON wh_events (global_sequence);
```

**Key Design Decisions**:
- **UUIDv7** for `event_id`: Time-ordered, insert-friendly
- **sequence_number**: Position within a single stream (1, 2, 3, ...)
- **global_sequence**: Total ordering across all streams (for projections)
- **JSONB** for `event_data`: Flexible schema, queryable
- **stream_type**: Partition by aggregate type (Order, Customer, Product, etc.)

---

### Event Processing Tracking

```sql
-- Receptor processing (log-style tracking)
CREATE TABLE wh_receptor_processing (
    event_id UUID NOT NULL,
    receptor_name VARCHAR(200) NOT NULL,
    status VARCHAR(50) NOT NULL,  -- 'Processed', 'Failed', 'Skipped'
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    error TEXT,

    PRIMARY KEY (event_id, receptor_name),
    FOREIGN KEY (event_id) REFERENCES wh_events (event_id) ON DELETE CASCADE
);

CREATE INDEX idx_receptor_processing_status ON wh_receptor_processing (status);

-- Perspective checkpoints (stream-based projections)
CREATE TABLE wh_perspective_checkpoints (
    stream_id UUID NOT NULL,
    perspective_name VARCHAR(200) NOT NULL,
    last_event_id UUID NOT NULL,
    last_sequence_number BIGINT NOT NULL,
    status VARCHAR(50) NOT NULL,  -- 'UpToDate', 'Rebuilding', 'Failed'
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    error TEXT,

    PRIMARY KEY (stream_id, perspective_name),
    FOREIGN KEY (last_event_id) REFERENCES wh_events (event_id) ON DELETE CASCADE
);

CREATE INDEX idx_perspective_checkpoints_perspective ON wh_perspective_checkpoints (perspective_name);
CREATE INDEX idx_perspective_checkpoints_status ON wh_perspective_checkpoints (status);
```

**Design Differences**:

| Aspect | Receptors (wh_receptor_processing) | Perspectives (wh_perspective_checkpoints) |
|--------|-------------------------------------|------------------------------------------|
| **Tracking** | Per event + receptor | Per stream + perspective |
| **Ordering** | No ordering (parallel) | Ordered within stream |
| **Use Case** | Side effects, notifications | Read model projections |
| **Replay** | Re-process individual events | Rebuild from checkpoint |

---

## Appending Events

### Simple Event Storage (Recommended)

The simplest way to append events is to pass just the stream ID and event. Whizbang automatically captures tracing context from the `IEnvelopeRegistry`:

```csharp
public class OrderReceptor(IEventStore eventStore) : IReceptor<CreateOrder, OrderCreated> {
    public async ValueTask<OrderCreated> ReceiveAsync(CreateOrder command, CancellationToken ct) {
        var orderId = Guid.CreateVersion7();

        var @event = new OrderCreated(orderId, command.CustomerId, command.Total);

        // Simple pattern - just pass stream ID and event
        await eventStore.AppendAsync(orderId, @event, ct);

        return @event;
    }
}
```

**How it works**: When the Dispatcher invokes your receptor, it registers the `MessageEnvelope` in the `IEnvelopeRegistry`. When you call `AppendAsync(streamId, message)`, the event store looks up the envelope to preserve:
- **MessageId** - Correlation across systems
- **Hops** - Service-to-service tracing
- **CorrelationId/CausationId** - Request chain tracking

If no envelope is found (e.g., in tests without Dispatcher), a minimal envelope is created automatically.

### Full Control with Envelope

For advanced scenarios where you need full control over the envelope:

```csharp
// Create explicit envelope with custom tracing
var envelope = new MessageEnvelope<OrderCreated> {
    MessageId = MessageId.New(),
    Payload = @event,
    Hops = [new MessageHop {
        ServiceInstance = serviceInstanceProvider.ToInfo(),
        Timestamp = DateTimeOffset.UtcNow
    }]
};

await eventStore.AppendAsync(orderId, envelope, ct);
```

### Low-Level Event Storage (Implementation Detail)

For reference, here's the underlying storage implementation:

```csharp
public class EventStore : IEventStore {
    private readonly IDbConnectionFactory _db;

    public async Task<Guid> AppendAsync(
        Guid streamId,
        string streamType,
        string eventType,
        object eventData,
        Dictionary<string, object>? metadata = null,
        CancellationToken ct = default) {

        await using var conn = _db.CreateConnection();

        // Get next sequence number for stream
        var nextSequence = await conn.QuerySingleAsync<long>(
            "SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM wh_events WHERE stream_id = @StreamId",
            new { StreamId = streamId }
        );

        var eventId = Guid.CreateVersion7();

        await conn.ExecuteAsync(
            """
            INSERT INTO wh_events (
                event_id, stream_id, stream_type, event_type, event_data, event_metadata, sequence_number, timestamp
            ) VALUES (
                @EventId, @StreamId, @StreamType, @EventType, @EventData::jsonb, @EventMetadata::jsonb, @SequenceNumber, @Timestamp
            )
            """,
            new {
                EventId = eventId,
                StreamId = streamId,
                StreamType = streamType,
                EventType = eventType,
                EventData = JsonSerializer.Serialize(eventData),
                EventMetadata = JsonSerializer.Serialize(metadata ?? new Dictionary<string, object>()),
                SequenceNumber = nextSequence,
                Timestamp = DateTimeOffset.UtcNow
            },
            cancellationToken: ct
        );

        return eventId;
    }
}
```

### Optimistic Concurrency (Expected Version)

```csharp
public async Task<Guid> AppendAsync(
    Guid streamId,
    string streamType,
    string eventType,
    object eventData,
    long? expectedVersion = null,  // ← Optimistic concurrency
    Dictionary<string, object>? metadata = null,
    CancellationToken ct = default) {

    await using var conn = _db.CreateConnection();
    await conn.OpenAsync(ct);

    await using var transaction = await conn.BeginTransactionAsync(ct);

    try {
        // Get current version
        var currentVersion = await conn.QuerySingleOrDefaultAsync<long?>(
            "SELECT MAX(sequence_number) FROM wh_events WHERE stream_id = @StreamId",
            new { StreamId = streamId },
            transaction: transaction
        );

        var actualVersion = currentVersion ?? 0;

        // Check expected version
        if (expectedVersion.HasValue && actualVersion != expectedVersion.Value) {
            throw new ConcurrencyException(
                $"Stream {streamId} expected version {expectedVersion}, but was {actualVersion}"
            );
        }

        var nextSequence = actualVersion + 1;
        var eventId = Guid.CreateVersion7();

        await conn.ExecuteAsync(
            """
            INSERT INTO wh_events (
                event_id, stream_id, stream_type, event_type, event_data, event_metadata, sequence_number, timestamp
            ) VALUES (
                @EventId, @StreamId, @StreamType, @EventType, @EventData::jsonb, @EventMetadata::jsonb, @SequenceNumber, @Timestamp
            )
            """,
            new {
                EventId = eventId,
                StreamId = streamId,
                StreamType = streamType,
                EventType = eventType,
                EventData = JsonSerializer.Serialize(eventData),
                EventMetadata = JsonSerializer.Serialize(metadata ?? new Dictionary<string, object>()),
                SequenceNumber = nextSequence,
                Timestamp = DateTimeOffset.UtcNow
            },
            transaction: transaction,
            cancellationToken: ct
        );

        await transaction.CommitAsync(ct);

        return eventId;

    } catch {
        await transaction.RollbackAsync(ct);
        throw;
    }
}
```

---

## Reading Event Streams

### Read Full Stream

```csharp
public async Task<StoredEvent[]> ReadStreamAsync(
    Guid streamId,
    CancellationToken ct = default) {

    await using var conn = _db.CreateConnection();

    var events = await conn.QueryAsync<StoredEvent>(
        """
        SELECT
            event_id, stream_id, stream_type, event_type,
            event_data, event_metadata, sequence_number, global_sequence, timestamp
        FROM wh_events
        WHERE stream_id = @StreamId
        ORDER BY sequence_number
        """,
        new { StreamId = streamId },
        cancellationToken: ct
    );

    return events.ToArray();
}
```

### Read Stream from Version

```csharp
public async Task<StoredEvent[]> ReadStreamAsync(
    Guid streamId,
    long fromVersion,
    CancellationToken ct = default) {

    await using var conn = _db.CreateConnection();

    var events = await conn.QueryAsync<StoredEvent>(
        """
        SELECT * FROM wh_events
        WHERE stream_id = @StreamId
          AND sequence_number >= @FromVersion
        ORDER BY sequence_number
        """,
        new { StreamId = streamId, FromVersion = fromVersion },
        cancellationToken: ct
    );

    return events.ToArray();
}
```

### Read All Events (Global Stream)

```csharp
public async Task<StoredEvent[]> ReadAllEventsAsync(
    long fromGlobalSequence,
    int limit = 1000,
    CancellationToken ct = default) {

    await using var conn = _db.CreateConnection();

    var events = await conn.QueryAsync<StoredEvent>(
        """
        SELECT * FROM wh_events
        WHERE global_sequence >= @FromGlobalSequence
        ORDER BY global_sequence
        LIMIT @Limit
        """,
        new { FromGlobalSequence = fromGlobalSequence, Limit = limit },
        cancellationToken: ct
    );

    return events.ToArray();
}
```

---

## Rebuilding Perspectives from Events

### Checkpoint-Based Replay

```csharp
public class PerspectiveRebuilder {
    private readonly IDbConnectionFactory _db;
    private readonly IServiceProvider _services;

    public async Task RebuildPerspectiveAsync(
        Guid streamId,
        string perspectiveName,
        CancellationToken ct = default) {

        await using var conn = _db.CreateConnection();

        // Get last checkpoint (if any)
        var checkpoint = await conn.QuerySingleOrDefaultAsync<PerspectiveCheckpoint>(
            """
            SELECT * FROM wh_perspective_checkpoints
            WHERE stream_id = @StreamId AND perspective_name = @PerspectiveName
            """,
            new { StreamId = streamId, PerspectiveName = perspectiveName }
        );

        var fromSequence = checkpoint?.LastSequenceNumber + 1 ?? 1;

        // Read events from checkpoint
        var events = await conn.QueryAsync<StoredEvent>(
            """
            SELECT * FROM wh_events
            WHERE stream_id = @StreamId
              AND sequence_number >= @FromSequence
            ORDER BY sequence_number
            """,
            new { StreamId = streamId, FromSequence = fromSequence },
            cancellationToken: ct
        );

        // Resolve perspective handler
        var perspective = ResolvePerspective(perspectiveName);

        // Replay events
        foreach (var storedEvent in events) {
            var @event = DeserializeEvent(storedEvent);

            await perspective.UpdateAsync(@event, ct);

            // Update checkpoint
            await conn.ExecuteAsync(
                """
                INSERT INTO wh_perspective_checkpoints (
                    stream_id, perspective_name, last_event_id, last_sequence_number, status, updated_at
                ) VALUES (
                    @StreamId, @PerspectiveName, @EventId, @SequenceNumber, 'UpToDate', NOW()
                )
                ON CONFLICT (stream_id, perspective_name) DO UPDATE SET
                    last_event_id = EXCLUDED.last_event_id,
                    last_sequence_number = EXCLUDED.last_sequence_number,
                    status = EXCLUDED.status,
                    updated_at = EXCLUDED.updated_at
                """,
                new {
                    StreamId = streamId,
                    PerspectiveName = perspectiveName,
                    EventId = storedEvent.EventId,
                    SequenceNumber = storedEvent.SequenceNumber
                },
                cancellationToken: ct
            );
        }
    }
}
```

### Full Rebuild (Delete + Replay)

```csharp
public async Task FullRebuildPerspectiveAsync(
    string perspectiveName,
    CancellationToken ct = default) {

    await using var conn = _db.CreateConnection();

    // 1. Delete existing perspective data
    await conn.ExecuteAsync($"TRUNCATE TABLE {GetPerspectiveTableName(perspectiveName)}");

    // 2. Reset checkpoints
    await conn.ExecuteAsync(
        "DELETE FROM wh_perspective_checkpoints WHERE perspective_name = @PerspectiveName",
        new { PerspectiveName = perspectiveName }
    );

    // 3. Read all events (global sequence)
    var events = await conn.QueryAsync<StoredEvent>(
        "SELECT * FROM wh_events ORDER BY global_sequence",
        cancellationToken: ct
    );

    // 4. Resolve perspective handler
    var perspective = ResolvePerspective(perspectiveName);

    // 5. Replay ALL events
    foreach (var storedEvent in events) {
        var @event = DeserializeEvent(storedEvent);

        // Check if perspective handles this event type
        if (CanHandle(perspective, @event)) {
            await perspective.UpdateAsync(@event, ct);

            // Update checkpoint
            await conn.ExecuteAsync(
                """
                INSERT INTO wh_perspective_checkpoints (
                    stream_id, perspective_name, last_event_id, last_sequence_number, status, updated_at
                ) VALUES (
                    @StreamId, @PerspectiveName, @EventId, @SequenceNumber, 'UpToDate', NOW()
                )
                ON CONFLICT (stream_id, perspective_name) DO UPDATE SET
                    last_event_id = EXCLUDED.last_event_id,
                    last_sequence_number = EXCLUDED.last_sequence_number,
                    status = EXCLUDED.status,
                    updated_at = EXCLUDED.updated_at
                """,
                new {
                    StreamId = storedEvent.StreamId,
                    PerspectiveName = perspectiveName,
                    EventId = storedEvent.EventId,
                    SequenceNumber = storedEvent.SequenceNumber
                },
                cancellationToken: ct
            );
        }
    }
}
```

---

## Snapshots (Performance Optimization)

**Problem**: Replaying 10,000 events to rebuild an aggregate is slow.

**Solution**: Store periodic snapshots of aggregate state.

### Snapshot Schema

```sql
CREATE TABLE wh_snapshots (
    stream_id UUID NOT NULL,
    snapshot_type VARCHAR(200) NOT NULL,  -- Aggregate type
    snapshot_data JSONB NOT NULL,
    sequence_number BIGINT NOT NULL,      -- Last event included in snapshot
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (stream_id, sequence_number)
);

CREATE INDEX idx_snapshots_stream_id ON wh_snapshots (stream_id, sequence_number DESC);
```

### Snapshot Creation

```csharp
public async Task CreateSnapshotAsync(
    Guid streamId,
    string snapshotType,
    object snapshot,
    long sequenceNumber,
    CancellationToken ct = default) {

    await using var conn = _db.CreateConnection();

    await conn.ExecuteAsync(
        """
        INSERT INTO wh_snapshots (
            stream_id, snapshot_type, snapshot_data, sequence_number, created_at
        ) VALUES (
            @StreamId, @SnapshotType, @SnapshotData::jsonb, @SequenceNumber, NOW()
        )
        """,
        new {
            StreamId = streamId,
            SnapshotType = snapshotType,
            SnapshotData = JsonSerializer.Serialize(snapshot),
            SequenceNumber = sequenceNumber
        },
        cancellationToken: ct
    );
}
```

### Snapshot-Based Replay

```csharp
public async Task<Order> RehydrateOrderAsync(
    Guid orderId,
    CancellationToken ct = default) {

    await using var conn = _db.CreateConnection();

    // 1. Get latest snapshot
    var snapshot = await conn.QuerySingleOrDefaultAsync<StoredSnapshot>(
        """
        SELECT * FROM wh_snapshots
        WHERE stream_id = @StreamId
        ORDER BY sequence_number DESC
        LIMIT 1
        """,
        new { StreamId = orderId }
    );

    Order order;
    long fromSequence;

    if (snapshot is not null) {
        // Deserialize snapshot
        order = JsonSerializer.Deserialize<Order>(snapshot.SnapshotData)!;
        fromSequence = snapshot.SequenceNumber + 1;
    } else {
        // No snapshot, start from beginning
        order = new Order();
        fromSequence = 1;
    }

    // 2. Read events after snapshot
    var events = await conn.QueryAsync<StoredEvent>(
        """
        SELECT * FROM wh_events
        WHERE stream_id = @StreamId
          AND sequence_number >= @FromSequence
        ORDER BY sequence_number
        """,
        new { StreamId = orderId, FromSequence = fromSequence },
        cancellationToken: ct
    );

    // 3. Apply remaining events
    foreach (var storedEvent in events) {
        var @event = DeserializeEvent(storedEvent);
        order.Apply(@event);  // Aggregate applies event to mutate state
    }

    return order;
}
```

**Snapshot Strategy**:
- Create snapshot every N events (e.g., every 100 events)
- Keep last 3 snapshots (delete older ones)
- Balance: More snapshots = faster replay, more storage

---

## Temporal Queries (Time Travel)

### Query State at Specific Time

```csharp
public async Task<Order> GetOrderAsOfAsync(
    Guid orderId,
    DateTimeOffset asOfTime,
    CancellationToken ct = default) {

    await using var conn = _db.CreateConnection();

    // Read events up to specific time
    var events = await conn.QueryAsync<StoredEvent>(
        """
        SELECT * FROM wh_events
        WHERE stream_id = @StreamId
          AND timestamp <= @AsOfTime
        ORDER BY sequence_number
        """,
        new { StreamId = orderId, AsOfTime = asOfTime },
        cancellationToken: ct
    );

    // Rebuild aggregate state from events
    var order = new Order();

    foreach (var storedEvent in events) {
        var @event = DeserializeEvent(storedEvent);
        order.Apply(@event);
    }

    return order;
}
```

### Perspective Projection at Specific Time

```csharp
public async Task RebuildPerspectiveAsOfAsync(
    string perspectiveName,
    DateTimeOffset asOfTime,
    CancellationToken ct = default) {

    await using var conn = _db.CreateConnection();

    // 1. Truncate perspective table
    await conn.ExecuteAsync($"TRUNCATE TABLE {GetPerspectiveTableName(perspectiveName)}");

    // 2. Read events up to specific time
    var events = await conn.QueryAsync<StoredEvent>(
        """
        SELECT * FROM wh_events
        WHERE timestamp <= @AsOfTime
        ORDER BY global_sequence
        """,
        new { AsOfTime = asOfTime },
        cancellationToken: ct
    );

    // 3. Replay events
    var perspective = ResolvePerspective(perspectiveName);

    foreach (var storedEvent in events) {
        var @event = DeserializeEvent(storedEvent);

        if (CanHandle(perspective, @event)) {
            await perspective.UpdateAsync(@event, ct);
        }
    }
}
```

**Use Cases**:
- **Debugging**: "What did the order look like when the bug occurred?"
- **Compliance**: "Show me customer data as of December 31st for audit"
- **Analytics**: "How many active customers did we have at the end of Q3?"

---

## Event Versioning

### Problem: Event Schema Changes

```csharp
// Version 1
public record OrderCreatedV1(
    Guid OrderId,
    Guid CustomerId,
    decimal Total
);

// Version 2 (added new field)
public record OrderCreatedV2(
    Guid OrderId,
    Guid CustomerId,
    decimal Total,
    string Currency  // ← New field!
);
```

### Strategy 1: Upcasting

```csharp
public class EventUpcast {
    public object Upcast(StoredEvent storedEvent) {
        return storedEvent.EventType switch {
            "OrderCreatedV1" => UpcastV1ToV2(storedEvent),
            "OrderCreatedV2" => JsonSerializer.Deserialize<OrderCreatedV2>(storedEvent.EventData),
            _ => throw new UnknownEventTypeException(storedEvent.EventType)
        };
    }

    private OrderCreatedV2 UpcastV1ToV2(StoredEvent storedEvent) {
        var v1 = JsonSerializer.Deserialize<OrderCreatedV1>(storedEvent.EventData)!;

        return new OrderCreatedV2(
            OrderId: v1.OrderId,
            CustomerId: v1.CustomerId,
            Total: v1.Total,
            Currency: "USD"  // ← Default value for missing field
        );
    }
}
```

### Strategy 2: Copy-and-Transform (Migration)

```sql
-- Add new event type with transformed data
INSERT INTO wh_events (
    event_id, stream_id, stream_type, event_type, event_data, event_metadata, sequence_number, timestamp
)
SELECT
    uuid_generate_v7(),
    stream_id,
    stream_type,
    'OrderCreatedV2',  -- New event type
    jsonb_set(event_data, '{Currency}', '"USD"'),  -- Add default Currency
    event_metadata,
    sequence_number,
    timestamp
FROM wh_events
WHERE event_type = 'OrderCreatedV1';

-- Delete old events (after verification!)
-- DELETE FROM wh_events WHERE event_type = 'OrderCreatedV1';
```

---

## Event Store Performance

### Partitioning by Stream Type

```sql
CREATE TABLE wh_events (
    event_id UUID PRIMARY KEY,
    stream_id UUID NOT NULL,
    stream_type VARCHAR(200) NOT NULL,
    -- ... other columns
) PARTITION BY LIST (stream_type);

-- Create partitions per stream type
CREATE TABLE wh_events_orders PARTITION OF wh_events
FOR VALUES IN ('Order');

CREATE TABLE wh_events_customers PARTITION OF wh_events
FOR VALUES IN ('Customer');

CREATE TABLE wh_events_products PARTITION OF wh_events
FOR VALUES IN ('Product');
```

**Benefit**: Queries filtered by `stream_type` only scan relevant partition.

### Partitioning by Time Range

```sql
CREATE TABLE wh_events (
    event_id UUID PRIMARY KEY,
    stream_id UUID NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    -- ... other columns
) PARTITION BY RANGE (timestamp);

-- Monthly partitions
CREATE TABLE wh_events_2024_12 PARTITION OF wh_events
FOR VALUES FROM ('2024-12-01') TO ('2025-01-01');

CREATE TABLE wh_events_2025_01 PARTITION OF wh_events
FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
```

**Benefit**: Time-based queries automatically prune old partitions.

### Archiving Old Events

```sql
-- Archive events older than 1 year
INSERT INTO wh_events_archive
SELECT * FROM wh_events
WHERE timestamp < NOW() - INTERVAL '1 year';

-- Delete from main table
DELETE FROM wh_events
WHERE timestamp < NOW() - INTERVAL '1 year';
```

---

## Best Practices

### DO ✅

- ✅ **Append-only** - Never update or delete events
- ✅ **Use UUIDv7** for event_id (time-ordered)
- ✅ **Sequence numbers** within streams (1, 2, 3, ...)
- ✅ **Global sequence** for cross-stream ordering
- ✅ **JSONB** for event_data (flexible, queryable)
- ✅ **Snapshots** for long streams (> 100 events)
- ✅ **Upcasting** for event versioning
- ✅ **Partition** by stream_type or timestamp for large stores
- ✅ **Archive** old events (> 1 year)
- ✅ **Checkpoint-based replay** for perspectives

### DON'T ❌

- ❌ Update events (immutable!)
- ❌ Delete events (append-only!)
- ❌ Use random UUIDs (index fragmentation)
- ❌ Skip sequence numbers (breaks ordering)
- ❌ Store large BLOBs in events (use object storage, store URL)
- ❌ Replay without snapshots (slow!)
- ❌ Break event schemas (upcast instead)
- ❌ Query events for current state (use perspectives/lenses)

---

## Common Patterns

### Pattern 1: Event-Sourced Aggregate

```csharp
public class Order {
    public Guid Id { get; private set; }
    public string Status { get; private set; } = "Created";
    public decimal Total { get; private set; }

    private readonly List<object> _uncommittedEvents = new();

    public IReadOnlyList<object> GetUncommittedEvents() => _uncommittedEvents.AsReadOnly();

    public void ClearUncommittedEvents() => _uncommittedEvents.Clear();

    // Apply event to mutate state
    public void Apply(object @event) {
        switch (@event) {
            case OrderCreated e:
                Id = e.OrderId;
                Status = "Created";
                Total = e.Total;
                break;

            case OrderShipped e:
                Status = "Shipped";
                break;

            default:
                throw new UnknownEventException(@event.GetType().Name);
        }
    }

    // Business logic produces events
    public void Ship() {
        if (Status != "Created") {
            throw new InvalidOperationException("Can only ship created orders");
        }

        var @event = new OrderShipped(Id, DateTimeOffset.UtcNow);

        Apply(@event);  // Mutate state
        _uncommittedEvents.Add(@event);  // Track for persistence
    }
}
```

### Pattern 2: Repository with Event Store

```csharp
public class OrderRepository(IEventStore eventStore) {
    public async Task<Order> GetByIdAsync(Guid orderId, CancellationToken ct = default) {
        var events = await eventStore.ReadStreamAsync(orderId, ct);

        var order = new Order();

        foreach (var @event in events) {
            order.Apply(@event);
        }

        return order;
    }

    public async Task SaveAsync(Order order, CancellationToken ct = default) {
        var uncommittedEvents = order.GetUncommittedEvents();

        foreach (var @event in uncommittedEvents) {
            // Simple pattern - stream ID and event only
            await eventStore.AppendAsync(order.Id, @event, ct);
        }

        order.ClearUncommittedEvents();
    }
}
```

---

## Further Reading

**Workers**:
- [Perspective Worker](../workers/perspective-worker.md) - Checkpoint processing lifecycle and runtime behavior
- [Execution Lifecycle](../workers/execution-lifecycle.md) - Startup/shutdown coordination

**Core Concepts**:
- [Perspectives](../core-concepts/perspectives.md) - Event-driven read models
- [Observability](../core-concepts/observability.md) - Message hops and tracing

**Data Access**:
- [Dapper Integration](dapper-integration.md) - Lightweight data access
- [EF Core Integration](efcore-integration.md) - Full-featured ORM
- [Perspectives Storage](perspectives-storage.md) - Read model schema design

**Messaging**:
- [Outbox Pattern](../messaging/outbox-pattern.md) - Reliable event publishing
- [Work Coordinator](../messaging/work-coordinator.md) - Atomic batch processing

**Examples**:
- [ECommerce: Event Sourcing](../examples/ecommerce/event-sourcing.md) - Real-world event store usage

---

*Version 0.1.0 - Foundation Release | Last Updated: 2025-12-21*
