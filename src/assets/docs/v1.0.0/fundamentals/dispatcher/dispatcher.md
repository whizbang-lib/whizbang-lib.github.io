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
  - samples/ECommerce/ECommerce.BFF.API/Endpoints/CreateOrderEndpoint.cs
lastMaintainedCommit: '01f07906'
---

# Dispatcher Deep Dive

The **Dispatcher** is Whizbang's central message router. It provides three distinct dispatch patterns for different messaging scenarios: commands, queries, and events.

## Quick Reference

| Pattern | Use Case | Return Type | Performance | Distribution |
|---------|----------|-------------|-------------|--------------|
| `SendAsync` | Commands with delivery tracking | `IDeliveryReceipt` | ~100μs | Local or Remote |
| `LocalInvokeAsync` | In-process queries/commands | `TResult` | < 20ns | Local only |
| `LocalInvokeWithReceiptAsync` | In-process RPC with receipt | `InvokeResult<TResult>` | ~100μs | Local only |
| `LocalInvokeAndSyncAsync` | Commands with perspective sync | `TResult` / `SyncResult` | Varies | Local only |
| `PublishAsync` | Event broadcasting | `IDeliveryReceipt` | ~50μs | Local or Remote |
| `SendManyAsync` | Batch commands (local + outbox) | `IEnumerable<IDeliveryReceipt>` | Optimized | Local + Remote |
| `PublishManyAsync` | Batch event publishing | `IEnumerable<IDeliveryReceipt>` | Optimized | Local + Remote |
| `LocalSendManyAsync` | Batch local-only dispatch | `IEnumerable<IDeliveryReceipt>` | ~20ns/msg | Local only |

## IDispatcher Interface

```csharp{title="IDispatcher Interface" description="IDispatcher Interface" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "IDispatcher", "Interface"]}
namespace Whizbang.Core;

public interface IDispatcher {
    // Pattern 1: Command dispatch with delivery receipt
    Task<IDeliveryReceipt> SendAsync<TMessage>(
        TMessage message
    ) where TMessage : notnull;

    // Pattern 2: In-process RPC with typed result
    ValueTask<TResult> LocalInvokeAsync<TMessage, TResult>(
        TMessage message
    ) where TMessage : notnull;

    // In-process RPC returning both result AND delivery receipt
    ValueTask<InvokeResult<TResult>> LocalInvokeWithReceiptAsync<TMessage, TResult>(
        TMessage message
    ) where TMessage : notnull;

    // In-process RPC with perspective sync (wait for all perspectives)
    Task<TResult> LocalInvokeAndSyncAsync<TMessage, TResult>(
        TMessage message,
        TimeSpan? timeout = null,
        Action<SyncWaitingContext>? onWaiting = null,
        Action<SyncDecisionContext>? onDecisionMade = null,
        CancellationToken cancellationToken = default
    ) where TMessage : notnull;

    // Pattern 3: Event broadcasting with delivery receipt
    Task<IDeliveryReceipt> PublishAsync<TEvent>(
        TEvent eventData
    );

    // Advanced/Internal: Cascade a message using a source envelope's security context
    Task CascadeMessageAsync(
        IMessage message,
        IMessageEnvelope? sourceEnvelope,
        DispatchMode mode,
        CancellationToken cancellationToken = default);
}
```

---

## Pattern 1: SendAsync - Command Dispatch

**Use Case**: Send commands with delivery tracking, supports both local and remote dispatch.

**Signature**:
```csharp{title="Pattern 1: SendAsync - Command Dispatch" description="Pattern 1: SendAsync - Command Dispatch" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Pattern", "SendAsync"]}
Task<IDeliveryReceipt> SendAsync<TMessage>(
    TMessage message
) where TMessage : notnull;
```

**Returns**: `IDeliveryReceipt` containing message ID, correlation ID, destination, status, and metadata.

### Basic Usage

```csharp{title="Basic Usage" description="Basic Usage" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Basic", "Usage"]}
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

```csharp{title="IDeliveryReceipt Interface" description="IDeliveryReceipt Interface" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "DeliveryReceipt", "Structure"]}
public interface IDeliveryReceipt {
    MessageId MessageId { get; }              // Unique message identifier (value object)
    DateTimeOffset Timestamp { get; }         // When the message was accepted
    string Destination { get; }               // Where routed (receptor name, topic, etc.)
    DeliveryStatus Status { get; }            // Accepted, Queued, Delivered, Failed
    IReadOnlyDictionary<string, JsonElement> Metadata { get; }  // Extensible metadata
    CorrelationId? CorrelationId { get; }     // Correlation ID from message context
    MessageId? CausationId { get; }           // ID of the message that caused this one
    Guid? StreamId { get; }                   // Stream ID from [StreamId] attribute
}

public enum DeliveryStatus {
    Accepted = 0,   // Accepted by dispatcher, ready for processing
    Queued = 1,     // Queued for async processing (e.g., inbox pattern)
    Delivered = 2,  // Delivered to handler (handler executed)
    Failed = 3      // Failed to deliver or process
}

// Concrete implementation with factory methods
public sealed class DeliveryReceipt : IDeliveryReceipt {
    // Factory methods for creating receipts:
    public static DeliveryReceipt Accepted(MessageId messageId, string destination, ...);
    public static DeliveryReceipt Queued(MessageId messageId, string destination, ...);
    public static DeliveryReceipt Delivered(MessageId messageId, string destination, ...);
    public static DeliveryReceipt Failed(MessageId messageId, string destination, ...);
}
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

```csharp{title="Example: Long-Running Order Processing" description="Example: Long-Running Order Processing" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Example:", "Long-Running"]}
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
```csharp{title="Pattern 2: LocalInvokeAsync - In-Process RPC" description="Pattern 2: LocalInvokeAsync - In-Process RPC" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Pattern", "LocalInvokeAsync"]}
ValueTask<TResult> LocalInvokeAsync<TMessage, TResult>(
    TMessage message
) where TMessage : notnull;
```

**Returns**: Typed result from receptor (`TResult`).

**Performance**: < 20ns dispatch overhead, zero allocations (with object pooling).

### Basic Usage

```csharp{title="Basic Usage (2)" description="Basic Usage" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Basic", "Usage"]}
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

```csharp{title="Example: Query with Typed Response" description="Example: Query with Typed Response" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Dispatcher", "Example:", "Query"]}
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

```csharp{title="Type Safety Enforcement" description="Type Safety Enforcement" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Type", "Safety"]}
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

```csharp{title="Synchronous Receptor Invocation" description="Synchronous Receptor Invocation" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Synchronous", "Receptor"]}
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

See [Receptors: ISyncReceptor Interface](../receptors/receptors.md#isyncreceptor-interface) for when to use sync vs async receptors.

### Performance Optimization

LocalInvokeAsync achieves < 20ns overhead through:

1. **Compile-time routing**: Source generators create direct method calls
2. **Value types**: Envelope and hops use structs where possible
3. **Object pooling**: Reuse envelope instances
4. **Zero reflection**: No runtime type discovery

**Generated code example**:
```csharp{title="Performance Optimization" description="Generated code example:" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Dispatcher", "Performance", "Optimization"]}
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

## LocalInvokeAndSyncAsync - Invoke with Perspective Sync

**Use Case**: Invoke a handler and wait for ALL perspectives to process any events emitted during the invocation. This enables synchronous-feeling APIs over event-sourced systems.

**Signatures**:
```csharp{title="LocalInvokeAndSyncAsync - Invoke with Perspective Sync" description="Signatures:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "LocalInvokeAndSyncAsync", "Invoke"]}
// With typed result - waits for ALL perspectives
Task<TResult> LocalInvokeAndSyncAsync<TMessage, TResult>(
    TMessage message,
    TimeSpan? timeout = null,
    Action<SyncWaitingContext>? onWaiting = null,
    Action<SyncDecisionContext>? onDecisionMade = null,
    CancellationToken cancellationToken = default
) where TMessage : notnull;

// Void (returns SyncResult) - waits for ALL perspectives
Task<SyncResult> LocalInvokeAndSyncAsync<TMessage>(
    TMessage message,
    TimeSpan? timeout = null,
    Action<SyncWaitingContext>? onWaiting = null,
    Action<SyncDecisionContext>? onDecisionMade = null,
    CancellationToken cancellationToken = default
) where TMessage : notnull;

// With typed result - waits for a SPECIFIC perspective only
Task<TResult> LocalInvokeAndSyncAsync<TMessage, TResult, TPerspective>(
    TMessage message,
    TimeSpan? timeout = null,
    Action<SyncWaitingContext>? onWaiting = null,
    Action<SyncDecisionContext>? onDecisionMade = null,
    CancellationToken cancellationToken = default
) where TMessage : notnull
  where TPerspective : class;

// Void - waits for a SPECIFIC perspective only
Task<SyncResult> LocalInvokeAndSyncForPerspectiveAsync<TMessage, TPerspective>(
    TMessage message,
    TimeSpan? timeout = null,
    Action<SyncWaitingContext>? onWaiting = null,
    Action<SyncDecisionContext>? onDecisionMade = null,
    CancellationToken cancellationToken = default
) where TMessage : notnull
  where TPerspective : class;
```

**Callback Parameters**:
- `onWaiting`: Optional callback invoked when the sync wait begins. Only called if there are events to wait for and they have not already been processed. Not called for `SyncOutcome.NoPendingEvents`.
- `onDecisionMade`: Optional callback always invoked when the sync decision is made, regardless of outcome.

**Returns**: The business result from the handler, after all perspectives have processed the events.

### When to Use

Use `LocalInvokeAndSyncAsync` when:

- You need to query read models immediately after a command
- Building APIs that need immediate consistency
- You want to return data that includes perspective-computed values

### Basic Usage

```csharp{title="Basic Usage - OrderMutation" description="Basic Usage - OrderMutation" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Basic", "Usage"]}
public class OrderMutation {
    private readonly IDispatcher _dispatcher;

    public OrderMutation(IDispatcher dispatcher) {
        _dispatcher = dispatcher;
    }

    public async Task<OrderResult> CreateOrder(CreateOrderInput input) {
        var command = new CreateOrder(input.CustomerId, input.Items);

        // Invoke and wait for ALL perspectives to process events
        var result = await _dispatcher.LocalInvokeAndSyncAsync<CreateOrder, OrderResult>(
            command,
            timeout: TimeSpan.FromSeconds(10));

        // Safe to query read models now - they're fully updated
        return result;
    }
}
```

### SyncResult Outcomes

When using the void overload, you get a `SyncResult`:

```csharp{title="SyncResult Outcomes" description="When using the void overload, you get a SyncResult:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "SyncResult", "Outcomes"]}
var syncResult = await _dispatcher.LocalInvokeAndSyncAsync(command);

switch (syncResult.Outcome) {
    case SyncOutcome.Synced:
        // All perspectives processed successfully
        break;
    case SyncOutcome.TimedOut:
        // Handler completed but perspectives didn't finish in time
        break;
    case SyncOutcome.NoPendingEvents:
        // No events were emitted during the invocation
        break;
}
```

### Timeout Handling

For the typed result overload, a `TimeoutException` is thrown if perspectives don't complete in time:

```csharp{title="Timeout Handling" description="For the typed result overload, a TimeoutException is thrown if perspectives don't complete in time:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Timeout", "Handling"]}
try {
    var result = await _dispatcher.LocalInvokeAndSyncAsync<CreateOrder, OrderResult>(
        command,
        timeout: TimeSpan.FromSeconds(5));
} catch (TimeoutException ex) {
    // Handler completed successfully, but perspectives timed out
    // Events were still emitted and will be processed eventually
}
```

The default timeout is 30 seconds if not specified.

### How It Works

1. Invokes the handler via `LocalInvokeAsync`
2. Retrieves tracked events from `IScopedEventTracker`
3. Waits for `IEventCompletionAwaiter.WaitForEventsAsync()` to complete
4. Returns the result (or throws `TimeoutException` for the typed overload)

### Perspective-Specific Sync

When you only need one specific read model to be updated before returning, use the perspective-specific overloads. This avoids waiting for all perspectives when you only depend on one:

```csharp{title="Perspective-Specific Sync" description="Wait for a specific perspective to process events" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "LocalInvokeAndSyncAsync", "Perspective"]}
// Wait for OrderSummaryPerspective only (typed result)
var result = await _dispatcher.LocalInvokeAndSyncAsync<CreateOrder, OrderResult, OrderSummaryPerspective>(
    command,
    timeout: TimeSpan.FromSeconds(5));
// OrderSummaryPerspective is guaranteed up-to-date; other perspectives may still be processing

// Void variant for a specific perspective
var syncResult = await _dispatcher.LocalInvokeAndSyncForPerspectiveAsync<CreateOrder, OrderSummaryPerspective>(
    command,
    timeout: TimeSpan.FromSeconds(5));
```

:::new
`LocalInvokeAndSyncForPerspectiveAsync` is named differently from the result-returning overload to avoid generic type parameter ambiguity between `<TMessage, TResult>` and `<TMessage, TPerspective>`.
:::

### Sync Callbacks

Use `onWaiting` and `onDecisionMade` callbacks for observability:

```csharp{title="Sync Callbacks" description="Use callbacks for observability during perspective sync" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Dispatcher", "LocalInvokeAndSyncAsync", "Callbacks"]}
var result = await _dispatcher.LocalInvokeAndSyncAsync<CreateOrder, OrderResult>(
    command,
    timeout: TimeSpan.FromSeconds(10),
    onWaiting: ctx => _logger.LogDebug("Waiting for {Count} events to sync...", ctx.EventCount),
    onDecisionMade: ctx => _logger.LogDebug("Sync decision: {Outcome}", ctx.Outcome));
```

---

## Pattern 3: PublishAsync - Event Broadcasting

**Use Case**: Broadcast events to multiple listeners (perspectives).

**Signature**:
```csharp{title="Pattern 3: PublishAsync - Event Broadcasting" description="Pattern 3: PublishAsync - Event Broadcasting" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Pattern", "PublishAsync"]}
Task<IDeliveryReceipt> PublishAsync<TEvent>(
    TEvent eventData
);
```

**Returns**: `IDeliveryReceipt` with delivery status, correlation, and stream information.

### Basic Usage

```csharp{title="Basic Usage (4)" description="Basic Usage" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Basic", "Usage"]}
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

```csharp{title="Example: Multiple Perspectives" description="Example: Multiple Perspectives" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Dispatcher", "Example:", "Multiple"]}
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

```csharp{title="Remote Publishing with Outbox" description="Remote Publishing with Outbox" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Dispatcher", "Remote", "Publishing"]}
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
| `IDispatcher.PublishAsync` | Broadcast event | Yes (local) | Yes (remote) | `IDeliveryReceipt` |
| `IDispatcher.SendAsync` | Route command | No | Yes | `IDeliveryReceipt` |

### Correct Patterns

**For Events (most common case):**

```csharp{title="Correct Patterns" description="For Events (most common case):" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Correct", "Patterns"]}
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

```csharp{title="Correct Patterns (2)" description="For Commands:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Correct", "Patterns"]}
// ✅ CORRECT: Send command with delivery tracking
await _dispatcher.SendAsync(new ProcessPayment(orderId, amount), ct);
```

**For Direct Event Store Access (rare - infrastructure/workers only):**

```csharp{title="Correct Patterns (3)" description="For Direct Event Store Access (rare - infrastructure/workers only):" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Correct", "Patterns"]}
// ✅ CORRECT: When you need explicit transactional control
await using var work = await _workCoordinator.BeginAsync(ct);
await _eventStore.AppendAsync(streamId, @event, ct);
await work.CommitAsync(ct);
```

### Anti-Patterns to Avoid

```csharp{title="Anti-Patterns to Avoid" description="Anti-Patterns to Avoid" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Anti-Patterns", "Avoid"]}
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

```csharp{title="Pattern Comparison" description="Pattern Comparison" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Pattern", "Comparison"]}
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

## Batch Operations

### SendManyAsync

**Use Case**: Send multiple messages in a single batch, optimized with a single outbox scope and flush. Messages are processed both **locally** (if a receptor exists) and via the **outbox** (for cross-service delivery).

:::new{type="breaking"}
**Behavior Change (v0.9.10)**: `SendManyAsync` now routes messages to **both** local receptors and the outbox — matching `PublishAsync` semantics. Previously, messages with a local receptor were dispatched locally only, silently skipping outbox delivery. This caused events to not propagate cross-service when sent via `SendManyAsync`.
:::

**Signatures**:
```csharp{title="SendManyAsync" description="Signatures:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "SendManyAsync"]}
// Generic (AOT-compatible, preserves type information)
Task<IEnumerable<IDeliveryReceipt>> SendManyAsync<TMessage>(
    IEnumerable<TMessage> messages) where TMessage : notnull;

// Non-generic (backward compatible)
Task<IEnumerable<IDeliveryReceipt>> SendManyAsync(
    IEnumerable<object> messages);
```

**Returns**: `IDeliveryReceipt` per message — `Delivered` for locally-handled messages, `Accepted` for outbox-only messages.

**Example**:
```csharp{title="SendManyAsync (2)" description="SendManyAsync" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "SendManyAsync"]}
// Batch send commands — each gets local processing + outbox delivery
var commands = new[] {
    new UpdateInventory(productId1, 10),
    new UpdateInventory(productId2, -5),
    new UpdateInventory(productId3, 20)
};

var receipts = await _dispatcher.SendManyAsync(commands);
// All messages: local receptor invoked AND queued for cross-service delivery
```

**Routing Behavior**:

| Message Has Local Receptor | Has Outbox Strategy | Behavior |
|---------------------------|--------------------|----|
| Yes | Yes | Local + Outbox (receipt: Delivered) |
| Yes | No | Local only (receipt: Delivered) |
| No | Yes | Outbox only (receipt: Accepted) |
| No | No | Throws `InvalidOperationException` |

**Source**: `src/Whizbang.Core/Dispatcher.cs` · **Tests**: `tests/Whizbang.Core.Tests/Dispatcher/DispatcherOutboxTests.cs`

### PublishManyAsync

**Use Case**: Publish multiple events in a single batch with event topic routing. The batch equivalent of `PublishAsync` — events are broadcast to local handlers and queued for cross-service delivery via the outbox.

:::new{type="important"}
**v0.9.11**: `PublishManyAsync` is the recommended API for batch event publishing. Unlike `SendManyAsync`, it is semantically explicit about publishing events. Both methods now correctly route events to event topics (not command destinations).
:::

**Signatures**:
```csharp{title="Signatures" description="Signatures" category="Fundamentals" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "C#"]}
// Generic (AOT-compatible, preserves type information)
Task<IEnumerable<IDeliveryReceipt>> PublishManyAsync<TEvent>(
    IEnumerable<TEvent> events) where TEvent : notnull;

// Non-generic (backward compatible)
Task<IEnumerable<IDeliveryReceipt>> PublishManyAsync(
    IEnumerable<object> events);
```

**Returns**: `IDeliveryReceipt` per event — `Delivered` for locally-handled events, `Accepted` for outbox-only events.

**Example**:
```csharp{title="Example" description="Example" category="Fundamentals" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "C#"]}
// Batch publish events — single scope, single flush
var events = new[] {
    new OrderCreatedEvent(orderId1),
    new OrderCreatedEvent(orderId2),
    new OrderCreatedEvent(orderId3)
};

var receipts = await _dispatcher.PublishManyAsync(events);
// All events: local handlers invoked AND queued for cross-service delivery
// Events route to event topics (not command destinations)
```

**Source**: `src/Whizbang.Core/Dispatcher.cs` · **Tests**: `tests/Whizbang.Core.Tests/Dispatcher/DispatcherOutboxTests.cs`

### LocalSendManyAsync

**Use Case**: Send multiple messages to local receptors **only** — no outbox delivery. Useful when you want batch local-only processing without cross-service propagation.

**Signatures**:
```csharp{title="LocalSendManyAsync" description="Signatures:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "LocalSendManyAsync"]}
// Generic (AOT-compatible)
ValueTask<IEnumerable<IDeliveryReceipt>> LocalSendManyAsync<TMessage>(
    IEnumerable<TMessage> messages) where TMessage : notnull;

// Non-generic
ValueTask<IEnumerable<IDeliveryReceipt>> LocalSendManyAsync(
    IEnumerable<object> messages);
```

**Returns**: `IDeliveryReceipt` per message — all with `Delivered` status.

**Throws**: `ReceptorNotFoundException` if any message has no local receptor.

**Example**:
```csharp{title="LocalSendManyAsync (2)" description="LocalSendManyAsync" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "LocalSendManyAsync"]}
// Process commands locally only — no outbox, no cross-service delivery
var commands = new[] {
    new ValidateOrder(orderId1),
    new ValidateOrder(orderId2)
};

var receipts = await _dispatcher.LocalSendManyAsync(commands);
// All receipts have Status == Delivered (processed in-process)
// No outbox messages created
```

**API Design Intent**:

| Method | Local | Outbox | Use Case |
|--------|-------|--------|----------|
| `SendAsync` / `PublishAsync` | Yes | Yes | Default: full delivery |
| `SendManyAsync` | Yes | Yes | Batch: full delivery (commands + events) |
| `PublishManyAsync` | Yes | Yes | Batch: event publishing |
| `LocalInvokeAsync` | Yes | No | In-process RPC |
| `LocalSendManyAsync` | Yes | No | Batch: local only |

**Source**: `src/Whizbang.Core/Dispatcher.cs` · **Tests**: `tests/Whizbang.Core.Tests/Dispatcher/DispatcherOutboxTests.cs`

---

## LocalInvokeWithReceiptAsync - Invoke with Receipt {#local-invoke-with-receipt}

**Use Case**: Get both the typed business result AND a delivery receipt with dispatch metadata (MessageId, StreamId, CorrelationId, etc.) from a single in-process invocation. This bridges the gap between `LocalInvokeAsync` (typed result only) and `SendAsync` (receipt only).

### InvokeResult&lt;T&gt;

```csharp{title="InvokeResult Record" description="Combines a typed business result with a delivery receipt" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "InvokeResult", "Receipt"]}
public sealed record InvokeResult<TResult>(
    TResult Value,           // The business result from the receptor
    IDeliveryReceipt Receipt // Delivery receipt with MessageId, StreamId, CorrelationId, etc.
);
```

### Signatures

```csharp{title="LocalInvokeWithReceiptAsync Signatures" description="All overloads for LocalInvokeWithReceiptAsync" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "LocalInvokeWithReceiptAsync", "Signatures"]}
// Generic (AOT-compatible) - preserves type at compile time
ValueTask<InvokeResult<TResult>> LocalInvokeWithReceiptAsync<TMessage, TResult>(
    TMessage message) where TMessage : notnull;

// Non-generic
ValueTask<InvokeResult<TResult>> LocalInvokeWithReceiptAsync<TResult>(
    object message);

// With explicit message context (AOT-compatible)
ValueTask<InvokeResult<TResult>> LocalInvokeWithReceiptAsync<TMessage, TResult>(
    TMessage message,
    IMessageContext context) where TMessage : notnull;

// With dispatch options (cancellation, timeout)
ValueTask<InvokeResult<TResult>> LocalInvokeWithReceiptAsync<TResult>(
    object message, DispatchOptions options);
```

### Basic Usage

```csharp{title="LocalInvokeWithReceiptAsync Usage" description="Get both result and receipt from a single invocation" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "LocalInvokeWithReceiptAsync", "Usage"]}
[HttpPost("orders")]
public async Task<ActionResult> CreateOrder(
    [FromBody] CreateOrderRequest request,
    CancellationToken ct) {

    var command = new CreateOrder(request.CustomerId, request.Items);

    // Get both the business result AND delivery metadata
    var invokeResult = await _dispatcher
        .LocalInvokeWithReceiptAsync<CreateOrder, OrderCreated>(command);

    // Access the typed business result
    var order = invokeResult.Value;

    // Access delivery metadata for tracking
    var receipt = invokeResult.Receipt;

    return CreatedAtAction(
        nameof(GetOrder),
        new { orderId = order.OrderId },
        new {
            order,
            messageId = receipt.MessageId,
            correlationId = receipt.CorrelationId,
            streamId = receipt.StreamId
        });
}
```

**When to use**:
- API endpoints that need to return both business data and tracking metadata
- Correlation tracking where you need the MessageId alongside the result
- Scenarios requiring both typed response and stream/correlation IDs

**Performance note**: `LocalInvokeWithReceiptAsync` always takes the tracing code path (creates an envelope) since the receipt requires dispatch metadata. If you do not need the receipt, prefer `LocalInvokeAsync` for lower overhead.

**Source**: `src/Whizbang.Core/IDispatcher.cs` · **Tests**: `tests/Whizbang.Core.Tests/Dispatcher/DispatcherInvokeWithReceiptTests.cs`

---

## Error Handling

### LocalInvokeAsync Error Handling

```csharp{title="LocalInvokeAsync Error Handling" description="LocalInvokeAsync Error Handling" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "LocalInvokeAsync", "Error"]}
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

```csharp{title="SendAsync Error Handling" description="SendAsync Error Handling" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "SendAsync", "Error"]}
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

```csharp{title="PublishAsync Error Handling" description="PublishAsync Error Handling" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "PublishAsync", "Error"]}
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

```csharp{title="Pattern: Command + Event in Single Transaction" description="Pattern: Command + Event in Single Transaction" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Pattern:", "Command"]}
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

```csharp{title="Pattern: Conditional Publishing" description="Pattern: Conditional Publishing" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Pattern:", "Conditional"]}
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

```csharp{title="Pattern: Batch Processing" description="Pattern: Batch Processing" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Pattern:", "Batch"]}
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

## Automatic Message Cascade {#automatic-message-cascade}

Whizbang automatically extracts and dispatches `IMessage` instances (both `IEvent` and `ICommand`) from receptor return values. This enables a cleaner pattern where receptors can return tuples or arrays containing messages without explicit `PublishAsync` or `SendAsync` calls.

### The Problem (Without Auto-Cascade)

```csharp{title="The Problem (Without Auto-Cascade)" description="The Problem (Without Auto-Cascade)" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Problem", "Without"]}
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

```csharp{title="The Solution (With Auto-Cascade)" description="The Solution (With Auto-Cascade)" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Solution", "Auto-Cascade"]}
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
```csharp{title="Supported Return Types" description="Tuple with Event:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Supported", "Return"]}
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
```csharp{title="Supported Return Types - ShipOrderReceptor" description="Tuple with Multiple Events:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Supported", "Return"]}
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
```csharp{title="Supported Return Types - NotifyReceptor" description="Array of Events:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Supported", "Return"]}
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
```csharp{title="Supported Return Types - ComplexReceptor" description="Nested Tuples:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Supported", "Return"]}
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

```csharp{title="Cascades Through All Dispatch Paths" description="Auto-cascade works with all dispatch methods and message types:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Cascades", "Through"]}
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

```csharp{title="Mixed Events and Commands" description="Receptors can return both events and commands in a single tuple:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Mixed", "Events"]}
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
```csharp{title="Best Practices" description="DO: Return messages (events and commands) alongside business results in tuples" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Best", "Practices"]}
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
```csharp{title="Best Practices (2)" description="DON'T: Return messages AND manually dispatch them" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Best", "Practices"]}
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
```csharp{title="Best Practices (3)" description="DON'T: Return empty arrays to avoid cascade" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Best", "Practices"]}
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
```csharp{title="Auto-Cascade to Outbox" description="Route Wrappers: {#routed-message-cascading}" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Auto-Cascade", "Outbox"]}
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

```csharp{title="Event Store Only Mode" description="- Audit events: Record actions without triggering business logic - Historical events: Import or replay events into the" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Event", "Store"]}
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
```csharp{title="Event Store Only Mode - CreateOrderReceptor" description="Example: Cross-Service Event Publishing:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Event", "Store"]}
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
5. For `DispatchMode.EventStoreOnly`: Persists to event store only (no local dispatch, no transport)
6. Generated dispatcher uses type-switch dispatch (zero reflection, AOT compatible)

### DispatchMode Flags Enum

`DispatchMode` is a `[Flags]` enum composed from three base flags: `LocalDispatch` (1), `Outbox` (2), and `EventStore` (4). The named convenience values combine these flags:

| Mode | Value | Flags Composition | Local Receptors | Event Store | Outbox |
|------|-------|-------------------|-----------------|-------------|--------|
| `None` | 0 | _(none)_ | No | No | No |
| `LocalNoPersist` | 1 | `LocalDispatch` | Yes | No | No |
| `Local` | 5 | `LocalDispatch \| EventStore` | Yes | Yes | No |
| `Outbox` | 2 | `Outbox` | No | Yes (via outbox) | Yes |
| `Both` | 3 | `LocalDispatch \| Outbox` | Yes | Yes (via outbox) | Yes |
| `EventStoreOnly` | 4 | `EventStore` | No | Yes | No |

Each `Route.*()` factory method maps to one of these modes:

| Route Method | DispatchMode | Description |
|---|---|---|
| `Route.Local(value)` | `Local` | Local receptors + event store persistence |
| `Route.LocalNoPersist(value)` | `LocalNoPersist` | Local receptors only, no persistence (ephemeral) |
| `Route.Outbox(value)` | `Outbox` | Outbox for cross-service transport |
| `Route.Both(value)` | `Both` | Local receptors + outbox transport |
| `Route.EventStoreOnly(value)` | `EventStoreOnly` | Event store only, no local dispatch |
| `Route.None()` | _(RoutedNone)_ | No dispatch; used in discriminated union tuples |

**Generated Code Pattern**: {#cascade-to-outbox}
```csharp{title="Event Store Only Mode (3)" description="Generated Code Pattern: {#cascade-to-outbox}" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Dispatcher", "Event", "Store"]}
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

### Security Context in Cascade {#cascade-security-context}

When events are cascaded to receptors (via auto-cascade or `CascadeMessageAsync`), **security context automatically propagates** from the source envelope to the new DI scope created for receptor execution.

This ensures cascaded receptors have access to:
- `IMessageContext.UserId` - Original user who initiated the request
- `IMessageContext.TenantId` - Tenant context from the source message
- `IScopeContextAccessor.Current` - Full security scope
- `UserContextManager.TenantContext` - Tenant-scoped context

**Example Flow**:
```csharp{title="Security Context in Cascade" description="Example Flow:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Security", "Context"]}
// 1. HTTP request with UserId = "user@test.com", TenantId = "tenant-123"
public class OrderCommandHandler : IReceptor<CreateOrder, OrderCreated> {
    private readonly IMessageContext _context;

    public OrderCommandHandler(IMessageContext context) {
        _context = context;
    }

    public ValueTask<OrderCreated> HandleAsync(CreateOrder cmd) {
        // ✅ Security context available: _context.UserId = "user@test.com"
        return ValueTask.FromResult(new OrderCreated(cmd.OrderId));
    }
}

// 2. Event auto-cascades to OrderCreatedReceptor
public class OrderCreatedReceptor : IReceptor<OrderCreated> {
    private readonly IMessageContext _context;
    private readonly UserContextManager _userContext;

    public OrderCreatedReceptor(
        IMessageContext context,
        UserContextManager userContext) {
        _context = context;
        _userContext = userContext;
    }

    public ValueTask HandleAsync(OrderCreated evt) {
        // ✅ Security context propagated from command handler!
        //    _context.UserId = "user@test.com"
        //    _context.TenantId = "tenant-123"
        //    _userContext.TenantContext is set correctly

        return ValueTask.CompletedTask;
    }
}
```

**How It Works**:

The generated `GetUntypedReceptorPublisher` method creates a new DI scope for each cascade and establishes security context before invoking receptors:

```csharp{title="Security Context in Cascade (2)" description="The generated GetUntypedReceptorPublisher method creates a new DI scope for each cascade and establishes security" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Dispatcher", "Security", "Context"]}
// Generated by Whizbang.Generators
protected override Func<object, IMessageEnvelope?, CancellationToken, Task>?
    GetUntypedReceptorPublisher(Type eventType) {

    if (eventType == typeof(OrderCreated)) {
        async Task PublishToReceptorsUntyped(
            object evt,
            IMessageEnvelope? sourceEnvelope,
            CancellationToken cancellationToken) {

            var scope = _scopeFactory.CreateScope();
            try {
                // ✅ Establish security context from source envelope
                if (sourceEnvelope is not null) {
                    await SecurityContextHelper.EstablishFullContextAsync(
                        sourceEnvelope,
                        scope.ServiceProvider,
                        cancellationToken);
                }

                // Now receptors can access UserId, TenantId via IMessageContext
                var receptors = scope.ServiceProvider
                    .GetServices<IReceptor<OrderCreated>>();

                foreach (var receptor in receptors) {
                    await receptor.HandleAsync((OrderCreated)evt, cancellationToken);
                }
            } finally {
                await scope.DisposeAsync();
            }
        }

        return PublishToReceptorsUntyped;
    }
    // ... other event types
}
```

**Null Envelope Scenarios**:

Some cascade paths don't have a source envelope:
- **RPC Local Invoke** (`CascadeExcludingResponse`) - No envelope available, receptors run without security context
- **System-initiated events** - Timer/scheduler triggers have no user context

In these cases, receptors run without security context, which is expected behavior. If you need security context in these scenarios, establish it explicitly before dispatch using `AsSystem()` or `RunAs()`.

**Key Points**:
- **Automatic propagation**: No manual context passing required
- **New scope per cascade**: Each cascade creates an isolated DI scope
- **AOT compatible**: Zero reflection, compile-time type-switch dispatch
- **Transitive propagation**: Nested dispatches from cascaded receptors inherit security context

:::new
**New**: Security context now automatically propagates through all cascade paths, enabling cascaded receptors to access user and tenant context from the original request.
:::

---

## Dispatcher Configuration Options {#dispatch-options}

`DispatchOptions` provides fine-grained control over dispatch behavior, including cancellation, timeouts, and perspective synchronization.

### Basic Options

```csharp{title="Basic Options" description="Basic Options" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Basic", "Options"]}
// Cancellation token
using var cts = new CancellationTokenSource();
var options = new DispatchOptions().WithCancellationToken(cts.Token);
await dispatcher.SendAsync(command, options);

// Timeout
var options = new DispatchOptions().WithTimeout(TimeSpan.FromSeconds(30));
await dispatcher.SendAsync(command, options);

// Chained fluent API
var options = new DispatchOptions()
    .WithCancellationToken(cts.Token)
    .WithTimeout(TimeSpan.FromMinutes(5));
```

### Perspective Synchronization

Wait for all perspectives to finish processing cascaded events before returning:

```csharp{title="Perspective Synchronization" description="Wait for all perspectives to finish processing cascaded events before returning:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Perspective", "Synchronization"]}
// Wait with default timeout (30 seconds)
var options = new DispatchOptions().WithPerspectiveWait();
var result = await dispatcher.LocalInvokeAsync<CreateOrder, OrderCreated>(
    command,
    options
);

// Wait with custom timeout
var options = new DispatchOptions().WithPerspectiveWait(TimeSpan.FromMinutes(2));
```

**Use cases**:
- RPC-style calls requiring immediate consistency
- APIs that query read models after commands
- GraphQL mutations returning freshly updated data

**How it works**:
1. Invokes the receptor via `LocalInvokeAsync`
2. Tracks all cascaded events via `IScopedEventTracker`
3. Waits for `IEventCompletionAwaiter.WaitForEventsAsync()` to complete
4. Returns the result (or throws `TimeoutException` if perspectives don't finish in time)

**Alternative API**: Use `LocalInvokeAndSyncAsync` for built-in perspective synchronization without explicit options:

```csharp{title="Perspective Synchronization (2)" description="Alternative API: Use LocalInvokeAndSyncAsync for built-in perspective synchronization without explicit options:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Perspective", "Synchronization"]}
// Equivalent to LocalInvokeAsync with DispatchOptions.WithPerspectiveWait()
var result = await dispatcher.LocalInvokeAndSyncAsync<CreateOrder, OrderCreated>(
    command,
    timeout: TimeSpan.FromSeconds(10)
);
```

See [LocalInvokeAndSyncAsync](#localinvokeandsyncasync---invoke-with-perspective-sync) for details.

### DispatchOptions Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `CancellationToken` | `CancellationToken` | `None` | Cancels the dispatch operation |
| `Timeout` | `TimeSpan?` | `null` | Maximum time for dispatch completion |
| `WaitForPerspectives` | `bool` | `false` | Wait for all perspectives to finish |
| `PerspectiveWaitTimeout` | `TimeSpan` | 30 seconds | Timeout for perspective processing |

### Example: Timeout Handling

```csharp{title="Example: Timeout Handling" description="Example: Timeout Handling" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Example:", "Timeout"]}
try {
    var options = new DispatchOptions()
        .WithTimeout(TimeSpan.FromSeconds(5))
        .WithPerspectiveWait();

    var result = await dispatcher.LocalInvokeAsync<CreateOrder, OrderCreated>(
        command,
        options
    );
} catch (OperationCanceledException ex) {
    // Timeout exceeded
    _logger.LogWarning(ex, "Command timed out after 5 seconds");
} catch (TimeoutException ex) {
    // Perspectives didn't finish in time (but command succeeded)
    _logger.LogWarning(ex, "Perspectives timed out (command succeeded)");
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

```csharp{title="Object Pooling" description="Whizbang uses object pooling for message envelopes:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Object", "Pooling"]}
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

```csharp{title="Outbox Pattern" description="SendAsync integrates with the Outbox pattern:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Outbox", "Pattern"]}
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

See [Outbox Pattern](../../messaging/outbox-pattern.md) for details.

### Inbox Pattern

`SendAsync` integrates with the Inbox pattern for exactly-once processing:

```csharp{title="Inbox Pattern" description="SendAsync integrates with the Inbox pattern for exactly-once processing:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Inbox", "Pattern"]}
// Check inbox for duplicate
var existing = await _coordinator.FindInboxMessageAsync(messageId);

if (existing is not null) {
    // Duplicate detected - return cached result
    return existing.Result;
}

// Process message
var result = await _dispatcher.LocalInvokeAsync<TMessage, TResult>(message);

// Store in inbox
await _coordinator.ProcessWorkBatchAsync(
    /* ... */,
    newInboxMessages: [
        new InboxMessage(messageId, result)
    ],
    /* ... */
);
```

See [Inbox Pattern](../../messaging/inbox-pattern.md) for details.

---

## Testing

### Testing with Dispatcher

```csharp{title="Testing with Dispatcher" description="Testing with Dispatcher" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "C#", "Testing"]}
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

## DispatchOptions {#dispatch-options}

`DispatchOptions` controls cancellation, timeouts, and perspective wait behavior for dispatch operations. All `SendAsync`, `LocalInvokeAsync`, `PublishAsync`, and `LocalInvokeWithReceiptAsync` methods accept an optional `DispatchOptions` parameter.

### Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `CancellationToken` | `CancellationToken` | `CancellationToken.None` | Token to cancel the dispatch operation. Throws `OperationCanceledException` when cancelled. |
| `Timeout` | `TimeSpan?` | `null` (no timeout) | Maximum time to wait for dispatch completion. Throws `OperationCanceledException` when exceeded. |
| `WaitForPerspectives` | `bool` | `false` | When `true`, `LocalInvokeAsync` waits for all perspectives to finish processing cascaded events before returning. |
| `PerspectiveWaitTimeout` | `TimeSpan` | 30 seconds | Timeout for waiting for perspectives. Only used when `WaitForPerspectives` is `true`. |

### Fluent API

```csharp{title="DispatchOptions Fluent API" description="Fluent builder methods for DispatchOptions" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "DispatchOptions", "Fluent"]}
// With cancellation token
using var cts = new CancellationTokenSource();
var options = new DispatchOptions().WithCancellationToken(cts.Token);
await dispatcher.SendAsync(command, options);

// With timeout
var options = new DispatchOptions().WithTimeout(TimeSpan.FromSeconds(30));
await dispatcher.SendAsync(command, options);

// Chained fluent API
var options = new DispatchOptions()
    .WithCancellationToken(cts.Token)
    .WithTimeout(TimeSpan.FromMinutes(5));

// Wait for perspectives with default timeout (30s)
var options = new DispatchOptions().WithPerspectiveWait();
await dispatcher.LocalInvokeAsync<TResult>(command, options);

// Wait for perspectives with custom timeout
var options = new DispatchOptions().WithPerspectiveWait(TimeSpan.FromMinutes(2));
```

### Perspective Wait

Use `WithPerspectiveWait()` for RPC-style calls where you need all perspectives to have processed cascaded events before the response is returned to the caller:

```csharp{title="DispatchOptions Perspective Wait" description="Wait for perspectives to complete before returning" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "DispatchOptions", "PerspectiveWait"]}
[HttpPost("orders")]
public async Task<ActionResult<OrderResult>> CreateOrder(
    [FromBody] CreateOrderRequest request,
    CancellationToken ct) {

    var command = new CreateOrder(request.CustomerId, request.Items);

    var options = new DispatchOptions()
        .WithCancellationToken(ct)
        .WithPerspectiveWait(TimeSpan.FromSeconds(10));

    // All perspectives will have processed events before this returns
    var result = await _dispatcher.LocalInvokeAsync<OrderResult>(command, options);

    return Ok(result);
}
```

**Source**: `src/Whizbang.Core/Dispatch/DispatchOptions.cs` · **Tests**: `tests/Whizbang.Core.Tests/Dispatch/DispatchOptionsTests.cs`

---

## Further Reading

**Core Concepts**:
- [Receptors](../receptors/receptors.md) - Message handlers that dispatcher invokes
- [Perspectives](../perspectives/perspectives.md) - Event listeners for read models
- [Message Context](../messages/message-context.md) - Correlation and causation tracking

**Messaging Patterns**:
- [Outbox Pattern](../../messaging/outbox-pattern.md) - Reliable event publishing
- [Inbox Pattern](../../messaging/inbox-pattern.md) - Exactly-once processing
- [Work Coordination](../../messaging/work-coordinator.md) - Distributed work coordination

**Examples**:
- ECommerce: Order Service - Real-world dispatcher usage

### For Contributors

Looking to extend or customize dispatch behavior? See:
- [Custom Dispatchers](../../extending/extensibility/custom-dispatchers.md) — Build custom dispatch strategies like mediator patterns or event sourcing dispatchers

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
