# Migrate from Marten/Wolverine: Event Store Migration

This guide covers migrating from Marten's `IDocumentStore` to Whizbang's `IEventStore`.

## Overview

| Marten | Whizbang |
|--------|----------|
| `IDocumentStore` | `IEventStore` |
| `IDocumentSession` | Direct `IEventStore` methods |
| `StartStream<T>()` | `AppendAsync()` with new stream ID |
| `Append()` + `SaveChangesAsync()` | Single `AppendAsync()` call |
| `FetchStreamAsync()` | `ReadAsync()` |

## Basic Operations

### Creating a Stream

#### Before: Marten

```csharp
await using var session = _store.LightweightSession();
var streamId = session.Events.StartStream<Order>(
    new OrderCreated(orderId, customerId, items)
).Id;
await session.SaveChangesAsync();
```

#### After: Whizbang

```csharp
var streamId = Guid.NewGuid();
await _eventStore.AppendAsync(streamId, new OrderCreated(orderId, customerId, items), ct);
```

### Appending Events

#### Before: Marten

```csharp
await using var session = _store.LightweightSession();
session.Events.Append(streamId, new OrderShipped(streamId, DateTime.UtcNow));
await session.SaveChangesAsync();
```

#### After: Whizbang

```csharp
await _eventStore.AppendAsync(streamId, new OrderShipped(streamId, DateTimeOffset.UtcNow), ct);
```

### Reading Events

#### Before: Marten

```csharp
await using var session = _store.QuerySession();
var events = await session.Events.FetchStreamAsync(streamId);
```

#### After: Whizbang

```csharp
var events = _eventStore.ReadAsync<IEvent>(streamId, fromSequence: 0, ct);
await foreach (var envelope in events) {
    // envelope.Payload contains the event
    // envelope.Metadata contains correlation ID, timestamp, etc.
}
```

## Working with Message Envelopes

Whizbang wraps events in `MessageEnvelope<T>` for metadata:

```csharp
public class OrderService {
  private readonly IEventStore _eventStore;

  public async Task CreateOrderAsync(CreateOrderCommand command, CancellationToken ct) {
    var orderId = Guid.NewGuid();
    var @event = new OrderCreated(orderId, command.CustomerId, command.Items);

    // Option 1: Simple append (envelope created automatically)
    await _eventStore.AppendAsync(orderId, @event, ct);

    // Option 2: Explicit envelope with custom metadata
    var envelope = new MessageEnvelope<OrderCreated> {
      MessageId = MessageId.New(),
      Payload = @event,
      CorrelationId = command.CorrelationId,
      Metadata = new Dictionary<string, string> {
        ["tenant_id"] = command.TenantId,
        ["user_id"] = command.UserId.ToString()
      }
    };
    await _eventStore.AppendAsync(orderId, envelope, ct);
  }
}
```

## Aggregate Rehydration

### Before: Marten

```csharp
await using var session = _store.LightweightSession();
var order = await session.Events.AggregateStreamAsync<Order>(streamId);
```

### After: Whizbang

```csharp
// Option 1: Use perspective for read model
var orderView = await _perspectiveReader.GetAsync<OrderView>(streamId, ct);

// Option 2: Manual rehydration
var order = new Order();
await foreach (var envelope in _eventStore.ReadAsync<IOrderEvent>(streamId, 0, ct)) {
    order.Apply(envelope.Payload);
}
```

## Optimistic Concurrency

### Before: Marten

```csharp
await using var session = _store.LightweightSession();
session.Events.Append(streamId, expectedVersion, @event);
await session.SaveChangesAsync(); // Throws on version mismatch
```

### After: Whizbang

```csharp
try {
    await _eventStore.AppendAsync(streamId, @event, expectedSequence: 5, ct);
}
catch (ConcurrencyException ex) {
    // Handle version conflict
    _logger.LogWarning("Concurrency conflict on stream {StreamId}", streamId);
}
```

## Batch Operations

### Appending Multiple Events

```csharp
// Append multiple events to the same stream atomically
var events = new object[] {
    new OrderCreated(orderId, customerId, items),
    new PaymentReceived(orderId, amount),
    new OrderConfirmed(orderId)
};

await _eventStore.AppendBatchAsync(streamId, events, ct);
```

### Multi-Stream Transactions

```csharp
// For cross-stream consistency, use IWorkCoordinator
await using var work = await _workCoordinator.BeginAsync(ct);

await _eventStore.AppendAsync(orderStreamId, new OrderCreated(...), ct);
await _eventStore.AppendAsync(inventoryStreamId, new InventoryReserved(...), ct);

await work.CommitAsync(ct);
```

## Stream Metadata

### Getting Stream Info

```csharp
var lastSequence = await _eventStore.GetLastSequenceAsync(streamId, ct);
var exists = lastSequence > 0;
```

### Checking Stream Existence

```csharp
var exists = await _eventStore.StreamExistsAsync(streamId, ct);
```

## Schema Migration

### During Migration Period

Run both stores in parallel with separate schemas:

```csharp
builder.Services.AddMarten(options => {
    options.Connection(connectionString);
    options.DatabaseSchemaName = "marten"; // Existing schema
});

builder.Services.AddWhizbang(options => {
    options.UsePostgresEventStore(connectionString);
    options.SchemaName = "whizbang"; // New schema
});
```

### Dual-Write Pattern

Write to both stores during migration:

```csharp
public class DualWriteEventStore : IEventStore {
  private readonly IDocumentSession _martenSession;
  private readonly IEventStore _whizbangStore;

  public async Task AppendAsync<T>(Guid streamId, T @event, CancellationToken ct) {
    // Write to Marten (existing)
    _martenSession.Events.Append(streamId, @event);
    await _martenSession.SaveChangesAsync(ct);

    // Write to Whizbang (new)
    await _whizbangStore.AppendAsync(streamId, @event, ct);
  }
}
```

### Data Migration Script

For migrating existing events:

```csharp
public class EventMigrationService {
  private readonly IDocumentStore _martenStore;
  private readonly IEventStore _whizbangStore;

  public async Task MigrateStreamAsync(Guid streamId, CancellationToken ct) {
    await using var session = _martenStore.QuerySession();
    var martenEvents = await session.Events.FetchStreamAsync(streamId);

    foreach (var martenEvent in martenEvents) {
      var envelope = new MessageEnvelope<object> {
        MessageId = MessageId.New(),
        Payload = martenEvent.Data,
        Timestamp = martenEvent.Timestamp,
        Metadata = new Dictionary<string, string> {
          ["marten_sequence"] = martenEvent.Sequence.ToString(),
          ["migrated_at"] = DateTimeOffset.UtcNow.ToString("O")
        }
      };

      await _whizbangStore.AppendAsync(streamId, envelope, ct);
    }
  }
}
```

## Checklist

- [ ] Replace `IDocumentStore` injection with `IEventStore`
- [ ] Replace `IDocumentSession` usage with direct `IEventStore` methods
- [ ] Convert `StartStream<T>()` to `AppendAsync()` with new GUID
- [ ] Convert `Append()` + `SaveChangesAsync()` to single `AppendAsync()`
- [ ] Convert `FetchStreamAsync()` to `ReadAsync()`
- [ ] Update optimistic concurrency checks
- [ ] Plan data migration strategy (dual-write vs batch migration)
- [ ] Configure separate schemas during migration period
- [ ] Update tests to use Whizbang test fixtures

## Next Steps

- [Transport Configuration](./06-transport-configuration.md) - Configure messaging transports
