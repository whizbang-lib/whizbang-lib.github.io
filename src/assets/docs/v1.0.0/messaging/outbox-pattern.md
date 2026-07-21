---
title: Outbox Pattern
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Messaging
order: 1
description: >-
  Implement reliable cross-service event publishing with the Outbox Pattern -
  guaranteed delivery without distributed transactions
tags: >-
  outbox, reliable-messaging, transactional-outbox, event-publishing,
  distributed-systems
codeReferences:
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Core/Workers/OutboxPublishWorker.cs
  - src/Whizbang.Core/Workers/OutboxDrainWorker.cs
  - src/Whizbang.Data.Postgres/Migrations/020_StoreOutboxMessages.sql
  - >-
    samples/ECommerce/ECommerce.OrderService.API/Receptors/CreateOrderReceptor.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/FetchOutboxBatchSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/CompleteOutboxPublishedSqlTests.cs
  - tests/Whizbang.Core.Tests/Workers/OutboxDrainWorkerTests.cs
  - tests/Whizbang.Core.Tests/Workers/OutboxPublishWorkerTests.cs
lastMaintainedCommit: '01f07906'
---

# Outbox Pattern

The **Outbox Pattern** ensures reliable event publishing in distributed systems by storing events in a database table ("outbox") as part of the same transaction that modifies business data. A background worker then publishes events from the outbox to the message transport.

## Problem: Dual Writes

**The Challenge**: How do you atomically update a database AND publish an event to a message broker?

### Naive Approach (BROKEN)

```csharp{title="Naive Approach (BROKEN)" description="Naive Approach (BROKEN)" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Naive", "Approach", "BROKEN"] unverified="counter-example — the broken dual-write anti-pattern, intentionally not atomic"}
public async Task<OrderCreated> HandleAsync(CreateOrder message, CancellationToken ct) {
    // 1. Update database
    await _db.ExecuteAsync(
        "INSERT INTO orders (order_id, customer_id, total) VALUES (@OrderId, @CustomerId, @Total)",
        new { OrderId = orderId, message.CustomerId, Total = total }
    );

    // 2. Publish event to Azure Service Bus
    await _transport.PublishAsync(orderCreatedEvent);  // ❌ NOT ATOMIC!

    return orderCreatedEvent;
}
```

**What can go wrong?**
- ❌ Database commit succeeds, but publish fails → Event lost!
- ❌ Publish succeeds, but database commit fails → Duplicate event!
- ❌ Process crashes between the two operations → Inconsistent state!

**Root Cause**: You cannot have a distributed transaction across database and message broker.

---

## Solution: Outbox Pattern

**The Fix**: Store the event in the database (same transaction), then publish it later.

```mermaid{caption="Outbox solution — the event is stored in wh_outbox atomically with the business write, then background workers claim, drain, publish, and delete the row." tests=["OutboxDrainWorkerTests.OutboxDrainWorker_OnStreamId_FetchesBatch_PublishesEach_EnqueuesCompletionAsync"]}
flowchart TD
    TX["Database Transaction<br/><br/>1. INSERT INTO orders (...) VALUES (...)<br/>2. INSERT INTO wh_outbox (...) VALUES (...) — Event stored atomically!"]
    Worker["Background Workers<br/><br/>3. ClaimWorker: claim_work leases rows, returns stream ids<br/>4. OutboxDrainWorker: fetch bodies per stream, publish in FIFO order<br/>5. complete_outbox_published: DELETE the row (prod)<br/>&nbsp;&nbsp;&nbsp;&nbsp;(debug mode retains it with published_at stamped)"]

    TX --> Worker

    class TX layer-event
    class Worker layer-command
```

**Benefits**:
- ✅ **Atomicity**: Event stored in same transaction as business data
- ✅ **Guaranteed delivery**: Event will be published eventually
- ✅ **No data loss**: If publish fails, event remains in outbox for retry
- ✅ **Idempotency**: Can safely retry publishing

---

## Whizbang Implementation

### Database Schema

```sql{title="Database Schema" description="Database Schema" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "Sql", "Database", "Schema"]}
CREATE TABLE IF NOT EXISTS wh_outbox (
  message_id UUID NOT NULL PRIMARY KEY,
  destination VARCHAR(500) NOT NULL,
  message_type VARCHAR(500) NOT NULL,
  event_data JSONB NOT NULL,
  metadata JSONB NOT NULL,
  scope JSONB NULL,
  stream_id UUID NULL,
  partition_number INTEGER NULL,
  is_event BOOLEAN NOT NULL DEFAULT FALSE,
  status INTEGER NOT NULL DEFAULT 1,          -- MessageProcessingStatus flags (Stored = 1)
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT NULL,
  instance_id UUID NULL,
  lease_expiry TIMESTAMPTZ NULL,
  failure_reason INTEGER NOT NULL DEFAULT 99,
  scheduled_for TIMESTAMPTZ NULL,             -- Scheduled retry gate
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMPTZ NULL,
  processed_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_outbox_status_created_at ON wh_outbox (status, created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_published_at ON wh_outbox (published_at);
CREATE INDEX IF NOT EXISTS idx_outbox_lease_expiry ON wh_outbox (lease_expiry) WHERE lease_expiry IS NOT NULL;
```

**Key Fields**:
- **message_id**: Unique identifier (UUIDv7)
- **destination**: Transport destination (topic/exchange) the message publishes to
- **status**: `MessageProcessingStatus` flags bitmask (Stored = 1, Published = 4, Failed = 32768)
- **instance_id** / **lease_expiry**: Which worker claimed this message, and until when
- **partition_number**: Consistent hashing for work distribution
- **created_at**: Order-of-creation timestamp — outbox ordering uses `created_at` (inbox uses `received_at`)

### IWorkCoordinator Operations

The outbox flow uses these focused `IWorkCoordinator` operations (see [Work Coordinator](work-coordinator.md) for the full API reference):

1. `StoreOutboxMessagesAsync` → `store_outbox_messages` — insert new outbox rows
2. `ClaimWorkAsync` → `claim_work` — lease rows, return claimed stream ids
3. `FetchOutboxBatchAsync` → `fetch_outbox_batch` — pull leased bodies for one stream in FIFO order
4. `CompleteOutboxPublishedAsync` → `complete_outbox_published` — delete (prod) or stamp (debug) published rows
5. `ReportFailuresAsync` → `report_failures` — increment attempts, record error/failure_reason

---

## Storing Events in Outbox

### Example: CreateOrderReceptor

You don't write outbox plumbing — `dispatcher.PublishAsync()` routes the event into the outbox, and the handler-commit path stores it atomically with your message's completion:

```csharp{title="Example: CreateOrderReceptor" description="Example: CreateOrderReceptor" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Example:", "CreateOrderReceptor"] unverified="sample receptor from samples/ECommerce — application handler code, not covered by a framework test"}
public class CreateOrderReceptor(
    IDispatcher dispatcher,
    ILogger<CreateOrderReceptor> logger)
    : IReceptor<CreateOrderCommand, OrderCreatedEvent> {

    public async ValueTask<OrderCreatedEvent> HandleAsync(
        CreateOrderCommand message,
        CancellationToken cancellationToken = default) {

        // Validate order (business logic)
        if (message.TotalAmount <= 0) {
            throw new InvalidOperationException("Order total must be positive");
        }

        // Create the event
        var orderCreated = new OrderCreatedEvent {
            OrderId = message.OrderId,
            CustomerId = message.CustomerId,
            LineItems = message.LineItems,
            TotalAmount = message.TotalAmount,
            CreatedAt = DateTime.UtcNow
        };

        // Publish → collected into the outbox; committed atomically with
        // this message's inbox completion via commit_handler_batch
        await dispatcher.PublishAsync(orderCreated);

        return orderCreated;
    }
}
```

**Key Points**:
- ✅ The emitted event and the handler's completion commit in the **same transaction** (`commit_handler_batch`)
- ✅ If the transaction fails, **nothing** is committed (atomicity) — the inbox message retries and re-emits
- ✅ Event is stored even if the network to the message broker is down

---

## Publishing from Outbox

### The Publish Pipeline

Publishing is handled by a set of cooperating background workers (all registered automatically):

```mermaid{caption="Outbox publish pipeline — ClaimWorker leases stream ids, OutboxDrainWorker fetches bodies per stream and publishes in created_at FIFO order, then completions flush through complete_outbox_published." tests=["OutboxDrainWorkerTests.OutboxDrainWorker_OnStreamId_FetchesBatch_PublishesEach_EnqueuesCompletionAsync"]}
sequenceDiagram
    participant CW as ClaimWorker
    participant DB as PostgreSQL
    participant ODW as OutboxDrainWorker
    participant T as Transport
    participant OCF as OutboxCompletionFlushWorker

    CW->>DB: claim_work() — leases rows
    DB-->>CW: outbox stream ids (bodies NULL)
    CW->>ODW: stream_id via IOutboxDrainChannel

    ODW->>DB: fetch_outbox_batch(stream_id)
    DB-->>ODW: leased bodies in created_at order
    ODW->>T: publish each (stream-FIFO)
    T-->>ODW: Ack

    ODW->>OCF: enqueue completion ids
    OCF->>DB: complete_outbox_published([ids])
    DB->>DB: DELETE rows (prod) / stamp published_at (debug)
```

**Workflow**:
1. **Claim work**: `ClaimWorker` polls `claim_work` (adaptive cadence: 250 ms base, 10 s backoff cap, 5 s relaxed when LISTEN/NOTIFY is healthy) — a NOTIFY from the storing transaction wakes it immediately
2. **Drain**: `OutboxDrainWorker` fetches leased bodies per stream and publishes in stream-FIFO order via `IMessagePublishStrategy`; `OutboxPublishWorker` fires Pre/Post Outbox lifecycle stages
3. **Report**: completions batch through `OutboxCompletionFlushWorker` → `complete_outbox_published`; failures batch through `FailureFlushWorker` → `report_failures`
4. **Retry**: failed messages stay in the outbox (lease released, attempts incremented) until they succeed or exceed `MaxOutboxAttempts` (default 10, then dead-lettered to `wh_dead_letters`)

---

## Lease-Based Coordination

### How Leasing Works

```sql{title="How Leasing Works" description="How Leasing Works (conceptual — see claim_orphaned_outbox in migration 024)" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "Sql", "How", "Leasing", "Works"]}
-- Claim unowned / lease-expired outbox rows this instance may own
UPDATE wh_outbox
SET
    instance_id = @InstanceId,
    lease_expiry = NOW() + INTERVAL '5 minutes'
WHERE processed_at IS NULL
  AND (instance_id IS NULL OR lease_expiry < NOW())  -- Available or lease expired
  AND (scheduled_for IS NULL OR scheduled_for <= NOW())
  -- Ownership: stream pinned to this instance in wh_active_streams,
  -- OR unowned and partition_number % active_instance_count = instance_rank
ORDER BY created_at;
```

**Benefits**:
- ✅ **Parallel processing**: Multiple workers can process different streams
- ✅ **Fault tolerance**: If worker crashes, lease expires and message is reclaimed
- ✅ **Load balancing**: Work distributed via consistent hashing (partition_number) + stream pinning

### Configuration

```csharp{title="Configuration" description="Configuration" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "Configuration"] unverified="configuration example — ClaimWorkerOptions DI wiring, no behavioral assertion"}
services.Configure<ClaimWorkerOptions>(options => {
    options.PollingIntervalMilliseconds = 250;               // base cadence (default)
    options.PollingMaxIntervalMilliseconds = 10_000;         // adaptive backoff cap (default 10 s)
    options.NotifyHealthyPollingIntervalMilliseconds = 5_000; // relaxed cadence when NOTIFY healthy
    options.LeaseSeconds = 300;                              // 5 minutes (default)
    options.PartitionCount = 10_000;                         // modulo partition count (default)
});
```

**Parameters**:
- `PollingIntervalMilliseconds`: Base claim-loop cadence (250 ms); NOTIFY wakes the loop immediately on new work
- `PollingMaxIntervalMilliseconds`: Adaptive backoff cap on consecutive empty polls (10 s)
- `NotifyHealthyPollingIntervalMilliseconds`: Relaxed safety-net cadence while LISTEN/NOTIFY is verified healthy (5 s)
- `LeaseSeconds`: How long a lease lasts (300 s = 5 minutes)
- `PartitionCount`: Total partitions for consistent hashing (10,000)

---

## Guaranteed Delivery

### At-Least-Once Semantics

The Outbox Pattern provides **at-least-once delivery**:
- ✅ Event is **guaranteed** to be published (eventually)
- ⚠️ Event **may** be published multiple times (rare, but possible)

**Why duplicates?**
```
1. Worker publishes message to Azure Service Bus (success)
2. complete_outbox_published flush fails (network blip) — row still in wh_outbox
3. Lease expires
4. Different worker claims message
5. Worker publishes message again (duplicate!)
```

**Solution**: Use Inbox Pattern on receiving side to detect duplicates.

### Retry Strategy

```csharp{title="Retry Strategy" description="Failures are reported through the coordinator" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Retry", "Strategy"] unverified="ReportFailuresAsync outbox-failure behavior (error stamped, lease released) is verified by EFCoreFlusherMethodsTests and DapperWorkCoordinatorWithDataTests, which are outside the current coverage map"}
// FailureFlushWorker batches failures per category:
await coordinator.ReportFailuresAsync(
    WorkCategory.Outbox,
    [
        new MessageFailure {
            MessageId = row.MessageId,
            CompletedStatus = MessageProcessingStatus.Stored,
            Error = ex.Message,
            Reason = MessageFailureReason.TransportException
        }
    ],
    ct);
// SQL: attempts + 1, error + failure_reason stamped, lease released
```

**Retry Logic**:
- Attempts 1 through `MaxOutboxAttempts` (default 10): retry (lease released, row re-claimable; transport-not-ready failures re-buffer with a lease renewal instead of counting as attempts)
- Beyond `MaxOutboxAttempts`: `OutboxPublishWorker`/`OutboxDrainWorker` promote the row to `wh_dead_letters`

**Monitoring**:
```sql{title="Retry Strategy (2)" description="Monitoring:" category="Architecture" difficulty="BEGINNER" tags=["Messaging", "Sql", "Retry", "Strategy"]}
-- Find messages accumulating failures
SELECT message_id, message_type, attempts, error, created_at
FROM wh_outbox
WHERE attempts > 0 AND processed_at IS NULL
ORDER BY created_at DESC;

-- Messages that gave up (moved to the internal dead-letter table)
SELECT * FROM wh_dead_letters WHERE source_table = 'wh_outbox';
```

---

## Best Practices

### DO ✅

- ✅ Store events in **same transaction** as business data (automatic via the handler-commit path)
- ✅ Use **UUIDv7** for MessageId — `TrackedGuid.NewMedo()` (time-ordered, avoids index fragmentation)
- ✅ Set **reasonable lease duration** (5 minutes default)
- ✅ **Monitor dead letters** (rows land in `wh_dead_letters` after `MaxOutboxAttempts`, default 10)
- ✅ Use **consistent hashing** (partition_number) for work distribution
- ✅ **Log all publishes** (correlation ID, message type, destination)
- ✅ **Rely on built-in retries** (lease release + reclaim, scheduled retry backoff, max attempts)
- ✅ **Published rows clean themselves up** (deleted at completion in production; debug mode retains them)

### DON'T ❌

- ❌ Publish directly to transport without outbox (breaks atomicity)
- ❌ Use database locks instead of leases (doesn't scale)
- ❌ Ignore failed messages (silent data loss)
- ❌ Set lease duration too short (thrashing)
- ❌ Set lease duration too long (slow recovery from crashes)
- ❌ Store large payloads in outbox (use payload size limits)
- ❌ Skip monitoring (blind to failures)

---

## Monitoring & Observability

### Key Metrics

In production, published rows are **deleted at completion** — pending depth is what you monitor (successful-publish counts live in your logs/metrics, or in debug mode where rows are retained).

```csharp{title="Key Metrics" description="Key Metrics" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Key", "Metrics"] unverified="illustrative monitoring code — user-defined metrics query, not a framework API"}
public class OutboxMetrics {
    public int PendingCount { get; set; }     // Messages waiting to be published
    public int DeadLetterCount { get; set; }  // Messages that failed max retries
    public double OldestMessageAge { get; set; }  // Age of oldest pending message (seconds)
    public int ActiveLeases { get; set; }     // Number of active leases
}

public async Task<OutboxMetrics> GetMetricsAsync(CancellationToken ct = default) {
    await using var conn = _db.CreateConnection();

    var metrics = await conn.QuerySingleAsync<OutboxMetrics>(
        """
        SELECT
            COUNT(*) FILTER (WHERE processed_at IS NULL) AS PendingCount,
            (SELECT COUNT(*) FROM wh_dead_letters WHERE source_table = 'wh_outbox') AS DeadLetterCount,
            EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE processed_at IS NULL))) AS OldestMessageAge,
            COUNT(*) FILTER (WHERE instance_id IS NOT NULL AND lease_expiry > NOW()) AS ActiveLeases
        FROM wh_outbox
        """,
        cancellationToken: ct
    );

    return metrics;
}
```

### Alerts

**Critical Alerts**:
- 🚨 `OldestMessageAge > 600` (message stuck for 10+ minutes)
- 🚨 `DeadLetterCount > 0` (messages gave up after max retries)
- 🚨 `PendingCount > 10000` (outbox backlog growing)

**Warning Alerts**:
- ⚠️ `OldestMessageAge > 60` (message not published within 1 minute)
- ⚠️ `PendingCount > 1000` (outbox filling up)

---

## Testing

### Integration Tests

The framework's own suite exercises the store → claim → fetch → complete cycle (see `FetchOutboxBatchSqlTests.cs` and `CompleteOutboxPublishedSqlTests.cs`):

```csharp{title="Integration Tests" description="Store, publish, and complete an outbox message" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Integration", "Tests"] unverified="illustrative integration test — the store, claim, fetch, complete cycle and production-mode row deletion are verified by FetchOutboxBatchSqlTests and CompleteOutboxPublishedSqlTests, which are outside the current coverage map"}
[Test]
public async Task StoreClaimPublishComplete_RemovesRowAsync() {
    // Arrange - store a message (normally done by the handler-commit path)
    var message = BuildOutboxMessage(messageId: (Guid)TrackedGuid.NewMedo());
    await _coordinator.StoreOutboxMessagesAsync([message], partitionCount: 10_000);

    // Act - claim, fetch bodies, complete
    var batch = await _coordinator.ClaimWorkAsync(BuildClaimRequest());
    var rows = await _coordinator.FetchOutboxBatchAsync(
        batch.OutboxStreamIds, _instanceId);

    // ... publish rows to the (test) transport ...

    var affected = await _coordinator.CompleteOutboxPublishedAsync(
        rows.Select(r => r.MessageId).ToList());

    // Assert - production mode deletes the row
    await Assert.That(affected).IsEqualTo(1);
    var remaining = await _db.ExecuteScalarAsync<int>(
        "SELECT COUNT(*) FROM wh_outbox WHERE message_id = @MessageId",
        new { message.MessageId });
    await Assert.That(remaining).IsEqualTo(0);
}
```

For end-to-end worker tests, use completion signals (lifecycle hooks, `TaskCompletionSource`) rather than `Task.Delay` polling.

---

## Further Reading

**Core Concepts**:
- [Dispatcher](../fundamentals/dispatcher/dispatcher.md) - How to publish events
- [Receptors](../fundamentals/receptors/receptors.md) - Message handlers

**Messaging Patterns**:
- [Inbox Pattern](inbox-pattern.md) - Exactly-once message processing
- [Work Coordination](work-coordinator.md) - IWorkCoordinator deep dive
- [Message Envelopes](message-envelopes.md) - Hop-based observability

**Examples**:
- ECommerce: Order Service - Real-world outbox usage

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
