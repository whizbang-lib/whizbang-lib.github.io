---
title: "Commands and Events"
version: 1.0.0
category: "Messaging"
order: 5
description: >-
  Core message types in Whizbang representing intent (commands) and facts
  (events). Covers ICommand, IEvent, and IQuery marker interfaces, naming
  conventions, and message envelope integration.
tags: 'commands, events, queries, messaging, ICommand, IEvent, CQRS, message-types'
codeReferences:
  - src/Whizbang.Core/ICommand.cs
  - src/Whizbang.Core/IEvent.cs
  - src/Whizbang.Core/IQuery.cs
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

```csharp{title="Definition" description="Demonstrates definition" category="Architecture" difficulty="BEGINNER" tags=["Messaging", "Definition"]}
/// <summary>
/// Marker interface for command messages
/// </summary>
/// <docs>messaging/commands-events</docs>
public interface ICommand {
  // Marker interface - no members
}
```

### Example Commands

```csharp{title="Example Commands" description="Demonstrates example Commands" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "Example", "Commands"]}
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

```csharp{title="Definition - for" description="Demonstrates definition" category="Architecture" difficulty="BEGINNER" tags=["Messaging", "Definition"]}
/// <summary>
/// Marker interface for event messages
/// </summary>
/// <docs>messaging/commands-events</docs>
public interface IEvent {
  // Marker interface - no members
}
```

### Example Events

```csharp{title="Example Events" description="Demonstrates example Events" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "Example", "Events"]}
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

```csharp{title="Command → Event Flow" description="Commands trigger business logic that results in events:" category="Architecture" difficulty="ADVANCED" tags=["Messaging", "Command", "Event", "Flow"]}
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
  public async Task<OrderCreated> HandleAsync(
    CreateOrder command,
    IMessageContext context,
    CancellationToken cancellationToken = default
  ) {
    // Validate business rules
    if (command.Items.Length == 0) {
      throw new InvalidOperationException("Order must contain at least one item");
    }

    // Create order
    var orderId = Guid.CreateVersion7();
    var totalAmount = command.Items.Sum(i => i.Price * i.Quantity);

    // Return event (fact)
    return new OrderCreated {
      OrderId = orderId,
      CustomerId = command.CustomerId,
      Items = command.Items,
      TotalAmount = totalAmount,
      CreatedAt = DateTimeOffset.UtcNow
    };
  }
}
```

## Message Envelopes

Both commands and events are wrapped in `MessageEnvelope<T>` for routing and tracing:

```csharp{title="Message Envelopes" description="Both commands and events are wrapped in MessageEnvelope<T> for routing and tracing:" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "Message", "Envelopes"]}
// Dispatch a command
var createOrder = new CreateOrder {
  CustomerId = "cust-123",
  Items = [
    new OrderItem { ProductId = "prod-456", Quantity = 2, Price = 29.99m }
  ]
};

var result = await dispatcher.DispatchAsync<CreateOrder, OrderCreated>(createOrder);

// The envelope provides:
// - MessageId (UUIDv7)
// - CorrelationId (for distributed tracing)
// - CausationId (parent message)
// - Hops (routing and metadata)
// - SecurityContext (user, tenant)
// - PolicyDecisionTrail (authorization audit)
```

See [Message Envelopes](message-envelopes.md) for details.

## Event Sourcing

Events are the source of truth in event-sourced systems:

```csharp{title="Event Sourcing" description="Events are the source of truth in event-sourced systems:" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "Event", "Sourcing"]}
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

  // Rebuild state from events
  public static Order FromEvents(IEnumerable<IEvent> events) {
    var order = new Order();
    foreach (var e in events) {
      order.Apply((dynamic)e);
    }
    return order;
  }
}
```

See [Event Store](../data/event-store.md) for details.

## Perspectives (Read Models)

Events drive perspectives - read models optimized for queries:

```csharp{title="Perspectives (Read Models)" description="Events drive perspectives - read models optimized for queries:" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "Perspectives", "Read", "Models"]}
// Perspective: Order summary read model
public class OrderSummaryPerspective : IPerspectiveOf<OrderSummary> {
  public async Task<OrderSummary> ProjectAsync(
    IEvent @event,
    OrderSummary? current,
    CancellationToken cancellationToken = default
  ) {
    return @event switch {
      OrderCreated e => new OrderSummary {
        OrderId = e.OrderId,
        CustomerId = e.CustomerId,
        TotalAmount = e.TotalAmount,
        Status = "Created",
        CreatedAt = e.CreatedAt
      },
      OrderCancelled e => current with {
        Status = "Cancelled",
        CancelledAt = e.CancelledAt
      },
      _ => current ?? throw new InvalidOperationException("Unknown event type")
    };
  }
}
```

See [Perspectives](../fundamentals/perspectives/perspectives.md) for details.

## Best Practices

### Command Design

**1. Use value objects for type safety**:
```csharp{title="Command Design" description="Demonstrates command Design" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "Command", "Design"]}
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
```csharp{title="Command Design - CreateOrder" description="Demonstrates command Design" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "Command", "Design"]}
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
```csharp{title="Command Design - with" description="Demonstrates command Design" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "Command", "Design"]}
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
```csharp{title="Event Design" description="Demonstrates event Design" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "Event", "Design"]}
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
```csharp{title="Event Design - OrderCreated" description="Demonstrates event Design" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "Event", "Design"]}
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
```csharp{title="Event Design - OrderCreated" description="Demonstrates event Design" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "Event", "Design"]}
// ✅ GOOD: UUIDv7 for database-friendly, time-ordered IDs
public record OrderCreated : IEvent {
  public required Guid OrderId { get; init; }  // Generated via Guid.CreateVersion7()
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
