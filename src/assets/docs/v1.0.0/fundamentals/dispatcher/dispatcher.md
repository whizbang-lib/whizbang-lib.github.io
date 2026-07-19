---
title: Dispatcher Deep Dive
pageType: overview
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
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
  - src/Whizbang.Core/IDeliveryReceipt.cs
  - src/Whizbang.Core/Dispatch/DispatchOptions.cs
  - src/Whizbang.Core/Dispatch/DispatchMode.cs
  - src/Whizbang.Core/Dispatch/Route.cs
  - src/Whizbang.Core/Dispatch/InvokeResult.cs
testReferences:
  - tests/Whizbang.Core.Tests/Dispatcher/DispatcherTests.cs
  - tests/Whizbang.Core.Tests/Dispatcher/DispatcherOutboxTests.cs
  - tests/Whizbang.Core.Tests/Dispatcher/DispatcherInvokeWithReceiptTests.cs
  - tests/Whizbang.Core.Tests/Dispatcher/DispatcherLocalInvokeAndSyncTests.cs
  - tests/Whizbang.Core.Tests/Dispatcher/DispatcherCascadeTests.cs
  - tests/Whizbang.Core.Tests/Dispatcher/DispatcherRoutedCascadeTests.cs
  - tests/Whizbang.Core.Tests/Dispatch/DispatchOptionsTests.cs
  - tests/Whizbang.Core.Tests/Dispatch/DispatchModeTests.cs
  - tests/Whizbang.Core.Tests/DeliveryReceiptTests.cs
lastMaintainedCommit: '01f07906'
---

# Dispatcher Deep Dive

The **Dispatcher** is Whizbang's central message router. It provides three distinct dispatch patterns for different messaging scenarios: commands, queries, and events.

```mermaid{caption="dispatch routing — SendAsync resolves the message type to its receptor, or falls through to the outbox when no local handler exists." tests=["DispatcherTests.Dispatcher_ShouldRouteToCorrectHandlerAsync", "DispatcherTests.Dispatcher_MultipleReceptorsSameMessage_ShouldRouteToAllAsync", "DispatcherOutboxTests.SendAsync_NoLocalHandler_RoutesToOutboxAsync"]}
flowchart LR
    A[Caller] -->|SendAsync| D{Dispatcher}
    D -->|route by message type| R1[Matched Receptor]
    D -->|no local handler| O[(Outbox)]
    R1 --> RC[IDeliveryReceipt]
```

## Quick Reference

| Pattern | Use Case | Return Type | Performance | Distribution | Verified |
|---------|----------|-------------|-------------|--------------|----------|
| `SendAsync` | Commands with delivery tracking | `IDeliveryReceipt` | ~100μs | Local or Remote | {verified: DispatcherTests.Send_WithValidMessage_ShouldReturnDeliveryReceiptAsync} |
| `LocalInvokeAsync` | In-process queries/commands | `TResult` | < 20ns | Local only | {verified: DispatcherTests.LocalInvoke_WithValidMessage_ShouldReturnBusinessResultAsync} |
| `LocalInvokeWithReceiptAsync` | In-process RPC with receipt | `InvokeResult<TResult>` | ~100μs | Local only | {verified: DispatcherInvokeWithReceiptTests.LocalInvokeWithReceipt_ReturnsBusinessResultAndReceiptAsync} |
| `LocalInvokeAndSyncAsync` (W4) | Invoke + wait per `SyncMode` (CT-only) | `ValueTask` | Varies | Local only | {verified: DispatcherLocalInvokeAndSyncTests.LocalInvokeAndSyncAsync_NewOverload_ReturnsValueTaskAsync} |
| `LocalInvokeAndSyncAsync` (legacy, `[Obsolete]`) | Commands with perspective sync | `TResult` / `SyncResult` | Varies | Local only | {verified: DispatcherLocalInvokeAndSyncTests.LocalInvokeAndSyncAsync_OldOverloads_AreMarkedObsoleteAsync} |
| `PublishAsync` | Event broadcasting | `IDeliveryReceipt` | ~50μs | Local or Remote | {verified: DispatcherTests.Publish_WithEvent_ShouldNotifyAllHandlersAsync} |
| `SendManyAsync` | Batch commands (local + outbox) | `IEnumerable<IDeliveryReceipt>` | Optimized | Local + Remote | {verified: DispatcherOutboxTests.SendManyAsync_QueuesAllMessagesBeforeFlushAsync} |
| `PublishManyAsync` | Batch event publishing | `IEnumerable<IDeliveryReceipt>` | Optimized | Local + Remote | {verified: DispatcherOutboxTests.PublishAsync_ProductEvent_RoutesToProductsTopicAsync} |
| `LocalSendManyAsync` | Batch local-only dispatch | `IEnumerable<IDeliveryReceipt>` | ~20ns/msg | Local only | {verified: DispatcherTests.SendMany_WithMultipleCommands_ShouldReturnAllReceiptsAsync} |

## IDispatcher Interface

```csharp{title="IDispatcher Interface" description="IDispatcher Interface" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "IDispatcher", "Interface"] tests=["DispatcherTests.Send_WithValidMessage_ShouldReturnDeliveryReceiptAsync", "DispatcherTests.LocalInvoke_WithValidMessage_ShouldReturnBusinessResultAsync", "DispatcherInvokeWithReceiptTests.LocalInvokeWithReceipt_ReturnsBusinessResultAndReceiptAsync"]}
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

    // W4: invoke + wait per SyncMode (CancellationToken-only; no TimeSpan timeout)
    ValueTask LocalInvokeAndSyncAsync<TMessage>(
        TMessage message,
        SyncMode mode,
        CancellationToken cancellationToken = default
    ) where TMessage : notnull;

    // LEGACY ([Obsolete]): in-process RPC with perspective sync + TimeSpan timeout
    [Obsolete]
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

    // Exactly-once event emission per claim key (see PublishOnceAsync page)
    Task<bool> PublishOnceAsync<TEvent>(
        string claimKey,
        TEvent eventData,
        CancellationToken cancellationToken = default);

    // Advanced/Internal: Cascade a message using a source envelope's security context
    Task CascadeMessageAsync(
        IMessage message,
        IMessageEnvelope? sourceEnvelope,
        DispatchModes mode,
        CancellationToken cancellationToken = default);
}
```

Most methods also have overloads accepting an explicit `IMessageContext` (with caller-info parameters) and/or `DispatchOptions` — the block above shows the primary shapes only. See [SyncMode](sync-mode) for the W4 `LocalInvokeAndSyncAsync` contract and [PublishOnceAsync](publish-once) for exactly-once emission.

---

## AppendAsync vs PublishAsync vs SendAsync

:::new{type="important"}
Understanding when to use `IEventStore.AppendAsync` versus `IDispatcher.PublishAsync` is critical. Using both together is usually **redundant**.
:::

### Key Differences

| Method | Responsibility | Triggers Perspectives | Uses Outbox | Return |
|--------|---------------|----------------------|-------------|--------|
| `IEventStore.AppendAsync` | Persist event to event store | No | No | `Task` |
| `IDispatcher.PublishAsync` | Broadcast event | Yes (local) | Yes (remote) | `IDeliveryReceipt` |
| `IDispatcher.SendAsync` | Route command | No | Yes | `IDeliveryReceipt` |

### Correct Patterns

**For Events (most common case):**

```csharp{title="Correct Patterns" description="For Events (most common case):" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Correct", "Patterns"] tests=["DispatcherTests.Publish_WithEvent_ShouldNotifyAllHandlersAsync"]}
// ✅ CORRECT: Just publish - handles perspectives + outbox
public async ValueTask<OrderCreated> HandleAsync(
    CreateOrder command,
    CancellationToken ct) {

    var @event = new OrderCreated(command.OrderId, command.Items);

    // PublishAsync triggers local perspectives AND queues for remote delivery
    await _dispatcher.PublishAsync(@event);

    return @event;
}
```

**For Commands:**

```csharp{title="Correct Patterns (2)" description="For Commands:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Correct", "Patterns"] tests=["DispatcherTests.Send_WithValidMessage_ShouldReturnDeliveryReceiptAsync"]}
// ✅ CORRECT: Send command with delivery tracking
await _dispatcher.SendAsync(new ProcessPayment(orderId, amount));
```

**For Direct Event Store Access (rare - infrastructure/workers only):**

```csharp{title="Correct Patterns (3)" description="For Direct Event Store Access (rare - infrastructure/workers only):" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Correct", "Patterns"] unverified="raw IEventStore.AppendAsync — verified in the Event Store docs, not by Dispatcher tests"}
// ✅ CORRECT: Direct append for infrastructure code, replay, or migration scripts.
// No perspectives fire and nothing is queued to the outbox.
await _eventStore.AppendAsync(streamId, @event, ct);
```

### Anti-Patterns to Avoid

```csharp{title="Anti-Patterns to Avoid" description="Anti-Patterns to Avoid" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Anti-Patterns", "Avoid"] unverified="counter-example — intentionally wrong, nothing to assert"}
// ❌ WRONG: Redundant - calling both AppendAsync and PublishAsync
await _eventStore.AppendAsync(orderId, @event, ct);
await _dispatcher.PublishAsync(@event);
// PublishAsync already handles persistence + perspectives + outbox!
```

### When to Use Each

| Scenario | Use |
|----------|-----|
| Publishing an event from a receptor | `PublishAsync` |
| Sending a command to another service | `SendAsync` |
| In-process query with typed response | `LocalInvokeAsync` |
| Infrastructure/worker code appending directly (no perspectives, no transport) | `AppendAsync` |
| Event replay/migration scripts | `AppendAsync` |

---

## Decision Matrix

### When to Use Each Pattern

{verified: DispatcherTests.Send_WithValidMessage_ShouldReturnDeliveryReceiptAsync, DispatcherTests.LocalInvoke_WithValidMessage_ShouldReturnBusinessResultAsync, DispatcherTests.Publish_WithEvent_ShouldNotifyAllHandlersAsync}

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

```csharp{title="Pattern Comparison" description="Pattern Comparison" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Pattern", "Comparison"] tests=["DispatcherTests.Send_WithValidMessage_ShouldReturnDeliveryReceiptAsync", "DispatcherTests.LocalInvoke_WithValidMessage_ShouldReturnBusinessResultAsync", "DispatcherTests.Publish_WithEvent_ShouldNotifyAllHandlersAsync"]}
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


## Pattern Deep Dives

Each pattern has a full reference on the [Dispatch Patterns](dispatch-patterns) page:

| Pattern | Deep dive |
|---------|-----------|
| `SendAsync` — command dispatch with delivery receipt | [Dispatch Patterns § Pattern 1](dispatch-patterns#pattern-1-sendasync-command-dispatch) |
| `LocalInvokeAsync` — in-process RPC (+ sync and receipt variants) | [Dispatch Patterns § Pattern 2](dispatch-patterns#pattern-2-localinvokeasync-in-process-rpc) |
| `PublishAsync` — event broadcasting | [Dispatch Patterns § Pattern 3](dispatch-patterns#pattern-3-publishasync-event-broadcasting) |
| Batch operations (`LocalSendManyAsync`) | [Dispatch Patterns § Batch Operations](dispatch-patterns#batch-operations) |
| Error handling & advanced composition | [Dispatch Patterns § Error Handling](dispatch-patterns#error-handling) |

Message cascading (receptor return values flowing onward automatically, route wrappers, event-store-only mode, the deferred event channel) moved to [Automatic Message Cascade](message-cascade).

## Dispatcher Configuration Options {#dispatch-options}

{verified: DispatchOptionsTests.WithTimeout_SetsTimeout_ReturnsSelfAsync, DispatchOptionsTests.WithCancellationToken_SetsToken_ReturnsSelfAsync, DispatchOptionsTests.FluentApi_CanChainMultipleCalls_Async}

`DispatchOptions` provides fine-grained control over dispatch behavior, including cancellation, timeouts {verified: DispatchOptionsTests.WithTimeout_SetsTimeout_ReturnsSelfAsync}, and perspective synchronization.

### Basic Options

```csharp{title="Basic Options" description="Basic Options" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Basic", "Options"] tests=["DispatchOptionsTests.WithTimeout_SetsTimeout_ReturnsSelfAsync", "DispatchOptionsTests.WithCancellationToken_SetsToken_ReturnsSelfAsync"]}
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

```csharp{title="Perspective Synchronization" description="Wait for all perspectives to finish processing cascaded events before returning:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Perspective", "Synchronization"] tests=["DispatchOptionsTests.Default_WaitForPerspectives_IsFalseAsync", "DispatcherLocalInvokeAndSyncTests.LocalInvokeAndSyncAsync_MultipleEventsWaitsOnceAsync"]}
// Wait with default timeout (30 seconds)
var options = new DispatchOptions().WithPerspectiveWait();
var result = await dispatcher.LocalInvokeAsync<OrderCreated>(
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

```csharp{title="Perspective Synchronization (2)" description="Alternative API: Use LocalInvokeAndSyncAsync for built-in perspective synchronization without explicit options:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "Perspective", "Synchronization"] tests=["DispatcherLocalInvokeAndSyncTests.LocalInvokeAndSyncAsync_NewOverload_ReturnsValueTaskAsync", "DispatcherLocalInvokeAndSyncTests.LocalInvokeAndSyncAsync_MultipleEventsWaitsOnceAsync"]}
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

```csharp{title="Example: Timeout Handling" description="Example: Timeout Handling" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Example:", "Timeout"] tests=["DispatchOptionsTests.WithTimeout_SetsTimeout_ReturnsSelfAsync", "DispatchOptionsTests.WithTimeout_NegativeValue_ThrowsArgumentOutOfRangeExceptionAsync"]}
try {
    var options = new DispatchOptions()
        .WithTimeout(TimeSpan.FromSeconds(5))
        .WithPerspectiveWait();

    var result = await dispatcher.LocalInvokeAsync<OrderCreated>(
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

### Envelope Allocation

Envelope creation is internal to the dispatcher — application code never constructs envelopes for dispatch. The fast path (`LocalInvokeAsync` without tracing or a receipt) skips envelope creation entirely; receipt-returning paths (`SendAsync`, `PublishAsync`, `LocalInvokeWithReceiptAsync`) create an envelope because the receipt needs its metadata.

**Result**: Minimal allocations in steady state; zero-allocation fast path for plain `LocalInvokeAsync`.

---

## Integration with Patterns

### Outbox Pattern

{verified: DispatcherOutboxTests.SendAsync_NoLocalHandler_RoutesToOutboxAsync, DispatcherOutboxTests.SendManyAsync_QueuesAllMessagesBeforeFlushAsync}

`SendAsync` and `PublishAsync` integrate with the Outbox pattern automatically: messages destined for the transport are serialized into `wh_outbox` in the same batch as the rest of the dispatch's work, then published by background workers.

```csharp{title="Outbox Pattern" description="Dispatch writes to the outbox; background workers publish from it:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "Outbox", "Pattern"] tests=["DispatcherOutboxTests.SendAsync_NoLocalHandler_RoutesToOutboxAsync", "DispatcherOutboxTests.PublishAsync_ProductEvent_RoutesToProductsTopicAsync"]}
// Application code: just dispatch — the outbox write is part of the dispatch
var receipt = await _dispatcher.PublishAsync(new OrderCreated(/* ... */));

// Framework internals (workers): work is claimed and flushed through
// IWorkCoordinator.ProcessWorkBatchAsync(ProcessWorkBatchRequest, ct),
// which returns OutboxWork / InboxWork / PerspectiveWork batches.
```

See [Outbox Pattern](../../messaging/outbox-pattern.md) for details.

### Inbox Pattern

Incoming transport messages integrate with the Inbox pattern for exactly-once processing: the `TransportConsumerWorker` persists received messages to `wh_inbox`, deduplicates by message ID, and dispatches them to local receptors. Duplicate deliveries are detected at the inbox and never re-invoke your handlers.

See [Inbox Pattern](../../messaging/inbox-pattern.md) for details.

---

## Testing

### Testing with Dispatcher

```csharp{title="Testing with Dispatcher" description="Testing with Dispatcher" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "C#", "Testing"] tests=["DispatcherTests.Send_WithValidMessage_ShouldReturnDeliveryReceiptAsync", "DispatcherTests.Send_WithUnknownMessageType_ShouldThrowReceptorNotFoundExceptionAsync"]}
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

## DispatchOptions Record {#dispatch-options-record}

`DispatchOptions` controls cancellation, timeouts, and perspective wait behavior for dispatch operations. All `SendAsync`, `LocalInvokeAsync`, `PublishAsync`, and `LocalInvokeWithReceiptAsync` methods accept an optional `DispatchOptions` parameter.

### Properties

{verified: DispatchOptionsTests.Timeout_PropertySetter_WorksAsync, DispatchOptionsTests.CancellationToken_PropertySetter_WorksAsync}

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `CancellationToken` | `CancellationToken` | `CancellationToken.None` | Token to cancel the dispatch operation. Throws `OperationCanceledException` when cancelled. |
| `Timeout` | `TimeSpan?` | `null` (no timeout) | Maximum time to wait for dispatch completion. Throws `OperationCanceledException` when exceeded. |
| `WaitForPerspectives` | `bool` | `false` | When `true`, `LocalInvokeAsync` waits for all perspectives to finish processing cascaded events before returning. |
| `PerspectiveWaitTimeout` | `TimeSpan` | 30 seconds | Timeout for waiting for perspectives. Only used when `WaitForPerspectives` is `true`. |

### Fluent API

```csharp{title="DispatchOptions Fluent API" description="Fluent builder methods for DispatchOptions" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Dispatcher", "DispatchOptions", "Fluent"] tests=["DispatchOptionsTests.FluentApi_CanChainMultipleCalls_Async", "DispatchOptionsTests.WithTimeout_SetsTimeout_ReturnsSelfAsync", "DispatchOptionsTests.WithCancellationToken_SetsToken_ReturnsSelfAsync"]}
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

{verified: DispatchOptionsTests.Default_WaitForPerspectives_IsFalseAsync}

Use `WithPerspectiveWait()` for RPC-style calls where you need all perspectives to have processed cascaded events before the response is returned to the caller:

```csharp{title="DispatchOptions Perspective Wait" description="Wait for perspectives to complete before returning" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Dispatcher", "DispatchOptions", "PerspectiveWait"] tests=["DispatchOptionsTests.Default_WaitForPerspectives_IsFalseAsync"]}
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
