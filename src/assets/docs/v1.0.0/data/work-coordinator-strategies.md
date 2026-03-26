---
title: Work Coordinator Strategies
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
---

# Work Coordinator Strategies

The work coordinator uses a **strategy pattern** to control when and how messages are flushed from in-memory queues to the database via `process_work_batch`. Each strategy makes different trade-offs between latency, throughput, and database load.

## Strategy Overview

| Strategy | Flush Trigger | Lifetime | Best For |
|----------|--------------|----------|----------|
| **Immediate** | Every `FlushAsync` call | Scoped | Real-time scenarios, low-throughput services |
| **Scoped** (default) | Scope disposal / explicit flush | Scoped | Web APIs, message handlers |
| **Interval** | Periodic timer | Singleton | Background workers, steady throughput |
| **Batch** | Batch size reached OR debounce quiet period | Singleton | Bulk imports, seeding, high-volume processing |

## Configuration

All strategies are configured via `WorkCoordinatorOptions`:

```csharp{title="Configuration" description="All strategies are configured via WorkCoordinatorOptions:" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "Configuration"]}
services.Configure<WorkCoordinatorOptions>(options => {
  options.Strategy = WorkCoordinatorStrategy.Batch;
  options.BatchSize = 100;               // Batch: flush at this count
  options.IntervalMilliseconds = 200;    // Interval: timer period; Batch: debounce window
  options.CoalesceWindowMilliseconds = 50; // Optional: delay Required flushes to pick up nearby items
  options.DebugMode = false;
  options.PartitionCount = 10_000;
  options.LeaseSeconds = 300;
  options.StaleThresholdSeconds = 600;
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
| `DebugMode` | `bool` | `false` | All | Keep completed messages for debugging |
| `LeaseSeconds` | `int` | `300` | All | Message lease duration |
| `StaleThresholdSeconds` | `int` | `600` | All | Threshold for stale instance detection |

## Strategies in Detail

### Immediate

Flushes on every `FlushAsync` call. No batching, no timers.

```csharp{title="Immediate" description="Flushes on every FlushAsync call." category="Implementation" difficulty="BEGINNER" tags=["Data", "Immediate"]}
services.Configure<WorkCoordinatorOptions>(o => {
  o.Strategy = WorkCoordinatorStrategy.Immediate;
});
```

- **Latency**: Lowest (immediate database write)
- **Database load**: Highest (one call per operation)
- **Use when**: You need real-time delivery and throughput is low

### Scoped (Default)

Batches operations within a DI scope (e.g., HTTP request). Flushes on explicit `FlushAsync` or scope disposal.

```csharp{title="Scoped (Default)" description="Batches operations within a DI scope (e." category="Implementation" difficulty="BEGINNER" tags=["Data", "C#", "Scoped", "Default"]}
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

```csharp{title="Interval" description="Batches operations and flushes on a periodic timer." category="Implementation" difficulty="BEGINNER" tags=["Data", "Interval"]}
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

```csharp{title="Batch" description="Batch" category="Implementation" difficulty="BEGINNER" tags=["Data", "Batch"]}
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

Singleton strategies (Interval, Batch) require `IWorkChannelWriter` for outbox publishing. When `process_work_batch` returns outbox work, the strategy writes it to the channel so the `WorkCoordinatorPublisherWorker` can pick it up and publish to the transport. The generated registration template automatically resolves all dependencies — including `IWorkChannelWriter`, `WorkCoordinatorMetrics`, and `LifecycleMetrics` — from the DI container.

The `WorkCoordinatorStrategyFactory` provides AOT-safe strategy creation using direct `new` calls (no reflection).

## FlushMode

All strategies support `FlushMode` on `FlushAsync`:

- **`Required`** (default): Must flush now and return results.
- **`BestEffort`**: Strategy decides when to flush. Interval/Batch defer to their triggers; Scoped flushes immediately anyway.

## Manual Flushing

For scenarios where you need explicit control over when messages are persisted — independent of the strategy's automatic triggers — inject `IWorkFlusher`:

```csharp{title="Manual Flushing" description="For scenarios where you need explicit control over when messages are persisted — independent of the strategy's" category="Implementation" difficulty="INTERMEDIATE" tags=["Data", "C#", "Manual", "Flushing"]}
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

`IWorkFlusher` is registered as **scoped** and resolves to the same strategy instance as `IWorkCoordinatorStrategy`. Calling `FlushAsync` is equivalent to calling the strategy's `FlushAsync` with `FlushMode.Required`.

This is useful when:
- You need to ensure messages are persisted before returning a response
- You're using Interval or Batch strategy but need an immediate flush at a specific point
- You want to control flush timing without switching to the Immediate strategy
