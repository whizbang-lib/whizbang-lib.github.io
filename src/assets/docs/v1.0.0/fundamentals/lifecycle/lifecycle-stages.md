---
title: Lifecycle Stages
pageType: reference
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Core Concepts
order: 9
description: >-
  Complete reference for all lifecycle stages in Whizbang message processing
  pipeline - timing, guarantees, and use cases
tags: 'lifecycle, stages, hooks, message-processing, timing, coordinator'
codeReferences:
  - src/Whizbang.Core/Messaging/LifecycleStage.cs
  - src/Whizbang.Core/Messaging/FireAtAttribute.cs
  - src/Whizbang.Core/Messaging/IReceptorInvoker.cs
  - src/Whizbang.Core/Messaging/IReceptorRegistry.cs
  - src/Whizbang.Core/Lifecycle/ILifecycleCoordinator.cs
  - src/Whizbang.Core/Lifecycle/ILifecycleTracking.cs
  - src/Whizbang.Core/Dispatcher.cs
  - src/Whizbang.Core/Workers/OutboxPublishWorker.cs
  - src/Whizbang.Core/Messaging/WorkCoordinatorFlushHelper.cs
  - src/Whizbang.Core/Workers/InboxDispatchWorker.cs
  - src/Whizbang.Core/Workers/TransportConsumerWorker.cs
  - src/Whizbang.Generators/Templates/PerspectiveRunnerTemplate.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
  - src/Whizbang.Core/Workers/MaintenanceWorker.cs
  - src/Whizbang.Core/Lifecycle/DestructionStageReceptors.cs
  - src/Whizbang.Core/Lifecycle/StreamCloser.cs
testReferences:
  - tests/Whizbang.Core.Tests/Messaging/LifecycleStageTests.cs
  - tests/Whizbang.Core.Tests/Messaging/LifecycleStageExtensionsTests.cs
  - tests/Whizbang.Core.Tests/Messaging/LocalImmediateLifecycleStageTests.cs
  - tests/Whizbang.Core.Tests/Messaging/ReceptorInvokerTests.cs
  - tests/Whizbang.Core.Component.Tests/Lifecycle/LifecycleCoordinatorTests.cs
  - tests/Whizbang.Core.Tests/Workers/PerspectiveWorkerPostLifecycleTests.cs
  - tests/Whizbang.Core.Tests/Workers/TransportConsumerWorkerPostLifecycleTests.cs
  - tests/Whizbang.Core.Tests/Workers/MaintenanceWorkerDestructionHookTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/DestructionStageReceptorComponentTests.cs
  - tests/Whizbang.Core.Component.Tests/Lifecycle/StreamCloserDestructionStageComponentTests.cs
  - tests/Whizbang.Core.Component.Tests/Dispatcher/PostLifecycleOncePerHandlingServiceComponentTests.cs
  - tests/Whizbang.Generators.Tests/ReceptorDiscoveryGeneratorTests.cs
  - tests/Whizbang.Core.Component.Tests/Messaging/DistributeStageOwnedCommandSendComponentTests.cs
  - tests/Whizbang.Core.Component.Tests/Messaging/LifecycleInvocationHelperTests.cs
lastMaintainedCommit: '01f07906'
---

# Lifecycle Stages

Whizbang provides lifecycle stages where custom logic can execute during message processing. Lifecycle stages enable observability, metrics collection, test synchronization, and custom side effects without modifying core framework code.

:::updated
The [Lifecycle Coordinator](lifecycle-coordinator.md) now manages all stage transitions, guaranteeing each stage fires **exactly once per event**. Tags fire at every stage as lifecycle observers.
:::

## Core Concept

Messages flow through **two paths**, and one dispatch can take both: local stages fire whenever this service handles the message in-process, and the distributed stages fire for its outbox copy. The [dispatch policy](../dispatcher/dispatch-policy.md) decides which a call takes:

### Local Path (Mediator Pattern)

```mermaid{caption="Local (mediator) path — LocalInvokeAsync processes the message immediately at the LocalImmediate stage, with no persistence and no transport."}
graph LR
    A[LocalInvokeAsync] --> B[LocalImmediate]
    B --> C[Done]

    style A fill:#e1f5ff
    style B fill:#d4edda
    style C fill:#f0f0f0
```

**Local dispatch** (`LocalInvokeAsync`) acts as an in-memory mediator - no persistence, no transport. Messages are processed immediately.

### Distributed Path (Outbox/Inbox)

```mermaid{caption="Distributed (outbox/inbox) path — a dispatched message is persisted to the outbox, published via transport, received into the inbox, then processed by perspectives on the receiver side."}
graph LR
    A[Dispatch] --> B[Distribute]
    B --> C[Outbox]
    C --> D[Transport]
    D --> E[Inbox]
    E --> F[Perspective]

    style A fill:#e1f5ff
    style B fill:#fff4e1
    style C fill:#ffe1e1
    style D fill:#f0f0f0
    style E fill:#e1ffe1
    style F fill:#f5e1ff
```

**Distributed dispatch** persists to outbox, publishes via transport (RabbitMQ, Service Bus), and processes in inbox on receiver side.

## Stage Semantics {#stage-semantics}

Every stage name answers two questions: what triggers the stage, and whether anything waits for it. A receptor only ever describes what happens in the service that declares it. Another service handles the same message with its own receptors.

**Immediate** stages are tied to handling the message, not to a step in the pipeline:
- They fire in the process that handles the message, at the moment it is handled.
- There is no durable hop in between: no outbox, transport or inbox between the trigger and the receptor.
- If the process dies, an immediate stage that had not run is lost. Nothing retries it.

**Non-immediate** stages are tied to a step in the durable pipeline as the message passes through this service: written to the outbox, published, received, projected, lifecycle complete.
- They fire when the message reaches that step in this service.
- They are tied to a stored record, so they are retried if the process fails.

**Inline**:
- Whoever fires the stage waits for it: the caller on local dispatch, or the worker on a pipeline stage.
- It runs in the same scope and unit of work.
- An exception fails that unit: the caller sees it, or the message is retried.
- It finishes before the next stage starts.

**Detached**:
- Nobody waits for it, and it runs in its own scope.
- An exception is logged or reported and never fails the message.
- It is not ordered against the next stage, and the caller may get control back first.

| Stage | What to expect |
|-------|----------------|
| `LocalImmediateInline` | The handler runs in the caller's process. The caller waits and gets the result or the exception. |
| `LocalImmediateDetached` | Runs in the caller's process in its own scope. The caller does not wait, and errors never reach the caller. |
| `ImmediateDetached` | Runs once in each service that handles the message, right after the handler, whether it was handled locally or on receipt. Nobody waits for it, and its errors never affect the message. For timing, metrics and activity tracking. |
| Pipeline stages (`PreOutbox*`, `PostInbox*`, `*Perspective*`, `PostLifecycle*`, and the rest) | Fire when the message reaches that step in this service, durably and with retries, with the Inline or Detached behavior above. |


---

## Local and Distributed Paths

:::updated
A dispatch is not either/or. Local stages fire whenever this service handles a message in-process, whether or not the message also goes to the outbox; the distributed stages fire for the outbox copy. The [dispatch policy](../dispatcher/dispatch-policy.md#decision-table) decides, per call, whether a message runs here, goes out, or both.
:::

| Path | When | Default Stages | Persistence |
|------|------|---------------|-------------|
| **Local** | this service handles the message in-process (`LocalInvokeAsync`, or a `SendAsync`/`PublishAsync`/cascade it has a handler for) | `LocalImmediateInline` | ❌ None (in-process) |
| **Distributed** | the message is written to the outbox and delivered through the transport | `PostInboxDetached` (receiver) | ✅ Outbox/Inbox |

Receptors **without** `[FireAt]` are registered at `LocalImmediateInline` + `PostInboxDetached` (locked by generator tests). A receptor declared `[FireAt(LocalImmediateInline)]` is a local handler, like a default one. A receptor declared `[FireAt(LocalImmediateDetached)]` is a hook that starts in the background after the handler whenever this service handles the message in-process. There is no default sender-side outbox stage.

**Key Points**:
- A message this service handles **and** sends out takes both paths; its outbox copy is marked as handled here, so this service does not run it again when its own copy comes back
- Default receptors (no `[FireAt]`) fire once per service that handles the message
- `[FireAt]` attributes opt into specific stages and OUT of default behavior

## When Each Stage Fires {#when-each-stage-fires}

Which stages a message reaches depends on its direction relative to the service you are looking at:

- **Internal**: this service dispatches the message and handles it in-process (`LocalInvokeAsync`, or a `SendAsync`/`PublishAsync` with a local receptor).
- **Egress**: this service writes the message to its outbox for other services.
- **Ingress**: the message arrives from another service through the transport and inbox.

| Stage | Internal | Egress (sender) | Ingress (receiver) |
|-------|----------|-----------------|--------------------|
| `LocalImmediateInline` | ✅ the local handler | — | — |
| `LocalImmediateDetached` | ✅ hooks, after the local handler, not waited for | — | — |
| `ImmediateDetached` | ✅ once, after the local receptor | — | ✅ once, after PostInbox |
| `PreDistribute*` / `DistributeDetached` / `PostDistribute*` | — | ✅ | — |
| `PreOutbox*` / `PostOutbox*` | — | ✅ (see the skips below) | — |
| `PreInbox*` / `PostInbox*` | — | — | ✅ |
| `PrePerspective*` / `PostPerspective*` / `PostAllPerspectives*` | events with perspectives, on the service that stores them | — | events with perspectives |
| `PostLifecycle*` | ✅ every local run, once per handling service | — | ✅ |

**Where a receptor is registered**:

| Receptor | Registered at |
|----------|---------------|
| Generated, no `[FireAt]` | `LocalImmediateInline` and `PostInboxDetached`. Never at an outbox stage, so a plain receptor does not run on the sender when a message only passes through its outbox. |
| Generated, `[FireAt(X)]` | stage `X` only |
| Runtime (`IReceptorRegistry.Register`) | the stage it names. A runtime registration at `LocalImmediateInline` is the message's local handler for `SendAsync`, `SendManyAsync` and every `LocalInvokeAsync` overload when no generated receptor exists; a generated receptor always wins. One at `LocalImmediateDetached` is a hook started after the handler. |

**When the outbox stages are skipped**. `PreOutbox*` and `PostOutbox*` run only for a message that is in the outbox, and the invoker skips some of those:

| Message | Outbox stages |
|---------|---------------|
| An unowned command `SendAsync` handles locally | ✅ written as a copy marked as handled here (`DispatchModes.Both`) |
| An owned command (`RoutingOptions.OwnDomains`) | never written; with no local handler `SendAsync` throws `ReceptorNotFoundException` |
| An event-store-only message (no destination) | none |
| An event `PublishAsync` sends, owned or not | ✅ |
| A [system command](../dispatcher/routing.md#system-commands) | ✅ always, even when handled locally |
| A copy marked as handled here (`DispatchModes.LocalDispatch`): any send, publish, batch or cascade this service also handled | PreOutbox skips only a receptor that already ran locally: a runtime registration also registered at a local stage, or a generated receptor whose double-fire guard already recorded it. A receptor registered only at PreOutbox, which observes the outbox, still runs |
| With owned domains configured: an owned command, or an event another service owns | PreOutbox skips it |

On ingress, `PostInbox*` skips a message this same service published: its handler already ran when it was dispatched. A scheduled copy whose local handling was deferred (`LocalDeferred`) is the exception: this service handles it when it comes back.

On ingress, an event no perspective in this service folds runs through `PostAllPerspectives*` and `PostLifecycle*` on receipt. A [collective event](../messaging/collective-events.md#post-perspective-stages-once) received by a service that runs the collective sink is the exception: the sink fires those stages once per event, after its apply commits, and the receive path leaves them to it.

At each stage, **lifecycle receptors** can execute to:
- Track metrics and telemetry
- Log diagnostic information
- Synchronize integration tests
- Trigger custom business logic
- Implement cross-cutting concerns

---

## All 28 Lifecycle Stages

:::updated
The `LifecycleStage` enum contains 29 values total: 28 true lifecycle stages plus one special value (`AfterReceptorCompletion = -1`). `AfterReceptorCompletion` is **not** a true lifecycle stage — it is a hook that fires synchronously after a receptor completes in the Dispatcher, before any lifecycle stages are invoked. It exists as the default for backward compatibility with tag hooks.
:::

### Immediate Stage

#### `ImmediateDetached`

**Timing**: Once per message on each service that handles it, right after its handler: after the business receptor on local dispatch, after the PostInbox stage on a service receiving the message from the transport.

**Use Cases**:
- Log command execution timing
- Track user activity
- Record metrics without blocking dispatch

**Guarantees**:
- Fires exactly once per message per handling service, for every `SendAsync` and `LocalInvokeAsync` overload, with or without the [Lifecycle Coordinator](lifecycle-coordinator.md)
- Never re-fired after a later stage, and never fired on a service that only forwards the message (the outbox stages) or projects it (the perspective stages)
- Detached: nobody waits for it, and its errors never fail the message (see [Stage Semantics](#stage-semantics))

:::updated
Before 1.0 the dispatcher awaited `ImmediateDetached` before local dispatch returned, so a receptor's exception reached the caller, and a receiving service with no `PostInboxDetached` receptor ran it inline in the inbox unit of work ([#1393](https://github.com/whizbang-lib/whizbang/issues/1393)). A test that counts its invocations waits for a signal from the receptor, not for the dispatch to return.
:::

:::updated
In earlier releases `ImmediateDetached` also re-fired after each lifecycle stage: after each PostLifecycle stage on local dispatch, after every stage the coordinator advanced, and after each worker stage. A receptor declared `[ReceptorIdempotent]`, which bypasses the double-fire guard, ran up to three times for one `LocalInvokeAsync`.
:::

**Example**:
```csharp{title="`ImmediateDetached`" description="ImmediateDetached" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lifecycle", "ImmediateDetached"] tests=["ReceptorDiscoveryGeneratorTests.Generator_ReceptorWithFireAt_RegisteredOnlyAtSpecifiedStageAsync", "LifecycleCoordinatorTests.AdvanceTo_DoesNotFireImmediateDetached_AfterTheStageAsync", "ImmediateDetachedOncePerDispatchComponentTests.OneLocalDispatch_FiresImmediateDetachedExactlyOnceAsync", "ImmediateDetachedOncePerDispatchComponentTests.ALocalDispatch_ReturnsWithoutWaitingForImmediateDetachedAsync", "ImmediateDetachedOncePerDispatchComponentTests.AnImmediateDetachedFailure_NeverReachesTheCallerAsync", "InboxDispatchWorkerBranchCoverageTests.ImmediateDetached_WithOnlyAnInlineHandler_RunsOutsideTheUnitOfWorkAndNeverFailsTheMessageAsync", "LifecycleStageTests.LifecycleStage_ImmediateDetached_IsDefinedAsync"]}
[FireAt(LifecycleStage.ImmediateDetached)]
public class CommandMetricsReceptor : IReceptor<ICommand> {
    private readonly IMetricsCollector _metrics;

    public ValueTask HandleAsync(ICommand cmd, CancellationToken ct = default) {
        _metrics.RecordCommand(cmd.GetType().Name);
        return ValueTask.CompletedTask;
    }
}
```

---

### LocalImmediate Stages (2 stages) ⭐ NEW

:::new
LocalImmediate stages are new in v1.0.0 and enable in-memory mediator-style message handling.
:::

#### `LocalImmediateDetached`

**Timing**: After the local handler, whenever this service handles the message in-process (a send, publish, local invoke, batch or cascade it has a handler for), whether or not the message also goes to the outbox.

**Use Cases**:
- Fire-and-forget side effects of handling a message here: metrics, notifications, cache warming
- Work the caller should not wait for

**Guarantees**:
- **Detached**: runs in its own scope after the handler, and the caller does not wait for it (see [Stage Semantics](#stage-semantics))
- **A hook, not a handler**: a message whose only local receptor is declared here has no local handler, so the hook does not run for it
- Errors are logged and never reach the caller

:::updated
Before 1.0 a receptor without `[FireAt]` was registered here and the caller waited for it, which is the Inline behavior, so an explicit `[FireAt(LocalImmediateDetached)]` receptor was awaited as a second handler ([#1392](https://github.com/whizbang-lib/whizbang/issues/1392)). Default receptors are now registered at `LocalImmediateInline`, and a receptor that used `LocalImmediateDetached` as its message's only handler should drop the attribute or declare `LocalImmediateInline`.
:::

**Example**:
```csharp{title="`LocalImmediateDetached`" description="A hook that runs in the background after the local handler" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lifecycle", "LocalImmediateDetached"] tests=["LocalImmediateDetachedHookComponentTests.ALocalDispatch_ReturnsWithoutWaitingForALocalImmediateDetachedHookAsync", "LocalImmediateDetachedHookComponentTests.ALocalImmediateDetachedHookFailure_NeverReachesTheCallerAsync", "ReceptorDiscoveryGeneratorTests.Generator_LocalImmediateDetachedReceptor_IsRegisteredAtItsStage_AndNeverAwaitedAsAHandlerAsync", "LifecycleStageTests.LifecycleStage_LocalImmediateDetached_IsDefinedAsync"]}
// The handler: no [FireAt], so LocalImmediateInline. The caller waits for it.
public class CreateTenantCommandHandler : IReceptor<CreateTenantCommand, TenantCreatedEvent> {
    public async ValueTask<TenantCreatedEvent> HandleAsync(CreateTenantCommand cmd, CancellationToken ct = default) {
        var tenant = new Tenant(cmd.Name);
        await _dbContext.Tenants.AddAsync(tenant, ct);
        return new TenantCreatedEvent(tenant.Id);
    }
}

// A hook: starts after the handler, in its own scope. Nobody waits for it.
[FireAt(LifecycleStage.LocalImmediateDetached)]
public class WarmTenantCache : IReceptor<CreateTenantCommand> {
    public async ValueTask HandleAsync(CreateTenantCommand cmd, CancellationToken ct = default) {
        await _cache.WarmAsync(cmd.Name, ct);
    }
}
```

#### `LocalImmediateInline` ⭐ **Default Stage for Local Path**

**Timing**: Whenever this service handles the message in-process. The caller waits for it.

**Use Cases**:
- **Default receptors** (receptors WITHOUT `[FireAt]` are registered here for locally-dispatched messages)
- In-memory mediator workflows: the handler's result is returned to `LocalInvokeAsync`
- Validation that must complete before dispatch returns

**Guarantees**:
- **Blocking**: the dispatch waits for completion
- **NO persistence** of its own: the stage does not write to the outbox or inbox
- Errors propagate to the caller

**Example**:
```csharp{title="`LocalImmediateInline`" description="LocalImmediateInline" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lifecycle", "LocalImmediateInline"] tests=["ReceptorDiscoveryGeneratorTests.Generator_ReceptorWithoutFireAt_RegisteredAtDefaultStagesAsync", "LocalImmediateDetachedHookComponentTests.ALocalInvokeForAResult_ReturnsTheHandlersResult_NotTheHooksAsync"]}
// Receptor WITHOUT [FireAt] is registered at LocalImmediateInline: the caller waits and gets its result
public class GetTenantHandler : IReceptor<GetTenant, TenantView> {
    public ValueTask<TenantView> HandleAsync(GetTenant query, CancellationToken ct = default) =>
        ValueTask.FromResult(_views.Find(query.TenantId));
}

var view = await dispatcher.LocalInvokeAsync<GetTenant, TenantView>(new GetTenant(tenantId));
```

---

### Distribute Stages (5 stages)

The five Distribute stages fire on every work-coordinator flush, around the flush's store calls: `PreDistributeDetached` and `PreDistributeInline` before the outbox and inbox rows are stored, `DistributeDetached` alongside the store, and `PostDistributeDetached` and `PostDistributeInline` after it. They fire for both the outbox (publishing) and inbox (consuming) messages in the flush; use `MessageSource` to tell them apart. A flush that skips lifecycle (the framework's own internal flushes) fires none of them.

#### `PreDistributeDetached`

**Timing**: Before the flush's store calls (fire-and-forget, own scope).

**Use Cases**:
- Non-critical logging before batch distribution
- Async metrics collection
- Pre-distribution notifications

**Guarantees**:
- Detached - fire-and-forget, runs in its own scope
- Errors are logged but don't affect distribution
- May still be running when distribution occurs

#### `PreDistributeInline`

**Timing**: Before the flush's store calls.

**Use Cases**:
- Pre-processing before batch distribution
- Validation before work coordination

**Guarantees**:
- Blocking - blocks the unit of work (not the entire queue) until completion
- Runs before any work is sent to coordinator

#### `DistributeDetached`

**Timing**: In parallel with the flush's store calls (fire-and-forget).

**Use Cases**:
- Side effects that don't need to block (notifications, caching)
- Fire-and-forget operations
- Background metrics collection

**Guarantees**:
- Detached - fire-and-forget, runs in its own scope
- Errors are logged but don't affect distribution
- May complete after distribution finishes

#### `PostDistributeDetached`

**Timing**: After the flush's store calls return (fire-and-forget, own scope).

**Use Cases**:
- Post-distribution metrics
- Cleanup operations
- Async notifications

**Guarantees**:
- Detached - fire-and-forget, runs in its own scope
- Errors are logged but don't affect next steps
- Work has been queued to coordinator

#### `PostDistributeInline`

**Timing**: After the flush's store calls return (blocking).

**Use Cases**:
- Synchronization points in tests
- Critical post-distribution validation

**Guarantees**:
- Blocking - next step waits for completion
- Work has been queued to coordinator

---

### Outbox Stages (4 stages)

#### `PreOutboxDetached`

**Timing**: Before publishing message to transport (fire-and-forget, own scope).

**Use Cases**:
- Async logging of outbound messages
- Non-critical metrics

**Guarantees**:
- Detached - fire-and-forget, does not block the outbox worker
- Message may already be sent when receptor completes

#### `PreOutboxInline`

**Timing**: Before publishing message to transport (Service Bus, RabbitMQ, etc.).

**Use Cases**:
- Pre-publish validation and authorization checks
- Message enrichment
- Transport-specific preparation

**Guarantees**:
- **Blocking** - publish waits for completion
- Message not yet sent to transport

#### `PostOutboxDetached`

**Timing**: After message published to transport (fire-and-forget, own scope).

**Use Cases**:
- Delivery confirmation logging
- Success metrics

**Guarantees**:
- Detached - fire-and-forget, does not block the outbox worker
- Message successfully published to transport

#### `PostOutboxInline`

**Timing**: After message published to transport (blocking).

**Use Cases**:
- Test synchronization for message publishing
- Critical post-publish operations

**Guarantees**:
- Blocking
- Message successfully published to transport

---

### Inbox Stages (4 stages)

#### `PreInboxDetached`

**Timing**: Before the received message is processed by local receptors (fire-and-forget, own scope).

**Use Cases**:
- Async logging of inbound messages
- Non-critical metrics

**Guarantees**:
- Detached - fire-and-forget, does not block the inbox worker
- Receptor may complete before this stage finishes

#### `PreInboxInline`

**Timing**: Before invoking local receptor for received message.

**Use Cases**:
- Pre-processing received messages
- Validation before handler invocation
- Message deduplication checks

**Guarantees**:
- Blocking - receptor invocation waits
- Message received from transport but not yet processed

#### `PostInboxDetached` ⭐ **Default Stage for Distributed Receiver**

**Timing**: After the received message is processed and stored (fire-and-forget, own scope).

**Use Cases**:
- **Default receptors** (receptors WITHOUT `[FireAt]` fire here for messages arriving from other services!)
- Post-processing metrics
- Success logging, cleanup, notifications

**Guarantees**:
- Detached - fire-and-forget, does not block the inbox worker
- Fires after event storage
- **Default stage** for receptors WITHOUT `[FireAt]` on the distributed path (receiver side); source-service filtering skips it for messages this service dispatched itself (those already fired at `LocalImmediateDetached`)

#### `PostInboxInline`

**Timing**: After message received from transport and stored (blocking).

**Use Cases**:
- Test synchronization for message reception
- Critical post-processing, saga completion

**Guarantees**:
- **Blocking** - completion waits for all handlers
- Message stored and deduplicated

---

### Perspective Stages (4 stages)

:::new
Perspective lifecycle stages are new in v1.0.0 and enable deterministic test synchronization.
:::

#### `PrePerspectiveDetached`

**Timing**: Before the perspective processes the batch (fire-and-forget, own scope).

**Use Cases**:
- Async logging
- Non-critical metrics

**Guarantees**:
- Detached - fire-and-forget, does not block the perspective worker
- Fires once per batch, not per event
- Perspective may complete before this stage finishes

**Hook Location**: Generated perspective runner (from `PerspectiveRunnerTemplate.cs`) before event processing loop begins

#### `PrePerspectiveInline`

**Timing**: Before the perspective processes the batch, blocking.

**Use Cases**:
- Pre-processing before perspective updates
- Checkpoint validation
- Event enrichment

**Guarantees**:
- Blocking - perspective processing waits
- Fires once per batch, not per event
- No events processed yet

**Hook Location**: Generated perspective runner (from `PerspectiveRunnerTemplate.cs`) before event processing loop begins

#### `PostPerspectiveDetached`

**Timing**: After perspective data is flushed, before the checkpoint is committed (fire-and-forget, own scope).

**Use Cases**:
- Early non-blocking notification (data committed but checkpoint not yet saved)
- Post-processing metrics
- Event logging, custom indexing

**Guarantees**:
- Detached - fire-and-forget, does not block the perspective worker
- Perspective data writes are flushed
- Checkpoint not yet committed

**Hook Location**: Generated perspective runner (from `PerspectiveRunnerTemplate.cs`) after perspective data is flushed, before checkpoint save

**Example**:
```csharp{title="`PostPerspectiveDetached`" description="PostPerspectiveDetached" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lifecycle", "PostPerspectiveDetached"] tests=["ReceptorDiscoveryGeneratorTests.Generator_ReceptorWithFireAt_RegisteredOnlyAtSpecifiedStageAsync", "LifecycleCoordinatorTests.AdvanceTo_SetsCorrectContextProperties_OnReceptorInvocationAsync", "LifecycleStageTests.LifecycleStage_PostPerspectiveDetached_IsDefinedAsync"]}
[FireAt(LifecycleStage.PostPerspectiveDetached)]
public class PerspectiveMetricsReceptor : IReceptor<IEvent> {
    private readonly IMetricsCollector _metrics;

    public ValueTask HandleAsync(IEvent evt, CancellationToken ct = default) {
        _metrics.RecordPerspectiveUpdate(evt.GetType().Name);
        return ValueTask.CompletedTask;
    }
}
```

#### `PostPerspectiveInline` ⭐ **Critical for Testing**

**Timing**: After perspective data AND checkpoint are committed (blocking).

**Use Cases**:
- **Test synchronization** - wait for perspective data to be saved
- Critical derived updates, cross-perspective consistency

**Guarantees**:
- **Blocking** - perspective processing for this unit waits for completion
- Perspective has processed all events in the unit
- **Database writes are committed** - safe to query perspective data
- **Checkpoint is committed** - both data and checkpoint are durable

**Hook Location**: `PerspectiveWorker.cs` - fires after the checkpoint commits (the generated runner tracks processed envelopes so the worker can fire this per processed event)

**Example** (Test Synchronization):
```csharp{title="`PostPerspectiveInline` ⭐ **Critical for Testing**" description="Example (Test Synchronization):" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lifecycle", "PostPerspectiveInline", "**Critical"] tests=["ReceptorDiscoveryGeneratorTests.Generator_ReceptorWithFireAt_RegisteredOnlyAtSpecifiedStageAsync", "LifecycleStageTests.LifecycleStage_PostPerspectiveInline_IsDefinedAsync"]}
[FireAt(LifecycleStage.PostPerspectiveInline)]
public class PerspectiveCompletionReceptor<TEvent> : IReceptor<TEvent>
    where TEvent : IEvent {

    private readonly TaskCompletionSource<bool> _completion;

    public ValueTask HandleAsync(TEvent evt, CancellationToken ct = default) {
        _completion.SetResult(true);  // Signal test to proceed
        return ValueTask.CompletedTask;
    }
}
```

See [Lifecycle Synchronization](../../operations/testing/lifecycle-synchronization.md) for complete test patterns.

---

### PostAllPerspectives Stages (2 stages)

:::new
PostAllPerspectives stages are new in v1.0.0 and fire **once per event** after **all** perspectives have finished processing it. They sit between PostPerspective (per-perspective) and PostLifecycle (end-of-lifecycle) in the pipeline.
:::

#### `PostAllPerspectivesDetached`

**Timing**: After ALL perspectives have completed processing this event (WhenAll pattern), before PostLifecycle stages. Fire-and-forget, own scope.

**Use Cases**:
- Cross-perspective aggregation that needs all perspective data committed
- Notifications that require all perspectives to be up-to-date
- Derived computations spanning multiple perspectives

**Guarantees**:
- **Fires exactly once per event** — managed by [Lifecycle Coordinator](lifecycle-coordinator.md) via WhenAll
- Detached — does not delay PostLifecycle
- All perspective checkpoints have been saved
- Fires **before** PostLifecycle stages

**Example**:
```csharp{title="`PostAllPerspectivesDetached`" description="Cross-perspective aggregation after all perspectives complete" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lifecycle", "PostAllPerspectivesDetached"] tests=["ReceptorDiscoveryGeneratorTests.Generator_PublishToReceptors_OmitsFireAtReceptorsAsync", "LifecycleCoordinatorTests.ExpectPerspectiveCompletions_AllSignal_ReturnsTrueAsync", "LifecycleCoordinatorTests.SignalPerspectiveComplete_ExtraUnrelatedSignal_DoesNotPreventCompletionAsync", "LifecycleStageTests.LifecycleStage_PostAllPerspectivesDetached_IsDefinedAsync"]}
[FireAt(LifecycleStage.PostAllPerspectivesDetached)]
public class CrossPerspectiveAggregator : IReceptor<OrderPlacedEvent> {
  private readonly IOrderSummaryService _summaryService;

  public async ValueTask HandleAsync(OrderPlacedEvent evt, CancellationToken ct = default) {
    // Safe to read all perspectives — every perspective has processed this event
    await _summaryService.RebuildSummaryAsync(evt.OrderId, ct);
  }
}
```

#### `PostAllPerspectivesInline`

**Timing**: Same as `PostAllPerspectivesDetached` but **blocking** — the worker waits for completion before proceeding to PostLifecycle.

**Use Cases**:
- Critical cross-perspective consistency checks
- Aggregation that must complete before PostLifecycle fires
- Test synchronization after all perspectives finish

**Guarantees**:
- **Fires exactly once per event** — managed by Lifecycle Coordinator via WhenAll
- **Blocking** — PostLifecycle stages wait for completion
- All perspective checkpoints have been saved

---

### PostLifecycle Stages (2 stages) {#post-lifecycle}

:::new
PostLifecycle stages are the **final stages** in an event's lifecycle, managed by the [Lifecycle Coordinator](lifecycle-coordinator.md).
:::

#### `PostLifecycleDetached`

**Timing**: After ALL processing completes for this event — all perspectives have processed it, or inbox processing is done (for events without perspectives), or local dispatch is complete. Fire-and-forget, own scope.

**Use Cases**:
- Final notifications (SignalR, email, push) — guaranteed to fire exactly once per event
- Cross-perspective aggregation
- Analytics and reporting
- Cleanup operations

**Guarantees**:
- **Fires exactly once per event in each service that handles it**, managed by [Lifecycle Coordinator](lifecycle-coordinator.md)
- **Fires on every local run, whichever call handled it**: `SendAsync`, `SendManyAsync`, `PublishAsync`, `PublishManyAsync`, `LocalInvokeAsync`, `LocalSendManyAsync` and a cascade's local run. Before 1.0 only `LocalInvokeAsync` fired it.
- Detached — does not delay the next batch
- For `Route.Both()` events, fires only after ALL paths complete ([WhenAll pattern](lifecycle-coordinator.md#whenall-pattern))
- Fired by whichever worker is the **last to act** on the event:

| Scenario | Who fires PostLifecycle |
|----------|----------------------|
| Local dispatch | Dispatcher |
| Local dispatch of a stored event a perspective on this service applies | PerspectiveWorker, after the apply (the local run leaves it to the worker, so it fires once) |
| Distributed, no perspectives | TransportConsumer |
| Distributed, with perspectives | PerspectiveWorker |
| `Route.Both()` | Last path to complete (WhenAll) |

**Example**:
```csharp{title="`PostLifecycleDetached`" description="Final notification after all processing completes" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lifecycle", "PostLifecycleDetached"] tests=["LifecycleCoordinatorTests.WhenAll_BothComplete_FiresPostLifecycleOnceAsync", "LifecycleCoordinatorTests.SignalSegmentComplete_NoWhenAll_FiresPostLifecycleImmediatelyAsync", "LifecycleCoordinatorTests.WhenAll_LocalAlone_DoesNotFirePostLifecycleDetachedAsync", "LifecycleStageTests.LifecycleStage_PostLifecycleDetached_IsDefinedAsync", "PostLifecycleOncePerHandlingServiceComponentTests.EveryLocalRun_FiresPostLifecycleExactlyOnceAsync", "PostLifecycleOncePerHandlingServiceComponentTests.AnEventAPerspectiveHereApplies_LeavesPostLifecycleToThePerspectiveWorkerOnlyWhenStoredAsync"]}
[FireAt(LifecycleStage.PostLifecycleDetached)]
public class OrderNotificationReceptor : IReceptor<OrderPlacedEvent> {
  private readonly INotificationService _notifications;

  public async ValueTask HandleAsync(OrderPlacedEvent evt, CancellationToken ct = default) {
    // Safe to send notification — all perspectives have processed the event
    // This fires exactly once, regardless of how many perspectives exist
    await _notifications.SendAsync($"Order {evt.OrderId} confirmed", ct);
  }
}
```

#### `PostLifecycleInline`

**Timing**: Same as `PostLifecycleDetached` but **blocking** — the worker waits for completion.

**Use Cases**:
- Critical final processing that must complete before the batch ends
- Guaranteed-delivery notifications
- Test synchronization for end-of-lifecycle events

**Guarantees**:
- **Fires exactly once per event** — managed by Lifecycle Coordinator
- **Blocking** — worker waits for all handlers to complete
- Same "last worker to act" semantics as `PostLifecycleDetached`

---

### Destruction Stages (4 stages) {#destruction}

:::updated
Destruction stages hook the destruction of stored events. Two operations destroy events, and both fire the stages around their delete:

- **The ephemeral reap.** The `MaintenanceWorker` reaper fires them around the physical delete of consumed, aged-past-grace ephemeral event bodies, once per maintenance cycle for the whole about-to-reap batch.
- **A period close.** `IStreamCloser.CloseAsync` fires them around the truncate of a stream's detail through the close version, for the events in that range (see [Closing a Stream's History](../events/event-streams#closing-a-stream)).

They reach two kinds of handler:

- **`[FireAt]` receptors** declared at a destruction stage, typed by the event they handle, like any other lifecycle receptor.
- **A registered `IDestructionHook`**, called once with the whole batch (the reap) or the whole stream (a close), which can also Cancel or Defer it.

With neither, the stages are inert and nothing extra is read.
:::

Both operations delete the stored events, so the events that have a destruction-stage receptor are **loaded before the delete**. The Pre stages get them before the delete; the Post stages get the same envelopes after it, when the stored data is already gone. Only events whose type has a destruction-stage receptor are loaded, and with no destruction-stage receptor registered at all, a close does not even list the events in its range.
{verified: DestructionStageReceptorComponentTests.TheReap_RunsThePreStagesBeforeTheDeleteAndThePostStagesAfterItAsync, StreamCloserDestructionStageComponentTests.Close_RunsThePreStagesBeforeTheTruncateAndThePostStagesAfterItAsync, StreamCloserDestructionStageComponentTests.AnEventWithNoDestructionReceptor_IsNotLoadedOrHandedToAnyStageAsync, StreamCloserDestructionStageComponentTests.WithNoDestructionReceptorAnywhere_TheRangeIsNeverListedAsync}

The two operations differ only in what a failure does, because they destroy different kinds of data:

| | The ephemeral reap | A period close |
|---|---|---|
| Events offered | The bodies this cycle reaps | Every event of the stream at or below the close version |
| A throwing Pre Inline receptor | Holds the batch for retry, then the `OnDestroyFailure` policy decides | Aborts the close: the exception reaches the caller and nothing is truncated, as with a throwing hook |
| The hook cancels or defers | The batch is held; no stage runs | The close returns `canceled` or `deferred`; no stage runs |
| Post stages run when | The batch was deleted | The close returned `closed`; a `blocked`, `held` or other outcome runs no Post stage |
| A throwing Post Inline receptor | Logged; the reap stands | Logged; the close stands |

{verified: StreamCloserDestructionStageComponentTests.AThrowingPreInlineReceptor_VetoesTheCloseAsync, StreamCloserDestructionStageComponentTests.AHookThatCancels_RunsNoDestructionStageAsync, StreamCloserDestructionStageComponentTests.ACloseThatTruncatesNothing_RunsNoPostStageAsync, StreamCloserDestructionStageComponentTests.AThrowingPostInlineReceptor_IsLoggedAndTheCloseStandsAsync}

```csharp{title="Archiving an ephemeral event before it is reaped" description="A PreDestructionInline receptor runs before the reap deletes the event; a PostDestructionDetached receptor runs after" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lifecycle", "Destruction", "Ephemeral"] tests=["DestructionStageReceptorComponentTests.TheReap_RunsThePreStagesBeforeTheDeleteAndThePostStagesAfterItAsync", "DestructionStageReceptorComponentTests.AFailingPreInlineReceptor_HoldsTheBatchAndNoPostStageRunsAsync", "DestructionStageReceptorComponentTests.AnEventWithNoDestructionReceptor_IsNotLoadedOrHandedToAnyStageAsync"]}
[FireAt(LifecycleStage.PreDestructionInline)]
public class ArchiveTelemetry : IReceptor<TelemetryRecorded> {
  public async ValueTask HandleAsync(TelemetryRecorded evt, CancellationToken ct = default) {
    // Awaited before the delete: commit the archive copy now, or throw to hold the batch
    await _archive.WriteAsync(evt, ct);
  }
}

[FireAt(LifecycleStage.PostDestructionDetached)]
public class CountReapedTelemetry : IReceptor<TelemetryRecorded> {
  public ValueTask HandleAsync(TelemetryRecorded evt, CancellationToken ct = default) {
    // The stored event is gone; the envelope was loaded before the delete
    _metrics.Reaped.Add(1);
    return ValueTask.CompletedTask;
  }
}
```

#### `PreDestructionDetached`

**Timing**: Just before the batch is deleted or the stream is truncated. Runs in the background, in its own scope.

**Guarantees**: Detached: does not block the reaper or the close. Best for destruction notifications / metrics that need not gate the delete.

#### `PreDestructionInline`

**Timing**: Just before the delete, **awaited on the reaper's or the closer's critical path**, so side effects must durably commit BEFORE the physical delete.

**Use Cases**: Compact / snapshot / archive / crypto-shred. An `IDestructionHook` may return **Cancel** or **Defer** (or a chosen disposition): the whole batch is then held (Cancel = far-future, Defer = until the given instant) and nothing is reaped this cycle, and PostDestruction does not fire.

**Guarantees**: Blocking for this batch or close. A throwing receptor or hook does NOT fail open. In the reap the batch is held with backoff and re-offered up to `MaxDestructionRetries`, after which the `OnDestroyFailure` policy decides (forced delete or keep); no Post stage runs for a held batch. In a period close the close is aborted and the exception reaches the caller; nothing is truncated.

#### `PostDestructionDetached`

**Timing**: After the physical delete or the truncate has committed. Runs in the background, in its own scope.

**Use Cases**: Notify / metrics / cascade.

#### `PostDestructionInline`

**Timing**: After the physical delete, awaited by the reaper or the closer. Rare: most post-destruction work is Detached. A throwing receptor is logged; the delete already committed and stands.

---

### Pipeline Overview

Each worker processes a specific **segment** of the lifecycle. `PostLifecycle` fires at the end of whichever worker is the last to act on the event:

```mermaid{caption="Pipeline overview — each worker (Dispatcher, OutboxWorker, TransportConsumer, PerspectiveWorker) processes one lifecycle segment; PostLifecycle fires at the end of whichever worker is last to act, gated by WhenAll for multi-path events." tests=["LifecycleCoordinatorTests.WhenAll_BothComplete_FiresPostLifecycleOnceAsync", "LifecycleCoordinatorTests.SignalSegmentComplete_NoWhenAll_FiresPostLifecycleImmediatelyAsync"]}
graph LR
    subgraph DIS["Dispatcher"]
        direction TB
        DIS0["ENTRY: dispatch"]
        DIS1["LocalImmediateInline"]
        DIS2["LocalImmediateDetached (not waited for)"]
        DIS3["PostLifecycleDetached †"]
        DIS4["PostLifecycleInline †"]
        DIS5["EXIT: done / WhenAll"]
        DIS0 --> DIS1 --> DIS2 --> DIS3 --> DIS4 --> DIS5
    end

    subgraph OBW["OutboxWorker"]
        direction TB
        OBW0["ENTRY: load from DB"]
        OBW1["PreOutboxDetached"]
        OBW2["PreOutboxInline"]
        OBW3["PostOutboxDetached"]
        OBW4["PostOutboxInline"]
        OBW5["PostLifecycleDetached ‡"]
        OBW6["PostLifecycleInline ‡"]
        OBW7["EXIT: transport / WhenAll"]
        OBW0 --> OBW1 --> OBW2 --> OBW3 --> OBW4 --> OBW5 --> OBW6 --> OBW7
    end

    subgraph TC["TransportConsumer"]
        direction TB
        TC0["ENTRY: receive"]
        TC1["PreInboxDetached"]
        TC2["PreInboxInline"]
        TC3["PostInboxDetached"]
        TC4["PostInboxInline"]
        TC5["PostLifecycleDetached *"]
        TC6["PostLifecycleInline *"]
        TC7["EXIT: done / WhenAll"]
        TC0 --> TC1 --> TC2 --> TC3 --> TC4 --> TC5 --> TC6 --> TC7
    end

    subgraph PW["PerspectiveWorker"]
        direction TB
        PW0["ENTRY: load from DB"]
        PW1["PrePerspectiveDetached"]
        PW2["PrePerspectiveInline"]
        PW3["PostPerspectiveDetached"]
        PW4["PostPerspectiveInline"]
        PW5["PostAllPerspectivesDetached"]
        PW6["PostAllPerspectivesInline"]
        PW7["PostLifecycleDetached **"]
        PW8["PostLifecycleInline **"]
        PW9["EXIT: done / WhenAll"]
        PW0 --> PW1 --> PW2 --> PW3 --> PW4 --> PW5 --> PW6 --> PW7 --> PW8 --> PW9
    end

    DIS ~~~ OBW
    OBW ~~~ TC
    TC ~~~ PW
```

- `†` fires if this is the only processing path (Route.Local), OR via WhenAll
- `‡` fires if no further processing (event leaves service), OR via WhenAll
- `*` fires for events WITHOUT perspectives, OR via WhenAll
- `**` fires AFTER ALL perspectives complete (PostAllPerspectives → PostLifecycle), OR via WhenAll

See [Lifecycle Coordinator](lifecycle-coordinator.md) for details on entry/exit points, WhenAll, and tracking.

---

## Lifecycle Stage Timing Diagram

```mermaid{caption="Lifecycle stage timing — the ordered sequence of Inline stages a message passes through across the Dispatch, Distribute, Outbox, Inbox, Perspective, PostAllPerspectives, and PostLifecycle phases."}
sequenceDiagram
    participant Caller
    participant Receptor
    participant UOW as Unit of Work
    participant Coordinator as Work Coordinator
    participant Worker
    participant Perspective

    Note over Caller,Perspective: Dispatch Phase
    Caller->>Receptor: SendAsync(command)
    Receptor-->>Receptor: HandleAsync()
    Note right of Receptor: ImmediateDetached fires here
    Receptor->>UOW: SaveChangesAsync()

    Note over UOW,Coordinator: Distribute Phase
    Note right of UOW: PreDistributeInline
    UOW->>Coordinator: StoreOutboxMessagesAsync() / StoreInboxMessagesAsync()
    Note right of UOW: PostDistributeInline

    Note over Worker,Perspective: Outbox Phase
    Note right of Worker: PreOutboxInline
    Worker->>Transport: Publish()
    Note right of Worker: PostOutboxInline

    Note over Worker,Perspective: Inbox Phase
    Transport->>Worker: Receive()
    Note right of Worker: PreInboxInline
    Worker->>Receptor: HandleAsync()
    Note right of Worker: PostInboxInline

    Note over Worker,Perspective: Perspective Phase
    Note right of Worker: PrePerspectiveInline
    Worker->>Perspective: RunAsync()
    Perspective-->>Perspective: Apply events
    Note right of Worker: PostPerspectiveInline ⭐

    Note over Worker,Perspective: PostAllPerspectives Phase
    Note right of Worker: PostAllPerspectivesDetached (after ALL perspectives complete)
    Note right of Worker: PostAllPerspectivesInline

    Note over Worker,Perspective: PostLifecycle Phase
    Note right of Worker: PostLifecycleDetached (final stage)
    Note right of Worker: PostLifecycleInline
    Worker->>Coordinator: ReportCompletionAsync()
```

---

## Detached vs Inline Stages

Most lifecycle stages come in pairs:

| Stage Type | Who waits | Scope | An exception | Ordered before the next stage |
|------------|-----------|-------|--------------|-------------------------------|
| `*Inline` | The caller or worker that fires it | Same scope and unit of work | Fails that unit | ✅ Yes |
| `*Detached` | Nobody | Its own | Is logged or reported, never fails the message | ❌ No |

The full definitions are in [Stage Semantics](#stage-semantics).

**Guidelines**:
- **Use Inline** for: Test synchronization, validation, critical operations
- **Use Detached** for: Logging, metrics, observability

---

## Registering Lifecycle Receptors

### Compile-Time (Production)

Use `[FireAt]` attribute for compile-time registration:

```csharp{title="Compile-Time (Production)" description="Use [FireAt] attribute for compile-time registration:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lifecycle", "Compile-Time", "Production"] tests=["ReceptorDiscoveryGeneratorTests.Generator_ReceptorWithFireAt_RegisteredOnlyAtSpecifiedStageAsync", "ReceptorDiscoveryGeneratorTests.Generator_WithReceptor_GeneratesReceptorRegistryAsync", "ReceptorDiscoveryGeneratorTests.Generator_GeneratesDispatcherRegistrationsAsync", "LifecycleStageTests.LifecycleStage_PostPerspectiveDetached_IsDefinedAsync"]}
[FireAt(LifecycleStage.PostPerspectiveDetached)]
public class MyMetricsReceptor : IReceptor<ProductCreatedEvent> {
    public ValueTask HandleAsync(ProductCreatedEvent evt, CancellationToken ct = default) {
        // Track metrics
        return ValueTask.CompletedTask;
    }
}
```

Source generators discover and wire these automatically.

### Runtime (Testing)

Use `IReceptorRegistry` for dynamic registration:

```csharp{title="Runtime (Testing)" description="Use IReceptorRegistry for dynamic registration:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lifecycle", "Runtime", "Testing"] unverified="runtime IReceptorRegistry.Register/Unregister test-registration pattern — not exercised by any test class in this page's coverage map"}
var registry = host.Services.GetRequiredService<IReceptorRegistry>();
var receptor = new PerspectiveCompletionReceptor<ProductCreatedEvent>(completionSource);

registry.Register<ProductCreatedEvent>(receptor, LifecycleStage.PostPerspectiveInline);
try {
    // Dispatch command
    await dispatcher.SendAsync(command);

    // Wait for completion
    await completionSource.Task;
} finally {
    registry.Unregister<ProductCreatedEvent>(receptor, LifecycleStage.PostPerspectiveInline);
}
```

See [Lifecycle Receptors](../receptors/lifecycle-receptors.md) for API details.

---

## Performance Considerations

**Lifecycle receptors execute synchronously in the message processing path**. Keep them fast:

✅ **Good Practices**:
- Quick in-memory operations
- Async logging (non-blocking)
- Metrics collection
- Test signaling

❌ **Avoid**:
- Database queries
- HTTP calls
- Heavy computation
- Blocking operations (in Detached stages)

**Exception Handling**:
- Lifecycle receptor errors are logged but don't fail message processing
- Checkpoint progress continues even if lifecycle receptors fail
- Critical operations should use Inline stages to detect failures

---

## Hook Locations in Source Code

| Stage | File | Method/Location |
|-------|------|-----------------|
| `ImmediateDetached` | `Dispatcher.cs` | After business receptor completes |
| `PreDistribute*` / `DistributeDetached` / `PostDistribute*` | `WorkCoordinatorFlushHelper.cs` | Around the flush's outbox and inbox store calls |
| `PreOutbox*` / `PostOutbox*` | `OutboxPublishWorker.cs` | Around transport publish |
| `PreInbox*` / `PostInbox*` | `InboxDispatchWorker.cs` | Around receptor dispatch (`PostInbox` fires after event storage) |
| `PrePerspective*` | `PerspectiveRunnerTemplate.cs` | Before event processing loop (once per batch) |
| `PostPerspectiveDetached` | `PerspectiveRunnerTemplate.cs` | After perspective data flush, before checkpoint save |
| `PostPerspectiveInline` | `PerspectiveWorker.cs` | After checkpoint commit (data + checkpoint durable) |
| `PostAllPerspectives*` | `PerspectiveWorker.cs` | After ALL perspectives complete (WhenAll) — managed by [Lifecycle Coordinator](lifecycle-coordinator.md) |
| `PostLifecycle*` | `PerspectiveWorker.cs`, `TransportConsumerWorker.cs`, `Dispatcher.cs` | After all processing completes — managed by [Lifecycle Coordinator](lifecycle-coordinator.md) |
| `PreDestruction*` / `PostDestruction*` | `MaintenanceWorker.cs`, `StreamCloser.cs` | Around the ephemeral reap (batched once per cycle) and around a period close's truncate, for `[FireAt]` receptors and a registered `IDestructionHook` |

---

## Related Topics

- [Lifecycle Coordinator](lifecycle-coordinator.md) - Centralized stage management, WhenAll pattern, tracking
- [Lifecycle Receptors API](../receptors/lifecycle-receptors.md) - Using `[FireAt]` and `ILifecycleContext`
- [Testing: Lifecycle Synchronization](../../operations/testing/lifecycle-synchronization.md) - Test patterns with lifecycle hooks
- [PerspectiveWorker](../../operations/workers/perspective-worker.md) - Perspective processing worker
- [Work Coordination](../../messaging/work-coordination.md) - Distributed work coordination

---

## Summary

- **28 lifecycle stages** across 9 phases (Immediate, LocalImmediate, Distribute, Outbox, Inbox, Perspective, PostAllPerspectives, PostLifecycle, Destruction) plus 1 special value (`AfterReceptorCompletion`)
- **Two paths, one dispatch can take both**: local (this service handles it in-process) and distributed (its outbox copy); the [dispatch policy](../dispatcher/dispatch-policy.md) decides
- **Default stages** for receptors without `[FireAt]`:
  - **Local path**: `LocalImmediateInline`
  - **Distributed path**: `PostInboxDetached` (receiver) — source-service filtering prevents double-fire
- **PostLifecycle** fires exactly once per event at the end of whichever worker is last to act
- **Lifecycle Coordinator** guarantees each stage fires once per event — no duplicate firings
- **Tags fire at ALL stages** as lifecycle observers
- **Inline stages** block next step - use for critical operations
- **Detached stages** are fire-and-forget in their own scope - use for metrics and logging
- **`PostPerspectiveInline`** is critical for test synchronization
- **Compile-time registration** via `[FireAt]` attribute
- **Runtime registration** via `IReceptorRegistry.Register<TMessage>()` for tests
- **Zero reflection** - fully AOT-compatible via `IReceptorInvoker` and `IReceptorRegistry`
- **Performance** - keep lifecycle receptors fast and lightweight

### For Contributors

Looking to understand the internal message flow? See:
- [Message Lifecycle & Architecture](../../extending/internals/message-lifecycle.md) — Complete internal view of how messages flow through Dispatcher, Outbox, Inbox, and Perspectives
