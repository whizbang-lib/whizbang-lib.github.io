---
title: Message Lifecycle & Architecture
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
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
  - tests/Whizbang.Core.Tests/Messaging/OrderedStreamProcessorTests.cs
  - tests/Whizbang.Core.Tests/Messaging/ScopedWorkCoordinatorStrategyTests.cs
  - tests/Whizbang.Core.Tests/Messaging/IntervalWorkCoordinatorStrategyTests.cs
  - tests/Whizbang.Core.Tests/Messaging/ImmediateWorkCoordinatorStrategyTests.cs
lastMaintainedCommit: '01f07906'
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
        WC[Work Coordinator<br/>process_work_batch]
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

    PUB -->|Poll| WC
    WC -->|Claim Work| PUB
    PUB -->|Stream Order| OSP
    OSP -->|Publish| SB
    OSP -->|Report Complete| WC

    SB -->|Receive| CONS
    CONS -->|Queue Inbox| STRAT
    STRAT -->|Dedup Insert| WC
    WC -->|Check Duplicate| INBOX
    WC -->|If New| CONS
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
    participant WorkCoord as Work Coordinator<br/>process_work_batch
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

    WorkStrategy->>WorkCoord: ProcessWorkBatchAsync(<br/>  newOutboxMessages: [event],<br/>  flags: None<br/>)

    Note over WorkCoord: Single atomic transaction:

    WorkCoord->>Outbox: INSERT INTO wh_outbox
    Note over Outbox: Stream-based partitioning<br/>partition_number = hash(stream_id) % 10000

    WorkCoord->>EventStore: INSERT INTO wh_event_store<br/>(if is_event=true AND stream_id IS NOT NULL)
    Note over EventStore: Auto-increment version per stream<br/>Global sequence for ordering

    WorkCoord-->>WorkStrategy: WorkBatch(claimedOutboxMessages, ...)
    WorkStrategy-->>Dispatcher: WorkBatch

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
    participant WorkCoord as Work Coordinator<br/>process_work_batch
    participant Outbox

    Client->>Controller: POST /orders/async
    Controller->>Dispatcher: SendAsync(CreateOrder)

    Note over Dispatcher: Create MessageEnvelope<br/>Generate MessageId, CorrelationId

    Dispatcher->>Receptor: HandleAsync(CreateOrder)
    Receptor-->>Dispatcher: OrderCreated event

    Dispatcher->>WorkStrategy: QueueOutboxMessage(event, isEvent=true)
    Dispatcher->>WorkStrategy: FlushAsync()

    WorkStrategy->>WorkCoord: ProcessWorkBatchAsync(<br/>  newOutboxMessages: [event]<br/>)

    WorkCoord->>Outbox: INSERT INTO wh_outbox
    WorkCoord-->>WorkStrategy: WorkBatch
    WorkStrategy-->>Dispatcher: WorkBatch

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

### Background Workers: ClaimWorker + OutboxPublishWorker

:::updated
The legacy `WorkCoordinatorPublisherWorker` has been decomposed into a work-pump pipeline (Phase C): `ClaimWorker` is the **only** place that calls `IWorkCoordinator.ClaimWorkAsync` (adaptive backoff on empty polls, with a wake semaphore driven by Postgres NOTIFY / local channel writes); claimed work flows through in-process channels to `OutboxPublishWorker`, which publishes to transport via `IMessagePublishStrategy`; completions and failures are flushed back to the database by dedicated flush workers (`OutboxCompletionFlushWorker`, `FailureFlushWorker`). The sequence below shows the logical flow — claim, ordered publish, completion reporting — which is unchanged.
:::

```mermaid{caption="Outbox publishing flow: lease-based claim, ordered per-stream publish to transport via the Ordered Stream Processor, then atomic completion reporting"}
sequenceDiagram
    participant Timer
    participant PublisherWorker as ClaimWorker +<br/>OutboxPublishWorker
    participant WorkStrategy as Work Coordinator<br/>Strategy (Interval)
    participant WorkCoord as Work Coordinator<br/>process_work_batch
    participant Outbox
    participant OSP as Ordered Stream<br/>Processor
    participant Transport as Azure Service Bus

    loop Every 100ms (configurable interval)
        Timer->>PublisherWorker: Tick

        PublisherWorker->>WorkStrategy: FlushAsync()

        WorkStrategy->>WorkCoord: ProcessWorkBatchAsync(<br/>  InstanceId: worker-guid,<br/>  ServiceName: "OrderService",<br/>  PartitionCount: 10000,<br/>  LeaseSeconds: 300,<br/>  MaxStreamsPerBatch: 300<br/>)

        Note over WorkCoord: Atomic lease-based claiming:

        WorkCoord->>Outbox: SELECT * FROM wh_outbox<br/>WHERE partition_number IN (assigned_partitions)<br/>  AND (instance_id IS NULL OR lease_expiry < NOW())<br/>  AND (status & 4) != 4 AND (status & 32768) = 0<br/>FOR UPDATE SKIP LOCKED

        WorkCoord->>Outbox: UPDATE wh_outbox SET<br/>  instance_id = @InstanceId,<br/>  lease_expiry = NOW() + @LeaseSeconds<br/>WHERE message_id IN (...)

        WorkCoord-->>WorkStrategy: WorkBatch(claimedOutboxMessages: [...])

        WorkStrategy-->>PublisherWorker: WorkBatch

        alt Has claimed messages
            PublisherWorker->>OSP: ProcessOutboxWorkAsync(messages)

            Note over OSP: Group by stream_id<br/>Sort by sequence_order per stream<br/>Process sequentially per stream

            loop For each stream (parallel)
                loop For each message in stream (sequential)
                    OSP->>Transport: PublishAsync(topic, messageId, payload)

                    alt Success
                        OSP->>WorkStrategy: QueueOutboxCompletion(messageId, Published)
                    else Failure
                        OSP->>WorkStrategy: QueueOutboxFailure(messageId, Failed, error)
                    end
                end
            end

            PublisherWorker->>WorkStrategy: FlushAsync()

            WorkStrategy->>WorkCoord: ProcessWorkBatchAsync(<br/>  outboxCompletions: [...],<br/>  outboxFailures: [...]<br/>)

            WorkCoord->>Outbox: DELETE FROM wh_outbox<br/>WHERE message_id IN (completions)

            WorkCoord->>Outbox: UPDATE wh_outbox SET<br/>  status = status | 32768 (Failed),<br/>  error = ...,<br/>  failure_reason = ...,<br/>  scheduled_for = backoff<br/>WHERE message_id IN (failures)
        end
    end
```

**Key Points**:
1. **Adaptive polling**: ClaimWorker backs off on consecutive empty polls; NOTIFY signals wake it immediately
2. **Partition-based distribution**: Each worker claims a subset of partitions
3. **Lease-based coordination**: Prevents duplicate processing across workers
4. **Stream ordering via OrderedStreamProcessor**: Events from same stream processed sequentially
5. **Parallel streams**: Different streams can process concurrently
6. **Atomic completion reporting**: Deletes completed, updates failed

---

## Event Flow (Consuming from Inbox)

### Background Worker: ServiceBusConsumerWorker

```mermaid{caption="Inbox consuming flow: atomic dedup insert, ordered per-stream perspective invocation via the Ordered Stream Processor, then completion reporting and Service Bus completion"}
sequenceDiagram
    participant ServiceBus as Azure Service Bus
    participant ConsumerWorker as ServiceBus<br/>ConsumerWorker
    participant WorkStrategy as Work Coordinator<br/>Strategy (Scoped)
    participant WorkCoord as Work Coordinator<br/>process_work_batch
    participant Inbox
    participant OSP as Ordered Stream<br/>Processor
    participant Perspectives

    ServiceBus->>ConsumerWorker: Receive message

    Note over ConsumerWorker: Create scoped DI container<br/>(per message)

    ConsumerWorker->>ConsumerWorker: Deserialize MessageEnvelope

    ConsumerWorker->>WorkStrategy: QueueInboxMessage(envelope)

    ConsumerWorker->>WorkStrategy: FlushAsync()

    WorkStrategy->>WorkCoord: ProcessWorkBatchAsync(<br/>  newInboxMessages: [envelope]<br/>)

    Note over WorkCoord: Atomic deduplication:

    WorkCoord->>Inbox: INSERT INTO wh_inbox<br/>ON CONFLICT (message_id) DO NOTHING<br/>RETURNING *

    alt Message is duplicate
        WorkCoord-->>WorkStrategy: WorkBatch(claimedInboxMessages: [])
        WorkStrategy-->>ConsumerWorker: WorkBatch (empty)

        Note over ConsumerWorker: Duplicate detected,<br/>skip processing

        ConsumerWorker->>ServiceBus: Complete message
    else Message is new
        WorkCoord-->>WorkStrategy: WorkBatch(claimedInboxMessages: [envelope])
        WorkStrategy-->>ConsumerWorker: WorkBatch

        ConsumerWorker->>OSP: ProcessInboxWorkAsync(messages)

        Note over OSP: Group by stream_id<br/>Sort by sequence_order per stream<br/>Process sequentially per stream

        loop For each stream (parallel)
            loop For each message in stream (sequential)
                OSP->>OSP: Deserialize event payload

                OSP->>Perspectives: InvokePerspectivesAsync(event)

                Note over Perspectives: Find all perspectives<br/>registered for this event type

                par Update Read Models
                    Perspectives->>Perspectives: OrderSummaryPerspective.Apply()
                    Perspectives->>Perspectives: InventoryPerspective.Apply()
                    Perspectives->>Perspectives: AnalyticsPerspective.Apply()
                end

                alt All perspectives succeeded
                    OSP->>WorkStrategy: QueueInboxCompletion(messageId, Completed)
                else Any perspective failed
                    OSP->>WorkStrategy: QueueInboxFailure(messageId, Failed, error)
                end
            end
        end

        ConsumerWorker->>WorkStrategy: FlushAsync()

        WorkStrategy->>WorkCoord: ProcessWorkBatchAsync(<br/>  inboxCompletions: [...],<br/>  inboxFailures: [...]<br/>)

        WorkCoord->>Inbox: DELETE FROM wh_inbox<br/>WHERE message_id IN (completions)

        WorkCoord->>Inbox: UPDATE wh_inbox SET<br/>  status = status | 32768 (Failed),<br/>  error = ...,<br/>  scheduled_for = backoff<br/>WHERE message_id IN (failures)

        ConsumerWorker->>ServiceBus: Complete message
    end

    Note over WorkStrategy: Scope disposed<br/>(end of message processing)
```

**Key Points**:
1. **Scoped strategy**: One scope per message
2. **Atomic deduplication**: INSERT ... ON CONFLICT ensures exactly-once semantics
3. **Stream ordering**: OrderedStreamProcessor ensures events from same stream process sequentially
4. **Perspective invocation**: All registered perspectives updated in parallel
5. **Completion reporting**: Atomic delete (success) or update (failure)
6. **Service Bus completion**: Only after database commit

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
    Guid orderId = TrackedGuid.NewMedo();  // Time-ordered UUIDv7
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
// 2. process_work_batch (commit transaction)
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

All operations in `process_work_batch` are **atomic** (single transaction):

```sql{title="Work Coordinator: Atomic Operations" description="All operations in process_work_batch are atomic (single transaction):" category="Internals" difficulty="ADVANCED" tags=["Extending", "Internals", "Work", "Coordinator:"]}
CREATE OR REPLACE FUNCTION process_work_batch(...)
RETURNS TABLE (...) AS $$
BEGIN
    -- 1. Delete completed outbox messages
    DELETE FROM wh_outbox
    WHERE message_id IN (SELECT message_id FROM jsonb_array_elements(p_outbox_completions));

    -- 2. Update failed outbox messages (process_outbox_failures)
    UPDATE wh_outbox SET
        status = status | 32768,  -- Failed bit
        error = ...,
        failure_reason = ...,
        scheduled_for = ...  -- exponential backoff
    WHERE message_id IN (...);

    -- 3. Insert new outbox messages (with partition assignment)
    INSERT INTO wh_outbox (message_id, stream_id, partition_number, ...)
    SELECT
        (elem->>'message_id')::UUID,
        (elem->>'stream_id')::UUID,
        abs(hashtext((elem->>'stream_id')::TEXT)) % p_partition_count,  -- Partition
        ...
    FROM jsonb_array_elements(p_new_outbox_messages) AS elem;

    -- 4. Copy newly-inserted events to the event store
    -- (store_outbox_messages calls _emit_event_store_chain for rows with
    --  is_event = true AND stream_id IS NOT NULL)
    INSERT INTO wh_event_store (event_id, stream_id, event_type, version, ...)
    SELECT
        (elem->>'message_id')::UUID,
        (elem->>'stream_id')::UUID,
        (elem->>'message_type')::TEXT,
        COALESCE(
            (SELECT MAX(version) + 1 FROM wh_event_store WHERE stream_id = (elem->>'stream_id')::UUID),
            1
        ),
        ...
    FROM jsonb_array_elements(p_new_outbox_messages) AS elem
    WHERE (elem->>'is_event')::BOOLEAN = TRUE
      AND (elem->>'stream_id') IS NOT NULL;

    -- 5-8. Similar atomic operations for inbox
    -- ...

    -- 9. Claim new outbox work (lease-based)
    UPDATE wh_outbox
    SET
        instance_id = p_instance_id,
        lease_expiry = NOW() + (p_lease_seconds || ' seconds')::INTERVAL
    WHERE message_id IN (
        SELECT message_id FROM wh_outbox
        WHERE partition_number IN (SELECT * FROM assigned_partitions)
          AND (instance_id IS NULL OR lease_expiry < NOW())
          AND (status & 4) != 4       -- not yet Published
          AND (status & 32768) = 0    -- not Failed
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED  -- Non-blocking claim
    )
    RETURNING *;

    -- COMMIT (all operations succeed or fail together)
END;
$$ LANGUAGE plpgsql;
```

**Guarantees**:
1. ✅ **Atomicity**: All operations succeed together or fail together
2. ✅ **No race conditions**: Lease-based claiming prevents duplicate work
3. ✅ **Stream ordering**: Partition assignment ensures same stream → same worker
4. ✅ **Event Store consistency**: Event version conflicts detected automatically
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
- [Lifecycle Stages](../../fundamentals/lifecycle/lifecycle-stages.md) — All 24 lifecycle stages, timing guarantees, and how to register lifecycle receptors

---

*Version 1.0.0 - Foundation Release | Last Updated: 2025-12-21*
