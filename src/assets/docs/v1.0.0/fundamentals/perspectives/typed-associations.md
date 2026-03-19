# GetPerspectiveAssociations: Strongly-Typed Perspective Queries

GetPerspectiveAssociations is a source-generated method that returns strongly-typed perspective associations filtered by model and event type. It provides compile-time type safety and AOT-compatible delegate access to perspective Apply methods.

## Overview

**GetPerspectiveAssociations&lt;TModel, TEvent&gt;** provides:
- ✅ Type-filtered perspective associations
- ✅ Compile-time type checking with generic constraints
- ✅ AOT-compatible delegates (zero reflection)
- ✅ Empty array for non-matching types
- ✅ Source-generated for all discovered perspectives

## Quick Start

### Basic Usage

```csharp
using Whizbang.Core.Generated;

// Get all perspectives handling ProductCreatedEvent for ProductModel
var associations = PerspectiveRegistrationExtensions
    .GetPerspectiveAssociations<ProductModel, ProductCreatedEvent>("ECommerce.BFF.API");

// Iterate and invoke
var model = new ProductModel();
var evt = new ProductCreatedEvent { ProductId = "prod-123" };

foreach (var assoc in associations) {
    Console.WriteLine($"Applying: {assoc.TargetName}");
    model = assoc.ApplyDelegate(model, evt);
}

Console.WriteLine($"Final model: {model}");
```

### Type Safety

```csharp
// Compile-time type safety ensures matching types
var associations = PerspectiveRegistrationExtensions
    .GetPerspectiveAssociations<ProductModel, ProductCreatedEvent>(serviceName);

// Compiler enforces correct types
var productModel = new ProductModel();
var productEvent = new ProductCreatedEvent();

foreach (var assoc in associations) {
    // ✅ Types match - compiles
    productModel = assoc.ApplyDelegate(productModel, productEvent);
}

// ❌ Won't compile - type mismatch
var orderEvent = new OrderCreatedEvent();
productModel = assoc.ApplyDelegate(productModel, orderEvent); // Compiler error!
```

## Method Signature

### Declaration

```csharp
namespace Whizbang.Core.Generated;

public static class PerspectiveRegistrationExtensions {
    /// <summary>
    /// Gets strongly-typed perspective associations with AOT-compatible delegates.
    /// Returns associations only for the specified TModel and TEvent types.
    /// Uses compile-time type checking - no reflection.
    /// </summary>
    /// <typeparam name="TModel">The model type to filter by</typeparam>
    /// <typeparam name="TEvent">The event type to filter by</typeparam>
    /// <param name="serviceName">The service name (assembly name)</param>
    /// <returns>Read-only list of typed perspective associations with delegates</returns>
    public static IReadOnlyList<PerspectiveAssociationInfo<TModel, TEvent>>
        GetPerspectiveAssociations<TModel, TEvent>(string serviceName)
        where TEvent : IEvent;
}
```

### Parameters

- **serviceName**: Service name / assembly name (e.g., "ECommerce.BFF.API")

### Type Parameters

- **TModel**: Model type maintained by perspectives
  - No constraints (can be any type)
  - Must match perspective's `IPerspectiveFor<TModel, TEvent>` first type argument

- **TEvent**: Event type handled by perspectives
  - Must implement `IEvent` interface
  - Must match perspective's `IPerspectiveFor<TModel, TEvent>` second type argument

### Return Value

- Returns `IReadOnlyList<PerspectiveAssociationInfo<TModel, TEvent>>`
- Returns empty list if no perspectives match the specified types
- Never returns null
- List is immutable (read-only)

## Generated Code Structure

### How It Works

The source generator produces compile-time type checks for each perspective:

```csharp
// Generated method (simplified example)
public static IReadOnlyList<PerspectiveAssociationInfo<TModel, TEvent>>
    GetPerspectiveAssociations<TModel, TEvent>(string serviceName)
    where TEvent : IEvent {

    // ProductPerspective: IPerspectiveFor<ProductModel, ProductCreatedEvent>
    if (typeof(TModel) == typeof(ProductModel) &&
        typeof(TEvent) == typeof(ProductCreatedEvent)) {

        return new[] {
            new PerspectiveAssociationInfo<TModel, TEvent>(
                "ECommerce.Contracts.Events.ProductCreatedEvent",
                "ProductPerspective",
                "ECommerce.BFF.API",
                (model, evt) => {
                    var perspective = new ProductPerspective();
                    var typedModel = (ProductModel)((object)model);
                    var typedEvent = (ProductCreatedEvent)((object)evt);
                    var result = perspective.Apply(typedModel, typedEvent);
                    return (TModel)((object)result);
                }
            )
        };
    }

    // OrderPerspective: IPerspectiveFor<OrderModel, OrderCreatedEvent>
    if (typeof(TModel) == typeof(OrderModel) &&
        typeof(TEvent) == typeof(OrderCreatedEvent)) {

        return new[] {
            new PerspectiveAssociationInfo<TModel, TEvent>(
                "ECommerce.Contracts.Events.OrderCreatedEvent",
                "OrderPerspective",
                "ECommerce.BFF.API",
                (model, evt) => {
                    var perspective = new OrderPerspective();
                    var typedModel = (OrderModel)((object)model);
                    var typedEvent = (OrderCreatedEvent)((object)evt);
                    var result = perspective.Apply(typedModel, typedEvent);
                    return (TModel)((object)result);
                }
            )
        };
    }

    // No match - return empty
    return Array.Empty<PerspectiveAssociationInfo<TModel, TEvent>>();
}
```

### AOT Compatibility

Key features ensuring AOT compatibility:

1. **Compile-time type checking**: Uses `typeof()` comparisons
2. **Direct instantiation**: Uses `new` keyword (no `Activator.CreateInstance`)
3. **Direct method calls**: No `MethodInfo.Invoke`
4. **No reflection**: All types known at compile time
5. **Trim-safe**: No dynamic type loading

## Common Scenarios

### Scenario 1: Generic Event Processor

**When**: Building a generic event processing pipeline

```csharp
public class EventProcessor {
    private readonly string _serviceName;

    public EventProcessor(string serviceName) {
        _serviceName = serviceName;
    }

    public TModel ProcessEvent<TModel, TEvent>(TModel model, TEvent evt)
        where TEvent : IEvent {

        // Get associations for this model/event combination
        var associations = PerspectiveRegistrationExtensions
            .GetPerspectiveAssociations<TModel, TEvent>(_serviceName);

        if (!associations.Any()) {
            throw new InvalidOperationException(
                $"No perspectives found for {typeof(TModel).Name} + {typeof(TEvent).Name}"
            );
        }

        // Apply all matching perspectives
        foreach (var assoc in associations) {
            model = assoc.ApplyDelegate(model, evt);
        }

        return model;
    }
}

// Usage
var processor = new EventProcessor("ECommerce.BFF.API");
var updatedProduct = processor.ProcessEvent(productModel, productCreatedEvent);
var updatedOrder = processor.ProcessEvent(orderModel, orderCreatedEvent);
```

### Scenario 2: Event Replay Engine

**When**: Replaying historical events to rebuild state

```csharp
public class EventReplayEngine {
    public async Task<TModel> ReplayAsync<TModel, TEvent>(
        TModel initialModel,
        IAsyncEnumerable<TEvent> events,
        string serviceName)
        where TEvent : IEvent {

        // Get associations once (before loop)
        var associations = PerspectiveRegistrationExtensions
            .GetPerspectiveAssociations<TModel, TEvent>(serviceName);

        if (!associations.Any()) {
            return initialModel; // No perspectives, return unchanged
        }

        var model = initialModel;

        // Replay each event
        await foreach (var evt in events) {
            foreach (var assoc in associations) {
                model = assoc.ApplyDelegate(model, evt);
            }
        }

        return model;
    }
}

// Usage
var replayEngine = new EventReplayEngine();
var events = LoadHistoricalEvents();
var currentState = await replayEngine.ReplayAsync(
    new ProductModel(),
    events,
    "ECommerce.BFF.API"
);
```

### Scenario 3: Multi-Perspective Testing

**When**: Testing that all perspectives handle an event correctly

```csharp
[Test]
public async Task AllPerspectives_HandleProductCreatedEvent_CorrectlyAsync() {
    // Arrange
    var associations = PerspectiveRegistrationExtensions
        .GetPerspectiveAssociations<ProductModel, ProductCreatedEvent>("ECommerce.BFF.API");

    var model = new ProductModel { ProductCount = 0 };
    var evt = new ProductCreatedEvent { ProductId = "prod-123" };

    // Act & Assert - test each perspective
    foreach (var assoc in associations) {
        Console.WriteLine($"Testing perspective: {assoc.TargetName}");

        var result = assoc.ApplyDelegate(model, evt);

        // Verify perspective applied changes
        await Assert.That(result).IsNotEqualTo(model);
        await Assert.That(result.ProductCount).IsGreaterThan(model.ProductCount);

        model = result; // Update for next perspective
    }

    // Final assertion
    await Assert.That(model.ProductCount).IsGreaterThan(0);
}
```

### Scenario 4: Conditional Perspective Application

**When**: Applying perspectives based on runtime conditions

```csharp
public class ConditionalPerspectiveApplier {
    public TModel ApplyWithFilter<TModel, TEvent>(
        TModel model,
        TEvent evt,
        string serviceName,
        Func<PerspectiveAssociationInfo<TModel, TEvent>, bool> filter)
        where TEvent : IEvent {

        var associations = PerspectiveRegistrationExtensions
            .GetPerspectiveAssociations<TModel, TEvent>(serviceName);

        // Apply only perspectives matching filter
        foreach (var assoc in associations.Where(filter)) {
            model = assoc.ApplyDelegate(model, evt);
        }

        return model;
    }
}

// Usage: Apply only specific perspectives
var applier = new ConditionalPerspectiveApplier();
var filtered = applier.ApplyWithFilter(
    productModel,
    productEvent,
    serviceName,
    assoc => assoc.TargetName.Contains("Inventory") // Only inventory perspectives
);
```

### Scenario 5: Performance Monitoring

**When**: Monitoring perspective performance

```csharp
public class MonitoredPerspectiveApplier {
    private readonly ILogger _logger;

    public TModel ApplyWithMonitoring<TModel, TEvent>(
        TModel model,
        TEvent evt,
        string serviceName)
        where TEvent : IEvent {

        var associations = PerspectiveRegistrationExtensions
            .GetPerspectiveAssociations<TModel, TEvent>(serviceName);

        foreach (var assoc in associations) {
            var sw = Stopwatch.StartNew();

            model = assoc.ApplyDelegate(model, evt);

            sw.Stop();
            _logger.LogDebug(
                "Perspective {PerspectiveName} took {ElapsedMs}ms",
                assoc.TargetName,
                sw.ElapsedMilliseconds
            );
        }

        return model;
    }
}
```

## Type Filtering Behavior

### Exact Type Matching

GetPerspectiveAssociations uses exact type matching (not assignable types):

```csharp
// Perspective definition
public class ProductPerspective : IPerspectiveFor<ProductModel, ProductCreatedEvent> {
    public ProductModel Apply(ProductModel model, ProductCreatedEvent evt) {
        // ...
    }
}

// ✅ Exact match - returns association
var associations1 = PerspectiveRegistrationExtensions
    .GetPerspectiveAssociations<ProductModel, ProductCreatedEvent>(serviceName);
// Returns: [ProductPerspective]

// ❌ Base class - no match
var associations2 = PerspectiveRegistrationExtensions
    .GetPerspectiveAssociations<BaseModel, ProductCreatedEvent>(serviceName);
// Returns: [] (empty)

// ❌ Interface - no match
var associations3 = PerspectiveRegistrationExtensions
    .GetPerspectiveAssociations<IModel, ProductCreatedEvent>(serviceName);
// Returns: [] (empty)
```

### Multiple Perspectives

If multiple perspectives handle the same model/event combination, all are returned:

```csharp
// Two perspectives handling ProductModel + ProductCreatedEvent
public class InventoryPerspective : IPerspectiveFor<ProductModel, ProductCreatedEvent> { }
public class CatalogPerspective : IPerspectiveFor<ProductModel, ProductCreatedEvent> { }

var associations = PerspectiveRegistrationExtensions
    .GetPerspectiveAssociations<ProductModel, ProductCreatedEvent>(serviceName);

// Returns: [InventoryPerspective, CatalogPerspective]
Console.WriteLine($"Found {associations.Count} perspectives");

// Apply both
foreach (var assoc in associations) {
    model = assoc.ApplyDelegate(model, evt);
}
```

## Performance Considerations

### Caching Associations

```csharp
// ❌ WRONG: Calling in loop
foreach (var evt in events) {
    var associations = PerspectiveRegistrationExtensions
        .GetPerspectiveAssociations<ProductModel, ProductCreatedEvent>(serviceName);
    // Unnecessary overhead!
}

// ✅ CORRECT: Cache outside loop
var associations = PerspectiveRegistrationExtensions
    .GetPerspectiveAssociations<ProductModel, ProductCreatedEvent>(serviceName);

foreach (var evt in events) {
    foreach (var assoc in associations) {
        model = assoc.ApplyDelegate(model, evt);
    }
}
```

### Compile-Time Optimization

The method uses compile-time type checks, so the JIT compiler can optimize aggressively:

```csharp
// JIT can inline typeof() checks
// Result: Very fast (~1-2ns per call once JIT'd)
var associations = PerspectiveRegistrationExtensions
    .GetPerspectiveAssociations<ProductModel, ProductCreatedEvent>(serviceName);
```

### Delegate Invocation Cost

```csharp
// Delegate invocation is extremely fast
// Approximately 1-2ns per invocation (similar to virtual method call)
var result = assoc.ApplyDelegate(model, evt);

// Compare to reflection: ~100-1000ns per call
// Delegates are 50-500x faster!
```

## Integration with Message Associations

### Complementary APIs

```csharp
// 1. Discovery with MessageAssociation (string-based)
var allAssociations = PerspectiveRegistrationExtensions
    .GetMessageAssociations(serviceName);

var productEvents = allAssociations
    .Where(a => a.TargetName == "ProductPerspective")
    .Select(a => a.MessageType);

Console.WriteLine($"ProductPerspective handles: {string.Join(", ", productEvents)}");

// 2. Invocation with GetPerspectiveAssociations (typed)
var typedAssociations = PerspectiveRegistrationExtensions
    .GetPerspectiveAssociations<ProductModel, ProductCreatedEvent>(serviceName);

foreach (var assoc in typedAssociations) {
    model = assoc.ApplyDelegate(model, evt);
}
```

### Workflow

1. **Discovery**: Use `GetMessageAssociations()` to find available perspectives
2. **Filtering**: Use fuzzy matching and queries to filter
3. **Invocation**: Use `GetPerspectiveAssociations<TModel, TEvent>()` to invoke

## API Reference

### Method Details

**Namespace**: `Whizbang.Core.Generated`

**Class**: `PerspectiveRegistrationExtensions`

**Method**: `GetPerspectiveAssociations<TModel, TEvent>`

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `serviceName` | `string` | Service name / assembly name |

### Type Parameters

| Parameter | Constraints | Description |
|-----------|-------------|-------------|
| `TModel` | None | Model type maintained by perspectives |
| `TEvent` | `where TEvent : IEvent` | Event type handled by perspectives |

### Return Value

| Type | Description |
|------|-------------|
| `IReadOnlyList<PerspectiveAssociationInfo<TModel, TEvent>>` | Immutable list of typed associations |

- **Empty list**: No perspectives match the specified types
- **One or more items**: All perspectives handling TModel + TEvent
- **Never null**: Always returns a list (empty or populated)

## Best Practices

1. **Cache associations outside loops** - Method is fast but caching improves performance
2. **Handle empty results gracefully** - Check `Count` or `Any()` before iterating
3. **Use for type-safe invocation** - Prefer over reflection or dynamic invocation
4. **Combine with MessageAssociation** - Use MessageAssociation for discovery, GetPerspectiveAssociations for invocation
5. **Leverage compile-time safety** - Let compiler enforce type constraints
6. **Monitor performance** - Add logging/metrics to track perspective execution time
7. **Test with multiple perspectives** - Verify behavior when multiple perspectives match

## Common Pitfalls

### ❌ Not Handling Empty Results

```csharp
// ❌ WRONG: Assuming results exist
var associations = PerspectiveRegistrationExtensions
    .GetPerspectiveAssociations<ProductModel, ProductCreatedEvent>(serviceName);

var first = associations.First(); // May throw InvalidOperationException!

// ✅ CORRECT: Check first
if (associations.Any()) {
    var first = associations.First();
} else {
    _logger.LogWarning("No perspectives found for ProductModel + ProductCreatedEvent");
}
```

### ❌ Calling in Hot Paths

```csharp
// ❌ WRONG: Calling repeatedly
public TModel ProcessEvents<TModel, TEvent>(
    TModel model,
    IEnumerable<TEvent> events,
    string serviceName)
    where TEvent : IEvent {

    foreach (var evt in events) {
        var associations = PerspectiveRegistrationExtensions
            .GetPerspectiveAssociations<TModel, TEvent>(serviceName); // Called 1000 times!
        // ...
    }
}

// ✅ CORRECT: Cache before loop
public TModel ProcessEvents<TModel, TEvent>(
    TModel model,
    IEnumerable<TEvent> events,
    string serviceName)
    where TEvent : IEvent {

    var associations = PerspectiveRegistrationExtensions
        .GetPerspectiveAssociations<TModel, TEvent>(serviceName); // Called once!

    foreach (var evt in events) {
        foreach (var assoc in associations) {
            model = assoc.ApplyDelegate(model, evt);
        }
    }

    return model;
}
```

### ❌ Ignoring Type Constraints

```csharp
// ❌ WRONG: Forgetting IEvent constraint
public void ProcessEvent<TModel, TMessage>(TModel model, TMessage message) {
    var associations = PerspectiveRegistrationExtensions
        .GetPerspectiveAssociations<TModel, TMessage>(serviceName);
    // Compiler error: TMessage doesn't have IEvent constraint!
}

// ✅ CORRECT: Add constraint
public void ProcessEvent<TModel, TMessage>(TModel model, TMessage message)
    where TMessage : IEvent {

    var associations = PerspectiveRegistrationExtensions
        .GetPerspectiveAssociations<TModel, TMessage>(serviceName);
}
```

## See Also

- [PerspectiveAssociationInfo](/v1.0.0/core-concepts/perspectives/association-info) - Association record with delegates
- [Perspectives](/v1.0.0/core-concepts/perspectives) - Overview of perspective system
- [Message Associations](/v1.0.0/core-concepts/perspectives#message-associations) - String-based discovery
- [AOT Compatibility](/v1.0.0/advanced-topics/aot-compatibility) - Native AOT support
