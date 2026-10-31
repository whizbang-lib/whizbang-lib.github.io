---
title: Lifecycle Coordinator
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Core Concepts
order: 11
description: >-
  Centralized lifecycle management for event processing - guarantees each stage
  fires exactly once per event, tracks live events, and coordinates multi-path
  completion via the WhenAll pattern
tags: 'lifecycle, coordinator, tracking, PostLifecycle, WhenAll, pipeline'
codeReferences:
  - src/Whizbang.Core/Lifecycle/ILifecycleCoordinator.cs
  - src/Whizbang.Core/Lifecycle/LifecycleCoordinator.cs
  - src/Whizbang.Core/Lifecycle/ILifecycleTracking.cs
  - src/Whizbang.Core/Lifecycle/ILifecycleTrackingContext.cs
  - src/Whizbang.Core/Lifecycle/ILifecyclePerspectiveStageContext.cs
  - src/Whizbang.Core/Lifecycle/LifecycleTrackingState.cs
  - src/Whizbang.Core/Lifecycle/LifecycleTrackingPath.cs
  - src/Whizbang.Core/Lifecycle/DebugAwareStopwatch.cs
  - src/Whizbang.Core/Lifecycle/StageRecord.cs
  - src/Whizbang.Core/Observability/LifecycleCoordinatorMetrics.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
testReferences:
  - tests/Whizbang.Core.Component.Tests/Lifecycle/LifecycleCoordinatorTests.cs
  - tests/Whizbang.Core.Tests/Lifecycle/LifecycleCoordinatorSituationTests.cs
  - tests/Whizbang.Core.Tests/Lifecycle/PostLifecyclePipelineTests.cs
  - tests/Whizbang.Core.Component.Tests/Lifecycle/DebugAwareStopwatchTests.cs
  - tests/Whizbang.Core.Tests/Workers/PerspectiveWorkerPostLifecycleTests.cs
  - tests/Whizbang.Core.Tests/Workers/TransportConsumerWorkerPostLifecycleTests.cs
  - tests/Whizbang.Core.Tests/Lifecycle/LifecycleTrackingEndsTests.cs
  - tests/Whizbang.Core.Tests/Lifecycle/LifecycleCoordinatorDetachedRetentionTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PerspectiveWorkerDrainModeLifecycleTests.TrackingEnds.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PerspectiveWorkerStartupAndMaintenanceTests.cs
  - tests/Whizbang.Core.Tests/Lifecycle/LifecycleTrackingPathTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PerspectiveWorkerDrainModeLifecycleTests.LocalDispatchOverlap.cs
lastMaintainedCommit: '01f07906'
---

# Lifecycle Coordinator

The `ILifecycleCoordinator` is the centralized owner of all lifecycle stage transitions. It guarantees that **each stage fires exactly once per event** and that `PostLifecycle` fires only after all processing paths complete.

## Why a Coordinator?

Without centralized coordination, lifecycle stages were invoked independently by each worker. This led to:
- **Duplicate hook firings** when multiple code paths called `ProcessTagsAsync` for the same stage
- **PostLifecycle firing from 3 places** (Dispatcher, TransportConsumer, PerspectiveWorker) with no guarantee of exactly-once
- **No cross-path coordination** for `Route.Both()` events that traverse local and distributed paths simultaneously

The coordinator solves all of these by being the single source of truth for stage transitions.

---

## Pipeline Diagram

Events flow through different workers depending on their dispatch path. Each worker is a **segment** of the lifecycle, with well-defined entry and exit points. The coordinator tracks events only while they are **live in-memory** — tracking is abandoned at persistence/transport boundaries and recreated at entry points.

See [Lifecycle Stages Pipeline](lifecycle-stages.md#pipeline-overview) for the full pipeline diagram showing all stages per worker, including PostAllPerspectives and PostLifecycle.

**Key insight**: `PostLifecycle` always fires at the **end** of whichever worker is the last to act on the event. The coordinator guarantees this happens exactly once.

---

## Core Concepts

### Live Tracking {#live-tracking}

The coordinator only tracks events that are **live**: actively being processed in-memory. This prevents memory leaks and avoids tracking events across persistence boundaries.

- **Entry points**: `BeginTracking()` when an event enters a worker (dispatch, DB load, transport receive)
- **Exit points**: `AbandonTracking()` when an event leaves a worker (persisted to DB, sent to transport, processing complete)

Between entry and exit, the worker advances the event through stages using `AdvanceToAsync()`.

#### One entry per path {#tracking-paths}

An event can be live on more than one path in the same process at once: a service can dispatch an event locally while its perspective worker projects the same event and its outbox publishes it. The coordinator keys each entry by the path that tracks the event together with the event id, so each path has an entry of its own, with its own stage guard and its own end.

| `LifecycleTrackingPath` | Who tracks the event on it |
|-------------------------|----------------------------|
| `LocalDispatch` | The dispatcher's in-process run of a message, through its PostLifecycle after the local receptor |
| `Perspective` | The perspective worker's projection of a stored event, through PostAllPerspectives and PostLifecycle |
| `Outbox` | The outbox publish worker's publication of a message to the transport |
| `Inbox` | A transport consumer's receipt of a message from the transport |

- **Each path's entry is separate**: `BeginTracking` on two paths for the same event returns two handles, and the same path asking again for the same event gets the handle it already has.
- **One path never ends another's**: `AbandonTracking(path, eventId)` ends only that path's entry. The stale sweep ending one path's entry leaves the others alone.
- **The perspective gate belongs to the perspective path**: the event's [perspective WhenAll gate](#perspective-whenall) is held by the `Perspective` entry and ends only with it. Another path's end, or the sweep ending another path's entry, cannot open it.
- **A segment latch fires on its own path**: `ExpectCompletionsFrom` and `SignalSegmentCompleteAsync` take the path whose entry fires PostLifecycle, and the latch ends with that entry.

So PostAllPerspectives and the projection's PostLifecycle always fire for an event the process projects, even when the same process also dispatches that event locally and the local dispatch finishes first.

{verified: LifecycleTrackingPathTests.EachPathTracksTheSameEventInAnEntryOfItsOwnAsync, LifecycleTrackingPathTests.EndingOnePathsTracking_NeverEndsAnotherPathsTrackingOfTheSameEventAsync, LifecycleTrackingPathTests.EndingAnotherPathsTracking_LeavesThePerspectiveGateClosedAsync, LifecycleTrackingPathTests.Sweep_EndingAnotherPathsStaleEntry_LeavesThePerspectiveGateClosedAsync, LifecycleTrackingPathTests.SegmentLatch_FiresPostLifecycleOnItsOwnPathsTracking_AndEndsWithItAsync, PerspectiveWorkerDrainModeLifecycleTests.LocalDispatchOfAnEventTheWorkerIsProjecting_BothPathsCompleteTheirOwnLifecycleAsync}

:::updated
Tracking used to be keyed by the event id alone. A local dispatch of an event the same process was projecting took the perspective worker's entry, fired its own PostLifecycle on it, and then ended it together with the event's perspective gate, so PostAllPerspectives and the projection's PostLifecycle never fired for that event in that process. Each path now tracks the event in an entry of its own.

**Upgrading code that calls the coordinator directly**: `BeginTracking`, `GetTracking`, `AbandonTracking`, `ExpectCompletionsFrom` and `SignalSegmentCompleteAsync` now take a `LifecycleTrackingPath` as their first argument. Pass the path your code is acting as; a path only finds and ends entries it began. Receptors, `[FireAt]` stages and message tags need no change. The perspective WhenAll methods (`ExpectPerspectiveCompletions`, `SignalPerspectiveComplete`, `AreAllPerspectivesComplete`) still take the event id alone, because the gate always belongs to the `Perspective` entry.
:::

Every tracking entry has a defined end: the path that begins tracking ends it once the lifecycle it tracks is done. The [stale sweep](#stale-tracking-cleanup) is a safety net for an entry no exit ended, not what keeps memory stable. The `whizbang.lifecycle_coordinator.tracked_entries` gauge shows the live count (see [Observability](#observability)).

For the perspective worker, the exit is explicit:

- **Lifecycle complete**: once an event's perspective WhenAll gate is open, its PostAllPerspectives and PostLifecycle stages fire and its tracking ends.
- **Receptor failure**: when a PostAllPerspectives or PostLifecycle receptor throws, the failure is isolated (it is not retried in memory) and the entry still ends.
- **Cancellation**: when the stages are canceled mid-batch, every event whose gate is open has its tracking ended, and the cancellation propagates.
- **Waiting events keep their entries**: an event still waiting on a perspective that has not reported stays tracked for a later batch.
- **Ended events stay ended**: a cooled row that signals an event whose tracking already ended registers no new WhenAll expectation and fires nothing again.
- **Orphan replay**: the startup orphan replay ends each entry it began, whether its stages succeed or throw.

{verified: PerspectiveWorkerDrainModeLifecycleTests.DrainMode_EveryProjectedEventsTracking_EndsOnceItsLifecycleCompletesAsync, PerspectiveWorkerDrainModeLifecycleTests.DrainMode_AnEventWaitingOnAPerspectiveThatHasNotReported_StaysTrackedAsync, PerspectiveWorkerDrainModeLifecycleTests.DrainMode_APostAllPerspectivesReceptorThatThrows_StillEndsItsEventsTrackingAsync, PerspectiveWorkerDrainModeLifecycleTests.FirePostLifecycle_CanceledMidBatch_EndsEveryReadyEventsTrackingAsync, PerspectiveWorkerDrainModeLifecycleTests.FirePostLifecycle_AnEventWhoseTrackingEnded_IsNeitherRegisteredNorFiredAgainAsync, PerspectiveWorkerStartupAndMaintenanceTests.Startup_OrphanReplay_EndsEveryReplayedEventsTracking_WhetherItsStagesSucceedOrThrowAsync}

An ended entry keeps only its detached stages that are still running, and releases each one when it finishes.

{verified: LifecycleCoordinatorDetachedRetentionTests.EndedTracking_ReleasesItsDetachedStage_OnceTheStageFinishesAsync, LifecycleCoordinatorDetachedRetentionTests.EndedTracking_NeverRetainsADetachedStageThatAlreadyFinishedAsync}

:::updated
A re-delivered event whose earlier tracking entry has already ended now runs its PrePerspective and PostAllPerspectives receptors again, the same way the Dispatcher and transport paths already behave. Previously the perspective worker never ended its entries, so a leaked entry doubled as a per-process exactly-once guard. With the perspective worker's [cooldown cache](../../operations/workers/perspective-worker.md#cooldown-cache-capacity) on (the default), a re-delivered row is still skipped and nothing fires again. With the cooldown off, or after the cooldown TTL while the row is still pending, the event begins a new entry and its receptors run again. Make those receptors idempotent if they must not repeat.
:::

### Exactly-Once Stage Firing

When a worker calls `tracking.AdvanceToAsync(stage)`, the coordinator:
1. Updates the current stage on the tracking instance
2. Resolves `IReceptorInvoker` from the scoped service provider
3. Invokes all receptors registered at that stage — Detached stages fire-and-forget in their own scope; Inline stages are awaited before returning
4. Processes all message tags (tags fire at **every** stage as lifecycle observers)

It does not fire `ImmediateDetached`: that stage runs once per message, after the handler, never after a lifecycle stage. See [`ImmediateDetached`](lifecycle-stages.md#immediatedetached).

Because stage transitions go through a single code path, there is no way for a stage to fire twice for the same event.

### PostLifecycle Guarantee

`PostLifecycleDetached` and `PostLifecycleInline` are special — they are the **final stages** in an event's lifecycle. The coordinator guarantees they fire exactly once per event, at the end of whichever worker is the last to process it:

| Scenario | Who fires PostLifecycle |
|----------|----------------------|
| Local dispatch (`Route.Local`) | Dispatcher |
| Distributed, no perspectives | TransportConsumer |
| Distributed, with perspectives | PerspectiveWorker |
| `Route.Both()` | Whichever completes last (via WhenAll) |

---

## WhenAll Pattern

When an event goes through **multiple processing paths** (e.g., `Route.Both()`), PostLifecycle must fire only after ALL paths complete. The coordinator tracks expected completions:

`Route.Both()` example:

```mermaid{caption="Route.Both fan-in — the local path signals its completion and the distributed path (outbox to inbox to perspectives) signals its own; only when both arrive at the WhenAll gate does PostLifecycle fire exactly once." tests=["LifecycleCoordinatorTests.WhenAll_BothComplete_FiresPostLifecycleOnceAsync", "LifecycleCoordinatorTests.WhenAll_LocalAlone_DoesNotFirePostLifecycleDetachedAsync"]}
graph LR
    E["Event"]
    LD["Dispatcher processes"]
    LS["signals &quot;local done&quot;"]
    O["Outbox"]
    T["Transport"]
    I["Inbox"]
    P["Perspectives"]
    DS["signals &quot;distributed done&quot;"]
    W["WhenAll"]
    PL["PostLifecycle (once)"]

    E -->|"Local path"| LD --> LS --> W
    E -->|"Distributed path"| O --> T --> I --> P --> DS --> W
    W --> PL

    style E fill:#fff3cd,stroke:#ffc107
    style W fill:#d4edda,stroke:#28a745
    style PL fill:#d4edda,stroke:#28a745
```

### Usage

```csharp{title="WhenAll Pattern" description="Coordinating PostLifecycle across multiple processing paths" category="Architecture" difficulty="ADVANCED" tags=["Lifecycle", "Coordinator", "WhenAll"] tests=["LifecycleCoordinatorTests.WhenAll_LocalAlone_DoesNotFirePostLifecycleDetachedAsync", "LifecycleCoordinatorTests.WhenAll_BothComplete_FiresPostLifecycleOnceAsync"]}
// At cascade time, register expected completions on the tracking path that fires PostLifecycle
coordinator.ExpectCompletionsFrom(LifecycleTrackingPath.LocalDispatch, eventId,
  PostLifecycleCompletionSource.Local,
  PostLifecycleCompletionSource.Distributed);

// Signal the local segment complete
await coordinator.SignalSegmentCompleteAsync(
  LifecycleTrackingPath.LocalDispatch, eventId, PostLifecycleCompletionSource.Local, scopedProvider, ct);
// PostLifecycle does NOT fire yet: waiting for Distributed

// Later, signal the distributed segment complete
await coordinator.SignalSegmentCompleteAsync(
  LifecycleTrackingPath.LocalDispatch, eventId, PostLifecycleCompletionSource.Distributed, scopedProvider, ct);
// NOW PostLifecycle fires on the LocalDispatch entry: all segments complete
```

### Completion Sources

| Source | Meaning |
|--------|---------|
| `PostLifecycleCompletionSource.Local` | Local dispatch path completed |
| `PostLifecycleCompletionSource.Distributed` | Distributed path completed (outbox → inbox → perspectives) |
| `PostLifecycleCompletionSource.Outbox` | Outbox publishing completed (event left service) |

---

## Perspective WhenAll {#perspective-whenall}

When an event is processed by **multiple perspectives**, `PostAllPerspectivesDetached` must fire only after ALL perspectives complete. The coordinator tracks expected perspective completions per event:

```mermaid{caption="Perspective WhenAll fan-in — five perspectives each signal completion, and PostAllPerspectivesDetached fires only after the fifth (5/5) signal arrives; a partial set leaves the gate closed." tests=["LifecycleCoordinatorTests.ExpectPerspectiveCompletions_AllSignal_ReturnsTrueAsync", "LifecycleCoordinatorTests.ExpectPerspectiveCompletions_PartialSignal_ReturnsFalseAsync"]}
graph TB
    E["Event arrives → 5 perspectives registered"]
    PA["PerspectiveA completes → signal &quot;A done&quot; (1/5)"]
    PB["PerspectiveB completes → signal &quot;B done&quot; (2/5)"]
    PC["PerspectiveC completes → signal &quot;C done&quot; (3/5)"]
    PD["PerspectiveD completes → signal &quot;D done&quot; (4/5)"]
    PE["PerspectiveE completes → signal &quot;E done&quot; (5/5)"]
    F["PostAllPerspectivesDetached fires"]

    E --> PA
    E --> PB
    E --> PC
    E --> PD
    E --> PE
    PE --> F

    style PA fill:#cce5ff,stroke:#004085
    style PB fill:#cce5ff,stroke:#004085
    style PC fill:#cce5ff,stroke:#004085
    style PD fill:#cce5ff,stroke:#004085
    style PE fill:#cce5ff,stroke:#004085
    style F fill:#d4edda,stroke:#28a745
```

### Key Behaviors

- **Terminal stages always fire**: `PostAllPerspectivesDetached/Inline` and `PostLifecycleDetached/Inline` fire at the end of every event lifecycle — even when zero perspectives exist (`AreAllPerspectivesComplete` returns `true` when no expectations are registered). The WhenAll gate controls **timing** (wait for all to complete), not **whether** stages fire.
- **Short-circuits still signal**: Fast-return paths (cooldown, deduplication, already-processed checks) must still call `SignalPerspectiveComplete` for their perspective — otherwise the WhenAll gate never opens and PostAllPerspectives/PostLifecycle never fire. `SignalPerspectiveComplete` is idempotent, so re-signaling the same perspective is safe.
- **Cross-batch tracking**: Perspectives may be processed across multiple batch cycles. The coordinator preserves tracking state between batches so the WhenAll gate fires exactly once.
- **Registry-based expectations**: At startup, `PerspectiveWorker` builds a map from `IPerspectiveRunnerRegistry` (event type → all perspective names). This ensures expectations include ALL perspectives, not just those in the current batch.
- **Debounce cleanup**: Tracking entries have a sliding inactivity window. Each stage transition and perspective signal resets the timer, preventing premature cleanup while perspectives are still processing.

### Usage

```csharp{title="Perspective WhenAll" description="Coordinating PostAllPerspectives across multiple perspectives" category="Architecture" difficulty="ADVANCED" tags=["Lifecycle", "Coordinator", "Perspectives", "WhenAll"] tests=["LifecycleCoordinatorTests.ExpectPerspectiveCompletions_AllSignal_ReturnsTrueAsync", "LifecycleCoordinatorTests.ExpectPerspectiveCompletions_PartialSignal_ReturnsFalseAsync"]}
// Register expected perspectives for an event
coordinator.ExpectPerspectiveCompletions(eventId, ["PerspectiveA", "PerspectiveB", "PerspectiveC"]);

// Each perspective signals completion after processing
coordinator.SignalPerspectiveComplete(eventId, "PerspectiveA");
coordinator.SignalPerspectiveComplete(eventId, "PerspectiveB");
coordinator.SignalPerspectiveComplete(eventId, "PerspectiveC");
// Returns true on last signal — all perspectives complete

// Check gate
if (coordinator.AreAllPerspectivesComplete(eventId)) {
  // Fire PostAllPerspectives + PostLifecycle
  await tracking.AdvanceToAsync(LifecycleStage.PostAllPerspectivesDetached, sp, ct);
  await tracking.AdvanceToAsync(LifecycleStage.PostAllPerspectivesInline, sp, ct);
  await tracking.AdvanceToAsync(LifecycleStage.PostLifecycleDetached, sp, ct);
  await tracking.AdvanceToAsync(LifecycleStage.PostLifecycleInline, sp, ct);
}
```

---

## Stale Tracking Cleanup {#stale-tracking-cleanup}

Every path ends the entries it begins (see [Live Tracking](#live-tracking)), so the periodic sweep is a safety net for an entry no exit ended. It uses a debounce-style inactivity threshold read on the coordinator's clock:

- **`LastActivityUtc`**: Set on creation, reset on every stage transition and perspective signal, so an entry still being reported for is never ended
- **`CleanupStaleTracking(TimeSpan)`**: Ends entries inactive longer than the threshold and returns how many entries it removed
- **Completed entries are removed**: an entry whose lifecycle completed is removed whatever its age, and counted in `whizbang.lifecycle_coordinator.completed_tracking_swept`. A nonzero count names a path that skipped its exit.
- **Partial entries end**: an entry nothing has reported for within the threshold ends even when some of its expected perspectives reported. The end is counted in `whizbang.lifecycle_coordinator.partial_tracking_ended` and logged at Debug with the perspectives that never reported. PostAllPerspectives does not fire for that event in this process.
- **Injected clock**: `LifecycleCoordinator` takes an optional `TimeProvider` (the system clock when omitted, resolved from DI when one is registered), so tests can move time past the threshold deterministically
- **PerspectiveWorker**: Runs the sweep every 10th batch cycle with a 5-minute inactivity threshold
- **Snapshot**: the sweep works on a snapshot and skips an entry another path ended in the meantime, so no entry is counted twice

{verified: LifecycleTrackingEndsTests.Sweep_NeverRetainsACompletedEntry_HoweverRecentAsync, LifecycleTrackingEndsTests.Sweep_EndsAPartialEntry_OnceNoPerspectiveHasReportedForTheBound_NamingTheMissingPerspectivesAsync, LifecycleTrackingEndsTests.Sweep_KeepsAPartialEntry_WhilePerspectivesKeepReportingWithinTheBoundAsync, LifecycleTrackingEndsTests.Sweep_KeepsAnUnreportedEntry_UntilTheInjectedClockPassesTheBoundAsync}

:::updated
The sweep used to skip completed entries and preserve partial ones, so an entry the perspective worker never ended stayed for the life of the process. It now removes completed entries and ends partial ones, and the `stale_tracking_preserved_partial_perspectives` metric is gone (see [Observability](#observability)).
:::

---

## Observability {#observability}

The coordinator emits OTel metrics via `LifecycleCoordinatorMetrics` (meter: `Whizbang.LifecycleCoordinator`):

| Metric | Type | Description |
|--------|------|-------------|
| `whizbang.lifecycle_coordinator.active_tracked_events` | UpDownCounter | Events currently in lifecycle tracking |
| `whizbang.lifecycle_coordinator.pending_perspective_states` | UpDownCounter | Events awaiting perspective WhenAll completion |
| `whizbang.lifecycle_coordinator.pending_when_all_states` | UpDownCounter | Events awaiting segment WhenAll completion |
| `whizbang.lifecycle_coordinator.perspective_completions_signaled` | Counter | Individual perspective complete signals received |
| `whizbang.lifecycle_coordinator.all_perspectives_completed` | Counter | Events where all perspectives finished |
| `whizbang.lifecycle_coordinator.expectations_not_registered` | Counter | Events with no perspective expectations (key mismatch detector) |
| `whizbang.lifecycle_coordinator.post_all_perspectives_fired` | Counter | PostAllPerspectives stage executions |
| `whizbang.lifecycle_coordinator.post_lifecycle_fired` | Counter | PostLifecycle stage executions |
| `whizbang.lifecycle_coordinator.stage_transitions` | Counter | Stage transitions (tag: `stage`) |
| `whizbang.lifecycle_coordinator.stale_tracking_cleaned` | Counter | Stale tracking entries cleaned by inactivity threshold |
| `whizbang.lifecycle_coordinator.post_lifecycle_errors` | Counter | PostLifecycle stage errors that were isolated (per-event error isolation) |
| `whizbang.lifecycle_coordinator.tracked_entries` | Gauge | Tracking entries held right now; steady under load in a healthy service, a climb that never falls back is a path that begins tracking without ending it |
| `whizbang.lifecycle_coordinator.partial_tracking_ended` | Counter | Partial entries the stale sweep ended because some expected perspectives never reported |
| `whizbang.lifecycle_coordinator.completed_tracking_swept` | Counter | Completed entries the stale sweep removed: a path that skipped its exit |

{verified: LifecycleTrackingEndsTests.TrackedEntriesGauge_ReportsTheLiveTrackedCountAsync}

:::new
Lifecycle coordinator metrics are automatically registered via `AddWhizbang()`.
:::

:::updated
`whizbang.lifecycle_coordinator.stale_tracking_preserved_partial_perspectives` (`StaleTrackingPreservedPartialPerspectives`) was removed: the sweep no longer preserves partial entries. Point dashboards and alerts at `whizbang.lifecycle_coordinator.partial_tracking_ended` instead.
:::

---

## API Reference

### `ILifecycleCoordinator`

```csharp{title="ILifecycleCoordinator Interface" description="Centralized lifecycle stage coordination" category="API" difficulty="INTERMEDIATE" tags=["Lifecycle", "Coordinator", "API"] unverified="interface declaration — API surface; the coordinator's methods are exercised by LifecycleCoordinatorTests"}
public interface ILifecycleCoordinator {
  // Begin one path's tracking of an event at the specified entry stage
  ILifecycleTracking BeginTracking(
    LifecycleTrackingPath path, Guid eventId, IMessageEnvelope envelope,
    LifecycleStage entryStage, MessageSource source,
    Guid? streamId = null, Type? perspectiveType = null);

  // Get one path's current tracking of an event for runtime inspection
  ILifecycleTracking? GetTracking(LifecycleTrackingPath path, Guid eventId);

  // Register expected completions for WhenAll pattern, on the path whose tracking fires PostLifecycle
  void ExpectCompletionsFrom(
    LifecycleTrackingPath path, Guid eventId, params PostLifecycleCompletionSource[] sources);

  // Signal a processing segment completed
  ValueTask SignalSegmentCompleteAsync(
    LifecycleTrackingPath path, Guid eventId, PostLifecycleCompletionSource source,
    IServiceProvider scopedProvider, CancellationToken ct);

  // End one path's tracking at its exit point; other paths' tracking of the event is untouched
  void AbandonTracking(LifecycleTrackingPath path, Guid eventId);

  // Register expected perspective completions for per-event WhenAll (held by the Perspective path's entry)
  void ExpectPerspectiveCompletions(Guid eventId, IReadOnlyList<string> perspectiveNames);

  // Signal a perspective completed — returns true when all complete
  bool SignalPerspectiveComplete(Guid eventId, string perspectiveName);

  // Check if all expected perspectives have completed (true if no expectations)
  bool AreAllPerspectivesComplete(Guid eventId);

  // Remove stale tracking entries (debounce-style inactivity threshold)
  int CleanupStaleTracking(TimeSpan inactivityThreshold);
}
```

### `ILifecycleTracking`

```csharp{title="ILifecycleTracking Interface" description="Per-event tracking handle for stage advancement" category="API" difficulty="INTERMEDIATE" tags=["Lifecycle", "Tracking", "API"] unverified="interface declaration — API surface; AdvanceToAsync and AdvanceBatchAsync are exercised by LifecycleCoordinatorTests"}
public interface ILifecycleTracking {
  Guid EventId { get; }
  LifecycleStage CurrentStage { get; }
  bool IsComplete { get; }

  // Advance to the next stage — invokes receptors, then tags
  ValueTask AdvanceToAsync(LifecycleStage stage, IServiceProvider scopedProvider, CancellationToken ct);

  // Wait for in-flight detached tasks (graceful shutdown / testing)
  ValueTask DrainDetachedAsync();

  // Batch advancement for game-loop workers
  static ValueTask AdvanceBatchAsync(
    IEnumerable<ILifecycleTracking> trackings,
    LifecycleStage stage, IServiceProvider scopedProvider, CancellationToken ct);
}
```

---

## Tracking Context

The `ILifecycleTrackingContext` extends `ILifecycleContext` with coordinator-specific capabilities: timing, stage history, cancellation, and dynamic hook registration. It is optionally injectable by lifecycle receptors.

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `StageElapsed` | `TimeSpan` | Elapsed time in the current stage. Debug-aware: pauses when debugger is attached. |
| `TotalElapsed` | `TimeSpan` | Total elapsed time since tracking began. Debug-aware. |
| `ServiceInstance` | `ServiceInstanceInfo?` | The service instance processing this event. |
| `BatchSize` | `int` | Number of events in the current batch. Game loop workers: count of events. Independent mode: 1. |
| `StageHistory` | `IReadOnlyList<StageRecord>` | Stages this tracking instance has passed through, with timing. Only tracks the current hydrated run, not across persistence boundaries. |
| `IsCancelled` | `bool` | Whether this lifecycle has been cancelled. |
| `CancellationReason` | `string?` | The reason for cancellation, if cancelled. |

### Methods

| Method | Description |
|--------|-------------|
| `Cancel(string reason)` | Cancels remaining stages in this lifecycle. |
| `OnStage(LifecycleStage stage, Func<ILifecycleTrackingContext, CancellationToken, ValueTask> hook)` | Registers a delegate hook to fire at a specific stage. |

### Usage

```csharp{title="ILifecycleTrackingContext" description="Accessing tracking context in a lifecycle receptor" category="API" difficulty="INTERMEDIATE" tags=["Lifecycle", "Tracking", "Context"] unverified="illustrative receptor usage — reading StageElapsed / StageHistory and calling Cancel / OnStage; no in-map test asserts these tracking-context capabilities"}
[FireAt(LifecycleStage.PostPerspectiveInline)]
public class PerformanceMonitorReceptor : IReceptor<IEvent> {
  private readonly ILifecycleTrackingContext _tracking;

  public PerformanceMonitorReceptor(ILifecycleTrackingContext tracking) {
    _tracking = tracking;
  }

  public ValueTask HandleAsync(IEvent evt, CancellationToken ct) {
    // Check timing
    if (_tracking.StageElapsed > TimeSpan.FromSeconds(5)) {
      Console.WriteLine($"Slow stage detected: {_tracking.StageElapsed}");
    }

    // Review stage history
    foreach (var record in _tracking.StageHistory) {
      Console.WriteLine($"Stage {record.Stage}: {record.Duration}");
    }

    // Cancel remaining stages if needed
    if (_tracking.TotalElapsed > TimeSpan.FromMinutes(1)) {
      _tracking.Cancel("Lifecycle exceeded 1 minute timeout");
    }

    // Register a dynamic hook for a later stage
    _tracking.OnStage(LifecycleStage.PostLifecycleDetached, async (ctx, token) => {
      Console.WriteLine($"Total lifecycle time: {ctx.TotalElapsed}");
    });

    return ValueTask.CompletedTask;
  }
}
```

---

## Perspective Stage Context

The `ILifecyclePerspectiveStageContext` carries perspective-relevant information alongside the base lifecycle context during perspective lifecycle stages.

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `Lifecycle` | `ILifecycleContext` | The parent lifecycle context. |
| `PerspectiveNames` | `IReadOnlyList<string>` | Names of perspectives being processed in this stage. |
| `StreamId` | `Guid` | The stream ID being processed. |
| `LastProcessedEventId` | `Guid?` | The last successfully processed event ID (checkpoint position). |
| `PerspectiveType` | `Type?` | The perspective type being processed, if applicable. |

### Usage

```csharp{title="ILifecyclePerspectiveStageContext" description="Accessing perspective stage context in a lifecycle receptor" category="API" difficulty="INTERMEDIATE" tags=["Lifecycle", "Perspective", "Context"] unverified="illustrative receptor usage — reading perspective stage context (StreamId, PerspectiveNames, LastProcessedEventId, PerspectiveType); no in-map test asserts this context surface"}
[FireAt(LifecycleStage.PostPerspectiveInline)]
public class PerspectiveAuditReceptor : IReceptor<IEvent> {
  private readonly ILifecyclePerspectiveStageContext _perspectiveContext;

  public PerspectiveAuditReceptor(ILifecyclePerspectiveStageContext perspectiveContext) {
    _perspectiveContext = perspectiveContext;
  }

  public ValueTask HandleAsync(IEvent evt, CancellationToken ct) {
    Console.WriteLine($"Stream: {_perspectiveContext.StreamId}");
    Console.WriteLine($"Perspectives: {string.Join(", ", _perspectiveContext.PerspectiveNames)}");
    Console.WriteLine($"Checkpoint: {_perspectiveContext.LastProcessedEventId}");

    if (_perspectiveContext.PerspectiveType is not null) {
      Console.WriteLine($"Type: {_perspectiveContext.PerspectiveType.Name}");
    }

    return ValueTask.CompletedTask;
  }
}
```

---

## How Workers Use the Coordinator

### PerspectiveWorker (Game Loop)

```csharp{title="PerspectiveWorker Integration" description="Batch-synchronized stage advancement" category="Architecture" difficulty="ADVANCED" tags=["Lifecycle", "PerspectiveWorker", "GameLoop"] unverified="simplified sketch of the worker's exit; the behavior is verified by PerspectiveWorkerDrainModeLifecycleTests, listed under Live Tracking"}
// ENTRY: Begin tracking for each unique event in the batch
foreach (var (eventId, (envelope, streamId)) in batchProcessedEvents) {
  coordinator.BeginTracking(LifecycleTrackingPath.Perspective, eventId, envelope,
    LifecycleStage.PrePerspectiveDetached, MessageSource.Local, streamId);
}

// Advance all events through stages together (game loop)
// ... perspective processing ...

// Terminal stages: once per event whose WhenAll gate is open
foreach (var (eventId, (envelope, streamId)) in batchProcessedEvents) {
  var tracking = coordinator.GetTracking(LifecycleTrackingPath.Perspective, eventId);
  if (tracking is null || !coordinator.AreAllPerspectivesComplete(eventId)) {
    continue;  // still waiting on a perspective: keep the entry for a later batch
  }
  try {
    await tracking.AdvanceToAsync(LifecycleStage.PostAllPerspectivesDetached, scopedProvider, ct);
    await tracking.AdvanceToAsync(LifecycleStage.PostAllPerspectivesInline, scopedProvider, ct);
    await tracking.AdvanceToAsync(LifecycleStage.PostLifecycleDetached, scopedProvider, ct);
    await tracking.AdvanceToAsync(LifecycleStage.PostLifecycleInline, scopedProvider, ct);
  } finally {
    coordinator.AbandonTracking(LifecycleTrackingPath.Perspective, eventId);  // EXIT: also on receptor failure and cancellation
  }
}
```

The worker ends what it begins. The `finally` is why a failing terminal-stage receptor or a canceled batch still releases the entry; the startup orphan replay ends its entries the same way. See [Live Tracking](#live-tracking) for the full list of exits and the tests that lock them.

### Dispatcher (Independent)

```csharp{title="Dispatcher Integration" description="Independent lifecycle for local dispatch" category="Architecture" difficulty="INTERMEDIATE" tags=["Lifecycle", "Dispatcher", "Local"] unverified="verified by PostLifecyclePipelineTests, which is outside the current coverage map"}
// ENTRY: Begin tracking
var tracking = coordinator.BeginTracking(
  LifecycleTrackingPath.LocalDispatch, messageId, envelope, LifecycleStage.PostLifecycleDetached, MessageSource.Local);

// Fire PostLifecycle
await tracking.AdvanceToAsync(LifecycleStage.PostLifecycleDetached, scopedProvider, ct);
await tracking.AdvanceToAsync(LifecycleStage.PostLifecycleInline, scopedProvider, ct);

// EXIT: processing complete; ends only the LocalDispatch entry, never the perspective worker's
coordinator.AbandonTracking(LifecycleTrackingPath.LocalDispatch, messageId);
```

---

## Execution Modes

The coordinator supports two execution modes, matching the natural patterns of each worker:

| Mode | Workers | Behavior |
|------|---------|----------|
| **Game Loop** | PerspectiveWorker, TransportConsumer, OutboxWorker | All events in a batch advance through stages together. Enables batch optimization. |
| **Independent** | Dispatcher | Each event has its own lifecycle. Processes immediately, no batching. |

---

## Thread Safety

The coordinator is a **singleton** registered in DI. It uses `ConcurrentDictionary` for tracking state and atomic operations for WhenAll completion signaling. Multiple workers can concurrently:

- Begin/abandon tracking for different events, or for the same event on different paths
- Advance different events through stages
- Signal segment completion for WhenAll

---

## Registration

The coordinator is automatically registered when calling `AddWhizbang()`:

```csharp{title="Registration" description="Automatic registration via AddWhizbang" category="Configuration" difficulty="BEGINNER" tags=["Lifecycle", "DI", "Registration"] unverified="AddWhizbang DI registration — the coordinator is wired as a singleton automatically; no runtime behavior to assert"}
services.AddWhizbang(options => {
  // ILifecycleCoordinator is registered as singleton automatically
});
```

---

## Related Topics

- [Lifecycle Stages](lifecycle-stages.md) - All 28 lifecycle stages reference
- [Lifecycle Receptors](../receptors/lifecycle-receptors.md) - `[FireAt]` attribute and `ILifecycleContext`
- [Testing: Lifecycle Synchronization](../../operations/testing/lifecycle-synchronization.md) - Test patterns with lifecycle hooks
- [Message Tags](../messages/message-tags.md) - Tags fire at every stage as lifecycle observers
- [Metrics Reference](../../operations/observability/metrics.md#lifecycle-coordinator) - Complete metrics reference for all Whizbang subsystems including lifecycle coordinator
