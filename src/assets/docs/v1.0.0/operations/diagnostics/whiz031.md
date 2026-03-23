---
title: 'WHIZ031: Multiple StreamKey Attributes'
description: >-
  Event type has multiple properties marked with [StreamKey] - only one is
  allowed
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - perspectives
  - streamkey
  - source-generator
---

# WHIZ031: Multiple StreamKey Attributes

**Severity**: Error
**Category**: Source Generation

## Description

This error occurs when an event type has more than one property marked with the `[StreamKey]` attribute. Each event can only have **exactly one** stream key property because it uniquely identifies which stream (aggregate) the event belongs to.

## Error Message

```
Event type 'MyNamespace.OrderEvent' has multiple properties marked with [StreamKey]. Only one property can be the stream key.
```

## How to Fix

Remove the `[StreamKey]` attribute from all but one property. Keep it only on the property that identifies the aggregate/stream:

**Before (causes WHIZ031)**:
```csharp{title="How to Fix" description="Before (causes WHIZ031):" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Fix"]}
public record OrderEvent : IEvent {
  [StreamKey]  // ❌ Multiple [StreamKey] attributes!
  public Guid OrderId { get; init; }

  [StreamKey]  // ❌ Remove this!
  public Guid CustomerId { get; init; }

  public decimal Amount { get; init; }
}
```

**After (error resolved)**:
```csharp{title="How to Fix - OrderEvent" description="After (error resolved):" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Fix"]}
public record OrderEvent : IEvent {
  [StreamKey]  // ✅ Single [StreamKey] on the aggregate ID
  public Guid OrderId { get; init; }

  // CustomerId is just a regular property
  public Guid CustomerId { get; init; }

  public decimal Amount { get; init; }
}
```

## Choosing the Right Property

The `[StreamKey]` should mark the property that identifies the **primary aggregate** for this event:

```csharp{title="Choosing the Right Property" description="The [StreamKey] should mark the property that identifies the primary aggregate for this event:" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Choosing", "Right"]}
// Order-centric events
public record OrderCreatedEvent : IEvent {
  [StreamKey]  // Order is the aggregate
  public Guid OrderId { get; init; }
  public Guid CustomerId { get; init; }  // Related entity, not stream key
}

// Customer-centric events
public record CustomerRegisteredEvent : IEvent {
  [StreamKey]  // Customer is the aggregate
  public Guid CustomerId { get; init; }
}
```

### Rule of Thumb

Ask: "Which entity does this event primarily describe?"
- `OrderCreatedEvent` describes an **Order** → `OrderId` gets `[StreamKey]`
- `ProductUpdatedEvent` describes a **Product** → `ProductId` gets `[StreamKey]`
- `CustomerRegisteredEvent` describes a **Customer** → `CustomerId` gets `[StreamKey]`

## Why Only One?

The `[StreamKey]` serves a specific purpose in perspective runners:

1. **Stream Identification**: Groups events by aggregate for ordered processing
2. **UUID7 Ordering**: Events within the same stream are processed in timestamp order
3. **Compile-Time Extraction**: Source generator creates `ExtractStreamId()` methods

Having multiple stream keys would create ambiguity:
- Which property identifies the stream?
- How should events be grouped?
- Which ordering should be used?

## Example: Order Aggregate

**Correct - Single stream key**:
```csharp{title="Example: Order Aggregate" description="Correct - Single stream key:" category="Troubleshooting" difficulty="ADVANCED" tags=["Operations", "Diagnostics", "Example:", "Order"]}
public record OrderCreatedEvent : IEvent {
  [StreamKey]
  public Guid OrderId { get; init; }
  public Guid CustomerId { get; init; }
  public DateTime CreatedAt { get; init; }
}

public record OrderShippedEvent : IEvent {
  [StreamKey]
  public Guid OrderId { get; init; }  // Same stream as OrderCreatedEvent
  public string TrackingNumber { get; init; } = string.Empty;
  public DateTime ShippedAt { get; init; }
}

public record OrderDto {
  [StreamKey]
  public Guid OrderId { get; init; }
  public string Status { get; init; } = string.Empty;
  public string? TrackingNumber { get; init; }
}

public class OrderPerspective :
  IPerspectiveFor<OrderDto, OrderCreatedEvent, OrderShippedEvent> {

  public OrderDto Apply(OrderDto currentData, OrderCreatedEvent @event) {
    return new OrderDto {
      OrderId = @event.OrderId,
      Status = "Created"
    };
  }

  public OrderDto Apply(OrderDto currentData, OrderShippedEvent @event) {
    return currentData with {
      Status = "Shipped",
      TrackingNumber = @event.TrackingNumber
    };
  }
}
```

## Common Scenarios

### Scenario 1: Event with Multiple IDs

If your event references multiple entities, only mark the **primary aggregate**:

```csharp{title="Scenario 1: Event with Multiple IDs" description="If your event references multiple entities, only mark the primary aggregate:" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Scenario", "Event"]}
public record OrderLineItemAddedEvent : IEvent {
  [StreamKey]  // Order is the primary aggregate
  public Guid OrderId { get; init; }

  // Product is referenced but not the stream key
  public Guid ProductId { get; init; }
  public int Quantity { get; init; }
}
```

### Scenario 2: Composite Keys

If you truly need a composite key, create a single property that represents it:

```csharp{title="Scenario 2: Composite Keys" description="If you truly need a composite key, create a single property that represents it:" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Scenario", "Composite"]}
public record OrderLineItemEvent : IEvent {
  [StreamKey]  // Composite key as single property
  public string StreamKey => $"{OrderId}:{ProductId}";

  public Guid OrderId { get; init; }
  public Guid ProductId { get; init; }
}
```

However, this is rare. Most domain events belong to a single aggregate.

## Related Diagnostics

- **[WHIZ030](whiz030.md)** - Event type missing `[StreamKey]` attribute
- **WHIZ009** - Warning for IEvent implementations missing `[StreamKey]` (general case)

## See Also

- [StreamKey Attribute](../../extending/attributes/streamkey.md) - Detailed attribute documentation
- [Perspectives](../../fundamentals/perspectives/perspectives.md) - Pure function perspectives with StreamKey
- Event Sourcing - Understanding aggregates and streams
