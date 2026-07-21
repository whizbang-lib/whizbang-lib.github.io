---
title: 'WHIZ030: Perspective Event Missing StreamId'
pageType: troubleshooting
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
description: >-
  Event type used in perspective must have exactly one property marked with
  [StreamId] attribute
category: Diagnostics
severity: Error
tags:
  - diagnostics
  - perspectives
  - streamid
  - source-generator
codeReferences:
  - src/Whizbang.Generators/DiagnosticDescriptors.cs
  - src/Whizbang.Generators/PerspectiveDiscoveryGenerator.cs
  - src/Whizbang.Core/StreamIdAttribute.cs
testReferences:
  - tests/Whizbang.Generators.Tests/PerspectiveDiscoveryGeneratorTests.cs
lastMaintainedCommit: '01f07906'
---

# WHIZ030: Perspective Event Missing StreamId

**Severity**: Error
**Category**: Source Generation

## Description

This error occurs when an event type is used in a perspective (via `IPerspectiveFor<TModel, TEvent>`) but does not have a property marked with the `[StreamId]` attribute.

The `[StreamId]` attribute is required on all events used in perspectives because it identifies which stream (aggregate) the event belongs to. This enables the perspective runner to:
- Group events by stream for ordered processing
- Apply events in UUID7 timestamp order within each stream
- Maintain consistency per aggregate

The check searches the event type's full inheritance hierarchy, so a `[StreamId]` inherited from a base event type satisfies it. For array event types (batch application), the *element* type is validated.

## Error Message

```
Event type 'ProductCreatedEvent' used in perspective 'ProductCatalogPerspective' must have exactly one property marked with [StreamId] attribute
```

## How to Fix

Add the `[StreamId]` attribute to exactly one property on your event type:

```csharp{title="How to Fix" description="Add the [StreamId] attribute to exactly one property on your event type:" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Diagnostics", "Fix"] tests=["PerspectiveDiscoveryGeneratorTests.PerspectiveDiscoveryGenerator_EventWithStreamId_ExtractsStreamIdPropertyAsync"]}
public record ProductCreatedEvent : IEvent {
  [StreamId]  // ✅ Add this attribute
  public Guid ProductId { get; init; }
  public string Name { get; init; } = string.Empty;
  public decimal Price { get; init; }
}
```

## Requirements

- **Exactly one property** must have `[StreamId]` (more than one triggers [WHIZ031](whiz031.md))
- The property should identify the aggregate/stream (e.g., `OrderId`, `ProductId`, `CustomerId`)
- The property must be of type `Guid`, `Guid?`, or a WhizbangId type (a type with a `.Value` property returning `Guid`)

## Example: Product Catalog Perspective

**Before (causes WHIZ030)**:
```csharp{title="Example: Product Catalog Perspective" description="Before (causes WHIZ030):" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Example:", "Product"] unverified="counter-example — the pattern WHIZ030 flags; detection verified by PerspectiveDiscoveryGeneratorTests.PerspectiveDiscoveryGenerator_EventMissingStreamId_ReportsWHIZ030DiagnosticAsync"}
// ❌ Missing [StreamId] attribute
public record ProductCreatedEvent : IEvent {
  public Guid ProductId { get; init; }  // No [StreamId]!
  public string Name { get; init; } = string.Empty;
}

public record ProductDto {
  [StreamId]
  public Guid ProductId { get; init; }
  public string Name { get; init; } = string.Empty;
}

public class ProductCatalogPerspective : IPerspectiveFor<ProductDto, ProductCreatedEvent> {
  public ProductDto Apply(ProductDto currentData, ProductCreatedEvent @event) {
    return new ProductDto {
      ProductId = @event.ProductId,
      Name = @event.Name
    };
  }
}
```

**After (error resolved)**:
```csharp{title="Example: Product Catalog Perspective - ProductCreatedEvent" description="After (error resolved):" category="Troubleshooting" difficulty="INTERMEDIATE" tags=["Operations", "Diagnostics", "Example:", "Product"] tests=["PerspectiveDiscoveryGeneratorTests.PerspectiveDiscoveryGenerator_EventWithStreamId_ExtractsStreamIdPropertyAsync"]}
// ✅ [StreamId] added to event
public record ProductCreatedEvent : IEvent {
  [StreamId]  // Identifies the stream
  public Guid ProductId { get; init; }
  public string Name { get; init; } = string.Empty;
}

public record ProductDto {
  [StreamId]
  public Guid ProductId { get; init; }
  public string Name { get; init; } = string.Empty;
}

public class ProductCatalogPerspective : IPerspectiveFor<ProductDto, ProductCreatedEvent> {
  public ProductDto Apply(ProductDto currentData, ProductCreatedEvent @event) {
    return new ProductDto {
      ProductId = @event.ProductId,
      Name = @event.Name
    };
  }
}
```

## Why This Matters

Without a `[StreamId]`, the perspective runner cannot:
1. **Extract the stream ID** from events at compile-time (zero reflection)
2. **Group events by stream** for ordered processing
3. **Apply events in order** within each aggregate
4. **Maintain consistency** per aggregate instance

## Related Diagnostics

- **[WHIZ031](whiz031.md)** - Event type has multiple `[StreamId]` attributes
- **WHIZ009** - Warning for IEvent/ICommand implementations missing `[StreamId]` (general case)

## See Also

- [StreamId Attribute](../../extending/attributes/streamid.md) - Detailed attribute documentation
- [Perspectives](../../fundamentals/perspectives/perspectives.md) - Pure function perspectives with StreamId
- [PerspectiveRunner Architecture](../../fundamentals/perspectives/perspectives.md#perspectiverunner-architecture) - How runners use StreamId
