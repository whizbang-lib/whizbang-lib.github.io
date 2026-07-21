---
title: Work Coordinator Strategies
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Data Access
order: 8
description: >-
  Strategy pattern for controlling message flush behavior from in-memory queues
  to the database. Covers Immediate, Scoped, Interval, and Batch strategies
  with trade-offs between latency, throughput, and database load.
tags: 'work-coordinator, flush-strategy, batch, scoped, interval, process-work-batch'
codeReferences:
  - src/Whizbang.Core/Messaging/IWorkCoordinatorStrategy.cs
  - src/Whizbang.Core/Messaging/BatchWorkCoordinatorStrategy.cs
  - src/Whizbang.Core/Messaging/WorkCoordinatorStrategyFactory.cs
  - src/Whizbang.Core/Messaging/IWorkFlusher.cs
  - src/Whizbang.Hosting.AspNet/WhizbangFlushMiddleware.cs
  - src/Whizbang.Core/Messaging/WorkCoordinatorFlushHelper.cs
testReferences:
  - tests/Whizbang.Core.Tests/Messaging/FlushApiTests.cs
  - tests/Whizbang.Core.Tests/Messaging/BatchWorkCoordinatorStrategyTests.cs
  - tests/Whizbang.Core.Tests/Messaging/WorkCoordinatorStrategyRegistrationTests.cs
  - tests/Whizbang.Core.Tests/Messaging/WorkFlusherTests.cs
  - tests/Whizbang.Hosting.AspNet.Tests/WhizbangFlushMiddlewareTests.cs
lastMaintainedCommit: '01f07906'
---

# Work Coordinator Strategies

The work coordinator uses a **strategy pattern** to control when and how messages are flushed from in-memory queues to the database via the `store_outbox_messages` / `store_inbox_messages` SQL functions. Each strategy makes different trade-offs between latency, throughput, and database load.

:::updated{version="1.0.0"}
Earlier pre-v1.0 builds flushed through a single `process_work_batch` orchestrator function. That function has been dropped: flushes now insert rows via `store_outbox_messages` / `store_inbox_messages`, completions and failures flow through dedicated channel flushers, and work claiming is owned exclusively by the `ClaimWorker` via the `claim_work` SQL function.
:::

## Strategy Overview

| Strategy | Flush Trigger | Lifetime | Best For |
|----------|--------------|----------|----------|
| **Immediate** | Every `FlushAsync` call | Scoped | Real-time scenarios, low-throughput services |
| **Scoped** (default) | Scope disposal / explicit flush | Scoped | Web APIs, message handlers |
| **Interval** | Periodic timer | Singleton | Background workers, steady throughput |
| **Batch** | Batch size reached OR debounce quiet period | Singleton | Bulk imports, seeding, high-volume processing |

## Configuration

All strategies are configured via `WorkCoordinatorOptions`:

```csharp{title="Configuration" description="All strategies are configured via WorkCoordinatorOptions:" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "Configuration"] unverified="configuration surface — per-option behavior is covered by the strategy-selection examples below"}
services.Configure<WorkCoordinatorOptions>(options => {
  options.Strategy = WorkCoordinatorStrategy.Batch;
  options.BatchSize = 100;               // Batch: flush at this count
  options.IntervalMilliseconds = 200;    // Interval: timer period; Batch: debounce window
  options.CoalesceWindowMilliseconds = 50; // Optional: delay Required flushes to pick up nearby items
  options.DebugMode = false;
  options.PartitionCount = 10_000;
  options.LeaseSeconds = 300;
  options.AbandonStaleInstanceThresholdSeconds = 30;
});
```

### `WorkCoordinatorOptions` Properties

| Property | Type | Default | Used By | Description |
|----------|------|---------|---------|-------------|
| `Strategy` | `WorkCoordinatorStrategy` | `Scoped` | All | Which strategy to use |
| `IntervalMilliseconds` | `int` | `100` | Interval, Batch | Timer period (Interval) or debounce window (Batch) |
| `BatchSize` | `int` | `100` | Batch | Message count threshold for immediate flush |
| `CoalesceWindowMilliseconds` | `int` | `0` | Interval, Batch | Delay before Required flush to coalesce nearby items |
| `PartitionCount` | `int` | `10,000` | All | Total partition count for stream distribution |
| `ParallelizeStreams` | `bool` | `false` | All | Process different streams in parallel within an instance |
| `DebugMode` | `bool` | `false` | All | Keep completed messages for debugging |
| `LeaseSeconds` | `int` | `300` | All | Message lease duration |
| `AbandonStaleInstanceThresholdSeconds` | `int` | `30` | All | Grace period before a non-heartbeating instance is abandoned and its leases released |

## Strategies in Detail

### Immediate

Flushes on every `FlushAsync` call. No batching, no timers.

```csharp{title="Immediate" description="Flushes on every FlushAsync call." category="Implementation" difficulty="BEGINNER" tags=["Data", "Immediate"] tests=["WorkCoordinatorStrategyRegistrationTests.CreateStrategy_WithImmediateOption_ReturnsImmediateStrategyAsync"]}
services.Configure<WorkCoordinatorOptions>(o => {
  o.Strategy = WorkCoordinatorStrategy.Immediate;
});
```

- **Latency**: Lowest (immediate database write)
- **Database load**: Highest (one call per operation)
- **Use when**: You need real-time delivery and throughput is low

### Scoped (Default)

Batches operations within a DI scope (e.g., HTTP request). Flushes on explicit `FlushAsync` or scope disposal.

```csharp{title="Scoped (Default)" description="Batches operations within a DI scope (e." category="Implementation" difficulty="BEGINNER" tags=["Data", "C#", "Scoped", "Default"] tests=["WorkCoordinatorStrategyRegistrationTests.CreateStrategy_DefaultOptions_ReturnsScopedStrategyAsync"]}
// Default - no configuration needed
services.Configure<WorkCoordinatorOptions>(o => {
  o.Strategy = WorkCoordinatorStrategy.Scoped;
});
```

- **Latency**: Low (flushes at end of request/handler)
- **Database load**: Moderate (one call per scope)
- **Use when**: Web APIs, message handlers, transactional operations

### Interval

Batches operations and flushes on a periodic timer. Registered as a singleton (timer persists across scopes).

```csharp{title="Interval" description="Batches operations and flushes on a periodic timer." category="Implementation" difficulty="BEGINNER" tags=["Data", "Interval"] tests=["WorkCoordinatorStrategyRegistrationTests.CreateStrategy_WithIntervalOption_ReturnsIntervalStrategyAsync", "WorkCoordinatorStrategyRegistrationTests.GeneratorPattern_Interval_ResolvesSingletonAsync"]}
services.Configure<WorkCoordinatorOptions>(o => {
  o.Strategy = WorkCoordinatorStrategy.Interval;
  o.IntervalMilliseconds = 100; // Flush every 100ms
});
```

- **Latency**: Higher (up to `IntervalMilliseconds` delay)
- **Database load**: Lowest (predictable, periodic flushes)
- **Use when**: Background workers with steady message throughput

### Batch

Combines **count-based** and **debounce-based** triggers. Flushes when either threshold is hit first:

1. **Batch size reached**: When total queued messages (outbox + inbox) reaches `BatchSize`, flush fires immediately.
2. **Debounce timer expires**: When no new messages arrive for `IntervalMilliseconds`, flush fires for the partial batch.

```csharp{title="Batch" description="Batch" category="Implementation" difficulty="BEGINNER" tags=["Data", "Batch"] tests=["WorkCoordinatorStrategyRegistrationTests.CreateStrategy_WithBatchOption_ReturnsBatchStrategyAsync", "BatchWorkCoordinatorStrategyTests.BatchSize_TakesPriorityOverDebounceAsync", "BatchWorkCoordinatorStrategyTests.DebounceTimer_FlushesAfterQuietPeriodAsync"]}
services.Configure<WorkCoordinatorOptions>(o => {
  o.Strategy = WorkCoordinatorStrategy.Batch;
  o.BatchSize = 100;             // Flush at 100 messages
  o.IntervalMilliseconds = 200;  // Or after 200ms of quiet
});
```

- **Latency**: Adaptive (immediate at high volume, debounced at low volume)
- **Database load**: Low (large batches during bursts, timely flushes during quiet periods)
- **Use when**: Bulk imports, seeding, high-volume background processing where operations arrive in bursts

**Debounce behavior**: Each new `QueueOutboxMessage` or `QueueInboxMessage` call resets the debounce countdown. The timer only fires after messages stop arriving for the full `IntervalMilliseconds` window. This means continuous message flow keeps batching until `BatchSize` is hit, while gaps in the flow trigger timely partial flushes.

## Decision Matrix

| Scenario | Recommended Strategy |
|----------|---------------------|
| Web API handling user requests | **Scoped** (default) |
| Real-time notifications | **Immediate** |
| Background worker processing queue | **Interval** |
| Bulk data import / seeding | **Batch** |
| Mixed workload (bursts + quiet) | **Batch** |
| Steady stream processing | **Interval** |

## DI Registration

The source generator automatically registers strategies based on `WorkCoordinatorOptions.Strategy`. Timer-based strategies (Interval, Batch) are registered as **singletons** to preserve their background timers across scopes. Per-scope strategies (Scoped, Immediate) are created fresh per scope.

Singleton strategies (Interval, Batch) require `IWorkChannelWriter` so a flush can signal the `ClaimWorker`. After a flush stores rows via `store_outbox_messages` / `store_inbox_messages`, the strategy calls `SignalNewWorkAvailable()` (and `SignalNewInboxWorkAvailable()` for inbox rows) so the `ClaimWorker` polls `claim_work` immediately instead of waiting for its next timer tick. The generated registration template automatically resolves all dependencies — including `IWorkChannelWriter`, `WorkCoordinatorMetrics`, and `LifecycleMetrics` — from the DI container.

The `WorkCoordinatorStrategyFactory` provides AOT-safe strategy creation using direct `new` calls (no reflection).

## Two Flush Methods

`IWorkCoordinatorStrategy` exposes two flush methods. Which one you call is a caller-side decision based on whether you need the resulting `WorkBatch`:

| Method | Returns | Semantics |
|--------|---------|-----------|
| **`FlushAsync(flags, ct)`** | `Task` | Fire-and-forget signal. The strategy decides when to flush: Immediate and Scoped flush now; Interval defers to its timer; Batch defers to its debounce or batch-size trigger. Used by Dispatcher for all automatic outbox routing (cascade-to-outbox, routed publish, routed send) — those paths don't consume the `WorkBatch`. |
| **`FlushAndGetBatchAsync(flags, ct)`** | `Task<WorkBatch>` | Force flush now and return the batch, bypassing any batching window. Used by inbox consumers that filter the returned `WorkBatch` by `MessageId` for deduplication, and by `IWorkFlusher` (end-of-request middleware) that must persist before the response completes. |

:::updated{version="1.0.0" type="breaking"}
**API changed in pre-v1.0:** the single `FlushAsync(flags, mode, ct)` method with a `FlushMode` enum was replaced by the two methods above. `FlushMode` no longer exists. Callers that previously passed `FlushMode.Required` should use `FlushAndGetBatchAsync`; callers that previously passed `FlushMode.BestEffort` should use `FlushAsync`. This split is structural — a caller that doesn't need the `WorkBatch` can't accidentally force a synchronous flush against an Interval or Batch strategy (the cause of the 2026-03-12 cascade-batching regression).
:::

## Manual Flushing

For scenarios where you need explicit control over when messages are persisted — independent of the strategy's automatic triggers — inject `IWorkFlusher`:

```csharp{title="Manual Flushing" description="For scenarios where you need explicit control over when messages are persisted — independent of the strategy's" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Manual", "Flushing"] tests=["WorkFlusherTests.ScopedStrategy_FlushAsync_DelegatesToStrategyWithRequiredModeAsync", "BatchWorkCoordinatorStrategyTests.ManualFlushAsync_DoesNotWaitForTimerOrBatchAsync"]}
public class ImportService(IWorkFlusher flusher) {
  public async Task ImportBatchAsync(IEnumerable<Order> orders, CancellationToken ct) {
    foreach (var order in orders) {
      await dispatcher.PublishAsync(new OrderImported(order.Id));
    }
    // Force flush now, don't wait for strategy trigger
    await flusher.FlushAsync(ct);
  }
}
```

`IWorkFlusher` is registered as **scoped** and resolves to the same strategy instance as `IWorkCoordinatorStrategy`. Calling `FlushAsync` on it delegates to the strategy's `FlushAndGetBatchAsync` — a forced flush that bypasses any batching window, because end-of-request middleware cannot defer persistence past the HTTP response.

This is useful when:
- You need to ensure messages are persisted before returning a response
- You're using Interval or Batch strategy but need an immediate flush at a specific point
- You want to control flush timing without switching to the Immediate strategy
