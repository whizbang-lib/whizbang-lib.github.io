---
title: 'WHIZ031: Multiple StreamId Attributes'
pageType: troubleshooting
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
description: >-
  Event type has multiple properties marked with [StreamId] - only one is
  allowed
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - perspectives
  - streamid
  - source-generator
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/PerspectiveDiscoveryGenerator.cs
  - src/Whizbang.Core/StreamIdAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectiveDiscoveryGeneratorTests.cs
lastMaintainedCommit: '01f07906'
---

# WHIZ031: Multiple StreamId Attributes

**Severity**: Error
**Category**: Source Generation

## Description

This error occurs when an event type used in a perspective has more than one property marked with the `[StreamId]` attribute. Each event can only have **exactly one** stream ID property because it uniquely identifies which stream (aggregate) the event belongs to.

The check searches the event type's full inheritance hierarchy — a `[StreamId]` on a base type plus another on the derived type also triggers this error.

## Error Message

```
Event type 'OrderEvent' has multiple properties marked with [StreamId]. Only one property can be the stream ID.
```

## How to Fix

Remove the `[StreamId]` attribute from all but one property. Keep it only on the property that identifies the aggregate/stream:

**Before (causes WHIZ031)**:
```csharp{title="How to Fix" description="Before (causes WHIZ031):" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Fix"]}
public record OrderEvent : IEvent {
  [StreamId]  // ❌ Multiple [StreamId] attributes!
  public Guid OrderId { get; init; }

  [StreamId]  // ❌ Remove this!
  public Guid CustomerId { get; init; }

  public decimal Amount { get; init; }
}
```

**After (error resolved)**:
```csharp{title="How to Fix - OrderEvent" description="After (error resolved):" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Fix"]}
public record OrderEvent : IEvent {
  [StreamId]  // ✅ Single [StreamId] on the aggregate ID
  public Guid OrderId { get; init; }

  // CustomerId is just a regular property
  public Guid CustomerId { get; init; }

  public decimal Amount { get; init; }
}
```

## Choosing the Right Property

The `[StreamId]` should mark the property that identifies the **primary aggregate** for this event:

```csharp{title="Choosing the Right Property" description="The [StreamId] should mark the property that identifies the primary aggregate for this event:" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Choosing", "Right"]}
// Order-centric events
public record OrderCreatedEvent : IEvent {
  [StreamId]  // Order is the aggregate
  public Guid OrderId { get; init; }
  public Guid CustomerId { get; init; }  // Related entity, not stream ID
}

// Customer-centric events
public record CustomerRegisteredEvent : IEvent {
  [StreamId]  // Customer is the aggregate
  public Guid CustomerId { get; init; }
}
```

### Rule of Thumb

Ask: "Which entity does this event primarily describe?"
- `OrderCreatedEvent` describes an **Order** → `OrderId` gets `[StreamId]`
- `ProductUpdatedEvent` describes a **Product** → `ProductId` gets `[StreamId]`
- `CustomerRegisteredEvent` describes a **Customer** → `CustomerId` gets `[StreamId]`

## Why Only One?

The `[StreamId]` serves a specific purpose in perspective runners:

1. **Stream Identification**: Groups events by aggregate for ordered processing
2. **UUID7 Ordering**: Events within the same stream are processed in timestamp order
3. **Compile-Time Extraction**: Source generator creates stream ID extractor methods

Having multiple stream IDs would create ambiguity:
- Which property identifies the stream?
- How should events be grouped?
- Which ordering should be used?

## Example: Order Aggregate

**Correct - Single stream ID**:
```csharp{title="Example: Order Aggregate" description="Correct - Single stream ID:" category="Troubleshooting" difficulty="ADVANCED" tags=["Operations", "Diagnostics", "Example:", "Order"]}
public record OrderCreatedEvent : IEvent {
  [StreamId]
  public Guid OrderId { get; init; }
  public Guid CustomerId { get; init; }
  public DateTime CreatedAt { get; init; }
}

public record OrderShippedEvent : IEvent {
  [StreamId]
  public Guid OrderId { get; init; }  // Same stream as OrderCreatedEvent
  public string TrackingNumber { get; init; } = string.Empty;
  public DateTime ShippedAt { get; init; }
}

public record OrderDto {
  [StreamId]
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
  [StreamId]  // Order is the primary aggregate
  public Guid OrderId { get; init; }

  // Product is referenced but not the stream ID
  public Guid ProductId { get; init; }
  public int Quantity { get; init; }
}
```

### Scenario 2: Composite Keys

The `[StreamId]` property must be a `Guid` (or `Guid?`/WhizbangId type), so composite string keys are not supported. If an event conceptually belongs to a combination of entities, derive a single deterministic `Guid` for that combination and store it as the stream ID:

```csharp{title="Scenario 2: Composite Keys" description="Derive a single deterministic Guid when an event belongs to a combination of entities:" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Scenario", "Composite"]}
public record OrderLineItemEvent : IEvent {
  [StreamId]  // Single Guid stream ID, derived once when the event is created
  public Guid LineItemStreamId { get; init; }

  public Guid OrderId { get; init; }
  public Guid ProductId { get; init; }
}
```

However, this is rare. Most domain events belong to a single aggregate.

## Related Diagnostics

- **[WHIZ030](whiz030.md)** - Event type missing `[StreamId]` attribute
- **WHIZ009** - Warning for IEvent/ICommand implementations missing `[StreamId]` (general case)

## See Also

- [StreamId Attribute](../../extending/attributes/streamid.md) - Detailed attribute documentation
- [Perspectives](../../fundamentals/perspectives/perspectives.md) - Pure function perspectives with StreamId
- Event Sourcing - Understanding aggregates and streams
