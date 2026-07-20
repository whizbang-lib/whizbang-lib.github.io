---
title: Perspective Worker
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Workers
order: 1
description: >-
  Background worker for materializing perspectives - channel-fed processing,
  NOTIFY-driven wake, event deduplication, completion strategies, and
  lease-based coordination
tags: >-
  perspective-worker, cursors, background-worker, lease-based-coordination,
  deduplication, error-tracking
codeReferences:
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
  - src/Whizbang.Core/Workers/ClaimWorker.cs
  - src/Whizbang.Core/Workers/ProcessedEventCache.cs
  - src/Whizbang.Core/Workers/IProcessedEventCacheObserver.cs
  - src/Whizbang.Core/Workers/IPerspectiveCompletionStrategy.cs
  - src/Whizbang.Core/Workers/PerspectiveCompletionFlushWorker.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Data.Postgres/Migrations/009_CreatePerspectiveEventsTable.sql
  - src/Whizbang.Data.Postgres/Migrations/042_FetchPendingPerspectiveEvents.sql
  - src/Whizbang.Data.Postgres/Migrations/037_CompletePerspectiveEvents.sql
  - src/Whizbang.Data.Postgres/Migrations/005_CreateCompletePerspectiveCheckpointFunction.sql
testReferences:
  - tests/Whizbang.Core.Tests/Workers/PerspectiveWorkerChannelModeTests.cs
  - tests/Whizbang.Core.Tests/Workers/PerspectiveWorkerDedupTests.cs
  - tests/Whizbang.Core.Tests/Workers/ProcessedEventCacheTests.cs
  - tests/Whizbang.Core.Tests/Workers/PerspectiveWorkerStrategyTests.cs
  - tests/Whizbang.Core.Tests/Workers/PerspectiveCompletionStrategyTests.cs
  - tests/Whizbang.Core.Tests/Workers/PerspectiveWorkerSecurityContextTests.cs
  - tests/Whizbang.Core.Tests/Workers/PerspectiveWorkerDrainModeTests.cs
lastMaintainedCommit: '01f07906'
---

# Perspective Worker

The **PerspectiveWorker** is a background service (`BackgroundService`) that materializes perspectives: it consumes claimed perspective work from in-process channels, fetches pending events per stream, invokes perspective runners, deduplicates re-delivered events, and reports completions back to the database.

:::updated
Earlier versions described a poll-driven "4-phase checkpoint system" (`auto_create_perspective_checkpoints` trigger, `wh_perspective_mappings` fuzzy matching, `claim_perspective_checkpoint_work`). That architecture has been replaced. As shipped, work claiming is done by the dedicated **ClaimWorker** (`claim_work` SQL function), per-event work rows live in **`wh_perspective_events`**, cursors live in **`wh_perspective_cursors`** (renamed from `wh_perspective_checkpoints` in migration 033), and the PerspectiveWorker consumes **channels** instead of polling SQL directly. This page documents the shipped architecture.
:::

## Overview

### What the Perspective Worker Does

1. **Consumes** perspective work channels fed by `ClaimWorker` (drain stream ids via `IPerspectiveDrainChannel`, legacy `PerspectiveWork` items via `IPerspectiveChannelWriter`)
2. **Batches** drain signals with a sliding window so bursts for the same stream coalesce into one apply pass
3. **Fetches** pending events per stream (`claim_and_fetch_pending_perspective_events` / `fetch_pending_perspective_events`)
4. **Resolves** the appropriate `IPerspectiveRunner` for each (stream, perspective) pair and applies events
5. **Deduplicates** events that SQL re-delivers during the batched-completion window (see [Event Deduplication](#event-deduplication))
6. **Reports** completions and failures through batched flush channels
7. **Fires** lifecycle stages (`PostAllPerspectives`, `PostLifecycle`) once per batch

**Key Insight**: The PerspectiveWorker is the runtime engine that turns compile-time perspective discovery (source generators) into a running system. Database claiming and leasing are handled upstream by `ClaimWorker`; the PerspectiveWorker's loop is wake-on-signal, not poll-per-interval.

---

## The Perspective Work Pipeline

```mermaid{caption="Perspective work pipeline — events land in wh_perspective_events and NOTIFY the ClaimWorker, which leases rows and pushes stream ids to the drain channel; the PerspectiveWorker sliding-window batches, fetches pending events, dedups, and applies them, then the flush worker completes rows and advances cursors."}
sequenceDiagram
    participant ES as Event Store
    participant PE as wh_perspective_events
    participant CW as ClaimWorker
    participant CH as Channels
    participant PW as PerspectiveWorker
    participant PR as IPerspectiveRunner
    participant FL as PerspectiveCompletionFlushWorker

    Note over ES,PE: 1. Event arrival
    ES->>PE: store_perspective_events() — one row per<br/>(stream_id, perspective_name, event_id)
    PE-->>CW: NOTIFY (perspective signal)

    Note over CW,CH: 2. Claim & distribute
    CW->>PE: claim_work() — lease rows<br/>(instance_id, lease_expiry)
    CW->>CH: stream ids → IPerspectiveDrainChannel

    Note over PW,PR: 3. Drain & apply
    CH-->>PW: WaitToReadAsync (wake)
    PW->>PW: Sliding-window batch drain signals
    PW->>PE: claim_and_fetch_pending_perspective_events(stream_id)
    PW->>PW: ProcessedEventCache filter (dedup)
    PW->>PR: Apply events since cursor
    PR-->>PW: completions / failures

    Note over PW,FL: 4. Complete
    PW->>FL: EnqueueEventWorkIdAsync / EnqueueCursorAsync
    FL->>PE: CompletePerspectiveAsync →<br/>complete_perspective_events (delete rows)
    FL->>FL: advance wh_perspective_cursors<br/>+ cleanup_completed_streams
```

**Stages**:

1. **Event arrival** — when events are persisted, `store_perspective_events` (migration 022) inserts one ephemeral work row per (stream, perspective, event) into `wh_perspective_events` (migration 009), and a NOTIFY signal wakes the claim loop
2. **Claim & distribute** — `ClaimWorker` calls the `claim_work` SQL function (migration 029), which leases work rows (`instance_id`, `lease_expiry`) and returns drain stream ids; ClaimWorker writes them to the drain channel
3. **Drain & apply** — PerspectiveWorker consumer loops read the channels, fetch pending events per stream in event-id order, filter duplicates, and invoke runners
4. **Complete** — completions flow through `PerspectiveCompletionFlushWorker`, which calls `IWorkCoordinator.CompletePerspectiveAsync`: processed `wh_perspective_events` rows are deleted (`complete_perspective_events`, migration 037 — or kept with a marker in [debug mode](#configuration)), cursors advance in `wh_perspective_cursors`, and fully-drained streams are evicted from `wh_active_streams`

**Cursor tracking**: `wh_perspective_cursors` records `(stream_id, perspective_name) → last_event_id, status, error`. Status is a flags value of `PerspectiveProcessingStatus` (`None=0`, `Processing=1`, `Completed=2`, `Failed=4`, `CatchingUp=8`). `complete_perspective_cursor_work` (migration 005) marks **only explicitly-listed event ids** as processed, so concurrent late-arriving events are never swallowed by range-based cursor advancement.

---

## Wake Semantics: NOTIFY + Safety-Net Polling

The consumer loop blocks on four wake sources simultaneously: the work channel, the drain channel, the perspective NOTIFY signal, and an idle timeout.

```csharp{title="Wake Semantics" description="Channel consumer loop wake sources" category="Implementation" difficulty="ADVANCED" tags=["Operations", "Workers", "Wake", "NOTIFY"] unverified="verified by PerspectiveWorkerChannelModeTests, which is outside the current coverage map"}
// When the NOTIFY listener is wired, use the relaxed cadence
// (safety-net only); otherwise fall back to the legacy tight cadence so a
// NOTIFY outage doesn't introduce latency.
var pollMs = _perspectiveNotificationListener is null
  ? _options.PollingIntervalMilliseconds
  : Math.Max(_options.PollingIntervalMilliseconds, _options.NotifyHealthyPollingIntervalMilliseconds);
var idleTimeout = Task.Delay(pollMs, stoppingToken);

await Task.WhenAny(workWait, drainWait, idleTimeout, perspectiveSignal);
```

- With the multiplexed NOTIFY listener wired, every `wh_perspective_events` insert fires a `WorkSignalCategory.Perspective` signal — the worker wakes immediately on new work
- The idle timeout is a **safety net** for missed signals (`NotifyHealthyPollingIntervalMilliseconds`, default **1000 ms**); without a listener the loop runs at `PollingIntervalMilliseconds` (default **1000 ms**)
- `ClaimWorker` has its own independent cadence: 250 ms tight polling, relaxed to **5000 ms** (`ClaimWorkerOptions.NotifyHealthyPollingIntervalMilliseconds`, v0.684 default) while NOTIFY is verified healthy

### Sliding-Window Drain Batching

After the first drain signal arrives, the worker waits up to `DrainBatcher.SlidingWindow` (default **300 ms**, resetting on each new arrival) for more stream ids, bounded by `MaxWait` (default **3 s**) and `MaxSize` (default **1000**). Bursts of events for the same stream — e.g. a bulk import writing dozens of events milliseconds apart — coalesce into **one** apply cycle with events fetched in monotonic order. The work channel is *not* batched this way; its dedup semantics depend on per-cycle processing.

---

## Startup Sequence

At the top of `ExecuteAsync` the worker:

1. **Subscribes** to the perspective NOTIFY signal (if a listener is wired)
2. **Initializes the perspective registry** — builds the event-type → perspective-names map from `IPerspectiveRunnerRegistry` (used to register complete WhenAll expectations so `PostAllPerspectives` fires once after ALL perspectives complete)
3. **Reconciles orphaned lifecycles** — finds events where all perspectives completed but `PostLifecycle` never fired (process crash) and replays the lifecycle stages
4. **Scans and repairs interrupted rewinds**
5. **Spawns** `MaxConcurrentDrainConsumers` (default 4) parallel channel-consumer loops

The channel dependencies (`IPerspectiveChannelWriter`, `IPerspectiveCompletionChannel`, `IFailureChannel`) are **required at runtime** — they are wired automatically by `AddWhizbang()` (which invokes `AddWhizbangWorkers()`). If they are missing, `ExecuteAsync` throws `InvalidOperationException`; the legacy `ProcessWorkBatchAsync` poll path has been removed.

Database readiness is handled upstream: `ClaimWorker` and the flush workers await [`ISchemaReadyGate`](database-readiness.md) before their first SQL, so perspective work only starts flowing after migrations complete.

### Immediate Poll {#immediate-poll}

External callers can wake the worker without waiting for a signal or timeout:

```csharp{title="Immediate Poll" description="RequestImmediatePoll wakes the worker without waiting for the polling interval" category="Implementation" difficulty="BEGINNER" tags=["Operations", "Workers", "Immediate", "Poll"]}
/// Signals the worker to wake immediately and poll for new perspective events,
/// instead of waiting for the next scheduled polling interval.
/// Safe to call from any thread; redundant calls are harmless.
public void RequestImmediatePoll();
```

The worker also subscribes to `IWorkChannelWriter.OnNewPerspectiveWorkAvailable`, which calls `RequestImmediatePoll` whenever new perspective work is enqueued.

---

## Security Context {#security-context}

The PerspectiveWorker establishes security context before invoking lifecycle receptors and perspective processing, ensuring that `IMessageContext.UserId` and `IScopeContext` are available. This follows the same pattern as `ReceptorInvoker` for consistency across the system.

### How Security Context is Established

Before each perspective event is processed, `_establishSecurityContextAsync` runs:

```csharp{title="How Security Context is Established" description="PerspectiveWorker._establishSecurityContextAsync" category="Implementation" difficulty="ADVANCED" tags=["Operations", "Workers", "Security", "Context"] unverified="verified by PerspectiveWorkerSecurityContextTests, which is outside the current coverage map"}
private static async ValueTask _establishSecurityContextAsync(
    IMessageEnvelope envelope,
    IServiceProvider scopedProvider,
    CancellationToken cancellationToken) {

  IScopeContext? securityContext = null;

  // Establish security context from envelope (same pattern as ReceptorInvoker)
  var securityProvider = scopedProvider.GetService<IMessageSecurityContextProvider>();
  if (securityProvider is not null) {
    securityContext = await securityProvider
      .EstablishContextAsync(envelope, scopedProvider, cancellationToken)
      .ConfigureAwait(false);

    if (securityContext is not null) {
      var accessor = scopedProvider.GetService<IScopeContextAccessor>();
      if (accessor is not null) {
        accessor.Current = securityContext;
      }
    }
  }

  // Fall back to the envelope's scope when extraction returned nothing
  var scopeForMessageContext = securityContext ?? envelope.GetCurrentScope();

  if (securityContext is null && scopeForMessageContext is not null) {
    // Promote to a propagating ImmutableScopeContext so ambient security flows to
    // lifecycle handlers that append events, and invoke security callbacks manually.
    var immutableScope = ImmutableScopeContext.PromoteToPropagating(scopeForMessageContext);
    scopeForMessageContext = immutableScope;

    var accessor = scopedProvider.GetService<IScopeContextAccessor>();
    if (accessor is not null) {
      accessor.Current = immutableScope;
    }

    var callbacks = scopedProvider.GetServices<ISecurityContextCallback>();
    foreach (var callback in callbacks) {
      cancellationToken.ThrowIfCancellationRequested();
      await callback.OnContextEstablishedAsync(immutableScope, envelope, scopedProvider, cancellationToken)
        .ConfigureAwait(false);
    }
  }

  // Build + establish the message context via the ONE shared step (identity + scope +
  // both accessors) — the same helper ReceptorInvoker and SecurityContextHelper use.
  Security.SecurityContextHelper.BuildAndEstablishMessageContext(envelope, scopeForMessageContext, scopedProvider);
}
```

### When Security Context is Established

Security context is established **per envelope**, at every point where perspective processing or lifecycle receptors run — including before pre-perspective lifecycle stages, before batch apply, before post-perspective lifecycle stages, and when reconciling orphaned lifecycles on startup. Each event carries its own user context, even in multi-tenant or multi-user batches.

### Graceful Handling

The establishment is fault-tolerant:

- **No security provider registered**: falls back to the envelope's scope; processing continues
- **Provider returns null but envelope has scope**: the scope is promoted to a propagating `ImmutableScopeContext` and security callbacks are invoked manually
- **No accessors registered**: processing continues without ambient context

This ensures perspectives work in environments without security infrastructure (simple tests, migration scripts).

### Per-Envelope Context

```mermaid{caption="Per-envelope security context — each envelope re-establishes its own UserId before its lifecycle stage runs, so envelope 1 (user-a) and envelope 2 (user-b) never share context within a batch."}
sequenceDiagram
    participant PW as PerspectiveWorker
    participant SC as SecurityContext
    participant LC as LifecycleInvoker

    Note over PW: Process envelope 1 (user-a)
    PW->>SC: _establishSecurityContextAsync(envelope1)
    SC-->>SC: Set UserId = "user-a"
    PW->>LC: Lifecycle stage (envelope1)
    Note over LC: UserId = "user-a"

    Note over PW: Process envelope 2 (user-b)
    PW->>SC: _establishSecurityContextAsync(envelope2)
    SC-->>SC: Set UserId = "user-b"
    PW->>LC: Lifecycle stage (envelope2)
    Note over LC: UserId = "user-b"
```

---

## Lease-Based Coordination

Work distribution across instances is lease-based, but leases live on the **ephemeral event rows** (`wh_perspective_events`), not on cursors:

- **Claim**: `claim_work` stamps `instance_id` and `lease_expiry` (now + `LeaseSeconds`, default 300 s) on claimed rows; `FOR UPDATE SKIP LOCKED` prevents two instances claiming the same rows
- **Stream affinity**: `wh_active_streams` (migration 007) pins each stream to one owning pod, so events for a stream drain on a single instance; each service schema has its own `wh_active_streams`
- **Intra-pod affinity gate**: within a pod, a per-(stream_id, perspective_name) `SemaphoreSlim` serializes concurrent writes for the same tuple while preserving cross-stream and cross-perspective parallelism
- **Renewal**: long-running applies renew leases through `ILeaseRenewalChannel` / `LeaseRenewalWorker`
- **Release**: completion deletes the event rows (`complete_perspective_events`), so there is nothing left to lease
- **Reclaim**: if an instance dies, its heartbeat goes stale; after `AbandonStaleInstanceThresholdSeconds` (default 30 s) its leases are released, and `claim_orphaned_perspective_events` (migration 027) redistributes unowned work across alive instances via partition-modulo (`partition_number % active_instance_count = instance_rank`)

**Benefits**:
- ✅ **Fault tolerance**: crashed workers' leases expire; work is reclaimed automatically
- ✅ **Scalability**: streams distribute across instances; different streams process in parallel
- ✅ **No conflicts**: `SKIP LOCKED` claiming + single-owner streams + intra-pod gates make double-apply structurally impossible
- ✅ **Observability**: `instance_id` on leased rows shows which worker holds what

---

## Configuration {#configuration}

**PerspectiveWorkerOptions** (defaults from source):

```csharp{title="Configuration" description="PerspectiveWorkerOptions with shipped defaults" category="Implementation" difficulty="ADVANCED" tags=["Operations", "Workers", "Configuration"] unverified="worker config/DI wiring — not exercised by a test"}
public class PerspectiveWorkerOptions {
  /// Base wake cadence when no NOTIFY listener is available. Default: 1000 (1 second).
  public int PollingIntervalMilliseconds { get; set; } = 1000;

  /// Safety-net cadence when LISTEN/NOTIFY is verified healthy. Default: 1000 (1 s) —
  /// kept tight because brand-new streams receive no per-instance NOTIFY on their
  /// first batch. Production environments with reliable LISTEN connections can raise
  /// this (30000+) to reduce poll volume.
  public int NotifyHealthyPollingIntervalMilliseconds { get; set; } = 1_000;

  /// Dead-letter threshold for wh_perspective_events rows: total apply attempts
  /// permitted before the row moves to wh_dead_letters. Default: 10. Null = no limit.
  public int? MaxPerspectiveEventAttempts { get; set; } = 10;

  /// Lease duration in seconds. Also drives the dedup cache retention period.
  /// Default: 300 (5 minutes).
  public int LeaseSeconds { get; set; } = 300;

  /// Grace period before a non-heartbeating instance is abandoned and its leases
  /// released. Default: 30 seconds.
  public int AbandonStaleInstanceThresholdSeconds { get; set; } = 30;

  /// Keep completed rows for debugging instead of deleting them. Default: false.
  public bool DebugMode { get; set; }

  /// Number of partitions for work distribution. Default: 10000.
  public int PartitionCount { get; set; } = 10_000;

  /// Consecutive empty polls required to fire OnWorkProcessingIdle. Default: 2.
  public int IdleThresholdPolls { get; set; } = 2;

  /// Events per batch before saving model + cursor. Default: 100.
  public int PerspectiveBatchSize { get; set; } = 100;

  /// Max perspective groups processed concurrently within a batch. Default: 30.
  public int MaxConcurrentPerspectives { get; set; } = 30;

  /// Parallel channel-consumer loops (outer × inner = concurrency ceiling). Default: 4.
  public int MaxConcurrentDrainConsumers { get; set; } = 4;

  /// Max streams claimed/processed per tick. Default: 300.
  public int MaxStreamsPerBatch { get; set; } = 300;

  /// Per-stream drain loop: max refetch iterations for streams with sustained
  /// arrivals. Default: 5. Set to 1 for single-pass behavior.
  public int DrainLoopMaxIterations { get; set; } = 5;

  /// Minimum batch size that triggers a drain-loop refetch. Default: 2.
  public int DrainLoopRefetchMinBatch { get; set; } = 2;

  /// Sliding-window batching for drain signals.
  /// Defaults: 300 ms debounce / 3 s hard cap / 1000 signal ceiling.
  public SlidingWindowBatcherOptions DrainBatcher { get; set; } = new() {
    SlidingWindow = TimeSpan.FromMilliseconds(300),
    MaxWait = TimeSpan.FromSeconds(3),
    MaxSize = 1000,
  };

  /// Retry configuration (exponential backoff) for completion acknowledgement.
  public WorkerRetryOptions RetryOptions { get; set; } = new();
}
```

**Configuration Example**:
```csharp{title="Configuration (2)" description="Configuration Example:" category="Implementation" difficulty="BEGINNER" tags=["Operations", "Workers", "Configuration"] unverified="worker config/DI wiring — not exercised by a test"}
// Program.cs
builder.Services.Configure<PerspectiveWorkerOptions>(options => {
  options.LeaseSeconds = 600;             // 10-minute leases (longer processing time)
  options.DebugMode = true;               // Keep completed rows for debugging
  options.PerspectiveBatchSize = 50;      // Smaller batches for faster commits
  options.MaxConcurrentPerspectives = 60; // More intra-batch parallelism
});
```

**Tuning Guidelines**:
- **High throughput**: raise `PerspectiveBatchSize` and `MaxConcurrentPerspectives`
- **Fault tolerance**: lower `LeaseSeconds` (faster reclaim after crashes — but also shorter dedup retention)
- **Long processing**: raise `LeaseSeconds` (e.g. 1800 for slow perspectives)
- **Steady-state DB load**: raise `NotifyHealthyPollingIntervalMilliseconds` when LISTEN/NOTIFY is reliable

---

## Completion Strategy Pattern

The PerspectiveWorker uses a **completion strategy** to control when cursor completions/failures are reported. This provides flexibility for different environments (production vs testing).

### Strategy Interface

**IPerspectiveCompletionStrategy**:
```csharp{title="Strategy Interface" description="IPerspectiveCompletionStrategy:" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "Strategy", "Interface"] tests=["PerspectiveCompletionStrategyTests.BatchedStrategy_AcknowledgementFlow_RemovesAcknowledgedItems_Async", "PerspectiveCompletionStrategyTests.BatchedStrategy_GetPendingCompletions_ReturnsCollectedCompletions_Async", "PerspectiveCompletionStrategyTests.BatchedStrategy_GetPendingFailures_ReturnsCollectedFailures_Async"]}
public interface IPerspectiveCompletionStrategy {
  /// Reports a perspective cursor completion.
  Task ReportCompletionAsync(
    PerspectiveCursorCompletion completion,
    IWorkCoordinator coordinator,
    CancellationToken cancellationToken);

  /// Reports a perspective cursor failure.
  Task ReportFailureAsync(
    PerspectiveCursorFailure failure,
    IWorkCoordinator coordinator,
    CancellationToken cancellationToken);

  /// Pending completions collected but not yet reported (empty for instant strategies).
  TrackedCompletion<PerspectiveCursorCompletion>[] GetPendingCompletions();

  /// Pending failures collected but not yet reported.
  TrackedCompletion<PerspectiveCursorFailure>[] GetPendingFailures();

  /// Mark items as sent to the coordinator.
  void MarkAsSent(
    TrackedCompletion<PerspectiveCursorCompletion>[] completions,
    TrackedCompletion<PerspectiveCursorFailure>[] failures,
    DateTimeOffset sentAt);

  /// Mark oldest N items as acknowledged based on coordinator-confirmed counts.
  void MarkAsAcknowledged(int completionCount, int failureCount);

  /// Clear all acknowledged items.
  void ClearAcknowledged();

  /// Reset stale items back to pending with exponential backoff.
  void ResetStale(DateTimeOffset now);
}
```

Note the send/acknowledge split: items are tracked through **pending → sent → acknowledged** states, with `ResetStale` re-queuing items whose acknowledgement never arrived (exponential backoff via `WorkerRetryOptions`).

### Built-In Strategies

#### BatchedCompletionStrategy (Default)

**Purpose**: Collects completions in memory and reports them on the **next cycle**.

```mermaid{caption="Batched completion flow — cycle N stores completions in memory without calling the coordinator; cycle N+1 drains GetPendingCompletions, flushes them in one round-trip, then MarkAsAcknowledged clears them." tests=["PerspectiveCompletionStrategyTests.BatchedStrategy_ReportCompletionAsync_DoesNotCallCoordinatorImmediately_Async", "PerspectiveCompletionStrategyTests.BatchedStrategy_GetPendingCompletions_ReturnsCollectedCompletions_Async", "PerspectiveCompletionStrategyTests.BatchedStrategy_AcknowledgementFlow_RemovesAcknowledgedItems_Async"]}
sequenceDiagram
    participant PW as PerspectiveWorker
    participant S as BatchedStrategy
    participant WC as WorkCoordinator

    Note over PW,WC: Cycle N: Process perspectives
    PW->>S: ReportCompletionAsync(completion1)
    Note over S: Store in memory (pending)
    PW->>S: ReportCompletionAsync(completion2)
    Note over S: Store in memory (pending)

    Note over PW,WC: Cycle N+1: Report results
    PW->>S: GetPendingCompletions()
    S-->>PW: [completion1, completion2]
    PW->>WC: flush completions
    WC-->>WC: Persist to database
    PW->>S: MarkAsAcknowledged(2, 0)
```

**When to use**:
- ✅ **Production** - minimizes database round-trips
- ✅ **High throughput** - batches multiple completions per flush

**Trade-off**: results are visible after the next cycle rather than immediately.

#### InstantCompletionStrategy

**Purpose**: Reports completions **immediately** via out-of-band coordinator methods; nothing is held in memory.

**When to use**:
- ✅ **Test environments** - immediate consistency for assertions
- ✅ **Low latency requirements** - results visible immediately

**Example**:
```csharp{title="InstantCompletionStrategy" description="Injecting the instant strategy" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "InstantCompletionStrategy"] tests=["PerspectiveWorkerStrategyTests.PerspectiveWorker_WithInstantStrategy_ReportsImmediately_Async"]}
// Register before AddWhizbang so the worker picks it up from DI
builder.Services.AddSingleton<IPerspectiveCompletionStrategy, InstantCompletionStrategy>();
```

**Trade-off**: one database call per completion.

### Out-of-Band Reporting Methods

`InstantCompletionStrategy` uses lightweight out-of-band methods on `IWorkCoordinator`:

```csharp{title="Out-of-Band Reporting Methods" description="ReportPerspectiveCompletionAsync / ReportPerspectiveFailureAsync" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "Out-of-Band", "Reporting"] tests=["PerspectiveCompletionStrategyTests.InstantStrategy_ReportCompletionAsync_CallsCoordinatorImmediately_Async", "PerspectiveCompletionStrategyTests.InstantStrategy_ReportFailureAsync_CallsCoordinatorImmediately_Async"]}
// Lightweight: ONLY updates the perspective cursor — no heartbeats, no work claiming.
// Calls the complete_perspective_cursor_work SQL function directly.
await coordinator.ReportPerspectiveCompletionAsync(
  new PerspectiveCursorCompletion {
    StreamId = streamId,
    PerspectiveName = "OrderSummaryPerspective",
    LastEventId = lastEventId,
    Status = PerspectiveProcessingStatus.Completed
  },
  cancellationToken
);

await coordinator.ReportPerspectiveFailureAsync(
  new PerspectiveCursorFailure {
    StreamId = streamId,
    PerspectiveName = "OrderSummaryPerspective",
    LastEventId = lastEventId,
    Status = PerspectiveProcessingStatus.Failed,
    Error = ex.Message
  },
  cancellationToken
);
```

### Choosing a Strategy

| Factor | BatchedCompletionStrategy | InstantCompletionStrategy |
|--------|---------------------------|---------------------------|
| **Database Load** | ✅ Low (batched) | ⚠️ Higher (per-completion) |
| **Latency** | ⚠️ Delayed (~1 cycle) | ✅ Immediate |
| **Best For** | Production | Tests, low-latency |
| **Delivery Guarantee** | Tracked send/ack + stale retry | Direct call |
| **Simplicity** | ✅ Default behavior | Requires registration |

---

## Event Deduplication {#event-deduplication}

The PerspectiveWorker includes a built-in **two-phase TTL cache** (`ProcessedEventCache`) that prevents duplicate `Apply` calls when SQL re-delivers events during the batched completion window.

### The Problem

With `BatchedCompletionStrategy`, completions are deferred to the next cycle. During that window:

1. **Cycle N**: Events are processed, Apply is called, completions queued in memory
2. **Cycle N+1**: Completions from Cycle N are flushed to SQL
3. **The gap**: Between Cycle N completing and the flush being acknowledged, SQL can return the same events again

Without deduplication, the runner would call Apply a second time for events that were already processed.

### How It Works

The cache operates in two phases:

```mermaid{caption="ProcessedEventCache two-phase TTL — entries enter InFlight (never expiring) after Apply, move to Retained with a lease-aligned countdown once the DB acknowledges via ActivateRetention, and are Evicted only after the TTL lapses." tests=["ProcessedEventCacheTests.InFlight_NeverExpires_UntilActivatedAsync", "ProcessedEventCacheTests.ActivateRetention_StartsCountdownAsync", "ProcessedEventCacheTests.EvictExpired_RemovesOnlyRetainedPastTtlAsync"]}
stateDiagram-v2
    direction LR
    InFlight: InFlight (no expiry)
    Retained: Retained (TTL active)
    Evicted: Evicted (removed)

    InFlight --> Retained: ActivateRetention() (after DB ack)
    Retained --> Evicted: TTL expires
```

- **InFlight**: Added after Apply completes. Cannot expire — guards until the database confirms the completion was processed.
- **Retained**: After the coordinator acknowledges the flush (`MarkAsAcknowledged`), `ActivateRetention()` is called. The lease-aligned TTL (default 5 minutes) starts counting down from this moment.
- **Evicted**: After TTL expires, `EvictExpired()` removes entries. This correctly allows reprocessing for rewind/rebuild scenarios (rewind also force-removes entries via `RemoveRange`).

### Configuration

Event deduplication is **automatic** — it uses the existing `LeaseSeconds` option (default: 300 seconds / 5 minutes) as the retention period.

```csharp{title="Event Deduplication Configuration" description="Configuring event deduplication retention period" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Workers", "Deduplication"] unverified="worker config/DI wiring — not exercised by a test"}
builder.Services.Configure<PerspectiveWorkerOptions>(options => {
  options.LeaseSeconds = 300;  // Dedup retention aligns to lease duration (default: 5 min)
});
```

### Dedup Observer {#dedup-observer}

Register an `IProcessedEventCacheObserver` for debugging, metrics, or test assertions:

```csharp{title="Dedup Observer" description="Implementing IProcessedEventCacheObserver for debugging" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "Deduplication", "Observer"] tests=["ProcessedEventCacheTests.Observer_OnEventsMarkedInFlight_CalledAsync", "ProcessedEventCacheTests.Observer_OnRetentionActivated_CalledAsync", "ProcessedEventCacheTests.Observer_OnEvicted_CalledAsync", "ProcessedEventCacheTests.Observer_OnEventsRemoved_CalledAsync"]}
public class MetricsDedupObserver : IProcessedEventCacheObserver {
  public void OnEventsDeduped(IReadOnlyList<Guid> dedupedEventIds, string perspectiveName, Guid streamId) {
    // Log or emit metrics when events are skipped as duplicates
    Console.WriteLine($"Dedup: skipped {dedupedEventIds.Count} events for {perspectiveName}/{streamId}");
  }

  public void OnEventsMarkedInFlight(IReadOnlyList<Guid> eventIds) { }
  public void OnRetentionActivated(int count) { }
  public void OnEvicted(int count) { }
  public void OnEventsRemoved(IReadOnlyList<Guid> eventIds) { }
}

// Register in DI
builder.Services.AddSingleton<IProcessedEventCacheObserver, MetricsDedupObserver>();
```

---

## Completion Flush Path

Completions and failures leave the worker through bounded channels drained by dedicated flush workers (Phase C of the work-pump decomposition):

- **`PerspectiveCompletionFlushWorker`** (implements `IPerspectiveCompletionChannel`) batches event-work-id deletions and cursor advancements via `BatchFlusher<T>` and calls `IWorkCoordinator.CompletePerspectiveAsync(cursors, workIds, debugMode)` in one round-trip. After completions land, it opportunistically calls `CleanupCompletedStreamsAsync` so fully-drained streams exit `wh_active_streams` (the SQL self-checks pending work — passing a stream that still has work is a safe no-op).
- **`FailureFlushWorker`** (implements `IFailureChannel`) coalesces failures per category and calls `IWorkCoordinator.ReportFailuresAsync`.
- Both workers await `ISchemaReadyGate` before flushing.

**Atomicity**: each flush batch persists in a single database call; unacknowledged items are retried with exponential backoff (`ResetStale`), so a crash mid-flush loses nothing — SQL re-delivers, and the dedup cache prevents double-apply.

---

## Error Tracking & Retry

**Failure workflow**:

1. Exception thrown during perspective processing is caught per (stream, perspective) group
2. A `PerspectiveCursorFailure` is created — `StreamId`, `PerspectiveName`, `LastEventId`, `Status = Failed`, `Error = ex.Message`, plus `ProcessedEventIds` for the events that *did* apply before the failure
3. The failure flows through the completion strategy / failure channel to SQL
4. `complete_perspective_cursor_work` persists the error to `wh_perspective_cursors.error`, marks only the actually-processed event ids, and sets the failed status
5. Un-processed `wh_perspective_events` rows remain, with `attempts` incremented — they are re-claimed and retried on later cycles

**Dead-lettering**: when a `wh_perspective_events` row's attempts exceed `MaxPerspectiveEventAttempts` (default **10**), the worker moves it into `wh_dead_letters` via `IDeadLetterStore` **before** deserialization + apply. Set the option to `null` to restore the legacy accumulate-forever behavior.

**Example error record**:
```sql{title="Error Tracking & Retry" description="Example error record in wh_perspective_cursors" category="Implementation" difficulty="BEGINNER" tags=["Operations", "Workers", "Error", "Tracking"]}
-- wh_perspective_cursors after a failure (status is a flags SMALLINT: 4 = Failed)
stream_id                            | perspective_name        | status | error
-------------------------------------|-------------------------|--------|------------------
0197a3b2-...                         | OrderSummaryPerspective |      4 | Null reference exception: customerId
```

---

## Processing Hooks {#processing-hooks}

The worker exposes first-class events for production monitoring and deterministic test synchronization (no `Task.Delay` polling needed):

| Member | Fires |
|--------|-------|
| `OnWorkProcessingStarted` | Idle → active transition (work appeared after empty polls) |
| `OnWorkProcessingIdle` | Active → idle transition, after `IdleThresholdPolls` consecutive empty polls (default 2) |
| `OnBatchCycleComplete` | Once per worker tick after ALL phases (drain processing, `PostAllPerspectives`, `PostLifecycle`, metrics) — fires whether or not work was found |
| `OnPerspectiveEventProcessed` | Synchronously after a perspective successfully processes events for a stream |
| `ConsecutiveEmptyPolls` (property) | Count of consecutive empty polls; resets when work is found |
| `IsIdle` (property) | Whether the worker is currently idle |
| `RequestImmediatePoll()` | Wakes the worker immediately (see [Immediate Poll](#immediate-poll)) |

**Example Usage**:
```csharp{title="Processing Hooks" description="Example Usage:" category="Implementation" difficulty="BEGINNER" tags=["Operations", "Workers", "Events"]}
var worker = serviceProvider.GetRequiredService<PerspectiveWorker>();

worker.OnWorkProcessingIdle += () => {
  Console.WriteLine("All perspective work processed!");
};
```

### Database Queries

**Check cursor status** (status is a flags value: 1=Processing, 2=Completed, 4=Failed, 8=CatchingUp):
```sql{title="Database Queries" description="Check cursor status:" category="Implementation" difficulty="BEGINNER" tags=["Operations", "Workers", "Database", "Queries"]}
SELECT
  perspective_name,
  COUNT(*) FILTER (WHERE status & 1 = 1) AS processing,
  COUNT(*) FILTER (WHERE status & 2 = 2) AS completed,
  COUNT(*) FILTER (WHERE status & 4 = 4) AS failed,
  COUNT(*) FILTER (WHERE status & 8 = 8) AS catching_up
FROM wh_perspective_cursors
GROUP BY perspective_name;
```

**Find failed cursors**:
```sql{title="Database Queries (2)" description="Find failed cursors:" category="Implementation" difficulty="BEGINNER" tags=["Operations", "Workers", "Database", "Queries"]}
SELECT stream_id, perspective_name, error, processed_at
FROM wh_perspective_cursors
WHERE status & 4 = 4
ORDER BY processed_at DESC;
```

**Check pending / leased event work**:
```sql{title="Database Queries (3)" description="Check pending perspective event work:" category="Implementation" difficulty="BEGINNER" tags=["Operations", "Workers", "Database", "Queries"]}
SELECT perspective_name,
  COUNT(*)                                   AS pending_rows,
  COUNT(*) FILTER (WHERE instance_id IS NOT NULL
                     AND lease_expiry > NOW()) AS leased,
  MAX(attempts)                              AS max_attempts
FROM wh_perspective_events
GROUP BY perspective_name;
```

**Check worker health**:
```sql{title="Database Queries (4)" description="Check worker health:" category="Implementation" difficulty="BEGINNER" tags=["Operations", "Workers", "Database", "Queries"]}
SELECT instance_id, service_name, last_heartbeat_at,
  NOW() - last_heartbeat_at AS time_since_heartbeat
FROM wh_service_instances
ORDER BY last_heartbeat_at DESC;
```

---

## Best Practices

### DO ✅

- ✅ **Register via `AddWhizbang()`** - channel dependencies are wired automatically
- ✅ **Track errors** - monitor `wh_perspective_cursors.error` and `wh_perspective_events.attempts`
- ✅ **Monitor dead letters** - alert on `wh_dead_letters` growth
- ✅ **Use appropriate lease duration** - balance fault tolerance, processing time, and dedup retention
- ✅ **Configure batch size** - tune `PerspectiveBatchSize` for your workload
- ✅ **Use `DebugMode`** - keep completed rows for troubleshooting in non-production
- ✅ **Use the processing hooks in tests** - `OnWorkProcessingIdle` / `OnBatchCycleComplete` instead of `Task.Delay`

### DON'T ❌

- ❌ Set lease duration too short (thrashing, reclaim of live work, short dedup window)
- ❌ Set lease duration too long (slow recovery from crashes)
- ❌ Ignore failed cursors (silent data staleness)
- ❌ Process perspective events outside the worker (breaks coordination and dedup)
- ❌ Manually modify cursor or event rows (breaks consistency)
- ❌ Register multiple services with the same `IServiceInstanceProvider.InstanceId` (see Troubleshooting)

---

## Troubleshooting

### Problem: Perspectives Not Materializing

**Symptoms**: `wh_perspective_events` rows accumulate; perspective tables stay empty.

**Causes**:
1. `ClaimWorker` not running or disabled (`ClaimWorkerOptions.Enabled = false`)
2. Schema gate never opened (migrations failed — see [Database Readiness](database-readiness.md))
3. `IPerspectiveRunnerRegistry` not registered / no runner for the perspective name
4. Channel dependencies missing (worker throws `InvalidOperationException` on startup)

**Solution**:
```csharp{title="Problem: Perspectives Not Materializing" description="Checklist" category="Implementation" difficulty="BEGINNER" tags=["Operations", "Workers", "Problem:", "Checkpoints"] unverified="worker config/DI wiring — not exercised by a test"}
// 1. Use AddWhizbang() — registers ClaimWorker, PerspectiveWorker, flush workers, channels
builder.Services.AddWhizbang(/* ... */);

// 2. Ensure perspective runners are registered (source-generated)
builder.Services.AddPerspectiveRunners();

// 3. Check logs for missing runners
// "No IPerspectiveRunner found for perspective {PerspectiveName}"
```

### Problem: Duplicate Processing

**Symptoms**: Same event applied multiple times, tag hooks firing repeatedly (~5 minutes apart).

**Causes**:
1. Batched completion window — SQL re-delivers events before completions are acknowledged
2. Lease duration too short — events reclaimed by another instance before completion
3. Clock skew between database and application servers

**Solution**:

The built-in `ProcessedEventCache` automatically prevents duplicate `Apply` calls. See [Event Deduplication](#event-deduplication) for details.

If duplicates persist, check:

```csharp{title="Problem: Duplicate Processing" description="Demonstrates problem: Duplicate Processing" category="Implementation" difficulty="BEGINNER" tags=["Operations", "Workers", "Problem:", "Duplicate"] unverified="worker config/DI wiring — not exercised by a test"}
// 1. Register a dedup observer to confirm dedup is working
builder.Services.AddSingleton<IProcessedEventCacheObserver, MetricsDedupObserver>();

// 2. Increase lease duration if needed (also increases dedup retention)
builder.Services.Configure<PerspectiveWorkerOptions>(options => {
  options.LeaseSeconds = 600;  // 10 minutes
});

// 3. Check database server time vs application server time
// SELECT NOW();  -- Database time
// Console.WriteLine(DateTimeOffset.UtcNow);  -- Application time
```

### Problem: Failed Work Accumulating

**Symptoms**: Rising `attempts` on `wh_perspective_events` rows; failed cursors; dead letters appearing.

**Causes**:
1. Perspective runner throwing exceptions (bad data, null references)
2. Database connection issues during apply
3. Timeout during processing

**Solution**:
```sql{title="Problem: Failed Work Accumulating" description="Find most common errors" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "Problem:", "Failed"]}
-- Most common cursor errors
SELECT error, COUNT(*) AS count
FROM wh_perspective_cursors
WHERE status & 4 = 4
GROUP BY error
ORDER BY count DESC;

-- Rows nearing the dead-letter threshold (default MaxPerspectiveEventAttempts = 10)
SELECT stream_id, perspective_name, event_id, attempts, error
FROM wh_perspective_events
WHERE attempts >= 5
ORDER BY attempts DESC;
```

Fix the underlying issue; remaining rows retry automatically. Rows that exceeded the attempt cap are in `wh_dead_letters` and flow through the dead-letter recovery workers.

### Problem: Only One Service Processing Work (Multi-Service Setup)

:::new{type="fix" version="v0.1.1"}
**FIXED IN v0.1.1**: This issue was resolved by ensuring all SQL migrations properly qualify `wh_active_streams` table references with the `__SCHEMA__` placeholder. Each service now has schema-qualified `wh_active_streams` tables (e.g., `inventory.wh_active_streams`, `bff.wh_active_streams`), allowing multiple services to independently process the same streams, matching Azure Service Bus behavior where each service has its own subscription.

**Historical Context**: Earlier versions had unqualified `wh_active_streams` references causing a "last writer wins" race condition where both services would update a shared table, leaving only the last writer with stream ownership.

**Affected functions** (current migration numbering): 007 (table creation), 020 (store_outbox_messages), 021 (store_inbox_messages), 023 (cleanup_completed_streams), 024-026 (claim_orphaned_*), 027 (claim_orphaned_perspective_events).
:::

**Symptoms**: In a multi-service setup (e.g., InventoryWorker and BFF), only one service processes perspective work while the other remains idle. Perspective tables for the idle service remain empty.

**Causes**:
1. **Shared instance ID** - Multiple services using the same `IServiceInstanceProvider.InstanceId`
2. Work coordinator treats multiple services as a single instance
3. Only one service claims and processes work

**Diagnostic Steps**:
```csharp{title="Problem: Only One Service Processing Work (Multi-Service" description="Diagnostic Steps:" category="Implementation" difficulty="BEGINNER" tags=["Operations", "Workers", "Problem:", "Only"] unverified="worker config/DI wiring — not exercised by a test"}
// Enable diagnostic logging to check instance IDs
builder.Logging.SetMinimumLevel(LogLevel.Debug);

// Check logs for instance ID collision
// Look for: "Perspective worker starting: Instance {InstanceId} ({ServiceName}@{HostName})"
// If multiple services show the same InstanceId, you have a collision
```

**Solution**:
```csharp{title="Problem: Only One Service Processing Work (Multi-Service" description="Problem: Only One Service Processing Work (Multi-Service" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "Problem:", "Only"] unverified="counter-example — shared-instance-ID collision (WRONG) contrasted with unique per-service instance IDs (CORRECT)"}
// WRONG: Shared instance ID (causes collision)
private readonly Guid _sharedInstanceId = Guid.CreateVersion7();
builder.Services.AddSingleton<IServiceInstanceProvider>(sp =>
  new TestServiceInstanceProvider(_sharedInstanceId, "InventoryWorker"));  // Same ID for both!

// CORRECT: Unique instance IDs per service
private readonly Guid _inventoryInstanceId = Guid.CreateVersion7();
private readonly Guid _bffInstanceId = Guid.CreateVersion7();

// InventoryWorker host
inventoryBuilder.Services.AddSingleton<IServiceInstanceProvider>(sp =>
  new TestServiceInstanceProvider(_inventoryInstanceId, "InventoryWorker"));

// BFF host
bffBuilder.Services.AddSingleton<IServiceInstanceProvider>(sp =>
  new TestServiceInstanceProvider(_bffInstanceId, "BFF.API"));
```

**Verification**:
```sql{title="Problem: Only One Service Processing Work (Multi-Service" description="Verification:" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "Problem:", "Only"]}
-- Check that both services are active
SELECT instance_id, service_name, last_heartbeat_at
FROM wh_service_instances
WHERE service_name IN ('InventoryWorker', 'BFF.API')
ORDER BY service_name;

-- Should show TWO distinct instance_id values (one per service)
```

**Related**: This issue commonly occurs in test fixtures where multiple services share a single test host. In production, each service typically runs in its own process with a unique instance ID.

---

## Further Reading

**Related Workers**:
- [Execution Lifecycle](execution-lifecycle.md) - Startup/shutdown coordination
- [Database Readiness](database-readiness.md) - Schema-ready gating
- [Lease Semantics](process-work-batch-lease-semantics.md) - Claiming and lease details

**Core Concepts**:
- [Perspectives](../../fundamentals/perspectives/perspectives.md) - What perspectives are
- [Perspective Discovery](../../extending/source-generators/perspective-discovery.md) - Compile-time discovery

**Messaging**:
- [Work Coordinator](../../messaging/work-coordinator.md) - Atomic batch processing
- [Outbox Pattern](../../messaging/outbox-pattern.md) - Reliable event publishing

**Data Access**:
- [Event Store](../../data/event-store.md) - Event sourcing and replay
- [Perspectives Storage](../../data/perspectives-storage.md) - Read model schema design

**Extensibility**:
- [Custom Perspectives](../../extending/extensibility/custom-perspectives.md) - Advanced perspective patterns

---

*Version 1.0.0 - Foundation Release | Last Updated: 2026-07-16*
