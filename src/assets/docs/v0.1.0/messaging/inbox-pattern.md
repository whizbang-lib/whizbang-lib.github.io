---
title: "Inbox Pattern"
version: 0.1.0
category: Messaging
order: 2
description: "Achieve exactly-once message processing with the Inbox Pattern - automatic deduplication and idempotent message handling"
tags: inbox, exactly-once, deduplication, idempotency, message-processing
codeReferences:
  - src/Whizbang.Core/WorkCoordination/IWorkCoordinator.cs
  - src/Whizbang.Data.Postgres/WorkCoordination/PostgresWorkCoordinator.cs
  - samples/ECommerce/ECommerce.InventoryWorker/Workers/InventoryWorker.cs
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

```csharp
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

**The Fix**: Check inbox before processing, store message ID after processing.

```
┌─────────────────────────────────────────────────┐
│ 1. Message arrives from Azure Service Bus      │
└─────────────────┬───────────────────────────────┘
                  ↓
┌─────────────────────────────────────────────────┐
│ 2. Check inbox for duplicate                    │
│    SELECT * FROM wh_inbox WHERE message_id = ?  │
│                                                 │
│    If found: SKIP (already processed!)         │  ← Exactly-once!
│    If not found: Continue...                    │
└─────────────────┬───────────────────────────────┘
                  ↓
┌─────────────────────────────────────────────────┐
│ 3. Process message (business logic)             │
└─────────────────┬───────────────────────────────┘
                  ↓
┌─────────────────────────────────────────────────┐
│ 4. Store message ID in inbox (atomic!)          │
│    INSERT INTO wh_inbox (message_id, ...)       │
└─────────────────────────────────────────────────┘
```

**Benefits**:
- ✅ **Exactly-once processing**: Duplicates detected and skipped
- ✅ **Idempotent**: Safe to replay messages
- ✅ **Automatic**: Framework handles deduplication
- ✅ **Auditability**: Complete record of processed messages

---

## Whizbang Implementation

### Database Schema

```sql
CREATE TABLE wh_inbox (
    message_id UUID PRIMARY KEY,
    correlation_id UUID NOT NULL,
    causation_id UUID NULL,
    message_type VARCHAR(500) NOT NULL,
    payload JSONB NOT NULL,
    source_topic VARCHAR(255) NOT NULL,

    -- Metadata
    metadata JSONB NULL,

    -- Lease-based coordination
    instance_id UUID NULL,
    lease_expiry TIMESTAMPTZ NULL,

    -- Status tracking
    status VARCHAR(50) NOT NULL DEFAULT 'Received',
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT NULL,

    -- Timestamps
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ NULL,
    completed_at TIMESTAMPTZ NULL,

    -- Indexes
    CONSTRAINT chk_inbox_status CHECK (status IN ('Received', 'Processing', 'Completed', 'Failed'))
);

CREATE INDEX idx_inbox_status ON wh_inbox(status, partition_number);
CREATE INDEX idx_inbox_correlation ON wh_inbox(correlation_id);
CREATE UNIQUE INDEX idx_inbox_message_id ON wh_inbox(message_id);  -- Enforces exactly-once!
```

**Key Fields**:
- **message_id**: Unique message identifier (primary key, enforces uniqueness)
- **status**: Received → Processing → Completed | Failed
- **instance_id**: Which worker is processing this message
- **lease_expiry**: When the lease expires

**Critical**: `UNIQUE INDEX` on `message_id` prevents duplicate processing!

---

## Detecting Duplicates

### Check Before Processing

```csharp
public async Task<bool> IsMessageProcessedAsync(
    Guid messageId,
    CancellationToken ct = default) {

    await using var conn = _db.CreateConnection();

    var existing = await conn.QuerySingleOrDefaultAsync<InboxRow>(
        "SELECT * FROM wh_inbox WHERE message_id = @MessageId",
        new { MessageId = messageId },
        cancellationToken: ct
    );

    return existing is not null && existing.Status == "Completed";
}
```

**Usage**:
```csharp
if (await IsMessageProcessedAsync(message.MessageId, ct)) {
    _logger.LogWarning("Duplicate message {MessageId} detected, skipping", message.MessageId);
    return;  // Skip processing!
}
```

### Atomic Insert with Duplicate Check

```csharp
try {
    await conn.ExecuteAsync(
        """
        INSERT INTO wh_inbox (message_id, correlation_id, message_type, payload, source_topic, status, received_at)
        VALUES (@MessageId, @CorrelationId, @MessageType, @Payload, @SourceTopic, 'Received', NOW())
        """,
        new {
            MessageId = message.MessageId,
            CorrelationId = message.CorrelationId,
            MessageType = message.GetType().FullName,
            Payload = JsonSerializer.Serialize(message),
            SourceTopic = "orders"
        },
        cancellationToken: ct
    );

} catch (Npgsql.PostgresException ex) when (ex.SqlState == "23505") {  // Unique violation
    _logger.LogWarning("Duplicate message {MessageId} detected (unique constraint)", message.MessageId);
    return;  // Skip processing!
}
```

**Pattern**: Let database enforce uniqueness via unique constraint.

---

## Complete Processing Example

### InventoryWorker

```csharp
public class InventoryWorker : BackgroundService {
    private readonly IWorkCoordinator _coordinator;
    private readonly IMessageTransport _transport;
    private readonly IDispatcher _dispatcher;

    protected override async Task ExecuteAsync(CancellationToken ct) {
        var instanceId = Guid.NewGuid();

        // Subscribe to topic
        await _transport.SubscribeAsync("orders", async (msg, ct) => {
            try {
                // 1. Check for duplicate (via inbox)
                var isDuplicate = await _coordinator.IsMessageInInboxAsync(msg.MessageId, ct);

                if (isDuplicate) {
                    _logger.LogWarning(
                        "Duplicate message {MessageId} detected, skipping",
                        msg.MessageId
                    );
                    return;  // Skip!
                }

                // 2. Store in inbox (atomic - prevents concurrent processing)
                await _coordinator.ProcessWorkBatchAsync(
                    instanceId: instanceId,
                    serviceName: "InventoryWorker",
                    hostName: Environment.MachineName,
                    processId: Environment.ProcessId,
                    metadata: null,
                    outboxCompletions: [],
                    outboxFailures: [],
                    inboxCompletions: [],
                    inboxFailures: [],
                    receptorCompletions: [],
                    receptorFailures: [],
                    perspectiveCompletions: [],
                    perspectiveFailures: [],
                    newOutboxMessages: [],
                    newInboxMessages: [
                        new InboxMessage(
                            MessageId: msg.MessageId,
                            CorrelationId: msg.CorrelationId,
                            CausationId: msg.CausationId,
                            MessageType: msg.MessageType,
                            Payload: msg.Payload,
                            SourceTopic: "orders"
                        )
                    ],
                    renewOutboxLeaseIds: [],
                    renewInboxLeaseIds: [],
                    ct: ct
                );

                // 3. Process message (business logic)
                var orderCreated = JsonSerializer.Deserialize<OrderCreated>(msg.Payload);

                if (orderCreated is null) {
                    throw new InvalidOperationException("Failed to deserialize OrderCreated");
                }

                await ProcessOrderCreatedAsync(orderCreated, ct);

                // 4. Mark as completed
                await _coordinator.ProcessWorkBatchAsync(
                    instanceId: instanceId,
                    serviceName: "InventoryWorker",
                    hostName: Environment.MachineName,
                    processId: Environment.ProcessId,
                    metadata: null,
                    outboxCompletions: [],
                    outboxFailures: [],
                    inboxCompletions: [
                        new MessageCompletion(
                            MessageId: msg.MessageId,
                            Status: MessageProcessingStatus.Completed
                        )
                    ],
                    inboxFailures: [],
                    receptorCompletions: [],
                    receptorFailures: [],
                    perspectiveCompletions: [],
                    perspectiveFailures: [],
                    newOutboxMessages: [],
                    newInboxMessages: [],
                    renewOutboxLeaseIds: [],
                    renewInboxLeaseIds: [],
                    ct: ct
                );

                _logger.LogInformation(
                    "Successfully processed message {MessageId}",
                    msg.MessageId
                );

            } catch (Exception ex) {
                _logger.LogError(
                    ex,
                    "Failed to process message {MessageId}",
                    msg.MessageId
                );

                // Mark as failed
                await _coordinator.ProcessWorkBatchAsync(
                    instanceId: instanceId,
                    serviceName: "InventoryWorker",
                    hostName: Environment.MachineName,
                    processId: Environment.ProcessId,
                    metadata: null,
                    outboxCompletions: [],
                    outboxFailures: [],
                    inboxCompletions: [],
                    inboxFailures: [
                        new MessageFailure(
                            MessageId: msg.MessageId,
                            Status: MessageProcessingStatus.Failed,
                            Error: ex.Message,
                            StackTrace: ex.StackTrace
                        )
                    ],
                    receptorCompletions: [],
                    receptorFailures: [],
                    perspectiveCompletions: [],
                    perspectiveFailures: [],
                    newOutboxMessages: [],
                    newInboxMessages: [],
                    renewOutboxLeaseIds: [],
                    renewInboxLeaseIds: [],
                    ct: ct
                );
            }
        }, ct);

        // Keep running
        await Task.Delay(Timeout.Infinite, ct);
    }

    private async Task ProcessOrderCreatedAsync(OrderCreated @event, CancellationToken ct) {
        // Business logic: Reserve inventory

        foreach (var item in @event.Items) {
            var available = await _db.QuerySingleAsync<int>(
                "SELECT available FROM inventory WHERE product_id = @ProductId",
                new { ProductId = item.ProductId },
                ct
            );

            if (available < item.Quantity) {
                throw new InsufficientInventoryException(
                    $"Product {item.ProductId} has only {available} units available, requested {item.Quantity}"
                );
            }

            await _db.ExecuteAsync(
                "UPDATE inventory SET reserved = reserved + @Quantity WHERE product_id = @ProductId",
                new { ProductId = item.ProductId, Quantity = item.Quantity },
                ct
            );
        }

        _logger.LogInformation(
            "Reserved inventory for order {OrderId}",
            @event.OrderId
        );
    }
}
```

**Flow**:
1. Check inbox for duplicate → Skip if found
2. Insert into inbox (atomic) → Prevents concurrent processing
3. Process message (business logic)
4. Mark as completed → Won't process again

---

## Lease-Based Processing

Like the Outbox Pattern, Inbox uses **leases** for coordinating work across multiple workers.

### Claiming Messages

```sql
-- Claim inbox messages for processing
UPDATE wh_inbox
SET
    instance_id = @InstanceId,
    lease_expiry = NOW() + INTERVAL '5 minutes',
    status = 'Processing'
WHERE message_id IN (
    SELECT message_id
    FROM wh_inbox
    WHERE
        status = 'Received'
        AND (instance_id IS NULL OR lease_expiry < NOW())
        AND partition_number IN (SELECT * FROM assigned_partitions)
    ORDER BY received_at
    LIMIT 100
)
RETURNING *;
```

**Benefits**:
- ✅ Multiple workers can process different messages
- ✅ Crashed workers release leases automatically (via expiry)
- ✅ Work distributed evenly (partition-based)

---

## Exactly-Once Semantics

### How Inbox Ensures Exactly-Once

```
Message arrives with MessageId: msg-123

┌──────────────────────────────────────────┐
│ Attempt 1 (Worker A)                     │
│                                          │
│ 1. Check inbox for msg-123: NOT FOUND   │
│ 2. Insert into inbox: SUCCESS           │  ← First to insert!
│ 3. Process message: SUCCESS              │
│ 4. Mark completed: SUCCESS               │
└──────────────────────────────────────────┘

Duplicate arrives with MessageId: msg-123 (network retry)

┌──────────────────────────────────────────┐
│ Attempt 2 (Worker B)                     │
│                                          │
│ 1. Check inbox for msg-123: FOUND!      │  ← Duplicate detected!
│ 2. SKIP processing                       │
└──────────────────────────────────────────┘
```

**Key**: `UNIQUE INDEX` on `message_id` prevents duplicate inserts.

### Race Condition Handling

```
Two workers receive same message simultaneously:

Worker A                     Worker B
  ↓                           ↓
INSERT msg-123 → SUCCESS     INSERT msg-123 → DUPLICATE KEY ERROR!
  ↓                           ↓
Process message              Skip (unique constraint violation)
  ↓
Mark completed
```

**Database guarantees exactly-once** via unique constraint!

---

## Idempotency

Even with inbox, **business logic should be idempotent** as a defense-in-depth strategy.

### Idempotent Update

```csharp
// ✅ Idempotent - safe to run multiple times
await _db.ExecuteAsync(
    "UPDATE orders SET status = 'Shipped', shipped_at = @ShippedAt WHERE order_id = @OrderId AND status = 'Created'",
    new { @event.OrderId, @event.ShippedAt }
);
```

**Key**: `WHERE status = 'Created'` ensures update only happens once (already shipped orders are skipped).

### Non-Idempotent Update (Avoid!)

```csharp
// ❌ Not idempotent - running twice doubles inventory!
await _db.ExecuteAsync(
    "UPDATE inventory SET reserved = reserved + @Quantity WHERE product_id = @ProductId",
    new { @event.ProductId, @event.Quantity }
);
```

**Fix**: Use inbox to prevent this, OR make logic idempotent:

```csharp
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

```csharp
// Failed messages: increment attempts, update status
foreach (var failure in inboxFailures) {
    await conn.ExecuteAsync(
        """
        UPDATE wh_inbox
        SET
            attempts = attempts + 1,
            status = CASE
                WHEN attempts + 1 >= 5 THEN 'Failed'  -- Max 5 attempts
                ELSE 'Received'  -- Retry
            END,
            last_error = @Error,
            instance_id = NULL,
            lease_expiry = NULL
        WHERE message_id = @MessageId
        """,
        new { failure.MessageId, failure.Error }
    );
}
```

**Retry Strategy**:
- Attempt 1-4: Retry (status = Received, available for next poll)
- Attempt 5+: Give up (status = Failed, needs manual intervention)

### Dead Letter Queue

```csharp
public async Task ReprocessFailedMessagesAsync(CancellationToken ct = default) {
    var failedMessages = await _db.QueryAsync<InboxRow>(
        """
        SELECT * FROM wh_inbox
        WHERE status = 'Failed'
        ORDER BY received_at
        LIMIT 100
        """,
        cancellationToken: ct
    );

    foreach (var msg in failedMessages) {
        // Manual retry or move to dead letter queue
        _logger.LogWarning(
            "Failed message {MessageId} after {Attempts} attempts: {Error}",
            msg.MessageId, msg.Attempts, msg.LastError
        );
    }
}
```

---

## Best Practices

### DO ✅

- ✅ **Check inbox before processing** (detect duplicates)
- ✅ **Insert into inbox atomically** (prevents concurrent processing)
- ✅ **Use unique constraint** on message_id (enforces exactly-once)
- ✅ **Make business logic idempotent** (defense-in-depth)
- ✅ **Log all processing** (correlation ID, message type)
- ✅ **Monitor failed messages** (alerts when attempts >= 5)
- ✅ **Clean up old messages** (archive Completed after 30 days)
- ✅ **Use leases** (enables parallel processing)

### DON'T ❌

- ❌ Skip duplicate detection (leads to duplicate processing)
- ❌ Process before inserting into inbox (race condition)
- ❌ Ignore failed messages (silent data loss)
- ❌ Assume messages arrive in order (they don't!)
- ❌ Store large payloads in inbox (use size limits)
- ❌ Process same message concurrently (use leases)
- ❌ Skip monitoring (blind to failures)

---

## Monitoring & Observability

### Key Metrics

```csharp
public class InboxMetrics {
    public int ReceivedCount { get; set; }     // Messages waiting to be processed
    public int ProcessingCount { get; set; }   // Messages currently being processed
    public int CompletedCount { get; set; }    // Messages successfully processed
    public int FailedCount { get; set; }       // Messages that failed max retries
    public double OldestMessageAge { get; set; }  // Age of oldest Received message (seconds)
}

public async Task<InboxMetrics> GetMetricsAsync(CancellationToken ct = default) {
    await using var conn = _db.CreateConnection();

    return await conn.QuerySingleAsync<InboxMetrics>(
        """
        SELECT
            COUNT(*) FILTER (WHERE status = 'Received') AS ReceivedCount,
            COUNT(*) FILTER (WHERE status = 'Processing') AS ProcessingCount,
            COUNT(*) FILTER (WHERE status = 'Completed') AS CompletedCount,
            COUNT(*) FILTER (WHERE status = 'Failed') AS FailedCount,
            EXTRACT(EPOCH FROM (NOW() - MIN(received_at) FILTER (WHERE status = 'Received'))) AS OldestMessageAge
        FROM wh_inbox
        """,
        cancellationToken: ct
    );
}
```

### Alerts

**Critical Alerts**:
- 🚨 `OldestMessageAge > 600` (message stuck for 10+ minutes)
- 🚨 `FailedCount > 0` (messages gave up after max retries)
- 🚨 `ReceivedCount > 10000` (inbox backlog growing)

**Warning Alerts**:
- ⚠️ `OldestMessageAge > 60` (message not processed within 1 minute)
- ⚠️ `ProcessingCount > 1000` (many messages being processed)

---

## Testing

### Unit Tests

```csharp
[Test]
public async Task ProcessMessage_Duplicate_SkipsProcessingAsync() {
    // Arrange
    var messageId = Guid.CreateVersion7();

    // First processing
    await _coordinator.ProcessWorkBatchAsync(
        /* ... */,
        newInboxMessages: [new InboxMessage(MessageId: messageId, /* ... */)],
        /* ... */
    );

    await _coordinator.ProcessWorkBatchAsync(
        /* ... */,
        inboxCompletions: [new MessageCompletion(MessageId: messageId, Status: MessageProcessingStatus.Completed)],
        /* ... */
    );

    // Act - attempt duplicate
    var isDuplicate = await _coordinator.IsMessageInInboxAsync(messageId);

    // Assert
    await Assert.That(isDuplicate).IsTrue();
}
```

### Integration Tests

```csharp
[Test]
public async Task InventoryWorker_DuplicateMessage_ProcessesOnceAsync() {
    // Arrange
    var message = new OrderCreated(/* ... */);
    var messageId = message.MessageId;

    // Act - publish same message twice
    await _transport.PublishAsync("orders", message);
    await Task.Delay(1000);  // Let worker process

    await _transport.PublishAsync("orders", message);  // Duplicate!
    await Task.Delay(1000);  // Let worker process

    // Assert - inventory reserved only once
    var reserved = await _db.QuerySingleAsync<int>(
        "SELECT reserved FROM inventory WHERE product_id = @ProductId",
        new { ProductId = message.Items[0].ProductId }
    );

    await Assert.That(reserved).IsEqualTo(message.Items[0].Quantity);  // Not doubled!

    // Assert - inbox has one completed entry
    var inboxCount = await _db.ExecuteScalarAsync<int>(
        "SELECT COUNT(*) FROM wh_inbox WHERE message_id = @MessageId",
        new { MessageId = messageId }
    );

    await Assert.That(inboxCount).IsEqualTo(1);
}
```

---

## Further Reading

**Core Concepts**:
- [Dispatcher](../core-concepts/dispatcher.md) - Message routing
- [Receptors](../core-concepts/receptors.md) - Message handlers

**Messaging Patterns**:
- [Outbox Pattern](outbox-pattern.md) - Reliable event publishing
- [Work Coordination](work-coordinator.md) - IWorkCoordinator deep dive
- [Message Envelopes](message-envelopes.md) - Hop-based observability

**Examples**:
- [ECommerce: Inventory Worker](../examples/ecommerce/inventory-worker.md) - Real-world inbox usage

---

*Version 0.1.0 - Foundation Release | Last Updated: 2024-12-12*
