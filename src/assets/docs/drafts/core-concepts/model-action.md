---
title: "Model Actions - Perspective Deletion Support"
version: 0.2.0
category: Core Concepts
order: 4
description: "Control perspective model lifecycle with ModelAction - support soft delete, hard delete (purge), and conditional updates in pure Apply methods"
tags: perspectives, deletion, soft-delete, purge, model-action, apply-result, cqrs, read-models
codeReferences:
  - src/Whizbang.Core/Perspectives/ModelAction.cs
  - src/Whizbang.Core/Perspectives/ApplyResult.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveStore.cs
---

# Model Actions - Perspective Deletion Support

**ModelAction** enables perspectives to signal what action should be taken on a model after applying an event. This supports the full lifecycle of read models including creation, updates, soft deletes, and hard deletes (purges).

## Core Concept

When a perspective applies an event, it may need to do more than just update the model:
- **Update** the model with new data (default behavior)
- **Soft delete** the model (set `DeletedAt` timestamp)
- **Hard delete** the model (permanently remove from database)
- **Skip update** when no changes are needed

ModelAction and ApplyResult provide these capabilities while maintaining the **pure function** nature of perspectives.

---

## ModelAction Enum

```csharp
namespace Whizbang.Core.Perspectives;

/// <summary>
/// Specifies what action to take on a perspective model after Apply.
/// </summary>
public enum ModelAction {
  /// <summary>No action - keep model as-is or use returned model.</summary>
  None = 0,

  /// <summary>Soft delete - set DeletedAt timestamp on model.</summary>
  Delete = 1,

  /// <summary>Hard delete - remove model from database entirely.</summary>
  Purge = 2
}
```

**Action Semantics**:
- `None`: Standard behavior - upsert the returned model (or keep existing if null)
- `Delete`: Soft delete - model remains in database with `DeletedAt` timestamp set
- `Purge`: Hard delete - model is permanently removed from database

---

## Return Type Patterns

Perspectives support multiple return types from `Apply()` methods, each suited to different scenarios:

### Pattern 1: `TModel` (Standard Update)

Returns a model - always upserts.

```csharp
public class OrderPerspective : IPerspectiveFor<OrderView, OrderCreated> {
    public OrderView Apply(OrderView? current, OrderCreated @event) {
        return new OrderView {
            OrderId = @event.OrderId,
            Status = "Created",
            CreatedAt = @event.Timestamp
        };
    }
}
```

**Use when**: Every event results in a model update.

### Pattern 2: `TModel?` (Conditional Update)

Returns nullable model - `null` means "no change, keep existing".

```csharp
public class OrderPerspective : IPerspectiveFor<OrderView, OrderStatusChecked> {
    public OrderView? Apply(OrderView current, OrderStatusChecked @event) {
        // Only update if status actually changed
        if (current.Status == @event.NewStatus) {
            return null;  // No change - skip upsert
        }

        return current with { Status = @event.NewStatus };
    }
}
```

**Use when**: Some events may not require updates.

### Pattern 3: `ModelAction` (Delete/Purge Only)

Returns action without model data.

```csharp
public class OrderPerspective : IPerspectiveFor<OrderView, OrderCancelled> {
    public ModelAction Apply(OrderView current, OrderCancelled @event) {
        return ModelAction.Delete;  // Soft delete
    }
}

public class OrderPerspective : IPerspectiveFor<OrderView, OrderPurged> {
    public ModelAction Apply(OrderView current, OrderPurged @event) {
        return ModelAction.Purge;  // Hard delete - remove from database
    }
}
```

**Use when**: Event signals deletion without data changes.

### Pattern 4: `(TModel?, ModelAction)` Tuple (Hybrid)

Returns both model and action for full control.

```csharp
public class OrderPerspective : IPerspectiveFor<OrderView, OrderArchived> {
    public (OrderView?, ModelAction) Apply(OrderView current, OrderArchived @event) {
        if (@event.PermanentDelete) {
            return (null, ModelAction.Purge);  // Hard delete
        }

        // Update then soft delete
        var updated = current with { ArchivedAt = @event.ArchivedAt };
        return (updated, ModelAction.Delete);
    }
}
```

**Use when**: Event conditionally determines action, or you need to update before deleting.

### Pattern 5: `ApplyResult<TModel>` (Full Flexibility)

Unified wrapper with factory methods and implicit conversions.

```csharp
public class OrderPerspective : IPerspectiveFor<OrderView, OrderEvent> {
    public ApplyResult<OrderView> Apply(OrderView current, OrderEvent @event) {
        return @event switch {
            OrderCreated e => ApplyResult<OrderView>.Update(new OrderView { OrderId = e.OrderId }),
            OrderCancelled _ => ApplyResult<OrderView>.Delete(),
            OrderPurged _ => ApplyResult<OrderView>.Purge(),
            OrderNoOp _ => ApplyResult<OrderView>.None(),
            _ => current  // Implicit conversion from TModel
        };
    }
}
```

**Use when**: Complex event handling with multiple outcomes.

---

## ApplyResult Struct

```csharp
namespace Whizbang.Core.Perspectives;

/// <summary>
/// Result of applying an event to a perspective, containing optional model and action.
/// </summary>
public readonly struct ApplyResult<TModel> where TModel : class {
    public TModel? Model { get; }
    public ModelAction Action { get; }

    public ApplyResult(TModel? model, ModelAction action = ModelAction.None) {
        Model = model;
        Action = action;
    }

    // Factory methods
    public static ApplyResult<TModel> None() => new(null, ModelAction.None);
    public static ApplyResult<TModel> Delete() => new(null, ModelAction.Delete);
    public static ApplyResult<TModel> Purge() => new(null, ModelAction.Purge);
    public static ApplyResult<TModel> Update(TModel model) => new(model, ModelAction.None);

    // Implicit conversions for clean syntax
    public static implicit operator ApplyResult<TModel>(TModel model) => new(model);
    public static implicit operator ApplyResult<TModel>(ModelAction action) => new(null, action);
    public static implicit operator ApplyResult<TModel>((TModel?, ModelAction) tuple) => new(tuple.Item1, tuple.Item2);
}
```

**Factory Methods**:
- `ApplyResult<T>.None()` - No change, keep existing model
- `ApplyResult<T>.Delete()` - Soft delete the model
- `ApplyResult<T>.Purge()` - Hard delete the model
- `ApplyResult<T>.Update(model)` - Update with new model

**Implicit Conversions**:
```csharp
// All of these work:
ApplyResult<OrderView> result1 = new OrderView { OrderId = id };           // From TModel
ApplyResult<OrderView> result2 = ModelAction.Delete;                        // From ModelAction
ApplyResult<OrderView> result3 = (updatedModel, ModelAction.None);          // From tuple
```

---

## Soft Delete vs Hard Delete

### Soft Delete (`ModelAction.Delete`)

Model remains in database with `DeletedAt` timestamp:

```csharp
// Model must have DeletedAt property
public record OrderView {
    [StreamKey]
    public Guid OrderId { get; init; }
    public string Status { get; init; } = string.Empty;
    public DateTimeOffset? DeletedAt { get; init; }  // Required for soft delete
}

// Perspective signals soft delete
public class OrderPerspective : IPerspectiveFor<OrderView, OrderCancelled> {
    public (OrderView, ModelAction) Apply(OrderView current, OrderCancelled @event) {
        // Set DeletedAt and signal Delete action
        var deleted = current with { DeletedAt = @event.CancelledAt };
        return (deleted, ModelAction.Delete);
    }
}
```

**Result**: Model row updated with `deleted_at` timestamp. Lenses can filter out deleted records.

### Hard Delete (`ModelAction.Purge`)

Model is permanently removed from database:

```csharp
public class OrderPerspective : IPerspectiveFor<OrderView, OrderPurged> {
    public ModelAction Apply(OrderView current, OrderPurged @event) {
        return ModelAction.Purge;  // Row deleted from database
    }
}
```

**Result**: Model row physically deleted. Use for GDPR compliance, data retention policies, or test cleanup.

---

## IPerspectiveStore.PurgeAsync

The perspective store provides the `PurgeAsync` method for hard deletes:

```csharp
public interface IPerspectiveStore<TModel> where TModel : class {
    // ... other methods ...

    /// <summary>
    /// Hard deletes (purges) a model by removing it from the store entirely.
    /// This is a permanent deletion - the row is physically removed from the database.
    /// </summary>
    Task PurgeAsync(Guid streamId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Hard deletes (purges) a model by partition key, removing it from the store entirely.
    /// </summary>
    Task PurgeByPartitionKeyAsync<TPartitionKey>(
        TPartitionKey partitionKey,
        CancellationToken cancellationToken = default)
        where TPartitionKey : notnull;
}
```

**Idempotent**: Purging a non-existent model does not throw - it's a no-op.

---

## Generated Runner Behavior

The source-generated perspective runner handles all return types and actions:

```csharp
// Generated code (simplified)
var (appliedModel, action) = ApplyEvent(perspective, updatedModel, @event);

switch (action) {
    case ModelAction.Delete:
        // Soft delete: keep model (may have DeletedAt set by perspective)
        updatedModel = appliedModel ?? updatedModel;
        break;

    case ModelAction.Purge:
        // Hard delete: mark for purge, skip upsert
        pendingPurge = true;
        updatedModel = null;
        break;

    default:
        // Normal update or no-change
        if (appliedModel != null) {
            updatedModel = appliedModel;
        }
        // null model with None = no change, keep existing
        break;
}

// At end of batch...
if (pendingPurge) {
    await _perspectiveStore.PurgeAsync(streamId, cancellationToken);
} else if (updatedModel != null) {
    await _perspectiveStore.UpsertAsync(streamId, updatedModel, cancellationToken);
}
```

**Unit of Work**: Actions are batched - all events applied, then single save/purge at end.

---

## Complete Example

```csharp
using Whizbang.Core;
using Whizbang.Core.Perspectives;

// Events
public record OrderCreated([property: StreamKey] Guid OrderId, string CustomerId) : IEvent;
public record OrderShipped([property: StreamKey] Guid OrderId, DateTime ShippedAt) : IEvent;
public record OrderCancelled([property: StreamKey] Guid OrderId, DateTime CancelledAt) : IEvent;
public record OrderDeleted([property: StreamKey] Guid OrderId) : IEvent;

// Read Model
public record OrderView {
    [StreamKey]
    public Guid OrderId { get; init; }
    public string CustomerId { get; init; } = string.Empty;
    public string Status { get; init; } = string.Empty;
    public DateTime? ShippedAt { get; init; }
    public DateTimeOffset? DeletedAt { get; init; }
}

// Perspective handling all event types
public class OrderPerspective :
    IPerspectiveFor<OrderView, OrderCreated>,
    IPerspectiveFor<OrderView, OrderShipped>,
    IPerspectiveFor<OrderView, OrderCancelled>,
    IPerspectiveFor<OrderView, OrderDeleted> {

    // Creation - returns model
    public OrderView Apply(OrderView? current, OrderCreated @event) {
        return new OrderView {
            OrderId = @event.OrderId,
            CustomerId = @event.CustomerId,
            Status = "Created"
        };
    }

    // Update - returns model
    public OrderView Apply(OrderView current, OrderShipped @event) {
        return current with {
            Status = "Shipped",
            ShippedAt = @event.ShippedAt
        };
    }

    // Soft delete - returns tuple (model with DeletedAt, Delete action)
    public (OrderView, ModelAction) Apply(OrderView current, OrderCancelled @event) {
        var deleted = current with {
            Status = "Cancelled",
            DeletedAt = @event.CancelledAt
        };
        return (deleted, ModelAction.Delete);
    }

    // Hard delete - returns action only
    public ModelAction Apply(OrderView current, OrderDeleted @event) {
        return ModelAction.Purge;
    }
}
```

---

## Migration from Marten's ShouldDelete

If migrating from Marten projections with `ShouldDelete`:

**Marten**:
```csharp
public class OrderProjection : SingleStreamProjection<OrderView> {
    public OrderView Create(OrderCreated @event) => new() { OrderId = @event.OrderId };

    public bool ShouldDelete(OrderCancelled @event) => true;  // Soft delete pattern

    public bool ShouldDelete(OrderDeleted @event, OrderView view) => true;
}
```

**Whizbang**:
```csharp
public class OrderPerspective :
    IPerspectiveFor<OrderView, OrderCreated>,
    IPerspectiveFor<OrderView, OrderCancelled>,
    IPerspectiveFor<OrderView, OrderDeleted> {

    public OrderView Apply(OrderView? current, OrderCreated @event) {
        return new OrderView { OrderId = @event.OrderId };
    }

    // ShouldDelete → ModelAction.Delete
    public ModelAction Apply(OrderView current, OrderCancelled @event) {
        return ModelAction.Delete;
    }

    // For hard delete (if Marten was actually deleting rows):
    public ModelAction Apply(OrderView current, OrderDeleted @event) {
        return ModelAction.Purge;
    }
}
```

---

## Best Practices

### DO

- Use `ModelAction.Delete` for soft deletes (preserves audit trail)
- Use `ModelAction.Purge` for GDPR/data retention compliance
- Return `null` with `ModelAction.None` to skip unnecessary upserts
- Add `DateTimeOffset? DeletedAt` property to models that support soft delete
- Test deletion scenarios in unit tests (pure functions, no mocking needed)

### DON'T

- Use `Purge` when you need audit history (soft delete instead)
- Forget to set `DeletedAt` on the model when using `Delete` action
- Mix deletion logic with complex updates (keep Apply methods focused)
- Call `PurgeAsync` directly from perspectives (runner handles this)

---

## Further Reading

- [Perspectives Guide](perspectives.md) - Core perspective concepts and pure functions
- [IPerspectiveStore](../data/perspective-store.md) - Storage abstraction including PurgeAsync
- [Perspective Discovery](../source-generators/perspective-discovery.md) - Generator details
- [Marten Migration Guide](../migration/marten-to-whizbang.md) - ShouldDelete migration patterns

---

*Version 0.2.0 - Draft | Last Updated: 2026-01-20*
