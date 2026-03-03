---
title: Perspective Association Info
version: 1.0.0
category: Perspectives
order: 4
description: >-
  Type metadata linking perspectives to their models and tracked types for
  source generator discovery
tags: 'perspectives, association, metadata, source-generators, registration'
codeReferences:
  - src/Whizbang.Core/Perspectives/PerspectiveAssociationInfo.cs
  - src/Whizbang.Generators/PerspectiveDiscoveryGenerator.cs
---

# Perspective Association Info

`PerspectiveAssociationInfo` is a metadata structure used by source generators to track the relationship between perspective implementations and their model types. It enables compile-time discovery and runtime registration of perspectives.

## Purpose

The perspective discovery system needs to know:
- Which model type a perspective projects to
- Which event types the perspective handles
- How to construct and invoke the perspective runner

`PerspectiveAssociationInfo` provides this metadata bridge between compile-time analysis and runtime execution.

## Structure

```csharp
namespace Whizbang.Core.Perspectives;

/// <summary>
/// Associates a perspective implementation with its model type and tracked event types.
/// </summary>
/// <remarks>
/// This type is used by source generators to create the mapping between
/// perspectives and their models during perspective discovery.
/// </remarks>
public sealed class PerspectiveAssociationInfo {
  /// <summary>
  /// The perspective type (e.g., OrderSummaryPerspective).
  /// </summary>
  public required Type PerspectiveType { get; init; }

  /// <summary>
  /// The model type this perspective projects to (e.g., OrderSummaryDto).
  /// </summary>
  public required Type ModelType { get; init; }

  /// <summary>
  /// The event types this perspective handles.
  /// </summary>
  public required IReadOnlyList<Type> EventTypes { get; init; }
}
```

## How It Works

### Compile-Time Discovery

The `PerspectiveDiscoveryGenerator` scans for types implementing `IPerspectiveFor<TModel, TEvent>`:

```csharp
// Your code
public class OrderSummaryPerspective :
    IPerspectiveFor<OrderSummaryDto, OrderCreated>,
    IPerspectiveFor<OrderSummaryDto, OrderShipped> {

  public OrderSummaryDto Apply(OrderSummaryDto current, OrderCreated evt) { ... }
  public OrderSummaryDto Apply(OrderSummaryDto current, OrderShipped evt) { ... }
}
```

### Generated Association

The generator creates an association entry:

```csharp
// Auto-generated code
new PerspectiveAssociationInfo {
  PerspectiveType = typeof(OrderSummaryPerspective),
  ModelType = typeof(OrderSummaryDto),
  EventTypes = new[] {
    typeof(OrderCreated),
    typeof(OrderShipped)
  }
}
```

### Runtime Registration

The generated registration code uses this metadata to:

1. Register the perspective runner in `IPerspectiveRunnerRegistry`
2. Register the perspective in DI container
3. Create event subscription mappings

```csharp
// Auto-generated registration
services.AddTransient<OrderSummaryPerspective>();
services.AddTransient<IPerspectiveRunner>(sp =>
  new OrderSummaryPerspectiveRunner(
    sp,
    sp.GetRequiredService<IEventStore>(),
    sp.GetRequiredService<IPerspectiveStore<OrderSummaryDto>>()
  )
);
```

## Generated Components

For each `PerspectiveAssociationInfo`, the generator creates:

### 1. Perspective Runner

```csharp
internal sealed class OrderSummaryPerspectiveRunner : IPerspectiveRunner {
  // Implements event replay logic
  public async Task<PerspectiveCheckpointCompletion> RunAsync(
      Guid streamId,
      string perspectiveName,
      Guid? lastProcessedEventId,
      CancellationToken ct) {
    // Load model, apply events, save checkpoint
  }
}
```

### 2. Registry Entry

```csharp
// In generated PerspectiveRunnerRegistry
registry.Register(
  perspectiveName: "OrderSummaryPerspective",
  factory: sp => new OrderSummaryPerspectiveRunner(...)
);
```

### 3. Event Subscriptions

```csharp
// In generated EventSubscriptionDiscovery
subscriptions.Add(new EventSubscription {
  EventType = typeof(OrderCreated),
  PerspectiveName = "OrderSummaryPerspective"
});
subscriptions.Add(new EventSubscription {
  EventType = typeof(OrderShipped),
  PerspectiveName = "OrderSummaryPerspective"
});
```

## Example Workflow

### Step 1: Define Perspective

```csharp
public class ProductCatalogPerspective :
    IPerspectiveFor<ProductDto, ProductCreated>,
    IPerspectiveFor<ProductDto, ProductUpdated> {

  public ProductDto Apply(ProductDto current, ProductCreated evt) {
    return new ProductDto {
      ProductId = evt.ProductId,
      Name = evt.Name,
      Price = evt.Price
    };
  }

  public ProductDto Apply(ProductDto current, ProductUpdated evt) {
    return current with {
      Name = evt.Name ?? current.Name,
      Price = evt.Price ?? current.Price
    };
  }
}
```

### Step 2: Generator Creates Association

```csharp
// Auto-generated metadata
new PerspectiveAssociationInfo {
  PerspectiveType = typeof(ProductCatalogPerspective),
  ModelType = typeof(ProductDto),
  EventTypes = new[] {
    typeof(ProductCreated),
    typeof(ProductUpdated)
  }
}
```

### Step 3: Generator Creates Runner

```csharp
// Auto-generated runner
internal sealed class ProductCatalogPerspectiveRunner : IPerspectiveRunner {
  public async Task<PerspectiveCheckpointCompletion> RunAsync(...) {
    var perspective = _serviceProvider.GetRequiredService<ProductCatalogPerspective>();
    var model = await _perspectiveStore.GetByStreamIdAsync(streamId, ct)
        ?? CreateEmptyModel(streamId);

    await foreach (var envelope in _eventStore.ReadAsync<IEvent>(streamId, lastProcessedEventId, ct)) {
      model = envelope.Payload switch {
        ProductCreated created => perspective.Apply(model, created),
        ProductUpdated updated => perspective.Apply(model, updated),
        _ => model
      };
    }

    await _perspectiveStore.UpsertAsync(streamId, model, ct);
    return new PerspectiveCheckpointCompletion { ... };
  }
}
```

## Benefits

**Compile-Time Safety**:
- Type errors caught at build time
- No runtime reflection needed

**AOT Compatibility**:
- All associations resolved at compile-time
- Zero runtime type scanning

**Performance**:
- Direct method calls (no reflection)
- Optimal code generation

**Observability**:
- Clear mapping between perspectives and models
- Easy to debug perspective registration

## Diagnostics

The generator emits diagnostics when processing associations:

**WHIZ020**: Perspective discovered
```
info WHIZ020: Discovered perspective 'OrderSummaryPerspective' for model 'OrderSummaryDto' handling 2 event types
```

**WHIZ021**: Multiple perspectives for same model
```
info WHIZ021: Multiple perspectives discovered for model 'OrderSummaryDto': OrderSummaryPerspective, OrderDetailsPerspective
```

## See Also

- [Perspectives Guide](../core-concepts/perspectives.md) - Perspective fundamentals
- [Perspective Discovery](../source-generators/perspective-discovery.md) - Source generator details
- [Perspective Worker](../workers/perspective-worker.md) - Runtime execution
- [Perspective Store](../data/perspective-store.md) - Model persistence

---

*Version 1.0.0 - Foundation Release*
