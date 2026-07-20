---
title: Event Store
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Data Access
order: 4
description: >-
  Event sourcing and stream storage - event streams, replay, checkpoints,
  snapshots, and temporal queries
tags: >-
  event-sourcing, event-store, streams, replay, checkpoints, snapshots,
  postgresql
codeReferences:
  - src/Whizbang.Core/Messaging/IEventStore.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Data.Schema/Schemas/EventStoreSchema.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreEventStore.cs
testReferences:
  - tests/Whizbang.Core.Tests/Messaging/InMemoryEventStoreTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreEventStoreTests.cs
  - tests/Whizbang.Data.Schema.Tests/Schemas/EventStoreSchemaTests.cs
lastMaintainedCommit: '01f07906'
---

# Event Store

The **Event Store** is the append-only log of all domain events in your system. It provides event sourcing capabilities, stream-based processing, and time-travel queries for rebuilding read models from any point in history.

## Event Sourcing Fundamentals

**Event Sourcing** stores state changes as a sequence of events rather than current state:

```mermaid{caption="Event sourcing keeps the full event history (OrderCreated → OrderPaid → OrderShipped) rather than only the current-state row that traditional table storage keeps."}
flowchart RL
    subgraph EventSourcing["Event Sourcing"]
        Stream["Event Stream<br/>OrderCreated<br/>OrderPaid<br/>OrderShipped<br/>(full history)"]
    end

    subgraph Traditional["Traditional State Storage"]
        Table["Order Table<br/>order_id: abc<br/>status: Shipped<br/>total: $100<br/>(current state)"]
    end

    Stream --> Table
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

```sql{title="Core Tables" description="Core Tables" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "Sql", "Core", "Tables"]}
-- Event stream (append-only). DDL is generated from the C# schema definition
-- (EventStoreSchema) by EnsureWhizbangDatabaseInitializedAsync().
CREATE TABLE IF NOT EXISTS wh_event_store (
    event_id UUID PRIMARY KEY,                -- UUIDv7 (time-ordered), assigned client-side
    stream_id UUID NOT NULL,                  -- Stream identifier
    aggregate_id UUID NOT NULL,               -- Aggregate/entity ID
    aggregate_type VARCHAR(500) NOT NULL,     -- 'Order', 'Customer', etc.

    event_type VARCHAR(500) NOT NULL,         -- 'OrderCreatedEvent', etc.
    event_data JSONB NOT NULL,                -- Event payload
    metadata JSONB NOT NULL,                  -- Envelope context (hops, correlation)
    scope JSONB,                              -- Security/tenant scope

    version INTEGER NOT NULL,                 -- Position in stream (1, 2, 3, ...)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    flags INTEGER NOT NULL DEFAULT 0          -- EventFlags bitmask (collective/composite)
);

-- Indexes (unique per-stream and per-aggregate versions)
CREATE UNIQUE INDEX idx_event_store_stream ON wh_event_store (stream_id, version);
CREATE UNIQUE INDEX idx_event_store_aggregate ON wh_event_store (aggregate_id, version);
CREATE INDEX idx_event_store_aggregate_type ON wh_event_store (aggregate_type, created_at);
```

**Key Design Decisions**:
- **UUIDv7** for `event_id`: Time-ordered, insert-friendly - reads order by `event_id` directly
- **version**: Position within a single stream (1, 2, 3, ...), enforced by a unique index
- **commit_sequence** (added by migration `046_CommitSequenceSchema`): global commit ordering, stamped asynchronously after commit for deterministic cross-stream/cross-service ordering
- **JSONB** for `event_data`/`metadata`/`scope`: Flexible schema, queryable
- **aggregate_type**: Query/filter by aggregate type (Order, Customer, Product, etc.)

---

### Event Processing Tracking

```sql{title="Event Processing Tracking" description="Event Processing Tracking" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "Sql", "Event", "Processing", "Tracking"]}
-- Receptor processing (log-style tracking with lease-based claiming)
CREATE TABLE IF NOT EXISTS wh_receptor_processing (
    id UUID PRIMARY KEY,
    event_id UUID NOT NULL,
    receptor_name VARCHAR(500) NOT NULL,
    stream_id UUID,
    partition_number INTEGER,
    status VARCHAR(50) NOT NULL,        -- 'Pending', 'Processing', 'Completed', 'Failed'
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    instance_id UUID,                   -- Claiming service instance
    lease_expiry TIMESTAMPTZ,           -- Lease-based work claiming
    started_at TIMESTAMPTZ,
    claimed_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    processed_at TIMESTAMPTZ
);

-- Perspective cursors (stream-based projection tracking)
CREATE TABLE IF NOT EXISTS wh_perspective_cursors (
    stream_id UUID NOT NULL,
    perspective_name VARCHAR(500) NOT NULL,
    last_event_id UUID NOT NULL,        -- Cursor: last processed event (UUIDv7-ordered)
    status VARCHAR(50) NOT NULL,
    processed_at TIMESTAMPTZ,
    error TEXT,

    -- Rewind support (late-arriving events)
    rewind_trigger_event_id UUID,
    rewind_flagged_at TIMESTAMPTZ,
    rewind_first_flagged_at TIMESTAMPTZ,

    -- Per-stream lock (used during rebuild/rewind)
    stream_lock_instance_id UUID,
    stream_lock_expiry TIMESTAMPTZ,
    stream_lock_reason VARCHAR(100),

    PRIMARY KEY (stream_id, perspective_name)
);
```

**Design Differences**:

| Aspect | Receptors (wh_receptor_processing) | Perspectives (wh_perspective_cursors) |
|--------|-------------------------------------|------------------------------------------|
| **Tracking** | Per event + receptor (log-style) | Per stream + perspective (cursor-style) |
| **Ordering** | No ordering (parallel) | Ordered within stream (by UUIDv7 event_id) |
| **Use Case** | Side effects, notifications | Read model projections |
| **Replay** | Re-process individual events | Advance/rewind the stream cursor |

---

## Appending Events

### Simple Event Storage (Recommended)

The simplest way to append events is to pass just the stream ID and event. Whizbang automatically captures tracing context from the `IEnvelopeRegistry`:

```csharp{title="Simple Event Storage (Recommended)" description="The simplest way to append events is to pass just the stream ID and event." category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Event", "Storage", "Recommended"] tests=["InMemoryEventStoreTests.AppendAsync_WithMessage_ShouldStoreEventAsync", "InMemoryEventStoreTests.AppendAsync_WithMessage_WhenEnvelopeRegistered_ShouldUseEnvelopeAsync", "InMemoryEventStoreTests.AppendAsync_WithMessage_WhenNoEnvelope_ShouldCreateMinimalEnvelopeAsync", "EFCoreEventStoreTests.AppendAsync_WithRawMessage_CreatesEnvelopeAndAppendsAsync"]}
public class OrderReceptor(IEventStore eventStore) : IReceptor<CreateOrder, OrderCreated> {
    public async ValueTask<OrderCreated> HandleAsync(
        CreateOrder command,
        CancellationToken ct = default) {

        Guid orderId = TrackedGuid.NewMedo();  // time-ordered UUIDv7

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

```csharp{title="Full Control with Envelope" description="For advanced scenarios where you need full control over the envelope:" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Full", "Control", "Envelope"] tests=["EFCoreEventStoreTests.AppendAsync_WithValidEnvelope_AppendsEventToStreamAsync"]}
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

### Batch Appends

When one wire message fans out into many inner events (composite events), use `AppendBatchAsync` so backends can bulk-insert in one round trip:

```csharp{title="Batch Appends" description="Append a batch of envelopes in a single operation:" category="Implementation" difficulty="ADVANCED" tags=["Data", "C#", "Batch", "Appends"] unverified="AppendBatchAsync is verified by EventStoreAppendBatchTests, which is outside the current coverage map"}
await eventStore.AppendBatchAsync(
    [
        (orderId, envelope1),
        (orderId, envelope2),
        (otherStreamId, envelope3)
    ],
    ct
);
```

Entries land in the supplied order. The default implementation loops over `AppendAsync`; the EF Core Postgres backend can bulk-insert.

### The IEventStore Surface

```csharp{title="The IEventStore Surface" description="Key members of the IEventStore interface:" category="Implementation" difficulty="ADVANCED" tags=["Data", "C#", "IEventStore", "Interface"] tests=["InMemoryEventStoreTests.AppendAsync_WithMessage_ShouldStoreEventAsync", "EFCoreEventStoreTests.ReadAsync_WithExistingEvents_ReturnsEventsInSequenceOrderAsync", "InMemoryEventStoreTests.ReadPolymorphicAsync_WithMatchingEventType_ShouldReturnEventsAsync", "EFCoreEventStoreTests.GetEventsBetweenPolymorphicAsync_WithMixedEventTypes_ReturnsAllEventsAsync", "EFCoreEventStoreTests.GetLastSequenceAsync_WithExistingEvents_ReturnsHighestSequenceAsync"]}
public interface IEventStore {
    // Appending
    Task AppendAsync<TMessage>(Guid streamId, MessageEnvelope<TMessage> envelope, CancellationToken ct = default);
    Task AppendAsync<TMessage>(Guid streamId, TMessage message, CancellationToken ct = default) where TMessage : notnull;
    Task AppendBatchAsync<TMessage>(IReadOnlyList<(Guid streamId, MessageEnvelope<TMessage> envelope)> entries, CancellationToken ct = default);

    // Reading (async streams, ordered by sequence / UUIDv7 event id)
    IAsyncEnumerable<MessageEnvelope<TMessage>> ReadAsync<TMessage>(Guid streamId, long fromSequence, CancellationToken ct = default);
    IAsyncEnumerable<MessageEnvelope<TMessage>> ReadAsync<TMessage>(Guid streamId, Guid? fromEventId, CancellationToken ct = default);
    IAsyncEnumerable<MessageEnvelope<IEvent>> ReadPolymorphicAsync(Guid streamId, Guid? fromEventId, IReadOnlyList<Type> eventTypes, CancellationToken ct = default);

    // Checkpoint-range reads (used by lifecycle receptors)
    Task<List<MessageEnvelope<TMessage>>> GetEventsBetweenAsync<TMessage>(Guid streamId, Guid? afterEventId, Guid upToEventId, CancellationToken ct = default);
    Task<List<MessageEnvelope<IEvent>>> GetEventsBetweenPolymorphicAsync(Guid streamId, Guid? afterEventId, Guid upToEventId, IReadOnlyList<Type> eventTypes, CancellationToken ct = default);

    // Positions
    Task<long> GetLastSequenceAsync(Guid streamId, CancellationToken ct = default);      // -1 if empty
    Task<long?> GetCommitSequenceAsync(Guid eventId, CancellationToken ct = default);    // null until stamped

    // Synchronous verification (request-response over event sourcing)
    Task<SyncResult> AppendAndWaitAsync<TMessage, TPerspective>(Guid streamId, TMessage message, TimeSpan? timeout = null, /* callbacks */ CancellationToken ct = default) where TMessage : notnull where TPerspective : class;
    Task<SyncResult> AppendAndWaitAsync<TMessage>(Guid streamId, TMessage message, TimeSpan? timeout = null, /* callbacks */ CancellationToken ct = default) where TMessage : notnull;
}
```

### Concurrency and Sequencing

You never pass an expected version. Sequencing and conflict handling are built in:

- Each append assigns the next `version` for the stream (via the store's sequence provider)
- The **unique index on `(stream_id, version)`** rejects concurrent writers that race to the same slot
- The Postgres backends **retry with backoff** on unique-violation conflicts until the append lands (or max retries is exceeded under extreme contention)
- Use `GetLastSequenceAsync(streamId)` if you need the current stream position (for example, to detect concurrent modification at the application level)

---

## Reading Event Streams

### Read Full Stream

```csharp{title="Read Full Stream" description="Read Full Stream" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Read", "Full", "Stream"] tests=["EFCoreEventStoreTests.ReadAsync_WithExistingEvents_ReturnsEventsInSequenceOrderAsync"]}
// Strongly-typed read from the beginning (sequence 0), in order
await foreach (var envelope in eventStore.ReadAsync<OrderCreated>(orderId, fromSequence: 0, ct)) {
    Console.WriteLine($"{envelope.MessageId}: {envelope.Payload}");
}
```

### Read Stream from a Checkpoint

```csharp{title="Read Stream from a Checkpoint" description="Read Stream from a Checkpoint" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Read", "Stream", "Checkpoint"] tests=["InMemoryEventStoreTests.ReadAsync_ByEventId_WithSpecificEventId_ShouldReturnEventsAfterItAsync", "EFCoreEventStoreTests.ReadAsync_ByEventId_WithFromEventId_ReturnsEventsAfterIdAsync"]}
// Events are UUIDv7-ordered - read everything after the last processed event id
Guid? lastProcessedEventId = /* from your cursor */;

await foreach (var envelope in eventStore.ReadAsync<OrderCreated>(orderId, lastProcessedEventId, ct)) {
    // process...
}
```

### Read Mixed Event Types (Polymorphic)

```csharp{title="Read Mixed Event Types (Polymorphic)" description="Read Mixed Event Types (Polymorphic)" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Read", "Polymorphic", "Events"] tests=["InMemoryEventStoreTests.ReadPolymorphicAsync_WithMatchingEventType_ShouldReturnEventsAsync", "EFCoreEventStoreTests.ReadPolymorphicAsync_WithUnknownEventType_SkipsUnknownEventsAsync"]}
// Deserializes each row to its concrete type via the event_type column.
// All event types must be listed for AOT compatibility.
IReadOnlyList<Type> eventTypes = [typeof(OrderCreated), typeof(OrderShipped), typeof(OrderCancelled)];

await foreach (var envelope in eventStore.ReadPolymorphicAsync(orderId, fromEventId: null, eventTypes, ct)) {
    switch (envelope.Payload) {
        case OrderCreated created: /* ... */ break;
        case OrderShipped shipped: /* ... */ break;
    }
}
```

### Read a Checkpoint Range

```csharp{title="Read a Checkpoint Range" description="Read events between two checkpoints (exclusive start, inclusive end):" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Read", "Range", "Events"] tests=["EFCoreEventStoreTests.GetEventsBetweenPolymorphicAsync_WithMixedEventTypes_ReturnsAllEventsAsync", "InMemoryEventStoreTests.GetEventsBetweenPolymorphicAsync_WithAfterEventId_ShouldFilterEventsAsync", "EFCoreEventStoreTests.GetEventsBetweenPolymorphicAsync_NullAfterEventId_ReturnsFromStartAsync"]}
// Used by lifecycle receptors at PostPerspective stages to load exactly
// the events a perspective just processed.
var events = await eventStore.GetEventsBetweenPolymorphicAsync(
    orderId,
    afterEventId: previousCheckpoint,   // exclusive; null = from beginning
    upToEventId: newCheckpoint,         // inclusive
    eventTypes,
    ct
);
```

---

## Rebuilding Perspectives from Events

Perspective replay is **built into the framework** — you do not write replay loops yourself. The `PerspectiveWorker` drives perspectives forward, and `wh_perspective_cursors` tracks progress per `(stream_id, perspective_name)`.

### How Cursor-Based Processing Works

1. Events land in `wh_event_store` (and matching rows in `wh_perspective_events` route work to perspectives)
2. The `PerspectiveWorker` claims a stream, reads events after the cursor's `last_event_id` (UUIDv7-ordered), and applies your pure `Apply` methods
3. The resulting model is upserted into the perspective's `wh_per_*` table and the cursor advances — atomically
4. **Late-arriving events** flag the cursor for rewind (`rewind_trigger_event_id`); the worker rewinds from the nearest snapshot and replays forward

### Rebuild Modes

Full and selective rebuilds (Blue-Green, In-Place, Selected Streams) are covered in [Perspective Rebuild](../fundamentals/perspectives/rebuild.md). Conceptually a rebuild:

1. Locks the affected streams (`stream_lock_*` columns on `wh_perspective_cursors`)
2. Resets the cursor(s) and clears or shadows the `wh_per_*` rows
3. Replays events through the same pure `Apply` functions the live path uses
4. Swaps/unlocks when the rebuilt model catches up

Because perspectives are **pure functions**, replaying the same events always produces the same model — there is no separate "rebuild codepath" to keep in sync.

---

## Snapshots (Performance Optimization)

**Problem**: Rewinding a perspective after a late-arriving event would mean replaying the stream from event zero.

**Solution**: Whizbang stores **perspective snapshots** — periodic captures of a perspective's model state — so rewinds replay only from the nearest snapshot.

### Snapshot Schema

```sql{title="Snapshot Schema" description="Snapshot Schema (generated from PerspectiveSnapshotsSchema)" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "Sql", "Snapshot", "Schema"]}
CREATE TABLE IF NOT EXISTS wh_perspective_snapshots (
    stream_id UUID NOT NULL,
    perspective_name VARCHAR(500) NOT NULL,
    snapshot_event_id UUID NOT NULL,       -- Event this snapshot was taken at
    snapshot_data JSONB NOT NULL,          -- Full model state
    sequence_number BIGINT NOT NULL,       -- Stream position at snapshot time
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    snapshot_commit_sequence BIGINT,       -- commit_sequence anchor (nullable)

    PRIMARY KEY (stream_id, perspective_name, snapshot_event_id)
);

CREATE INDEX idx_perspective_snapshots_lookup
    ON wh_perspective_snapshots (stream_id, perspective_name, sequence_number);
```

### How Snapshot-Based Rewind Works

1. Perspective runners periodically write a snapshot of the current model (with the event id and `commit_sequence` it corresponds to, resolved via `IEventStore.GetCommitSequenceAsync`)
2. When a late-arriving event flags a cursor for rewind, the worker locates the nearest snapshot **before** the late event
3. The model is restored from `snapshot_data` and events after the snapshot are replayed through the pure `Apply` functions
4. The cursor advances normally from there

**Snapshot Strategy**:
- Snapshots are per `(stream_id, perspective_name)` — each perspective rewinds independently
- More frequent snapshots = shorter rewinds, more storage
- Because `Apply` is pure, restoring a snapshot + replaying the tail is always equivalent to a full replay

---

## Temporal Queries (Time Travel)

### Query State at Specific Time

Because `event_id` is a UUIDv7, time-based cutoffs map naturally onto event ids. Read the stream and stop at the cutoff:

```csharp{title="Query State at Specific Time" description="Query State at Specific Time" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Query", "State", "Specific"] unverified="application-composed temporal query — the underlying ReadPolymorphicAsync read is verified above; the hop-timestamp cutoff and Apply loop are application logic"}
public async Task<OrderSummary> GetOrderAsOfAsync(
    IEventStore eventStore,
    Guid orderId,
    DateTimeOffset asOfTime,
    CancellationToken ct = default) {

    var perspective = new OrderSummaryPerspective();
    var model = new OrderSummary();

    IReadOnlyList<Type> eventTypes = [typeof(OrderCreated), typeof(OrderShipped)];

    await foreach (var envelope in eventStore.ReadPolymorphicAsync(orderId, null, eventTypes, ct)) {
        // Stop once we pass the cutoff (hop timestamps carry wall-clock time)
        if (envelope.Hops[0].Timestamp > asOfTime) {
            break;
        }

        model = envelope.Payload switch {
            OrderCreated e => perspective.Apply(model, e),
            OrderShipped e => perspective.Apply(model, e),
            _ => model
        };
    }

    return model;
}
```

For ad-hoc analysis you can also query `wh_event_store` directly - `created_at` records when each event was stored, and `version` orders events within a stream.

**Use Cases**:
- **Debugging**: "What did the order look like when the bug occurred?"
- **Compliance**: "Show me customer data as of December 31st for audit"
- **Analytics**: "How many active customers did we have at the end of Q3?"

---

## Event Versioning

:::planned
First-class event versioning (version attributes, an upcasting registry, and multi-version `Apply` support) is a planned framework feature. The patterns below work today as application code.
:::

### Problem: Event Schema Changes

```csharp{title="Problem: Event Schema Changes" description="Problem: Event Schema Changes" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Problem:", "Event", "Schema"] unverified="illustrative event-version record shapes with no behavior to assert — event versioning is a planned framework feature"}
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

```csharp{title="Strategy 1: Upcasting" description="Strategy 1: Upcasting" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Strategy", "Upcasting"] unverified="application-level upcasting pattern — event versioning is a planned framework feature, not yet verified by tests"}
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

```sql{title="Strategy 2: Transform-in-Place (Migration)" description="Strategy 2: Transform-in-Place (Migration)" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "Strategy", "Transform-in-Place", "Migration"]}
-- Rewrite stored payloads to the new shape (verify with a SELECT first!)
-- In-place UPDATE preserves event_id and the unique (stream_id, version) index.
UPDATE wh_event_store
SET event_type = 'OrderCreatedV2',
    event_data = jsonb_set(event_data, '{Currency}', '"USD"')  -- Add default Currency
WHERE event_type = 'OrderCreatedV1';
```

---

## Event Store Performance

The stock `wh_event_store` table is unpartitioned. For very large stores, standard PostgreSQL techniques apply (these are database-administration patterns, not framework features — validate them against your workload in isolation first):

### Partitioning by Aggregate Type

```sql{title="Partitioning by Aggregate Type" description="Partitioning by Aggregate Type" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "Sql", "Partitioning", "Aggregate", "Type"]}
CREATE TABLE event_store_partitioned (
    event_id UUID NOT NULL,
    stream_id UUID NOT NULL,
    aggregate_type VARCHAR(500) NOT NULL,
    -- ... remaining wh_event_store columns
) PARTITION BY LIST (aggregate_type);

CREATE TABLE event_store_orders PARTITION OF event_store_partitioned
FOR VALUES IN ('Order');

CREATE TABLE event_store_customers PARTITION OF event_store_partitioned
FOR VALUES IN ('Customer');
```

**Benefit**: Queries filtered by `aggregate_type` only scan the relevant partition.

### Partitioning by Time Range

```sql{title="Partitioning by Time Range" description="Partitioning by Time Range" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "Sql", "Partitioning", "Time", "Range"]}
CREATE TABLE event_store_partitioned (
    event_id UUID NOT NULL,
    stream_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    -- ... remaining wh_event_store columns
) PARTITION BY RANGE (created_at);

-- Monthly partitions
CREATE TABLE event_store_2026_06 PARTITION OF event_store_partitioned
FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE event_store_2026_07 PARTITION OF event_store_partitioned
FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
```

**Benefit**: Time-based queries automatically prune old partitions.

### Archiving Old Events

```sql{title="Archiving Old Events" description="Archiving Old Events" category="Implementation" difficulty="BEGINNER" tags=["Data", "Sql", "Archiving", "Old", "Events"]}
-- Archive events older than 1 year (verify replay/rewind windows first -
-- archived events are no longer available for perspective rewind)
INSERT INTO event_store_archive
SELECT * FROM wh_event_store
WHERE created_at < NOW() - INTERVAL '1 year';

DELETE FROM wh_event_store
WHERE created_at < NOW() - INTERVAL '1 year';
```

---

## Best Practices

### DO ✅

- ✅ **Append-only** - Never update or delete events
- ✅ **Use UUIDv7** (`TrackedGuid.NewMedo()`) for stream IDs - event ids are UUIDv7 automatically
- ✅ **Trust the built-in versioning** - `version` per stream is assigned and uniqueness-enforced by the store
- ✅ **Use commit_sequence** for deterministic cross-stream ordering (stamped asynchronously)
- ✅ **JSONB** for event_data (flexible, queryable)
- ✅ **Snapshots** happen automatically per perspective - tune cadence for long streams
- ✅ **Upcasting** for event versioning
- ✅ **Partition** by aggregate_type or created_at for very large stores
- ✅ **Archive** old events (> 1 year) once rewind windows allow
- ✅ **Cursor-based processing** for perspectives (built in via `wh_perspective_cursors`)

### DON'T ❌

- ❌ Update events (immutable!)
- ❌ Delete events (append-only!)
- ❌ Use random UUIDs (index fragmentation) - prefer `TrackedGuid.NewMedo()`
- ❌ Write your own replay loops (the `PerspectiveWorker` owns replay/rewind)
- ❌ Store large BLOBs in events (use object storage, store URL)
- ❌ Break event schemas (upcast instead)
- ❌ Query events for current state (use perspectives/lenses)

---

## Common Patterns

### Pattern 1: Event-Sourced Aggregate

```csharp{title="Pattern 1: Event-Sourced Aggregate" description="Pattern 1: Event-Sourced Aggregate" category="Implementation" difficulty="ADVANCED" tags=["Data", "Pattern", "Event-Sourced", "Aggregate"] unverified="application-level event-sourced aggregate pattern — not a framework API surface"}
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

```csharp{title="Pattern 2: Repository with Event Store" description="Pattern 2: Repository with Event Store" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Pattern", "Repository", "Event"] unverified="application-level repository pattern composing the verified ReadPolymorphicAsync + AppendAsync APIs"}
public class OrderRepository(IEventStore eventStore) {
    private static readonly IReadOnlyList<Type> EventTypes =
        [typeof(OrderCreated), typeof(OrderShipped)];

    public async Task<Order> GetByIdAsync(Guid orderId, CancellationToken ct = default) {
        var order = new Order();

        await foreach (var envelope in eventStore.ReadPolymorphicAsync(orderId, null, EventTypes, ct)) {
            order.Apply(envelope.Payload);
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
- [Perspective Worker](../operations/workers/perspective-worker.md) - Checkpoint processing lifecycle and runtime behavior
- [Execution Lifecycle](../operations/workers/execution-lifecycle.md) - Startup/shutdown coordination

**Core Concepts**:
- [Perspectives](../fundamentals/perspectives/perspectives.md) - Event-driven read models
- [Observability](../fundamentals/persistence/observability.md) - Message hops and tracing

**Data Access**:
- [Dapper Integration](dapper-integration.md) - Lightweight data access
- [EF Core Integration](efcore-integration.md) - Full-featured ORM
- [Perspectives Storage](perspectives-storage.md) - Read model schema design

**Messaging**:
- [Outbox Pattern](../messaging/outbox-pattern.md) - Reliable event publishing
- [Work Coordinator](../messaging/work-coordinator.md) - Atomic batch processing

**Examples**:
- ECommerce: Event Sourcing - Real-world event store usage

---

*Version 1.0.0 - Foundation Release | Last Updated: 2025-12-21*
