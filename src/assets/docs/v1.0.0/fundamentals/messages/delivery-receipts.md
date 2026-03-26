---
title: Delivery Receipts
version: 1.0.0
category: Core Concepts
order: 20
description: >-
  Delivery receipts, stream ID extraction, and message tracking in Whizbang.
tags: 'delivery-receipts, stream-id, extraction, tracking, aot'
codeReferences:
  - src/Whizbang.Core/IDeliveryReceipt.cs
  - src/Whizbang.Core/IStreamIdExtractor.cs
  - src/Whizbang.Core/StreamIdExtractor.cs
  - src/Whizbang.Core/Registry/StreamIdExtractorRegistry.cs
---

# Delivery Receipts

Delivery receipts provide tracking information when messages are dispatched. Stream ID extractors enable AOT-compatible extraction of stream identifiers from messages.

## Overview

When you dispatch a message via `SendAsync`, you receive a `DeliveryReceipt`:

```csharp{title="Overview" description="When you dispatch a message via SendAsync, you receive a DeliveryReceipt:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Messages", "Overview"]}
var receipt = await dispatcher.SendAsync(new CreateOrder {
  CustomerId = customerId,
  Items = items
});

// receipt contains:
// - MessageId: Unique ID for this message
// - CorrelationId: For tracing related messages
// - StreamId: Extracted from the message (if available)
// - Timestamp: When the message was dispatched
```

## DeliveryReceipt Structure

```csharp{title="DeliveryReceipt Structure" description="DeliveryReceipt Structure" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Messages", "DeliveryReceipt", "Structure"]}
public record DeliveryReceipt(
    Guid MessageId,        // Unique message identifier
    Guid CorrelationId,    // For distributed tracing
    Guid? StreamId,        // Stream key (if extracted)
    DateTimeOffset Timestamp
);
```

## Stream ID Extraction

### IStreamIdExtractor Interface {#istreamidextractor}

```csharp{title="IStreamIdExtractor Interface" description="IStreamIdExtractor Interface" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "IStreamIdExtractor", "Interface"]}
namespace Whizbang.Core;

/// <summary>
/// Extracts stream IDs from messages for delivery receipts and routing.
/// Uses [StreamId] attribute on both events and commands.
/// Uses source-generated extractors - zero reflection, AOT compatible.
/// </summary>
public interface IStreamIdExtractor {
  /// <summary>
  /// Extracts the stream ID from a message.
  /// Uses the [StreamId] attribute to identify the stream property.
  /// </summary>
  /// <param name="message">The message instance</param>
  /// <param name="messageType">The runtime type of the message</param>
  /// <returns>The stream ID if found, otherwise null</returns>
  Guid? ExtractStreamId(object message, Type messageType);
}
```

### StreamIdExtractor Implementation {#streamidextractor}

The default implementation delegates to source-generated extractors:

```csharp{title="StreamIdExtractor Implementation" description="The default implementation delegates to source-generated extractors:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "StreamIdExtractor", "Implementation"]}
namespace Whizbang.Core;

/// <summary>
/// Extracts stream IDs from messages using unified [StreamId] attribute.
/// Delegates to source-generated extractors for zero-reflection, AOT-compatible extraction.
/// </summary>
public sealed class StreamIdExtractor : IStreamIdExtractor {
  public Guid? ExtractStreamId(object message, Type messageType) {
    if (message is null) return null;

    // Use unified [StreamId] extractors for all message types
    if (message is IEvent @event) {
      return StreamIdExtractors.TryResolveAsGuid(@event);
    }

    if (message is ICommand command) {
      return StreamIdExtractors.TryResolveAsGuid(command);
    }

    // For other message types (e.g., perspective DTOs)
    return StreamIdExtractors.TryResolveAsGuid(message);
  }
}
```

### StreamIdExtractorRegistry {#streamidextractorregistry}

Registry for multi-assembly stream ID extraction:

```csharp{title="StreamIdExtractorRegistry" description="Registry for multi-assembly stream ID extraction:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "StreamIdExtractorRegistry", "Streamidextractorregistry"]}
namespace Whizbang.Core.Registry;

/// <summary>
/// Registry for IStreamIdExtractor contributions from multiple assemblies.
/// Each assembly registers its generated extractor via [ModuleInitializer].
/// </summary>
public static class StreamIdExtractorRegistry {
  /// <summary>
  /// Register an extractor. Called from [ModuleInitializer] in generated code.
  /// </summary>
  /// <param name="extractor">The extractor to register</param>
  /// <param name="priority">Lower = tried first. Use 100 for contracts, 1000 for services.</param>
  public static void Register(IStreamIdExtractor extractor, int priority = 1000);

  /// <summary>
  /// Extract stream ID by trying all registered extractors in priority order.
  /// </summary>
  public static Guid? ExtractStreamId(object message, Type messageType);

  /// <summary>
  /// Get a singleton IStreamIdExtractor that delegates to the registry.
  /// Use this for DI registration.
  /// </summary>
  public static IStreamIdExtractor GetComposite();
}
```

## Marking Stream ID Properties

### Using [StreamKey] Attribute

Mark properties that identify the event stream:

```csharp{title="Using [StreamKey] Attribute" description="Mark properties that identify the event stream:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Using", "StreamKey"]}
public record OrderCreated : IEvent {
  [StreamKey]
  public required Guid OrderId { get; init; }  // This is the stream ID
  public required Guid CustomerId { get; init; }
  public required decimal Total { get; init; }
}

// When dispatching:
var receipt = await dispatcher.SendAsync(new OrderCreated {
  OrderId = orderId,
  CustomerId = customerId,
  Total = 99.99m
});
// receipt.StreamId == orderId
```

### Using IHasStreamId Interface

For auto-generated stream IDs:

```csharp{title="Using IHasStreamId Interface" description="For auto-generated stream IDs:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Messages", "Using", "IHasStreamId"]}
public record OrderCreated : IEvent, IHasStreamId {
  public Guid StreamId { get; set; }  // Auto-generated if empty
  public required Guid CustomerId { get; init; }
}
```

## Source-Generated Extractors

Extractors are **source-generated** at compile time:

```csharp{title="Source-Generated Extractors" description="Extractors are source-generated at compile time:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Source-Generated", "Extractors"]}
// Generated code (simplified)
namespace Whizbang.Core.Generated;

public static class StreamIdExtractors {
  public static Guid? TryResolveAsGuid(object message) {
    return message switch {
      OrderCreated e => e.OrderId,
      OrderShipped e => e.OrderId,
      PaymentProcessed e => e.PaymentId,
      _ => null
    };
  }
}
```

Benefits:
- **Zero reflection** - compile-time type switches
- **AOT compatible** - no runtime type discovery
- **Multi-assembly** - each assembly contributes extractors
- **Priority-based** - contracts assemblies tried first

## Multi-Assembly Extraction

When messages are defined in a "contracts" assembly:

```csharp{title="Multi-Assembly Extraction" description="When messages are defined in a 'contracts' assembly:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Messages", "Multi-Assembly", "Extraction"]}
// MyApp.Contracts assembly
namespace MyApp.Contracts;

public record OrderCreated : IEvent {
  [StreamKey]
  public required Guid OrderId { get; init; }
}
```

The generated extractor is registered via `[ModuleInitializer]`:

```csharp{title="Multi-Assembly Extraction (2)" description="The generated extractor is registered via [ModuleInitializer]:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Messages", "Multi-Assembly", "Extraction"]}
// Generated in MyApp.Contracts assembly
[ModuleInitializer]
public static void RegisterStreamIdExtractors() {
  StreamIdExtractorRegistry.Register(
      new MyAppContractsStreamIdExtractor(),
      priority: 100  // Contracts assemblies = higher priority
  );
}
```

When the service assembly loads:
1. Contracts assembly's `[ModuleInitializer]` runs
2. Extractor is registered with priority 100
3. Service's extractor is registered with priority 1000
4. Composite extractor tries contracts first

## Using Delivery Receipts

### Tracking Message Delivery

```csharp{title="Tracking Message Delivery" description="Tracking Message Delivery" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Tracking", "Message"]}
[HttpPost("orders")]
public async Task<ActionResult> CreateOrder(
    [FromBody] CreateOrderRequest request,
    CancellationToken ct) {

  var command = new CreateOrder {
    CustomerId = request.CustomerId,
    Items = request.Items
  };

  var receipt = await _dispatcher.SendAsync(command, ct);

  // Store receipt for tracking
  await _trackingService.StoreAsync(receipt);

  return Accepted(new {
    trackingUrl = $"/api/orders/status/{receipt.CorrelationId}",
    messageId = receipt.MessageId,
    streamId = receipt.StreamId
  });
}
```

### Correlation Tracking

```csharp{title="Correlation Tracking" description="Correlation Tracking" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Correlation", "Tracking"]}
// Check status by correlation ID
[HttpGet("orders/status/{correlationId:guid}")]
public async Task<ActionResult> GetStatus(Guid correlationId) {
  var status = await _trackingService.GetByCorrelationIdAsync(correlationId);

  return Ok(new {
    correlationId,
    status = status?.Status ?? "Unknown",
    events = status?.Events ?? []
  });
}
```

### Idempotency

```csharp{title="Idempotency" description="Idempotency" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Idempotency"]}
// Use MessageId for idempotency
public async Task ProcessWithIdempotencyAsync(DeliveryReceipt receipt) {
  if (await _idempotencyStore.ExistsAsync(receipt.MessageId)) {
    _logger.LogWarning("Duplicate message {MessageId}", receipt.MessageId);
    return;
  }

  await ProcessAsync();
  await _idempotencyStore.MarkProcessedAsync(receipt.MessageId);
}
```

## Best Practices

### DO

- **Use [StreamKey]** to mark stream ID properties
- **Store receipts** for important operations
- **Use CorrelationId** for distributed tracing
- **Use MessageId** for idempotency checks

### DON'T

- **Don't ignore receipts** for critical operations
- **Don't hardcode stream ID extraction** - use attributes
- **Don't mix approaches** - pick [StreamKey] or IHasStreamId

## Related Documentation

- [Stream ID](../events/stream-id.md) - IHasStreamId interface
- [Event Streams](../events/event-streams.md) - Stream organization
- [Dispatcher](../dispatcher/dispatcher.md) - SendAsync method
- [Assembly Registry](../identity/assembly-registry.md) - Multi-assembly registration

---

*Version 1.0.0 - Foundation Release*
