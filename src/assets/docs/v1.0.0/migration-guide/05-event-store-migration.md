---
title: Event Store Migration
version: 1.0.0
category: Migration Guide
order: 6
description: Migrating from Marten's event store to Whizbang's IEventStore
tags: 'migration, event-store, marten, events, streams'
codeReferences:
  - src/Whizbang.Core/Messaging/IEventStore.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreEventStore.cs
---

# Event Store Migration: Marten → Whizbang

This guide covers migrating from Marten's document store and event sourcing to Whizbang's `IEventStore`.

## Key Differences

| Aspect | Marten | Whizbang |
|--------|--------|----------|
| Session | `IDocumentSession` | Direct `IEventStore` injection |
| Append | `session.Events.Append()` | `eventStore.AppendAsync<T>()` |
| Save | `session.SaveChangesAsync()` | Implicit (per-append) |
| Stream ID | Inferred or explicit | Always explicit |
| Envelope | Automatic | `MessageEnvelope<T>` |
| Versioning | `ExpectedVersion` | Sequence-based |

## Basic Event Store Operations

### Appending Events

**Marten**:

```csharp{title="Appending Events" description="Appending Events" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Appending", "Events"]}
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

```csharp{title="Appending Events - CreateOrderReceptor" description="Appending Events - CreateOrderReceptor" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Appending", "Events", "CreateOrderReceptor"]}
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    private readonly IEventStore _eventStore;

    public CreateOrderReceptor(IEventStore eventStore) {
        _eventStore = eventStore;
    }

    public async ValueTask<OrderCreated> HandleAsync(
        CreateOrder message,
        CancellationToken ct = default) {

        var streamId = Guid.CreateVersion7();
        var @event = new OrderCreated(streamId, message.CustomerId, message.Items);

        var envelope = new MessageEnvelope<OrderCreated> {
            MessageId = MessageId.From(Guid.CreateVersion7()),
            Payload = @event,
            Hops = new List<MessageHop> {
                MessageHop.Create(CorrelationId.From(Guid.CreateVersion7()))
            }
        };

        await _eventStore.AppendAsync(streamId, envelope, ct);
        return @event;
    }
}
```

### Reading Events

**Marten**:

```csharp{title="Reading Events" description="Reading Events" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Reading", "Events"]}
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

```csharp{title="Reading Events (2)" description="Reading Events" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Reading", "Events"]}
public async Task<Order> RehydrateOrderAsync(Guid orderId, CancellationToken ct) {
    var events = await _eventStore.ReadAsync<IOrderEvent>(
        orderId,
        fromSequence: 0,
        ct);

    var order = new Order();
    await foreach (var envelope in events) {
        order.Apply(envelope.Payload);
    }
    return order;
}
```

### Multiple Events in One Append

**Marten**:

```csharp{title="Multiple Events in One Append" description="Multiple Events in One Append" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Multiple", "Events", "One"]}
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
// Append multiple events individually
var events = new IOrderEvent[] {
    new OrderCreated(orderId),
    new OrderItemAdded(orderId, item1),
    new OrderItemAdded(orderId, item2)
};

foreach (var @event in events) {
    var envelope = CreateEnvelope(@event);
    await _eventStore.AppendAsync(orderId, envelope, ct);
}

// Or use batch append if available
await _eventStore.AppendManyAsync(orderId, envelopes, ct);
```

## Stream Management

### Starting a Stream

**Marten** (implicit stream creation):

```csharp{title="Starting a Stream" description="Marten (implicit stream creation):" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Starting", "Stream"]}
// Marten creates stream automatically
session.Events.Append(newStreamId, firstEvent);
```

**Whizbang** (explicit stream):

```csharp{title="Starting a Stream (2)" description="Whizbang (explicit stream):" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Starting", "Stream"]}
// Whizbang creates stream on first append
var streamId = Guid.CreateVersion7();  // Use UUIDv7 for time-ordering
var envelope = CreateEnvelope(firstEvent);
await _eventStore.AppendAsync(streamId, envelope, ct);
```

### Checking Stream Existence

**Marten**:

```csharp{title="Checking Stream Existence" description="Checking Stream Existence" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Checking", "Stream", "Existence"]}
var state = await session.Events.FetchStreamStateAsync(streamId);
var exists = state != null;
```

**Whizbang**:

```csharp{title="Checking Stream Existence (2)" description="Checking Stream Existence" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Checking", "Stream", "Existence"]}
var events = await _eventStore.ReadAsync<IEvent>(streamId, fromSequence: 0, ct);
var exists = await events.AnyAsync(ct);
```

## Concurrency Control

### Marten Expected Version

```csharp{title="Marten Expected Version" description="Marten Expected Version" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Marten", "Expected", "Version"]}
// Marten: Optimistic concurrency via expected version
session.Events.Append(orderId, expectedVersion: 5, newEvent);
await session.SaveChangesAsync();  // Throws if version != 5
```

### Whizbang Sequence-Based

```csharp{title="Whizbang Sequence-Based" description="Whizbang Sequence-Based" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-Guide", "Whizbang", "Sequence-Based"]}
// Whizbang: Sequence-based concurrency
// Events have monotonic sequence numbers per stream
// Concurrency handled at append time

var envelope = new MessageEnvelope<OrderUpdated> {
    MessageId = MessageId.From(Guid.CreateVersion7()),
    Payload = @event,
    // Sequence is assigned automatically
};

await _eventStore.AppendAsync(streamId, envelope, ct);
// Throws ConcurrencyException if sequence conflict
```

## Session Patterns

### Marten Unit of Work

```csharp{title="Marten Unit of Work" description="Marten Unit of Work" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Marten", "Unit", "Work"]}
// Marten: Batch multiple operations
await using var session = _store.LightweightSession();

session.Events.Append(order1Id, event1);
session.Events.Append(order2Id, event2);
session.Store(document);

await session.SaveChangesAsync();  // All-or-nothing
```

### Whizbang Transactional

```csharp{title="Whizbang Transactional" description="Whizbang Transactional" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "Whizbang", "Transactional"]}
// Whizbang: Use EF Core transaction or explicit transaction
await using var transaction = await _dbContext.Database.BeginTransactionAsync(ct);

try {
    await _eventStore.AppendAsync(order1Id, envelope1, ct);
    await _eventStore.AppendAsync(order2Id, envelope2, ct);
    await _dbContext.SaveChangesAsync(ct);

    await transaction.CommitAsync(ct);
} catch {
    await transaction.RollbackAsync(ct);
    throw;
}
```

## Query Patterns

### Marten Query Session

```csharp{title="Marten Query Session" description="Marten Query Session" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Marten", "Query", "Session"]}
// Marten: Query events directly
await using var session = _store.QuerySession();

var recentOrders = await session.Events
    .QueryRawEventDataOnly<OrderCreated>()
    .Where(e => e.Timestamp > cutoff)
    .ToListAsync();
```

### Whizbang Event Queries

```csharp{title="Whizbang Event Queries" description="Whizbang Event Queries" category="Reference" difficulty="BEGINNER" tags=["Migration-guide", "C#", "Whizbang", "Event", "Queries"]}
// Whizbang: Query via event store
var events = await _eventStore.GetEventsBetweenAsync<OrderCreated>(
    fromPosition: lastCheckpoint,
    toPosition: currentPosition,
    ct);

await foreach (var envelope in events) {
    // Process event
}
```

## MessageEnvelope Creation Helper

Create a helper method for consistent envelope creation:

```csharp{title="MessageEnvelope Creation Helper" description="Create a helper method for consistent envelope creation:" category="Reference" difficulty="INTERMEDIATE" tags=["Migration-guide", "C#", "MessageEnvelope", "Creation", "Helper"]}
public static class EnvelopeFactory {
    public static MessageEnvelope<T> Create<T>(
        T payload,
        CorrelationId? correlationId = null,
        CausationId? causationId = null) where T : IEvent {

        return new MessageEnvelope<T> {
            MessageId = MessageId.From(Guid.CreateVersion7()),
            Payload = payload,
            Hops = new List<MessageHop> {
                MessageHop.Create(
                    correlationId ?? CorrelationId.From(Guid.CreateVersion7()),
                    causationId)
            }
        };
    }
}

// Usage
var envelope = EnvelopeFactory.Create(orderCreatedEvent);
await _eventStore.AppendAsync(streamId, envelope, ct);
```

## Migration Checklist

- [ ] Replace `IDocumentStore` with `IEventStore`
- [ ] Replace `IDocumentSession` with direct `IEventStore` injection
- [ ] Replace `session.Events.Append()` with `eventStore.AppendAsync<T>()`
- [ ] Create `MessageEnvelope<T>` for each event
- [ ] Use `Guid.CreateVersion7()` for new stream IDs
- [ ] Remove `session.SaveChangesAsync()` (Whizbang auto-commits)
- [ ] Update concurrency handling to sequence-based
- [ ] Update event queries to use `IEventStore` methods

---

*Previous: [Projection Migration](04-projection-migration.md) | Next: [Transport Configuration](06-transport-configuration.md)*
