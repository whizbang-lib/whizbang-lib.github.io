---
title: Multi-Stream Perspectives
version: 1.0.0
category: Core Concepts
order: 1
description: >-
  IGlobalPerspectiveFor pattern for aggregating events across multiple streams
  using partition keys - inspired by Marten's MultiStreamProjection
tags: >-
  perspectives, multi-stream, global-perspectives, partition-key, cross-stream,
  aggregation, read-models, marten
codeReferences:
  - src/Whizbang.Core/Perspectives/IGlobalPerspectiveFor.cs
---

# Multi-Stream Perspectives

**Multi-stream perspectives** (also called **global perspectives**) aggregate events from **multiple streams** based on a **partition key**. They enable read models that span across aggregates.

## Core Concept

### Single-Stream vs. Multi-Stream

**Single-Stream Perspective** (`IPerspectiveFor<TModel, TEvent>`):
- One stream → One model instance
- Stream ID identifies the model
- Example: `ProductPerspective` - one model per product stream

**Multi-Stream Perspective** (`IGlobalPerspectiveFor<TModel, TPartitionKey, TEvent>`):
- Many streams → One model instance (per partition key)
- Partition key extracted from events identifies the model
- Example: `CustomerStatisticsPerspective` - aggregates order events from many order streams into one customer model

```
Single-Stream (IPerspectiveFor):
┌─────────────────┐
│  Order Stream 1 │ ──────> Order Summary Model 1
└─────────────────┘
┌─────────────────┐
│  Order Stream 2 │ ──────> Order Summary Model 2
└─────────────────┘


Multi-Stream (IGlobalPerspectiveFor):
┌─────────────────┐
│  Order Stream 1 │ ──┐
└─────────────────┘   │
┌─────────────────┐   │    Customer Statistics Model
│  Order Stream 2 │ ──┼──> (Partition Key: CustomerId)
└─────────────────┘   │
┌─────────────────┐   │
│  Order Stream 3 │ ──┘
└─────────────────┘
```

---

## IGlobalPerspectiveFor Interface

```csharp
/// <summary>
/// Multi-stream perspective that handles a single event type with partition key extraction.
/// GetPartitionKey extracts the partition from events (like Marten's Identity method).
/// Apply methods must be pure functions: no I/O, no side effects, deterministic.
/// </summary>
public interface IGlobalPerspectiveFor<TModel, TPartitionKey, TEvent1>
  where TModel : class
  where TPartitionKey : notnull
  where TEvent1 : IEvent {

  /// <summary>
  /// Extracts the partition key from an event to determine which model instance to update.
  /// MUST be a pure function: deterministic, no side effects.
  /// </summary>
  TPartitionKey GetPartitionKey(TEvent1 @event);

  /// <summary>
  /// Applies an event to the model and returns a new model.
  /// MUST be a pure function: no I/O, no side effects, deterministic.
  /// </summary>
  TModel Apply(TModel currentData, TEvent1 @event);
}
```

**Key Methods**:
- `GetPartitionKey()` - Extracts partition key from event (which model to update)
- `Apply()` - Pure function that applies event to model (same as single-stream)

---

## Basic Example: Customer Statistics

### Scenario

Aggregate order statistics per customer across all order streams.

### Events

```csharp
using Whizbang.Core;

// Order created event (separate stream per order)
public record OrderCreatedEvent : IEvent {
  [StreamKey]
  public Guid OrderId { get; init; }        // Stream key (order stream)

  public Guid CustomerId { get; init; }     // Partition key (customer)
  public decimal Total { get; init; }
  public DateTime CreatedAt { get; init; }
}

// Order completed event
public record OrderCompletedEvent : IEvent {
  [StreamKey]
  public Guid OrderId { get; init; }        // Stream key

  public Guid CustomerId { get; init; }     // Partition key
  public DateTime CompletedAt { get; init; }
}
```

### Read Model

```csharp
// Customer statistics model (one per customer)
public record CustomerStatisticsDto {
  public Guid CustomerId { get; init; }           // Partition key
  public int TotalOrders { get; init; }
  public decimal TotalSpent { get; init; }
  public DateTime? LastOrderDate { get; init; }
  public DateTime? LastCompletedDate { get; init; }
}
```

### Multi-Stream Perspective

```csharp
using Whizbang.Core.Perspectives;

public class CustomerStatisticsPerspective :
  IGlobalPerspectiveFor<CustomerStatisticsDto, Guid, OrderCreatedEvent>,
  IGlobalPerspectiveFor<CustomerStatisticsDto, Guid, OrderCompletedEvent> {

  // Extract partition key from OrderCreatedEvent
  public Guid GetPartitionKey(OrderCreatedEvent @event) {
    return @event.CustomerId;  // Group by customer ID
  }

  // Extract partition key from OrderCompletedEvent
  public Guid GetPartitionKey(OrderCompletedEvent @event) {
    return @event.CustomerId;  // Group by customer ID
  }

  // Apply OrderCreatedEvent
  public CustomerStatisticsDto Apply(CustomerStatisticsDto currentData, OrderCreatedEvent @event) {
    return new CustomerStatisticsDto {
      CustomerId = @event.CustomerId,
      TotalOrders = (currentData?.TotalOrders ?? 0) + 1,
      TotalSpent = (currentData?.TotalSpent ?? 0) + @event.Total,
      LastOrderDate = @event.CreatedAt,
      LastCompletedDate = currentData?.LastCompletedDate
    };
  }

  // Apply OrderCompletedEvent
  public CustomerStatisticsDto Apply(CustomerStatisticsDto currentData, OrderCompletedEvent @event) {
    return new CustomerStatisticsDto {
      CustomerId = currentData.CustomerId,
      TotalOrders = currentData.TotalOrders,
      TotalSpent = currentData.TotalSpent,
      LastOrderDate = currentData.LastOrderDate,
      LastCompletedDate = @event.CompletedAt
    };
  }
}
```

**Result**:
- Events from **many order streams** (order-001, order-002, order-003)
- All update the **same customer model** (customer-abc-123)
- Partition key (`CustomerId`) groups events into customer-specific aggregates

---

## Partition Key Types

### Guid Partition Key

```csharp
// Partition by customer ID
public class CustomerActivityPerspective :
  IGlobalPerspectiveFor<CustomerActivityDto, Guid, OrderCreatedEvent> {

  public Guid GetPartitionKey(OrderCreatedEvent @event) {
    return @event.CustomerId;  // Guid partition key
  }

  public CustomerActivityDto Apply(CustomerActivityDto currentData, OrderCreatedEvent @event) {
    // ...
  }
}
```

### String Partition Key

```csharp
// Partition by product category
public class CategorySalesPerspective :
  IGlobalPerspectiveFor<CategorySalesDto, string, ProductSoldEvent> {

  public string GetPartitionKey(ProductSoldEvent @event) {
    return @event.Category;  // String partition key (e.g., "Electronics", "Clothing")
  }

  public CategorySalesDto Apply(CategorySalesDto currentData, ProductSoldEvent @event) {
    return new CategorySalesDto {
      Category = @event.Category,
      TotalSales = (currentData?.TotalSales ?? 0) + @event.Quantity,
      Revenue = (currentData?.Revenue ?? 0) + @event.Price
    };
  }
}
```

### Composite Partition Key

```csharp
// Partition by tenant + customer
public record TenantCustomerKey(Guid TenantId, Guid CustomerId);

public class TenantCustomerPerspective :
  IGlobalPerspectiveFor<CustomerDto, TenantCustomerKey, OrderCreatedEvent> {

  public TenantCustomerKey GetPartitionKey(OrderCreatedEvent @event) {
    return new TenantCustomerKey(@event.TenantId, @event.CustomerId);
  }

  public CustomerDto Apply(CustomerDto currentData, OrderCreatedEvent @event) {
    // ...
  }
}
```

---

## Multiple Event Types

Multi-stream perspectives can handle up to 3 event types (v1.0.0):

```csharp
public class CustomerLifecyclePerspective :
  IGlobalPerspectiveFor<CustomerDto, Guid, CustomerRegisteredEvent>,
  IGlobalPerspectiveFor<CustomerDto, Guid, OrderCreatedEvent>,
  IGlobalPerspectiveFor<CustomerDto, Guid, CustomerDeactivatedEvent> {

  // GetPartitionKey for each event type
  public Guid GetPartitionKey(CustomerRegisteredEvent @event) => @event.CustomerId;
  public Guid GetPartitionKey(OrderCreatedEvent @event) => @event.CustomerId;
  public Guid GetPartitionKey(CustomerDeactivatedEvent @event) => @event.CustomerId;

  // Apply for each event type
  public CustomerDto Apply(CustomerDto currentData, CustomerRegisteredEvent @event) {
    return new CustomerDto {
      CustomerId = @event.CustomerId,
      Name = @event.Name,
      Email = @event.Email,
      RegisteredAt = @event.RegisteredAt,
      TotalOrders = 0,
      Status = "Active"
    };
  }

  public CustomerDto Apply(CustomerDto currentData, OrderCreatedEvent @event) {
    return new CustomerDto {
      CustomerId = currentData.CustomerId,
      Name = currentData.Name,
      Email = currentData.Email,
      RegisteredAt = currentData.RegisteredAt,
      TotalOrders = currentData.TotalOrders + 1,
      Status = currentData.Status
    };
  }

  public CustomerDto Apply(CustomerDto currentData, CustomerDeactivatedEvent @event) {
    return new CustomerDto {
      CustomerId = currentData.CustomerId,
      Name = currentData.Name,
      Email = currentData.Email,
      RegisteredAt = currentData.RegisteredAt,
      TotalOrders = currentData.TotalOrders,
      Status = "Deactivated"
    };
  }
}
```

**Note**: Maximum 3 event types per perspective in v1.0.0. For more events, create multiple perspectives targeting the same model.

---

## Comparison with Marten

Whizbang's multi-stream perspectives are inspired by [Marten's MultiStreamProjection](https://martendb.io/events/projections/multi-stream-projections.html):

### Marten Pattern

```csharp
// Marten (C#)
public class TripProjection : MultiStreamProjection<Trip, string> {
  public TripProjection() {
    // Identity method extracts partition key
    Identity<TripStarted>(x => x.TripId);
    Identity<TripEnded>(x => x.TripId);
  }

  public void Apply(Trip trip, TripStarted started) {
    trip.Id = started.TripId;
    trip.Started = started.StartedAt;
  }

  public void Apply(Trip trip, TripEnded ended) {
    trip.Ended = ended.EndedAt;
  }
}
```

### Whizbang Pattern

```csharp
// Whizbang (C#)
public class TripPerspective :
  IGlobalPerspectiveFor<TripDto, string, TripStartedEvent>,
  IGlobalPerspectiveFor<TripDto, string, TripEndedEvent> {

  // GetPartitionKey is like Marten's Identity
  public string GetPartitionKey(TripStartedEvent @event) => @event.TripId;
  public string GetPartitionKey(TripEndedEvent @event) => @event.TripId;

  // Apply must be pure (return new instance)
  public TripDto Apply(TripDto currentData, TripStartedEvent @event) {
    return new TripDto {
      Id = @event.TripId,
      Started = @event.StartedAt,
      Ended = currentData?.Ended
    };
  }

  public TripDto Apply(TripDto currentData, TripEndedEvent @event) {
    return new TripDto {
      Id = currentData.Id,
      Started = currentData.Started,
      Ended = @event.EndedAt
    };
  }
}
```

**Key Differences**:
- **Whizbang**: `GetPartitionKey()` method per event type (explicit)
- **Marten**: `Identity<T>()` configuration in constructor (implicit)
- **Whizbang**: `Apply()` returns new instance (pure function)
- **Marten**: `Apply()` mutates existing instance (imperative)

**Philosophical Difference**:
- **Whizbang**: Pure functional approach (immutability, determinism)
- **Marten**: Object-oriented approach (mutation, state changes)

---

## Use Cases

### 1. Customer Aggregates

Aggregate customer data from multiple event streams:

```csharp
// Events from different streams
OrderCreatedEvent (order-001) → CustomerId: abc-123
PaymentReceivedEvent (payment-042) → CustomerId: abc-123
SupportTicketCreatedEvent (ticket-789) → CustomerId: abc-123

// All update same CustomerDto
CustomerDto (partition: abc-123) {
  TotalOrders: 15,
  TotalSpent: $1,250.00,
  OpenTickets: 2
}
```

### 2. Analytics & Reporting

Pre-compute analytics across streams:

```csharp
// Category sales perspective
public class CategorySalesPerspective :
  IGlobalPerspectiveFor<CategorySalesDto, string, ProductSoldEvent> {

  public string GetPartitionKey(ProductSoldEvent @event) => @event.Category;

  public CategorySalesDto Apply(CategorySalesDto currentData, ProductSoldEvent @event) {
    return new CategorySalesDto {
      Category = @event.Category,
      UnitsSold = (currentData?.UnitsSold ?? 0) + @event.Quantity,
      Revenue = (currentData?.Revenue ?? 0) + (@event.Quantity * @event.UnitPrice),
      LastSaleDate = @event.SoldAt
    };
  }
}
```

### 3. Multi-Tenant Aggregates

Partition by tenant for SaaS applications:

```csharp
public class TenantUsagePerspective :
  IGlobalPerspectiveFor<TenantUsageDto, Guid, ApiRequestEvent>,
  IGlobalPerspectiveFor<TenantUsageDto, Guid, DataStoredEvent> {

  public Guid GetPartitionKey(ApiRequestEvent @event) => @event.TenantId;
  public Guid GetPartitionKey(DataStoredEvent @event) => @event.TenantId;

  public TenantUsageDto Apply(TenantUsageDto currentData, ApiRequestEvent @event) {
    return new TenantUsageDto {
      TenantId = @event.TenantId,
      ApiRequests = (currentData?.ApiRequests ?? 0) + 1,
      StorageBytes = currentData?.StorageBytes ?? 0
    };
  }

  public TenantUsageDto Apply(TenantUsageDto currentData, DataStoredEvent @event) {
    return new TenantUsageDto {
      TenantId = @event.TenantId,
      ApiRequests = currentData?.ApiRequests ?? 0,
      StorageBytes = (currentData?.StorageBytes ?? 0) + @event.Bytes
    };
  }
}
```

---

## Pure Function Requirements

**CRITICAL**: Multi-stream perspectives must use **pure functions** in both `GetPartitionKey()` and `Apply()`.

### GetPartitionKey - Pure Function

```csharp
// ✅ CORRECT: Pure function (deterministic, no side effects)
public Guid GetPartitionKey(OrderCreatedEvent @event) {
  return @event.CustomerId;
}

// ❌ WRONG: Impure (calls external service)
public Guid GetPartitionKey(OrderCreatedEvent @event) {
  var customer = _customerService.GetCustomer(@event.CustomerId);  // I/O!
  return customer.Id;
}

// ❌ WRONG: Non-deterministic
public string GetPartitionKey(OrderCreatedEvent @event) {
  return Guid.NewGuid().ToString();  // Different result each time!
}
```

### Apply - Pure Function

```csharp
// ✅ CORRECT: Pure function (returns new instance)
public CustomerDto Apply(CustomerDto currentData, OrderCreatedEvent @event) {
  return new CustomerDto {
    CustomerId = @event.CustomerId,
    TotalOrders = (currentData?.TotalOrders ?? 0) + 1,
    TotalSpent = (currentData?.TotalSpent ?? 0) + @event.Total
  };
}

// ❌ WRONG: Mutates current data
public CustomerDto Apply(CustomerDto currentData, OrderCreatedEvent @event) {
  currentData.TotalOrders += 1;  // Mutation!
  return currentData;
}

// ❌ WRONG: Performs I/O
public CustomerDto Apply(CustomerDto currentData, OrderCreatedEvent @event) {
  var customer = await _db.GetCustomerAsync(@event.CustomerId);  // I/O!
  return new CustomerDto { /* ... */ };
}
```

**Why pure functions?**
- **Deterministic replay**: Rebuilding read models always produces same result
- **Event sourcing**: Can replay events from any point
- **Testing**: No mocking required, simple unit tests

---

## Storage & Checkpointing

### Storage

Multi-stream perspectives use the same storage pattern as single-stream perspectives:

```sql
-- Perspective table
CREATE TABLE wh_per_customer_statistics (
  partition_key UUID PRIMARY KEY,      -- CustomerId (not stream_id!)
  data JSONB NOT NULL,                 -- CustomerStatisticsDto
  version BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
```

**Key Difference**: `partition_key` instead of `stream_id`.

### Checkpointing

Multi-stream perspectives track checkpoints per partition:

```sql
-- Perspective checkpoints
INSERT INTO wh_perspective_checkpoints (
  partition_key,              -- CustomerId
  perspective_name,           -- "CustomerStatisticsPerspective"
  last_event_id,              -- UUIDv7 of last processed event
  last_sequence_number,
  status
) VALUES (
  'abc-123',
  'CustomerStatisticsPerspective',
  'event-uuid-789',
  42,
  'UpToDate'
);
```

---

## Testing Multi-Stream Perspectives

### Unit Tests

```csharp
using TUnit.Assertions;
using TUnit.Core;

public class CustomerStatisticsPerspectiveTests {
  [Test]
  public async Task GetPartitionKey_OrderCreatedEvent_ReturnsCustomerIdAsync() {
    // Arrange
    var perspective = new CustomerStatisticsPerspective();
    var @event = new OrderCreatedEvent {
      OrderId = Guid.NewGuid(),
      CustomerId = Guid.Parse("abc-123"),
      Total = 100m
    };

    // Act
    var partitionKey = perspective.GetPartitionKey(@event);

    // Assert
    await Assert.That(partitionKey).IsEqualTo(Guid.Parse("abc-123"));
  }

  [Test]
  public async Task Apply_OrderCreatedEvent_IncrementsCountersAsync() {
    // Arrange
    var perspective = new CustomerStatisticsPerspective();
    var currentData = new CustomerStatisticsDto {
      CustomerId = Guid.Parse("abc-123"),
      TotalOrders = 5,
      TotalSpent = 500m
    };
    var @event = new OrderCreatedEvent {
      CustomerId = Guid.Parse("abc-123"),
      Total = 100m,
      CreatedAt = DateTime.UtcNow
    };

    // Act
    var result = perspective.Apply(currentData, @event);

    // Assert
    await Assert.That(result.TotalOrders).IsEqualTo(6);
    await Assert.That(result.TotalSpent).IsEqualTo(600m);
    await Assert.That(currentData.TotalOrders).IsEqualTo(5);  // Not mutated!
  }

  [Test]
  public async Task Apply_MultipleEvents_SamePartition_AggregatesCorrectlyAsync() {
    // Arrange
    var perspective = new CustomerStatisticsPerspective();
    var emptyData = new CustomerStatisticsDto {
      CustomerId = Guid.Parse("abc-123")
    };

    var event1 = new OrderCreatedEvent {
      CustomerId = Guid.Parse("abc-123"),
      Total = 100m,
      CreatedAt = DateTime.UtcNow
    };

    var event2 = new OrderCreatedEvent {
      CustomerId = Guid.Parse("abc-123"),
      Total = 200m,
      CreatedAt = DateTime.UtcNow.AddMinutes(5)
    };

    // Act - apply events sequentially
    var afterEvent1 = perspective.Apply(emptyData, event1);
    var afterEvent2 = perspective.Apply(afterEvent1, event2);

    // Assert
    await Assert.That(afterEvent2.TotalOrders).IsEqualTo(2);
    await Assert.That(afterEvent2.TotalSpent).IsEqualTo(300m);
  }
}
```

---

## Best Practices

### DO ✅

- ✅ Use `GetPartitionKey()` as pure function (deterministic)
- ✅ Use `Apply()` as pure function (no I/O, returns new instance)
- ✅ Partition by stable identifiers (CustomerId, TenantId, Category)
- ✅ Handle null `currentData` defensively (first event for partition)
- ✅ Use partition keys that make sense for your domain
- ✅ Test partition key extraction separately
- ✅ Test Apply logic independently

### DON'T ❌

- ❌ Perform I/O in `GetPartitionKey()` or `Apply()`
- ❌ Use non-deterministic partition keys (Guid.NewGuid(), DateTime.Now)
- ❌ Mutate `currentData` in `Apply()`
- ❌ Partition by high-cardinality keys (RequestId, MessageId)
- ❌ Mix single-stream and multi-stream patterns (choose one)
- ❌ Forget to handle null `currentData` (first event case)

---

## Limitations (v1.0.0)

1. **Maximum 3 event types** per multi-stream perspective
2. **Partition key must be notnull** (`where TPartitionKey : notnull`)
3. **Model must be class** (`where TModel : class`)
4. **No built-in UI for v1.0.0** (manual perspective registration)

**Workaround for >3 events**: Create multiple perspectives targeting the same model type.

---

## Further Reading

**Core Concepts**:
- [Perspectives](../perspectives.md) - Single-stream perspectives (IPerspectiveFor)
- [Lenses](../lenses.md) - Query interfaces for read models
- [StreamKey Attribute](../../attributes/streamkey.md) - Stream identification

**Source Generators**:
- [Perspective Discovery](../../source-generators/perspective-discovery.md) - Auto-discovery and runner generation

**Data Access**:
- [Perspective Storage](../../data/perspectives-storage.md) - Read model persistence
- [Event Store](../../data/event-store.md) - Event sourcing foundation

**Workers**:
- [Perspective Worker](../../workers/perspective-worker.md) - Checkpoint processing and runtime

**External Resources**:
- [Marten MultiStreamProjection](https://martendb.io/events/projections/multi-stream-projections.html) - Inspiration for this pattern

---

*Version 1.0.0 - Foundation Release | Last Updated: 2025-12-22*
