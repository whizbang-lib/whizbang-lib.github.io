---
title: Observability & Message Hops
version: 1.0.0
category: Core Concepts
order: 6
description: >-
  Understand Whizbang's hop-based observability architecture - MessageEnvelope
  and MessageHop for distributed tracing and debugging
tags: 'observability, message-hops, distributed-tracing, debugging, telemetry'
codeReferences:
  - src/Whizbang.Core/Observability/MessageEnvelope.cs
  - src/Whizbang.Core/Observability/MessageHop.cs
  - src/Whizbang.Core/Policies/PolicyDecisionTrail.cs
---

# Observability & Message Hops

Whizbang implements **hop-based observability**, inspired by network packet routing. Every message carries a **MessageEnvelope** containing **hops** - snapshots of contextual metadata at each stage of processing.

## Core Concept: Network Packet Analogy

Just like IP packets travel through routers, accumulating hops along their journey, Whizbang messages travel through receptors and services, accumulating context hops:

```
Network Packet:
┌────────────────────────┐
│ IP Header              │
│ ├─ Source IP           │
│ ├─ Dest IP             │
│ └─ Hop Count: 3        │
├────────────────────────┤
│ Payload (your data)    │
└────────────────────────┘

Whizbang Message:
┌─────────────────────────┐
│ MessageEnvelope         │
│ ├─ MessageId            │
│ ├─ CorrelationId        │
│ ├─ CausationId          │
│ └─ Hops: [Hop1, Hop2]   │
├─────────────────────────┤
│ Payload (your message)  │
└─────────────────────────┘
```

**Key Insight**: Hops capture **where the message has been** and **what decisions were made** along the way.

---

## MessageEnvelope Structure

```csharp
public class MessageEnvelope {
    // Identity
    public required MessageId MessageId { get; init; }
    public required CorrelationId CorrelationId { get; init; }
    public required CausationId? CausationId { get; init; }

    // Payload
    public required object Payload { get; init; }

    // Observability
    public required List<MessageHop> Hops { get; init; }  // THE KEY TO OBSERVABILITY

    // Metadata
    public DateTimeOffset CreatedAt { get; init; }
}
```

**MessageEnvelope wraps every message**, providing:
- **Identity**: MessageId, CorrelationId, CausationId
- **Payload**: Your actual command/event/query
- **Observability**: List of hops showing the message's journey

---

## MessageHop Structure

```csharp
public class MessageHop {
    // Hop Type
    public required MessageHopType Type { get; init; }  // Current or Causation

    // Routing
    public string? Topic { get; init; }
    public string? StreamKey { get; init; }
    public int? PartitionIndex { get; init; }
    public long? SequenceNumber { get; init; }

    // Security
    public SecurityContext? SecurityContext { get; init; }  // UserId, TenantId, etc.

    // Policy
    public PolicyDecisionTrail? PolicyDecisionTrail { get; init; }

    // Metadata (stitched across hops)
    public Dictionary<string, string> Metadata { get; init; } = new();

    // Debugging
    public string? CallerMemberName { get; init; }
    public string? CallerFilePath { get; init; }
    public int? CallerLineNumber { get; init; }

    // Timing
    public DateTimeOffset Timestamp { get; init; }
    public TimeSpan? Duration { get; init; }
}

public enum MessageHopType {
    Current,    // This message's context
    Causation   // Parent message's context (inherited)
}
```

**MessageHop captures**:
- **Routing**: Topic, stream, partition, sequence
- **Security**: Who is making this request?
- **Policy**: What decisions were made?
- **Metadata**: Custom key-value pairs
- **Debugging**: Source location (file, line, method)
- **Timing**: When did this happen, how long did it take?

---

## Hop Types

### Current Hop

**Purpose**: Captures context for **this message**.

```csharp
var currentHop = new MessageHop {
    Type = MessageHopType.Current,
    Topic = "orders",
    StreamKey = "customer-123",
    PartitionIndex = 42,
    SecurityContext = new SecurityContext {
        UserId = Guid.Parse("user-456"),
        TenantId = Guid.Parse("tenant-789")
    },
    Metadata = new Dictionary<string, string> {
        ["ServiceName"] = "OrderService",
        ["Version"] = "1.0.0"
    },
    Timestamp = DateTimeOffset.UtcNow
};
```

**Use Case**: Know where this message originated, who created it, and what metadata it carries.

### Causation Hop

**Purpose**: Captures context from **parent message** (inherited).

```csharp
// When OrderCreated event is created from CreateOrder command:
var envelope = MessageEnvelope.Create(
    messageId: MessageId.New(),
    correlationId: command.CorrelationId,  // Inherit
    causationId: CausationId.From(command.MessageId),  // Parent reference
    payload: orderCreatedEvent,
    currentHop: /* current hop */,
    causationHops: command.Hops  // INHERIT parent's hops!
);
```

**Result**: `OrderCreated` envelope contains:
1. **Current hop**: Context for OrderCreated
2. **Causation hops**: All hops from CreateOrder (parent)

**Benefit**: Complete trace from HTTP request → Command → Event → Downstream events!

---

## Hop Flow Example

### Scenario: Create Order Workflow

```
1. HTTP POST /api/orders (API Gateway)
   ├─ Current Hop:
   │  ├─ Type: Current
   │  ├─ SecurityContext: { UserId: user-123, TenantId: tenant-456 }
   │  ├─ Metadata: { ServiceName: "API Gateway", RequestPath: "/api/orders" }
   │  └─ Timestamp: 2024-12-12T10:00:00Z
   └─ Causation Hops: (none)

      ↓ Creates CreateOrder Command

2. CreateOrder Command (OrderService)
   ├─ Current Hop:
   │  ├─ Type: Current
   │  ├─ Topic: "orders"
   │  ├─ StreamKey: "customer-123"
   │  ├─ SecurityContext: { UserId: user-123, TenantId: tenant-456 }  (inherited)
   │  ├─ Metadata: { ServiceName: "OrderService", ReceptorName: "CreateOrderReceptor" }
   │  └─ Timestamp: 2024-12-12T10:00:00.123Z
   └─ Causation Hops:
      └─ Hop from API Gateway (inherited)

      ↓ Creates OrderCreated Event

3. OrderCreated Event
   ├─ Current Hop:
   │  ├─ Type: Current
   │  ├─ Topic: "orders"
   │  ├─ StreamKey: "customer-123"
   │  ├─ SecurityContext: { UserId: user-123, TenantId: tenant-456 }  (inherited)
   │  ├─ Metadata: { ServiceName: "OrderService", EventType: "OrderCreated" }
   │  └─ Timestamp: 2024-12-12T10:00:00.456Z
   └─ Causation Hops:
      ├─ Hop from API Gateway (inherited)
      └─ Hop from CreateOrder Command (inherited)

      ↓ Published to Azure Service Bus

      ↓ Consumed by InventoryWorker

4. InventoryReserved Event
   ├─ Current Hop:
   │  ├─ Type: Current
   │  ├─ Topic: "inventory"
   │  ├─ StreamKey: "product-789"
   │  ├─ SecurityContext: { UserId: user-123, TenantId: tenant-456 }  (inherited)
   │  ├─ Metadata: { ServiceName: "InventoryWorker", EventType: "InventoryReserved" }
   │  └─ Timestamp: 2024-12-12T10:00:01.234Z
   └─ Causation Hops:
      ├─ Hop from API Gateway (inherited)
      ├─ Hop from CreateOrder Command (inherited)
      └─ Hop from OrderCreated Event (inherited)
```

**Result**: `InventoryReserved` event contains **complete trace** back to original HTTP request!

---

## Security Context

```csharp
public record SecurityContext {
    public Guid? UserId { get; init; }
    public Guid? TenantId { get; init; }
    public string[]? Roles { get; init; }
    public Dictionary<string, string>? Claims { get; init; }
}
```

**Use Case**: Authorization across services.

### Example: Multi-Tenant Authorization

```csharp
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    private readonly IHttpContextAccessor _httpContext;

    public async ValueTask<OrderCreated> HandleAsync(
        CreateOrder message,
        CancellationToken ct = default) {

        // Extract security context from hops
        var securityContext = message.Hops
            .FirstOrDefault(h => h.Type == MessageHopType.Current)?
            .SecurityContext;

        if (securityContext?.TenantId is null) {
            throw new UnauthorizedAccessException("No tenant context");
        }

        // Validate customer belongs to tenant
        if (!await _customerService.BelongsToTenantAsync(
            message.CustomerId,
            securityContext.TenantId.Value,
            ct)) {

            throw new ForbiddenException("Customer does not belong to tenant");
        }

        // Business logic...
    }
}
```

**Benefit**: Security context flows automatically across services!

---

## Policy Decision Trail

```csharp
public record PolicyDecisionTrail {
    public List<PolicyDecision> Decisions { get; init; } = new();
}

public record PolicyDecision {
    public string PolicyName { get; init; }
    public bool Allowed { get; init; }
    public string? Reason { get; init; }
    public Dictionary<string, string> Context { get; init; } = new();
}
```

**Use Case**: Audit which policies allowed/denied actions.

### Example: Rate Limiting Policy

```csharp
public class RateLimitingPolicy : IPolicy {
    public async Task<PolicyDecision> EvaluateAsync(
        MessageEnvelope envelope,
        CancellationToken ct = default) {

        var securityContext = envelope.Hops
            .FirstOrDefault(h => h.Type == MessageHopType.Current)?
            .SecurityContext;

        var userId = securityContext?.UserId;

        if (userId is null) {
            return new PolicyDecision {
                PolicyName = "RateLimiting",
                Allowed = false,
                Reason = "No user context"
            };
        }

        var count = await _rateLimiter.GetRequestCountAsync(userId.Value, ct);

        if (count > 100) {  // Max 100 requests per minute
            return new PolicyDecision {
                PolicyName = "RateLimiting",
                Allowed = false,
                Reason = "Rate limit exceeded",
                Context = new Dictionary<string, string> {
                    ["RequestCount"] = count.ToString(),
                    ["Limit"] = "100"
                }
            };
        }

        return new PolicyDecision {
            PolicyName = "RateLimiting",
            Allowed = true,
            Context = new Dictionary<string, string> {
                ["RequestCount"] = count.ToString()
            }
        };
    }
}
```

**Result**: Every hop contains policy decisions - full audit trail!

---

## Metadata Stitching

Metadata **stitches across hops**, accumulating context:

```csharp
// Hop 1 (API Gateway)
Metadata: {
    "ServiceName": "API Gateway",
    "RequestPath": "/api/orders"
}

// Hop 2 (OrderService) - inherits + adds
Metadata: {
    "ServiceName": "OrderService",        // Overwrites
    "RequestPath": "/api/orders",         // Inherited
    "ReceptorName": "CreateOrderReceptor" // Added
}

// Hop 3 (InventoryWorker) - inherits + adds
Metadata: {
    "ServiceName": "InventoryWorker",     // Overwrites
    "RequestPath": "/api/orders",         // Inherited
    "ReceptorName": "ReserveInventoryReceptor", // Overwrites
    "InventoryCheck": "Passed"            // Added
}
```

**Pattern**: Each hop can:
- **Inherit** metadata from parent
- **Overwrite** existing keys
- **Add** new keys

---

## Debugging Information

```csharp
public async ValueTask<OrderCreated> HandleAsync(
    CreateOrder message,
    [CallerMemberName] string memberName = "",
    [CallerFilePath] string filePath = "",
    [CallerLineNumber] int lineNumber = 0,
    CancellationToken ct = default) {

    var currentHop = new MessageHop {
        Type = MessageHopType.Current,
        CallerMemberName = memberName,  // "HandleAsync"
        CallerFilePath = filePath,      // "/src/OrderService/Receptors/CreateOrderReceptor.cs"
        CallerLineNumber = lineNumber,  // 42
        Timestamp = DateTimeOffset.UtcNow
    };

    // Add hop to envelope
    message.Envelope.Hops.Add(currentHop);

    // Business logic...
}
```

**Benefit**: Know **exactly** which file/line created each hop!

### Example: Error Debugging

```
Error: InvalidOperationException in OrderCreated processing

Stack Trace from Hops:
1. API Gateway
   File: /src/API/Controllers/OrdersController.cs:45

2. OrderService - CreateOrderReceptor
   File: /src/OrderService/Receptors/CreateOrderReceptor.cs:78

3. InventoryWorker - ReserveInventoryReceptor
   File: /src/InventoryWorker/Receptors/ReserveInventoryReceptor.cs:102  ← ERROR HERE
```

**Much easier than traditional stack traces in distributed systems!**

---

## Timing & Performance

```csharp
public class MessageHop {
    public DateTimeOffset Timestamp { get; init; }  // When hop was created
    public TimeSpan? Duration { get; init; }        // How long this hop took
}
```

### Example: Performance Profiling

```csharp
var startTime = DateTimeOffset.UtcNow;

// Business logic...

var duration = DateTimeOffset.UtcNow - startTime;

var currentHop = new MessageHop {
    Type = MessageHopType.Current,
    Timestamp = startTime,
    Duration = duration,  // How long this receptor took
    Metadata = new Dictionary<string, string> {
        ["ReceptorName"] = "CreateOrderReceptor"
    }
};
```

**Query Performance**:
```csharp
// Find slow hops
var slowHops = envelope.Hops
    .Where(h => h.Duration > TimeSpan.FromMilliseconds(500))
    .OrderByDescending(h => h.Duration)
    .ToArray();

foreach (var hop in slowHops) {
    Console.WriteLine($"{hop.Metadata["ReceptorName"]}: {hop.Duration.TotalMilliseconds}ms");
}
```

---

## Visualizing Hops

```csharp
public class HopVisualizer {
    public void PrintHops(MessageEnvelope envelope) {
        Console.WriteLine($"Message: {envelope.MessageId}");
        Console.WriteLine($"Correlation: {envelope.CorrelationId}");
        Console.WriteLine($"Causation: {envelope.CausationId}");
        Console.WriteLine();
        Console.WriteLine("Hops:");

        for (int i = 0; i < envelope.Hops.Count; i++) {
            var hop = envelope.Hops[i];
            var prefix = new string(' ', i * 2);

            Console.WriteLine($"{prefix}{i + 1}. {hop.Type}");
            Console.WriteLine($"{prefix}   Timestamp: {hop.Timestamp:yyyy-MM-dd HH:mm:ss.fff}");

            if (hop.Duration is not null) {
                Console.WriteLine($"{prefix}   Duration: {hop.Duration.Value.TotalMilliseconds}ms");
            }

            if (hop.SecurityContext is not null) {
                Console.WriteLine($"{prefix}   User: {hop.SecurityContext.UserId}");
                Console.WriteLine($"{prefix}   Tenant: {hop.SecurityContext.TenantId}");
            }

            foreach (var kvp in hop.Metadata) {
                Console.WriteLine($"{prefix}   {kvp.Key}: {kvp.Value}");
            }

            Console.WriteLine();
        }
    }
}
```

**Output**:
```
Message: msg-003
Correlation: corr-abc
Causation: msg-002

Hops:
1. Causation
   Timestamp: 2024-12-12 10:00:00.123
   Duration: 15ms
   User: user-123
   Tenant: tenant-456
   ServiceName: API Gateway
   RequestPath: /api/orders

  2. Causation
     Timestamp: 2024-12-12 10:00:00.456
     Duration: 50ms
     User: user-123
     Tenant: tenant-456
     ServiceName: OrderService
     ReceptorName: CreateOrderReceptor

    3. Current
       Timestamp: 2024-12-12 10:00:01.234
       Duration: 120ms
       User: user-123
       Tenant: tenant-456
       ServiceName: InventoryWorker
       ReceptorName: ReserveInventoryReceptor
```

---

## Best Practices

### DO ✅

- ✅ **Add hops** at each processing stage
- ✅ **Include security context** in first hop
- ✅ **Inherit causation hops** from parent message
- ✅ **Stitch metadata** across hops
- ✅ **Record timing** (Timestamp, Duration)
- ✅ **Add debugging info** (CallerMemberName, FilePath, LineNumber)
- ✅ **Visualize hops** for debugging
- ✅ **Query hops** for performance profiling

### DON'T ❌

- ❌ Skip adding hops (breaks tracing)
- ❌ Forget to inherit causation hops
- ❌ Store sensitive data in metadata (use SecurityContext)
- ❌ Add excessive metadata (keep it lean)
- ❌ Ignore hop timestamps (critical for debugging)

---

## Integration with Event Store

Hops are stored with events for full auditability:

```sql
CREATE TABLE wh_event_store (
    event_id UUID PRIMARY KEY,
    message_id UUID NOT NULL,
    correlation_id UUID NOT NULL,
    causation_id UUID NULL,
    event_type VARCHAR(255) NOT NULL,
    payload JSONB NOT NULL,
    hops JSONB NOT NULL,  -- Stored as JSON
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_event_store_correlation_id ON wh_event_store(correlation_id);
CREATE INDEX idx_event_store_causation_id ON wh_event_store(causation_id);
```

**Query hops**:
```sql
SELECT
    event_id,
    event_type,
    hops->>0->>'Metadata'->>'ServiceName' AS service_name,
    hops->>0->>'Timestamp' AS timestamp,
    hops->>0->>'Duration' AS duration
FROM wh_event_store
WHERE correlation_id = 'corr-abc'
ORDER BY created_at;
```

---

## Further Reading

**Core Concepts**:
- [Message Context](message-context.md) - MessageId, CorrelationId, CausationId
- [Dispatcher](dispatcher.md) - How messages flow through the system
- [Receptors](receptors.md) - Message handlers

**Messaging Patterns**:
- [Message Envelopes](../messaging/message-envelopes.md) - Deep dive into hop architecture
- [Outbox Pattern](../messaging/outbox-pattern.md) - Reliable messaging with hops
- [Event Store](../data/event-store.md) - Storing hops with events

**Infrastructure**:
- [Logging & Telemetry](../infrastructure/observability-setup.md) - Application Insights integration
- [Policy Engine](../infrastructure/policies.md) - Policy decision trails

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
