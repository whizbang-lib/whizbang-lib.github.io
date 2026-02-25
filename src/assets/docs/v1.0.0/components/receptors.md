---
title: Receptors Component
version: 1.0.0
category: Components
order: 3
description: >-
  Command receivers that make decisions and emit events - the foundation of
  Whizbang's event-driven architecture
tags: 'receptors, commands, events, stateless, v0.1.0'
---

# Receptors Component

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Status](https://img.shields.io/badge/status-stable-green)

## Version History

:::new
**New in v1.0.0**: Type-safe receptors with async support and automatic multi-destination routing
:::


## Overview

Receptors are the decision-making components in Whizbang. They receive commands, apply business rules, and emit events representing the decisions made. In v1.0.0, receptors are **stateless** and focus on simple command-to-event transformation.

## What is a Receptor?

A Receptor:
- **Receives** commands from the dispatcher
- **Validates** business rules
- **Decides** what should happen
- **Emits** events representing decisions
- **Never** performs side effects directly

Think of a receptor as a pure decision function: given a command, what event(s) should occur?

## Core Interface (v1.0.0)

:::new
The type-safe receptor interface with generic message and response types:
:::

```csharp
public interface IReceptor<TMessage, TResponse> {
    Task<TResponse> Receive(TMessage message);
}
```

### Key Features

- **Type Safety**: Compile-time checking for message and response types
- **Async Support**: All operations return `Task<TResponse>` for async handling
- **Multi-Destination**: Multiple receptors can handle the same message type
- **Zero Reflection**: Source generation provides maximum performance

### Response Type Flexibility

Receptors support flexible response types:

| Response Type | Behavior | Example |
|---------------|----------|---------|
| Single Response | Return typed response | `Task<OrderCreated>` |
| Tuple Response | Return multiple related responses | `Task<(PaymentProcessed, AuditEvent)>` |
| Array Response | Return dynamic number of responses | `Task<NotificationEvent[]>` |
| Result Type | Success/failure handling | `Task<Result<OrderCreated>>` |

## Stateless Implementation

:::new
In v1.0.0, all receptors are stateless and get any needed state from parameters:
:::

```csharp
[WhizbangHandler]  // Source generator discovers this
public class OrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    
    public async Task<OrderCreated> Receive(CreateOrder cmd) {
        // Simple validation
        if (cmd.Items.Count == 0) {
            throw new InvalidOperationException("Order must have items");
        }
        
        // Make decision and return response
        return new OrderCreated(
            OrderId: Guid.NewGuid(),
            CustomerId: cmd.CustomerId,
            Items: cmd.Items,
            Total: cmd.Items.Sum(i => i.Quantity * i.Price),
            CreatedAt: DateTimeOffset.UtcNow
        );
    }
}
```

## Multi-Destination Routing

:::new
**Key Feature**: Multiple receptors can handle the same message type, running automatically in parallel:
:::

```csharp
// Multiple receptors can handle the same message type

public class OrderBusinessReceptor : IReceptor<CreateOrder, OrderCreated> {
    public async Task<OrderCreated> Receive(CreateOrder cmd) {
        // Main business logic
        var order = await ProcessOrder(cmd);
        return new OrderCreated(order.Id, order.Items);
    }
}

public class OrderAuditReceptor : IReceptor<CreateOrder, AuditEvent> {
    public async Task<AuditEvent> Receive(CreateOrder cmd) {
        // Compliance logging runs in parallel
        await _auditLog.Record("OrderCreationAttempt", cmd);
        return new AuditEvent("OrderCreationAttempt", cmd.OrderId);
    }
}

public class OrderFraudReceptor : IReceptor<CreateOrder, FraudCheckResult> {
    public async Task<FraudCheckResult> Receive(CreateOrder cmd) {
        // Fraud detection runs in parallel
        var riskScore = await _fraudEngine.Analyze(cmd);
        return new FraudCheckResult(cmd.OrderId, riskScore);
    }
}

// Framework automatically routes CreateOrder to all three receptors
// All run in parallel, each returning their specific response type
```

## Working with Lenses

For queries, receptors can receive lens parameters:

```csharp
public class OrderUpdateReceptor : IReceptor<UpdateOrder, OrderUpdated> {
    
    public async Task<OrderUpdated> Receive(UpdateOrder cmd, IOrderLens lens) {
        // Use lens to query current state (read-only)
        var currentOrder = await lens.Focus(cmd.OrderId);
        
        if (currentOrder == null) {
            throw new OrderNotFoundException(cmd.OrderId);
        }
        
        if (currentOrder.Status == OrderStatus.Shipped) {
            throw new InvalidOperationException("Cannot update shipped order");
        }
        
        // Return response based on decision
        return new OrderUpdated(
            OrderId: cmd.OrderId,
            Changes: cmd.Changes,
            UpdatedAt: DateTimeOffset.UtcNow
        );
    }
}
```

## Flexible Response Types

Receptors can return single responses, tuples, or arrays:

```csharp
// Single response
public class OrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    public async Task<OrderCreated> Receive(CreateOrder cmd) {
        return new OrderCreated(cmd.OrderId);
    }
}

// Multiple responses via tuple
public class PaymentReceptor : IReceptor<ProcessPayment, (PaymentProcessed, AuditEvent)> {
    public async Task<(PaymentProcessed, AuditEvent)> Receive(ProcessPayment cmd) {
        var payment = await ProcessPayment(cmd);
        return (
            new PaymentProcessed(payment.Id),
            new AuditEvent("PaymentProcessed", payment.Id)
        );
    }
}

// Array for dynamic responses
public class NotificationReceptor : IReceptor<OrderCreated, NotificationEvent[]> {
    public async Task<NotificationEvent[]> Receive(OrderCreated evt) {
        var notifications = new List<NotificationEvent>();
        
        notifications.Add(new EmailSent(evt.CustomerId));
        
        if (evt.Total > 1000) {
            notifications.Add(new HighValueAlert(evt.OrderId));
        }
        
        return notifications.ToArray();
    }
}
```

## Error Handling

Use `Result<T>` for explicit success/failure:

```csharp
public class OrderCancelReceptor : IReceptor<CancelOrder, Result<OrderCancelled>> {
    
    public async Task<Result<OrderCancelled>> Receive(CancelOrder cmd, IOrderLens lens) {
        var order = await lens.Focus(cmd.OrderId);
        
        if (order == null) {
            return Result.Failure<OrderCancelled>("Order not found");
        }
        
        if (order.Status == OrderStatus.Shipped) {
            return Result.Failure<OrderCancelled>("Cannot cancel shipped order");
        }
        
        return Result.Success(new OrderCancelled(cmd.OrderId));
    }
}
```

## Source Generation

:::new
Receptors are discovered at compile time via source generators:
:::

```csharp
// Generated by Whizbang.Generators
public static partial class WhizbangGenerated {
    public static void RegisterReceptors(IServiceCollection services) {
        services.AddScoped<IReceptor<CreateOrder, OrderCreated>, OrderReceptor>();
        services.AddScoped<IReceptor<CreateOrder, AuditEvent>, OrderAuditReceptor>();
        services.AddScoped<IReceptor<CreateOrder, FraudCheckResult>, OrderFraudReceptor>();
        services.AddScoped<IReceptor<UpdateOrder, OrderUpdated>, OrderUpdateReceptor>();
        services.AddScoped<IReceptor<CancelOrder, Result<OrderCancelled>>, OrderCancelReceptor>();
    }
}
```

## Policy Application

:::new
Policies can be applied to receptors via attributes:
:::

```csharp
[Retry(3, BackoffStrategy.Exponential)]
[Timeout(5000)]
[CircuitBreaker(0.5, TimeoutSeconds = 30)]
public class PaymentReceptor : IReceptor<ProcessPayment, PaymentProcessed> {
    public async Task<PaymentProcessed> Receive(ProcessPayment cmd) {
        // Policies are applied automatically by the dispatcher
        var result = await ProcessPaymentAsync(cmd);
        return new PaymentProcessed(cmd.PaymentId, result.Amount);
    }
}
```

## Testing Receptors

```csharp
[Test]
public class OrderReceptorTests {
    private OrderReceptor _receptor;
    
    [SetUp]
    public void Setup() {
        _receptor = new OrderReceptor();
    }
    
    [Test]
    public async Task CreateOrder_WithItems_ShouldReturnOrderCreated() {
        // Arrange
        var command = new CreateOrder(
            CustomerId: Guid.NewGuid(),
            Items: new[] { new OrderItem("SKU-001", 2, 29.99m) }
        );
        
        // Act
        var result = await _receptor.Receive(command);
        
        // Assert
        Assert.IsType<OrderCreated>(result);
        Assert.NotEqual(Guid.Empty, result.OrderId);
        Assert.Equal(59.98m, result.Total);
    }
    
    [Test]
    public async Task CreateOrder_WithNoItems_ShouldThrow() {
        // Arrange
        var command = new CreateOrder(
            CustomerId: Guid.NewGuid(),
            Items: Array.Empty<OrderItem>()
        );
        
        // Act & Assert
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => _receptor.Receive(command)
        );
    }
}
```

## IDE Features

The IDE provides rich support for receptors:

```csharp
// IDE shows: "Handles: CreateOrder → OrderCreated | Type-safe async receptor"
public class OrderReceptor : IReceptor<CreateOrder, OrderCreated> { }

// IDE shows: "3 receptors handle this message type"
public record CreateOrder(Guid CustomerId, OrderItem[] Items);

// IDE shows: "Returned by: OrderReceptor.Receive, OrderBusinessReceptor.Receive"
public record OrderCreated(Guid OrderId, Guid CustomerId);
```

## Dispatcher Integration

The Dispatcher provides different ways to invoke receptors:

```csharp
public interface IDispatcher {
    // Inline async - wait for single response
    Task<TResponse> Send<TResponse>(object message);
    
    // Fire and forget - no response needed
    Task Fire(object message);
    
    // Callback - handle response asynchronously
    Task SendWithCallback<TResponse>(object message, Func<TResponse, Task> callback);
    
    // Multiple responses (from multiple receptors)
    Task<IEnumerable<object>> SendAll(object message);
}
```

### Usage Examples

```csharp
public class OrderController {
    private readonly IDispatcher _dispatcher;
    
    // Inline async - wait for result
    public async Task<IActionResult> CreateOrder(CreateOrderRequest request) {
        var command = new CreateOrder(request.CustomerId, request.Items);
        var result = await _dispatcher.Send<OrderCreated>(command);
        return Ok(result);
    }
    
    // Fire and forget - audit logging
    public async Task LogAction(string action) {
        var auditCommand = new LogAuditEvent(action, GetUserId());
        await _dispatcher.Fire(auditCommand); // Don't wait for completion
    }
    
    // Multiple responses - get all results
    public async Task<IActionResult> ProcessOrderWithAudit(CreateOrder command) {
        var results = await _dispatcher.SendAll(command);
        
        var orderCreated = results.OfType<OrderCreated>().Single();
        var auditEvent = results.OfType<AuditEvent>().Single();
        var fraudResult = results.OfType<FraudCheckResult>().Single();
        
        return Ok(new { orderCreated, auditEvent, fraudResult });
    }
}
```

## Limitations in v1.0.0

:::info
These limitations are addressed in future versions:
:::

- **No state management** - Receptors cannot maintain state between calls
- **Basic validation** - Manual validation in code  
- **Limited dependency injection** - Cannot inject services directly into Receive method
- **Single message handling** - Each receptor handles one message type

## Migration Path

### To v0.2.0 (Non-Breaking)

:::planned
v0.2.0 adds these enhancements without breaking existing code:
:::

```csharp
// v1.0.0 - Current async interface
public async Task<OrderCreated> Receive(CreateOrder cmd) { }

// v0.2.0 - Enhanced capabilities
public async Task<OrderCreated> Receive(
    [Valid] CreateOrder cmd,      // Automatic validation
    IOrderService service,        // Service injection
    IMessageContext context       // Context injection
) { }
```

### To v0.3.0 (Stateful Receptors)

:::planned
v0.3.0 introduces stateful receptors for event sourcing:
:::

```csharp
// v0.3.0 - Stateful receptor
[EventSourced]
public class OrderReceptor : IStatefulReceptor<Order> {
    private Order state;  // Maintained from events
    
    public OrderUpdated Receive(UpdateOrder cmd) {
        // Can access state directly
        if (state.Status == OrderStatus.Shipped) {
            throw new InvalidOperationException();
        }
        return new OrderUpdated(state.Id, cmd.Changes);
    }
}
```

## Performance Characteristics

| Operation | Target | Actual |
|-----------|--------|--------|
| Receive invocation | < 100ns | TBD |
| Event creation | < 50ns | TBD |
| Validation | < 1μs | TBD |
| Policy application | < 10μs | TBD |

## Best Practices

1. **Keep receptors pure** - No side effects, only decisions
2. **Return events** - Always return events, not void
3. **Validate early** - Check preconditions first
4. **Use meaningful names** - OrderReceptor, not OrderHandler
5. **One command type** - Each receptor handles one command
6. **Test thoroughly** - Unit test all paths

## Related Documentation

- [Dispatcher](dispatcher.md) - How commands reach receptors
- [Perspectives](perspectives.md) - What happens to emitted events
- [Lenses](lenses.md) - Querying state in receptors
- [Policy Engine](policy-engine.md) - Applying policies to receptors
- [Testing](../testing/foundation.md) - Testing receptors

## Next Steps

- See [v0.2.0 Enhancements](../../v0.2.0/enhancements/receptors.md) for validation and injection features
- See [v0.3.0 Stateful Receptors](../../v0.3.0/features/stateful-receptors.md) for event sourcing
- Review [Examples](../examples/basic-receptor.md) for practical usage
