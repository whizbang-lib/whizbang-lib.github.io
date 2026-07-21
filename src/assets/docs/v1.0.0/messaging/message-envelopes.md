---
title: Message Envelopes Deep Dive
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
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
  - src/Whizbang.Core/Observability/IMessageEnvelope.cs
  - src/Whizbang.Core/Observability/MessageHop.cs
  - src/Whizbang.Core/Observability/EnvelopeMetadata.cs
  - src/Whizbang.Transports.AzureServiceBus/AzureServiceBusTransport.cs
testReferences:
  - tests/Whizbang.Core.Tests/Observability/MessageEnvelopeTests.cs
  - tests/Whizbang.Core.Tests/Observability/MessageEnvelopeVersionTests.cs
  - tests/Whizbang.Core.Tests/Observability/MessageEnvelopeExtensionsTests.cs
  - tests/Whizbang.Core.Tests/Observability/CascadeEnvelopeWrapperCausationTests.cs
lastMaintainedCommit: '01f07906'
---

# Message Envelopes Deep Dive

This guide explores how **MessageEnvelope** enables hop-based distributed tracing across Outbox, Inbox, and message transports like Azure Service Bus.

See [Observability & Message Hops](../fundamentals/persistence/observability.md) for architectural overview. This document focuses on **practical messaging scenarios**.

---

## Envelope Flow Across Services

### Complete Journey

```mermaid{caption="End-to-end envelope journey — hops accumulate across Service A → B → C over Azure Service Bus, preserving the full causation trace."}
flowchart TD
    A["Service A (OrderService)<br/><br/>CreateOrder command arrives<br/>Envelope created with Current hop<br/>Receptor processes, creates OrderCreated event<br/>Event stored in Outbox with inherited hops<br/>Background worker publishes to Azure Service Bus<br/>Envelope serialized with all hops"]
    B["Service B (InventoryWorker)<br/><br/>Message arrives from Azure Service Bus<br/>Envelope deserialized (hops restored!)<br/>Stored in Inbox with all original hops<br/>Receptor processes, adds new Current hop<br/>InventoryReserved event created<br/>Published to Azure Service Bus with accumulated hops"]
    C["Service C (PaymentWorker)<br/><br/>Message arrives with hops from A + B<br/>Complete trace from HTTP request → Payment!"]

    A -->|"Azure Service Bus"| B
    B -->|"Azure Service Bus"| C

    class A,B,C layer-command
```

**Key Insight**: Hops **accumulate** across services, providing end-to-end trace.

---

## The Envelope Model

The framework creates envelopes for you — when a receptor calls `dispatcher.PublishAsync(event)`, the dispatcher wraps the payload in a `MessageEnvelope<TMessage>`, inherits the parent's hops, and appends a new hop with caller info.

### Wire Shape (Compact JSON Names)

Envelope and hop properties serialize with **short JSON names** to keep payloads small:

```csharp{title="Envelope and Hop Shape" description="IMessageEnvelope and MessageHop with their compact JSON property names" category="Architecture" difficulty="ADVANCED" tags=["Messaging", "C#", "Storing", "Envelope", "Outbox"] unverified="wire-shape declaration — the compact JSON property-name contract is verified by MessageEnvelopeVersionTests, which is outside the current coverage map"}
public interface IMessageEnvelope {
    [JsonPropertyName("v")]  int Version { get; }                        // Envelope schema version
    [JsonPropertyName("dc")] MessageDispatchContext DispatchContext { get; }
    [JsonPropertyName("id")] MessageId MessageId { get; }
    [JsonPropertyName("p")]  object Payload { get; }
    [JsonPropertyName("h")]  List<MessageHop> Hops { get; }
    [JsonPropertyName("sid")]  Guid SourceServiceId { get; }             // Source-service identity
    [JsonPropertyName("sseq")] long SourceCommitSequence { get; }
    // ...
}

public record MessageHop {
    [JsonPropertyName("ty")] public HopType Type { get; init; }          // Current | Causation
    [JsonPropertyName("ca")] public MessageId? CausationId { get; init; }
    [JsonPropertyName("co")] public CorrelationId? CorrelationId { get; init; }
    [JsonPropertyName("ct")] public string? CausationType { get; init; }
    [JsonPropertyName("si")] public required ServiceInstanceInfo ServiceInstance { get; init; }
    [JsonPropertyName("ts")] public DateTimeOffset Timestamp { get; init; }
    [JsonPropertyName("to")] public string Topic { get; init; }
    [JsonPropertyName("st")] public string StreamId { get; init; }
    [JsonPropertyName("sc")] public ScopeDelta? Scope { get; init; }     // Scope propagation
    [JsonPropertyName("md")] public IReadOnlyDictionary<string, JsonElement>? Metadata { get; init; }
    [JsonPropertyName("cm")] public string? CallerMemberName { get; init; }  // Debug: who dispatched
    [JsonPropertyName("cf")] public string? CallerFilePath { get; init; }
    [JsonPropertyName("cl")] public int? CallerLineNumber { get; init; }
    [JsonPropertyName("du")] public TimeSpan Duration { get; init; }
    [JsonPropertyName("tp")] public string? TraceParent { get; init; }   // W3C trace context
    // ...
}
```

**Key Points**:
- Envelope includes **all hops** (current + causation), each stamped with service instance, timestamp, and caller info (`cm`/`cf`/`cl`)
- Hops carry **scope deltas** (`sc`) for scope/security propagation
- The outbox/inbox `metadata` column persists `EnvelopeMetadata` (MessageId + Hops) for auditability

---

## Publishing with Hops

### Azure Service Bus Integration

`AzureServiceBusTransport` serializes the full envelope (all hops included) as the message body and maps envelope identity onto broker properties:

```csharp{title="Azure Service Bus Integration" description="How AzureServiceBusTransport maps envelope fields onto ServiceBusMessage" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Azure", "Service", "Bus"] unverified="AzureServiceBusTransport internals — verified in the Azure Service Bus transport tests, not by envelope tests"}
// Inside AzureServiceBusTransport.PublishAsync (simplified):
var message = new ServiceBusMessage(json) {   // json = serialized envelope w/ all hops
    MessageId = envelope.MessageId.Value.ToString(),
    Subject = destination.RoutingKey ?? "message",
    ContentType = "application/json"
};

// SessionId = StreamId for FIFO ordering (session-enabled subscriptions)
if (destination.Metadata?.TryGetValue("StreamId", out var streamIdElement) == true) {
    message.SessionId = streamIdElement.ToString();
}

// Envelope type for AOT-safe deserialization on the receive side
message.ApplicationProperties["EnvelopeType"] = envelopeTypeName;

// Correlation / causation from the hop chain
var correlationId = envelope.GetCorrelationId();
if (correlationId != null) {
    message.CorrelationId = correlationId.Value.Value.ToString();
}
var causationId = envelope.GetCausationId();
if (causationId != null) {
    message.ApplicationProperties["CausationId"] = causationId.Value.Value.ToString();
}
```

**Result**: Envelope with **all hops** transmitted to Azure Service Bus — and stream-FIFO ordering preserved via sessions.

---

## Receiving with Hops

### Inbox Deduplication + Hop Restoration

The receive side is handled by `TransportConsumerWorker`:

1. **Header check first**: the `EnvelopeType` application property is read *before* deserialization; messages no receptor, perspective, or tag attribute subscribes to are **discarded at the receive boundary** — no inbox row, no deserialization
2. **AOT-safe deserialization**: the envelope is deserialized via the registered `JsonTypeInfo` for its envelope type — hops restored intact
3. **Store**: `StoreInboxMessagesAsync` → `store_inbox_messages` persists the row with its `EnvelopeMetadata` (MessageId + Hops); the dedup table rejects duplicates atomically
4. **Process**: handlers receive the full envelope — hop history, scope, and correlation identity intact

```csharp{title="Reading Envelope Identity" description="Read-only accessors on IMessageEnvelope" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Inbox", "Deduplication", "Hop"] tests=["MessageEnvelopeTests.GetCorrelationId_ReturnsFirstHopCorrelationIdAsync", "MessageEnvelopeTests.GetCausationId_ReturnsFirstHopCausationIdAsync", "MessageEnvelopeTests.GetMessageTimestamp_ReturnsFirstHopTimestampAsync", "MessageEnvelopeTests.GetCurrentScope_IgnoresCausationHopsAsync", "MessageEnvelopeTests.GetMetadata_ReturnsLatestValue_WhenKeyExistsInMultipleHopsAsync", "MessageEnvelopeTests.GetCausationHops_ReturnsOnlyCausationHopsAsync", "MessageEnvelopeTests.GetCurrentHops_ReturnsOnlyCurrentHopsAsync"]}
// Identity and history are read via accessors — derived from the hop chain:
CorrelationId? correlationId = envelope.GetCorrelationId();
MessageId? causationId = envelope.GetCausationId();
DateTimeOffset timestamp = envelope.GetMessageTimestamp();
ScopeContext? scope = envelope.GetCurrentScope();

// Metadata is READ-ONLY via GetMetadata — it searches Current hops newest-first:
JsonElement? tenantId = envelope.GetMetadata("TenantId");

// Hop history:
IReadOnlyList<MessageHop> causationHops = envelope.GetCausationHops();
IReadOnlyList<MessageHop> currentHops = envelope.GetCurrentHops();
```

**Key Points**:
- Envelope **deserialized** with all hops intact
- Hops stored in the inbox `metadata` column for auditability
- Handlers receive the **full envelope** context (not just the payload)
- Envelope metadata is **read-only** at consumption time — write metadata by adding hops, never by mutating inherited ones

---

## Adding Hops in Workers

### Automatic Hop Accumulation

Hop accumulation is **automatic**. When your receptor publishes a new event, the dispatcher's cascade context:

1. Inherits the incoming envelope's hops (re-typed as `Causation` hops)
2. Appends a fresh `Current` hop stamped with the service instance (`si`), timestamp (`ts`), topic (`to`), stream id (`st`), and the dispatching call site (`cm`/`cf`/`cl` via `[CallerMemberName]` etc.)
3. Carries the correlation identity and scope delta forward

```csharp{title="Receptor Example" description="Hop inheritance happens inside dispatcher.PublishAsync — no manual envelope code" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "InventoryWorker"] unverified="sample receptor — hop inheritance runs inside the dispatcher cascade, not this code"}
public class ReserveInventoryReceptor(IDispatcher dispatcher)
    : IReceptor<ReserveInventoryCommand, InventoryReservedEvent> {

    public async ValueTask<InventoryReservedEvent> HandleAsync(
        ReserveInventoryCommand message,
        CancellationToken cancellationToken = default) {

        // ... business logic ...

        var inventoryReserved = new InventoryReservedEvent { /* ... */ };

        // The dispatcher inherits the incoming envelope's hops,
        // appends a new Current hop, and preserves correlation + scope.
        await dispatcher.PublishAsync(inventoryReserved);

        return inventoryReserved;
    }
}
```

**Result**: the `InventoryReservedEvent` envelope contains:
1. A new Current hop (this service, this call site)
2. All causation hops from the triggering message (OrderService, API gateway, etc.)

---

## Querying Hops Across Services

### Find Complete Workflow

```sql{title="Find Complete Workflow" description="Find Complete Workflow" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "Sql", "Find", "Complete", "Workflow"]}
-- Find all messages in a workflow (hops live in the metadata JSONB column)
-- Note: in production, published rows delete on completion — run against
-- debug-mode retained rows or your archive.
SELECT
    o.message_id,
    o.message_type,
    o.destination,
    o.created_at,
    o.metadata->'Hops' AS hops
FROM wh_outbox o
WHERE o.metadata->'Hops'->0->>'co' = 'corr-abc'  -- correlation id ('co') on the first hop
ORDER BY o.created_at;
```

**Example output**:
```
message_id | message_type       | destination | created_at          | hops
-----------|--------------------|-------------|---------------------|------
msg-001    | OrderCreated       | orders      | 2024-12-12 10:00:00 | [API Gateway]
msg-002    | InventoryReserved  | inventory   | 2024-12-12 10:00:01 | [API Gateway, OrderService]
msg-003    | PaymentProcessed   | payment     | 2024-12-12 10:00:02 | [API Gateway, OrderService, InventoryWorker]
```

### Visualize Hop Accumulation

```csharp{title="Visualize Hop Accumulation" description="Visualize Hop Accumulation" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Visualize", "Hop", "Accumulation"] unverified="user diagnostic helper — illustrative console output, not framework code"}
public void PrintHopAccumulation(Guid correlationId) {
    var messages = GetMessagesByCorrelation(correlationId);

    foreach (var msg in messages) {
        Console.WriteLine($"{msg.MessageType} ({msg.Timestamp}):");

        for (int i = 0; i < msg.Envelope.Hops.Count; i++) {
            var hop = msg.Envelope.Hops[i];
            var prefix = new string(' ', i * 2);
            var type = hop.Type == HopType.Current ? "CURRENT" : "CAUSATION";

            Console.WriteLine($"{prefix}├─ {type}: {hop.ServiceInstance.ServiceName}");
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

## Scope Propagation

### Extracting Scope from Hops

Hops carry **scope deltas** (`sc` / `ScopeDelta`) — each hop records what changed in the security/tenancy scope, and `GetCurrentScope()` folds the deltas into the effective `ScopeContext`:

```csharp{title="Extracting Scope from Hops" description="Extracting Scope from Hops" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Extracting", "Security", "Hops"] unverified="user application logic — scope-based authorization built on GetCurrentScope(), not framework code"}
public async ValueTask<InventoryReservedEvent> HandleAsync(
    ReserveInventoryCommand message,
    CancellationToken ct = default) {

    // Effective scope, folded from the hop chain's scope deltas
    var scope = envelope.GetCurrentScope();

    if (scope?.EffectivePrincipal is null) {
        throw new UnauthorizedAccessException("No principal in scope");
    }

    // Validate permissions carried by the scope
    if (!scope.HasPermission(InventoryPermissions.Reserve)) {
        throw new UnauthorizedAccessException("Missing inventory permission");
    }

    // Business logic with scope context
    await ReserveInventoryAsync(message, scope, ct);
}
```

**Benefit**: Scope context flows **automatically** via hops! (`GetCurrentSecurityContext()` is obsolete — use `GetCurrentScope()`.)

---

## Best Practices

### DO ✅

- ✅ **Publish via the dispatcher** — hop inheritance, current-hop stamping, and scope propagation are automatic
- ✅ **Read identity via accessors** (`GetCorrelationId`, `GetCausationId`, `GetMetadata`, `GetCurrentScope`)
- ✅ **Rely on stored envelopes** in outbox/inbox metadata for auditability
- ✅ **Query by correlation id** for end-to-end traces
- ✅ **Monitor hop count** (alert if > 10 hops indicates circular dependency)
- ✅ **Use the caller info** (`cm`/`cf`/`cl`) captured automatically on each hop when debugging dispatch origins

### DON'T ❌

- ❌ Discard causation hops (breaks tracing)
- ❌ Modify inherited hops (immutable — metadata is read-only via `GetMetadata`; add a new hop instead)
- ❌ Build envelopes by hand (bypasses hop inheritance and scope propagation)
- ❌ Store sensitive data in hop metadata (use the scope for security-relevant context)
- ❌ Ignore hop count limits (circular dependencies)
- ❌ Forget to log hop information

---

## Troubleshooting

### Problem: Missing Hops

**Symptom**: Messages arrive with fewer hops than expected.

**Causes**:
1. Publishing outside the dispatcher's cascade context (hop inheritance bypassed)
2. Envelope not serialized/deserialized with its registered `JsonTypeInfo`
3. Hops not stored in the outbox metadata column

**Solution**:
```csharp{title="Problem: Missing Hops" description="Problem: Missing Hops" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Problem:", "Missing", "Hops"] unverified="troubleshooting snippet — publish-from-handler cascade guidance plus an illustrative serialization round-trip check, not framework test code"}
// Publish from within the handler so the cascade context inherits hops
await dispatcher.PublishAsync(newEvent);   // ✅ hops inherited automatically

// Verify serialization round-trips the hop chain (uses the compact 'h' property)
var json = JsonSerializer.Serialize(envelope, typeInfo);
var deserialized = JsonSerializer.Deserialize(json, typeInfo)!;
Debug.Assert(deserialized.Hops.Count == envelope.Hops.Count);
```

### Problem: Circular Dependencies

**Symptom**: Hop count grows indefinitely.

**Causes**:
1. Service A publishes event that triggers Service B
2. Service B publishes event that triggers Service A
3. Loop repeats forever

**Solution**:
```csharp{title="Problem: Circular Dependencies" description="Problem: Circular Dependencies" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Problem:", "Circular", "Dependencies"] unverified="user diagnostic pattern — illustrative circular-dependency guard, not framework code"}
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

```csharp{title="Serialization Performance" description="Serialization Performance" category="Architecture" difficulty="BEGINNER" tags=["Messaging", "C#", "Serialization", "Performance"] unverified="JsonContextRegistry serialization setup plus reflection counter-example — not verified by envelope tests"}
// ✅ Efficient: source-generated JsonTypeInfo from the cross-assembly registry
var options = JsonContextRegistry.CreateCombinedOptions();
var typeInfo = options.GetTypeInfo(typeof(MessageEnvelope<OrderCreatedEvent>));
var json = JsonSerializer.Serialize(envelope, typeInfo);

// ❌ Slow: Reflection-based serialization
var json = JsonSerializer.Serialize(envelope);  // Not AOT-compatible
```

The compact JSON property names (`v`, `id`, `p`, `h`, per-hop `ty`/`si`/`ts`/...) keep hop overhead small on the wire.

---

## Further Reading

**Core Concepts**:
- [Observability & Message Hops](../fundamentals/persistence/observability.md) - Architecture overview
- [Message Context](../fundamentals/messages/message-context.md) - MessageId, CorrelationId, CausationId

**Messaging Patterns**:
- [Outbox Pattern](outbox-pattern.md) - Reliable publishing with hops
- [Inbox Pattern](inbox-pattern.md) - Exactly-once processing with hops
- [Work Coordinator](work-coordinator.md) - Atomic batch processing

**Transports**:
- [Azure Service Bus](./transports/azure-service-bus.md) - ASB integration with hops

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
