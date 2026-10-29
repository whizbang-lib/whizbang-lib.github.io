---
title: Whizbang.Sagas — Multi-Stream Saga Coordination
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
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
  - src/Whizbang.Sagas.Contracts/Events/ISagaStreamEvent.cs
  - src/Whizbang.Sagas/SagaFrameworkEventStreamIds.cs
  - src/Whizbang.Sagas/Services/BaseSagaService.cs
  - src/Whizbang.Sagas/Helpers/SagaCompletionGuard.cs
  - src/Whizbang.Sagas/Helpers/SagaItemCompletionReconciler.cs
  - src/Whizbang.Sagas/SagaItemStreams.cs
  - src/Whizbang.Sagas/ISagaItemStreamIdDeriver.cs
  - src/Whizbang.Sagas/SagaItemStreamIdDeriver.cs
  - src/Whizbang.Sagas/SagaServiceCollectionExtensions.cs
  - src/Whizbang.Sagas.Generators/SagaGenerator.cs
  - src/Whizbang.Sagas.Contracts/SignalsOutcomeAttribute.cs
testReferences:
  - tests/Whizbang.Sagas.Tests/BaseSagaServiceTests.cs
  - tests/Whizbang.Sagas.Tests/SagaCompletionGuardTests.cs
  - tests/Whizbang.Sagas.Tests/SagaItemCompletionReconcilerTests.cs
  - tests/Whizbang.Sagas.Tests/SagaItemStreamsTests.cs
  - tests/Whizbang.Sagas.Tests/SagaItemStreamIdDeriverTests.cs
  - tests/Whizbang.Sagas.Component.Tests/SagaItemStreamNamespacePerHostTests.cs
  - tests/Whizbang.Sagas.Tests/SagaLiveProgressResolversTests.cs
  - tests/Whizbang.Sagas.Tests/SagaApplyHelperTests.cs
  - tests/Whizbang.Sagas.Tests/SagaHookApplyHelperTests.cs
  - tests/Whizbang.Sagas.Tests/SagaMetricsTests.cs
  - tests/Whizbang.Sagas.Tests/Generators/SagaGeneratorSmokeTests.cs
---

# Whizbang.Sagas — Multi-Stream Saga Coordination

## When you need it

You have a long-running workflow that processes many items, may take minutes or hours, can fail mid-flight on individual items, and needs to surface live progress to a UI. Classic cases:

- **Bulk import**: 350 jobs imported from a CSV; each job is a separate work unit; some fail; dashboard renders progress.
- **Multi-step orchestration**: archive a tenant's jobs, then run an embedding backfill across all employee records, then notify subscribers.
- **Periodic backfill**: walk every row in a 10k-row table, recompute a derived field, track completion.

The bare event-sourcing primitives (`PublishAsync`, perspective projection) are correct but require every consumer to re-implement: per-item state tracking, progress aggregation, completion detection, race-free terminal-event emission, cross-pod consistency recovery, and dashboard resolvers. `Whizbang.Sagas` ships those pieces as one application block on top of `Whizbang.Core`.

## One-line consumer surface

```csharp{title="Declare a saga" unverified="consumer-authored saga declaration; the generated events + Service are exercised by SagaGeneratorSmokeTests, which is outside the current coverage map"}
using Whizbang.Sagas;

namespace AcmeCorp.Sagas;

[Saga<AcmeEventBase>("BulkOrderImport")]
public partial class BulkOrderImportSaga;
```

That's it. The `[Saga<T>("Name")]` source generator emits, into a sibling `.g.cs` file:

- `SagaName` const
- Nine sealed partial nested event classes (`InitiatedEvent`, `ItemsDispatchedEvent`, `ItemStartedEvent`, `ItemCompletedEvent`, `ItemFailedEvent`, `CompletedEvent`, `ResetEvent`, `HookStartedEvent`, `HookCompletedEvent`) — each inherits `AcmeEventBase` and implements the matching `Whizbang.Sagas.Contracts` interface
- A typed `Service` class derived from `BaseSagaService<...>` with all factory methods filled in
- Three recovery receptors (`SagaItemCompletedRecoveryHandler`, `SagaItemFailedRecoveryHandler`, `SagaCompletionWatchdogTickHandler`) that bridge per-item terminal events and the auto-armed watchdog tick to the framework's completion-recovery path. The tick handler is received at `PreInboxInline`, so every tick reaches it once on the receiving side, including the scheduled ticks the saga's own service publishes
- An `AddBulkOrderImportSaga()` DI extension method registering the `Service` as Scoped

### One stream per saga: the saga id {#stream-key}

{verified: SagaStreamKeyTests.EveryEventAGeneratedSagaEmits_IsStoredOnTheSagasStream_WhenTheEntityIdDiffersAsync, SagaStreamKeyTests.CustomBaseSagaEvent_IsStoredOnTheSagasStream_NotTheBasesAsync, SagaStreamKeyTests.GeneratedSagaEvents_CarryBothIdsAsync}

`SagaContext` carries two ids. **`SagaId` is the saga's stream**: every event the saga emits is stored
on it, the generated lifecycle, item and hook events as well as the watchdog tick, the abandonment and
the continuation request. **`EntityId` is your domain identity**, carried on every event for filtering
and routing; it never decides a stream. The two are often the same value, but need not be.

Each generated event carries `SagaId` and implements `ISagaStreamEvent`, through which the framework
resolves its stream. That holds even with a `[Saga<TBase>]` whose base marks a `[StreamId]` of its own:
a saga event belongs to its saga. A hand-written saga event can implement `ISagaStreamEvent` to be
stored the same way.

A `SagaId` must not be empty: a saga event with an empty stream id is rejected when it is published,
as any event with an unpopulated `[StreamId]` is.

**Migration note:** before this, generated saga events were stored each on a stream of its own
message id. Where `SagaId` and `EntityId` are equal nothing else changes. Where they differ, a saga's
new events land on its `SagaId` stream while its earlier events stay where they were, so review any
perspective or query keyed on the entity's stream.

**Without a project event base?** Use `[Saga("Name")]` (no generic argument). The generator inherits from the framework's default `SagaEventBase` (carries `MessageId`, `OccurredAt`, `CorrelationId`, `CausationId`, `OperationName`).

**Consumer usage:**

```csharp{title="Consume the generated service" unverified="illustrative consumer receptor and DI wiring; the BaseSagaService lifecycle calls it shows are covered by BaseSagaServiceTests, but this fence is user-domain code"}
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

A saga service written by hand — a `BaseSagaService` subclass without `[Saga]` — is registered with
`services.AddSagaService<TService>()` rather than `AddScoped`, so its completion watchdog ticks have a
receiver. See [Hand-written sagas](./completion-orchestration#hand-written-sagas).

## What you get under the covers

### Per-item streams (cross-pod-safe fan-out) {#per-item-streams-cross-pod-safe-fan-out}

Per-item events (`ItemStartedEvent`, `ItemCompletedEvent`, `ItemFailedEvent`) ride a **per-item stream** derived from the saga id and the item identifier via `SagaItemStreams.Of(sagaId, itemIdentifier)`. Concurrent items don't contend for the saga's stream lease — N pods can process N items in parallel without lost-update races on a single aggregate.

`SagaItemStreams` uses an RFC 4122 v5 UUID (SHA-1 over `{namespace_bytes || utf8("{sagaId:D}/{itemIdentifier}")}`). The default namespace is `acb2e0cf-92d5-4f1b-8c5e-2d7f4a5e8b3a`. Override at startup for consumers migrating from a pre-Whizbang scheme:

```csharp{title="Migration override" unverified="DI-wiring; the per-item-stream namespace override behavior is covered by SagaItemStreamsTests, but this fence is options wiring"}
services.AddWhizbangSagas(opts =>
  opts.PerItemStreamNamespace = Guid.Parse("0b36f8d4-3884-4c3c-b92b-fc6ec74775ea"));
```

The derivation is reproducible byte-for-byte in SQL via a canonical `saga_item_stream_id(uuid, text)` function (shipped by consumers as needed — handy for backfills; the library does not install it).

#### Each host derives under its own namespace {#per-item-stream-namespace-per-host}

:::updated
`SagaItemStreams.AppDefaultNamespace` is one value for the whole process, and every `AddWhizbangSagas` call
overwrites it. The framework's own per-item readers used to derive from it at call time, so in a process
that builds several hosts (integration tests, a test server per service) the last registration decided the
namespace for all of them. A host registered without the setting reset it to the default, and another host's
stranded-item watchdog then derived ids for streams it never writes, read items whose terminal events were
stored as not terminal, and failed them, with nothing logged. Each host now derives under its own namespace.
:::

`AddWhizbangSagas` registers an `ISagaItemStreamIdDeriver` in **each container**, built from that container's
own `SagaOptions`:

| Member | What it gives |
|---|---|
| `NamespaceId` | The namespace UUID this host derives under (its `PerItemStreamNamespace`, or the default) |
| `StreamIdOf(sagaId, itemIdentifier)` | The per-item stream id under `NamespaceId`, byte-for-byte what `SagaItemStreams.Of(NamespaceId, sagaId, itemIdentifier)` returns |

The framework's readers use the host's deriver: a saga service given its host's `SagaOptions` derives under
that host's namespace in the watchdog's reconciliation, the stranded-item resolution and the unstarted-item
completion. `SagaItemCompletionReconciler.ResolveCompletionCountsAsync` and `ReconcileTerminalCountsAsync`
gain overloads that take the deriver.

**Inject the deriver wherever your own code derives a per-item stream id** (an item event's stream id, a
terminal-event lookup):

```csharp{title="Derive per-item stream ids under the host's namespace" description="Takes the host's ISagaItemStreamIdDeriver from the container instead of calling the process-wide SagaItemStreams.Of" category="Sagas" difficulty="INTERMEDIATE" tags=["Sagas", "Per-item streams", "Dependency Injection"] tests=["SagaItemStreamIdDeriverTests.TwoContainers_EachResolveADeriverForTheirOwnNamespaceAsync", "SagaItemStreamIdDeriverTests.Of_DerivesUnderTheOptionsNamespaceAsync"]}
public sealed class ImportItemLookup(ISagaItemStreamIdDeriver itemStreams, ISagaItemTerminalReader terminals) {
  public Task<SagaItemTerminalOutcome> CheckAsync(Guid sagaId, string itemIdentifier, CancellationToken ct) =>
    terminals.CheckAsync(itemStreams.StreamIdOf(sagaId, itemIdentifier), ct);
}
```

**The static `SagaItemStreams.Of(sagaId, itemIdentifier)` is process-wide.** It stays, for code with no
container, and it reads the one value the last `AddWhizbangSagas` call in the process set. In a process with
a single host that is the host's namespace; in a process with several it is whichever registered last. The
existing reconciler overloads without a deriver, and the overload `SagaItemStreams.Of(namespaceId, sagaId,
itemIdentifier)` that names its namespace, behave exactly as before.

**Options a service built by hand keep the process-wide namespace, on purpose.** A saga service is treated
as deriving under its host's namespace only when it was given the `SagaOptions` instance a container's
`AddWhizbangSagas` registered. A `new SagaOptions()` carries the framework default namespace unless it is set,
so reading it as the host's would silently move a service whose host configured a namespace onto streams it
never wrote. Hand-built options, and no options at all, keep the process-wide value the framework always used.

**A hand-written saga takes `SagaOptions` from the container** and passes it to the constructor that takes
options, so its watchdog reads the streams its own host writes:

```csharp{title="A hand-written saga service that derives under its host's namespace" description="Takes SagaOptions from the container and passes it to BaseSagaService, so the watchdog and stranded-item resolution derive per-item stream ids under this host's namespace" category="Sagas" difficulty="INTERMEDIATE" tags=["Sagas", "Per-item streams", "Watchdog"] tests=["SagaItemStreamNamespacePerHostTests.TwoHostsWithDifferentNamespaces_EachHostsWatchdogReadsItsOwnItemsAsTerminalAsync", "SagaItemStreamIdDeriverTests.For_OptionsAContainerRegistered_DeriveUnderThoseOptionsAsync"]}
public sealed class ImportSagaService(
    ISagaEventEmitter emitter,
    ISagaItemRepository itemRepository,
    ISagaItemTerminalReader terminalReader,
    SagaOptions options,                       // the instance AddWhizbangSagas registered
    ILogger<ImportSagaService> logger)
  : BaseSagaService<ImportInitiated, ImportItemsDispatched, ImportItemStarted, ImportItemCompleted,
                    ImportItemFailed, ImportCompleted, ImportReset, ImportHookStarted, ImportHookCompleted>(
      "import", emitter, itemRepository, terminalReader, options, logger) {
  // Build*Event overrides and LoadProjectionAsync as before.
}
```

{verified: SagaItemStreamIdDeriverTests.For_OptionsNotRegisteredByAContainer_OrNone_UseTheProcessWideNamespaceAsync, SagaItemStreamIdDeriverTests.ProcessWide_DerivesUnderTheNamespaceItReportsAsync, SagaItemStreamIdDeriverTests.Constructor_WithoutOptions_ThrowsAsync, SagaItemStreamIdDeriverTests.Reconciler_WithADeriver_ChecksTheStreamsItDerivesAsync, SagaItemStreamIdDeriverTests.Reconciler_WithoutADeriver_ThrowsAsync}

**Upgrading.** Nothing changes for a process that builds one host, and a single-host deployment derives the
same ids as before. To be safe in a process with several hosts:

- Replace `SagaItemStreams.Of(sagaId, itemIdentifier)` in code that runs inside a host with an injected
  `ISagaItemStreamIdDeriver`.
- Pass the deriver to `SagaItemCompletionReconciler.ResolveCompletionCountsAsync` and
  `ReconcileTerminalCountsAsync` when you call them yourself.
- A hand-written saga that uses the constructor without options (or builds its own `SagaOptions`) should
  take `SagaOptions` from the container and pass it through, as above.

### Atomic terminal-event emission

When all items reach a terminal state, **N concurrent terminal handlers** may each conclude "I'm the last one" and try to emit `CompletedEvent`. The naive `if (!alreadyEmitted) PublishAsync(...)` has a check-to-commit window that collapses N duplicates to a few — but never to one.

`BaseSagaService.CompleteSagaAsync` builds its claim key via `SagaCompletionGuard.ClaimKey` — the convention `"saga-completed:{sagaName}:{sagaId}"` — and calls `ISagaEventEmitter.PublishOnceAsync(claimKey, evt, ct)`; the default `DispatcherSagaEventEmitter` forwards to `IDispatcher.PublishOnceAsync`. (`SagaCompletionGuard.EmitOnceAsync` packages the same idiom for callers holding an `IDispatcher` directly.) The dispatcher's atomic `INSERT … ON CONFLICT DO NOTHING` against `wh_unique_emission_claims` gives **exactly-one** emission by construction. See [PublishOnceAsync](../dispatcher/publish-once) for the underlying mechanism.

### Stranded-row reconciliation {#stranded-row-reconciliation}

Per-item projection rows can still be left in a non-terminal state by a cross-pod lost-update: two pods apply the same per-item stream and a stale `ItemStartedEvent` write lands after the `ItemCompletedEvent` write, reverting the row to `Running` even though the terminal event committed to `wh_event_store`.

`SagaItemCompletionReconciler.ResolveCompletionCountsAsync` walks the projection's non-terminal items and consults the durable event store via `ISagaItemTerminalReader`. If every item is terminal in the store, it returns the reconciled `(completed, failed)` counts; otherwise null (genuinely in progress). Saga completion handlers should call this on the slow path so a single stranded row doesn't strand the entire saga forever.

Both `ResolveCompletionCountsAsync` and `ReconcileTerminalCountsAsync` have an overload that takes an
`ISagaItemStreamIdDeriver`; pass your host's, so the store is asked about the streams this host writes (see
[each host derives under its own namespace](#per-item-stream-namespace-per-host)). The overloads without one
derive under the process-wide namespace.

### Dashboard live-progress resolvers

`SagaLiveProgressResolvers` ships three helpers backing every saga dashboard's `processedCount` / `failedCount` / `progressPercent` GraphQL/REST resolvers:

```csharp{
title: "Wire a saga live-progress resolver"
description: "Delegates a dashboard's processedCount resolver to SagaLiveProgressResolvers, which reads the live GROUP BY aggregate while running and short-circuits to stored counters once the saga is terminal."
framework: "NET10"
category: "Sagas"
difficulty: "INTERMEDIATE"
tags: ["sagas", "dashboard", "live-progress", "resolvers", "graphql"]
tests: ["SagaLiveProgressResolversTests.ResolveProcessedCount_Running_ReadsFromRepoAggregateAsync", "SagaLiveProgressResolversTests.ResolveProcessedCount_Terminal_ReturnsStoredAndDoesNotCallRepoAsync"]
}
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

```csharp{title="Skip hooks" unverified="consumer-authored saga declaration; the generator's hook-omission behavior is exercised by SagaGeneratorSmokeTests, which is outside the current coverage map"}
[Saga<AcmeEventBase>("BulkOrderImport", IncludeHooks = false)]
public partial class BulkOrderImportSaga;
// Generator omits HookStartedEvent + HookCompletedEvent, stubs the
// Service's BuildHook*Event overrides to throw InvalidOperationException.
```

```csharp{title="Custom Service class" unverified="consumer-authored custom Service subclass — illustrative override, not framework code under test"}
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

```csharp{title="Extra per-event payload via partial class" unverified="consumer-authored partial-class payload extension — illustrative, not a behavior under test"}
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

The item-identifier mechanism already supports nesting. A parent saga's `ItemIdentifier` is a child saga's id; when the child completes, a cross-saga receptor marks the parent's item terminal via `UpdateItemAsync` / `FailItemAsync`:

```csharp{title="Parent observes children" unverified="consumer-authored nested-saga pattern illustration; the UpdateItemAsync / FailItemAsync calls it uses are covered by BaseSagaServiceTests, but this receptor is user-domain code"}
public class ChildSagaCompletedReceptor(ParentSaga.Service parent) :
    IReceptor<ChildSaga.CompletedEvent> {
  public async ValueTask HandleAsync(ChildSaga.CompletedEvent e, CancellationToken ct) {
    // CompletedEvent carries EntityId (the identity the child saga was initiated
    // with) — initiate child sagas with EntityId == child saga id (the common 1:1
    // shape) so the parent can key its item on it.
    var childSagaId = e.EntityId;
    var parentSagaId = ResolveParent(childSagaId);
    var parentCtx = new SagaContext(parentSagaId, parentEntityId);
    if (e.FinalStatus is SagaStatus.Completed) {
      await parent.UpdateItemAsync(parentCtx, childSagaId.ToString(), SagaItemState.Completed, displayName: null, ct);
    } else {
      await parent.FailItemAsync(parentCtx, childSagaId.ToString(), $"Child saga {e.FinalStatus}", null, displayName: null, ct);
    }
  }
}
```

No framework-level child concept is required. Each level uses the same `BaseSagaService` API. `SagaItemCompletionReconciler` handles "did the child actually finish?" via event-store truth at each level.

### Compensation

Whizbang.Sagas does NOT automatically execute compensation. The right ordering is irreducibly domain-specific: refund before un-archive, or the reverse, depending on the workflow. What it does provide is the decision. A saga that declares `[SignalsOutcome]` is committed or rolled back exactly once, whichever way it ends, and your receptors on `SagaRolledBackEvent` run the compensation. See [Saga Commit and Rollback](./commit-rollback.md) for the signal and the stage-then-apply design that keeps compensation cheap.

Mark your compensation events with the `ISagaCompensatingEvent` marker interface so visualization and audit tooling can group them apart from forward-path work:

```csharp{
title: "Mark a saga compensation event"
description: "Tags a domain event with ISagaCompensatingEvent so audit and visualization tooling can group compensation actions, while the domain wires its own receptor chain to execute them."
framework: "NET10"
category: "Sagas"
difficulty: "ADVANCED"
tags: ["sagas", "compensation", "saga-orchestration", "events", "audit"]
unverified: "consumer-authored compensation event; the framework ships the ISagaCompensatingEvent marker only and does not execute compensation — no behavior under test"
}
public class RefundPaymentEvent : AcmeEventBase, ISagaCompensatingEvent {
  public Guid CompensatingForSagaId { get; set; }
  public decimal Amount { get; set; }
  // ... domain payload
}
```

### Hook bookends (Rule 17)

Long-running setup or teardown work (warm a cache, write a manifest, send a notification) sits alongside items as first-class "hook" entries on the saga projection:

```csharp{title="Run a hook" unverified="consumer usage of TryRunHookAsync; no in-map service-level hook-run test (SagaHookApplyHelperTests covers only the Apply-side hook helpers)"}
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
- **Exactly-once emission lives at the dispatcher.** `PublishOnceAsync` is used only for emissions that racing terminal callers must collapse to one: the completion, the abandonment, each continuation request and the commit-or-rollback signal, each under its own claim key. Every other lifecycle event is a plain publish.

## Related

- [Completion Orchestration & Adaptive Watchdog](./completion-orchestration) — how a saga actually closes: per-item event-driven completion path + the progress-rate-based watchdog safety net.
- [Saga Commit and Rollback](./commit-rollback) — the exactly-once outcome signal a saga's compensation runs from.
- [PublishOnceAsync](../dispatcher/publish-once) — the dispatcher-level exactly-once primitive `SagaCompletionGuard` wraps.
- [Dispatcher Deep Dive](../dispatcher/dispatcher) — the broader `IDispatcher` API surface.
- [Collective Events](../messaging/collective-events) — for the orthogonal "one event mutates a set of streams" pattern.
