---
title: Core Concepts
category: Core Concepts
order: 1
tags: events, commands, aggregates, projections, domain-driven-design
---

# Core Concepts

Whizbang is built on four foundational concepts: **Events**, **Commands**, **Aggregates**, and **Projections**. Understanding these primitives is essential to using Whizbang effectively.

## Events

**Events are immutable facts that have happened in your system.** They represent state changes and are the source of truth in event-sourced architectures.

### Characteristics

- **Past tense naming** - `OrderPlaced`, `PaymentProcessed`, `InventoryReserved`
- **Immutable** - Once written, never modified
- **Append-only** - New events are added to the stream, old events remain forever
- **Domain-owned** - Each event belongs to a specific domain/service

### Example

```csharp{
title: "Order Domain Events"
description: "Events representing state changes in the order lifecycle"
framework: "NET8"
category: "Domain Logic"
difficulty: "BEGINNER"
tags: ["Events", "Domain Events", "Order Management"]
usingStatements: ["System"]
showLineNumbers: true
}
using System;

namespace MyApp.Orders.Events;

// Event: Order was placed by a customer
public record OrderPlaced(
    Guid OrderId,
    Guid CustomerId,
    DateTimeOffset PlacedAt,
    List<OrderItem> Items,
    decimal Total
);

// Event: Order was shipped
public record OrderShipped(
    Guid OrderId,
    DateTimeOffset ShippedAt,
    string TrackingNumber
);

// Event: Order was cancelled
public record OrderCancelled(
    Guid OrderId,
    DateTimeOffset CancelledAt,
    string Reason
);
```

### Event Streams

Events are stored in **streams**, one stream per aggregate instance:

```
Stream: "Order-{orderId}"
  [0] OrderPlaced
  [1] OrderItemAdded
  [2] OrderShipped
  [3] OrderDelivered
```

Each event has a **position** (sequence number) in the stream, enabling:
- **Replaying** the stream to rebuild aggregate state
- **Optimistic concurrency** - Detect conflicting concurrent updates
- **Point-in-time queries** - Get state as of a specific event

### Domain Ownership

Events are **owned by the domain** that publishes them:

```csharp{
title: "Domain-Owned Events"
description: "Marking events with their owning domain"
framework: "NET8"
category: "Domain Logic"
difficulty: "INTERMEDIATE"
tags: ["Events", "Domain Ownership", "Distributed Systems"]
usingStatements: ["Whizbang", "System"]
showLineNumbers: true
}
using System;
using Whizbang;

namespace MyApp.Orders.Events;

[OwnedBy("Orders")]  // This event comes from the Orders domain
public record OrderPlaced(Guid OrderId, Guid CustomerId);

[OwnedBy("Inventory")]  // This event comes from the Inventory domain
public record InventoryReserved(Guid OrderId, List<Guid> ProductIds);
```

When other services subscribe to these events:
- They're consuming a **public API** from the owning domain
- The owning domain controls the event schema
- Subscribers can backfill from the entire event history

## Commands

**Commands are requests to change state.** They represent intent and are sent to the domain that owns the aggregate.

### Characteristics

- **Imperative naming** - `PlaceOrder`, `ProcessPayment`, `ReserveInventory`
- **Validated** - Can be rejected if invalid
- **Routed** - Sent to the owning domain's handlers
- **Single recipient** - Unlike events, commands go to exactly one handler

### Example

```csharp{
title: "Order Domain Commands"
description: "Commands representing requests to change order state"
framework: "NET8"
category: "Domain Logic"
difficulty: "BEGINNER"
tags: ["Commands", "CQRS", "Order Management"]
usingStatements: ["System"]
showLineNumbers: true
}
using System;

namespace MyApp.Orders.Commands;

// Command: Request to place a new order
public record PlaceOrder(
    Guid CustomerId,
    List<OrderItem> Items
);

// Command: Request to cancel an order
public record CancelOrder(
    Guid OrderId,
    string Reason
);

// Command: Request to update shipping address
public record UpdateShippingAddress(
    Guid OrderId,
    Address NewAddress
);
```

### Command Handlers

Handlers receive commands, validate them, and produce events:

```csharp{
title: "Order Command Handler"
description: "Handler that validates commands and produces events"
framework: "NET8"
category: "Domain Logic"
difficulty: "INTERMEDIATE"
tags: ["Commands", "Handlers", "Validation", "Events"]
usingStatements: ["Whizbang", "System", "System.Threading.Tasks"]
showLineNumbers: true
}
using System;
using System.Threading.Tasks;
using Whizbang;

namespace MyApp.Orders.Handlers;

public class PlaceOrderHandler {
    private readonly IOrderRepository _repository;

    public PlaceOrderHandler(IOrderRepository repository) {
        _repository = repository;
    }

    public async Task<OrderPlaced> Handle(PlaceOrder command) {
        // Validate command
        if (command.Items.Count == 0) {
            throw new InvalidOperationException("Order must have at least one item");
        }

        // Create aggregate
        var order = new Order(
            Guid.NewGuid(),
            command.CustomerId,
            command.Items
        );

        // Persist aggregate (events are appended)
        await _repository.SaveAsync(order);

        // Return event (auto-published by Whizbang)
        return new OrderPlaced(
            order.Id,
            command.CustomerId,
            DateTimeOffset.UtcNow,
            command.Items,
            order.Total
        );
    }
}
```

### Command Routing

Commands are routed to the **owning domain**:

```csharp{
title: "Sending Commands"
description: "How to send commands to their owning domain"
framework: "NET8"
category: "Domain Logic"
difficulty: "INTERMEDIATE"
tags: ["Commands", "Routing", "Distributed Systems"]
usingStatements: ["Whizbang", "System", "System.Threading.Tasks"]
showLineNumbers: true
}
using System;
using System.Threading.Tasks;
using Whizbang;

public class CheckoutService {
    private readonly IWhizbang _whizbang;

    public CheckoutService(IWhizbang whizbang) {
        _whizbang = whizbang;
    }

    public async Task CheckoutAsync(Guid customerId, List<OrderItem> items) {
        // Send command to Orders domain
        var placed = await _whizbang.Send(new PlaceOrder(customerId, items));

        // Send command to Inventory domain
        await _whizbang.Send(new ReserveInventory(placed.OrderId, items));

        // Send command to Payment domain
        await _whizbang.Send(new ProcessPayment(placed.OrderId, placed.Total));
    }
}
```

In a **monolith**, these commands are routed to local handlers.
In **microservices**, they're routed to the owning service via message broker.

## Aggregates

**Aggregates are the write-side domain models that enforce business rules.** They are the consistency boundary for commands and events.

### Characteristics

- **Consistency boundary** - All changes within an aggregate are transactional
- **Event-sourced** - State is built by replaying events
- **Validated** - Enforce invariants before producing events
- **Single writer** - Only one command can modify an aggregate at a time (optimistic concurrency)

### Example

```csharp{
title: "Order Aggregate"
description: "Event-sourced aggregate that enforces order business rules"
framework: "NET8"
category: "Domain Logic"
difficulty: "INTERMEDIATE"
tags: ["Aggregates", "Event Sourcing", "Domain-Driven Design"]
usingStatements: ["Whizbang", "System", "System.Collections.Generic"]
showLineNumbers: true
}
using System;
using System.Collections.Generic;
using Whizbang;

namespace MyApp.Orders.Domain;

public class Order : Aggregate {
    public Guid Id { get; private set; }
    public Guid CustomerId { get; private set; }
    public OrderStatus Status { get; private set; }
    public List<OrderItem> Items { get; private set; } = new();
    public decimal Total { get; private set; }

    // Constructor for new aggregates
    public Order(Guid id, Guid customerId, List<OrderItem> items) {
        // Validate business rules
        if (items.Count == 0) {
            throw new InvalidOperationException("Order must have items");
        }

        // Produce event
        Apply(new OrderPlaced(
            id,
            customerId,
            DateTimeOffset.UtcNow,
            items,
            items.Sum(i => i.Price * i.Quantity)
        ));
    }

    // Event handler - updates state
    private void When(OrderPlaced @event) {
        Id = @event.OrderId;
        CustomerId = @event.CustomerId;
        Status = OrderStatus.Placed;
        Items = @event.Items;
        Total = @event.Total;
    }

    // Command method - enforces business rules
    public void Ship(string trackingNumber) {
        if (Status != OrderStatus.Placed) {
            throw new InvalidOperationException("Can only ship placed orders");
        }

        Apply(new OrderShipped(Id, DateTimeOffset.UtcNow, trackingNumber));
    }

    // Event handler - updates state
    private void When(OrderShipped @event) {
        Status = OrderStatus.Shipped;
    }

    // Command method - enforces business rules
    public void Cancel(string reason) {
        if (Status == OrderStatus.Shipped || Status == OrderStatus.Delivered) {
            throw new InvalidOperationException("Cannot cancel shipped/delivered orders");
        }

        Apply(new OrderCancelled(Id, DateTimeOffset.UtcNow, reason));
    }

    // Event handler - updates state
    private void When(OrderCancelled @event) {
        Status = OrderStatus.Cancelled;
    }
}

public enum OrderStatus {
    Placed,
    Shipped,
    Delivered,
    Cancelled
}
```

### Event Sourcing Pattern

Aggregates follow this pattern:

1. **Load** aggregate by replaying events from the stream
2. **Execute** command method, which validates business rules
3. **Apply** events to update state
4. **Save** new events to the stream

```csharp{
title: "Loading and Saving Aggregates"
description: "How aggregates are loaded from and saved to event streams"
framework: "NET8"
category: "Domain Logic"
difficulty: "ADVANCED"
tags: ["Aggregates", "Event Sourcing", "Repositories"]
usingStatements: ["Whizbang", "System", "System.Threading.Tasks", "System.Collections.Generic"]
showLineNumbers: true
}
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Whizbang;

public class OrderRepository : IOrderRepository {
    private readonly IEventStore _eventStore;

    public OrderRepository(IEventStore eventStore) {
        _eventStore = eventStore;
    }

    public async Task<Order> GetAsync(Guid orderId) {
        // Load events from stream
        var events = await _eventStore.LoadStreamAsync($"Order-{orderId}");

        // Reconstitute aggregate by replaying events
        var order = new Order();
        foreach (var @event in events) {
            order.ApplyEvent(@event);  // Calls private When() methods
        }

        return order;
    }

    public async Task SaveAsync(Order order) {
        // Get uncommitted events from aggregate
        var newEvents = order.GetUncommittedEvents();

        // Append to event stream with optimistic concurrency check
        await _eventStore.AppendToStreamAsync(
            $"Order-{order.Id}",
            newEvents,
            expectedVersion: order.Version
        );

        // Mark events as committed
        order.MarkEventsAsCommitted();
    }
}
```

## Projections

**Projections are read-side models optimized for queries.** They are built by subscribing to events and updating denormalized views.

### Characteristics

- **Eventually consistent** - Updated asynchronously as events arrive
- **Denormalized** - Optimized for specific query patterns
- **Rebuildable** - Can be deleted and rebuilt from event history
- **Isolated** - Each projection has its own data model

### Example

```csharp{
title: "Order History Projection"
description: "Projection that maintains a queryable order history"
framework: "NET8"
category: "Domain Logic"
difficulty: "INTERMEDIATE"
tags: ["Projections", "CQRS", "Read Models"]
usingStatements: ["Whizbang", "System", "System.Threading.Tasks"]
showLineNumbers: true
}
using System;
using System.Threading.Tasks;
using Whizbang;

namespace MyApp.Orders.Projections;

// Read model - optimized for queries
public class OrderHistoryItem {
    public Guid OrderId { get; set; }
    public Guid CustomerId { get; set; }
    public DateTimeOffset PlacedAt { get; set; }
    public DateTimeOffset? ShippedAt { get; set; }
    public decimal Total { get; set; }
    public string Status { get; set; }
}

// Projection handler - subscribes to events
public class OrderHistoryProjection {
    private readonly IOrderHistoryStore _store;

    public OrderHistoryProjection(IOrderHistoryStore store) {
        _store = store;
    }

    // Event handler - updates read model
    public async Task Handle(OrderPlaced @event) {
        await _store.InsertAsync(new OrderHistoryItem {
            OrderId = @event.OrderId,
            CustomerId = @event.CustomerId,
            PlacedAt = @event.PlacedAt,
            Total = @event.Total,
            Status = "Placed"
        });
    }

    // Event handler - updates read model
    public async Task Handle(OrderShipped @event) {
        await _store.UpdateAsync(@event.OrderId, item => {
            item.ShippedAt = @event.ShippedAt;
            item.Status = "Shipped";
        });
    }

    // Event handler - updates read model
    public async Task Handle(OrderCancelled @event) {
        await _store.UpdateAsync(@event.OrderId, item => {
            item.Status = "Cancelled";
        });
    }
}
```

### Querying Projections

Projections are queried directly, not through the event store:

```csharp{
title: "Querying Order History"
description: "How to query projections for read-side data"
framework: "NET8"
category: "Domain Logic"
difficulty: "BEGINNER"
tags: ["Projections", "Queries", "CQRS"]
usingStatements: ["System", "System.Threading.Tasks", "System.Collections.Generic"]
showLineNumbers: true
}
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

public class OrderQueryService {
    private readonly IOrderHistoryStore _store;

    public OrderQueryService(IOrderHistoryStore store) {
        _store = store;
    }

    public async Task<List<OrderHistoryItem>> GetCustomerOrdersAsync(Guid customerId) {
        // Query the projection (fast, optimized for reads)
        return await _store.QueryAsync(item => item.CustomerId == customerId);
    }

    public async Task<OrderHistoryItem> GetOrderDetailsAsync(Guid orderId) {
        return await _store.GetAsync(orderId);
    }
}
```

### Projection Backfilling

When a projection is added to a new service, it can **backfill** from historical events:

```csharp{
title: "Backfilling a Projection"
description: "Configure a projection to rebuild from historical events"
framework: "NET8"
category: "Domain Logic"
difficulty: "ADVANCED"
tags: ["Projections", "Backfilling", "Event Sourcing"]
usingStatements: ["Whizbang", "Microsoft.Extensions.DependencyInjection", "System"]
showLineNumbers: true
}
using System;
using Microsoft.Extensions.DependencyInjection;
using Whizbang;

public static class ServiceCollectionExtensions {
    public static IServiceCollection AddOrderProjections(this IServiceCollection services) {
        services.AddProjection<OrderHistoryProjection>(options => {
            // Subscribe to events from the Orders domain
            options.Subscribe<OrderPlaced>();
            options.Subscribe<OrderShipped>();
            options.Subscribe<OrderCancelled>();

            // Backfill from the beginning of time
            options.BackfillFrom = DateTimeOffset.MinValue;

            // Process in parallel across order IDs (partitioned by OrderId)
            options.PartitionBy = @event => ((dynamic)@event).OrderId;
        });

        return services;
    }
}
```

When this projection starts:
1. It queries the Orders service for all historical `OrderPlaced`, `OrderShipped`, and `OrderCancelled` events
2. It applies them in order to build the initial projection state
3. It continues processing new events as they arrive

## CQRS Pattern

**CQRS (Command Query Responsibility Segregation)** separates writes from reads:

- **Commands** → **Aggregates** (write side)
- **Queries** → **Projections** (read side)

```
     Command                   Event                   Query
        ↓                        ↓                        ↓
   ┌─────────┐             ┌──────────┐            ┌──────────┐
   │Aggregate│ ─Events→    │Event     │ ─Events→   │Projection│
   │         │             │Store     │            │          │
   └─────────┘             └──────────┘            └──────────┘
   Write Model             Source of Truth          Read Model
   (Normalized)            (Immutable)              (Denormalized)
```

Benefits:
- **Optimized models** - Write and read models can have different schemas
- **Scalability** - Scale reads independently from writes
- **Flexibility** - Multiple projections can be built from the same events

## Next Steps

Now that you understand the core concepts, learn how to:

- [**Get Started**](./getting-started.md) - Build your first Whizbang application
- [**Package Structure**](./package-structure.md) - Choose the right NuGet packages
- [**Driver System**](./drivers.md) - Understand how to swap persistence and messaging backends
