---
title: Dispatcher Component
version: 1.0.0
category: Components
order: 2
description: Core message routing and orchestration with basic handler discovery
tags: 'dispatcher, routing, orchestration, mediator, v0.1.0'
---

# Dispatcher Component

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Status](https://img.shields.io/badge/status-stable-green)

## Version History

:::new
**New in v1.0.0**: Basic message dispatcher with handler discovery and in-process routing
:::


## Overview

The Dispatcher is the heart of Whizbang - it routes messages to handlers, orchestrates component interactions, and ensures proper execution flow. In v1.0.0, it provides basic handler discovery and routing with support for commands, events, and queries.

## What is a Dispatcher?

A Dispatcher:
- **Routes** messages to appropriate handlers
- **Orchestrates** component interactions
- **Manages** execution flow and dependencies
- **Coordinates** between receptors, perspectives, and lenses

Think of the dispatcher as the conductor of an orchestra - it ensures each component plays its part at the right time.

## Core Interface (v1.0.0)

:::new
The fundamental dispatcher interface with three distinct patterns:
:::

```csharp
public interface IDispatcher {
    // Send command - returns delivery receipt (can work over wire)
    Task<IDeliveryReceipt> SendAsync(object message);
    Task<IDeliveryReceipt> SendAsync(object message, IMessageContext context);

    // Local invocation - returns typed result (in-process only, zero allocation)
    Task<TResult> LocalInvokeAsync<TResult>(object message);
    Task<TResult> LocalInvokeAsync<TResult>(object message, IMessageContext context);

    // Publish event to all interested perspectives (fire-and-forget)
    Task PublishAsync<TEvent>(TEvent @event);

    // Batch operations
    Task<IEnumerable<IDeliveryReceipt>> SendManyAsync(IEnumerable<object> messages);
    Task<IEnumerable<TResult>> LocalInvokeManyAsync<TResult>(IEnumerable<object> messages);
}
```

## Three Dispatch Patterns

### SendAsync - Command Dispatch with Acknowledgment

**Use when**: Sending commands that may execute remotely or asynchronously

```csharp
// Returns delivery receipt, not business result
var receipt = await dispatcher.SendAsync(new ProcessOrder(orderId));

// Receipt contains delivery metadata
Console.WriteLine($"Message {receipt.MessageId} delivered at {receipt.Timestamp}");
Console.WriteLine($"Status: {receipt.Status}"); // Accepted, Queued, Delivered
```

**Characteristics**:
- Returns `IDeliveryReceipt` with correlation info
- Can work over network transports (future versions)
- Supports inbox pattern and async workflows
- Includes full observability envelope

### LocalInvokeAsync - In-Process RPC

**Use when**: Calling handlers within the same process and need the business result immediately

```csharp
// Returns typed business result
var result = await dispatcher.LocalInvokeAsync<OrderCreated>(new CreateOrder(items));

// Access business data directly
Console.WriteLine($"Order created: {result.OrderId}");
```

**Characteristics**:
- Returns strongly-typed business result
- **In-process only** - throws if used with remote transport
- **Zero allocation** - skips envelope creation for maximum performance
- Target: < 20ns per invocation, 0 bytes allocated
- Ideal for high-throughput local workflows

### PublishAsync - Event Broadcasting

**Use when**: Notifying multiple handlers about an event

```csharp
// Fire-and-forget to all subscribers
await dispatcher.PublishAsync(new OrderPlaced(orderId));

// All perspectives receive the event
// - OrderPerspective updates order view
// - InventoryPerspective reserves items
// - NotificationPerspective sends email
```

**Characteristics**:
- Fire-and-forget semantics
- No return value
- Fans out to all registered handlers
- Handlers execute independently

## When To Use Which Pattern

| Pattern | Use Case | Returns | Can Go Over Wire | Performance Target |
|---------|----------|---------|------------------|-------------------|
| **SendAsync** | Async workflows, remote execution, inbox pattern | Delivery receipt | ✅ Yes (future) | Normal |
| **LocalInvokeAsync** | High-throughput local calls, immediate results | Business result | ❌ No | < 20ns, 0B |
| **PublishAsync** | Event notification, fan-out | void | ✅ Yes (future) | Normal |

## Delivery Receipt

The `IDeliveryReceipt` provides correlation and tracking information:

```csharp
public interface IDeliveryReceipt {
    MessageId MessageId { get; }         // Unique message identifier
    DateTimeOffset Timestamp { get; }     // When message was accepted
    string Destination { get; }           // Where message was routed
    DeliveryStatus Status { get; }        // Accepted, Queued, Delivered
    IReadOnlyDictionary<string, object> Metadata { get; } // Extensible data
}

public enum DeliveryStatus {
    Accepted,   // Message accepted by dispatcher
    Queued,     // Message queued for async processing
    Delivered   // Message delivered to handler
}
```

## Pipeline Behaviors

:::new
v1.0.0 introduces pipeline behavior support for cross-cutting concerns:
:::

Pipeline behaviors allow you to inject middleware-style logic into the dispatch flow. Common use cases include:
- **Inbox Pattern** - De-duplicate messages, ensure idempotency
- **Validation** - Validate commands before execution
- **Logging** - Log all messages and results
- **Retry Logic** - Automatically retry failed operations
- **Performance Monitoring** - Track execution times
- **Transaction Management** - Wrap execution in transactions

### IPipelineBehavior Interface

```csharp
public interface IPipelineBehavior<TRequest, TResponse> {
    /// <summary>
    /// Execute behavior and optionally call next in pipeline
    /// </summary>
    /// <param name="request">The message being dispatched</param>
    /// <param name="next">Delegate to invoke next behavior or handler</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>The response (potentially modified)</returns>
    Task<TResponse> Handle(
        TRequest request,
        Func<Task<TResponse>> next,
        CancellationToken cancellationToken = default
    );
}
```

### Example: Inbox Pattern Behavior

```csharp
public class InboxBehavior<TRequest, TResponse> : IPipelineBehavior<TRequest, TResponse> {
    private readonly IInboxStore _inbox;

    public async Task<TResponse> Handle(
        TRequest request,
        Func<Task<TResponse>> next,
        CancellationToken cancellationToken
    ) {
        var messageId = GetMessageId(request);

        // Check if already processed
        if (await _inbox.HasProcessedAsync(messageId)) {
            return await _inbox.GetResultAsync<TResponse>(messageId);
        }

        // Mark as processing
        await _inbox.MarkProcessingAsync(messageId);

        try {
            // Execute handler
            var response = await next();

            // Store result
            await _inbox.StoreResultAsync(messageId, response);

            return response;
        } catch (Exception ex) {
            await _inbox.MarkFailedAsync(messageId, ex);
            throw;
        }
    }
}
```

### Example: Validation Behavior

```csharp
public class ValidationBehavior<TRequest, TResponse> : IPipelineBehavior<TRequest, TResponse> {
    private readonly IValidator<TRequest> _validator;

    public async Task<TResponse> Handle(
        TRequest request,
        Func<Task<TResponse>> next,
        CancellationToken cancellationToken
    ) {
        // Validate request
        var validationResult = await _validator.ValidateAsync(request);

        if (!validationResult.IsValid) {
            throw new ValidationException(validationResult.Errors);
        }

        // Continue pipeline
        return await next();
    }
}
```

### Example: Logging Behavior

```csharp
public class LoggingBehavior<TRequest, TResponse> : IPipelineBehavior<TRequest, TResponse> {
    private readonly ILogger _logger;

    public async Task<TResponse> Handle(
        TRequest request,
        Func<Task<TResponse>> next,
        CancellationToken cancellationToken
    ) {
        var requestName = typeof(TRequest).Name;
        _logger.LogInformation("Handling {Request}", requestName);

        var stopwatch = Stopwatch.StartNew();

        try {
            var response = await next();

            stopwatch.Stop();
            _logger.LogInformation(
                "Handled {Request} in {Elapsed}ms",
                requestName,
                stopwatch.ElapsedMilliseconds
            );

            return response;
        } catch (Exception ex) {
            stopwatch.Stop();
            _logger.LogError(
                ex,
                "Error handling {Request} after {Elapsed}ms",
                requestName,
                stopwatch.ElapsedMilliseconds
            );
            throw;
        }
    }
}
```

### Registering Behaviors

```csharp
services.AddWhizbangDispatcher(dispatcher => {
    // Behaviors execute in registration order
    dispatcher.AddPipelineBehavior<InboxBehavior<,>>();
    dispatcher.AddPipelineBehavior<ValidationBehavior<,>>();
    dispatcher.AddPipelineBehavior<LoggingBehavior<,>>();
});
```

### Performance Considerations

Pipeline behaviors add overhead to each dispatch:
- **Target**: < 5% overhead per behavior
- **Recommendation**: Keep behaviors lightweight
- **Optimization**: Use struct-based behaviors where possible
- **Monitoring**: Track behavior execution times

## In-Memory Implementation

```csharp
public class InMemoryDispatcher : IDispatcher {
    private readonly Dictionary<Type, Delegate> _handlers;
    private readonly Dictionary<Type, List<Delegate>> _eventHandlers;
    private readonly IServiceProvider _serviceProvider;
    
    public InMemoryDispatcher(IServiceProvider serviceProvider) {
        _serviceProvider = serviceProvider;
        _handlers = WhizbangGenerated.GetCommandHandlers();  // Source-generated
        _eventHandlers = WhizbangGenerated.GetEventHandlers();  // Source-generated
    }
    
    public async Task<TResult> Send<TResult>(ICommand<TResult> command) {
        var commandType = command.GetType();
        
        if (!_handlers.TryGetValue(commandType, out var handler)) {
            throw new HandlerNotFoundException(commandType);
        }
        
        // Apply policies (generated code handles this)
        var receptor = _serviceProvider.GetRequiredService(handler.Method.DeclaringType);
        var result = await handler.DynamicInvoke(receptor, command);
        
        // If result is an event, publish it
        if (result is IEvent @event) {
            await Publish(@event);
        }
        
        return (TResult)result;
    }
    
    public async Task Publish<TEvent>(TEvent @event) {
        var eventType = @event.GetType();
        
        if (_eventHandlers.TryGetValue(eventType, out var handlers)) {
            var tasks = handlers.Select(async handler => {
                var perspective = _serviceProvider.GetRequiredService(handler.Method.DeclaringType);
                await handler.DynamicInvoke(perspective, @event);
            });
            
            await Task.WhenAll(tasks);
        }
    }
    
    public TLens GetLens<TLens>() where TLens : ILens {
        return _serviceProvider.GetRequiredService<TLens>();
    }
}
```

## Source-Generated Routing

The source generator creates efficient routing tables:

```csharp
// Generated by Whizbang.Generators
public static partial class WhizbangGenerated {
    public static Dictionary<Type, Delegate> GetCommandHandlers() {
        return new Dictionary<Type, Delegate> {
            [typeof(CreateOrder)] = (Func<OrderReceptor, CreateOrder, Task<OrderCreated>>)
                ((receptor, cmd) => receptor.Receive(cmd)),
                
            [typeof(CancelOrder)] = (Func<OrderReceptor, CancelOrder, Task<OrderCancelled>>)
                ((receptor, cmd) => receptor.Cancel(cmd)),
                
            // ... all discovered handlers
        };
    }
    
    public static Dictionary<Type, List<Delegate>> GetEventHandlers() {
        return new Dictionary<Type, List<Delegate>> {
            [typeof(OrderCreated)] = new List<Delegate> {
                (Func<OrderPerspective, OrderCreated, Task>)
                    ((perspective, e) => perspective.Update(e)),
                    
                (Func<InventoryPerspective, OrderCreated, Task>)
                    ((perspective, e) => perspective.Update(e)),
            },
            
            // ... all discovered event handlers
        };
    }
}
```

## Message Context

Every message carries context for traceability:

```csharp
public class MessageContext : IMessageContext {
    public Guid MessageId { get; init; } = Guid.NewGuid();
    public Guid CorrelationId { get; init; }
    public Guid CausationId { get; init; }
    public DateTimeOffset Timestamp { get; init; } = DateTimeOffset.UtcNow();
    public string UserId { get; init; }
    public Dictionary<string, object> Metadata { get; init; } = new();
    public ISpan? Span { get; init; }  // OpenTelemetry span
}
```

## Policy Application

The dispatcher applies policies through generated decorators:

```csharp
// Source-generated decorator for policies
public class PolicyAwareDispatcher : IDispatcher {
    private readonly IDispatcher _inner;
    private readonly IPolicyEngine _policies;
    
    public async Task<TResult> Send<TResult>(ICommand<TResult> command) {
        // Get policies for this command type (compile-time determined)
        var policies = WhizbangGenerated.GetPoliciesFor(command.GetType());
        
        // Apply policies in order
        return await _policies.Execute(policies, async () => {
            return await _inner.Send(command);
        });
    }
}
```

## Traceability Integration

The dispatcher provides hooks for traceability:

```csharp
public class TraceableDispatcher : IDispatcher {
    private readonly IDispatcher _inner;
    private readonly ITraceabilityService _traceability;
    
    public async Task<TResult> Send<TResult>(ICommand<TResult> command) {
        var span = _traceability.StartSpan($"Send {command.GetType().Name}");
        
        try {
            var result = await _inner.Send(command);
            
            _traceability.RecordSuccess(span, command, result);
            
            // Update IDE overlay
            _traceability.UpdateOverlay(command.GetType(), result?.GetType());
            
            return result;
        }
        catch (Exception ex) {
            _traceability.RecordError(span, command, ex);
            throw;
        }
        finally {
            span.End();
        }
    }
}
```

## Error Handling

The dispatcher provides comprehensive error information:

```csharp
public class HandlerNotFoundException : Exception {
    public Type CommandType { get; }
    
    public HandlerNotFoundException(Type commandType) 
        : base(FormatMessage(commandType)) {
        CommandType = commandType;
    }
    
    private static string FormatMessage(Type commandType) {
        return $@"
No handler found for command '{commandType.Name}'.

To fix this:
1. Create a receptor that implements IReceptor<{commandType.Name}>
2. Add the [WhizbangHandler] attribute to the receptor
3. Ensure the receptor is in a scanned assembly

Example:
[WhizbangHandler]
public class {commandType.Name.Replace("Command", "")}Receptor : IReceptor<{commandType.Name}, {commandType.Name.Replace("Command", "")}Result> {{
    public async Task<{commandType.Name.Replace("Command", "")}Result> Receive({commandType.Name} command) {{
        // Handle command
    }}
}}

Quick Fix: Press Ctrl+. to generate the handler automatically.
";
    }
}
```

## Configuration

```csharp
public class DispatcherOptions {
    /// <summary>
    /// Maximum time to wait for a handler (milliseconds)
    /// </summary>
    public int DefaultTimeout { get; set; } = 30000;
    
    /// <summary>
    /// Enable parallel event publishing
    /// </summary>
    public bool ParallelEventPublishing { get; set; } = true;
    
    /// <summary>
    /// Maximum degree of parallelism for events
    /// </summary>
    public int MaxEventParallelism { get; set; } = 10;
    
    /// <summary>
    /// Enable traceability hooks
    /// </summary>
    public bool EnableTraceability { get; set; } = true;
    
    /// <summary>
    /// Record performance metrics
    /// </summary>
    public bool EnableMetrics { get; set; } = true;
}
```

## Testing

```csharp
[Test]
public class DispatcherTests {
    private IDispatcher _dispatcher;
    
    [SetUp]
    public void Setup() {
        var services = new ServiceCollection();
        services.AddWhizbang(o => o.UseInMemory());
        
        var provider = services.BuildServiceProvider();
        _dispatcher = provider.GetRequiredService<IDispatcher>();
    }
    
    [Test]
    public async Task Send_Command_Should_Return_Result() {
        // Arrange
        var command = new CreateOrder(
            CustomerId: Guid.NewGuid(),
            Items: new[] { new OrderItem("SKU-001", 2, 29.99m) }
        );
        
        // Act
        var result = await _dispatcher.Send(command);
        
        // Assert
        Assert.IsType<OrderCreated>(result);
        Assert.NotEqual(Guid.Empty, result.OrderId);
    }
    
    [Test]
    public async Task Publish_Event_Should_Notify_All_Perspectives() {
        // Arrange
        var @event = new OrderCreated(Guid.NewGuid(), Guid.NewGuid());
        var notificationCount = 0;
        
        // Subscribe to notifications
        _dispatcher.Subscribe<OrderCreated>(e => {
            notificationCount++;
            return Task.CompletedTask;
        });
        
        // Act
        await _dispatcher.Publish(@event);
        
        // Assert
        Assert.Greater(notificationCount, 0);
    }
}
```

## Performance Characteristics

| Operation | Target | Actual (v1.0.0) |
|-----------|--------|-----------------|
| Command Routing | < 100ns | TBD |
| Event Publishing (1 handler) | < 1μs | TBD |
| Event Publishing (10 handlers) | < 10μs | TBD |
| Context Creation | < 50ns | TBD |
| Policy Application | < 1μs per policy | TBD |

## IDE Integration

The dispatcher provides real-time information to the IDE:

```csharp
// IDE shows: "5 commands routed | 23 events published | Last: 2ms ago"
public interface IDispatcher { }

// IDE shows: "Routed 15 times | Avg: 1.2ms | Last: CreateOrder"
public async Task<TResult> Send<TResult>(ICommand<TResult> command);
```

## Limitations in v1.0.0

:::info
These limitations are addressed in future versions:
:::

- **No middleware** - Cannot inject cross-cutting concerns
- **Sequential execution** - Perspectives run one at a time
- **No saga support** - Cannot coordinate multi-step workflows
- **No retry logic** - Failed operations aren't retried
- **Single instance** - No distributed coordination

## Migration Path

### To v0.2.0 (Pipeline & Middleware)

:::planned
v0.2.0 adds pipeline processing:
:::

```csharp
// v0.2.0 - Middleware pipeline
services.AddWhizbangDispatcher(dispatcher => {
    dispatcher.AddMiddleware<LoggingMiddleware>();
    dispatcher.AddMiddleware<ValidationMiddleware>();
    dispatcher.AddMiddleware<MetricsMiddleware>();
});
```

### To v0.3.0 (Saga Orchestration)

:::planned
v0.3.0 adds workflow support:
:::

```csharp
// v0.3.0 - Saga orchestration
public class OrderSaga : ISaga<CreateOrder> {
    public async Task<SagaResult> Execute(CreateOrder command) {
        // Multi-step workflow with compensation
    }
}
```

## Best Practices

1. **Keep dispatcher thin** - Logic belongs in handlers, not dispatcher
2. **Handle errors gracefully** - Don't let one perspective failure break all
3. **Use dependency injection** - Let DI container manage lifetimes
4. **Monitor performance** - Track dispatch times and success rates
5. **Test handler discovery** - Ensure all handlers are registered
6. **Design for async** - All operations should be async

## Related Documentation

- [Receptors](receptors.md) - Command handlers
- [Perspectives](perspectives.md) - Event handlers
- [Lenses](lenses.md) - Query handlers
- [Ledger](ledger.md) - Event storage
- [Feature Evolution](../../roadmap/FEATURE-EVOLUTION.md) - How dispatcher evolves

## Next Steps

- See [v0.2.0 Pipeline](../../v0.2.0/enhancements/dispatcher.md) for middleware support
- See [v0.3.0 Orchestration](../../v0.3.0/features/dispatcher.md) for saga patterns
- Review [Examples](../examples/dispatcher-patterns.md) for usage patterns
