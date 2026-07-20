---
title: Ledger Component
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Components
order: 7
description: 'The ledger concept: Whizbang''s append-only event store, implemented by IEventStore'
tags: 'ledger, event-store, events, in-memory, append-only'
codeReferences:
  - src/Whizbang.Core/Messaging/IEventStore.cs
  - src/Whizbang.Core/Messaging/InMemoryEventStore.cs
  - src/Whizbang.Core/Messaging/EventStoreRecord.cs
testReferences:
  - tests/Whizbang.Core.Tests/Messaging/InMemoryEventStoreTests.cs
  - tests/Whizbang.Core.Tests/Messaging/EventStoreOrderingInvariantTests.cs
  - tests/Whizbang.Core.Tests/Messaging/EventStoreAppendBatchTests.cs
lastMaintainedCommit: '01f07906'
---

# Ledger Component

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Status](https://img.shields.io/badge/status-stable-green)

## Overview

The **ledger** is Whizbang's append-only event store: an immutable, replayable record of every event in your system. It is implemented by the [`IEventStore`](event-store.md) interface — events are appended to **streams** (one stream per aggregate/entity, keyed by a UUIDv7 `streamId`) and can never be altered or deleted.

:::updated
Early drafts of this page described a standalone `ILedger` interface with global positions. The shipped design is stream-based: the ledger is the `IEventStore` abstraction, with per-stream sequence numbers and UUIDv7 event-id ordering. This page describes the shipped behavior; see [Event Store](event-store.md) for the full API surface.
:::

## What is a Ledger?

A Ledger:
- **Stores** events in append-only fashion, organized into streams
- **Preserves** the complete history of state changes
- **Provides** an immutable audit trail
- **Enables** event replay (perspectives, rebuilds) and debugging

Think of the ledger as your system's permanent memory - every significant action is recorded and can never be altered or deleted.

## Core Interface

The ledger contract is `IEventStore` (`Whizbang.Core.Messaging`). The essential members:

```csharp{title="Core Interface" description="Essential IEventStore members (see Event Store for the full interface)" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Core", "Interface"] tests=["InMemoryEventStoreTests.AppendAsync_WithMessage_ShouldStoreEventAsync", "InMemoryEventStoreTests.ReadPolymorphicAsync_WithMatchingEventType_ShouldReturnEventsAsync", "EventStoreContractTests.GetLastSequenceAsync_AfterAppends_ShouldReturnCorrectSequenceAsync"]}
public interface IEventStore {
  // Append an envelope to a stream
  Task AppendAsync<TMessage>(Guid streamId, MessageEnvelope<TMessage> envelope,
      CancellationToken cancellationToken = default);

  // Append a raw message (envelope resolved from IEnvelopeRegistry, or a minimal one is created)
  Task AppendAsync<TMessage>(Guid streamId, TMessage message,
      CancellationToken cancellationToken = default) where TMessage : notnull;

  // Read a stream from a sequence number (inclusive)
  IAsyncEnumerable<MessageEnvelope<TMessage>> ReadAsync<TMessage>(Guid streamId,
      long fromSequence, CancellationToken cancellationToken = default);

  // Read a stream starting after an event ID (UUIDv7 time-ordering); null = from beginning
  IAsyncEnumerable<MessageEnvelope<TMessage>> ReadAsync<TMessage>(Guid streamId,
      Guid? fromEventId, CancellationToken cancellationToken = default);

  // Read mixed event types, deserializing each to its concrete type
  IAsyncEnumerable<MessageEnvelope<IEvent>> ReadPolymorphicAsync(Guid streamId,
      Guid? fromEventId, IReadOnlyList<Type> eventTypes,
      CancellationToken cancellationToken = default);

  // Last (highest) sequence number for a stream; -1 if the stream is empty
  Task<long> GetLastSequenceAsync(Guid streamId, CancellationToken cancellationToken = default);

  // ... batch append, checkpoint-range reads, and AppendAndWaitAsync -
  // see the Event Store page for the full surface
}
```

There is no global "position" counter — ordering is **per stream** (monotonic sequence numbers) and **by event ID** (UUIDv7 is time-ordered), which is what enables partitioned, scalable storage backends.

## Implementations

| Implementation | Package | Use |
|----------------|---------|-----|
| `InMemoryEventStore` | `Whizbang.Core` | Testing and single-process scenarios. Thread-safe; NOT for multi-process production use. |
| Postgres event stores (Dapper / EF Core) | `Whizbang.Data.*` | Production. Events land in the `wh_event_store` table via the work coordinator. |

```csharp{title="In-Memory Implementation" description="InMemoryEventStore for tests and single-process scenarios" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "InMemory", "Implementation"] tests=["InMemoryEventStoreTests.AppendAsync_WithMessage_WhenNoEnvelope_ShouldCreateMinimalEnvelopeAsync", "InMemoryEventStoreTests.AppendAsync_WithMessage_WhenEnvelopeRegistered_ShouldUseEnvelopeAsync"]}
// Thread-safe in-memory ledger for tests / single-process apps
var store = new InMemoryEventStore();

// Or, with envelope-registry support so raw-message appends keep tracing context
var store = new InMemoryEventStore(envelopeRegistry);
```

## Event Storage

### Record Structure

Relational backends persist one `EventStoreRecord` per event:

```csharp{title="Record Structure" description="EventStoreRecord - the persisted shape of a ledger entry" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Event", "Structure"]}
public sealed class EventStoreRecord {
  public Guid Id { get; set; }                       // Event ID (UUIDv7)
  public required Guid StreamId { get; set; }        // Stream (aggregate) identity
  public required Guid AggregateId { get; set; }     // Back-compat alias of StreamId
  public required string AggregateType { get; set; } // CLR type name (no assembly)
  public required int Version { get; set; }          // Per-stream optimistic-concurrency version
  public required string EventType { get; set; }     // "Namespace.Type, Assembly"
  public required JsonElement EventData { get; set; }// Event payload as JSON
  public required EnvelopeMetadata Metadata { get; set; } // Hops, correlation, causation
  public PerspectiveScope? Scope { get; set; }       // Security scope (tenant/user/...)
  public DateTime CreatedAt { get; set; }
  public long? CommitSequence { get; set; }          // Global commit stamp (async)
  // ... origin fields for cross-service provenance
}
```

### Appending Events

Events reach the ledger automatically: receptors return events, and the dispatch pipeline stores them (outbox → work coordinator → event store). You can also append directly:

```csharp{title="Appending Events" description="Appending Events" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "C#", "Appending"] tests=["InMemoryEventStoreTests.AppendAsync_WithMessage_ShouldStoreEventAsync", "InMemoryEventStoreTests.AppendAsync_WithMessage_WhenEnvelopeRegistered_ShouldUseEnvelopeAsync"]}
// Direct append - envelope (with tracing context) is looked up automatically
await eventStore.AppendAsync(order.StreamId, new OrderShipped {
  OrderId = order.Id,
  ShippedAt = timeProvider.GetUtcNow()
});
```

### Reading Events

```csharp{title="Reading Events" description="Reading Events" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "C#", "Reading"] tests=["EventStoreContractTests.ReadAsync_ShouldReturnEventsInOrderAsync", "InMemoryEventStoreTests.ReadAsync_ByEventId_WithSpecificEventId_ShouldReturnEventsAfterItAsync", "InMemoryEventStoreTests.ReadPolymorphicAsync_WithMatchingEventType_ShouldReturnEventsAsync"]}
// Read a whole stream, strongly typed
await foreach (var envelope in eventStore.ReadAsync<OrderCreated>(streamId, fromSequence: 0)) {
  Console.WriteLine($"{envelope.Payload.OrderId}");
}

// Read from a checkpoint (events AFTER this event ID)
await foreach (var envelope in eventStore.ReadAsync<OrderCreated>(streamId, fromEventId: lastSeenEventId)) {
  ProcessEvent(envelope.Payload);
}

// Polymorphic read - mixed event types in one stream
var eventTypes = new[] { typeof(OrderCreated), typeof(OrderShipped) };
await foreach (var envelope in eventStore.ReadPolymorphicAsync(streamId, fromEventId: null, eventTypes)) {
  switch (envelope.Payload) {
    case OrderCreated created: /* ... */ break;
    case OrderShipped shipped: /* ... */ break;
  }
}
```

## Testing with the Ledger

`InMemoryEventStore` makes ledger-level assertions easy:

```csharp{title="Testing with the Ledger" description="Testing with the Ledger" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Testing", "Ledger"] tests=["EventStoreContractTests.GetLastSequenceAsync_EmptyStream_ShouldReturnMinusOneAsync", "EventStoreContractTests.GetLastSequenceAsync_AfterAppends_ShouldReturnCorrectSequenceAsync"]}
[Test]
public async Task Append_ShouldIncrementSequenceAsync() {
  // Arrange
  var store = new InMemoryEventStore();
  var streamId = (Guid)TrackedGuid.NewMedo();

  // Empty stream reports -1
  await Assert.That(await store.GetLastSequenceAsync(streamId)).IsEqualTo(-1);

  // Act
  await store.AppendAsync(streamId, new TestEvent());
  await store.AppendAsync(streamId, new TestEvent());

  // Assert - sequences are per stream and monotonic
  await Assert.That(await store.GetLastSequenceAsync(streamId)).IsEqualTo(1);

  var events = new List<MessageEnvelope<TestEvent>>();
  await foreach (var e in store.ReadAsync<TestEvent>(streamId, fromSequence: 0)) {
    events.Add(e);
  }
  await Assert.That(events.Count).IsEqualTo(2);
}
```

## Characteristics

- **Append-only** - no update or delete operations exist on the interface
- **Per-stream ordering** - monotonic sequence numbers within each stream
- **Time-ordered event IDs** - UUIDv7 (`TrackedGuid.NewMedo()`) makes event IDs sortable across streams
- **AOT-compatible** - generic append/read with source-generated JSON contexts; no reflection
- **Thread-safe** - `InMemoryEventStore` uses concurrent collections; Postgres backends rely on transactional inserts with retry

## Best Practices

1. **Events are immutable** - Never modify events after creation
2. **Use meaningful event names** - OrderCreated not Event1
3. **Include all relevant data** - Events should be self-contained
4. **Keep events small** - Large payloads impact performance
5. **Version your events** - Plan for schema evolution (see [Event Upcasting](event-upcasting.md))
6. **Test with the ledger** - Use `InMemoryEventStore` to verify event flow in tests

## Related Documentation

- [Event Store](event-store.md) - Full `IEventStore` API, `AppendAndWaitAsync`, decorator stack
- [Event Store Query](event-store-query.md) - Querying the ledger
- [Event Streams](event-streams.md) - Stream organization and `StreamId`
- [Stream ID](stream-id.md) - How stream identity is assigned
- [Event Upcasting](event-upcasting.md) - Evolving stored events
- [Receptors](../receptors/receptors.md) - Where events come from
- [Perspectives](../perspectives/perspectives.md) - How events update views
