---
title: Execution Lifecycle
pageType: concept
verifiedAgainstCommit: eb145727
verifiedDate: 2026-11-03
version: 1.0.0
category: Workers
order: 2
description: >-
  Application startup and shutdown coordination - IExecutionStrategy lifecycle
  hooks, graceful shutdown with work draining, and worker coordination
tags: >-
  execution-lifecycle, startup, shutdown, graceful-shutdown, work-draining,
  lifecycle-hooks
codeReferences:
  - src/Whizbang.Core/Execution/IExecutionStrategy.cs
  - src/Whizbang.Core/Execution/SerialExecutor.cs
  - src/Whizbang.Core/Execution/ParallelExecutor.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
  - src/Whizbang.Core/Workers/ISchemaReadyGate.cs
  - src/Whizbang.Core/Workers/BatchStrategyShutdownFlush.cs
testReferences:
  - tests/Whizbang.Execution.Component.Tests/ExecutionStrategyContractTests.cs
  - tests/Whizbang.Execution.Component.Tests/SerialExecutorTests.cs
  - tests/Whizbang.Execution.Component.Tests/SerialExecutorStopTests.cs
  - tests/Whizbang.Execution.Component.Tests/SerialExecutorDrainAfterStopTests.cs
  - tests/Whizbang.Execution.Component.Tests/SerialExecutorDrainCancellationTests.cs
  - tests/Whizbang.Execution.Component.Tests/SerialExecutorEnqueueFailureTests.cs
  - tests/Whizbang.Execution.Component.Tests/ParallelExecutorDrainTests.cs
lastMaintainedCommit: '01f07906'
---

# Execution Lifecycle

The **Execution Lifecycle** defines how Whizbang coordinates application startup, normal operation, and graceful shutdown. It's built around the `IExecutionStrategy` interface which provides lifecycle hooks (`StartAsync`, `StopAsync`, `DrainAsync`) for controlled initialization and cleanup.

## Overview

### Why Lifecycle Management Matters

Without proper lifecycle coordination:
- ❌ Workers start before database is ready → exceptions on startup
- ❌ Application shuts down mid-processing → data loss
- ❌ In-flight work abandoned → orphaned leases
- ❌ No graceful cleanup → resource leaks

With `IExecutionStrategy` lifecycle:
- ✅ Workers wait for dependencies (database ready) before starting
- ✅ Clean shutdown signal → no new work accepted
- ✅ Work draining → in-flight operations complete
- ✅ Graceful cleanup → resources released properly

---

## IExecutionStrategy Interface

**IExecutionStrategy.cs**:
```csharp{title="IExecutionStrategy Interface" description="**IExecutionStrategy." category="Implementation" difficulty="ADVANCED" tags=["Operations", "Workers", "IExecutionStrategy", "Interface"] tests=["ExecutionStrategyContractTests.Name_ShouldNotBeEmptyAsync", "ExecutionStrategyContractTests.ExecuteAsync_ShouldReturnHandlerResultAsync", "ExecutionStrategyContractTests.StartAsync_ShouldBeIdempotentAsync", "ExecutionStrategyContractTests.StopAsync_ShouldPreventNewExecutionsAsync", "ExecutionStrategyContractTests.DrainAsync_ShouldWaitForPendingWorkAsync"]}
/// <summary>
/// Defines a strategy for executing message handlers.
/// Implementations control ordering, concurrency, and lifecycle.
/// </summary>
public interface IExecutionStrategy {
  /// <summary>
  /// Name of the execution strategy (e.g., "Serial", "Parallel")
  /// </summary>
  string Name { get; }

  /// <summary>
  /// Executes a message handler with the given envelope and context.
  /// </summary>
  ValueTask<TResult> ExecuteAsync<TResult>(
    IMessageEnvelope envelope,
    Func<IMessageEnvelope, PolicyContext, ValueTask<TResult>> handler,
    PolicyContext context,
    CancellationToken ct = default
  );

  /// <summary>
  /// Starts the execution strategy (initializes any background workers/channels)
  /// </summary>
  Task StartAsync(CancellationToken ct = default);

  /// <summary>
  /// Stops the execution strategy (stops accepting new work; queued work is finished as canceled)
  /// </summary>
  Task StopAsync(CancellationToken ct = default);

  /// <summary>
  /// Drains any pending work and waits for completion
  /// </summary>
  Task DrainAsync(CancellationToken ct = default);
}
```

**Three Lifecycle Phases**:
1. **StartAsync**: Initialize workers, channels, background tasks
2. **DrainAsync**: Stop accepting new work and wait for everything already queued to run
3. **StopAsync**: Stop accepting new work; the item already running finishes and anything still queued is finished as canceled

**Order on shutdown: drain, then stop.** `StopAsync` does not run queued work, so a host that wants the queue run calls `DrainAsync` first and `StopAsync` after it. Stopping first and draining after runs nothing: the stop has already finished the queue as canceled, and a drain of a stopped executor returns at once. {verified: SerialExecutorStopTests.StopAsync_ItemQueuedBehindRunningWork_IsCanceledWithoutRunningAsync, SerialExecutorTests.DrainAsync_AfterStop_ReturnsWithoutDrainingAsync}

---

## Startup Lifecycle Flow

```mermaid{caption="Host startup-to-shutdown lifecycle: schema provisioning gates worker startup, then IExecutionStrategy StartAsync → normal operation → DrainAsync → StopAsync coordinate a graceful drain." tests=["ExecutionStrategyContractTests.StartAsync_ShouldBeIdempotentAsync", "ExecutionStrategyContractTests.DrainAsync_ShouldWaitForPendingWorkAsync", "ExecutionStrategyContractTests.StopAsync_ShouldPreventNewExecutionsAsync", "SerialExecutorStopTests.StopAsync_ItemQueuedBehindRunningWork_IsCanceledWithoutRunningAsync"]}
sequenceDiagram
    participant App as Application
    participant Init as WhizbangDatabaseInitializerService
    participant Gate as ISchemaReadyGate
    participant ES as IExecutionStrategy
    participant W as Workers e.g. ClaimWorker

    rect rgb(240, 255, 240)
        Note over App,Init: Phase 1: Initialization
        App->>App: Configure services
        App->>App: Build service provider
    end

    rect rgb(240, 248, 255)
        Note over App,Gate: Phase 2: Schema Provisioning
        App->>Init: StartAsync() (blocks host startup)
        Init->>Init: Run migrations
        alt Migrations succeed
            Init->>Gate: MarkReady()
        else Migrations fail
            Init-->>App: throws — host aborts,<br/>gate stays closed
        end
    end

    rect rgb(255, 250, 240)
        Note over ES,W: Phase 3: Worker Startup
        App->>ES: StartAsync()
        Note over ES: Initialize channels,<br/>start background workers
        App->>W: StartAsync() (the wrapper the worker is registered in)
        Gate-->>W: ready (the wrapper starts the worker at its start point)
        Note over W: First claim cycle acts as<br/>startup catch-up for pre-existing work
    end

    rect rgb(240, 255, 240)
        Note over W: Phase 4: Normal Operation
        loop NOTIFY-driven wake + safety-net poll
            W->>W: Claim work, feed channels,<br/>process batches
        end
    end

    rect rgb(255, 240, 240)
        Note over App,W: Phase 5: Shutdown Signal
        App->>W: StopAsync() (SIGTERM received, CancellationToken)
        Note over W: Stop feeding<br/>new work
        W->>W: Complete current batch
    end

    rect rgb(255, 240, 255)
        Note over App,W: Phase 6: Drain, then Stop
        App->>ES: DrainAsync()
        ES-->>App: Everything queued has run
        App->>ES: StopAsync()
        ES-->>App: Worker ended (nothing left to cancel)
        Note over App: Exit gracefully
    end
```

**Key Phases**:
1. **Initialization**: Configure services, build DI container
2. **Schema Provisioning**: Initializer runs migrations, then marks `ISchemaReadyGate` ready (on failure the gate stays closed and the host aborts)
3. **Worker Startup**: Workers await the schema gate, then enter their main loops; the first claim cycle catches up on pre-existing work
4. **Normal Operation**: NOTIFY-driven wake with safety-net polling
5. **Shutdown Signal**: Workers stop feeding new work
6. **Drain, then Stop**: `DrainAsync` runs everything queued, then `StopAsync` ends the executor (stopping first would cancel the queue instead of running it)

---

## StartAsync: Initialization

**Purpose**: Initialize execution strategy infrastructure before accepting work.

### Execution Strategy Responsibilities

**Example: SerialExecutor** (the built-in serial strategy):
```csharp{title="Execution Strategy Responsibilities" description="Example: SerialExecutor StartAsync" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "Execution", "Strategy"] tests=["SerialExecutorTests.StartAsync_AfterStop_ThrowsInvalidOperationExceptionAsync", "SerialExecutorTests.StateTransitions_IdempotentOperations_SucceedAsync", "ExecutionStrategyContractTests.StartAsync_ShouldBeIdempotentAsync", "SerialExecutorTests.ExecuteAsync_WorkCanceledWhileQueued_FaultsTheCallerInsteadOfHangingAsync", "SerialExecutorStopTests.StopAsync_ItemQueuedBehindRunningWork_IsCanceledWithoutRunningAsync"]}
public Task StartAsync(CancellationToken ct = default) {
  lock (_stateLock) {
    if (_state == State.Running) {
      return Task.CompletedTask; // Idempotent
    }

    if (_state == State.Stopped) {
      throw new InvalidOperationException("Cannot restart a stopped SerialExecutor");
    }

    _state = State.Running;
    _workerCts = new CancellationTokenSource();
    var stopping = _workerCts.Token;
    // Started without a token: the worker always runs, so items queued before an early stop
    // still have a worker to finish them.
    _workerTask = Task.Run(() => _processWorkItemsAsync(stopping), CancellationToken.None);
  }

  return Task.CompletedTask;
}

private async Task _processWorkItemsAsync(CancellationToken stopping) {
  // The read takes no token: the loop ends when the channel is completed AND empty,
  // so every accepted item reaches the body below.
  await foreach (var workItem in _channel.Reader.ReadAllAsync(CancellationToken.None)) {
    if (stopping.IsCancellationRequested) {
      await workItem.CancelAsync(workItem.State, stopping); // stopping: finish as canceled
      continue;
    }
    if (workItem.CancellationToken.IsCancellationRequested) {
      await workItem.CancelAsync(workItem.State, workItem.CancellationToken); // caller gave up
      continue;
    }
    await workItem.ExecuteAsync(workItem.State); // Process work items serially
  }
}
```

**What happens**:
- Create channels, queues, or other work coordination structures (SerialExecutor creates its channel in the constructor — bounded or unbounded via `channelCapacity`)
- Start background workers or task processors
- `StartAsync` is **idempotent** while running; restarting a stopped executor throws
- Log startup completion

### BackgroundService Integration

**PerspectiveWorker (BackgroundService)** — startup sequence at the top of `ExecuteAsync`:
```csharp{title="BackgroundService Integration" description="PerspectiveWorker (BackgroundService) startup sequence" category="Implementation" difficulty="ADVANCED" tags=["Operations", "Workers", "BackgroundService", "Integration"] unverified="PerspectiveWorker startup sequence — a different component, outside the execution-strategy candidate tests"}
protected override async Task ExecuteAsync(CancellationToken stoppingToken) {
  LogWorkerStarting(_logger, _instanceProvider.InstanceId, _instanceProvider.ServiceName,
    _instanceProvider.HostName, _instanceProvider.ProcessId, _options.PollingIntervalMilliseconds);

  // Hook the perspective NOTIFY signal so we wake on every new
  // wh_perspective_events insert instead of polling at PollingIntervalMilliseconds.
  if (_perspectiveNotificationListener is not null && !_perspectiveSignalSubscribed) {
    _perspectiveNotificationListener.OnSignal += _onPerspectiveSignal;
    _perspectiveSignalSubscribed = true;
  }

  await _initializePerspectiveRegistryAsync();          // build event-type → perspectives map
  _processInitialCheckpoints();                          // ClaimWorker feeds leftovers via channels
  await _reconcileOrphanedLifecyclesAsync(stoppingToken); // replay lifecycles orphaned by a crash
  await _scanAndRepairRewindsOnStartupAsync(stoppingToken);

  // ... spawn MaxConcurrentDrainConsumers channel-consumer loops
}
```

**Best Practices**:
- ✅ **Register workers with their start point** (`AddWhizbangWorker`): the host starts `ClaimWorker`, `PerspectiveWorker` and the rest of the data plane once the instance's row records Accept commands, so no worker waits on the gate itself
- ✅ **Reconcile orphaned state on startup** (crashed-pod lifecycles, interrupted rewinds)
- ✅ **Log startup events** for observability
- ✅ **Handle startup exceptions** gracefully (don't crash worker)

---

## StopAsync: Shutdown Signal

**Purpose**: Stop accepting new work and end the executor promptly, without running the queue.

### Execution Strategy Responsibilities

**Example: SerialExecutor**:
```csharp{title="Execution Strategy Responsibilities (2)" description="Example: SerialExecutor StopAsync" category="Implementation" difficulty="BEGINNER" tags=["Operations", "Workers", "Execution", "Strategy"] tests=["ExecutionStrategyContractTests.StopAsync_ShouldPreventNewExecutionsAsync", "SerialExecutorTests.ExecuteAsync_WhenNotRunning_ThrowsInvalidOperationExceptionAsync", "SerialExecutorTests.StateTransitions_IdempotentOperations_SucceedAsync", "SerialExecutorStopTests.StopAsync_ItemQueuedBehindRunningWork_IsCanceledWithoutRunningAsync", "SerialExecutorDrainAfterStopTests.DrainAsync_StopLandsWhileTheDrainAwaitsTheWorker_BothCompleteAndQueuedWorkIsCanceledAsync"]}
public async Task StopAsync(CancellationToken ct = default) {
  lock (_stateLock) {
    if (_state == State.Stopped) {
      return; // Already stopped
    }

    if (_state == State.NotStarted) {
      _state = State.Stopped;
      return; // No worker to end
    }

    _state = State.Stopped;

    // Stop accepting new work
    if (!_channelCompleted) {
      _channel.Writer.Complete();
      _channelCompleted = true;
    }
  }

  // Marks the executor stopping. Nothing waits on this token: the worker tests it
  // before each item and finishes whatever is still queued as canceled.
  if (_workerCts != null) {
    await _workerCts.CancelAsync();
  }

  // The worker ends normally once the completed channel is empty; there is no
  // cancellation to catch.
  if (_workerTask != null) {
    await _workerTask;
  }
}
```

**What happens**:
- Close the channel (no new writes accepted)
- Flip internal state (`State.Stopped`): subsequent `ExecuteAsync` calls throw `InvalidOperationException`
- The item already running finishes and its caller gets its result
- Every item still queued is finished as canceled: its handler does not run, and its caller's `await` ends in `OperationCanceledException`. No caller is left waiting
- The worker itself is not canceled: it ends normally once the channel is empty, and `StopAsync` returns after it
- An `ExecuteAsync` call that races the stop (it passed the running check, or was waiting for room in a bounded channel, when the stop closed the channel) is canceled the same way: its caller gets `OperationCanceledException`, not `ChannelClosedException`, and its pooled execution state is returned. A caller whose own token cancels that wait gets its own cancellation, unchanged. {verified: SerialExecutorEnqueueFailureTests.ExecuteAsync_StopClosesTheChannelWhileTheWriteWaits_CallerIsCanceledAndStateReturnedAsync, SerialExecutorEnqueueFailureTests.ExecuteAsync_CallerCancelsWhileTheWriteWaits_CallerSeesItsCancellationAndStateReturnedAsync}

**Why queued work is canceled rather than run**: `StopAsync` does not wait for work (that is `DrainAsync`), and a host calls it under its shutdown timeout, which a deep queue would overrun. A queued item whose own token is canceled before the worker reaches it already finishes the same way. To run the queue on shutdown, drain first, then stop. {verified: SerialExecutorStopTests.StopAsync_ItemQueuedBehindRunningWork_IsCanceledWithoutRunningAsync, SerialExecutorTests.ExecuteAsync_WorkCanceledWhileQueued_FaultsTheCallerInsteadOfHangingAsync}

**A stop that overlaps a drain wins for work that has not started**: the drain and the stop both complete, the item already running finishes, and the items still queued are finished as canceled. {verified: SerialExecutorDrainAfterStopTests.DrainAsync_StopLandsWhileTheDrainAwaitsTheWorker_BothCompleteAndQueuedWorkIsCanceledAsync}

**DO NOT**:
- ❌ Wait for queued work to run (that's `DrainAsync`; call it before `StopAsync`)
- ❌ Forcefully terminate workers (allow graceful completion)
- ❌ Throw exceptions (shutdown should always succeed)

### BackgroundService Integration

**PerspectiveWorker**:
```csharp{title="BackgroundService Integration (2)" description="PerspectiveWorker shutdown: unsubscribe signals, drain background lifecycle work" category="Implementation" difficulty="ADVANCED" tags=["Operations", "Workers", "BackgroundService", "Integration"] unverified="PerspectiveWorker shutdown sequence — a different component, outside the execution-strategy candidate tests"}
public override Task StopAsync(CancellationToken cancellationToken) {
  // Unsubscribe from the NOTIFY signal so no new wakes arrive during shutdown
  if (_perspectiveSignalSubscribed && _perspectiveNotificationListener is not null) {
    _perspectiveNotificationListener.OnSignal -= _onPerspectiveSignal;
    _perspectiveSignalSubscribed = false;
  }
  return base.StopAsync(cancellationToken);
}

// Inside ExecuteAsync — the consumer loops exit on cancellation, then a finally block
// drains the in-flight PostLifecycle task so background work completes before the host
// disposes scoped services (DbContext, etc.) out from under it:
finally {
  var finalPending = Interlocked.Exchange(ref _pendingPostLifecycle, null);
  if (finalPending is not null) {
    try {
      await finalPending;
    } catch (Exception ex) when (ex is not OperationCanceledException) {
      LogPriorPostLifecycleFaulted(_logger, ex);
    }
  }
}
```

**How BackgroundService works**:
1. `IHostApplicationLifetime.ApplicationStopping` event fires
2. `BackgroundService.StopAsync()` called → sets `CancellationToken`
3. Worker detects cancellation → completes current batch
4. Worker exits `ExecuteAsync()` loop
5. `BackgroundService.StopAsync()` awaits `ExecuteAsync()` completion

**Timeline Example**:
```
t=0ms:    SIGTERM received (Ctrl+C or docker stop)
t=5ms:    ApplicationStopping event fires
t=10ms:   BackgroundService.StopAsync() called
t=15ms:   CancellationToken set
t=100ms:  Worker detects cancellation
t=150ms:  Current batch completes
t=200ms:  Worker exits ExecuteAsync()
t=250ms:  StopAsync() returns
```

---

## DrainAsync: Work Completion

**Purpose**: Wait for all in-flight work to complete before final shutdown.

### Execution Strategy Responsibilities

**Example: SerialExecutor**:
```csharp{title="Execution Strategy Responsibilities (3)" description="Example: SerialExecutor DrainAsync" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "Execution", "Strategy"] tests=["SerialExecutorTests.DrainAsync_WaitsForAllInFlightWork_CompletesAsync", "SerialExecutorTests.DrainAsync_WhenNotRunning_ReturnsImmediatelyAsync", "SerialExecutorDrainAfterStopTests.DrainAsync_StopLandsWhileTheDrainAwaitsTheWorker_BothCompleteAndQueuedWorkIsCanceledAsync", "SerialExecutorDrainCancellationTests.DrainAsync_CanceledWhileWaiting_StopsWaitingAndTheQueueStillRunsAsync", "SerialExecutorDrainCancellationTests.DrainAsync_TokenAlreadyCanceled_LeavesTheExecutorAcceptingWorkAsync", "ExecutionStrategyContractTests.DrainAsync_ShouldWaitForPendingWorkAsync"]}
public async Task DrainAsync(CancellationToken ct = default) {
  lock (_stateLock) {
    if (_state != State.Running) {
      return; // Nothing to drain
    }

    // Before the channel is closed: a drain canceled before it starts changes nothing
    ct.ThrowIfCancellationRequested();

    // Complete the channel writer to signal no more work
    if (!_channelCompleted) {
      _channel.Writer.Complete();
      _channelCompleted = true;
    }
  }

  // Wait for the worker to finish every item. It ends normally once the completed
  // channel is empty, also when a stop lands while this drain waits, so there is no
  // cancellation to absorb. The token bounds only this caller's wait.
  if (_workerTask != null) {
    await _workerTask.WaitAsync(ct);
  }
}
```

**What happens**:
- Complete the channel writer (no more work can be queued)
- Await the background worker until it has processed everything already queued
- If a stop lands while the drain waits, the drain still completes normally; the items the worker had not reached are finished as canceled
- Log/trace drain completion

**Timeout Handling**:
- `DrainAsync` awaits completion; bound it with its `CancellationToken` if your host imposes a shutdown budget
- A drain canceled while it waits stops waiting and throws `OperationCanceledException`. The token bounds only the caller's wait: the channel the drain closed stays closed, the worker keeps running the queue, and a later drain or stop completes as usual. {verified: SerialExecutorDrainCancellationTests.DrainAsync_CanceledWhileWaiting_StopsWaitingAndTheQueueStillRunsAsync}
- A drain whose token is already canceled throws before it closes the channel, so it changes nothing and the executor keeps accepting work. {verified: SerialExecutorDrainCancellationTests.DrainAsync_TokenAlreadyCanceled_LeavesTheExecutorAcceptingWorkAsync}
- Log a warning if the budget is exceeded
- Allow shutdown to proceed (don't block forever)

### ParallelExecutor: Concurrent and Canceled Drains

`ParallelExecutor` has no queue: a drain proves nothing is running by holding every concurrency slot at once. The slots are taken one at a time, so drains pass through a one-at-a-time gate first. Two drains at once could otherwise each hold some of the slots and wait forever for the rest; with the gate, concurrent drains complete one after another. {verified: ParallelExecutorDrainTests.DrainAsync_TwoDrainsOverlap_BothCompleteAsync}

- **A drain canceled part way gives its slots back**: every slot it had taken, and the gate, are released before the cancellation reaches its caller, so the executor keeps its full concurrency and later drains still complete. {verified: ParallelExecutorDrainTests.DrainAsync_CanceledAfterTakingSlots_GivesThemBackAsync, ParallelExecutorDrainTests.DrainAsync_CanceledBeforeTakingAnySlot_LeavesTheExecutorWholeAsync}
- **A drain canceled while waiting for the gate releases nothing**: it never held the gate or a slot, so the drain that does hold them is left whole. {verified: ParallelExecutorDrainTests.DrainAsync_CanceledWaitingForTheGate_LeavesTheRunningDrainWholeAsync}


### Application Integration

**ASP.NET Core Program.cs**:
```csharp{title="Application Integration" description="Application Integration" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "Application", "Integration"] unverified="ASP.NET host wiring and DI registration — not exercised by execution-strategy unit tests"}
var builder = WebApplication.CreateBuilder(args);

// Configure services
builder.Services.AddSingleton<IExecutionStrategy, SerialExecutor>();
// PerspectiveWorker is hosted by the framework at its start point; it needs no registration.
builder.Services.AddWhizbangWorker<MyOwnWorker>();

var app = builder.Build();

// Application startup
await app.StartAsync();

// Lifecycle: StartAsync called automatically by .NET host
// - IExecutionStrategy.StartAsync()
// - BackgroundService.StartAsync() → ExecuteAsync()

// Normal operation
// - Workers process events
// - Application serves requests

// Shutdown signal (SIGTERM, Ctrl+C, etc.)
var lifetime = app.Services.GetRequiredService<IHostApplicationLifetime>();
lifetime.ApplicationStopping.Register(() => {
  // BackgroundService.StopAsync() sets CancellationToken
});

await app.WaitForShutdownAsync();

// Lifecycle: drain, then stop
// - BackgroundService awaits ExecuteAsync completion (no new work is fed)
// - IExecutionStrategy.DrainAsync()  runs everything queued
// - IExecutionStrategy.StopAsync()   ends the executor; anything still queued is canceled

await app.StopAsync();
```

---

## Schema Readiness Coordination

Workers coordinate startup with database availability through the **`ISchemaReadyGate`** signal, but they do not wait on it themselves: each worker is [registered with its start point](../startup/startup-status#add-whizbang-worker), and the wrapper that hosts it waits.

### Why Schema Readiness Matters

**Without the gate**, workers race the migration runner:
```csharp{title="Why Schema Readiness Matters" description="Without the gate:" category="Implementation" difficulty="ADVANCED" tags=["Operations", "Workers", "Why", "Database"] unverified="counter-example — worker racing migrations with no gate; intentionally wrong, nothing to assert"}
// ❌ Worker starts before migrations have run
protected override async Task ExecuteAsync(CancellationToken ct) {
  while (!ct.IsCancellationRequested) {
    try {
      await _claimOnceAsync(ct);  // EXCEPTION: relation "wh_outbox" does not exist
    } catch (Npgsql.NpgsqlException ex) {
      // Startup race or runtime failure? Can't tell from here.
    }
  }
}
```

**With a start point**, the host starts the worker only once the instance reaches it, and the worker's loop holds no wait:
```csharp{title="Why Schema Readiness Matters (2)" description="The worker is registered with its start point; its loop holds no gate code" category="Workers" difficulty="ADVANCED" tags=["Operations", "Workers", "Startup", "Registration"] tests=["WhizbangWorkerRegistrationTests.AddWhizbangWorker_StartsAtAcceptCommandsByDefault_AndHostsTheRegisteredSingletonAsync","WorkerStartGateSourceGuardTests.NoHostedService_DecidesItsOwnStartOnTheSchemaReadyGate_ButTheStartupMachineryAsync"]}
// ✅ Registered with its start point: Accept commands unless another stage is named
builder.Services.AddWhizbangWorker<MyClaimingWorker>();

// The worker's loop starts only once the instance is eligible for work
protected override async Task ExecuteAsync(CancellationToken stoppingToken) {
  while (!stoppingToken.IsCancellationRequested) {
    // ... claim and process work
  }
}
```

**Benefits**:
- ✅ **No startup/runtime ambiguity** — after the gate opens, database exceptions are genuine runtime failures
- ✅ **Registration order stops mattering**: the host starts each worker at its start point, whatever order it was added in
- ✅ **No gate code in any worker**: the wait lives in the wrapper, and a source guard fails if a library worker waits on the gate itself
- ✅ **Fail-safe on migration failure** — the gate stays closed and the host aborts

The gate is marked ready by `WhizbangDatabaseInitializerService` after migrations succeed. See [Database Readiness](database-readiness.md) for full details.

---

## Graceful Shutdown Best Practices

### DO ✅

**1. Complete Current Batch**:
```csharp{title="DO ✅" description="DO ✅" category="Implementation" difficulty="ADVANCED" tags=["Operations", "Workers"] unverified="illustrative best-practice pattern — GetWorkBatchAsync/ProcessWorkItemAsync are pseudocode, not concrete Whizbang APIs"}
protected override async Task ExecuteAsync(CancellationToken ct) {
  while (!ct.IsCancellationRequested) {
    var workBatch = await GetWorkBatchAsync(ct);

    foreach (var workItem in workBatch) {
      // ✅ Check cancellation BETWEEN items, not during
      if (ct.IsCancellationRequested) {
        _logger.LogInformation("Shutdown requested - completing current batch");
        break;
      }

      await ProcessWorkItemAsync(workItem, ct);
    }

    // Report results for completed items
    await ReportResults(ct);
  }
}
```

**2. Set Reasonable Drain Timeout**:
```csharp{title="DO ✅ (2)" description="DO ✅ (2)" category="Implementation" difficulty="BEGINNER" tags=["Operations", "Workers"] unverified="illustrative drain-timeout pattern — _worker.WaitAsync is pseudocode, not the SerialExecutor API"}
public async Task DrainAsync(CancellationToken ct = default) {
  var timeout = TimeSpan.FromSeconds(30);  // ✅ 30 seconds max

  try {
    await _worker.WaitAsync(timeout, ct);
  } catch (TimeoutException) {
    _logger.LogWarning("Drain timeout - forcing shutdown");
  }
}
```

**3. Use Shutdown Token for New Work**:
```csharp{title="DO ✅ (3)" description="DO ✅ (3)" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers"] unverified="illustrative shutdown-token pattern — _shutdownToken is pseudocode; SerialExecutor rejects post-stop work via state, covered above"}
public ValueTask<TResult> ExecuteAsync<TResult>(
  IMessageEnvelope envelope,
  Func<IMessageEnvelope, PolicyContext, ValueTask<TResult>> handler,
  PolicyContext context,
  CancellationToken ct = default
) {
  if (_shutdownToken.IsCancellationRequested) {
    throw new InvalidOperationException("Execution strategy is shutting down");
  }

  // Accept new work only if not shutting down
  return _channel.Writer.WriteAsync(new WorkItem(...), ct);
}
```

### DON'T ❌

**1. Don't Abandon In-Flight Work**:
```csharp{title="DON'T ❌" description="DON'T ❌" category="Implementation" difficulty="ADVANCED" tags=["Operations", "Workers", "DON'T"] unverified="counter-example — abandons the rest of the batch on cancellation; intentionally wrong"}
// ❌ BAD: Immediately exit on cancellation
protected override async Task ExecuteAsync(CancellationToken ct) {
  while (!ct.IsCancellationRequested) {
    var workBatch = await GetWorkBatchAsync(ct);

    foreach (var workItem in workBatch) {
      if (ct.IsCancellationRequested) {
        return;  // ❌ Abandoned rest of batch!
      }

      await ProcessWorkItemAsync(workItem, ct);
    }
  }
}
```

**2. Don't Block Shutdown Indefinitely**:
```csharp{title="DON'T ❌ (2)" description="DON'T ❌ (2)" category="Implementation" difficulty="BEGINNER" tags=["Operations", "Workers", "DON'T"] unverified="counter-example — unbounded drain with no timeout; intentionally wrong"}
// ❌ BAD: No timeout on drain
public async Task DrainAsync(CancellationToken ct = default) {
  await _worker;  // ❌ Could wait forever if worker is stuck
}
```

**3. Don't Throw on Shutdown**:
```csharp{title="DON'T ❌ (3)" description="DON'T ❌ (3)" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "DON'T"] unverified="counter-example — throws during shutdown; intentionally wrong, contrasted with a log-and-continue variant"}
// ❌ BAD: Throwing exceptions during shutdown
public async Task StopAsync(CancellationToken ct = default) {
  if (_worker == null) {
    throw new InvalidOperationException("Not started");  // ❌ Crashes shutdown
  }

  _channel.Writer.Complete();
}

// ✅ GOOD: Log and continue
public async Task StopAsync(CancellationToken ct = default) {
  if (_worker == null) {
    _logger.LogWarning("StopAsync called but worker was never started");
    return;  // ✅ Graceful
  }

  _channel.Writer.Complete();
}
```

---

## Observability

### Logging Startup

```csharp{title="Logging Startup" description="Logging Startup" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "Logging", "Startup"] unverified="illustrative logging pattern — observability example, nothing asserted"}
public async Task StartAsync(CancellationToken ct = default) {
  _logger.LogInformation(
    "Starting {StrategyName} execution strategy",
    Name
  );

  // ... initialization

  _logger.LogInformation(
    "{StrategyName} started successfully",
    Name
  );
}
```

### Logging Shutdown

```csharp{title="Logging Shutdown" description="Logging Shutdown" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "Logging", "Shutdown"] unverified="illustrative logging pattern — observability example, nothing asserted"}
public async Task StopAsync(CancellationToken ct = default) {
  _logger.LogInformation(
    "{StrategyName} stopping - no new work will be accepted",
    Name
  );

  _channel.Writer.Complete();
}

public async Task DrainAsync(CancellationToken ct = default) {
  _logger.LogInformation(
    "{StrategyName} draining - waiting for {PendingCount} pending work items",
    Name,
    _channel.Reader.Count
  );

  await _worker.WaitAsync(TimeSpan.FromSeconds(30), ct);

  _logger.LogInformation(
    "{StrategyName} drained successfully",
    Name
  );
}
```

### Metrics

**Track shutdown duration**:
```csharp{title="Metrics" description="Track shutdown duration:" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "Metrics"] unverified="illustrative metrics pattern — Stopwatch timing example, nothing asserted"}
private readonly Stopwatch _shutdownTimer = new();

public async Task StopAsync(CancellationToken ct = default) {
  _shutdownTimer.Start();
  _channel.Writer.Complete();
}

public async Task DrainAsync(CancellationToken ct = default) {
  await _worker.WaitAsync(TimeSpan.FromSeconds(30), ct);

  _shutdownTimer.Stop();
  _logger.LogInformation(
    "Shutdown completed in {ElapsedMs}ms",
    _shutdownTimer.ElapsedMilliseconds
  );
}
```

---

## Testing Lifecycle

### Testing StartAsync

```csharp{title="Testing StartAsync" description="Testing StartAsync" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "Testing", "StartAsync"] tests=["ExecutionStrategyContractTests.StartAsync_ShouldBeIdempotentAsync", "SerialExecutorTests.StateTransitions_IdempotentOperations_SucceedAsync"]}
[Test]
public async Task StartAsync_ShouldBeIdempotentAsync() {
  // Arrange
  var strategy = new SerialExecutor();

  // Act
  await strategy.StartAsync();
  await strategy.StartAsync();  // Second call should not throw

  // Assert - no exception
  await strategy.StopAsync();
}
```

### Testing StopAsync

```csharp{title="Testing StopAsync" description="Testing StopAsync" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "Testing", "StopAsync"] tests=["ExecutionStrategyContractTests.StopAsync_ShouldPreventNewExecutionsAsync", "SerialExecutorTests.ExecuteAsync_WhenNotRunning_ThrowsInvalidOperationExceptionAsync"]}
[Test]
public async Task StopAsync_ShouldPreventNewExecutionsAsync() {
  // Arrange
  var strategy = new SerialExecutor();
  await strategy.StartAsync();

  // Act
  await strategy.StopAsync();

  // Assert - new executions should throw
  await Assert.That(async () => {
    await strategy.ExecuteAsync<int>(
      envelope,
      (env, ctx) => ValueTask.FromResult(0),
      context
    );
  }).Throws<InvalidOperationException>();
}
```

### Testing DrainAsync

```csharp{title="Testing DrainAsync" description="Testing DrainAsync" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "Testing", "DrainAsync"] tests=["ExecutionStrategyContractTests.DrainAsync_ShouldWaitForPendingWorkAsync", "SerialExecutorTests.DrainAsync_WaitsForAllInFlightWork_CompletesAsync"]}
[Test]
public async Task DrainAsync_ShouldWaitForPendingWorkAsync() {
  // Arrange
  var strategy = new SerialExecutor();
  await strategy.StartAsync();
  var handlerStarted = new TaskCompletionSource<bool>();
  var handlerCompleted = new TaskCompletionSource<bool>();

  // Act - start a long-running handler (completion signals, never Task.Delay)
  var executionTask = strategy.ExecuteAsync<int>(
    envelope,
    async (env, ctx) => {
      handlerStarted.SetResult(true);
      await handlerCompleted.Task;
      return 0;
    },
    context
  );

  await handlerStarted.Task;
  var drainTask = strategy.DrainAsync();  // should wait for the handler

  handlerCompleted.SetResult(true);
  await executionTask;

  // Assert - DrainAsync now completes
  await drainTask;
  await strategy.StopAsync();
}
```

---

## Common Patterns

### Pattern 1: Initialization Dependencies

**Problem**: Worker needs database migrations before starting.

**Solution**: register the worker with its start point; the host starts it there:
```csharp{title="Pattern 1: Initialization Dependencies" description="Register the worker at the point it needs; the worker holds no wait of its own" category="Workers" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "Pattern", "Initialization"] tests=["WhizbangWorkerRegistrationTests.AddWhizbangWorker_StartsAtAcceptCommandsByDefault_AndHostsTheRegisteredSingletonAsync","WhizbangWorkerRegistrationTests.AddWhizbangWorkerAtSchemaReady_HostsTheWorkerBehindTheSchemaReadyGateAsync"]}
// Started once the instance is eligible for work (Accept commands)
builder.Services.AddWhizbangWorker<MyDatabaseWorker>();

public class MyDatabaseWorker : BackgroundService {
  protected override async Task ExecuteAsync(CancellationToken ct) {
    // The schema is provisioned and the instance is eligible before this runs
    while (!ct.IsCancellationRequested) {
      await ProcessBatchAsync(ct);
    }
  }
}
```

A worker that needs only the schema, not eligibility, uses `AddWhizbangWorkerAtSchemaReady<T>()` instead.

### Pattern 2: Multi-Phase Shutdown

**Problem**: Need to drain work from multiple channels.

**Solution**:
```csharp{title="Pattern 2: Multi-Phase Shutdown" description="Pattern 2: Multi-Phase Shutdown" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "Pattern", "Multi-Phase"] unverified="illustrative multi-channel drain pattern — not the single-channel SerialExecutor API"}
public async Task DrainAsync(CancellationToken ct = default) {
  // Phase 1: Drain primary work queue
  _primaryChannel.Writer.Complete();
  await _primaryWorker.WaitAsync(TimeSpan.FromSeconds(15), ct);

  // Phase 2: Drain secondary work queue (depends on primary)
  _secondaryChannel.Writer.Complete();
  await _secondaryWorker.WaitAsync(TimeSpan.FromSeconds(15), ct);

  _logger.LogInformation("All work drained");
}
```

### Pattern 3: Startup Health Checks

**Problem**: Expose readiness to container orchestrator (Kubernetes).

**Solution**:
```csharp{title="Pattern 3: Startup Health Checks" description="Pattern 3: Startup Health Checks" category="Implementation" difficulty="BEGINNER" tags=["Operations", "Workers", "Pattern", "Startup"] unverified="ASP.NET health-check wiring — SchemaReadyHealthCheck/ExecutionStrategyHealthCheck not exercised by execution-strategy unit tests"}
// ASP.NET Core health checks (SchemaReadyHealthCheck wraps ISchemaReadyGate.IsReady —
// see the Database Readiness page for the implementation)
builder.Services.AddHealthChecks()
  .AddCheck<SchemaReadyHealthCheck>("schema")
  .AddCheck<ExecutionStrategyHealthCheck>("execution");

app.MapHealthChecks("/health/ready", new HealthCheckOptions {
  Predicate = check => check.Tags.Contains("ready")
});
```

---

## Troubleshooting

### Problem: Worker Starts Before Database Ready

**Symptoms**: Exceptions on startup, "relation does not exist" or "connection refused" errors.

**Cause**: the worker was added with `AddHostedService`, so it starts with the host, before the migration.

**Solution**: register it with its start point:
```csharp{title="Problem: Worker Starts Before Database Ready" description="AddWhizbangWorker starts the worker at Accept commands instead of with the host" category="Workers" difficulty="BEGINNER" tags=["Operations", "Workers", "Startup", "Registration"] tests=["WhizbangWorkerRegistrationTests.AddWhizbangWorker_StartsAtAcceptCommandsByDefault_AndHostsTheRegisteredSingletonAsync"]}
// Not: builder.Services.AddHostedService<MyDatabaseWorker>();
builder.Services.AddWhizbangWorker<MyDatabaseWorker>();
```

### Problem: Shutdown Hangs Indefinitely

**Symptoms**: Application doesn't exit after SIGTERM.

**Causes**:
1. `DrainAsync()` has no timeout
2. Background worker stuck in infinite loop
3. Deadlock in work processing
4. A detached lifecycle receptor or tag handler is still running: the host waits for it before disposing the service provider, up to `HostOptions.ShutdownTimeout`. Look for the Information log `Waiting for {Count} detached lifecycle invocation(s) to finish before the service provider is disposed`, and see [Detached Work When the Host Stops](../../fundamentals/lifecycle/lifecycle-stages.md#host-stop).

**Solution**: Add timeout to drain:
```csharp{title="Problem: Shutdown Hangs Indefinitely" description="Solution: Add timeout to drain:" category="Implementation" difficulty="BEGINNER" tags=["Operations", "Workers", "Problem:", "Shutdown"] unverified="illustrative drain-timeout pattern — _worker.WaitAsync is pseudocode, not the SerialExecutor API"}
public async Task DrainAsync(CancellationToken ct = default) {
  try {
    await _worker.WaitAsync(TimeSpan.FromSeconds(30), ct);
  } catch (TimeoutException) {
    _logger.LogWarning("Drain timeout - forcing shutdown");
  }
}
```

### Problem: Work Abandoned on Shutdown

**Symptoms**: In-flight work not completed, data loss.

**Causes**:
1. Worker exits immediately on cancellation
2. `StopAsync()` kills worker instead of signaling
3. `DrainAsync()` not awaited
4. `StopAsync()` called before `DrainAsync()`: the stop finishes the executor's queued work as canceled instead of running it, and the drain that follows has nothing left to run. Drain first, then stop

**Solution**: Complete current batch before exiting:
```csharp{title="Problem: Work Abandoned on Shutdown" description="Solution: Complete current batch before exiting:" category="Implementation" difficulty="ADVANCED" tags=["Operations", "Workers", "Problem:", "Work"] unverified="illustrative complete-current-batch pattern — generic BackgroundService loop, not a concrete Whizbang API"}
protected override async Task ExecuteAsync(CancellationToken ct) {
  while (!ct.IsCancellationRequested) {
    var batch = await GetWorkBatchAsync(ct);

    foreach (var item in batch) {
      // Check cancellation BETWEEN items
      if (ct.IsCancellationRequested) {
        _logger.LogInformation("Completing current batch before shutdown");
        break;
      }

      await ProcessWorkItemAsync(item, ct);
    }

    // Report results for completed items
    await ReportResultsAsync(ct);
  }
}
```

---

## Further Reading

**Related Workers**:
- [Perspective Worker](perspective-worker.md) - Concrete BackgroundService implementation
- [Database Readiness](database-readiness.md) - Startup dependency coordination

**Core Concepts**:
- [Dispatcher](../../fundamentals/dispatcher/dispatcher.md) - Message routing and execution

**Messaging**:
- [Work Coordinator](../../messaging/work-coordinator.md) - Atomic batch processing
- [Outbox Pattern](../../messaging/outbox-pattern.md) - Reliable event publishing

**Testing**:
- Testing Guide - Testing lifecycle hooks

---

*Version 1.0.0 - Foundation Release | Last Updated: 2026-08-05*
