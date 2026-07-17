---
title: "Commands and Events"
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: "Messaging"
order: 5
description: >-
  Core message types in Whizbang representing intent (commands) and facts
  (events). Covers ICommand, IEvent, and IQuery marker interfaces, naming
  conventions, and message envelope integration.
tags: 'commands, events, queries, messaging, ICommand, IEvent, CQRS, message-types'
codeReferences:
  - src/Whizbang.Core/IMessage.cs
  - src/Whizbang.Core/ICommand.cs
  - src/Whizbang.Core/IEvent.cs
  - src/Whizbang.Core/IQuery.cs
  - src/Whizbang.Core/IReceptor.cs
  - src/Whizbang.Core/Observability/MessageEnvelope.cs
testReferences:
  - tests/Whizbang.Core.Tests/Receptors/ReceptorTests.cs
  - tests/Whizbang.Generators.Tests/MessageRegistryGeneratorTests.cs
lastMaintainedCommit: '01f07906'
---

# Commands and Events

Commands and Events are the core message types in Whizbang, representing intent (commands) and facts (events) in your domain.

## Overview

Whizbang uses marker interfaces to distinguish between different message types:

- **Commands**: Represent intent or requests for action (e.g., `CreateOrder`, `CancelOrder`)
- **Events**: Represent facts or things that have happened (e.g., `OrderCreated`, `OrderCancelled`)

Both commands and events are wrapped in [Message Envelopes](message-envelopes.md) for routing, tracing, and metadata.

## ICommand Interface

Commands express **intent** - a request to perform an action in the system.

### Characteristics

- **Imperative naming**: `CreateOrder`, `UpdateInventory`, `ProcessPayment`
- **Single handler**: Typically processed by exactly one receptor
- **Can fail**: Commands can be rejected due to business rules or validation
- **Idempotent**: Should be safe to retry
- **Authorization**: May require permissions or policies

### Definition

```csharp{title="Definition" description="Definition" category="Architecture" difficulty="BEGINNER" tags=["Messaging", "Definition"]}
/// <summary>
/// Marker interface for commands - messages that represent an intent to change state.
/// Commands are processed by Receptors which validate business rules and emit Events.
/// </summary>
public interface ICommand : IMessage;
```

`ICommand` extends `IMessage`, the base marker for every message in the system.

### Example Commands

```csharp{title="Example Commands" description="Example Commands" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Commands"]}
public record CreateOrder : ICommand {
  public required string CustomerId { get; init; }
  public required OrderItem[] Items { get; init; }
  public string? CouponCode { get; init; }
}

public record CancelOrder : ICommand {
  public required Guid OrderId { get; init; }
  public required string Reason { get; init; }
}

public record UpdateInventory : ICommand {
  public required string ProductId { get; init; }
  public required int QuantityChange { get; init; }
}
```

### Naming Conventions

**Commands use imperative verbs**:
- ✅ `CreateOrder`, `UpdateProfile`, `ProcessPayment`
- ❌ `OrderCreation`, `ProfileUpdate`, `PaymentProcessing`

**Commands are specific**:
- ✅ `ApproveOrder`, `RejectOrder`, `CancelOrder`
- ❌ `ModifyOrder`, `ChangeOrder`, `UpdateOrder` (too generic)

## IEvent Interface

Events represent **facts** - things that have already happened in the system.

### Characteristics

- **Past tense naming**: `OrderCreated`, `PaymentProcessed`, `InventoryUpdated`
- **Multiple handlers**: Can be processed by many receptors and perspectives
- **Cannot fail**: Events are facts - you can't "reject" something that already happened
- **Immutable**: Events should never be modified after creation
- **Source of truth**: Events drive perspectives (read models) and analytics

### Definition

```csharp{title="Definition - for" description="Definition - for" category="Architecture" difficulty="BEGINNER" tags=["Messaging", "Definition"]}
/// <summary>
/// Marker interface for events - messages that represent facts about
/// state changes that have already occurred.
/// </summary>
public interface IEvent : IMessage;
```

A third marker, `IQuery : IMessage`, exists for read-only request messages.

### Example Events

```csharp{title="Example Events" description="Example Events" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Events"]}
public record OrderCreated : IEvent {
  public required Guid OrderId { get; init; }
  public required string CustomerId { get; init; }
  public required OrderItem[] Items { get; init; }
  public required decimal TotalAmount { get; init; }
  public required DateTimeOffset CreatedAt { get; init; }
}

public record OrderCancelled : IEvent {
  public required Guid OrderId { get; init; }
  public required string Reason { get; init; }
  public required DateTimeOffset CancelledAt { get; init; }
}

public record InventoryUpdated : IEvent {
  public required string ProductId { get; init; }
  public required int OldQuantity { get; init; }
  public required int NewQuantity { get; init; }
  public required DateTimeOffset UpdatedAt { get; init; }
}
```

### Naming Conventions

**Events use past tense**:
- ✅ `OrderCreated`, `PaymentProcessed`, `InventoryReserved`
- ❌ `CreateOrder`, `ProcessPayment`, `ReserveInventory`

**Events capture state changes**:
- ✅ `ProductPriceChanged` (includes old and new price)
- ✅ `OrderStatusChanged` (includes old and new status)
- ❌ `ProductUpdated` (too generic, doesn't capture what changed)

## Command → Event Flow

Commands trigger business logic that results in events:

```csharp{title="Command → Event Flow" description="Commands trigger business logic that results in events:" category="Architecture" difficulty="ADVANCED" tags=["Messaging", "C#", "Command", "Event", "Flow"]}
// Command: Request to create an order
public record CreateOrder : ICommand {
  public required string CustomerId { get; init; }
  public required OrderItem[] Items { get; init; }
}

// Event: Order was created successfully
public record OrderCreated : IEvent {
  public required Guid OrderId { get; init; }
  public required string CustomerId { get; init; }
  public required OrderItem[] Items { get; init; }
  public required decimal TotalAmount { get; init; }
  public required DateTimeOffset CreatedAt { get; init; }
}

// Receptor: Handles command, produces event
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
  public async ValueTask<OrderCreated> HandleAsync(
    CreateOrder message,
    CancellationToken cancellationToken = default
  ) {
    // Validate business rules
    if (message.Items.Length == 0) {
      throw new InvalidOperationException("Order must contain at least one item");
    }

    // Create order (TrackedGuid.NewMedo() generates a time-ordered UUIDv7)
    Guid orderId = TrackedGuid.NewMedo();
    var totalAmount = message.Items.Sum(i => i.Price * i.Quantity);

    // Return event (fact)
    return new OrderCreated {
      OrderId = orderId,
      CustomerId = message.CustomerId,
      Items = message.Items,
      TotalAmount = totalAmount,
      CreatedAt = DateTimeOffset.UtcNow
    };
  }
}
```

## Message Envelopes

Both commands and events are wrapped in `MessageEnvelope<T>` for routing and tracing:

```csharp{title="Message Envelopes" description="Both commands and events are wrapped in MessageEnvelope<T> for routing and tracing:" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Message", "Envelopes"]}
// Dispatch a command
var createOrder = new CreateOrder {
  CustomerId = "cust-123",
  Items = [
    new OrderItem { ProductId = "prod-456", Quantity = 2, Price = 29.99m }
  ]
};

// In-process, typed result:
var result = await dispatcher.LocalInvokeAsync<CreateOrder, OrderCreated>(createOrder);

// Or route through the messaging pipeline (outbox/transport):
var receipt = await dispatcher.SendAsync(createOrder);

// The envelope provides:
// - MessageId (UUIDv7)
// - Hops (routing/audit trail; each hop carries CorrelationId for
//   distributed tracing, CausationId for the parent message, scope
//   deltas for security context, and the policy decision trail)
// - SourceServiceId / SourceCommitSequence (origin stamps)
// - EventFlags (category and treatment flags)
```

See [Message Envelopes](message-envelopes.md) for details.

## Event Sourcing

Events are the source of truth in event-sourced systems:

```csharp{title="Event Sourcing" description="Events are the source of truth in event-sourced systems:" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Event", "Sourcing"]}
// Event store tracks all events for an aggregate
public class Order {
  public Guid Id { get; private set; }
  public List<IEvent> Events { get; } = new();

  public void Apply(OrderCreated e) {
    Id = e.OrderId;
    // ... update state
  }

  public void Apply(OrderCancelled e) {
    // ... update state
  }

  // Rebuild state from events (pattern matching - AOT-compatible, no reflection)
  public static Order FromEvents(IEnumerable<IEvent> events) {
    var order = new Order();
    foreach (var e in events) {
      switch (e) {
        case OrderCreated created: order.Apply(created); break;
        case OrderCancelled cancelled: order.Apply(cancelled); break;
      }
    }
    return order;
  }
}
```

See [Event Store](../data/event-store.md) for details.

## Perspectives (Read Models)

Events drive perspectives - read models optimized for queries:

```csharp{title="Perspectives (Read Models)" description="Events drive perspectives - read models optimized for queries:" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Perspectives", "Read", "Models"]}
// Perspective: Order summary read model.
// Apply methods are pure functions: no I/O, no side effects, deterministic.
public class OrderSummaryPerspective : IPerspectiveFor<OrderSummary, OrderCreated, OrderCancelled> {
  public OrderSummary Apply(OrderSummary currentData, OrderCreated eventData) {
    return currentData with {
      OrderId = eventData.OrderId,
      CustomerId = eventData.CustomerId,
      TotalAmount = eventData.TotalAmount,
      Status = "Created",
      CreatedAt = eventData.CreatedAt
    };
  }

  public OrderSummary Apply(OrderSummary currentData, OrderCancelled eventData) {
    return currentData with {
      Status = "Cancelled",
      CancelledAt = eventData.CancelledAt
    };
  }
}
```

See [Perspectives](../fundamentals/perspectives/perspectives.md) for details.

## Best Practices

### Command Design

**1. Use value objects for type safety**:
```csharp{title="Command Design" description="Command Design" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Command", "Design"]}
// ✅ GOOD: Type-safe value objects
public record CreateOrder : ICommand {
  public required CustomerId CustomerId { get; init; }
  public required OrderItem[] Items { get; init; }
}

// ❌ BAD: Primitive obsession
public record CreateOrder : ICommand {
  public required string CustomerId { get; init; }  // What format? Validated?
  public required object[] Items { get; init; }      // What type?
}
```

**2. Make commands self-contained**:
```csharp{title="Command Design - CreateOrder" description="Command Design - CreateOrder" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Command", "Design", "CreateOrder"]}
// ✅ GOOD: Everything needed to process the command
public record CreateOrder : ICommand {
  public required string CustomerId { get; init; }
  public required OrderItem[] Items { get; init; }
  public required Address ShippingAddress { get; init; }
  public string? CouponCode { get; init; }
}

// ❌ BAD: Requires external lookups
public record CreateOrder : ICommand {
  public required string CustomerId { get; init; }
  // Missing: Items, shipping address - where do these come from?
}
```

**3. Use records for immutability**:
```csharp{title="Command Design - with" description="Command Design - with" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Command", "Design"]}
// ✅ GOOD: Immutable record with init-only properties
public record CreateOrder : ICommand {
  public required string CustomerId { get; init; }
  public required OrderItem[] Items { get; init; }
}

// ❌ BAD: Mutable class with setters
public class CreateOrder : ICommand {
  public string CustomerId { get; set; }  // Can be modified after creation!
  public OrderItem[] Items { get; set; }
}
```

### Event Design

**1. Capture all relevant state**:
```csharp{title="Event Design" description="Event Design" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Event", "Design"]}
// ✅ GOOD: Complete snapshot of what changed
public record ProductPriceChanged : IEvent {
  public required string ProductId { get; init; }
  public required decimal OldPrice { get; init; }
  public required decimal NewPrice { get; init; }
  public required DateTimeOffset ChangedAt { get; init; }
  public required string ChangedBy { get; init; }
}

// ❌ BAD: Incomplete - can't reconstruct history
public record ProductPriceChanged : IEvent {
  public required string ProductId { get; init; }
  public required decimal NewPrice { get; init; }
  // Missing: old price, timestamp, who made the change
}
```

**2. Make events immutable and serializable**:
```csharp{title="Event Design - OrderCreated" description="Event Design - OrderCreated" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Event", "Design", "OrderCreated"]}
// ✅ GOOD: All properties init-only, no methods
public record OrderCreated : IEvent {
  public required Guid OrderId { get; init; }
  public required string CustomerId { get; init; }
  public required OrderItem[] Items { get; init; }
}

// ❌ BAD: Mutable properties, non-serializable state
public record OrderCreated : IEvent {
  public Guid OrderId { get; set; }  // Mutable!
  public Func<decimal> CalculateTotal { get; set; }  // Non-serializable!
}
```

**3. Use UUIDv7 for time-ordered IDs**:
```csharp{title="Event Design - OrderCreated" description="Event Design - OrderCreated" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Event", "Design", "OrderCreated"]}
// ✅ GOOD: UUIDv7 for database-friendly, time-ordered IDs
public record OrderCreated : IEvent {
  public required Guid OrderId { get; init; }  // Generated via TrackedGuid.NewMedo()
  public required DateTimeOffset CreatedAt { get; init; }
}

// ❌ BAD: Random GUIDs cause index fragmentation
public record OrderCreated : IEvent {
  public required Guid OrderId { get; init; }  // Guid.NewGuid() - random!
}
```

## Related Topics

- [Message Envelopes](message-envelopes.md) - How commands and events are wrapped for routing
- [Receptors](../fundamentals/receptors/receptors.md) - How commands are handled
- [Perspectives](../fundamentals/perspectives/perspectives.md) - How events drive read models
- [Event Store](../data/event-store.md) - How events are persisted
- [Inbox Pattern](inbox-pattern.md) - Guaranteed message delivery
- [Outbox Pattern](outbox-pattern.md) - Transactional message publishing

## Summary

- **Commands** = Intent (imperative verbs, can fail, single handler)
- **Events** = Facts (past tense, cannot fail, multiple handlers)
- Both wrapped in **MessageEnvelope** for routing and tracing
- Commands handled by **Receptors** which produce events
- Events drive **Perspectives** (read models) and analytics
- Use **records** for immutability
- Use **value objects** for type safety
- Use **UUIDv7** for time-ordered IDs
