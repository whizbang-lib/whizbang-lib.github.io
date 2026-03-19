---
title: Custom Work Coordinators
version: 1.0.0
category: Extensibility
order: 11
description: >-
  Implement custom work coordination strategies - distributed locks, Redis
  queues, or custom lease management
tags: 'work-coordination, iworkcoordinator, distributed-locks, redis-queues'
codeReferences:
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
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

```csharp
public interface IWorkCoordinator {
  Task<WorkBatch> ProcessWorkBatchAsync(
    Guid instanceId,
    string serviceName,
    // ... parameters
    CancellationToken ct = default
  );
}
```

---

## Redis Work Coordinator

### Pattern 1: Redis Queue-Based Coordination

```csharp
using StackExchange.Redis;

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

  public async Task<WorkBatch> ProcessWorkBatchAsync(
    Guid instanceId,
    string serviceName,
    string hostName,
    int processId,
    Dictionary<string, JsonElement>? metadata,
    MessageCompletion[] outboxCompletions,
    MessageFailure[] outboxFailures,
    // ... other parameters
    CancellationToken ct = default
  ) {
    var db = _redis.GetDatabase();

    // 1. Process completions (remove from Redis)
    foreach (var completion in outboxCompletions) {
      await db.ListRemoveAsync(
        "outbox:pending",
        JsonSerializer.Serialize(completion.MessageId),
        ct
      );
    }

    // 2. Process failures (update retry count)
    foreach (var failure in outboxFailures) {
      // Increment retry count, re-queue if needed
      // ...
    }

    // 3. Claim new work (atomic LPOP)
    var claimedWork = new List<OutboxMessage>();
    for (int i = 0; i < 100; i++) {
      var workItem = await db.ListLeftPopAsync("outbox:pending", ct);
      if (workItem.IsNullOrEmpty) break;

      var message = JsonSerializer.Deserialize<OutboxMessage>(workItem!);
      claimedWork.Add(message!);
    }

    return new WorkBatch {
      ClaimedOutboxMessages = claimedWork.ToArray()
    };
  }
}
```

---

## Further Reading

**Messaging**:
- [Work Coordination](../messaging/work-coordination.md) - PostgreSQL work coordination

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
