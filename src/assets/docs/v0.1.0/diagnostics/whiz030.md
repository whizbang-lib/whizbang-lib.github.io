---
title: "WHIZ030: Perspective Event Missing StreamKey"
description: "Event type used in perspective must have exactly one property marked with [StreamKey] attribute"
category: "Diagnostics"
severity: "Error"
tags: ["diagnostics", "perspectives", "streamkey", "source-generator"]
---

# WHIZ030: Perspective Event Missing StreamKey

**Severity**: Error
**Category**: Source Generation

## Description

This error occurs when an event type is used in a perspective (via `IPerspectiveFor<TModel, TEvent>`) but does not have a property marked with the `[StreamKey]` attribute.

The `[StreamKey]` attribute is required on all events used in perspectives because it identifies which stream (aggregate) the event belongs to. This enables the perspective runner to:
- Group events by stream for ordered processing
- Apply events in UUID7 timestamp order within each stream
- Maintain consistency per aggregate

## Error Message

```
Event type 'MyNamespace.ProductCreatedEvent' used in perspective 'ProductCatalogPerspective' must have exactly one property marked with [StreamKey] attribute
```

## How to Fix

Add the `[StreamKey]` attribute to exactly one property on your event type:

```csharp
public record ProductCreatedEvent : IEvent {
  [StreamKey]  // ✅ Add this attribute
  public Guid ProductId { get; init; }
  public string Name { get; init; } = string.Empty;
  public decimal Price { get; init; }
}
```

## Requirements

- **Exactly one property** must have `[StreamKey]`
- The property should identify the aggregate/stream (e.g., `OrderId`, `ProductId`, `CustomerId`)
- The property must be accessible (typically `public` with `get` accessor)

## Example: Product Catalog Perspective

**Before (causes WHIZ030)**:
```csharp
// ❌ Missing [StreamKey] attribute
public record ProductCreatedEvent : IEvent {
  public Guid ProductId { get; init; }  // No [StreamKey]!
  public string Name { get; init; } = string.Empty;
}

public record ProductDto {
  [StreamKey]
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
```csharp
// ✅ [StreamKey] added to event
public record ProductCreatedEvent : IEvent {
  [StreamKey]  // Identifies the stream
  public Guid ProductId { get; init; }
  public string Name { get; init; } = string.Empty;
}

public record ProductDto {
  [StreamKey]
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

Without a `[StreamKey]`, the perspective runner cannot:
1. **Extract the stream ID** from events at compile-time (zero reflection)
2. **Group events by stream** for ordered processing
3. **Apply events in order** within each aggregate
4. **Maintain consistency** per aggregate instance

## Related Diagnostics

- **[WHIZ031](whiz031.md)** - Event type has multiple `[StreamKey]` attributes
- **[WHIZ009](whiz009.md)** - Warning for IEvent implementations missing `[StreamKey]` (general case)

## See Also

- [StreamKey Attribute](../attributes/streamkey.md) - Detailed attribute documentation
- [Perspectives](../core-concepts/perspectives.md) - Pure function perspectives with StreamKey
- [PerspectiveRunner Architecture](../core-concepts/perspectives.md#perspectiverunner-architecture) - How runners use StreamKey
