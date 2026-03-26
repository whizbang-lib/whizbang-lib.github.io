---
title: GenerateStreamId Attribute
version: 1.0.0
category: Attributes
order: 3
description: >-
  Marks an event type or property for automatic StreamId generation at dispatch time,
  replacing the blunt AutoGenerateStreamIds option with per-event-type control
tags: 'attributes, streamid, event-sourcing, source-generator, auto-generation'
codeReferences:
  - src/Whizbang.Core/GenerateStreamIdAttribute.cs
  - src/Whizbang.Generators/StreamIdGenerator.cs
  - src/Whizbang.Core/Validation/StreamIdGuard.cs
---

# GenerateStreamId Attribute

The `[GenerateStreamId]` attribute marks an event for automatic StreamId generation at dispatch time. It works alongside `[StreamId]` to provide explicit, per-event-type opt-in for stream ID auto-generation.

## Namespace

```csharp{title="Namespace" description="Namespace" category="Reference" difficulty="BEGINNER" tags=["Extending", "Attributes", "Namespace"]}
using Whizbang.Core;
```

## Syntax

```csharp{title="Syntax" description="Syntax" category="Reference" difficulty="INTERMEDIATE" tags=["Extending", "Attributes", "Syntax"]}
// On a property (alongside [StreamId])
public record OrderCreatedEvent : IEvent {
  [StreamId] [GenerateStreamId]
  public Guid OrderId { get; set; }
}

// With OnlyIfEmpty for flexible events
public record InventoryReserved : IEvent {
  [StreamId] [GenerateStreamId(OnlyIfEmpty = true)]
  public Guid ReservationId { get; set; }
}

// On a class (for inherited [StreamId])
[GenerateStreamId]
public record OrderCreatedEvent : BaseEvent {
  // [StreamId] inherited from BaseEvent.StreamId
}

// On record parameters
public record OrderCreated([property: StreamId] [property: GenerateStreamId] Guid OrderId) : IEvent;
```

## Applies To

- Properties on event types (alongside `[StreamId]`)
- Record parameters (using `[property: GenerateStreamId]` target)
- Classes/records (when `[StreamId]` is inherited from a base type)

## Purpose

The `[GenerateStreamId]` attribute replaces the blunt `AutoGenerateStreamIds` option with fine-grained, per-event-type control over when StreamIds are auto-generated. This distinction is critical for event-sourced systems where:

1. **Stream-initiating events** should always get a new StreamId
2. **Appending events** must receive a StreamId from their parent (and fail-fast if missing)
3. **Flexible events** may either inherit a StreamId from a cascade or generate their own

## Event Patterns

### Stream-Initiating Events

Events that start a new stream should always generate a new StreamId, even when cascaded from another event:

```csharp{title="Stream-Initiating Events" description="Events that start a new stream should always generate a new StreamId, even when cascaded from another event:" category="Reference" difficulty="BEGINNER" tags=["Extending", "Attributes", "Stream-Initiating", "Events"]}
public record OrderCreatedEvent : IEvent {
  [StreamId] [GenerateStreamId]
  public Guid OrderId { get; set; }
}
```

When dispatched, `OrderId` will always be populated with a new UUIDv7 (TrackedGuid.NewMedo()).

### Appending Events

Events that must belong to an existing stream should NOT have `[GenerateStreamId]`. If the StreamId is `Guid.Empty` at dispatch time, the `StreamIdGuard` will throw an `InvalidStreamIdException`:

```csharp{title="Appending Events" description="Events that must belong to an existing stream should NOT have [GenerateStreamId]." category="Reference" difficulty="BEGINNER" tags=["Extending", "Attributes", "Appending", "Events"]}
public record OrderItemAddedEvent : IEvent {
  [StreamId]
  public Guid OrderId { get; set; }  // MUST be provided by caller
}
```

### Flexible Events

Events that may be dispatched independently OR cascaded from a parent event should use `OnlyIfEmpty = true`:

```csharp{title="Flexible Events" description="Events that may be dispatched independently OR cascaded from a parent event should use OnlyIfEmpty = true:" category="Reference" difficulty="BEGINNER" tags=["Extending", "Attributes", "Flexible", "Events"]}
public record InventoryReserved : IEvent {
  [StreamId] [GenerateStreamId(OnlyIfEmpty = true)]
  public Guid ReservationId { get; set; }
}
```

- When cascaded: inherits parent's StreamId (not overwritten)
- When standalone: gets a new StreamId auto-generated

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `OnlyIfEmpty` | `bool` | `false` | When `true`, only generates a StreamId if the current value is `Guid.Empty`. When `false`, always generates a new StreamId. |

## How It Works

1. **At compile time**: The source generator discovers `[GenerateStreamId]` attributes and generates a `GetGenerationPolicy` method with type-specific switch arms.

2. **At dispatch time**: The Dispatcher calls `GetGenerationPolicy(message)` to determine if auto-generation should occur:
   - `(ShouldGenerate: true, OnlyIfEmpty: false)` → Always generate new StreamId
   - `(ShouldGenerate: true, OnlyIfEmpty: true)` → Generate only if current StreamId is `Guid.Empty`
   - `(ShouldGenerate: false, OnlyIfEmpty: false)` → No auto-generation; guard will throw if StreamId is `Guid.Empty`

3. **After generation**: `StreamIdGuard.ThrowIfEmpty` validates that events with `[StreamId]` have a non-empty StreamId at pipeline boundaries (Dispatcher outbox, consumer inbox, work coordinator queues).

## Validation Guards

Events with `[StreamId]` but without `[GenerateStreamId]` are validated at pipeline boundaries:

- **Dispatcher outbox**: `StreamIdGuard.ThrowIfEmpty` throws `InvalidStreamIdException`
- **Consumer inbox**: Guards at `TransportConsumerWorker` and `ServiceBusConsumerWorker`
- **Work coordinator**: `StreamIdGuard.ThrowIfNonNullEmpty` at queue boundaries

The guard distinguishes between:
- `null` StreamId → OK (event has no stream concept, no `[StreamId]` attribute)
- `Guid.Empty` StreamId → Bug (event has `[StreamId]` but no value was provided or generated)
- Valid Guid → OK

## Relationship to Other Attributes

| Attribute | Purpose |
|---|---|
| `[StreamId]` | Marks which property IS the stream ID |
| `[GenerateStreamId]` | Controls whether the stream ID is AUTO-GENERATED |
| `[StreamKey]` | Alternative string-based stream identification |

`[GenerateStreamId]` requires `[StreamId]` to be present (either on the same property or inherited from a base class).

## Zero Reflection / AOT

The `[GenerateStreamId]` attribute is fully AOT-compatible:

- Discovery happens at compile time via the source generator
- The `GetGenerationPolicy` method uses type-based pattern matching (no reflection)
- Generation uses `TrackedGuid.NewMedo()` (UUIDv7) for time-ordered, database-friendly IDs

## See Also

- [StreamId Attribute](streamid.md) — Marks the stream ID property
- [Stream ID Concepts](../../fundamentals/events/stream-id.md) — Stream ID concepts and ordering
