---
title: Transports Component
version: 1.0.0
category: Components
order: 9
description: Basic in-process message transport for local development
tags: 'transports, messaging, in-process, communication, v0.1.0'
---

# Transports Component

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Status](https://img.shields.io/badge/status-stable-green)

## Version History

:::new
**New in v1.0.0**: Basic in-process transport with synchronous message passing
:::


## Overview

Transports provide the communication layer in Whizbang, enabling message exchange between components. In v1.0.0, we provide a simple in-process transport that passes messages directly in memory - perfect for monolithic applications and testing.

## What is a Transport?

A Transport:
- **Carries** messages between components
- **Handles** serialization and deserialization
- **Manages** connections and channels
- **Provides** delivery guarantees

Think of transports as the postal service of your application - they ensure messages get from sender to receiver reliably.

## Core Interface (v1.0.0)

:::new
The basic transport interface for message passing:
:::

```csharp
public interface ITransport {
    // Send a message
    Task<TResponse> Send<TRequest, TResponse>(TRequest request, string destination)
        where TRequest : IMessage
        where TResponse : IMessage;
    
    // Send without response
    Task Publish<TMessage>(TMessage message, string topic)
        where TMessage : IMessage;
    
    // Subscribe to messages
    Task Subscribe<TMessage>(string topic, Func<TMessage, Task> handler)
        where TMessage : IMessage;
    
    // Transport metadata
    string Name { get; }
    TransportCapabilities Capabilities { get; }
}

public enum TransportCapabilities {
    None = 0,
    RequestResponse = 1,
    PublishSubscribe = 2,
    Streaming = 4,
    Reliable = 8,
    Ordered = 16
}
```

## In-Process Transport

:::new
The default in-process transport for v1.0.0:
:::

```csharp
[WhizbangTransport("InProcess")]
public class InProcessTransport : ITransport {
    private readonly Dictionary<string, object> _handlers = new();
    private readonly Dictionary<string, List<Func<object, Task>>> _subscribers = new();
    private readonly object _lock = new();
    
    public string Name => "InProcess";
    public TransportCapabilities Capabilities => 
        TransportCapabilities.RequestResponse | 
        TransportCapabilities.PublishSubscribe |
        TransportCapabilities.Ordered;
    
    // Register a handler for request/response
    public void RegisterHandler<TRequest, TResponse>(
        string destination, 
        Func<TRequest, Task<TResponse>> handler)
        where TRequest : IMessage
        where TResponse : IMessage {
        
        lock (_lock) {
            _handlers[destination] = handler;
        }
    }
    
    public async Task<TResponse> Send<TRequest, TResponse>(
        TRequest request, 
        string destination)
        where TRequest : IMessage
        where TResponse : IMessage {
        
        object handler;
        lock (_lock) {
            if (!_handlers.TryGetValue(destination, out handler!)) {
                throw new TransportException($"No handler registered for {destination}");
            }
        }
        
        var typedHandler = (Func<TRequest, Task<TResponse>>)handler;
        return await typedHandler(request);
    }
    
    public async Task Publish<TMessage>(TMessage message, string topic)
        where TMessage : IMessage {
        
        List<Func<object, Task>> subscribers;
        lock (_lock) {
            if (!_subscribers.TryGetValue(topic, out subscribers!)) {
                return; // No subscribers
            }
            subscribers = subscribers.ToList(); // Copy to avoid lock during execution
        }
        
        // Execute all subscribers
        var tasks = subscribers.Select(sub => sub(message!));
        await Task.WhenAll(tasks);
    }
    
    public Task Subscribe<TMessage>(string topic, Func<TMessage, Task> handler)
        where TMessage : IMessage {
        
        lock (_lock) {
            if (!_subscribers.ContainsKey(topic)) {
                _subscribers[topic] = new List<Func<object, Task>>();
            }
            
            _subscribers[topic].Add(async obj => await handler((TMessage)obj));
        }
        
        return Task.CompletedTask;
    }
}
```

## Message Contracts

:::new
Define messages for transport:
:::

```csharp
public interface IMessage {
    Guid Id { get; }
    DateTimeOffset Timestamp { get; }
    Dictionary<string, string> Headers { get; }
}

public abstract record Message : IMessage {
    public Guid Id { get; init; } = Guid.NewGuid();
    public DateTimeOffset Timestamp { get; init; } = DateTimeOffset.UtcNow;
    public Dictionary<string, string> Headers { get; init; } = new();
}

// Command message
public record CreateOrderCommand : Message {
    public Guid CustomerId { get; init; }
    public List<OrderItem> Items { get; init; }
    public decimal Total { get; init; }
}

// Event message
public record OrderCreatedEvent : Message {
    public Guid OrderId { get; init; }
    public Guid CustomerId { get; init; }
    public OrderStatus Status { get; init; }
}

// Query message
public record GetOrderQuery : Message {
    public Guid OrderId { get; init; }
}

// Response message
public record OrderResponse : Message {
    public Order Order { get; init; }
    public bool Success { get; init; }
    public string? Error { get; init; }
}
```

## Transport Registration

Transports are registered and configured at startup:

```csharp
// Manual registration
services.AddWhizbangTransports(options => {
    options.UseInProcess();
});

// Register handlers
services.AddTransportHandlers(handlers => {
    handlers.Handle<CreateOrderCommand, OrderCreatedEvent>("orders", 
        async cmd => {
            // Process command
            return new OrderCreatedEvent { 
                OrderId = Guid.NewGuid(),
                CustomerId = cmd.CustomerId 
            };
        });
});

// Source generated registration
public static partial class WhizbangGenerated {
    public static void RegisterTransports(IServiceCollection services) {
        services.AddSingleton<ITransport, InProcessTransport>();
        
        // Auto-discover and register handlers
        services.AddScoped<IHandler<CreateOrderCommand>, CreateOrderHandler>();
    }
}
```

## Using Transports

### In Receptors

```csharp
public class OrderReceptor : IReceptor<CreateOrder> {
    private readonly ITransport _transport;
    
    public OrderReceptor(ITransport transport) {
        _transport = transport;
    }
    
    public async Task<OrderCreated> Receive(CreateOrder cmd) {
        // Validate locally
        if (!IsValid(cmd)) {
            throw new ValidationException("Invalid order");
        }
        
        // Send to inventory service (in-process for now)
        var inventoryCommand = new CheckInventoryCommand {
            Items = cmd.Items
        };
        
        var inventoryResponse = await _transport.Send<CheckInventoryCommand, InventoryResponse>(
            inventoryCommand, 
            "inventory"
        );
        
        if (!inventoryResponse.Available) {
            throw new InsufficientInventoryException();
        }
        
        // Create order
        var orderCreated = new OrderCreated {
            OrderId = Guid.NewGuid(),
            CustomerId = cmd.CustomerId,
            Items = cmd.Items
        };
        
        // Publish event
        await _transport.Publish(orderCreated, "orders.created");
        
        return orderCreated;
    }
}
```

### Event Subscriptions

```csharp
public class NotificationService {
    private readonly ITransport _transport;
    
    public async Task Start() {
        // Subscribe to order events
        await _transport.Subscribe<OrderCreatedEvent>(
            "orders.created",
            HandleOrderCreated
        );
        
        await _transport.Subscribe<OrderShippedEvent>(
            "orders.shipped",
            HandleOrderShipped
        );
    }
    
    private async Task HandleOrderCreated(OrderCreatedEvent evt) {
        // Send confirmation email
        await SendEmail(evt.CustomerId, "Order Confirmed", 
            $"Your order {evt.OrderId} has been confirmed.");
    }
    
    private async Task HandleOrderShipped(OrderShippedEvent evt) {
        // Send shipping notification
        await SendEmail(evt.CustomerId, "Order Shipped",
            $"Your order {evt.OrderId} has been shipped!");
    }
}
```

## Message Pipeline

:::new
Simple message pipeline for v1.0.0:
:::

```csharp
public interface IMessagePipeline {
    Task<TResponse> Process<TRequest, TResponse>(
        TRequest request,
        Func<TRequest, Task<TResponse>> next);
}

public class MessagePipeline : IMessagePipeline {
    private readonly List<IMessageMiddleware> _middleware = new();
    
    public void Use(IMessageMiddleware middleware) {
        _middleware.Add(middleware);
    }
    
    public async Task<TResponse> Process<TRequest, TResponse>(
        TRequest request,
        Func<TRequest, Task<TResponse>> handler) {
        
        // Build pipeline
        Func<TRequest, Task<TResponse>> pipeline = handler;
        
        foreach (var middleware in _middleware.Reverse<IMessageMiddleware>()) {
            var next = pipeline;
            pipeline = async req => await middleware.Process(req, () => next(req));
        }
        
        return await pipeline(request);
    }
}

// Example middleware
public class LoggingMiddleware : IMessageMiddleware {
    private readonly ILogger _logger;
    
    public async Task<object> Process(object message, Func<Task<object>> next) {
        _logger.LogInformation("Processing {MessageType}", message.GetType().Name);
        var start = Stopwatch.StartNew();
        
        try {
            var result = await next();
            _logger.LogInformation("Processed in {ElapsedMs}ms", start.ElapsedMilliseconds);
            return result;
        }
        catch (Exception ex) {
            _logger.LogError(ex, "Failed after {ElapsedMs}ms", start.ElapsedMilliseconds);
            throw;
        }
    }
}
```

## Testing with Transports

```csharp
[Test]
public class TransportTests {
    private InProcessTransport _transport;
    
    [SetUp]
    public void Setup() {
        _transport = new InProcessTransport();
    }
    
    [Test]
    public async Task Send_ShouldInvokeHandler() {
        // Arrange
        var handlerCalled = false;
        _transport.RegisterHandler<TestCommand, TestResponse>(
            "test",
            async cmd => {
                handlerCalled = true;
                return new TestResponse { Success = true };
            }
        );
        
        // Act
        var response = await _transport.Send<TestCommand, TestResponse>(
            new TestCommand(),
            "test"
        );
        
        // Assert
        Assert.True(handlerCalled);
        Assert.True(response.Success);
    }
    
    [Test]
    public async Task Publish_ShouldNotifyAllSubscribers() {
        // Arrange
        var received1 = false;
        var received2 = false;
        
        await _transport.Subscribe<TestEvent>("test.topic", evt => {
            received1 = true;
            return Task.CompletedTask;
        });
        
        await _transport.Subscribe<TestEvent>("test.topic", evt => {
            received2 = true;
            return Task.CompletedTask;
        });
        
        // Act
        await _transport.Publish(new TestEvent(), "test.topic");
        
        // Assert
        Assert.True(received1);
        Assert.True(received2);
    }
}
```

## IDE Features

```csharp
// IDE shows: "Transport: InProcess | Handlers: 12 | Subscribers: 34"
public interface ITransport { }

// IDE shows: "Called 234 times | Avg: 0.5ms | Success: 99.8%"
public Task<TResponse> Send<TRequest, TResponse>(...) { }

// IDE shows: "Topic: orders.created | Subscribers: 3"
public Task Publish<TMessage>(TMessage message, string topic) { }
```

## Performance Characteristics

| Operation | Target | Actual |
|-----------|--------|--------|
| Send (in-process) | < 100ns | TBD |
| Publish (10 subscribers) | < 1μs | TBD |
| Subscribe | < 50ns | TBD |
| Message serialization | N/A | N/A |

## Limitations in v1.0.0

:::info
These limitations are addressed in future versions:
:::

- **In-process only** - No network communication
- **No persistence** - Messages lost on crash
- **No serialization** - Direct object passing
- **No retry** - Failed messages are lost
- **Single instance** - No distributed messaging

## Migration Path

### To v0.2.0 (HTTP/WebSocket)

:::planned
v0.2.0 adds network transports:
:::

```csharp
// v0.2.0 - HTTP transport
services.AddWhizbangTransports(options => {
    options.UseHttp(http => {
        http.BaseUrl = "https://api.example.com";
        http.Timeout = TimeSpan.FromSeconds(30);
    });
});
```

### To v0.3.0 (Message Queues)

:::planned
v0.3.0 adds message queue support:
:::

```csharp
// v0.3.0 - RabbitMQ transport
services.AddWhizbangTransports(options => {
    options.UseRabbitMQ(rabbit => {
        rabbit.ConnectionString = "amqp://localhost";
        rabbit.ExchangeName = "whizbang";
    });
});
```

## Best Practices

1. **Design for distribution** - Even with in-process, assume network
2. **Use message contracts** - Define clear message schemas
3. **Handle failures** - Plan for transport failures
4. **Version messages** - Plan for message evolution
5. **Keep messages small** - Large messages impact performance
6. **Test with different transports** - Ensure transport agnostic code

## Related Documentation

- [Dispatcher](dispatcher.md) - How messages are routed
- [Receptors](receptors.md) - Message handlers
- [Testing](../testing/foundation.md) - Testing with transports
- [Feature Evolution](../../roadmap/FEATURE-EVOLUTION.md) - How transports evolve

## Next Steps

- See [v0.2.0 HTTP Transport](../../v0.2.0/enhancements/transports.md) for REST APIs
- See [v0.3.0 Message Queues](../../v0.3.0/features/transports.md) for async messaging
- Review [Examples](../examples/messaging-patterns.md) for transport patterns
