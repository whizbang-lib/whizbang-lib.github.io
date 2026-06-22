---
title: Whizbang.Sagas — Multi-Stream Saga Coordination
version: 1.0.0
category: Application Blocks
order: 1
description: >-
  Long-running multi-item workflows on top of Whizbang.Core. One attribute
  generates the events + service; per-item streams give race-free fan-out;
  PublishOnceAsync collapses the terminal-emission race; SagaItemCompletionReconciler
  rescues stranded sagas from cross-pod lost-updates.
tags: 'sagas, workflows, event-sourcing, per-item-streams, exactly-once'
codeReferences:
  - src/Whizbang.Sagas/Services/BaseSagaService.cs
  - src/Whizbang.Sagas/Helpers/SagaCompletionGuard.cs
  - src/Whizbang.Sagas/Helpers/SagaItemCompletionReconciler.cs
  - src/Whizbang.Sagas/SagaItemStreams.cs
  - src/Whizbang.Sagas.Generators/SagaGenerator.cs
---

# Whizbang.Sagas — Multi-Stream Saga Coordination

## When you need it

You have a long-running workflow that processes many items, may take minutes or hours, can fail mid-flight on individual items, and needs to surface live progress to a UI. Classic cases:

- **Bulk import**: 350 jobs imported from a CSV; each job is a separate work unit; some fail; dashboard renders progress.
- **Multi-step orchestration**: archive a tenant's jobs, then run an embedding backfill across all employee records, then notify subscribers.
- **Periodic backfill**: walk every row in a 10k-row table, recompute a derived field, track completion.

The bare event-sourcing primitives (`PublishAsync`, perspective projection) are correct but require every consumer to re-implement: per-item state tracking, progress aggregation, completion detection, race-free terminal-event emission, cross-pod consistency recovery, and dashboard resolvers. `Whizbang.Sagas` ships those pieces as one application block on top of `Whizbang.Core`.

## One-line consumer surface

```csharp{title="Declare a saga"}
using Whizbang.Sagas;

namespace AcmeCorp.Sagas;

[Saga<AcmeEventBase>("BulkOrderImport")]
public partial class BulkOrderImportSaga;
```

That's it. The `[Saga<T>("Name")]` source generator emits, into a sibling `.g.cs` file:

- `SagaName` const
- Nine sealed partial nested event classes (`InitiatedEvent`, `ItemsDispatchedEvent`, `ItemStartedEvent`, `ItemCompletedEvent`, `ItemFailedEvent`, `CompletedEvent`, `ResetEvent`, `HookStartedEvent`, `HookCompletedEvent`) — each inherits `AcmeEventBase` and implements the matching `Whizbang.Sagas.Contracts` interface
- A typed `Service` class derived from `BaseSagaService<...>` with all factory methods filled in
- An `AddBulkOrderImportSaga()` DI extension method registering the `Service` as Scoped

**Without a project event base?** Use `[Saga("Name")]` (no generic argument). The generator inherits from the framework's default `SagaEventBase` (carries `MessageId`, `OccurredAt`, `CorrelationId`, `CausationId`, `OperationName`).

**Consumer usage:**

```csharp{title="Consume the generated service"}
public class BulkOrderImportReceptor(BulkOrderImportSaga.Service saga) : IReceptor<StartBulkOrderImport> {
  public async ValueTask HandleAsync(StartBulkOrderImport cmd, CancellationToken ct) {
    var context = new SagaContext(SagaId: cmd.OperationId, EntityId: cmd.TenantId);
    await saga.InitiateSagaAsync(context, itemIdentifiers: cmd.OrderIds.Select(id => id.ToString()).ToList(), hookNames: null, ct);
    foreach (var orderId in cmd.OrderIds) {
      await saga.UpdateItemAsync(context, orderId.ToString(), SagaItemState.Running, displayName: null, ct);
      try {
        await ProcessOrderAsync(orderId, ct);
        await saga.UpdateItemAsync(context, orderId.ToString(), SagaItemState.Completed, displayName: null, ct);
      } catch (Exception ex) {
        await saga.FailItemAsync(context, orderId.ToString(), ex.Message, ex.ToString(), displayName: null, ct);
      }
    }
  }
}

services.AddWhizbangSagas();
services.AddBulkOrderImportSaga();
```

## What you get under the covers

### Per-item streams (cross-pod-safe fan-out)

Per-item events (`ItemStartedEvent`, `ItemCompletedEvent`, `ItemFailedEvent`) ride a **per-item stream** derived from the saga id and the item identifier via `SagaItemStreams.Of(sagaId, itemIdentifier)`. Concurrent items don't contend for the saga's stream lease — N pods can process N items in parallel without lost-update races on a single aggregate.

`SagaItemStreams` uses an RFC 4122 v5 UUID (SHA-1 over `{namespace_bytes || utf8("{sagaId:D}/{itemIdentifier}")}`). The default namespace is `acb2e0cf-92d5-4f1b-8c5e-2d7f4a5e8b3a`. Override at startup for consumers migrating from a pre-Whizbang scheme:

```csharp{title="Migration override"}
services.AddWhizbangSagas(opts =>
  opts.PerItemStreamNamespace = Guid.Parse("0b36f8d4-3884-4c3c-b92b-fc6ec74775ea"));
```

A matching PostgreSQL `saga_item_stream_id(uuid, text)` function reproduces the derivation byte-for-byte (handy for backfills).

### Atomic terminal-event emission

When all items reach a terminal state, **N concurrent terminal handlers** may each conclude "I'm the last one" and try to emit `CompletedEvent`. The naive `if (!alreadyEmitted) PublishAsync(...)` has a check-to-commit window that collapses N duplicates to a few — but never to one.

`BaseSagaService.CompleteSagaAsync` routes through `SagaCompletionGuard.EmitOnceAsync`, which calls `IDispatcher.PublishOnceAsync(claimKey, evt, ct)` with the convention `"saga-completed:{sagaName}:{sagaId}"`. The dispatcher's atomic `INSERT … ON CONFLICT DO NOTHING` against `wh_unique_emission_claims` gives **exactly-one** emission by construction. See [PublishOnceAsync](../dispatcher/publish-once) for the underlying mechanism.

### Stranded-row reconciliation

Per-item projection rows can still be left in a non-terminal state by a cross-pod lost-update: two pods apply the same per-item stream and a stale `ItemStartedEvent` write lands after the `ItemCompletedEvent` write, reverting the row to `Running` even though the terminal event committed to `wh_event_store`.

`SagaItemCompletionReconciler.ResolveCompletionCountsAsync` walks the projection's non-terminal items and consults the durable event store via `ISagaItemTerminalReader`. If every item is terminal in the store, it returns the reconciled `(completed, failed)` counts; otherwise null (genuinely in progress). Saga completion handlers should call this on the slow path so a single stranded row doesn't strand the entire saga forever.

### Dashboard live-progress resolvers

`SagaLiveProgressResolvers` ships three helpers backing every saga dashboard's `processedCount` / `failedCount` / `progressPercent` GraphQL/REST resolvers:

```csharp
// In a HotChocolate / projection-side resolver:
public Task<int> GetProcessedCountAsync(
    Guid sagaId, SagaStatus status, int storedCompletedItems,
    [Service] ISagaItemRepository repo, CancellationToken ct) =>
  SagaLiveProgressResolvers.ResolveProcessedCountAsync(sagaId, status, storedCompletedItems, repo, ct);
```

While running, stored counters on the saga row are still 0; the resolver reads the live GROUP BY aggregate. Once terminal, stored counters are authoritative and the resolver short-circuits (no DB round-trip on every refresh). All resolvers take an explicit `sagaId` parameter so projection-level shadowing of `BaseSagaModel.Id` (`[StreamId] public new Guid Id`) doesn't silently return zero.

### Apply helpers

`SagaApplyHelper` (`TrackCompleted`, `TrackFailed`, `TrackFailedFast`) and `SagaHookApplyHelper` (`DeclareHooks`, `TrackHookStarted`, `TrackHookCompleted`) consolidate the find-or-create + `IsTerminal`-dedup + counter-bump pattern that every saga projection's Apply methods otherwise re-implement. They take a caller-supplied timestamp — Apply stays pure, replays reconstruct exact original timestamps.

### Metrics

`SagaMetrics` (meter `Whizbang.Sagas`) ships nine instruments tagged with `saga_name`:

| Instrument | Type | Use |
|---|---|---|
| `whizbang.sagas.initiated` | Counter | Sagas initiated |
| `whizbang.sagas.completed` | Counter | Sagas reached terminal completion |
| `whizbang.sagas.failed` | Counter | Sagas fail-fasted |
| `whizbang.sagas.duration` | Histogram | End-to-end saga duration (seconds) |
| `whizbang.sagas.items_completed` | Histogram | Items completed per saga |
| `whizbang.sagas.items_failed` | Histogram | Items failed per saga |
| `whizbang.sagas.hooks_completed` | Counter | Hook executions that succeeded |
| `whizbang.sagas.hooks_failed` | Counter | Hook executions that failed |
| `whizbang.sagas.items_reset` | Counter | Saga items reset via `SagaResetEvent` |

Add to your OpenTelemetry exporter wiring alongside `Whizbang.Dispatcher`.

## Customization

```csharp{title="Skip hooks"}
[Saga<AcmeEventBase>("BulkOrderImport", IncludeHooks = false)]
public partial class BulkOrderImportSaga;
// Generator omits HookStartedEvent + HookCompletedEvent, stubs the
// Service's BuildHook*Event overrides to throw InvalidOperationException.
```

```csharp{title="Custom Service class"}
[Saga<AcmeEventBase>("BulkOrderImport", GenerateService = false)]
public partial class BulkOrderImportSaga {
  public sealed class Service(ISagaEventEmitter emitter, ILogger<Service> log) :
    BaseSagaService<InitiatedEvent, ItemsDispatchedEvent, ItemStartedEvent, ItemCompletedEvent,
                    ItemFailedEvent, CompletedEvent, ResetEvent, HookStartedEvent, HookCompletedEvent>(
      SagaName, emitter, log) {
    // Custom factory overrides, e.g. populating tenant context onto every event.
    protected override InitiatedEvent BuildInitiatedEvent(SagaContext ctx, IReadOnlyList<string> items, IReadOnlyList<string>? hooks, DateTimeOffset sentAt) =>
      new() { EntityId = ctx.EntityId, ItemIdentifiers = items, TotalItems = items.Count, HookNames = hooks, TenantId = TenantContext.Current };
    // ... 8 more
  }
}
```

```csharp{title="Extra per-event payload via partial class"}
[Saga<AcmeEventBase>("BulkOrderImport")]
public partial class BulkOrderImportSaga {
  // Consumer extends the generated CompletedEvent with domain payload:
  public sealed partial class CompletedEvent {
    public int DraftsCreated { get; set; }
    public string? WarningCode { get; set; }
  }
}
```

## Patterns

### Nested / hierarchical sagas

The item-identifier mechanism already supports nesting. A parent saga's `ItemIdentifier` is a child saga's id; when the child completes, a cross-saga receptor calls `parent.CompleteItem(parentSagaId, childId)`:

```csharp{title="Parent observes children"}
public class ChildSagaCompletedReceptor(ParentSaga.Service parent) :
    IReceptor<ChildSaga.CompletedEvent> {
  public async ValueTask HandleAsync(ChildSaga.CompletedEvent e, CancellationToken ct) {
    var parentSagaId = ResolveParent(e.SagaId);
    var parentCtx = new SagaContext(parentSagaId, parentEntityId);
    if (e.FinalStatus is SagaStatus.Completed) {
      await parent.UpdateItemAsync(parentCtx, e.SagaId.ToString(), SagaItemState.Completed, displayName: null, ct);
    } else {
      await parent.FailItemAsync(parentCtx, e.SagaId.ToString(), $"Child saga {e.FinalStatus}", null, displayName: null, ct);
    }
  }
}
```

No framework-level child concept is required. Each level uses the same `BaseSagaService` API. `SagaItemCompletionReconciler` handles "did the child actually finish?" via event-store truth at each level.

### Compensation

Whizbang.Sagas ships an `ISagaCompensatingEvent` marker interface but does NOT automatically execute compensation — the right ordering is irreducibly domain-specific (refund before un-archive, or vice versa, depends on the workflow). Mark your compensation events with the interface so visualization and audit tooling can group them, then wire your own `IReceptor<MyCompensatingEvent>` chain:

```csharp
public class RefundPaymentEvent : AcmeEventBase, ISagaCompensatingEvent {
  public Guid CompensatingForSagaId { get; set; }
  public decimal Amount { get; set; }
  // ... domain payload
}
```

### Hook bookends (Rule 17)

Long-running setup or teardown work (warm a cache, write a manifest, send a notification) sits alongside items as first-class "hook" entries on the saga projection:

```csharp{title="Run a hook"}
await saga.TryRunHookAsync(
  ctx, sagaProjection: maybeLoadedProjection,
  hookName: "warm-cache", displayName: "Warm response cache",
  work: async (ct) => await _cache.WarmAsync(ct),
  ct);
```

The framework publishes `HookStartedEvent` before `work()` runs and `HookCompletedEvent` after (or on failure, with the exception captured before rethrow). Hook idempotency: `TryRunHookAsync` skips when the projection already shows the hook in a terminal state.

## Architecture invariants

Whizbang.Sagas is built on Whizbang.Core's purity contract:

- **Apply stays pure.** Every helper takes the caller's timestamp; no `DateTimeOffset.UtcNow` leakage. Replay reconstructs exact original state.
- **Receptors do side effects.** `BaseSagaService` lifecycle methods (`InitiateSagaAsync`, `UpdateItemAsync`, etc.) are explicitly receptor-time operations — they call `ISagaEventEmitter.PublishAsync`. Apply methods just project.
- **Exactly-once emission lives at the dispatcher.** `CompleteSagaAsync` is the only method that uses `PublishOnceAsync` — and only because the saga-completion race is the precise scenario the dispatcher's claim primitive was designed for.

## Related

- [PublishOnceAsync](../dispatcher/publish-once) — the dispatcher-level exactly-once primitive `SagaCompletionGuard` wraps.
- [Dispatcher Deep Dive](../dispatcher/dispatcher) — the broader `IDispatcher` API surface.
- [Collective Events](../messaging/collective-events) — for the orthogonal "one event mutates a set of streams" pattern.
