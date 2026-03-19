---
title: Stream ID
version: 1.0.0
category: Core Concepts
order: 12
description: >-
  IHasStreamId interface and automatic stream ID generation for event streams in Whizbang.
tags: 'stream-id, events, event-sourcing, auto-generation'
codeReferences:
  - src/Whizbang.Core/IHasStreamId.cs
  - src/Whizbang.Core/ValueObjects/StreamId.cs
---

# Stream ID

Stream IDs uniquely identify event streams in Whizbang's event sourcing system. The `IHasStreamId` interface enables automatic stream ID generation for messages.

## Overview

Every event in Whizbang belongs to a **stream** - a sequence of events for a specific aggregate or entity. Stream IDs:

- Uniquely identify an event stream (e.g., all events for Order #123)
- Enable efficient querying and replay of events
- Support partitioning for scalability
- Use UUIDv7 for time-ordered, database-friendly storage

## IHasStreamId Interface {#ihasstreamid}

```csharp
namespace Whizbang.Core;

/// <summary>
/// Interface for messages that have a settable StreamId.
/// When implemented and StreamId is Guid.Empty, Whizbang automatically
/// generates a new StreamId using TrackedGuid.NewMedo().
/// </summary>
public interface IHasStreamId {
  /// <summary>
  /// The stream identifier for this message.
  /// If empty when dispatched, a new ID will be generated automatically.
  /// </summary>
  Guid StreamId { get; set; }
}
```

## Automatic Stream ID Generation {#auto-generation}

Stream ID auto-generation is controlled per-event-type using the `[GenerateStreamId]` attribute. This replaces the previous global `AutoGenerateStreamIds` option with fine-grained control.

### `[GenerateStreamId]` Attribute

Apply `[GenerateStreamId]` alongside `[StreamId]` to opt-in to auto-generation:

```csharp
// Stream-initiating event: ALWAYS gets a new StreamId
public record OrderCreated : IEvent {
  [StreamId] [GenerateStreamId]
  public Guid OrderId { get; set; }
}

// Flexible event: generates only if not already set (e.g., from cascade)
public record InventoryReserved : IEvent {
  [StreamId] [GenerateStreamId(OnlyIfEmpty = true)]
  public Guid ReservationId { get; set; }
}

// Appending event: MUST have StreamId provided (guard throws if empty)
public record OrderItemAdded : IEvent {
  [StreamId]
  public Guid OrderId { get; set; }
}
```

Events without `[GenerateStreamId]` are validated at pipeline boundaries by `StreamIdGuard`. If the StreamId is `Guid.Empty`, an `InvalidStreamIdException` is thrown, catching bugs where a required StreamId was not provided.

### Usage Example

```csharp
// Stream-initiating event with auto-generation
public record OrderCreated : IEvent {
  [StreamId] [GenerateStreamId]
  public Guid OrderId { get; set; }
  public required Guid CustomerId { get; init; }
  public required OrderItem[] Items { get; init; }
  public required decimal Total { get; init; }
}

// Usage - OrderId will be auto-generated at dispatch
var evt = new OrderCreated {
  CustomerId = customerId,
  Items = items,
  Total = total
  // OrderId not set - will be generated automatically
};

await dispatcher.PublishAsync(evt);
// evt.OrderId now contains a UUIDv7 value
```

For full details, see the [`[GenerateStreamId]` attribute reference](../attributes/generatestreamid).

### How Auto-Generation Works

1. Dispatcher checks if message implements `IHasStreamId`
2. If `StreamId == Guid.Empty`, generates new ID via `TrackedGuid.NewMedo()`
3. Sets the `StreamId` property on the message
4. Message is then processed with the generated ID

```csharp
// Internal dispatcher logic (simplified)
if (message is IHasStreamId hasStreamId && hasStreamId.StreamId == Guid.Empty) {
  hasStreamId.StreamId = TrackedGuid.NewMedo();
}
```

## StreamId Value Object {#streamid-value-object}

For type-safe stream IDs, use the generated `StreamId` value object:

```csharp
namespace Whizbang.Core.ValueObjects;

/// <summary>
/// Uniquely identifies an event stream within the system.
/// Uses UUIDv7 for time-ordered, database-friendly storage.
/// </summary>
[WhizbangId]
public readonly partial struct StreamId;
```

### Usage

```csharp
// Create new StreamId
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

## StreamId vs [StreamKey] Attribute

Whizbang supports two ways to identify stream keys:

### 1. IHasStreamId Interface

Use when you want **automatic generation** of stream IDs:

```csharp
public record OrderCreated : IEvent, IHasStreamId {
  public Guid StreamId { get; set; }  // Auto-generated if empty
  // ...
}
```

### 2. [StreamKey] Attribute

Use when stream ID is derived from **business data**:

```csharp
public record OrderCreated : IEvent {
  [StreamKey]
  public required Guid OrderId { get; init; }  // Business ID is stream key
  // ...
}
```

### Comparison

| Feature | IHasStreamId | [StreamKey] |
|---------|--------------|-------------|
| Auto-generation | Yes | No |
| Property name | Must be `StreamId` | Any property |
| Multiple keys | No | Yes (composite) |
| Read-only | No (must be settable) | Yes |
| Use case | System-generated IDs | Business-driven IDs |

## Working with Event Streams

### Appending Events

```csharp
// Event store uses StreamId for organization
await eventStore.AppendAsync(order.StreamId, new OrderShipped {
  OrderId = order.Id,
  ShippedAt = _timeProvider.GetUtcNow()
});
```

### Reading Events

```csharp
// Read all events for a stream
await foreach (var envelope in eventStore.ReadAsync<IEvent>(streamId, fromSequence: 0)) {
  var evt = envelope.Payload;
  // Process event...
}
```

### Polymorphic Reads

```csharp
// Read multiple event types from a stream
var eventTypes = new[] { typeof(OrderCreated), typeof(OrderShipped), typeof(OrderDelivered) };

await foreach (var envelope in eventStore.ReadPolymorphicAsync(
    streamId,
    fromEventId: null,
    eventTypes)) {

  switch (envelope.Payload) {
    case OrderCreated created:
      // Handle created...
      break;
    case OrderShipped shipped:
      // Handle shipped...
      break;
    case OrderDelivered delivered:
      // Handle delivered...
      break;
  }
}
```

## Best Practices

### DO

- **Use IHasStreamId** when stream ID should be system-generated
- **Use [StreamKey]** when stream ID comes from business data
- **Use StreamId value object** for type safety in domain code
- **Store StreamId with events** for replay and querying

### DON'T

- **Don't mix approaches** - choose one pattern per event type
- **Don't modify StreamId** after event is published
- **Don't use random GUIDs** - prefer UUIDv7 for time ordering

## Stream ID Extraction

For advanced scenarios, see [Delivery Receipts](delivery-receipts.md) for how Whizbang extracts stream IDs from messages using source-generated extractors.

## Related Documentation

- [Events](events.md) - Event definition and EventId
- [Event Streams](event-streams.md) - Stream organization
- [Delivery Receipts](delivery-receipts.md) - Stream ID extraction
- [WhizbangIds](whizbang-ids.md) - Strongly-typed ID values

---

*Version 1.0.0 - Foundation Release*
