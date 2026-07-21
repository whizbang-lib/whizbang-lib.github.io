---
title: Stream ID
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Core Concepts
order: 12
description: >-
  IHasStreamId interface and automatic stream ID generation for event streams in Whizbang.
tags: 'stream-id, events, event-sourcing, auto-generation'
codeReferences:
  - src/Whizbang.Core/IHasStreamId.cs
  - src/Whizbang.Core/ValueObjects/StreamId.cs
  - src/Whizbang.Core/StreamIdAttribute.cs
  - src/Whizbang.Core/GenerateStreamIdAttribute.cs
  - src/Whizbang.Core/Validation/StreamIdGuard.cs
  - src/Whizbang.Core/Validation/InvalidStreamIdException.cs
testReferences:
  - tests/Whizbang.Core.Tests/Validation/StreamIdGuardTests.cs
  - tests/Whizbang.Core.Tests/Registry/StreamIdExtractorRegistryTests.cs
  - tests/Whizbang.Generators.Tests/StreamIdGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/GenerateStreamIdGeneratorTests.cs
lastMaintainedCommit: '01f07906'
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

```csharp{title="IHasStreamId Interface" description="IHasStreamId Interface" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "IHasStreamId", "Interface"] unverified="marker interface contract declaration; no runtime behavior asserted in the snippet"}
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

:::updated
`WhizbangOptions.AutoGenerateStreamIds` still exists as a property (default `true`) for backward compatibility, but the shipped generation path is driven by the per-type `[GenerateStreamId]` policy via the generated stream-id extractor — the global option is no longer consulted by the dispatcher.
:::

### `[GenerateStreamId]` Attribute

Apply `[GenerateStreamId]` alongside `[StreamId]` to opt-in to auto-generation:

```csharp{title="`[GenerateStreamId]` Attribute" description="Apply [GenerateStreamId] alongside [StreamId] to opt-in to auto-generation:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "GenerateStreamId", "Attribute"] unverified="attribute-declaration example; per-type generation policy is exercised by the generator tests, not asserted at runtime here"}
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

```csharp{title="Usage Example" description="Usage Example" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Usage", "Example"] unverified="consumer-facing dispatch illustration; the isolated stream-id generation policy is verified on the How Auto-Generation Works block"}
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

For full details, see the [`[GenerateStreamId]` attribute reference](../../extending/attributes/generatestreamid).

### How Auto-Generation Works

1. The source generator discovers `[GenerateStreamId]` on the message type and records its policy (always generate vs. `OnlyIfEmpty`)
2. At dispatch, the Dispatcher asks the generated stream-id extractor for the message's generation policy
3. If the policy says generate (and, for `OnlyIfEmpty`, the current StreamId is `Guid.Empty`), a new ID is created via `TrackedGuid.NewMedo()`
4. The ID is written back through `IHasStreamId.StreamId` when the message implements it, or through the generated `[StreamId]` property setter otherwise
5. The message is then processed with the generated ID

```csharp{title="How Auto-Generation Works" description="How Auto-Generation Works" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "Auto-Generation", "Works"] tests=["StreamIdExtractorRegistryTests.GetGenerationPolicy_WithExtractorThatShouldGenerate_ReturnsTrueAsync", "StreamIdExtractorRegistryTests.GetGenerationPolicy_WithExtractorShouldGenerateOnlyIfEmpty_ReturnsTrueTrueAsync", "StreamIdExtractorRegistryTests.SetStreamId_WithSuccessfulExtractor_ReturnsTrueAsync"]}
// Internal dispatcher logic (simplified)
var (shouldGenerate, onlyIfEmpty) = _streamIdExtractor.GetGenerationPolicy(message);
if (shouldGenerate && (!onlyIfEmpty || streamId == Guid.Empty)) {
  streamId = TrackedGuid.NewMedo();
  if (message is IHasStreamId hasStreamId) {
    hasStreamId.StreamId = streamId;
  } else {
    _streamIdExtractor.SetStreamId(message, streamId);
  }
}
```

## StreamId Value Object {#streamid-value-object}

For type-safe stream IDs, use the generated `StreamId` value object:

```csharp{title="StreamId Value Object" description="For type-safe stream IDs, use the generated StreamId value object:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "StreamId", "Value"] unverified="value-object type declaration; no runtime behavior asserted"}
namespace Whizbang.Core.ValueObjects;

/// <summary>
/// Uniquely identifies an event stream within the system.
/// Uses UUIDv7 for time-ordered, database-friendly storage.
/// </summary>
[WhizbangId]
public readonly partial struct StreamId;
```

### Usage

```csharp{title="Usage" description="Usage" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Usage"] unverified="StreamId value-object construction and parsing; verified by IdentityValueObjectTests, which is absent from the test map"}
// Create new StreamId (UUIDv7 via TrackedGuid.NewMedo())
var streamId = StreamId.New();

// From existing Guid — throws ArgumentException if the Guid is not UUIDv7
var streamId = StreamId.From(existingGuid);

// From a TrackedGuid, preserving tracking metadata (must be time-ordered)
var streamId = StreamId.From(TrackedGuid.NewMedo());

// Parse from string — validates UUIDv7 (a v4 string here would throw)
var streamId = StreamId.Parse("01890a5d-ac96-774b-bcce-b302099a8057");

// Implicit conversion to Guid
Guid guid = streamId;

// Get underlying value
Guid underlying = streamId.Value;
```

## IHasStreamId vs [StreamId] Attribute

Whizbang supports two ways to identify a message's stream:

### 1. IHasStreamId Interface

Use when you want a settable `StreamId` property the framework can write to directly:

```csharp{title="IHasStreamId Interface" description="Use when you want a settable StreamId property:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "IHasStreamId", "Interface"] unverified="event-type declaration showing IHasStreamId; no runtime behavior asserted"}
public record OrderCreated : IEvent, IHasStreamId {
  public Guid StreamId { get; set; }  // Auto-generated if empty (with [GenerateStreamId])
  // ...
}
```

### 2. [StreamId] Attribute

Use when the stream ID lives on a **business-named property** — the source generator emits a zero-reflection extractor (and setter) for it:

```csharp{title="[StreamId] Attribute" description="Use when the stream ID lives on a business-named property:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "StreamId", "Attribute"] tests=["StreamIdGeneratorTests.Generator_WithStreamIdAttribute_GeneratesExtractorAsync"]}
public record OrderCreated : IEvent {
  [StreamId]
  public required Guid OrderId { get; init; }  // Business ID is the stream ID
  // ...
}
```

The property must be `Guid`, `Guid?`, or a WhizbangId type, and only **one** property per message type may carry `[StreamId]` (the attribute is inherited by derived message types).

### Comparison

| Feature | IHasStreamId | [StreamId] |
|---------|--------------|------------|
| Property name | Must be `StreamId` | Any property |
| Settable required | Yes (`get; set;`) | No (`init` works; generated setter used for auto-generation) |
| Properties per type | One (`StreamId`) | One `[StreamId]` property per type |
| Auto-generation | With `[GenerateStreamId]` | With `[GenerateStreamId]` |
| Use case | System-generated stream identity | Business-named stream identity |

## Working with Event Streams

### Appending Events

```csharp{title="Appending Events" description="Appending Events" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "C#", "Appending"] tests=["InMemoryEventStoreTests.AppendAsync_WithMessage_ShouldStoreEventAsync"]}
// Event store uses StreamId for organization
await eventStore.AppendAsync(order.StreamId, new OrderShipped {
  OrderId = order.Id,
  ShippedAt = _timeProvider.GetUtcNow()
});
```

### Reading Events

```csharp{title="Reading Events" description="Reading Events" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "C#", "Reading"] tests=["EventStoreContractTests.ReadAsync_ShouldReturnEventsInOrderAsync"]}
// Read all events for a stream
await foreach (var envelope in eventStore.ReadAsync<IEvent>(streamId, fromSequence: 0)) {
  var evt = envelope.Payload;
  // Process event...
}
```

### Polymorphic Reads

```csharp{title="Polymorphic Reads" description="Polymorphic Reads" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Polymorphic", "Reads"] tests=["InMemoryEventStoreTests.ReadPolymorphicAsync_WithMatchingEventType_ShouldReturnEventsAsync"]}
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

- **Use IHasStreamId** when you want a framework-writable `StreamId` property
- **Use [StreamId]** when the stream ID comes from a business-named property
- **Use [GenerateStreamId]** to opt in to auto-generation (stream-initiating events)
- **Use StreamId value object** for type safety in domain code
- **Store StreamId with events** for replay and querying

### DON'T

- **Don't mix approaches** - choose one pattern per event type
- **Don't modify StreamId** after event is published
- **Don't use random GUIDs** - prefer UUIDv7 for time ordering

## Stream ID Extraction

For advanced scenarios, see [Delivery Receipts](../messages/delivery-receipts.md) for how Whizbang extracts stream IDs from messages using source-generated extractors.

## Related Documentation

- [Events](events.md) - Event definition and EventId
- [Event Streams](event-streams.md) - Stream organization
- [Delivery Receipts](../messages/delivery-receipts.md) - Stream ID extraction
- [WhizbangIds](../identity/whizbang-ids.md) - Strongly-typed ID values

---

*Version 1.0.0 - Foundation Release*
