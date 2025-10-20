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
// Traditional approach - configuration separate from logic
await bus.Publish(event1);
await bus.Send(command1);
await bus.Reply(response1);
await bus.Defer(message1, TimeSpan.FromMinutes(5));
```

Whizbang's approach - return values drive behavior:
```csharp
// Whizbang - intent is clear from return type
return event1;                                    // Publishes event
return command1;                                  // Sends command  
return response1;                                 // Replies to sender
return message1.After(TimeSpan.FromMinutes(5));  // Defers message
```

## Basic Return Types

### Single Message Return

```csharp
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
public OrderCreated Handle(CreateOrder cmd)  // Clear intent
```

✅ **Leverage tuples for related messages**
```csharp
public (OrderCreated, SendEmail) Handle(CreateOrder cmd)
```

✅ **Use Result<T> for fallible operations**
```csharp
public Result<PaymentProcessed> Handle(ProcessPayment cmd)
```

✅ **Stream large result sets**
```csharp
public async IAsyncEnumerable<Result> Handle(LargeQuery query)
```

### Don'ts

❌ **Don't use generic object returns**
```csharp
public object Handle(Command cmd)  // Loses type safety
```

❌ **Don't mix unrelated messages in tuples**
```csharp
public (OrderCreated, UnrelatedUserLogout) Handle(CreateOrder cmd)
```

❌ **Don't ignore return values in tests**
```csharp
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