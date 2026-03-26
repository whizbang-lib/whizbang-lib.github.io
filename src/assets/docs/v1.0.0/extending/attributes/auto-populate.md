---
title: Auto-Populate Attributes
version: 1.0.0
category: Attributes
order: 5
description: >-
  Automatically populate message properties with timestamps, service info,
  security context, and message identifiers at dispatch time using
  zero-reflection source-generated code
tags: 'attributes, auto-populate, timestamps, observability, security-context, source-generator, aot'
codeReferences:
  - src/Whizbang.Core/Attributes/PopulateTimestampAttribute.cs
  - src/Whizbang.Core/Attributes/PopulateFromServiceAttribute.cs
  - src/Whizbang.Core/Attributes/PopulateFromIdentifierAttribute.cs
  - src/Whizbang.Core/Attributes/PopulateFromContextAttribute.cs
  - src/Whizbang.Core/Attributes/TimestampKind.cs
  - src/Whizbang.Core/Attributes/ServiceKind.cs
  - src/Whizbang.Core/Attributes/IdentifierKind.cs
  - src/Whizbang.Core/Attributes/ContextKind.cs
  - src/Whizbang.Core/AutoPopulate/PopulateKind.cs
  - src/Whizbang.Core/AutoPopulate/IAutoPopulateRegistry.cs
  - src/Whizbang.Core/AutoPopulate/IAutoPopulateProcessor.cs
  - src/Whizbang.Core/AutoPopulate/IAutoPopulatePopulator.cs
  - src/Whizbang.Core/AutoPopulate/AutoPopulateRegistry.cs
  - src/Whizbang.Core/AutoPopulate/AutoPopulateProcessor.cs
  - src/Whizbang.Core/AutoPopulate/AutoPopulatePopulatorRegistry.cs
  - src/Whizbang.Core/AutoPopulate/AutoPopulateRegistration.cs
  - src/Whizbang.Core/AutoPopulate/MessageEnvelopeAutoPopulateExtensions.cs
  - src/Whizbang.Core/AutoPopulate/JsonAutoPopulateHelper.cs
  - src/Whizbang.Generators/AutoPopulateDiscoveryGenerator.cs
---

# Auto-Populate Attributes

Auto-populate attributes automatically enrich message properties with contextual data -- timestamps, service instance information, security context, and message identifiers -- at dispatch time. Values are populated via source-generated code with zero reflection, making the entire feature fully AOT-compatible.

## Namespace

```csharp{title="Namespace" description="Namespaces for auto-populate attributes and infrastructure" category="Reference" difficulty="BEGINNER" tags=["auto-populate", "namespace"]}
using Whizbang.Core.Attributes;     // Attributes and kind enums
using Whizbang.Core.AutoPopulate;   // Processor, registry, extensions
```

## Overview

Instead of manually setting observability and audit fields on every message, auto-populate attributes let you declare what data a property should receive. The source generator discovers these attributes at compile time and generates populator code that uses record `with` expressions for zero-reflection population.

```csharp{title="Overview" description="A single message decorated with all four auto-populate attribute categories" category="Extending" difficulty="BEGINNER" tags=["auto-populate", "overview", "example"]}
public record OrderCreated(
    [property: StreamId] Guid OrderId,
    string ProductName,
    [property: PopulateTimestamp(TimestampKind.SentAt)] DateTimeOffset? SentAt = null,
    [property: PopulateTimestamp(TimestampKind.QueuedAt)] DateTimeOffset? QueuedAt = null,
    [property: PopulateTimestamp(TimestampKind.DeliveredAt)] DateTimeOffset? DeliveredAt = null,
    [property: PopulateFromService(ServiceKind.ServiceName)] string? ProcessedBy = null,
    [property: PopulateFromContext(ContextKind.UserId)] string? CreatedBy = null,
    [property: PopulateFromIdentifier(IdentifierKind.CorrelationId)] Guid? WorkflowId = null
) : IEvent;
```

Values are stored in the `MessageEnvelope` metadata to preserve message immutability. Access them via envelope extension methods or use `Materialize<T>()` to create a new message instance with the populated values baked in.

## Attributes

### PopulateTimestamp

Marks a `DateTimeOffset` or `DateTimeOffset?` property for automatic timestamp population at a specific point in the message lifecycle.

```csharp{title="PopulateTimestamp Attribute" description="Capture timestamps at different lifecycle stages" category="Extending" difficulty="BEGINNER" tags=["auto-populate", "timestamp", "PopulateTimestamp"]}
public record PaymentProcessed(
    [property: StreamId] Guid PaymentId,
    decimal Amount,
    [property: PopulateTimestamp(TimestampKind.SentAt)] DateTimeOffset? SentAt = null,
    [property: PopulateTimestamp(TimestampKind.QueuedAt)] DateTimeOffset? QueuedAt = null,
    [property: PopulateTimestamp(TimestampKind.DeliveredAt)] DateTimeOffset? DeliveredAt = null
) : IEvent;
```

#### TimestampKind Enum

| Value | Description | When Populated |
|---|---|---|
| `SentAt` | When `dispatcher.SendAsync()` or `PublishAsync()` is called | At dispatch time |
| `QueuedAt` | After the message is written to the outbox and committed | By the outbox publisher worker |
| `DeliveredAt` | When the message arrives at the destination inbox | By the transport consumer worker |

`QueuedAt` and `DeliveredAt` only fire for distributed messages. Local-only dispatch skips those lifecycle stages.

### PopulateFromService

Marks a property for automatic population from `ServiceInstanceInfo`. Useful for observability and distributed tracing to know which service instance processed a message.

```csharp{title="PopulateFromService Attribute" description="Capture service instance information for observability" category="Extending" difficulty="BEGINNER" tags=["auto-populate", "service", "PopulateFromService", "observability"]}
public record OrderShipped(
    [property: StreamId] Guid OrderId,
    string TrackingNumber,
    [property: PopulateFromService(ServiceKind.ServiceName)] string? ProcessedBy = null,
    [property: PopulateFromService(ServiceKind.InstanceId)] Guid? InstanceId = null,
    [property: PopulateFromService(ServiceKind.HostName)] string? HostName = null,
    [property: PopulateFromService(ServiceKind.ProcessId)] int? ProcessId = null
) : IEvent;
```

#### ServiceKind Enum

| Value | Type | Description |
|---|---|---|
| `ServiceName` | `string` | The name of the service (e.g., "OrderService") |
| `InstanceId` | `Guid` | Unique identifier for the service instance in scaled deployments |
| `HostName` | `string` | The host/machine name where the service runs |
| `ProcessId` | `int` | The operating system process ID |

### PopulateFromIdentifier

Marks a `Guid` or `Guid?` property for automatic population from message envelope identifiers. Essential for correlation, causation tracking, and saga patterns.

```csharp{title="PopulateFromIdentifier Attribute" description="Capture message identifiers for correlation and causation" category="Extending" difficulty="BEGINNER" tags=["auto-populate", "identifier", "PopulateFromIdentifier", "correlation"]}
public record ShipmentDispatched(
    [property: StreamId] Guid ShipmentId,
    string TrackingNumber,
    [property: PopulateFromIdentifier(IdentifierKind.MessageId)] Guid? MyMessageId = null,
    [property: PopulateFromIdentifier(IdentifierKind.CorrelationId)] Guid? WorkflowId = null,
    [property: PopulateFromIdentifier(IdentifierKind.CausationId)] Guid? TriggeredBy = null,
    [property: PopulateFromIdentifier(IdentifierKind.StreamId)] string? StreamIdentifier = null
) : IEvent;
```

#### IdentifierKind Enum

| Value | Type | Description |
|---|---|---|
| `MessageId` | `Guid` | The current message's unique identifier |
| `CorrelationId` | `Guid` | Links all messages in a workflow or saga |
| `CausationId` | `Guid` | The ID of the message that caused this one |
| `StreamId` | `string` | The stream/aggregate this message belongs to |

### PopulateFromContext

Marks a `string` property for automatic population from the current security context. Useful for audit trails and multi-tenancy.

```csharp{title="PopulateFromContext Attribute" description="Capture security context for audit trails and multi-tenancy" category="Extending" difficulty="BEGINNER" tags=["auto-populate", "context", "PopulateFromContext", "security", "multi-tenancy"]}
public record DocumentCreated(
    [property: StreamId] Guid DocumentId,
    string Title,
    [property: PopulateFromContext(ContextKind.UserId)] string? CreatedBy = null,
    [property: PopulateFromContext(ContextKind.TenantId)] string? TenantId = null
) : IEvent;
```

#### ContextKind Enum

| Value | Type | Description |
|---|---|---|
| `UserId` | `string` | The current user's identifier from `SecurityContext` |
| `TenantId` | `string` | The current tenant's identifier from `SecurityContext` |

## Applies To

All four attributes can be applied to:

- Properties on event types (implementing `IEvent`)
- Properties on command types (implementing `ICommand`)
- Record parameters (using `[property: ...]` attribute target syntax)

```csharp{title="Attribute Targets" description="Auto-populate attributes on properties and record parameters" category="Extending" difficulty="BEGINNER" tags=["auto-populate", "syntax", "attribute-targets"]}
// On record parameters (preferred for positional records)
public record OrderCreated(
    [property: StreamId] Guid OrderId,
    [property: PopulateTimestamp(TimestampKind.SentAt)] DateTimeOffset? SentAt = null
) : IEvent;

// On properties (class-style records or classes)
public record InventoryReserved : IEvent {
    [StreamId]
    public Guid ReservationId { get; init; }

    [PopulateTimestamp(TimestampKind.SentAt)]
    public DateTimeOffset? SentAt { get; init; }

    [PopulateFromContext(ContextKind.UserId)]
    public string? ReservedBy { get; init; }
}
```

## How It Works

### 1. Compile-Time Discovery

The `AutoPopulateDiscoveryGenerator` source generator scans all message types for auto-populate attributes and generates two classes per assembly:

- **`GeneratedAutoPopulateRegistry_{Assembly}`** -- implements `IAutoPopulateRegistry`, providing metadata about which properties on which types need population
- **`GeneratedAutoPopulatePopulator_{Assembly}`** -- implements `IAutoPopulatePopulator`, using record `with` expressions to produce new message instances with populated values

Both classes self-register via `[ModuleInitializer]` at assembly load time -- no manual wiring required.

### 2. Three Lifecycle Phases

Population happens at three distinct points in the message lifecycle:

```csharp{title="Lifecycle Phases" description="The three phases where auto-populate values are set" category="Extending" difficulty="INTERMEDIATE" tags=["Extending", "Attributes", "C#", "Lifecycle", "Phases"]}
// Phase 1: Sent -- when dispatcher.SendAsync/PublishAsync is called
// Populates: TimestampKind.SentAt, all ServiceKind, all ContextKind, all IdentifierKind

// Phase 2: Queued -- after message is written to the outbox
// Populates: TimestampKind.QueuedAt

// Phase 3: Delivered -- when message arrives from transport
// Populates: TimestampKind.DeliveredAt
```

### 3. Immutability Preservation

Auto-populated values are stored in the `MessageEnvelope` metadata with an `auto:` prefix, preserving the original message immutability. The generated populator uses record `with` expressions to create new instances:

```csharp{title="Generated Populator" description="Example of source-generated populator using with expressions" category="Reference" difficulty="INTERMEDIATE" tags=["auto-populate", "source-generator", "with-expression"]}
// Generated code (simplified) -- you never write this
public object? TryPopulateSent(object message, MessageHop hop, MessageId messageId) {
    return message switch {
        OrderCreated m => m with {
            SentAt = hop.Timestamp,
            ProcessedBy = hop.ServiceInstance.ServiceName,
            CreatedBy = _extractUserId(hop),
            WorkflowId = hop.CorrelationId?.Value.Value,
        },
        _ => null
    };
}
```

## Reading Auto-Populated Values

### From the Envelope

Use the extension methods on `IMessageEnvelope` to retrieve auto-populated values:

```csharp{title="Reading Values from Envelope" description="Retrieve auto-populated values from the message envelope" category="Extending" difficulty="BEGINNER" tags=["auto-populate", "envelope", "extensions", "reading"]}
// Get a specific auto-populated value
var sentAt = envelope.GetAutoPopulated<DateTimeOffset>("SentAt");
var userId = envelope.GetAutoPopulated<string>("CreatedBy");
var correlationId = envelope.GetAutoPopulated<Guid>("WorkflowId");

// Try-get pattern
if (envelope.TryGetAutoPopulated<string>("CreatedBy", out var createdBy)) {
    Console.WriteLine($"Created by: {createdBy}");
}

// Check existence
bool hasSentAt = envelope.HasAutoPopulated("SentAt");

// List all auto-populated keys
IEnumerable<string> keys = envelope.GetAllAutoPopulatedKeys();
```

### JSON Payload Manipulation

For transport workers that operate on serialized payloads, `JsonAutoPopulateHelper` provides AOT-safe timestamp population on `JsonElement` values:

```csharp{title="JSON Auto-Populate" description="Populate timestamps on serialized JSON payloads without typed deserialization" category="Extending" difficulty="INTERMEDIATE" tags=["auto-populate", "json", "transport", "aot"]}
// By Type reference
var updatedPayload = JsonAutoPopulateHelper.PopulateTimestamp(
    payload: jsonElement,
    messageType: typeof(OrderCreated),
    kind: TimestampKind.QueuedAt,
    timestamp: DateTimeOffset.UtcNow
);

// By type name (AOT-safe, avoids Type.GetType())
var updatedPayload = JsonAutoPopulateHelper.PopulateTimestampByName(
    payload: jsonElement,
    messageTypeName: "MyApp.Events.OrderCreated",
    kind: TimestampKind.DeliveredAt,
    timestamp: DateTimeOffset.UtcNow
);
```

## Practical Example

A complete event with full observability using all four attribute categories:

```csharp{title="Complete Observability Event" description="Event with full lifecycle timestamps, service info, security context, and identifiers" category="Extending" difficulty="INTERMEDIATE" tags=["auto-populate", "observability", "audit", "complete-example"]}
public record InvoiceGenerated(
    [property: StreamId] Guid InvoiceId,
    decimal TotalAmount,
    string Currency,

    // Lifecycle timestamps
    [property: PopulateTimestamp(TimestampKind.SentAt)] DateTimeOffset? SentAt = null,
    [property: PopulateTimestamp(TimestampKind.QueuedAt)] DateTimeOffset? QueuedAt = null,
    [property: PopulateTimestamp(TimestampKind.DeliveredAt)] DateTimeOffset? DeliveredAt = null,

    // Service info
    [property: PopulateFromService(ServiceKind.ServiceName)] string? GeneratedByService = null,
    [property: PopulateFromService(ServiceKind.InstanceId)] Guid? ServiceInstanceId = null,

    // Security context
    [property: PopulateFromContext(ContextKind.UserId)] string? GeneratedBy = null,
    [property: PopulateFromContext(ContextKind.TenantId)] string? TenantId = null,

    // Message identifiers
    [property: PopulateFromIdentifier(IdentifierKind.CorrelationId)] Guid? WorkflowId = null,
    [property: PopulateFromIdentifier(IdentifierKind.CausationId)] Guid? TriggeredBy = null
) : IEvent;
```

After dispatch, every field from `SentAt` downward is automatically populated. You never write manual assignment code for these properties.

## API Reference

### Attributes

| Attribute | Kind Enum | Property Types | Source |
|---|---|---|---|
| `PopulateTimestampAttribute` | `TimestampKind` | `DateTimeOffset`, `DateTimeOffset?` | Message lifecycle timestamps |
| `PopulateFromServiceAttribute` | `ServiceKind` | `string`, `Guid`, `int` | `ServiceInstanceInfo` |
| `PopulateFromIdentifierAttribute` | `IdentifierKind` | `Guid`, `Guid?`, `string` | `MessageEnvelope` identifiers |
| `PopulateFromContextAttribute` | `ContextKind` | `string` | `SecurityContext` |

### PopulateKind Enum

The `PopulateKind` enum categorizes registrations internally:

| Value | Description |
|---|---|
| `Timestamp` | Lifecycle timestamps (SentAt, QueuedAt, DeliveredAt) |
| `Context` | Security context values (UserId, TenantId) |
| `Service` | Service instance information (ServiceName, InstanceId, HostName, ProcessId) |
| `Identifier` | Message identifiers (MessageId, CorrelationId, CausationId, StreamId) |

### Key Interfaces

| Interface | Purpose |
|---|---|
| `IAutoPopulateRegistry` | Per-assembly registry of auto-populate registrations, generated by the source generator |
| `IAutoPopulateProcessor` | Processes registrations and stores values in envelope metadata |
| `IAutoPopulatePopulator` | Per-assembly populator using record `with` expressions for typed population |

### Key Classes

| Class | Purpose |
|---|---|
| `AutoPopulateRegistry` | Static aggregator of all `IAutoPopulateRegistry` instances across loaded assemblies |
| `AutoPopulatePopulatorRegistry` | Static aggregator of all `IAutoPopulatePopulator` instances across loaded assemblies |
| `AutoPopulateProcessor` | Default `IAutoPopulateProcessor` implementation; extracts values from hops and stores them as metadata |
| `AutoPopulateRegistration` | Record describing a single auto-populated property (message type, property name, kind, etc.) |
| `MessageEnvelopeAutoPopulateExtensions` | Extension methods for `IMessageEnvelope` to read auto-populated values |
| `JsonAutoPopulateHelper` | AOT-safe helper for populating timestamps on serialized JSON payloads |
| `AutoPopulateDiscoveryGenerator` | Source generator that discovers auto-populate attributes and generates registry and populator code |

## Zero Reflection / AOT

The auto-populate system is fully AOT-compatible:

- **Discovery** happens at compile time via the `AutoPopulateDiscoveryGenerator` source generator
- **Registration** uses `[ModuleInitializer]` for automatic self-registration at assembly load
- **Population** uses record `with` expressions -- direct property assignment with no reflection
- **JSON manipulation** uses `System.Text.Json.Nodes.JsonNode` which is fully AOT-compatible
- **Serialization** uses `InfrastructureJsonContext` source-generated JSON serializer context

No `Type.GetType()`, no `PropertyInfo.SetValue()`, no runtime reflection of any kind.

## See Also

- [StreamId Attribute](streamid.md) -- Marks the stream ID property
- [GenerateStreamId Attribute](generatestreamid.md) -- Auto-generate StreamIds at dispatch time
- [StreamKey Attribute](streamkey.md) -- Event ordering for perspectives
