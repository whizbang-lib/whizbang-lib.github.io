---
title: PerspectiveWorker NOTIFY Wake
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Fundamentals
order: 7
description: >-
  PerspectiveWorker subscribes to WorkSignalCategory.Perspective NOTIFY
  signals to eliminate idle polling. Polling stays as a safety-net cadence.
tags: 'workers, notify, perspective, polling, signals'
codeReferences:
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
  - src/Whizbang.Core/Notifications/IWorkNotificationListener.cs
  - src/Whizbang.Core/Async/WakeSignal.cs
  - src/Whizbang.Core/Workers/DeadLetterRecoveryWorker.cs
testReferences:
  - tests/Whizbang.Core.Tests/Workers/PerspectiveWorkerStartupAndMaintenanceTests.cs
  - tests/Whizbang.Core.Tests/Workers/PerspectiveWorkerDeepPathChannelTests.cs
  - tests/Whizbang.Core.Tests/Workers/V502DefaultsTests.cs
  - tests/Whizbang.Core.Tests/Async/WakeSignalTests.cs
  - tests/Whizbang.Core.Tests/Workers/DeadLetterRecoveryWorkerTests.cs
---

# PerspectiveWorker NOTIFY wake

`WorkSignalCategory.Perspective` already fires from the database on every `wh_perspective_events` insert — the producer trigger has been live for releases. Until v0.681 the signal had no consumer, so `PerspectiveWorker` spun on a 1 s default poll loop regardless of actual perspective_event arrival.

This page documents the consumer subscription added in slice 7a.

## Wake mechanism

```mermaid{caption="PerspectiveWorker NOTIFY wake: a wh_perspective_events insert fires the DB trigger, NOTIFY reaches the LISTEN dispatcher, and the worker's wake signal wins Task.WhenAny to drain." tests=["PerspectiveWorkerDeepPathChannelTests.Worker_WithNotificationListener_SubscribesCoalescesAndUnsubscribesAsync"]}
graph LR
  Producer[Producer commits<br/>wh_perspective_events row] -->|trigger fires| PG[(PostgreSQL<br/>NOTIFY 'perspective')]
  PG -->|LISTEN dispatch| Listener[IWorkNotificationListener]
  Listener -->|OnSignal(Perspective)| Worker[PerspectiveWorker._perspectiveWake.Set]
  Worker -->|Task.WhenAny wins| Drain[Scan + drain]
```

The worker's main `Task.WhenAny` now races the standard channel-readers, the safety-net `Task.Delay`, AND the wake signal (a `WakeSignal`, described below). Whichever completes first triggers the drain.

## One waiter, never a stale one
{verified: WakeSignalTests.WaitAsync_RepeatedWhilePending_ReturnsTheSameTaskAndKeepsOneWaiterAsync, WakeSignalTests.Set_AfterManyAbandonedIterations_WakesTheLiveWaiterNotAStaleOneAsync, WakeSignalTests.Set_WithoutWaiter_IsKeptOnceForTheNextWaitAsync, PerspectiveWorkerDeepPathChannelTests.Worker_SignalAfterWorkDrivenIterations_WakesOnTheFirstSignalAsync, PerspectiveWorkerDeepPathChannelTests.Worker_ManyWorkDrivenIterations_HoldsAtMostOneWakeWaiterAsync}

The wake used to be a `SemaphoreSlim(0, 1)`. That idiom has a defect in a `Task.WhenAny` loop: the loop created a fresh `WaitAsync` on **every** iteration and raced it against the channel readers and the delay. Every iteration that a channel or the idle timeout won left one more queued semaphore waiter that nothing awaited. `Release()` completes the *oldest* waiter, so a real signal went to a stale waiter from a past iteration and the live one kept sleeping: the signal was swallowed, and the abandoned waiters accumulated without bound in a long-running process.

`WakeSignal` (in `Whizbang.Core.Async`) is a coalescing, single-consumer wake that holds **at most one waiter**:

- `WaitAsync(ct)` returns the **same** pending task while a wait is outstanding, so a loop that abandons the task for another wake source simply asks again on the next iteration without queuing a second waiter. It completes immediately when a signal is already pending, and cancellation clears the waiter.
- `Set()` completes the one waiter (disposing its cancellation registration), or records a single pending signal when nobody is waiting, so a signal raised while the loop is busy still wakes the next iteration. Further `Set()` calls before the next wait coalesce into that one.
- `PendingWaiters` is always 0 or 1, and `HasPendingSignal` says whether a signal is parked. Both workers expose `PendingWakeWaiters` for tests.

```csharp{
title: "The WhenAny loop with a WakeSignal"
description: "Asking for the wait every iteration is now free: while a wait is pending the same task comes back, so channel- or timeout-driven iterations never leave a stale waiter behind, and the first Set after any number of such iterations wakes the live waiter."
framework: "NET10"
category: "Workers"
difficulty: "ADVANCED"
tags: ["perspective-worker", "wake-signal", "notify", "when-any", "semaphore"]
tests: ["WakeSignalTests.WaitAsync_RepeatedWhilePending_ReturnsTheSameTaskAndKeepsOneWaiterAsync", "WakeSignalTests.Set_AfterManyAbandonedIterations_WakesTheLiveWaiterNotAStaleOneAsync", "WakeSignalTests.Set_WithPendingWaiter_CompletesItAndClearsTheSlotAsync", "WakeSignalTests.WaitAsync_Canceled_CancelsTheWaiterAndClearsTheSlotAsync"]
}
private readonly WakeSignal _perspectiveWake = new();

// Signal handler (IWorkNotificationListener.OnSignal, category == Perspective):
_perspectiveWake.Set();

// Consumer loop:
while (!stoppingToken.IsCancellationRequested) {
  var wake = _perspectiveWake.WaitAsync(stoppingToken);          // same task while pending; never a second waiter
  var winner = await Task.WhenAny(workWait, drainWait, idleTimeout, wake);
  // ... drain whichever source won; a Set() that arrives while draining is kept for the next WaitAsync
}
```

The same replacement was made in `DeadLetterRecoveryWorker`, whose scan-backstop loop had the same shape at its `ScanIntervalMinutes` cadence; its backstop delay now runs on an injectable `TimeProvider` so the contract is provable without waiting. {verified: DeadLetterRecoveryWorkerTests.NotificationListener_SignalAfterBackstopTimeouts_WakesOnTheFirstSignalAsync, DeadLetterRecoveryWorkerTests.NotificationListener_ManyBackstopTimeouts_HoldAtMostOneWakeWaiterAsync}

## Options

| Property | Default | Used when |
|---|---|---|
| `PollingIntervalMilliseconds` | `1000` | NOTIFY listener is null / disabled — the worker falls back to this cadence so an outage doesn't introduce latency |
| `NotifyHealthyPollingIntervalMilliseconds` | `1000` | NOTIFY listener is wired — safety-net cadence (signal does the actual wake). Ships equal to the poll interval; raise it (e.g. `30000`+) to relax the safety net on hosts with reliable LISTEN connections |

The worker picks the max of the two when a listener is wired, so leaving `NotifyHealthyPollingIntervalMilliseconds = PollingIntervalMilliseconds` (the shipped default) means no relaxed cadence. The tight default is deliberate: new streams not yet present in `wh_active_streams` receive no per-instance NOTIFY on their first batch, so the safety net must catch them quickly.

## Operator notes

- When no `IWorkNotificationListener` is registered (legacy / no-direct-conn hosts), behaviour is bit-for-bit identical to pre-v0.681.
- The signal handler filters by `category == Perspective`; Outbox/Inbox/OrphanRedistribute don't wake this worker.
- `StopAsync` unsubscribes symmetrically; a host restart doesn't double-subscribe.

## Verification

After deploy, `pg_stat_statements` filtered to your service's database should show the perspective-fetch-shaped query call count drop sharply during idle periods once the safety-net cadence is relaxed (e.g. ~4 calls/sec on 250 ms poll-only vs ~0.03/sec at a 30 s safety-net cadence). The `whizbang.perspective.empty_batches` counter (idle wake cycles that found no work) is the observability signal that the loop is no longer poll-spinning.

## Related

- [Worker classification](./worker-classification.md) — which workers are NOTIFY-driven, channel-driven, or timer-driven.
- [Instance liveness](./instance-liveness.md) — the direct LISTEN connection also carries the advisory-lock liveness signal.
- [Pinned connection pool](./pinned-connection-pool.md) — how NOTIFY + worker traffic split across direct and pooled connections.
