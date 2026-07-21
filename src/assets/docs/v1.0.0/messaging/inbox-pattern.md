---
title: Inbox Pattern
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Messaging
order: 2
description: >-
  Achieve exactly-once message processing with the Inbox Pattern - automatic
  deduplication and idempotent message handling
tags: 'inbox, exactly-once, deduplication, idempotency, message-processing'
codeReferences:
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Core/Workers/TransportConsumerWorker.cs
  - src/Whizbang.Core/Workers/InboxDispatchWorker.cs
  - src/Whizbang.Data.Postgres/Migrations/021_StoreInboxMessages.sql
  - samples/ECommerce/ECommerce.InventoryWorker/Receptors/ReserveInventoryReceptor.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StoreInboxMessagesSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreStoreInboxMessagesTests.cs
  - tests/Whizbang.Core.Tests/Workers/InboxDispatchWorkerDeadLetterTests.cs
  - tests/Whizbang.Core.Tests/Workers/InboxDispatchWorkerTests.cs
lastMaintainedCommit: '01f07906'
---

# Inbox Pattern

The **Inbox Pattern** ensures exactly-once message processing by storing incoming messages in a database table ("inbox") before processing. If a duplicate message arrives, it's detected and ignored.

## Problem: Duplicate Messages

**The Challenge**: Message brokers provide **at-least-once delivery**, meaning messages may be delivered multiple times.

### Sources of Duplicates

1. **Outbox retry**: Publisher retries after partial failure
2. **Network timeout**: Ack not received, broker resends
3. **Consumer restart**: Message in-flight when consumer crashes
4. **Broker failover**: Message replayed after broker failover

### Naive Approach (BROKEN)

```csharp{title="Naive Approach (BROKEN)" description="Naive Approach (BROKEN)" category="Architecture" difficulty="BEGINNER" tags=["Messaging", "C#", "Naive", "Approach", "BROKEN"] unverified="counter-example — no duplicate detection, processes every message"}
public async Task ProcessMessageAsync(OrderCreated @event, CancellationToken ct) {
    // ❌ No duplicate detection - processes every message!

    await _db.ExecuteAsync(
        "UPDATE inventory SET reserved = reserved + @Quantity WHERE product_id = @ProductId",
        new { @event.ProductId, @event.Quantity }
    );
}
```

**What goes wrong with duplicates?**
- ❌ Inventory reserved twice (incorrect stock levels)
- ❌ Payment charged twice (angry customers!)
- ❌ Email sent twice (spam)

---

## Solution: Inbox Pattern

**The Fix**: Record the message ID **before** processing — duplicates are rejected at store time, so a message can never enter the pipeline twice.

```mermaid{caption="Inbox pipeline — transport arrival, dedup-gated store, lease + stream-FIFO claim, then atomic handler commit."}
flowchart TD
    S1["1. Message arrives from transport<br/>(unsubscribed messages are discarded at the<br/>receive boundary — no inbox row at all)"]
    S2["2. store_inbox_messages:<br/>INSERT INTO wh_message_deduplication ... ON CONFLICT DO NOTHING<br/><br/>If conflict: SKIP (already seen!) — Exactly-once!<br/>If new: INSERT INTO wh_inbox (same transaction)"]
    S3["3. ClaimWorker leases the row;<br/>handlers invoked in stream order"]
    S4["4. Handler commit (commit_handler_batch):<br/>completion + emitted messages, atomic"]

    S1 --> S2
    S2 --> S3
    S3 --> S4

    class S1,S2 layer-command
    class S3 layer-core
    class S4 layer-event
```

**Benefits**:
- ✅ **Exactly-once processing**: Duplicates detected and skipped
- ✅ **Idempotent**: Safe to replay messages
- ✅ **Automatic**: Framework handles deduplication
- ✅ **Auditability**: Deduplication record of processed message IDs (retention window applies)

---

## Whizbang Implementation

### Database Schema

```sql{title="Database Schema" description="Database Schema" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "Sql", "Database", "Schema"]}
CREATE TABLE IF NOT EXISTS wh_inbox (
  message_id UUID NOT NULL PRIMARY KEY,
  handler_name VARCHAR(500) NOT NULL,
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
  processed_at TIMESTAMPTZ NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inbox_processed_at ON wh_inbox (processed_at);
CREATE INDEX IF NOT EXISTS idx_inbox_received_at ON wh_inbox (received_at);
CREATE INDEX IF NOT EXISTS idx_inbox_lease_expiry ON wh_inbox (lease_expiry) WHERE lease_expiry IS NOT NULL;

-- Deduplication happens against a separate table:
CREATE TABLE IF NOT EXISTS wh_message_deduplication (
  message_id UUID NOT NULL PRIMARY KEY,       -- Enforces exactly-once!
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

**Key Fields**:
- **message_id**: Unique message identifier (primary key on both tables)
- **status**: `MessageProcessingStatus` flags bitmask (Stored = 1, EventStored = 2, Failed = 32768)
- **instance_id** / **lease_expiry**: Which worker holds the lease, and until when
- **scheduled_for**: When set, the row (and later rows in its stream) waits for the retry time
- **received_at**: Order-of-arrival timestamp — inbox ordering uses `received_at` (outbox uses `created_at`)

**Critical**: The `wh_message_deduplication` primary key prevents duplicate processing — the inbox insert only happens when the dedup insert succeeds.

---

## Detecting Duplicates

Deduplication is **automatic** — you never write this code yourself. Two boundaries filter incoming messages:

### Boundary 1: The Receive Boundary

`TransportConsumerWorker` discards messages that no receptor, perspective, or tag attribute subscribes to **before** any database work — no inbox row, no deserialization, no lifecycle. Only messages your service actually handles reach the inbox.

### Boundary 2: The Deduplication Table

The `store_inbox_messages` PostgreSQL function (called via `IWorkCoordinator.StoreInboxMessagesAsync`) tries the dedup insert first and gates the inbox insert on its success:

```sql{title="Atomic Insert with Duplicate Check" description="store_inbox_messages dedup gate (021_StoreInboxMessages.sql)" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "Sql", "Atomic", "Insert", "Duplicate"]}
-- Deduplication: Try to insert into deduplication table first
-- If message_id already exists, this returns 0 rows and we skip the inbox insert
INSERT INTO wh_message_deduplication (message_id, first_seen_at)
VALUES (v_msg.msg_id, p_now)
ON CONFLICT ON CONSTRAINT wh_message_deduplication_pkey DO NOTHING;

GET DIAGNOSTICS v_was_new = ROW_COUNT;

-- Only proceed if deduplication insert succeeded (message is new)
IF v_was_new = 1 THEN
  INSERT INTO wh_inbox (message_id, handler_name, message_type, ...)
  VALUES (...);
END IF;
```

**Pattern**: Let the database enforce uniqueness via the primary key — no read-then-write race, no exception handling.

---

## Complete Processing Example

You don't write inbox plumbing — the framework workers handle storage, deduplication, claiming, and completion. You write a **receptor** with your business logic:

### ReserveInventoryReceptor

```csharp{title="ReserveInventoryReceptor" description="Receptor with business logic — the framework handles the inbox around it" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "InventoryWorker"] unverified="sample receptor business logic — the framework inbox plumbing around it is what's tested, not this body"}
public class ReserveInventoryReceptor(
    IDispatcher dispatcher,
    ILogger<ReserveInventoryReceptor> logger)
    : IReceptor<ReserveInventoryCommand, InventoryReservedEvent> {

    public async ValueTask<InventoryReservedEvent> HandleAsync(
        ReserveInventoryCommand message,
        CancellationToken cancellationToken = default) {

        logger.LogInformation(
            "Reserving {Quantity} units of product {ProductId} for order {OrderId}",
            message.Quantity, message.ProductId, message.OrderId);

        // Business logic: check availability, reserve inventory ...

        var inventoryReserved = new InventoryReservedEvent {
            OrderId = message.OrderId.Value.ToString(),
            ProductId = message.ProductId.Value,
            Quantity = message.Quantity,
            ReservedAt = DateTime.UtcNow
        };

        // Emitted events go to the outbox in the SAME transaction
        // as this message's inbox completion (commit_handler_batch)
        await dispatcher.PublishAsync(inventoryReserved);

        return inventoryReserved;
    }
}
```

**Flow (all automatic)**:
1. `TransportConsumerWorker` receives the message; unsubscribed messages are discarded at the boundary
2. `StoreInboxMessagesAsync` → `store_inbox_messages`: dedup insert gates the inbox insert (duplicates skipped here)
3. `ClaimWorker` leases the row; `InboxDrainWorker` fetches it in stream-FIFO order; `InboxDispatchWorker` fires lifecycle stages and invokes your receptor
4. `InboxHandlerWorker` commits the result via `commit_handler_batch` — inbox completion + any events your receptor emitted, atomically

---

## Lease-Based Processing

Like the Outbox Pattern, Inbox uses **leases** for coordinating work across multiple workers.

### Claiming Messages

Claiming happens inside `claim_work` via the `claim_orphaned_inbox` sub-function. Conceptually:

```sql{title="Claiming Messages" description="Claiming Messages (conceptual — see claim_orphaned_inbox in migration 025)" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "Sql", "Claiming", "Messages"]}
-- Claim unowned / lease-expired inbox rows this instance may own
UPDATE wh_inbox
SET
    instance_id = @InstanceId,
    lease_expiry = NOW() + INTERVAL '5 minutes'
WHERE processed_at IS NULL
  AND (instance_id IS NULL OR lease_expiry < NOW())
  AND (scheduled_for IS NULL OR scheduled_for <= NOW())
  -- Ownership: stream pinned to this instance in wh_active_streams,
  -- OR unowned and partition_number % active_instance_count = instance_rank
ORDER BY received_at;
```

**Benefits**:
- ✅ Multiple workers can process different streams
- ✅ Crashed workers release leases automatically (via expiry + stale-instance cleanup)
- ✅ Work distributed evenly (partition modulo + stream pinning)
- ✅ Claimed rows return as stream ids; `InboxDrainWorker` fetches bodies per stream in FIFO order

---

## Exactly-Once Semantics

### How Inbox Ensures Exactly-Once

```mermaid{caption="Exactly-once via the dedup table — the first insert wins (ROW_COUNT = 1); a duplicate hits ON CONFLICT (ROW_COUNT = 0) and never enters the pipeline."}
flowchart TD
    M1["Message arrives with MessageId: msg-123"]
    A1["Attempt 1 (Worker A)<br/><br/>1. Dedup insert for msg-123: ROW_COUNT = 1 — First to insert!<br/>2. Inbox row created<br/>3. Handler invoked: SUCCESS<br/>4. Handler commit: SUCCESS"]
    M2["Duplicate arrives with MessageId: msg-123 (network retry)"]
    A2["Attempt 2 (Worker B)<br/><br/>1. Dedup insert for msg-123: ON CONFLICT, ROW_COUNT = 0 — Duplicate!<br/>2. SKIP inbox insert — message never enters the pipeline"]

    M1 --> A1
    M2 --> A2

    class M1,M2 layer-command
    class A1 layer-core
    class A2 layer-event
```

**Key**: The `wh_message_deduplication` primary key prevents duplicate inserts.

### Race Condition Handling

```mermaid{caption="Concurrent-worker race — both attempt the dedup insert; one wins and processes, the loser's ON CONFLICT DO NOTHING returns zero rows and it skips without error."}
flowchart TD
    Start["Two workers receive same message simultaneously"]
    WA["Worker A"]
    WB["Worker B"]
    IA["Dedup INSERT msg-123 → ROW_COUNT = 1"]
    IB["Dedup INSERT msg-123 → ON CONFLICT DO NOTHING (ROW_COUNT = 0)"]
    PA["Inbox row created; handler invoked"]
    SB["Skip (no inbox row, no error)"]
    MC["Handler commit"]

    Start --> WA
    Start --> WB
    WA --> IA
    IA --> PA
    PA --> MC
    WB --> IB
    IB --> SB

    class WA,WB layer-command
    class IA,IB layer-event
    class PA,MC layer-core
```

**Database guarantees exactly-once** via the primary key — and `ON CONFLICT DO NOTHING` means the losing worker sees no error, just zero rows.

---

## Idempotency

Even with inbox, **business logic should be idempotent** as a defense-in-depth strategy.

### Idempotent Update

```csharp{title="Idempotent Update" description="Idempotent Update" category="Architecture" difficulty="BEGINNER" tags=["Messaging", "C#", "Idempotent", "Update"] unverified="user application logic (idempotent SQL) — not framework code"}
// ✅ Idempotent - safe to run multiple times
await _db.ExecuteAsync(
    "UPDATE orders SET status = 'Shipped', shipped_at = @ShippedAt WHERE order_id = @OrderId AND status = 'Created'",
    new { @event.OrderId, @event.ShippedAt }
);
```

**Key**: `WHERE status = 'Created'` ensures update only happens once (already shipped orders are skipped).

### Non-Idempotent Update (Avoid!)

```csharp{title="Non-Idempotent Update (Avoid!)" description="Non-Idempotent Update (Avoid!)" category="Architecture" difficulty="BEGINNER" tags=["Messaging", "Non-Idempotent", "Update", "Avoid!"] unverified="counter-example — non-idempotent update, intentionally wrong"}
// ❌ Not idempotent - running twice doubles inventory!
await _db.ExecuteAsync(
    "UPDATE inventory SET reserved = reserved + @Quantity WHERE product_id = @ProductId",
    new { @event.ProductId, @event.Quantity }
);
```

**Fix**: Use inbox to prevent this, OR make logic idempotent:

```csharp{title="Non-Idempotent Update (Avoid!) (2)" description="Fix: Use inbox to prevent this, OR make logic idempotent:" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "Non-Idempotent", "Update", "Avoid!"] unverified="user application logic — idempotency guard, not framework code"}
// ✅ Idempotent - check if already reserved
var alreadyReserved = await _db.QuerySingleAsync<bool>(
    "SELECT EXISTS(SELECT 1 FROM inventory_reservations WHERE order_id = @OrderId AND product_id = @ProductId)",
    new { @event.OrderId, @event.ProductId }
);

if (!alreadyReserved) {
    await _db.ExecuteAsync(
        "UPDATE inventory SET reserved = reserved + @Quantity WHERE product_id = @ProductId",
        new { @event.ProductId, @event.Quantity }
    );

    await _db.ExecuteAsync(
        "INSERT INTO inventory_reservations (order_id, product_id, quantity) VALUES (@OrderId, @ProductId, @Quantity)",
        new { @event.OrderId, @event.ProductId, @event.Quantity }
    );
}
```

---

## Retry & Failure Handling

### Retry Logic

Failures flow through `ReportFailuresAsync` (batched by `FailureFlushWorker`), which increments `attempts`, stamps `error`/`failure_reason`, and releases the lease so the row can be re-claimed. Retries can be delayed via `scheduled_for` — later messages in the same stream wait behind a scheduled retry to preserve ordering.

```csharp{title="Retry Logic" description="Failures are reported through the coordinator, not raw SQL" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Retry", "Logic"] unverified="illustrative ReportFailuresAsync usage showing the failure-reporting API shape; the coordinator call flow is not exercised by this snippet"}
// FailureFlushWorker drains the failure channel and flushes per category
await coordinator.ReportFailuresAsync(
    WorkCategory.Inbox,
    [
        new MessageFailure {
            MessageId = work.MessageId,
            CompletedStatus = MessageProcessingStatus.Stored,
            Error = ex.Message,
            Reason = MessageFailureReason.TransportException
        }
    ],
    ct);
```

**Retry Strategy**:
- Attempts 1 through `MaxInboxAttempts` (default 10): row re-claimed and retried (with `scheduled_for` backoff for scheduled retries)
- Beyond `MaxInboxAttempts`: `InboxDispatchWorker` dead-letters the message

### Dead Letter Queue

When `attempts` exceeds `MessageProcessingOptions.MaxInboxAttempts` (default 10), the row moves to the internal `wh_dead_letters` table with a forensic snapshot, and the SQL function deletes it from `wh_inbox` in the same transaction:

```csharp{title="Dead Letter Queue" description="Dead-letter promotion on max attempts (InboxDispatchWorker)" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Dead", "Letter", "Queue"] tests=["InboxDispatchWorkerTests.MaxInboxAttempts_AttemptsOneOverMax_DeadLettersAsync", "InboxDispatchWorkerTests.MaxInboxAttempts_AttemptsEqualToMax_StillProcessesAsync"]}
// InboxDispatchWorker (automatic):
if (work.Attempts > _options.MaxInboxAttempts) {
    await _deadLetterStore.MoveAsync(
        deadLetterId: (Guid)TrackedGuid.NewMedo(),
        sourceTable: DeadLetterSourceTable.INBOX,
        sourceId: work.MessageId,
        failureReason: MessageFailureReason.MaxAttemptsExceeded,
        errorText: promotionErrorText,
        instanceId: instanceId,
        generation: generation,
        ct: ct);
    return;  // Row removed from wh_inbox; recover later via dead-letter recovery
}
```

---

## Best Practices

### DO ✅

- ✅ **Let the framework store first, process second** (dedup insert gates the pipeline)
- ✅ **Rely on the dedup primary key** on message_id (enforces exactly-once)
- ✅ **Make business logic idempotent** (defense-in-depth)
- ✅ **Log all processing** (correlation ID, message type)
- ✅ **Monitor dead letters** (rows land in `wh_dead_letters` after `MaxInboxAttempts`, default 10)
- ✅ **Let `perform_maintenance` clean up** (dedup entries purged after retention, default 30 days)
- ✅ **Use leases** (enables parallel processing across streams)

### DON'T ❌

- ❌ Skip duplicate detection (leads to duplicate processing)
- ❌ Process before the inbox row exists (race condition)
- ❌ Ignore dead-lettered messages (silent data loss)
- ❌ Assume messages arrive in order across streams (only within a stream!)
- ❌ Store large payloads in inbox (use offload storage for big bodies)
- ❌ Process the same message concurrently (leases prevent this)
- ❌ Skip monitoring (blind to failures)

---

## Monitoring & Observability

### Key Metrics

In production, completed rows are **deleted at commit** — pending depth is what you monitor (completed counts live in your logs/metrics, or in debug mode where rows are retained).

```csharp{title="Key Metrics" description="Key Metrics" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Key", "Metrics"] unverified="user monitoring code — illustrative metrics query, not framework code"}
public class InboxMetrics {
    public int PendingCount { get; set; }      // Unprocessed, not currently leased
    public int InFlightCount { get; set; }     // Unprocessed, leased by an instance
    public int DeadLetterCount { get; set; }   // Rows promoted to wh_dead_letters
    public double OldestMessageAge { get; set; }  // Age of oldest unprocessed message (seconds)
}

public async Task<InboxMetrics> GetMetricsAsync(CancellationToken ct = default) {
    await using var conn = _db.CreateConnection();

    return await conn.QuerySingleAsync<InboxMetrics>(
        """
        SELECT
            COUNT(*) FILTER (WHERE processed_at IS NULL AND instance_id IS NULL) AS PendingCount,
            COUNT(*) FILTER (WHERE processed_at IS NULL AND instance_id IS NOT NULL) AS InFlightCount,
            (SELECT COUNT(*) FROM wh_dead_letters WHERE source_table = 'wh_inbox') AS DeadLetterCount,
            EXTRACT(EPOCH FROM (NOW() - MIN(received_at) FILTER (WHERE processed_at IS NULL))) AS OldestMessageAge
        FROM wh_inbox
        """,
        cancellationToken: ct
    );
}
```

### Alerts

**Critical Alerts**:
- 🚨 `OldestMessageAge > 600` (message stuck for 10+ minutes)
- 🚨 `DeadLetterCount > 0` (messages gave up after max retries)
- 🚨 `PendingCount > 10000` (inbox backlog growing)

**Warning Alerts**:
- ⚠️ `OldestMessageAge > 60` (message not processed within 1 minute)
- ⚠️ `InFlightCount > 1000` (many messages being processed)

---

## Testing

### Integration Tests

The framework's own regression suite locks the dedup invariant (see `StoreInboxMessagesSqlTests.cs`):

```csharp{title="Integration Tests" description="Duplicate store no-ops via the dedup table" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Integration", "Tests"] unverified="verified by StoreInboxMessagesSqlTests, which is outside the current coverage map"}
[Test]
public async Task DuplicateMessageId_SecondCallNoOpsViaDedupTableAsync() {
    // Arrange
    var messageId = (Guid)TrackedGuid.NewMedo();
    var message = BuildInboxMessage(messageId);

    // Act - store the same message twice
    await _coordinator.StoreInboxMessagesAsync([message], partitionCount: 10_000);
    await _coordinator.StoreInboxMessagesAsync([message], partitionCount: 10_000);  // Duplicate!

    // Assert - exactly one inbox row and one dedup row
    var inboxCount = await _db.ExecuteScalarAsync<int>(
        "SELECT COUNT(*) FROM wh_inbox WHERE message_id = @MessageId",
        new { MessageId = messageId }
    );
    await Assert.That(inboxCount).IsEqualTo(1);
}
```

For end-to-end tests, publish the same message twice through the transport and assert the handler fired once — use completion signals (e.g., `TaskCompletionSource` wired to a lifecycle hook), not `Task.Delay` polling.

---

## Further Reading

**Core Concepts**:
- [Dispatcher](../fundamentals/dispatcher/dispatcher.md) - Message routing
- [Receptors](../fundamentals/receptors/receptors.md) - Message handlers

**Messaging Patterns**:
- [Outbox Pattern](outbox-pattern.md) - Reliable event publishing
- [Work Coordination](work-coordinator.md) - IWorkCoordinator deep dive
- [Message Envelopes](message-envelopes.md) - Hop-based observability

**Examples**:
- ECommerce: Inventory Worker - Real-world inbox usage

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
