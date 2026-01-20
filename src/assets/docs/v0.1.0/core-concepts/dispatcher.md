---
title: "Dispatcher Deep Dive"
version: 0.1.0
category: Core Concepts
order: 1
description: "Master the Whizbang Dispatcher - three dispatch patterns (SendAsync, LocalInvokeAsync, PublishAsync) for commands, queries, and events"
tags: dispatcher, messaging, commands, events, patterns
codeReferences:
  - src/Whizbang.Core/IDispatcher.cs
  - src/Whizbang.Core/Dispatcher.cs
  - samples/ECommerce/ECommerce.BFF.API/Endpoints/OrderEndpoints.cs
---

# Dispatcher Deep Dive

The **Dispatcher** is Whizbang's central message router. It provides three distinct dispatch patterns for different messaging scenarios: commands, queries, and events.

## Quick Reference

| Pattern | Use Case | Return Type | Performance | Distribution |
|---------|----------|-------------|-------------|--------------|
| `SendAsync` | Commands with delivery tracking | `DeliveryReceipt` | ~100μs | Local or Remote |
| `LocalInvokeAsync` | In-process queries/commands | `TResponse` | < 20ns | Local only |
| `PublishAsync` | Event broadcasting | `void` | ~50μs | Local or Remote |

## IDispatcher Interface

```csharp
namespace Whizbang.Core;

public interface IDispatcher {
    // Pattern 1: Command dispatch with delivery receipt
    Task<DeliveryReceipt> SendAsync<TMessage>(
        TMessage message,
        CancellationToken cancellationToken = default
    ) where TMessage : notnull;

    // Pattern 2: In-process RPC with typed response
    Task<TResponse> LocalInvokeAsync<TMessage, TResponse>(
        TMessage message,
        CancellationToken cancellationToken = default
    ) where TMessage : notnull;

    // Pattern 3: Event broadcasting (fire-and-forget)
    Task PublishAsync<TMessage>(
        TMessage message,
        CancellationToken cancellationToken = default
    ) where TMessage : notnull;
}
```

---

## Pattern 1: SendAsync - Command Dispatch

**Use Case**: Send commands with delivery tracking, supports both local and remote dispatch.

**Signature**:
```csharp
Task<DeliveryReceipt> SendAsync<TMessage>(
    TMessage message,
    CancellationToken cancellationToken = default
) where TMessage : notnull;
```

**Returns**: `DeliveryReceipt` containing message ID, correlation ID, and timestamp.

### Basic Usage

```csharp
public class OrdersController : ControllerBase {
    private readonly IDispatcher _dispatcher;

    public OrdersController(IDispatcher dispatcher) {
        _dispatcher = dispatcher;
    }

    [HttpPost]
    public async Task<ActionResult> CreateOrder(
        [FromBody] CreateOrderRequest request,
        CancellationToken ct) {

        var command = new CreateOrder(
            CustomerId: request.CustomerId,
            Items: request.Items
        );

        // Send command, get delivery receipt
        var receipt = await _dispatcher.SendAsync(command, ct);

        return Accepted(new {
            messageId = receipt.MessageId,
            correlationId = receipt.CorrelationId,
            timestamp = receipt.Timestamp
        });
    }
}
```

### DeliveryReceipt Structure

```csharp
public record DeliveryReceipt(
    Guid MessageId,        // Unique ID for this message
    Guid CorrelationId,    // ID for tracking related messages
    DateTimeOffset Timestamp
);
```

**Use cases**:
- Long-running operations where you track completion separately
- Commands that may be processed asynchronously
- Remote command dispatch via transport (Azure Service Bus, etc.)
- Idempotency tracking (store receipt, check for duplicates)

### SendAsync Flow

```
Client
  ├─> dispatcher.SendAsync(command)
  ├─> Envelope created (MessageId, CorrelationId)
  ├─> Receptor invoked locally
  ├─> Event stored in Outbox
  └─> DeliveryReceipt returned

Background Worker
  ├─> Polls Outbox
  ├─> Publishes event to transport (Azure Service Bus)
  └─> Marks message as Published
```

**Key Points**:
- **Asynchronous semantics**: Receipt doesn't mean message is processed, just accepted
- **Outbox integration**: Event stored for reliable delivery
- **Idempotency**: Use `MessageId` to detect duplicates

### Example: Long-Running Order Processing

```csharp
[HttpPost("orders")]
public async Task<ActionResult> CreateOrder(
    [FromBody] CreateOrderRequest request,
    CancellationToken ct) {

    var command = new CreateOrder(
        CustomerId: request.CustomerId,
        Items: request.Items
    );

    // Send command - returns immediately with receipt
    var receipt = await _dispatcher.SendAsync(command, ct);

    // Store receipt for later tracking
    await _trackingService.StoreReceiptAsync(
        receipt.MessageId,
        receipt.CorrelationId,
        "Order creation initiated"
    );

    // Return 202 Accepted with tracking URL
    return Accepted(new {
        trackingUrl = $"/api/orders/status/{receipt.CorrelationId}",
        messageId = receipt.MessageId
    });
}

[HttpGet("orders/status/{correlationId:guid}")]
public async Task<ActionResult> GetOrderStatus(Guid correlationId) {
    var status = await _trackingService.GetStatusAsync(correlationId);
    return Ok(status);
}
```

---

## Pattern 2: LocalInvokeAsync - In-Process RPC

**Use Case**: Fast, synchronous-style command/query execution with typed response.

**Signature**:
```csharp
Task<TResponse> LocalInvokeAsync<TMessage, TResponse>(
    TMessage message,
    CancellationToken cancellationToken = default
) where TMessage : notnull;
```

**Returns**: Typed response from receptor (`TResponse`).

**Performance**: < 20ns dispatch overhead, zero allocations (with object pooling).

### Basic Usage

```csharp
[HttpPost("orders")]
public async Task<ActionResult<OrderCreated>> CreateOrder(
    [FromBody] CreateOrderRequest request,
    CancellationToken ct) {

    var command = new CreateOrder(
        CustomerId: request.CustomerId,
        Items: request.Items
    );

    // Invoke receptor, get typed response
    var result = await _dispatcher.LocalInvokeAsync<CreateOrder, OrderCreated>(
        command,
        ct
    );

    // Publish event to perspectives
    await _dispatcher.PublishAsync(result, ct);

    return CreatedAtAction(
        nameof(GetOrder),
        new { orderId = result.OrderId },
        result
    );
}
```

### LocalInvokeAsync Flow

```
Client
  ├─> dispatcher.LocalInvokeAsync<CreateOrder, OrderCreated>(command)
  ├─> Lookup receptor in registry (compile-time, zero reflection)
  ├─> Invoke receptor.HandleAsync(command)
  ├─> Return typed response
  └─> < 20ns overhead (zero allocations)
```

**Key Points**:
- **Compile-time safety**: Type mismatch = compiler error
- **Zero reflection**: Routing generated at compile time
- **Synchronous semantics**: Waits for receptor to complete
- **Local only**: Cannot cross process boundaries
- **Performance**: Optimal for in-process commands/queries

### Example: Query with Typed Response

```csharp
public record GetOrderQuery(Guid OrderId);

public record OrderDetails(
    Guid OrderId,
    Guid CustomerId,
    OrderLineItem[] Items,
    decimal Total,
    string Status
);

public class GetOrderReceptor : IReceptor<GetOrderQuery, OrderDetails> {
    private readonly IOrderLens _lens;

    public GetOrderReceptor(IOrderLens lens) {
        _lens = lens;
    }

    public async ValueTask<OrderDetails> HandleAsync(
        GetOrderQuery query,
        CancellationToken ct = default) {

        var order = await _lens.GetOrderAsync(query.OrderId, ct);

        if (order is null) {
            throw new NotFoundException($"Order {query.OrderId} not found");
        }

        return new OrderDetails(
            OrderId: order.OrderId,
            CustomerId: order.CustomerId,
            Items: order.Items,
            Total: order.Total,
            Status: order.Status
        );
    }
}

// Controller usage
[HttpGet("orders/{orderId:guid}")]
public async Task<ActionResult<OrderDetails>> GetOrder(
    Guid orderId,
    CancellationToken ct) {

    var query = new GetOrderQuery(orderId);

    try {
        var details = await _dispatcher.LocalInvokeAsync<GetOrderQuery, OrderDetails>(
            query,
            ct
        );

        return Ok(details);
    } catch (NotFoundException ex) {
        return NotFound(new { error = ex.Message });
    }
}
```

### Type Safety Enforcement

```csharp
// ✅ CORRECT - Type mismatch caught at compile time
var result = await _dispatcher.LocalInvokeAsync<CreateOrder, OrderCreated>(command);

// ❌ COMPILER ERROR - Type mismatch
var wrong = await _dispatcher.LocalInvokeAsync<CreateOrder, PaymentProcessed>(command);
// Error: No receptor registered for CreateOrder → PaymentProcessed
```

### Performance Optimization

LocalInvokeAsync achieves < 20ns overhead through:

1. **Compile-time routing**: Source generators create direct method calls
2. **Value types**: Envelope and hops use structs where possible
3. **Object pooling**: Reuse envelope instances
4. **Zero reflection**: No runtime type discovery

**Generated code example**:
```csharp
// Generated by Whizbang.Generators
protected override ReceptorInvoker<TResult>? GetReceptorInvoker<TResult>(
    object message,
    Type messageType) {

    // Direct type check, no reflection
    if (messageType == typeof(CreateOrder)) {
        var receptor = _serviceProvider.GetRequiredService<IReceptor<CreateOrder, OrderCreated>>();
        return async msg => (TResult)(object)await receptor.HandleAsync((CreateOrder)msg);
    }

    // ... other message types

    return null;
}
```

---

## Pattern 3: PublishAsync - Event Broadcasting

**Use Case**: Broadcast events to multiple listeners (perspectives).

**Signature**:
```csharp
Task PublishAsync<TMessage>(
    TMessage message,
    CancellationToken cancellationToken = default
) where TMessage : notnull;
```

**Returns**: `Task` (no return value, fire-and-forget).

### Basic Usage

```csharp
[HttpPost("orders")]
public async Task<ActionResult<OrderCreated>> CreateOrder(
    [FromBody] CreateOrderRequest request,
    CancellationToken ct) {

    var command = new CreateOrder(
        CustomerId: request.CustomerId,
        Items: request.Items
    );

    // 1. Execute command
    var result = await _dispatcher.LocalInvokeAsync<CreateOrder, OrderCreated>(
        command,
        ct
    );

    // 2. Publish event to all perspectives
    await _dispatcher.PublishAsync(result, ct);

    return CreatedAtAction(nameof(GetOrder), new { orderId = result.OrderId }, result);
}
```

### PublishAsync Flow

```
Client
  ├─> dispatcher.PublishAsync(event)
  ├─> Find all perspectives for event type
  ├─> Invoke each perspective.UpdateAsync(event)
  │   ├─> OrderSummaryPerspective.UpdateAsync(OrderCreated)
  │   ├─> InventoryPerspective.UpdateAsync(OrderCreated)
  │   └─> AnalyticsPerspective.UpdateAsync(OrderCreated)
  └─> All perspectives updated (parallel execution)
```

**Key Points**:
- **Multiple listeners**: One event triggers multiple perspectives
- **Fire-and-forget**: Doesn't wait for perspectives to complete (async)
- **Local broadcast**: All perspectives in current process
- **Outbox integration**: Event can be stored for remote publishing

### Example: Multiple Perspectives

```csharp
// Event
public record OrderCreated(
    Guid OrderId,
    Guid CustomerId,
    OrderLineItem[] Items,
    decimal Total,
    DateTimeOffset CreatedAt
);

// Perspective 1: Order summary for UI
public class OrderSummaryPerspective : IPerspectiveOf<OrderCreated> {
    private readonly IDbConnectionFactory _db;

    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "INSERT INTO order_summaries (order_id, customer_id, total, status, created_at) VALUES (@OrderId, @CustomerId, @Total, @Status, @CreatedAt)",
            new {
                @event.OrderId,
                @event.CustomerId,
                @event.Total,
                Status = "Created",
                @event.CreatedAt
            }
        );
    }
}

// Perspective 2: Analytics/reporting
public class OrderAnalyticsPerspective : IPerspectiveOf<OrderCreated> {
    private readonly IDbConnectionFactory _db;

    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "INSERT INTO order_analytics (order_id, customer_id, total, created_at) VALUES (@OrderId, @CustomerId, @Total, @CreatedAt)",
            new {
                @event.OrderId,
                @event.CustomerId,
                @event.Total,
                @event.CreatedAt
            }
        );
    }
}

// Perspective 3: Notification system
public class NotificationPerspective : IPerspectiveOf<OrderCreated> {
    private readonly IEmailService _email;

    public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
        await _email.SendAsync(
            to: await GetCustomerEmailAsync(@event.CustomerId),
            subject: "Order Confirmed",
            body: $"Your order {@event.OrderId} has been created. Total: {@event.Total:C}"
        );
    }
}
```

When you call `PublishAsync(orderCreated)`, **all three perspectives** are invoked automatically.

### Remote Publishing with Outbox

```csharp
// In receptor - store event in outbox for remote publishing
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    private readonly IWorkCoordinator _coordinator;

    public async ValueTask<OrderCreated> HandleAsync(
        CreateOrder message,
        CancellationToken ct = default) {

        // Business logic...
        var @event = new OrderCreated(/* ... */);

        // Store in outbox for reliable publishing
        await _coordinator.ProcessWorkBatchAsync(
            instanceId: Guid.NewGuid(),
            serviceName: "OrderService",
            hostName: Environment.MachineName,
            processId: Environment.ProcessId,
            metadata: null,
            outboxCompletions: [],
            outboxFailures: [],
            inboxCompletions: [],
            inboxFailures: [],
            receptorCompletions: [],
            receptorFailures: [],
            perspectiveCompletions: [],
            perspectiveFailures: [],
            newOutboxMessages: [
                new OutboxMessage(
                    MessageId: Guid.CreateVersion7(),
                    MessageType: typeof(OrderCreated).FullName!,
                    Payload: JsonSerializer.Serialize(@event),
                    CorrelationId: GetCorrelationId(),
                    Topic: "orders",
                    PartitionKey: @event.CustomerId.ToString()
                )
            ],
            newInboxMessages: [],
            renewOutboxLeaseIds: [],
            renewInboxLeaseIds: [],
            flags: WorkBatchFlags.None,
            ct: ct
        );

        return @event;
    }
}
```

---

## AppendAsync vs PublishAsync vs SendAsync

:::new{type="important"}
Understanding when to use `IEventStore.AppendAsync` versus `IDispatcher.PublishAsync` is critical. Using both together is usually **redundant**.
:::

### Key Differences

| Method | Responsibility | Triggers Perspectives | Uses Outbox | Return |
|--------|---------------|----------------------|-------------|--------|
| `IEventStore.AppendAsync` | Persist event to event store | No | No | `void` |
| `IDispatcher.PublishAsync` | Broadcast event | Yes (local) | Yes (remote) | `void` |
| `IDispatcher.SendAsync` | Route command | No | Yes | `DeliveryReceipt` |

### Correct Patterns

**For Events (most common case):**

```csharp
// ✅ CORRECT: Just publish - handles perspectives + outbox
public async ValueTask<OrderCreated> HandleAsync(
    CreateOrder command,
    CancellationToken ct) {

    var @event = new OrderCreated(command.OrderId, command.Items);

    // PublishAsync triggers local perspectives AND queues for remote delivery
    await _dispatcher.PublishAsync(@event, ct);

    return @event;
}
```

**For Commands:**

```csharp
// ✅ CORRECT: Send command with delivery tracking
await _dispatcher.SendAsync(new ProcessPayment(orderId, amount), ct);
```

**For Direct Event Store Access (rare - infrastructure/workers only):**

```csharp
// ✅ CORRECT: When you need explicit transactional control
await using var work = await _workCoordinator.BeginAsync(ct);
await _eventStore.AppendAsync(streamId, @event, ct);
await work.CommitAsync(ct);
```

### Anti-Patterns to Avoid

```csharp
// ❌ WRONG: Redundant - calling both AppendAsync and PublishAsync
await _eventStore.AppendAsync(orderId, @event, ct);
await _dispatcher.PublishAsync(@event, ct);
// PublishAsync already handles persistence + perspectives + outbox!
```

### When to Use Each

| Scenario | Use |
|----------|-----|
| Publishing an event from a receptor | `PublishAsync` |
| Sending a command to another service | `SendAsync` |
| In-process query with typed response | `LocalInvokeAsync` |
| Background worker with explicit transaction control | `AppendAsync` + `IWorkCoordinator` |
| Event replay/migration scripts | `AppendAsync` |

---

## Decision Matrix

### When to Use Each Pattern

| Scenario | Pattern | Reason |
|----------|---------|--------|
| **Create order (synchronous response needed)** | `LocalInvokeAsync` | Need typed `OrderCreated` response immediately |
| **Create order (async processing)** | `SendAsync` | Return receipt, process in background |
| **Query order details** | `LocalInvokeAsync` | Need typed `OrderDetails` response |
| **Update read models after command** | `PublishAsync` | Broadcast event to perspectives |
| **Send email notification** | `PublishAsync` | Fire-and-forget to notification perspective |
| **Remote command (cross-service)** | `SendAsync` | Delivery tracking, supports transport |
| **In-process RPC-style call** | `LocalInvokeAsync` | Fastest, type-safe |

### Pattern Comparison

```csharp
// Scenario: Create an order

// Option 1: SendAsync (async semantics, delivery tracking)
var receipt = await _dispatcher.SendAsync(command);
// Returns: DeliveryReceipt { MessageId, CorrelationId, Timestamp }
// Use: When you need to track delivery or process asynchronously

// Option 2: LocalInvokeAsync (sync semantics, typed response)
var result = await _dispatcher.LocalInvokeAsync<CreateOrder, OrderCreated>(command);
// Returns: OrderCreated { OrderId, CustomerId, Total, ... }
// Use: When you need the result immediately (< 20ns overhead)

// Option 3: PublishAsync (broadcast to listeners)
await _dispatcher.PublishAsync(orderCreated);
// Returns: void
// Use: After command completes, update all perspectives
```

---

## Error Handling

### LocalInvokeAsync Error Handling

```csharp
[HttpPost("orders")]
public async Task<ActionResult> CreateOrder(
    [FromBody] CreateOrderRequest request,
    CancellationToken ct) {

    try {
        var command = new CreateOrder(request.CustomerId, request.Items);

        var result = await _dispatcher.LocalInvokeAsync<CreateOrder, OrderCreated>(
            command,
            ct
        );

        await _dispatcher.PublishAsync(result, ct);

        return CreatedAtAction(nameof(GetOrder), new { orderId = result.OrderId }, result);

    } catch (ValidationException ex) {
        // Business rule violation (e.g., invalid quantity)
        return BadRequest(new { error = ex.Message, errors = ex.ValidationErrors });

    } catch (NotFoundException ex) {
        // Entity not found (e.g., customer doesn't exist)
        return NotFound(new { error = ex.Message });

    } catch (InvalidOperationException ex) {
        // Business logic error (e.g., insufficient inventory)
        return Conflict(new { error = ex.Message });

    } catch (OperationCanceledException) {
        // Client cancelled request
        return StatusCode(499, new { error = "Request cancelled" });

    } catch (Exception ex) {
        // Unexpected error
        _logger.LogError(ex, "Failed to create order");
        return StatusCode(500, new { error: "An unexpected error occurred" });
    }
}
```

### SendAsync Error Handling

```csharp
try {
    var receipt = await _dispatcher.SendAsync(command, ct);

    // Store receipt for tracking
    await _trackingService.StoreAsync(receipt);

    return Accepted(new { trackingId = receipt.CorrelationId });

} catch (Exception ex) {
    // SendAsync errors typically indicate infrastructure issues
    _logger.LogError(ex, "Failed to dispatch command");
    return StatusCode(503, new { error = "Service temporarily unavailable" });
}
```

### PublishAsync Error Handling

```csharp
try {
    await _dispatcher.PublishAsync(orderCreated, ct);

} catch (AggregateException ex) {
    // One or more perspectives failed
    foreach (var inner in ex.InnerExceptions) {
        _logger.LogError(inner, "Perspective update failed");
    }

    // Decide: fail request or continue?
    // Option 1: Fail entire request
    throw;

    // Option 2: Log and continue (eventual consistency)
    // Perspectives will catch up via event replay
}
```

---

## Advanced Patterns

### Pattern: Command + Event in Single Transaction

```csharp
[HttpPost("orders")]
public async Task<ActionResult<OrderCreated>> CreateOrder(
    [FromBody] CreateOrderRequest request,
    CancellationToken ct) {

    var command = new CreateOrder(request.CustomerId, request.Items);

    // Execute command
    var result = await _dispatcher.LocalInvokeAsync<CreateOrder, OrderCreated>(
        command,
        ct
    );

    // Publish event to local perspectives
    await _dispatcher.PublishAsync(result, ct);

    // Also send via SendAsync for outbox (remote publishing)
    await _dispatcher.SendAsync(result, ct);

    return CreatedAtAction(nameof(GetOrder), new { orderId = result.OrderId }, result);
}
```

**Result**:
- Local perspectives updated immediately
- Event stored in outbox for remote publishing
- Background worker publishes to Azure Service Bus

### Pattern: Conditional Publishing

```csharp
public async Task<ActionResult> ProcessPayment(
    [FromBody] ProcessPaymentRequest request,
    CancellationToken ct) {

    var command = new ProcessPayment(request.OrderId, request.Amount);

    var result = await _dispatcher.LocalInvokeAsync<ProcessPayment, PaymentResult>(
        command,
        ct
    );

    // Publish different events based on result
    if (result.IsSuccess) {
        await _dispatcher.PublishAsync(
            new PaymentProcessed(result.OrderId, result.Amount, result.TransactionId),
            ct
        );
    } else {
        await _dispatcher.PublishAsync(
            new PaymentFailed(result.OrderId, result.Amount, result.ErrorCode),
            ct
        );
    }

    return Ok(result);
}
```

### Pattern: Batch Processing

```csharp
public async Task<ActionResult> ProcessOrders(
    [FromBody] ProcessOrdersRequest request,
    CancellationToken ct) {

    var results = new List<OrderCreated>();

    foreach (var item in request.Orders) {
        var command = new CreateOrder(item.CustomerId, item.Items);

        var result = await _dispatcher.LocalInvokeAsync<CreateOrder, OrderCreated>(
            command,
            ct
        );

        results.Add(result);
    }

    // Publish all events in batch
    foreach (var result in results) {
        await _dispatcher.PublishAsync(result, ct);
    }

    return Ok(new { ordersCreated = results.Count, orders = results });
}
```

---

## Performance Considerations

### LocalInvokeAsync Benchmarks

| Scenario | Overhead | Allocations |
|----------|----------|-------------|
| Direct method call | 0ns | 0 bytes |
| LocalInvokeAsync (cold) | 15-20ns | 0 bytes (pooled) |
| LocalInvokeAsync (warm) | < 10ns | 0 bytes |
| SendAsync | ~100μs | Minimal (envelope) |
| PublishAsync | ~50μs | Minimal |

**Tips**:
- Use `LocalInvokeAsync` for hot paths (< 20ns)
- Use `SendAsync` for asynchronous commands (acceptable ~100μs)
- Use `PublishAsync` for events (fire-and-forget)

### Object Pooling

Whizbang uses object pooling for message envelopes:

```csharp
// Automatically pooled
var envelope = MessageEnvelope.Create(message, correlationId, causationId);

// After dispatch, envelope is returned to pool
// Next dispatch reuses pooled instance (zero allocation)
```

**Result**: Zero allocations in steady state (after warmup).

---

## Integration with Patterns

### Outbox Pattern

`SendAsync` integrates with the Outbox pattern:

```csharp
// Receptor stores event in outbox
var @event = new OrderCreated(/* ... */);

await _coordinator.ProcessWorkBatchAsync(
    /* ... */,
    newOutboxMessages: [
        new OutboxMessage(/* event data */)
    ],
    /* ... */
);

// Background worker publishes from outbox
var batch = await _coordinator.ProcessWorkBatchAsync(/* ... */);

foreach (var msg in batch.ClaimedOutboxMessages) {
    await _transport.PublishAsync(msg);
}
```

See [Outbox Pattern](../messaging/outbox-pattern.md) for details.

### Inbox Pattern

`SendAsync` integrates with the Inbox pattern for exactly-once processing:

```csharp
// Check inbox for duplicate
var existing = await _coordinator.FindInboxMessageAsync(messageId);

if (existing is not null) {
    // Duplicate detected - return cached result
    return existing.Result;
}

// Process message
var result = await _dispatcher.LocalInvokeAsync<TMessage, TResponse>(message);

// Store in inbox
await _coordinator.ProcessWorkBatchAsync(
    /* ... */,
    newInboxMessages: [
        new InboxMessage(messageId, result)
    ],
    /* ... */
);
```

See [Inbox Pattern](../messaging/inbox-pattern.md) for details.

---

## Testing

### Testing with Dispatcher

```csharp
public class OrderEndpointsTests {
    private IDispatcher _dispatcher;
    private OrdersController _controller;

    [Before(Test)]
    public void Setup() {
        var services = new ServiceCollection();
        services.AddWhizbangCore();
        services.AddTransient<IReceptor<CreateOrder, OrderCreated>, CreateOrderReceptor>();

        var provider = services.BuildServiceProvider();
        _dispatcher = provider.GetRequiredService<IDispatcher>();
        _controller = new OrdersController(_dispatcher);
    }

    [Test]
    public async Task CreateOrder_ValidRequest_ReturnsCreatedAsync() {
        // Arrange
        var request = new CreateOrderRequest(
            CustomerId: Guid.NewGuid(),
            Items: [new OrderLineItem(Guid.NewGuid(), 5, 19.99m)]
        );

        // Act
        var result = await _controller.CreateOrder(request, CancellationToken.None);

        // Assert
        await Assert.That(result.Result).IsTypeOf<CreatedAtActionResult>();

        var createdResult = (CreatedAtActionResult)result.Result!;
        await Assert.That(createdResult.Value).IsTypeOf<OrderCreated>();
    }
}
```

---

## Further Reading

**Core Concepts**:
- [Receptors](receptors.md) - Message handlers that dispatcher invokes
- [Perspectives](perspectives.md) - Event listeners for read models
- [Message Context](message-context.md) - Correlation and causation tracking

**Messaging Patterns**:
- [Outbox Pattern](../messaging/outbox-pattern.md) - Reliable event publishing
- [Inbox Pattern](../messaging/inbox-pattern.md) - Exactly-once processing
- [Work Coordination](../messaging/work-coordinator.md) - Distributed work coordination

**Examples**:
- [ECommerce: Order Service](../examples/ecommerce/order-service.md) - Real-world dispatcher usage

---

*Version 0.1.0 - Foundation Release | Last Updated: 2024-12-12*
