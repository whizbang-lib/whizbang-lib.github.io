---
title: Message Envelopes Deep Dive
version: 1.0.0
category: Messaging
order: 4
description: >-
  Deep dive into Message Envelopes - hop-based distributed tracing across
  Outbox, Inbox, and message transports
tags: >-
  message-envelopes, distributed-tracing, observability, cross-service,
  azure-service-bus
codeReferences:
  - src/Whizbang.Core/Observability/MessageEnvelope.cs
  - src/Whizbang.Core/Observability/MessageHop.cs
  - src/Whizbang.Transports.AzureServiceBus/AzureServiceBusTransport.cs
---

# Message Envelopes Deep Dive

This guide explores how **MessageEnvelope** enables hop-based distributed tracing across Outbox, Inbox, and message transports like Azure Service Bus.

See [Observability & Message Hops](../core-concepts/observability.md) for architectural overview. This document focuses on **practical messaging scenarios**.

---

## Envelope Flow Across Services

### Complete Journey

```
Service A (OrderService)
  ├─> CreateOrder command arrives
  ├─> Envelope created with Current hop
  ├─> Receptor processes, creates OrderCreated event
  ├─> Event stored in Outbox with inherited hops
  ├─> Background worker publishes to Azure Service Bus
  └─> Envelope serialized with all hops

      ↓ Azure Service Bus

Service B (InventoryWorker)
  ├─> Message arrives from Azure Service Bus
  ├─> Envelope deserialized (hops restored!)
  ├─> Stored in Inbox with all original hops
  ├─> Receptor processes, adds new Current hop
  ├─> InventoryReserved event created
  └─> Published to Azure Service Bus with accumulated hops

      ↓ Azure Service Bus

Service C (PaymentWorker)
  ├─> Message arrives with hops from A + B
  └─> Complete trace from HTTP request → Payment!
```

**Key Insight**: Hops **accumulate** across services, providing end-to-end trace.

---

## Outbox Integration

### Storing Envelope in Outbox

```csharp
public async ValueTask<OrderCreated> HandleAsync(
    CreateOrder message,
    CancellationToken ct = default) {

    // Create event
    var @event = new OrderCreated(/* ... */);

    // Create envelope with hops
    var envelope = MessageEnvelope.Create(
        messageId: MessageId.New(),
        correlationId: message.CorrelationId,
        causationId: CausationId.From(message.MessageId),
        payload: @event,
        currentHop: new MessageHop {
            Type = MessageHopType.Current,
            Topic = "orders",
            StreamKey: message.CustomerId.ToString(),
            SecurityContext = GetSecurityContext(),
            Metadata = new Dictionary<string, string> {
                ["ServiceName"] = "OrderService",
                ["ReceptorName"] = nameof(CreateOrderReceptor)
            },
            Timestamp = DateTimeOffset.UtcNow
        },
        causationHops: message.Envelope.Hops  // Inherit parent hops!
    );

    // Store in outbox (serialize envelope)
    await _coordinator.ProcessWorkBatchAsync(
        /* ... */,
        newOutboxMessages: [
            new OutboxMessage(
                MessageId: envelope.MessageId.Value,
                CorrelationId: envelope.CorrelationId.Value,
                CausationId: envelope.CausationId?.Value,
                MessageType: typeof(OrderCreated).FullName!,
                Payload: JsonSerializer.Serialize(envelope),  // ← Full envelope!
                Topic: "orders",
                StreamKey: message.CustomerId.ToString(),
                PartitionKey: message.CustomerId.ToString()
            )
        ],
        /* ... */
    );

    return @event;
}
```

**Key Points**:
- Envelope includes **all hops** (current + causation)
- Serialized as JSON in `Payload` field
- Hops **persist** in database for auditability

---

## Publishing with Hops

### Azure Service Bus Integration

```csharp
public class AzureServiceBusTransport : IMessageTransport {
    public async Task PublishAsync(
        string topic,
        MessageEnvelope envelope,
        CancellationToken ct = default) {

        // Serialize envelope (includes all hops)
        var json = JsonSerializer.Serialize(envelope, _jsonOptions);

        var message = new ServiceBusMessage(json) {
            MessageId = envelope.MessageId.Value.ToString(),
            CorrelationId = envelope.CorrelationId.Value.ToString(),
            Subject = envelope.Payload.GetType().Name,

            // Add custom properties for routing
            ApplicationProperties = {
                ["MessageType"] = envelope.Payload.GetType().FullName,
                ["CausationId"] = envelope.CausationId?.Value.ToString() ?? "",
                ["HopCount"] = envelope.Hops.Count,  // For monitoring
                ["OriginatingService"] = envelope.Hops.FirstOrDefault()?.Metadata?["ServiceName"] ?? "Unknown"
            }
        };

        var sender = _client.CreateSender(topic);
        await sender.SendMessageAsync(message, ct);

        _logger.LogInformation(
            "Published message {MessageId} to topic {Topic} with {HopCount} hops",
            envelope.MessageId, topic, envelope.Hops.Count
        );
    }
}
```

**Result**: Envelope with **all hops** transmitted to Azure Service Bus!

---

## Receiving with Hops

### Inbox Deduplication + Hop Restoration

```csharp
public async Task SubscribeAsync(
    string topic,
    Func<MessageEnvelope, CancellationToken, Task> handler,
    CancellationToken ct = default) {

    var processor = _client.CreateProcessor(topic, new ServiceBusProcessorOptions());

    processor.ProcessMessageAsync += async args => {
        try {
            // 1. Deserialize envelope (hops restored!)
            var envelope = JsonSerializer.Deserialize<MessageEnvelope>(
                args.Message.Body.ToString(),
                _jsonOptions
            );

            if (envelope is null) {
                _logger.LogError("Failed to deserialize envelope");
                await args.CompleteMessageAsync(args.Message, ct);
                return;
            }

            _logger.LogInformation(
                "Received message {MessageId} with {HopCount} hops, CorrelationId {CorrelationId}",
                envelope.MessageId, envelope.Hops.Count, envelope.CorrelationId
            );

            // 2. Check inbox for duplicate
            var isDuplicate = await _coordinator.IsMessageInInboxAsync(
                envelope.MessageId.Value,
                ct
            );

            if (isDuplicate) {
                _logger.LogWarning(
                    "Duplicate message {MessageId} detected, skipping",
                    envelope.MessageId
                );
                await args.CompleteMessageAsync(args.Message, ct);
                return;
            }

            // 3. Store in inbox
            await _coordinator.ProcessWorkBatchAsync(
                /* ... */,
                newInboxMessages: [
                    new InboxMessage(
                        MessageId: envelope.MessageId.Value,
                        CorrelationId: envelope.CorrelationId.Value,
                        CausationId: envelope.CausationId?.Value,
                        MessageType: envelope.Payload.GetType().FullName!,
                        Payload: JsonSerializer.Serialize(envelope),  // Store full envelope
                        SourceTopic: topic
                    )
                ],
                /* ... */
            );

            // 4. Process message (handler receives envelope with hops!)
            await handler(envelope, ct);

            // 5. Complete message
            await args.CompleteMessageAsync(args.Message, ct);

        } catch (Exception ex) {
            _logger.LogError(ex, "Error processing message");
            await args.AbandonMessageAsync(args.Message);
        }
    };

    await processor.StartProcessingAsync(ct);
}
```

**Key Points**:
- Envelope **deserialized** with all hops intact
- Hops stored in inbox for auditability
- Handler receives **full envelope** (not just payload)

---

## Adding Hops in Workers

### InventoryWorker Example

```csharp
public async Task ProcessOrderCreatedAsync(
    MessageEnvelope envelope,
    CancellationToken ct = default) {

    var orderCreated = (OrderCreated)envelope.Payload;

    // Business logic: Reserve inventory
    await ReserveInventoryAsync(orderCreated, ct);

    // Create InventoryReserved event
    var inventoryReserved = new InventoryReserved(
        OrderId: orderCreated.OrderId,
        Reservations: /* ... */,
        ReservedAt: DateTimeOffset.UtcNow
    );

    // Create envelope with NEW hop
    var newEnvelope = MessageEnvelope.Create(
        messageId: MessageId.New(),
        correlationId: envelope.CorrelationId,  // Inherit
        causationId: CausationId.From(envelope.MessageId),  // Parent
        payload: inventoryReserved,
        currentHop: new MessageHop {
            Type = MessageHopType.Current,
            Topic = "inventory",
            StreamKey: orderCreated.OrderId.ToString(),
            SecurityContext = envelope.Hops.FirstOrDefault()?.SecurityContext,  // Inherit security
            Metadata = new Dictionary<string, string> {
                ["ServiceName"] = "InventoryWorker",
                ["ReceptorName"] = "ReserveInventoryReceptor",
                ["OriginalOrderId"] = orderCreated.OrderId.ToString()
            },
            Timestamp = DateTimeOffset.UtcNow
        },
        causationHops: envelope.Hops  // ← INHERIT ALL PARENT HOPS!
    );

    // Store in outbox for publishing
    await _coordinator.ProcessWorkBatchAsync(
        /* ... */,
        newOutboxMessages: [
            new OutboxMessage(
                MessageId: newEnvelope.MessageId.Value,
                CorrelationId: newEnvelope.CorrelationId.Value,
                CausationId: newEnvelope.CausationId?.Value,
                MessageType: typeof(InventoryReserved).FullName!,
                Payload: JsonSerializer.Serialize(newEnvelope),
                Topic: "inventory",
                StreamKey: orderCreated.OrderId.ToString(),
                PartitionKey: orderCreated.OrderId.ToString()
            )
        ],
        /* ... */
    );

    _logger.LogInformation(
        "Published InventoryReserved event with {HopCount} hops (inherited {InheritedHops})",
        newEnvelope.Hops.Count,
        newEnvelope.Hops.Count(h => h.Type == MessageHopType.Causation)
    );
}
```

**Result**: `InventoryReserved` envelope contains:
1. Current hop (InventoryWorker)
2. All causation hops from `OrderCreated` (OrderService, API Gateway, etc.)

---

## Querying Hops Across Services

### Find Complete Workflow

```sql
-- Find all messages in a workflow (all services)
SELECT
    o.message_id,
    o.message_type,
    o.topic,
    o.created_at,
    (o.payload::JSONB)->'Hops' AS hops
FROM wh_outbox o
WHERE (o.payload::JSONB)->>'CorrelationId' = 'corr-abc'
ORDER BY o.created_at;
```

**Example output**:
```
message_id | message_type       | topic     | created_at          | hops
-----------|--------------------|-----------|---------------------|------
msg-001    | OrderCreated       | orders    | 2024-12-12 10:00:00 | [API Gateway]
msg-002    | InventoryReserved  | inventory | 2024-12-12 10:00:01 | [API Gateway, OrderService]
msg-003    | PaymentProcessed   | payment   | 2024-12-12 10:00:02 | [API Gateway, OrderService, InventoryWorker]
```

### Visualize Hop Accumulation

```csharp
public void PrintHopAccumulation(Guid correlationId) {
    var messages = GetMessagesByCorrelation(correlationId);

    foreach (var msg in messages) {
        Console.WriteLine($"{msg.MessageType} ({msg.Timestamp}):");

        for (int i = 0; i < msg.Envelope.Hops.Count; i++) {
            var hop = msg.Envelope.Hops[i];
            var prefix = new string(' ', i * 2);
            var type = hop.Type == MessageHopType.Current ? "CURRENT" : "CAUSATION";

            Console.WriteLine($"{prefix}├─ {type}: {hop.Metadata?["ServiceName"]}");
        }

        Console.WriteLine();
    }
}
```

**Output**:
```
OrderCreated (2024-12-12 10:00:00):
├─ CURRENT: OrderService

InventoryReserved (2024-12-12 10:00:01):
├─ CAUSATION: OrderService
  ├─ CURRENT: InventoryWorker

PaymentProcessed (2024-12-12 10:00:02):
├─ CAUSATION: OrderService
  ├─ CAUSATION: InventoryWorker
    ├─ CURRENT: PaymentWorker
```

---

## Security Context Propagation

### Extracting Security from Hops

```csharp
public async Task<InventoryReserved> HandleAsync(
    MessageEnvelope envelope,
    CancellationToken ct = default) {

    // Extract security context from first hop (originating service)
    var securityContext = envelope.Hops
        .FirstOrDefault(h => h.SecurityContext is not null)?
        .SecurityContext;

    if (securityContext?.UserId is null) {
        throw new UnauthorizedAccessException("No user context in hops");
    }

    // Validate tenant isolation
    if (securityContext.TenantId != expectedTenantId) {
        throw new ForbiddenException("Tenant mismatch");
    }

    // Business logic with security context
    await ReserveInventoryAsync(orderCreated, securityContext, ct);
}
```

**Benefit**: Security context flows **automatically** via hops!

---

## Best Practices

### DO ✅

- ✅ **Inherit causation hops** when creating new messages
- ✅ **Add current hop** with service name, timestamp, metadata
- ✅ **Propagate security context** via hops
- ✅ **Store envelopes** in outbox/inbox (full auditability)
- ✅ **Query by CorrelationId** for end-to-end traces
- ✅ **Monitor hop count** (alert if > 10 hops indicates circular dependency)
- ✅ **Include debug info** (CallerMemberName, FilePath, LineNumber)

### DON'T ❌

- ❌ Discard causation hops (breaks tracing)
- ❌ Modify inherited hops (immutable!)
- ❌ Skip adding current hop (incomplete trace)
- ❌ Store sensitive data in metadata (use SecurityContext)
- ❌ Ignore hop count limits (circular dependencies)
- ❌ Forget to log hop information

---

## Troubleshooting

### Problem: Missing Hops

**Symptom**: Messages arrive with fewer hops than expected.

**Causes**:
1. Worker not inheriting causation hops
2. Envelope not serialized/deserialized correctly
3. Hops not stored in outbox

**Solution**:
```csharp
// Verify hops are inherited
var newEnvelope = MessageEnvelope.Create(
    /* ... */,
    causationHops: parentEnvelope.Hops  // ← REQUIRED!
);

// Verify serialization
var json = JsonSerializer.Serialize(envelope);
var deserialized = JsonSerializer.Deserialize<MessageEnvelope>(json);
Debug.Assert(deserialized.Hops.Count == envelope.Hops.Count);
```

### Problem: Circular Dependencies

**Symptom**: Hop count grows indefinitely.

**Causes**:
1. Service A publishes event that triggers Service B
2. Service B publishes event that triggers Service A
3. Loop repeats forever

**Solution**:
```csharp
// Detect circular dependency via hop count
if (envelope.Hops.Count > 10) {
    _logger.LogError(
        "Circular dependency detected! {HopCount} hops for {CorrelationId}",
        envelope.Hops.Count, envelope.CorrelationId
    );

    // Break the loop
    return;
}
```

---

## Performance Considerations

### Hop Size

**Typical hop**: ~500 bytes (JSON)

**10 hops**: ~5KB total envelope size

**Recommendation**: Limit hops to 10-20 max to prevent payload bloat.

### Serialization Performance

```csharp
// ✅ Efficient: Use JsonTypeInfo for AOT
var json = JsonSerializer.Serialize(
    envelope,
    _jsonOptions.GetTypeInfo(typeof(MessageEnvelope))
);

// ❌ Slow: Reflection-based serialization
var json = JsonSerializer.Serialize(envelope);  // Not AOT-compatible
```

---

## Further Reading

**Core Concepts**:
- [Observability & Message Hops](../core-concepts/observability.md) - Architecture overview
- [Message Context](../core-concepts/message-context.md) - MessageId, CorrelationId, CausationId

**Messaging Patterns**:
- [Outbox Pattern](outbox-pattern.md) - Reliable publishing with hops
- [Inbox Pattern](inbox-pattern.md) - Exactly-once processing with hops
- [Work Coordinator](work-coordinator.md) - Atomic batch processing

**Transports**:
- [Azure Service Bus](../transports/azure-service-bus.md) - ASB integration with hops

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
