---
title: Custom Perspectives
version: 1.0.0
category: Extensibility
order: 3
description: >-
  Advanced perspective patterns - time-travel, snapshots, caching, batching, and
  custom storage backends
tags: 'perspectives, read-models, custom-storage, time-travel, snapshots, caching'
codeReferences:
  - src/Whizbang.Core/IPerspectiveOf.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveStore.cs
  - src/Whizbang.Core/Messaging/PerspectiveCheckpointRecord.cs
---

# Custom Perspectives

**Custom perspectives** extend the basic `IPerspectiveOf<TEvent>` pattern with advanced capabilities like time-travel (event replay), snapshots, caching layers, batch processing, and custom storage backends.

:::note
For basic perspective usage, see [Perspectives Guide](../core-concepts/perspectives.md). This guide focuses on **advanced customization patterns** for specialized scenarios.
:::

---

## Why Custom Perspective Patterns?

**Built-in `IPerspectiveOf<TEvent>` handles most cases**, but some scenarios benefit from custom patterns:

| Scenario | Standard Perspective | Custom Pattern |
|----------|---------------------|----------------|
| **Event → Read Model** | ✅ Perfect fit | No customization needed |
| **Time-Travel Queries** | ❌ No built-in support | ✅ Checkpoint-based replay |
| **Performance (Large Events)** | ❌ Full replay expensive | ✅ Snapshot + incremental |
| **Caching Layer** | ❌ Database-only | ✅ In-memory + database |
| **Batch Updates** | ❌ One-at-a-time | ✅ Batched for throughput |
| **Custom Storage** | ❌ SQL-only | ✅ Custom backends (Redis, Elasticsearch) |
| **Hierarchical Models** | ❌ Flat models | ✅ Parent-child relationships |

**When to customize**:
- ✅ Time-travel / event replay scenarios
- ✅ High-frequency events (> 10K/sec per stream)
- ✅ Large event streams (> 1M events)
- ✅ Specialized storage (search engines, caches)
- ✅ Complex read model requirements

**When NOT to customize**:
- ❌ Simple event → table updates
- ❌ Low-volume scenarios (< 100 events/sec)
- ❌ Standard SQL read models

---

## Checkpoint System Overview

:::note
For comprehensive coverage of perspective checkpoints including automatic creation, fuzzy type matching, error tracking, and the complete 4-phase checkpoint system, see [Perspective Worker](../workers/perspective-worker.md).
:::

**Core checkpoint concepts**:
- **Event Store**: Immutable log of all events per stream
- **Checkpoint**: Last processed event per (stream, perspective) pair
- **Auto-Creation**: Checkpoints created automatically when events arrive (Phase 1)
- **Fuzzy Matching**: Perspectives matched to events via regex patterns (Phase 2)
- **Processing**: PerspectiveWorker polls and processes checkpoints (Phase 3)
- **Error Tracking**: Failed checkpoints persist error messages (Phase 4)

See [Perspective Worker](../workers/perspective-worker.md) for detailed checkpoint lifecycle, sequence diagrams, and runtime behavior.

---

## Custom Base Classes

### Pattern 1: Checkpoint-Aware Perspective Base

**Use Case**: Automatically track checkpoint after processing each event.

```csharp
using Whizbang.Core;
using Whizbang.Core.Messaging;

public abstract class CheckpointPerspective<TEvent> : IPerspectiveOf<TEvent> where TEvent : IEvent {
  private readonly IWorkCoordinator _coordinator;
  protected readonly ILogger Logger;

  protected CheckpointPerspective(
    IWorkCoordinator coordinator,
    ILogger logger
  ) {
    _coordinator = coordinator;
    Logger = logger;
  }

  public async Task UpdateAsync(TEvent @event, CancellationToken ct = default) {
    // 1. Process event (implemented by subclass)
    await ProcessEventAsync(@event, ct);

    // 2. Update checkpoint automatically
    await UpdateCheckpointAsync(@event, ct);

    Logger.LogInformation(
      "Processed {EventType} for stream {StreamId}, checkpoint updated to {EventId}",
      typeof(TEvent).Name,
      @event.StreamId,
      @event.EventId
    );
  }

  /// <summary>
  /// Implement event processing logic here.
  /// Checkpoint is updated automatically after success.
  /// </summary>
  protected abstract Task ProcessEventAsync(TEvent @event, CancellationToken ct);

  /// <summary>
  /// Get the perspective name for checkpoint tracking.
  /// Default: class name. Override for custom names.
  /// </summary>
  protected virtual string GetPerspectiveName() => GetType().Name;

  private async Task UpdateCheckpointAsync(TEvent @event, CancellationToken ct) {
    var completion = new PerspectiveCheckpointCompletion {
      StreamId = @event.StreamId,
      PerspectiveName = GetPerspectiveName(),
      LastEventId = @event.EventId,
      Status = PerspectiveProcessingStatus.Completed
    };

    // Update checkpoint via work coordinator
    await _coordinator.ProcessWorkBatchAsync(
      instanceId: Guid.NewGuid(),
      serviceName: "Perspective",
      hostName: Environment.MachineName,
      processId: Environment.ProcessId,
      metadata: null,
      outboxCompletions: [],
      outboxFailures: [],
      inboxCompletions: [],
      inboxFailures: [],
      receptorCompletions: [],
      receptorFailures: [],
      perspectiveCompletions: [completion],  // ← Update checkpoint
      perspectiveFailures: [],
      newOutboxMessages: [],
      newInboxMessages: [],
      renewOutboxLeaseIds: [],
      renewInboxLeaseIds: [],
      cancellationToken: ct
    );
  }
}
```

**Usage**:
```csharp
public record OrderCreated(
  Guid StreamId,
  Guid EventId,
  Guid OrderId,
  Guid CustomerId,
  decimal Total
) : IEvent;

public class OrderSummaryPerspective : CheckpointPerspective<OrderCreated> {
  private readonly IDbConnectionFactory _db;

  public OrderSummaryPerspective(
    IWorkCoordinator coordinator,
    ILogger<OrderSummaryPerspective> logger,
    IDbConnectionFactory db
  ) : base(coordinator, logger) {
    _db = db;
  }

  // Checkpoint updated automatically after ProcessEventAsync completes
  protected override async Task ProcessEventAsync(
    OrderCreated @event,
    CancellationToken ct
  ) {
    await using var conn = _db.CreateConnection();
    await conn.ExecuteAsync(
      "INSERT INTO order_summaries (order_id, customer_id, total, status) VALUES (@OrderId, @CustomerId, @Total, 'Created')",
      new { @event.OrderId, @event.CustomerId, @event.Total },
      ct
    );
  }
}
```

**Benefits**:
- **Automatic Checkpoint Tracking**: No manual checkpoint management
- **Time-Travel Ready**: Can replay from any checkpoint
- **Consistent Pattern**: Same checkpoint logic across perspectives

---

### Pattern 2: Snapshot Perspective Base

**Use Case**: Periodic snapshots instead of full event replay for large streams.

```csharp
using Whizbang.Core;

public abstract class SnapshotPerspective<TEvent, TSnapshot> : IPerspectiveOf<TEvent>
  where TEvent : IEvent
  where TSnapshot : class, new() {

  private readonly IPerspectiveStore<TSnapshot> _store;
  protected readonly ILogger Logger;

  // Snapshot every N events (configurable)
  protected virtual int SnapshotInterval => 100;

  protected SnapshotPerspective(
    IPerspectiveStore<TSnapshot> store,
    ILogger logger
  ) {
    _store = store;
    Logger = logger;
  }

  public async Task UpdateAsync(TEvent @event, CancellationToken ct = default) {
    // 1. Load current snapshot (or create new)
    var snapshot = await LoadSnapshotAsync(@event.StreamId.ToString(), ct)
                   ?? new TSnapshot();

    // 2. Apply event to snapshot
    ApplyEvent(@event, snapshot);

    // 3. Save updated snapshot
    await _store.UpsertAsync(@event.StreamId.ToString(), snapshot, ct);

    Logger.LogDebug(
      "Applied {EventType} to snapshot for stream {StreamId}",
      typeof(TEvent).Name,
      @event.StreamId
    );
  }

  /// <summary>
  /// Apply event to snapshot (implement delta update).
  /// </summary>
  protected abstract void ApplyEvent(TEvent @event, TSnapshot snapshot);

  /// <summary>
  /// Load snapshot from store.
  /// </summary>
  protected virtual async Task<TSnapshot?> LoadSnapshotAsync(
    string streamId,
    CancellationToken ct
  ) {
    // IPerspectiveStore doesn't expose reads - this is write-only
    // For reads, use a separate query service/lens
    return new TSnapshot();  // Simplified for example
  }
}
```

**Usage**:
```csharp
public record OrderSnapshot {
  public Guid OrderId { get; set; }
  public Guid CustomerId { get; set; }
  public decimal Total { get; set; }
  public string Status { get; set; } = "Created";
  public int EventCount { get; set; }  // Track events applied
}

public class OrderSnapshotPerspective : SnapshotPerspective<OrderCreated, OrderSnapshot> {
  public OrderSnapshotPerspective(
    IPerspectiveStore<OrderSnapshot> store,
    ILogger<OrderSnapshotPerspective> logger
  ) : base(store, logger) { }

  protected override void ApplyEvent(OrderCreated @event, OrderSnapshot snapshot) {
    // Delta update - only change what's new
    snapshot.OrderId = @event.OrderId;
    snapshot.CustomerId = @event.CustomerId;
    snapshot.Total = @event.Total;
    snapshot.Status = "Created";
    snapshot.EventCount++;

    Logger.LogInformation(
      "Applied OrderCreated to snapshot, now at {EventCount} events",
      snapshot.EventCount
    );
  }
}
```

**Benefits**:
- **Fast Rebuild**: Snapshot + recent events (not full replay)
- **Performance**: O(recent events) instead of O(all events)
- **Scalability**: Works with millions of events per stream

---

## Time-Travel Perspectives

### Pattern 3: Event Replay Perspective

**Use Case**: Rebuild read model from event history for any point in time.

```csharp
using Whizbang.Core;

public class TimeravelOrderSummaryPerspective : IPerspectiveOf<OrderCreated> {
  private readonly IEventStore _eventStore;
  private readonly IDbConnectionFactory _db;
  private readonly ILogger<TimeravelOrderSummaryPerspective> _logger;

  public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
    // Standard event processing
    await using var conn = _db.CreateConnection();
    await conn.ExecuteAsync(
      "INSERT INTO order_summaries (...) VALUES (...)",
      @event,
      ct
    );
  }

  /// <summary>
  /// Rebuild read model from event history up to specific event.
  /// Enables "what did the order look like at 2:00 PM yesterday?"
  /// </summary>
  public async Task RebuildToEventAsync(
    Guid streamId,
    Guid targetEventId,
    CancellationToken ct = default
  ) {
    _logger.LogInformation(
      "Rebuilding OrderSummary for stream {StreamId} up to event {EventId}",
      streamId,
      targetEventId
    );

    // 1. Clear existing read model for this stream
    await ClearReadModelAsync(streamId, ct);

    // 2. Replay events in order until target event
    await foreach (var @event in _eventStore.GetEventsAsync<OrderCreated>(
      streamId,
      untilEventId: targetEventId,  // Stop at target
      ct
    )) {
      await UpdateAsync(@event, ct);
    }

    _logger.LogInformation(
      "Rebuilt OrderSummary for stream {StreamId} to event {EventId}",
      streamId,
      targetEventId
    );
  }

  /// <summary>
  /// Rebuild entire read model from scratch.
  /// </summary>
  public async Task RebuildAllAsync(CancellationToken ct = default) {
    _logger.LogInformation("Rebuilding all OrderSummary read models");

    // 1. Truncate read model table
    await using var conn = _db.CreateConnection();
    await conn.ExecuteAsync("TRUNCATE TABLE order_summaries", ct);

    // 2. Replay all events
    await foreach (var @event in _eventStore.GetAllEventsAsync<OrderCreated>(ct)) {
      await UpdateAsync(@event, ct);
    }

    _logger.LogInformation("Rebuilt all OrderSummary read models");
  }

  private async Task ClearReadModelAsync(Guid streamId, CancellationToken ct) {
    await using var conn = _db.CreateConnection();
    await conn.ExecuteAsync(
      "DELETE FROM order_summaries WHERE stream_id = @StreamId",
      new { StreamId = streamId },
      ct
    );
  }
}
```

**Usage**:
```csharp
// Standard event processing
await perspective.UpdateAsync(orderCreated, ct);

// Time-travel: rebuild to specific event
var specificEventId = Guid.Parse("...");  // Event from 2:00 PM yesterday
await perspective.RebuildToEventAsync(orderId, specificEventId, ct);

// Rebuild entire read model (after schema change)
await perspective.RebuildAllAsync(ct);
```

**Use Cases**:
- **Debugging**: What did the order look like when bug occurred?
- **Auditing**: Reconstruct state at regulatory compliance checkpoint
- **Schema Evolution**: Rebuild read model after adding new fields
- **Testing**: Verify read model correctness by replaying production events

---

## Performance Optimization

### Pattern 4: Batching Perspective

**Use Case**: Batch multiple events for single database roundtrip.

```csharp
using Whizbang.Core;
using System.Threading.Channels;

public class BatchingOrderSummaryPerspective : IPerspectiveOf<OrderCreated>, IAsyncDisposable {
  private readonly IDbConnectionFactory _db;
  private readonly ILogger<BatchingOrderSummaryPerspective> _logger;

  private readonly Channel<OrderCreated> _eventQueue;
  private readonly Task _batchProcessor;
  private readonly CancellationTokenSource _cts;

  // Batch settings
  private const int BatchSize = 100;
  private static readonly TimeSpan BatchTimeout = TimeSpan.FromMilliseconds(500);

  public BatchingOrderSummaryPerspective(
    IDbConnectionFactory db,
    ILogger<BatchingOrderSummaryPerspective> logger
  ) {
    _db = db;
    _logger = logger;

    // Bounded channel for backpressure
    _eventQueue = Channel.CreateBounded<OrderCreated>(new BoundedChannelOptions(10000) {
      FullMode = BoundedChannelFullMode.Wait
    });

    _cts = new CancellationTokenSource();
    _batchProcessor = Task.Run(() => ProcessBatchesAsync(_cts.Token));
  }

  public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
    // Queue event for batch processing
    await _eventQueue.Writer.WriteAsync(@event, ct);
  }

  private async Task ProcessBatchesAsync(CancellationToken ct) {
    var batch = new List<OrderCreated>(BatchSize);

    while (!ct.IsCancellationRequested) {
      try {
        // Read up to BatchSize events or timeout
        while (batch.Count < BatchSize) {
          using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
          timeoutCts.CancelAfter(BatchTimeout);

          try {
            var @event = await _eventQueue.Reader.ReadAsync(timeoutCts.Token);
            batch.Add(@event);
          } catch (OperationCanceledException) {
            // Timeout or cancellation - process what we have
            break;
          }
        }

        // Process batch if we have any events
        if (batch.Count > 0) {
          await ProcessBatchAsync(batch, ct);
          batch.Clear();
        }

      } catch (Exception ex) when (ex is not OperationCanceledException) {
        _logger.LogError(ex, "Error processing event batch");
        await Task.Delay(TimeSpan.FromSeconds(1), ct);  // Backoff
      }
    }
  }

  private async Task ProcessBatchAsync(List<OrderCreated> events, CancellationToken ct) {
    await using var conn = _db.CreateConnection();

    // Single INSERT for entire batch
    await conn.ExecuteAsync(
      """
      INSERT INTO order_summaries (order_id, customer_id, total, status, created_at)
      VALUES (@OrderId, @CustomerId, @Total, 'Created', @CreatedAt)
      ON CONFLICT (order_id) DO NOTHING
      """,
      events,  // ← Dapper executes once per item, but single roundtrip
      ct
    );

    _logger.LogInformation(
      "Processed batch of {Count} events",
      events.Count
    );
  }

  public async ValueTask DisposeAsync() {
    // Shutdown gracefully
    _eventQueue.Writer.Complete();
    _cts.Cancel();

    try {
      await _batchProcessor.WaitAsync(TimeSpan.FromSeconds(10));
    } catch (TimeoutException) {
      _logger.LogWarning("Batch processor did not complete within timeout");
    }

    _cts.Dispose();
  }
}
```

**Performance**:
- **Throughput**: 10x improvement (100 events/batch vs 1 event/call)
- **Latency**: Slightly higher (max 500ms batching delay)
- **Database Load**: 10x reduction in connections/queries

---

### Pattern 5: Cached Perspective

**Use Case**: In-memory cache + database for read-heavy scenarios.

```csharp
using Whizbang.Core;
using Microsoft.Extensions.Caching.Memory;

public class CachedOrderSummaryPerspective : IPerspectiveOf<OrderCreated> {
  private readonly IDbConnectionFactory _db;
  private readonly IMemoryCache _cache;
  private readonly ILogger<CachedOrderSummaryPerspective> _logger;

  private static readonly MemoryCacheEntryOptions CacheOptions = new() {
    AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5),
    SlidingExpiration = TimeSpan.FromMinutes(1)
  };

  public CachedOrderSummaryPerspective(
    IDbConnectionFactory db,
    IMemoryCache cache,
    ILogger<CachedOrderSummaryPerspective> logger
  ) {
    _db = db;
    _cache = cache;
    _logger = logger;
  }

  public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
    // 1. Update database (source of truth)
    await using var conn = _db.CreateConnection();
    await conn.ExecuteAsync(
      "INSERT INTO order_summaries (order_id, customer_id, total, status) VALUES (@OrderId, @CustomerId, @Total, 'Created')",
      new { @event.OrderId, @event.CustomerId, @event.Total },
      ct
    );

    // 2. Update cache
    var cacheKey = GetCacheKey(@event.OrderId);
    var summary = new OrderSummary {
      OrderId = @event.OrderId,
      CustomerId = @event.CustomerId,
      Total = @event.Total,
      Status = "Created"
    };

    _cache.Set(cacheKey, summary, CacheOptions);

    _logger.LogDebug(
      "Updated order summary for {OrderId} in database and cache",
      @event.OrderId
    );
  }

  /// <summary>
  /// Read from cache, fall back to database if cache miss.
  /// </summary>
  public async Task<OrderSummary?> GetAsync(Guid orderId, CancellationToken ct = default) {
    var cacheKey = GetCacheKey(orderId);

    // Try cache first
    if (_cache.TryGetValue(cacheKey, out OrderSummary? cached)) {
      _logger.LogDebug("Cache hit for order {OrderId}", orderId);
      return cached;
    }

    // Cache miss - load from database
    _logger.LogDebug("Cache miss for order {OrderId}, loading from database", orderId);

    await using var conn = _db.CreateConnection();
    var summary = await conn.QuerySingleOrDefaultAsync<OrderSummary>(
      "SELECT * FROM order_summaries WHERE order_id = @OrderId",
      new { OrderId = orderId },
      ct
    );

    if (summary is not null) {
      // Populate cache for next time
      _cache.Set(cacheKey, summary, CacheOptions);
    }

    return summary;
  }

  private static string GetCacheKey(Guid orderId) => $"order-summary:{orderId}";
}

public record OrderSummary {
  public Guid OrderId { get; set; }
  public Guid CustomerId { get; set; }
  public decimal Total { get; set; }
  public string Status { get; set; } = string.Empty;
}
```

**Performance**:
- **Cache Hit Rate**: 95%+ for read-heavy workloads
- **Latency**: ~1µs (cache) vs ~5ms (database)
- **Database Load**: 95% reduction in reads

---

## Custom Storage Backends

### Pattern 6: IPerspectiveStore Implementation

**Use Case**: Custom storage backend (Redis, Elasticsearch, etc.).

```csharp
using Whizbang.Core.Perspectives;
using StackExchange.Redis;
using System.Text.Json;

/// <summary>
/// Redis-based perspective store for high-performance read models.
/// </summary>
public class RedisPerspectiveStore<TModel> : IPerspectiveStore<TModel> where TModel : class {
  private readonly IConnectionMultiplexer _redis;
  private readonly ILogger<RedisPerspectiveStore<TModel>> _logger;
  private readonly string _keyPrefix;

  private static readonly JsonSerializerOptions JsonOptions = new() {
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase
  };

  public RedisPerspectiveStore(
    IConnectionMultiplexer redis,
    ILogger<RedisPerspectiveStore<TModel>> logger,
    string? keyPrefix = null
  ) {
    _redis = redis;
    _logger = logger;
    _keyPrefix = keyPrefix ?? typeof(TModel).Name.ToLowerInvariant();
  }

  public async Task UpsertAsync(
    string id,
    TModel model,
    CancellationToken ct = default
  ) {
    var db = _redis.GetDatabase();
    var key = GetRedisKey(id);

    // Serialize model to JSON
    var json = JsonSerializer.Serialize(model, JsonOptions);

    // Store in Redis with expiration
    await db.StringSetAsync(
      key,
      json,
      expiry: TimeSpan.FromHours(24)  // TTL for read models
    );

    _logger.LogDebug(
      "Upserted {ModelType} with id {Id} to Redis",
      typeof(TModel).Name,
      id
    );
  }

  /// <summary>
  /// Get model from Redis (not part of IPerspectiveStore, but useful for reads).
  /// </summary>
  public async Task<TModel?> GetAsync(string id, CancellationToken ct = default) {
    var db = _redis.GetDatabase();
    var key = GetRedisKey(id);

    var json = await db.StringGetAsync(key);
    if (json.IsNullOrEmpty) {
      return null;
    }

    return JsonSerializer.Deserialize<TModel>(json!, JsonOptions);
  }

  private string GetRedisKey(string id) => $"{_keyPrefix}:{id}";
}
```

**Usage**:
```csharp
// Register Redis perspective store
builder.Services.AddSingleton<IConnectionMultiplexer>(
  ConnectionMultiplexer.Connect("localhost:6379")
);
builder.Services.AddSingleton<IPerspectiveStore<OrderSummary>, RedisPerspectiveStore<OrderSummary>>();

// Use in perspective
public class OrderSummaryPerspective : IPerspectiveOf<OrderCreated> {
  private readonly IPerspectiveStore<OrderSummary> _store;

  public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
    var summary = new OrderSummary {
      OrderId = @event.OrderId,
      CustomerId = @event.CustomerId,
      Total = @event.Total,
      Status = "Created"
    };

    // Store in Redis (via IPerspectiveStore abstraction)
    await _store.UpsertAsync(@event.OrderId.ToString(), summary, ct);
  }
}
```

**Benefits**:
- **Storage Flexibility**: Redis, Elasticsearch, MongoDB, etc.
- **Abstraction**: Perspectives don't know storage details
- **Testability**: Mock IPerspectiveStore for unit tests

---

## Advanced Patterns

### Pattern 7: Hierarchical Perspective

**Use Case**: Parent-child read models (order → order items).

```csharp
using Whizbang.Core;

public class OrderDetailsPerspective :
  IPerspectiveOf<OrderCreated>,
  IPerspectiveOf<OrderItemAdded> {

  private readonly IDbConnectionFactory _db;

  public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
    await using var conn = _db.CreateConnection();

    // Insert parent record
    await conn.ExecuteAsync(
      "INSERT INTO order_details (order_id, customer_id, total, status) VALUES (@OrderId, @CustomerId, @Total, 'Created')",
      new { @event.OrderId, @event.CustomerId, @event.Total },
      ct
    );
  }

  public async Task UpdateAsync(OrderItemAdded @event, CancellationToken ct = default) {
    await using var conn = _db.CreateConnection();

    // Insert child record
    await conn.ExecuteAsync(
      "INSERT INTO order_detail_items (order_id, product_id, quantity, unit_price) VALUES (@OrderId, @ProductId, @Quantity, @UnitPrice)",
      new { @event.OrderId, @event.ProductId, @event.Quantity, @event.UnitPrice },
      ct
    );

    // Update parent aggregate
    await conn.ExecuteAsync(
      "UPDATE order_details SET total = total + (@Quantity * @UnitPrice) WHERE order_id = @OrderId",
      new { @event.OrderId, @event.Quantity, @event.UnitPrice },
      ct
    );
  }
}
```

**Schema**:
```sql
CREATE TABLE order_details (
    order_id UUID PRIMARY KEY,
    customer_id UUID NOT NULL,
    total DECIMAL(10,2) NOT NULL,
    status VARCHAR(50) NOT NULL
);

CREATE TABLE order_detail_items (
    order_item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES order_details(order_id),
    product_id UUID NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL
);
```

---

### Pattern 8: Transformation Perspective

**Use Case**: Transform events before storing (enrich, filter, aggregate).

```csharp
using Whizbang.Core;

public class EnrichedOrderPerspective : IPerspectiveOf<OrderCreated> {
  private readonly IDbConnectionFactory _db;
  private readonly ICustomerService _customerService;
  private readonly ILogger<EnrichedOrderPerspective> _logger;

  public async Task UpdateAsync(OrderCreated @event, CancellationToken ct = default) {
    // 1. Enrich event with customer data
    var customer = await _customerService.GetCustomerAsync(@event.CustomerId, ct);

    // 2. Transform and store enriched data
    await using var conn = _db.CreateConnection();
    await conn.ExecuteAsync(
      """
      INSERT INTO enriched_orders (
          order_id, customer_id, customer_name, customer_email, customer_tier,
          total, status, created_at
      ) VALUES (
          @OrderId, @CustomerId, @CustomerName, @CustomerEmail, @CustomerTier,
          @Total, 'Created', @CreatedAt
      )
      """,
      new {
        @event.OrderId,
        @event.CustomerId,
        CustomerName = customer.FullName,       // ← Enriched
        CustomerEmail = customer.Email,         // ← Enriched
        CustomerTier = customer.LoyaltyTier,    // ← Enriched
        @event.Total,
        @event.CreatedAt
      },
      ct
    );

    _logger.LogInformation(
      "Enriched order {OrderId} with customer data for {CustomerName}",
      @event.OrderId,
      customer.FullName
    );
  }
}
```

---

## Testing Custom Perspectives

### Testing Checkpoint Perspectives

```csharp
public class CheckpointPerspectiveTests {
  [Test]
  public async Task UpdateAsync_UpdatesCheckpointAfterProcessingAsync() {
    // Arrange
    var mockCoordinator = CreateMockWorkCoordinator();
    var mockDb = CreateMockDb();
    var logger = new NullLogger<OrderSummaryPerspective>();

    var perspective = new OrderSummaryPerspective(mockCoordinator, logger, mockDb);

    var @event = new OrderCreated(
      StreamId: Guid.NewGuid(),
      EventId: Guid.NewGuid(),
      OrderId: Guid.NewGuid(),
      CustomerId: Guid.NewGuid(),
      Total: 99.99m
    );

    // Act
    await perspective.UpdateAsync(@event);

    // Assert - checkpoint updated
    var checkpoints = mockCoordinator.GetPerspectiveCheckpoints();
    await Assert.That(checkpoints).HasCount().EqualTo(1);
    await Assert.That(checkpoints[0].StreamId).IsEqualTo(@event.StreamId);
    await Assert.That(checkpoints[0].LastEventId).IsEqualTo(@event.EventId);
    await Assert.That(checkpoints[0].PerspectiveName).IsEqualTo("OrderSummaryPerspective");
  }
}
```

### Testing Time-Travel Perspectives

```csharp
public class TimeravelPerspectiveTests {
  [Test]
  public async Task RebuildToEventAsync_ReplaysEventsUpToTargetAsync() {
    // Arrange
    var mockEventStore = CreateMockEventStore(eventCount: 10);
    var mockDb = CreateMockDb();
    var logger = new NullLogger<TimeravelOrderSummaryPerspective>();

    var perspective = new TimeravelOrderSummaryPerspective(mockEventStore, mockDb, logger);

    var streamId = Guid.NewGuid();
    var targetEventId = mockEventStore.GetEventId(streamId, eventIndex: 5);  // Event #5

    // Act - rebuild to event #5 (should process events 1-5)
    await perspective.RebuildToEventAsync(streamId, targetEventId);

    // Assert - only 5 events processed
    var summaries = await mockDb.QueryAsync<OrderSummary>(
      "SELECT * FROM order_summaries WHERE stream_id = @StreamId",
      new { StreamId = streamId }
    );

    await Assert.That(summaries).HasCount().EqualTo(5);  // Not 10!
  }
}
```

---

## Best Practices

### DO ✅

- ✅ **Track checkpoints** for time-travel scenarios
- ✅ **Use snapshots** for large event streams (> 1M events)
- ✅ **Batch updates** for high-throughput scenarios (> 10K events/sec)
- ✅ **Cache read models** for read-heavy workloads
- ✅ **Make perspectives idempotent** (same event = same result)
- ✅ **Test time-travel scenarios** (rebuild from any point)
- ✅ **Log checkpoint progress** for debugging

### DON'T ❌

- ❌ Store state in perspective instances (stateless only)
- ❌ Skip checkpoint updates (breaks time-travel)
- ❌ Replay all events for every query (use snapshots)
- ❌ Block perspective processing (async all the way)
- ❌ Ignore idempotency (duplicate events will happen)
- ❌ Mix read and write logic in perspectives

---

## Further Reading

**Workers**:
- [Perspective Worker](../workers/perspective-worker.md) - **Comprehensive checkpoint lifecycle and 4-phase system**
- [Execution Lifecycle](../workers/execution-lifecycle.md) - Startup/shutdown coordination
- [Database Readiness](../workers/database-readiness.md) - Dependency coordination

**Core Concepts**:
- [Perspectives Guide](../core-concepts/perspectives.md) - Basic perspective usage
- [Dispatcher](../core-concepts/dispatcher.md) - Publishing events
- [Event Store](../data/event-store.md) - Event storage patterns

**Extensibility**:
- [Custom Receptors](custom-receptors.md) - Advanced receptor patterns
- [Custom Storage](custom-storage.md) - Storage backend implementations

**Data Access**:
- [Perspectives Storage](../data/perspectives-storage.md) - Schema design

**Messaging**:
- [Work Coordinator](../messaging/work-coordinator.md) - Atomic batch processing and checkpoint tracking

---

*Version 1.0.0 - Foundation Release | Last Updated: 2025-12-21*
