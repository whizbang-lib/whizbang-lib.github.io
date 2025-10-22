---
title: Receptors
category: Core Concepts
order: 2
tags: receptors, commands, decisions, event-driven, event-sourced
description: Receptors - the universal pattern for receiving commands and making decisions in Whizbang
---

# Receptors

## Overview

Receptors are the decision-making components in Whizbang. They receive commands, apply business rules, and emit events representing the decisions made. The same receptor interface works in both Event-Driven (stateless) and Event-Sourced (stateful) modes, making them the cornerstone of Whizbang's progressive enhancement philosophy.

## What is a Receptor?

A Receptor:
- **Receives** commands from external sources
- **Decides** what should happen based on business rules
- **Emits** events representing those decisions
- **Never** performs side effects directly

Think of a receptor as a pure decision function: given a command and current state, what event(s) should occur?

## The Universal Interface

```csharp{
title: "Universal Receptor Interface"
description: "The core interface that works for both Event-Driven and Event-Sourced modes"
framework: "NET8"
category: "Core Concepts"
difficulty: "BEGINNER"
tags: ["Receptors", "Interface", "Universal"]
filename: "IReceptor.cs"
usingStatements: ["System"]
showLineNumbers: true
}
public interface IReceptor<TCommand> {
    object Receive(TCommand command);
}
```

The return type determines what happens:
- Single event → Published to perspectives
- Multiple events (tuple) → All published
- `Result<TEvent>` → Success/failure handling
- `void` → No events (rare)

## Stateless Receptors (Event-Driven Mode)

In Event-Driven mode, receptors are stateless and get current state from Lenses:

```csharp{
title: "Stateless Receptor with Lens"
description: "Event-Driven mode receptor that gets state from lens parameters"
framework: "NET8"
category: "Core Concepts"
difficulty: "INTERMEDIATE"
tags: ["Receptors", "Stateless", "Event-Driven", "Lenses"]
filename: "OrderReceptor.cs"
usingStatements: ["System", "Whizbang"]
showLineNumbers: true
}
public class OrderReceptor : IReceptor<CreateOrder> {
    // Stateless - gets state from lens parameter
    public OrderCreated Receive(CreateOrder cmd, IOrderLens lens) {
        // Validate using lens (read-only)
        var customer = lens.GetCustomer(cmd.CustomerId);
        if (!customer.IsActive) {
            throw new InactiveCustomerException();
        }
        
        // Check inventory through lens
        var inventory = lens.GetInventory(cmd.Items);
        if (!inventory.HasStock()) {
            throw new OutOfStockException();
        }
        
        // Make decision and emit event
        return new OrderCreated(
            Guid.NewGuid(),
            cmd.CustomerId,
            cmd.Items,
            CalculateTotal(cmd.Items),
            DateTime.UtcNow
        );
    }
}
```

### Characteristics of Stateless Receptors

- Get state from Lens parameters
- Created per request (transient lifetime)
- No internal state between calls
- Perfect for simple CRUD operations

## Stateful Receptors (Event-Sourced Mode)

In Event-Sourced mode, receptors maintain internal state rebuilt from events:

```csharp{
title: "Stateful Event-Sourced Receptor"
description: "Event-Sourced mode receptor with internal state maintained from events"
framework: "NET8"
category: "Core Concepts"
difficulty: "ADVANCED"
tags: ["Receptors", "Stateful", "Event-Sourced", "State Management"]
filename: "OrderReceptor.cs"
nugetPackages: ["Whizbang.EventSourcing"]
usingStatements: ["System", "System.Collections.Generic", "System.Linq", "Whizbang"]
showLineNumbers: true
highlightLines: [1, 17, 29, 46]
}
[EventSourced]
public class OrderReceptor : 
    IReceptor<CreateOrder>,
    IReceptor<AddItem>,
    IReceptor<RemoveItem>,
    IReceptor<ShipOrder> {
    
    // Internal state maintained from events
    private Guid id;
    private Guid customerId;
    private List<OrderItem> items = new();
    private OrderStatus status;
    private decimal total;
    
    // Command handlers - no lens needed
    public OrderCreated Receive(CreateOrder cmd) {
        if (id != Guid.Empty) {
            throw new InvalidOperationException("Order already created");
        }
        
        return new OrderCreated(
            Guid.NewGuid(),
            cmd.CustomerId,
            cmd.Items,
            cmd.Items.Sum(i => i.Quantity * i.Price),
            DateTime.UtcNow
        );
    }
    
    public ItemAdded Receive(AddItem cmd) {
        if (status != OrderStatus.Pending) {
            throw new InvalidOperationException("Cannot modify shipped order");
        }
        
        var newTotal = total + (cmd.Quantity * cmd.Price);
        return new ItemAdded(id, cmd.ProductId, cmd.Quantity, cmd.Price, newTotal);
    }
    
    public OrderShipped Receive(ShipOrder cmd) {
        if (status != OrderStatus.Paid) {
            throw new InvalidOperationException("Order must be paid before shipping");
        }
        
        return new OrderShipped(id, cmd.TrackingNumber, DateTime.UtcNow);
    }
    
    // Event handlers - update internal state
    public void Absorb(OrderCreated e) {
        id = e.OrderId;
        customerId = e.CustomerId;
        items = e.Items.ToList();
        total = e.Total;
        status = OrderStatus.Pending;
    }
    
    public void Absorb(ItemAdded e) {
        items.Add(new OrderItem(e.ProductId, e.Quantity, e.Price));
        total = e.NewTotal;
    }
    
    public void Absorb(OrderShipped e) {
        status = OrderStatus.Shipped;
    }
}
```

### Characteristics of Stateful Receptors

- Maintain internal state from event stream
- State rebuilt by replaying events
- Long-lived (cached between requests)
- Perfect for complex domain logic

## Return Type Semantics

What you return determines what happens:

```csharp{
title: "Return Type Semantics"
description: "Different return types control how events are published"
framework: "NET8"
category: "Core Concepts"
difficulty: "INTERMEDIATE"
tags: ["Receptors", "Return Types", "Events"]
filename: "PaymentReceptor.cs"
usingStatements: ["System", "Whizbang"]
showLineNumbers: true
}
public class PaymentReceptor : IReceptor<ProcessPayment> {
    // Single event - published to perspectives
    public PaymentProcessed Receive(ProcessPayment cmd) {
        return new PaymentProcessed(cmd.OrderId, cmd.Amount);
    }
    
    // Multiple events - all published
    public (PaymentProcessed, EmailQueued, InventoryReserved) ReceiveWithEffects(ProcessPayment cmd) {
        return (
            new PaymentProcessed(cmd.OrderId, cmd.Amount),
            new EmailQueued(cmd.CustomerEmail, "Payment received"),
            new InventoryReserved(cmd.OrderId, cmd.Items)
        );
    }
    
    // Result type - success/failure handling
    public Result<PaymentProcessed> ReceiveWithValidation(ProcessPayment cmd) {
        if (cmd.Amount <= 0) {
            return Result.Failure<PaymentProcessed>("Invalid amount");
        }
        
        return Result.Success(new PaymentProcessed(cmd.OrderId, cmd.Amount));
    }
}
```

## Evolution Pattern

Receptors naturally evolve from stateless to stateful as complexity grows:

### Stage 1: Simple Stateless
```csharp{
title: "Evolution Stage 1: Simple Stateless"
description: "Starting with a simple stateless receptor"
framework: "NET8"
category: "Evolution"
difficulty: "BEGINNER"
tags: ["Receptors", "Evolution", "Simple"]
filename: "ProductReceptor.cs"
usingStatements: ["System", "Whizbang"]
}
public class ProductReceptor : IReceptor<CreateProduct> {
    public ProductCreated Receive(CreateProduct cmd) {
        return new ProductCreated(Guid.NewGuid(), cmd.Name, cmd.Price);
    }
}
```

### Stage 2: Stateless with Validation
```csharp{
title: "Evolution Stage 2: Stateless with Validation"
description: "Adding validation using lens for state access"
framework: "NET8"
category: "Evolution"
difficulty: "INTERMEDIATE"
tags: ["Receptors", "Evolution", "Validation", "Lenses"]
filename: "ProductReceptor.cs"
usingStatements: ["System", "Whizbang"]
showLineNumbers: true
}
public class ProductReceptor : IReceptor<CreateProduct> {
    public ProductCreated Receive(CreateProduct cmd, IProductLens lens) {
        if (lens.Exists(p => p.Name == cmd.Name)) {
            throw new DuplicateProductException();
        }
        
        return new ProductCreated(Guid.NewGuid(), cmd.Name, cmd.Price);
    }
}
```

### Stage 3: Multiple Commands
```csharp{
title: "Evolution Stage 3: Multiple Commands"
description: "Multiple related commands suggesting need for state"
framework: "NET8"
category: "Evolution"
difficulty: "INTERMEDIATE"
tags: ["Receptors", "Evolution", "Multiple Commands"]
filename: "ProductReceptor.cs"
usingStatements: ["Whizbang"]
}
public class ProductReceptor : 
    IReceptor<CreateProduct>,
    IReceptor<UpdatePrice>,
    IReceptor<Discontinue> {
    
    // Multiple related commands suggest need for state
}
```

### Stage 4: Stateful (Event-Sourced)
```csharp{
title: "Evolution Stage 4: Stateful Event-Sourced"
description: "Final evolution to stateful receptor with internal state"
framework: "NET8"
category: "Evolution"
difficulty: "ADVANCED"
tags: ["Receptors", "Evolution", "Event-Sourced", "Stateful"]
filename: "ProductReceptor.cs"
nugetPackages: ["Whizbang.EventSourcing"]
usingStatements: ["System", "Whizbang"]
showLineNumbers: true
}
[EventSourced]
public class ProductReceptor : 
    IReceptor<CreateProduct>,
    IReceptor<UpdatePrice>,
    IReceptor<Discontinue> {
    
    private Guid id;
    private decimal price;
    private bool isDiscontinued;
    
    // Now maintains state across commands
}
```

## Receptor Configuration

Configure receptors via policies:

```csharp{
title: "Receptor Configuration"
description: "Configuring receptors with policies and assembly scanning"
framework: "NET8"
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["Receptors", "Configuration", "Policies"]
filename: "Program.cs"
nugetPackages: ["Whizbang.Core", "Microsoft.Extensions.DependencyInjection"]
usingStatements: ["Microsoft.Extensions.DependencyInjection", "System", "Whizbang"]
showLineNumbers: true
}
services.AddWhizbang()
    .UseDispatcher(dispatcher => {
        // Register all receptors
        dispatcher.RegisterReceptorsFromAssembly(typeof(Program).Assembly);
        
        // Configure specific receptors
        dispatcher.ForReceptor<OrderReceptor>()
            .UsePolicy(new EventSourcedPolicy {
                SnapshotFrequency = 100,
                CacheDuration = TimeSpan.FromMinutes(5)
            });
            
        dispatcher.ForReceptor<NotificationReceptor>()
            .UsePolicy(new EventDrivenPolicy {
                MaxConcurrency = 10
            });
    });
```

## Best Practices

### Do's

✅ **Keep receptors focused on decisions**
```csharp{
title: "Best Practice: Focus on Decisions"
description: "Keep receptors focused on business logic and decisions"
framework: "NET8"
category: "Best Practices"
difficulty: "BEGINNER"
tags: ["Receptors", "Best Practices", "Business Logic"]
filename: "OrderReceptor.cs"
usingStatements: ["Whizbang"]
}
public OrderCreated Receive(CreateOrder cmd) {
    // Only business logic and decision making
    return new OrderCreated(...);
}
```

✅ **Use descriptive event names**
```csharp{
title: "Best Practice: Descriptive Event Names"
description: "Use clear, descriptive names for events"
framework: "NET8"
category: "Best Practices"
difficulty: "BEGINNER"
tags: ["Receptors", "Best Practices", "Event Naming"]
filename: "OrderReceptor.cs"
usingStatements: ["Whizbang"]
}
return new OrderShipmentInitiated(...);  // Clear what happened
```

✅ **Validate business rules**
```csharp{
title: "Best Practice: Validate Business Rules"
description: "Enforce business rules with clear validation"
framework: "NET8"
category: "Best Practices"
difficulty: "BEGINNER"
tags: ["Receptors", "Best Practices", "Validation"]
filename: "OrderReceptor.cs"
usingStatements: ["System"]
}
if (status != OrderStatus.Paid) {
    throw new BusinessRuleViolationException("Order must be paid");
}
```

✅ **Return events for all state changes**
```csharp{
title: "Best Practice: Return Events for State Changes"
description: "Always return events for state changes"
framework: "NET8"
category: "Best Practices"
difficulty: "BEGINNER"
tags: ["Receptors", "Best Practices", "Events"]
filename: "ProductReceptor.cs"
usingStatements: ["Whizbang"]
}
public PriceUpdated Receive(UpdatePrice cmd) {
    return new PriceUpdated(id, oldPrice, cmd.NewPrice);
}
```

### Don'ts

❌ **Don't perform side effects**
```csharp{
title: "Anti-Pattern: Side Effects"
description: "DON'T perform side effects in receptors"
framework: "NET8"
category: "Anti-Patterns"
difficulty: "BEGINNER"
tags: ["Receptors", "Anti-Patterns", "Side Effects"]
filename: "OrderReceptor.cs"
usingStatements: ["Whizbang"]
}
// BAD - Side effect in receptor
public OrderCreated Receive(CreateOrder cmd) {
    emailService.SendEmail(...);  // Don't do this!
    database.Save(...);           // Don't do this!
    return new OrderCreated(...);
}
```

❌ **Don't mix read and write concerns**
```csharp{
title: "Anti-Pattern: Read/Write Mixing"
description: "DON'T mix read and write concerns in receptors"
framework: "NET8"
category: "Anti-Patterns"
difficulty: "BEGINNER"
tags: ["Receptors", "Anti-Patterns", "CQRS"]
filename: "OrderReceptor.cs"
usingStatements: ["Whizbang"]
}
// BAD - Receptor shouldn't query
public OrderList Receive(GetOrders query) {  // Use Lens instead
```

❌ **Don't mutate command parameters**
```csharp{
title: "Anti-Pattern: Mutating Commands"
description: "DON'T mutate command parameters"
framework: "NET8"
category: "Anti-Patterns"
difficulty: "BEGINNER"
tags: ["Receptors", "Anti-Patterns", "Immutability"]
filename: "OrderReceptor.cs"
usingStatements: ["System.Collections.Generic"]
}
// BAD - Commands are immutable
cmd.Items.Add(newItem);  // Don't modify!
```

## Testing Receptors

Receptors are easy to test because they're pure decision functions:

```csharp{
title: "Testing Receptors"
description: "Unit testing receptors as pure decision functions"
framework: "NET8"
category: "Testing"
difficulty: "INTERMEDIATE"
tags: ["Receptors", "Testing", "Unit Tests"]
filename: "OrderReceptorTests.cs"
nugetPackages: ["xunit"]
testFile: "OrderReceptorTests.cs"
testMethod: "CreateOrder_ValidCommand_ReturnsOrderCreatedEvent"
usingStatements: ["System", "Xunit", "Whizbang"]
showLineNumbers: true
}
[Fact]
public void CreateOrder_ValidCommand_ReturnsOrderCreatedEvent() {
    // Arrange
    var receptor = new OrderReceptor();
    var command = new CreateOrder {
        CustomerId = Guid.NewGuid(),
        Items = new[] { new OrderItem("SKU-1", 2, 10.00m) }
    };
    
    // Act
    var @event = receptor.Receive(command);
    
    // Assert
    Assert.IsType<OrderCreated>(@event);
    var orderCreated = (OrderCreated)@event;
    Assert.Equal(command.CustomerId, orderCreated.CustomerId);
    Assert.Equal(20.00m, orderCreated.Total);
}

[Fact]
public void ShipOrder_UnpaidOrder_ThrowsException() {
    // Arrange
    var receptor = new OrderReceptor();
    receptor.Absorb(new OrderCreated(...));  // Not paid
    
    // Act & Assert
    Assert.Throws<BusinessRuleViolationException>(
        () => receptor.Receive(new ShipOrder(...))
    );
}
```

## Advanced Patterns

### Compensating Events

```csharp{
title: "Compensating Events Pattern"
description: "Returning compensating events for complex operations"
framework: "NET8"
category: "Advanced"
difficulty: "ADVANCED"
tags: ["Receptors", "Compensating Events", "Advanced"]
filename: "PaymentReceptor.cs"
usingStatements: ["System", "Whizbang"]
showLineNumbers: true
}
public class PaymentReceptor : IReceptor<RefundPayment> {
    public (PaymentRefunded, InventoryReleased) Receive(RefundPayment cmd) {
        if (status != PaymentStatus.Completed) {
            throw new InvalidOperationException("Can only refund completed payments");
        }
        
        // Return compensating events
        return (
            new PaymentRefunded(id, amount, DateTime.UtcNow),
            new InventoryReleased(orderId, items)  // Compensate inventory
        );
    }
}
```

### Conditional Events

```csharp{
title: "Conditional Events Pattern"
description: "Returning different events based on current state"
framework: "NET8"
category: "Advanced"
difficulty: "ADVANCED"
tags: ["Receptors", "Conditional Events", "State-Based"]
filename: "OrderReceptor.cs"
usingStatements: ["System", "Whizbang"]
showLineNumbers: true
}
public class OrderReceptor : IReceptor<CompleteOrder> {
    public object Receive(CompleteOrder cmd) {
        return status switch {
            OrderStatus.Pending => new OrderCompleted(id),
            OrderStatus.OnHold => (object)(
                new OrderReleased(id),
                new OrderCompleted(id)
            ),
            _ => throw new InvalidOperationException($"Cannot complete order in {status} status")
        };
    }
}
```

### Saga Initiation

```csharp{
title: "Saga Initiation Pattern"
description: "Starting distributed transactions with multiple events"
framework: "NET8"
category: "Advanced"
difficulty: "ADVANCED"
tags: ["Receptors", "Sagas", "Distributed Transactions"]
filename: "CheckoutReceptor.cs"
usingStatements: ["Whizbang"]
showLineNumbers: true
}
public class CheckoutReceptor : IReceptor<Checkout> {
    public (CheckoutStarted, ReserveInventory, ProcessPayment) Receive(Checkout cmd) {
        // Start a distributed transaction
        return (
            new CheckoutStarted(cmd.OrderId),
            new ReserveInventory(cmd.OrderId, cmd.Items),
            new ProcessPayment(cmd.OrderId, cmd.PaymentMethod, cmd.Total)
        );
    }
}
```

## Summary

Receptors are the heart of Whizbang's decision-making:

- **Universal interface** works in both Event-Driven and Event-Sourced modes
- **Pure functions** that transform commands into events
- **Progressive enhancement** from stateless to stateful
- **Testable** without infrastructure dependencies
- **Composable** through return type semantics

Whether stateless or stateful, receptors ensure your business logic remains clean, testable, and portable across different deployment modes.

## Next Steps

- Explore **[Perspectives](/docs/core-concepts/perspectives)** - How events update views
- Learn about **[Lenses](/docs/core-concepts/lenses)** - Read-only state access
- See **[Event-Driven Architecture](/docs/architecture-design/event-driven-architecture)** - The bigger picture
- Review **[Testing Strategies](/docs/advanced/testing-strategies)** - Testing receptors