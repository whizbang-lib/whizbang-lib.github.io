---
title: Dispatch Patterns
pageType: reference
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Core Concepts
order: 2
description: >-
  Deep reference for the three dispatch patterns — SendAsync, LocalInvokeAsync,
  PublishAsync — plus sync/receipt variants, batch operations, and error handling
tags: 'dispatcher, sendasync, localinvokeasync, publishasync, batch, patterns'
codeReferences:
  - src/Whizbang.Core/IDispatcher.cs
  - src/Whizbang.Core/Dispatcher.cs
  - src/Whizbang.Core/IDeliveryReceipt.cs
  - src/Whizbang.Core/Dispatch/InvokeResult.cs
testReferences:
  - tests/Whizbang.Core.Tests/Dispatcher/DispatcherTests.cs
  - tests/Whizbang.Core.Tests/Dispatcher/DispatcherInvokeWithReceiptTests.cs
  - tests/Whizbang.Core.Tests/DeliveryReceiptTests.cs
---

# Dispatch Patterns

Deep-dive reference for each dispatch pattern. For the decision matrix, interface overview, and configuration, see the [Dispatcher overview](dispatcher).
## Pattern 1: SendAsync - Command Dispatch

**Use Case**: Send commands with delivery tracking, supports both local and remote dispatch.

**Signature**:
```csharp{title="Pattern 1: SendAsync - Command Dispatch" description="Pattern 1: SendAsync - Command Dispatch" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Pattern", "SendAsync"] tests=["DispatcherTests.Send_WithValidMessage_ShouldReturnDeliveryReceiptAsync"]}
Task<IDeliveryReceipt> SendAsync<TMessage>(
    TMessage message
) where TMessage : notnull;
```

**Returns**: `IDeliveryReceipt` containing message ID, correlation ID, destination, status, and metadata.

### Basic Usage

```csharp{title="Basic Usage" description="Basic Usage" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Basic", "Usage"] tests=["DispatcherTests.Send_WithValidMessage_ShouldReturnDeliveryReceiptAsync"]}
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
        var receipt = await _dispatcher.SendAsync(command);

        return Accepted(new {
            messageId = receipt.MessageId,
            correlationId = receipt.CorrelationId,
            timestamp = receipt.Timestamp
        });
    }
}
```

### Verified example

This snippet is verbatim from the library's test suite and drift-checked in CI — if the test changes, the docs build flags this page:

```csharp{
title: "SendAsync returns a delivery receipt"
description: "Verbatim from DispatcherTests; drift-checked against the library by verify-sample-drift.mjs"
category: "Architecture"
difficulty: "BEGINNER"
tags: ["Fundamentals", "Dispatcher", "SendAsync", "Verified"]
testFile: "tests/Whizbang.Core.Tests/Dispatcher/DispatcherTests.cs"
testMethod: "Send_WithValidMessage_ShouldReturnDeliveryReceiptAsync"
tests: ["DispatcherTests.Send_WithValidMessage_ShouldReturnDeliveryReceiptAsync"]
}
var command = new CreateOrder(Guid.NewGuid(), ["item1", "item2"]);

// Act
var receipt = await dispatcher.SendAsync(command);

// Assert
await Assert.That(receipt).IsNotNull();
await Assert.That(receipt.MessageId.Value).IsNotEqualTo(Guid.Empty);
await Assert.That(receipt.Status).IsEqualTo(DeliveryStatus.Delivered);
await Assert.That(receipt.Destination).Contains("CreateOrder");
```

### DeliveryReceipt Structure

```csharp{title="IDeliveryReceipt Interface" description="IDeliveryReceipt Interface" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "DeliveryReceipt", "Structure"] tests=["DeliveryReceiptTests.AllProperties_AreAccessible_ThroughInterfaceAsync", "DeliveryReceiptTests.Accepted_CreatesReceiptWithAcceptedStatusAsync", "DeliveryReceiptTests.Queued_CreatesReceiptWithQueuedStatusAsync", "DeliveryReceiptTests.Delivered_CreatesReceiptWithDeliveredStatusAsync", "DeliveryReceiptTests.Failed_CreatesReceiptWithFailedStatusAsync", "DeliveryReceiptTests.StreamId_IsAccessible_ThroughInterfaceAsync"]}
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

```mermaid{caption="SendAsync flow — the caller gets a delivery receipt after the receptor runs and the event is queued to the outbox; a background worker later publishes it to the transport." tests=["DispatcherTests.Send_WithValidMessage_ShouldReturnDeliveryReceiptAsync"]}
graph TB
    subgraph Client["Client"]
        C1["dispatcher.SendAsync(command)"]
        C2["Envelope created (MessageId, CorrelationId)"]
        C3["Receptor invoked locally"]
        C4["Event stored in Outbox"]
        C5["DeliveryReceipt returned"]
        C1 --> C2 --> C3 --> C4 --> C5
    end

    subgraph Worker["Background Worker"]
        W1["Polls Outbox"]
        W2["Publishes event to transport (Azure Service Bus)"]
        W3["Marks message as Published"]
        W1 --> W2 --> W3
    end

    style C4 fill:#fff3cd,stroke:#ffc107
    style W1 fill:#fff3cd,stroke:#ffc107
    style W2 fill:#fff3cd,stroke:#ffc107
```

**Key Points**:
- **Asynchronous semantics**: Receipt doesn't mean message is processed, just accepted
- **Outbox integration**: Event stored for reliable delivery
- **Idempotency**: Use `MessageId` to detect duplicates

### Example: Long-Running Order Processing

```csharp{title="Example: Long-Running Order Processing" description="Example: Long-Running Order Processing" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Example:", "Long-Running"] tests=["DispatcherTests.Send_WithValidMessage_ShouldReturnDeliveryReceiptAsync"]}
[HttpPost("orders")]
public async Task<ActionResult> CreateOrder(
    [FromBody] CreateOrderRequest request,
    CancellationToken ct) {

    var command = new CreateOrder(
        CustomerId: request.CustomerId,
        Items: request.Items
    );

    // Send command - returns immediately with receipt
    var receipt = await _dispatcher.SendAsync(command);

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
```csharp{title="Pattern 2: LocalInvokeAsync - In-Process RPC" description="Pattern 2: LocalInvokeAsync - In-Process RPC" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Pattern", "LocalInvokeAsync"] tests=["DispatcherTests.LocalInvoke_WithValidMessage_ShouldReturnBusinessResultAsync"]}
ValueTask<TResult> LocalInvokeAsync<TMessage, TResult>(
    TMessage message
) where TMessage : notnull;
```

**Returns**: Typed result from receptor (`TResult`).

**Performance**: < 20ns dispatch overhead, zero allocations (with object pooling).

### Basic Usage

```csharp{title="Basic Usage (2)" description="Basic Usage" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Basic", "Usage"] tests=["DispatcherTests.LocalInvoke_WithValidMessage_ShouldReturnBusinessResultAsync", "DispatcherTests.Publish_WithEvent_ShouldNotifyAllHandlersAsync"]}
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
        command
    );

    // Publish event to perspectives
    await _dispatcher.PublishAsync(result);

    return CreatedAtAction(
        nameof(GetOrder),
        new { orderId = result.OrderId },
        result
    );
}
```

### LocalInvokeAsync Flow

```mermaid{caption="LocalInvokeAsync flow — the dispatcher resolves the receptor from the compile-time registry and returns its typed result with sub-20ns overhead and zero allocations." tests=["DispatcherTests.LocalInvoke_WithValidMessage_ShouldReturnBusinessResultAsync"]}
graph TB
    subgraph Client["Client"]
        L1["dispatcher.LocalInvokeAsync&lt;CreateOrder, OrderCreated&gt;(command)"]
        L2["Lookup receptor in registry (compile-time, zero reflection)"]
        L3["Invoke receptor.HandleAsync(command)"]
        L4["Return typed response"]
        L5["&lt; 20ns overhead (zero allocations)"]
        L1 --> L2 --> L3 --> L4 --> L5
    end

    style L3 fill:#d4edda,stroke:#28a745
```

**Key Points**:
- **Compile-time safety**: Type mismatch = compiler error
- **Zero reflection**: Routing generated at compile time
- **Synchronous semantics**: Waits for receptor to complete
- **Local only**: Cannot cross process boundaries
- **Performance**: Optimal for in-process commands/queries

### Example: Query with Typed Response

```csharp{title="Example: Query with Typed Response" description="Example: Query with Typed Response" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Dispatcher", "Example:", "Query"] tests=["DispatcherTests.LocalInvoke_WithValidMessage_ShouldReturnBusinessResultAsync"]}
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
            query
        );

        return Ok(details);
    } catch (NotFoundException ex) {
        return NotFound(new { error = ex.Message });
    }
}
```

### Type Safety Enforcement

```csharp{title="Type Safety Enforcement" description="Type Safety Enforcement" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Type", "Safety"] unverified="compile-time type-safety demo — the wrong overload is a compiler error, not a runtime assertion"}
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

```csharp{title="Synchronous Receptor Invocation" description="Synchronous Receptor Invocation" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Synchronous", "Receptor"] tests=["DispatcherSyncTests.LocalInvokeAsync_SyncReceptor_InvokesSynchronouslyAsync", "DispatcherSyncTests.LocalInvokeAsync_SyncReceptor_ReturnsCompletedValueTaskAsync"]}
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
```csharp{title="Performance Optimization" description="Generated code example:" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Dispatcher", "Performance", "Optimization"] unverified="illustrative sketch of source-generator output — not a runtime-asserted snippet"}
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

## LocalInvokeAndSyncAsync - Invoke with Perspective Sync {#local-invoke-and-sync}

**Use Case**: Invoke a handler and wait for ALL perspectives to process any events emitted during the invocation. This enables synchronous-feeling APIs over event-sourced systems.

:::updated
The timeout-shaped overloads below (`TimeSpan? timeout`, `onWaiting`/`onDecisionMade` callbacks) are marked `[Obsolete]` as of the W4 dispatcher cleanup and will be removed in the next major. The replacement is the CancellationToken-only overload `LocalInvokeAndSyncAsync<TMessage>(message, SyncMode, CancellationToken)` — see [SyncMode — Read-After-Write Dispatch](sync-mode). `LocalInvokeAndSyncForPerspectiveAsync` is not obsolete. The legacy overloads still function; migrate when convenient.
:::

**Signatures**:
```csharp{title="LocalInvokeAndSyncAsync - Invoke with Perspective Sync" description="Signatures:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "LocalInvokeAndSyncAsync", "Invoke"] unverified="verified by DispatcherSyncModeContractTests, which is outside the current coverage map"}
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

```csharp{title="Basic Usage - OrderMutation" description="Basic Usage - OrderMutation" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Basic", "Usage"] unverified="verified by DispatcherLocalInvokeAndSyncTimingTests, which is outside the current coverage map"}
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

```csharp{title="SyncResult Outcomes" description="When using the void overload, you get a SyncResult:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "SyncResult", "Outcomes"] unverified="verified by DispatcherLocalInvokeAndSyncTimingTests, which is outside the current coverage map"}
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

```csharp{title="Timeout Handling" description="For the typed result overload, a TimeoutException is thrown if perspectives don't complete in time:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Timeout", "Handling"] unverified="verified by DispatcherLocalInvokeAndSyncTimingTests, which is outside the current coverage map"}
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

```csharp{title="Perspective-Specific Sync" description="Wait for a specific perspective to process events" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "LocalInvokeAndSyncAsync", "Perspective"] unverified="verified by DispatcherSyncModeBehaviorTests, which is outside the current coverage map"}
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

```csharp{title="Sync Callbacks" description="Use callbacks for observability during perspective sync" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Dispatcher", "LocalInvokeAndSyncAsync", "Callbacks"] unverified="verified by DispatcherLocalInvokeAndSyncCallbackTests, which is outside the current coverage map"}
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
```csharp{title="Pattern 3: PublishAsync - Event Broadcasting" description="Pattern 3: PublishAsync - Event Broadcasting" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Pattern", "PublishAsync"] tests=["DispatcherTests.Publish_WithEvent_ShouldNotifyAllHandlersAsync"]}
Task<IDeliveryReceipt> PublishAsync<TEvent>(
    TEvent eventData
);
```

**Returns**: `IDeliveryReceipt` with delivery status, correlation, and stream information.

### Basic Usage

```csharp{title="Basic Usage (4)" description="Basic Usage" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Basic", "Usage"] tests=["DispatcherTests.LocalInvoke_WithValidMessage_ShouldReturnBusinessResultAsync", "DispatcherTests.Publish_WithEvent_ShouldNotifyAllHandlersAsync"]}
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
        command
    );

    // 2. Publish event to all perspectives
    await _dispatcher.PublishAsync(result);

    return CreatedAtAction(nameof(GetOrder), new { orderId = result.OrderId }, result);
}
```

### PublishAsync Flow

```mermaid{caption="PublishAsync flow — one event fans out to every perspective registered for that event type, each updated in parallel." tests=["DispatcherTests.Publish_WithEvent_ShouldNotifyAllHandlersAsync"]}
graph TB
    subgraph Client["Client"]
        P1["dispatcher.PublishAsync(event)"]
        P2["Find all perspectives for event type"]
        P3["Invoke each perspective.UpdateAsync(event)"]
        P4["OrderSummaryPerspective.UpdateAsync(OrderCreated)"]
        P5["InventoryPerspective.UpdateAsync(OrderCreated)"]
        P6["AnalyticsPerspective.UpdateAsync(OrderCreated)"]
        P7["All perspectives updated (parallel execution)"]
        P1 --> P2 --> P3
        P3 --> P4 --> P7
        P3 --> P5 --> P7
        P3 --> P6 --> P7
    end

    style P4 fill:#cce5ff,stroke:#004085
    style P5 fill:#cce5ff,stroke:#004085
    style P6 fill:#cce5ff,stroke:#004085
```

**Key Points**:
- **Multiple listeners**: One event triggers multiple perspectives
- **Fire-and-forget**: Doesn't wait for perspectives to complete (async)
- **Local broadcast**: All perspectives in current process
- **Outbox integration**: Event can be stored for remote publishing

### Example: Multiple Perspectives

```csharp{title="Example: Multiple Perspectives" description="Example: Multiple Perspectives" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Dispatcher", "Example:", "Multiple"] tests=["DispatcherTests.Publish_WithEvent_ShouldNotifyAllHandlersAsync"]}
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

```csharp{title="Remote Publishing with Outbox" description="Remote Publishing with Outbox" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Dispatcher", "Remote", "Publishing"] tests=["DispatcherCascadeTests.LocalInvokeAsync_TupleWithEvent_AutoPublishesEventAsync"]}
// In a receptor, you never write to the outbox by hand.
// Return the event (auto-cascade) — the framework serializes it to wh_outbox
// and a background worker publishes it to the transport.
public class CreateOrderReceptor : IReceptor<CreateOrder, (OrderResult, OrderCreated)> {
    public ValueTask<(OrderResult, OrderCreated)> HandleAsync(
        CreateOrder message,
        CancellationToken ct = default) {

        // Business logic...
        var result = new OrderResult(message.OrderId);
        var @event = new OrderCreated(/* ... */);

        // Default cascade mode routes through the outbox for cross-service delivery.
        // Use Route.Both(@event) to also invoke local receptors, or
        // Route.Local(@event) for local receptors + event store persistence only.
        return ValueTask.FromResult((result, @event));
    }
}
```

The outbox write itself happens inside the framework: the dispatcher serializes the cascaded event to `wh_outbox` (via `IWorkCoordinator`), and the outbox workers publish it to the transport. See [Auto-Cascade to Outbox](#auto-cascade-to-outbox) and [Outbox Pattern](../../messaging/outbox-pattern.md).

---

## Batch Operations

### SendManyAsync

**Use Case**: Send multiple messages in a single batch, optimized with a single outbox scope and flush. Messages are processed both **locally** (if a receptor exists) and via the **outbox** (for cross-service delivery).

:::new{type="breaking"}
**Behavior Change (v0.9.10)**: `SendManyAsync` now routes messages to **both** local receptors and the outbox — matching `PublishAsync` semantics. Previously, messages with a local receptor were dispatched locally only, silently skipping outbox delivery. This caused events to not propagate cross-service when sent via `SendManyAsync`.
:::

**Signatures**:
```csharp{title="SendManyAsync" description="Signatures:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "SendManyAsync"] tests=["DispatcherTests.SendManyAsync_Generic_CreatesTypedEnvelopesAsync", "DispatcherTests.SendManyAsync_Generic_DifferentFromNonGenericVersionAsync"]}
// Generic (AOT-compatible, preserves type information)
Task<IEnumerable<IDeliveryReceipt>> SendManyAsync<TMessage>(
    IEnumerable<TMessage> messages) where TMessage : notnull;

// Non-generic (backward compatible)
Task<IEnumerable<IDeliveryReceipt>> SendManyAsync(
    IEnumerable<object> messages);
```

**Returns**: `IDeliveryReceipt` per message — `Delivered` for locally-handled messages, `Accepted` for outbox-only messages.

**Example**:
```csharp{title="SendManyAsync (2)" description="SendManyAsync" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "SendManyAsync"] tests=["DispatcherTests.SendMany_WithMultipleCommands_ShouldReturnAllReceiptsAsync"]}
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
```csharp{title="Signatures" description="Signatures" category="Fundamentals" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "C#"] tests=["DispatcherOutboxTests.PublishManyAsync_Generic_QueuesAllEventsWithEventRoutingAsync", "DispatcherOutboxTests.PublishManyAsync_NonGeneric_QueuesAllEventsWithEventRoutingAsync"]}
// Generic (AOT-compatible, preserves type information)
Task<IEnumerable<IDeliveryReceipt>> PublishManyAsync<TEvent>(
    IEnumerable<TEvent> events) where TEvent : notnull;

// Non-generic (backward compatible)
Task<IEnumerable<IDeliveryReceipt>> PublishManyAsync(
    IEnumerable<object> events);
```

**Returns**: `IDeliveryReceipt` per event — `Delivered` for locally-handled events, `Accepted` for outbox-only events.

**Example**:
```csharp{title="Example" description="Example" category="Fundamentals" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "C#"] tests=["DispatcherOutboxTests.PublishManyAsync_Generic_QueuesAllEventsWithEventRoutingAsync"]}
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

### LocalSendManyAsync {#localsendmanyasync}

**Use Case**: Send multiple messages to local receptors **only** — no outbox delivery. Useful when you want batch local-only processing without cross-service propagation.

**Signatures**:
```csharp{title="LocalSendManyAsync" description="Signatures:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "LocalSendManyAsync"] tests=["DispatcherOutboxTests.LocalSendManyAsync_Generic_ProcessesAllMessagesLocallyAsync", "DispatcherOutboxTests.LocalSendManyAsync_NonGeneric_ProcessesAllMessagesLocallyAsync"]}
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
```csharp{title="LocalSendManyAsync (2)" description="LocalSendManyAsync" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "LocalSendManyAsync"] tests=["DispatcherOutboxTests.LocalSendManyAsync_Generic_ProcessesAllMessagesLocallyAsync", "DispatcherOutboxTests.LocalSendManyAsync_Generic_WithLocalReceptor_DoesNotPublishToOutboxAsync"]}
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

{verified: DispatcherInvokeWithReceiptTests.LocalInvokeWithReceipt_ReturnsBusinessResultAndReceiptAsync}

**Use Case**: Get both the typed business result AND a delivery receipt with dispatch metadata (MessageId, StreamId, CorrelationId, etc.) from a single in-process invocation. This bridges the gap between `LocalInvokeAsync` (typed result only) and `SendAsync` (receipt only).

### InvokeResult&lt;T&gt;

```csharp{title="InvokeResult Record" description="Combines a typed business result with a delivery receipt" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "InvokeResult", "Receipt"] tests=["DispatcherInvokeWithReceiptTests.LocalInvokeWithReceipt_ReturnsBusinessResultAndReceiptAsync"]}
public sealed record InvokeResult<TResult>(
    TResult Value,           // The business result from the receptor
    IDeliveryReceipt Receipt // Delivery receipt with MessageId, StreamId, CorrelationId, etc.
);
```

### Signatures

```csharp{title="LocalInvokeWithReceiptAsync Signatures" description="All overloads for LocalInvokeWithReceiptAsync" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "LocalInvokeWithReceiptAsync", "Signatures"] tests=["DispatcherInvokeWithReceiptTests.LocalInvokeWithReceipt_Generic_ReturnsBusinessResultAndReceiptAsync", "DispatcherInvokeWithReceiptTests.LocalInvokeWithReceipt_WithContext_PreservesCorrelationIdAsync", "DispatcherInvokeWithReceiptTests.LocalInvokeWithReceipt_WithDispatchOptions_ReturnsReceiptAsync"]}
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

```csharp{title="LocalInvokeWithReceiptAsync Usage" description="Get both result and receipt from a single invocation" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "LocalInvokeWithReceiptAsync", "Usage"] tests=["DispatcherInvokeWithReceiptTests.LocalInvokeWithReceipt_ReturnsBusinessResultAndReceiptAsync", "DispatcherInvokeWithReceiptTests.LocalInvokeWithReceipt_WithContext_PreservesCorrelationIdAsync"]}
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

```csharp{title="LocalInvokeAsync Error Handling" description="LocalInvokeAsync Error Handling" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "LocalInvokeAsync", "Error"] unverified="illustrative controller error-mapping — maps user-domain exceptions to HTTP responses, not a library-asserted behavior"}
[HttpPost("orders")]
public async Task<ActionResult> CreateOrder(
    [FromBody] CreateOrderRequest request,
    CancellationToken ct) {

    try {
        var command = new CreateOrder(request.CustomerId, request.Items);

        var result = await _dispatcher.LocalInvokeAsync<CreateOrder, OrderCreated>(
            command
        );

        await _dispatcher.PublishAsync(result);

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

```csharp{title="SendAsync Error Handling" description="SendAsync Error Handling" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "SendAsync", "Error"] unverified="illustrative error-handling — treats dispatch failures as infrastructure faults, not a library-asserted behavior"}
try {
    var receipt = await _dispatcher.SendAsync(command);

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

```csharp{title="PublishAsync Error Handling" description="PublishAsync Error Handling" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "PublishAsync", "Error"] unverified="illustrative perspective-failure handling — an eventual-consistency strategy, not a library-asserted behavior"}
try {
    await _dispatcher.PublishAsync(orderCreated);

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

```csharp{title="Pattern: Command + Event in Single Transaction" description="Pattern: Command + Event in Single Transaction" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Pattern:", "Command"] tests=["DispatcherTests.LocalInvoke_WithValidMessage_ShouldReturnBusinessResultAsync", "DispatcherTests.Publish_WithEvent_ShouldNotifyAllHandlersAsync", "DispatcherTests.Send_WithValidMessage_ShouldReturnDeliveryReceiptAsync"]}
[HttpPost("orders")]
public async Task<ActionResult<OrderCreated>> CreateOrder(
    [FromBody] CreateOrderRequest request,
    CancellationToken ct) {

    var command = new CreateOrder(request.CustomerId, request.Items);

    // Execute command
    var result = await _dispatcher.LocalInvokeAsync<CreateOrder, OrderCreated>(
        command
    );

    // Publish event to local perspectives
    await _dispatcher.PublishAsync(result);

    // Also send via SendAsync for outbox (remote publishing)
    await _dispatcher.SendAsync(result);

    return CreatedAtAction(nameof(GetOrder), new { orderId = result.OrderId }, result);
}
```

**Result**:
- Local perspectives updated immediately
- Event stored in outbox for remote publishing
- Background worker publishes to Azure Service Bus

### Pattern: Conditional Publishing

```csharp{title="Pattern: Conditional Publishing" description="Pattern: Conditional Publishing" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Pattern:", "Conditional"] tests=["DispatcherTests.LocalInvoke_WithValidMessage_ShouldReturnBusinessResultAsync", "DispatcherTests.Publish_WithEvent_ShouldNotifyAllHandlersAsync"]}
public async Task<ActionResult> ProcessPayment(
    [FromBody] ProcessPaymentRequest request,
    CancellationToken ct) {

    var command = new ProcessPayment(request.OrderId, request.Amount);

    var result = await _dispatcher.LocalInvokeAsync<ProcessPayment, PaymentResult>(
        command
    );

    // Publish different events based on result
    if (result.IsSuccess) {
        await _dispatcher.PublishAsync(
            new PaymentProcessed(result.OrderId, result.Amount, result.TransactionId));
    } else {
        await _dispatcher.PublishAsync(
            new PaymentFailed(result.OrderId, result.Amount, result.ErrorCode));
    }

    return Ok(result);
}
```

### Pattern: Batch Processing

```csharp{title="Pattern: Batch Processing" description="Pattern: Batch Processing" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Pattern:", "Batch"] tests=["DispatcherTests.LocalInvoke_WithValidMessage_ShouldReturnBusinessResultAsync", "DispatcherTests.Publish_WithEvent_ShouldNotifyAllHandlersAsync"]}
public async Task<ActionResult> ProcessOrders(
    [FromBody] ProcessOrdersRequest request,
    CancellationToken ct) {

    var results = new List<OrderCreated>();

    foreach (var item in request.Orders) {
        var command = new CreateOrder(item.CustomerId, item.Items);

        var result = await _dispatcher.LocalInvokeAsync<CreateOrder, OrderCreated>(
            command
        );

        results.Add(result);
    }

    // Publish all events in batch
    foreach (var result in results) {
        await _dispatcher.PublishAsync(result);
    }

    return Ok(new { ordersCreated = results.Count, orders = results });
}
```

---
