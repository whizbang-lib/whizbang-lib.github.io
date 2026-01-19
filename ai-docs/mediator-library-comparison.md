# Mediator Library Comparison & Analysis

## Overview

This document analyzes popular .NET mediator and messaging libraries to understand their unique strengths, architectural decisions, and what makes each one valuable in different scenarios. This analysis helps inform Whizbang's design by learning from successful patterns in the ecosystem.

## Libraries Analyzed

1. **MediatR** - The ubiquitous in-process mediator
2. **Wolverine** - Opinionated messaging framework
3. **MassTransit** - Distributed application framework
4. **Brighter** - Command processor with external bus support
5. **Rebus** - Simple service bus
6. **NServiceBus** - Enterprise service bus

## MediatR

### Strengths
- **Extreme Simplicity**: Just request/response with no assumptions
- **Zero Configuration**: Works immediately with DI registration
- **Minimal Abstractions**: IRequest, IRequestHandler, INotification
- **Pipeline Behaviors**: Clean cross-cutting concern injection
- **Synchronous by Design**: No confusion about execution context
- **Excellent IDE Support**: Go to Implementation works perfectly

### What Makes It Great
```csharp
// The entire mental model in one interface
public interface IRequest<out TResponse> { }

// Dead simple handler
public class GetOrderHandler : IRequestHandler<GetOrder, Order> {
    public Task<Order> Handle(GetOrder request, CancellationToken ct) {
        // Your code here
    }
}

// Pipeline behaviors for AOP
public class LoggingBehavior<TRequest, TResponse> : IPipelineBehavior<TRequest, TResponse> {
    public async Task<TResponse> Handle(TRequest request, RequestHandlerDelegate<TResponse> next) {
        _logger.LogInformation("Handling {Request}", typeof(TRequest).Name);
        var response = await next();
        _logger.LogInformation("Handled {Request}", typeof(TRequest).Name);
        return response;
    }
}
```

### Design Decisions That Matter
- **No Built-in Persistence**: Keeps it simple and composable
- **No Retry/Resilience**: User's responsibility via behaviors
- **Void Returns Allowed**: Supports fire-and-forget patterns
- **Multiple Handler Notifications**: Pub/sub within process
- **No Message Versioning**: Assumes compile-time safety

### When MediatR Excels
- Monolithic applications
- Vertical slice architecture
- CQRS without event sourcing
- Rapid prototyping
- Teams new to mediator pattern

## Wolverine (formerly Jasper)

### Strengths
- **Runtime Code Generation**: Optimal performance via compilation
- **Message Durability**: Built-in persistence and outbox pattern
- **Saga Support**: First-class stateful workflow support
- **Error Policies**: Sophisticated retry/error handling
- **Minimal Ceremony**: Convention over configuration
- **HTTP Endpoint Integration**: Direct handler-to-endpoint mapping

### What Makes It Great
```csharp
// Minimal handler - no interfaces!
public static class OrderHandler {
    // Return types determine behavior
    public static OrderCreated Handle(CreateOrder command, IOrderRepository repo) {
        var order = repo.Create(command);
        return new OrderCreated(order.Id);
    }
    
    // Cascading messages via tuple return
    public static (OrderShipped, SendEmail) Handle(ShipOrder command) {
        return (
            new OrderShipped(command.OrderId),
            new SendEmail(command.CustomerEmail, "Order shipped!")
        );
    }
}

// Saga with zero boilerplate
public class OrderSaga : Saga {
    public Guid Id { get; set; }
    public OrderState State { get; set; }
    
    // Methods are matched by parameter type
    public void Start(OrderPlaced e) => State = OrderState.Placed;
    public SendPayment Handle(OrderConfirmed e) => new SendPayment(e.Amount);
    public void Handle(PaymentReceived e) => State = OrderState.Paid;
}
```

### Design Decisions That Matter
- **Source Generation Over Reflection**: Better performance and AOT
- **Method-Based Handlers**: More natural C# vs interface implementation
- **Return Type Semantics**: Return value determines side effects
- **Built-in Middleware**: Comprehensive pipeline out of the box
- **Message Store Integration**: Persistence is first-class

### When Wolverine Excels
- Greenfield event-driven systems
- Systems requiring durability
- Complex saga orchestration
- Teams wanting conventions
- High-performance scenarios

## MassTransit

### Strengths
- **Battle-Tested**: Years of production use
- **Multi-Transport**: RabbitMQ, Azure Service Bus, Kafka, etc.
- **Sophisticated Routing**: Complex topology support
- **State Machines**: Automatonymous saga implementation
- **Comprehensive Middleware**: Retry, circuit breaker, rate limiting
- **Observability**: OpenTelemetry, metrics, distributed tracing

### What Makes It Great
```csharp
// Consumer with built-in DI
public class OrderConsumer : IConsumer<SubmitOrder> {
    public async Task Consume(ConsumeContext<SubmitOrder> context) {
        // Rich context with headers, correlation, etc.
        await context.RespondAsync(new OrderAccepted {
            OrderId = context.Message.OrderId
        });
        
        // Publish events
        await context.Publish(new OrderSubmitted {
            OrderId = context.Message.OrderId,
            Timestamp = context.SentTime ?? DateTime.UtcNow
        });
    }
}

// Saga state machine with visual flow
public class OrderStateMachine : MassTransitStateMachine<OrderState> {
    public OrderStateMachine() {
        Initially(
            When(OrderSubmitted)
                .Then(context => context.Instance.SubmittedAt = DateTime.UtcNow)
                .TransitionTo(Submitted)
                .Publish(context => new ProcessPayment(context.Instance.OrderId))
        );
        
        During(Submitted,
            When(PaymentProcessed)
                .TransitionTo(Paid)
                .Publish(context => new ShipOrder(context.Instance.OrderId))
        );
    }
}

// Request/Response with timeout
var client = busControl.CreateRequestClient<CheckInventory>();
var response = await client.GetResponse<InventoryStatus>(
    new CheckInventory { ProductId = "ABC123" },
    timeout: TimeSpan.FromSeconds(30)
);
```

### Design Decisions That Matter
- **Transport Abstraction**: Same code works across all transports
- **Consumer Interfaces**: Type-safe message handling
- **Conventional Configuration**: Automatic topology creation
- **Fault Handling**: Dead letter queues and error queues
- **Testing Support**: In-memory test harness

### When MassTransit Excels
- Microservices architectures
- Multi-transport requirements
- Complex routing scenarios
- Enterprise integration
- Teams needing mature tooling

## Brighter

### Strengths
- **Command/Query Processor**: Clear separation of concerns
- **Polly Integration**: First-class resilience policies
- **External Bus Support**: RabbitMQ, Kafka, AWS SNS/SQS
- **Command Sourcing**: Built-in event store support
- **Declarative Policies**: Attribute-based configuration
- **Inbox Pattern**: Idempotency support

### What Makes It Great
```csharp
// Declarative policies via attributes
public class OrderHandler : RequestHandler<PlaceOrder> {
    [UsePolicy(CommandProcessor.RETRYPOLICY, step: 1)]
    [UsePolicy(CommandProcessor.CIRCUITBREAKER, step: 2)]
    public override PlaceOrder Handle(PlaceOrder command) {
        // Automatic retry and circuit breaker
        _repository.Save(new Order(command));
        return base.Handle(command);
    }
}

// Pipeline with middleware
public class ValidationHandler<T> : RequestHandler<T> where T : class, IRequest {
    public override T Handle(T command) {
        var validationResult = _validator.Validate(command);
        if (!validationResult.IsValid) {
            throw new ValidationException(validationResult.Errors);
        }
        return base.Handle(command);
    }
}

// Inbox pattern for idempotency
[Idempotent(timeoutInMilliseconds: 60000)]
public class PaymentHandler : RequestHandler<ProcessPayment> {
    public override ProcessPayment Handle(ProcessPayment command) {
        // Automatically de-duplicated within timeout window
        _paymentService.Process(command.Amount);
        return base.Handle(command);
    }
}
```

### Design Decisions That Matter
- **Policy-Based Resilience**: Declarative error handling
- **Command Sourcing**: Optional event sourcing
- **Explicit Pipeline**: Clear middleware chain
- **Separate Bus Abstraction**: Internal vs external messaging
- **Request/Command Split**: Different patterns for different needs

### When Brighter Excels
- Systems needing resilience policies
- Gradual migration from monolith
- Command sourcing requirements
- AWS-centric architectures
- Teams wanting explicit control

## Rebus

### Strengths
- **Simplicity**: Minimal concepts and abstractions
- **Flexibility**: Pluggable everything
- **Lightweight**: Small footprint
- **Testability**: Excellent testing support
- **Async/Await Native**: Modern async patterns
- **SQL Transport**: Database as message broker

### What Makes It Great
```csharp
// Simple handler interface
public class OrderHandler : IHandleMessages<PlaceOrder> {
    public async Task Handle(PlaceOrder message) {
        // Simple async handling
        await _repository.SaveOrder(message);
        
        // Reply pattern
        await _bus.Reply(new OrderPlaced { OrderId = message.Id });
    }
}

// Routing slip pattern
await _bus.Send(new ProcessOrder {
    RoutingSlip = new[] {
        "validate-queue",
        "payment-queue", 
        "shipping-queue"
    }
});

// Defer messages
await _bus.Defer(TimeSpan.FromMinutes(5), new SendReminder {
    CustomerId = customerId,
    Message = "Your cart is waiting!"
});
```

### Design Decisions That Matter
- **One Handler Interface**: Maximum simplicity
- **Explicit Configuration**: No magic, all visible
- **Transport Flexibility**: From in-memory to cloud
- **Unit of Work**: Transaction management built-in
- **Message Correlation**: Automatic conversation tracking

### When Rebus Excels
- Small to medium projects
- SQL Server environments
- Simple pub/sub needs
- Teams wanting transparency
- Gradual complexity growth

## NServiceBus

### Strengths
- **Enterprise Features**: Monitoring, management tools
- **Message Versioning**: Sophisticated schema evolution
- **Reliability**: Battle-tested in critical systems
- **Saga Persistence**: Multiple storage options
- **Commercial Support**: Professional backing
- **Platform Tools**: ServicePulse, ServiceInsight

### What Makes It Great
```csharp
// Saga with correlation
public class OrderSaga : Saga<OrderSagaData>,
    IAmStartedByMessages<StartOrder>,
    IHandleMessages<PaymentReceived>,
    IHandleMessages<OrderShipped> {
    
    protected override void ConfigureHowToFindSaga(SagaPropertyMapper<OrderSagaData> mapper) {
        mapper.ConfigureMapping<StartOrder>(m => m.OrderId)
            .ToSaga(s => s.OrderId);
    }
    
    public async Task Handle(StartOrder message, IMessageHandlerContext context) {
        Data.OrderId = message.OrderId;
        await RequestTimeout<OrderTimeout>(context, TimeSpan.FromHours(24));
    }
    
    public async Task Timeout(OrderTimeout state, IMessageHandlerContext context) {
        await context.Send(new CancelOrder { OrderId = Data.OrderId });
        MarkAsComplete();
    }
}

// Message versioning
public class OrderV2 : OrderV1 {
    public string AdditionalField { get; set; }
}

// Message mutators for cross-cutting concerns
public class AuditMutator : IMutateIncomingMessages {
    public Task MutateIncoming(MutateIncomingMessageContext context) {
        context.Headers["AuditTimestamp"] = DateTimeOffset.UtcNow.ToString();
        return Task.CompletedTask;
    }
}
```

### Design Decisions That Matter
- **Convention-Based Configuration**: Reduces boilerplate
- **Message Versioning**: Long-term evolution support
- **Distributed Transaction Support**: When you absolutely need it
- **Pipeline Customization**: Extensive hook points
- **Monitoring Integration**: Built for operations teams

### When NServiceBus Excels
- Large enterprise systems
- Regulatory compliance needs
- Complex versioning requirements
- Teams needing commercial support
- Mission-critical systems

## Comparative Analysis

### Abstraction Levels

```
Simple                                                    Complex
   ↓                                                         ↓
MediatR → Rebus → Brighter → Wolverine → MassTransit → NServiceBus
```

### Performance Characteristics

| Library | Overhead | Throughput | Latency | Memory |
|---------|----------|------------|---------|---------|
| MediatR | Minimal | High | Low | Low |
| Wolverine | Low* | Very High | Low | Medium |
| MassTransit | Medium | High | Medium | High |
| Brighter | Low | High | Low | Medium |
| Rebus | Low | High | Low | Low |
| NServiceBus | Medium | High | Medium | High |

*After initial compilation

### Feature Matrix

| Feature | MediatR | Wolverine | MassTransit | Brighter | Rebus | NServiceBus |
|---------|---------|-----------|-------------|----------|-------|-------------|
| In-Process | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Distributed | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Persistence | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Sagas | ❌ | ✅ | ✅ | ⚠️ | ⚠️ | ✅ |
| Event Sourcing | ❌ | ⚠️ | ❌ | ✅ | ❌ | ⚠️ |
| Testing Tools | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Monitoring | ❌ | ✅ | ✅ | ⚠️ | ⚠️ | ✅ |

## Key Insights for Whizbang

### What Makes Each Library Special

1. **MediatR**: Proves that simplicity wins. No framework lock-in.
2. **Wolverine**: Shows that conventions and code generation can eliminate boilerplate.
3. **MassTransit**: Demonstrates the value of comprehensive middleware and routing.
4. **Brighter**: Validates the command processor pattern with explicit pipelines.
5. **Rebus**: Confirms that flexibility and simplicity can coexist.
6. **NServiceBus**: Proves enterprise features and developer experience aren't mutually exclusive.

### Patterns to Embrace

1. **Pipeline/Behavior Pattern** (MediatR, Brighter)
   - Clean way to add cross-cutting concerns
   - Composable and testable

2. **Return Type Semantics** (Wolverine)
   - Return value determines side effects
   - More intuitive than attributes

3. **Consumer Context** (MassTransit)
   - Rich context object with all message metadata
   - Enables sophisticated patterns

4. **Policy Attributes** (Brighter)
   - Declarative resilience configuration
   - Separation of concerns

5. **Transport Abstraction** (MassTransit, Rebus)
   - Same code works in-process or distributed
   - Gradual distribution strategy

### Patterns to Avoid

1. **Too Much Magic** (Early NServiceBus)
   - Hidden behavior confuses developers
   - Explicit is better than implicit

2. **Forced Inheritance** (Some saga implementations)
   - Composition over inheritance
   - Keep handlers simple

3. **Complex Configuration** (Some MassTransit setups)
   - Convention over configuration
   - Progressive disclosure

4. **All-or-Nothing** (Some enterprise buses)
   - Allow incremental adoption
   - Start simple, grow complex

## Recommendations for Whizbang

### Core Design Principles

1. **Start Like MediatR**: Dead simple in-process messaging
2. **Evolve Like Wolverine**: Add durability without changing code
3. **Scale Like MassTransit**: Same patterns work distributed
4. **Configure Like Brighter**: Explicit policies and pipelines
5. **Test Like Rebus**: First-class testing support

### Unique Value Proposition

```csharp
// Whizbang: One model, multiple modes
public class OrderHandler : IHandle<CreateOrder> {
    public OrderCreated Handle(CreateOrder cmd) {
        // This SAME handler works:
        // - In-process (like MediatR)
        // - Durable (like Wolverine)  
        // - Distributed (like MassTransit)
        // - Event-sourced (unique to Whizbang)
        
        return new OrderCreated(cmd.OrderId);
    }
}

// Progressive enhancement via configuration, not code changes
services.AddWhizbang()
    .UseInProcessMode()     // Start here (MediatR-like)
    .UseDurableMode()        // Add persistence (Wolverine-like)
    .UseDistributedMode()    // Scale out (MassTransit-like)
    .UseEventSourcing();     // Full event sourcing (Whizbang special)
```

### The Whizbang Advantage

1. **Unified Mental Model**: Same patterns everywhere
2. **Progressive Complexity**: Start simple, scale gradually
3. **Mode Switching**: Change deployment without changing code
4. **Event Sourcing Native**: Not an afterthought
5. **Performance First**: Code generation like Wolverine
6. **Developer Experience**: Simplicity of MediatR
7. **Enterprise Ready**: Features of NServiceBus

## Conclusion

Each library excels in its niche:
- **MediatR** for simplicity
- **Wolverine** for performance and conventions
- **MassTransit** for distributed systems
- **Brighter** for resilience patterns
- **Rebus** for flexibility
- **NServiceBus** for enterprise

Whizbang can learn from all of them while providing a unique value: one mental model that scales from in-process to distributed to event-sourced without changing your code.