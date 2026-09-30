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
  - src/Whizbang.Sagas/SagaFrameworkEventStreamIds.cs
  - src/Whizbang.Sagas/Helpers/SagaAbandonGuard.cs
  - src/Whizbang.Sagas/Services/SagaClaimPruneStep.cs
  - src/Whizbang.Core/Dispatch/IClaimedEmissionStore.cs
  - src/Whizbang.Sagas/Services/WatchdogTickOutcome.cs
  - src/Whizbang.Sagas/Services/ISagaWatchdogParticipant.cs
  - src/Whizbang.Sagas/Services/SagaWatchdogTickRouter.cs
  - src/Whizbang.Sagas/Services/SagaWatchdogTickRouterRegistrar.cs
  - src/Whizbang.Sagas/SagaServiceCollectionExtensions.cs
  - src/Whizbang.Core/Routing/RuntimeEventSubscription.cs
  - src/Whizbang.Core/Routing/EventSubscriptionDiscovery.cs
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
  - tests/Whizbang.Sagas.Tests/SagaWatchdogTickSubscriptionIntegrationTests.cs
  - tests/Whizbang.Sagas.Tests/Services/StrandedSagaSweepTests.cs
  - tests/Whizbang.Sagas.Tests/Services/StrandedSagaSweepStepTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StreamsWithPendingMessagesSqlTests.cs
  - tests/Whizbang.Core.Tests/Dispatcher/DispatcherScheduledForLocalReceptorTests.cs
  - tests/Whizbang.Sagas.Tests/SagaFrameworkEventStreamTests.cs
  - tests/Whizbang.Sagas.Tests/SagaWatchdogTickDeliveryCountTests.cs
  - tests/Whizbang.Core.Tests/Dispatcher/DispatcherLocalDispatchRecordTests.cs
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
        S2 -->|"already complete or saga not found"| S7["exit (chain ends)"]
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
  result = recover(ctx)             # the recovery TryRecoverViaWatchdogAsync runs
  if result is Recovered:       return Recovered
  if result is AlreadyComplete: return AlreadyComplete   # projection: CompletionEventDispatched
  if result is SagaNotFound:    return SagaNotFound      # loader wired, returned no saga

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

## Watchdog tick outcomes

`TryRecoverViaWatchdogTickAsync` returns a `WatchdogTickOutcome`. Three of them end the watchdog chain; the other two keep it going or hand it to an operator.

| Outcome | What the tick found | What happens next |
|---|---|---|
| `Recovered` | Every item terminal; the tick drove `SagaCompletedEvent` | Chain ends |
| `AlreadyComplete` | The saga projection carries `CompletionEventDispatched` | Chain ends |
| `SagaNotFound` | The projection loader returned no saga (deleted, or never known) | Chain ends |
| `ReArmed` | Saga still in progress | Next tick scheduled at the adaptive delay |
| `Abandoned` | No progress across `MaxConsecutiveStalls` ticks | `SagaCompletionAbandonedEvent` published |

`AlreadyComplete` is the most common outcome of all: the per-item path usually completes a saga before its watchdog tick fires, and that tick then has nothing to do. It schedules no next tick, counts no stall, resolves no stranded item and never abandons. A late tick cannot fail the items a fail-fast saga left non-terminal when it completed as Failed, and cannot publish an abandon event for a saga that finished normally.

`SagaNotFound` is reported only when the service wires a projection loader (overrides `LoadProjectionAsync`). A service without one cannot see the projection at all, so a missing projection says nothing about the saga, and its ticks keep re-arming as before.

The enum may grow. A receptor or logging override that switches on `WatchdogTickOutcome` should have a default arm.

## Configuration

Seven knobs on `SagaOptions`:

```csharp{title="Adaptive scheduler config" unverified="DI-wiring configuration of SagaOptions; the knobs' runtime effect is exercised by TryRecoverViaWatchdogTickAsyncTests, but this fence is options wiring"}
services.AddWhizbangSagas(opts => {
  opts.MinWatchdogDelay        = TimeSpan.FromSeconds(30); // floor
  opts.MaxWatchdogDelay        = TimeSpan.FromMinutes(30); // ceiling
  opts.WatchdogSafetyMargin    = TimeSpan.FromSeconds(30); // added to ETA
  opts.MaxConsecutiveStalls    = 4;                        // abandon threshold
  opts.StallBackoffMultiplier  = 2.0;                      // exponential on stall
  opts.StrandedSagaIdleGuard   = TimeSpan.FromMinutes(5);  // stranded-saga sweep
  opts.StrandedSagaRearmInterval = TimeSpan.FromHours(1);  // stranded-saga re-arm
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
| `StrandedSagaRearmInterval` | 1 hour | How often the [stranded-saga sweep](#stranded-sagas) arms another tick for a saga that stays stranded, counted in whole intervals of stillness since its last change. Must be positive. |

## Where a tick is received {#tick-delivery}

{verified: SagaWatchdogTickDeliveryCountTests.ScheduledTick_ReceivedByItsOwnService_IsHandledOnceAsync, SagaWatchdogTickDeliveryCountTests.ImmediateTick_ReceivedByItsOwnService_IsHandledOnceAsync, SagaWatchdogTickDeliveryCountTests.Tick_EachReceivingHost_HandlesItOnceAsync}

Both receivers, the `[Saga]`-generated `SagaCompletionWatchdogTickHandler` and the framework router
for hand-written sagas, answer at `PreInboxInline`. That stage runs once for every inbox row whichever
service published it, and it is on the receiving side, so a tick is never handled at the moment it is
armed. A saga's service normally arms and receives its own ticks. The post-inbox stage skips a message
this same service published, which is why a generated receiver there never saw its own scheduled
ticks, and only the stranded-saga sweep's ticks reached it.

Each host that receives a tick handles it once. Ticks share one topic, so two differently named
services that both declare the same saga would each check it: run a saga in one service. Whether to
claim each tick so it is handled once across services is an open question,
[#1005](https://github.com/whizbang-lib/whizbang/issues/1005).

## Hand-written sagas {#hand-written-sagas}

{verified: SagaWatchdogTickDeliveryIntegrationTests.HandWrittenSagaTick_DeliveredAtTheInboxStage_ReachesTheSagaAsync, SagaWatchdogTickDeliveryIntegrationTests.WithoutTheRouter_AHandWrittenSagaTick_ReachesNothingAsync, SagaWatchdogTickDeliveryIntegrationTests.HandWrittenSagaTick_AtTheSendingStage_DoesNotReachTheSagaAsync, SagaWatchdogTickDeliveryIntegrationTests.HandWrittenSagaTick_AfterTheInboxCommit_DoesNotReachTheSagaAgainAsync, SagaWatchdogTickDeliveryIntegrationTests.SagaAttributeTick_IsLeftToItsGeneratedReceiverAsync, SagaWatchdogTickSubscriptionIntegrationTests.AddSagaServiceOnly_SubscribesToTheTicksTopic_AndAPublishedTickReachesTheSagaAsync, SagaWatchdogTickSubscriptionIntegrationTests.WithoutWhizbangSagas_TheTicksTopicIsNotSubscribed_AndAPublishedTickIsNeverReceivedAsync, SagaWatchdogTickSubscriptionIntegrationTests.HostWithItsOwnTickReceptor_SubscribesOnce_AndEachTickIsRecoveredOnceAsync, SagaWatchdogTickSubscriptionIntegrationTests.AddSagaServiceOnly_TheTickSubscription_IsLoggedAndHealthyLikeAnyOtherAsync}

`BaseSagaService.InitiateSagaAsync` arms the watchdog for **every** saga it starts. A saga declared
with `[Saga]` gets a generated receiver for its ticks. A saga service written by hand — a class that
subclasses `BaseSagaService` directly and is registered with the container — does not, so register
it with `AddSagaService`:

```csharp{title="Registering a hand-written saga service" description="Exposes a BaseSagaService subclass to the framework's watchdog router and subscribes the host to the tick's topic, so its ticks are received" category="Configuration" difficulty="BEGINNER" tags=["Sagas", "Watchdog", "Configuration"] tests=["SagaWatchdogTickRoutingTests.AddSagaService_RegistersTheServiceAndItsWatchdogParticipationAsOneInstanceAsync", "SagaWatchdogTickRoutingTests.AddWhizbangSagas_RegistersTheRouterRegistrarAsync", "SagaWatchdogTickRoutingTests.AddWhizbangSagas_DeclaresTheTickAsConsumed_OnceHoweverOftenItIsCalledAsync", "SagaWatchdogTickSubscriptionIntegrationTests.AddSagaServiceOnly_SubscribesToTheTicksTopic_AndAPublishedTickReachesTheSagaAsync"]}
services.AddWhizbangSagas();
services.AddSagaService<ImportSagaService>();   // instead of services.AddScoped<ImportSagaService>()
```

`AddSagaService<T>()` registers the service scoped and exposes the same instance as an
`ISagaWatchdogParticipant`, which `BaseSagaService` implements. `AddWhizbangSagas()` registers the
framework's `SagaWatchdogTickRouter` at startup, and the router hands each delivered tick to the
participant whose saga name it carries.

**These two calls are all a hand-written saga needs, including the transport subscription.** A
service's subscriptions are normally derived at compile time from the receptors and perspectives the
source generator finds, and the router is registered at startup where that discovery cannot see it.
So `AddWhizbangSagas()` also declares the tick as an event the host consumes
([runtime event subscriptions](../dispatcher/routing#runtime-event-subscriptions)), and the transport
consumer subscribes to the tick's topic (`whizbang.sagas`) exactly as it would for a generated
receiver. The subscription is created and logged at startup like every other one. Do not write a tick
receptor of your own to get it: if a receptor you already have forwards ticks to a saga that is now
registered with `AddSagaService`, remove it, or each tick is recovered twice and re-armed twice. A host
that keeps such a receptor (for a saga not registered with `AddSagaService`) still subscribes to the
topic once, so each tick is delivered once.

**Why it matters.** Before the router existed, a hand-written saga armed its tick, the transport
delivered it on time, and at the stage the inbox invokes there was no receptor for it — so it was
discarded without a trace. Nothing failed and nothing logged. Once the router existed, a service that
relied on it alone still never subscribed to the tick's topic, so its ticks were published and never
received: they waited unread on the broker, and the stranded-saga sweep re-armed ticks that met the
same end. On a healthy run either gap is invisible, because the per-item fast path completes the saga
first; it only matters once something else has gone wrong, and then the safety net is simply absent.

Two rules keep the router safe:

- **It registers on the receiving side only**, at `PreInboxInline`. A tick is armed for a future
  time; a receptor on the sending side would run at arming and re-arm immediately — the cascade
  described above. It is the pre-inbox stage rather than the post-inbox one because the receptor
  invoker skips post-inbox receptors for a message its own service published, on the grounds that
  it already ran at publish. A saga service arms and receives its own ticks, so at the post-inbox
  stage every tick, including the ones the stranded-saga sweep arms, was received, committed and
  handed to nobody.
- **A `[Saga]`-declared saga is not a participant.** It already has a generated receiver. Registering
  it with `AddSagaService` as well would deliver every tick twice and re-arm it twice.

## When the watchdog is structurally redundant

After the cascade fix, the watchdog is a **safety net**. During healthy fan-out:

1. The initial watchdog tick fires at `T + ComputeInitialWatchdogBudget(items)` — roughly `30s + items × 100ms`.
2. By then, most items have already terminated; per-item recovery receptors have been firing inline on every `SagaItemCompletedEvent`.
3. The watchdog observes either a near-zero remaining count (re-arms close to actual completion), a recovered saga (exits), or a saga the per-item path already completed (exits with `AlreadyComplete`).

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

The event is stored on the saga's own stream, so a saga perspective can apply it to the saga's row
(`SagaApplyHelper.TrackAbandoned` records `SagaStatus.Abandoned`). It is published once per saga,
under the saga's abandonment claim; see [Abandoned sagas](#abandoned-sagas).

At the stall limit the watchdog abandons only as a last resort, in this order: it
[resolves stranded items](#stranded-items), and if there were none it
[completes a saga whose remaining items never started](#items-that-never-started); only a saga where
neither applies is abandoned.

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

## Items that never started {#items-that-never-started}

{verified: TryRecoverViaWatchdogTickAsyncTests.MaxConsecutiveStalls_ItemsWithNoRow_AreFailedAndTheSagaCompletesAsync, TryRecoverViaWatchdogTickAsyncTests.MaxConsecutiveStalls_ExpectedItemsKnown_FailsEachItemThatNeverGotARowAsync, TryRecoverViaWatchdogTickAsyncTests.MaxConsecutiveStalls_ItemsWithNoRowAndARowBehindTheStore_CountsWhatTheStoreRecordsAsync, TryRecoverViaWatchdogTickAsyncTests.MaxConsecutiveStalls_NoItemRowAtAll_IsAbandonedUnlessTheExpectedItemsAreKnownAsync, TryRecoverViaWatchdogTickAsyncTests.MaxConsecutiveStalls_ItemsWithNoRowButNoKnownTotal_IsAbandonedAsync}

A fan-out can stop partway: the worker dispatching a saga's items dies after starting 337 of 350.
The 13 items it never reached have no item row at all. The reconciler counts terminal rows against the
saga's total and can never reach it, and stranded-item resolution only reaches rows that exist, so
such a saga used to be abandoned, discarding the 337 items that ran.

The watchdog resolves it at the stall limit, in one of two ways.

**When the service can say which items the saga was started with**, override
`LoadExpectedItemIdentifiersAsync`. Each expected item with no row is then treated exactly like a
stranded item: skipped if its per-item stream already records it as terminal, offered to
`TryRedriveStrandedItemAsync`, and otherwise failed with a reason saying it never started. Every
failure shows against the item that failed, and the saga completes once the failures land. This is
the preferred answer, because it records which items did not run.

```csharp{title="Naming the items a saga expects" description="Lets the watchdog fail, by name, each item the fan-out never started" category="Sagas" difficulty="INTERMEDIATE" tags=["Sagas", "Watchdog", "Recovery"] tests=["TryRecoverViaWatchdogTickAsyncTests.MaxConsecutiveStalls_ExpectedItemsKnown_FailsEachItemThatNeverGotARowAsync"]}
protected override async Task<IReadOnlyList<string>?> LoadExpectedItemIdentifiersAsync(
    SagaContext ctx, CancellationToken cancellationToken) {
  var import = await _imports.GetAsync(ctx.EntityId, cancellationToken);
  return import?.RowIds.Select(id => id.ToString()).ToList();   // null: cannot say
}
```

**Otherwise the watchdog counts.** At the stall limit, with nothing left to resolve and every recorded
row terminal (a row the store already records as terminal counts as the store records it), nothing
else can move: the items with no row were never going to start. The saga completes as
`CompletedWithFailures`, with failed = total − completed.

Two cases are still abandoned: a saga that recorded **no item row at all** (there is no evidence to
complete it on, unless `LoadExpectedItemIdentifiersAsync` names its items), and a saga whose total
cannot be read (no projection loader, or a total of zero).

## Stranded sagas {#stranded-sagas}

{verified: StrandedSagaSweepTests.Sweep_NoTickComingAndIdle_ArmsOneTickAtTheStallLimitInTheSagasTenantAsync, StrandedSagaSweepTests.Sweep_TickStillComing_ArmsNothingAsync, StrandedSagaSweepTests.Sweep_WakeLookupCannotTell_ArmsNothingAsync, StrandedSagaSweepTests.Sweep_RecentItemActivity_ArmsNothingAsync, StrandedSagaSweepTests.Sweep_SameIdleState_ClaimsTheSameKey_NewActivityANewKeyAsync, StrandedSagaSweepTests.Sweep_TickLostAndSagaStillStranded_IsReArmedAfterTheInterval_NotBeforeAsync, StrandedSagaSweepTests.Sweep_SeveralInstancesInOneInterval_ArmOneTickAsync, StrandedSagaSweepTests.Sweep_TickStillComing_IsNotReArmedHoweverManyIntervalsHavePassedAsync, SagaWatchdogTickSubscriptionIntegrationTests.SweepTickPublishedByTheSagasOwnService_IsReceivedKeptAndReachesTheSagaAsync, StrandedSagaSweepTests.ArmedTick_OnArrival_ResolvesTheStrandedItemAsync, StrandedSagaSweepStepTests.Step_AsksTheCoordinatorForPendingTicks_AndHandsItsAnswerToEachSagaAsync}

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
of the saga, the time of its last change, and the number of whole `StrandedSagaRearmInterval`s (one
hour) it has been still since. Every instance and restart sweeping the same stop in one interval
arrives at one emission. A saga that moves and then stops again has a new last change, and is owed
one more tick.

The claim records that a tick was **published**, not that it was **handled**. A tick can still be
lost after it is published, and a stranded saga never changes, so without the interval its first
sweep tick would also be its last. With it, a saga that is still stranded a whole interval later
is owed another tick, and gets one per interval until something changes. A saga with a tick still
waiting is never re-armed, whatever the interval.

The sweep finds a pending tick by the saga's stream, and the watchdog tick is stored on that stream,
so a tick the sweep armed itself is seen as pending for as long as it waits.

An abandoned saga is not re-armed: the sweep leaves out a saga whose perspective records
`SagaStatus.Abandoned`, and any saga holding its abandonment claim. See [Abandoned sagas](#abandoned-sagas).

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

{verified: StrandedSagaSweepTests.Sweep_ItemRepositoryRequiresTenantScope_ReadsInTheSagasTenantAndArmsTheTickAsync, StrandedSagaSweepTests.Sweep_SagasInDifferentTenants_EachIsReadAndArmedInItsOwnTenantAsync, StrandedSagaSweepTests.Sweep_SagaWithNoTenant_IsReadInTheWorkersOwnContextAsync, StrandedSagaSweepTests.Sweep_OneSagasReadThrows_TheOthersAreStillArmedAndTheFailureIsLoggedAsync, StrandedSagaSweepTests.Sweep_CanceledMidSweep_StopsTheSweepAsync}

**Each saga is swept inside its own tenant.** The sweep runs on a maintenance worker with no request
and no ambient tenant, and one sweep crosses tenants. So everything it does for one saga runs as the
system in that saga's tenant: the last-activity read, the item aggregate read, and the tick it arms.
An item repository that reads through a tenant-scoped lens, which refuses to run without an ambient
tenant, works unchanged. A saga with no tenant is read in the worker's own context.
`LoadIncompleteSagasAsync` itself still runs with no tenant, because it enumerates sagas across all of
them; the override has to read across tenants on its own terms, as the example above does.

**One saga's failure does not stop the sweep.** If reading or arming one saga throws, the sweep logs a
warning naming the saga, its id and its tenant, and moves on to the next. Only the sweep's own
cancellation stops it. Before this, a single saga whose reads failed ended the whole sweep for its saga
service, every cycle, so every other stranded saga of that service stayed stranded behind it.

## Abandoned sagas {#abandoned-sagas}

{verified: StrandedSagaSweepTests.Sweep_AbandonedSaga_IsNotReArmedInLaterIntervalsAsync, StrandedSagaSweepTests.Sweep_ArmsARunningSaga_BesideOneHoldingItsAbandonmentClaimAsync, StrandedSagaSweepTests.Sweep_EmitterThatCannotReadClaims_ArmsAsBeforeAsync, StrandedSagaSweepTests.ReDrive_AbandonedSaga_ReleasesTheClaimAndArmsAFreshTickAsync, StrandedSagaSweepTests.ReDrive_SagaNotAbandoned_ArmsNothingAsync, TryRecoverViaWatchdogTickAsyncTests.MaxConsecutiveStalls_AbandonsUnderTheSagasAbandonmentClaimAsync, TryRecoverViaWatchdogTickAsyncTests.MaxConsecutiveStalls_AbandonmentAlreadyClaimed_PublishesNoSecondAbandonEventAsync}

Abandoning a saga decides that it is not coming back on its own. The watchdog records that decision
as a claim, `saga-abandoned:{sagaName}:{sagaId}`, taken through
[`PublishOnceAsync`](../dispatcher/publish-once) when it publishes `SagaCompletionAbandonedEvent`.

- **The stranded-saga sweep leaves a saga holding the claim alone**, however many intervals pass. It
  reads the claims of its candidates in one query, before it asks about pending ticks.
- **A second abandonment publishes nothing.** A tick from an older chain can still reach the stall
  limit; the claim is already held, so no second event is published.

The claim works for every consumer. A saga perspective that applies the abandon event also records
`SagaStatus.Abandoned`, which the sweep honors too, but a consumer whose perspective does not apply it
is covered by the claim alone. A claim store or emitter that cannot read claims back leaves the sweep
arming as it did before the claim existed.

### Re-driving an abandoned saga

Once the cause is dealt with (a worker restored, an item re-dispatched), an operator puts the saga
back under the watchdog:

```csharp{title="Re-driving an abandoned saga" description="Releases the abandonment claim and arms a fresh watchdog chain with its whole stall budget" category="Sagas" difficulty="INTERMEDIATE" tags=["Sagas", "Watchdog", "Operations"] tests=["StrandedSagaSweepTests.ReDrive_AbandonedSaga_ReleasesTheClaimAndArmsAFreshTickAsync"]}
var redriven = await importSaga.ReDriveAbandonedSagaAsync(
    new SagaContext(sagaId, entityId), cancellationToken);
// false: the saga held no abandonment claim, and nothing was armed
```

`ReDriveAbandonedSagaAsync` releases the claim and arms a fresh tick at once. The tick checks
completion straight away, and a saga still not moving is abandoned again only after
`MaxConsecutiveStalls` more stalls. For a saga holding no claim it does nothing, so it cannot start a
second chain beside a live one.

If the saga's perspective recorded `SagaStatus.Abandoned`, also move the saga back to running through
the reset path: the sweep skips it on that status, and `TryComplete` records a completion only from
running.

## Claim retention {#claim-retention}

{verified: SagaClaimPruneStepTests.Run_PrunesSweepCompletionAndContinuationClaimsPastTheRetention_AndKeepsAbandonmentsAsync, SagaClaimPruneStepTests.Run_WithTheMaintainerDutyAssigned_PrunesOnlyOnItsHolderAsync, SagaClaimPruneStepTests.Run_UsesTheConfiguredRetentionAsync}

A saga takes claims as it runs: one per stranded-saga sweep tick, one for its completion, and one per
continuation it requests. A maintenance step, `saga-claim-prune`, deletes them once they are older
than `SagaOptions.ClaimRetention` (seven days). A sweep claim is dead once its interval has passed, and
a completion or continuation claim exists only after the saga has completed.

The **abandonment claim is kept**. It is the record that stops the sweep re-arming an abandoned saga,
and it goes only when an operator [re-drives](#abandoned-sagas) the saga.

Where role assignment manages the maintainer duty, only its holder prunes. Otherwise every instance
does; the delete is by age and idempotent. Past the retention window, a completion claim no longer
dedups a very late second completion attempt; the projection's completion flag still ends the
watchdog's.

## Related

- [Whizbang.Sagas overview](./whizbang-sagas) — the application block this is part of.
- [Versioned Apply](../perspectives/versioned-apply) — the opt-in storage-layer guard that closes the cross-pod strand on `SagaItemModel` beyond the v0.740 stream-affinity gate.
- [PublishOnceAsync](../dispatcher/publish-once) — the exactly-once primitive `CompleteSagaAsync` rides on.
- [Dispatcher Deep Dive](../dispatcher/dispatcher) — the `Dispatcher.PublishAsync(event, DispatchOptions)` semantics that the cascade fix corrected.
