---
title: Event Streams
version: 1.0.0
category: Core Concepts
order: 13
description: >-
  Event streams and StreamId value object for organizing events by aggregate in Whizbang.
tags: 'event-streams, stream-id, event-sourcing, aggregates'
codeReferences:
  - src/Whizbang.Core/ValueObjects/StreamId.cs
  - src/Whizbang.Core/Messaging/IEventStore.cs
---

# Event Streams

Event streams are ordered sequences of events belonging to a single aggregate or entity. The `StreamId` value object uniquely identifies each stream.

## Overview

In event sourcing, events are organized into **streams**:

- Each stream represents a single aggregate instance (e.g., Order #123)
- Events within a stream are ordered by sequence number
- Streams enable efficient querying, replay, and partitioning
- Stream IDs use UUIDv7 for time-ordered, database-friendly storage

## StreamId Value Object {#streamid}

```csharp{title="StreamId Value Object" description="StreamId Value Object" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "StreamId", "Value"]}
namespace Whizbang.Core.ValueObjects;

/// <summary>
/// Uniquely identifies an event stream within the system.
/// Uses UUIDv7 (time-ordered, database-friendly) for optimal indexing performance.
/// Uses Medo.Uuid7 for monotonic counter-based generation with guaranteed uniqueness.
/// </summary>
[WhizbangId]
public readonly partial struct StreamId;
```

### Creating StreamIds

```csharp{title="Creating StreamIds" description="Creating StreamIds" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Creating", "StreamIds"]}
// Create new StreamId (UUIDv7)
var streamId = StreamId.New();

// From existing Guid
var streamId = StreamId.From(existingGuid);

// Parse from string
var streamId = StreamId.Parse("550e8400-e29b-41d4-a716-446655440000");

// Implicit conversion to Guid
Guid guid = streamId;

// Get underlying value
Guid underlying = streamId.Value;
```

## Stream Structure

```
Stream: order-123
├── Seq 1: OrderCreated { OrderId, CustomerId, Items }
├── Seq 2: OrderItemAdded { OrderId, ProductId, Quantity }
├── Seq 3: OrderShipped { OrderId, TrackingNumber }
└── Seq 4: OrderDelivered { OrderId, DeliveredAt }

Stream: order-456
├── Seq 1: OrderCreated { OrderId, CustomerId, Items }
├── Seq 2: OrderCancelled { OrderId, Reason }
└── (no more events - cancelled)
```

Each event has:
- **StreamId**: Which stream it belongs to
- **Sequence**: Position within the stream (1, 2, 3, ...)
- **EventId**: Globally unique event identifier

## Working with Streams

### Appending Events

```csharp{title="Appending Events" description="Appending Events" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "C#", "Appending"]}
// Append event to a stream
await eventStore.AppendAsync(order.StreamId, new OrderShipped {
  OrderId = order.Id,
  TrackingNumber = trackingNumber,
  ShippedAt = _timeProvider.GetUtcNow()
});
```

### Reading Events

```csharp{title="Reading Events" description="Reading Events" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "C#", "Reading"]}
// Read all events from a stream
await foreach (var envelope in eventStore.ReadAsync<IEvent>(streamId, fromSequence: 0)) {
  Console.WriteLine($"Event {envelope.Sequence}: {envelope.Payload.GetType().Name}");
}
```

### Reading from Checkpoint

```csharp{title="Reading from Checkpoint" description="Reading from Checkpoint" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "Reading", "Checkpoint"]}
// Read events after a specific event ID (checkpoint-based)
await foreach (var envelope in eventStore.ReadAsync<IEvent>(streamId, fromEventId: lastProcessedId)) {
  await ProcessEventAsync(envelope.Payload);
}
```

### Polymorphic Reads

```csharp{title="Polymorphic Reads" description="Polymorphic Reads" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Polymorphic", "Reads"]}
// Read multiple event types from a stream
var eventTypes = new[] {
  typeof(OrderCreated),
  typeof(OrderShipped),
  typeof(OrderDelivered)
};

await foreach (var envelope in eventStore.ReadPolymorphicAsync(
    streamId,
    fromEventId: null,
    eventTypes)) {

  switch (envelope.Payload) {
    case OrderCreated created:
      ApplyOrderCreated(created);
      break;
    case OrderShipped shipped:
      ApplyOrderShipped(shipped);
      break;
    case OrderDelivered delivered:
      ApplyOrderDelivered(delivered);
      break;
  }
}
```

## Stream-Based Aggregates

Events in a stream can rebuild aggregate state:

```csharp{title="Stream-Based Aggregates" description="Events in a stream can rebuild aggregate state:" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Events", "Stream-Based", "Aggregates"]}
public class Order {
  public Guid Id { get; private set; }
  public Guid CustomerId { get; private set; }
  public OrderStatus Status { get; private set; }
  public List<OrderItem> Items { get; } = new();

  // Rebuild from events
  public static async Task<Order> LoadAsync(
      IEventStore eventStore,
      StreamId streamId,
      CancellationToken ct = default) {

    var order = new Order();

    await foreach (var envelope in eventStore.ReadPolymorphicAsync(
        streamId.Value, null, new[] {
          typeof(OrderCreated),
          typeof(OrderItemAdded),
          typeof(OrderShipped),
          typeof(OrderDelivered),
          typeof(OrderCancelled)
        }, ct)) {

      order.Apply(envelope.Payload);
    }

    return order;
  }

  private void Apply(object evt) {
    switch (evt) {
      case OrderCreated e:
        Id = e.OrderId;
        CustomerId = e.CustomerId;
        Status = OrderStatus.Created;
        Items.AddRange(e.Items);
        break;
      case OrderShipped e:
        Status = OrderStatus.Shipped;
        break;
      case OrderDelivered e:
        Status = OrderStatus.Delivered;
        break;
      case OrderCancelled e:
        Status = OrderStatus.Cancelled;
        break;
    }
  }
}
```

## Stream Partitioning

Streams enable partitioning for scalability:

```csharp{title="Stream Partitioning" description="Streams enable partitioning for scalability:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "Stream", "Partitioning"]}
// Events are partitioned by StreamId
// Each partition can be processed independently
public record OrderCreated : IEvent {
  [StreamKey]  // Used for partitioning
  public required Guid OrderId { get; init; }
  public required Guid CustomerId { get; init; }
}
```

Benefits of stream-based partitioning:
- **Ordering**: Events within a stream are processed in order
- **Parallelism**: Different streams can be processed in parallel
- **Scalability**: Partitions can be distributed across nodes
- **Consistency**: Stream-level consistency guarantees

## Stream ID Strategies

### Business Entity ID

Use the entity's business ID as the stream ID:

```csharp{title="Business Entity ID" description="Use the entity's business ID as the stream ID:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "Business", "Entity"]}
public record OrderCreated : IEvent {
  [StreamKey]
  public required Guid OrderId { get; init; }  // OrderId IS the StreamId
  // ...
}
```

### Auto-Generated Stream ID

Use `IHasStreamId` for system-generated IDs:

```csharp{title="Auto-Generated Stream ID" description="Use IHasStreamId for system-generated IDs:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "Auto-Generated", "Stream"]}
public record OrderCreated : IEvent, IHasStreamId {
  public Guid StreamId { get; set; }  // Auto-generated
  public required Guid CustomerId { get; init; }
  // ...
}
```

### Composite Stream ID

For complex scenarios, derive stream ID from multiple fields:

```csharp{title="Composite Stream ID" description="For complex scenarios, derive stream ID from multiple fields:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "Composite", "Stream"]}
public record TenantOrderCreated : IEvent {
  public required Guid TenantId { get; init; }
  public required Guid OrderId { get; init; }

  // Derive stream ID (implemented via custom extractor)
  public Guid GetStreamId() => ComputeStreamId(TenantId, OrderId);
}
```

## Best Practices

### Stream Granularity

- **One stream per aggregate instance** (Order #123, User #456)
- **Don't create global streams** for all events of a type
- **Keep streams focused** - one logical entity per stream

### Stream Naming

- Use meaningful identifiers (business IDs when possible)
- Consider multi-tenancy (tenant-prefixed streams)
- Document stream ID derivation strategies

### Stream Length

- Streams can grow indefinitely (event sourcing principle)
- Consider snapshots for very long streams
- Perspectives handle read model optimization

## Related Documentation

- [Events](events.md) - Event definition and EventId
- [Stream ID](stream-id.md) - IHasStreamId and auto-generation
- [Event Store](event-store.md) - Event persistence
- [Perspectives](../perspectives/perspectives.md) - Read model projections

---

*Version 1.0.0 - Foundation Release*
