---
title: Work Coordinator
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Messaging
order: 3
description: >-
  Master the Work Coordinator - focused claim, store, commit, and completion
  operations for Outbox, Inbox, and perspective tracking with lease-based
  coordination
tags: >-
  work-coordinator, atomic-operations, batch-processing,
  distributed-coordination, lease-management, claim-work
codeReferences:
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Core/Messaging/ClaimWorkRequest.cs
  - src/Whizbang.Core/Messaging/HeartbeatRequest.cs
  - src/Whizbang.Core/Messaging/HandlerCommitRequest.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreWorkCoordinator.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperWorkCoordinator.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreClaimWorkTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreCommitHandlerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreRecordHeartbeatTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/CompleteOutboxPublishedSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/CommitHandlerBatchSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/FlushCompletionsSqlTests.cs
lastMaintainedCommit: '01f07906'
---

# Work Coordinator

The **Work Coordinator** (`IWorkCoordinator`) is Whizbang's database coordination surface. It exposes a set of **focused, single-purpose operations** — claiming, storing, completing, failing, lease renewal, heartbeating — each backed by its own PostgreSQL function and called by a dedicated background worker.

> **This page is the API reference.** For conceptual architecture (lease-based coordination, virtual partition distribution, stream ordering guarantees), see [Work Coordination](work-coordination.md).

:::updated
The legacy `ProcessWorkBatchAsync` mega-call was decomposed into the focused methods below; the `process_work_batch` SQL orchestrator was dropped (migration `029_ProcessWorkBatch.sql`). `ProcessWorkBatchAsync` remains on the interface as a compatibility shim that returns an empty `WorkBatch`.
:::

## Overview

The Work Coordinator solves a critical problem: **How do you reliably coordinate distributed message processing** (claim work exclusively, commit handler results atomically, recover from crashes) across service instances?

### What It Coordinates

```mermaid{caption="The Work Coordinator's focused operations — claim, store, fetch, commit, complete, fail, renew, heartbeat — each atomic in its own call, with the handler-commit path bundling inbox completion and emitted messages."}
flowchart TD
    subgraph Ops["Focused Coordinator Operations (each atomic in its own call)"]
        Claim["ClaimWorkAsync — lease orphaned/unowned work, return stream ids"]
        Store["StoreOutboxMessagesAsync / StoreInboxMessagesAsync — persist new messages"]
        Fetch["FetchOutboxBatchAsync / FetchInboxBatchAsync — pull leased bodies per stream"]
        Commit["CommitHandlerBatchAsync — inbox completion + emitted messages, SAVEPOINT per handler"]
        Complete["CompleteOutboxPublishedAsync / CompletePerspectiveAsync — batched completions"]
        Fail["ReportFailuresAsync — batched failure reporting per category"]
        Lease["RenewLeasesAsync — extend leases for in-flight work"]
        Heart["RecordHeartbeatAsync / DeregisterInstanceAsync — instance lifecycle"]
    end

    class Claim layer-event
```

**Key Insight**: Each operation is atomic on its own, and the handler-commit path bundles an inbox completion **plus** any messages the handler emitted into one transaction — the critical succeed-together/fail-together boundary.

---

## IWorkCoordinator Interface

The core methods (each has a corresponding SQL function and a dedicated calling worker):

```csharp{title="IWorkCoordinator Interface" description="IWorkCoordinator Interface" category="Architecture" difficulty="ADVANCED" tags=["Messaging", "C#", "IWorkCoordinator", "Interface"]}
public interface IWorkCoordinator {
    // Claim loop (called only by ClaimWorker)
    Task<WorkBatch> ClaimWorkAsync(
        ClaimWorkRequest request, CancellationToken cancellationToken = default);

    // Instance lifecycle
    Task RecordHeartbeatAsync(
        HeartbeatRequest request, CancellationToken cancellationToken = default);
    Task DeregisterInstanceAsync(
        Guid instanceId, CancellationToken cancellationToken = default);

    // Message storage
    Task StoreOutboxMessagesAsync(
        OutboxMessage[] messages, int partitionCount,
        CancellationToken cancellationToken = default);
    Task StoreInboxMessagesAsync(
        InboxMessage[] messages, int partitionCount,
        CancellationToken cancellationToken = default);

    // Per-stream body fetch (called by drain workers)
    Task<IReadOnlyList<OutboxBatchRow>> FetchOutboxBatchAsync(
        IReadOnlyList<Guid> streamIds, Guid instanceId,
        int maxPerStream = 100, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<InboxBatchRow>> FetchInboxBatchAsync(
        IReadOnlyList<Guid> streamIds, Guid instanceId,
        int maxPerStream = 100, CancellationToken cancellationToken = default);

    // Handler commit (inbox completion + emitted messages, atomic)
    Task CommitHandlerResultAsync(
        HandlerCommitRequest request, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<HandlerBatchResult>> CommitHandlerBatchAsync(
        IReadOnlyList<HandlerCommitRequest> requests, CancellationToken cancellationToken = default);

    // Batched completions / failures / lease renewal
    Task<int> CompleteOutboxPublishedAsync(
        IReadOnlyList<Guid> ids, CancellationToken cancellationToken = default);
    Task CompletePerspectiveAsync(
        IReadOnlyList<PerspectiveCursorCompletion> cursors,
        IReadOnlyList<Guid> eventWorkIds, CancellationToken cancellationToken = default);
    Task ReportFailuresAsync(
        WorkCategory category, IReadOnlyList<MessageFailure> failures,
        CancellationToken cancellationToken = default);
    Task<int> RenewLeasesAsync(
        WorkCategory category, IReadOnlyList<Guid> ids,
        int leaseSeconds = 300, CancellationToken cancellationToken = default);

    // Scheduled retries + observability
    Task<int> NotifyScheduledRetryDueAsync(CancellationToken cancellationToken = default);
    Task<WorkCoordinatorStatistics> GatherStatisticsAsync(CancellationToken cancellationToken = default);
}
```

**Claim Parameter Object**:
```csharp{title="ClaimWorkRequest" description="Parameter object for ClaimWorkAsync" category="Architecture" difficulty="ADVANCED" tags=["Messaging", "IWorkCoordinator", "Request"] tests=["ClaimWorkRequestTests.PositionalCtor_RequiredFieldsRoundTripAsync", "ClaimWorkRequestTests.Defaults_MatchProductionTunedConstantsAsync"]}
public sealed record ClaimWorkRequest(
    Guid InstanceId,        // Calling service instance
    string ServiceName,     // Service name (diagnostics)
    string HostName,        // Pod / host name (diagnostics)
    int ProcessId,          // OS process id (diagnostics)
    int MaxStreams = 1000,      // Cap on rows returned per call
    int PartitionCount = 10000, // Modulo partition count
    int LeaseSeconds = 300);    // Lease duration for claimed work

public sealed record HeartbeatRequest(
    Guid InstanceId,
    string ServiceName,
    string HostName,
    int ProcessId,
    JsonElement? Metadata = null);
```

---

## Core Concepts

### Atomic Handler Commit

**Pattern**: A handler's inbox completion and everything it emitted commit **together or not at all**.

```csharp{title="Atomic Handler Commit" description="Pattern: A handler's inbox completion and its emitted messages commit atomically." category="Architecture" difficulty="ADVANCED" tags=["Messaging", "C#", "Atomic", "Batch", "Processing"]}
// InboxHandlerWorker batches handler results and commits them in one round-trip
var results = await _coordinator.CommitHandlerBatchAsync(
    [
        new HandlerCommitRequest(
            HandlerId: handlerId,
            InstanceId: instanceId,
            ServiceName: "OrderService",
            HostName: Environment.MachineName,
            ProcessId: Environment.ProcessId,
            PartitionCount: 10_000,
            InboxCompletion: new HandlerInboxCompletion(inboxMessageId, status),
            NewOutboxMessages: emittedOutboxMessages,  // events the handler produced
            NewInboxMessages: null
        )
    ],
    cancellationToken
);

// One row per request: per-handler success/failure via SAVEPOINT isolation
foreach (var result in results) {
    if (!result.Success) { /* result.ErrorMessage */ }
}
```

**Result**:
1. Inbox message marked complete AND emitted events stored in outbox — one transaction
2. N handler results commit in one round-trip with a single fsync
3. A failing handler rolls back **only its own** SAVEPOINT; sibling handlers are unaffected

### Lease-Based Coordination

**Problem**: How do multiple workers process messages without conflicts?

**Solution**: **Leasing** - workers "claim" messages for a time period.

```sql{title="Lease-Based Coordination" description="Solution: Leasing - workers 'claim' messages for a time period." category="Architecture" difficulty="BEGINNER" tags=["Messaging", "Lease-Based", "Coordination"]}
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

**Solution**: **Consistent hashing** via `partition_number` (computed database-side by `compute_partition`).

```sql{title="Partition-Based Distribution" description="Solution: Consistent hashing via partition_number." category="Architecture" difficulty="BEGINNER" tags=["Messaging", "Partition-Based", "Distribution"]}
-- Each message gets a partition number (0-9999) from its stream_id
partition_number := abs(hashtext(stream_id::TEXT)) % partition_count;

-- Unowned work is claimable by the instance whose rank matches:
--   partition_number % active_instance_count = instance_rank
```

**Benefits**:
- ✅ **Even distribution**: Hash function spreads streams evenly
- ✅ **Deterministic**: Same stream always maps to same partition
- ✅ **Scalable**: Add more workers, unowned partitions redistribute via the modulo formula

---

## Supporting Types

### Work Batch (Claim Result)

```csharp{title="WorkBatch" description="Result of ClaimWorkAsync" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "WorkBatch"]}
public record WorkBatch {
    public required List<OutboxWork> OutboxWork { get; init; }
    public required List<InboxWork> InboxWork { get; init; }
    public required List<PerspectiveWork> PerspectiveWork { get; init; }

    // Per-stream-drain projections: claim_work returns stream ids only;
    // drain workers fetch bodies via FetchOutboxBatchAsync / FetchInboxBatchAsync
    public List<Guid> OutboxStreamIds { get; init; } = [];
    public List<Guid> InboxStreamIds { get; init; } = [];
    public List<Guid> PerspectiveStreamIds { get; init; } = [];
}
```

### Completions and Failures

```csharp{title="Completions and Failures" description="Completion and failure records" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Message", "Completions"] tests=["MessageFailureTests.MessageFailure_WithoutReason_DefaultsToUnknownAsync", "MessageFailureTests.MessageFailure_WithReason_StoresReasonAsync"]}
public record MessageCompletion {
    public required Guid MessageId { get; init; }
    public required MessageProcessingStatus Status { get; init; }
}

public record MessageFailure {
    public required Guid MessageId { get; init; }
    public required MessageProcessingStatus CompletedStatus { get; init; }
    public required string Error { get; init; }
    public MessageFailureReason Reason { get; init; } = MessageFailureReason.Unknown;
}

[Flags]
public enum MessageProcessingStatus {
    None = 0,
    Stored = 1 << 0,        // Row persisted
    EventStored = 1 << 1,   // Event appended to event store
    Published = 1 << 2,     // Transport publish succeeded
    // Bits 3-14 reserved for future pipeline stages
    Failed = 1 << 15
}

public enum WorkCategory { Outbox, Inbox, PerspectiveEvent }
```

**Usage**: `ReportFailuresAsync` increments retry counters and stamps `error`/`failure_reason`; completion methods delete rows (production) or stamp them (debug mode).

### Perspective Cursor Completion

```csharp{title="Perspective Cursor Completion" description="Cursor advancement spec for CompletePerspectiveAsync" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Event", "Store", "Tracking"]}
public record PerspectiveCursorCompletion {
    public required Guid StreamId { get; init; }
    public required string PerspectiveName { get; init; }
    public required Guid LastEventId { get; init; }
    public required PerspectiveProcessingStatus Status { get; init; }
}
```

**Purpose**: Track **cursors** for perspectives processing event streams (one cursor per stream/perspective pair, stored in `wh_perspective_cursors`).

**Key Difference from Receptors**:
- **Receptors**: Many receptors can process the same event independently (tracked in `wh_receptor_processing`)
- **Perspectives**: One cursor per (stream_id, perspective_name) pair for ordered processing

### New Messages

```csharp{title="New Messages" description="Envelope-based message records for the store methods" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "New", "Messages"]}
public record OutboxMessage {
    public required Guid MessageId { get; init; }
    public string? Destination { get; init; }
    public required IMessageEnvelope<JsonElement> Envelope { get; init; }
    public required EnvelopeMetadata Metadata { get; init; }
    public required string EnvelopeType { get; init; }
    public Guid? StreamId { get; init; }
    public bool IsEvent { get; init; }
    public EventFlags Flags { get; init; }
    public PerspectiveScope? Scope { get; init; }
}

public record InboxMessage {
    public required Guid MessageId { get; init; }
    public required string HandlerName { get; init; }
    public required IMessageEnvelope<JsonElement> Envelope { get; init; }
    public required string EnvelopeType { get; init; }
    public required string MessageType { get; init; }
    public Guid? StreamId { get; init; }
    public bool IsEvent { get; init; }
    public EventFlags Flags { get; init; }
    public PerspectiveScope? Scope { get; init; }
    public EnvelopeMetadata? Metadata { get; init; }
    public Guid SourceServiceId { get; init; }
    public long SourceCommitSequence { get; init; }
}
```

**Usage**: Store new events in outbox (for publishing) or inbox (for deduplication + handler invocation). Correlation/causation and hop history travel inside the envelope's `EnvelopeMetadata`, not as top-level fields.

---

## Common Usage Patterns

These patterns show how the framework's built-in workers use the coordinator. Application code rarely calls `IWorkCoordinator` directly — the workers below are registered automatically.

### Pattern 1: Claim Work (ClaimWorker)

```csharp{title="Pattern 1: Claim Work" description="ClaimWorker polls claim_work and distributes stream ids to drain channels" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Pattern", "Claim", "Publish"] tests=["ClaimWorkerTests.ExecuteAsync_PollsAtLeastOnceAsync", "ClaimWorkerTests.Distribute_OutboxStreamIds_RoutedToOutboxDrainChannelAsync", "ClaimWorkerTests.Distribute_InboxDrainChannel_WritesStreamIds_EvenWhenIsInFlightTrueAsync"]}
// ClaimWorker is the only caller of ClaimWorkAsync
var batch = await coordinator.ClaimWorkAsync(new ClaimWorkRequest(
    InstanceId: instanceId,
    ServiceName: "OrderService",
    HostName: Environment.MachineName,
    ProcessId: Environment.ProcessId,
    MaxStreams: 1000,
    PartitionCount: 10_000,
    LeaseSeconds: 300
), ct);

// Bodies are NOT in the batch — distribute stream ids to the drain channels
foreach (var streamId in batch.OutboxStreamIds) {
    await outboxDrainChannel.WriteAsync(streamId, ct);
}
foreach (var streamId in batch.InboxStreamIds) {
    await inboxDrainChannel.WriteAsync(streamId, ct);
}
```

### Pattern 2: Drain and Publish (OutboxDrainWorker)

```csharp{title="Pattern 2: Drain and Publish" description="OutboxDrainWorker fetches leased bodies per stream and publishes in FIFO order" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Pattern", "Report", "Completions"] tests=["OutboxDrainWorkerTests.OutboxDrainWorker_OnStreamId_FetchesBatch_PublishesEach_EnqueuesCompletionAsync", "OutboxDrainWorkerTests.OutboxDrainWorker_BulkResultsMixed_RoutesSuccessToCompletion_FailureToFailureChannelAsync"]}
// Per-stream drainer: fetch all leased rows for the stream, publish in order
var rows = await coordinator.FetchOutboxBatchAsync([streamId], instanceId, cancellationToken: ct);

foreach (var row in rows) {
    try {
        await publishStrategy.PublishAsync(row, ct);
        outboxCompletionChannel.Enqueue(row.MessageId);       // → CompleteOutboxPublishedAsync (batched)
    } catch (Exception ex) {
        failureChannel.Enqueue(WorkCategory.Outbox, new MessageFailure {
            MessageId = row.MessageId,
            CompletedStatus = MessageProcessingStatus.Stored,
            Error = ex.Message
        });                                                    // → ReportFailuresAsync (batched)
    }
}
```

### Pattern 3: Batched Completions (Flush Workers)

```csharp{title="Pattern 3: Batched Completions" description="Flush workers coalesce completions into one round-trip per batch" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Pattern", "Store", "Event"] tests=["OutboxCompletionFlushWorkerTests.EnqueuedIds_FlushedToCoordinatorAsync"]}
// OutboxCompletionFlushWorker drains the completion channel and flushes in batches
var publishedIds = DrainPendingCompletionIds();
var affected = await coordinator.CompleteOutboxPublishedAsync(publishedIds, ct);
// Production: rows DELETEd. Debug mode: rows retained with published_at stamped.

// FailureFlushWorker does the same for failures, per category
await coordinator.ReportFailuresAsync(WorkCategory.Outbox, pendingFailures, ct);
```

### Pattern 4: Lease Renewal (LeaseRenewalWorker)

```csharp{title="Pattern 4: Lease Renewal" description="LeaseRenewalWorker extends leases for in-flight work approaching expiry" category="Architecture" difficulty="BEGINNER" tags=["Messaging", "C#", "Pattern", "Store", "Inbox"]}
// When in-flight items approach lease/3 from expiry, renew in batch per category
var renewed = await coordinator.RenewLeasesAsync(
    WorkCategory.Inbox,
    inFlightMessageIds,
    leaseSeconds: 300,
    ct);

// A per-item renewal cap prevents stuck work from renewing forever —
// once the cap is hit, the lease expires and claim_orphaned_* re-issues the work
```

---

## PostgreSQL Implementation

Each coordinator method maps to a focused **PostgreSQL function** (hosted primarily in migration `029_ProcessWorkBatch.sql`, which also drops the legacy `process_work_batch` orchestrator).

### Function Map

| C# Method | SQL Function | Calling Worker |
|---|---|---|
| `ClaimWorkAsync` | `claim_work` | `ClaimWorker` |
| `RecordHeartbeatAsync` | `record_heartbeat` | `HeartbeatWorker` |
| `DeregisterInstanceAsync` | `deregister_instance` | `WhizbangShutdownService` |
| `StoreOutboxMessagesAsync` / `StoreInboxMessagesAsync` | `store_outbox_messages` / `store_inbox_messages` | Coordinator strategies |
| `FetchOutboxBatchAsync` / `FetchInboxBatchAsync` | `fetch_outbox_batch` / `fetch_inbox_batch` | Drain workers |
| `CommitHandlerResultAsync` / `CommitHandlerBatchAsync` | `commit_handler_result` / `commit_handler_batch` | `InboxHandlerWorker` |
| `CompleteOutboxPublishedAsync` | `complete_outbox_published` | `OutboxCompletionFlushWorker` |
| `CompletePerspectiveAsync` | `complete_perspective` | `PerspectiveCompletionFlushWorker` |
| `ReportFailuresAsync` | `report_failures` | `FailureFlushWorker` |
| `RenewLeasesAsync` | `renew_leases` | `LeaseRenewalWorker` |
| `NotifyScheduledRetryDueAsync` | `notify_scheduled_retry_due` | Backup tick (`DefaultBackupTickRegistrar` / `BackupTickCoordinator`) |

### Claim Function Signature

```sql{title="Function: claim_work" description="The claim_work SQL function signature" category="Architecture" difficulty="ADVANCED" tags=["Messaging", "Stored", "Procedure:", "Claim_work"]}
CREATE OR REPLACE FUNCTION claim_work(
    p_instance_id UUID,
    p_service_name TEXT,
    p_host_name TEXT,
    p_process_id INTEGER,
    p_max_streams INTEGER DEFAULT 1000,
    p_partition_count INTEGER DEFAULT 10000,
    p_lease_seconds INTEGER DEFAULT 300
) RETURNS TABLE(
    source VARCHAR(20),           -- 'outbox' | 'inbox' | 'receptor' | 'perspective'
    work_id UUID,
    work_stream_id UUID,
    partition_number INTEGER,
    destination VARCHAR(200),
    message_type VARCHAR(500),
    envelope_type VARCHAR(500),
    message_data TEXT,            -- NULL: bodies fetched per stream by drain workers
    metadata JSONB,
    status INTEGER,
    attempts INTEGER,
    is_newly_stored BOOLEAN,
    is_orphaned BOOLEAN,
    perspective_name VARCHAR(200)
)
```

**Benefits**:
- ✅ **Empty-call short-circuit**: idle polls cost ≤1 ms (indexed `EXISTS` probes; `claim_orphaned_*` never invoked)
- ✅ **Stream-ids-only projection**: bytes on the wire scale with active stream count, not payload size
- ✅ **Atomic per call**: each function is transactional; the handler-commit path bundles completion + emitted messages

---

## Best Practices

### DO ✅

- ✅ **Let the built-in workers drive the coordinator**: They batch, coalesce, and flush correctly
- ✅ **Report completions promptly**: Don't let leases expire (the flush workers coalesce automatically)
- ✅ **Monitor stale leases**: Alert when lease_expiry is old
- ✅ **Use consistent hashing**: Partition-based work distribution
- ✅ **Log all operations**: InstanceId, ServiceName, timestamps
- ✅ **Handle failures gracefully**: `ReportFailuresAsync` increments retry counts and records errors
- ✅ **Rely on `perform_maintenance`**: Purges completed rows and old dedup entries on schedule
- ✅ **Configure lease duration**: Balance fault tolerance vs recovery time

### DON'T ❌

- ❌ Skip reporting completions (leads to duplicate work)
- ❌ Ignore failures (silent data loss)
- ❌ Use locks instead of leases (doesn't scale)
- ❌ Set lease duration too short (thrashing)
- ❌ Set lease duration too long (slow recovery from crashes)
- ❌ Commit handler results outside `CommitHandlerResultAsync`/`CommitHandlerBatchAsync` (breaks the completion+emission atomicity boundary)
- ❌ Skip monitoring (blind to failures)

---

## Monitoring & Observability

### Key Metrics

The coordinator exposes queue-depth statistics via `GatherStatisticsAsync`:

```csharp{title="Key Metrics" description="Key Metrics" category="Architecture" difficulty="INTERMEDIATE" tags=["Messaging", "C#", "Key", "Metrics"]}
public record WorkCoordinatorStatistics {
    public long PendingPerspectiveEvents { get; init; }  // wh_perspective_events unprocessed
    public long PendingOutbox { get; init; }             // wh_outbox unprocessed
    public long PendingInbox { get; init; }              // wh_inbox unprocessed
    public long ActiveStreams { get; init; }             // wh_active_streams rows
}
```

### Alerts

**Critical**:
- 🚨 Rows with expired `lease_expiry` and no reclaim (workers crashed or stuck)
- 🚨 Rows with `failure_reason = MaxAttemptsExceeded` / dead-letter growth (messages gave up)

**Warning**:
- ⚠️ `PendingOutbox` or `PendingInbox` growing steadily (backlog)
- ⚠️ `ActiveStreams` growing unexpectedly (streams not being cleaned up)

---

## Further Reading

**Architecture**:
- [Message Lifecycle & Architecture](../extending/internals/message-lifecycle.md) - **Complete flow with sequence diagrams** showing Commands, Events, Receptors, Perspectives, and all integration points

**Core Concepts**:
- [Dispatcher](../fundamentals/dispatcher/dispatcher.md) - Message routing
- [Receptors](../fundamentals/receptors/receptors.md) - Message handlers and business logic
- [Perspectives](../fundamentals/perspectives/perspectives.md) - Event listeners for read models

**Messaging Patterns**:
- [Outbox Pattern](outbox-pattern.md) - Reliable event publishing
- [Inbox Pattern](inbox-pattern.md) - Exactly-once processing
- [Message Envelopes](message-envelopes.md) - Hop-based observability

**Data Access**:
- [Event Store](../data/event-store.md) - Event storage and replay

**Workers**:
- [Perspective Worker](../operations/workers/perspective-worker.md) - Uses work coordinator for checkpoint-based processing
- [Execution Lifecycle](../operations/workers/execution-lifecycle.md) - Startup/shutdown coordination
- [Database Readiness](../operations/workers/database-readiness.md) - Dependency coordination

---

*Version 1.0.0 - Foundation Release | Last Updated: 2025-12-21*
