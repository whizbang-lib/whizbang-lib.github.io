---
title: Completion Orchestration & Adaptive Watchdog
pageType: concept
verifiedAgainstCommit: 3a670b3a
verifiedDate: 2026-09-25
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
  - src/Whizbang.Sagas/Services/WatchdogTickOutcome.cs
  - src/Whizbang.Sagas/Services/ISagaWatchdogParticipant.cs
  - src/Whizbang.Sagas/Services/SagaWatchdogTickRouter.cs
  - src/Whizbang.Sagas/Services/SagaWatchdogTickRouterRegistrar.cs
  - src/Whizbang.Sagas/SagaServiceCollectionExtensions.cs
  - src/Whizbang.Sagas/Services/StrandedSagaSweepStep.cs
  - src/Whizbang.Sagas/Services/ISagaWakeLookup.cs
  - src/Whizbang.Sagas/Services/DispatcherSagaEventEmitter.cs
  - src/Whizbang.Data.Postgres/StreamsWithPendingMessagesSql.cs
  - src/Whizbang.Sagas/Models/IncompleteSaga.cs
  - src/Whizbang.Sagas/Repositories/ISagaItemRepository.cs
  - src/Whizbang.Core/Dispatcher.cs
testReferences:
  - tests/Whizbang.Sagas.Tests/Services/TryRecoverViaWatchdogTickAsyncTests.cs
  - tests/Whizbang.Sagas.Tests/Services/TryRecoverViaWatchdogAsyncTests.cs
  - tests/Whizbang.Sagas.Tests/CompletionOrchestrationGapTests.cs
  - tests/Whizbang.Sagas.Tests/Services/SagaWatchdogTickRoutingTests.cs
  - tests/Whizbang.Sagas.Tests/SagaWatchdogTickDeliveryIntegrationTests.cs
  - tests/Whizbang.Sagas.Tests/Services/StrandedSagaSweepTests.cs
  - tests/Whizbang.Sagas.Tests/Services/StrandedSagaSweepStepTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StreamsWithPendingMessagesSqlTests.cs
  - tests/Whizbang.Core.Tests/Dispatcher/DispatcherScheduledForLocalReceptorTests.cs
---

# Completion Orchestration & Adaptive Watchdog

## When you need it

You have a saga that fans out N items to per-item handlers. When the saga is healthy, the last item to terminate fires `SagaItemCompletedEvent` → receptor → `TryRecoverViaWatchdogAsync` → `SagaCompletedEvent`. The whole thing closes on the same event flow that processed the items — no timer involved.

But that path can drop. A per-item terminal event can get lost in transport. A pod can die mid-receptor between writing the terminal event and updating the per-item projection row. The framework reconciler can be needed for a cross-pod-stranded row but the watchdog has to fire to trigger it.

The **completion watchdog** is the safety net. It fires on a budgeted schedule, calls `TryRecoverViaWatchdogAsync`, and either drives `SagaCompletedEvent` from event-store truth or re-arms with an adaptive next-tick interval. After enough consecutive ticks observe no progress, it emits `SagaCompletionAbandonedEvent` for operator triage instead of re-arming forever.

## The two completion paths

```mermaid{caption="The two completion paths — the primary event-driven close (last item terminates, the reconciler agrees with the event store, exactly-one SagaCompletedEvent emits) and the watchdog safety net that re-arms on progress, increments a stall counter on no progress, backs off, and abandons after max consecutive stalls. Tests cover the watchdog safety-net transitions." tests=["TryRecoverViaWatchdogTickAsyncTests.NoProgressBetweenTicks_StallCounterIncrementsAndBacksOffAsync", "TryRecoverViaWatchdogTickAsyncTests.MaxConsecutiveStalls_AbandonsAsync", "TryRecoverViaWatchdogTickAsyncTests.ProgressAfterStalls_ResetsStallCounterAsync", "TryRecoverViaWatchdogTickAsyncTests.NextDelay_ClampedAtMaxAsync"]}
flowchart TD
    subgraph Primary["PRIMARY: event-driven completion"]
        P1["per-item terminal event"] --> P2["SagaItemCompletedRecoveryHandler"]
        P2 --> P3["TryRecoverViaWatchdogAsync"]
        P3 --> P4["CompleteSagaAsync (one-shot)"]
        PNote["Last item to terminate sees agg.Total == TotalItems,<br/>the reconciler agrees with the event store,<br/>exactly-one SagaCompletedEvent emits via PublishOnceAsync."]
    end

    subgraph Safety["SAFETY NET: time-driven completion"]
        S1["watchdog tick (scheduled_for in outbox)"] --> S2["TryRecoverViaWatchdogTickAsync"]
        S2 -->|"recovered"| S3["exit"]
        S2 -->|"progress observed"| S4["next tick at ETA + safety"]
        S2 -->|"no progress"| S5["stall counter increments"]
        S2 -->|"max stalls reached"| S6["SagaCompletionAbandonedEvent"]
    end

    Primary -->|"if dropped"| Safety

    style Primary fill:#d4edda,stroke:#28a745,stroke-width:2px
    style Safety fill:#fff3cd,stroke:#ffc107,stroke-width:2px
```

## The cascade bug the dispatcher fix closed

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

Six knobs on `SagaOptions`:

```csharp{title="Adaptive scheduler config" unverified="DI-wiring configuration of SagaOptions; the knobs' runtime effect is exercised by TryRecoverViaWatchdogTickAsyncTests, but this fence is options wiring"}
services.AddWhizbangSagas(opts => {
  opts.MinWatchdogDelay        = TimeSpan.FromSeconds(30); // floor
  opts.MaxWatchdogDelay        = TimeSpan.FromMinutes(30); // ceiling
  opts.WatchdogSafetyMargin    = TimeSpan.FromSeconds(30); // added to ETA
  opts.MaxConsecutiveStalls    = 4;                        // abandon threshold
  opts.StallBackoffMultiplier  = 2.0;                      // exponential on stall
  opts.StrandedSagaIdleGuard   = TimeSpan.FromMinutes(5);  // stranded-saga sweep
});
```

| Knob | Default | Effect |
|---|---|---|
| `MinWatchdogDelay` | 30s | Floor on the next-tick delay. A fast burst observed rate can't trigger a tight re-arm loop. |
| `MaxWatchdogDelay` | 30 min | Ceiling on the next-tick delay. A near-zero rate (one trailing item) can't push the tick hours into the future. |
| `WatchdogSafetyMargin` | 30s | Added on top of the ETA when progress was observed, so the next tick lands a bit past the projected completion moment. |
| `MaxConsecutiveStalls` | 4 | Number of consecutive zero-progress ticks before abandon. Progress between ticks resets the counter — slow sagas don't trigger abandon, stuck ones do. |
| `StallBackoffMultiplier` | 2.0 | Exponential factor on stall: `MinDelay × Multiplier^stallCount`. Stall 1 = 60s, stall 2 = 120s, stall 3 = 240s, then abandon. |
| `StrandedSagaIdleGuard` | 5 min | How long a saga with no tick coming must go without any change before the [stranded-saga sweep](#stranded-sagas) re-arms it. Covers a tick on the transport, which no table shows. |

## Hand-written sagas {#hand-written-sagas}

{verified: SagaWatchdogTickDeliveryIntegrationTests.HandWrittenSagaTick_DeliveredAtTheInboxStage_ReachesTheSagaAsync, SagaWatchdogTickDeliveryIntegrationTests.WithoutTheRouter_AHandWrittenSagaTick_ReachesNothingAsync, SagaWatchdogTickDeliveryIntegrationTests.HandWrittenSagaTick_AtTheSendingStage_DoesNotReachTheSagaAsync, SagaWatchdogTickDeliveryIntegrationTests.SagaAttributeTick_IsLeftToItsGeneratedReceiverAsync}

`BaseSagaService.InitiateSagaAsync` arms the watchdog for **every** saga it starts. A saga declared
with `[Saga]` gets a generated receiver for its ticks. A saga service written by hand — a class that
subclasses `BaseSagaService` directly and is registered with the container — does not, so register
it with `AddSagaService`:

```csharp{title="Registering a hand-written saga service" description="Exposes a BaseSagaService subclass to the framework's watchdog router so its ticks are received" category="Configuration" difficulty="BEGINNER" tags=["Sagas", "Watchdog", "Configuration"] tests=["SagaWatchdogTickRoutingTests.AddSagaService_RegistersTheServiceAndItsWatchdogParticipationAsOneInstanceAsync", "SagaWatchdogTickRoutingTests.AddWhizbangSagas_RegistersTheRouterRegistrarAsync"]}
services.AddWhizbangSagas();
services.AddSagaService<ImportSagaService>();   // instead of services.AddScoped<ImportSagaService>()
```

`AddSagaService<T>()` registers the service scoped and exposes the same instance as an
`ISagaWatchdogParticipant`, which `BaseSagaService` implements. `AddWhizbangSagas()` registers the
framework's `SagaWatchdogTickRouter` at startup, and the router hands each delivered tick to the
participant whose saga name it carries.

**Why it matters.** Before the router existed, a hand-written saga armed its tick, the transport
delivered it on time, and at the stage the inbox invokes there was no receptor for it — so it was
discarded without a trace. Nothing failed and nothing logged. On a healthy run the gap is invisible,
because the per-item fast path completes the saga first; it only matters once something else has
gone wrong, and then the safety net is simply absent.

Two rules keep the router safe:

- **It registers on the receiving side only** (`PostInboxInline`). A tick is armed for a future time;
  a receptor on the sending side would run at arming and re-arm immediately — the cascade described
  above.
- **A `[Saga]`-declared saga is not a participant.** It already has a generated receiver. Registering
  it with `AddSagaService` as well would deliver every tick twice and re-arm it twice.

## When the watchdog is structurally redundant

After the cascade fix, the watchdog is a **safety net**. During healthy fan-out:

1. The initial watchdog tick fires at `T + ComputeInitialWatchdogBudget(items)` — roughly `30s + items × 100ms`.
2. By then, most items have already terminated; per-item recovery receptors have been firing inline on every `SagaItemCompletedEvent`.
3. The watchdog observes either a near-zero remaining count (re-arms close to actual completion) or a recovered saga (exits).

You only need the watchdog when the event-driven path didn't close — a per-item terminal event got lost in transport, a pod died mid-receptor, or the framework reconciler needs the event-store slow-path for a stranded projection row.

## Stall detection vs abandon

Progress between ticks resets `ConsecutiveStallCount` to zero. A genuinely slow saga (one item taking minutes, others trickling in) keeps the counter at zero indefinitely — the watchdog will keep re-arming at clamped intervals until everything completes.

A stuck saga (transport-lost terminal event, projection-store wedged, an item caught in an infinite retry loop without emitting terminal) increments the counter on every tick that observes zero progress. After `MaxConsecutiveStalls`:

```csharp{title="SagaCompletionAbandonedEvent" tests=["TryRecoverViaWatchdogTickAsyncTests.MaxConsecutiveStalls_AbandonsAsync"]}
public class SagaCompletionAbandonedEvent : SagaEventBase, ISagaCompletionAbandonedEvent {
  public string SagaName { get; set; }
  public Guid EntityId { get; set; }
  public Guid StreamId { get; set; }        // the saga's stream
  public int RescheduleCount { get; set; }  // count of the last tick
}
```

This is the operator-triage signal. Subscribe a consumer-side receptor to it for alerting / paging. The framework does NOT automatically retry or re-initiate the saga — the assumption is that anything reaching abandon needs human inspection.

## Stranded items {#stranded-items}

{verified: TryRecoverViaWatchdogTickAsyncTests.MaxConsecutiveStalls_WithAStrandedItem_FailsItAndReArmsInsteadOfAbandoningAsync, TryRecoverViaWatchdogTickAsyncTests.MaxConsecutiveStalls_ItemAlreadyTerminalInTheStore_IsNotFailedAgainAsync, TryRecoverViaWatchdogTickAsyncTests.MaxConsecutiveStalls_ConsumerRedrivesTheItem_ItIsNotFailedAsync, TryRecoverViaWatchdogTickAsyncTests.StrandedByALostWorker_EndsCompletedWithOneFailure_NotAbandonedAsync}

When the process holding a started item goes away — a deploy, a node drain, a crash — the work goes
with it. No terminal event is written, no inbox row is left to reclaim, and nothing dead-letters it.
Abandoning the saga at the stall limit would throw away every item that did finish over the one that
could not.

So before abandoning, the watchdog **resolves stranded items**. At the stall limit, each item still
`Pending` or `Running` is checked against its per-item stream:

- **The store already records it as terminal** — skipped. Only the projection is behind, and the
  reconciler handles that.
- **No terminal event anywhere** — the worker was most likely lost. The item is offered to
  `TryRedriveStrandedItemAsync`. By default that returns `false` and the item is **failed** with a
  reason naming the likely cause, so the saga completes with the failure visible instead of hanging
  on it.

The watchdog then re-arms with its stall count reset, so the new terminal events can land before the
saga is judged stuck again. It abandons only when there was nothing to resolve.

A service whose item handler is idempotent can re-dispatch the work instead of failing the item:

```csharp{title="Re-dispatching a stranded item" description="Overrides the stranded-item hook so a lost worker's item is retried rather than failed" category="Sagas" difficulty="INTERMEDIATE" tags=["Sagas", "Watchdog", "Recovery"] tests=["TryRecoverViaWatchdogTickAsyncTests.MaxConsecutiveStalls_ConsumerRedrivesTheItem_ItIsNotFailedAsync"]}
protected override async Task<bool> TryRedriveStrandedItemAsync(
    SagaContext ctx, SagaItemModel item, CancellationToken cancellationToken) {
  await _dispatcher.SendAsync(new ImportItem(ctx.SagaId, item.ItemIdentifier));
  return true;   // the item stays in progress and the watchdog keeps watching
}
```

Only re-dispatch when the handler tolerates running twice: the lost worker may have got partway.

## Stranded sagas {#stranded-sagas}

{verified: StrandedSagaSweepTests.Sweep_NoTickComingAndIdle_ArmsOneTickAtTheStallLimitInTheSagasTenantAsync, StrandedSagaSweepTests.Sweep_TickStillComing_ArmsNothingAsync, StrandedSagaSweepTests.Sweep_WakeLookupCannotTell_ArmsNothingAsync, StrandedSagaSweepTests.Sweep_RecentItemActivity_ArmsNothingAsync, StrandedSagaSweepTests.Sweep_SameIdleState_ClaimsTheSameKey_NewActivityANewKeyAsync, StrandedSagaSweepTests.ArmedTick_OnArrival_ResolvesTheStrandedItemAsync, StrandedSagaSweepStepTests.Step_AsksTheCoordinatorForPendingTicks_AndHandsItsAnswerToEachSagaAsync}

The watchdog is a chain: the first tick is armed when the saga starts, and each tick arms the next.
Lose one tick and the chain ends. A tick can be lost to an instance that stops between the saga's work
and the tick's write, or to a version where nothing received it. The saga then stays in progress
forever, and upgrading to a version that recovers stranded sagas does not, by itself, recover the ones
already stranded.

So the maintenance cycle runs a **stranded-saga sweep** as one of its
[steps](../workers/maintenance-steps#maintenance-steps): after the schema is ready, once the service has
settled, on the maintenance interval. For each saga service it arms **one** tick for every incomplete
saga whose chain has ended, already at the stall limit, so the tick resolves
[stranded items](#stranded-items) the moment it arrives instead of serving a stall count the saga has
already served.

A chain has ended when both of these hold:

- **No tick is coming.** The sweep asks the work coordinator which of the sagas still have a watchdog
  tick waiting: in the outbox (unpublished, or scheduled for later) or in an inbox (unclaimed, or being
  handled now). A saga with one is left alone, however long ago that tick was scheduled for. Waking it
  would be early, and a second tick would start a second chain that re-arms beside the first forever.
  When the coordinator cannot tell, the sweep arms nothing.
- **Nothing has changed recently.** Neither the saga nor any of its items changed within
  `StrandedSagaIdleGuard` (five minutes). This covers the one place no table shows a tick: on the
  transport, between the outbox that sent it and the inbox that will receive it. A saga that changed
  that recently is moving, or has a tick in flight.

Every instance sweeps, and every restart sweeps again, so the tick is published with a claim key made
of the saga and the time of its last change. They all arrive at one emission. A saga that moves and
then stops again has a new last change, and is owed one more tick.

The tick is published as the system, in the saga's tenant, so it is handled exactly as the tick the saga
armed for itself was. That is why the sweep needs to know which sagas are incomplete **and which tenant
each belongs to**. Override `LoadIncompleteSagasAsync` on the saga service; the default returns none,
and the sweep then does nothing for that saga:

```csharp{title="Enumerating incomplete sagas for the sweep" description="Returns each incomplete saga with its tenant so the sweep can re-arm a watchdog chain that has ended" category="Sagas" difficulty="INTERMEDIATE" tags=["Sagas", "Watchdog", "Recovery"] tests=["StrandedSagaSweepTests.Sweep_NoTickComingAndIdle_ArmsOneTickAtTheStallLimitInTheSagasTenantAsync"]}
protected override async Task<IReadOnlyList<IncompleteSaga>> LoadIncompleteSagasAsync(
    CancellationToken cancellationToken) {
  var rows = await _sagas.ListIncompleteAcrossTenantsAsync(cancellationToken);
  return rows.Select(r => new IncompleteSaga(r.ToSagaModel(), r.TenantId)).ToList();
}
```

The newest item change comes from `ISagaItemRepository.GetLastActivityAsync`. Its default reads every
item row of the saga; a repository over a database should override it with a single `MAX` query.

## Related

- [Whizbang.Sagas overview](./whizbang-sagas) — the application block this is part of.
- [Versioned Apply](../perspectives/versioned-apply) — the opt-in storage-layer guard that closes the cross-pod strand on `SagaItemModel` beyond the v0.740 stream-affinity gate.
- [PublishOnceAsync](../dispatcher/publish-once) — the exactly-once primitive `CompleteSagaAsync` rides on.
- [Dispatcher Deep Dive](../dispatcher/dispatcher) — the `Dispatcher.PublishAsync(event, DispatchOptions)` semantics that the cascade fix corrected.
