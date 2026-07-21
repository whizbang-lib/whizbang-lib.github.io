---
title: StreamKey Attribute
pageType: reference
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
description: >-
  The historical StreamKey attribute has been unified into StreamId, which now
  drives both event store stream identification and perspective event ordering
category: Attributes
tags:
  - attributes
  - streamkey
  - streamid
  - perspectives
  - event-sourcing
  - source-generator
codeReferences:
  - src/Whizbang.Core/StreamIdAttribute.cs
  - src/Whizbang.Core/StreamIdExtractor.cs
  - src/Whizbang.Core/IStreamIdExtractor.cs
  - src/Whizbang.Generators/StreamIdGenerator.cs
testReferences:
  - tests/Whizbang.Generators.Tests/StreamIdGeneratorTests.cs
  - tests/Whizbang.Core.Tests/StreamIdExtractorTests.cs
lastMaintainedCommit: '01f07906'
---

# StreamKey Attribute

:::updated
The `[StreamKey]` attribute no longer exists as a separate attribute. It has been **unified into [`[StreamId]`](./streamid)**, which now serves both purposes: identifying the event store stream an event belongs to, **and** grouping/ordering events per stream for perspective processing. Apply `[StreamId]` everywhere older documentation said `[StreamKey]`.
:::

## Migration

```csharp{title="StreamKey to StreamId" description="Replace StreamKey with the unified StreamId attribute" category="Usage" difficulty="BEGINNER" tags=["StreamKey", "StreamId", "Migration"] tests=["StreamIdExtractorTests.ExtractStreamId_EventWithStreamId_ReturnsStreamIdValueAsync", "StreamIdGeneratorTests.Generator_WithStreamIdAttribute_GeneratesExtractorAsync"]}
// Before (historical API - no longer compiles)
public record ProductCreatedEvent : IEvent {
  [StreamKey]
  public Guid ProductId { get; init; }
}

// After (current API)
public record ProductCreatedEvent : IEvent {
  [StreamId]
  public Guid ProductId { get; init; }
}
```

The same replacement applies to perspective model types - models mark their stream identity property with `[StreamId]`:

```csharp{title="Model StreamId" description="Perspective models use StreamId to identify their stream" category="Usage" difficulty="BEGINNER" tags=["StreamId", "Perspectives", "Models"] unverified="[StreamId] on a perspective model plus an IPerspectiveFor Apply — perspective-model stream-id generation and the pure Apply are covered by perspective-discovery/perspective tests, not by these event/command StreamId extractor and generator tests"}
public record ProductDto {
  [StreamId]  // Identifies which product this model represents
  public Guid ProductId { get; init; }
  public string Name { get; init; } = string.Empty;
  public decimal Price { get; init; }
}

public class ProductCatalogPerspective : IPerspectiveFor<ProductDto, ProductCreatedEvent> {
  public ProductDto Apply(ProductDto currentData, ProductCreatedEvent eventData) {
    return new ProductDto {
      ProductId = eventData.ProductId,
      Name = eventData.Name,
      Price = eventData.Price
    };
  }
}
```

## How Perspective Ordering Works Today

The role the historical `[StreamKey]` attribute played in perspectives is now filled by `[StreamId]`:

1. The source generators discover `[StreamId]` on event, command, and perspective model properties and generate zero-reflection extractors (`StreamIdExtractors` in your assembly's `.Generated` namespace).
2. At runtime, perspective processing groups events by their extracted stream ID, so all events for one aggregate (e.g. Order #123) are applied in order within that stream.
3. Events are applied to the model through pure `Apply()` methods; the updated model is saved with its checkpoint per stream.

## Requirements

- **Exactly one** `[StreamId]` property per event type used in a perspective
- Perspective model types must also have a `[StreamId]` property, or no runner is generated
- Property type must be `Guid`, `Guid?`, or a WhizbangId-style type (a type exposing a `Guid` value)

## Diagnostics

The source generators validate `[StreamId]` usage for perspectives:

### WHIZ030: Missing StreamId

**Error**: An event used in a perspective has no `[StreamId]` property.

```csharp{title="WHIZ030: Missing StreamId" description="Error: Event used in perspective has no StreamId property" category="Diagnostics" difficulty="INTERMEDIATE" tags=["StreamId", "Diagnostics", "WHIZ030"] unverified="counter-example — an event used in a perspective with no [StreamId] is the pattern WHIZ030 flags; WHIZ030 detection is asserted by the perspective-discovery generator tests, not by these StreamId extractor/generator tests"}
// ❌ Causes WHIZ030
public record ProductEvent : IEvent {
  public Guid ProductId { get; init; }  // No [StreamId]!
}

// ✅ Fixed
public record ProductEvent : IEvent {
  [StreamId]
  public Guid ProductId { get; init; }
}
```

See [WHIZ030 Diagnostic](../../operations/diagnostics/whiz030.md) for details.

### WHIZ031: Multiple StreamIds

**Error**: An event has multiple properties marked with `[StreamId]`.

```csharp{title="WHIZ031: Multiple StreamIds" description="Error: Event has multiple StreamId properties" category="Diagnostics" difficulty="INTERMEDIATE" tags=["StreamId", "Diagnostics", "WHIZ031"] unverified="counter-example — two [StreamId] properties on one event is the pattern WHIZ031 flags; the WHIZ031 multiple-stream-id diagnostic is not asserted by these StreamId extractor/generator tests"}
// ❌ Causes WHIZ031
public record OrderEvent : IEvent {
  [StreamId]
  public Guid OrderId { get; init; }

  [StreamId]  // Only one [StreamId] allowed!
  public Guid CustomerId { get; init; }
}

// ✅ Fixed - Choose the primary aggregate
public record OrderEvent : IEvent {
  [StreamId]  // Order is the primary aggregate
  public Guid OrderId { get; init; }

  public Guid CustomerId { get; init; }  // Related entity, not stream ID
}
```

See [WHIZ031 Diagnostic](../../operations/diagnostics/whiz031.md) for details.

### WHIZ033: Perspective Model Missing StreamId

**Warning**: A perspective's model type has no `[StreamId]` property. The perspective will not get a generated runner until the model marks its stream identity property.

## Best Practices

- Put `[StreamId]` on the **aggregate root identifier** (e.g. `OrderId`), not on related entity IDs or timestamps
- Use the **same property name** across all events of one aggregate and on the matching model
- Prefer time-ordered UUIDv7 values (`TrackedGuid.NewMedo()` or [GenerateStreamId](./generatestreamid)) for stream IDs

## See Also

- [StreamId Attribute](./streamid) - The unified attribute (full reference)
- [GenerateStreamId Attribute](./generatestreamid) - Auto-generate stream IDs at dispatch time
- [Perspectives](../../fundamentals/perspectives/perspectives.md) - Pure function perspectives
- [WHIZ030 Diagnostic](../../operations/diagnostics/whiz030.md) - Missing StreamId error
- [WHIZ031 Diagnostic](../../operations/diagnostics/whiz031.md) - Multiple StreamId error
