---
title: Custom Dispatchers
pageType: guide
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Extensibility
order: 9
description: >-
  Extend dispatch behavior by decorating IDispatcher - cross-cutting concerns,
  auditing, custom routing
tags: 'dispatcher, decorator, routing, event-sourcing'
codeReferences:
  - src/Whizbang.Core/IDispatcher.cs
  - src/Whizbang.Core/Dispatcher.cs
testReferences:
  - tests/Whizbang.Core.Tests/Dispatcher/DispatcherTests.cs
  - tests/Whizbang.Core.Tests/Dispatcher/DispatcherDeliveryReceiptTests.cs
  - tests/Whizbang.Core.Tests/Dispatcher/DispatcherOutboxTests.cs
lastMaintainedCommit: '01f07906'
---

# Custom Dispatchers

**Custom dispatchers** layer additional behavior over Whizbang's dispatcher - auditing, metrics, tenant tagging, or custom side effects. The practical extension pattern is **decoration**: wrap the registered `IDispatcher` and forward calls to it.

:::note
Whizbang's default dispatcher is source-generated (a subclass of the abstract `Dispatcher` class), registered as a singleton `IDispatcher` by `AddWhizbang()`. It already provides AOT-compatible, zero-reflection routing, outbox integration, and mediator-style in-process RPC. Reimplementing `IDispatcher` from scratch is rarely the right choice - the interface has three dispatch patterns plus batch, receipt, cascade, and sync-mode members.
:::

---

## The IDispatcher Surface

`IDispatcher` (namespace `Whizbang.Core`) exposes three distinct dispatch patterns:

```csharp{title="IDispatcher Core Patterns" description="The three dispatch patterns on IDispatcher" category="Reference" difficulty="INTERMEDIATE" tags=["Dispatcher", "API", "Reference"]}
public interface IDispatcher {
  // SEND - command dispatch with delivery receipt (can work over the wire)
  Task<IDeliveryReceipt> SendAsync<TMessage>(TMessage message) where TMessage : notnull;

  // LOCAL INVOKE - in-process RPC with typed business result (zero allocation)
  ValueTask<TResult> LocalInvokeAsync<TMessage, TResult>(TMessage message) where TMessage : notnull;
  ValueTask LocalInvokeAsync<TMessage>(TMessage message) where TMessage : notnull;  // void receptors

  // PUBLISH - event broadcasting; receipt carries StreamId from [StreamId]
  Task<IDeliveryReceipt> PublishAsync<TEvent>(TEvent eventData);

  // ... plus overloads taking IMessageContext and DispatchOptions, and:
  // SendManyAsync / LocalSendManyAsync / PublishManyAsync / LocalInvokeManyAsync  (batch)
  // LocalInvokeWithReceiptAsync   (typed result + delivery receipt)
  // PublishOnceAsync              (at-most-once per claim key, needs IClaimedEmissionStore)
  // LocalInvokeAndSyncAsync       (wait for perspectives via SyncMode)
  // CascadeMessageAsync           (cascade with explicit DispatchModes)
}
```

Key semantics to preserve in any custom dispatcher:

| Pattern | Returns | Notes |
|---------|---------|-------|
| `SendAsync` | `IDeliveryReceipt` | Delivery acknowledgment, **not** the business result |
| `LocalInvokeAsync` | Typed `TResult` (or void) | In-process only; throws for remote transports |
| `PublishAsync` | `IDeliveryReceipt` | Fan-out to all interested handlers + outbox |

---

## You May Not Need One: Mediator Pattern Is Built In

`LocalInvokeAsync` already provides MediatR-style request/response over receptors - no custom dispatcher required:

```csharp{title="Built-In Mediator Semantics" description="LocalInvokeAsync provides typed request/response" category="Extensibility" difficulty="BEGINNER" tags=["Dispatcher", "Mediator", "LocalInvoke"]}
// Command in, typed business result out - handled by a receptor
var result = await dispatcher.LocalInvokeAsync<CreateOrder, OrderResult>(
  new CreateOrder { CustomerId = customerId }
);
```

---

## Decorator Pattern: Auditing Dispatcher

Wrap the inner dispatcher to add cross-cutting behavior. Implement `IDispatcher`, forward every member to the inner instance, and add your logic around the members you care about:

```csharp{title="Auditing Dispatcher Decorator" description="Decorate IDispatcher to audit publishes" category="Extensibility" difficulty="INTERMEDIATE" tags=["Dispatcher", "Decorator", "Auditing"]}
public class AuditingDispatcher : IDispatcher {
  private readonly IDispatcher _inner;
  private readonly ILogger<AuditingDispatcher> _logger;

  public AuditingDispatcher(IDispatcher inner, ILogger<AuditingDispatcher> logger) {
    _inner = inner;
    _logger = logger;
  }

  public async Task<IDeliveryReceipt> PublishAsync<TEvent>(TEvent eventData) {
    var receipt = await _inner.PublishAsync(eventData);
    _logger.LogInformation(
      "Published {EventType} to stream {StreamId}",
      typeof(TEvent).Name, receipt.StreamId
    );
    return receipt;
  }

  public Task<IDeliveryReceipt> SendAsync<TMessage>(TMessage message) where TMessage : notnull =>
    _inner.SendAsync(message);

  public ValueTask<TResult> LocalInvokeAsync<TMessage, TResult>(TMessage message) where TMessage : notnull =>
    _inner.LocalInvokeAsync<TMessage, TResult>(message);

  // ... every remaining IDispatcher member forwards to _inner the same way.
  // The interface is large (Send/LocalInvoke/Publish overloads, batch, receipt,
  // cascade, and sync-mode members) - forward all of them.
}
```

### Registering the Decorator

`AddWhizbang()` registers the generated dispatcher as a singleton `IDispatcher`. Decorate it by replacing the descriptor **after** the Whizbang registration:

```csharp{title="Decorator Registration" description="Wrap the registered IDispatcher" category="Extensibility" difficulty="INTERMEDIATE" tags=["Dispatcher", "Decorator", "DI"]}
// After AddWhizbang() has registered IDispatcher
var innerDescriptor = services.Single(d => d.ServiceType == typeof(IDispatcher));
services.Replace(ServiceDescriptor.Singleton<IDispatcher>(sp =>
  new AuditingDispatcher(
    (IDispatcher)innerDescriptor.ImplementationFactory!(sp),
    sp.GetRequiredService<ILogger<AuditingDispatcher>>()
  )
));
```

:::warning
Framework components that resolve the concrete generated dispatcher type continue to bypass your decorator - decoration applies to consumers resolving `IDispatcher`. Keep decorators free of business logic that correctness depends on; use [receptors](../../fundamentals/receptors/receptors.md) and [policies](./custom-policies.md) for that.
:::

---

## Event Auditing Without a Custom Dispatcher

If your goal is an append-only record of dispatched events, prefer the built-in facilities before decorating:

- Events published via `PublishAsync` already flow through the outbox and (when configured) the event store
- `PublishOnceAsync(claimKey, eventData)` gives at-most-once emission per idempotency key
- Delivery receipts expose `StreamId` (extracted from the `[StreamId]` attribute) for correlation

---

## Further Reading

**Core Concepts**:
- [Dispatcher](../../fundamentals/dispatcher/dispatcher.md) - Default dispatcher

### For Users

New to dispatchers? Start with the user guide:
- [Dispatcher Guide](../../fundamentals/dispatcher/dispatcher.md) — Core dispatch patterns, local vs distributed dispatch, and usage examples

---

*Version 1.0.0 - Foundation Release | Last Updated: 2026-07-16*
