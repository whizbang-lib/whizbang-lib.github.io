---
title: Perspectives with Actions
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Core Concepts
order: 5
description: >-
  Soft-delete and purge support for perspectives using IPerspectiveWithActionsFor,
  ApplyResult, and ModelAction to control row lifecycle from pure Apply methods
tags: >-
  perspectives, delete, purge, soft-delete, ApplyResult, ModelAction,
  row-removal, resurrect, purge-marker
codeReferences:
  - src/Whizbang.Core/Perspectives/IPerspectiveWithActionsFor.cs
  - src/Whizbang.Core/Perspectives/ApplyResult.cs
  - src/Whizbang.Core/Perspectives/ModelAction.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveStore.cs
  - src/Whizbang.Core/Perspectives/IPerspectivePurgeMarkerStore.cs
  - src/Whizbang.Data.Postgres/PostgresPerspectivePurgeMarkerStore.cs
  - src/Whizbang.Core/Perspectives/PerspectiveRowWriteGuard.cs
  - src/Whizbang.Core/Perspectives/ApplyContext.cs
  - src/Whizbang.Generators/PerspectiveCurrentModelAnalyzer.cs
  - src/Whizbang.Generators/Analyzers/PerspectiveContractAnalyzer.cs
  - src/Whizbang.Data.Postgres/Migrations/264_DrainSaysWhichEventIsFirstInItsStream.sql
testReferences:
  - tests/Whizbang.Core.Tests/Perspectives/IPerspectiveWithActionsForTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/ApplyResultTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/ModelActionTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/PurgeStaysPurgedTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/PerspectivePurgeMarkerStoreTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/DeclinedStreamLeavesNoRowTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/PerspectiveRowWriteGuardTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveRunnerTemplateInvariantTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/ApplyContextTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/FirstEventInStreamTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/FirstEventInStreamReadTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveCurrentModelAnalyzerTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveWithActionsArityTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveApplyReturnShapeTests.cs
  - tests/Whizbang.Generators.Tests/PerspectiveDuplicateApplyTests.cs
lastMaintainedCommit: '01f07906'
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

```csharp{title="IPerspectiveWithActionsFor Interface" description="Perspective interface that returns ApplyResult for delete/purge support" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "IPerspectiveWithActionsFor", "Interface"] tests=["IPerspectiveWithActionsForTests.Interface_EnforcesApplyResultReturnTypeAsync"]}
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

### Up to 50 events per implementation {#arity}

:::updated
`IPerspectiveWithActionsFor` takes up to **50** events per implementation, the same as `IPerspectiveFor` (it stopped at
10), so moving an event that may delete or purge into it never meets a smaller cap.
:::

`IPerspectiveWithActionsFor<TModel, TEvent1, ..., TEvent50>` declares one `ApplyResult<TModel> Apply` per event, and a
perspective may implement it any number of times, beside any number of `IPerspectiveFor` implementations. See
[the interfaces are the contract](perspectives.md#strongly-typed-contract).

{verified: PerspectiveWithActionsArityTests.BothFamilies_TakeUpToFiftyEvents_AndNoMoreAsync}

---

## ApplyResult Struct

`ApplyResult<TModel>` is a readonly struct that pairs an optional model with a `ModelAction`. It provides five static factory methods and three implicit conversions for ergonomic usage.

```csharp{title="ApplyResult Factory Methods" description="Static factory methods for creating ApplyResult instances" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "ApplyResult", "Factory"] tests=["ApplyResultTests.ApplyResult_None_ReturnsNullModelWithNoneActionAsync", "ApplyResultTests.ApplyResult_Delete_ReturnsNullModelWithDeleteActionAsync", "ApplyResultTests.ApplyResult_Purge_ReturnsNullModelWithPurgeActionAsync", "ApplyResultTests.ApplyResult_Update_ReturnsModelWithNoneActionAsync", "ApplyResultTests.ApplyResult_Resurrect_ReturnsModelWithResurrectActionAsync"]}
namespace Whizbang.Core.Perspectives;

public readonly struct ApplyResult<TModel> where TModel : class {
    public TModel? Model { get; }
    public ModelAction Action { get; }

    // Factory methods
    public static ApplyResult<TModel> None();           // No change (skip update)
    public static ApplyResult<TModel> Delete();         // Soft delete (row preserved)
    public static ApplyResult<TModel> Purge();          // Hard delete (remove row)
    public static ApplyResult<TModel> Update(TModel model);  // Update model
    public static ApplyResult<TModel> Resurrect(TModel model);  // Recreate a purged row

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
| `Delete()` | `null` | `Delete` | Soft delete (row preserved; see below). On a stream with no row it is a no-op |
| `Purge()` | `null` | `Purge` | Hard delete (removes row); later events on the stream are skipped |
| `Resurrect(model)` | The new model | `Resurrect` | Recreates a purged row and forgets the purge; an ordinary update otherwise |

### Implicit Conversions

The implicit conversions let you write concise Apply methods without explicitly constructing `ApplyResult`:

```csharp{title="ApplyResult Implicit Conversions" description="Three implicit conversions for ergonomic ApplyResult usage" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "ApplyResult", "ImplicitConversion"] tests=["IPerspectiveWithActionsForTests.Apply_ReturningModel_HasImplicitConversionToApplyResultAsync", "IPerspectiveWithActionsForTests.Apply_ModelActionImplicitConversion_WorksAsync", "ApplyResultTests.ApplyResult_ImplicitConversion_FromModel_WorksAsync", "ApplyResultTests.ApplyResult_ImplicitConversion_FromModelAction_WorksAsync"]}
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

```csharp{title="ModelAction Enum" description="Enum controlling perspective model lifecycle: None, Delete (soft), Purge (hard)" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "ModelAction", "Enum"] tests=["ModelActionTests.ModelAction_None_HasValueZeroAsync", "ModelActionTests.ModelAction_Delete_HasValueOneAsync", "ModelActionTests.ModelAction_Purge_HasValueTwoAsync", "ModelActionTests.ModelAction_Resurrect_HasValueThreeAsync", "ModelActionTests.ModelAction_HasFourValuesAsync"]}
namespace Whizbang.Core.Perspectives;

public enum ModelAction {
    None = 0,      // Keep the model as-is or use the returned model
    Delete = 1,    // Soft delete: row remains (set DeletedAt on the model yourself)
    Purge = 2,     // Hard delete: remove the row entirely; it stays removed
    Resurrect = 3  // Recreate a purged row with the returned model
}
```

### Delete vs Purge

| | Delete (Soft) | Purge (Hard) |
|---|---|---|
| **Row in database** | Preserved (set `DeletedAt` on the model in `Apply`) | Removed entirely |
| **Audit queries** | Queryable via temporal lens | Gone forever |
| **Model requirement** | Convention: a `DateTimeOffset? DeletedAt` property your `Apply` sets | No requirement |
| **Use case** | Orders, users, anything needing history | Temporary data, GDPR right-to-erasure |
| **Reversible** | Yes (replay without the delete event) | Only by an event whose Apply returns `Resurrect` (see [Purge stays purged](#purge-stays-purged)) |

---

## Mixing IPerspectiveFor and IPerspectiveWithActionsFor

A single perspective class can implement **both** `IPerspectiveFor` and `IPerspectiveWithActionsFor` for different event types. This is the recommended pattern: use `IPerspectiveFor` for events that only update, and `IPerspectiveWithActionsFor` for events that may delete.

```csharp{title="Mixed Perspective" description="Perspective mixing IPerspectiveFor (updates) with IPerspectiveWithActionsFor (deletes)" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Perspectives", "Mixed", "IPerspectiveFor", "IPerspectiveWithActionsFor"] tests=["IPerspectiveWithActionsForTests.MixedPerspective_BothInterfaceTypes_WorkTogetherAsync", "IPerspectiveWithActionsForTests.MixedPerspective_IPerspectiveFor_ReturnsTModelAsync", "IPerspectiveWithActionsForTests.MixedPerspective_IPerspectiveWithActionsFor_ReturnsApplyResultAsync"]}
using Whizbang.Core;
using Whizbang.Core.Perspectives;

// Events
public record OrderCreatedEvent : IEvent {
    [StreamId]
    public Guid OrderId { get; init; }
    public string CustomerName { get; init; } = string.Empty;
    public decimal Total { get; init; }
    public DateTime CreatedAt { get; init; }
}

public record OrderUpdatedEvent : IEvent {
    [StreamId]
    public Guid OrderId { get; init; }
    public decimal? Total { get; init; }
    public DateTime UpdatedAt { get; init; }
}

public record OrderCancelledEvent : IEvent {
    [StreamId]
    public Guid OrderId { get; init; }
    public DateTimeOffset CancelledAt { get; init; }
}

public record OrderPurgedEvent : IEvent {
    [StreamId]
    public Guid OrderId { get; init; }
}

// Read model
public record OrderView {
    [StreamId]
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

### Purging from a perspective that also returns models {#purge-beside-models}

A perspective whose events mostly return the model, and one or two of which must purge or delete the row, implements
**both** families: `IPerspectiveFor` for the events that return the model, and `IPerspectiveWithActionsFor` for the ones
that may purge or delete. Each event's `Apply` returns what the interface listing it declares. The purge itself stays one
line, because `ApplyResult<TModel>` converts implicitly from `ModelAction` (and from the model, and from the
`(TModel?, ModelAction)` tuple):

```csharp{title="Purge beside model-returning events" description="OrderPlaced returns the model through IPerspectiveFor; OrderStatusChanged returns ApplyResult through IPerspectiveWithActionsFor, and ModelAction.Purge converts implicitly" framework="NET10" category="Perspectives" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Purge", "ApplyResult", "ModelAction"] tests=["PerspectiveRunnerInterfaceDispatchTests.EachEvent_IsAppliedThroughTheInterfaceThatListsItAsync", "IPerspectiveWithActionsForTests.Apply_ModelActionImplicitConversion_WorksAsync"]}
public class OrderProjection :
    IPerspectiveFor<Order, OrderPlaced>,
    IPerspectiveWithActionsFor<Order, OrderStatusChanged> {
  public Order Apply(Order current, OrderPlaced @event) => current with { Id = @event.OrderId };

  public ApplyResult<Order> Apply(Order current, OrderStatusChanged @event) => ModelAction.Purge;
}
```

Do **not** return a bare `ModelAction`, or the tuple, from an `Apply` for an event `IPerspectiveFor` lists. That method is
not the interface's `Apply`, so it compiles only beside an explicit `Order Apply` implementation, and the explicit one is
what the runner calls: the row is kept. The build reports both methods
([WHIZ115](../../operations/diagnostics/whiz115), [WHIZ114](../../operations/diagnostics/whiz114)).

{verified: PerspectiveApplyReturnShapeTests.ABareModelActionReturn_ForAnIPerspectiveForEvent_IsAnErrorNamingTheFixAsync, PerspectiveApplyReturnShapeTests.AShapeOnlyASuppressedWhiz115Allows_IsNeverWhatTheRunnerCallsAsync, PerspectiveDuplicateApplyTests.TheApplyBesideAnExplicitInterfaceApply_IsAnErrorAtTheOneThatNeverRunsAsync}

### Upgrading to the contract {#upgrading-to-the-contract}

:::updated
**Upgrading:** code that returns a shape no interface declares for its event (a bare `ModelAction`, the
`(TModel?, ModelAction)` tuple, or `ApplyResult<TModel>` for an event only `IPerspectiveFor` lists), or that keeps an
explicit `Apply` beside another `Apply` for the same event, now fails to build with [WHIZ115](../../operations/diagnostics/whiz115)
and [WHIZ114](../../operations/diagnostics/whiz114). An event listed only through a custom `IPerspectiveBase` marker fails
with [WHIZ117](../../operations/diagnostics/whiz117). To migrate:

1. List each such event under `IPerspectiveWithActionsFor<TModel, ...>` (beside the class's `IPerspectiveFor`
   implementations; one class may implement both, each any number of times).
2. Change its `Apply` to return `ApplyResult<TModel>`. The body usually does not change: `return ModelAction.Purge;`
   and `return (current, ModelAction.Delete);` convert implicitly.
3. Delete the explicit implementation that existed only so the class compiled.
:::

```csharp{title="Before: two Apply methods for one event, which no longer builds" description="A ModelAction Apply for an IPerspectiveFor event, compiled only beside an explicit Order Apply that the runner calls instead" framework="NET10" category="Perspectives" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Upgrade", "WHIZ115", "WHIZ114"] tests=["PerspectiveApplyReturnShapeTests.ABareModelActionReturn_ForAnIPerspectiveForEvent_IsAnErrorNamingTheFixAsync", "PerspectiveDuplicateApplyTests.TheApplyBesideAnExplicitInterfaceApply_IsAnErrorAtTheOneThatNeverRunsAsync"]}
public class OrderProjection : IPerspectiveFor<Order, OrderPlaced, OrderStatusChanged> {
  public Order Apply(Order current, OrderPlaced @event) => current;

  // WHIZ115 and WHIZ114: never runs, because the runner calls the explicit implementation below
  public ModelAction Apply(Order current, OrderStatusChanged @event) => ModelAction.Purge;

  // The interface's implementation: the Apply the runner calls, and it keeps the row
  Order IPerspectiveFor<Order, OrderPlaced, OrderStatusChanged>.Apply(Order current, OrderStatusChanged @event) =>
    current;
}
```

```csharp{title="After: the event listed under IPerspectiveWithActionsFor" description="The purging event moves to IPerspectiveWithActionsFor, its Apply returns ApplyResult, and the explicit implementation is gone" framework="NET10" category="Perspectives" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "Upgrade", "ApplyResult"] tests=["PerspectiveRunnerInterfaceDispatchTests.EachEvent_IsAppliedThroughTheInterfaceThatListsItAsync"]}
public class OrderProjection :
    IPerspectiveFor<Order, OrderPlaced>,
    IPerspectiveWithActionsFor<Order, OrderStatusChanged> {
  public Order Apply(Order current, OrderPlaced @event) => current;

  public ApplyResult<Order> Apply(Order current, OrderStatusChanged @event) => ModelAction.Purge;
}
```

The runner and the typed appliers from
[`GetPerspectiveAssociations`](typed-associations.md#apply-through-the-interface) call `Apply` through the interface, so
the interface's implementation is the one that runs, and the build errors keep a second `Apply` for the same event from
looking like the handler.

---

## Conditional Actions

An Apply method can choose different actions based on event data. This is useful when the same event type might update or delete depending on context.

```csharp{title="Conditional Action" description="Apply method choosing between update and purge based on event data" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Perspectives", "Conditional", "ApplyResult"] unverified="domain ArchivePerspective illustrating conditional purge-or-update branching, no dedicated test"}
using Whizbang.Core;
using Whizbang.Core.Perspectives;

public record OrderArchivedEvent : IEvent {
    [StreamId]
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
Runner State:  track        track        keep model, mark written
                                              ↓
Unit of Work:              Save final model + checkpoint ONCE
```

:::updated
Shipped behavior: `ModelAction.Delete` does **not** automatically stamp `DeletedAt`. The runner keeps the model returned by the perspective (or the prior model when `Delete()` returns null) and upserts it at the end of the batch. To record a tombstone timestamp, set `DeletedAt` on the model yourself — either in the `Apply` method via `Update(current with { DeletedAt = @event.CancelledAt })`, or by returning a modified model alongside `ModelAction.Delete` using the tuple conversion.
:::

**Runner behavior per action**:

1. **`ModelAction.None`** (update): The runner keeps the returned model and continues applying events. At the end of the batch, it upserts the final model and saves the checkpoint atomically.

2. **`ModelAction.Delete`** (soft delete): The runner keeps the model (the one returned with the action, or the prior model if none was returned) and upserts it at save time. The row remains in the database for audit and temporal queries. Setting `DeletedAt` is the perspective's responsibility. A `Delete()` that returns no model on a stream with no row is a no-op: there is nothing to mark, so no row is created (see [A declined stream gets no row](#declined-stream-no-row)).

3. **`ModelAction.Purge`** (hard delete): The runner marks the stream purged for this perspective and nulls the model. Every later event on the stream, in this batch or any later one, advances the checkpoint and is skipped unless its Apply returns `Resurrect`. At save time, the runner records the purge and then calls `IPerspectiveStore.PurgeAsync()` to remove the row entirely.

4. **`ModelAction.Resurrect`**: On a purged stream, the runner recreates the row with the returned model and forgets the purge; the events after it apply to the new row as usual. On a stream that is not purged, it is an ordinary update.

**Important**: a purged row stays purged. See the next section.

---

## Purge Stays Purged {#purge-stays-purged}

A purge used to leave nothing behind. The next event on the stream found no row, the runner applied it to an empty model, and an Apply written as create-or-update rebuilt a row with mostly default values. A delayed follow-up, such as a version bump from a save point that lands thirty seconds after the delete, then put an empty row back into grids and counts.

### What Apply receives when there is no row {#no-row-contract}

The runner **never passes `Apply` a null model**. When a stream has no row (a new stream, or a purged one), it builds an empty model and passes that:

- the `[StreamId]` property is set to the stream id (a `Guid`, `Guid?`, `string`, or a strongly-typed id with a static `From(Guid)` factory);
- every `required` member is set to `default!`;
- every other property keeps the value of the model's own initializer, or its default.

The runner saves a row only when an `Apply` returns a model (or the row already existed); a batch of `ApplyResult.None()` on a new stream writes nothing. This has a consequence that surprises people: a guard written as `current ??= new OrderView { ... }` **never runs**, because `current` is never null. A create-or-update `Apply` therefore cannot tell "no row yet" from "a row with default values" by checking for null, and on a missing row it builds a row out of the empty model. Test for a missing row explicitly (for example, the stream key is set but a field every created row has, such as `CreatedAt`, is still its default) if an event must not create one, and rely on the purge marker below for a row that was purged.

The analyzer reports a null test of the current model (`current is null`, `current is not null`, `current == null`, `current != null`, with `null` on either side) as [WHIZ107](../../operations/diagnostics/whiz107): the test is never true, so the branch it guards is dead code.

{verified: PerspectiveCurrentModelAnalyzerTests.EveryFormOfTheNullCheck_IsWarnedAsync, PerspectiveCurrentModelAnalyzerTests.ANullCheckOfAPropertyOrOfTheEvent_IsNotWarnedAsync}

#### Detecting a stream's first event {#first-event-in-stream}

:::new
`ApplyContext.Current.IsFirstEventInStream` tells an `Apply` whether it is applying the first event of its stream, decided by the event's position and reproduced by every replay.
:::

An `Apply` that needs to know whether it is applying the **first event of its stream** (to set a `CreatedAt`, a first-seen value or an opening status) reads `ApplyContext.Current.IsFirstEventInStream`:

```csharp{title="Set a first-seen value from the stream's first event" description="ApplyContext.Current.IsFirstEventInStream is true only for the event at the stream's first position, so the value is set once and every replay sets it the same way" framework="NET10" category="Core Concepts" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "ApplyContext", "First Event"] tests=["FirstEventInStreamTests.TheEventThatOpensAStream_IsTheFirstEventInStreamAsync", "FirstEventInStreamTests.ALaterEventOnAStreamWithNoRow_IsNotTheFirstEventInStreamAsync"]}
using Whizbang.Core.Perspectives;

public class OrderViewPerspective : IPerspectiveFor<OrderView, OrderPlaced> {
  public OrderView Apply(OrderView current, OrderPlaced @event) =>
    ApplyContext.Current.IsFirstEventInStream
      ? current with { CreatedAt = @event.PlacedAt, Status = "Placed" }
      : current with { Status = "Placed" };
}
```

The fact is decided by the **event's own position in its stream**, never by the row the perspective holds. Row state is the wrong signal: a purge, an eviction, a rebuild or a replay changes it, so "no row yet" is true for many events that are not first, and false for a first event that is applied again in a rewind. The position does not change, so a live apply, a rewind, a rebuild and a replay of the stream all reach the same answer.

- A stream's first event is the one at **version 1**, or at **version 0** for a stream whose numbering began there (a stream created by a direct append before new streams started at 1; see [Stream versions](../events/event-store#stream-versions)). A version-1 event of a stream that also holds a version 0 is not first.
- The generated runner sets the fact around every `Apply` (and every resurrection check) on the thread the `Apply` runs on; an `Apply` is synchronous. Outside an `Apply` the context is empty and `IsFirstEventInStream` is `false`.
- An event read from a store that does not record stream positions is never first.

{verified: FirstEventInStreamTests.TheEventThatOpensAStream_IsTheFirstEventInStreamAsync, FirstEventInStreamTests.ALaterEventOnAStreamWithNoRow_IsNotTheFirstEventInStreamAsync, FirstEventInStreamTests.ARewind_ReproducesTheFirstEventFactAsync, FirstEventInStreamTests.AfterTheRun_TheFactIsNoLongerCurrentAsync, ApplyContextTests.OutsideAnApply_NoEventIsTheFirstInItsStreamAsync}

**Where the fact comes from.** Every read a perspective folds from carries it on the envelope as `MessageEnvelope.IsFirstInLocalStream` (not serialized; derived from the local rows at read time): the polymorphic read on the EF Core and Dapper drivers and the in-memory store, and the live drain. For the drain, migration 264 adds an `out_first_in_stream` column to `get_stream_events`, which reaches the envelope through `StreamEventData.IsFirstInStream`. The check is one unique-index probe per stream, made only for a version-1 row. A reader running against a database that has not applied 264 reports no event as first.

{verified: FirstEventInStreamReadTests.GetStreamEvents_ReturnsWhetherEachEventIsTheFirstInItsStreamAsync, FirstEventInStreamReadTests.DeserializeStreamEvents_CarriesTheFirstInStreamFactOntoTheEnvelopeAsync, FirstEventInStreamReadTests.ReadPolymorphicAsync_MarksOnlyTheEventAtTheStreamsFirstPositionAsFirstAsync, FirstEventInStreamTests.TheInMemoryStore_MarksOnlyTheStreamsFirstEventAsync}

**Unit-testing an `Apply`.** A test that calls an `Apply` directly sets the fact with `ApplyContext.Enter`, which returns a scope that restores the previous facts when it is disposed:

```csharp{title="Drive an Apply as the stream's first event in a unit test" description="ApplyContext.Enter makes the fact current until the scope is disposed" framework="NET10" category="Testing" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "ApplyContext", "Testing"] tests=["ApplyContextTests.Enter_MakesTheFactCurrentUntilTheScopeIsDisposedAsync", "ApplyContextTests.ANestedScope_RestoresTheEnclosingFactOnDisposeAsync"]}
[Test]
public async Task FirstOrderPlaced_SetsCreatedAtAsync() {
  var perspective = new OrderViewPerspective();
  var placed = new OrderPlaced { OrderId = orderId, PlacedAt = placedAt };

  OrderView view;
  using (ApplyContext.Enter(isFirstEventInStream: true)) {
    view = perspective.Apply(new OrderView { OrderId = orderId }, placed);
  }

  await Assert.That(view.CreatedAt).IsEqualTo(placedAt);
}
```

Keep the call inside the `using` block synchronous, as an `Apply` is: the facts belong to the thread.

:::updated
**Upgrading:** code that used `current is null` (or `== null`, `??=`) to detect a stream's first event never detected it, because the runner has always passed an empty model. Replace the check with `ApplyContext.Current.IsFirstEventInStream`; the build now reports the old form as [WHIZ107](../../operations/diagnostics/whiz107). Tests that called such an `Apply` with `null` should pass an empty model inside `ApplyContext.Enter(isFirstEventInStream: true)` instead.
:::

### A declined stream gets no row {#declined-stream-no-row}

A perspective can decline a stream: every `Apply` for the stream's events returns `ApplyResult<TModel>.None()`, for example because the events belong to a different workflow that shares the event types. Such a stream **gets no row**, however its events reach the runner. The live drain writes nothing, and so does a rewind, whether it comes from a late event behind the cursor, events of one stream split across concurrent claims, a startup rewind or a resurrection. A rewind writes, and snapshots, only a model an `Apply` produced or a snapshot it restored; the empty model the runner builds as `Apply` input is never stored. The cursor still moves past the declined events, so they are not claimed again.

{verified: DeclinedStreamLeavesNoRowTests.LiveBatch_FirstEventDeclined_AndALaterEventDeclined_LeavesNoRowAsync, DeclinedStreamLeavesNoRowTests.Rewind_OfAStreamWhoseEventsAreAllDeclined_LeavesNoRowAsync, DeclinedStreamLeavesNoRowTests.ConcurrentClaims_TheLaterEventFirst_ThenTheEarlierOneRewound_LeavesNoRowAsync, DeclinedStreamLeavesNoRowTests.Rewind_WithSnapshotsOn_OfAStreamWhoseEventsAreAllDeclined_SnapshotsNothingAsync, DeclinedStreamLeavesNoRowTests.Rewind_OfAStreamWithAnAcceptedEvent_WritesTheRowItFoldsAsync, DeclinedStreamLeavesNoRowTests.Rewind_FromASnapshot_WithEveryLaterEventDeclined_KeepsWritingTheSnapshotsModelAsync, DeclinedStreamLeavesNoRowTests.Rewind_WhereADeclinedEventPrecedesAnAcceptedOne_WritesOnlyWhatTheAcceptedOneFoldsAsync}

The same holds for a soft delete with no model. `ApplyResult<TModel>.Delete()` on a stream with no row is a no-op, live or in a rewind. On a stream an `Apply` already produced a model for, it keeps that model, as described above.

{verified: DeclinedStreamLeavesNoRowTests.LiveBatch_ASoftDeleteWithNoModel_OnAStreamWithNoRow_LeavesNoRowAsync, DeclinedStreamLeavesNoRowTests.Rewind_ASoftDeleteWithNoModel_OnAStreamWithNoRow_LeavesNoRowAsync, DeclinedStreamLeavesNoRowTests.LiveBatch_ASoftDeleteWithNoModel_OnALiveRow_KeepsTheRowAsync}

Earlier versions stored the empty model on a rewind of a declined stream, which left a row of defaults (empty strings, zero counts, the earliest timestamps) that read as a real one. Rows already written that way stay in place: the fix stops new ones, it does not remove old ones.

**The write guard.** Every row write in the generated runner passes through `PerspectiveRowWriteGuard.AllowsWrite` first. The runner tells it whether the model came from an `Apply`, a stored row or a snapshot; when it did not, the guard refuses the write and logs a warning:

```text
[diag.write.unproduced] {PerspectiveName} stream {StreamId}: refused to write a row no Apply produced; ...
```

Every write path in the runner already declines such a batch before it reaches the write, so this warning should never appear. If you see it, nothing was lost and no blank row was stored, but it means a write path is missing the check: report it as a defect on the [Whizbang issue tracker](https://github.com/whizbang-lib/whizbang/issues), with the perspective name, the stream id and the surrounding log lines.

{verified: PerspectiveRowWriteGuardTests.AllowsWrite_AModelAnApplyProduced_IsWrittenAndNothingIsLoggedAsync, PerspectiveRowWriteGuardTests.AllowsWrite_AModelNoApplyProduced_IsRefusedWithAWarningNamingTheRowAsync, PerspectiveRunnerTemplateInvariantTests.SaveModelAndCheckpoint_AsksTheWriteGuardBeforeItWritesAsync}

The runner now remembers the purge, and checks it **before** any `Apply` runs:

- **The purge is recorded.** When an Apply returns `Purge`, the runner writes a purge marker for the stream and perspective (`wh_stream_purge_markers`) *before* it removes the row, so a crash between the two leaves a marker on a live row, never a missing row without one.
- **Later events are skipped.** When the row is missing and the stream carries a marker, the batch is skipped before anything is applied to the stream's row: the checkpoint moves past each event, nothing is written, and the skip is logged and counted in `whizbang.perspective.purged_events_skipped` (tagged with `perspective_name`). An Apply that throws on a purged stream is a skip too, not a failure: the row it would change is gone.
- **Resurrect is the only way back.** To find out whether an event opts back in, the runner still calls its `Apply` on a fresh empty model, and throws the result away unless it is `ApplyResult<TModel>.Resurrect(model)`, which recreates the row and clears the marker; events after it apply normally. Nothing a create-or-update `Apply` returns can recreate the row.
- **New streams are never affected.** The marker is consulted only when the row is missing, and a marker exists only after a purge, so a new stream, or any stream that was never purged, never pays for or meets it.
- **Live, rewind and rebuild agree.** A rebuild or a full rewind of a purged stream starts purged when the stream carries a marker, so replaying "created, deleted, bumped" leaves no row, exactly as the live drain did. A straggler written before the delete but delivered after it stays out too: the live drain finds the marker, and a rewind replays it in order before the purge.
- **An operator purge marks every perspective.** [Purging streams](../../operations/infrastructure/purging-streams.md) removes a stream entirely and marks it for every perspective at once, so a later event cannot recreate any of its rows.

```csharp{title="Opting back in with Resurrect" description="A follow-up written as create-or-update stays out of a purged stream; only the reopen recreates the row" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Perspectives", "ApplyResult", "Purge", "Resurrect"] tests=["PurgeStaysPurgedTests.LaterBatch_AfterPurge_IsSkipped_AndNoRowIsRecreatedAsync", "PurgeStaysPurgedTests.Resurrect_OnPurgedStream_RecreatesRow_AndClearsMarkerAsync", "PurgeStaysPurgedTests.Rebuild_OfDeletedThenBumpedStream_LeavesNoRowAsync"]}
using Whizbang.Core.Perspectives;

public class OrderPerspective :
    IPerspectiveFor<OrderView, OrderSaved>,
    IPerspectiveWithActionsFor<OrderView, OrderDeleted>,
    IPerspectiveWithActionsFor<OrderView, OrderReopened> {

    // Create-or-update: on a purged stream this event is skipped, not applied to an empty model.
    public OrderView Apply(OrderView current, OrderSaved @event) =>
        current with { Version = current.Version + 1 };

    public ApplyResult<OrderView> Apply(OrderView current, OrderDeleted @event) =>
        ApplyResult<OrderView>.Purge();

    // The explicit opt-in: this event starts the order over.
    public ApplyResult<OrderView> Apply(OrderView current, OrderReopened @event) =>
        ApplyResult<OrderView>.Resurrect(new OrderView { OrderId = @event.OrderId, Version = 1 });
}
```

**Why a return value, not an attribute.** `Resurrect` sits beside `Purge` in the vocabulary Apply already uses for a row's lifecycle, so the decision lives in the same pure function as the purge and can depend on the event's content (reopen only when the reason allows it). Replay and rebuild fold the same results, so they reach the same answer with nothing else to consult. An Apply that returns a plain `TModel` cannot resurrect; return `ApplyResult<TModel>` from the events that should.

The markers are written by both Postgres drivers. A store without them (a custom driver that registers no `IPerspectivePurgeMarkerStore`) still honors a purge within its batch, as before.

---

## Read Model Requirements

### For Soft Delete

By convention, models that support soft delete include a `DateTimeOffset? DeletedAt` property, which the perspective's `Apply` method sets (the framework does not stamp it automatically):

```csharp{title="Soft Delete Model" description="Read model with DeletedAt property for soft-delete support" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Perspectives", "SoftDelete", "Model"] unverified="read-model DTO — property-only, no behavior to assert"}
using Whizbang.Core;

public record OrderView {
    [StreamId]
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

```csharp{title="Testing Perspectives with Actions" description="Unit tests for perspectives returning ApplyResult with delete and purge actions" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Perspectives", "Testing", "ApplyResult"] tests=["IPerspectiveWithActionsForTests.Apply_ReturningDelete_HasCorrectActionAsync", "IPerspectiveWithActionsForTests.Apply_ReturningPurge_HasCorrectActionAsync", "IPerspectiveWithActionsForTests.MixedPerspective_BothInterfaceTypes_WorkTogetherAsync", "IPerspectiveWithActionsForTests.Apply_IsPureFunction_OriginalModelUnchangedAsync"]}
using Whizbang.Core.Perspectives;

public class OrderPerspectiveTests {
    [Test]
    public async Task Apply_OrderCancelled_ReturnsSoftDeleteAsync() {
        // Arrange
        var perspective = new OrderPerspective();
        var model = new OrderView {
            OrderId = TrackedGuid.New(),
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
            OrderId = TrackedGuid.New(),
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
            OrderId = TrackedGuid.New(),
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
            OrderId = TrackedGuid.New(),
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
- Include `DateTimeOffset? DeletedAt` on models that support soft delete, and set it in `Apply`
- Prefer `Delete()` over `Purge()` unless data retention is explicitly not required
- Use implicit conversions for clean, readable Apply methods (`return ModelAction.Purge;` from an `ApplyResult<TModel>` Apply)
- Implement `IPerspectiveFor` and `IPerspectiveWithActionsFor` side by side, each as many times as you like
- Test each action type (update, delete, purge) independently

### DON'T

- Don't use `IPerspectiveWithActionsFor` for every event type when only one or two need deletion
- Don't return a bare `ModelAction` or a tuple from an `IPerspectiveFor` event's `Apply`, or add an explicit `Apply` to make one compile ([WHIZ115](../../operations/diagnostics/whiz115), [WHIZ114](../../operations/diagnostics/whiz114))
- Don't perform I/O in Apply methods (they remain pure functions)
- Don't expect a later event to bring a purged row back: return `Resurrect` from the event that should
- Don't write a create-or-update Apply as a way to undo a purge; it is skipped on a purged stream
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
