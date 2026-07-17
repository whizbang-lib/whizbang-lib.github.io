---
title: Transports Component
pageType: overview
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Components
order: 9
description: >-
  The ITransport abstraction - capabilities, publishing, batch subscriptions,
  and bulk publishing across in-process and broker transports
tags: 'transports, messaging, in-process, communication, bulk-publish, batch-subscribe'
codeReferences:
  - src/Whizbang.Core/Transports/ITransport.cs
  - src/Whizbang.Core/Transports/TransportCapabilities.cs
  - src/Whizbang.Core/Transports/TransportDestination.cs
  - src/Whizbang.Core/Transports/InProcessTransport.cs
  - src/Whizbang.Core/Transports/ITransportManager.cs
  - src/Whizbang.Core/Transports/ISubscription.cs
  - src/Whizbang.Core/Transports/IMessageSerializer.cs
  - src/Whizbang.Core/Transports/BulkPublish.cs
  - src/Whizbang.Core/Workers/IMessagePublishStrategy.cs
  - src/Whizbang.Core/Workers/TransportPublishStrategy.cs
  - src/Whizbang.Core/Workers/OutboxPublishWorker.cs
testReferences:
  - tests/Whizbang.Transports.Tests/ITransportTests.cs
  - tests/Whizbang.Transports.Tests/TransportCapabilitiesTests.cs
  - tests/Whizbang.Transports.Tests/TransportDestinationTests.cs
  - tests/Whizbang.Transports.Tests/InProcessTransportTests.cs
  - tests/Whizbang.Transports.Tests/ISubscriptionTests.cs
  - tests/Whizbang.Transports.Tests/BulkPublishTests.cs
  - tests/Whizbang.Transports.Tests/SubscribeBatchTests.cs
  - tests/Whizbang.Core.Tests/Workers/TransportPublishStrategyTests.cs
  - tests/Whizbang.Core.Tests/Workers/MessagePublishStrategyTests.cs
  - tests/Whizbang.Core.Tests/Workers/OutboxPublishWorkerTests.cs
lastMaintainedCommit: '01f07906'
---

# Transports Component

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Status](https://img.shields.io/badge/status-stable-green)

## Overview

Transports provide the communication layer in Whizbang, enabling message exchange between services. Three transport drivers ship today:

- **In-process** (`InProcessTransport`) - direct in-memory delivery for tests and single-process apps
- **RabbitMQ** (`RabbitMQTransport`) - see [RabbitMQ Transport](rabbitmq.md)
- **Azure Service Bus** (`AzureServiceBusTransport`) - see [Azure Service Bus Transport](azure-service-bus.md)

All three implement the same `ITransport` interface, so application code and the outbox/inbox workers are transport-agnostic.

## What is a Transport?

A Transport:
- **Carries** message envelopes between services
- **Handles** wire serialization and deserialization (AOT-safe, via `JsonContextRegistry`)
- **Manages** connections and channels
- **Declares** its delivery guarantees through capability flags

Think of transports as the postal service of your application - they ensure messages get from sender to receiver reliably.

## Core Interface

The real `ITransport` surface (`src/Whizbang.Core/Transports/ITransport.cs`):

```csharp{title="ITransport interface" description="The transport abstraction: initialization, capabilities, publish, batch subscribe, request/response, and bulk publish" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Core", "Interface"]}
public interface ITransport {
    // Lifecycle
    bool IsInitialized { get; }
    Task InitializeAsync(CancellationToken cancellationToken = default);

    // What this transport supports (flags)
    TransportCapabilities Capabilities { get; }

    // Max wire size in bytes; null = no limit relevant to offload decisions.
    // Size-aware strategies (body offload / claim-check) read this pre-flight.
    long? MaxMessageSizeBytes => null;

    // Fire-and-forget publish of one envelope
    Task PublishAsync(
        IMessageEnvelope envelope,
        TransportDestination destination,
        string? envelopeType = null,
        ReadOnlyMemory<byte>? preSerializedBytes = null,
        CancellationToken cancellationToken = default);

    // Subscribe with transport-level batch collection: the handler is invoked
    // once per batch (size reached, sliding window, or hard max timeout)
    Task<ISubscription> SubscribeBatchAsync(
        Func<IReadOnlyList<TransportMessage>, CancellationToken, Task> batchHandler,
        TransportDestination destination,
        TransportBatchOptions batchOptions,
        CancellationToken cancellationToken = default);

    // Push subscription on the broker's dead-letter queue.
    // Default implementation throws NotSupportedException (polling fallback).
    Task<ISubscription> SubscribeToDeadLetterAsync(
        Func<TransportMessage, CancellationToken, Task> handler,
        TransportDestination destination,
        CancellationToken cancellationToken = default);

    // Request/response pattern
    Task<IMessageEnvelope> SendAsync<TRequest, TResponse>(
        IMessageEnvelope requestEnvelope,
        TransportDestination destination,
        CancellationToken cancellationToken = default)
        where TRequest : notnull where TResponse : notnull;

    // Bulk publish (see the Bulk Publishing section below).
    // Default implementation throws NotSupportedException.
    Task<IReadOnlyList<BulkPublishItemResult>> PublishBatchAsync(
        IReadOnlyList<BulkPublishItem> items,
        TransportDestination destination,
        CancellationToken cancellationToken = default);
}
```

`TransportMessage` is a lightweight value type pairing a deserialized `IMessageEnvelope` with its assembly-qualified envelope type name:

```csharp{title="TransportMessage" description="A deserialized transport message ready for batch processing" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Batching"]}
public readonly record struct TransportMessage(
    IMessageEnvelope Envelope,
    string? EnvelopeType
);
```

### Transport Capabilities

`TransportCapabilities` is a `[Flags]` enum - transports combine the flags they support:

```csharp{title="TransportCapabilities flags" description="Capability flags a transport can declare" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Capabilities"]}
[Flags]
public enum TransportCapabilities {
    None             = 0,
    RequestResponse  = 1 << 0,  // Send/Receive pattern
    PublishSubscribe = 1 << 1,  // Pub/sub pattern
    Streaming        = 1 << 2,  // IAsyncEnumerable streams
    Reliable         = 1 << 3,  // At-least-once delivery
    Ordered          = 1 << 4,  // Ordering within a stream/partition
    ExactlyOnce      = 1 << 5,  // Requires inbox/outbox dedup
    BulkPublish      = 1 << 6,  // Batch multiple messages per transport call
    All = RequestResponse | PublishSubscribe | Streaming | Reliable | Ordered | ExactlyOnce | BulkPublish
}
```

| Transport | Declared capabilities |
|-----------|----------------------|
| `InProcessTransport` | `RequestResponse \| PublishSubscribe \| Ordered \| Reliable` |
| `RabbitMQTransport` | `PublishSubscribe \| Reliable \| BulkPublish` (+ `Ordered` when Single Active Consumer is enabled) |
| `AzureServiceBusTransport` | `PublishSubscribe \| Reliable \| BulkPublish` (+ `Ordered` when sessions are enabled) |

## Transport Destinations

Where a message goes is expressed with `TransportDestination` - an address, an optional routing key, and optional transport-specific metadata:

```csharp{title="TransportDestination" description="Address, routing key, and metadata describing where a message is sent" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Destination"]}
public record TransportDestination(
    string Address,                                        // queue/topic/exchange name (required, non-empty)
    string? RoutingKey = null,                             // e.g. "orders.created"
    IReadOnlyDictionary<string, JsonElement>? Metadata = null  // transport-specific extras
);
```

Each transport interprets these differently - see [Infrastructure Mapping](infrastructure-mapping.md) for the full per-transport breakdown.

## Message Envelopes

Messages travel as `IMessageEnvelope` instances. The concrete `MessageEnvelope<T>` requires an id, payload, dispatch context, and at least one hop:

```csharp{title="Constructing an envelope" description="MessageEnvelope<T> with its required properties" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "Envelope"]}
var envelope = new MessageEnvelope<OrderCreatedEvent> {
    MessageId = MessageId.New(),
    Payload = new OrderCreatedEvent { OrderId = orderId, CustomerId = customerId },
    DispatchContext = new MessageDispatchContext {
        Mode = DispatchModes.Outbox,
        Source = MessageSource.Outbox
    },
    Hops = [
        new MessageHop {
            Type = HopType.Current,
            Timestamp = DateTimeOffset.UtcNow,
            Topic = "orders",
            ServiceInstance = ServiceInstanceInfo.Unknown
        }
    ]
};
```

:::info
In normal application code you rarely build envelopes by hand - the **Dispatcher** wraps your commands/events in envelopes and routes them through the outbox. Direct `ITransport` use is for infrastructure code and tests.
:::

## In-Process Transport

`InProcessTransport` delivers envelopes directly in memory - no serialization, no network. `PublishAsync` enqueues into each active subscription's batch collector; paused subscriptions are skipped. `SendAsync` implements request/response by subscribing to a per-request `response-{messageId}` destination before publishing the request.

```csharp{title="In-process publish and batch subscribe" description="Using InProcessTransport directly - the same ITransport calls work against RabbitMQ and Azure Service Bus" category="Configuration" difficulty="INTERMEDIATE" tags=["Messaging", "Transports", "In-Process"]}
var transport = new InProcessTransport();
await transport.InitializeAsync();

var destination = new TransportDestination("orders");

var subscription = await transport.SubscribeBatchAsync(
    batchHandler: (batch, ct) => {
        foreach (var message in batch) {
            Console.WriteLine($"Received {message.Envelope.MessageId}");
        }
        return Task.CompletedTask;
    },
    destination,
    new TransportBatchOptions { BatchSize = 1, SlideMs = 20, MaxWaitMs = 1000 });

await transport.PublishAsync(envelope, destination);

// ISubscription supports pause/resume and disposal
await subscription.PauseAsync();
await subscription.ResumeAsync();
subscription.Dispose();
```

`TransportBatchOptions` defaults: `BatchSize = 200`, `SlideMs = 20`, `MaxWaitMs = 1000`.

## Transport Registration

Each transport package ships its own DI extension; the in-process transport is registered directly:

```csharp{title="Transport Registration" description="Registering a transport - one ITransport per host" category="Configuration" difficulty="BEGINNER" tags=["Messaging", "Transports", "Registration"]}
// In-process (tests, single-process apps)
services.AddSingleton<ITransport>(new InProcessTransport());

// RabbitMQ (Whizbang.Transports.RabbitMQ)
services.AddRabbitMQTransport("amqp://guest:guest@localhost:5672/");

// Azure Service Bus (Whizbang.Transports.AzureServiceBus)
services.AddAzureServiceBusTransport(connectionString);
```

The broker extensions also register an `ITransportReadinessCheck`, an `IInfrastructureProvisioner`, and an `IMessagePublishStrategy` (the seam the outbox workers publish through). To consume messages, chain `WithRouting(...)` and `AddTransportConsumer()` - see [Transport Consumer](transport-consumer.md).

## Bulk Publishing

:::new
Transports can declare the `BulkPublish` capability to enable batching multiple messages in a single transport operation.
:::

When a transport supports `BulkPublish`, the outbox publish path drains multiple outbox rows and publishes them in batch calls, reducing network round-trips.

### How It Works

1. The publish strategy exposes `IMessagePublishStrategy.SupportsBulkPublish`, which `TransportPublishStrategy` derives from `ITransport.Capabilities.HasFlag(TransportCapabilities.BulkPublish)`
2. The outbox worker drains a batch of pending messages (up to `MaxBulkPublishBatchSize` on the `OutboxPublishWorker` path; the per-stream `OutboxDrainWorker` batches a stream's newly-claimed rows)
3. `TransportPublishStrategy.PublishBatchAsync` groups messages by **(destination address, stream id)** - messages with the same `StreamId` stay in one batch so session-based transports never mix streams
4. Each group is published via `ITransport.PublishBatchAsync()` in a single transport call, with per-item results for partial-failure handling
5. Per-message lifecycle hooks (PreOutbox/PostOutbox) still fire individually

### Capability Detection

```csharp{title="Capability Detection" category="Configuration" difficulty="INTERMEDIATE" tags=["Transports", "BulkPublish"]}
// Transports declare their capabilities via the Capabilities property
public TransportCapabilities Capabilities =>
    TransportCapabilities.PublishSubscribe |
    TransportCapabilities.Reliable |
    TransportCapabilities.BulkPublish;

// The ITransport interface provides a default implementation that throws
// NotSupportedException — transports override it when they support batching
Task<IReadOnlyList<BulkPublishItemResult>> PublishBatchAsync(
    IReadOnlyList<BulkPublishItem> items,
    TransportDestination destination,
    CancellationToken cancellationToken = default);
```

Each `BulkPublishItem` carries the envelope, its type name, a `MessageId`, an optional per-item `RoutingKey` (overriding the destination's), an optional `StreamId` for FIFO ordering, optional `PreSerializedBytes`, and optional `PerItemMetadata` (per-item keys override shared destination metadata).

### Configuration

```csharp{title="Bulk Publish Options" category="Configuration" difficulty="BEGINNER" tags=["Transports", "BulkPublish", "Options"]}
services.Configure<OutboxPublishWorkerOptions>(options => {
    options.MaxBulkPublishBatchSize = 50; // Default: 100
});
```

:::updated
The options class is `OutboxPublishWorkerOptions` (the legacy `WorkCoordinatorPublisherWorker` and its options class were removed) and the default batch size is **100**. Note that `OutboxPublishWorker` is disabled by default (`Enabled = false`) - the per-stream `OutboxDrainWorker` is the active outbox publish path, and it uses the same bulk-capable `TransportPublishStrategy`.
:::

### Transport Support

| Transport | BulkPublish | Mechanism |
|-----------|:-----------:|-----------|
| InProcess | No | No network benefit |
| Azure Service Bus | Yes | `CreateMessageBatchAsync` with auto-split when a message doesn't fit the current batch |
| RabbitMQ | Yes | Pipelined `BasicPublishAsync` calls on a single pooled channel (issued sequentially, confirms awaited together) |

## Limitations of the In-Process Transport

:::info
These apply to `InProcessTransport` only - use RabbitMQ or Azure Service Bus for distributed messaging:
:::

- **In-process only** - No network communication
- **No persistence** - Messages lost on crash (durability comes from the outbox/inbox tables, not the transport)
- **No serialization** - The live CLR envelope reference is handed to subscribers (`preSerializedBytes` is ignored)
- **Single instance** - No distributed messaging

## Best Practices

1. **Design for distribution** - Even with in-process, assume network
2. **Use message contracts** - Define clear message schemas
3. **Handle failures** - Plan for transport failures
4. **Version messages** - Plan for message evolution
5. **Keep messages small** - Large messages impact performance; size-aware body offload uses `MaxMessageSizeBytes`
6. **Test with different transports** - Ensure transport agnostic code

## Related Documentation

- [Infrastructure Mapping](infrastructure-mapping.md) - How topics, streams, and partitions map to each transport
- [Transport Consumer](transport-consumer.md) - Consuming messages with auto-generated subscriptions
- [RabbitMQ Transport](rabbitmq.md) - Topic exchanges, channel pooling, dead-letter queues
- [Azure Service Bus Transport](azure-service-bus.md) - Sessions, SQL filters, scheduled messages
- [In-Memory Transport](in-memory.md) - Testing and development
- [Dispatcher](../../fundamentals/dispatcher/dispatcher.md) - How messages are routed
- [Receptors](../../fundamentals/receptors/receptors.md) - Message handlers
