---
title: Multi-Stream Perspectives
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
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
  - src/Whizbang.Core/Perspectives/IPerspectiveFanOutFor.cs
  - src/Whizbang.Core/Perspectives/FanOutKey.cs
  - src/Whizbang.Core/Perspectives/PerspectiveFanOutEntry.cs
  - src/Whizbang.Generators/PerspectiveFanOutDiscoveryGenerator.cs
  - src/Whizbang.Generators/Analyzers/PerspectiveFanOutAnalyzer.cs
  - src/Whizbang.Core/Perspectives/FanOutScopeResolver.cs
  - src/Whizbang.Core/Perspectives/FanOutCollectiveEvent.cs
  - src/Whizbang.Core/Perspectives/CollectiveDispatcher.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCorePostgresPerspectiveStore.cs
testReferences:
  - tests/Whizbang.Core.Unit.Perspectives.Tests/Perspectives/IGlobalPerspectiveForTests.cs
  - tests/Whizbang.Generators.Tests/GlobalPerspectiveArityTests.cs
  - tests/Whizbang.Core.Unit.Perspectives.Tests/Perspectives/PerspectiveFanOutContractTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveFanOutDiscoveryGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/Analyzers/PerspectiveFanOutAnalyzerTests.cs
  - tests/Whizbang.Core.Unit.Perspectives.Tests/Perspectives/FanOutCollectiveDispatchTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Collective/FanOutApplyEFCoreTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/Collective/DapperFanOutApplyTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCorePostgresPerspectiveStoreTests.cs
lastMaintainedCommit: '01f07906'
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

```mermaid{caption="Single-stream perspectives map one stream to one model instance; multi-stream (global) perspectives fold events from many streams into one model per partition key." tests=["IGlobalPerspectiveForTests.GlobalPerspective_EventsFromDifferentStreams_UpdateSamePartitionAsync"]}
flowchart TB
    subgraph Single["Single-Stream (IPerspectiveFor)"]
        direction LR
        S1["Order Stream 1"] --> SM1["Order Summary Model 1"]
        S2["Order Stream 2"] --> SM2["Order Summary Model 2"]
    end

    subgraph Multi["Multi-Stream (IGlobalPerspectiveFor)"]
        direction LR
        M1["Order Stream 1"] --> CSM["Customer Statistics Model<br/>(Partition Key: CustomerId)"]
        M2["Order Stream 2"] --> CSM
        M3["Order Stream 3"] --> CSM
    end
```

---

## IGlobalPerspectiveFor Interface

```csharp{title="IGlobalPerspectiveFor Interface" description="IGlobalPerspectiveFor Interface" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "IGlobalPerspectiveFor", "Interface"] tests=["IGlobalPerspectiveForTests.GlobalPerspective_HasGetPartitionKeyMethod_ExtractsPartitionFromEventAsync", "IGlobalPerspectiveForTests.GlobalPerspective_ApplyMethod_IsPureFunctionAsync"]}
/// <summary>
/// Multi-stream perspective that handles a single event type with partition key extraction.
/// GetPartitionKey extracts the partition from events (like Marten's Identity method).
/// Apply methods must be pure functions: no I/O, no side effects, deterministic.
/// </summary>
public interface IGlobalPerspectiveFor<TModel, TPartitionKey, TEvent1> : IGlobalPerspectiveFor<TModel, TPartitionKey>
  where TModel : class
  where TPartitionKey : notnull
  where TEvent1 : IEvent {

  /// <summary>
  /// Extracts the partition key from an event to determine which model instance to update.
  /// MUST be a pure function: deterministic, no side effects.
  /// </summary>
  TPartitionKey GetPartitionKey(TEvent1 eventData);

  /// <summary>
  /// Applies an event to the model and returns a new model.
  /// MUST be a pure function: no I/O, no side effects, deterministic.
  /// </summary>
  TModel Apply(TModel currentData, TEvent1 eventData);
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

```csharp{title="Events" description="Events" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Events"] unverified="consumer domain event record definitions, not a core library API"}
using Whizbang.Core;

// Order created event (separate stream per order)
public record OrderCreatedEvent : IEvent {
  [StreamId]
  public Guid OrderId { get; init; }        // Stream ID (order stream)

  public Guid CustomerId { get; init; }     // Partition key (customer)
  public decimal Total { get; init; }
  public DateTime CreatedAt { get; init; }
}

// Order completed event
public record OrderCompletedEvent : IEvent {
  [StreamId]
  public Guid OrderId { get; init; }        // Stream ID

  public Guid CustomerId { get; init; }     // Partition key
  public DateTime CompletedAt { get; init; }
}
```

### Read Model

```csharp{title="Read Model" description="Read Model" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "Read", "Model"] unverified="consumer domain read-model record definition, not a core library API"}
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

```csharp{title="Multi-Stream Perspective" description="Multi-Stream Perspective" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Perspectives", "Multi-Stream", "Perspective"] tests=["IGlobalPerspectiveForTests.GlobalPerspective_MultipleEventTypes_HasGetPartitionKeyForEachAsync", "IGlobalPerspectiveForTests.GlobalPerspective_EventsFromDifferentStreams_UpdateSamePartitionAsync"]}
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

```csharp{title="Guid Partition Key" description="Guid Partition Key" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Guid", "Partition"] tests=["IGlobalPerspectiveForTests.GlobalPerspective_HasGetPartitionKeyMethod_ExtractsPartitionFromEventAsync"]}
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

```csharp{title="String Partition Key" description="String Partition Key" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "String", "Partition"] tests=["IGlobalPerspectiveForTests.GlobalPerspective_DifferentPartitionKeys_CanUseStringTypeAsync"]}
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

```csharp{title="Composite Partition Key" description="Composite Partition Key" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Composite", "Partition"] unverified="consumer illustration of a composite partition-key record with elided Apply body; no composite-key test exists in IGlobalPerspectiveForTests"}
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

Multi-stream perspectives can handle many event types: each `IGlobalPerspectiveFor` implementation takes up to 50, and a perspective may implement it any number of times:

```csharp{title="Multiple Event Types" description="A multi-stream perspective implementing IGlobalPerspectiveFor once per event, with a GetPartitionKey and an Apply for each" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Perspectives", "Multiple", "Event"] tests=["IGlobalPerspectiveForTests.GlobalPerspective_MultipleEventTypes_HasGetPartitionKeyForEachAsync"]}
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

:::updated
`IGlobalPerspectiveFor` takes up to **50 event type parameters** per implementation, the same as `IPerspectiveFor` and
`IPerspectiveWithActionsFor` (it stopped at 3). A perspective may implement it any number of times, so events can be
grouped however reads best. `ITemporalPerspectiveFor` stays at 10.
:::

{verified: GlobalPerspectiveArityTests.TheGlobalFamily_TakesUpToFiftyEvents_AndNoMoreAsync, GlobalPerspectiveArityTests.AGlobalPerspectiveWithFiftyEvents_CompilesAndRoutesEveryEventAsync}

---

## Comparison with Marten

Whizbang's multi-stream perspectives are inspired by [Marten's MultiStreamProjection](https://martendb.io/events/projections/multi-stream-projections.html):

### Marten Pattern

```csharp{title="Marten Pattern" description="Marten Pattern" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Marten", "Pattern"] unverified="Marten API — not Whizbang code, shown for comparison only"}
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

```csharp{title="Whizbang Pattern" description="Whizbang Pattern" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Whizbang", "Pattern"] tests=["IGlobalPerspectiveForTests.GlobalPerspective_MultipleEventTypes_HasGetPartitionKeyForEachAsync", "IGlobalPerspectiveForTests.GlobalPerspective_ApplyMethod_IsPureFunctionAsync"]}
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

```csharp{title="Customer Aggregates" description="Aggregate customer data from multiple event streams:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Customer", "Aggregates"] tests=["IGlobalPerspectiveForTests.GlobalPerspective_EventsFromDifferentStreams_UpdateSamePartitionAsync"]}
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

```csharp{title="Analytics & Reporting" description="Pre-compute analytics across streams:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Analytics", "Reporting"] tests=["IGlobalPerspectiveForTests.GlobalPerspective_DifferentPartitionKeys_CanUseStringTypeAsync"]}
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

```csharp{title="Multi-Tenant Aggregates" description="Partition by tenant for SaaS applications:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Multi-Tenant", "Aggregates"] tests=["IGlobalPerspectiveForTests.GlobalPerspective_MultipleEventTypes_HasGetPartitionKeyForEachAsync"]}
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

```csharp{title="GetPartitionKey - Pure Function" description="GetPartitionKey - Pure Function" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "GetPartitionKey", "Pure"] unverified="counter-example — impure and non-deterministic GetPartitionKey anti-patterns"}
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

```csharp{title="Apply - Pure Function" description="Apply - Pure Function" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Apply", "Pure"] tests=["IGlobalPerspectiveForTests.GlobalPerspective_ApplyMethod_IsPureFunctionAsync"]}
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

## Fan-out from another stream {#fan-out-from-another-stream}

A global perspective folds many streams into **one** row per partition key. A **fan-out** is the other direction:
one event of another stream changes **many** rows of a perspective. When a customer is renamed, every order summary of
that customer shows the new name.

A fan-out is declared by the **consuming** perspective, not by the producer. The customer service writes the
`CustomerRenamed` it always wrote; the order perspective says which of its rows that event targets and how they
change. It is the same set-based update a [collective event](../messaging/collective-events) makes, with the scope
declared by the consumer instead of carried on the event.

```mermaid{caption="One CustomerRenamed on stream c-1 changes every OrderSummary row whose CustomerId is c-1, in the event's tenant; rows of other customers are not targeted." tests=["FanOutCollectiveDispatchTests.ScopeFilter_MatchesTheRowsWhoseKeyIsTheStream_InTheEventsTenantOnlyAsync"]}
flowchart LR
  C["Customer stream c-1<br/>CustomerRenamed"] -->|"rows whose CustomerId = c-1"| O1["OrderSummary o-1"]
  C --> O2["OrderSummary o-2"]
  C -.->|"CustomerId = c-2: not targeted"| O3["OrderSummary o-3"]
```

### Declaring a fan-out

A perspective implements `IPerspectiveFanOutFor<TModel, TEvent>` once per foreign event. `Targets` names the **key
column**: the rows whose key equals the event's stream id. `Apply` returns the change, in the same
`ICollectiveSpec<TModel>` form a `[CollectiveApplyFor]` handler returns.

```csharp{title="A perspective that fans out a foreign event" description="OrderSummary rows take the customer's new name when the customer stream renames it" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Multi-Stream", "Fan-Out"] testFile="PerspectiveFanOutDiscoveryGeneratorTests.cs" testMethod="Generator_OneEntryPerModelAndForeignEvent_WithTheKeyColumnAsync" tests=["PerspectiveFanOutDiscoveryGeneratorTests.Generator_OneEntryPerModelAndForeignEvent_WithTheKeyColumnAsync"]}
public sealed class OrderSummary {
  [StreamId] public Guid OrderId { get; init; }

  // The key column: a physical field, indexed, holding a stream id
  [PhysicalField]
  [Indexed]
  public Guid CustomerId { get; init; }

  public string CustomerName { get; init; } = "";
  public bool CustomerDeleted { get; init; }
}

public class OrderSummaryProjection
  : IPerspectiveFor<OrderSummary, OrderPlaced>,
    IPerspectiveFanOutFor<OrderSummary, CustomerRenamed>,
    IPerspectiveFanOutFor<OrderSummary, CustomerDeleted> {

  // The rows a customer event targets: those whose CustomerId is the event's stream id
  public static FanOutKey<OrderSummary> Targets => FanOut.By<OrderSummary>(o => o.CustomerId);

  public OrderSummary Apply(OrderSummary current, OrderPlaced e) =>
    new() { OrderId = e.OrderId, CustomerId = e.CustomerId, CustomerName = e.CustomerName };

  public ICollectiveSpec<OrderSummary> Apply(CustomerRenamed e) =>
    new CollectiveSpec<OrderSummary>(s => s.SetProperty(o => o.CustomerName, e.Name));

  // A foreign delete marks or clears the rows; it never removes them
  public ICollectiveSpec<OrderSummary> Apply(CustomerDeleted e) =>
    new CollectiveSpec<OrderSummary>(s => s.SetProperty(o => o.CustomerDeleted, true));
}
```

`CollectiveSpec<TModel>` is the same small consumer-owned record the [collective events](../messaging/collective-events)
page shows. One `Targets` serves every fan-out of the model when they share a key. A perspective that needs a
different key per foreign event implements `Targets` explicitly, once per interface:

```csharp{title="A different key per foreign event" description="Explicit Targets per interface give each foreign event its own key column" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Perspectives", "Multi-Stream", "Fan-Out"] testFile="PerspectiveFanOutDiscoveryGeneratorTests.cs" testMethod="Generator_ExplicitTargetsPerInterface_GiveEachEventItsOwnKeyAsync" tests=["PerspectiveFanOutDiscoveryGeneratorTests.Generator_ExplicitTargetsPerInterface_GiveEachEventItsOwnKeyAsync"]}
static FanOutKey<OrderSummary> IPerspectiveFanOutFor<OrderSummary, CustomerRenamed>.Targets =>
  FanOut.By<OrderSummary>(o => o.CustomerId);

static FanOutKey<OrderSummary> IPerspectiveFanOutFor<OrderSummary, RegionRenamed>.Targets =>
  FanOut.By<OrderSummary>(o => o.RegionId);
```

### What the build checks

The key is read from `Targets` at build time, so the build refuses every declaration it could not run as written:

| Rule | Why | Diagnostic |
|---|---|---|
| `Targets` returns `FanOut.By<TModel>(row => row.Key)` directly, naming one property of the model | The generator reads the column from the selector; any other form cannot be read | [WHIZ124](../../operations/diagnostics/whiz124) |
| The key is a `[PhysicalField]` | The rows are found by a real column, live and on a rebuild | [WHIZ125](../../operations/diagnostics/whiz125) |
| The key carries `[Indexed]` | Every foreign event filters the table on the key | [WHIZ126](../../operations/diagnostics/whiz126) |
| The key is a `Guid` or a strongly typed id over one, nullable or not | It is compared with the event's stream id | [WHIZ127](../../operations/diagnostics/whiz127) |
| No fan-out `Apply` and no `[CollectiveApplyFor]` handler assigns the key | A rebuild finds a row's foreign events from the keys its own events gave it | [WHIZ128](../../operations/diagnostics/whiz128) |
| A fan-out `Apply` depends only on the row and the event | It is folded per row on a rebuild, as a collective spec is | [WHIZ106](../../operations/diagnostics/whiz106) |
| The perspective, its model and the event are internal or public | The registry generated beside the declaration names them | [WHIZ129](../../operations/diagnostics/whiz129) |
| The foreign event is not a collective | A collective is applied by its own `[CollectiveApplyFor]` handlers, never as a fan-out | [WHIZ143](../../operations/diagnostics/whiz143) |

A fan-out `Apply` is also held to the determinism checks every Apply has ([WHIZ100](../../operations/diagnostics/whiz100) to
[WHIZ104](../../operations/diagnostics/whiz104)): no `async`, no I/O, no clock reads.

### Registration

The generator registers each fan-out it accepts as one entry per (model, foreign event), with its key column and a
typed invoker that calls the fan-out `Apply`. Every assembly contributes its entries to the `IPerspectiveFanOutRegistry` the host
serves, through `AddWhizbang()`, so there is nothing to register by hand. A perspective with no fan-out generates
nothing new.

### Why the member is `Apply` {#why-apply}

Every member that turns an event into a row change is called `Apply`: `IPerspectiveFor.Apply(model, event)` for a
row's own events, a `[CollectiveApplyFor]` handler's `Apply(event, query)` for a collective, and the fan-out's
`Apply(event)` for another stream's event. A fan-out's `Apply` takes the event alone and returns the set-based change,
so it overloads cleanly beside the row's own `Apply` methods on one perspective class. The design discussion's sketch
called it `Set`; it was renamed so the vocabulary stays one word.

## How a fan-out applies live {#how-a-fan-out-applies-live}

The foreign event is stored in this service's event store as any received or local event is. The startup
associations step writes each fan-out event type as a perspective association whose target is the collective sink
(`__collective__`), so the event store's existing perspective insert gives the event **one** sink row, on the outbox
and the inbox paths alike. The perspective worker's sink reads the row, wraps the event with its stream id and tenant,
and hands it to the same `ICollectiveDispatcher` a collective goes through. There is one set-based apply path for
both kinds of entry: the dispatcher runs each fan-out as an entry beside the `[CollectiveApplyFor]` handlers, through
the driver's collective executor.

```mermaid{caption="A fan-out event gets one __collective__ row; the perspective worker's sink wraps it with its stream and tenant and applies it through the collective dispatcher's set-based executor." tests=["PerspectiveWorkerCollectiveSinkTests.FanOut_TheSinkDispatchesTheForeignEvent_WrappedWithItsStreamAndTenantAsync"]}
flowchart LR
  E["CustomerRenamed<br/>stored on stream c-1"] -->|"perspective association<br/>target __collective__"| R["one __collective__ row"]
  R --> S["perspective worker:<br/>collective sink"]
  S -->|"fan-out scope:<br/>stream c-1, tenant t"| D["ICollectiveDispatcher"]
  D -->|"OrderSummaryProjection.Apply(CustomerRenamed)"| X["driver's collective executor"]
  X -->|"UPDATE ... WHERE customer_id = c-1<br/>AND tenant = t, in keyset batches"| T[("wh_per_order_summary")]
```

What the apply does on the EF Core driver (a host on the Dapper driver that declares a fan-out is refused at startup):

- **One statement per batch.** The rows are found by the key's column (`"customer_id" = @stream`), which the key's
  `[Indexed]` index serves, and by the event's tenant. The update runs in keyset batches under the collective apply
  lock, as a wide collective does; a customer with many orders is many batches of one statement each.
- **The event's tenant only.** A row of another tenant that holds the same key value is never touched. An event with
  no tenant (system scoped) targets nothing.
- **Once, and resumable.** The apply keeps the collective progress record
  ([Resuming an apply](../messaging/collective-events#resuming-an-apply)) under the event's id and the fan-out's entry
  key (`Perspective.Apply(Event):Model`). An event delivered again applies nothing; an apply interrupted after a batch
  resumes after the last batch that committed.
- **Mark and clear, never purge.** A fan-out's change is setters only, so a foreign delete sets a flag or clears the
  copied fields and every row stays. There is no purge of targeted rows: an order outlives its customer, and a purge
  is the one action that would make the replay order hard.
- **A failing `Apply` does not stop the host.** The sink reports the failure on the sink row, which is retried and
  dead-lettered at its bound like any perspective row.

There is nothing to register. The EF Core Postgres driver (`.WithEFCore<TDbContext>().WithDriver.Postgres`) registers
the collective dispatcher for a host that declares a fan-out, and the dispatcher makes the executor of each model a
fan-out targets, so no `AddCollectiveExecutorEFCore<TModel>()` is needed for it. A host that composes its services
another way and declares a fan-out without a collective dispatcher is refused at startup, with the models and the line
to add in the message; a fan-out is never declared and silently never applied.

:::warning
**EF Core only.** A fan-out is routed to its rows by the perspective associations step and applied by the perspective
worker, which the EF Core Postgres driver provides. The Dapper driver provides neither, so a Dapper host that declares
a fan-out is refused at schema initialization, before it touches the database.
:::

### Design choices {#fan-out-design-choices}

| Choice | Why | Locked by |
|---|---|---|
| A fan-out reaches the sink through a perspective association to `__collective__`, not a new branch in the emit chains | The store's hot path gains no statement and no branch; an ordinary event pays nothing | `FanOutRoutingSqlTests.Outbox_AnOrdinaryEvent_GetsItsPerspectiveRow_AndNoSinkRowAsync`, `ClaimFixedCostSqlTests.StorePass_AnOrdinaryEvent_RunsNoCollectiveRoutingAsync` |
| One set-based apply path: a fan-out runs as an entry of the collective dispatcher | Batching, the apply lock, progress and reach behave the same for both kinds of entry, with no second executor to keep in step | `FanOutCollectiveDispatchTests.DispatchAsync_AFanOut_RunsOnlyTheFanOutEntriesOfItsEventAsync` |
| Declarations keep their own registry (`IPerspectiveFanOutRegistry`) | A declaration carries what a collective handler has no use for (the key column and selector, which replay needs too); the dispatcher derives its entries from it | `FanOutCollectiveDispatchTests.GetCollectiveDispatchEntries_AreTheHandlersThenEachFanOutAsync` |
| A fan-out applies only to its own wrapper, never to a collective of the same type | A type that is both runs each from its own row, once | `FanOutCollectiveDispatchTests.AppliesTo_ACollectiveEntry_NeverAppliesToAFanOutWrapperAsync` |
| The event's tenant bounds the rows | A key value is unique within a tenant, not across tenants | `FanOutApplyEFCoreTests.ARename_InOneTenant_LeavesTheSameCustomerIdInAnotherTenantAloneAsync` |
| Mark and clear, no purge | Rows outlive the foreign aggregate; a purge would make replay ordering hard | `FanOutApplyEFCoreTests.ADelete_MarksTheCustomersOrders_AndRemovesNoneAsync` |
| No registration to remember: the driver registers the dispatcher and the dispatcher makes each fan-out model's executor | A declared fan-out that nothing applies is the one failure no test of the perspective itself would show | `FanOutWiringTests.ForDispatch_CreatesOneExecutorPerFanOutModelThatHasNone_AndKeepsTheRegisteredOnesAsync`, `PostgresDriverExtensionsTests.Postgres_AHostThatDeclaresAFanOut_GetsTheCollectiveDispatcher_WithNothingToAddAsync` |
| A host that cannot apply a fan-out is refused at startup | Refusing loudly beats completing rows nothing applied | `FanOutWiringTests.Validator_AFanOutWithNoCollectiveDispatcher_RefusesTheHost_NamingTheModelAndTheLineAsync`, `DapperFanOutRefusalTests.ADapperHostThatDeclaresAFanOut_IsRefusedAtSchemaInitialization_BeforeItConnectsAsync` |
| A strongly typed id key is compared by its Guid, in SQL and in memory alike | The column stores the Guid; a boxed id never equals a boxed Guid | `FanOutCollectiveDispatchTests.ScopeFilter_AStronglyTypedIdKey_MatchesTheRowWhoseIdWrapsTheStreamIdAsync` |

:::note
Live fan-out is available now. A rebuild or rewind of a fan-out perspective does not yet fold the foreign events that
target a row, and a fan-out that commits beside a row's own later event is not yet reconciled into commit order; both
are delivered in the slices that follow. Until then, a rebuild of a fan-out perspective resets the fanned-out fields
to what the row's own events set.
:::

---

## Storage & Checkpointing

### Storage

Multi-stream perspectives use the **same generated per-model tables** (`wh_per_<model>`) as single-stream perspectives. The row's `id` column stores the **partition key** (instead of the stream ID):

- `Guid` partition keys are stored as-is.
- `string` and other partition key types are converted to a **deterministic Guid** via an MD5 hash of their string representation (see `EFCorePostgresPerspectiveStore._convertPartitionKeyToGuid`).

The store exposes partition-key access via `GetByPartitionKeyAsync<TPartitionKey>(...)` and `UpsertByPartitionKeyAsync<TPartitionKey>(...)`.

### Cursor Tracking

Perspective progress is tracked in `wh_perspective_cursors`, keyed by `(stream_id, perspective_name)`:

```sql{title="Cursor Tracking" description="Perspective cursor table schema" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Checkpointing"]}
-- Perspective Cursors - Read model projection tracking (checkpoint-style)
CREATE TABLE IF NOT EXISTS wh_perspective_cursors (
  stream_id UUID NOT NULL,
  perspective_name TEXT NOT NULL,
  last_event_id UUID NOT NULL,
  status SMALLINT NOT NULL DEFAULT 0,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  error TEXT NULL,
  CONSTRAINT pk_perspective_cursors PRIMARY KEY (stream_id, perspective_name)
);
```

---

## Testing Multi-Stream Perspectives

### Unit Tests

```csharp{title="Unit Tests" description="Unit Tests" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Perspectives", "Unit", "Tests"] tests=["IGlobalPerspectiveForTests.GlobalPerspective_HasGetPartitionKeyMethod_ExtractsPartitionFromEventAsync", "IGlobalPerspectiveForTests.GlobalPerspective_ApplyMethod_IsPureFunctionAsync", "IGlobalPerspectiveForTests.GlobalPerspective_EventsFromDifferentStreams_UpdateSamePartitionAsync"]}
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

1. **Up to 50 event types** per `IGlobalPerspectiveFor` implementation, the same as `IPerspectiveFor` and `IPerspectiveWithActionsFor`; implement it again for more
2. **Partition key must be notnull** (`where TPartitionKey : notnull`)
3. **Model must be class** (`where TModel : class`)
4. **No built-in UI for v1.0.0** (manual perspective registration)

**More than 50 events**: implement `IGlobalPerspectiveFor` again on the same class; the generator merges every implementation's events.

---

## Further Reading

**Core Concepts**:
- [Perspectives](perspectives.md) - Single-stream perspectives (IPerspectiveFor)
- [Lenses](../lenses/lenses.md) - Query interfaces for read models
- [StreamId Attribute](../../extending/attributes/streamid.md) - Stream identification

**Source Generators**:
- [Perspective Discovery](../../extending/source-generators/perspective-discovery.md) - Auto-discovery and runner generation

**Data Access**:
- [Perspective Storage](../../data/perspectives-storage.md) - Read model persistence
- [Event Store](../../data/event-store.md) - Event sourcing foundation

**Workers**:
- [Perspective Worker](../../operations/workers/perspective-worker.md) - Checkpoint processing and runtime

**External Resources**:
- [Marten MultiStreamProjection](https://martendb.io/events/projections/multi-stream-projections.html) - Inspiration for this pattern

---

*Version 1.0.0 - Foundation Release | Last Updated: 2025-12-22*
