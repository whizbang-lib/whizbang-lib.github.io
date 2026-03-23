---
title: Auto-Populate Attributes
version: 1.0.0
category: Attributes
order: 10
description: >-
  Marker attributes that automatically populate message properties from envelope
  context including timestamps, security, service info, and identifiers
tags: 'attributes, auto-populate, timestamps, security, context, source-generator, aot'
codeReferences:
  - src/Whizbang.Core/Attributes/PopulateTimestampAttribute.cs
  - src/Whizbang.Core/Attributes/PopulateFromContextAttribute.cs
  - src/Whizbang.Core/Attributes/PopulateFromServiceAttribute.cs
  - src/Whizbang.Core/Attributes/PopulateFromIdentifierAttribute.cs
  - src/Whizbang.Core/AutoPopulate/IAutoPopulateProcessor.cs
  - src/Whizbang.Generators/AutoPopulate/AutoPopulateDiscoveryGenerator.cs
---

# Auto-Populate Attributes

Auto-populate attributes automatically set message property values from envelope context at specific points in the message lifecycle. This enables tracking timestamps, security context, service info, and identifiers without manual code.

## Namespace

```csharp
using Whizbang.Core.Attributes;
```

## Overview

There are four categories of auto-populate attributes:

| Attribute | Purpose | Example Values |
|-----------|---------|----------------|
| `[PopulateTimestamp]` | Lifecycle timestamps | SentAt, QueuedAt, DeliveredAt |
| `[PopulateFromContext]` | Security context | UserId, TenantId |
| `[PopulateFromService]` | Service instance info | ServiceName, HostName |
| `[PopulateFromIdentifier]` | Message identifiers | MessageId, CorrelationId, StreamId |

## Quick Example

```csharp{title="Complete Auto-Populate Example" description="Message with all auto-populate categories" category="Usage" difficulty="BEGINNER" tags=["Auto-Populate", "Events", "Attributes"]}
public record OrderCreated(
    [property: StreamId] Guid OrderId,
    string ProductName,
    decimal Price,

    // Timestamps - populated at specific lifecycle stages
    [property: PopulateTimestamp(TimestampKind.SentAt)] DateTimeOffset? SentAt = null,
    [property: PopulateTimestamp(TimestampKind.QueuedAt)] DateTimeOffset? QueuedAt = null,

    // Security - from current security context
    [property: PopulateFromContext(ContextKind.UserId)] string? CreatedBy = null,
    [property: PopulateFromContext(ContextKind.TenantId)] string? TenantId = null,

    // Service - from service instance info
    [property: PopulateFromService(ServiceKind.ServiceName)] string? ProcessedBy = null,

    // Identifiers - from message envelope
    [property: PopulateFromIdentifier(IdentifierKind.CorrelationId)] Guid? CorrelationId = null
) : IEvent;
```

## Timestamp Attributes

The `[PopulateTimestamp]` attribute captures timestamps at specific points in the message lifecycle.

### TimestampKind Values

| Kind | When Populated | Description |
|------|----------------|-------------|
| `SentAt` | Dispatcher entry | When `SendAsync()` or `PublishAsync()` is called |
| `QueuedAt` | After outbox commit | After message is persisted to outbox |
| `DeliveredAt` | Inbox receive | When message arrives from transport |

### Example

```csharp{title="Timestamp Attributes" description="Track message timing through lifecycle" category="Usage" difficulty="BEGINNER" tags=["Timestamps", "SentAt", "QueuedAt", "DeliveredAt"]}
public record PaymentProcessed(
    [property: StreamId] Guid PaymentId,
    decimal Amount,

    // Captured when dispatcher.PublishAsync() is called
    [property: PopulateTimestamp(TimestampKind.SentAt)] DateTimeOffset? SentAt = null,

    // Captured after outbox write commits
    [property: PopulateTimestamp(TimestampKind.QueuedAt)] DateTimeOffset? QueuedAt = null,

    // Captured when message arrives at destination service
    [property: PopulateTimestamp(TimestampKind.DeliveredAt)] DateTimeOffset? DeliveredAt = null
) : IEvent;
```

### Lifecycle Stage Mapping

```
Dispatcher.SendAsync() / PublishAsync()
    │
    ├── SentAt populated here
    │
    ▼
PostDistributeInline (outbox commit)
    │
    ├── QueuedAt populated here
    │
    ▼
Transport (message travels to destination)
    │
    ▼
PreInboxAsync (message received)
    │
    ├── DeliveredAt populated here
    │
    ▼
Receptor handles message
```

## Context Attributes

The `[PopulateFromContext]` attribute captures values from the current security context.

### ContextKind Values

| Kind | Source | Type |
|------|--------|------|
| `UserId` | `SecurityContext.UserId` | `string?` |
| `TenantId` | `SecurityContext.TenantId` | `string?` |

### Example

```csharp{title="Context Attributes" description="Capture security context on messages" category="Usage" difficulty="BEGINNER" tags=["Context", "UserId", "TenantId", "Security"]}
public record DocumentCreated(
    [property: StreamId] Guid DocumentId,
    string Title,
    string Content,

    // Captures who created the document
    [property: PopulateFromContext(ContextKind.UserId)] string? CreatedBy = null,

    // Captures which tenant owns the document
    [property: PopulateFromContext(ContextKind.TenantId)] string? TenantId = null
) : IEvent;
```

### Multi-Tenant Scenarios

```csharp{title="Multi-Tenant Event" description="Auto-capture tenant context for audit trail" category="Usage" difficulty="INTERMEDIATE" tags=["Context", "Multi-Tenant", "Audit"]}
public record InventoryAdjusted(
    [property: StreamId] Guid ProductId,
    int QuantityChange,
    string Reason,

    // Audit fields populated automatically
    [property: PopulateFromContext(ContextKind.UserId)] string? AdjustedBy = null,
    [property: PopulateFromContext(ContextKind.TenantId)] string? TenantId = null,
    [property: PopulateTimestamp(TimestampKind.SentAt)] DateTimeOffset? AdjustedAt = null
) : IEvent;
```

## Service Attributes

The `[PopulateFromService]` attribute captures information about the service instance processing the message.

### ServiceKind Values

| Kind | Source | Type |
|------|--------|------|
| `ServiceName` | `ServiceInstanceInfo.ServiceName` | `string` |
| `InstanceId` | `ServiceInstanceInfo.InstanceId` | `Guid` |
| `HostName` | `ServiceInstanceInfo.HostName` | `string` |
| `ProcessId` | `ServiceInstanceInfo.ProcessId` | `int` |

### Example

```csharp{title="Service Attributes" description="Track which service processed a message" category="Usage" difficulty="INTERMEDIATE" tags=["Service", "Observability", "Distributed"]}
public record OrderProcessed(
    [property: StreamId] Guid OrderId,
    string Status,

    // Which service processed this event
    [property: PopulateFromService(ServiceKind.ServiceName)] string? ProcessedByService = null,

    // Which instance (for scaling scenarios)
    [property: PopulateFromService(ServiceKind.InstanceId)] Guid? ProcessedByInstance = null,

    // Which host machine
    [property: PopulateFromService(ServiceKind.HostName)] string? ProcessedOnHost = null
) : IEvent;
```

### Distributed Tracing

```csharp{title="Distributed Tracing" description="Track message journey across services" category="Usage" difficulty="ADVANCED" tags=["Service", "Distributed", "Tracing"]}
public record PaymentCompleted(
    [property: StreamId] Guid PaymentId,
    decimal Amount,

    // Full service context for debugging
    [property: PopulateFromService(ServiceKind.ServiceName)] string? ServiceName = null,
    [property: PopulateFromService(ServiceKind.InstanceId)] Guid? InstanceId = null,
    [property: PopulateFromService(ServiceKind.HostName)] string? HostName = null,
    [property: PopulateFromService(ServiceKind.ProcessId)] int? ProcessId = null
) : IEvent;
```

## Identifier Attributes

The `[PopulateFromIdentifier]` attribute captures message identifiers from the envelope.

### IdentifierKind Values

| Kind | Source | Description |
|------|--------|-------------|
| `MessageId` | Current message ID | Unique identifier for this message |
| `CorrelationId` | Workflow correlation ID | Links all messages in a workflow |
| `CausationId` | Parent message ID | ID of the message that caused this one |
| `StreamId` | Stream/aggregate ID | The stream this message belongs to |

### Example

```csharp{title="Identifier Attributes" description="Capture correlation for distributed workflows" category="Usage" difficulty="INTERMEDIATE" tags=["Identifiers", "Correlation", "Causation"]}
public record ShipmentDispatched(
    [property: StreamId] Guid ShipmentId,
    string TrackingNumber,

    // Link to the originating workflow
    [property: PopulateFromIdentifier(IdentifierKind.CorrelationId)] Guid? WorkflowId = null,

    // Link to the command that triggered this event
    [property: PopulateFromIdentifier(IdentifierKind.CausationId)] Guid? TriggeredBy = null,

    // Unique ID for this specific message
    [property: PopulateFromIdentifier(IdentifierKind.MessageId)] Guid? EventId = null
) : IEvent;
```

### Saga/Workflow Pattern

```csharp{title="Saga Correlation" description="Auto-populate correlation for saga patterns" category="Usage" difficulty="ADVANCED" tags=["Identifiers", "Saga", "Workflow"]}
// All events in a checkout saga share the same CorrelationId
public record CartCheckedOut(
    [property: StreamId] Guid CartId,
    [property: PopulateFromIdentifier(IdentifierKind.CorrelationId)] Guid? CheckoutWorkflowId = null
) : IEvent;

public record PaymentReceived(
    [property: StreamId] Guid PaymentId,
    Guid CartId,
    [property: PopulateFromIdentifier(IdentifierKind.CorrelationId)] Guid? CheckoutWorkflowId = null,
    [property: PopulateFromIdentifier(IdentifierKind.CausationId)] Guid? TriggeredByCartCheckout = null
) : IEvent;

public record OrderCreatedFromCart(
    [property: StreamId] Guid OrderId,
    Guid CartId,
    [property: PopulateFromIdentifier(IdentifierKind.CorrelationId)] Guid? CheckoutWorkflowId = null,
    [property: PopulateFromIdentifier(IdentifierKind.CausationId)] Guid? TriggeredByPayment = null
) : IEvent;
```

## Property Requirements

### Nullable Types

Auto-populated properties should be nullable to distinguish "not yet populated" from a value:

```csharp{title="Nullable Properties" description="Use nullable types for auto-populated properties" category="Best-Practices" difficulty="BEGINNER" tags=["Nullable", "Types"]}
// Correct: Nullable types with default null
[property: PopulateTimestamp(TimestampKind.SentAt)] DateTimeOffset? SentAt = null
[property: PopulateFromContext(ContextKind.UserId)] string? CreatedBy = null
[property: PopulateFromIdentifier(IdentifierKind.CorrelationId)] Guid? CorrelationId = null
```

### Supported Types

| Attribute Category | Supported Property Types |
|--------------------|-------------------------|
| `PopulateTimestamp` | `DateTimeOffset`, `DateTimeOffset?`, `DateTime`, `DateTime?` |
| `PopulateFromContext` | `string`, `string?` |
| `PopulateFromService` | `string`, `string?`, `Guid`, `Guid?`, `int`, `int?` |
| `PopulateFromIdentifier` | `Guid`, `Guid?`, `string`, `string?` |

## How It Works

### Compile-Time Discovery

The source generator discovers properties with auto-populate attributes and generates a registry:

```csharp{title="Generated Registry" description="Source generator creates zero-reflection registry" category="Reference" difficulty="ADVANCED" tags=["Source-Generator", "AOT"]}
// Generated by AutoPopulateDiscoveryGenerator
internal static class AutoPopulateRegistry {
    public static void PopulateSentAt(IMessageEnvelope envelope, DateTimeOffset timestamp) {
        // Generated code for each message type with SentAt
        if (envelope.Payload is OrderCreated) {
            envelope.AddAutoPopulatedValue("SentAt", timestamp);
        }
        // ... more types
    }
}
```

### Envelope Metadata Storage

Values are stored in envelope metadata (not mutating the immutable message):

```csharp{title="Envelope Storage" description="Values stored in envelope, not message" category="Reference" difficulty="INTERMEDIATE" tags=["Envelope", "Metadata"]}
// Values stored in MessageHop.Metadata with __autopop__ prefix
envelope.Hops[^1].Metadata["__autopop__SentAt"] = timestamp;
envelope.Hops[^1].Metadata["__autopop__UserId"] = userId;
```

### Accessing Values

```csharp{title="Accessing Auto-Populated Values" description="Read auto-populated values from envelope" category="Usage" difficulty="INTERMEDIATE" tags=["Envelope", "Reading"]}
// Via extension method
var sentAt = envelope.GetAutoPopulated<DateTimeOffset>("SentAt");
var createdBy = envelope.GetAutoPopulated<string>("UserId");

// Materialize full message with populated values
OrderCreated populatedMessage = envelope.Materialize<OrderCreated>();
// populatedMessage.SentAt now has the timestamp value
```

## Edge Cases

### Property Already Set

By default, existing values are preserved:

```csharp{title="Preserve Existing Values" description="Manual values are not overwritten" category="Reference" difficulty="INTERMEDIATE" tags=["Edge-Cases"]}
// If you manually set SentAt, auto-populate won't overwrite it
var order = new OrderCreated(
    OrderId: Guid.CreateVersion7(),
    ProductName: "Widget",
    SentAt: DateTimeOffset.Parse("2024-01-01T00:00:00Z")  // Manual value
);

await dispatcher.PublishAsync(order);
// SentAt remains 2024-01-01, not overwritten by current time
```

### Local-Only Dispatch

Some timestamps only apply to distributed messages:

| Timestamp | Local Dispatch | Distributed Dispatch |
|-----------|----------------|---------------------|
| `SentAt` | Populated | Populated |
| `QueuedAt` | Not populated | Populated (after outbox) |
| `DeliveredAt` | Not populated | Populated (at inbox) |

### Retry Scenarios

On message retry, original timestamps are preserved to maintain accurate timing information.

## Zero Reflection and AOT

All auto-populate functionality works without runtime reflection:

- **Compile-time discovery**: Source generator finds attributes during build
- **Generated code**: Direct property access, no `Type.GetProperty()`
- **AOT-compatible**: Works with Native AOT publishing
- **No reflection allocations**: Zero GC pressure from type inspection

## Best Practices

### 1. Use Meaningful Property Names

```csharp{title="Meaningful Names" description="Name properties for their business meaning" category="Best-Practices" difficulty="BEGINNER" tags=["Naming"]}
// Good: Business-meaningful names
[property: PopulateFromContext(ContextKind.UserId)] string? CreatedBy = null
[property: PopulateTimestamp(TimestampKind.SentAt)] DateTimeOffset? CreatedAt = null

// Avoid: Generic technical names
[property: PopulateFromContext(ContextKind.UserId)] string? UserId = null
[property: PopulateTimestamp(TimestampKind.SentAt)] DateTimeOffset? SentAt = null
```

### 2. Consistent Patterns Across Events

```csharp{title="Consistent Patterns" description="Use same auto-populate pattern across aggregate" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Patterns", "Consistency"]}
// All order events have consistent audit fields
public record OrderCreated(...,
    [property: PopulateFromContext(ContextKind.UserId)] string? CreatedBy = null,
    [property: PopulateTimestamp(TimestampKind.SentAt)] DateTimeOffset? CreatedAt = null
) : IEvent;

public record OrderUpdated(...,
    [property: PopulateFromContext(ContextKind.UserId)] string? UpdatedBy = null,
    [property: PopulateTimestamp(TimestampKind.SentAt)] DateTimeOffset? UpdatedAt = null
) : IEvent;
```

### 3. Don't Over-Populate

Only add auto-populate attributes where the data is actually needed:

```csharp{title="Selective Population" description="Only populate what you need" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Performance"]}
// Internal event - minimal metadata
public record InventoryReserved(
    [property: StreamId] Guid ProductId,
    int Quantity
) : IEvent;

// External-facing event - full audit trail
public record OrderShipped(
    [property: StreamId] Guid OrderId,
    string TrackingNumber,
    [property: PopulateFromContext(ContextKind.UserId)] string? ShippedBy = null,
    [property: PopulateTimestamp(TimestampKind.SentAt)] DateTimeOffset? ShippedAt = null,
    [property: PopulateFromService(ServiceKind.ServiceName)] string? ProcessedBy = null,
    [property: PopulateFromIdentifier(IdentifierKind.CorrelationId)] Guid? OrderWorkflowId = null
) : IEvent;
```

## See Also

- [StreamId Attribute](../../v1.0.0/extending/attributes/streamid.md) - Stream identification for event sourcing
- Message Envelope - Understanding envelope metadata
- [Lifecycle Stages](../../v1.0.0/fundamentals/lifecycle/lifecycle-stages.md) - When timestamps are populated
- Security Context - How security context flows
- [Source Generators](../metrics/overview.md) - How auto-populate discovery works
