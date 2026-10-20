---
title: Message Lifecycle & Architecture
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Architecture
order: 1
description: >-
  Complete guide to message flow through Whizbang - Commands, Events, Work
  Coordinator, and all the hooks between Dispatcher, Receptors, Perspectives,
  and Outbox/Inbox
tags: >-
  architecture, message-lifecycle, command-flow, event-flow, work-coordinator,
  sequence-diagrams
codeReferences:
  - src/Whizbang.Core/Dispatcher.cs
  - src/Whizbang.Core/IDispatcher.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinatorStrategy.cs
  - src/Whizbang.Core/Messaging/LifecycleStage.cs
  - src/Whizbang.Core/Workers/ServiceBusConsumerWorker.cs
  - src/Whizbang.Core/Workers/ClaimWorker.cs
  - src/Whizbang.Core/Workers/OutboxPublishWorker.cs
  - src/Whizbang.Core/Messaging/OrderedStreamProcessor.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperWorkCoordinator.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreWorkCoordinator.cs
testReferences:
  - tests/Whizbang.Core.Component.Tests/Messaging/OrderedStreamProcessorTests.cs
  - tests/Whizbang.Core.Tests/Messaging/ScopedWorkCoordinatorStrategyTests.cs
  - tests/Whizbang.Core.Component.Tests/Messaging/IntervalWorkCoordinatorStrategyTests.cs
  - tests/Whizbang.Core.Tests/Messaging/ImmediateWorkCoordinatorStrategyTests.cs
lastMaintainedCommit: '62abd3a45'
---

# Message Lifecycle & Architecture

This document provides a complete view of how messages flow through Whizbang from initial dispatch through outbox publishing, including all the integration points with Receptors, Perspectives, Event Store, and the Work Coordinator.

---

## Architecture Overview

```mermaid{caption="Whizbang end-to-end component map: dispatcher, work coordinator, event store, outbox and inbox, and the background workers"}
graph TB
    subgraph "API/Client Layer"
        API[API Controller]
    end

    subgraph "Dispatcher Layer"
        DISP[Dispatcher]
        STRAT[Work Coordinator Strategy]
    end

    subgraph "Business Logic Layer"
        REC[Receptor]
    end

    subgraph "Read Model Layer"
        PERSP[Perspectives]
    end

    subgraph "Persistence Layer"
        WC[Work Coordinator<br/>focused SQL functions]
        ES[Event Store]
        OUTBOX[(Outbox Table)]
        INBOX[(Inbox Table)]
    end

    subgraph "Background Workers"
        PUB[Publisher Worker]
        CONS[Consumer Worker]
        OSP[Ordered Stream<br/>Processor]
    end

    subgraph "External Systems"
        SB[Azure Service Bus]
    end

    API -->|SendAsync<br/>LocalInvokeAsync<br/>PublishAsync| DISP
    DISP -->|1. Invoke| REC
    REC -->|2. Return Event| DISP
    DISP -->|3. Queue Outbox| STRAT
    STRAT -->|4. Batch Insert| WC
    WC -->|5. Store| OUTBOX
    WC -->|6. Store| ES
    DISP -->|7. PublishAsync| PERSP

    PUB -->|claim_work| WC
    WC -->|Leased streams| PUB
    PUB -->|Stream Order| OSP
    OSP -->|Publish| SB
    OSP -->|Report Complete| WC

    SB -->|Receive| CONS
    CONS -->|Queue Inbox| STRAT
    CONS -->|store_inbox_messages| WC
    WC -->|Dedup Insert| INBOX
    WC -->|claim_work| CONS
    CONS -->|Stream Order| OSP
    OSP -->|Invoke| PERSP
    OSP -->|Report Complete| WC

    style WC fill:#4CAF50
    style ES fill:#2196F3
    style OSP fill:#FF9800
```

---

## Command Flow (Synchronous)

### Pattern: LocalInvokeAsync

**Use Case**: API endpoint needs immediate typed response

```mermaid{caption="Synchronous command flow: the controller waits for the receptor result while outbox and event store persist in one atomic work-coordinator batch"}
sequenceDiagram
    participant Client
    participant Controller
    participant Dispatcher
    participant Receptor
    participant WorkStrategy as Work Coordinator<br/>Strategy (Scoped)
    participant WorkCoord as Work Coordinator<br/>store_outbox_messages
    participant EventStore
    participant Outbox
    participant Perspectives

    Client->>Controller: POST /orders
    Controller->>Dispatcher: LocalInvokeAsync<CreateOrder, OrderCreated>(command)

    Note over Dispatcher: Create MessageEnvelope<br/>(MessageId, CorrelationId, CausationId)

    Dispatcher->>Receptor: HandleAsync(CreateOrder)

    Note over Receptor: Validate command<br/>Apply business logic<br/>Generate event

    Receptor-->>Dispatcher: OrderCreated event

    Note over Dispatcher: Check if event implements IEvent<br/>(for Event Store)

    Dispatcher->>WorkStrategy: QueueOutboxMessage(event, isEvent=true)
    Note over WorkStrategy: Batch in scoped collection

    Dispatcher->>WorkStrategy: FlushAsync()

    WorkStrategy->>WorkCoord: StoreOutboxMessagesAsync([event])

    Note over WorkCoord: store_outbox_messages,<br/>one atomic transaction:

    WorkCoord->>Outbox: INSERT INTO wh_outbox
    Note over Outbox: Stream-based partitioning<br/>partition_number = hash(stream_id) % 10000

    WorkCoord->>EventStore: _emit_event_store_chain:<br/>INSERT INTO wh_event_store (event_id = message_id)<br/>+ perspective work (event rows with a stream_id)
    Note over EventStore: Auto-increment version per stream<br/>Global sequence for ordering

    WorkCoord-->>WorkStrategy: stored (a flush claims nothing;<br/>ClaimWorker claims the new rows)
    WorkStrategy-->>Dispatcher: flush complete

    Dispatcher->>Perspectives: PublishAsync(OrderCreated)

    Note over Perspectives: Parallel invocation of all perspectives:

    par Update Read Models
        Perspectives->>Perspectives: OrderSummaryPerspective.Apply()
        Perspectives->>Perspectives: InventoryPerspective.Apply()
        Perspectives->>Perspectives: AnalyticsPerspective.Apply()
    end

    Dispatcher-->>Controller: OrderCreated result
    Controller-->>Client: 201 Created + OrderCreated JSON

    Note over WorkStrategy: Scope disposed<br/>(end of HTTP request)
```

**Key Points**:
1. **Synchronous semantics**: Controller waits for the receptor's typed result
2. **Atomic Event Store + Outbox**: Both persisted in single transaction
3. **Stream-based partitioning**: Ensures same stream_id always maps to same partition
4. **Perspective update**: Runs asynchronously via the perspective pipeline; use `AppendAndWaitAsync` / perspective sync when read-your-writes is required
5. **Scoped strategy**: Batches operations per HTTP request, flushes on disposal

---

## Command Flow (Asynchronous)

### Pattern: SendAsync

**Use Case**: Long-running operation, return receipt for tracking

```mermaid{caption="Asynchronous command flow: the dispatcher returns a delivery receipt after the outbox insert, with eventual delivery guaranteed by the outbox"}
sequenceDiagram
    participant Client
    participant Controller
    participant Dispatcher
    participant Receptor
    participant WorkStrategy as Work Coordinator<br/>Strategy (Scoped)
    participant WorkCoord as Work Coordinator<br/>store_outbox_messages
    participant Outbox

    Client->>Controller: POST /orders/async
    Controller->>Dispatcher: SendAsync(CreateOrder)

    Note over Dispatcher: Create MessageEnvelope<br/>Generate MessageId, CorrelationId

    Dispatcher->>Receptor: HandleAsync(CreateOrder)
    Receptor-->>Dispatcher: OrderCreated event

    Dispatcher->>WorkStrategy: QueueOutboxMessage(event, isEvent=true)
    Dispatcher->>WorkStrategy: FlushAsync()

    WorkStrategy->>WorkCoord: StoreOutboxMessagesAsync([event])

    WorkCoord->>Outbox: INSERT INTO wh_outbox
    WorkCoord-->>WorkStrategy: stored
    WorkStrategy-->>Dispatcher: flush complete

    Dispatcher-->>Controller: DeliveryReceipt(MessageId, CorrelationId, Timestamp)
    Controller-->>Client: 202 Accepted + tracking URL

    Note over Client: Poll tracking URL<br/>GET /orders/status/{correlationId}
```

**Key Points**:
1. **Asynchronous semantics**: Receipt doesn't mean processing complete
2. **Tracking via CorrelationId**: Client polls status endpoint
3. **Outbox guarantees delivery**: Event will be published eventually
4. **No perspective update**: Happens asynchronously via background workers

---

## Event Flow (Publishing from Outbox)

### Background Workers: ClaimWorker + OutboxDrainWorker

:::updated
The legacy `WorkCoordinatorPublisherWorker` has been decomposed into a work-pump pipeline: `ClaimWorker` is the **only** place that calls `IWorkCoordinator.ClaimWorkAsync` (the `claim_work` SQL function; adaptive backoff on empty polls, with a wake semaphore driven by Postgres NOTIFY / local channel writes). `claim_work` leases work and returns the stream ids the instance holds; `ClaimWorker` writes the outbox stream ids to the outbox drain channel, and `OutboxDrainWorker` fetches each stream's leased rows with `fetch_outbox_batch` and publishes them in stream order through `IMessagePublishStrategy`. Completions and failures are flushed back to the database by dedicated flush workers (`OutboxCompletionFlushWorker` calls `complete_outbox_published`, `FailureFlushWorker` calls `report_failures`).
:::

```mermaid{caption="Outbox publishing flow: lease-based claim, per-stream fetch and ordered publish to transport, then batched completion and failure reporting"}
sequenceDiagram
    participant Claim as ClaimWorker
    participant Drain as OutboxDrainWorker
    participant Flush as OutboxCompletionFlushWorker<br/>+ FailureFlushWorker
    participant WorkCoord as Work Coordinator<br/>(SQL functions)
    participant Outbox
    participant Transport as Azure Service Bus

    loop Adaptive poll (default 250ms base, backoff to 10s on empty polls; NOTIFY wakes immediately)
        Claim->>WorkCoord: ClaimWorkAsync (claim_work)

        Note over WorkCoord: Lease-based claiming:<br/>unowned or lease-expired rows<br/>get instance_id + lease_expiry

        WorkCoord->>Outbox: lease claimable rows
        WorkCoord-->>Claim: WorkBatch (outbox stream ids, ...)

        alt Has outbox streams
            Claim->>Drain: outbox drain channel (stream ids)

            loop For each stream (parallel across streams)
                Drain->>WorkCoord: FetchOutboxBatchAsync (fetch_outbox_batch)
                WorkCoord-->>Drain: leased rows in stream order

                loop For each message in stream (sequential)
                    Drain->>Transport: publish via IMessagePublishStrategy

                    alt Success
                        Drain->>Flush: completion channel (messageId)
                    else Failure
                        Drain->>Flush: failure channel (messageId, error)
                    end
                end
            end

            Flush->>WorkCoord: CompleteOutboxPublishedAsync (complete_outbox_published)
            WorkCoord->>Outbox: remove published rows<br/>(retained with processed_at in debug mode)

            Flush->>WorkCoord: ReportFailuresAsync (report_failures)
            WorkCoord->>Outbox: UPDATE failed rows<br/>(failure bit, error, backoff)
        end
    end
```

**Key Points**:
1. **Adaptive polling**: ClaimWorker backs off on consecutive empty polls; NOTIFY signals wake it immediately
2. **Partition-based distribution**: Each worker claims a subset of partitions
3. **Lease-based coordination**: Prevents duplicate processing across workers
4. **Stream ordering**: `OutboxDrainWorker` publishes one stream's rows sequentially, in stream order
5. **Parallel streams**: Different streams can process concurrently
6. **Batched completion reporting**: Completions and failures are coalesced by the flush workers

---

## Event Flow (Consuming from Inbox)

### Background Workers: Consumer, ClaimWorker, InboxDrainWorker, InboxHandlerWorker

```mermaid{caption="Inbox consuming flow: deduplicating store, lease-based claim, per-stream fetch and handler dispatch, then batched handler commit"}
sequenceDiagram
    participant ServiceBus as Azure Service Bus
    participant ConsumerWorker as Transport<br/>ConsumerWorker
    participant WorkCoord as Work Coordinator<br/>(SQL functions)
    participant Inbox
    participant Claim as ClaimWorker
    participant Drain as InboxDrainWorker +<br/>InboxDispatchWorker
    participant Commit as InboxHandlerWorker

    ServiceBus->>ConsumerWorker: Receive message(s)

    ConsumerWorker->>ConsumerWorker: Deserialize MessageEnvelope(s)

    ConsumerWorker->>WorkCoord: StoreInboxMessagesAsync (store_inbox_messages)

    Note over WorkCoord: Atomic deduplication:

    WorkCoord->>Inbox: record in wh_message_deduplication,<br/>INSERT INTO wh_inbox ON CONFLICT DO NOTHING

    ConsumerWorker->>ServiceBus: Complete message(s)<br/>(after the insert commits)

    Claim->>WorkCoord: ClaimWorkAsync (claim_work)
    Note over WorkCoord: Leases new inbox rows and copies inbox events<br/>into wh_event_store with their perspective work<br/>(_emit_event_store_chain_for_inbox)
    WorkCoord-->>Claim: WorkBatch (inbox stream ids, ...)

    Claim->>Drain: inbox drain channel (stream ids)
    Drain->>WorkCoord: FetchInboxBatchAsync (fetch_inbox_batch)
    WorkCoord-->>Drain: leased rows in stream order

    loop For each message in stream (sequential)
        Drain->>Drain: run inbox lifecycle stages (receptors)
        Drain->>Commit: HandlerCommitRequest
    end

    Commit->>WorkCoord: CommitHandlerBatchAsync (commit_handler_batch)
    Note over WorkCoord: Per-handler SAVEPOINT isolation:<br/>marks the inbox row processed and stores<br/>any emitted outbox messages in one commit
```

**Key Points**:
1. **Store first, acknowledge after**: the transport message is completed only after the inbox insert commits
2. **Atomic deduplication**: `store_inbox_messages` inserts with ON CONFLICT, so a redelivered message is not processed twice
3. **Stream ordering**: rows of one stream are fetched and dispatched sequentially
4. **Perspectives run separately**: inbox events become event-store rows and perspective work during `claim_work`, and the perspective worker applies them
5. **Batched commit**: `commit_handler_batch` commits many handler results in one round-trip with per-handler failure isolation

---

## Receptor Lifecycle Hooks

Receptors have several integration points throughout the message lifecycle:

```mermaid{caption="Receptor lifecycle phases from validation through completion, with the error path and HTTP status for each phase"}
graph TB
    START[Message Arrives] --> VALIDATE[1. Validation Phase]
    VALIDATE --> LOGIC[2. Business Logic Phase]
    LOGIC --> EVENT[3. Event Generation Phase]
    EVENT --> STORE[4. Event Store Phase]
    STORE --> PERSP[5. Perspective Update Phase]
    PERSP --> COMPLETE[6. Completion Phase]

    VALIDATE -->|ValidationException| ERROR1[Return 400 Bad Request]
    LOGIC -->|Business Exception| ERROR2[Return 409 Conflict]
    STORE -->|DB Error| ERROR3[Rollback + Return 500]
    PERSP -->|Perspective Error| ERROR4[Rollback + Return 500]

    style VALIDATE fill:#FFC107
    style LOGIC fill:#4CAF50
    style EVENT fill:#2196F3
    style STORE fill:#9C27B0
    style PERSP fill:#FF5722
    style COMPLETE fill:#4CAF50
```

### Phase 1: Validation

```csharp{title="Phase 1: Validation" description="Phase 1: Validation" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Internals", "Phase", "Validation"] unverified="Consumer receptor validation illustration, not a core Whizbang API"}
public async ValueTask<OrderCreated> HandleAsync(
    CreateOrder message,
    CancellationToken ct = default) {

    // HOOK 1: Input Validation
    if (message.Items.Length == 0) {
        throw new ValidationException("Order must contain at least one item");
    }

    if (message.Items.Any(i => i.Quantity <= 0)) {
        throw new ValidationException("All items must have quantity > 0");
    }

    // ... continue to business logic
}
```

**Hook**: Validate inputs **before** any database operations
**Result**: If validation fails, throw `ValidationException` → 400 Bad Request
**Guarantees**: No side effects (no database writes)

### Phase 2: Business Logic

```csharp{title="Phase 2: Business Logic" description="Phase 2: Business Logic" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Internals", "Phase", "Business"] unverified="Consumer receptor business-logic illustration, not a core Whizbang API"}
public async ValueTask<OrderCreated> HandleAsync(
    CreateOrder message,
    CancellationToken ct = default) {

    // Validation phase (above)
    // ...

    // HOOK 2: Business Logic
    await using var conn = _db.CreateConnection();

    // Check customer exists
    var customer = await conn.QuerySingleOrDefaultAsync<Customer>(
        "SELECT * FROM customers WHERE customer_id = @CustomerId",
        new { message.CustomerId },
        ct
    );

    if (customer is null) {
        throw new NotFoundException($"Customer {message.CustomerId} not found");
    }

    // Check inventory
    var hasStock = await _inventory.CheckStockAsync(message.Items, ct);
    if (!hasStock) {
        throw new InvalidOperationException("Insufficient inventory");
    }

    // ... continue to event generation
}
```

**Hook**: Execute business logic, load state, check invariants
**Result**: If business rules fail, throw appropriate exception
**Guarantees**: No state changes yet (read-only operations)

### Phase 3: Event Generation

```csharp{title="Phase 3: Event Generation" description="Phase 3: Event Generation" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Internals", "Phase", "Event"] unverified="Consumer receptor event-generation illustration, not a core Whizbang API"}
public async ValueTask<OrderCreated> HandleAsync(
    CreateOrder message,
    CancellationToken ct = default) {

    // Validation and business logic phases (above)
    // ...

    // HOOK 3: Event Generation
    Guid orderId = TrackedGuid.New();  // Time-ordered UUIDv7
    var total = message.Items.Sum(i => i.Quantity * i.UnitPrice);

    var @event = new OrderCreated(
        OrderId: orderId,
        CustomerId: message.CustomerId,
        Items: message.Items,
        Total: total,
        CreatedAt: DateTimeOffset.UtcNow
    );

    return @event;
}
```

**Hook**: Generate event representing **fact of what happened**
**Result**: Return strongly-typed event
**Guarantees**: Event is immutable (record type), contains all relevant data

### Phase 4: Event Store (Automatic)

This phase is **automatic** - no receptor code needed:

```csharp{title="Phase 4: Event Store (Automatic)" description="This phase is automatic - no receptor code needed:" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Internals", "Phase", "Event"] unverified="Illustrative Dispatcher-internal pseudo-code, not verified by this page's strategy or OSP tests"}
// Inside Dispatcher.SendAsync():
_workCoordinatorStrategy.QueueOutboxMessage(
    new OutboxMessage {
        MessageId = envelope.MessageId.Value,
        StreamId = ExtractStreamId(envelope),  // From aggregate ID
        IsEvent = payload is IEvent,  // ← Automatic detection
        // ...
    }
);
```

**Hook**: Dispatcher checks if `payload is IEvent` and sets the `IsEvent` flag on the outbox row
**Result**: `store_outbox_messages` copies newly-inserted rows with `is_event = true` (and a non-null `stream_id`) into `wh_event_store` via `_emit_event_store_chain`
**Guarantees**: Event Store + Outbox insert in **same atomic transaction**

### Phase 5: Perspective Update

**Automatic via `PublishAsync()`**:

```csharp{title="Phase 5: Perspective Update" description="Automatic via PublishAsync():" category="Internals" difficulty="BEGINNER" tags=["Extending", "Internals", "Phase", "Perspective"] unverified="Illustrative Dispatcher-internal pseudo-code for PublishAsync, not verified by this page's tests"}
// Inside Dispatcher after receptor returns
if (result is not null) {
    await PublishAsync(result, cancellationToken);
}
```

**Hook**: The perspective pipeline finds all `IPerspectiveFor<TModel, TEvent, ...>` registrations for the event type
**Result**: Each perspective's pure `Apply(currentData, eventData)` runs and the result is upserted to its read-model table
**Guarantees**: Read models updated eventually; use `AppendAndWaitAsync` / perspective sync for read-your-writes

### Phase 6: Completion

**Automatic scope disposal**:

```csharp{title="Phase 6: Completion" description="Automatic scope disposal:" category="Internals" difficulty="BEGINNER" tags=["Extending", "Internals", "Phase", "Completion"] unverified="Consumer HTTP scope-usage illustration, not a core Whizbang API"}
// Inside HTTP request handler
await using var scope = _scopeFactory.CreateAsyncScope();
var dispatcher = scope.ServiceProvider.GetRequiredService<IDispatcher>();

var result = await dispatcher.LocalInvokeAsync<CreateOrder, OrderCreated>(command);

// Scope disposal triggers:
// 1. WorkCoordinatorStrategy.FlushAsync()
// 2. store_outbox_messages (commit transaction; event rows reach
//    wh_event_store through _emit_event_store_chain)
// 3. DbContext.SaveChangesAsync() (if using EF Core)
```

**Hook**: Scope disposal at end of request
**Result**: All queued work flushed to database
**Guarantees**: Atomic commit of all operations

---

## Strategy Pattern: Three Execution Models

### 1. Immediate Strategy (Lowest Latency)

```csharp{title="Immediate Strategy (Lowest Latency)" description="Immediate Strategy (Lowest Latency)" category="Internals" difficulty="BEGINNER" tags=["Extending", "Internals", "Immediate", "Strategy"] tests=["ImmediateWorkCoordinatorStrategyTests.QueueOutboxMessage_FlushesOnCallAsync", "ImmediateWorkCoordinatorStrategyTests.FlushAsync_ImmediatelyCallsWorkCoordinatorAsync"]}
public class ImmediateWorkCoordinatorStrategy : IWorkCoordinatorStrategy {
    public void QueueOutboxMessage(OutboxMessage message) {
        _pendingOutbox.Add(message);

        // Flush immediately (no batching) - fire-and-forget flush follows
    }
    // FlushAsync(WorkBatchOptions.None) invoked right after each queue call
}
```

**Use Case**: Real-time critical operations
**Latency**: ~10ms (1 DB call per message)
**DB Load**: High (1 call per message)

### 2. Scoped Strategy (Per-Request Batching)

```csharp{title="Scoped Strategy (Per-Request Batching)" description="Scoped Strategy (Per-Request Batching)" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Internals", "Scoped", "Strategy"] tests=["ScopedWorkCoordinatorStrategyTests.DisposeAsync_FlushesQueuedMessagesAsync", "ScopedWorkCoordinatorStrategyTests.MultipleQueues_FlushedTogetherOnDisposalAsync"]}
public class ScopedWorkCoordinatorStrategy : IWorkCoordinatorStrategy, IAsyncDisposable {
    public void QueueOutboxMessage(OutboxMessage message) {
        _pendingOutbox.Add(message);
        // Don't flush yet - batch until scope disposal
    }

    public async ValueTask DisposeAsync() {
        // Flush on scope disposal (end of HTTP request)
        await FlushAsync(WorkBatchOptions.None);
    }
}
```

**Use Case**: Web APIs, per-request batching
**Latency**: ~50ms (1 DB call per request)
**DB Load**: Medium (1 call per HTTP request)

### 3. Interval Strategy (Highest Throughput)

```csharp{title="Interval Strategy (Highest Throughput)" description="Interval Strategy (Highest Throughput)" category="Internals" difficulty="INTERMEDIATE" tags=["Extending", "Internals", "Interval", "Strategy"] tests=["IntervalWorkCoordinatorStrategyTests.BackgroundTimer_FlushesEveryIntervalAsync", "IntervalWorkCoordinatorStrategyTests.QueuedMessages_BatchedUntilTimerAsync"]}
public class IntervalWorkCoordinatorStrategy : IWorkCoordinatorStrategy {
    public void QueueOutboxMessage(OutboxMessage message) {
        _pendingOutbox.Add(message);
        // Don't flush - timer will flush every 100ms
    }

    private async Task TimerCallback() {
        while (!_cts.IsCancellationRequested) {
            await Task.Delay(_options.IntervalMilliseconds, _cts.Token);
            await FlushAsync(WorkBatchOptions.None);  // Batch flush
        }
    }
}
```

**Use Case**: Background workers, high throughput
**Latency**: ~100ms (1 DB call per interval)
**DB Load**: Low (1 call per 100ms, regardless of message count)

---

## Work Coordinator: Atomic Operations

Each coordinator call is its own transaction in a focused SQL function. There is no single function that stores, completes and claims in one call; the orchestrator function earlier builds used was removed (migration 029 drops it). The transactional boundaries that matter:

| Call | SQL function | What commits together |
|---|---|---|
| `StoreOutboxMessagesAsync` | `store_outbox_messages` | The outbox rows (with partition assignment) and, for event rows with a stream id, the `wh_event_store` rows (`event_id` = the outbox `message_id`, next version per stream) and their perspective work, written by `_emit_event_store_chain` in the same transaction |
| `StoreInboxMessagesAsync` | `store_inbox_messages` | Deduplication record and inbox row (the inbox insert is `ON CONFLICT DO NOTHING`) |
| `ClaimWorkAsync` | `claim_work` | Leases on unowned or lease-expired outbox, inbox, perspective and receptor work; inbox events copied into the event store by `_emit_event_store_chain_for_inbox` |
| `CommitHandlerBatchAsync` | `commit_handler_batch` | Each handler's inbox completion plus the messages it emitted, isolated per handler by a SAVEPOINT |
| `CompleteOutboxPublishedAsync` | `complete_outbox_published` | Removal of published outbox rows (kept with `processed_at` in debug mode) |
| `ReportFailuresAsync` | `report_failures` | Failure status, error and retry schedule per category |

**Guarantees**:
1. ✅ **Atomicity**: An event's outbox row and its event-store row commit together or not at all
2. ✅ **No race conditions**: Lease-based claiming prevents duplicate work
3. ✅ **Stream ordering**: Partition assignment ensures same stream → same worker
4. ✅ **Event Store consistency**: Per-stream advisory locks serialize version assignment; a conflicting row is skipped and retried rather than duplicated
5. ✅ **Deduplication**: INSERT ... ON CONFLICT prevents duplicate inbox processing

---

## Further Reading

**Core Concepts**:
- [Dispatcher Deep Dive](../../fundamentals/dispatcher/dispatcher.md) - Three dispatch patterns
- [Receptors Guide](../../fundamentals/receptors/receptors.md) - Message handlers and business logic
- [Perspectives Guide](../../fundamentals/perspectives/perspectives.md) - Event listeners for read models

**Messaging Patterns**:
- [Work Coordinator](../../messaging/work-coordinator.md) - Atomic batch processing
- [Outbox Pattern](../../messaging/outbox-pattern.md) - Reliable event publishing
- [Inbox Pattern](../../messaging/inbox-pattern.md) - Exactly-once processing

**Components**:
- Ordered Stream Processor - Stream-based ordering guarantees

**Examples**:
- ECommerce: Order Service - Real-world implementation

### For Users

New to lifecycle stages? Start with the user guide:
- [Lifecycle Stages](../../fundamentals/lifecycle/lifecycle-stages.md) — All 28 lifecycle stages, timing guarantees, and how to register lifecycle receptors

---

*Version 1.0.0 - Foundation Release | Last Updated: 2025-12-21*
