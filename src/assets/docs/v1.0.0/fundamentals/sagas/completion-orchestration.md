---
title: Completion Orchestration & Adaptive Watchdog
pageType: concept
version: 1.0.0
category: Application Blocks
order: 2
description: >-
  How Whizbang.Sagas closes a saga. The per-item event-driven completion path
  is primary; the watchdog is a safety net that uses progress-rate-based
  adaptive scheduling, not a fixed exponential schedule.
tags: 'sagas, completion, watchdog, scheduling, abandon, stall-detection'
codeReferences:
  - src/Whizbang.Sagas/Services/BaseSagaService.cs
  - src/Whizbang.Sagas/SagaOptions.cs
  - src/Whizbang.Sagas/SagaCompletionWatchdogTickEvent.cs
  - src/Whizbang.Sagas/SagaCompletionAbandonedEvent.cs
  - src/Whizbang.Core/Dispatcher.cs
---

# Completion Orchestration & Adaptive Watchdog

## When you need it

You have a saga that fans out N items to per-item handlers. When the saga is healthy, the last item to terminate fires `SagaItemCompletedEvent` → receptor → `TryRecoverViaWatchdogAsync` → `SagaCompletedEvent`. The whole thing closes on the same event flow that processed the items — no timer involved.

But that path can drop. A per-item terminal event can get lost in transport. A pod can die mid-receptor between writing the terminal event and updating the per-item projection row. The framework reconciler can be needed for a cross-pod-stranded row but the watchdog has to fire to trigger it.

The **completion watchdog** is the safety net. It fires on a budgeted schedule, calls `TryRecoverViaWatchdogAsync`, and either drives `SagaCompletedEvent` from event-store truth or re-arms with an adaptive next-tick interval. After enough consecutive ticks observe no progress, it emits `SagaCompletionAbandonedEvent` for operator triage instead of re-arming forever.

## The two completion paths

```
┌─────────────────────────────────────────────────────────────────┐
│ PRIMARY: event-driven completion                                │
│                                                                 │
│   per-item terminal event → SagaItemCompletedHandler →          │
│   TryRecoverViaWatchdogAsync → CompleteSagaAsync (one-shot)     │
│                                                                 │
│ Last item to terminate sees agg.Total == TotalItems, the        │
│ reconciler agrees with the event store, exactly-one             │
│ SagaCompletedEvent emits via PublishOnceAsync.                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓ if dropped
┌─────────────────────────────────────────────────────────────────┐
│ SAFETY NET: time-driven completion                              │
│                                                                 │
│   watchdog tick (scheduled_for in outbox) →                     │
│   TryRecoverViaWatchdogTickAsync →                              │
│       recovered          → exit                                 │
│       progress observed  → next tick at ETA + safety            │
│       no progress        → stall counter increments             │
│       max stalls reached → SagaCompletionAbandonedEvent         │
└─────────────────────────────────────────────────────────────────┘
```

## The cascade bug (motivating slot-3 incident, 2026-06-25)

`Dispatcher.PublishAsync(event, DispatchOptions)` used to honor `ScheduledFor` on the outbox row's `scheduled_for` column but invoke the in-process local receptor inline regardless. That made watchdog re-arm look like this:

```
T+0ms     SagaInitiatedEvent published
T+15ms    Initial watchdog tick fires inline (should be T+~65s for 350 items)
T+~30ms   Re-arm publishes next tick "for T+30s", fires inline immediately
T+~50ms   Re-arm publishes next tick, fires inline immediately
T+~70ms   Re-arm publishes next tick, fires inline immediately
T+86ms    SagaCompletionAbandonedEvent emitted (schedule exhausted)
T+4s      Item 1's SagaItemCompletedEvent arrives… but the saga is already
          abandoned, so the per-item recovery path no-ops.
```

The fix is at the dispatcher: `PublishAsync` now gates the local receptor on `ScheduledFor` the same way it gates the outbox pickup. Future `ScheduledFor` defers the local receptor to the outbox-pickup path (mig 040). Past or null `ScheduledFor` preserves immediate-dispatch semantics.

## Adaptive watchdog scheduling

The watchdog used to follow a fixed `[30s, 2m, 8m, 30m]` exponential. That works for the average case but ignores what the saga is actually doing — a 10,000-item saga and a 5-item saga ride the same schedule, and a saga that's actively making progress backs off the same way as one that's truly stuck.

The current scheduler is **progress-aware**. Each watchdog tick captures a snapshot on the next tick event and the next tick computes its delay from observed completion rate:

```
on tick:
  recovered = TryRecoverViaWatchdogAsync(ctx)
  if recovered: return Recovered

  current = ItemRepository.GetAggregateForSagaAsync(sagaId)
  delta   = (current.Completed + current.Failed)
            - (tick.LastObservedCompleted + tick.LastObservedFailed)

  if tick.LastObservedAt is null:
    # First re-arm — no prior measurement
    next_delay = ComputeInitialWatchdogBudget(current.Total)
    next_stall = 0

  elif delta > 0:
    # Progress observed — ETA-based
    elapsed   = now - tick.LastObservedAt
    rate      = delta / elapsed.TotalSeconds
    remaining = current.Total - (current.Completed + current.Failed)
    next_delay = remaining / rate + WatchdogSafetyMargin
    next_stall = 0

  else:
    # No progress between ticks — stall
    next_stall = tick.ConsecutiveStallCount + 1
    if next_stall >= MaxConsecutiveStalls:
      emit SagaCompletionAbandonedEvent
      return Abandoned
    next_delay = MinWatchdogDelay * StallBackoffMultiplier^next_stall

  next_delay = clamp(next_delay, MinWatchdogDelay, MaxWatchdogDelay)
  emit SagaCompletionWatchdogTickEvent {
    RescheduleCount = tick.RescheduleCount + 1,
    LastObservedAt = now,
    LastObservedCompleted = current.Completed,
    LastObservedFailed = current.Failed,
    ConsecutiveStallCount = next_stall,
  } scheduled_for now + next_delay
  return ReArmed
```

The snapshot lives on the tick event itself — no new table, no per-pod in-memory state to fragment across instances.

## Configuration

Five knobs on `SagaOptions`:

```csharp{title="Adaptive scheduler config"}
services.AddWhizbangSagas(opts => {
  opts.MinWatchdogDelay        = TimeSpan.FromSeconds(30); // floor
  opts.MaxWatchdogDelay        = TimeSpan.FromMinutes(30); // ceiling
  opts.WatchdogSafetyMargin    = TimeSpan.FromSeconds(30); // added to ETA
  opts.MaxConsecutiveStalls    = 4;                        // abandon threshold
  opts.StallBackoffMultiplier  = 2.0;                      // exponential on stall
});
```

| Knob | Default | Effect |
|---|---|---|
| `MinWatchdogDelay` | 30s | Floor on the next-tick delay. A fast burst observed rate can't trigger a tight re-arm loop. |
| `MaxWatchdogDelay` | 30 min | Ceiling on the next-tick delay. A near-zero rate (one trailing item) can't push the tick hours into the future. |
| `WatchdogSafetyMargin` | 30s | Added on top of the ETA when progress was observed, so the next tick lands a bit past the projected completion moment. |
| `MaxConsecutiveStalls` | 4 | Number of consecutive zero-progress ticks before abandon. Progress between ticks resets the counter — slow sagas don't trigger abandon, stuck ones do. |
| `StallBackoffMultiplier` | 2.0 | Exponential factor on stall: `MinDelay × Multiplier^stallCount`. Stall 1 = 60s, stall 2 = 120s, stall 3 = 240s, then abandon. |

## When the watchdog is structurally redundant

After the cascade fix, the watchdog is a **safety net**. During healthy fan-out:

1. The initial watchdog tick fires at `T + ComputeInitialWatchdogBudget(items)` — roughly `30s + items × 100ms`.
2. By then, most items have already terminated; per-item recovery receptors have been firing inline on every `SagaItemCompletedEvent`.
3. The watchdog observes either a near-zero remaining count (re-arms close to actual completion) or a recovered saga (exits).

You only need the watchdog when the event-driven path didn't close — a per-item terminal event got lost in transport, a pod died mid-receptor, or the framework reconciler needs the event-store slow-path for a stranded projection row.

## Stall detection vs abandon

Progress between ticks resets `ConsecutiveStallCount` to zero. A genuinely slow saga (one item taking minutes, others trickling in) keeps the counter at zero indefinitely — the watchdog will keep re-arming at clamped intervals until everything completes.

A stuck saga (transport-lost terminal event, projection-store wedged, an item caught in an infinite retry loop without emitting terminal) increments the counter on every tick that observes zero progress. After `MaxConsecutiveStalls`:

```csharp{title="SagaCompletionAbandonedEvent"}
public sealed class SagaCompletionAbandonedEvent : SagaEventBase {
  public string SagaName { get; set; }
  public Guid EntityId { get; set; }
  public int RescheduleCount { get; set; }  // count of the last tick
}
```

This is the operator-triage signal. Subscribe a consumer-side receptor to it for alerting / paging. The framework does NOT automatically retry or re-initiate the saga — the assumption is that anything reaching abandon needs human inspection.

## Related

- [Whizbang.Sagas overview](./whizbang-sagas) — the application block this is part of.
- [Versioned Apply](../perspectives/versioned-apply) — the opt-in storage-layer guard that closes the cross-pod strand on `SagaItemModel` beyond the v0.740 stream-affinity gate.
- [PublishOnceAsync](../dispatcher/publish-once) — the exactly-once primitive `CompleteSagaAsync` rides on.
- [Dispatcher Deep Dive](../dispatcher/dispatcher) — the `Dispatcher.PublishAsync(event, DispatchOptions)` semantics that the cascade fix corrected.
