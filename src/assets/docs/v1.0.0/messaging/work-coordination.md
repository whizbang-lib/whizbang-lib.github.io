---
title: "Work Coordination"
version: 1.0.0
category: "Messaging"
order: 10
description: >-
  Foundation of Whizbang's distributed message processing architecture
  covering lease-based coordination, virtual partition distribution via
  consistent hashing, stream ordering guarantees, and orphaned work recovery.
tags: 'work-coordination, lease-based, partitioning, consistent-hashing, stream-ordering, distributed-systems, process-work-batch'
codeReferences:
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinatorStrategy.cs
  - src/Whizbang.Core/Workers/WorkCoordinatorPublisherWorker.cs
---

# Work Coordination

## Overview

Work coordination is the foundation of Whizbang's distributed message processing architecture. It ensures reliable, ordered, and efficient message processing across multiple service instances through lease-based coordination, partition-based distribution, and stream ordering guarantees.

> **This page covers concepts and architecture.** For the `IWorkCoordinator` API reference (interface, parameters, usage patterns), see [Work Coordinator](work-coordinator.md).

## Core Concepts

### Lease-Based Coordination

Messages are claimed using time-limited leases to prevent duplicate processing and enable automatic recovery from instance failures.

**Key Properties:**
- **Lease Duration**: Configurable time window (default: 5 minutes) during which an instance has exclusive rights to process a message
- **Lease Expiry**: UTC timestamp when the lease expires
- **Orphaned Work Recovery**: Messages with expired leases can be reclaimed by any active instance
- **Atomic Claiming**: Lease acquisition happens atomically in the database via the `process_work_batch` function

### Virtual Partition Distribution

Work is distributed across instances using consistent hashing on UUIDv7 identifiers - **no partition assignments table required**.

**How It Works:**
1. Each message's `stream_id` is hashed to determine its partition number (0-9999 by default)
2. Instance ownership calculated algorithmically: `hashtext(stream_id::TEXT) % active_instance_count = hashtext(instance_id::TEXT) % active_instance_count`
3. Each message stores `instance_id` when claimed to preserve assignment
4. No `wh_partition_assignments` table - purely algorithmic

**Benefits:**
- **Fair Distribution**: Work evenly distributed via consistent hashing
- **Sticky Assignment**: Same stream always maps to same instance (until rebalancing)
- **Automatic Rebalancing**: Adding/removing instances triggers hash redistribution
- **Self-Contained**: No external state - assignment based on UUID properties
- **Fault Tolerance**: Failed instances release messages via lease expiry

### Stream Ordering Guarantees

Messages within the same stream are processed in strict temporal order, even across multiple instances.

**Ordering Rules:**
1. Messages in the same stream must be processed in `created_at` (outbox) or `received_at` (inbox) order
2. If Instance A holds message M1 from stream S, Instance B cannot claim later messages M2, M3, M4 from stream S
3. Scheduled retries block all later messages in the same stream until the scheduled time passes
4. This guarantee holds across instance failures, scaling events, and partition reassignments

## Message Flow Diagrams

### Inbox Message Flow (Inline Processing)

Shows how `TransportConsumerWorker` processes incoming messages in real-time via the inbox pattern.

```mermaid
sequenceDiagram
    participant T as Transport
    participant TCW as TransportConsumerWorker
    participant S as Strategy (FlushAsync)
    participant SQL as process_work_batch
    participant DB as wh_inbox
    participant R as Receptors

    T->>TCW: message arrives
    TCW->>TCW: _serializeToNewInboxMessage()
    TCW->>S: QueueInboxMessage(msg)
    S->>SQL: ProcessWorkBatchAsync({NewInboxMessages})
    SQL->>DB: store_inbox_messages (partition, lease)
    SQL-->>S: InboxWork[] returned
    S-->>TCW: WorkBatch with InboxWork
    TCW->>R: PreInboxAsync / PreInboxInline
    TCW->>TCW: OrderedStreamProcessor.ProcessInboxWorkAsync
    TCW->>R: PostInboxAsync / PostInboxInline
    TCW->>S: QueueInboxCompletion(msgId, status)
    S->>SQL: ProcessWorkBatchAsync({InboxCompletions})
    SQL->>DB: update status, clear lease, set processed_at
```

### Orphaned Inbox Recovery (Poll Loop)

Shows how `WorkCoordinatorPublisherWorker` recovers and processes orphaned inbox messages that were not completed (e.g., due to crashes or deployments).

```mermaid
sequenceDiagram
    participant W as WorkCoordinatorPublisherWorker
    participant SQL as process_work_batch
    participant DB as wh_inbox
    participant R as Receptors

    loop every PollingIntervalMs
        W->>SQL: ProcessWorkBatchAsync({InboxFailures, InboxCompletions})
        SQL->>DB: report failures/completions from previous cycle
        SQL->>DB: claim_orphaned_inbox (expired leases)
        SQL-->>W: WorkBatch { InboxWork[] }
        alt InboxWork present
            W->>W: deserialize via ILifecycleMessageDeserializer (AOT-safe)
            W->>R: PreInboxAsync / PreInboxInline
            W->>W: OrderedStreamProcessor.ProcessInboxWorkAsync
            W->>R: PostInboxAsync / PostInboxInline
            W->>W: queue to _inboxCompletions or _inboxFailures
        end
    end
```

### What Was Broken (Before Fix)

Before the inbox processing fix, orphaned inbox messages were stuck in an infinite loop because failures were routed to the wrong SQL parameter.

```mermaid
flowchart TD
    A[Inbox message stored, status=1] -->|lease expires| B[claim_orphaned_inbox]
    B --> C[InboxWork returned]
    C --> D["_failures.Add('Inbox processing not yet implemented')"]
    D --> E[Next poll: failures sent as OutboxFailures]
    E --> F["SQL updates wh_outbox — wrong table!"]
    F --> G[No matching rows → 0 processed]
    G --> H[Failures never acknowledged]
    H -->|lease expires again| B
    style D fill:#dc3545,color:#fff
    style F fill:#dc3545,color:#fff
```

## Architecture Components

### Database Tables

**`wh_service_instances`** - Active instance registry
- Tracks all service instances with heartbeat timestamps
- Used to determine active instance count for virtual partition distribution
- Stale instances (no heartbeat > threshold) are automatically removed

**`wh_outbox`** - Outbound message queue
- Messages awaiting publication to external transports
- Includes partition number, lease information, and processing status
- Done when `Published` flag is set

**`wh_inbox`** - Inbound message queue
- Messages awaiting handler invocation
- Includes deduplication tracking via `wh_message_deduplication`
- Done when `EventStored` flag is set

**`wh_message_deduplication`** - Inbox deduplication
- Permanent record of all inbox message IDs seen
- Prevents duplicate processing of the same message
- Outbox does not use this table (transactional boundary responsibility)

### PostgreSQL Function

**`process_work_batch`** - Atomic work coordination
- Single PostgreSQL function handling all coordination operations
- Minimizes database round-trips and ensures atomicity
- Returns claimable work in a single result set

**Operations Performed:**
1. Register/update instance with heartbeat
2. Clean up stale instances (expired heartbeats)
3. Mark completed/failed messages (outbox and inbox)
4. Update receptor processing and perspective checkpoints
5. Store new messages (with partition assignment)
6. Claim orphaned work (expired leases)
7. Renew leases for buffered messages
8. Return claimable work (respecting stream ordering)

**Parameters:**
- Instance identification (ID, service name, host, process ID)
- Completion/failure tracking (outbox, inbox, receptors, perspectives)
- New messages to store
- Lease renewal IDs
- Configuration (lease seconds, stale threshold, partition count)

## Processing Flow

### Normal Operation

```mermaid
sequenceDiagram
    participant App as Application
    participant WC as WorkCoordinator
    participant DB as PostgreSQL
    participant T as Transport

    App->>WC: ProcessWorkBatchAsync()
    WC->>DB: process_work_batch()
    DB->>DB: Update heartbeat
    DB->>DB: Claim orphaned work
    DB->>DB: Apply modulo distribution
    DB->>DB: Check stream ordering
    DB-->>WC: WorkBatch (claimable messages)
    WC-->>App: WorkBatch

    App->>App: Process messages
    App->>T: Publish to transport
    T-->>App: Ack

    App->>WC: ProcessWorkBatchAsync(completions)
    WC->>DB: process_work_batch(completions)
    DB->>DB: Mark as Published/EventStored
    DB->>DB: Delete completed messages
    DB-->>WC: WorkBatch (new work)
    WC-->>App: WorkBatch
```

### Failure Recovery

```mermaid
sequenceDiagram
    participant I1 as Instance 1
    participant DB as PostgreSQL
    participant I2 as Instance 2

    I1->>DB: ProcessWorkBatch()
    DB-->>I1: M1, M2 (lease_expiry = now + 5min)

    Note over I1: Instance 1 crashes<br/>(no heartbeat)

    Note over DB: Time passes...<br/>lease_expiry < now

    I2->>DB: ProcessWorkBatch()
    DB->>DB: Find orphaned work<br/>(lease_expiry < now)
    DB-->>I2: M1, M2 (reclaimed)

    Note over I2: ✅ Processing continues<br/>No messages lost
```

## Key Features

### Atomic Operations

All coordination operations happen in a single database transaction:
- Heartbeat updates
- Message completions
- Message failures
- New message storage
- Lease claims
- Work return

This ensures consistency even under high concurrency and instance failures.

### Stale Instance Detection

Instances that stop heartbeating are automatically detected and cleaned up:
- **Stale Threshold**: Default 10 minutes (configurable)
- **Heartbeat Update**: Every `ProcessWorkBatch` call updates `last_heartbeat_at`
- **Cleanup**: Stale instances deleted, their partitions released (CASCADE)

### Partition Stability

Partition ownership is stable across instance scaling:
- **New Instances**: Claim only unassigned partitions or partitions from stale instances
- **Active Instances**: Partitions are NOT reassigned from active instances
- **Modulo Distribution**: Ensures fair work distribution as instances join/leave

### Idempotency

**Inbox**: Permanent deduplication via `wh_message_deduplication` table
- Duplicate messages are rejected via `ON CONFLICT DO NOTHING`
- Ensures exactly-once processing guarantee

**Outbox**: Transactional boundary responsibility
- No deduplication table (duplicate prevention is the caller's responsibility)
- Outbox is part of the application's transaction boundary

## Configuration Options

### Lease Configuration

```csharp{title="Lease Configuration" description="Lease Configuration" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Lease", "Configuration"]}
var request = new ProcessWorkBatchRequest {
    // ... other properties
    LeaseSeconds = 300,  // 5 minutes (default)
    StaleThresholdSeconds = 600  // 10 minutes (default)
};
```

### Partition Configuration

```csharp{title="Partition Configuration" description="Partition Configuration" category="Architecture" difficulty="BEGINNER" tags=["Messaging", "C#", "Partition", "Configuration"]}
var request = new ProcessWorkBatchRequest {
    // ... other properties
    PartitionCount = 10_000,  // Total partitions (default)
};
```

### Testing Configuration

For fast tests, use short lease and stale times:

```csharp{title="Testing Configuration" description="For fast tests, use short lease and stale times:" category="Architecture" difficulty="BEGINNER" tags=["Messaging", "C#", "Testing", "Configuration"]}
var request = new ProcessWorkBatchRequest {
    // ... other properties
    LeaseSeconds = 2,  // 2 seconds for fast tests
    StaleThresholdSeconds = 10  // 10 seconds for fast tests
};
```

## Performance Characteristics

### Single Database Call

All coordination operations happen in one `process_work_batch` call:
- Minimizes network round-trips
- Reduces database connection overhead
- Ensures atomic consistency

### Efficient Querying

The function uses optimized queries:
- Index-based partition lookups
- Efficient NOT EXISTS checks for stream ordering
- Batch operations for completions/failures

### Scalability

Horizontal scaling through partition distribution:
- Add instances → automatic partition redistribution
- Remove instances → automatic partition reassignment
- No manual coordination required

## Related Documentation

- [Multi-Instance Coordination](multi-instance-coordination.md) - Detailed scenarios and sequence diagrams
- [Idempotency Patterns](idempotency-patterns.md) - Deduplication strategies
- [Failure Handling](failure-handling.md) - Retry scheduling and failure cascades
- [Outbox Pattern](outbox-pattern.md) - Transactional outbox implementation
- [Inbox Pattern](inbox-pattern.md) - Deduplication and handler invocation

## Implementation

### C# Interface

```csharp{title="C# Interface" description="C# Interface" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "Interface"]}
public interface IWorkCoordinator {
    Task<WorkBatch> ProcessWorkBatchAsync(
        ProcessWorkBatchRequest request,
        CancellationToken cancellationToken = default
    );
}
```

For the full `ProcessWorkBatchRequest` parameter object, see [Work Coordinator](work-coordinator.md#processworkbatchrequest).

### PostgreSQL Implementation

See: `014_CreateProcessWorkBatchFunction.sql`

The PostgreSQL function is the authoritative implementation of all coordination logic.

## Testing

Comprehensive integration tests validate all coordination scenarios:
- Instance lifecycle (heartbeat, stale cleanup)
- Partition stability (scaling, reassignment)
- Stream ordering (cross-instance, scheduled retry)
- Idempotency (inbox deduplication, outbox transactional)
- Failure recovery (lease expiry, orphaned work)

See: `Whizbang.Data.EFCore.Postgres.Tests/EFCoreWorkCoordinatorTests.cs`

## Best Practices

### Heartbeat Frequency

Call `ProcessWorkBatchAsync` frequently to maintain heartbeat:
- Recommended: Every 30-60 seconds minimum
- Ensures instances are not marked as stale
- Enables quick partition reassignment on failures

### Lease Duration

Choose lease duration based on maximum processing time:
- Too short: Messages become orphaned during normal processing
- Too long: Delayed recovery from instance failures
- Recommended: 5 minutes (covers most processing scenarios)

### Stale Threshold

Set stale threshold to allow for temporary network issues:
- Should be significantly longer than lease duration
- Recommended: 2x lease duration minimum (10 minutes for 5-minute leases)

### Partition Count

Higher partition counts enable finer-grained distribution:
- Default: 10,000 partitions (works well for most scenarios)
- More partitions = more even distribution across instances
- Trade-off: More partition assignments to track

## Troubleshooting

### Messages Not Being Claimed

**Check:**
- Instance is heartbeating (calls `ProcessWorkBatchAsync` regularly)
- Partition ownership (is instance assigned the message's partition?)
- Stream ordering (is an earlier message blocking this message?)
- Lease status (is message already claimed by another instance?)

### Stale Instance Not Cleaned Up

**Check:**
- Last heartbeat timestamp (`wh_service_instances.last_heartbeat_at`)
- Stale threshold configuration (default: 10 minutes)
- System time synchronization across instances

### Partition Not Reassigning

**Check:**
- Instance is actually stale (heartbeat > threshold)
- Active instance count in `wh_service_instances` (algorithmic redistribution)
- Hash-based distribution formula: `hashtext(stream_id::TEXT) % active_instance_count`

### Out-of-Order Processing

**Check:**
- Stream ID is set correctly on all messages
- Temporal order (created_at/received_at timestamps)
- Cross-instance lease coordination (NOT EXISTS logic)
