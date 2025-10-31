---
title: Event Sourcing & Projections
version: 0.3.0
category: Features
order: 4
evolves-from: v0.2.0/enhancements/ledger.md
evolves-to: v0.4.0/database/ledger.md, v0.5.0/production/ledger.md
description: Full event sourcing with aggregates, projections, and time-travel queries
tags: ledger, event-sourcing, projections, aggregates, time-travel, v0.3.0
---

# Event Sourcing & Projections

![Version](https://img.shields.io/badge/version-0.3.0-blue)
![Status](https://img.shields.io/badge/status-feature-orange)
![Next Update](https://img.shields.io/badge/next-v0.4.0-yellow)

## Version History

:::updated
**Enhanced in v0.3.0**: 
- Full event sourcing with aggregates
- Projection management and rebuilding
- Time-travel queries
- Event replay and debugging
:::

:::planned
**Coming in v0.4.0**: 
- SQL/JSONB storage backend
- Index-optimized queries
- Partitioned event streams

[See database features →](../../v0.4.0/database/ledger.md)
:::

:::planned
**Coming in v0.5.0**: 
- Distributed event store
- Multi-region replication
- Event streaming protocols

[See production features →](../../v0.5.0/production/ledger.md)
:::

## Event Sourcing Implementation

### Aggregate Root Pattern

:::new
Full aggregate support with event sourcing:
:::

```csharp
public abstract class AggregateRoot {
    private readonly List<IEvent> _uncommittedEvents = new();
    
    public string Id { get; protected set; }
    public int Version { get; private set; } = -1;
    
    // Get uncommitted events for persistence
    public IReadOnlyList<IEvent> GetUncommittedEvents() => _uncommittedEvents;
    
    // Mark events as committed
    public void MarkEventsAsCommitted() {
        _uncommittedEvents.Clear();
    }
    
    // Apply event and increment version
    protected void ApplyEvent(IEvent @event, bool isNew = true) {
        ((dynamic)this).Apply((dynamic)@event);
        Version++;
        
        if (isNew) {
            _uncommittedEvents.Add(@event);
        }
    }
    
    // Load aggregate from history
    public void LoadFromHistory(IEnumerable<IEvent> events) {
        foreach (var @event in events) {
            ApplyEvent(@event, isNew: false);
        }
    }
}

// Domain aggregate
public class Order : AggregateRoot {
    public Guid CustomerId { get; private set; }
    public OrderStatus Status { get; private set; }
    public decimal Total { get; private set; }
    public List<OrderItem> Items { get; private set; } = new();
    
    // Commands create events
    public void Create(Guid orderId, Guid customerId, List<OrderItem> items) {
        ApplyEvent(new OrderCreated {
            OrderId = orderId,
            CustomerId = customerId,
            Items = items,
            Total = items.Sum(i => i.Price * i.Quantity)
        });
    }
    
    public void Ship(string trackingNumber) {
        if (Status != OrderStatus.Confirmed) {
            throw new InvalidOperationException("Can only ship confirmed orders");
        }
        
        ApplyEvent(new OrderShipped {
            OrderId = Guid.Parse(Id),
            TrackingNumber = trackingNumber
        });
    }
    
    // Event handlers update state
    public void Apply(OrderCreated @event) {
        Id = @event.OrderId.ToString();
        CustomerId = @event.CustomerId;
        Items = @event.Items.ToList();
        Total = @event.Total;
        Status = OrderStatus.Created;
    }
    
    public void Apply(OrderShipped @event) {
        Status = OrderStatus.Shipped;
    }
}
```

### Event Store Repository

:::new
Repository pattern for aggregate persistence:
:::

```csharp
public interface IEventStoreRepository<T> where T : AggregateRoot {
    Task<T> GetById(string id);
    Task Save(T aggregate, ExpectedVersion expectedVersion = ExpectedVersion.Any);
    Task<bool> Exists(string id);
}

public class EventStoreRepository<T> : IEventStoreRepository<T> 
    where T : AggregateRoot, new() {
    
    private readonly IEventStore _eventStore;
    private readonly ISnapshotStore _snapshots;
    
    public async Task<T> GetById(string id) {
        var aggregate = new T();
        
        // Try loading from snapshot
        var snapshot = await _snapshots.GetLatest(GetStreamName(id));
        if (snapshot != null) {
            aggregate.RestoreFromSnapshot(snapshot.Data);
            
            // Load events after snapshot
            var events = await _eventStore.ReadStream(
                GetStreamName(id), 
                fromVersion: snapshot.Version + 1
            );
            aggregate.LoadFromHistory(events);
        } else {
            // No snapshot, load all events
            var events = await _eventStore.ReadStream(GetStreamName(id));
            if (!events.Any()) {
                throw new AggregateNotFoundException(id);
            }
            aggregate.LoadFromHistory(events);
        }
        
        return aggregate;
    }
    
    public async Task Save(T aggregate, ExpectedVersion expectedVersion = ExpectedVersion.Any) {
        var streamName = GetStreamName(aggregate.Id);
        var events = aggregate.GetUncommittedEvents();
        
        if (!events.Any()) return;
        
        // Save events
        await _eventStore.AppendToStream(
            streamName, 
            events, 
            expectedVersion == ExpectedVersion.Any 
                ? expectedVersion 
                : aggregate.Version - events.Count
        );
        
        // Create snapshot if needed (every 50 events)
        if (aggregate.Version > 0 && aggregate.Version % 50 == 0) {
            var snapshot = aggregate.CreateSnapshot();
            await _snapshots.Save(streamName, aggregate.Version, snapshot);
        }
        
        aggregate.MarkEventsAsCommitted();
    }
    
    private string GetStreamName(string aggregateId) => $"{typeof(T).Name}-{aggregateId}";
}
```

## Projection Management

### Projection Definition

:::new
Define projections that build read models from events:
:::

```csharp
[Projection("OrderSummary")]
public class OrderSummaryProjection : IProjection {
    private readonly IProjectionStore _store;
    
    // Current checkpoint for this projection
    public long Checkpoint { get; private set; }
    
    // Handle specific events
    public async Task Handle(OrderCreated @event, EventMetadata metadata) {
        await _store.Upsert("OrderSummary", @event.OrderId, new {
            OrderId = @event.OrderId,
            CustomerId = @event.CustomerId,
            Total = @event.Total,
            Status = "Created",
            CreatedAt = metadata.Timestamp,
            ItemCount = @event.Items.Count
        });
        
        Checkpoint = metadata.Position;
    }
    
    public async Task Handle(OrderShipped @event, EventMetadata metadata) {
        await _store.Update("OrderSummary", @event.OrderId, doc => {
            doc.Status = "Shipped";
            doc.ShippedAt = metadata.Timestamp;
        });
        
        Checkpoint = metadata.Position;
    }
    
    public async Task Handle(OrderCancelled @event, EventMetadata metadata) {
        await _store.Update("OrderSummary", @event.OrderId, doc => {
            doc.Status = "Cancelled";
            doc.CancelledAt = metadata.Timestamp;
        });
        
        Checkpoint = metadata.Position;
    }
}
```

### Projection Rebuilding

:::new
Rebuild projections from event history:
:::

```csharp
public interface IProjectionManager {
    Task RebuildProjection(string projectionName, DateTime? from = null);
    Task<ProjectionStatus> GetStatus(string projectionName);
    Task PauseProjection(string projectionName);
    Task ResumeProjection(string projectionName);
}

public class ProjectionManager : IProjectionManager {
    private readonly IEventStore _eventStore;
    private readonly IProjectionStore _projectionStore;
    private readonly IProjectionRegistry _registry;
    
    public async Task RebuildProjection(string projectionName, DateTime? from = null) {
        // Get projection instance
        var projection = _registry.GetProjection(projectionName);
        
        // Clear existing projection data
        if (from == null) {
            await _projectionStore.Clear(projectionName);
            projection.Checkpoint = 0;
        }
        
        // Stream all events from checkpoint
        var position = from != null 
            ? await _eventStore.GetPositionAt(from.Value)
            : GlobalPosition.Start;
            
        await foreach (var @event in _eventStore.ReadAll(position)) {
            // Dispatch to projection handlers
            await projection.Handle(@event.Data, @event.Metadata);
            
            // Save checkpoint periodically
            if (@event.Metadata.Position % 1000 == 0) {
                await SaveCheckpoint(projectionName, @event.Metadata.Position);
            }
        }
        
        // Save final checkpoint
        await SaveCheckpoint(projectionName, projection.Checkpoint);
    }
}
```

## Time-Travel Queries

### Query Historical State

:::new
Query system state at any point in time:
:::

```csharp
public interface ITimeTravelQuery {
    Task<T> GetAggregateAt<T>(string aggregateId, DateTime asOf) where T : AggregateRoot, new();
    Task<IReadOnlyList<T>> QueryAt<T>(DateTime asOf, Expression<Func<T, bool>> predicate);
}

public class TimeTravelQuery : ITimeTravelQuery {
    private readonly IEventStore _eventStore;
    
    public async Task<T> GetAggregateAt<T>(string aggregateId, DateTime asOf) 
        where T : AggregateRoot, new() {
        
        var aggregate = new T();
        var streamName = $"{typeof(T).Name}-{aggregateId}";
        
        // Read events up to specified time
        await foreach (var @event in _eventStore.ReadStream(streamName)) {
            if (@event.Metadata.Timestamp > asOf) break;
            
            aggregate.LoadFromHistory(new[] { @event.Data });
        }
        
        return aggregate;
    }
    
    public async Task<Order> GetOrderStatus(Guid orderId, DateTime when) {
        return await GetAggregateAt<Order>(orderId.ToString(), when);
    }
}

// Usage
public class HistoricalAnalysis {
    private readonly ITimeTravelQuery _timeTravel;
    
    public async Task AnalyzeOrderHistory(Guid orderId) {
        var now = DateTime.UtcNow;
        var yesterday = now.AddDays(-1);
        var lastWeek = now.AddDays(-7);
        
        var orderNow = await _timeTravel.GetAggregateAt<Order>(orderId.ToString(), now);
        var orderYesterday = await _timeTravel.GetAggregateAt<Order>(orderId.ToString(), yesterday);
        var orderLastWeek = await _timeTravel.GetAggregateAt<Order>(orderId.ToString(), lastWeek);
        
        Console.WriteLine($"Order status evolution:");
        Console.WriteLine($"  Last week: {orderLastWeek?.Status ?? "Not created"}");
        Console.WriteLine($"  Yesterday: {orderYesterday?.Status ?? "Not created"}");
        Console.WriteLine($"  Now: {orderNow.Status}");
    }
}
```

### Event Replay & Debugging

:::new
Replay events for debugging and analysis:
:::

```csharp
public class EventReplayer {
    private readonly IEventStore _eventStore;
    
    public async Task ReplayEvents(
        DateTime from, 
        DateTime to,
        Func<IEvent, EventMetadata, Task> handler) {
        
        var startPos = await _eventStore.GetPositionAt(from);
        
        await foreach (var envelope in _eventStore.ReadAll(startPos)) {
            if (envelope.Metadata.Timestamp > to) break;
            
            await handler(envelope.Data, envelope.Metadata);
        }
    }
    
    public async Task DebugEventFlow(string streamId) {
        Console.WriteLine($"Event flow for stream: {streamId}");
        Console.WriteLine(new string('-', 50));
        
        await foreach (var envelope in _eventStore.ReadStream(streamId)) {
            Console.WriteLine($"[{envelope.Metadata.Timestamp:HH:mm:ss.fff}] " +
                            $"v{envelope.Metadata.Version} " +
                            $"{envelope.Data.GetType().Name}");
            Console.WriteLine($"  Data: {JsonSerializer.Serialize(envelope.Data)}");
            Console.WriteLine();
        }
    }
}
```

## Advanced Features

### Subscription Management

```csharp
public interface IEventSubscription : IDisposable {
    string SubscriptionId { get; }
    Task Start(CancellationToken cancellationToken = default);
    Task Stop();
}

public class LiveEventSubscription : IEventSubscription {
    private readonly IEventStore _eventStore;
    private readonly Func<IEvent, Task> _handler;
    
    public async Task Start(CancellationToken cancellationToken = default) {
        var checkpoint = await LoadCheckpoint();
        
        // Subscribe to live events
        await foreach (var envelope in _eventStore
            .SubscribeToAll(checkpoint)
            .WithCancellation(cancellationToken)) {
            
            await _handler(envelope.Data);
            await SaveCheckpoint(envelope.Metadata.Position);
        }
    }
}
```

## Testing Event Sourcing

```csharp
[Test]
public class EventSourcingTests {
    [Test]
    public async Task Aggregate_ShouldRehydrateFromEvents() {
        // Arrange
        var repository = new EventStoreRepository<Order>();
        var orderId = Guid.NewGuid();
        
        var order = new Order();
        order.Create(orderId, Guid.NewGuid(), items);
        order.Confirm();
        order.Ship("TRACK123");
        
        // Act - save and reload
        await repository.Save(order);
        var loaded = await repository.GetById(orderId.ToString());
        
        // Assert
        Assert.Equal(OrderStatus.Shipped, loaded.Status);
        Assert.Equal(2, loaded.Version); // 3 events = version 2 (0-based)
    }
    
    [Test]
    public async Task Projection_ShouldRebuildFromEvents() {
        // Test projection rebuilding
    }
}
```

## Performance Characteristics

| Operation | Target | Notes |
|-----------|--------|-------|
| Load aggregate (50 events) | < 10ms | With snapshot: < 2ms |
| Save aggregate | < 5ms | Single stream append |
| Rebuild projection (100k events) | < 30s | ~3,300 events/sec |
| Time-travel query | < 50ms | Depends on history depth |

## Migration from v0.2.0

### New Concepts

- Aggregate roots for domain modeling
- Projections for read models
- Time-travel queries
- Event subscriptions

### Code Changes

```csharp
// v0.2.0 - Direct event append
await ledger.Append("order-123", new OrderCreated(...));

// v0.3.0 - Through aggregates
var order = new Order();
order.Create(orderId, customerId, items);
await repository.Save(order);
```

## Related Documentation

- [v0.2.0 Persistence](../../v0.2.0/enhancements/ledger.md) - File storage
- [v0.4.0 Database](../../v0.4.0/database/ledger.md) - SQL/JSONB backend
- [v0.5.0 Production](../../v0.5.0/production/ledger.md) - Distributed event store
- [Event Sourcing Guide](../guides/event-sourcing.md) - Best practices
- [Projection Patterns](../guides/projections.md) - Common patterns