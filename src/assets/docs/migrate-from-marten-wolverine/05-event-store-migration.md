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

## Common Migration Scenarios

This section documents common migration patterns from Marten event store to Whizbang. Each scenario has a unique ID for traceability to automated migration tests.

---

### Scenario E01: Start Stream with ID Generation

**Marten Pattern (Before):**

```csharp
public async Task<Guid> CreateOrderAsync(CreateOrderCommand command, CancellationToken ct) {
    await using var session = _store.LightweightSession();

    var orderId = Guid.NewGuid();
    session.Events.StartStream<Order>(
        orderId,
        new OrderCreated(orderId, command.CustomerId, command.Items)
    );

    await session.SaveChangesAsync(ct);
    return orderId;
}
```

**Whizbang Pattern (After):**

```csharp
public async Task<OrderId> CreateOrderAsync(CreateOrderCommand command, CancellationToken ct) {
    var orderId = OrderId.New();

    await _eventStore.AppendAsync(
        orderId.Value,
        new OrderCreated(orderId, command.CustomerId, command.Items),
        ct);

    return orderId;
}
```

**Key Differences:**

- No session management (open, use, dispose)
- Strongly-typed ID (`OrderId`) instead of raw `Guid`
- Single atomic `AppendAsync()` replaces `StartStream` + `SaveChangesAsync()`
- ID generation via `OrderId.New()` uses configured `IWhizbangIdProvider`

**CLI Transformation:**

- [x] Supported by `whizbang migrate apply`
- Converts `StartStream<T>()` + `SaveChangesAsync()` to `AppendAsync()`

**Test Coverage:**

- `TransformAsync_E01_StartStreamWithGuid_TransformsToAppendAsync`

---

### Scenario E02: Basic Append to Existing Stream

**Marten Pattern (Before):**

```csharp
public async Task ShipOrderAsync(Guid orderId, CancellationToken ct) {
    await using var session = _store.LightweightSession();

    session.Events.Append(orderId, new OrderShipped(orderId, DateTime.UtcNow));

    await session.SaveChangesAsync(ct);
}
```

**Whizbang Pattern (After):**

```csharp
public async Task ShipOrderAsync(OrderId orderId, CancellationToken ct) {
    await _eventStore.AppendAsync(
        orderId.Value,
        new OrderShipped(orderId, DateTimeOffset.UtcNow),
        ct);
}
```

**Key Differences:**

- No session boilerplate
- `DateTimeOffset` preferred over `DateTime` for explicit timezone handling
- Single `AppendAsync()` call (no separate `SaveChangesAsync()`)

**CLI Transformation:**

- [x] Supported by `whizbang migrate apply`
- Detects `Append()` + `SaveChangesAsync()` pattern

**Test Coverage:**

- `TransformAsync_E02_AppendToStream_TransformsToAppendAsync`

---

### Scenario E03: Exclusive Append with Locking

**Marten Pattern (Before):**

```csharp
public async Task ProcessExclusiveAsync(Guid streamId, IEvent @event, CancellationToken ct) {
    await using var session = _store.LightweightSession();

    // AppendExclusive takes a lock on the stream
    session.Events.AppendExclusive(streamId, @event);

    await session.SaveChangesAsync(ct);
}
```

**Whizbang Pattern (After):**

```csharp
public async Task ProcessExclusiveAsync(StreamId streamId, IEvent @event, CancellationToken ct) {
    // Whizbang uses optimistic concurrency by default
    // For exclusive access, use expected sequence or distributed lock
    var lastSequence = await _eventStore.GetLastSequenceAsync(streamId.Value, ct);

    await _eventStore.AppendAsync(
        streamId.Value,
        @event,
        expectedSequence: lastSequence,
        ct);
}
```

**Key Differences:**

- No built-in `AppendExclusive()` - use optimistic concurrency
- For true exclusive access, combine with distributed locking (Redis, PostgreSQL advisory locks)
- Consider if exclusive access is actually needed

**CLI Transformation:**

- [x] Supported by `whizbang migrate apply`
- Warning: "AppendExclusive requires review - consider optimistic concurrency or distributed locks"

**Test Coverage:**

- `TransformAsync_E03_AppendExclusive_TransformsWithWarning`

---

### Scenario E04: Optimistic Concurrency Append

**Marten Pattern (Before):**

```csharp
public async Task UpdateWithVersionAsync(Guid streamId, int expectedVersion, IEvent @event, CancellationToken ct) {
    await using var session = _store.LightweightSession();

    session.Events.AppendOptimistic(streamId, @event);
    // Or: session.Events.Append(streamId, expectedVersion, @event);

    await session.SaveChangesAsync(ct);
}
```

**Whizbang Pattern (After):**

```csharp
public async Task UpdateWithVersionAsync(StreamId streamId, long expectedSequence, IEvent @event, CancellationToken ct) {
    await _eventStore.AppendAsync(
        streamId.Value,
        @event,
        expectedSequence: expectedSequence,
        ct);
}
```

**Key Differences:**

- `expectedSequence` parameter provides optimistic concurrency
- Throws `ConcurrencyException` on version mismatch
- Sequence is `long` (not `int`) for better range

**CLI Transformation:**

- [x] Supported by `whizbang migrate apply`
- Converts `AppendOptimistic` to `AppendAsync` with `expectedSequence`

**Test Coverage:**

- `TransformAsync_E04_AppendOptimistic_TransformsWithExpectedSequence`

---

### Scenario E05: CombGuid ID Generation

**Marten Pattern (Before):**

```csharp
using Marten.Schema.Identity;

public async Task<Guid> CreateWithCombGuidAsync(CreateCommand command, CancellationToken ct) {
    await using var session = _store.LightweightSession();

    // CombGuid generates sequential GUIDs for better index performance
    var streamId = CombGuidIdGeneration.NewGuid();

    session.Events.StartStream<MyAggregate>(streamId, new AggregateCreated(streamId));
    await session.SaveChangesAsync(ct);

    return streamId;
}
```

**Whizbang Pattern (After):**

```csharp
public async Task<MyAggregateId> CreateWithSequentialIdAsync(CreateCommand command, CancellationToken ct) {
    // TrackedGuid.NewMedo() generates sequential GUIDs (MEDO algorithm)
    var streamId = MyAggregateId.New(); // Uses TrackedGuid.NewMedo() internally

    await _eventStore.AppendAsync(
        streamId.Value,
        new AggregateCreated(streamId),
        ct);

    return streamId;
}
```

**Key Differences:**

- `TrackedGuid.NewMedo()` replaces `CombGuidIdGeneration.NewGuid()`
- MEDO algorithm provides similar sequential GUID benefits
- Strongly-typed IDs encapsulate the generation strategy

**CLI Transformation:**

- [x] Supported by `whizbang migrate apply`
- Converts `CombGuidIdGeneration.NewGuid()` to `TrackedGuid.NewMedo()`

**Test Coverage:**

- `TransformAsync_E05_CombGuidIdGeneration_TransformsToTrackedGuid`

---

### Scenario E06: Stream ID Collision Retry

**Marten Pattern (Before):**

```csharp
public async Task<Guid> CreateWithRetryAsync(CreateCommand command, CancellationToken ct) {
    const int maxAttempts = 5;

    for (var attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            await using var session = _store.LightweightSession();

            var streamId = Guid.NewGuid();
            session.Events.StartStream<MyAggregate>(streamId, new AggregateCreated(streamId));
            await session.SaveChangesAsync(ct);

            return streamId;
        }
        catch (Exception ex) when (ex.Message.Contains("duplicate key")) {
            if (attempt == maxAttempts - 1) throw;
            // Retry with new ID
        }
    }

    throw new InvalidOperationException("Failed to create stream after max attempts");
}
```

**Whizbang Pattern (After):**

```csharp
public async Task<MyAggregateId> CreateWithRetryAsync(CreateCommand command, CancellationToken ct) {
    // TrackedGuid provides virtually collision-free IDs
    // Built-in retry policies handle rare collisions
    var streamId = MyAggregateId.New();

    await _eventStore.AppendAsync(
        streamId.Value,
        new AggregateCreated(streamId),
        ct);

    return streamId;
}
```

**Key Differences:**

- `TrackedGuid.NewMedo()` is virtually collision-free (timestamp + random)
- Retry logic typically unnecessary with proper ID generation
- If needed, use Polly or similar for retry policies

**CLI Transformation:**

- [x] Supported by `whizbang migrate apply`
- Warning: "Consider if retry logic is still needed with TrackedGuid"

**Test Coverage:**

- `TransformAsync_E06_CollisionRetry_SimplifiesToSingleAppend`

---

### Scenario E07: SaveChangesAsync Removal (Strategy-Based)

**Marten Pattern (Before):**

```csharp
public async Task ComplexOperationAsync(Guid orderId, CancellationToken ct) {
    await using var session = _store.LightweightSession();

    session.Events.Append(orderId, new OrderUpdated(orderId, "step1"));
    session.Events.Append(orderId, new OrderUpdated(orderId, "step2"));
    session.Events.Append(orderId, new OrderUpdated(orderId, "step3"));

    // All events committed atomically
    await session.SaveChangesAsync(ct);
}
```

**Whizbang Pattern (After):**

```csharp
public async Task ComplexOperationAsync(OrderId orderId, CancellationToken ct) {
    // Use batch append for multiple events to same stream
    var events = new IEvent[] {
        new OrderUpdated(orderId, "step1"),
        new OrderUpdated(orderId, "step2"),
        new OrderUpdated(orderId, "step3")
    };

    await _eventStore.AppendBatchAsync(orderId.Value, events, ct);
}
```

**Key Differences:**

- No `SaveChangesAsync()` - each `AppendAsync()` is atomic
- Use `AppendBatchAsync()` for multiple events to maintain atomicity
- No session state management needed

:::note[Persistence Strategy]
Whether `SaveChangesAsync()` is needed depends on your **persistence strategy**. Different areas of an application may use different strategies:

| Strategy | Behavior | SaveChanges Needed? |
|----------|----------|---------------------|
| **Immediate** (default) | Each `AppendAsync()` commits immediately | No |
| **Batched** | Events buffered until `FlushAsync()` | Yes (`FlushAsync`) |
| **Outbox** | Events queued for reliable delivery | No (coordinator handles) |

Configure per-receptor with `[PersistenceStrategy]` attribute:

```csharp
// Use default strategy (configured globally)
public class OrderReceptor : IReceptor<CreateOrder, OrderCreated> { }

// Override with specific strategy
[PersistenceStrategy(PersistenceMode.Immediate)]
public class CriticalPaymentReceptor : IReceptor<ProcessPayment, PaymentProcessed> { }

// Use named custom strategy from appsettings.json
[PersistenceStrategy("high-throughput-batch")]
public class EventIngestionReceptor : IReceptor<IngestEvent, EventIngested> { }
```
:::

**CLI Transformation:**

- [x] Supported by `whizbang migrate apply`
- Detects multiple `Append()` calls and suggests `AppendBatchAsync()`
- Generates `[PersistenceStrategy]` attribute based on wizard decisions

**Test Coverage:**

- `TransformAsync_E07_MultipleAppends_TransformsToAppendBatch`

---

### Scenario E08: Batch Append Without Session

**Marten Pattern (Before):**

```csharp
public async Task BatchCreateAsync(IReadOnlyList<CreateItemCommand> commands, CancellationToken ct) {
    await using var session = _store.LightweightSession();

    foreach (var command in commands) {
        var itemId = Guid.NewGuid();
        session.Events.StartStream<Item>(itemId, new ItemCreated(itemId, command.Name));
    }

    await session.SaveChangesAsync(ct);
}
```

**Whizbang Pattern (After):**

```csharp
public async Task BatchCreateAsync(IReadOnlyList<CreateItemCommand> commands, CancellationToken ct) {
    // For cross-stream atomicity, use work coordinator
    await using var work = await _workCoordinator.BeginAsync(ct);

    foreach (var command in commands) {
        var itemId = ItemId.New();
        await _eventStore.AppendAsync(
            itemId.Value,
            new ItemCreated(itemId, command.Name),
            ct);
    }

    await work.CommitAsync(ct);
}
```

**Key Differences:**

- Cross-stream transactions require `IWorkCoordinator`
- Single-stream batch uses `AppendBatchAsync()`
- Each stream is independent by default

**CLI Transformation:**

- [x] Supported by `whizbang migrate apply`
- Detects multi-stream batch patterns and suggests `IWorkCoordinator`

**Test Coverage:**

- `TransformAsync_E08_BatchAppend_TransformsWithWorkCoordinator`

---

### Scenario E09: Tenant-Scoped Event Store

**Marten Pattern (Before):**

```csharp
public class TenantAwareService {
    private readonly IDocumentStore _store;
    private readonly ITenantContext _tenantContext;

    public async Task CreateAsync(CreateCommand command, CancellationToken ct) {
        // Marten session scoped to tenant
        await using var session = _store.LightweightSession(_tenantContext.TenantId);

        var id = Guid.NewGuid();
        session.Events.StartStream<MyAggregate>(id, new Created(id));
        await session.SaveChangesAsync(ct);
    }
}
```

**Whizbang Pattern (After):**

```csharp
public class TenantAwareService(IEventStore eventStore, ITenantContext tenantContext) {
    public async Task CreateAsync(CreateCommand command, CancellationToken ct) {
        // Tenant context flows through scoped DI
        // IEventStore is already tenant-aware via DI scope
        var id = MyAggregateId.New();

        await eventStore.AppendAsync(
            id.Value,
            new Created(id),
            ct);
    }
}
```

**Key Differences:**

- Tenant context handled via scoped DI, not session parameter
- `IEventStore` resolves tenant from ambient context
- No explicit tenant parameter in store operations

**CLI Transformation:**

- [x] Supported by `whizbang migrate apply`
- Warning: "Ensure ITenantContext is registered as scoped service"

**Test Coverage:**

- `TransformAsync_E09_TenantScopedSession_TransformsToScopedEventStore`

---

## Scenario Coverage Matrix

| Scenario | Pattern | CLI Support | Test |
|----------|---------|-------------|------|
| E01 | StartStream with ID | ✅ Full | ✅ |
| E02 | Basic Append | ✅ Full | ✅ |
| E03 | AppendExclusive | ⚠️ Warning | ✅ |
| E04 | AppendOptimistic | ✅ Full | ✅ |
| E05 | CombGuid ID | ✅ Full | ✅ |
| E06 | Collision Retry | ⚠️ Warning | ✅ |
| E07 | SaveChangesAsync | ✅ Full | ✅ |
| E08 | Batch Append | ✅ Full | ✅ |
| E09 | Tenant-Scoped | ⚠️ Warning | ✅ |

---

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
