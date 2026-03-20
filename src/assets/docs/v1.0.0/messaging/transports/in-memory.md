---
title: In-Memory Transport
version: 1.0.0
category: Transports
order: 2
description: >-
  Synchronous in-process message delivery for testing and single-process
  scenarios - zero external dependencies
tags: >-
  transports, in-memory, testing, in-process, synchronous, pub-sub,
  request-response
codeReferences:
  - src/Whizbang.Core/Transports/InProcessTransport.cs
  - tests/Whizbang.Transports.Tests/InProcessTransportTests.cs
---

# In-Memory Transport

The **In-Memory transport** provides synchronous, in-process message delivery without external dependencies. This transport is ideal for testing, development, and single-process applications where cross-process communication isn't needed.

## Why In-Memory Transport?

**In-Memory** offers simplicity and speed for local scenarios:

| Feature | Description | Benefit |
|---------|-------------|---------|
| **Zero Dependencies** | No external infrastructure | Simple setup |
| **Synchronous Delivery** | Messages delivered immediately | Predictable testing |
| **Thread-Safe** | Concurrent publish/subscribe | Multi-threaded safety |
| **Full Capabilities** | Pub/sub + request/response | Complete feature set |
| **Instant Initialization** | No network checks | Fast startup |
| **Subscription Lifecycle** | Pause/resume/dispose | Fine-grained control |

**Use Cases**:
- ✅ **Unit Testing** - Test receptors without external infrastructure
- ✅ **Integration Testing** - Test message flows in-process
- ✅ **Single-Process Apps** - Modular applications without distributed messaging
- ✅ **Local Development** - No need for Service Bus/RabbitMQ during development
- ✅ **Prototyping** - Quick experimentation with messaging patterns

---

## Architecture

### Synchronous Delivery Model

```
┌─────────────────────────────────────────────────────────┐
│  InProcessTransport                                     │
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │  Subscriptions Dictionary                      │    │
│  │                                                 │    │
│  │  "orders" → [Handler1, Handler2]               │    │
│  │  "payments" → [Handler3]                       │    │
│  │  "notifications" → [Handler4, Handler5]        │    │
│  └────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘

Publisher                                      Subscriber
  │                                                │
  │ 1. PublishAsync(envelope, destination)        │
  │    Destination: "orders"                       │
  ▼                                                │
┌──────────────────────────────────┐              │
│  Lookup subscriptions["orders"]  │              │
└──────────────────────────────────┘              │
  │                                                │
  │ 2. Foreach handler in subscriptions           │
  │    → Await handler(envelope)                  │
  ▼                                                ▼
┌──────────────────────────────────┐    ┌──────────────────┐
│  Handler1(envelope)              │───▶│  Process message │
└──────────────────────────────────┘    └──────────────────┘
  │                                                │
  │ 3. Sequential execution                       │
  ▼                                                │
┌──────────────────────────────────┐    ┌──────────────────┐
│  Handler2(envelope)              │───▶│  Process message │
└──────────────────────────────────┘    └──────────────────┘
  │
  │ 4. PublishAsync completes after ALL handlers
  ▼
```

**Key Characteristics**:
- **Synchronous**: `PublishAsync` awaits all handlers before returning
- **Ordered**: Handlers invoked in subscription order
- **Thread-Safe**: Uses `ConcurrentDictionary` and locking
- **No Retry**: Exceptions propagate to publisher

---

## Configuration

### 1. Register Transport (Built-In)

```csharp{title="Register Transport (Built-In)" description="Demonstrates register Transport (Built-In)" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Register", "Transport"]}
using Whizbang.Core.Transports;

var builder = WebApplication.CreateBuilder(args);

// In-memory transport is part of Whizbang.Core - no separate package needed
builder.Services.AddSingleton<ITransport, InProcessTransport>();

var app = builder.Build();
app.Run();
```

**Note**: No additional configuration needed - transport is ready immediately.

### 2. Initialization

```csharp{title="Initialization" description="Demonstrates initialization" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Initialization"]}
var transport = new InProcessTransport();
await transport.InitializeAsync();  // Returns immediately (idempotent)

// IsInitialized is true immediately
Console.WriteLine(transport.IsInitialized);  // True
```

---

## Usage Patterns

### Publish/Subscribe

```csharp{title="Publish/Subscribe" description="Demonstrates publish/Subscribe" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Publish", "Subscribe"]}
using Whizbang.Core.Transports;

var transport = new InProcessTransport();

// Subscribe to messages
var subscription = await transport.SubscribeAsync(
  handler: async (envelope, ct) => {
    Console.WriteLine($"Received: {envelope.MessageId}");
    await ProcessMessageAsync(envelope);
  },
  destination: new TransportDestination("orders")
);

// Publish message
var envelope = MessageEnvelope.Create(
  messageId: MessageId.New(),
  correlationId: CorrelationId.New(),
  causationId: null,
  payload: new OrderCreated(orderId, customerId, total),
  currentHop: new MessageHop { Timestamp = DateTimeOffset.UtcNow }
);

await transport.PublishAsync(
  envelope,
  new TransportDestination("orders")
);

// Handler invoked synchronously before PublishAsync returns
```

### Multiple Subscribers

```csharp{title="Multiple Subscribers" description="Demonstrates multiple Subscribers" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Multiple", "Subscribers"]}
// Multiple subscribers receive the same message
await transport.SubscribeAsync(
  handler: async (envelope, ct) => {
    // Update read model
    await _perspectiveStore.UpdateAsync(envelope.Payload);
  },
  destination: new TransportDestination("orders")
);

await transport.SubscribeAsync(
  handler: async (envelope, ct) => {
    // Send notification
    await _emailService.SendOrderConfirmationAsync(envelope.Payload);
  },
  destination: new TransportDestination("orders")
);

// Publish - both handlers invoked sequentially
await transport.PublishAsync(envelope, new TransportDestination("orders"));
```

### Request/Response Pattern

```csharp{title="Request/Response Pattern" description="Demonstrates request/Response Pattern" category="Configuration" difficulty="ADVANCED" tags=["Messaging", "Transports", "Request", "Response"]}
// Setup responder
await transport.SubscribeAsync(
  handler: async (requestEnvelope, ct) => {
    // Process request
    var response = ProcessOrder(requestEnvelope.Payload);

    // Send response to response destination
    var responseEnvelope = MessageEnvelope.Create(
      messageId: MessageId.New(),
      correlationId: requestEnvelope.GetCorrelationId(),
      causationId: requestEnvelope.MessageId,
      payload: response,
      currentHop: new MessageHop { Timestamp = DateTimeOffset.UtcNow }
    );

    var responseDest = new TransportDestination($"response-{requestEnvelope.MessageId.Value}");
    await transport.PublishAsync(responseEnvelope, responseDest, ct);
  },
  destination: new TransportDestination("order-service")
);

// Send request and wait for response
var requestEnvelope = MessageEnvelope.Create(
  messageId: MessageId.New(),
  correlationId: CorrelationId.New(),
  causationId: null,
  payload: new CreateOrder(items),
  currentHop: new MessageHop { Timestamp = DateTimeOffset.UtcNow }
);

var responseEnvelope = await transport.SendAsync<CreateOrder, OrderCreated>(
  requestEnvelope,
  new TransportDestination("order-service")
);

Console.WriteLine($"Order created: {responseEnvelope.Payload}");
```

**How SendAsync Works**:
1. Creates temporary response destination: `response-{messageId}`
2. Subscribes to response destination
3. Publishes request to target destination
4. Waits for response (via `TaskCompletionSource`)
5. Cleans up response subscription (in finally block)

---

## Subscription Lifecycle

### Pause and Resume

```csharp{title="Pause and Resume" description="Demonstrates pause and Resume" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Pause", "Resume"]}
var subscription = await transport.SubscribeAsync(
  handler: async (envelope, ct) => {
    await ProcessAsync(envelope);
  },
  destination: new TransportDestination("orders")
);

// Pause subscription - handler won't be invoked
await subscription.PauseAsync();
Console.WriteLine(subscription.IsActive);  // False

await transport.PublishAsync(envelope, destination);  // Handler NOT invoked

// Resume subscription
await subscription.ResumeAsync();
Console.WriteLine(subscription.IsActive);  // True

await transport.PublishAsync(envelope, destination);  // Handler invoked
```

**Use Cases**:
- Temporarily stop processing during maintenance
- Rate limiting or backpressure handling
- Graceful shutdown (pause before disposing)

### Dispose

```csharp{title="Dispose" description="Demonstrates dispose" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Dispose"]}
// Remove subscription entirely
subscription.Dispose();

// Handler removed from transport
await transport.PublishAsync(envelope, destination);  // Handler NOT invoked

// Dispose is idempotent
subscription.Dispose();  // Safe to call multiple times
```

---

## Transport Capabilities

The in-memory transport declares these capabilities:

```csharp{title="Transport Capabilities" description="The in-memory transport declares these capabilities:" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Transport", "Capabilities"]}
TransportCapabilities.RequestResponse |   // ✅ SendAsync support
TransportCapabilities.PublishSubscribe |  // ✅ PublishAsync/SubscribeAsync
TransportCapabilities.Ordered |           // ✅ Sequential handler execution
TransportCapabilities.Reliable            // ✅ Direct invocation (no network failures)
```

**Not Supported**:
- ❌ `ExactlyOnce` - Handlers invoked for each publish (no deduplication)
- ❌ `Streaming` - Not applicable to in-memory

**Reliability Note**: "Reliable" means messages won't be lost due to network failures, but exceptions in handlers propagate to publisher.

---

## Thread Safety

### Concurrent Publishes

```csharp{title="Concurrent Publishes" description="Demonstrates concurrent Publishes" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Concurrent", "Publishes"]}
var transport = new InProcessTransport();
var destination = new TransportDestination("orders");

// Subscribe once
await transport.SubscribeAsync(
  handler: async (envelope, ct) => {
    await ProcessAsync(envelope);
  },
  destination: destination
);

// Publish concurrently from multiple threads
var tasks = Enumerable.Range(0, 100)
  .Select(i => {
    var envelope = CreateEnvelope($"order-{i}");
    return transport.PublishAsync(envelope, destination);
  })
  .ToArray();

await Task.WhenAll(tasks);  // Thread-safe - all handlers invoked
```

### Concurrent Subscriptions

```csharp{title="Concurrent Subscriptions" description="Demonstrates concurrent Subscriptions" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Concurrent", "Subscriptions"]}
// Subscribe concurrently from multiple threads
var subscribeTasks = Enumerable.Range(0, 50)
  .Select(i => transport.SubscribeAsync(
    handler: async (envelope, ct) => {
      await ProcessAsync(envelope, handlerIndex: i);
    },
    destination: new TransportDestination("orders")
  ))
  .ToArray();

await Task.WhenAll(subscribeTasks);  // Thread-safe - all registered

// Publish message - all 50 handlers invoked
await transport.PublishAsync(envelope, new TransportDestination("orders"));
```

**Implementation**:
- `ConcurrentDictionary<string, List<...>>` for subscriptions
- `lock` on subscription list during add/remove
- Thread-safe iteration with `.ToArray()` snapshot

---

## Error Handling

### Handler Exceptions

```csharp{title="Handler Exceptions" description="Demonstrates handler Exceptions" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Handler", "Exceptions"]}
await transport.SubscribeAsync(
  handler: async (envelope, ct) => {
    throw new InvalidOperationException("Handler failed!");
  },
  destination: new TransportDestination("orders")
);

try {
  await transport.PublishAsync(envelope, destination);
} catch (InvalidOperationException ex) {
  // Exception propagates to publisher
  Console.WriteLine($"Handler failed: {ex.Message}");
}
```

**Behavior**:
- Exception thrown in handler → exception propagates to `PublishAsync` caller
- Subsequent handlers **may not execute** (depends on exception handling)
- **No retry** - caller must handle retry logic

### Cancellation

```csharp{title="Cancellation" description="Demonstrates cancellation" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Cancellation"]}
var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));

try {
  await transport.SendAsync<CreateOrder, OrderCreated>(
    requestEnvelope,
    destination,
    cts.Token  // Timeout after 5 seconds
  );
} catch (OperationCanceledException) {
  Console.WriteLine("Request timed out - no response received");
}
```

**SendAsync Cancellation**:
- Response subscription cleaned up (finally block)
- `TaskCompletionSource` cancelled
- No orphaned subscriptions

---

## Performance

### Benchmarks

| Metric | Value | Notes |
|--------|-------|-------|
| **PublishAsync Latency** | ~1-5µs | Direct method call |
| **SendAsync Latency** | ~10-50µs | Includes subscription setup/teardown |
| **Throughput** | ~1M msg/sec | Limited by handler execution time |
| **Memory** | ~100 bytes/subscription | Minimal overhead |

### Comparison: In-Memory vs Azure Service Bus

| Metric | In-Memory | Azure Service Bus |
|--------|-----------|-------------------|
| **Latency** | ~5µs | ~10-50ms (network) |
| **Throughput** | ~1M msg/sec | ~10K msg/sec |
| **Cross-Process** | ❌ Same process only | ✅ Distributed |
| **Persistence** | ❌ No | ✅ Durable queues |
| **Retry** | ❌ Manual | ✅ Automatic |
| **Dead Letter** | ❌ No | ✅ Yes |
| **Setup Complexity** | ✅ None | ⚠️ Infrastructure required |

**When to Use Each**:

| Scenario | Transport |
|----------|-----------|
| **Unit/Integration Tests** | In-Memory |
| **Single-Process App** | In-Memory |
| **Distributed Services** | Azure Service Bus |
| **High Availability** | Azure Service Bus |
| **Local Development** | In-Memory |
| **Production Multi-Service** | Azure Service Bus |

---

## Testing Patterns

### Unit Testing Receptors

```csharp{title="Unit Testing Receptors" description="Demonstrates unit Testing Receptors" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Unit", "Testing"]}
[Test]
public async Task OrderReceptor_CreateOrder_PublishesOrderCreatedAsync() {
  // Arrange
  var transport = new InProcessTransport();
  var receptor = new OrderReceptor(transport);

  IMessageEnvelope? publishedEvent = null;
  await transport.SubscribeAsync(
    handler: (envelope, ct) => {
      publishedEvent = envelope;
      return Task.CompletedTask;
    },
    destination: new TransportDestination("order-events")
  );

  var command = new CreateOrder(orderId, customerId, items);

  // Act
  var result = await receptor.HandleAsync(command);

  // Assert
  await Assert.That(publishedEvent).IsNotNull();
  await Assert.That(publishedEvent!.Payload).IsOfType<OrderCreated>();
}
```

### Testing Message Flows

```csharp{title="Testing Message Flows" description="Demonstrates testing Message Flows" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Testing", "Message"]}
[Test]
public async Task OrderFlow_CreateAndShip_FullMessageChainAsync() {
  // Arrange
  var transport = new InProcessTransport();

  // Setup receptors
  var orderReceptor = new OrderReceptor(transport);
  var inventoryReceptor = new InventoryReceptor(transport);
  var shippingReceptor = new ShippingReceptor(transport);

  // Subscribe to each stage
  await transport.SubscribeAsync(
    handler: (env, ct) => inventoryReceptor.HandleAsync(env.Payload as OrderCreated),
    destination: new TransportDestination("inventory")
  );

  await transport.SubscribeAsync(
    handler: (env, ct) => shippingReceptor.HandleAsync(env.Payload as InventoryReserved),
    destination: new TransportDestination("shipping")
  );

  // Act - Trigger flow
  var command = new CreateOrder(orderId, customerId, items);
  await orderReceptor.HandleAsync(command);

  // Assert - Verify all stages completed
  var order = await _orderRepository.GetAsync(orderId);
  await Assert.That(order.Status).IsEqualTo(OrderStatus.Shipped);
}
```

### Testing with IDispatcher

```csharp{title="Testing with IDispatcher" description="Demonstrates testing with IDispatcher" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Testing", "IDispatcher"]}
[Test]
public async Task MessageFlow_ViaDispatcher_RoutesToCorrectReceptorAsync() {
  // Arrange
  var serviceProvider = BuildServiceProvider();  // Includes receptors
  var dispatcher = serviceProvider.GetRequiredService<IDispatcher>();
  var transport = serviceProvider.GetRequiredService<ITransport>() as InProcessTransport;

  // Subscribe dispatcher to transport
  await transport!.SubscribeAsync(
    handler: async (envelope, ct) => {
      await dispatcher.LocalInvokeAsync(envelope.Payload, ct);
    },
    destination: new TransportDestination("messages")
  );

  // Act - Publish command
  var command = new CreateOrder(orderId, customerId, items);
  var envelope = MessageEnvelope.Create(
    MessageId.New(), CorrelationId.New(), null,
    command,
    new MessageHop { Timestamp = DateTimeOffset.UtcNow }
  );

  await transport.PublishAsync(envelope, new TransportDestination("messages"));

  // Assert - Receptor invoked via dispatcher
  var order = await _orderRepository.GetAsync(orderId);
  await Assert.That(order).IsNotNull();
}
```

---

## Best Practices

### DO ✅

- ✅ **Use for unit and integration tests** - Fastest, no infrastructure
- ✅ **Dispose subscriptions** when done - Prevent handler leaks
- ✅ **Handle exceptions in handlers** - Prevent propagation to publisher
- ✅ **Use pause/resume for backpressure** - Graceful flow control
- ✅ **Test error paths** - Verify exception handling
- ✅ **Use for single-process apps** - Simple modular architecture

### DON'T ❌

- ❌ Use for production distributed systems (use Azure Service Bus)
- ❌ Rely on retry/dead-letter (not supported - handle manually)
- ❌ Forget to dispose subscriptions (causes memory leaks)
- ❌ Assume asynchronous delivery (handlers execute synchronously)
- ❌ Use for cross-process communication (in-memory only)
- ❌ Ignore handler exceptions (they propagate to publisher)

---

## Troubleshooting

### Problem: Handler Not Invoked

**Symptoms**: Published messages don't trigger handler.

**Causes**:
1. Destination address mismatch
2. Subscription paused or disposed
3. Handler threw exception in previous call

**Solution**:

```csharp{title="Problem: Handler Not Invoked" description="Demonstrates problem: Handler Not Invoked" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Problem:", "Handler"]}
// Verify destination addresses match EXACTLY
var publishDest = new TransportDestination("orders");
var subscribeDest = new TransportDestination("orders");

// Verify subscription is active
var subscription = await transport.SubscribeAsync(handler, subscribeDest);
Console.WriteLine(subscription.IsActive);  // Should be true

// Check for paused subscription
await subscription.ResumeAsync();
```

### Problem: SendAsync Hangs Forever

**Symptoms**: `SendAsync` never returns, no timeout.

**Cause**: No responder subscribed to request destination.

**Solution**:

```csharp{title="Problem: SendAsync Hangs Forever" description="Demonstrates problem: SendAsync Hangs Forever" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Problem:", "SendAsync"]}
// Always use timeout with SendAsync
var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));

try {
  var response = await transport.SendAsync<TRequest, TResponse>(
    requestEnvelope,
    destination,
    cts.Token  // ✅ Timeout after 30 seconds
  );
} catch (OperationCanceledException) {
  // No response received - handle timeout
  Console.WriteLine("Request timed out");
}
```

### Problem: Memory Leak with Subscriptions

**Symptoms**: Memory usage grows over time.

**Cause**: Subscriptions not disposed when no longer needed.

**Solution**:

```csharp{title="Problem: Memory Leak with Subscriptions" description="Demonstrates problem: Memory Leak with Subscriptions" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Problem:", "Memory"]}
// Always dispose subscriptions
var subscription = await transport.SubscribeAsync(handler, destination);

try {
  // Use subscription...
} finally {
  subscription.Dispose();  // ✅ Cleanup
}

// Or use IAsyncDisposable
await using var subscription = await transport.SubscribeAsync(handler, destination);
// Auto-disposed when out of scope
```

### Problem: Concurrent Handler Execution

**Symptoms**: Handlers execute in unpredictable order.

**Cause**: Multiple concurrent `PublishAsync` calls.

**Clarification**: This is **expected behavior** for concurrent publishes.

```csharp{title="Problem: Concurrent Handler Execution" description="Clarification: This is expected behavior for concurrent publishes." category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Problem:", "Concurrent"]}
// Concurrent publishes → concurrent handler execution
await Task.WhenAll(
  transport.PublishAsync(envelope1, destination),  // Handler invoked
  transport.PublishAsync(envelope2, destination),  // Handler invoked concurrently
  transport.PublishAsync(envelope3, destination)   // Handler invoked concurrently
);

// Solution: If strict ordering required, publish sequentially
await transport.PublishAsync(envelope1, destination);  // Completes before next
await transport.PublishAsync(envelope2, destination);
await transport.PublishAsync(envelope3, destination);
```

---

## Advanced Patterns

### Conditional Handler Execution

```csharp{title="Conditional Handler Execution" description="Demonstrates conditional Handler Execution" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Conditional", "Handler"]}
await transport.SubscribeAsync(
  handler: async (envelope, ct) => {
    // Skip processing based on metadata
    var hop = envelope.Hops.First();
    if (hop.ServiceInstance?.ServiceName == "InventoryService") {
      return;  // Skip messages from InventoryService
    }

    await ProcessAsync(envelope);
  },
  destination: new TransportDestination("orders")
);
```

### Circuit Breaker Pattern

```csharp{title="Circuit Breaker Pattern" description="Demonstrates circuit Breaker Pattern" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Circuit", "Breaker"]}
int failureCount = 0;
const int maxFailures = 3;

var subscription = await transport.SubscribeAsync(
  handler: async (envelope, ct) => {
    try {
      await ProcessAsync(envelope);
      failureCount = 0;  // Reset on success
    } catch (Exception ex) {
      failureCount++;

      if (failureCount >= maxFailures) {
        // Open circuit - pause subscription
        await subscription.PauseAsync();
        Console.WriteLine("Circuit opened - pausing subscription");

        // Schedule resume after cooldown
        _ = Task.Delay(TimeSpan.FromMinutes(1))
          .ContinueWith(async _ => {
            await subscription.ResumeAsync();
            failureCount = 0;
            Console.WriteLine("Circuit closed - resuming subscription");
          });
      }

      throw;  // Re-throw to propagate to publisher
    }
  },
  destination: new TransportDestination("orders")
);
```

### Fan-Out Pattern

```csharp{title="Fan-Out Pattern" description="Demonstrates fan-Out Pattern" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Fan-Out", "Pattern"]}
// Single publisher, multiple subscribers (fan-out)
var transport = new InProcessTransport();
var destination = new TransportDestination("order-created");

// Subscribe multiple services
await transport.SubscribeAsync(
  handler: async (env, ct) => await _inventoryService.ReserveStockAsync(env.Payload),
  destination: destination
);

await transport.SubscribeAsync(
  handler: async (env, ct) => await _notificationService.SendEmailAsync(env.Payload),
  destination: destination
);

await transport.SubscribeAsync(
  handler: async (env, ct) => await _analyticsService.TrackEventAsync(env.Payload),
  destination: destination
);

// Publish once - all three services invoked
await transport.PublishAsync(orderCreatedEnvelope, destination);
```

---

## Further Reading

**Transports**:
- [Azure Service Bus Transport](azure-service-bus.md) - Distributed messaging for production

**Messaging Patterns**:
- [Outbox Pattern](../messaging/outbox-pattern.md) - Reliable event publishing (not needed for in-memory)
- [Inbox Pattern](../messaging/inbox-pattern.md) - Exactly-once processing (not needed for in-memory)

**Testing**:
- [Testing Receptors](../advanced/testing-receptors.md) - Unit testing message handlers

**Extensibility**:
- [Custom Transports](../../extending/extensibility/custom-transports.md) - Implementing custom transports

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
