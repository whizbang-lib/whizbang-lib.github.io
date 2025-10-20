---
title: Whizbang Unified Vision
category: Architecture & Design
order: 3
tags: vision, architecture, unified-model, aop, progressive-enhancement
description: The unified architecture vision for Whizbang - combining the best of all messaging libraries with aspect-oriented programming
---

# Whizbang Unified Vision

## One Runtime. Any Mode. Every Pattern.

Whizbang represents a fundamental shift in how we think about messaging, events, and commands in .NET. Instead of choosing between different libraries for different needs, Whizbang provides **one mental model** that scales from simple in-process messaging to complex distributed event-sourced systems—without changing your code.

## The Problem We Solve

Today's .NET developers face an impossible choice:
- **MediatR** for simple in-process messaging
- **Wolverine** for performance and durability  
- **MassTransit** for distributed systems
- **NServiceBus** for enterprise features
- **Custom solutions** for event sourcing

Each library requires different patterns, different abstractions, and different mental models. Migrating between them means rewriting your entire application layer.

## The Whizbang Solution: Progressive Enhancement

```csharp
// This SAME handler works across ALL modes
public class OrderHandler : IHandle<CreateOrder> {
    public OrderCreated Handle(CreateOrder cmd, IOrderRepository repo) {
        var order = repo.CreateOrder(cmd);
        return new OrderCreated(order.Id, order.Total);
    }
}

// Start simple (like MediatR)
services.AddWhizbang().UseInProcessMode();

// Add durability (like Wolverine) - SAME HANDLER
services.AddWhizbang().UseDurableMode();

// Scale to distributed (like MassTransit) - SAME HANDLER  
services.AddWhizbang().UseDistributedMode();

// Enable event sourcing (unique to Whizbang) - SAME HANDLER
services.AddWhizbang().UseEventSourcedMode();
```

## Core Philosophy

### 1. **One Mental Model**
Write your business logic once. The same handlers, same patterns, and same abstractions work whether you're building a monolith or a distributed system.

### 2. **Convention Over Configuration**
Smart defaults derived from the best practices of all major libraries. Return types determine behavior. Attributes declare aspects. Source generators eliminate boilerplate.

### 3. **Aspect-Oriented by Design**
Cross-cutting concerns are first-class citizens, not afterthoughts. Logging, retry, caching, authorization—all composable through a powerful aspect system.

### 4. **Compile-Time Safety**
Source generators verify correctness at build time. Pure functions are enforced. Side effects are tracked. Mistakes are caught before runtime.

### 5. **Performance Without Compromise**
Runtime code generation like Wolverine. Zero-allocation patterns. Adaptive optimization. The convenience of high-level abstractions with the performance of hand-tuned code.

## Learning from the Best

### What We Take from Each Library

| Library | What We Adopt | How We Improve |
|---------|---------------|----------------|
| **MediatR** | Simplicity, pipeline behaviors | Add durability without complexity |
| **Wolverine** | Return type semantics, code generation | Extend to distributed scenarios |
| **MassTransit** | State machines, routing | Simplify configuration |
| **Brighter** | Policy attributes, command processor | Unify with aspects |
| **Rebus** | Flexibility, defer patterns | Maintain simplicity at scale |
| **NServiceBus** | Saga orchestration, monitoring | Open source with better DX |

## Unique Innovations

### Return Type Semantics

```csharp
public class OrderHandler {
    // Single return = single effect
    public OrderCreated Handle(CreateOrder cmd) => 
        new OrderCreated(cmd.OrderId);
    
    // Tuple return = multiple effects (cascading)
    public (OrderCreated, ProcessPayment, SendEmail) HandleComplete(CreateOrder cmd) => 
        (new OrderCreated(), new ProcessPayment(), new SendEmail());
    
    // Result return = validation with railway-oriented programming
    public Result<OrderCreated> HandleWithValidation(CreateOrder cmd) =>
        cmd.IsValid() 
            ? Result.Success(new OrderCreated())
            : Result.Failure<OrderCreated>("Invalid order");
    
    // IAsyncEnumerable = streaming results
    public async IAsyncEnumerable<OrderEvent> HandleBatch(ProcessBatch cmd) {
        foreach (var item in cmd.Items) {
            yield return ProcessItem(item);
        }
    }
    
    // Void = fire-and-forget
    public void HandleNotification(NotifyUser cmd) => 
        Console.WriteLine("Notified");
}
```

### Aspect-Oriented Programming

```csharp
[Logged]
[Timed]
[Cached(Duration = "5m")]
[Retry(3, Backoff = "exponential")]
[Authorized(Role = "Admin")]
public class OrderHandler : IHandle<CreateOrder> {
    [Pure] // Compile-time verification of no side effects
    public OrderCreated Handle(CreateOrder cmd) {
        // All aspects automatically applied via source generation
        return new OrderCreated(cmd.OrderId);
    }
}
```

### Pure Functions with Effect Tracking

```csharp
[Pure] // Enforced at compile time
public OrderCalculated Calculate(Order order) {
    // ✅ Pure computation allowed
    return new OrderCalculated(order.Items.Sum(i => i.Price));
    
    // ❌ Compile error: I/O not allowed in pure function
    // await database.SaveAsync(order);
}

[Effects(Reads = "Inventory", Writes = "Orders", Publishes = "OrderEvents")]
public async Task<OrderCreated> Handle(CreateOrder cmd) {
    // Effects are declared and tracked
    var inventory = await ReadInventory();
    var order = await WriteOrder(cmd);
    await PublishEvent(new OrderCreated());
    return order;
}
```

### Compile-Time Verification

```csharp
[EventSourced]
public class Order : Aggregate {
    [Pure] // Verified: no side effects in event application
    public void Apply(OrderCreated e) {
        Id = e.OrderId;
        Total = e.Total;
        // await EmailService.Send(); // ❌ Compile error
    }
    
    [Command]
    public OrderShipped Ship(ShipOrder cmd) {
        // Business logic with compile-time rule checking
        if (Status != OrderStatus.Paid) {
            throw new InvalidOperationException(); // ⚠️ Warning: Consider Result<T>
        }
        return new OrderShipped(Id);
    }
}
```

## Architecture Modes

### Mode 1: In-Process (Development/Monolith)
```csharp
services.AddWhizbang()
    .UseInProcessMode()
    .WithInMemoryStorage();
```
- Zero configuration
- Immediate execution
- Perfect for development
- No infrastructure needed

### Mode 2: Durable (Single Service)
```csharp
services.AddWhizbang()
    .UseDurableMode()
    .UsePostgreSQL(connectionString)
    .WithOutbox();
```
- Automatic persistence
- Outbox pattern
- Retry on failure
- Transaction support

### Mode 3: Distributed (Microservices)
```csharp
services.AddWhizbang()
    .UseDistributedMode()
    .UseKafka(config)
    .WithSagaOrchestration()
    .WithDistributedTracing();
```
- Cross-service messaging
- Saga orchestration
- Distributed tracing
- Multiple transports

### Mode 4: Event-Sourced (Event-Driven)
```csharp
services.AddWhizbang()
    .UseEventSourcedMode()
    .UseEventStore(config)
    .WithProjections()
    .WithSnapshots();
```
- Full event sourcing
- Automatic projections
- Time travel debugging
- CQRS patterns

## The Developer Experience

### IDE Integration
```csharp
// IntelliSense knows about aspects and suggests appropriate ones
[Wh| // IDE suggests: WhizbangHandler, WhizbangSaga, WhizbangProjection

public class OrderHandler {
    // Type 'Handle' and IDE generates method with aspects
    public Handle| // IDE template with return type options
}
```

### Testing Excellence
```csharp
[Test]
public async Task OrderHandler_CreatesOrder_WithAllAspects() {
    await Whizbang.Test<OrderHandler>()
        .Given(new CreateOrder { ... })
        .WithAspects() // Test with production aspects
        .WhenHandled()
        .Then(result => result.ShouldBeSuccess())
        .AndAspect<LoggingAspect>(logs => logs.ShouldContain("Order created"))
        .AndAspect<MetricsAspect>(metrics => metrics["orders.created"].ShouldBe(1))
        .AndAspect<CacheAspect>(cache => cache.ShouldHaveStored("order:123"));
}
```

### Observability Built-In
```csharp
// Automatic OpenTelemetry integration
[Observed]
public class OrderHandler {
    public OrderCreated Handle(CreateOrder cmd) {
        // Automatically generates:
        // - Distributed trace spans
        // - Metrics (count, duration, errors)
        // - Structured logs
        // - Health checks
        return new OrderCreated();
    }
}
```

## Migration Path

### From MediatR
```csharp
// Before (MediatR)
public class Handler : IRequestHandler<Command, Result> {
    public Task<Result> Handle(Command request, CancellationToken ct) { }
}

// After (Whizbang) - Almost identical!
public class Handler : IHandle<Command> {
    public Result Handle(Command cmd) { }  // Simpler, no cancellation token
}
```

### From MassTransit
```csharp
// Before (MassTransit)
public class Consumer : IConsumer<Message> {
    public async Task Consume(ConsumeContext<Message> context) { }
}

// After (Whizbang) - Cleaner, same power
public class Handler : IHandle<Message> {
    public Response Handle(Message msg) { }  // Context available via aspects
}
```

### From Wolverine
```csharp
// Before (Wolverine)
public static class Handler {
    public static Result Handle(Command cmd) { }
}

// After (Whizbang) - Same return type semantics!
public class Handler : IHandle<Command> {
    public Result Handle(Command cmd) { }  // Return type still determines behavior
}
```

## Performance Characteristics

| Aspect | Implementation | Benefit |
|--------|---------------|---------|
| **Source Generation** | Compile-time code generation | Zero reflection overhead |
| **Struct Messages** | Value types for small messages | Reduced allocations |
| **Object Pooling** | Automatic for handlers and messages | Lower GC pressure |
| **SIMD Operations** | Vectorized operations where applicable | Faster processing |
| **Adaptive Optimization** | Runtime profiling and recompilation | Improves over time |

## Comparison Matrix

| Feature | Whizbang | MediatR | Wolverine | MassTransit | NServiceBus |
|---------|----------|---------|-----------|-------------|-------------|
| **In-Process** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Distributed** | ✅ | ❌ | ✅ | ✅ | ✅ |
| **Event Sourcing** | ✅ Native | ❌ | ⚠️ | ❌ | ⚠️ |
| **AOP** | ✅ First-class | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| **Return Type Semantics** | ✅ | ❌ | ✅ | ❌ | ❌ |
| **Source Generation** | ✅ | ❌ | ✅ | ❌ | ❌ |
| **Pure Functions** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Effect Tracking** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Progressive Enhancement** | ✅ | ❌ | ⚠️ | ⚠️ | ⚠️ |
| **Time Travel Testing** | ✅ | ❌ | ❌ | ❌ | ❌ |

## Summary

Whizbang is not just another messaging library—it's a unified platform that grows with your application. Start simple like MediatR, add durability like Wolverine, scale like MassTransit, and leverage event sourcing when you need it—all without changing your handlers or learning new patterns.

**Write once. Run anywhere. Scale infinitely.**

## Next Steps

- See **[Aspect-Oriented Programming](aspect-oriented-programming.md)** for the AOP system
- Learn about **[Return Type Semantics](/docs/core-concepts/return-type-semantics)** 
- Explore **[Progressive Enhancement](/docs/usage-patterns/progressive-enhancement)**
- Read the **[Getting Started](/docs/getting-started/getting-started)** guide