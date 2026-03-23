---
title: Events
version: 1.0.0
category: Core Concepts
order: 11
description: >-
  Event definition, EventId value object, and event design patterns in Whizbang.
tags: 'events, event-sourcing, eventid, immutability'
codeReferences:
  - src/Whizbang.Core/IEvent.cs
  - src/Whizbang.Core/ValueObjects/EventId.cs
---

# Events

Events represent **facts** - things that have happened in the system. The `EventId` value object uniquely identifies each event.

## Overview

Events are the **source of truth** in event-sourced systems:

- **Immutable**: Events cannot be changed after creation
- **Facts**: They describe what happened, not what should happen
- **Past tense**: Named to reflect completed actions (e.g., `OrderCreated`)
- **Multiple handlers**: Can be processed by many receptors and perspectives

## IEvent Interface

```csharp{title="IEvent Interface" description="Demonstrates iEvent Interface" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "IEvent", "Interface"]}
namespace Whizbang.Core;

/// <summary>
/// Marker interface for event messages.
/// Events represent facts about state changes that have occurred.
/// </summary>
public interface IEvent : IMessage {
  // Marker interface - no members required
}
```

## EventId Value Object {#eventid}

```csharp{title="EventId Value Object" description="Demonstrates eventId Value Object" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "EventId", "Value"]}
namespace Whizbang.Core.ValueObjects;

/// <summary>
/// Uniquely identifies an event within a stream.
/// Uses UUIDv7 (time-ordered, database-friendly) for optimal indexing performance.
/// Uses Medo.Uuid7 for monotonic counter-based generation with guaranteed uniqueness.
/// </summary>
[WhizbangId]
public readonly partial struct EventId;
```

### Creating EventIds

```csharp{title="Creating EventIds" description="Demonstrates creating EventIds" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Creating", "EventIds"]}
// Create new EventId (UUIDv7)
var eventId = EventId.New();

// From existing Guid
var eventId = EventId.From(existingGuid);

// Parse from string
var eventId = EventId.Parse("550e8400-e29b-41d4-a716-446655440000");

// Implicit conversion to Guid
Guid guid = eventId;

// Get underlying value
Guid underlying = eventId.Value;
```

## Defining Events

### Basic Event

```csharp{title="Basic Event" description="Demonstrates basic Event" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "Basic", "Event"]}
public record OrderCreated : IEvent {
  [StreamKey]
  public required Guid OrderId { get; init; }
  public required Guid CustomerId { get; init; }
  public required OrderItem[] Items { get; init; }
  public required decimal Total { get; init; }
  public required DateTimeOffset CreatedAt { get; init; }
}
```

### Event with Complete State

Capture all relevant information:

```csharp{title="Event with Complete State" description="Capture all relevant information:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Event", "Complete"]}
public record ProductPriceChanged : IEvent {
  [StreamKey]
  public required Guid ProductId { get; init; }
  public required decimal OldPrice { get; init; }   // Before
  public required decimal NewPrice { get; init; }   // After
  public required string Currency { get; init; }
  public required DateTimeOffset ChangedAt { get; init; }
  public required string ChangedBy { get; init; }   // Who made the change
  public string? Reason { get; init; }              // Why (optional)
}
```

### Event with Nested Data

```csharp{title="Event with Nested Data" description="Demonstrates event with Nested Data" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Event", "Nested"]}
public record OrderShipped : IEvent {
  [StreamKey]
  public required Guid OrderId { get; init; }
  public required ShippingInfo Shipping { get; init; }
  public required DateTimeOffset ShippedAt { get; init; }
}

public record ShippingInfo {
  public required string Carrier { get; init; }
  public required string TrackingNumber { get; init; }
  public required Address DestinationAddress { get; init; }
  public DateTimeOffset? EstimatedDelivery { get; init; }
}
```

## Event Naming Conventions

### Use Past Tense

Events describe what **has happened**:

```csharp{title="Use Past Tense" description="Events describe what has happened:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Events", "Past", "Tense"]}
// ✅ GOOD: Past tense
public record OrderCreated : IEvent { }
public record PaymentProcessed : IEvent { }
public record InventoryReserved : IEvent { }

// ❌ BAD: Present/imperative tense
public record CreateOrder : IEvent { }      // This is a command!
public record ProcessPayment : IEvent { }   // This is a command!
```

### Be Specific

Events should clearly describe the state change:

```csharp{title="Be Specific" description="Events should clearly describe the state change:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Specific"]}
// ✅ GOOD: Specific events
public record OrderStatusChangedToShipped : IEvent { }
public record OrderStatusChangedToDelivered : IEvent { }
public record OrderItemQuantityUpdated : IEvent { }

// ⚠️ ACCEPTABLE: General but clear
public record OrderShipped : IEvent { }
public record OrderDelivered : IEvent { }

// ❌ BAD: Too generic
public record OrderUpdated : IEvent { }  // What was updated?
public record OrderChanged : IEvent { }  // What changed?
```

## Event Data Guidelines

### Capture Complete State

```csharp{title="Capture Complete State" description="Demonstrates capture Complete State" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Capture", "Complete"]}
// ✅ GOOD: Complete state for reconstruction
public record AccountBalanceChanged : IEvent {
  [StreamKey]
  public required Guid AccountId { get; init; }
  public required decimal PreviousBalance { get; init; }
  public required decimal NewBalance { get; init; }
  public required decimal Amount { get; init; }
  public required TransactionType TransactionType { get; init; }
  public required DateTimeOffset Timestamp { get; init; }
}

// ❌ BAD: Incomplete - can't reconstruct history
public record AccountBalanceChanged : IEvent {
  public required Guid AccountId { get; init; }
  public required decimal NewBalance { get; init; }
  // Missing: previous balance, amount, type, timestamp
}
```

### Include Temporal Information

```csharp{title="Include Temporal Information" description="Demonstrates include Temporal Information" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Include", "Temporal"]}
public record OrderCreated : IEvent {
  [StreamKey]
  public required Guid OrderId { get; init; }
  public required DateTimeOffset CreatedAt { get; init; }  // When it happened
}

public record OrderCancelled : IEvent {
  [StreamKey]
  public required Guid OrderId { get; init; }
  public required DateTimeOffset CancelledAt { get; init; }
  public required string Reason { get; init; }
}
```

### Use Value Objects for Type Safety

```csharp{title="Use Value Objects for Type Safety" description="Demonstrates use Value Objects for Type Safety" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Value", "Objects"]}
// ✅ GOOD: Type-safe identifiers
public record OrderCreated : IEvent {
  [StreamKey]
  public required OrderId OrderId { get; init; }    // Strongly-typed
  public required CustomerId CustomerId { get; init; }
  public required Money Total { get; init; }
}

// ❌ BAD: Primitive obsession
public record OrderCreated : IEvent {
  public required Guid OrderId { get; init; }
  public required string CustomerId { get; init; }  // What format?
  public required decimal Total { get; init; }      // What currency?
}
```

## Event Immutability

Events are **facts** and must be immutable:

```csharp{title="Event Immutability" description="Events are facts and must be immutable:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Event", "Immutability"]}
// ✅ GOOD: Immutable record with init-only properties
public record OrderCreated : IEvent {
  public required Guid OrderId { get; init; }  // Can only be set during construction
  public required DateTimeOffset CreatedAt { get; init; }
}

// ❌ BAD: Mutable properties
public class OrderCreated : IEvent {
  public Guid OrderId { get; set; }  // Can be modified!
  public DateTimeOffset CreatedAt { get; set; }
}
```

## Event vs Fact

Events are **not** commands or intentions. They represent **accomplished facts**:

```csharp{title="Event vs Fact" description="Events are not commands or intentions." category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Event", "Fact"]}
// Command (intention): "Please create an order"
public record CreateOrder : ICommand {
  public required Guid CustomerId { get; init; }
  public required OrderItem[] Items { get; init; }
}

// Event (fact): "An order was created"
public record OrderCreated : IEvent {
  [StreamKey]
  public required Guid OrderId { get; init; }
  public required Guid CustomerId { get; init; }
  public required OrderItem[] Items { get; init; }
  public required DateTimeOffset CreatedAt { get; init; }
}
```

Key differences:
- **Commands can fail** - events represent successful outcomes
- **Commands are requests** - events are notifications
- **Commands have one handler** - events can have many
- **Commands use imperative** - events use past tense

## Event Handling

### In Receptors

```csharp{title="In Receptors" description="Demonstrates in Receptors" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Receptors"]}
public class InventoryReceptor : IReceptor<OrderCreated, InventoryReserved> {
  public async ValueTask<InventoryReserved> HandleAsync(
      OrderCreated @event,
      CancellationToken ct = default) {

    // React to the fact that an order was created
    await ReserveInventoryAsync(@event.Items, ct);

    return new InventoryReserved {
      OrderId = @event.OrderId,
      Items = @event.Items,
      ReservedAt = _timeProvider.GetUtcNow()
    };
  }
}
```

### In Perspectives

```csharp{title="In Perspectives" description="Demonstrates in Perspectives" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Events", "Perspectives"]}
public class OrderSummaryPerspective : IPerspective<OrderSummary> {
  public async Task<OrderSummary> ProjectAsync(
      IEvent @event,
      OrderSummary? current,
      CancellationToken ct = default) {

    return @event switch {
      OrderCreated e => new OrderSummary {
        OrderId = e.OrderId,
        CustomerId = e.CustomerId,
        Total = e.Total,
        Status = "Created",
        CreatedAt = e.CreatedAt
      },
      OrderShipped e => current! with {
        Status = "Shipped",
        ShippedAt = e.ShippedAt
      },
      OrderDelivered e => current! with {
        Status = "Delivered",
        DeliveredAt = e.DeliveredAt
      },
      _ => current!
    };
  }
}
```

## Best Practices

### DO

- **Use records** for immutability
- **Include all relevant state** for reconstruction
- **Add temporal data** (timestamps)
- **Use specific names** that describe the change
- **Use value objects** for type safety

### DON'T

- **Don't modify events** after creation
- **Don't use mutable properties**
- **Don't use generic names** like "Updated" or "Changed"
- **Don't omit important state**
- **Don't confuse with commands**

## Related Documentation

- [Messages](../messages/messages.md) - IMessage base interface
- [Event Streams](event-streams.md) - Stream organization
- [Stream ID](stream-id.md) - Stream identification
- [Commands and Events](../../messaging/commands-events.md) - Detailed patterns
- [Perspectives](../perspectives/perspectives.md) - Event projections

---

*Version 1.0.0 - Foundation Release*
