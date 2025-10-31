---
title: Return Type Semantics
category: Core Concepts
order: 5
tags: return-types, semantics, handlers, conventions, core-concept
description: How return types determine behavior in Whizbang - the foundation of convention over configuration
---

# Return Type Semantics

## Overview

In Whizbang, **what you return determines what happens next**. This simple yet powerful concept eliminates configuration and makes your code's intent crystal clear. Inspired by Wolverine's approach but extended to cover all messaging patterns.

## Core Philosophy

Traditional messaging libraries require explicit configuration:

```csharp
---
category: Core Concepts
difficulty: BEGINNER
tags: [Traditional-Messaging, Configuration, Explicit-Calls]
description: Traditional messaging approach with explicit method calls
---
// Traditional approach - configuration separate from logic
await bus.Publish(event1);
await bus.Send(command1);
await bus.Reply(response1);
await bus.Defer(message1, TimeSpan.FromMinutes(5));
```

Whizbang's approach - return values drive behavior:

```csharp
---
category: Core Concepts
difficulty: BEGINNER
tags: [Return-Type-Semantics, Convention-Over-Configuration, Intent]
description: Whizbang's return-based messaging with clear intent
---
// Whizbang - intent is clear from return type
return event1;                                    // Publishes event
return command1;                                  // Sends command  
return response1;                                 // Replies to sender
return message1.After(TimeSpan.FromMinutes(5));  // Defers message
```

## Basic Return Types

### Single Message Return

```csharp
---
category: Core Concepts
difficulty: BEGINNER
tags: [Return-Type-Semantics, Single-Message, Event-Publishing]
description: Single message return publishes event automatically
---
public class OrderHandler : IHandle<CreateOrder> {
    // Returning a single message publishes it as an event
    public OrderCreated Handle(CreateOrder cmd) {
        var order = CreateOrder(cmd);
        return new OrderCreated(order.Id, order.Total);
    }
}
```

**Behavior**:

- If return type implements `IEvent` → Publish to all subscribers
- If return type implements `ICommand` → Send to single handler
- If return type implements `IResponse` → Reply to original sender

### Void Return (Fire-and-Forget)

```csharp
---
category: Core Concepts
difficulty: BEGINNER
tags: [Return-Type-Semantics, Void-Return, Fire-And-Forget]
description: Void return for fire-and-forget operations
---
public class NotificationHandler : IHandle<SendNotification> {
    // Void means no follow-up messages
    public void Handle(SendNotification cmd) {
        Console.WriteLine($"Notification: {cmd.Message}");
        // No return = no cascading messages
    }
}
```

**Behavior**: Handler executes with no subsequent messages

### Task Return (Async Void)

```csharp
---
category: Core Concepts
difficulty: BEGINNER
tags: [Return-Type-Semantics, Async-Void, Task-Return]
description: Async Task return for asynchronous fire-and-forget operations
---
public class EmailHandler : IHandle<SendEmail> {
    // Async with no result
    public async Task Handle(SendEmail cmd) {
        await emailService.SendAsync(cmd.To, cmd.Subject, cmd.Body);
        // No return value = no cascading messages
    }
}
```

**Behavior**: Async execution with no follow-up messages

## Advanced Return Types

### Tuple Return (Multiple Effects)

```csharp
---
category: Core Concepts
difficulty: INTERMEDIATE
tags: [Return-Type-Semantics, Tuple-Return, Multiple-Effects]
description: Tuple return for multiple cascading messages
---
public class OrderHandler : IHandle<CreateOrder> {
    // Return multiple messages in one operation
    public (OrderCreated, ProcessPayment, SendConfirmation) Handle(CreateOrder cmd) {
        var order = CreateOrder(cmd);
        
        return (
            new OrderCreated(order.Id, order.Total),           // Publish event
            new ProcessPayment(order.Id, order.Total),         // Send command
            new SendConfirmation(order.CustomerEmail, order.Id) // Send command
        );
    }
}
```

**Behavior**: All messages in tuple are processed according to their type

### Result Type (Railway-Oriented Programming)

```csharp
---
category: Core Concepts
difficulty: INTERMEDIATE
tags: [Return-Type-Semantics, Result-Type, Railway-Oriented-Programming]
description: Result type for success/failure handling with railway-oriented programming
---
public class OrderHandler : IHandle<CreateOrder> {
    // Result<T> for success/failure handling
    public Result<OrderCreated> Handle(CreateOrder cmd) {
        if (!IsValid(cmd)) {
            return Result.Failure<OrderCreated>("Invalid order data");
        }
        
        var order = CreateOrder(cmd);
        return Result.Success(new OrderCreated(order.Id));
    }
}

// Alternative with custom error type
public class PaymentHandler : IHandle<ProcessPayment> {
    public Result<PaymentProcessed, PaymentError> Handle(ProcessPayment cmd) {
        try {
            var transaction = ProcessPayment(cmd);
            return Result.Success(new PaymentProcessed(transaction.Id));
        }
        catch (InsufficientFundsException ex) {
            return Result.Failure(new PaymentError("Insufficient funds", ex));
        }
    }
}
```

**Behavior**:

- On Success → Process success value
- On Failure → Handle error (can trigger compensation)

### IAsyncEnumerable (Streaming Results)

```csharp
---
category: Core Concepts
difficulty: ADVANCED
tags: [Return-Type-Semantics, Streaming, IAsyncEnumerable, Yield]
description: IAsyncEnumerable return for streaming results as they're processed
---
public class BatchHandler : IHandle<ProcessBatch> {
    // Stream results as they're processed
    public async IAsyncEnumerable<OrderProcessed> Handle(ProcessBatch cmd) {
        foreach (var item in cmd.Items) {
            await Task.Delay(100); // Simulate processing
            
            var result = ProcessItem(item);
            yield return new OrderProcessed(result.Id, result.Status);
            
            // Each yielded item is immediately published
        }
    }
}
```

**Behavior**: Each yielded item is processed as it's produced (streaming)

### Option Type (Maybe Monad)

```csharp
---
category: Core Concepts
difficulty: INTERMEDIATE
tags: [Return-Type-Semantics, Option-Type, Maybe-Monad, Null-Safety]
description: Option type for queries that might return nothing
---
public class QueryHandler : IHandle<GetOrder> {
    // Option<T> for queries that might return nothing
    public Option<Order> Handle(GetOrder query) {
        var order = repository.FindById(query.OrderId);
        
        return order != null 
            ? Option.Some(order)
            : Option.None<Order>();
    }
}
```

**Behavior**:

- Some(value) → Process the value
- None → Handle absence (no error)

## Specialized Return Types

### Deferred Messages

```csharp
---
category: Core Concepts
difficulty: INTERMEDIATE
tags: [Return-Type-Semantics, Deferred-Messages, Scheduling, Time-Based]
description: Deferred message return for scheduled future delivery
---
public class ReminderHandler : IHandle<ScheduleReminder> {
    // Defer message with fluent syntax
    public Deferred<SendReminder> Handle(ScheduleReminder cmd) {
        return new SendReminder(cmd.UserId, cmd.Message)
            .After(TimeSpan.FromHours(24));
    }
    
    // Or with specific time
    public Deferred<SendReminder> HandleAt(ScheduleReminder cmd) {
        return new SendReminder(cmd.UserId, cmd.Message)
            .At(DateTime.UtcNow.AddDays(1).Date.AddHours(9)); // Tomorrow 9 AM
    }
}
```

**Behavior**: Message is scheduled for future delivery

### Saga Instructions

```csharp
---
category: Core Concepts
difficulty: ADVANCED
tags: [Return-Type-Semantics, Saga, Orchestration, Timeout-Handling]
description: Saga action return for complex orchestration with timeout handling
---
public class OrderSaga : Saga<OrderState> {
    // Return saga instructions
    public SagaAction Handle(OrderCreated @event) {
        State.OrderId = @event.OrderId;
        State.Status = "Created";
        
        return SagaAction
            .Send(new ProcessPayment(@event.OrderId, @event.Total))
            .After(TimeSpan.FromSeconds(5))
            .WithTimeout(TimeSpan.FromMinutes(10))
            .OnTimeout(new CancelOrder(@event.OrderId));
    }
}
```

**Behavior**: Complex saga orchestration with timeout handling

### Batched Returns

```csharp
---
category: Core Concepts
difficulty: INTERMEDIATE
tags: [Return-Type-Semantics, Batch-Processing, Collections, LINQ]
description: Collection return for batch message processing
---
public class BatchHandler : IHandle<ProcessOrders> {
    // Return collection of messages
    public IEnumerable<IMessage> Handle(ProcessOrders cmd) {
        var messages = new List<IMessage>();
        
        foreach (var orderId in cmd.OrderIds) {
            messages.Add(new ProcessOrder(orderId));
            messages.Add(new LogOrderProcessing(orderId));
        }
        
        return messages;
    }
    
    // Or with LINQ
    public IEnumerable<ProcessOrder> HandleLinq(ProcessOrders cmd) {
        return cmd.OrderIds.Select(id => new ProcessOrder(id));
    }
}
```

**Behavior**: All messages in collection are processed

### Conditional Returns

```csharp
---
category: Core Concepts
difficulty: INTERMEDIATE
tags: [Return-Type-Semantics, Pattern-Matching, Conditional-Logic, Switch-Expressions]
description: Conditional return using pattern matching and switch expressions
---
public class ConditionalHandler : IHandle<ProcessOrder> {
    // Use pattern matching for conditional returns
    public IMessage Handle(ProcessOrder cmd) {
        return cmd.Priority switch {
            Priority.High => new ProcessImmediately(cmd.OrderId),
            Priority.Normal => new ProcessOrder(cmd.OrderId).After("5m"),
            Priority.Low => new QueueForBatch(cmd.OrderId),
            _ => new LogUnknownPriority(cmd.OrderId)
        };
    }
}
```

**Behavior**: Different messages based on conditions

## Complex Return Patterns

### Nested Tuples for Grouping

```csharp
---
category: Core Concepts
difficulty: ADVANCED
tags: [Return-Type-Semantics, Nested-Tuples, Message-Grouping, Complex-Returns]
description: Nested tuples for grouping related messages logically
---
public class ComplexHandler : IHandle<ComplexCommand> {
    // Group related messages
    public ((OrderCreated, InventoryReserved), (SendEmail, LogActivity)) Handle(ComplexCommand cmd) {
        var order = CreateOrder(cmd);
        var inventory = ReserveInventory(cmd);
        
        return (
            // Business events
            (new OrderCreated(order.Id), new InventoryReserved(inventory.Id)),
            // Side effects
            (new SendEmail(cmd.Email), new LogActivity("Order created"))
        );
    }
}
```

### Discriminated Unions

```csharp
---
category: Core Concepts
difficulty: ADVANCED
tags: [Return-Type-Semantics, Discriminated-Unions, OneOf, Outcome-Based-Returns]
description: Discriminated union return for different outcomes
---
public class PaymentHandler : IHandle<ProcessPayment> {
    // Return different types based on outcome
    public OneOf<PaymentSucceeded, PaymentFailed, PaymentPending> Handle(ProcessPayment cmd) {
        var result = paymentGateway.Process(cmd);
        
        return result.Status switch {
            "succeeded" => new PaymentSucceeded(result.TransactionId),
            "failed" => new PaymentFailed(result.ErrorCode),
            "pending" => new PaymentPending(result.PendingId),
            _ => throw new UnknownPaymentStatus(result.Status)
        };
    }
}
```

### Recursive Returns

```csharp
---
category: Core Concepts
difficulty: ADVANCED
tags: [Return-Type-Semantics, Recursive-Processing, Tree-Structures]
description: Recursive handler return for tree/graph processing
---
public class RecursiveHandler : IHandle<ProcessNode> {
    // Return can trigger same handler recursively
    public IEnumerable<ProcessNode> Handle(ProcessNode cmd) {
        ProcessCurrentNode(cmd);
        
        // Return child nodes for recursive processing
        return cmd.Children.Select(child => new ProcessNode(child));
    }
}
```

## Return Type Metadata

### Priority and Headers

```csharp
---
category: Core Concepts
difficulty: INTERMEDIATE
tags: [Return-Type-Semantics, Message-Metadata, Priority, Headers]
description: Message with metadata for priority and header configuration
---
public class PriorityHandler : IHandle<CreateOrder> {
    public MessageWithMetadata<OrderCreated> Handle(CreateOrder cmd) {
        var order = CreateOrder(cmd);
        
        return new OrderCreated(order.Id)
            .WithPriority(MessagePriority.High)
            .WithHeader("CustomerId", cmd.CustomerId)
            .WithHeader("Source", "WebAPI")
            .WithCorrelationId(cmd.CorrelationId);
    }
}
```

### Routing Instructions

```csharp
---
category: Core Concepts
difficulty: INTERMEDIATE
tags: [Return-Type-Semantics, Message-Routing, Regional-Routing, Queue-Selection]
description: Routed message return for regional queue selection
---
public class RoutingHandler : IHandle<RouteOrder> {
    public RoutedMessage Handle(RouteOrder cmd) {
        return new ProcessOrder(cmd.OrderId)
            .RouteTo(cmd.Region switch {
                "US" => "us-queue",
                "EU" => "eu-queue",
                "ASIA" => "asia-queue",
                _ => "global-queue"
            })
            .WithRoutingKey($"orders.{cmd.Priority}.{cmd.Region}");
    }
}
```

## Compile-Time Verification

### Return Type Validation

```csharp
---
category: Core Concepts
difficulty: ADVANCED
tags: [Return-Type-Semantics, Compile-Time-Validation, Pure-Functions]
description: Compile-time validation of return types and pure function constraints
---
// Source generator validates return types
public class InvalidHandler : IHandle<CreateOrder> {
    // ❌ Compile error: Handler must return a message type
    public string Handle(CreateOrder cmd) {
        return "This won't compile";
    }
}

[Pure]
public class PureHandler : IHandle<Calculate> {
    // ❌ Compile error: Pure handlers cannot return commands
    public SendEmail Handle(Calculate cmd) {
        return new SendEmail(); // Side effect not allowed
    }
    
    // ✅ Valid: Pure handlers can return events
    public Calculated Handle(Calculate cmd) {
        return new Calculated(cmd.A + cmd.B);
    }
}
```

### Effect Tracking

```csharp
---
category: Core Concepts
difficulty: ADVANCED
tags: [Return-Type-Semantics, Effect-Tracking, Compile-Time-Validation]
description: Effect tracking validation of return types against declared effects
---
[Effects(Publishes = "OrderEvents")]
public class TrackedHandler : IHandle<CreateOrder> {
    // ✅ Valid: Return type matches declared effects
    public OrderCreated Handle(CreateOrder cmd) {
        return new OrderCreated();
    }
    
    // ❌ Compile error: PaymentProcessed not in declared effects
    public PaymentProcessed HandlePayment(ProcessPayment cmd) {
        return new PaymentProcessed();
    }
}
```

## Performance Optimizations

### Stack-Allocated Returns

```csharp
// Small structs are stack-allocated for performance
public readonly struct LightweightEvent : IEvent {
    public readonly Guid Id;
    public readonly DateTime Timestamp;
    
    public LightweightEvent(Guid id) {
        Id = id;
        Timestamp = DateTime.UtcNow;
    }
}

public class PerformantHandler : IHandle<QuickCommand> {
    // Returns struct without heap allocation
    public LightweightEvent Handle(QuickCommand cmd) {
        return new LightweightEvent(cmd.Id);
    }
}
```

### Pooled Returns

```csharp
[PooledReturns] // Source generator creates pooling
public class PooledHandler : IHandle<FrequentCommand> {
    public FrequentEvent Handle(FrequentCommand cmd) {
        // Return value is automatically pooled and reused
        return new FrequentEvent { Id = cmd.Id };
    }
}
```

## Testing Return Types

```csharp
[Test]
public async Task Handler_ReturnsCorrectMessageTypes() {
    // Given
    var handler = new OrderHandler();
    var command = new CreateOrder { ... };
    
    // When
    var result = handler.Handle(command);
    
    // Then - Verify return types
    result.Should()
        .BeOfType<(OrderCreated, ProcessPayment, SendEmail)>()
        .Which.Should().Satisfy(
            r => r.Item1.OrderId == command.OrderId,
            r => r.Item2.Amount == command.Total,
            r => r.Item3.Recipient == command.CustomerEmail
        );
}

```csharp
---
category: Core Concepts
difficulty: INTERMEDIATE
tags: [Return-Type-Semantics, Testing, Streaming, IAsyncEnumerable]
description: Testing streaming return values with IAsyncEnumerable
---
[Test]
public async Task Handler_StreamingReturn_YieldsAllItems() {
    var handler = new BatchHandler();
    var items = new[] { item1, item2, item3 };
    
    var results = await handler
        .Handle(new ProcessBatch { Items = items })
        .ToListAsync();
    
    results.Should().HaveCount(3);
    results.Should().AllBeOfType<OrderProcessed>();
}
```

## Best Practices

### Do's

✅ **Use specific return types for clarity**

```csharp
---
category: Core Concepts
difficulty: BEGINNER
tags: [Return-Type-Semantics, Best-Practices, Clear-Intent]
description: Using specific return types for clarity
---
public OrderCreated Handle(CreateOrder cmd)  // Clear intent
```

✅ **Leverage tuples for related messages**

```csharp
---
category: Core Concepts
difficulty: INTERMEDIATE
tags: [Return-Type-Semantics, Best-Practices, Tuple-Returns]
description: Leveraging tuples for related messages
---
public (OrderCreated, SendEmail) Handle(CreateOrder cmd)
```

✅ **Use Result<T> for fallible operations**

```csharp
---
category: Core Concepts
difficulty: INTERMEDIATE
tags: [Return-Type-Semantics, Best-Practices, Result-Type, Error-Handling]
description: Using Result<T> for fallible operations
---
public Result<PaymentProcessed> Handle(ProcessPayment cmd)
```

✅ **Stream large result sets**

```csharp
---
category: Core Concepts
difficulty: ADVANCED
tags: [Return-Type-Semantics, Best-Practices, Streaming, Large-Results]
description: Streaming large result sets with IAsyncEnumerable
---
public async IAsyncEnumerable<Result> Handle(LargeQuery query)
```

### Don'ts

❌ **Don't use generic object returns**

```csharp
---
category: Core Concepts
difficulty: BEGINNER
tags: [Return-Type-Semantics, Anti-Patterns, Type-Safety]
description: Anti-pattern - using generic object returns loses type safety
---
public object Handle(Command cmd)  // Loses type safety
```

❌ **Don't mix unrelated messages in tuples**

```csharp
---
category: Core Concepts
difficulty: BEGINNER
tags: [Return-Type-Semantics, Anti-Patterns, Unrelated-Messages]
description: Anti-pattern - mixing unrelated messages in tuples
---
public (OrderCreated, UnrelatedUserLogout) Handle(CreateOrder cmd)
```

❌ **Don't ignore return values in tests**

```csharp
---
category: Core Concepts
difficulty: BEGINNER
tags: [Return-Type-Semantics, Anti-Patterns, Testing, Ignored-Returns]
description: Anti-pattern - ignoring return values in tests
---
handler.Handle(cmd);  // Should verify return value
```

## Summary

Return type semantics in Whizbang provide:

- **Clear intent** from method signatures
- **Zero configuration** message routing
- **Type safety** with compile-time verification
- **Flexibility** through various return patterns
- **Performance** with optimized return handling

This approach makes your handlers self-documenting and eliminates the impedance mismatch between your domain logic and messaging infrastructure.

## Next Steps

- Explore **[Policy Composition](/docs/advanced/policy-composition)** for resilience
- Learn about **[Aspect-Oriented Handlers](/docs/usage-patterns/aspect-oriented-handlers)**
- See **[Progressive Enhancement](/docs/usage-patterns/progressive-enhancement)** patterns
- Review **[Testing Strategies](/docs/advanced/testing-strategies)**
