---
title: Aggregates
category: Core Concepts
order: 2
tags: aggregates, event-sourcing, domain-driven-design, ddd
---

# Aggregates

Aggregates are the fundamental building blocks of Whizbang's event-sourced architecture. They serve as consistency boundaries that encapsulate business logic and ensure data integrity.

## What are Aggregates?

An aggregate is a cluster of domain objects that can be treated as a single unit for data changes. In Whizbang:

- **Consistency Boundary**: All changes within an aggregate are atomic
- **Event Source**: Aggregates generate events when their state changes
- **Business Logic Container**: They encapsulate domain rules and invariants
- **Identity**: Each aggregate has a unique identifier

## Key Characteristics

### Event-Sourced State
Aggregates don't store current state directly. Instead, they:
- Store a sequence of events that represent state changes
- Rebuild current state by replaying events from the event store
- Append new events when commands are processed

### Command Processing
Aggregates receive commands and:
1. Validate the command against current state
2. Apply business rules and invariants
3. Generate domain events if the command is valid
4. Throw exceptions if the command violates business rules

### Optimistic Concurrency
Whizbang aggregates use optimistic concurrency control:
- Each aggregate has a version number
- Concurrent modifications are detected and handled
- Prevents lost update problems in distributed scenarios

## Example Structure

```csharp{
title: "Order Aggregate Example"
description: "Complete aggregate structure showing event sourcing, command handling, and state management"
framework: "NET8"
category: "Core Concepts"
difficulty: "INTERMEDIATE"
tags: ["Aggregates", "Event Sourcing", "DDD", "Order Management"]
filename: "OrderAggregate.cs"
nugetPackages: ["Whizbang.EventSourcing"]
usingStatements: ["System", "System.Collections.Generic", "Whizbang"]
showLineNumbers: true
}
public class OrderAggregate : Aggregate {
    public Guid Id { get; private set; }
    public OrderStatus Status { get; private set; }
    public List<OrderItem> Items { get; private set; } = new();
    
    // Constructor for new aggregates
    public OrderAggregate(PlaceOrderCommand command) {
        // Validate and apply business rules
        Apply(new OrderPlacedEvent(command.OrderId, command.Items));
    }
    
    // Event handler (rebuilds state)
    private void When(OrderPlacedEvent @event) {
        Id = @event.OrderId;
        Status = OrderStatus.Placed;
        Items = @event.Items;
    }
    
    // Command method
    public void Ship(ShipOrderCommand command) {
        if (Status != OrderStatus.Placed) {
            throw new InvalidOperationException("Order must be placed to ship");
        }
        Apply(new OrderShippedEvent(Id, command.TrackingNumber));
    }
}
```

## Best Practices

### Keep Aggregates Small
- Focus on a single business concept
- Avoid large, complex aggregates
- Consider splitting if aggregate becomes unwieldy

### Design Around Invariants
- Identify what must remain consistent
- Encapsulate related data that changes together
- Use domain events to communicate between aggregates

### Avoid Cross-Aggregate Transactions
- One aggregate per transaction
- Use eventual consistency between aggregates
- Communicate via domain events and sagas

## Integration with Whizbang

Whizbang provides:
- **Repository pattern** for loading and saving aggregates
- **Automatic event publishing** when aggregates are saved
- **Optimistic concurrency** handling out of the box
- **Multiple storage backends** (Postgres, SQL Server, etc.)

## Related Topics

- [Core Concepts](./core-concepts.md) - Overview of Whizbang's architectural patterns
- [Repositories and CQRS Helpers](./repositories-and-helpers.md) - Working with aggregate repositories
- [Command Handling](./Commands/command-handling.md) - Processing commands in aggregates
- [Getting Started](./getting-started.md) - Hands-on tutorial building aggregates

## Next Steps

This page provides an overview of aggregates in Whizbang. For detailed implementation examples and advanced patterns, see the comprehensive documentation linked above.