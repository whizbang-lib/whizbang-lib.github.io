---
title: Custom Work Coordinators
pageType: guide
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Extensibility
order: 11
description: >-
  Implement custom work coordination strategies - distributed locks, Redis
  queues, or custom lease management
tags: 'work-coordination, iworkcoordinator, distributed-locks, redis-queues'
codeReferences:
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Core/Messaging/ClaimWorkRequest.cs
  - src/Whizbang.Core/Messaging/WorkCategory.cs
  - src/Whizbang.Core/Messaging/HeartbeatRequest.cs
  - src/Whizbang.Core/Messaging/HandlerCommitRequest.cs
  - src/Whizbang.Core/Messaging/FlushCompletionsRequest.cs
testReferences:
  - tests/Whizbang.Core.Tests/Messaging/WorkCoordinatorDefaultInterfaceTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreWorkCoordinatorDeepPathTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperWorkCoordinatorBroadTests.cs
lastMaintainedCommit: '01f07906'
---

# Custom Work Coordinators

**Custom work coordinators** enable alternative work distribution strategies beyond PostgreSQL-based leasing. Implement Redis-based queues, distributed locks, or custom lease management.

:::note
Whizbang uses PostgreSQL stored procedures for work coordination by default. Custom coordinators are for specialized scenarios.
:::

---

## Why Custom Work Coordinators?

| Strategy | Use Case | Benefits |
|----------|----------|----------|
| **PostgreSQL** (default) | Standard apps | ACID, atomic batches |
| **Redis** | High-throughput | In-memory, fast locks |
| **Distributed Locks** | Multi-region | Consensus-based |
| **Kafka** | Event streaming | Offset-based tracking |

**When to use custom coordinators**:
- ✅ Extreme throughput (> 100K msg/sec)
- ✅ Multi-region deployments
- ✅ Existing infrastructure
- ✅ Custom lease strategies

---

## IWorkCoordinator Interface

`IWorkCoordinator` is a large interface, but most members ship **default interface implementations**. Only six members are abstract (must be implemented); the rest either throw `NotImplementedException` until you opt in, or no-op safely for backends that don't need them.

```csharp{title="IWorkCoordinator Interface" description="IWorkCoordinator Interface (abridged)" category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Extensibility", "IWorkCoordinator", "Interface"]}
namespace Whizbang.Core.Messaging;

public interface IWorkCoordinator {
  // --- Abstract members (every implementation MUST provide these) ---

  // Graceful-shutdown deregistration: releases all leases, removes instance row
  Task DeregisterInstanceAsync(Guid instanceId, CancellationToken cancellationToken = default);

  // Expensive COUNT-based queue-depth statistics (called ~every 60 ticks)
  Task<WorkCoordinatorStatistics> GatherStatisticsAsync(CancellationToken cancellationToken = default);

  // Lightweight inbox insert with deduplication (transport consumer path)
  Task StoreInboxMessagesAsync(InboxMessage[] messages, int partitionCount,
    CancellationToken cancellationToken = default);

  // Out-of-band perspective cursor reporting
  Task ReportPerspectiveCompletionAsync(PerspectiveCursorCompletion completion,
    CancellationToken cancellationToken = default);
  Task ReportPerspectiveFailureAsync(PerspectiveCursorFailure failure,
    CancellationToken cancellationToken = default);
  Task<PerspectiveCursorInfo?> GetPerspectiveCursorAsync(Guid streamId, string perspectiveName,
    CancellationToken cancellationToken = default);

  // --- Core work-pump surface (defaults THROW until overridden) ---

  // The only method the polling ClaimWorker calls; returns claimed work / stream ids
  Task<WorkBatch> ClaimWorkAsync(ClaimWorkRequest request,
    CancellationToken cancellationToken = default);

  // Decoupled heartbeat (C# HeartbeatWorker, 5 s default cadence)
  Task RecordHeartbeatAsync(HeartbeatRequest request, CancellationToken cancellationToken = default);

  // Coalesced completion/failure flushers
  Task<int> CompleteOutboxPublishedAsync(IReadOnlyList<Guid> ids, bool debugMode,
    CancellationToken cancellationToken = default);
  Task CompletePerspectiveAsync(IReadOnlyList<PerspectiveCursorCompletion> cursors,
    IReadOnlyList<Guid> eventWorkIds, bool debugMode, CancellationToken cancellationToken = default);
  Task<int> RenewLeasesAsync(WorkCategory category, IReadOnlyList<Guid> ids,
    int leaseSeconds = 300, CancellationToken cancellationToken = default);
  Task ReportFailuresAsync(WorkCategory category, IReadOnlyList<MessageFailure> failures,
    CancellationToken cancellationToken = default);
  Task FlushCompletionsAsync(FlushCompletionsRequest request,
    CancellationToken cancellationToken = default);

  // SAVEPOINT-per-handler batched commit (inbox completion + emitted messages, atomically)
  Task CommitHandlerResultAsync(HandlerCommitRequest request,
    CancellationToken cancellationToken = default);
  Task<IReadOnlyList<HandlerBatchResult>> CommitHandlerBatchAsync(
    IReadOnlyList<HandlerCommitRequest> requests, CancellationToken cancellationToken = default);

  // --- Defaults that NO-OP safely (override when your backend supports them) ---
  // StoreOutboxMessagesAsync, FetchOutboxBatchAsync / FetchInboxBatchAsync (per-stream drain),
  // ClaimAndFetchPendingPerspectiveEventsAsync, FetchEventsByIdsAsync,
  // CleanupCompletedStreamsAsync, RecomputePartitionNumbersAsync,
  // lifecycle reconciliation, rewind scans, maintenance, stuck-row sentinels, ...
}
```

:::updated
`ProcessWorkBatchAsync(ProcessWorkBatchRequest, CancellationToken)` still exists on the interface but is **compatibility-only**: its default implementation returns an empty `WorkBatch`, and the legacy orchestrator SQL function `process_work_batch` has been dropped. Work coordination is now decomposed into `ClaimWorkAsync`, `StoreOutboxMessagesAsync` / `StoreInboxMessagesAsync`, the per-completion/per-failure flushers, and `CommitHandlerBatchAsync`.
:::

### Claim/drain split

`ClaimWorkAsync` returns *stream ids* (`WorkBatch.OutboxStreamIds`, `InboxStreamIds`, `PerspectiveStreamIds`) — a small payload. Dedicated drain workers then fetch message bodies per stream via `FetchOutboxBatchAsync` / `FetchInboxBatchAsync` in stream-FIFO order. A custom coordinator must preserve this contract: claiming leases work to an instance; draining returns only rows leased to that instance.

---

## Redis Work Coordinator

### Pattern 1: Redis Queue-Based Coordination

```csharp{title="Pattern 1: Redis Queue-Based Coordination" description="Pattern 1: Redis Queue-Based Coordination" category="Extensibility" difficulty="ADVANCED" tags=["Extending", "Extensibility", "Pattern", "Redis"] unverified="user extension example — Redis IWorkCoordinator implementation"}
using StackExchange.Redis;
using Whizbang.Core.Messaging;

public class RedisWorkCoordinator : IWorkCoordinator {
  private readonly IConnectionMultiplexer _redis;
  private readonly ILogger<RedisWorkCoordinator> _logger;

  public RedisWorkCoordinator(
    IConnectionMultiplexer redis,
    ILogger<RedisWorkCoordinator> logger
  ) {
    _redis = redis;
    _logger = logger;
  }

  // Claim work: pop stream ids from a Redis list and lease them to this instance
  public async Task<WorkBatch> ClaimWorkAsync(
    ClaimWorkRequest request,
    CancellationToken cancellationToken = default
  ) {
    var db = _redis.GetDatabase();
    var claimedStreams = new List<Guid>();

    for (int i = 0; i < request.MaxStreams; i++) {
      var streamId = await db.ListLeftPopAsync("outbox:pending-streams");
      if (streamId.IsNullOrEmpty) break;

      var id = Guid.Parse(streamId!);

      // Lease the stream to this instance (expires after LeaseSeconds)
      await db.StringSetAsync(
        $"lease:outbox:{id}",
        request.InstanceId.ToString(),
        TimeSpan.FromSeconds(request.LeaseSeconds)
      );
      claimedStreams.Add(id);
    }

    return new WorkBatch {
      OutboxWork = [],
      InboxWork = [],
      PerspectiveWork = [],
      OutboxStreamIds = claimedStreams  // drain worker fetches bodies per stream
    };
  }

  // Completion flush: delete published messages and release stream leases
  public async Task<int> CompleteOutboxPublishedAsync(
    IReadOnlyList<Guid> ids,
    bool debugMode,
    CancellationToken cancellationToken = default
  ) {
    var db = _redis.GetDatabase();
    var removed = 0;
    foreach (var id in ids) {
      if (await db.KeyDeleteAsync($"outbox:message:{id}")) {
        removed++;
      }
    }
    return removed;
  }

  // ... implement the remaining abstract members (DeregisterInstanceAsync,
  // GatherStatisticsAsync, StoreInboxMessagesAsync, perspective cursor reporting)
  // and override FetchOutboxBatchAsync / FetchInboxBatchAsync, RecordHeartbeatAsync,
  // RenewLeasesAsync, ReportFailuresAsync, CommitHandlerBatchAsync for a
  // fully functional coordinator.
}
```

---

## Further Reading

**Messaging**:
- [Work Coordination](../../messaging/work-coordination.md) - PostgreSQL work coordination

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
