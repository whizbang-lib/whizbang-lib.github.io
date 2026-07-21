---
title: Event Store Migration
pageType: guide
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Migration Guide
order: 6
description: Migrating from Marten's event store to Whizbang's IEventStore
tags: 'migration, event-store, marten, events, streams'
codeReferences:
  - src/Whizbang.Core/Messaging/IEventStore.cs
  - src/Whizbang.Core/Messaging/InMemoryEventStore.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreEventStore.cs
testReferences:
  - tests/Whizbang.Core.Tests/Messaging/InMemoryEventStoreTests.cs
  - tests/Whizbang.Core.Tests/Messaging/EventStoreAppendBatchTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperPostgresEventStoreTests.cs
  - tests/Whizbang.Migrate.Tests/Transformers/EventStoreTransformerTests.cs
lastMaintainedCommit: '01f07906'
---

# Event Store Migration: Marten → Whizbang

This guide covers migrating from Marten's document store and event sourcing to Whizbang's `IEventStore`.

## Key Differences

| Aspect | Marten | Whizbang |
|--------|--------|----------|
| Session | `IDocumentSession` | Direct `IEventStore` injection |
| Append | `session.Events.Append()` | `eventStore.AppendAsync<T>()` |
| Save | `session.SaveChangesAsync()` | Implicit (per-append) |
| Stream ID | Inferred or explicit | Explicit parameter (or `[StreamId]` property) |
| Envelope | Automatic | Automatic (`MessageEnvelope<T>` created/retrieved for you) |
| Versioning | `ExpectedVersion` | Monotonic sequence numbers assigned per stream |

## Basic Event Store Operations

### Appending Events

**Marten**:

```csharp{title="Appending Events" description="Appending Events" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Appending", "Events"] unverified="other framework — migration before-state"}
public class OrderService {
    private readonly IDocumentStore _store;

    public async Task CreateOrderAsync(CreateOrderCommand cmd) {
        await using var session = _store.LightweightSession();

        var orderId = Guid.NewGuid();
        var @event = new OrderCreated(orderId, cmd.CustomerId, cmd.Items);

        session.Events.Append(orderId, @event);
        await session.SaveChangesAsync();
    }
}
```

**Whizbang**:

```csharp{title="Appending Events - CreateOrderReceptor" description="Appending Events - CreateOrderReceptor" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Appending", "Events", "CreateOrderReceptor"] tests=["InMemoryEventStoreTests.AppendAsync_WithMessage_ShouldStoreEventAsync", "InMemoryEventStoreTests.AppendAsync_WithMessage_WhenEnvelopeRegistered_ShouldUseEnvelopeAsync", "InMemoryEventStoreTests.AppendAsync_WithMessage_WhenNoEnvelope_ShouldCreateMinimalEnvelopeAsync"]}
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    private readonly IEventStore _eventStore;

    public CreateOrderReceptor(IEventStore eventStore) {
        _eventStore = eventStore;
    }

    public async ValueTask<OrderCreated> HandleAsync(
        CreateOrder message,
        CancellationToken ct = default) {

        Guid streamId = TrackedGuid.NewMedo();  // time-ordered UUIDv7
        var @event = new OrderCreated(streamId, message.CustomerId, message.Items);

        // The message overload creates the envelope for you. If the message was
        // dispatched through IDispatcher, its existing envelope is retrieved from
        // IEnvelopeRegistry so tracing context (hops, correlation, causation) is preserved.
        await _eventStore.AppendAsync(streamId, @event, ct);
        return @event;
    }
}
```

### Reading Events

**Marten**:

```csharp{title="Reading Events" description="Reading Events" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Reading", "Events"] unverified="other framework — migration before-state"}
public async Task<Order> RehydrateOrderAsync(Guid orderId) {
    await using var session = _store.QuerySession();

    var events = await session.Events
        .FetchStreamAsync(orderId);

    var order = new Order();
    foreach (var @event in events) {
        order.Apply(@event.Data);
    }
    return order;
}
```

**Whizbang**:

```csharp{title="Reading Events (2)" description="Reading Events" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Reading", "Events"] tests=["EventStoreContractTests.ReadAsync_ShouldReturnEventsInOrderAsync"]}
public async Task<Order> RehydrateOrderAsync(Guid orderId, CancellationToken ct) {
    var order = new Order();

    // ReadAsync returns IAsyncEnumerable<MessageEnvelope<T>> - no await on the call itself
    await foreach (var envelope in _eventStore.ReadAsync<IOrderEvent>(orderId, fromSequence: 0, ct)) {
        order.Apply(envelope.Payload);
    }
    return order;
}
```

### Multiple Events in One Append

**Marten**:

```csharp{title="Multiple Events in One Append" description="Multiple Events in One Append" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Multiple", "Events", "One"] unverified="other framework — migration before-state"}
await using var session = _store.LightweightSession();

session.Events.Append(orderId,
    new OrderCreated(orderId),
    new OrderItemAdded(orderId, item1),
    new OrderItemAdded(orderId, item2)
);

await session.SaveChangesAsync();
```

**Whizbang**:

```csharp{title="Multiple Events in One Append (2)" description="Multiple Events in One Append" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Multiple", "Events", "One"]}
// Append multiple events individually (ordered per stream)
await _eventStore.AppendAsync(orderId, new OrderCreated(orderId), ct);
await _eventStore.AppendAsync(orderId, new OrderItemAdded(orderId, item1), ct);
await _eventStore.AppendAsync(orderId, new OrderItemAdded(orderId, item2), ct);

// Or use AppendBatchAsync for bulk appends (single round-trip on
// backends that override it; entries land in the supplied order)
await _eventStore.AppendBatchAsync(
    new[] {
        (orderId, envelope1),
        (orderId, envelope2),
        (orderId, envelope3)
    },
    ct);
```

## Stream Management

### Starting a Stream

**Marten** (implicit stream creation):

```csharp{title="Starting a Stream" description="Marten (implicit stream creation):" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Starting", "Stream"] unverified="other framework — migration before-state"}
// Marten creates stream automatically
session.Events.Append(newStreamId, firstEvent);
```

**Whizbang** (explicit stream):

```csharp{title="Starting a Stream (2)" description="Whizbang (explicit stream):" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Starting", "Stream"] tests=["InMemoryEventStoreTests.AppendAsync_WithMessage_ShouldStoreEventAsync"]}
// Whizbang also creates the stream on first append
Guid streamId = TrackedGuid.NewMedo();  // UUIDv7 for time-ordering
await _eventStore.AppendAsync(streamId, firstEvent, ct);
```

### Checking Stream Existence

**Marten**:

```csharp{title="Checking Stream Existence" description="Checking Stream Existence" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Checking", "Stream", "Existence"] unverified="other framework — migration before-state"}
var state = await session.Events.FetchStreamStateAsync(streamId);
var exists = state != null;
```

**Whizbang**:

```csharp{title="Checking Stream Existence (2)" description="Checking Stream Existence" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Checking", "Stream", "Existence"] tests=["EventStoreContractTests.GetLastSequenceAsync_AfterAppends_ShouldReturnCorrectSequenceAsync", "EventStoreContractTests.GetLastSequenceAsync_EmptyStream_ShouldReturnMinusOneAsync"]}
// GetLastSequenceAsync returns the highest sequence number in the stream,
// or -1 when the stream doesn't exist or is empty
var lastSequence = await _eventStore.GetLastSequenceAsync(streamId, ct);
var exists = lastSequence >= 0;
```

## Concurrency Control

### Marten Expected Version

```csharp{title="Marten Expected Version" description="Marten Expected Version" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Marten", "Expected", "Version"] unverified="other framework — migration before-state"}
// Marten: Optimistic concurrency via expected version
session.Events.Append(orderId, expectedVersion: 5, newEvent);
await session.SaveChangesAsync();  // Throws if version != 5
```

### Whizbang Sequence-Based

```csharp{title="Whizbang Sequence-Based" description="Whizbang Sequence-Based" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-Guide", "Whizbang", "Sequence-Based"] tests=["EventStoreContractTests.GetLastSequenceAsync_AfterAppends_ShouldReturnCorrectSequenceAsync", "EventStoreContractTests.AppendAsync_ConcurrentAppends_ShouldBeThreadSafeAsync"]}
// Whizbang: Sequence-based concurrency
// Events get monotonic sequence numbers per stream, assigned at append time
// by the store's internal sequence provider - there is no expectedVersion parameter.

await _eventStore.AppendAsync(streamId, @event, ct);

// Concurrent appends to the same stream are resolved internally:
// the PostgreSQL stores retry on sequence conflicts with backoff and
// only surface an exception after exhausting the retry budget.
```

## Session Patterns

### Marten Unit of Work

```csharp{title="Marten Unit of Work" description="Marten Unit of Work" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Marten", "Unit", "Work"] unverified="other framework — migration before-state"}
// Marten: Batch multiple operations
await using var session = _store.LightweightSession();

session.Events.Append(order1Id, event1);
session.Events.Append(order2Id, event2);
session.Store(document);

await session.SaveChangesAsync();  // All-or-nothing
```

### Whizbang Batched Append

```csharp{title="Whizbang Batched Append" description="Whizbang Batched Append" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Whizbang", "Transactional"]}
// Whizbang: each AppendAsync commits independently - there is no session.
// For multi-event writes, use AppendBatchAsync. Entries land in the supplied
// order; backends MAY execute the batch in a single transaction (the default
// implementation loops serially and makes no atomicity guarantee).
await _eventStore.AppendBatchAsync(
    new[] {
        (order1Id, envelope1),
        (order2Id, envelope2)
    },
    ct);
```

> **Note**: In typical Whizbang applications, atomicity between business writes and event persistence is provided by the work coordinator (outbox pattern) rather than a user-managed transaction — see [Outbox Migration](07-outbox-migration.md).

## Query Patterns

### Marten Query Session

```csharp{title="Marten Query Session" description="Marten Query Session" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Marten", "Query", "Session"] unverified="other framework — migration before-state"}
// Marten: Query events directly
await using var session = _store.QuerySession();

var recentOrders = await session.Events
    .QueryRawEventDataOnly<OrderCreated>()
    .Where(e => e.Timestamp > cutoff)
    .ToListAsync();
```

### Whizbang Event Queries

```csharp{title="Whizbang Event Queries" description="Whizbang Event Queries" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Whizbang", "Event", "Queries"] tests=["InMemoryEventStoreTests.GetEventsBetweenAsync_NonExistentStream_ShouldReturnEmptyListAsync", "InMemoryEventStoreTests.ReadPolymorphicAsync_WithMatchingEventType_ShouldReturnEventsAsync"]}
// Whizbang: range queries are per stream, bounded by event IDs
// (afterEventId is exclusive; pass null to start from the beginning)
List<MessageEnvelope<OrderCreated>> events =
    await _eventStore.GetEventsBetweenAsync<OrderCreated>(
        streamId,
        afterEventId: lastCheckpointEventId,
        upToEventId: currentEventId,
        ct);

foreach (var envelope in events) {
    // Process event
}

// Cross-type reads for one stream use ReadPolymorphicAsync:
await foreach (var envelope in _eventStore.ReadPolymorphicAsync(
    streamId, fromEventId: null, eventTypes: new[] { typeof(OrderCreated), typeof(OrderShipped) }, ct)) {
    // envelope.Payload is IEvent
}
```

There is no cross-stream LINQ query surface on `IEventStore` — for query-shaped access, use a perspective + lens (see [Projection Migration](04-projection-migration.md)).

## Envelopes Are Created For You

You rarely construct `MessageEnvelope<T>` by hand. It has several `required` members (`MessageId`, `Payload`, `DispatchContext`, `Hops`) that the framework populates:

- **Dispatched messages**: `IDispatcher` creates the envelope and registers it with `IEnvelopeRegistry`.
- **Direct appends**: the `AppendAsync(streamId, message, ct)` overload looks up the message's existing envelope via `IEnvelopeRegistry` (preserving hops, correlation, and causation) or creates a minimal one if none exists.

```csharp{title="Envelope-Free Append" description="Let the framework manage envelopes:" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "MessageEnvelope", "Creation", "Helper"] tests=["InMemoryEventStoreTests.AppendAsync_WithMessage_ShouldStoreEventAsync", "InMemoryEventStoreTests.AppendAsync_WithMessage_WhenEnvelopeRegistered_ShouldUseEnvelopeAsync", "InMemoryEventStoreTests.AppendAsync_WithMessage_WhenNoEnvelope_ShouldCreateMinimalEnvelopeAsync"]}
// Preferred: append the message; envelope handling is automatic
await _eventStore.AppendAsync(streamId, orderCreatedEvent, ct);
```

The envelope-taking overload `AppendAsync(streamId, envelope, ct)` exists for advanced scenarios where you already hold a `MessageEnvelope<T>` (for example, relaying events received from a transport).

## Migration Checklist

- [ ] Replace `IDocumentStore` with `IEventStore`
- [ ] Replace `IDocumentSession` with direct `IEventStore` injection
- [ ] Replace `session.Events.Append()` with `eventStore.AppendAsync<T>()` (message overload — envelopes are automatic)
- [ ] Use `TrackedGuid.NewMedo()` for new stream IDs (time-ordered UUIDv7)
- [ ] Remove `session.SaveChangesAsync()` (each append commits; use `AppendBatchAsync` for bulk)
- [ ] Remove `expectedVersion` arguments (sequences are assigned automatically)
- [ ] Move cross-stream event queries to perspectives + lenses

---

*Previous: [Projection Migration](04-projection-migration.md) | Next: [Transport Configuration](06-transport-configuration.md)*
