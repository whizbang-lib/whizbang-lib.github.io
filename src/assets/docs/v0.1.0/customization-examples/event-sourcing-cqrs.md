---
title: "Event Sourcing & CQRS"
version: 0.1.0
category: Customization Examples
order: 2
description: "Implement full event sourcing with CQRS - event store, snapshots, temporal queries, and projections"
tags: event-sourcing, cqrs, event-store, snapshots, temporal-queries
---

# Event Sourcing & CQRS

Implement **full event sourcing with CQRS** using Whizbang - event store, aggregate reconstruction, snapshots, temporal queries, and read model projections.

---

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│  Event Sourcing Architecture                               │
│                                                             │
│  WRITE SIDE (Commands)                                     │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  1. Load Aggregate from Event Store                  │  │
│  │  2. Execute Command (domain logic)                   │  │
│  │  3. Generate Events                                  │  │
│  │  4. Persist Events to Event Store                    │  │
│  │  5. Publish Events to Bus                            │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Event Store (Append-Only Log)                       │  │
│  │  ┌────────┬────────┬────────┬────────┬────────┐      │  │
│  │  │Event 1 │Event 2 │Event 3 │Event 4 │Event 5 │      │  │
│  │  └────────┴────────┴────────┴────────┴────────┘      │  │
│  └──────────────────────────────────────────────────────┘  │
│                          │                                  │
│                          ▼                                  │
│  READ SIDE (Queries)                                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Projections (Perspectives)                          │  │
│  │  - OrderSummaryProjection                            │  │
│  │  - CustomerActivityProjection                        │  │
│  │  - InventoryProjection                               │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

---

## Event Store Schema

**Migrations/001_CreateEventStore.sql**:

```sql
CREATE TABLE event_store (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id UUID NOT NULL,
  stream_type TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL,
  event_data JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_stream_version UNIQUE (stream_id, event_version)
);

CREATE INDEX idx_event_store_stream_id ON event_store(stream_id);
CREATE INDEX idx_event_store_timestamp ON event_store(timestamp DESC);
CREATE INDEX idx_event_store_event_type ON event_store(event_type);

-- Snapshots for performance (optional)
CREATE TABLE event_store_snapshots (
  snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id UUID NOT NULL UNIQUE,
  stream_type TEXT NOT NULL,
  version INTEGER NOT NULL,
  state JSONB NOT NULL,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_snapshots_stream_id ON event_store_snapshots(stream_id);
```

---

## Domain Events

**OrderEvents.cs**:

```csharp
public record OrderCreatedEvent(
  string CustomerId,
  OrderItem[] Items,
  decimal TotalAmount,
  DateTime CreatedAt
);

public record PaymentProcessedEvent(
  string PaymentId,
  decimal Amount,
  DateTime ProcessedAt
);

public record OrderShippedEvent(
  string TrackingNumber,
  DateTime ShippedAt
);

public record OrderCancelledEvent(
  string Reason,
  DateTime CancelledAt
);
```

---

## Aggregate Root

**OrderAggregate.cs**:

```csharp
public class OrderAggregate {
  private readonly List<object> _uncommittedEvents = [];

  // State
  public Guid OrderId { get; private set; }
  public string? CustomerId { get; private set; }
  public decimal TotalAmount { get; private set; }
  public OrderStatus Status { get; private set; }
  public int Version { get; private set; }

  // Create new aggregate
  public static OrderAggregate Create(
    Guid orderId,
    string customerId,
    OrderItem[] items
  ) {
    var aggregate = new OrderAggregate();
    var totalAmount = items.Sum(i => i.Quantity * i.UnitPrice);

    var @event = new OrderCreatedEvent(
      CustomerId: customerId,
      Items: items,
      TotalAmount: totalAmount,
      CreatedAt: DateTime.UtcNow
    );

    aggregate.Apply(@event);
    aggregate._uncommittedEvents.Add(@event);

    return aggregate;
  }

  // Load from event history
  public static OrderAggregate LoadFromHistory(IEnumerable<object> events) {
    var aggregate = new OrderAggregate();
    foreach (var @event in events) {
      aggregate.Apply(@event);
      aggregate.Version++;
    }
    return aggregate;
  }

  // Commands
  public void ProcessPayment(string paymentId, decimal amount) {
    if (Status != OrderStatus.Pending) {
      throw new InvalidOperationException($"Cannot process payment for order in {Status} status");
    }

    var @event = new PaymentProcessedEvent(
      PaymentId: paymentId,
      Amount: amount,
      ProcessedAt: DateTime.UtcNow
    );

    Apply(@event);
    _uncommittedEvents.Add(@event);
  }

  public void Ship(string trackingNumber) {
    if (Status != OrderStatus.PaymentProcessed) {
      throw new InvalidOperationException($"Cannot ship order in {Status} status");
    }

    var @event = new OrderShippedEvent(
      TrackingNumber: trackingNumber,
      ShippedAt: DateTime.UtcNow
    );

    Apply(@event);
    _uncommittedEvents.Add(@event);
  }

  public void Cancel(string reason) {
    if (Status == OrderStatus.Shipped || Status == OrderStatus.Delivered) {
      throw new InvalidOperationException($"Cannot cancel order in {Status} status");
    }

    var @event = new OrderCancelledEvent(
      Reason: reason,
      CancelledAt: DateTime.UtcNow
    );

    Apply(@event);
    _uncommittedEvents.Add(@event);
  }

  // Event application (state transitions)
  private void Apply(OrderCreatedEvent @event) {
    OrderId = Guid.NewGuid();
    CustomerId = @event.CustomerId;
    TotalAmount = @event.TotalAmount;
    Status = OrderStatus.Pending;
  }

  private void Apply(PaymentProcessedEvent @event) {
    Status = OrderStatus.PaymentProcessed;
  }

  private void Apply(OrderShippedEvent @event) {
    Status = OrderStatus.Shipped;
  }

  private void Apply(OrderCancelledEvent @event) {
    Status = OrderStatus.Cancelled;
  }

  // Apply dynamic event
  private void Apply(object @event) {
    switch (@event) {
      case OrderCreatedEvent e:
        Apply(e);
        break;
      case PaymentProcessedEvent e:
        Apply(e);
        break;
      case OrderShippedEvent e:
        Apply(e);
        break;
      case OrderCancelledEvent e:
        Apply(e);
        break;
      default:
        throw new InvalidOperationException($"Unknown event type: {@event.GetType().Name}");
    }
  }

  // Get uncommitted events for persistence
  public IEnumerable<object> GetUncommittedEvents() => _uncommittedEvents;

  // Clear after persistence
  public void MarkChangesAsCommitted() => _uncommittedEvents.Clear();
}

public enum OrderStatus {
  Pending,
  PaymentProcessed,
  Shipped,
  Delivered,
  Cancelled
}
```

---

## Event Store Repository

**EventStoreRepository.cs**:

```csharp
public class EventStoreRepository {
  private readonly NpgsqlConnection _db;
  private readonly ILogger<EventStoreRepository> _logger;

  public async Task<OrderAggregate?> LoadAsync(
    Guid streamId,
    CancellationToken ct = default
  ) {
    // 1. Try to load from snapshot
    var snapshot = await _db.QuerySingleOrDefaultAsync<SnapshotRow>(
      """
      SELECT version, state
      FROM event_store_snapshots
      WHERE stream_id = @StreamId
      """,
      new { StreamId = streamId }
    );

    var fromVersion = 0;
    OrderAggregate? aggregate = null;

    if (snapshot != null) {
      // Deserialize snapshot
      var state = JsonSerializer.Deserialize<OrderAggregateState>(snapshot.State);
      aggregate = OrderAggregate.FromSnapshot(state!);
      fromVersion = snapshot.Version + 1;

      _logger.LogInformation(
        "Loaded aggregate {StreamId} from snapshot at version {Version}",
        streamId,
        snapshot.Version
      );
    }

    // 2. Load events after snapshot
    var events = await _db.QueryAsync<EventRow>(
      """
      SELECT event_type, event_data, event_version
      FROM event_store
      WHERE stream_id = @StreamId AND event_version >= @FromVersion
      ORDER BY event_version ASC
      """,
      new { StreamId = streamId, FromVersion = fromVersion }
    );

    if (!events.Any() && aggregate == null) {
      return null;  // Aggregate doesn't exist
    }

    // 3. Reconstruct aggregate from events
    var domainEvents = events.Select(e => DeserializeEvent(e.EventType, e.EventData));

    if (aggregate == null) {
      aggregate = OrderAggregate.LoadFromHistory(domainEvents);
    } else {
      aggregate.ApplyEvents(domainEvents);
    }

    _logger.LogInformation(
      "Loaded aggregate {StreamId} with {EventCount} events",
      streamId,
      events.Count()
    );

    return aggregate;
  }

  public async Task SaveAsync(
    OrderAggregate aggregate,
    CancellationToken ct = default
  ) {
    var uncommittedEvents = aggregate.GetUncommittedEvents().ToArray();
    if (!uncommittedEvents.Any()) {
      return;  // No changes to persist
    }

    await using var tx = await _db.BeginTransactionAsync(ct);

    try {
      var currentVersion = aggregate.Version - uncommittedEvents.Length;

      // Persist events
      foreach (var @event in uncommittedEvents) {
        currentVersion++;

        await _db.ExecuteAsync(
          """
          INSERT INTO event_store (stream_id, stream_type, event_type, event_version, event_data, metadata)
          VALUES (@StreamId, @StreamType, @EventType, @EventVersion, @EventData::jsonb, @Metadata::jsonb)
          """,
          new {
            StreamId = aggregate.OrderId,
            StreamType = "Order",
            EventType = @event.GetType().Name,
            EventVersion = currentVersion,
            EventData = JsonSerializer.Serialize(@event),
            Metadata = JsonSerializer.Serialize(new { Timestamp = DateTime.UtcNow })
          },
          transaction: tx
        );
      }

      // Optional: Create snapshot every N events
      if (currentVersion % 100 == 0) {
        await SaveSnapshotAsync(aggregate, currentVersion, tx, ct);
      }

      await tx.CommitAsync(ct);

      aggregate.MarkChangesAsCommitted();

      _logger.LogInformation(
        "Saved {EventCount} events for aggregate {StreamId}, version {Version}",
        uncommittedEvents.Length,
        aggregate.OrderId,
        currentVersion
      );
    } catch {
      await tx.RollbackAsync(ct);
      throw;
    }
  }

  private async Task SaveSnapshotAsync(
    OrderAggregate aggregate,
    int version,
    NpgsqlTransaction tx,
    CancellationToken ct
  ) {
    var state = aggregate.ToSnapshot();

    await _db.ExecuteAsync(
      """
      INSERT INTO event_store_snapshots (stream_id, stream_type, version, state)
      VALUES (@StreamId, @StreamType, @Version, @State::jsonb)
      ON CONFLICT (stream_id) DO UPDATE SET
        version = @Version,
        state = @State::jsonb,
        timestamp = NOW()
      """,
      new {
        StreamId = aggregate.OrderId,
        StreamType = "Order",
        Version = version,
        State = JsonSerializer.Serialize(state)
      },
      transaction: tx
    );

    _logger.LogInformation(
      "Created snapshot for aggregate {StreamId} at version {Version}",
      aggregate.OrderId,
      version
    );
  }

  private object DeserializeEvent(string eventType, string eventData) {
    var type = Type.GetType($"YourNamespace.{eventType}")
      ?? throw new InvalidOperationException($"Unknown event type: {eventType}");

    return JsonSerializer.Deserialize(eventData, type)!;
  }
}

public record EventRow(string EventType, string EventData, int EventVersion);
public record SnapshotRow(int Version, string State);
```

---

## Command Handler (Receptor)

**CreateOrderReceptor.cs**:

```csharp
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
  private readonly EventStoreRepository _eventStore;
  private readonly IMessageBus _bus;
  private readonly ILogger<CreateOrderReceptor> _logger;

  public async Task<OrderCreated> HandleAsync(
    CreateOrder command,
    CancellationToken ct = default
  ) {
    // 1. Create aggregate
    var aggregate = OrderAggregate.Create(
      orderId: Guid.NewGuid(),
      customerId: command.CustomerId,
      items: command.Items
    );

    // 2. Save to event store
    await _eventStore.SaveAsync(aggregate, ct);

    // 3. Publish events to bus
    foreach (var @event in aggregate.GetUncommittedEvents()) {
      await _bus.PublishAsync(@event, ct);
    }

    _logger.LogInformation(
      "Order {OrderId} created for customer {CustomerId}",
      aggregate.OrderId,
      command.CustomerId
    );

    return new OrderCreated(
      OrderId: aggregate.OrderId.ToString(),
      CustomerId: command.CustomerId,
      Items: command.Items,
      TotalAmount: aggregate.TotalAmount,
      CreatedAt: DateTime.UtcNow
    );
  }
}
```

---

## Temporal Queries

**Get aggregate state at specific point in time**:

```csharp
public class EventStoreQueryService {
  private readonly NpgsqlConnection _db;

  public async Task<OrderAggregate?> LoadAsOfAsync(
    Guid streamId,
    DateTime asOf,
    CancellationToken ct = default
  ) {
    // Load events up to specified timestamp
    var events = await _db.QueryAsync<EventRow>(
      """
      SELECT event_type, event_data
      FROM event_store
      WHERE stream_id = @StreamId AND timestamp <= @AsOf
      ORDER BY event_version ASC
      """,
      new { StreamId = streamId, AsOf = asOf }
    );

    if (!events.Any()) {
      return null;
    }

    var domainEvents = events.Select(e => DeserializeEvent(e.EventType, e.EventData));
    return OrderAggregate.LoadFromHistory(domainEvents);
  }
}
```

**Usage**:

```csharp
// Get order state as of yesterday
var orderYesterday = await queryService.LoadAsOfAsync(
  orderId,
  asOf: DateTime.UtcNow.AddDays(-1)
);

Console.WriteLine($"Order status yesterday: {orderYesterday?.Status}");
```

---

## Projections (Read Models)

**OrderSummaryProjection.cs**:

```csharp
public class OrderSummaryProjection :
  IPerspectiveOf<OrderCreatedEvent>,
  IPerspectiveOf<PaymentProcessedEvent>,
  IPerspectiveOf<OrderShippedEvent> {

  private readonly NpgsqlConnection _db;
  private readonly ILogger<OrderSummaryProjection> _logger;

  public async Task HandleAsync(
    OrderCreatedEvent @event,
    CancellationToken ct = default
  ) {
    await _db.ExecuteAsync(
      """
      INSERT INTO order_summary (order_id, customer_id, total_amount, status, created_at)
      VALUES (@OrderId, @CustomerId, @TotalAmount, 'Pending', @CreatedAt)
      """,
      new {
        OrderId = Guid.NewGuid(),  // From event metadata
        CustomerId = @event.CustomerId,
        TotalAmount = @event.TotalAmount,
        CreatedAt = @event.CreatedAt
      }
    );
  }

  public async Task HandleAsync(
    PaymentProcessedEvent @event,
    CancellationToken ct = default
  ) {
    await _db.ExecuteAsync(
      """
      UPDATE order_summary
      SET status = 'PaymentProcessed', payment_processed_at = @ProcessedAt
      WHERE order_id = @OrderId
      """,
      new {
        OrderId = Guid.NewGuid(),  // From event metadata
        ProcessedAt = @event.ProcessedAt
      }
    );
  }

  public async Task HandleAsync(
    OrderShippedEvent @event,
    CancellationToken ct = default
  ) {
    await _db.ExecuteAsync(
      """
      UPDATE order_summary
      SET status = 'Shipped', shipped_at = @ShippedAt, tracking_number = @TrackingNumber
      WHERE order_id = @OrderId
      """,
      new {
        OrderId = Guid.NewGuid(),  // From event metadata
        ShippedAt = @event.ShippedAt,
        TrackingNumber = @event.TrackingNumber
      }
    );
  }
}
```

---

## Rebuilding Projections

**Rebuild all projections from event store**:

```csharp
public class ProjectionRebuilder {
  private readonly EventStoreRepository _eventStore;
  private readonly OrderSummaryProjection _projection;
  private readonly ILogger<ProjectionRebuilder> _logger;

  public async Task RebuildOrderSummaryAsync(CancellationToken ct = default) {
    _logger.LogInformation("Starting projection rebuild...");

    // 1. Truncate read model
    await _db.ExecuteAsync("TRUNCATE TABLE order_summary");

    // 2. Replay all events
    var events = await _db.QueryAsync<EventRow>(
      """
      SELECT stream_id, event_type, event_data
      FROM event_store
      WHERE stream_type = 'Order'
      ORDER BY event_version ASC
      """
    );

    var count = 0;
    foreach (var eventRow in events) {
      var @event = DeserializeEvent(eventRow.EventType, eventRow.EventData);

      // Apply event to projection
      await ApplyToProjectionAsync(@event, ct);

      count++;
      if (count % 1000 == 0) {
        _logger.LogInformation("Processed {Count} events...", count);
      }
    }

    _logger.LogInformation("Projection rebuild complete. {Count} events processed.", count);
  }

  private async Task ApplyToProjectionAsync(object @event, CancellationToken ct) {
    switch (@event) {
      case OrderCreatedEvent e:
        await _projection.HandleAsync(e, ct);
        break;
      case PaymentProcessedEvent e:
        await _projection.HandleAsync(e, ct);
        break;
      case OrderShippedEvent e:
        await _projection.HandleAsync(e, ct);
        break;
    }
  }
}
```

---

## Key Takeaways

✅ **Event Store** - Append-only log of all domain events
✅ **Aggregate Reconstruction** - Rebuild state from event history
✅ **Snapshots** - Performance optimization for large event streams
✅ **Temporal Queries** - Query state at any point in time
✅ **Projections** - Event-driven read models (CQRS)
✅ **Projection Rebuilding** - Replay events to rebuild read models

---

## Performance Optimizations

### 1. Snapshots

Create snapshots every 100 events to avoid replaying thousands of events.

### 2. Caching

Cache frequently accessed aggregates in memory:

```csharp
public class CachedEventStoreRepository {
  private readonly EventStoreRepository _inner;
  private readonly IMemoryCache _cache;

  public async Task<OrderAggregate?> LoadAsync(Guid streamId, CancellationToken ct) {
    if (_cache.TryGetValue(streamId, out OrderAggregate? cached)) {
      return cached;
    }

    var aggregate = await _inner.LoadAsync(streamId, ct);
    if (aggregate != null) {
      _cache.Set(streamId, aggregate, TimeSpan.FromMinutes(5));
    }

    return aggregate;
  }
}
```

---

*Version 0.1.0 - Foundation Release | Last Updated: 2024-12-12*
