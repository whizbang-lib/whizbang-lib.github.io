---
title: Event Streams
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Core Concepts
order: 13
description: >-
  Event streams and StreamId value object for organizing events by aggregate in Whizbang.
tags: 'event-streams, stream-id, event-sourcing, aggregates'
codeReferences:
  - src/Whizbang.Core/ValueObjects/StreamId.cs
  - src/Whizbang.Core/Messaging/IEventStore.cs
  - src/Whizbang.Core/IHasStreamId.cs
  - src/Whizbang.Core/StreamIdAttribute.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Data.Postgres/Migrations/212_CloseStreamReanchorsCursorsAndSnapshots.sql
  - src/Whizbang.Data.Postgres/Migrations/240_TruncateStreamPrefix.sql
  - src/Whizbang.Core/Lifecycle/StreamPrefixTruncator.cs
  - src/Whizbang.Core/Lifecycle/IStreamFinalizer.cs
  - src/Whizbang.Core/Attributes/TerminalEventAttribute.cs
  - src/Whizbang.Core/Messaging/StreamSealedException.cs
testReferences:
  - tests/Whizbang.Core.Tests/Messaging/InMemoryEventStoreTests.cs
  - tests/Whizbang.Core.Tests/ValueObjects/IdentityValueObjectTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StreamCloseSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StreamDigestTableSqlTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperStreamCloseCompanionTests.cs
  - tests/Whizbang.Core.Tests/Messaging/WorkCoordinatorDefaultsTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StreamSealingSqlTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperStreamSealingTests.cs
lastMaintainedCommit: '01f07906'
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

```csharp{title="StreamId Value Object" description="StreamId Value Object" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "StreamId", "Value"] unverified="value-object type declaration; no runtime behavior asserted"}
namespace Whizbang.Core.ValueObjects;

/// <summary>
/// Uniquely identifies an event stream within the system.
/// Uses UUIDv7 (time-ordered, database-friendly) for optimal indexing performance.
/// Uses the framework's UUIDv7 generator for monotonic counter-based generation with guaranteed uniqueness.
/// </summary>
[WhizbangId]
public readonly partial struct StreamId;
```

### Creating StreamIds

```csharp{title="Creating StreamIds" description="Creating StreamIds" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Creating", "StreamIds"] unverified="StreamId value-object construction and parsing; verified by IdentityValueObjectTests, which is absent from the test map"}
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

```mermaid{caption="Two independent event streams (order-123 and order-456), each an ordered sequence of events by ascending sequence number." tests=["EventStoreContractTests.ReadAsync_ShouldReturnEventsInOrderAsync", "EventStoreContractTests.AppendAsync_DifferentStreams_ShouldBeIndependentAsync"]}
graph TB
    subgraph S1["Stream: order-123"]
        A1["Seq 0: OrderCreated { OrderId, CustomerId, Items }"]
        A2["Seq 1: OrderItemAdded { OrderId, ProductId, Quantity }"]
        A3["Seq 2: OrderShipped { OrderId, TrackingNumber }"]
        A4["Seq 3: OrderDelivered { OrderId, DeliveredAt }"]
        A1 --> A2 --> A3 --> A4
    end

    subgraph S2["Stream: order-456"]
        B1["Seq 0: OrderCreated { OrderId, CustomerId, Items }"]
        B2["Seq 1: OrderCancelled { OrderId, Reason }"]
        B3["(no more events - cancelled)"]
        B1 --> B2 --> B3
    end

    style A1 fill:#fff3cd,stroke:#ffc107
    style A2 fill:#fff3cd,stroke:#ffc107
    style A3 fill:#fff3cd,stroke:#ffc107
    style A4 fill:#fff3cd,stroke:#ffc107
    style B1 fill:#fff3cd,stroke:#ffc107
    style B2 fill:#fff3cd,stroke:#ffc107
```

Each event has:
- **StreamId**: Which stream it belongs to
- **Sequence**: Position within the stream (1, 2, 3, ...; a new stream's first event is sequence 1 on every write path, and a stream created by a direct append before migration 267 keeps the 0 it started at; see [Stream versions](event-store#stream-versions))
- **EventId**: Globally unique event identifier

## Working with Streams

### Appending Events

```csharp{title="Appending Events" description="Appending Events" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "C#", "Appending"] tests=["InMemoryEventStoreTests.AppendAsync_WithMessage_ShouldStoreEventAsync"]}
// Append event to a stream
await eventStore.AppendAsync(order.StreamId, new OrderShipped {
  OrderId = order.Id,
  TrackingNumber = trackingNumber,
  ShippedAt = _timeProvider.GetUtcNow()
});
```

### Reading Events

```csharp{title="Reading Events" description="Reading Events" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "C#", "Reading"] tests=["EventStoreContractTests.ReadAsync_ShouldReturnEventsInOrderAsync"]}
// Read all events from a stream (ordered by sequence within the stream)
await foreach (var envelope in eventStore.ReadAsync<IEvent>(streamId, fromSequence: 0)) {
  Console.WriteLine($"Event {envelope.MessageId}: {envelope.Payload.GetType().Name}");
}
```

### Reading from Checkpoint

```csharp{title="Reading from Checkpoint" description="Reading from Checkpoint" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "Reading", "Checkpoint"] tests=["InMemoryEventStoreTests.ReadAsync_ByEventId_WithSpecificEventId_ShouldReturnEventsAfterItAsync"]}
// Read events after a specific event ID (checkpoint-based)
await foreach (var envelope in eventStore.ReadAsync<IEvent>(streamId, fromEventId: lastProcessedId)) {
  await ProcessEventAsync(envelope.Payload);
}
```

### Polymorphic Reads

```csharp{title="Polymorphic Reads" description="Polymorphic Reads" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Polymorphic", "Reads"] tests=["InMemoryEventStoreTests.ReadPolymorphicAsync_WithMatchingEventType_ShouldReturnEventsAsync"]}
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

```csharp{title="Stream-Based Aggregates" description="Events in a stream can rebuild aggregate state:" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Events", "Stream-Based", "Aggregates"] unverified="illustrative aggregate rebuild — user-defined Apply fold over ReadPolymorphicAsync, not a framework API under test"}
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

```csharp{title="Stream Partitioning" description="Streams enable partitioning for scalability:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "Stream", "Partitioning"] unverified="attribute-declaration example illustrating partitioning; no runtime behavior asserted"}
// Events are partitioned by StreamId
// Each partition can be processed independently
public record OrderCreated : IEvent {
  [StreamId]  // Used for partitioning
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

```csharp{title="Business Entity ID" description="Use the entity's business ID as the stream ID:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "Business", "Entity"] unverified="stream-ID strategy declaration; [StreamId] extractor generation is verified on the Stream ID page"}
public record OrderCreated : IEvent {
  [StreamId]
  public required Guid OrderId { get; init; }  // OrderId IS the StreamId
  // ...
}
```

### Auto-Generated Stream ID

Use `IHasStreamId` for system-generated IDs:

```csharp{title="Auto-Generated Stream ID" description="Use IHasStreamId for system-generated IDs:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "Auto-Generated", "Stream"] unverified="IHasStreamId declaration; auto-generation is verified on the Stream ID page"}
public record OrderCreated : IEvent, IHasStreamId {
  public Guid StreamId { get; set; }  // Auto-generated
  public required Guid CustomerId { get; init; }
  // ...
}
```

### Composite Stream ID

For complex scenarios, derive stream ID from multiple fields:

```csharp{title="Composite Stream ID" description="For complex scenarios, derive stream ID from multiple fields:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "Composite", "Stream"] unverified="illustrative custom stream-ID derivation (GetStreamId), not a shipped API"}
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

## Truncating a Stream's Prefix {#truncating-a-stream-prefix}

A long-lived stream (an account, a ledger, a running balance) can drop its old detail once a later event carries the state forward: the domain appends that carry-forward event, then calls `IWorkCoordinator.TruncateStreamPrefixAsync(streamId, throughVersion, archive)` to remove the detail at or below `throughVersion`. With `archive: true` the detail is copied to cold storage first, in the same transaction, and stays readable through `GetArchivedEventsAsync`. The SQL function underneath is `wh_truncate_stream_prefix`.

```csharp{title="Truncating a Stream's Prefix" description="Remove a stream's detail at or below a version once a carry-forward event survives above it" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Streams", "Retention"] tests=["StreamCloseSqlTests.CloseStream_ConsumptionGate_BlocksThenTruncatesAsync"]}
// The domain has already emitted its carry-forward event (for example PeriodSummarized) through its receptor;
// that event survives above the truncate point and carries the state forward.
var result = await coordinator.TruncateStreamPrefixAsync(accountId, throughVersion: summarizedThrough, archive: true);
if (result.Status != "truncated") {
  // not an error: retry later, or act on the reason below
}
```

Calling the coordinator truncates and nothing more. `IStreamPrefixTruncator.TruncateAsync(streamId, throughVersion, archive)` (registered by `AddWhizbangWorkers()`) wraps the same truncate in the destruction hook and the [destruction lifecycle stages](../lifecycle/lifecycle-stages#destruction), so receptors that preserve or announce the truncated events run around it; see [Truncating a stream on a schedule](ephemeral-events#scheduled-close). With `archive: true` it writes through the registered [archive store](archive-store#the-prefix-truncate-archives-through-the-store), which keeps every column a restore needs and records where the prefix went on the stream's lifecycle row.

The truncate is all or nothing. It returns one of these statuses:

| Status | Meaning | What to do |
|---|---|---|
| `truncated` | The detail was removed; `EventsTruncated` says how many events. | Nothing. |
| `blocked` | A perspective still has unprocessed work at or below the truncate point. | Retry after the perspectives catch up. |
| `no_carry_forward` | No event survives above the truncate point, so nothing would carry the state forward. | Append the carry-forward event first. |
| `held` | An active destruction hold covers an event in the range. | Release or let the hold lapse; holds are deliberate decisions to keep data. |
| `cursor_behind` | A perspective's cursor sits inside the range and that perspective has not yet applied the first surviving event. | Retry after it applies that event. |
| `debug_skipped` | Debug mode is on; nothing is destroyed in debug mode. | Turn debug mode off outside local development. |
| `unsupported` | The storage engine has no truncate primitive. | Use a Postgres-backed store. |

{verified: StreamCloseSqlTests.CloseStream_ConsumptionGate_BlocksThenTruncatesAsync, StreamCloseSqlTests.CloseStream_NoCarryForward_RefusesTotalTruncationAsync, StreamCloseSqlTests.CloseStream_ActiveDestructionHoldInsideTheRange_IsRefused_ALapsedOneIsRemovedAsync, StreamCloseSqlTests.CloseStream_CursorBehindABoundaryEventItsPerspectiveStillOwes_IsRefusedAsync, StreamCloseSqlTests.CloseStream_DebugMode_SkippedAsync, WorkCoordinatorDefaultsTests.TruncateStreamPrefixAsync_WithoutProviderSupport_UsesInheritedDefaultAsync}

:::new{type="breaking"}
Until #1731 this operation was named `close_stream` / `CloseStreamAsync` (with `IStreamCloser`, `StreamCloseResult` and a `closed` status). It was renamed because it truncates; "close" now belongs to closing the books, a separate operation that seals a stream and opens its successor. Migration 240 drops `close_stream`, so SQL that called it by name has to move to `wh_truncate_stream_prefix`.
:::

{verified: StreamCloseSqlTests.TruncateStreamPrefix_AfterMigration_IsTheOnlyNameTheTruncateGoesByAsync, DapperStreamCloseCompanionTests.TruncateStreamPrefix_OnADapperMigratedDatabase_ReplacesCloseStreamAsync}

### What a prefix truncate does to the rest of the stream's state {#truncate-effects}

- **Perspective cursors** that point at a truncated event move onto the boundary event, the first event that survives above the truncate point. Nothing is skipped: the consumption check already proved every event at or below the truncate point was processed, and reads resume strictly after the cursor. If the perspective still owes work for the boundary event itself, moving the cursor would skip that event forever, so the truncate returns `cursor_behind` instead.
- **Snapshots** that a rewind could no longer replay from are removed: any snapshot at or below the truncate point, unless it is the current state of a perspective whose cursor was just moved (that snapshot is kept, so a later rewind of a perspective that ignores the carry-forward event does not restart from an empty model). Snapshots above the truncate point are untouched.
- **Processed perspective work rows** for the truncated events are removed.
- **Lapsed destruction holds** on truncated events are removed with them; active ones refuse the truncate (`held`).
- **Deduplication entries** are kept on purpose. They are what turns away a redelivered copy of a truncated event, and they expire under their own retention.
- **Stream integrity digests** subtract the truncated events in the same transaction, and the origin generation is bumped so consumers treat the change as deliberate. See [Stream Integrity](../../resilience/stream-integrity.md). Only events that were folded into a digest are subtracted and refolded: digest-exempt audit records (`EventAudited`, `CommandAudited`) are left out exactly as every fold leaves them out, and the origin generation advances only when the truncate removes folded events. A prefix holding only audit records changes nothing a consumer verifies, so it neither refolds sealed epochs nor advances the generation {verified: StreamDigestTableSqlTests.TruncateStreamPrefix_APrefixOfOnlyAnAuditRecord_IsNotAMutationOfFoldedHistoryAsync, StreamDigestTableSqlTests.TruncateStreamPrefix_APrefixHoldingAnAuditRecord_LeavesTheDigestEqualToAFreshFoldAsync}.

:::updated
Before migration 263, `wh_truncate_stream_prefix` read audit records into the ranges it refolds and into its digest subtraction. A prefix holding only audit records therefore refolded sealed epochs and advanced the origin generation, so every consumer reset its seals and re-verified although no folded history had changed. Migration 263 applies the folds' exemption to both reads; nothing else about the truncate changes.
:::

The Dapper and EF Core schemas behave the same way.

## Sealing a Stream {#sealing-a-stream}

A stream that has ended can be sealed: it keeps every event and stays readable, but every later append is refused. Seal
it explicitly with `IStreamFinalizer.FinalizeAsync(streamId, reason)`, or declare the event that ends it with
`[TerminalEvent]`, which seals the stream in the transaction that stores the event. A direct append to a sealed stream
throws `StreamSealedException`, and so does an outbox write its caller awaits (the immediate and scoped strategies);
a write nobody awaits dead-letters the refused event and stores the rest of its batch. Sealing is a stream's first step toward its end of life; see
[Stream End of Life](stream-end-of-life.md#sealing-a-stream) for the full behavior and every choice behind it.

```csharp{title="Seal a stream, explicitly or with a terminal event" description="Finalizes an order's stream, or lets the event that ends it seal the stream as it is stored." category="Core Concepts" difficulty="INTERMEDIATE" tags=["event-streams", "sealing", "terminal-event", "finalize"] tests=["StreamSealingSqlTests.Finalize_SealsTheStream_WithTheTimeAndTheReasonAsync", "StreamSealingSqlTests.TerminalEvent_DirectAppend_SealsTheStream_AndTheNextAppendThrowsAsync", "StreamSealingSqlTests.DirectAppend_ToASealedStream_ThrowsStreamSealedException_AndStoresNothingAsync"]}
// Explicitly: the order is archived, so its stream takes no more events.
await finalizer.FinalizeAsync(orderId, "Order archived after delivery");

try {
  await eventStore.AppendAsync(orderId, new OrderNoteAdded(orderId, "late note"));
} catch (StreamSealedException sealedStream) {
  // sealedStream.SealedAt and sealedStream.Reason say when and why the stream ended.
}

// Declaratively: storing an OrderCancelled seals the order's stream in the same transaction.
[TerminalEvent]
public sealed record OrderCancelled([property: StreamId] Guid OrderId, string Reason) : IEvent;
```

{verified: StreamSealingSqlTests.Finalize_SealsTheStream_WithTheTimeAndTheReasonAsync, StreamSealingSqlTests.TerminalEvent_DirectAppend_SealsTheStream_AndTheNextAppendThrowsAsync, StreamSealingSqlTests.DirectAppend_ToASealedStream_ThrowsStreamSealedException_AndStoresNothingAsync, DapperStreamSealingTests.AppendAsync_TerminalEvent_SealsTheStream_AndTheNextAppendThrowsStreamSealedExceptionAsync}

## Related Documentation

- [Events](events.md) - Event definition and EventId
- [Stream ID](stream-id.md) - IHasStreamId and auto-generation
- [Event Store](event-store.md) - Event persistence
- [Stream End of Life](stream-end-of-life.md) - The stream lifecycle ledger, and sealing a stream so it refuses appends
- [Perspectives](../perspectives/perspectives.md) - Read model projections

---

*Version 1.0.0 - Foundation Release*
