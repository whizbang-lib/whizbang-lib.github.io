---
title: Event-Driven Architecture
category: Architecture & Design
order: 4
tags: event-driven, event-sourced, architecture, receptor, perspective, lens
description: Understanding Whizbang's Event-Driven and Event-Sourced modes - how the same code works in both paradigms
---

# Event-Driven Architecture

## Overview

Whizbang is built on a universal event-driven architecture where **all state changes flow through events**, regardless of whether you're using Event-Driven or Event-Sourced mode. This fundamental design principle enables seamless progression from simple applications to complex event-sourced systems without changing your core logic.

## The Key Insight

**Write through events, read through lenses.** This simple principle unifies all Whizbang applications:

- **Commands** flow to **Receptors** which make decisions
- **Receptors** emit **Events** representing those decisions  
- **Events** flow to **Perspectives** which update views
- **Lenses** provide read-only access to current state

## Event-Driven vs Event-Sourced

Both modes use the same components and patterns. The only difference is whether events are persisted:

| Aspect | Event-Driven Mode | Event-Sourced Mode |
|--------|-------------------|-------------------|
| **Events** | Transient - drive immediate updates | Persisted - become source of truth |
| **Receptors** | Stateless - get state from Lenses | Stateful - maintain state from event stream |
| **Perspectives** | Execute inline with receptor | Execute async from event stream |
| **Ledger** | Not used | Stores all events permanently |
| **Replay** | Not possible | Can rebuild from events |
| **Transaction** | Receptor + Perspective together | Event append is the transaction |

## Core Components

### Receptor
**Purpose**: Receives commands, makes decisions, emits events

```csharp
---
category: Architecture
difficulty: INTERMEDIATE
tags: [Architecture, Receptors, Event-Driven, CQRS]
description: Universal receptor interface that works in both event-driven and event-sourced modes
---
// Same interface works in both modes!
public class OrderReceptor : IReceptor<CreateOrder> {
    public OrderCreated Receive(CreateOrder cmd, IOrderLens lens) {
        // Validate using lens (read-only view)
        var customer = lens.GetCustomer(cmd.CustomerId);
        if (!customer.IsActive) {
            throw new InactiveCustomerException();
        }
        
        // Make decision and emit event
        return new OrderCreated(
            Guid.NewGuid(),
            cmd.CustomerId,
            cmd.Items,
            DateTime.UtcNow
        );
    }
}
```

### Perspective
**Purpose**: Updates views and projections from events

```csharp
---
category: Architecture
difficulty: INTERMEDIATE
tags: [Architecture, Perspectives, Event-Driven, Projections]
description: Perspective that updates multiple data stores from events, working identically in both modes
---
// Perspectives work identically in both modes
public class OrderPerspective : IPerspectiveOf<OrderCreated> {
    public async Task Update(OrderCreated e) {
        // Update database
        await db.Orders.Add(new Order { 
            Id = e.OrderId,
            CustomerId = e.CustomerId 
        });
        
        // Update cache
        await cache.Invalidate($"customer:{e.CustomerId}");
        
        // Update search index
        await search.Index(e);
    }
}
```

### Lens
**Purpose**: Provides read-only access to current state

```csharp
---
category: Architecture
difficulty: INTERMEDIATE
tags: [Architecture, Lenses, Read-Model, Query-Interface]
description: Read-only lens interface providing consistent data access regardless of execution mode
---
// Lenses provide consistent reads regardless of mode
public interface IOrderLens {
    Order Focus(Guid id);                           // Get single item
    IEnumerable<Order> View(Expression<Func<Order, bool>> filter);
    OrderSummary Glimpse(Guid id);                  // Summary view
    bool Exists(Guid id);                           // Quick check
}
```

### Dispatcher
**Purpose**: Routes commands to receptors and events to perspectives

```csharp
---
category: Architecture
difficulty: INTERMEDIATE
tags: [Architecture, Dispatcher, CQRS, Message-Routing]
description: Core dispatcher interface for command routing, event broadcasting, and query execution
---
public interface IDispatcher {
    Task<TEvent> Dispatch<TEvent>(ICommand<TEvent> command);
    Task Broadcast(IEvent @event);
    Task<TResult> Query<TResult>(IQuery<TResult> query);
}
```

## The Universal Pattern

This pattern works identically in both modes:

```csharp
---
category: Architecture
difficulty: INTERMEDIATE
tags: [Architecture, Universal-Pattern, Business-Logic, Event-Driven]
description: Universal pattern showing receptor and perspective working identically in both modes
---
public class TransferMoneyReceptor : IReceptor<TransferMoney> {
    public MoneyTransferred Receive(TransferMoney cmd, IAccountLens lens) {
        // Read current state through lens
        var fromAccount = lens.Focus(cmd.FromAccountId);
        var toAccount = lens.Focus(cmd.ToAccountId);
        
        // Make business decision
        if (fromAccount.Balance < cmd.Amount) {
            throw new InsufficientFundsException();
        }
        
        // Emit event - this IS the write operation
        return new MoneyTransferred(
            cmd.FromAccountId,
            cmd.ToAccountId,
            cmd.Amount,
            DateTime.UtcNow
        );
    }
}

public class AccountPerspective : IPerspectiveOf<MoneyTransferred> {
    public async Task Update(MoneyTransferred e) {
        // In Event-Driven: Direct database update
        // In Event-Sourced: Update from replayed event
        
        await db.UpdateBalance(e.FromAccountId, -e.Amount);
        await db.UpdateBalance(e.ToAccountId, e.Amount);
        await db.AddTransaction(e);
    }
}
```

## Mode Selection via Policies

Configure behavior per-receptor using policies:

```csharp
---
category: Architecture
difficulty: INTERMEDIATE
tags: [Architecture, Policy-Configuration, Mode-Selection, Hybrid]
description: Configuration showing mixed modes within same application using policies
---
services.AddWhizbang()
    .UseDispatcher(dispatcher => {
        // Default mode for all receptors
        dispatcher.DefaultPolicy = new EventDrivenPolicy();
        
        // Specific receptors use event sourcing
        dispatcher.ForReceptor<PaymentReceptor>()
            .UsePolicy(new EventSourcedPolicy());
            
        dispatcher.ForReceptor<AuditReceptor>()
            .UsePolicy(new EventSourcedPolicy());
            
        // Mix modes in same application!
    });
```

## Evolution Path

### Phase 1: Event-Driven (Stateless Receptors)

```csharp
---
category: Architecture
difficulty: INTERMEDIATE
tags: [Architecture, Event-Driven, Stateless-Receptors, Phase-1]
description: Event-driven mode with stateless receptor getting state from lens
---
// Stateless receptor gets state from lens
public class OrderReceptor : IReceptor<ShipOrder> {
    public OrderShipped Receive(ShipOrder cmd, IOrderLens lens) {
        var order = lens.Focus(cmd.OrderId);  // Get state from lens
        
        if (order.Status != "Paid") {
            throw new InvalidOperationException("Order must be paid");
        }
        
        return new OrderShipped(cmd.OrderId, DateTime.UtcNow);
    }
}
```

### Phase 2: Event-Sourced (Stateful Receptors)

```csharp
---
category: Architecture
difficulty: ADVANCED
tags: [Architecture, Event-Sourcing, Stateful-Receptors, Phase-2]
description: Event-sourced mode with stateful receptor maintaining state from events
---
// Same receptor, now stateful
[EventSourced]
public class OrderReceptor : IReceptor<ShipOrder> {
    private OrderStatus status;  // State maintained from events
    
    public OrderShipped Receive(ShipOrder cmd) {
        if (status != OrderStatus.Paid) {  // Use internal state
            throw new InvalidOperationException("Order must be paid");
        }
        
        return new OrderShipped(Id, DateTime.UtcNow);
    }
    
    // Apply events to maintain state
    public void Absorb(OrderCreated e) => status = OrderStatus.Created;
    public void Absorb(OrderPaid e) => status = OrderStatus.Paid;
    public void Absorb(OrderShipped e) => status = OrderStatus.Shipped;
}
```

## The Flow

### Event-Driven Mode
```text
---
category: Architecture
difficulty: INTERMEDIATE
tags: [Architecture, Event-Driven, Flow-Diagram, Synchronous]
description: Event-driven mode flow with immediate database updates
---
Command → Dispatcher → Receptor → Event
                           ↓
                    Perspective → Database (immediate)
                           ↓
                        Lens → Queries
```

### Event-Sourced Mode
```text
---
category: Architecture
difficulty: ADVANCED
tags: [Architecture, Event-Sourcing, Flow-Diagram, Asynchronous]
description: Event-sourced mode flow with ledger persistence and async perspective updates
---
Command → Dispatcher → Receptor → Event
                           ↓
                        Ledger (persist)
                           ↓
                    Perspective → Database (async)
                           ↓
                        Lens → Queries
```

## Key Principles

### 1. Events Are The Write Model
No direct database writes. All state changes flow through events:

```csharp
---
category: Architecture
difficulty: INTERMEDIATE
tags: [Architecture, Best-Practices, Events-As-Write-Model, Anti-Patterns]
description: Comparison showing wrong direct database writes vs correct event-driven approach
---
// ❌ WRONG - Direct database write
public void Handle(CreateOrder cmd) {
    var order = new Order { ... };
    database.Orders.Add(order);  // Don't do this!
    database.SaveChanges();
}

// ✅ RIGHT - Write through events
public OrderCreated Receive(CreateOrder cmd) {
    return new OrderCreated(...);  // Perspective handles the write
}
```

### 2. Lenses Are Read-Only
Lenses never modify state, they only observe:

```csharp
---
category: Architecture
difficulty: INTERMEDIATE
tags: [Architecture, Best-Practices, Read-Only-Lenses, Anti-Patterns]
description: Comparison showing wrong lens with write methods vs correct read-only lens
---
// ❌ WRONG - Lens with write methods
public interface IOrderLens {
    void Save(Order order);  // Don't do this!
}

// ✅ RIGHT - Read-only lens
public interface IOrderLens {
    Order Focus(Guid id);
    bool Exists(Guid id);
}
```

### 3. Perspectives Handle All Writes
All database updates happen in perspectives:

```csharp
---
category: Architecture
difficulty: INTERMEDIATE
tags: [Architecture, Best-Practices, Perspective-Writes, Separation-Of-Concerns]
description: Proper perspective implementation handling all database writes
---
public class OrderPerspective : IPerspectiveOf<OrderCreated> {
    public async Task Update(OrderCreated e) {
        // ALL writes happen here
        await db.Orders.Add(...);
        await cache.Set(...);
        await search.Index(...);
    }
}
```

## Benefits

### Immediate Benefits (Event-Driven Mode)
- **Clear separation** between reads and writes
- **Explicit side effects** - all changes visible as events
- **Natural audit trail** - events show what happened
- **Testability** - test receptors without database

### Additional Benefits (Event-Sourced Mode)
- **Complete history** - every change is recorded
- **Time travel** - see state at any point in time
- **Event replay** - rebuild projections from events
- **Debugging** - trace exactly what happened

## Migration Strategy

Moving from Event-Driven to Event-Sourced is seamless:

```csharp
---
category: Architecture
difficulty: INTERMEDIATE
tags: [Architecture, Migration-Strategy, Progressive-Enhancement, Evolution]
description: Step-by-step migration from event-driven to event-sourced without code changes
---
// Step 1: You're already Event-Driven
services.AddWhizbang()
    .UseDispatcher(d => d.DefaultPolicy = new EventDrivenPolicy());

// Step 2: Enable Event-Sourcing for specific receptors
services.AddWhizbang()
    .UseDispatcher(d => {
        d.DefaultPolicy = new EventDrivenPolicy();
        d.ForReceptor<Order>().UsePolicy(new EventSourcedPolicy());
    });

// Step 3: Gradually migrate more receptors
// No code changes needed!
```

## Real-World Example

```csharp
---
category: Architecture
difficulty: INTERMEDIATE
tags: [Architecture, Real-World-Example, Multiple-Perspectives, Checkout-Process]
description: Complete checkout example showing receptor with multiple perspectives handling different concerns
---
// This receptor works in BOTH modes without changes
public class CheckoutReceptor : IReceptor<Checkout> {
    public CheckoutCompleted Receive(Checkout cmd, ICheckoutLens lens) {
        // Validate inventory
        var inventory = lens.GetInventory(cmd.Items);
        if (!inventory.IsAvailable()) {
            throw new OutOfStockException();
        }
        
        // Validate payment
        var paymentMethod = lens.GetPaymentMethod(cmd.PaymentId);
        if (!paymentMethod.IsValid()) {
            throw new InvalidPaymentException();
        }
        
        // Emit event - the perspective handles all writes
        return new CheckoutCompleted(
            Guid.NewGuid(),
            cmd.CustomerId,
            cmd.Items,
            cmd.PaymentId,
            DateTime.UtcNow
        );
    }
}

// Multiple perspectives update different concerns
public class OrderPerspective : IPerspectiveOf<CheckoutCompleted> {
    public async Task Update(CheckoutCompleted e) {
        await db.Orders.Create(e.OrderId, e.CustomerId, e.Items);
    }
}

public class InventoryPerspective : IPerspectiveOf<CheckoutCompleted> {
    public async Task Update(CheckoutCompleted e) {
        foreach (var item in e.Items) {
            await db.Inventory.Reserve(item.ProductId, item.Quantity);
        }
    }
}

public class PaymentPerspective : IPerspectiveOf<CheckoutCompleted> {
    public async Task Update(CheckoutCompleted e) {
        await paymentGateway.Charge(e.PaymentId, e.Total);
    }
}
```

## Summary

The Event-Driven Architecture in Whizbang provides:

- **Unified model** - Same patterns for Event-Driven and Event-Sourced
- **Progressive enhancement** - Start simple, add event sourcing when needed
- **No rewrites** - Same receptor code works in both modes
- **Mix and match** - Use different modes for different aggregates
- **Clear semantics** - Events for writes, lenses for reads

This architecture ensures that you're always thinking in events, whether you choose to persist them or not.

## Next Steps

- Learn about **[Receptors](/docs/core-concepts/receptors)** - The universal command handler
- Explore **[Perspectives](/docs/core-concepts/perspectives)** - Event-driven projections
- Understand **[Lenses](/docs/core-concepts/lenses)** - Read-only query interfaces
- See **[Progressive Enhancement](/docs/usage-patterns/progressive-enhancement)** - Evolution strategies