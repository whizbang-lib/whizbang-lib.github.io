---
title: Aggregate IDs
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Source Generators
order: 4
description: >-
  Zero-reflection stream ID extraction with [StreamId] - compile-time
  discovery of stream (aggregate) identifiers on events and commands
tags: >-
  source-generators, stream-ids, aggregate-ids, policy-context, zero-reflection,
  compile-time, uuidv7
codeReferences:
  - src/Whizbang.Generators/StreamIdGenerator.cs
  - src/Whizbang.Generators/Templates/StreamIdExtractorsTemplate.cs
  - src/Whizbang.Generators/Templates/Snippets/StreamIdSnippets.cs
  - src/Whizbang.Core/StreamIdAttribute.cs
  - src/Whizbang.Core/GenerateStreamIdAttribute.cs
  - src/Whizbang.Core/Policies/PolicyContext.cs
testReferences:
  - tests/Whizbang.Generators.Tests/StreamIdGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/StreamIdGeneratorCoverageTests.cs
  - tests/Whizbang.Generators.Tests/GenerateStreamIdGeneratorTests.cs
  - tests/Whizbang.Generators.Tests/StreamIdInfoTests.cs
lastMaintainedCommit: '01f07906'
---

# Aggregate IDs

:::updated
**Renamed in the shipped library (verified at commit `1b31f58d`)**: the early `AggregateIdGenerator` + `[AggregateId]` design described by previous versions of this page was replaced by the **`StreamIdGenerator`** + **`[StreamId]`** attribute. "Aggregate ID" and "stream ID" refer to the same concept — the identifier of the stream (aggregate/entity) a message belongs to — and `PolicyContext.GetAggregateId()` is still the policy-facing accessor, but discovery, generation, and extraction all run through `[StreamId]`.
:::

The **StreamIdGenerator** discovers properties (or record parameters) marked with `[StreamId]` at compile-time and generates zero-reflection extractor methods. This lets the framework resolve which stream a message belongs to — for event sourcing, tracing, and policy decisions — without any runtime reflection.

## Why Stream IDs?

**Stream IDs** identify the stream (aggregate) a message belongs to (Orders, Customers, Products). Whizbang uses them for:

| Use Case | Description | Example |
|----------|-------------|---------|
| **Event Sourcing** | Group all events for an aggregate into one stream | All events for Order #123 |
| **Ordering** | Events for the same stream process in order | Per-stream sequential drain |
| **Policy Decisions** | `PolicyContext.GetAggregateId()` for routing decisions | High-value orders → priority handling |
| **Delivery Receipts** | `IDeliveryReceipt.StreamId` extraction | Track outcome per stream |
| **Partitioning** | Distribute work across instances by stream | Order #789 → Instance 2 |

**Problem**: Extracting IDs at runtime requires **reflection** (slow, not AOT-compatible).

**Solution**: The generator discovers `[StreamId]` members at compile-time and generates **zero-reflection extractors**.

---

## How It Works

### 1. Mark Properties with [StreamId]

```csharp{title="Mark Properties with [StreamId]" description="Mark Properties with [StreamId]" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "Mark", "Properties"]}
using Whizbang.Core;

// Command (record parameter form)
public record CreateOrder(
    [property: StreamId] Guid OrderId,  // ← Marked as stream ID
    Guid CustomerId
) : ICommand;

// Event (property form)
public record OrderCreated : IEvent {
    [StreamId]
    public Guid OrderId { get; set; }
    public Guid CustomerId { get; init; }
    public decimal Total { get; init; }
}
```

**Requirements** (from `StreamIdAttribute`):
- Property must be `Guid`, `Guid?`, or a WhizbangId type (a type whose value resolves to a `Guid`)
- Only one `[StreamId]` per message type
- The attribute is inherited by derived message types

### 2. Compile-Time Discovery

The generator runs four discovery pipelines over public `record`/`class` declarations with base lists:

1. **`IEvent` types with `[StreamId]`** (on a property or constructor parameter, including inherited members)
2. **`IEvent` types without `[StreamId]`** — reported as WHIZ009 warnings
3. **`ICommand` types with `[StreamId]`**
4. **Concrete `ICompositeEvent` types with `[StreamId]`** — composites are `IMessage`-not-`IEvent`, but carry a `[StreamId]` their fanned-out inner events inherit; they get an object-typed extractor so producer-side fan-out routes children correctly

Non-public types are skipped (generated code could not access them), and abstract composites (e.g., `CompositeEventBase` itself) are skipped.

### 3. Generated Code

One file, **StreamIdExtractors.g.cs**, is emitted into the `{AssemblyName}.Generated` namespace. Its public surface:

```csharp{title="Generated Code" description="Public surface of StreamIdExtractors.g.cs" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "Generated", "Code"]}
public static partial class StreamIdExtractors {
    // Resolve stream ID as string (throws if the type has no [StreamId])
    public static string Resolve(IEvent @event);
    public static string Resolve(ICommand command);

    // Try to resolve as Guid (returns null if missing/not parseable)
    public static Guid? TryResolveAsGuid(IEvent? @event);
    public static Guid? TryResolveAsGuid(ICommand? command);
    public static Guid? TryResolveAsGuid(object? message);  // composites, perspective DTOs

    // [GenerateStreamId] support (used by the Dispatcher)
    public static (bool ShouldGenerate, bool OnlyIfEmpty) GetGenerationPolicy(object message);
    public static bool SetStreamId(object message, Guid streamId);
}

// Delegates to the static extractors; implements Whizbang.Core.IStreamIdExtractor
internal sealed class GeneratedStreamIdExtractor : IStreamIdExtractor { /* ... */ }

// DI hook: registers the composite extractor as IStreamIdExtractor
public static class StreamIdExtractorRegistrations {
    public static IServiceCollection AddWhizbangStreamIdExtractor(this IServiceCollection services);
}
```

Each discovered type gets a type-dispatch case plus a per-type extractor, e.g.:

```csharp{title="Generated Code (2)" description="Per-type dispatch and extractor" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "Generated", "Code"]}
// Dispatch (inside Resolve/TryResolveAsGuid)
if (@event is global::MyApp.Events.OrderCreated e0) {
    return TryExtractAsGuid(e0);
}

// Per-type extractor for a Guid property
private static global::System.Guid? TryExtractAsGuid(global::MyApp.Events.OrderCreated @event) {
    return @event.OrderId;
}
```

String and other property types are supported via `Guid.TryParse` on the value's string form; null or whitespace keys return `null` from `TryResolveAsGuid` (and throw from `Resolve`).

### 4. Multi-Assembly Registration

A `[ModuleInitializer]` in the generated file registers the assembly's extractor with the global `StreamIdExtractorRegistry` when the assembly loads — **priority 100 for contracts assemblies, 1000 for services** — so shared-contracts extractors are tried first. `AddWhizbangStreamIdExtractor()` (called by `AddWhizbangDispatcher()`) then registers the registry's composite as the DI `IStreamIdExtractor`.

---

## Auto-Generating Stream IDs

Apply `[GenerateStreamId]` alongside `[StreamId]` to have the Dispatcher mint a stream ID at dispatch time:

```csharp{title="GenerateStreamId" description="Auto-generation patterns" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "GenerateStreamId"]}
// Stream-initiating event: ALWAYS gets a new StreamId
public record OrderCreatedEvent : IEvent {
    [StreamId] [GenerateStreamId]
    public Guid OrderId { get; set; }
}

// Flexible event: inherits parent StreamId in cascades, generates if standalone
public record InventoryReserved : IEvent {
    [StreamId] [GenerateStreamId(OnlyIfEmpty = true)]
    public Guid ReservationId { get; set; }
}

// Class-level: for a [StreamId] inherited from a base class
[GenerateStreamId]
public record OrderCreatedFromBase : BaseEvent;
```

The generated `GetGenerationPolicy` returns `(ShouldGenerate, OnlyIfEmpty)` per type, and `SetStreamId` writes the minted value back through the `[StreamId]` property — which is why that property must be a mutable `get; set;` (see WHIZ013 below). Events with `[StreamId]` but **without** `[GenerateStreamId]` must have a stream ID assigned before dispatch.

---

## Usage in PolicyContext

`PolicyContext.GetAggregateId()` resolves the `IStreamIdExtractor` from the service provider and extracts the stream ID from the current message:

```csharp{title="PolicyContext Integration" description="PolicyContext.GetAggregateId() uses the generated extractor" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Source-Generators", "PolicyContext", "Integration"]}
// Inside a policy, the aggregate/stream ID comes from the generated extractor:
var aggregateId = context.GetAggregateId();

// Throws InvalidOperationException if:
// - IStreamIdExtractor is not registered, or
// - the message type has no property marked with [StreamId]
```

---

## Diagnostics

| ID | Severity | Message |
|----|----------|---------|
| **WHIZ004** | Info | `Found [StreamId] on command {0}.{1}` |
| **WHIZ005** | Error | `[StreamId] on {0}.{1} must be of type Guid, Guid?, or a type with a .Value property returning Guid` |
| **WHIZ006** | Warning | `Type {0} has multiple [StreamId] attributes. Only the first property '{1}' will be used.` |
| **WHIZ009** | Warning | `Type '{0}' implements {1} but has no property or parameter marked with [StreamId]. Stream ID resolution will fail at runtime.` |
| **WHIZ010** | Info | `Found [StreamId] on {0}.{1}` |
| **WHIZ013** | Error | `[GenerateStreamId]` on an **init-only** `[StreamId]` property — the generated `SetStreamId` writer cannot target `init`, so the minted ID would silently never be written. Change the property to `get; set;`. |

**Example build output**:
```
info WHIZ010: Found [StreamId] on OrderCreated.OrderId
info WHIZ004: Found [StreamId] on command CreateOrder.OrderId
warning WHIZ009: Type 'LegacyEvent' implements IEvent but has no property or parameter marked with [StreamId]. Stream ID resolution will fail at runtime.
```

---

## Patterns

### Pattern 1: Record Parameter

```csharp{title="Pattern 1: Record Parameter" description="Record parameter form" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "Pattern", "Record"]}
public record OrderCreated(
    [property: StreamId] Guid OrderId,
    string ProductName
) : IEvent;
```

### Pattern 2: Nullable Guid

```csharp{title="Pattern 2: Nullable Guid" description="Nullable stream ID" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "Pattern", "Nullable"]}
public record OrderArchived : IEvent {
    [StreamId]
    public Guid? OrderId { get; set; }  // TryResolveAsGuid returns null when unset
}
```

### Pattern 3: Inherited [StreamId]

```csharp{title="Pattern 3: Inherited [StreamId]" description="Inherited stream ID from base class" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "Pattern", "Inherited"]}
// Base class carries the attribute (Inherited = true)
public abstract record OrderEventBase : IEvent {
    [StreamId]
    public Guid OrderId { get; set; }
}

// Derived events are each discovered with the inherited property
public record OrderShipped(string TrackingNumber) : OrderEventBase;
public record OrderCancelled(string Reason) : OrderEventBase;
```

`FindPropertyWithAttribute` (see [Type Symbol Extensions](type-symbol-extensions.md)) walks the base-type chain, so the derived events each get their own extractor.

---

## Best Practices

### DO ✅

- ✅ **Mark the stream identifier** with `[StreamId]` on every `IEvent` and stream-addressed `ICommand`
- ✅ **Use Guid / Guid? / WhizbangId types** for ID properties
- ✅ **Use `[GenerateStreamId]`** for stream-initiating events; `OnlyIfEmpty = true` for cascade-friendly events
- ✅ **Keep `[StreamId]` + `[GenerateStreamId]` properties mutable** (`get; set;`) so the generated writer can assign them
- ✅ **Use UUIDv7-style IDs** (`TrackedGuid`/WhizbangId types) for time-ordering

### DON'T ❌

- ❌ Mark multiple properties (WHIZ006 — only the first is used)
- ❌ Use non-Guid-compatible types (WHIZ005 error)
- ❌ Leave events without `[StreamId]` (WHIZ009 — runtime resolution will fail)
- ❌ Combine `[GenerateStreamId]` with an init-only property (WHIZ013 error)

---

## Troubleshooting

### Problem: "No stream ID extractor found for event type ..."

**Symptoms**: `Resolve()` throws `InvalidOperationException` at runtime.

**Causes**:
1. The type has no `[StreamId]` property or parameter
2. The type is not public (generated code skips non-public types)

**Solution**:
```csharp{title="Problem: No extractor found" description="Add [StreamId] on a public type" category="Internals" difficulty="BEGINNER" tags=["Extending", "Source-Generators", "Problem:", "Extractor"]}
public record CreateOrder(
    [property: StreamId] Guid OrderId,  // Add attribute
    Guid CustomerId
) : ICommand;
```

### Problem: Second [StreamId] Ignored

**Symptoms**: Warning WHIZ006, second property not used.

**Solution**: Keep exactly one `[StreamId]` per message type.

### Problem: Auto-Generated ID Stays Empty

**Symptoms**: Dispatch fails at the outbox; `[GenerateStreamId]` appears to do nothing.

**Cause**: The `[StreamId]` property is init-only, so `SetStreamId` cannot write to it (WHIZ013 reports this at build time).

**Solution**: Change the property to `get; set;`.

---

## Further Reading

**Source Generators**:
- [Receptor Discovery](receptor-discovery.md) - Compile-time receptor discovery
- [Perspective Discovery](perspective-discovery.md) - Compile-time perspective discovery
- [Type Symbol Extensions](type-symbol-extensions.md) - Inherited-property discovery used by this generator
- [JSON Contexts](json-contexts.md) - AOT-compatible JSON serialization

**Core Concepts**:
- [Message Context](../../fundamentals/messages/message-context.md) - MessageId, CorrelationId, CausationId
- [Observability](../../fundamentals/persistence/observability.md) - Distributed tracing with hops

**Data Access**:
- [Event Store](../../data/event-store.md) - Event sourcing and stream storage

**Infrastructure**:
- [Policies](../../operations/infrastructure/policies.md) - Policy-based routing and decisions

---

*Version 1.0.0 - Foundation Release | Last Updated: 2026-07-16*
