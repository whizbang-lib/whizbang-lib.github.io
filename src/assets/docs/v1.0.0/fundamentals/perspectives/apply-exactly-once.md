---
title: Apply Exactly-Once Contract
pageType: concept
verifiedAgainstCommit: 74e1dea3
verifiedDate: 2026-10-04
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
  - src/Whizbang.Core/Perspectives/PerspectiveIdempotencyFilter.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
  - src/Whizbang.Core/Workers/ProcessedEventCache.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveRunner.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveReplayReader.cs
  - src/Whizbang.Generators/Templates/PerspectiveRunnerTemplate.cs
testReferences:
  - tests/Whizbang.Core.Tests/Perspectives/PerspectiveIdempotencyFilterTests.cs
  - tests/Whizbang.Core.Integration.Tests/Perspectives/PerspectiveApplyExactlyOnceTests.cs
  - tests/Whizbang.Core.Tests/Workers/ProcessedEventCacheTests.cs
  - tests/Whizbang.Core.Tests/Workers/PerspectiveWorkerDedupTests.cs
  - tests/Whizbang.Core.Tests/Workers/PerspectiveWorkerDrainModeTests.cs
---

# Apply Exactly-Once Contract

The perspective dispatch contract is simple: **`Apply(TModel, TEvent)` is invoked exactly once per event, per perspective, per stream.** Projection `Apply` methods are pure functions; they are not required to be idempotent. The framework guarantees single dispatch.

## The contract

For every tuple of (`streamId`, `perspectiveName`, `eventId`), the generated `IPerspectiveRunner` invokes the projection's `Apply` method **at most once**. This holds across all dispatch paths:

- **Standard mode** — `RunAsync` reads events via `IEventStore.ReadPolymorphicAsync` from the cursor forward.
- **Drain mode** — `RunWithEventsAsync` receives pre-fetched events from the coordinator batch.
- **Rewind mode** — `RewindAndRunAsync` replays from a snapshot or from zero, with `IPerspectiveReplayReader` marking which events are new.

A projection writer should treat `Apply` as a write to collection state with no pre-existing dedup:

```csharp{
title: "Write a non-idempotent perspective Apply that relies on exactly-once dispatch"
description: "A projection Apply method that blindly appends a collection row without a dedup check, correct because the framework guarantees Apply runs exactly once per event per perspective per stream."
framework: "NET10"
category: "Perspectives"
difficulty: "ADVANCED"
tags: ["perspectives", "apply", "exactly-once", "idempotency", "projection"]
unverified: "consumer OrderModel projection illustration; the exactly-once dispatch it relies on is covered by PerspectiveApplyExactlyOnceTests"
}
public OrderModel Apply(OrderModel current, OrderLineRowAddedEvent evt) {
  current.OrderLineRows.Add(new OrderLineRow { RowId = evt.RowId, /* … */ });
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

During a rewind, `IPerspectiveReplayReader.ReadReplayEventsAsync` annotates each replayed event with an `IsNew` flag (`ReplayEventEnvelope.IsNew` — `true` when the event still has a pending row in the perspective work queue). The runner applies every event in UUIDv7 order to reconstruct model state, but the lifecycle receptors only fire for `IsNew == true` — see [Exactly-Once Receptor Firing](../receptors/exactly-once-firing) for the receptor-side of this contract.

### The idempotency filter: comparing the row's position {#idempotency-filter}

A row records where it got to so that a re-delivered event is not folded in twice. Before `Apply`, the
generated runner asks `PerspectiveIdempotencyFilter.IsAlreadyApplied` once per event, passing the row's
recorded position and the event's own.

The row's position comes in two forms, and only one of them is dependable:

| Signal | Dependable? |
|---|---|
| `metadata.CommitSequence` — `wh_event_store.commit_sequence` of the last applied event | **Yes.** Stamped after commit, monotonic per database. |
| `metadata.EventId` — the last applied event's id | Only when both ids are UUIDv7. A UUIDv7 encodes its timestamp in the leading bytes, so lexical order is commit order. |

So the filter compares commit sequences whenever both sides have one. When they do not, the question
changes from *which came first* to **can these two positions be compared at all** — and when the answer is
no, the filter defers: it reports not-applied and lets `Apply` run.

```text
both sides stamped        → compare commit_sequence          (authoritative)
one side stamped          → defer                            (not comparable)
neither stamped,
  both ids UUIDv7         → compare ids as text              (lexical order is commit order)
  either id not UUIDv7    → defer                            (not comparable)
```

**Why deferring is the right direction.** The two errors are not symmetrical. Re-applying an event a
second time is visible — a duplicate collection row, a counter that moved by two — and it is recoverable.
Discarding an event that was never applied leaves the read model permanently wrong with nothing pending to
repair it, because the work rows are deleted once the runner reports the batch complete. The filter exists
to prevent doubling, so where it cannot establish ordering it does nothing and leaves the decision to
`Apply`.

**Where a non-UUIDv7 position comes from.** A row last written by an older version of this library carries
`{"EventType":"Unknown","EventId":"<random v4 GUID>","CommitSequence":null}`. A v4 id encodes no timestamp:
its leading nibble is random, so it sits at an arbitrary point in the same ordering — roughly 15 times in
16 **above** every UUIDv7 generated this decade. Comparing against it does not give a less precise answer,
it gives an unrelated one, and for most such rows the answer is "already applied" for every event that will
ever arrive. Those rows record no position this filter can read, which is why they defer.

The filter also defers when the stored id does not parse, and when the incoming id is `Guid.Empty` or
otherwise not time-ordered. Both sort below a UUIDv7, so a text comparison would quietly report
already-applied.

### Re-delivery guard: ProcessedEventCache

Perspective completions are written back to the database in batches. Between Apply and the database acknowledging that completion, SQL polling can re-deliver the same `wh_perspective_events` rows. `PerspectiveWorker` guards this window with an in-memory two-phase TTL cache (`ProcessedEventCache`):

- **InFlight** — event work IDs are added to the cache after Apply, with no expiry, guarding until the database confirms the completion batch.
- **Retained** — once the batch is acknowledged (`ActivateRetention`), the TTL countdown starts, aligned to the lease duration.
- **Evicted** — expired entries are removed at the start of each poll cycle (`EvictExpired`); SQL re-delivery is then allowed again, which is correct for rewind/rebuild scenarios.

Before grouping standard-mode work, the worker filters out any work item whose `WorkId` is already in the cache. The cache also provides force-removal (`Remove`/`RemoveRange`) for rewind scenarios, allowing replay of previously processed events.

## Related

- [Perspectives overview](perspectives)
- [Perspective Worker (drain mode)](../../operations/workers/perspective-worker)
- [Rebuild](rebuild)
- [Rewind (cursor inversion)](rewind)
- [Lifecycle receptors](../receptors/lifecycle-receptors)
- [Exactly-Once Receptor Firing](../receptors/exactly-once-firing)
