---
title: Lifecycle Stages
pageType: reference
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
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
  - src/Whizbang.Core/Workers/InboxDispatchWorker.cs
  - src/Whizbang.Core/Workers/TransportConsumerWorker.cs
  - src/Whizbang.Generators/Templates/PerspectiveRunnerTemplate.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
testReferences:
  - tests/Whizbang.Core.Tests/Messaging/LifecycleStageTests.cs
  - tests/Whizbang.Core.Tests/Messaging/LifecycleStageExtensionsTests.cs
  - tests/Whizbang.Core.Tests/Messaging/LocalImmediateLifecycleStageTests.cs
  - tests/Whizbang.Core.Tests/Messaging/ReceptorInvokerTests.cs
  - tests/Whizbang.Core.Tests/Lifecycle/LifecycleCoordinatorTests.cs
  - tests/Whizbang.Core.Tests/Workers/PerspectiveWorkerPostLifecycleTests.cs
  - tests/Whizbang.Core.Tests/Workers/TransportConsumerWorkerPostLifecycleTests.cs
  - tests/Whizbang.Generators.Tests/ReceptorDiscoveryGeneratorTests.cs
lastMaintainedCommit: '01f07906'
---

# Lifecycle Stages

Whizbang provides lifecycle stages where custom logic can execute during message processing. Lifecycle stages enable observability, metrics collection, test synchronization, and custom side effects without modifying core framework code.

:::updated
The [Lifecycle Coordinator](lifecycle-coordinator.md) now manages all stage transitions, guaranteeing each stage fires **exactly once per event**. Tags fire at every stage as lifecycle observers.
:::

## Core Concept

Messages flow through **two mutually exclusive paths**:

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

---

## Two Mutually Exclusive Paths

:::new
Understanding the two dispatch paths is critical for using lifecycle stages correctly.
:::

| Path | Description | Default Stages | Persistence |
|------|-------------|---------------|-------------|
| **Local** | `LocalInvokeAsync(msg)` / `LocalSendManyAsync(msgs)` | `LocalImmediateDetached` | ❌ None (mediator) |
| **Distributed** | `SendAsync(msg)` / `PublishAsync(evt)` via transport | `PostInboxDetached` (receiver) | ✅ Outbox/Inbox |

:::updated
Receptors **without** `[FireAt]` are registered at `LocalImmediateDetached` + `PostInboxDetached` (locked by generator tests). `LocalImmediateDetached` fires for messages dispatched by **this** service; `PostInboxDetached` fires for messages arriving from **other** services via transport. Source-service filtering in `ReceptorInvoker` prevents double-fire. There is no default sender-side outbox stage.
:::

**Key Points**:
- A message goes through ONE path, not both
- Default receptors (no `[FireAt]`) fire ONCE per path
- `[FireAt]` attributes opt into specific stages and OUT of default behavior

At each stage, **lifecycle receptors** can execute to:
- Track metrics and telemetry
- Log diagnostic information
- Synchronize integration tests
- Trigger custom business logic
- Implement cross-cutting concerns

---

## All 24 Lifecycle Stages

:::updated
The `LifecycleStage` enum contains 25 values total: 24 true lifecycle stages plus one special value (`AfterReceptorCompletion = -1`). `AfterReceptorCompletion` is **not** a true lifecycle stage — it is a hook that fires synchronously after a receptor completes in the Dispatcher, before any lifecycle stages are invoked. It exists as the default for backward compatibility with tag hooks.
:::

### Immediate Stage

#### `ImmediateDetached`

**Timing**: Immediately after the business receptor completes in the `Dispatcher`, fire-and-forget.

**Use Cases**:
- Log command execution timing
- Track user activity
- Record metrics without blocking dispatch

**Guarantees**:
- Detached: fire-and-forget, runs in its own scope
- Does not block message flow — errors are logged, not propagated
- With the [Lifecycle Coordinator](lifecycle-coordinator.md), fires automatically after each stage transition

**Example**:
```csharp{title="`ImmediateDetached`" description="ImmediateDetached" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lifecycle", "ImmediateDetached"] tests=["ReceptorDiscoveryGeneratorTests.Generator_ReceptorWithFireAt_RegisteredOnlyAtSpecifiedStageAsync", "LifecycleCoordinatorTests.AdvanceTo_FiresImmediateDetached_AfterEachStageAsync", "LifecycleStageTests.LifecycleStage_ImmediateDetached_IsDefinedAsync"]}
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

#### `LocalImmediateDetached` ⭐ **Default Stage for Local Path**

**Timing**: During local dispatch (`LocalInvokeAsync` / `LocalSendManyAsync`) when no transport is involved, fire-and-forget.

**Use Cases**:
- **Default receptors** (receptors WITHOUT `[FireAt]` fire here for locally-dispatched messages)
- In-memory mediator workflows
- Fire-and-forget side effects on local dispatch

**Guarantees**:
- **Detached** - fire-and-forget, runs in its own scope; does not block dispatch return
- **NO persistence** - message never hits outbox/inbox
- **Default stage** for receptors WITHOUT `[FireAt]` on the local path
- Errors logged but don't affect caller

**Example**:
```csharp{title="`LocalImmediateDetached` ⭐ **Default Stage for Local Path**" description="LocalImmediateDetached" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lifecycle", "LocalImmediateDetached", "**Default"] tests=["ReceptorDiscoveryGeneratorTests.Generator_ReceptorWithoutFireAt_RegisteredAtDefaultStagesAsync", "LifecycleStageTests.LifecycleStage_LocalImmediateDetached_IsDefinedAsync"]}
// Receptor WITHOUT [FireAt] fires at LocalImmediateDetached when dispatched locally!
public class CreateTenantCommandHandler : IReceptor<CreateTenantCommand, TenantCreatedEvent> {
    public async ValueTask<TenantCreatedEvent> HandleAsync(CreateTenantCommand cmd, CancellationToken ct = default) {
        var tenant = new Tenant(cmd.Name);
        await _dbContext.Tenants.AddAsync(tenant, ct);
        return new TenantCreatedEvent(tenant.Id);
    }
}

// Use local dispatch for in-process handling
await dispatcher.LocalInvokeAsync(new CreateTenantCommand("Acme"));
```

#### `LocalImmediateInline`

**Timing**: During local dispatch (`LocalInvokeAsync` / `LocalSendManyAsync`), blocking.

**Use Cases**:
- Synchronous local handling that must complete before dispatch returns
- Validation
- Test synchronization for local dispatch

**Guarantees**:
- **Blocking** - dispatch waits for completion
- **NO persistence** - message never hits outbox/inbox
- Errors propagate to caller

**Example**:
```csharp{title="`LocalImmediateInline`" description="LocalImmediateInline" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lifecycle", "LocalImmediateInline"] unverified="verified by LocalImmediateLifecycleStageTests, which is outside the current coverage map"}
[FireAt(LifecycleStage.LocalImmediateInline)]
public class LocalDispatchLogger : IReceptor<ICommand> {
    public ValueTask HandleAsync(ICommand cmd, CancellationToken ct = default) {
        Console.WriteLine($"Local dispatch completed for {cmd.GetType().Name}");
        return ValueTask.CompletedTask;
    }
}
```

---

### Distribute Stages (5 stages)

:::planned
All five Distribute stages (`PreDistributeDetached`, `PreDistributeInline`, `DistributeDetached`, `PostDistributeDetached`, `PostDistributeInline`) are planned for coordinator-managed execution. The enum values exist in `LifecycleStage` but are not yet wired into the pipeline. They will fire for both outbox (publishing) and inbox (consuming) paths — use `MessageSource` to distinguish.
:::

#### `PreDistributeDetached`

**Timing**: Before `process_work_batch` call (fire-and-forget, own scope).

**Use Cases**:
- Non-critical logging before batch distribution
- Async metrics collection
- Pre-distribution notifications

**Guarantees**:
- Detached - fire-and-forget, runs in its own scope
- Errors are logged but don't affect distribution
- May still be running when distribution occurs

#### `PreDistributeInline`

**Timing**: Before `process_work_batch` call.

**Use Cases**:
- Pre-processing before batch distribution
- Validation before work coordination

**Guarantees**:
- Blocking - blocks the unit of work (not the entire queue) until completion
- Runs before any work is sent to coordinator

#### `DistributeDetached`

**Timing**: In parallel with `process_work_batch` call (fire-and-forget).

**Use Cases**:
- Side effects that don't need to block (notifications, caching)
- Fire-and-forget operations
- Background metrics collection

**Guarantees**:
- Detached - fire-and-forget, runs in its own scope
- Errors are logged but don't affect distribution
- May complete after distribution finishes

#### `PostDistributeDetached`

**Timing**: After `process_work_batch` returns (fire-and-forget, own scope).

**Use Cases**:
- Post-distribution metrics
- Cleanup operations
- Async notifications

**Guarantees**:
- Detached - fire-and-forget, runs in its own scope
- Errors are logged but don't affect next steps
- Work has been queued to coordinator

#### `PostDistributeInline`

**Timing**: After `process_work_batch` returns (blocking).

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

### PostLifecycle Stages (2 stages)

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
- **Fires exactly once per event** — managed by [Lifecycle Coordinator](lifecycle-coordinator.md)
- Detached — does not delay the next batch
- For `Route.Both()` events, fires only after ALL paths complete ([WhenAll pattern](lifecycle-coordinator.md#whenall))
- Fired by whichever worker is the **last to act** on the event:

| Scenario | Who fires PostLifecycle |
|----------|----------------------|
| Local dispatch | Dispatcher |
| Distributed, no perspectives | TransportConsumer |
| Distributed, with perspectives | PerspectiveWorker |
| `Route.Both()` | Last path to complete (WhenAll) |

**Example**:
```csharp{title="`PostLifecycleDetached`" description="Final notification after all processing completes" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lifecycle", "PostLifecycleDetached"] tests=["LifecycleCoordinatorTests.WhenAll_BothComplete_FiresPostLifecycleOnceAsync", "LifecycleCoordinatorTests.SignalSegmentComplete_NoWhenAll_FiresPostLifecycleImmediatelyAsync", "LifecycleCoordinatorTests.WhenAll_LocalAlone_DoesNotFirePostLifecycleDetachedAsync", "LifecycleStageTests.LifecycleStage_PostLifecycleDetached_IsDefinedAsync"]}
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

### Pipeline Overview

Each worker processes a specific **segment** of the lifecycle. `PostLifecycle` fires at the end of whichever worker is the last to act on the event:

```mermaid{caption="Pipeline overview — each worker (Dispatcher, OutboxWorker, TransportConsumer, PerspectiveWorker) processes one lifecycle segment; PostLifecycle fires at the end of whichever worker is last to act, gated by WhenAll for multi-path events." tests=["LifecycleCoordinatorTests.WhenAll_BothComplete_FiresPostLifecycleOnceAsync", "LifecycleCoordinatorTests.SignalSegmentComplete_NoWhenAll_FiresPostLifecycleImmediatelyAsync"]}
graph LR
    subgraph DIS["Dispatcher"]
        direction TB
        DIS0["ENTRY: dispatch"]
        DIS1["LocalImmediateDetached"]
        DIS2["LocalImmediateInline"]
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
    UOW->>Coordinator: ProcessWorkBatchAsync()
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

| Stage Type | Timing | Blocks Next Step | Use Case |
|------------|--------|------------------|----------|
| `*Inline` | Before/After | ✅ Yes | Critical operations, test sync |
| `*Detached` | Fire-and-forget, own scope | ❌ No | Metrics, logging, non-critical |

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
| `PreDistribute*` / `DistributeDetached` / `PostDistribute*` | — | Planned — enum values exist but are not yet wired into the pipeline |
| `PreOutbox*` / `PostOutbox*` | `OutboxPublishWorker.cs` | Around transport publish |
| `PreInbox*` / `PostInbox*` | `InboxDispatchWorker.cs` | Around receptor dispatch (`PostInbox` fires after event storage) |
| `PrePerspective*` | `PerspectiveRunnerTemplate.cs` | Before event processing loop (once per batch) |
| `PostPerspectiveDetached` | `PerspectiveRunnerTemplate.cs` | After perspective data flush, before checkpoint save |
| `PostPerspectiveInline` | `PerspectiveWorker.cs` | After checkpoint commit (data + checkpoint durable) |
| `PostAllPerspectives*` | `PerspectiveWorker.cs` | After ALL perspectives complete (WhenAll) — managed by [Lifecycle Coordinator](lifecycle-coordinator.md) |
| `PostLifecycle*` | `PerspectiveWorker.cs`, `TransportConsumerWorker.cs`, `Dispatcher.cs` | After all processing completes — managed by [Lifecycle Coordinator](lifecycle-coordinator.md) |

---

## Related Topics

- [Lifecycle Coordinator](lifecycle-coordinator.md) - Centralized stage management, WhenAll pattern, tracking
- [Lifecycle Receptors API](../receptors/lifecycle-receptors.md) - Using `[FireAt]` and `ILifecycleContext`
- [Testing: Lifecycle Synchronization](../../operations/testing/lifecycle-synchronization.md) - Test patterns with lifecycle hooks
- [PerspectiveWorker](../../operations/workers/perspective-worker.md) - Perspective processing worker
- [Work Coordination](../../messaging/work-coordination.md) - Distributed work coordination

---

## Summary

- **24 lifecycle stages** across 8 phases (Immediate, LocalImmediate, Distribute, Outbox, Inbox, Perspective, PostAllPerspectives, PostLifecycle) plus 1 special value (`AfterReceptorCompletion`)
- **Two mutually exclusive paths**: Local (mediator) and Distributed (outbox/inbox)
- **Default stages** for receptors without `[FireAt]`:
  - **Local path**: `LocalImmediateDetached`
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
