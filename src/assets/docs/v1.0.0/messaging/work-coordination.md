---
title: "Work Coordination"
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: "Messaging"
order: 10
description: >-
  Foundation of Whizbang's distributed message processing architecture
  covering lease-based coordination, virtual partition distribution via
  consistent hashing, stream ordering guarantees, and orphaned work recovery.
tags: 'work-coordination, lease-based, partitioning, consistent-hashing, stream-ordering, distributed-systems, claim-work'
codeReferences:
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinatorStrategy.cs
  - src/Whizbang.Core/Messaging/ClaimWorkRequest.cs
  - src/Whizbang.Core/Workers/ClaimWorker.cs
  - src/Whizbang.Core/Workers/HeartbeatWorker.cs
  - src/Whizbang.Core/Workers/LeaseRenewalWorker.cs
  - src/Whizbang.Data.Postgres/Migrations/029_ProcessWorkBatch.sql
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ClaimWorkSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreClaimWorkTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreRecordHeartbeatTests.cs
  - tests/Whizbang.Core.Tests/Workers/ClaimWorkerTests.cs
  - tests/Whizbang.Core.Tests/Workers/HeartbeatWorkerTests.cs
  - tests/Whizbang.Core.Tests/Workers/LeaseRenewalWorkerCapTests.cs
lastMaintainedCommit: '01f07906'
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
- **Atomic Claiming**: Lease acquisition happens atomically in the database via the `claim_work` function
- **Lease Renewal**: `LeaseRenewalWorker` extends leases for in-flight work approaching expiry (via `renew_leases`), with a renewal cap so stuck work eventually re-orphans

### Virtual Partition Distribution

Work is distributed across instances using consistent hashing on UUIDv7 identifiers - **no partition assignments table required**.

**How It Works:**
1. Each message's `stream_id` is hashed to determine its partition number (0-9999 by default): `abs(hashtext(stream_id::TEXT)) % partition_count` (the `compute_partition` function)
2. Each live instance gets a rank among active instances (`calculate_instance_rank`: `ROW_NUMBER()` over live `wh_service_instances` rows)
3. Unowned or orphaned work is claimable when `partition_number % active_instance_count = instance_rank`
4. Streams pin to the instance that first stores work for them (`wh_active_streams.assigned_instance_id`, first-write-wins); ownership is reassigned only when the owning instance dies

**Benefits:**
- **Fair Distribution**: Work evenly distributed via consistent hashing
- **Sticky Assignment**: Same stream always maps to same instance (until the owner dies)
- **Automatic Rebalancing**: Adding/removing instances redistributes unowned partitions via the modulo formula
- **Fault Tolerance**: Failed instances release messages via lease expiry and stale-instance cleanup

### Stream Ordering Guarantees

Messages within the same stream are processed in strict temporal order, even across multiple instances.

**Ordering Rules:**
1. Messages in the same stream must be processed in `created_at` (outbox) or `received_at` (inbox) order
2. If Instance A holds message M1 from stream S, Instance B cannot claim later messages M2, M3, M4 from stream S
3. Scheduled retries block all later messages in the same stream until the scheduled time passes
4. This guarantee holds across instance failures, scaling events, and partition reassignments

## Message Flow Diagrams

### Inbox Message Flow

Shows how an incoming transport message travels through storage, claiming, per-stream draining, and handler commit.

```mermaid{caption="Inbox message flow — a transport message is stored, claimed by the owning instance, drained per-stream in FIFO order, then dispatched and handler-committed."}
sequenceDiagram
    participant T as Transport
    participant TCW as TransportConsumerWorker
    participant SQL as store_inbox_messages
    participant CW as ClaimWorker
    participant IDW as InboxDrainWorker
    participant DSP as InboxDispatchWorker
    participant IHW as InboxHandlerWorker

    T->>TCW: message arrives
    TCW->>SQL: StoreInboxMessagesAsync([msg])
    SQL->>SQL: dedup + INSERT wh_inbox (no lease)
    SQL-->>CW: NOTIFY wakes owner instance
    CW->>CW: claim_work() — leases rows,<br/>returns stream ids (bodies NULL)
    CW->>IDW: stream_id via IInboxDrainChannel
    IDW->>IDW: FetchInboxBatchAsync(stream_id)<br/>pulls leased rows in stream-FIFO order
    IDW->>DSP: InboxWork via IInboxChannelWriter
    DSP->>DSP: Pre/Post Inbox lifecycle stages,<br/>handler invocation
    DSP->>IHW: HandlerCommitRequest
    IHW->>IHW: CommitHandlerBatchAsync<br/>(commit_handler_batch, SAVEPOINT per handler)
```

### Orphaned Inbox Recovery (Claim Loop)

Shows how `ClaimWorker` recovers orphaned inbox messages that were not completed (e.g., due to crashes or deployments). Orphan claiming happens inside `claim_work` via the `claim_orphaned_inbox` sub-function.

```mermaid{caption="Orphaned-inbox recovery — ClaimWorker's adaptive poll loop calls claim_work, which reclaims unowned or expired-lease rows and hands the stream ids to the inbox drain worker." tests=["ClaimWorkerTests.ExecuteAsync_PollsAtLeastOnceAsync", "ClaimWorkerTests.Distribute_InboxDrainChannel_WritesStreamIds_EvenWhenIsInFlightTrueAsync"]}
sequenceDiagram
    participant CW as ClaimWorker
    participant SQL as claim_work
    participant DB as wh_inbox
    participant IDW as InboxDrainWorker

    loop adaptive poll (250 ms base, 10 s cap; 5 s when NOTIFY healthy)
        CW->>SQL: ClaimWorkAsync(instance, maxStreams, lease)
        SQL->>SQL: empty-call short-circuit<br/>(EXISTS probes, ≤1 ms when idle)
        SQL->>DB: claim_orphaned_inbox<br/>(unowned rows + expired leases)
        SQL-->>CW: stream ids for claimed work
        alt inbox work present
            CW->>IDW: stream_id via IInboxDrainChannel
            IDW->>IDW: fetch bodies, dispatch, commit<br/>(same path as normal flow)
        end
    end
```

## Architecture Components

### Database Tables

**`wh_service_instances`** - Active instance registry
- Tracks all service instances with heartbeat timestamps
- Used to determine active instance count for virtual partition distribution
- Stale instances (no heartbeat within the 30-second cutoff) are automatically removed

**`wh_outbox`** - Outbound message queue
- Messages awaiting publication to external transports
- Includes partition number, lease information, and processing status
- Done when published: the row is deleted (`complete_outbox_published`); in debug mode it is retained with `published_at`/`processed_at` stamped

**`wh_inbox`** - Inbound message queue
- Messages awaiting handler invocation
- Includes deduplication tracking via `wh_message_deduplication`
- Done when handler commit succeeds (`commit_handler_result`/`commit_handler_batch` stamps or deletes the row)

**`wh_active_streams`** - Stream ownership pinning
- One row per active stream; `assigned_instance_id` pins the stream to an instance (first-write-wins)
- Ownership reassigned only when the owning instance dies

**`wh_message_deduplication`** - Inbox deduplication
- Records inbox message IDs seen (purged past the retention window, default 30 days)
- Prevents duplicate processing of the same message
- Outbox does not use this table (transactional boundary responsibility)

### PostgreSQL Functions

:::updated
The legacy `process_work_batch` orchestrator was decomposed into focused work-pump functions and dropped (migration `029_ProcessWorkBatch.sql` removes it). Each concern now has its own function called by a dedicated C# worker.
:::

| Function | Called By | Purpose |
|---|---|---|
| `claim_work` | `ClaimWorker` | Claims orphaned/unowned work, returns claimed stream ids (bodies fetched separately) |
| `record_heartbeat` | `HeartbeatWorker` | UPSERTs `wh_service_instances`; opportunistically cleans up stale peers |
| `renew_leases` | `LeaseRenewalWorker` | Batched lease extension per category (outbox/inbox/perspective_event) |
| `store_outbox_messages` / `store_inbox_messages` | Coordinator strategies | Stores new messages with partition assignment (+ inbox dedup) |
| `fetch_outbox_batch` / `fetch_inbox_batch` | Drain workers | Pulls leased message bodies for one stream in FIFO order |
| `complete_outbox_published` | `OutboxCompletionFlushWorker` | Deletes (prod) or stamps (debug) published outbox rows |
| `commit_handler_result` / `commit_handler_batch` | `InboxHandlerWorker` | Commits handler results (batch path uses SAVEPOINT-per-handler isolation) |
| `complete_perspective` | `PerspectiveCompletionFlushWorker` | Deletes perspective event rows + advances cursors |
| `report_failures` | `FailureFlushWorker` | Batched failure reporting per category |
| `flush_completions` | Flush path | Composite single-round-trip flush across categories |
| `perform_maintenance` | `MaintenanceWorker` | Purges completed rows, old dedup entries, stale instances |

`claim_work` has an empty-call short-circuit: when all queues are empty, cheap indexed `EXISTS` probes return immediately (≤1 ms) without invoking any `claim_orphaned_*` function.

## Processing Flow

### Normal Operation

```mermaid{caption="Normal work-pump cycle — claim_work leases and returns stream ids, drain workers fetch bodies in stream-FIFO order and publish or invoke handlers, then flush workers complete the rows."}
sequenceDiagram
    participant CW as ClaimWorker
    participant DB as PostgreSQL
    participant DW as Drain Workers
    participant T as Transport
    participant FW as Flush Workers

    CW->>DB: claim_work()
    DB->>DB: Claim orphaned/unowned work
    DB->>DB: Apply modulo distribution + stream pinning
    DB->>DB: Order within streams
    DB-->>CW: Claimed stream ids (bodies NULL)
    CW->>DW: distribute via drain channels

    DW->>DB: fetch_outbox_batch / fetch_inbox_batch (per stream)
    DB-->>DW: leased bodies in stream-FIFO order
    DW->>T: Publish / invoke handlers
    T-->>DW: Ack

    DW->>FW: queue completions
    FW->>DB: complete_outbox_published / commit_handler_batch
    DB->>DB: Delete completed rows (prod)
```

Heartbeating runs on its own timer: `HeartbeatWorker` calls `record_heartbeat` every 30 seconds (60 seconds when the session advisory alive-lock provides the primary liveness signal), independent of the claim loop.

### Failure Recovery

```mermaid{caption="Lease-expiry failover — when Instance 1 crashes without renewing its lease, Instance 2's claim_work finds the expired-lease rows and reclaims them so no messages are lost."}
sequenceDiagram
    participant I1 as Instance 1
    participant DB as PostgreSQL
    participant I2 as Instance 2

    I1->>DB: claim_work()
    DB-->>I1: M1, M2 (lease_expiry = now + 5min)

    Note over I1: Instance 1 crashes<br/>(no heartbeat)

    Note over DB: Time passes...<br/>lease_expiry < now

    I2->>DB: claim_work()
    DB->>DB: Find orphaned work<br/>(lease_expiry < now)
    DB-->>I2: M1, M2 (reclaimed)

    Note over I2: ✅ Processing continues<br/>No messages lost
```

## Key Features

### Atomic Operations

Each focused function is atomic in its own transaction:
- `claim_work` — lease claims and work return
- `record_heartbeat` — heartbeat UPSERT plus opportunistic stale-peer cleanup
- `flush_completions` / per-category completion functions — batched completions with a single fsync per flush

Decomposing the legacy single mega-call keeps each operation cheap and contention-free while preserving per-operation consistency.

### Stale Instance Detection

Instances that stop heartbeating are automatically detected and cleaned up:
- **Stale Cutoff**: 30 seconds without a heartbeat (a 5-minute definitive-dead cutoff bypasses the alive-lock guard for half-open TCP cases)
- **Heartbeat Update**: `HeartbeatWorker` updates `last_heartbeat_at` on its own timer (30 s default)
- **Liveness Signals**: The heartbeat row is corroborated by the LISTEN connection (`wh_live_instances` view) and a session advisory alive-lock
- **Cleanup**: `record_heartbeat` opportunistically removes stale peers and releases their leases; `MaintenanceWorker` runs `cleanup_stale_instances` as a backstop

### Partition Stability

Partition ownership is stable across instance scaling:
- **Stream Pinning**: `wh_active_streams` pins each stream to the instance that first stored work for it
- **Active Instances**: Pinned streams are NOT reassigned from live instances
- **Modulo Distribution**: Unowned/orphaned work distributes by `partition_number % active_instance_count = instance_rank` as instances join/leave

### Idempotency

**Inbox**: Deduplication via `wh_message_deduplication` table (default 30-day retention)
- Duplicate messages are rejected via `ON CONFLICT DO NOTHING`
- Ensures exactly-once processing guarantee

**Outbox**: Transactional boundary responsibility
- No deduplication table (duplicate prevention is the caller's responsibility)
- Outbox is part of the application's transaction boundary

## Configuration Options

### Claim Loop Configuration

```csharp{title="Claim Loop Configuration" description="Claim Loop Configuration" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Lease", "Configuration"] unverified="configuration — ClaimWorkerOptions DI wiring, no behavioral assertion"}
services.Configure<ClaimWorkerOptions>(options => {
    options.PollingIntervalMilliseconds = 250;              // base cadence (default)
    options.PollingMaxIntervalMilliseconds = 10_000;        // adaptive backoff cap (default 10 s)
    options.NotifyHealthyPollingIntervalMilliseconds = 5_000; // relaxed cadence when NOTIFY healthy
    options.LeaseSeconds = 300;                             // 5 minutes (default)
    options.MaxStreamsPerBatch = 1000;                      // cap on rows per claim_work call
    options.PartitionCount = 10_000;                        // modulo partition count (default)
});
```

### Heartbeat Configuration

```csharp{title="Heartbeat Configuration" description="Heartbeat Configuration" category="Architecture" difficulty="BEGINNER" tags=["Messaging", "C#", "Partition", "Configuration"] unverified="configuration — HeartbeatWorkerOptions DI wiring, no behavioral assertion"}
services.Configure<HeartbeatWorkerOptions>(options => {
    options.IntervalSeconds = 30;      // heartbeat cadence (default)
    options.SlowIntervalSeconds = 60;  // when advisory alive-lock held (default)
});
```

### Testing Configuration

For fast tests, use short lease times and a tight safety-net poll:

```csharp{title="Testing Configuration" description="For fast tests, use short lease times and a tight safety-net poll:" category="Architecture" difficulty="BEGINNER" tags=["Messaging", "C#", "Testing", "Configuration"] unverified="configuration — test-tuning ClaimWorkerOptions overrides, no behavioral assertion"}
services.Configure<ClaimWorkerOptions>(options => {
    options.LeaseSeconds = 2;                                // fast orphan recovery in tests
    options.NotifyHealthyPollingIntervalMilliseconds = 500;  // tight safety-net cadence
});
```

## Performance Characteristics

### Focused, Cheap Calls

Each coordination concern is its own inexpensive call:
- `claim_work` returns stream ids only — bytes on the wire scale with active stream count, not payload size
- Empty-call short-circuit: an idle system pays ≤1 ms per poll (indexed `EXISTS` probes)
- Per-inner-function guards skip `claim_orphaned_*` scans for queues with nothing claimable

### Efficient Querying

The functions use optimized queries:
- Partial indexes on unprocessed rows for claiming
- Window functions for per-stream FIFO ordering
- Batched, coalesced flushes for completions/failures (single fsync per flush)

### Scalability

Horizontal scaling through partition distribution:
- Add instances → unowned work redistributes via the modulo formula
- Remove instances → their streams and leases release on stale-instance cleanup
- No manual coordination required

## Related Documentation

- [Multi-Instance Coordination](multi-instance-coordination.md) - Detailed scenarios and sequence diagrams
- [Idempotency Patterns](idempotency-patterns.md) - Deduplication strategies
- [Failure Handling](failure-handling.md) - Retry scheduling and failure cascades
- [Outbox Pattern](outbox-pattern.md) - Transactional outbox implementation
- [Inbox Pattern](inbox-pattern.md) - Deduplication and handler invocation

## Implementation

### C# Interface

The claim entry point on `IWorkCoordinator` (only `ClaimWorker` calls it):

```csharp{title="C# Interface" description="C# Interface" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "Interface"] unverified="interface declaration — IWorkCoordinator API surface, no behavioral assertion"}
public sealed record ClaimWorkRequest(
    Guid InstanceId,
    string ServiceName,
    string HostName,
    int ProcessId,
    int MaxStreams = 1000,
    int PartitionCount = 10000,
    int LeaseSeconds = 300);

public interface IWorkCoordinator {
    Task<WorkBatch> ClaimWorkAsync(
        ClaimWorkRequest request,
        CancellationToken cancellationToken = default
    );
    // ... focused companions: RecordHeartbeatAsync, RenewLeasesAsync,
    // CompleteOutboxPublishedAsync, CommitHandlerBatchAsync, ReportFailuresAsync, ...
}
```

For the full API surface, see [Work Coordinator](work-coordinator.md).

### PostgreSQL Implementation

See: `029_ProcessWorkBatch.sql` (hosts `claim_work`, `record_heartbeat`, `renew_leases`, `commit_handler_result`/`batch`, `complete_outbox_published`, `complete_perspective`, `report_failures`, `flush_completions`) plus the storage/claiming migrations it depends on (020-027, 040).

The PostgreSQL functions are the authoritative implementation of all coordination logic.

## Testing

Comprehensive integration tests validate all coordination scenarios:
- Instance lifecycle (heartbeat, stale cleanup)
- Partition stability (scaling, reassignment)
- Stream ordering (cross-instance, scheduled retry)
- Idempotency (inbox deduplication, outbox transactional)
- Failure recovery (lease expiry, orphaned work)

See: `Whizbang.Data.EFCore.Postgres.Tests/ClaimWorkSqlTests.cs`, `EFCoreClaimWorkTests.cs`, `EFCoreRecordHeartbeatTests.cs`, and the orphan-claiming SQL tests (`ClaimOrphaned*SqlTests.cs`)

## Best Practices

### Heartbeat Frequency

Heartbeating is automatic — `HeartbeatWorker` runs on its own timer:
- Default: every 30 seconds (60 seconds when the advisory alive-lock is held)
- Ensures instances are not marked as stale
- Enables quick work reassignment on failures

### Lease Duration

Choose lease duration based on maximum processing time:
- Too short: Messages become orphaned during normal processing (though `LeaseRenewalWorker` extends leases for in-flight work)
- Too long: Delayed recovery from instance failures
- Recommended: 5 minutes (the default; covers most processing scenarios)

### Partition Count

Higher partition counts enable finer-grained distribution:
- Default: 10,000 partitions (works well for most scenarios)
- More partitions = more even distribution across instances
- Purely algorithmic (`compute_partition`), so there is no per-partition state to track

## Troubleshooting

### Messages Not Being Claimed

**Check:**
- Instance is heartbeating (`HeartbeatWorker` running, `wh_service_instances.last_heartbeat_at` fresh)
- Stream ownership (`wh_active_streams.assigned_instance_id` — is the stream pinned to a live instance?)
- Stream ordering (is an earlier message blocking this message?)
- Lease status (is message already claimed by another instance?)

### Stale Instance Not Cleaned Up

**Check:**
- Last heartbeat timestamp (`wh_service_instances.last_heartbeat_at`)
- LISTEN connection liveness (`wh_live_instances` view) and advisory alive-lock — a live LISTEN connection keeps an instance "alive" past the 30-second heartbeat cutoff
- System time synchronization across instances

### Work Not Redistributing

**Check:**
- Instance is actually stale (heartbeat past the 30-second cutoff, no live LISTEN connection)
- Active instance count in `wh_service_instances` (algorithmic redistribution)
- Modulo distribution formula: `partition_number % active_instance_count = instance_rank`

### Out-of-Order Processing

**Check:**
- Stream ID is set correctly on all messages
- Temporal order (created_at/received_at timestamps)
- Cross-instance lease coordination (NOT EXISTS logic)
