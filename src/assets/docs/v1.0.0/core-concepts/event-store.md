# Event Store

The `IEventStore` interface provides append-only event storage for event sourcing patterns. It supports stream-based storage with automatic sequence numbering, polymorphic reads, and synchronous verification via `AppendAndWaitAsync`.

## Overview

Whizbang's event store is designed for:

- **Append-only storage** - Events are immutable once written
- **Stream-based organization** - Events grouped by aggregate ID
- **Polymorphic reads** - Read multiple event types from a stream
- **AOT compatibility** - Generic methods avoid reflection
- **Sync verification** - Wait for perspectives to process events

## Basic Usage

### Appending Events

```csharp
public class OrderHandler {
  private readonly IEventStore _eventStore;

  public async Task CreateOrder(CreateOrderCommand cmd) {
    var orderId = Guid.NewGuid();
    var evt = new OrderCreatedEvent(orderId, cmd.CustomerId, cmd.Items);

    // Append to stream identified by orderId
    await _eventStore.AppendAsync(orderId, evt);
  }
}
```

### Reading Events

```csharp
// Read all events of a specific type
await foreach (var envelope in _eventStore.ReadAsync<OrderCreatedEvent>(orderId, fromSequence: 0)) {
  var evt = envelope.Payload;
  // Process event
}

// Read from a specific event ID
await foreach (var envelope in _eventStore.ReadAsync<OrderEvent>(orderId, fromEventId: lastProcessedId)) {
  // Process events after the checkpoint
}
```

## AppendAndWaitAsync {#append-and-wait}

The `AppendAndWaitAsync` method appends an event and waits for a perspective to process it. This enables synchronous-feeling APIs over event sourcing.

### AppendAndWaitEventStoreDecorator

The `AppendAndWaitAsync` functionality is provided by the `AppendAndWaitEventStoreDecorator`, which wraps the base event store implementation. This decorator:

- **Tracks sync requests** using `ISyncCoordinator`
- **Waits for perspective processing** via polling or event notification
- **Times out gracefully** if perspective processing takes too long
- **Returns sync results** with timing and event count details

The decorator is automatically applied when using `DecorateEventStoreWithSyncTracking()`, which is called by data providers during registration.

### Usage

```csharp
var syncResult = await _eventStore.AppendAndWaitAsync<OrderCreatedEvent, OrderProjection>(
    streamId: orderId,
    message: new OrderCreatedEvent(orderId, customerId, items),
    timeout: TimeSpan.FromSeconds(10));

// Event has been appended AND OrderProjection has processed it
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `streamId` | `Guid` | The stream/aggregate ID |
| `message` | `TMessage` | The event to append |
| `timeout` | `TimeSpan?` | Maximum wait time (default: 30 seconds) |
| `cancellationToken` | `CancellationToken` | Cancellation token |

### SyncResult

Returns a `SyncResult` with the outcome:

```csharp
var result = await eventStore.AppendAndWaitAsync<OrderCreatedEvent, OrderProjection>(
    streamId, evt);

switch (result.Outcome) {
  case SyncOutcome.Synced:
    Console.WriteLine($"Synced {result.EventCount} events in {result.Elapsed}");
    break;
  case SyncOutcome.Timeout:
    Console.WriteLine("Event appended but perspective sync timed out");
    break;
  case SyncOutcome.NoPendingEvents:
    Console.WriteLine("No events to process");
    break;
}
```

### When to Use

Use `AppendAndWaitAsync` when:

- You need to verify a specific projection processed an event before returning
- Implementing request-response patterns over event sourcing
- Building APIs that need immediate consistency with a particular read model

For higher-level patterns that wait for ALL perspectives, see [LocalInvokeAndSyncAsync](./dispatcher#localinvokeandsyncasync---invoke-with-perspective-sync).

## Security Context Propagation

When appending events with the message-only overload (`AppendAsync<TMessage>(streamId, message)`), the event store automatically propagates security context from the ambient scope.

This happens via the `SecurityContextEventStoreDecorator`:

```csharp
// Security context from ScopeContextAccessor.CurrentContext is auto-propagated
await _eventStore.AppendAsync(orderId, new OrderCreatedEvent(...));

// The envelope will contain SecurityContext with UserId and TenantId
```

This ensures:
- **Audit trails** - Events record who performed the action
- **Multi-tenancy** - Events are tagged with tenant ID
- **Traceability** - Security context flows through the event chain

### When Context is Propagated

Security context is propagated when:
1. `ScopeContextAccessor.CurrentContext` contains an `ImmutableScopeContext`
2. The context has `ShouldPropagate = true`

```csharp
// Context is set by middleware or scope initialization
var extraction = new SecurityExtraction {
  Scope = new PerspectiveScope { UserId = "user-123", TenantId = "tenant-456" },
  // ...
};
ScopeContextAccessor.CurrentContext = new ImmutableScopeContext(extraction, shouldPropagate: true);

// Events now include this security context
await _eventStore.AppendAsync(orderId, evt);
```

## IEventStore Interface

```csharp
public interface IEventStore {
  // Append with envelope (full control)
  Task AppendAsync<TMessage>(Guid streamId, MessageEnvelope<TMessage> envelope, CancellationToken ct = default);

  // Append with message (auto-creates envelope with security context)
  Task AppendAsync<TMessage>(Guid streamId, TMessage message, CancellationToken ct = default)
      where TMessage : notnull;

  // Append and wait for perspective sync
  Task<SyncResult> AppendAndWaitAsync<TMessage, TPerspective>(
      Guid streamId, TMessage message, TimeSpan? timeout = null, CancellationToken ct = default)
      where TMessage : notnull
      where TPerspective : class;

  // Read by sequence number
  IAsyncEnumerable<MessageEnvelope<TMessage>> ReadAsync<TMessage>(
      Guid streamId, long fromSequence, CancellationToken ct = default);

  // Read after event ID (checkpoint-based)
  IAsyncEnumerable<MessageEnvelope<TMessage>> ReadAsync<TMessage>(
      Guid streamId, Guid? fromEventId, CancellationToken ct = default);

  // Read multiple event types
  IAsyncEnumerable<MessageEnvelope<IEvent>> ReadPolymorphicAsync(
      Guid streamId, Guid? fromEventId, IReadOnlyList<Type> eventTypes, CancellationToken ct = default);

  // Get events between checkpoints
  Task<List<MessageEnvelope<TMessage>>> GetEventsBetweenAsync<TMessage>(
      Guid streamId, Guid? afterEventId, Guid upToEventId, CancellationToken ct = default);

  // Get last sequence number
  Task<long> GetLastSequenceAsync(Guid streamId, CancellationToken ct = default);
}
```

## Decorator Stack

Whizbang applies decorators to enhance event store functionality:

```
IEventStore (your code calls this)
└─ AppendAndWaitEventStoreDecorator (enables AppendAndWaitAsync)
   └─ SyncTrackingEventStoreDecorator (tracks events for sync)
      └─ SecurityContextEventStoreDecorator (propagates security context)
         └─ Base IEventStore (e.g., EFCoreEventStore, DapperEventStore)
```

These decorators are automatically applied when using `DecorateEventStoreWithSyncTracking()`, which is called by data providers.

## Registration

Event stores are registered by data providers:

```csharp
services.AddWhizbang()
    .WithEFCore<MyDbContext>()
    .WithDriver.Postgres;  // Registers EFCoreEventStore with decorators
```

The decorators are applied automatically by `DecorateEventStoreWithSyncTracking()`.

## Related Documentation

- [Dispatcher](./dispatcher#localinvokeandsyncasync---invoke-with-perspective-sync) - LocalInvokeAndSyncAsync for request-response patterns
- [Perspectives](./perspectives) - Read model projections
- [Event Store Query](./event-store-query) - Querying events
- [Message Security](./message-security) - Security context
