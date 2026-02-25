---
title: Perspectives Guide
version: 1.0.0
category: Core Concepts
order: 3
description: >-
  Master Whizbang Perspectives - pure function event handlers that maintain
  eventually consistent read models optimized for queries
tags: >-
  perspectives, read-models, cqrs, eventual-consistency, event-driven,
  pure-functions, streamkey
codeReferences:
  - src/Whizbang.Core/Perspectives/IPerspectiveFor.cs
  - src/Whizbang.Core/StreamKeyAttribute.cs
  - >-
    samples/ECommerce/ECommerce.BFF.API/Perspectives/ProductCatalogPerspective.cs
  - >-
    samples/ECommerce/ECommerce.BFF.API/Perspectives/InventoryLevelsPerspective.cs
---

# Perspectives Guide

**Perspectives** are pure function event handlers that maintain **read models** (projections) optimized for queries. They embody the "Q" in CQRS (Command Query Responsibility Segregation) - separate models for reading data.

## Core Concept

A Perspective is analogous to a **viewpoint** or **lens through which you see data**:
- **Listens to events** (domain events)
- **Applies events using pure functions** (deterministic, no I/O)
- **Maintains denormalized read models** (optimized for queries)
- **Eventually consistent** (updates happen asynchronously)

**Key Innovation**: Perspectives use **pure functions** for event application, enabling deterministic event replay and reliable read model reconstruction.

---

## IPerspectiveFor Interface

```csharp
namespace Whizbang.Core.Perspectives;

public interface IPerspectiveFor<TModel, TEvent>
    where TModel : notnull
    where TEvent : notnull, IEvent {

    TModel Apply(TModel currentData, TEvent @event);
}
```

**Type Parameters**:
- `TModel`: The read model type (e.g., `ProductDto`)
- `TEvent`: The event type this perspective handles (e.g., `ProductCreatedEvent`)

**Key Characteristics**:
- **Pure function**: Synchronous, deterministic, no I/O or side effects
- **Returns new state**: Doesn't mutate `currentData`, returns new model instance
- **Event replay**: Runner applies events in UUID7 order
- **Unit of work**: All events applied, then model + checkpoint saved once

---

## StreamKey Attribute

The `[StreamKey]` attribute marks the property that identifies the stream/aggregate for event ordering and perspective model identification.

**Required on**:
- **Event types**: Identifies which stream the event belongs to
- **Model types**: Identifies which stream the model represents

**Example**:
```csharp
using Whizbang.Core;

// Event with StreamKey
public record ProductCreatedEvent : IEvent {
    [AggregateId]  // Optional: marks as aggregate identifier
    [StreamKey]    // Required: used for event replay ordering
    public Guid ProductId { get; init; }

    public string Name { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public decimal Price { get; init; }
}

// Model with StreamKey
public record ProductDto {
    [StreamKey]
    public Guid ProductId { get; init; }

    public string Name { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public decimal Price { get; init; }
    public DateTime CreatedAt { get; init; }
}
```

**Diagnostics**:
- **WHIZ030**: Event type must have exactly one property marked with `[StreamKey]`
- **WHIZ031**: Event type has multiple properties marked with `[StreamKey]` (only one allowed)

**Why required?**
- Enables stream-based event replay
- Ensures events are applied to correct model instance
- Supports UUID7-based ordering for deterministic replay

---

## Basic Example

```csharp
using Whizbang.Core;
using Whizbang.Core.Perspectives;

// Event
public record ProductCreatedEvent : IEvent {
    [StreamKey]
    public Guid ProductId { get; init; }
    public string Name { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public decimal Price { get; init; }
    public DateTime CreatedAt { get; init; }
}

// Read Model
public record ProductDto {
    [StreamKey]
    public Guid ProductId { get; init; }
    public string Name { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public decimal Price { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime? UpdatedAt { get; init; }
}

// Perspective (pure function)
public class ProductCatalogPerspective : IPerspectiveFor<ProductDto, ProductCreatedEvent> {
    public ProductDto Apply(ProductDto currentData, ProductCreatedEvent @event) {
        // Pure function: no I/O, no side effects, deterministic
        return new ProductDto {
            ProductId = @event.ProductId,
            Name = @event.Name,
            Description = @event.Description,
            Price = @event.Price,
            CreatedAt = @event.CreatedAt,
            UpdatedAt = null
        };
    }
}
```

**Notice**:
- No database access in `Apply()` - it's a pure function
- Returns new `ProductDto` instance (immutability)
- Deterministic: same input = same output every time

---

## CQRS Pattern

Whizbang implements CQRS with:
- **Write side**: Commands → Receptors → Events → Event Store
- **Read side**: PerspectiveWorker → Runners → Apply() → Read Models

```
┌─────────────── WRITE SIDE ───────────────┐
│                                           │
│  CreateProduct Command                    │
│       ↓                                   │
│  CreateProductReceptor                    │
│       ↓                                   │
│  ProductCreatedEvent → Event Store        │
│                                           │
└───────────────┬───────────────────────────┘
                │
                │ PerspectiveWorker polls for new events
                ↓
┌─────────────── READ SIDE ────────────────┐
│                                           │
│  ProductCreatedEvent (from event store)  │
│       ↓                                   │
│  ProductCatalogPerspectiveRunner         │
│       ↓                                   │
│  perspective.Apply(currentModel, event)  │
│       ↓                                   │
│  IPerspectiveStore.UpsertAsync(model)    │
│       ↓                                   │
│  product_catalog table (denormalized)    │
│       ↓                                   │
│  ProductLens.GetProductAsync() ← Query   │
│                                           │
└───────────────────────────────────────────┘
```

**Benefits**:
- **Optimized reads**: Denormalized data, no joins
- **Scalability**: Read and write databases can scale independently
- **Flexibility**: Multiple read models for different use cases
- **Performance**: Queries are simple, fast lookups
- **Reliability**: Pure functions enable deterministic event replay

---

## PerspectiveRunner Architecture

Whizbang automatically generates `IPerspectiveRunner` implementations for each perspective via source generators.

**What gets generated**:
- Runner class per perspective (e.g., `ProductCatalogPerspectiveRunner`)
- `ExtractStreamId` methods per event type (extracts stream ID from event's `[StreamKey]` property)
- Unit-of-work event replay logic
- Checkpoint management

**How it works**:
1. `PerspectiveWorker` polls `IWorkCoordinator` for streams with new events
2. Worker resolves appropriate runner via `IPerspectiveRunnerRegistry` (zero-reflection, AOT-compatible)
3. Runner loads current model from `IPerspectiveStore<TModel>` (or creates new)
4. Runner applies **all new events** using perspective's pure `Apply()` methods
5. Runner saves model + checkpoint **atomically** (unit of work pattern)

**Generated code example**:
```csharp
// Auto-generated by Whizbang.Generators
internal sealed class ProductCatalogPerspectiveRunner : IPerspectiveRunner {
    private readonly IServiceProvider _serviceProvider;
    private readonly IEventStore _eventStore;
    private readonly IPerspectiveStore<ProductDto> _perspectiveStore;

    public async Task<PerspectiveCheckpointCompletion> RunAsync(
        Guid streamId,
        string perspectiveName,
        Guid? lastProcessedEventId,
        CancellationToken cancellationToken) {

        // Load current model (or create new)
        var currentModel = await _perspectiveStore.GetByStreamIdAsync(streamId, cancellationToken)
            ?? CreateEmptyModel(streamId);

        // Get perspective instance from DI
        var perspective = _serviceProvider.GetRequiredService<ProductCatalogPerspective>();

        // Read events in UUID7 order
        await foreach (var envelope in _eventStore.ReadAsync<IEvent>(streamId, lastProcessedEventId, cancellationToken)) {
            var @event = envelope.Payload;

            // Apply event using perspective's pure Apply method
            currentModel = ApplyEvent(perspective, currentModel, @event);
            lastProcessedEventId = envelope.MessageId.Value;
        }

        // Unit of work: Save model + checkpoint ONCE
        await _perspectiveStore.UpsertAsync(streamId, currentModel, cancellationToken);
        // TODO: Save checkpoint

        return new PerspectiveCheckpointCompletion { /* ... */ };
    }

    // Generated ExtractStreamId method per event type
    private static string ExtractStreamId(ProductCreatedEvent @event) {
        return @event.ProductId.ToString();
    }
}
```

**Benefits**:
- Zero reflection (AOT-compatible)
- Type-safe event handling
- Deterministic replay (pure functions)
- Atomic writes (model + checkpoint together)

---

## Pure Function Pattern

Perspectives use **pure functions** for event application:

**Characteristics**:
- ✅ **Synchronous** (not async) - `TModel Apply()` not `Task<TModel> UpdateAsync()`
- ✅ **Deterministic** - Same input = same output every time
- ✅ **No I/O** - No database calls, no HTTP requests, no file system access
- ✅ **No side effects** - Doesn't mutate arguments or external state
- ✅ **Returns new state** - Creates and returns new model instance
- ✅ **Immutable** - Uses `record` types with `init` properties

**Why pure functions?**
1. **Deterministic replay**: Rebuilding read models from events always produces same result
2. **Easy to test**: No database mocking, no complex setup
3. **Compile-time safety**: Type system enforces purity (future: Roslyn analyzer)
4. **Event sourcing**: Pure functions are perfect for event replay
5. **Debugging**: No hidden state changes, easy to reason about

**Example - Pure vs. Impure**:

```csharp
// ❌ IMPURE: Async I/O, side effects
public class OldPerspective : IPerspectiveOf<ProductCreatedEvent> {
    private readonly IDbConnectionFactory _db;

    public async Task UpdateAsync(ProductCreatedEvent @event, CancellationToken ct) {
        // Direct I/O - not deterministic, can fail, impure
        await using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "INSERT INTO products (...) VALUES (...)",
            @event
        );
    }
}

// ✅ PURE: Synchronous, deterministic, no I/O
public class ProductCatalogPerspective : IPerspectiveFor<ProductDto, ProductCreatedEvent> {
    public ProductDto Apply(ProductDto currentData, ProductCreatedEvent @event) {
        // Pure function: no I/O, deterministic, returns new state
        return new ProductDto {
            ProductId = @event.ProductId,
            Name = @event.Name,
            Price = @event.Price,
            CreatedAt = @event.CreatedAt
        };
    }
}
```

**The runner handles I/O** (not the perspective):
- Perspective: Pure function that computes new state
- Runner: Loads model, calls Apply(), saves result

---

## Multiple Event Types

A single perspective can handle **multiple event types**:

```csharp
public class ProductCatalogPerspective :
    IPerspectiveFor<ProductDto, ProductCreatedEvent>,
    IPerspectiveFor<ProductDto, ProductUpdatedEvent>,
    IPerspectiveFor<ProductDto, ProductDeletedEvent> {

    public ProductDto Apply(ProductDto currentData, ProductCreatedEvent @event) {
        return new ProductDto {
            ProductId = @event.ProductId,
            Name = @event.Name,
            Description = @event.Description,
            Price = @event.Price,
            CreatedAt = @event.CreatedAt,
            UpdatedAt = null,
            DeletedAt = null
        };
    }

    public ProductDto Apply(ProductDto currentData, ProductUpdatedEvent @event) {
        // Partial update: only non-null fields
        return new ProductDto {
            ProductId = currentData.ProductId,
            Name = @event.Name ?? currentData.Name,
            Description = @event.Description ?? currentData.Description,
            Price = @event.Price ?? currentData.Price,
            CreatedAt = currentData.CreatedAt,
            UpdatedAt = @event.UpdatedAt,
            DeletedAt = currentData.DeletedAt
        };
    }

    public ProductDto Apply(ProductDto currentData, ProductDeletedEvent @event) {
        // Soft delete
        return new ProductDto {
            ProductId = currentData.ProductId,
            Name = currentData.Name,
            Description = currentData.Description,
            Price = currentData.Price,
            CreatedAt = currentData.CreatedAt,
            UpdatedAt = currentData.UpdatedAt,
            DeletedAt = @event.DeletedAt
        };
    }
}
```

**Pattern**: One read model, multiple events that update it over time.

**Note**: Maximum 5 event types per perspective (language limitation). For more events, create multiple perspectives targeting the same model.

---

## Multiple Perspectives per Event

One event can update **multiple read models**:

```csharp
// Event published once
public record OrderCreatedEvent : IEvent {
    [StreamKey]
    public Guid OrderId { get; init; }
    public Guid CustomerId { get; init; }
    public OrderLineItem[] Items { get; init; } = [];
    public decimal Total { get; init; }
}

// Perspective 1: Order summary (for customer order history)
public class OrderSummaryPerspective : IPerspectiveFor<OrderSummaryDto, OrderCreatedEvent> {
    public OrderSummaryDto Apply(OrderSummaryDto currentData, OrderCreatedEvent @event) {
        return new OrderSummaryDto {
            OrderId = @event.OrderId,
            CustomerId = @event.CustomerId,
            ItemCount = @event.Items.Length,
            Total = @event.Total,
            Status = "Created"
        };
    }
}

// Perspective 2: Customer activity (for personalization)
public class CustomerActivityPerspective : IPerspectiveFor<CustomerActivityDto, OrderCreatedEvent> {
    public CustomerActivityDto Apply(CustomerActivityDto currentData, OrderCreatedEvent @event) {
        return new CustomerActivityDto {
            CustomerId = @event.CustomerId,
            LastOrderDate = DateTime.UtcNow,
            OrderCount = (currentData?.OrderCount ?? 0) + 1,
            TotalSpent = (currentData?.TotalSpent ?? 0) + @event.Total
        };
    }
}
```

**Result**: Publishing `OrderCreatedEvent` updates **two separate read models** automatically via their respective runners.

---

## Read Model Design

### Denormalization

Read models are **denormalized** for query performance:

**Write Model** (normalized):
```sql
-- Normalized schema (write side)
CREATE TABLE products (
    product_id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE inventory (
    product_id UUID PRIMARY KEY,
    quantity INT NOT NULL,
    reserved INT NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(product_id)
);
```

**Read Model** (denormalized):
```sql
-- Denormalized schema (read side)
CREATE TABLE product_catalog (
    product_id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL,
    quantity INT NOT NULL,              -- Denormalized from inventory
    available INT NOT NULL,              -- Denormalized from inventory
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NULL,
    deleted_at TIMESTAMPTZ NULL
);

-- Simple index for fast lookups
CREATE INDEX idx_product_catalog_created_at ON product_catalog(created_at DESC);
```

**Query Performance**:
```sql
-- ❌ SLOW: Normalized (requires join)
SELECT p.product_id, p.name, p.price, i.quantity, (i.quantity - i.reserved) AS available
FROM products p
JOIN inventory i ON p.product_id = i.product_id
WHERE p.product_id = '...';

-- ✅ FAST: Denormalized (single table lookup)
SELECT product_id, name, price, quantity, available
FROM product_catalog
WHERE product_id = '...';
```

### Multiple Read Models

Different perspectives for different use cases:

```csharp
// Read Model 1: Product catalog (for product listing UI)
public record ProductCatalogDto {
    [StreamKey]
    public Guid ProductId { get; init; }
    public string Name { get; init; } = string.Empty;
    public decimal Price { get; init; }
    public int Available { get; init; }
}

// Read Model 2: Product details (for product detail page)
public record ProductDetailsDto {
    [StreamKey]
    public Guid ProductId { get; init; }
    public string Name { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public decimal Price { get; init; }
    public string? ImageUrl { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime? UpdatedAt { get; init; }
}

// Read Model 3: Inventory levels (for warehouse dashboard)
public record InventoryLevelsDto {
    [StreamKey]
    public Guid ProductId { get; init; }
    public int Quantity { get; init; }
    public int Reserved { get; init; }
    public int Available { get; init; }
    public DateTime LastUpdated { get; init; }
}
```

Each read model has its own **perspective** and **table schema** optimized for its queries.

---

## Dependency Injection

### Registration

**Manual**:
```csharp
// Register perspective (transient recommended)
builder.Services.AddTransient<ProductCatalogPerspective>();

// Register perspective store (scoped - per request)
builder.Services.AddScoped<IPerspectiveStore<ProductDto>, PostgresPerspectiveStore<ProductDto>>();
```

**Auto-Discovery** (with Whizbang.Generators):
```csharp
// Discovers all IPerspectiveFor implementations and registers runners
builder.Services.AddPerspectiveRunners();  // Generated by source generator
```

### Lifetime

**Perspectives**: `Transient` (new instance per Apply call)
- Stateless (no benefit to reusing instances)
- May be created multiple times during batch event replay

**Perspective Stores**: `Scoped` (per unit of work)
- May manage database connections
- Reused across batch of events in same stream

**Runners**: `Transient` (created per RunAsync call)
- Stateless (no shared state between runs)

```csharp
builder.Services.AddTransient<ProductCatalogPerspective>();
builder.Services.AddScoped<IPerspectiveStore<ProductDto>, PostgresPerspectiveStore<ProductDto>>();
```

---

## Testing Perspectives

### Unit Tests (Pure Functions)

```csharp
public class ProductCatalogPerspectiveTests {
    [Test]
    public async Task Apply_ProductCreatedEvent_CreatesNewModelAsync() {
        // Arrange
        var perspective = new ProductCatalogPerspective();
        var currentData = new ProductDto();  // Empty model

        var @event = new ProductCreatedEvent {
            ProductId = Guid.NewGuid(),
            Name = "Test Product",
            Description = "Test Description",
            Price = 19.99m,
            CreatedAt = DateTime.UtcNow
        };

        // Act - pure function, no I/O, no mocking!
        var result = perspective.Apply(currentData, @event);

        // Assert
        await Assert.That(result).IsNotNull();
        await Assert.That(result.ProductId).IsEqualTo(@event.ProductId);
        await Assert.That(result.Name).IsEqualTo("Test Product");
        await Assert.That(result.Price).IsEqualTo(19.99m);
        await Assert.That(currentData.Name).IsEqualTo(string.Empty);  // Not mutated!
    }

    [Test]
    public async Task Apply_Deterministic_SameInputProducesSameOutputAsync() {
        // Arrange
        var perspective = new ProductCatalogPerspective();
        var currentData = new ProductDto { ProductId = Guid.NewGuid() };
        var @event = new ProductUpdatedEvent {
            ProductId = currentData.ProductId,
            Name = "Updated Name",
            Price = 29.99m,
            UpdatedAt = DateTime.UtcNow
        };

        // Act - call Apply multiple times
        var result1 = perspective.Apply(currentData, @event);
        var result2 = perspective.Apply(currentData, @event);

        // Assert - pure function always returns same result
        await Assert.That(result1.Name).IsEqualTo(result2.Name);
        await Assert.That(result1.Price).IsEqualTo(result2.Price);
    }

    [Test]
    public async Task Apply_MultipleEvents_SequentialApplicationAsync() {
        // Arrange
        var perspective = new ProductCatalogPerspective();
        var createEvent = new ProductCreatedEvent {
            ProductId = Guid.NewGuid(),
            Name = "Product",
            Price = 10m,
            CreatedAt = DateTime.UtcNow
        };
        var updateEvent = new ProductUpdatedEvent {
            ProductId = createEvent.ProductId,
            Name = "Updated Product",
            Price = 20m,
            UpdatedAt = DateTime.UtcNow
        };

        // Act - apply events in sequence
        var emptyModel = new ProductDto();
        var afterCreate = perspective.Apply(emptyModel, createEvent);
        var afterUpdate = perspective.Apply(afterCreate, updateEvent);

        // Assert
        await Assert.That(afterUpdate.Name).IsEqualTo("Updated Product");
        await Assert.That(afterUpdate.Price).IsEqualTo(20m);
    }
}
```

**Benefits of testing pure functions**:
- No database mocking required
- No complex setup/teardown
- Fast (no I/O)
- Deterministic (no flaky tests)
- Easy to reason about

---

## Event Sourcing Integration

Perspectives can rebuild from event history (event replay):

```csharp
// Runner automatically handles event replay
public class PerspectiveWorker : BackgroundService {
    protected override async Task ExecuteAsync(CancellationToken ct) {
        while (!ct.IsCancellationRequested) {
            // Poll for streams with new events
            var workBatch = await _workCoordinator.ProcessWorkBatchAsync(...);

            foreach (var perspectiveWork in workBatch.PerspectiveWork) {
                // Resolve runner for this perspective
                var runner = _registry.GetRunner(perspectiveWork.PerspectiveName, _serviceProvider);

                // Runner applies all events since last checkpoint
                var result = await runner.RunAsync(
                    perspectiveWork.StreamId,
                    perspectiveWork.PerspectiveName,
                    perspectiveWork.LastProcessedEventId,  // Checkpoint
                    ct
                );
            }

            await Task.Delay(_options.PollingIntervalMilliseconds, ct);
        }
    }
}
```

**Unit of Work Pattern**:
1. Load current model (or create new)
2. Apply **ALL** events since last checkpoint using pure `Apply()` methods
3. Save model + checkpoint **atomically**

**Use cases**:
- **Rebuild corrupted read models**: Truncate table, replay all events
- **Add new perspectives**: Replay historical events into new read model
- **Time-travel queries**: Rebuild model up to specific point in time
- **Model schema changes**: Replay events into new schema

**Manual rebuild example**:
```csharp
public async Task RebuildProductCatalogAsync(CancellationToken ct) {
    var perspective = new ProductCatalogPerspective();
    var store = _serviceProvider.GetRequiredService<IPerspectiveStore<ProductDto>>();

    // Truncate read model
    await store.TruncateAsync(ct);

    // Replay all events
    await foreach (var envelope in _eventStore.ReadAllAsync<IEvent>(ct)) {
        var streamId = Guid.Parse(ExtractStreamId(envelope.Payload));

        // Load current model for this stream
        var currentModel = await store.GetByStreamIdAsync(streamId, ct)
            ?? CreateEmptyModel(streamId);

        // Apply event
        var updatedModel = ApplyEvent(perspective, currentModel, envelope.Payload);

        // Save updated model
        await store.UpsertAsync(streamId, updatedModel, ct);
    }
}
```

---

## Error Handling

### Pure Functions Don't Throw I/O Errors

Since `Apply()` methods are pure functions with no I/O, they rarely throw exceptions. Common cases:

```csharp
public ProductDto Apply(ProductDto currentData, ProductUpdatedEvent @event) {
    // Defensive: handle null current data
    if (currentData == null) {
        // Treat update as create
        return new ProductDto {
            ProductId = @event.ProductId,
            Name = @event.Name ?? string.Empty,
            Price = @event.Price ?? 0,
            CreatedAt = @event.UpdatedAt
        };
    }

    // Normal update
    return new ProductDto {
        ProductId = currentData.ProductId,
        Name = @event.Name ?? currentData.Name,
        Price = @event.Price ?? currentData.Price,
        CreatedAt = currentData.CreatedAt,
        UpdatedAt = @event.UpdatedAt
    };
}
```

### Runner-Level Error Handling

**Runners** handle I/O errors and implement retry logic:

```csharp
// Generated runner handles errors
public async Task<PerspectiveCheckpointCompletion> RunAsync(...) {
    try {
        // Apply all events
        foreach (var envelope in events) {
            updatedModel = ApplyEvent(perspective, updatedModel, envelope.Payload);
            lastSuccessfulEventId = envelope.MessageId.Value;
        }

        // Save model + checkpoint atomically
        await SaveModelAndCheckpointAsync(streamId, updatedModel, lastSuccessfulEventId, ct);

        return new PerspectiveCheckpointCompletion { Status = Completed };

    } catch (Exception ex) {
        // Partial success: save checkpoint up to last successful event
        if (lastSuccessfulEventId != null) {
            await SaveModelAndCheckpointAsync(streamId, updatedModel, lastSuccessfulEventId.Value, ct);
        }

        throw;  // Let PerspectiveWorker catch and convert to failure
    }
}
```

**Strategies**:
1. **Partial progress**: Save checkpoint up to last successful event
2. **Retry**: Worker retries failed perspective work on next poll
3. **Dead letter**: Log persistent failures for manual review

---

## Best Practices

### DO ✅

- ✅ Make `Apply()` methods **pure functions** (synchronous, deterministic, no I/O)
- ✅ Use `[StreamKey]` on **both events and models**
- ✅ Return **new model instance** from `Apply()` (don't mutate currentData)
- ✅ Use `record` types for immutability
- ✅ Handle null `currentData` defensively
- ✅ Denormalize read models for query performance
- ✅ Create **multiple read models** for different use cases
- ✅ Use **transient lifetime** for perspectives
- ✅ Test `Apply()` methods as pure functions (no database mocking)
- ✅ Index read model tables for fast queries

### DON'T ❌

- ❌ Perform I/O in `Apply()` methods (database, HTTP, file system)
- ❌ Make `Apply()` async (pure functions are synchronous)
- ❌ Mutate `currentData` parameter
- ❌ Store state in perspective instances
- ❌ Forget `[StreamKey]` attribute (will fail at runtime)
- ❌ Use multiple `[StreamKey]` attributes (WHIZ031 error)
- ❌ Perform complex joins in read models (defeats denormalization)
- ❌ Call receptors from perspectives (perspectives are read-only)
- ❌ Throw exceptions for business logic (return appropriate model state)

---

## Further Reading

**Core Concepts**:
- [Dispatcher](dispatcher.md) - How to publish events
- [Lenses](lenses.md) - Query interfaces for read models
- [Receptors](receptors.md) - Command handlers that produce events
- [StreamKey Attribute](../attributes/streamkey.md) - Stream identification

**Source Generators**:
- [Perspective Discovery](../source-generators/perspective-discovery.md) - Auto-discovery and runner generation
- [Diagnostics (WHIZ030/WHIZ031)](../diagnostics/whiz030-whiz031.md) - StreamKey validation

**Data Access**:
- [IPerspectiveStore](../data/perspective-store.md) - Persistence abstraction
- [Perspective Storage](../data/perspectives-storage.md) - Schema design patterns
- [EF Core Integration](../data/efcore-integration.md) - Using EF Core for read models

**Workers**:
- [Perspective Worker](../workers/perspective-worker.md) - Checkpoint processing lifecycle and runtime behavior
- [Execution Lifecycle](../workers/execution-lifecycle.md) - Startup/shutdown coordination
- [Database Readiness](../workers/database-readiness.md) - Dependency coordination

**Examples**:
- [ECommerce: BFF Pattern](../examples/ecommerce/bff-pattern.md) - Real-world perspectives
- [ECommerce: Product Catalog](../examples/ecommerce/product-catalog.md) - Complete example

---

*Version 1.0.0 - Foundation Release | Last Updated: 2025-12-21*
