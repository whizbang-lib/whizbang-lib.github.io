---
title: Perspectives with Actions
version: 1.0.0
category: Core Concepts
order: 5
description: >-
  Soft-delete and purge support for perspectives using IPerspectiveWithActionsFor,
  ApplyResult, and ModelAction to control row lifecycle from pure Apply methods
tags: >-
  perspectives, delete, purge, soft-delete, ApplyResult, ModelAction,
  row-removal
codeReferences:
  - src/Whizbang.Core/Perspectives/IPerspectiveWithActionsFor.cs
  - src/Whizbang.Core/Perspectives/ApplyResult.cs
  - src/Whizbang.Core/Perspectives/ModelAction.cs
---

# Perspectives with Actions

**IPerspectiveWithActionsFor** extends the standard perspective pattern with support for **soft-delete** and **hard-delete (purge)** operations. While `IPerspectiveFor` always returns an updated model, `IPerspectiveWithActionsFor` returns an `ApplyResult<TModel>` that can express deletion semantics alongside normal updates.

## Overview

Standard perspectives (`IPerspectiveFor`) assume every event produces a model update. But real-world systems need to remove read models too:

- **Soft delete**: Mark a row as deleted (set `DeletedAt`) while preserving it for audit queries
- **Hard delete (purge)**: Remove the row from the database entirely when data retention is not required

`IPerspectiveWithActionsFor` solves this by changing the `Apply` return type from `TModel` to `ApplyResult<TModel>`, giving the perspective control over the model's lifecycle.

**When to use**:
- Use `IPerspectiveFor` when events only create or update models
- Use `IPerspectiveWithActionsFor` when events may delete or purge models

---

## IPerspectiveWithActionsFor Interface

```csharp{title="IPerspectiveWithActionsFor Interface" description="Perspective interface that returns ApplyResult for delete/purge support" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "IPerspectiveWithActionsFor", "Interface"]}
namespace Whizbang.Core.Perspectives;

public interface IPerspectiveWithActionsFor<TModel, TEvent> : IPerspectiveWithActionsFor<TModel>
    where TModel : class
    where TEvent : IEvent {

    ApplyResult<TModel> Apply(TModel currentData, TEvent eventData);
}
```

**Type Parameters**:
- `TModel`: The read model type (must be a reference type)
- `TEvent`: The event type this perspective handles

**Key Difference from IPerspectiveFor**: The return type is `ApplyResult<TModel>` instead of `TModel`, enabling the perspective to signal deletion operations.

---

## ApplyResult Struct

`ApplyResult<TModel>` is a readonly struct that pairs an optional model with a `ModelAction`. It provides four static factory methods and three implicit conversions for ergonomic usage.

```csharp{title="ApplyResult Factory Methods" description="Static factory methods for creating ApplyResult instances" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "ApplyResult", "Factory"]}
namespace Whizbang.Core.Perspectives;

public readonly struct ApplyResult<TModel> where TModel : class {
    public TModel? Model { get; }
    public ModelAction Action { get; }

    // Factory methods
    public static ApplyResult<TModel> None();           // No change (skip update)
    public static ApplyResult<TModel> Delete();         // Soft delete (set DeletedAt)
    public static ApplyResult<TModel> Purge();          // Hard delete (remove row)
    public static ApplyResult<TModel> Update(TModel model);  // Update model

    // Implicit conversions
    public static implicit operator ApplyResult<TModel>(TModel model);              // Model -> Update
    public static implicit operator ApplyResult<TModel>(ModelAction action);        // Action -> ApplyResult
    public static implicit operator ApplyResult<TModel>((TModel?, ModelAction) tuple); // Tuple -> ApplyResult
}
```

### Return Type Semantics

| Factory Method | Model | Action | Runner Behavior |
|---|---|---|---|
| `Update(model)` | The updated model | `None` | Upserts the model |
| `None()` | `null` | `None` | Skips update |
| `Delete()` | `null` | `Delete` | Soft delete (sets `DeletedAt`) |
| `Purge()` | `null` | `Purge` | Hard delete (removes row) |

### Implicit Conversions

The implicit conversions let you write concise Apply methods without explicitly constructing `ApplyResult`:

```csharp{title="ApplyResult Implicit Conversions" description="Three implicit conversions for ergonomic ApplyResult usage" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "ApplyResult", "ImplicitConversion"]}
using Whizbang.Core.Perspectives;

public class OrderPerspective : IPerspectiveWithActionsFor<OrderView, OrderUpdated>,
    IPerspectiveWithActionsFor<OrderView, OrderCancelled> {

    // Implicit conversion from TModel -> ApplyResult with None action
    public ApplyResult<OrderView> Apply(OrderView current, OrderUpdated @event) {
        return current with { UpdatedAt = @event.UpdatedAt };
    }

    // Implicit conversion from ModelAction -> ApplyResult with null model
    public ApplyResult<OrderView> Apply(OrderView current, OrderCancelled @event) {
        return ModelAction.Delete;
    }
}
```

---

## ModelAction Enum

`ModelAction` specifies the lifecycle action for a perspective model after an Apply method executes.

```csharp{title="ModelAction Enum" description="Enum controlling perspective model lifecycle: None, Delete (soft), Purge (hard)" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "ModelAction", "Enum"]}
namespace Whizbang.Core.Perspectives;

public enum ModelAction {
    None = 0,    // Keep the model as-is or use the returned model
    Delete = 1,  // Soft delete: set DeletedAt timestamp, row remains
    Purge = 2    // Hard delete: remove the row entirely
}
```

### Delete vs Purge

| | Delete (Soft) | Purge (Hard) |
|---|---|---|
| **Row in database** | Preserved with `DeletedAt` set | Removed entirely |
| **Audit queries** | Queryable via temporal lens | Gone forever |
| **Model requirement** | Must have `DateTimeOffset? DeletedAt` property | No requirement |
| **Use case** | Orders, users, anything needing history | Temporary data, GDPR right-to-erasure |
| **Reversible** | Yes (replay without the delete event) | Yes (rebuild from event store) |

---

## Mixing IPerspectiveFor and IPerspectiveWithActionsFor

A single perspective class can implement **both** `IPerspectiveFor` and `IPerspectiveWithActionsFor` for different event types. This is the recommended pattern: use `IPerspectiveFor` for events that only update, and `IPerspectiveWithActionsFor` for events that may delete.

```csharp{title="Mixed Perspective" description="Perspective mixing IPerspectiveFor (updates) with IPerspectiveWithActionsFor (deletes)" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Perspectives", "Mixed", "IPerspectiveFor", "IPerspectiveWithActionsFor"]}
using Whizbang.Core;
using Whizbang.Core.Perspectives;

// Events
public record OrderCreatedEvent : IEvent {
    [StreamKey]
    public Guid OrderId { get; init; }
    public string CustomerName { get; init; } = string.Empty;
    public decimal Total { get; init; }
    public DateTime CreatedAt { get; init; }
}

public record OrderUpdatedEvent : IEvent {
    [StreamKey]
    public Guid OrderId { get; init; }
    public decimal? Total { get; init; }
    public DateTime UpdatedAt { get; init; }
}

public record OrderCancelledEvent : IEvent {
    [StreamKey]
    public Guid OrderId { get; init; }
    public DateTimeOffset CancelledAt { get; init; }
}

public record OrderPurgedEvent : IEvent {
    [StreamKey]
    public Guid OrderId { get; init; }
}

// Read model
public record OrderView {
    [StreamKey]
    public Guid OrderId { get; init; }
    public string CustomerName { get; init; } = string.Empty;
    public decimal Total { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime? UpdatedAt { get; init; }
    public DateTimeOffset? DeletedAt { get; init; }
}

// Perspective: IPerspectiveFor for updates, IPerspectiveWithActionsFor for deletes
public class OrderPerspective :
    IPerspectiveFor<OrderView, OrderCreatedEvent>,               // Update only
    IPerspectiveFor<OrderView, OrderUpdatedEvent>,               // Update only
    IPerspectiveWithActionsFor<OrderView, OrderCancelledEvent>,  // May soft-delete
    IPerspectiveWithActionsFor<OrderView, OrderPurgedEvent> {    // May hard-delete

    // IPerspectiveFor: returns TModel directly
    public OrderView Apply(OrderView currentData, OrderCreatedEvent @event) {
        return new OrderView {
            OrderId = @event.OrderId,
            CustomerName = @event.CustomerName,
            Total = @event.Total,
            CreatedAt = @event.CreatedAt
        };
    }

    public OrderView Apply(OrderView currentData, OrderUpdatedEvent @event) {
        return currentData with {
            Total = @event.Total ?? currentData.Total,
            UpdatedAt = @event.UpdatedAt
        };
    }

    // IPerspectiveWithActionsFor: returns ApplyResult<TModel>
    public ApplyResult<OrderView> Apply(OrderView currentData, OrderCancelledEvent @event) {
        // Soft delete - mark as deleted, preserve the row
        return ApplyResult<OrderView>.Delete();
    }

    public ApplyResult<OrderView> Apply(OrderView currentData, OrderPurgedEvent @event) {
        // Hard delete - remove the row entirely
        return ApplyResult<OrderView>.Purge();
    }
}
```

**Pattern**: Use `IPerspectiveFor` for create/update events where the model always survives. Switch to `IPerspectiveWithActionsFor` only for events that might remove the model.

---

## Conditional Actions

An Apply method can choose different actions based on event data. This is useful when the same event type might update or delete depending on context.

```csharp{title="Conditional Action" description="Apply method choosing between update and purge based on event data" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Perspectives", "Conditional", "ApplyResult"]}
using Whizbang.Core;
using Whizbang.Core.Perspectives;

public record OrderArchivedEvent : IEvent {
    [StreamKey]
    public Guid OrderId { get; init; }
    public bool ShouldPurge { get; init; }
    public DateTimeOffset ArchivedAt { get; init; }
}

public class ArchivePerspective : IPerspectiveWithActionsFor<OrderView, OrderArchivedEvent> {
    public ApplyResult<OrderView> Apply(OrderView currentData, OrderArchivedEvent @event) {
        if (@event.ShouldPurge) {
            // GDPR erasure request - remove entirely
            return ApplyResult<OrderView>.Purge();
        }

        // Normal archive - update the model with archive timestamp
        return ApplyResult<OrderView>.Update(currentData with {
            DeletedAt = @event.ArchivedAt
        });
    }
}
```

---

## How the Generated Runner Handles Actions

The source-generated `PerspectiveRunner` inspects the `ModelAction` returned by each Apply call and takes the appropriate action at the end of the unit of work.

```
Event Stream:  [Created] → [Updated] → [Cancelled]
                  ↓            ↓            ↓
Apply Result:  model₁       model₂       Delete()
                  ↓            ↓            ↓
Runner State:  upsert       upsert       set pendingDelete
                                              ↓
Unit of Work:              Save model + set DeletedAt + checkpoint
```

**Runner behavior per action**:

1. **`ModelAction.None`** (update): The runner keeps the returned model and continues applying events. At the end of the batch, it upserts the final model and saves the checkpoint atomically.

2. **`ModelAction.Delete`** (soft delete): The runner keeps the model (which may have been updated by the perspective). At save time, the perspective store sets the `DeletedAt` timestamp on the row. The row remains in the database for audit and temporal queries.

3. **`ModelAction.Purge`** (hard delete): The runner sets a `pendingPurge` flag and nulls the model. All remaining events in the batch still advance the checkpoint but skip Apply calls (the model is null). At save time, the runner calls `IPerspectiveStore.PurgeAsync()` to remove the row entirely.

**Important**: Purge is terminal within a batch. Once a purge event is processed, subsequent events in the same batch advance the checkpoint but do not call Apply. If a new "created" event arrives in a later batch, the runner creates a fresh model.

---

## Read Model Requirements

### For Soft Delete

Models that support soft delete must include a `DateTimeOffset? DeletedAt` property:

```csharp{title="Soft Delete Model" description="Read model with DeletedAt property for soft-delete support" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "SoftDelete", "Model"]}
using Whizbang.Core;

public record OrderView {
    [StreamKey]
    public Guid OrderId { get; init; }
    public string CustomerName { get; init; } = string.Empty;
    public decimal Total { get; init; }
    public DateTimeOffset? DeletedAt { get; init; }  // Required for soft delete
}
```

### For Purge

No special model properties are required for purge. The row is removed entirely by `IPerspectiveStore.PurgeAsync()`.

---

## Testing Perspectives with Actions

Testing follows the same pure-function pattern as standard perspectives. No database mocking needed.

```csharp{title="Testing Perspectives with Actions" description="Unit tests for perspectives returning ApplyResult with delete and purge actions" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Perspectives", "Testing", "ApplyResult"]}
using Whizbang.Core.Perspectives;

public class OrderPerspectiveTests {
    [Test]
    public async Task Apply_OrderCancelled_ReturnsSoftDeleteAsync() {
        // Arrange
        var perspective = new OrderPerspective();
        var model = new OrderView {
            OrderId = Guid.NewGuid(),
            CustomerName = "Alice",
            Total = 99.99m
        };
        var @event = new OrderCancelledEvent {
            OrderId = model.OrderId,
            CancelledAt = DateTimeOffset.UtcNow
        };

        // Act
        ApplyResult<OrderView> result = perspective.Apply(model, @event);

        // Assert - soft delete returns null model with Delete action
        await Assert.That(result.Model).IsNull();
        await Assert.That(result.Action).IsEqualTo(ModelAction.Delete);
    }

    [Test]
    public async Task Apply_OrderPurged_ReturnsHardDeleteAsync() {
        // Arrange
        var perspective = new OrderPerspective();
        var model = new OrderView {
            OrderId = Guid.NewGuid(),
            CustomerName = "Bob",
            Total = 50.00m
        };
        var @event = new OrderPurgedEvent { OrderId = model.OrderId };

        // Act
        ApplyResult<OrderView> result = perspective.Apply(model, @event);

        // Assert - hard delete returns null model with Purge action
        await Assert.That(result.Model).IsNull();
        await Assert.That(result.Action).IsEqualTo(ModelAction.Purge);
    }

    [Test]
    public async Task Apply_MixedInterfaces_ChainCorrectlyAsync() {
        // Arrange
        var perspective = new OrderPerspective();
        var empty = new OrderView();

        // Act - chain create, update, then delete
        var afterCreate = perspective.Apply(empty, new OrderCreatedEvent {
            OrderId = Guid.NewGuid(),
            CustomerName = "Carol",
            Total = 75.00m,
            CreatedAt = DateTime.UtcNow
        });

        var afterUpdate = perspective.Apply(afterCreate, new OrderUpdatedEvent {
            OrderId = afterCreate.OrderId,
            Total = 80.00m,
            UpdatedAt = DateTime.UtcNow
        });

        ApplyResult<OrderView> afterCancel = perspective.Apply(afterUpdate, new OrderCancelledEvent {
            OrderId = afterUpdate.OrderId,
            CancelledAt = DateTimeOffset.UtcNow
        });

        // Assert
        await Assert.That(afterCreate.CustomerName).IsEqualTo("Carol");
        await Assert.That(afterUpdate.Total).IsEqualTo(80.00m);
        await Assert.That(afterCancel.Action).IsEqualTo(ModelAction.Delete);
    }

    [Test]
    public async Task Apply_IsPureFunction_OriginalModelUnchangedAsync() {
        // Arrange
        var perspective = new OrderPerspective();
        var original = new OrderView {
            OrderId = Guid.NewGuid(),
            CustomerName = "Dave",
            Total = 100.00m
        };

        // Act
        var result = perspective.Apply(original, new OrderUpdatedEvent {
            OrderId = original.OrderId,
            Total = 200.00m,
            UpdatedAt = DateTime.UtcNow
        });

        // Assert - original not mutated
        await Assert.That(original.Total).IsEqualTo(100.00m);
        await Assert.That(result.Total).IsEqualTo(200.00m);
    }
}
```

---

## Best Practices

### DO

- Use `IPerspectiveFor` for events that always produce a model update
- Use `IPerspectiveWithActionsFor` only for events that may delete
- Include `DateTimeOffset? DeletedAt` on models that support soft delete
- Prefer `Delete()` over `Purge()` unless data retention is explicitly not required
- Use implicit conversions for clean, readable Apply methods
- Test each action type (update, delete, purge) independently

### DON'T

- Don't use `IPerspectiveWithActionsFor` for every event type when only one or two need deletion
- Don't perform I/O in Apply methods (they remain pure functions)
- Don't forget that `Purge` is terminal within a batch (subsequent events skip Apply)
- Don't rely on `Purge` for soft-delete scenarios (use `Delete` to preserve the row)

---

## Further Reading

**Perspectives**:
- [Perspectives Guide](perspectives.md) - Core perspective concepts, IPerspectiveFor, pure functions, and testing
- [Temporal Queries](temporal.md) - Querying soft-deleted models via temporal lenses

**Related Concepts**:
- [Lenses](../lenses/lenses.md) - Query interfaces for read models (including deleted rows)
- [Receptors](../receptors/receptors.md) - Command handlers that produce events leading to deletes
- [Dispatcher](../dispatcher/dispatcher.md) - How to publish delete/purge events

**Source Generators**:
- [Perspective Discovery](../../extending/source-generators/perspective-discovery.md) - How runners are generated for action perspectives

---

*Version 1.0.0 - Foundation Release | Last Updated: 2026-03-26*
