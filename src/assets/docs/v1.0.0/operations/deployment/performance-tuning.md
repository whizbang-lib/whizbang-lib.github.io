---
title: Performance Tuning
pageType: guide
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Advanced Topics
order: 1
description: >-
  Optimize Whizbang performance - zero-allocation patterns, pooling, batching,
  and profiling
tags: 'performance, optimization, profiling, zero-allocation, pooling'
codeReferences:
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
  - src/Whizbang.Core/Workers/BatchedCompletionStrategy.cs
  - src/Whizbang.Core/Workers/ProcessedEventCache.cs
  - src/Whizbang.Core/Workers/MessageProcessingOptions.cs
  - src/Whizbang.Core/Workers/TransportBatchOptions.cs
  - src/Whizbang.Core/Pooling/PolicyContextPool.cs
  - src/Whizbang.Core/Observability/WhizbangMetrics.cs
testReferences:
  - tests/Whizbang.Policies.Tests/PolicyContextPoolTests.cs
  - tests/Whizbang.Core.Tests/Workers/PerspectiveCompletionStrategyTests.cs
lastMaintainedCommit: '01f07906'
---

# Performance Tuning

Optimize **Whizbang performance** with zero-allocation patterns, object pooling, batching, database optimizations, and profiling techniques.

---

## Performance Benchmarks

| Metric | Target | Typical |
|--------|--------|---------|
| **Dispatcher Latency** | < 20ns | 15ns |
| **Message Throughput** | > 100K msg/sec | 150K msg/sec |
| **Memory Allocations** | Zero | 0 per dispatch |
| **Database Round-Trips** | 1 per batch | 1 per 100 messages |

---

## Zero-Allocation Dispatch

Whizbang's dispatch pipeline is **source-generated**: `Whizbang.Generators` emits a `GeneratedDispatcher` and a `GeneratedReceptorRegistry` whose receptor lookup tables are pre-compiled delegates categorized by message type and lifecycle stage - no reflection, no `MakeGenericType`, no runtime scanning.

```csharp{title="Zero-Allocation Dispatch" description="Source-generated dispatch - no reflection on the hot path" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "Zero-Allocation", "Dispatch"] unverified="DI wiring (AddWhizbangDispatcher/AddReceptors) + illustrative IReceptor shape; no behavior asserted by a mapped test"}
// Program.cs - the generated extensions wire the zero-reflection pipeline
services.AddWhizbangDispatcher();  // GeneratedDispatcher + GeneratedReceptorRegistry
services.AddReceptors();           // explicit registrations for every discovered receptor

// Hot-path lookup is a pre-compiled table, not reflection:
IReadOnlyList<ReceptorInfo> receptors =
  receptorRegistry.GetReceptorsFor(typeof(OrderCreatedEvent), LifecycleStage.PostInboxInline);

// Void receptors use ValueTask so synchronous completions allocate nothing:
public interface IReceptor<in TMessage> {
  ValueTask HandleAsync(TMessage message, CancellationToken cancellationToken = default);
}
```

**Why this is fast**:
- ✅ **No reflection** - Pre-compiled delegates emitted at build time
- ✅ **ValueTask handlers** - Synchronous completions avoid Task allocations
- ✅ **Inlineable** - JIT/AOT can inline small generated methods
- ✅ **Measured, not guessed** - `Whizbang.Dispatcher` meter exposes `whizbang.dispatcher.send.duration`, `whizbang.dispatcher.receptor.duration`, and friends

---

## Object Pooling

### 1. Policy Context Pooling

Whizbang ships **`PolicyContextPool`** (`Whizbang.Core.Pooling`) - a thread-safe, lock-free pool (max 1024 pooled instances) that reuses `PolicyContext` objects instead of allocating one per message:

```csharp{title="Policy Context Pooling" description="Built-in PolicyContextPool from Whizbang.Core.Pooling" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "Policy", "Context"] tests=["PolicyContextPoolTests.Rent_ShouldReturnInitializedContextAsync", "PolicyContextPoolTests.RentReturn_ShouldReinitializeContextAsync", "PolicyContextPoolTests.Pool_ShouldCreateNewContext_WhenEmptyAsync", "PolicyContextPoolTests.Pool_ShouldNotExceedMaxSize_WhenReturningManyContextsAsync"]}
using Whizbang.Core.Pooling;

var context = PolicyContextPool.Rent(message, envelope, services, "production");
try {
  var config = await policyEngine.MatchAsync(context);
} finally {
  PolicyContextPool.Return(context);  // ALWAYS return - Reset() happens inside
}
```

`Rent` re-initializes a pooled instance (or creates one when the pool is empty); `Return` resets state and discards the instance if the pool is already full. `PolicyContext` properties are intentionally read-only from user code - initialization happens only through the pool or the constructor.

**Effect**: steady-state policy evaluation allocates zero `PolicyContext` objects after warmup.

### 2. Bulk Processing Pools

Pool arrays for bulk operations:

```csharp{title="Bulk Processing Pools" description="Pool arrays for bulk operations:" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Bulk", "Processing"] unverified="user-defined ArrayPool wrapper over System.Buffers.ArrayPool; not a Whizbang API"}
public static class ArrayPool {
  public static T[] Rent<T>(int minLength) {
    return System.Buffers.ArrayPool<T>.Shared.Rent(minLength);
  }

  public static void Return<T>(T[] array, bool clearArray = false) {
    System.Buffers.ArrayPool<T>.Shared.Return(array, clearArray);
  }
}
```

**Usage**:

```csharp{title="Bulk Processing Pools (2)" description="Bulk Processing Pools" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Bulk", "Processing"] unverified="illustrative usage of the user-defined pool + app methods (ClaimWorkAsync/ProcessMessagesAsync); not a Whizbang API"}
var buffer = ArrayPool.Rent<OutboxMessage>(100);
try {
  var count = await ClaimWorkAsync(buffer);
  await ProcessMessagesAsync(buffer.AsSpan(0, count));
} finally {
  ArrayPool.Return(buffer, clearArray: true);
}
```

---

## Batching

### 1. Database Batching (Built In)

You don't write outbox SQL yourself - Whizbang funnels **all** outbox inserts, inbox writes, completions, and failures through a single `process_work_batch` database call per flush. Instead of every message handler making its own DB round-trip, the inbox batch strategy collects messages inside a sliding window and flushes them together. Tune the window via `MessageProcessingOptions`:

```csharp{title="Database Batching" description="MessageProcessingOptions controls process_work_batch batching" category="Configuration" difficulty="ADVANCED" tags=["Operations", "Deployment", "Database", "Batching"] unverified="MessageProcessingOptions tuning knobs; configuration values, no behavior asserted by a mapped test"}
// Override defaults before AddTransportConsumer():
services.AddSingleton(new MessageProcessingOptions {
  MaxConcurrentMessages = 80,   // default 40 - caps concurrent handlers (each holds a DB connection)
  InboxBatchSize = 50,          // default 100 - flush when this many messages collected
  InboxBatchSlideMs = 100,      // default 50 - flush after this much quiet time
  InboxBatchMaxWaitMs = 2000    // default 1000 - hard flush deadline
});
```

`process_work_batch` is the hot path on large datasets - watch `whizbang.work_coordinator.process_batch.duration` and `whizbang.work_coordinator.batch.*` metrics when tuning these values.

**Performance**: batching turns ~100 DB round-trips into 1 per flush window.

### 2. Message Publishing Batching (Built In)

Transport publishing is also batched by the library. `TransportBatchOptions` controls the sliding window the outbox publisher uses when handing messages to the transport (Azure Service Bus batch sends, RabbitMQ publisher batching):

```csharp{title="Message Publishing Batching" description="TransportBatchOptions controls transport publish batching" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "Message", "Publishing"] unverified="TransportBatchOptions tuning knobs; configuration values, no behavior asserted by a mapped test"}
// Register BEFORE the transport consumer builder - the library uses
// TryAddSingleton, so your instance wins if registered first.
services.AddSingleton(new TransportBatchOptions {
  BatchSize = 200,   // default 200 - max messages per transport batch
  SlideMs = 20,      // default 20 - quiet-time flush trigger
  MaxWaitMs = 1000   // default 1000 - hard flush deadline
});
```

Outbox draining uses the same sliding-window pattern (`SlidingWindowOutboxOptions`: `MaxSize` 100, `SlidingWindow` 50ms, `MaxWait` 1s defaults).

**Performance**: one transport call carries up to `BatchSize` messages instead of one call per message.

---

## Database Optimizations

### 1. Connection Pooling

Configure aggressive connection pooling:

**appsettings.json**:

```json{title="Connection Pooling" description="**appsettings." category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Connection", "Pooling"]}
{
  "ConnectionStrings": {
    "OrdersDb": "Host=localhost;Database=orders;Username=postgres;Password=postgres;Pooling=true;MinPoolSize=10;MaxPoolSize=100;ConnectionIdleLifetime=300"
  }
}
```

### 2. Prepared Statements

Use Dapper with prepared statements:

```csharp{title="Prepared Statements" description="Use Dapper with prepared statements:" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "Prepared", "Statements"] unverified="Dapper query in application code; not a Whizbang API"}
var orders = await _db.QueryAsync<OrderRow>(
  """
  SELECT * FROM orders
  WHERE customer_id = @CustomerId AND created_at >= @StartDate
  """,
  new { CustomerId = "cust-123", StartDate = DateTime.UtcNow.AddDays(-30) },
  commandType: CommandType.Text,
  commandTimeout: 30
);
```

PostgreSQL caches prepared statements automatically.

### 3. Indexes

Whizbang's internal tables (`wh_outbox`, `wh_inbox`, perspective tables) ship with their indexes managed by the library's own migrations - **don't add or remove indexes on `wh_*` tables yourself**. Create indexes for your *application* tables' common queries:

```sql{title="Indexes" description="Create indexes for your application tables' common queries" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Indexes"]}
-- App-level order lookups by customer
CREATE INDEX idx_orders_customer ON orders(customer_id, created_at DESC);

-- Partial index for active rows only
CREATE INDEX idx_orders_open ON orders(created_at)
  WHERE status = 'open';
```

When experimenting with indexes on large datasets, prefer a copy of the table plus `EXPLAIN ANALYZE` over experimenting against live traffic.

### 4. Partitioning

Partition large **application** tables by date:

```sql{title="Partitioning" description="Partition large app tables by date:" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "Partitioning"]}
CREATE TABLE order_events (
  event_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
  -- ... other columns
) PARTITION BY RANGE (created_at);

CREATE TABLE order_events_2026_07 PARTITION OF order_events
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
```

**Benefits**:
- Faster queries (scan only relevant partitions)
- Easier maintenance (drop old partitions)

Whizbang's own queue tables stay small by design - completed `wh_outbox` / `wh_inbox` rows are deleted on completion (unless debug mode retains them), so they don't normally need partitioning.

---

## Profiling

### 1. BenchmarkDotNet

Benchmark critical paths:

**CreateOrderBenchmark.cs**:

```csharp{title="BenchmarkDotNet" description="**CreateOrderBenchmark." category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "BenchmarkDotNet"] unverified="BenchmarkDotNet harness over a user receptor; not a Whizbang API test"}
using BenchmarkDotNet.Attributes;

[MemoryDiagnoser]
[SimpleJob(warmupCount: 3, iterationCount: 10)]
public class CreateOrderBenchmark {
  private CreateOrderReceptor _receptor = null!;
  private CreateOrderCommand _command = null!;

  [GlobalSetup]
  public void Setup() {
    _receptor = new CreateOrderReceptor(
      new TestDispatcher(),
      NullLogger<CreateOrderReceptor>.Instance);
    _command = OrderTestData.CreateValidOrder();
  }

  [Benchmark]
  public async Task<OrderCreatedEvent> CreateOrder() {
    return await _receptor.HandleAsync(_command);
  }
}
```

**Run**:

```bash{title="BenchmarkDotNet (2)" description="BenchmarkDotNet" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "BenchmarkDotNet"]}
dotnet run -c Release --project Benchmarks
```

**Output**:

```
|      Method |     Mean |   Error |  StdDev | Allocated |
|------------ |---------:|--------:|--------:|----------:|
| CreateOrder | 125.3 μs | 2.34 μs | 2.19 μs |     512 B |
```

### 2. dotnet-trace

Profile production workloads:

```bash{title="dotnet-trace" description="Profile production workloads:" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Dotnet-trace"]}
# Start tracing
dotnet-trace collect --process-id 1234 --profile cpu-sampling

# Stop after 30 seconds
# Open trace file in PerfView or Visual Studio
```

### 3. Application Insights

Monitor performance in production:

```csharp{title="Application Insights" description="Monitor performance in production:" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Application", "Insights"] unverified="Application Insights / OpenTelemetry DI wiring; third-party configuration"}
builder.Services.AddApplicationInsightsTelemetry();

builder.Services.AddOpenTelemetryMetrics(metrics => {
  metrics
    .AddMeter("Whizbang.*")
    .AddAspNetCoreInstrumentation()
    .AddHttpClientInstrumentation();
});
```

**Query in Azure**:

```kusto
requests
| where timestamp > ago(1h)
| summarize avg(duration), percentile(duration, 95) by name
| order by avg_duration desc
```

---

## Memory Optimizations

### 1. Struct Value Types

Use structs for small, immutable data:

```csharp{title="Struct Value Types" description="Use structs for small, immutable data:" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "Struct", "Value"] unverified="illustrative struct-vs-class example (incl. anti-pattern); not a Whizbang API"}
// ✅ GOOD - Struct (stack-allocated)
public readonly struct MessageId {
  private readonly Guid _value;

  public MessageId(Guid value) => _value = value;

  public override string ToString() => _value.ToString("N");
}

// ❌ BAD - Class (heap-allocated)
public class MessageId {
  public Guid Value { get; }
  public MessageId(Guid value) => Value = value;
}
```

### 2. Span<T> for Slicing

Avoid allocations when slicing arrays:

```csharp{title="Span<T> for Slicing" description="Avoid allocations when slicing arrays:" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Span<T>", "Slicing"] unverified="general Span<T> slicing idiom (incl. anti-pattern); not a Whizbang API"}
// ❌ BAD - Allocates new array
var subset = array.Skip(10).Take(50).ToArray();

// ✅ GOOD - No allocation
var subset = array.AsSpan(10, 50);
```

### 3. ValueTask for Hot Paths

Use `ValueTask` for frequently called async methods:

```csharp{title="ValueTask for Hot Paths" description="Use ValueTask for frequently called async methods:" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "ValueTask", "Hot"] unverified="illustrative ValueTask hot-path idiom in user code; not a Whizbang API"}
// ✅ GOOD - ValueTask avoids allocation if completed synchronously
// (this is why IReceptor.HandleAsync returns ValueTask)
public ValueTask<OrderCreatedEvent> HandleAsync(
  CreateOrderCommand command,
  CancellationToken cancellationToken = default
) {
  // If cached, return synchronously (no allocation)
  if (_cache.TryGetValue(command.CustomerId, out var cached)) {
    return new ValueTask<OrderCreatedEvent>(cached);
  }

  // Otherwise, await async operation
  return new ValueTask<OrderCreatedEvent>(HandleSlowPathAsync(command, cancellationToken));
}
```

---

## Concurrency Optimizations

### 1. Parallelism Is Explicit Configuration (No Auto-Tuning)

Whizbang's I/O parallelism is controlled by **explicit config knobs** - the library does **not** ship adaptive auto-tuning (AIMD, queue-depth feedback, etc.); set the knobs for your workload and validate with the `whizbang.*` metrics:

| Knob | Default | Controls |
|------|---------|----------|
| `MessageProcessingOptions.MaxConcurrentMessages` | 40 | Concurrent message handlers across all subscriptions (each holds a DB connection) |
| `MessageProcessingOptions.InboxBatchSize` / `InboxBatchSlideMs` / `InboxBatchMaxWaitMs` | 100 / 50 / 1000 | Inbox `process_work_batch` flush triggers |
| `TransportBatchOptions.BatchSize` / `SlideMs` / `MaxWaitMs` | 200 / 20 / 1000 | Transport publish batch flush triggers |
| `SlidingWindowOutboxOptions.MaxSize` / `SlidingWindow` / `MaxWait` | 100 / 50ms / 1s | Outbox drain batching |

Inside the perspective worker, per-stream processing is serialized by design (per-stream semaphores plus cross-pod stream pinning) so a stream's events always apply in order - parallelism happens **across** streams, never within one. That invariant is structural; there is no knob that relaxes it.

### 2. Parallel Processing in Your Own Code

For app-level fan-out (not Whizbang pipeline work), `Parallel.ForEachAsync` with a bounded degree is the standard pattern:

```csharp{title="Parallel Processing" description="Bounded parallel fan-out in application code" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "Parallel", "Processing"] unverified="app-level Parallel.ForEachAsync fan-out; explicitly not Whizbang pipeline work"}
await Parallel.ForEachAsync(
  workItems,
  new ParallelOptions { MaxDegreeOfParallelism = Environment.ProcessorCount, CancellationToken = ct },
  async (item, token) => {
    await ProcessItemAsync(item, token);
  }
);
```

### 3. Async Coordination

Use `SemaphoreSlim` for async locking:

```csharp{title="Async Coordination" description="Use SemaphoreSlim for async locking:" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "Async", "Coordination"] unverified="general SemaphoreSlim async-locking idiom (incl. anti-pattern); not a Whizbang API"}
// ✅ GOOD - Async-friendly
private readonly SemaphoreSlim _lock = new(1, 1);

public async Task ProcessAsync() {
  await _lock.WaitAsync();
  try {
    // Critical section
  } finally {
    _lock.Release();
  }
}

// ❌ BAD - Blocks thread
private readonly object _lock = new();

public async Task ProcessAsync() {
  lock (_lock) {  // Don't use lock() with async
    await SomeAsyncOperation();  // Deadlock risk
  }
}
```

---

## Key Takeaways

✅ **Zero Allocations** - Source-generated dispatch, no reflection
✅ **Object Pooling** - Built-in `PolicyContextPool`, `ArrayPool<T>` for buffers
✅ **Batching Built In** - `process_work_batch` + sliding-window transport batching, tuned via options
✅ **Explicit Parallelism Knobs** - `MaxConcurrentMessages` and batch windows are config; no auto-tuning shipped
✅ **Indexes** - Optimize your app tables; Whizbang manages its own `wh_*` indexes
✅ **Profiling** - BenchmarkDotNet, dotnet-trace, Application Insights, `whizbang.*` meters
✅ **Span<T> / ValueTask** - Avoid allocations on hot paths

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
