---
title: Dispatcher Deep Dive
version: 1.0.0
category: Core Concepts
order: 1
description: >-
  Master the Whizbang Dispatcher - three dispatch patterns (SendAsync,
  LocalInvokeAsync, PublishAsync) for commands, queries, and events
tags: 'dispatcher, messaging, commands, events, patterns'
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

### Synchronous Receptor Invocation

:::new
`LocalInvokeAsync` supports both async (`IReceptor`) and sync (`ISyncReceptor`) receptors transparently:
:::

```csharp
// Async receptor - uses HandleAsync, returns ValueTask
public class AsyncOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    public async ValueTask<OrderCreated> HandleAsync(
        CreateOrder message,
        CancellationToken ct = default) {
        // Can use await
        await Task.Delay(1);
        return new OrderCreated(message.OrderId);
    }
}

// Sync receptor - uses Handle, returns directly
public class SyncOrderReceptor : ISyncReceptor<CreateOrder, OrderCreated> {
    public OrderCreated Handle(CreateOrder message) {
        // Pure computation, no await
        return new OrderCreated(message.OrderId);
    }
}

// Both invoked the same way
var result = await _dispatcher.LocalInvokeAsync<CreateOrder, OrderCreated>(command);
```

**How it works**:
1. Dispatcher first checks for async `IReceptor<TMessage, TResponse>`
2. If not found, checks for sync `ISyncReceptor<TMessage, TResponse>`
3. Sync receptors are invoked directly, result wrapped in pre-completed `ValueTask`
4. Auto-cascade works identically for both sync and async receptors

**Performance benefit**: Sync receptors avoid async state machine overhead entirely. The returned `ValueTask` is pre-completed, resulting in zero allocations.

```
Async Receptor Flow:
  LocalInvokeAsync → HandleAsync() → ValueTask (may allocate Task)

Sync Receptor Flow:
  LocalInvokeAsync → Handle() → new ValueTask(result) (pre-completed, zero alloc)
```

**Precedence**: If both `IReceptor` and `ISyncReceptor` exist for the same message type, the async `IReceptor` takes precedence to avoid breaking existing behavior.

See [Receptors: ISyncReceptor Interface](receptors.md#isyncreceptor-interface) for when to use sync vs async receptors.

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

// Sync receptor routing (fallback if no async receptor)
protected override SyncReceptorInvoker<TResult>? GetSyncReceptorInvoker<TResult>(
    object message,
    Type messageType) {

    if (messageType == typeof(CreateOrder)) {
        var receptor = _serviceProvider.GetService<ISyncReceptor<CreateOrder, OrderCreated>>();
        if (receptor == null) return null;
        return msg => (TResult)(object)receptor.Handle((CreateOrder)msg)!;
    }

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

## Automatic Message Cascade

Whizbang automatically extracts and dispatches `IMessage` instances (both `IEvent` and `ICommand`) from receptor return values. This enables a cleaner pattern where receptors can return tuples or arrays containing messages without explicit `PublishAsync` or `SendAsync` calls.

### The Problem (Without Auto-Cascade)

```csharp
// ❌ VERBOSE: Explicit PublishAsync required
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    private readonly IDispatcher _dispatcher;

    public async ValueTask<OrderCreated> HandleAsync(
        CreateOrder command,
        CancellationToken ct = default) {

        // Business logic...
        var @event = new OrderCreated(command.OrderId, command.CustomerId);

        // Manual publishing required
        await _dispatcher.PublishAsync(@event, ct);

        return @event;
    }
}
```

### The Solution (With Auto-Cascade)

```csharp
// ✅ CLEAN: Framework auto-publishes events from return value
public class CreateOrderReceptor : IReceptor<CreateOrder, (OrderResult, OrderCreated)> {

    public ValueTask<(OrderResult, OrderCreated)> HandleAsync(
        CreateOrder command,
        CancellationToken ct = default) {

        var result = new OrderResult(command.OrderId);
        var @event = new OrderCreated(command.OrderId, command.CustomerId);

        // Return tuple - framework automatically publishes OrderCreated
        return ValueTask.FromResult((result, @event));
    }
}
```

**What happens**:
1. Receptor returns `(OrderResult, OrderCreated)` tuple
2. Dispatcher extracts `OrderCreated` (implements `IEvent`)
3. Dispatcher automatically publishes `OrderCreated` to all perspectives
4. Caller receives the full tuple result

### Supported Return Types

The auto-cascade feature supports several return patterns:

**Tuple with Event**:
```csharp
public class OrderReceptor : IReceptor<CreateOrder, (OrderResult, OrderCreated)> {
    public ValueTask<(OrderResult, OrderCreated)> HandleAsync(
        CreateOrder command, CancellationToken ct = default) {

        return ValueTask.FromResult((
            new OrderResult(command.OrderId),
            new OrderCreated(command.OrderId, command.CustomerId)
        ));
    }
}
// Result: OrderCreated auto-published
```

**Tuple with Multiple Events**:
```csharp
public class ShipOrderReceptor : IReceptor<ShipOrder, (ShipResult, OrderShipped, InventoryUpdated)> {
    public ValueTask<(ShipResult, OrderShipped, InventoryUpdated)> HandleAsync(
        ShipOrder command, CancellationToken ct = default) {

        return ValueTask.FromResult((
            new ShipResult(command.OrderId),
            new OrderShipped(command.OrderId),
            new InventoryUpdated(command.ProductId, -command.Quantity)
        ));
    }
}
// Result: Both OrderShipped and InventoryUpdated auto-published
```

**Array of Events**:
```csharp
public class NotifyReceptor : IReceptor<SendNotifications, IEvent[]> {
    public ValueTask<IEvent[]> HandleAsync(
        SendNotifications command, CancellationToken ct = default) {

        var events = new List<IEvent> {
            new EmailSent(command.CustomerId)
        };

        if (command.Amount >= 1000m) {
            events.Add(new HighValueAlert(command.OrderId));
        }

        return ValueTask.FromResult(events.ToArray());
    }
}
// Result: All events in array auto-published
```

**Nested Tuples**:
```csharp
public class ComplexReceptor : IReceptor<ComplexCommand, (Result, (Event1, Event2))> {
    public ValueTask<(Result, (Event1, Event2))> HandleAsync(
        ComplexCommand command, CancellationToken ct = default) {

        return ValueTask.FromResult((
            new Result(command.Id),
            (new Event1(command.Id), new Event2(command.Id))
        ));
    }
}
// Result: Both Event1 and Event2 auto-published (recursive extraction)
```

### How It Works

The auto-cascade system uses the `ITuple` interface for efficient, AOT-compatible message extraction:

```
Receptor Returns
  ├─> Dispatcher receives result
  ├─> MessageExtractor.ExtractMessages(result)
  │   ├─> Checks if result implements IMessage (IEvent or ICommand) → yield return
  │   ├─> Checks if result implements ITuple → extract each item recursively
  │   ├─> Checks if result implements IEnumerable<IMessage> → yield return each
  │   ├─> Checks if result implements IEnumerable<IEvent> → yield return each
  │   └─> Checks if result implements IEnumerable<ICommand> → yield return each
  └─> For each extracted IMessage:
      └─> GetUntypedReceptorPublisher(messageType).Invoke(message)
          └─> All receptors for that message type invoked
```

**Key Points**:
- **Zero reflection**: Uses `ITuple` interface (compile-time type info)
- **AOT compatible**: Works with Native AOT and trimming
- **Recursive**: Handles nested tuples and arrays
- **Selective**: Only extracts types implementing `IMessage` (events AND commands)
- **Non-messages ignored**: DTOs and value objects pass through unchanged

### Cascades Through All Dispatch Paths

Auto-cascade works with all dispatch methods and message types:

```csharp
// Via LocalInvokeAsync - Events auto-published
var result = await _dispatcher.LocalInvokeAsync<CreateOrder, (OrderResult, OrderCreated)>(command);
// OrderCreated auto-published ✓

// Via LocalInvokeAsync - Commands auto-dispatched
var result = await _dispatcher.LocalInvokeAsync<ProcessPayment, (PaymentResult, SendNotification)>(command);
// SendNotification command auto-dispatched ✓

// Via SendAsync
var receipt = await _dispatcher.SendAsync(command);
// Any returned IEvent or ICommand auto-cascaded ✓
```

### Mixed Events and Commands

Receptors can return both events and commands in a single tuple:

```csharp
public class ProcessOrderReceptor : IReceptor<ProcessOrder, (OrderResult, OrderProcessed, SendInvoice)> {
    public ValueTask<(OrderResult, OrderProcessed, SendInvoice)> HandleAsync(
        ProcessOrder command, CancellationToken ct = default) {

        var result = new OrderResult(command.OrderId, ProcessStatus.Completed);
        var orderEvent = new OrderProcessed(command.OrderId, DateTime.UtcNow);
        var invoiceCommand = new SendInvoice(command.OrderId, command.CustomerId);

        // Return tuple with both event AND command
        return ValueTask.FromResult((result, orderEvent, invoiceCommand));
    }
}
// Result: OrderProcessed event published to perspectives
// Result: SendInvoice command dispatched to invoice receptor
```

### Best Practices

**DO**: Return messages (events and commands) alongside business results in tuples
```csharp
// ✅ GOOD: Event returned with result
public ValueTask<(OrderResult, OrderCreated)> HandleAsync(
    CreateOrder command, CancellationToken ct) {
    return ValueTask.FromResult((
        new OrderResult(command.OrderId),
        new OrderCreated(command.OrderId, command.CustomerId)
    ));
}

// ✅ GOOD: Command returned triggers follow-up action
public ValueTask<(PaymentResult, SendReceipt)> HandleAsync(
    ProcessPayment command, CancellationToken ct) {
    return ValueTask.FromResult((
        new PaymentResult(command.OrderId, PaymentStatus.Success),
        new SendReceipt(command.OrderId, command.CustomerId)  // Command auto-dispatched
    ));
}
```

**DON'T**: Return messages AND manually dispatch them
```csharp
// ❌ BAD: Double publishing!
public async ValueTask<(OrderResult, OrderCreated)> HandleAsync(
    CreateOrder command, CancellationToken ct) {

    var @event = new OrderCreated(command.OrderId, command.CustomerId);

    // DON'T DO THIS - framework already auto-publishes from return value
    await _dispatcher.PublishAsync(@event, ct);

    return (new OrderResult(command.OrderId), @event);
}
```

**DON'T**: Return empty arrays to avoid cascade
```csharp
// ⚠️ UNNECESSARY: Empty arrays are handled gracefully
public ValueTask<(OrderResult, IMessage[])> HandleAsync(
    CreateOrder command, CancellationToken ct) {

    return ValueTask.FromResult((
        new OrderResult(command.OrderId),
        Array.Empty<IMessage>()  // Fine - no messages dispatched
    ));
}
```

### Auto-Cascade to Outbox {#auto-cascade-to-outbox}

By default, cascaded events are dispatched to local receptors only. To cascade events to the outbox for cross-service delivery, use the `Route` wrapper:

**Route Wrappers**: {#routed-message-cascading}
```csharp
// Cascade to local receptors AND persist to event store (default)
return (result, new OrderCreated(orderId));

// Explicit local + event store (same as default)
return (result, Route.Local(new OrderCreated(orderId)));

// Cascade to local receptors only - NO persistence (ephemeral)
return (result, Route.LocalNoPersist(new OrderCreated(orderId)));

// Persist to event store only - NO local receptors (audit events)
return (result, Route.EventStoreOnly(new AuditEvent(userId, action)));

// Cascade to outbox only (cross-service)
return (result, Route.Outbox(new OrderCreated(orderId)));

// Cascade to both local and outbox
return (result, Route.Both(new OrderCreated(orderId)));
```

:::new
**New**: `Route.Local()` now includes automatic event store persistence. Events are stored to `wh_event_store` and perspective events are created. Use `Route.LocalNoPersist()` for the previous behavior (local receptors only, no persistence).
:::

### Event Store Only Mode {#event-store-only}

`Route.EventStoreOnly()` persists events to the event store without invoking local receptors or sending via transport. This is useful for:

- **Audit events**: Record actions without triggering business logic
- **Historical events**: Import or replay events into the store
- **Deferred processing**: Store events for later perspective rebuilds

```csharp
public class AuditReceptor : IReceptor<ProcessOrder, (OrderResult, Routed<AuditEvent>)> {
    public ValueTask<(OrderResult, Routed<AuditEvent>)> HandleAsync(
        ProcessOrder command, CancellationToken ct = default) {

        var result = new OrderResult(command.OrderId);

        // Audit event stored to event store only - no local receptors invoked
        var auditEvent = new AuditEvent(
            UserId: command.UserId,
            Action: "OrderProcessed",
            ResourceId: command.OrderId
        );

        return ValueTask.FromResult((result, Route.EventStoreOnly(auditEvent)));
    }
}
// Result: AuditEvent persisted to wh_event_store
// Result: Perspective events created for downstream projections
// Result: NO local receptors invoked
// Result: NO transport publishing (destination=null)
```

**How It Works**:
1. Event is written to `wh_outbox` with `destination=null`
2. `process_work_batch` stores event in `wh_event_store` and creates perspective events
3. `TransportPublishStrategy` skips transport (null destination = bypass)
4. Event is marked as published (completed)

**Example: Cross-Service Event Publishing**:
```csharp
public class CreateOrderReceptor : IReceptor<CreateOrder, (OrderResult, Routed<OrderCreated>)> {
    public ValueTask<(OrderResult, Routed<OrderCreated>)> HandleAsync(
        CreateOrder command, CancellationToken ct = default) {

        var result = new OrderResult(command.OrderId);
        var @event = new OrderCreated(command.OrderId, command.CustomerId);

        // Wrap with Route.Both() to cascade to local perspectives AND outbox
        return ValueTask.FromResult((result, Route.Both(@event)));
    }
}
// Result: OrderCreated published to local perspectives
// Result: OrderCreated queued in outbox for remote services
```

**How It Works**:
1. Receptor returns a `Routed<TEvent>` wrapped event
2. Dispatcher extracts the event and its routing mode
3. For `DispatchMode.Local` or `DispatchMode.Both`: Publishes to local receptors
4. For `DispatchMode.Outbox` or `DispatchMode.Both`: Calls `CascadeToOutboxAsync`
5. Generated dispatcher uses type-switch dispatch (zero reflection, AOT compatible)

**Generated Code Pattern**:
```csharp
// Generated by Whizbang.Generators
protected override Task CascadeToOutboxAsync(IMessage message, Type messageType) {
    if (messageType == typeof(OrderCreated)) {
        return PublishToOutboxAsync((OrderCreated)message, messageType, MessageId.New());
    }
    if (messageType == typeof(PaymentProcessed)) {
        return PublishToOutboxAsync((PaymentProcessed)message, messageType, MessageId.New());
    }
    // ... other event types
    return Task.CompletedTask;
}
```

**Key Points**:
- **Zero reflection**: Source generators create compile-time type-switch dispatch
- **AOT compatible**: Works with Native AOT and trimming
- **Automatic**: No manual `PublishAsync` or `SendAsync` calls needed
- **Configurable**: Per-event routing via `Route.Local()`, `Route.LocalNoPersist()`, `Route.EventStoreOnly()`, `Route.Outbox()`, `Route.Both()`, `Route.None()`

:::new
**New in 0.1.0**: Auto-cascade to outbox enables automatic cross-service event publishing from receptor return values without explicit outbox writes.
:::

:::new
**New**: `Route.LocalNoPersist()` and `Route.EventStoreOnly()` provide fine-grained control over event persistence and local dispatch.
:::

### Comparison: Manual vs Auto-Cascade

| Approach | Lines of Code | Injection Dependencies | Error Surface |
|----------|--------------|----------------------|---------------|
| Manual `PublishAsync`/`SendAsync` | More | Requires `IDispatcher` | Higher (can forget) |
| Auto-cascade (tuple return) | Fewer | None | Lower (automatic) |

:::new
**New in 0.1.0**: Auto-cascade now supports both `IEvent` and `ICommand` types. Commands returned from receptors are automatically dispatched to their respective receptors.
:::

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

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
