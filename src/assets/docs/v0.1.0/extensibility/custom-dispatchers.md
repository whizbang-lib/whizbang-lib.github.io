---
title: "Custom Dispatchers"
version: 0.1.0
category: Extensibility
order: 9
description: "Implement custom dispatcher patterns - mediator, event sourcing, multi-tenant routing"
tags: dispatcher, mediator, routing, event-sourcing
codeReferences:
  - src/Whizbang.Core/Dispatcher/IDispatcher.cs
---

# Custom Dispatchers

**Custom dispatchers** enable alternative message routing strategies beyond the default dispatcher. Implement mediator patterns, event sourcing dispatchers, or multi-tenant routing.

:::note
Whizbang's default dispatcher provides AOT-compatible, zero-reflection routing. Custom dispatchers are for specialized architectural patterns.
:::

---

## Why Custom Dispatchers?

| Pattern | Default Dispatcher | Custom Dispatcher |
|---------|-------------------|-------------------|
| **Direct Routing** | ✅ Perfect | No customization needed |
| **Mediator Pattern** | ❌ Not built-in | ✅ Custom mediator |
| **Event Sourcing** | ❌ Append-only needed | ✅ Event store dispatcher |
| **Multi-Tenant** | ❌ Requires policies | ✅ Tenant-aware routing |

**When to use custom dispatchers**:
- ✅ Mediator pattern requirements
- ✅ Event sourcing architecture
- ✅ Complex multi-tenant routing
- ✅ Custom middleware pipelines

---

## Mediator Dispatcher

### Pattern 1: MediatR-Style Dispatcher

```csharp
public class MediatorDispatcher : IDispatcher {
  private readonly IServiceProvider _services;

  public MediatorDispatcher(IServiceProvider services) {
    _services = services;
  }

  public async Task<TResponse> SendAsync<TResponse>(
    object request,
    CancellationToken ct = default
  ) {
    var requestType = request.GetType();
    var handlerType = typeof(IRequestHandler<,>).MakeGenericType(requestType, typeof(TResponse));

    var handler = _services.GetRequiredService(handlerType);
    var method = handlerType.GetMethod("Handle");

    var result = await (Task<TResponse>)method!.Invoke(handler, new[] { request, ct })!;
    return result;
  }
}

public interface IRequestHandler<in TRequest, TResponse> {
  Task<TResponse> Handle(TRequest request, CancellationToken ct);
}
```

---

## Event Sourcing Dispatcher

### Pattern 2: Append-Only Event Store

```csharp
public class EventSourcingDispatcher : IDispatcher {
  private readonly IEventStore _eventStore;
  private readonly IDispatcher _innerDispatcher;

  public EventSourcingDispatcher(
    IEventStore eventStore,
    IDispatcher innerDispatcher
  ) {
    _eventStore = eventStore;
    _innerDispatcher = innerDispatcher;
  }

  public async Task<TResponse> SendAsync<TResponse>(
    object command,
    CancellationToken ct = default
  ) {
    // Dispatch command → get event response
    var @event = await _innerDispatcher.SendAsync<TResponse>(command, ct);

    // Append event to event store
    var streamId = GetStreamId(command);
    await _eventStore.AppendAsync(streamId, @event, ct);

    return @event;
  }

  private Guid GetStreamId(object command) {
    // Extract aggregate ID from command
    var aggregateIdProperty = command.GetType().GetProperty("AggregateId");
    return (Guid)aggregateIdProperty!.GetValue(command)!;
  }
}
```

---

## Further Reading

**Core Concepts**:
- [Dispatcher](../core-concepts/dispatcher.md) - Default dispatcher

---

*Version 0.1.0 - Foundation Release | Last Updated: 2024-12-12*
