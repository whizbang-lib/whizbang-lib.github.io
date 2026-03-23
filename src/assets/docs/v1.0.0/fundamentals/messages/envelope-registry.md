---
title: Envelope Registry
version: 1.0.0
category: Core Concepts
order: 22
description: >-
  IEnvelopeRegistry for tracking message envelopes by payload reference in Whizbang.
tags: 'envelope, registry, message-tracking, observability'
codeReferences:
  - src/Whizbang.Core/Observability/IEnvelopeRegistry.cs
  - src/Whizbang.Core/Observability/EnvelopeRegistry.cs
---

# Envelope Registry

The `IEnvelopeRegistry` provides a way to look up message envelopes by their payload reference. This enables APIs that accept raw messages to access the full envelope context.

## Overview

When processing messages, sometimes only the message payload is available, but the envelope context (correlation ID, hops, security context) is needed. The envelope registry bridges this gap:

- **Register** envelopes when created by the dispatcher
- **Lookup** envelopes by message payload reference
- **Unregister** when processing completes

## IEnvelopeRegistry Interface {#ienveloperegistry}

```csharp{title="IEnvelopeRegistry Interface" description="Demonstrates iEnvelopeRegistry Interface" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Messages", "IEnvelopeRegistry", "Interface"]}
namespace Whizbang.Core.Observability;

/// <summary>
/// Registry for tracking message envelopes by their message payload.
/// Enables looking up the envelope for a message when only the message is available.
/// </summary>
/// <remarks>
/// The registry uses object reference identity (not equality) to look up messages.
/// This means the exact same message instance must be used for registration and lookup.
///
/// Typical flow:
/// 1. Dispatcher creates envelope, calls Register(envelope)
/// 2. Receptor processes message, may call eventStore.AppendAsync(streamId, message)
/// 3. EventStore calls TryGetEnvelope(message) to get the envelope
/// 4. Processing completes, Unregister is called (or scope disposes)
/// </remarks>
public interface IEnvelopeRegistry {
  /// <summary>
  /// Registers an envelope in the registry.
  /// The envelope's Payload is used as the key for later lookup.
  /// </summary>
  void Register<T>(MessageEnvelope<T> envelope);

  /// <summary>
  /// Attempts to get the envelope for a message.
  /// Returns null if the message is not registered (does not throw).
  /// </summary>
  MessageEnvelope<T>? TryGetEnvelope<T>(T message) where T : notnull;

  /// <summary>
  /// Unregisters a message from the registry.
  /// </summary>
  void Unregister<T>(T message) where T : notnull;

  /// <summary>
  /// Unregisters an envelope from the registry.
  /// </summary>
  void Unregister<T>(MessageEnvelope<T> envelope);
}
```

## Usage Flow

```
1. Dispatcher creates envelope
   └─> envelopeRegistry.Register(envelope)

2. Receptor receives message (payload only)
   └─> Calls eventStore.AppendAsync(streamId, message)

3. EventStore needs envelope context
   └─> envelope = envelopeRegistry.TryGetEnvelope(message)
   └─> Uses envelope.CorrelationId, envelope.Hops, etc.

4. Processing completes
   └─> envelopeRegistry.Unregister(message)
```

## How It Works

### Reference Identity

The registry uses **object reference identity**, not equality:

```csharp{title="Reference Identity" description="The registry uses object reference identity, not equality:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Messages", "Reference", "Identity"]}
var message = new OrderCreated { OrderId = orderId };

// Same instance - works
registry.Register(envelope);
var found = registry.TryGetEnvelope(message);  // ✅ Returns envelope

// Different instance with same data - doesn't work
var copy = new OrderCreated { OrderId = orderId };
var notFound = registry.TryGetEnvelope(copy);  // ❌ Returns null
```

This is intentional - it ensures the exact message being processed is matched.

### Scoped Lifetime

The registry is typically scoped to a request/operation:

```csharp{title="Scoped Lifetime" description="The registry is typically scoped to a request/operation:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Messages", "Scoped", "Lifetime"]}
// Registered as scoped in DI
services.AddScoped<IEnvelopeRegistry, EnvelopeRegistry>();

// Each HTTP request/message processing scope gets its own registry
// Automatically cleaned up when scope ends
```

## Use Cases

### Event Store Integration

The event store uses the registry to get envelope context:

```csharp{title="Event Store Integration" description="The event store uses the registry to get envelope context:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Event", "Store"]}
public class EventStore : IEventStore {
  private readonly IEnvelopeRegistry _envelopeRegistry;

  public async Task AppendAsync<TMessage>(
      Guid streamId,
      TMessage message,
      CancellationToken ct = default) {

    // Try to get envelope from registry
    var envelope = _envelopeRegistry.TryGetEnvelope(message);

    if (envelope != null) {
      // Use envelope's correlation ID, hops, security context
      await StoreWithEnvelopeAsync(streamId, envelope, ct);
    } else {
      // Create minimal envelope for orphan message
      var minimalEnvelope = MessageEnvelope.Create(message);
      await StoreWithEnvelopeAsync(streamId, minimalEnvelope, ct);
    }
  }
}
```

### Security Context Propagation

```csharp{title="Security Context Propagation" description="Demonstrates security Context Propagation" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Security", "Context"]}
public class SecurityContextEventStoreDecorator : IEventStore {
  private readonly IEnvelopeRegistry _envelopeRegistry;
  private readonly IEventStore _inner;

  public async Task AppendAsync<TMessage>(
      Guid streamId,
      TMessage message,
      CancellationToken ct = default) {

    var envelope = _envelopeRegistry.TryGetEnvelope(message);

    // Propagate security context from envelope
    var securityContext = envelope?.Hops
        .FirstOrDefault(h => h.SecurityContext != null)?
        .SecurityContext;

    // Apply security context to storage
    using (_securityScope.UseContext(securityContext)) {
      await _inner.AppendAsync(streamId, message, ct);
    }
  }
}
```

### Correlation Tracking

```csharp{title="Correlation Tracking" description="Demonstrates correlation Tracking" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Correlation", "Tracking"]}
public class CorrelationTrackingReceptor : IReceptor<CreateOrder, OrderCreated> {
  private readonly IEnvelopeRegistry _envelopeRegistry;

  public async ValueTask<OrderCreated> HandleAsync(
      CreateOrder command,
      CancellationToken ct = default) {

    // Get correlation ID from envelope
    var envelope = _envelopeRegistry.TryGetEnvelope(command);
    var correlationId = envelope?.CorrelationId ?? Guid.NewGuid();

    _logger.LogInformation(
        "Processing CreateOrder with CorrelationId {CorrelationId}",
        correlationId);

    // Process and return event...
  }
}
```

## Implementation Details

### Thread Safety

The default implementation uses `ConcurrentDictionary`:

```csharp{title="Thread Safety" description="The default implementation uses ConcurrentDictionary:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Thread", "Safety"]}
public sealed class EnvelopeRegistry : IEnvelopeRegistry {
  private readonly ConcurrentDictionary<object, object> _envelopes = new();

  public void Register<T>(MessageEnvelope<T> envelope) {
    _envelopes[envelope.Payload!] = envelope;
  }

  public MessageEnvelope<T>? TryGetEnvelope<T>(T message) where T : notnull {
    return _envelopes.TryGetValue(message, out var envelope)
        ? envelope as MessageEnvelope<T>
        : null;
  }

  public void Unregister<T>(T message) where T : notnull {
    _envelopes.TryRemove(message, out _);
  }
}
```

### Memory Management

- Envelopes are stored by reference (not copied)
- Registry should be scoped to avoid memory leaks
- Unregister when processing completes

## Best Practices

### DO

- **Use scoped lifetime** for the registry
- **Unregister after processing** to free memory
- **Check for null** when calling `TryGetEnvelope`
- **Pass original message instance** - not copies

### DON'T

- **Don't use singleton lifetime** - causes memory leaks
- **Don't assume envelope exists** - always check for null
- **Don't modify registered messages** - use as immutable
- **Don't rely on equality** - only reference identity works

## Related Documentation

- [Message Envelopes](../../messaging/message-envelopes.md) - Envelope structure
- [Envelope Serialization](envelope-serialization.md) - Serializing envelopes
- [Observability](../persistence/observability.md) - Message tracing
- [Message Context](message-context.md) - Correlation and causation

---

*Version 1.0.0 - Foundation Release*
