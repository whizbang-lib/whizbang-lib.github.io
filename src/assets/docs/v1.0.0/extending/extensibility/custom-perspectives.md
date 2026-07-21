---
title: Custom Perspectives
pageType: guide
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Extensibility
order: 3
description: >-
  Advanced perspective patterns - deletion actions, multi-stream aggregation,
  rebuilds, and custom storage backends
tags: 'perspectives, read-models, custom-storage, rebuild, multi-stream, apply-result'
codeReferences:
  - src/Whizbang.Core/Perspectives/IPerspectiveFor.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveWithActionsFor.cs
  - src/Whizbang.Core/Perspectives/IGlobalPerspectiveFor.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveStore.cs
  - src/Whizbang.Core/Perspectives/PerspectiveRebuilder.cs
testReferences:
  - tests/Whizbang.Core.Tests/Perspectives/IPerspectiveStoreTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/IPerspectiveStoreDefaultsTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/PerspectiveRebuilderTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCorePostgresPerspectiveStoreTests.cs
lastMaintainedCommit: '01f07906'
---

# Custom Perspectives

**Custom perspectives** extend the basic `IPerspectiveFor<TModel, TEvent>` pattern with advanced capabilities: deletion actions, multi-stream aggregation, operational rebuilds, and custom storage backends.

:::note
For basic perspective usage, see [Perspectives Guide](../../fundamentals/perspectives/perspectives.md). This guide focuses on **advanced customization patterns** for specialized scenarios.
:::

---

## Why Custom Perspective Patterns?

**Built-in `IPerspectiveFor<TModel, TEvent...>` handles most cases**, but some scenarios benefit from the extended interfaces:

| Scenario | Standard Perspective | Extended Pattern |
|----------|---------------------|------------------|
| **Event → Read Model** | ✅ Perfect fit | No customization needed |
| **Soft/Hard Deletes** | ❌ Apply always returns a model | ✅ `IPerspectiveWithActionsFor` + `ApplyResult<TModel>` |
| **Cross-Stream Aggregation** | ❌ One model per stream | ✅ `IGlobalPerspectiveFor` with partition keys |
| **Rebuild / Replay** | ❌ Not in Apply's job | ✅ `IPerspectiveRebuilder` (blue-green, in-place, per-stream) |
| **Custom Storage** | Postgres (EF Core / Dapper) built in | ✅ Implement `IPerspectiveStore<TModel>` |

**Remember**: `Apply()` methods MUST stay pure - no I/O, no side effects, deterministic. All the patterns below keep that invariant; the framework (generated runners + `PerspectiveWorker`) owns loading, saving, checkpointing, and idempotency.

---

## Checkpoint System Overview

:::note
For comprehensive coverage of perspective processing - work claiming, cursor advancement, and error tracking - see [Perspective Worker](../../operations/workers/perspective-worker.md).
:::

**Core concepts**:
- **Event Store**: Immutable log of all events per stream
- **Cursor/Checkpoint**: Last processed event per (stream, perspective) pair, advanced by the framework
- **Idempotency**: Generated runners persist `PerspectiveMetadata.EventId` with each row upsert; on re-run after a crash they skip events with IDs ≤ the persisted value
- **Purity**: A Roslyn analyzer (`PerspectivePurityAnalyzer`) flags impure `Apply()` implementations at compile time

You do **not** write checkpoint-tracking code in perspectives - the runner and worker handle it.

---

## Deletion Actions

### Pattern 1: IPerspectiveWithActionsFor

**Use Case**: Events that should remove the read model row (soft delete or hard purge), not update it.

```csharp{title="Pattern 1: Perspective With Actions" description="Return ApplyResult to express delete/purge operations" category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Extensibility", "Pattern", "ApplyResult"] unverified="user extension example — user IPerspectiveWithActionsFor implementation"}
using Whizbang.Core;
using Whizbang.Core.Perspectives;

public class OrderPerspective :
    IPerspectiveFor<OrderView, OrderCreated>,               // Updates only
    IPerspectiveFor<OrderView, OrderUpdated>,               // Updates only
    IPerspectiveWithActionsFor<OrderView, OrderCancelled>,  // May delete
    IPerspectiveWithActionsFor<OrderView, OrderArchived> {  // May purge

  public OrderView Apply(OrderView currentData, OrderCreated eventData) =>
    new OrderView {
      OrderId = eventData.OrderId,
      Total = eventData.Total,
      Status = "Created"
    };

  public OrderView Apply(OrderView currentData, OrderUpdated eventData) =>
    currentData with { Total = eventData.NewTotal };

  public ApplyResult<OrderView> Apply(OrderView currentData, OrderCancelled eventData) =>
    ApplyResult<OrderView>.Delete();   // Soft delete (DeletedAt set)

  public ApplyResult<OrderView> Apply(OrderView currentData, OrderArchived eventData) =>
    ApplyResult<OrderView>.Purge();    // Hard delete (row removed)
}
```

`ApplyResult<TModel>` supports:
- Returning an updated model (implicit conversion from `TModel`)
- Soft delete via `ApplyResult<TModel>.Delete()`
- Hard delete via `ApplyResult<TModel>.Purge()`
- No change via `ApplyResult<TModel>.None()`

A perspective class can freely mix `IPerspectiveFor<TModel, TEvent>` (update-only events) and `IPerspectiveWithActionsFor<TModel, TEvent>` (events that may delete).

---

## Multi-Stream (Global) Perspectives

### Pattern 2: IGlobalPerspectiveFor

**Use Case**: Aggregate events from many streams into one model per **partition key** (e.g., per-customer order statistics).

```csharp{title="Pattern 2: Multi-Stream Perspective" description="Aggregate events across streams by partition key" category="Extensibility" difficulty="ADVANCED" tags=["Extending", "Extensibility", "Pattern", "Multi-Stream"] unverified="user extension example — user IGlobalPerspectiveFor implementation"}
using Whizbang.Core;
using Whizbang.Core.Perspectives;

public record CustomerOrderStats {
  [StreamId]
  public Guid CustomerId { get; init; }
  public int OrderCount { get; init; }
  public decimal TotalSpent { get; init; }
}

public class CustomerStatsPerspective :
    IGlobalPerspectiveFor<CustomerOrderStats, Guid, OrderCreated> {

  // Extracts the partition - like Marten's Identity() method.
  // MUST be pure: deterministic, no side effects.
  public Guid GetPartitionKey(OrderCreated eventData) => eventData.CustomerId;

  // Applies the event to the model for that partition. MUST be pure.
  public CustomerOrderStats Apply(CustomerOrderStats currentData, OrderCreated eventData) =>
    currentData with {
      CustomerId = eventData.CustomerId,
      OrderCount = currentData.OrderCount + 1,
      TotalSpent = currentData.TotalSpent + eventData.Total
    };
}
```

Storage-wise, global perspectives use the partition-key members of `IPerspectiveStore<TModel>` (`GetByPartitionKeyAsync` / `UpsertByPartitionKeyAsync`). Partition keys can be `Guid`, `string`, `int`, or any `notnull` type.

---

## Rebuilds and Replay

### Pattern 3: IPerspectiveRebuilder

**Use Case**: Rebuild read models after a schema change, a bug fix in `Apply()`, or data corruption - without writing replay plumbing yourself.

```csharp{title="Pattern 3: Perspective Rebuilds" description="Operational rebuild modes via IPerspectiveRebuilder" category="Extensibility" difficulty="ADVANCED" tags=["Extending", "Extensibility", "Pattern", "Rebuild"] tests=["PerspectiveRebuilderTests.RebuildBlueGreenAsync_CompletesSuccessfullyAsync", "PerspectiveRebuilderTests.RebuildInPlaceAsync_WithRegisteredPerspective_ProcessesAllStreamsAsync", "PerspectiveRebuilderTests.RebuildStreamsAsync_WithSpecificStreams_OnlyProcessesThoseAsync", "PerspectiveRebuilderTests.GetRebuildStatusAsync_WithNoActiveRebuild_ReturnsNullAsync"]}
public class PerspectiveOperations {
  private readonly IPerspectiveRebuilder _rebuilder;

  public PerspectiveOperations(IPerspectiveRebuilder rebuilder) {
    _rebuilder = rebuilder;
  }

  public async Task RebuildAfterSchemaChangeAsync(CancellationToken ct) {
    // Blue-green: rebuild into a shadow table, swap when complete
    RebuildResult result = await _rebuilder.RebuildBlueGreenAsync("OrderSummaryPerspective", ct);

    // In-place: truncate and replay into the live table
    result = await _rebuilder.RebuildInPlaceAsync("OrderSummaryPerspective", ct);

    // Selected streams only: surgical repair
    result = await _rebuilder.RebuildStreamsAsync(
      "OrderSummaryPerspective",
      streamIds: [orderId1, orderId2],
      ct
    );

    // Progress of a running rebuild
    RebuildStatus? status = await _rebuilder.GetRebuildStatusAsync("OrderSummaryPerspective", ct);
  }
}
```

The rebuilder resolves generated runners from `IPerspectiveRunnerRegistry`, queries streams from the event store, and replays events through the same `Apply()` code paths as live processing - so a rebuild always matches live behavior.

**Use Cases**:
- **Schema Evolution**: Rebuild read models after adding new fields
- **Bug Fixes**: Reproject after correcting an `Apply()` method
- **Debugging/Auditing**: Reconstruct state from the immutable event log
- **Surgical Repair**: Rebuild only the affected streams

---

## Custom Storage Backends

### Pattern 4: IPerspectiveStore Implementation

**Use Case**: Store read models somewhere other than the built-in Postgres stores (Redis, Elasticsearch, MongoDB, etc.).

`IPerspectiveStore<TModel>` is keyed by **`Guid` stream IDs** (and generic partition keys for global perspectives). Several overloads (scope, metadata, physical fields) have default implementations that delegate to the simpler members, so a minimal backend implements:

```csharp{title="Pattern 4: IPerspectiveStore Implementation" description="Redis-backed perspective store" category="Extensibility" difficulty="ADVANCED" tags=["Extending", "Extensibility", "Pattern", "IPerspectiveStore"] unverified="user extension example — user IPerspectiveStore (Redis) implementation"}
using Whizbang.Core.Perspectives;
using StackExchange.Redis;
using System.Text.Json;

public class RedisPerspectiveStore<TModel> : IPerspectiveStore<TModel> where TModel : class {
  private readonly IConnectionMultiplexer _redis;
  private readonly string _keyPrefix = typeof(TModel).Name.ToLowerInvariant();

  private static readonly JsonSerializerOptions JsonOptions = new() {
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase
  };

  public RedisPerspectiveStore(IConnectionMultiplexer redis) {
    _redis = redis;
  }

  public async Task<TModel?> GetByStreamIdAsync(Guid streamId, CancellationToken cancellationToken = default) {
    var json = await _redis.GetDatabase().StringGetAsync($"{_keyPrefix}:{streamId}");
    return json.IsNullOrEmpty ? null : JsonSerializer.Deserialize<TModel>(json!, JsonOptions);
  }

  public async Task UpsertAsync(Guid streamId, TModel model, CancellationToken cancellationToken = default) {
    var json = JsonSerializer.Serialize(model, JsonOptions);
    await _redis.GetDatabase().StringSetAsync($"{_keyPrefix}:{streamId}", json);
  }

  public Task UpsertWithPhysicalFieldsAsync(
      Guid streamId, TModel model, IDictionary<string, object?> physicalFieldValues,
      PerspectiveScope? scope = null, CancellationToken cancellationToken = default) =>
    UpsertAsync(streamId, model, cancellationToken);  // Redis has no split columns

  public async Task<TModel?> GetByPartitionKeyAsync<TPartitionKey>(
      TPartitionKey partitionKey, CancellationToken cancellationToken = default)
      where TPartitionKey : notnull {
    var json = await _redis.GetDatabase().StringGetAsync($"{_keyPrefix}:pk:{partitionKey}");
    return json.IsNullOrEmpty ? null : JsonSerializer.Deserialize<TModel>(json!, JsonOptions);
  }

  public async Task UpsertByPartitionKeyAsync<TPartitionKey>(
      TPartitionKey partitionKey, TModel model, CancellationToken cancellationToken = default)
      where TPartitionKey : notnull {
    var json = JsonSerializer.Serialize(model, JsonOptions);
    await _redis.GetDatabase().StringSetAsync($"{_keyPrefix}:pk:{partitionKey}", json);
  }

  public Task FlushAsync(CancellationToken cancellationToken = default) =>
    Task.CompletedTask;  // Redis writes are already committed

  public async Task PurgeAsync(Guid streamId, CancellationToken cancellationToken = default) =>
    await _redis.GetDatabase().KeyDeleteAsync($"{_keyPrefix}:{streamId}");

  public async Task PurgeByPartitionKeyAsync<TPartitionKey>(
      TPartitionKey partitionKey, CancellationToken cancellationToken = default)
      where TPartitionKey : notnull =>
    await _redis.GetDatabase().KeyDeleteAsync($"{_keyPrefix}:pk:{partitionKey}");
}
```

**Registration**:
```csharp{title="Custom Store Registration" description="Register a custom perspective store" category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Extensibility", "Pattern", "IPerspectiveStore"] unverified="user extension example — registers a user-defined Redis store"}
builder.Services.AddSingleton<IConnectionMultiplexer>(
  ConnectionMultiplexer.Connect("localhost:6379")
);
builder.Services.AddSingleton(typeof(IPerspectiveStore<>), typeof(RedisPerspectiveStore<>));
```

:::warning
The metadata-persisting `UpsertAsync` overloads are how generated runners make projection runs idempotent across worker crashes (they record the last applied `EventId` per row). A custom store that drops metadata still works - the default interface implementations fall back to "apply all events" - but loses that crash-window optimization. Implement the metadata overloads for production backends.
:::

**Benefits**:
- **Storage Flexibility**: Redis, Elasticsearch, MongoDB, etc.
- **Abstraction**: Perspectives don't know storage details - `Apply()` stays pure
- **Testability**: Fake `IPerspectiveStore` for unit tests

---

## Testing Custom Perspectives

Because `Apply()` methods are pure functions, perspective tests need no mocks, no database, and no framework setup:

```csharp{title="Testing Pure Apply Methods" description="Perspective tests are pure function tests" category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Extensibility", "Testing", "Perspectives"] unverified="user extension example — sample perspective unit test"}
public class OrderPerspectiveTests {
  [Test]
  public async Task Apply_OrderCreated_InitializesModelAsync() {
    var perspective = new OrderPerspective();
    var @event = new OrderCreated {
      OrderId = Guid.Parse("00000000-0000-0000-0000-000000000001"),
      Total = 99.99m
    };

    var result = perspective.Apply(new OrderView(), @event);

    await Assert.That(result.Status).IsEqualTo("Created");
    await Assert.That(result.Total).IsEqualTo(99.99m);
  }

  [Test]
  public async Task Apply_OrderCancelled_ReturnsDeleteActionAsync() {
    var perspective = new OrderPerspective();
    var current = new OrderView { Status = "Created" };

    ApplyResult<OrderView> result = perspective.Apply(current, new OrderCancelled());

    await Assert.That(result.Action).IsEqualTo(ModelAction.Delete);
  }
}
```

For storage backends, run the same contract tests the built-in stores use (upsert-then-get roundtrips, version increments, purge idempotency) against your implementation.

---

## Best Practices

### DO ✅

- ✅ **Keep Apply pure** - no I/O, no `DateTime.UtcNow`, no side effects (the purity analyzer enforces this)
- ✅ **Use `[StreamId]`** on the model's identity property (required for runner generation)
- ✅ **Use `ApplyResult` factory methods** for deletes instead of "tombstone" model flags
- ✅ **Use `IPerspectiveRebuilder`** for replays instead of hand-rolled truncate-and-loop code
- ✅ **Implement metadata overloads** in custom stores for crash-window idempotency
- ✅ **Test Apply methods as pure functions** - no mocks needed

### DON'T ❌

- ❌ Store state in perspective instances (stateless only)
- ❌ Perform database writes inside `Apply()` (that's the store's job)
- ❌ Track checkpoints manually (the framework owns cursors)
- ❌ Mix read/query logic into perspectives (use lenses/queries for reads)

---

## Further Reading

**Workers**:
- [Perspective Worker](../../operations/workers/perspective-worker.md) - Checkpoint lifecycle and processing
- [Execution Lifecycle](../../operations/workers/execution-lifecycle.md) - Startup/shutdown coordination
- [Database Readiness](../../operations/workers/database-readiness.md) - Dependency coordination

**Core Concepts**:
- [Perspectives Guide](../../fundamentals/perspectives/perspectives.md) - Basic perspective usage
- [Dispatcher](../../fundamentals/dispatcher/dispatcher.md) - Publishing events
- [Event Store](../../data/event-store.md) - Event storage patterns

**Extensibility**:
- [Custom Receptors](custom-receptors.md) - Advanced receptor patterns
- [Custom Storage](custom-storage.md) - Storage backend implementations

**Data Access**:
- [Perspectives Storage](../../data/perspectives-storage.md) - Schema design

**Messaging**:
- [Work Coordinator](../../messaging/work-coordinator.md) - Atomic batch processing and checkpoint tracking

### For Users

New to perspectives? Start with the user guide:
- [Perspectives Guide](../../fundamentals/perspectives/perspectives.md) — Core perspective concepts, pure function patterns, and read model design

---

*Version 1.0.0 - Foundation Release | Last Updated: 2026-07-16*
