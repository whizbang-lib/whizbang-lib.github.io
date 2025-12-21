---
title: "Work Coordinator"
version: 0.1.0
category: Messaging
order: 3
description: "Master the Work Coordinator - atomic batch processing for Outbox, Inbox, and event store tracking with lease-based coordination"
tags: work-coordinator, atomic-operations, batch-processing, distributed-coordination, lease-management
codeReferences:
  - src/Whizbang.Core/WorkCoordination/IWorkCoordinator.cs
  - src/Whizbang.Data.Postgres/WorkCoordination/PostgresWorkCoordinator.cs
  - src/Whizbang.Data.Postgres/WorkCoordination/process_work_batch.sql
---

# Work Coordinator

The **Work Coordinator** (`IWorkCoordinator`) is Whizbang's atomic batch processing engine. It handles Outbox, Inbox, and event store tracking in a single database transaction with lease-based coordination for distributed work.

## Overview

The Work Coordinator solves a critical problem: **How do you atomically coordinate multiple operations** (mark messages complete, store new events, claim work) across distributed workers?

### What It Coordinates

```
┌─────────────────────────────────────────────────────┐
│ Single Atomic Database Transaction                  │
│                                                     │
│ 1. Delete completed outbox messages                │
│ 2. Update failed outbox messages (retry counts)    │
│ 3. Insert new outbox messages                      │
│ 4. Delete completed inbox messages                 │
│ 5. Update failed inbox messages                    │
│ 6. Insert new inbox messages                       │
│ 7. Update receptor processing records              │
│ 8. Update perspective checkpoint records           │
│ 9. Claim new outbox/inbox work (via leasing)       │
│ 10. Return claimed work to caller                   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Key Insight**: All operations **succeed together or fail together** (atomicity via database transaction).

---

## IWorkCoordinator Interface

```csharp
public interface IWorkCoordinator {
    Task<WorkBatch> ProcessWorkBatchAsync(
        // Instance info
        Guid instanceId,
        string serviceName,
        string hostName,
        int processId,
        Dictionary<string, JsonElement>? metadata,

        // Outbox completions and failures
        MessageCompletion[] outboxCompletions,
        MessageFailure[] outboxFailures,

        // Inbox completions and failures
        MessageCompletion[] inboxCompletions,
        MessageFailure[] inboxFailures,

        // Event store tracking - Receptors
        ReceptorProcessingCompletion[] receptorCompletions,
        ReceptorProcessingFailure[] receptorFailures,

        // Event store tracking - Perspectives
        PerspectiveCheckpointCompletion[] perspectiveCompletions,
        PerspectiveCheckpointFailure[] perspectiveFailures,

        // New work to store
        OutboxMessage[] newOutboxMessages,
        InboxMessage[] newInboxMessages,

        // Lease renewals
        Guid[] renewOutboxLeaseIds,
        Guid[] renewInboxLeaseIds,

        // Configuration
        WorkBatchFlags flags = WorkBatchFlags.None,
        int partitionCount = 10000,
        int maxPartitionsPerInstance = 100,
        int leaseSeconds = 300,
        int staleThresholdSeconds = 600,

        CancellationToken cancellationToken = default
    );
}
```

**Returns**:
```csharp
public record WorkBatch(
    OutboxMessage[] ClaimedOutboxMessages,
    InboxMessage[] ClaimedInboxMessages,
    int[] AssignedPartitions
);
```

---

## Core Concepts

### Atomic Batch Processing

**Pattern**: Submit **all changes** in one call, get **all results** atomically.

```csharp
// Example: Order created, publish event, claim new work
var batch = await _coordinator.ProcessWorkBatchAsync(
    instanceId: workerInstanceId,
    serviceName: "OrderService",
    hostName: Environment.MachineName,
    processId: Environment.ProcessId,
    metadata: null,

    // No completions/failures this time
    outboxCompletions: [],
    outboxFailures: [],
    inboxCompletions: [],
    inboxFailures: [],

    // Event store tracking
    receptorCompletions: [],
    receptorFailures: [],
    perspectiveCompletions: [],
    perspectiveFailures: [],

    // Store new OrderCreated event in outbox
    newOutboxMessages: [
        new OutboxMessage(
            MessageId: Guid.CreateVersion7(),
            CorrelationId: correlationId,
            CausationId: causationId,
            MessageType: "OrderCreated",
            Payload: JsonSerializer.Serialize(orderCreated),
            Topic: "orders",
            StreamKey: customerId.ToString(),
            PartitionKey: customerId.ToString()
        )
    ],
    newInboxMessages: [],

    // No renewals
    renewOutboxLeaseIds: [],
    renewInboxLeaseIds: [],

    ct: cancellationToken
);

// batch.ClaimedOutboxMessages = newly claimed work ready to publish
```

**Result**:
1. OrderCreated event stored in outbox
2. New outbox messages claimed for this worker
3. **All atomic** - if database commit fails, nothing happens

### Lease-Based Coordination

**Problem**: How do multiple workers process messages without conflicts?

**Solution**: **Leasing** - workers "claim" messages for a time period.

```sql
-- Worker A claims messages
UPDATE wh_outbox
SET
    instance_id = 'worker-a',
    lease_expiry = NOW() + INTERVAL '5 minutes'
WHERE message_id IN (...)
```

**Benefits**:
- ✅ **Prevents duplicate processing**: Only one worker holds lease
- ✅ **Fault tolerance**: Lease expires if worker crashes
- ✅ **Scalability**: Multiple workers process different partitions

### Partition-Based Distribution

**Problem**: How do you distribute work evenly across workers?

**Solution**: **Consistent hashing** via `partition_number`.

```csharp
// Each message gets a partition number (0-9999)
var partitionNumber = Math.Abs(customerId.GetHashCode()) % 10000;

// Worker A might handle partitions 0-999
// Worker B might handle partitions 1000-1999
// Worker C might handle partitions 2000-2999
// etc.
```

**Benefits**:
- ✅ **Even distribution**: Hash function spreads messages evenly
- ✅ **Deterministic**: Same customer always maps to same partition
- ✅ **Scalable**: Add more workers, redistribute partitions

---

## Parameters Explained

### Instance Information

```csharp
Guid instanceId,          // Unique ID for this worker instance
string serviceName,       // Name of service ("OrderService")
string hostName,          // Machine name (Environment.MachineName)
int processId,            // Process ID (Environment.ProcessId)
Dictionary<string, JsonElement>? metadata,  // Optional metadata
```

**Usage**: Identifies which worker is processing messages (for observability and debugging).

### Message Completions

```csharp
MessageCompletion[] outboxCompletions,
MessageCompletion[] inboxCompletions,

public record MessageCompletion(
    Guid MessageId,
    MessageProcessingStatus Status
);

public enum MessageProcessingStatus {
    Stored = 1,
    Published = 2,
    Completed = 4,
    Failed = 8
}
```

**Usage**: Mark messages as successfully processed (delete from outbox/inbox).

### Message Failures

```csharp
MessageFailure[] outboxFailures,
MessageFailure[] inboxFailures,

public record MessageFailure(
    Guid MessageId,
    MessageProcessingStatus Status,
    string Error,
    string? StackTrace = null
);
```

**Usage**: Mark messages as failed (increment retry count, update error).

### Event Store Tracking - Receptors

```csharp
ReceptorProcessingCompletion[] receptorCompletions,
ReceptorProcessingFailure[] receptorFailures,

public record ReceptorProcessingCompletion(
    Guid EventId,
    string ReceptorName,
    ReceptorProcessingStatus Status
);

public record ReceptorProcessingFailure(
    Guid EventId,
    string ReceptorName,
    ReceptorProcessingStatus Status,
    string Error
);
```

**Purpose**: Track which **receptors** have processed which **events** (log-style, many receptors per event).

**Use Cases**:
- Side effects (sending emails, notifications)
- Read model updates (non-ordered)
- Analytics/metrics collection

### Event Store Tracking - Perspectives

```csharp
PerspectiveCheckpointCompletion[] perspectiveCompletions,
PerspectiveCheckpointFailure[] perspectiveFailures,

public record PerspectiveCheckpointCompletion(
    Guid StreamId,
    string PerspectiveName,
    Guid LastEventId,
    PerspectiveProcessingStatus Status
);

public record PerspectiveCheckpointFailure(
    Guid StreamId,
    string PerspectiveName,
    Guid LastEventId,
    PerspectiveProcessingStatus Status,
    string Error
);
```

**Purpose**: Track **checkpoints** for perspectives processing event streams (one checkpoint per stream/perspective pair).

**Use Cases**:
- Read model projections (ordered events per stream)
- Temporal queries (state as of specific event)
- Rebuilding projections from event history

**Key Difference from Receptors**:
- **Receptors**: Many receptors can process same event independently
- **Perspectives**: One checkpoint per (stream_id, perspective_name) pair for ordered processing

### New Messages

```csharp
OutboxMessage[] newOutboxMessages,
InboxMessage[] newInboxMessages,

public record OutboxMessage(
    Guid MessageId,
    Guid CorrelationId,
    Guid CausationId,
    string MessageType,
    string Payload,  // JSON
    string Topic,
    string StreamKey,
    string PartitionKey
);

public record InboxMessage(
    Guid MessageId,
    Guid CorrelationId,
    Guid? CausationId,
    string MessageType,
    string Payload,  // JSON
    string SourceTopic
);
```

**Usage**: Store new events in outbox (for publishing) or inbox (for deduplication).

### Lease Renewals

```csharp
Guid[] renewOutboxLeaseIds,
Guid[] renewInboxLeaseIds,
```

**Usage**: Extend leases on messages being processed (prevents timeout during long operations).

### Configuration

```csharp
WorkBatchFlags flags = WorkBatchFlags.None,
int partitionCount = 10000,
int maxPartitionsPerInstance = 100,
int leaseSeconds = 300,
int staleThresholdSeconds = 600,
```

**Flags**:
- `None`: Normal operation
- `SkipClaim`: Don't claim new work (only process completions/failures)

**Parameters**:
- `partitionCount`: Total partitions (10,000 recommended)
- `maxPartitionsPerInstance`: Max partitions per worker (100 recommended)
- `leaseSeconds`: Lease duration (300s = 5 minutes)
- `staleThresholdSeconds`: Stale lease threshold (600s = 10 minutes)

---

## Common Usage Patterns

### Pattern 1: Store Event in Outbox

```csharp
// Receptor creates event, stores in outbox
await _coordinator.ProcessWorkBatchAsync(
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
    newOutboxMessages: [
        new OutboxMessage(
            MessageId: Guid.CreateVersion7(),
            CorrelationId: command.CorrelationId.Value,
            CausationId: command.MessageId.Value,
            MessageType: typeof(OrderCreated).FullName!,
            Payload: JsonSerializer.Serialize(orderCreated),
            Topic: "orders",
            StreamKey: customerId.ToString(),
            PartitionKey: customerId.ToString()
        )
    ],
    newInboxMessages: [],
    renewOutboxLeaseIds: [],
    renewInboxLeaseIds: [],
    ct: ct
);
```

### Pattern 2: Claim and Publish Outbox Messages

```csharp
// Background worker claims work
var batch = await _coordinator.ProcessWorkBatchAsync(
    instanceId: workerInstanceId,
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

// Publish claimed messages
foreach (var msg in batch.ClaimedOutboxMessages) {
    await _transport.PublishAsync(msg.Topic, msg.MessageId, msg.Payload, ct);
}
```

### Pattern 3: Report Completions After Publishing

```csharp
var completions = new List<MessageCompletion>();

foreach (var msg in batch.ClaimedOutboxMessages) {
    try {
        await _transport.PublishAsync(msg.Topic, msg.MessageId, msg.Payload, ct);

        completions.Add(new MessageCompletion(
            MessageId: msg.MessageId,
            Status: MessageProcessingStatus.Published
        ));

    } catch (Exception ex) {
        failures.Add(new MessageFailure(
            MessageId: msg.MessageId,
            Status: MessageProcessingStatus.Failed,
            Error: ex.Message,
            StackTrace: ex.StackTrace
        ));
    }
}

// Report back to coordinator
await _coordinator.ProcessWorkBatchAsync(
    instanceId: workerInstanceId,
    serviceName: "OrderService",
    hostName: Environment.MachineName,
    processId: Environment.ProcessId,
    metadata: null,
    outboxCompletions: completions.ToArray(),
    outboxFailures: failures.ToArray(),
    /* ... */,
    ct: ct
);
```

### Pattern 4: Store in Inbox (Deduplication)

```csharp
// Worker receives message from Azure Service Bus
try {
    // Store in inbox (atomic - prevents duplicate processing)
    await _coordinator.ProcessWorkBatchAsync(
        instanceId: workerInstanceId,
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
                MessageId: message.MessageId,
                CorrelationId: message.CorrelationId,
                CausationId: message.CausationId,
                MessageType: message.MessageType,
                Payload: message.Payload,
                SourceTopic: "orders"
            )
        ],
        renewOutboxLeaseIds: [],
        renewInboxLeaseIds: [],
        ct: ct
    );

} catch (Npgsql.PostgresException ex) when (ex.SqlState == "23505") {
    // Unique constraint violation = duplicate message
    _logger.LogWarning("Duplicate message {MessageId} detected", message.MessageId);
    return;  // Skip processing
}
```

---

## PostgreSQL Implementation

The Work Coordinator is implemented as a **PostgreSQL stored procedure** for optimal performance.

### Stored Procedure: `process_work_batch`

```sql
CREATE OR REPLACE FUNCTION process_work_batch(
    p_instance_id UUID,
    p_service_name VARCHAR(255),
    p_host_name VARCHAR(255),
    p_process_id INT,
    p_metadata JSONB,

    -- Completions and failures (JSON arrays)
    p_outbox_completions JSONB,
    p_outbox_failures JSONB,
    p_inbox_completions JSONB,
    p_inbox_failures JSONB,

    -- Event store tracking
    p_receptor_completions JSONB,
    p_receptor_failures JSONB,
    p_perspective_completions JSONB,
    p_perspective_failures JSONB,

    -- New messages
    p_new_outbox_messages JSONB,
    p_new_inbox_messages JSONB,

    -- Lease renewals
    p_renew_outbox_lease_ids JSONB,
    p_renew_inbox_lease_ids JSONB,

    -- Configuration
    p_partition_count INT DEFAULT 10000,
    p_max_partitions_per_instance INT DEFAULT 100,
    p_lease_seconds INT DEFAULT 300,
    p_stale_threshold_seconds INT DEFAULT 600
)
RETURNS TABLE (
    claimed_outbox_messages JSONB,
    claimed_inbox_messages JSONB,
    assigned_partitions JSONB
)
LANGUAGE plpgsql
AS $$
BEGIN
    -- 1. Delete completed outbox messages
    DELETE FROM wh_outbox
    WHERE message_id IN (
        SELECT (value->>'MessageId')::UUID
        FROM jsonb_array_elements(p_outbox_completions)
    );

    -- 2. Update failed outbox messages
    -- (increment attempts, update error, release lease)

    -- 3. Insert new outbox messages
    -- (with partition_number for consistent hashing)

    -- 4. Delete completed inbox messages
    -- 5. Update failed inbox messages
    -- 6. Insert new inbox messages

    -- 7. Update receptor processing records
    -- 8. Update perspective checkpoint records

    -- 9. Claim new outbox work (with leasing)
    -- 10. Claim new inbox work (with leasing)

    -- Return claimed work
    RETURN QUERY SELECT ...;
END;
$$;
```

**Benefits**:
- ✅ **Single database roundtrip**: All operations in one call
- ✅ **Atomic**: Transaction semantics guarantee consistency
- ✅ **Performance**: Stored procedure is compiled, optimized by PostgreSQL

---

## Best Practices

### DO ✅

- ✅ **Use single transaction**: All operations atomic
- ✅ **Report completions promptly**: Don't let leases expire
- ✅ **Monitor stale leases**: Alert when lease_expiry is old
- ✅ **Use consistent hashing**: Partition-based work distribution
- ✅ **Log all operations**: InstanceId, ServiceName, timestamps
- ✅ **Handle failures gracefully**: Increment retry counts, log errors
- ✅ **Clean up old data**: Archive completed messages periodically
- ✅ **Configure lease duration**: Balance fault tolerance vs recovery time

### DON'T ❌

- ❌ Skip reporting completions (leads to duplicate work)
- ❌ Ignore failures (silent data loss)
- ❌ Use locks instead of leases (doesn't scale)
- ❌ Set lease duration too short (thrashing)
- ❌ Set lease duration too long (slow recovery from crashes)
- ❌ Process outside coordinator (breaks atomicity)
- ❌ Skip monitoring (blind to failures)

---

## Monitoring & Observability

### Key Metrics

```csharp
public class WorkCoordinatorMetrics {
    public int OutboxStoredCount { get; set; }
    public int OutboxPublishedCount { get; set; }
    public int OutboxFailedCount { get; set; }
    public int InboxReceivedCount { get; set; }
    public int InboxCompletedCount { get; set; }
    public int InboxFailedCount { get; set; }
    public int ActiveLeases { get; set; }
    public int StaleLeases { get; set; }
}
```

### Alerts

**Critical**:
- 🚨 `StaleLeases > 0` (workers crashed or stuck)
- 🚨 `OutboxFailedCount > 0` or `InboxFailedCount > 0` (messages gave up)

**Warning**:
- ⚠️ `OutboxStoredCount > 10000` (backlog growing)
- ⚠️ `ActiveLeases > workers * maxPartitionsPerInstance` (too many leases)

---

## Further Reading

**Architecture**:
- [Message Lifecycle & Architecture](../architecture/message-lifecycle.md) - **Complete flow with sequence diagrams** showing Commands, Events, Receptors, Perspectives, and all integration points

**Core Concepts**:
- [Dispatcher](../core-concepts/dispatcher.md) - Message routing
- [Receptors](../core-concepts/receptors.md) - Message handlers and business logic
- [Perspectives](../core-concepts/perspectives.md) - Event listeners for read models

**Messaging Patterns**:
- [Outbox Pattern](outbox-pattern.md) - Reliable event publishing
- [Inbox Pattern](inbox-pattern.md) - Exactly-once processing
- [Message Envelopes](message-envelopes.md) - Hop-based observability

**Data Access**:
- [Event Store](../data/event-store.md) - Event storage and replay

---

*Version 0.1.0 - Foundation Release | Last Updated: 2025-12-21*
