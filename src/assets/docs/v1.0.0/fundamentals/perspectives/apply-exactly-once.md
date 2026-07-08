---
title: Apply Exactly-Once Contract
version: 1.0.0
category: Core Concepts
order: 21
description: >-
  The Apply dispatch contract for perspective runners — Apply(TModel, TEvent)
  is invoked exactly once per event per perspective per stream. Projection
  Apply methods never need to be self-idempotent.
tags: >-
  perspectives, apply, dispatch, exactly-once, idempotency, drain-mode,
  perspective-runner, doubling
codeReferences:
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveRunner.cs
  - src/Whizbang.Generators/Templates/PerspectiveRunnerTemplate.cs
testReferences:
  - tests/Whizbang.Core.Integration.Tests/Perspectives/PerspectiveApplyExactlyOnceTests.cs
---

# Apply Exactly-Once Contract

The perspective dispatch contract is simple: **`Apply(TModel, TEvent)` is invoked exactly once per event, per perspective, per stream.** Projection `Apply` methods are pure functions; they are not required to be idempotent. The framework guarantees single dispatch.

## The contract

For every tuple of (`streamId`, `perspectiveName`, `eventId`), the generated `IPerspectiveRunner` invokes the projection's `Apply` method **at most once**. This holds across all dispatch paths:

- **Standard mode** — `RunAsync` reads events via `IEventStore.ReadPolymorphicAsync` from the cursor forward.
- **Drain mode** — `RunWithEventsAsync` receives pre-fetched events from the coordinator batch.
- **Rewind mode** — `RewindAndRunAsync` replays from a snapshot or from zero, with `IPerspectiveReplayReader` marking which events are new.

A projection writer should treat `Apply` as a write to collection state with no pre-existing dedup:

```csharp
public UberDraftJobModel Apply(UberDraftJobModel current, DraftJobEssentialFunctionRowAddedEvent evt) {
  current.EssentialFunctionRows.Add(new EssentialFunctionRow { RowId = evt.RowId, /* … */ });
  return current;
}
```

That code is correct. If the contract is ever violated, the symptom is an easy tell: the target collection contains duplicate rows (same `RowId`), or a counter increments by more than one.

## Why this contract exists

Making `Apply` self-idempotent pushes cost onto every projection author — every collection write needs a `RowId` check, every numeric accumulator needs a stamped `eventId` set, every scalar overwrite needs a timestamp comparison. The framework already knows which `(streamId, perspectiveName, eventId)` tuples have been dispatched; the exactly-once guarantee keeps projection code small.

## How the guarantee holds

### Standard mode

`PerspectiveWorker` groups pending `PerspectiveWork` by `(StreamId, PerspectiveName)` and invokes `runner.RunAsync(streamId, perspectiveName, lastProcessedEventId, …)` **once per group per cycle**. The runner reads events `> lastProcessedEventId` from the event store and applies them in UUIDv7 order.

### Drain mode

When the coordinator batch carries leased events, the worker batch-fetches with a single SQL call (`get_stream_events`) and feeds the pre-deserialized envelopes into `runner.RunWithEventsAsync`. The upstream SQL joins `perspective_events × event_store` — the same event can appear in the result multiple times if multiple queue rows reference it. The worker **dedupes by `MessageId`** at the group step before dispatching, so the runner sees each event exactly once while every queued `EventWorkId` still receives its own completion row.

### Drain/standard co-fire

If a stream appears in both `WorkBatch.PerspectiveStreamIds` (drain) and `WorkBatch.PerspectiveWork` (standard), the worker processes it via drain mode and clears the standard-mode work queue for that cycle. The two dispatch paths cannot co-fire for the same cycle.

### Rewind mode

During a rewind, `IPerspectiveReplayReader.ReadWithIsNewAsync` annotates each replayed event with `IsNewEvent`. The runner applies every event in UUIDv7 order to reconstruct model state, but the lifecycle receptors only fire for `IsNewEvent == true` — see [Exactly-Once Receptor Firing](../receptors/exactly-once-firing) for the receptor-side of this contract.

## Related

- [Perspectives overview](perspectives)
- [Drain mode](drain-mode)
- [Rebuild](rebuild)
- [Lifecycle receptors](../lifecycle/lifecycle-receptors)
- [Exactly-Once Receptor Firing](../receptors/exactly-once-firing)
