---
title: Outbox Pattern
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
  - src/Whizbang.Core/WorkCoordination/IWorkCoordinator.cs
  - src/Whizbang.Data.Postgres/WorkCoordination/PostgresWorkCoordinator.cs
  - >-
    samples/ECommerce/ECommerce.OrderService.API/Receptors/CreateOrderReceptor.cs
---

# Outbox Pattern

The **Outbox Pattern** ensures reliable event publishing in distributed systems by storing events in a database table ("outbox") as part of the same transaction that modifies business data. A background worker then publishes events from the outbox to the message transport.

## Problem: Dual Writes

**The Challenge**: How do you atomically update a database AND publish an event to a message broker?

### Naive Approach (BROKEN)

```csharp{title="Naive Approach (BROKEN)" description="Naive Approach (BROKEN)" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Naive", "Approach", "BROKEN"]}
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

```
┌─────────────────────────────────────────────────┐
│ Database Transaction                            │
│                                                 │
│ 1. INSERT INTO orders (...) VALUES (...)       │
│ 2. INSERT INTO wh_outbox (...) VALUES (...)    │  ← Event stored atomically!
│                                                 │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ Background Worker (polls outbox)                │
│                                                 │
│ 3. SELECT * FROM wh_outbox WHERE status = ...  │
│ 4. Publish to Azure Service Bus                │
│ 5. UPDATE wh_outbox SET status = 'Published'   │
│                                                 │
└─────────────────────────────────────────────────┘
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
CREATE TABLE wh_outbox (
    message_id UUID PRIMARY KEY,
    correlation_id UUID NOT NULL,
    causation_id UUID NULL,
    message_type VARCHAR(500) NOT NULL,
    payload JSONB NOT NULL,
    topic VARCHAR(255) NOT NULL,
    stream_key VARCHAR(255) NULL,
    partition_number INT NOT NULL,

    -- Metadata
    metadata JSONB NULL,

    -- Lease-based coordination
    instance_id UUID NULL,
    lease_expiry TIMESTAMPTZ NULL,

    -- Status tracking
    status VARCHAR(50) NOT NULL DEFAULT 'Stored',
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT NULL,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ NULL,

    -- Indexes for efficient querying
    CONSTRAINT chk_outbox_status CHECK (status IN ('Stored', 'Published', 'Failed'))
);

CREATE INDEX idx_outbox_status ON wh_outbox(status, partition_number);
CREATE INDEX idx_outbox_lease ON wh_outbox(instance_id, lease_expiry);
CREATE INDEX idx_outbox_correlation ON wh_outbox(correlation_id);
```

**Key Fields**:
- **message_id**: Unique identifier (UUIDv7)
- **status**: Stored → Published | Failed
- **instance_id**: Which worker claimed this message (lease-based coordination)
- **lease_expiry**: When the lease expires (prevents stuck messages)
- **partition_number**: Consistent hashing for work distribution

### IWorkCoordinator Interface

```csharp{title="IWorkCoordinator Interface" description="IWorkCoordinator Interface" category="Architecture" difficulty="ADVANCED" tags=["Messaging", "C#", "IWorkCoordinator", "Interface"]}
public interface IWorkCoordinator {
    Task<WorkBatch> ProcessWorkBatchAsync(
        ProcessWorkBatchRequest request,
        CancellationToken cancellationToken = default
    );
}
```

The `ProcessWorkBatchRequest` parameter object groups all work batch data (completions, failures, new messages, lease renewals, configuration). See [Work Coordinator](work-coordinator.md) for the full API reference.

**Key Method**: `ProcessWorkBatchAsync` handles **atomic operations**:
1. Delete completed messages
2. Update failed messages
3. Insert new outbox messages
4. Claim new work (via leasing)

---

## Storing Events in Outbox

### Example: CreateOrderReceptor

```csharp{title="Example: CreateOrderReceptor" description="Example: CreateOrderReceptor" category="Architecture" difficulty="ADVANCED" tags=["Messaging", "C#", "Example:", "CreateOrderReceptor"]}
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    private readonly IWorkCoordinator _coordinator;
    private readonly IDbConnectionFactory _db;

    public async ValueTask<OrderCreated> HandleAsync(
        CreateOrder message,
        CancellationToken ct = default) {

        // Business logic
        var orderId = Guid.CreateVersion7();
        var total = message.Items.Sum(i => i.Quantity * i.UnitPrice);

        var @event = new OrderCreated(
            OrderId: orderId,
            CustomerId: message.CustomerId,
            Items: message.Items,
            Total: total,
            CreatedAt: DateTimeOffset.UtcNow
        );

        // Store event in outbox (atomic with business data)
        await using var conn = _db.CreateConnection();
        await using var transaction = await conn.BeginTransactionAsync(ct);

        try {
            // 1. Insert business data
            await conn.ExecuteAsync(
                "INSERT INTO orders (order_id, customer_id, total, status, created_at) VALUES (@OrderId, @CustomerId, @Total, @Status, @CreatedAt)",
                new {
                    OrderId = orderId,
                    message.CustomerId,
                    Total = total,
                    Status = "Created",
                    CreatedAt = @event.CreatedAt
                },
                transaction: transaction,
                cancellationToken: ct
            );

            // 2. Insert event into outbox (same transaction!)
            await _coordinator.ProcessWorkBatchAsync(
                instanceId: Guid.NewGuid(),
                serviceName: "OrderService",
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
                newOutboxMessages: [
                    new OutboxMessage(
                        MessageId: Guid.CreateVersion7(),
                        CorrelationId: message.CorrelationId.Value,
                        CausationId: message.MessageId.Value,
                        MessageType: typeof(OrderCreated).FullName!,
                        Payload: JsonSerializer.Serialize(@event, _jsonOptions),
                        Topic: "orders",
                        StreamKey: message.CustomerId.ToString(),
                        PartitionKey: message.CustomerId.ToString()
                    )
                ],
                newInboxMessages: [],
                renewOutboxLeaseIds: [],
                renewInboxLeaseIds: [],
                ct: ct
            );

            await transaction.CommitAsync(ct);

        } catch {
            await transaction.RollbackAsync(ct);
            throw;
        }

        return @event;
    }
}
```

**Key Points**:
- ✅ Business data and outbox insert in **same transaction**
- ✅ If transaction fails, **nothing** is committed (atomicity)
- ✅ Event is stored even if network to message broker is down

---

## Publishing from Outbox

### WorkCoordinatorPublisher Worker

```csharp{title="WorkCoordinatorPublisher Worker" description="WorkCoordinatorPublisher Worker" category="Architecture" difficulty="ADVANCED" tags=["Messaging", "C#", "WorkCoordinatorPublisher", "Worker"]}
public class WorkCoordinatorPublisherWorker : BackgroundService {
    private readonly IWorkCoordinator _coordinator;
    private readonly IMessageTransport _transport;
    private readonly IConfiguration _config;
    private readonly ILogger<WorkCoordinatorPublisherWorker> _logger;

    protected override async Task ExecuteAsync(CancellationToken ct) {
        var instanceId = Guid.NewGuid();
        var pollingInterval = _config.GetValue<int>("WorkCoordinatorPublisher:PollingIntervalMilliseconds", 1000);

        _logger.LogInformation(
            "WorkCoordinatorPublisher starting with instance ID {InstanceId}",
            instanceId
        );

        while (!ct.IsCancellationRequested) {
            try {
                // 1. Claim work from outbox
                var batch = await _coordinator.ProcessWorkBatchAsync(
                    instanceId: instanceId,
                    serviceName: "OrderService",
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
                    newInboxMessages: [],
                    renewOutboxLeaseIds: [],
                    renewInboxLeaseIds: [],
                    ct: ct
                );

                // 2. Publish claimed messages
                var completions = new List<MessageCompletion>();
                var failures = new List<MessageFailure>();

                foreach (var msg in batch.ClaimedOutboxMessages) {
                    try {
                        await _transport.PublishAsync(
                            topic: msg.Topic,
                            messageId: msg.MessageId,
                            correlationId: msg.CorrelationId,
                            causationId: msg.CausationId,
                            messageType: msg.MessageType,
                            payload: msg.Payload,
                            ct: ct
                        );

                        completions.Add(new MessageCompletion(
                            MessageId: msg.MessageId,
                            Status: MessageProcessingStatus.Published
                        ));

                        _logger.LogInformation(
                            "Published message {MessageId} of type {MessageType} to topic {Topic}",
                            msg.MessageId, msg.MessageType, msg.Topic
                        );

                    } catch (Exception ex) {
                        _logger.LogError(
                            ex,
                            "Failed to publish message {MessageId} of type {MessageType}",
                            msg.MessageId, msg.MessageType
                        );

                        failures.Add(new MessageFailure(
                            MessageId: msg.MessageId,
                            Status: MessageProcessingStatus.Failed,
                            Error: ex.Message,
                            StackTrace: ex.StackTrace
                        ));
                    }
                }

                // 3. Report completions/failures back to coordinator
                if (completions.Count > 0 || failures.Count > 0) {
                    await _coordinator.ProcessWorkBatchAsync(
                        instanceId: instanceId,
                        serviceName: "OrderService",
                        hostName: Environment.MachineName,
                        processId: Environment.ProcessId,
                        metadata: null,
                        outboxCompletions: completions.ToArray(),
                        outboxFailures: failures.ToArray(),
                        inboxCompletions: [],
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
                }

            } catch (Exception ex) {
                _logger.LogError(ex, "Error in WorkCoordinatorPublisher");
            }

            await Task.Delay(pollingInterval, ct);
        }
    }
}
```

**Workflow**:
1. **Claim work**: Get messages from outbox (with lease)
2. **Publish**: Send to Azure Service Bus
3. **Report**: Mark as Published (success) or Failed (error)
4. **Retry**: Failed messages remain in outbox for retry

---

## Lease-Based Coordination

### How Leasing Works

```sql{title="How Leasing Works" description="How Leasing Works" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "Sql", "How", "Leasing", "Works"]}
-- Claim messages for this instance
UPDATE wh_outbox
SET
    instance_id = @InstanceId,
    lease_expiry = NOW() + INTERVAL '5 minutes'
WHERE message_id IN (
    SELECT message_id
    FROM wh_outbox
    WHERE
        status = 'Stored'
        AND (instance_id IS NULL OR lease_expiry < NOW())  -- Available or lease expired
        AND partition_number IN (SELECT * FROM assigned_partitions)
    ORDER BY created_at
    LIMIT 100
)
RETURNING *;
```

**Benefits**:
- ✅ **Parallel processing**: Multiple workers can process different partitions
- ✅ **Fault tolerance**: If worker crashes, lease expires and message is reclaimed
- ✅ **Load balancing**: Work distributed via consistent hashing (partition_number)

### Configuration

```json{title="Configuration" description="Configuration" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "Configuration"]}
{
  "WorkCoordinatorPublisher": {
    "PollingIntervalMilliseconds": 1000,
    "LeaseSeconds": 300,
    "StaleThresholdSeconds": 600,
    "PartitionCount": 10000
  }
}
```

**Parameters**:
- `PollingIntervalMilliseconds`: How often to check for new work (1000ms = 1 second)
- `LeaseSeconds`: How long a lease lasts (300s = 5 minutes)
- `StaleThresholdSeconds`: When to consider a lease stale (600s = 10 minutes)
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
2. Worker tries to mark message as Published in database (fails due to network blip)
3. Lease expires
4. Different worker claims message
5. Worker publishes message again (duplicate!)
```

**Solution**: Use Inbox Pattern on receiving side to detect duplicates.

### Retry Strategy

```csharp{title="Retry Strategy" description="Retry Strategy" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Retry", "Strategy"]}
public async Task ProcessWorkBatchAsync(...) {
    // Failed messages: increment attempt count, update status
    foreach (var failure in outboxFailures) {
        await conn.ExecuteAsync(
            """
            UPDATE wh_outbox
            SET
                attempts = attempts + 1,
                status = CASE
                    WHEN attempts + 1 >= 5 THEN 'Failed'  -- Max 5 attempts
                    ELSE 'Stored'  -- Retry
                END,
                last_error = @Error,
                instance_id = NULL,  -- Release lease
                lease_expiry = NULL
            WHERE message_id = @MessageId
            """,
            new { failure.MessageId, failure.Error }
        );
    }
}
```

**Retry Logic**:
- Attempt 1-4: Retry (status = Stored)
- Attempt 5+: Give up (status = Failed)

**Monitoring**:
```sql{title="Retry Strategy (2)" description="Monitoring:" category="Architecture" difficulty="BEGINNER" tags=["Messaging", "Sql", "Retry", "Strategy"]}
-- Find messages with multiple failures
SELECT message_id, message_type, attempts, last_error, created_at
FROM wh_outbox
WHERE status = 'Failed'
ORDER BY created_at DESC;
```

---

## Best Practices

### DO ✅

- ✅ Store events in **same transaction** as business data
- ✅ Use **UUIDv7** for MessageId (time-ordered, avoids index fragmentation)
- ✅ Set **reasonable lease duration** (5 minutes default)
- ✅ **Monitor failed messages** (alerts when attempts >= 5)
- ✅ Use **consistent hashing** (partition_number) for work distribution
- ✅ **Log all publishes** (correlation ID, message type, topic)
- ✅ **Implement retry logic** (exponential backoff, max attempts)
- ✅ **Clean up old messages** (archive Published messages after 30 days)

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

```csharp{title="Key Metrics" description="Key Metrics" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Key", "Metrics"]}
public class OutboxMetrics {
    public int StoredCount { get; set; }      // Messages waiting to be published
    public int PublishedCount { get; set; }   // Messages successfully published
    public int FailedCount { get; set; }      // Messages that failed max retries
    public double OldestMessageAge { get; set; }  // Age of oldest Stored message (seconds)
    public int ActiveLeases { get; set; }     // Number of active leases
}

public async Task<OutboxMetrics> GetMetricsAsync(CancellationToken ct = default) {
    await using var conn = _db.CreateConnection();

    var metrics = await conn.QuerySingleAsync<OutboxMetrics>(
        """
        SELECT
            COUNT(*) FILTER (WHERE status = 'Stored') AS StoredCount,
            COUNT(*) FILTER (WHERE status = 'Published') AS PublishedCount,
            COUNT(*) FILTER (WHERE status = 'Failed') AS FailedCount,
            EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE status = 'Stored'))) AS OldestMessageAge,
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
- 🚨 `FailedCount > 0` (messages gave up after max retries)
- 🚨 `StoredCount > 10000` (outbox backlog growing)

**Warning Alerts**:
- ⚠️ `OldestMessageAge > 60` (message not published within 1 minute)
- ⚠️ `StoredCount > 1000` (outbox filling up)

---

## Testing

### Unit Tests

```csharp{title="Unit Tests" description="Unit Tests" category="Architecture" difficulty="ADVANCED" tags=["Messaging", "C#", "Unit", "Tests"]}
[Test]
public async Task ProcessWorkBatchAsync_NewOutboxMessage_StoresInDatabaseAsync() {
    // Arrange
    var coordinator = CreateWorkCoordinator();

    var outboxMsg = new OutboxMessage(
        MessageId: Guid.CreateVersion7(),
        CorrelationId: Guid.CreateVersion7(),
        CausationId: Guid.CreateVersion7(),
        MessageType: "OrderCreated",
        Payload: "{\"orderId\":\"123\"}",
        Topic: "orders",
        StreamKey: "customer-456",
        PartitionKey: "customer-456"
    );

    // Act
    await coordinator.ProcessWorkBatchAsync(
        instanceId: Guid.NewGuid(),
        serviceName: "OrderService",
        hostName: "localhost",
        processId: 1234,
        metadata: null,
        outboxCompletions: [],
        outboxFailures: [],
        inboxCompletions: [],
        inboxFailures: [],
        receptorCompletions: [],
        receptorFailures: [],
        perspectiveCompletions: [],
        perspectiveFailures: [],
        newOutboxMessages: [outboxMsg],
        newInboxMessages: [],
        renewOutboxLeaseIds: [],
        renewInboxLeaseIds: [],
        ct: CancellationToken.None
    );

    // Assert
    var stored = await _db.QuerySingleOrDefaultAsync<OutboxRow>(
        "SELECT * FROM wh_outbox WHERE message_id = @MessageId",
        new { outboxMsg.MessageId }
    );

    await Assert.That(stored).IsNotNull();
    await Assert.That(stored!.Status).IsEqualTo("Stored");
    await Assert.That(stored.MessageType).IsEqualTo("OrderCreated");
}
```

### Integration Tests

```csharp{title="Integration Tests" description="Integration Tests" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Integration", "Tests"]}
[Test]
public async Task WorkCoordinatorPublisher_PublishesFromOutboxAsync() {
    // Arrange
    var mockTransport = CreateMockTransport();
    var worker = new WorkCoordinatorPublisherWorker(_coordinator, mockTransport, _config, _logger);

    // Seed outbox with message
    await SeedOutboxAsync(new OutboxMessage(/* ... */));

    // Act
    await worker.StartAsync(CancellationToken.None);
    await Task.Delay(2000);  // Let worker poll
    await worker.StopAsync(CancellationToken.None);

    // Assert
    await Assert.That(mockTransport.PublishedMessages).HasCount().EqualTo(1);

    var published = await _db.QuerySingleOrDefaultAsync<OutboxRow>(
        "SELECT * FROM wh_outbox WHERE message_id = @MessageId",
        new { MessageId = outboxMsg.MessageId }
    );

    await Assert.That(published!.Status).IsEqualTo("Published");
}
```

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
