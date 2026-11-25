---
title: Perspective Write Modes
pageType: concept
category: Perspectives
order: 16
status: current
version: 1.0.0
description: >-
  How the perspective runner writes a batch of folded models: set-based across streams by default,
  per-stream as an option, write-behind as an opt-in for a few very hot streams, and the seams the
  modes plug into.
tags: >-
  perspectives, write-modes, set-based, batching, round-trips, fan-out, perspective-runner,
  perspective-worker, conformance-suite, write-behind
codeReferences:
  - src/Whizbang.Core/Perspectives/PerspectiveRunnerBase.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
  - src/Whizbang.Core/Workers/BatchedCompletionStrategy.cs
  - src/Whizbang.Core/Workers/PerspectiveCompletionFlushWorker.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveRunner.cs
  - src/Whizbang.Core/Perspectives/PreparedPerspectiveApply.cs
  - src/Whizbang.Core/Perspectives/PerspectiveApplyLockSet.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveWriteSink.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveStateSource.cs
  - src/Whizbang.Core/Perspectives/BatchedPerspectiveStateSource.cs
  - src/Whizbang.Core/Perspectives/IApplyBatchStrategy.cs
  - src/Whizbang.Core/Perspectives/PerspectiveWriteMode.cs
  - src/Whizbang.Core/Workers/PerspectiveApplyBatch.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.ClaimedGroups.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.DrainGroups.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.WriteBehind.cs
  - src/Whizbang.Core/Workers/PerspectiveWriteBehindCache.cs
  - src/Whizbang.Core/Workers/WriteBehindBatchState.cs
  - src/Whizbang.Core/Perspectives/PerspectiveWriteBehindOptions.cs
  - src/Whizbang.Core/Perspectives/PerspectiveWriteBehindRow.cs
  - src/Whizbang.Core/Perspectives/PendingPerspectiveWrite.cs
  - src/Whizbang.Core/Observability/PerspectiveMetrics.cs
testReferences:
  - tests/Whizbang.Core.Component.Tests/Workers/PerspectiveWorkerDrainModeTests.WriteBehind.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/PerspectiveWriteModeConformanceTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/PerspectiveWriteModeConformanceTests.WriteBehind.cs
  - tests/Whizbang.Core.Unit.Perspectives.Tests/Perspectives/PerspectiveWriteBehindOptionsTests.cs
  - tests/Whizbang.Core.Unit.Workers.Tests/Workers/PerspectiveWriteBehindCacheTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/SetBasedPerspectiveWorkerIntegrationTests.MeasureWriteBehind.cs
---

# Perspective Write Modes

A **write mode** decides how the perspective worker turns a batch of claimed work into durable rows. The default is
**set-based**: every stream in the batch is folded in memory, and the results are written with a few statements per
table instead of one save per stream. The earlier path, one save per (stream, perspective) pair, stays available as the
**per-stream** mode. A third mode, **write-behind** ([#2247](https://github.com/whizbang-lib/whizbang/issues/2247)),
is opt-in and never the default: it holds folded models in memory across batches and writes each one later, for read
models with a few very hot streams.

## Why {#why}

The worker groups claimed work by (stream, perspective) and runs the pairs in parallel. Each pair has its own scope
and its own database context, and spends five to seven round trips: read the row, probe for an eviction or purge
marker when it is absent, read the commit sequence, write the row under the ordering guard, then flush, snapshot and
signal. That is a fair price for a busy stream with many events in a batch. It is a poor price for a **fan-out**,
where one event lands on each of thousands of streams: a batch of 500 streams is 500 single-row writes and a few
thousand round trips.

Bundling the events into a [composite event](../messaging/composite-events) does not change this. At the publishing
service an owned composite is expanded and each inner event is stored and projected on its own stream (see
[Publish-time local fan-out](../messaging/composite-events#publish-time-local-fan-out)), so the per-stream cost lands
on the perspective writes either way.

The fold itself is cheap and already runs in memory. The cost is the statements around it, so the design batches the
reads and the writes and leaves the fold alone.

## The batch pipeline {#pipeline}

Each batch runs five steps. Two are **fixed**, because correctness lives there, and three are **seams**, so a later
write mode plugs in without a second runner.

| Step | Fixed or seam | What it decides |
|---|---|---|
| 1. Form the batch | fixed | whatever is claimed and ready; group commit, no timer wait |
| 2. State source (`IPerspectiveStateSource`) | seam | where each stream's current model comes from |
| 3. Fold per stream | fixed | each stream's events applied in order, in memory |
| 4. Flush policy (`IApplyBatchStrategy`) | seam | when the folded results become durable |
| 5. Write sink (`IPerspectiveWriteSink`) | seam | how they are written |

```mermaid{caption="The set-based batch pipeline: one batched read, a parallel in-memory fold per stream, then one statement per table and operation. Refused and conflicted rows leave the batch for the existing rewind and per-stream paths; lifecycle and sync run after the commit."}
graph TB
    Claim["1. Form the batch<br/>claimed and ready work<br/>(group commit, no timer)"]
    Locks["Take per-stream locks<br/>as a set, fixed order"]
    Source["2. State source<br/>one SELECT ... WHERE id = ANY(@ids)<br/>per table; known-new streams skip it"]
    Fold["3. Prepare: fold each stream<br/>in order, in memory, in parallel"]
    Flush["4. Flush policy<br/>default: every batch"]
    Sink["5. Write sink<br/>group by table and operation<br/>one statement per group"]
    Complete["Complete each pair<br/>snapshot, detached lifecycle,<br/>completion"]
    After["Inline lifecycle and sync tracker<br/>(after commit)"]
    Rewind["Existing rewind path"]
    PerStream["Per-stream path<br/>(that pair only)"]

    Claim --> Locks --> Source --> Fold --> Flush --> Sink --> Complete --> After
    Fold -->|"rewind anchor, evicted or purged row,<br/>store cannot prepare"| PerStream
    Sink -->|"refused by ordering guard"| Rewind
    Sink -->|"row version conflict,<br/>rejected row"| PerStream

    class Claim,Locks,Fold layer-core
    class Source,Sink,Flush layer-event
    class Complete,After layer-read
    class Rewind,PerStream layer-command
```

### Step 1: form the batch {#batch-formation}

A batch is whatever work is claimed and ready when the worker looks. There is no timer that waits for a batch to
fill: under light load a batch is one stream and is written at once, and under load the batch grows by itself while
the previous one is being written. This is group commit, and it is why the set-based mode adds no latency to a quiet
service.

Both of the worker's sources take this path: claimed work and the drain. A claimed batch reads its pairs' cursors with
one statement (`GetPerspectiveCursorsBatchAsync`) and their streams' events with one read
(`IEventStore.ReadPolymorphicManyAsync`), and each runner selects the events it folds from its stream's share
(`IPerspectiveRunner.SelectEvents`); the same events serve the lifecycle stages after the write, so nothing is read a
second time. A store that does not read streams in batches, a decorator that cannot (a type-changing upcaster, a stream
whose first events are archived), a coordinator whose batched cursor read is the interface default
(`ReadsCursorsInBatches` false) or a batched read that fails (logged) sends each pair back to its own reads
(`ReadEventsAsync`, the read `RunAsync` makes before it applies). The drain's pairs come with their events already
fetched, and a pair whose stream the drain's batched cursor read found no cursor for does not read its own. On the
drain, the first lap of every stream in the batch is applied together; a stream's later laps (events that arrived
while it drained) run per pair.

### The batch {#the-batch}

For the pairs of a batch whose perspective writes set-based, the worker:

1. takes every pair's affinity gate, in `PerspectiveApplyLockSet.Order`;
2. begins each pair in parallel, as the per-pair path begins it: resolves the runner and cursor, fires the
   pre-perspective stages, and runs a rewind or a bootstrap snapshot the pair needs on the per-pair path, there and then;
3. takes the apply lock of every remaining pair as a set, plans the batch's reads with the state source, and prepares
   every pair at the worker's width;
4. groups the prepared writes by the DbContext they belong to (`PendingPerspectiveWrite.SinkKey`), resolves that
   context's write sink from a scope of its own, and hands each group to the flush policy;
5. completes every pair with its own outcome, releases the apply locks, and then finishes each pair exactly as the
   per-pair path finishes it: the completion report, the sync tracker and the post-perspective stages.

A pair's failure stays with the pair: an exception from its prepare or completion is failed as a thrown apply is on
the per-pair path, and a write whose sink is missing or failed as a whole is completed as `Failed`, which reruns it on
the per-pair path. A service with several DbContexts writes each perspective through its own: the driver registers one
sink per context, keyed by the context's type.

**A batch that outlives its lease.** A drain batch runs under one lease, whose token cancels its prepare, write and
completions once it runs out. Each pair that had already ended by then is finished with its own outcome: a pair that
produced its result is reported with it, and a pair that failed is reported with its own failure, exactly as the
per-pair path finishes an apply that returned
([#2536](https://github.com/whizbang-lib/whizbang/issues/2536)). Only pairs still in flight when the lease runs out are
failed on the lease, so their rows are re-issued. A result is finished with the expired lease's token, so a step that
observes cancellation can still route the pair to the lease failure, as on the per-pair path.
{verified: PerspectiveWorkerDrainModeTests.SetBasedDrain_ABatchThatOutlivesItsLease_FailsEveryPairOfTheBatchAsync, PerspectiveWorkerDrainModeTests.SetBasedDrain_APairWithAResultWhenItsBatchsLeaseRanOut_IsReportedWithItsResultAsync, PerspectiveWorkerDrainModeTests.SetBasedDrain_APairThatFailedBeforeItsBatchsLeaseRanOut_IsReportedWithItsOwnFailureAsync, PerspectiveWorkerDrainModeTests.PerPairDrain_APairWithAResultWhenItsLeaseRanOut_IsReportedWithItsResultAsync, PerspectiveWorkerDrainModeTests.PerPairDrain_AnApplyThatFailsAsItsLeaseRunsOut_IsReportedWithItsOwnFailureAsync}

The per-pair path is built from the same begin, finish and failure steps, so the two cannot drift.

### Step 3: the fold is fixed {#fold}

Each stream's events are applied in order, and `Apply` stays a pure function (see
[Purity Enforcement](perspectives#purity-enforcement)). The [exactly-once contract](apply-exactly-once) and the
idempotency filter are unchanged. No write mode may reorder events within a stream or fold one stream's events into
another's model, which is why this step is not a seam.

### Prepare and commit {#prepare-and-commit}

Every generated runner implements two members of `IPerspectiveRunner` next to `RunWithEventsAsync`, which stays as
the per-stream path:

- **`PrepareAsync(streamId, perspectiveName, lastProcessedEventId, events, batchState)`** reads the row (from the
  batch's state source where it can answer), runs the idempotency
  filter and folds, exactly as `RunWithEventsAsync` does, then stops before the write. It returns a
  `PreparedPerspectiveApply` that is one of three things:
  - a pending write (`Write`, a `PendingPerspectiveWrite`) for the batch's write sink: an insert, an update on the row
    version the apply read, an upsert under the ordering guard, or a purge;
  - nothing to write (a batch the row already holds); or
  - a hand-back to the per-stream path, with a `PerPairReason`.
- **`CompleteAsync(prepared, outcome)`** takes the write's outcome (`PerspectiveWriteOutcome`) and does what follows a
  save today: the snapshot, the detached lifecycle stage and the completion handed back to the worker. It returns the
  same `PerspectiveCursorCompletion` the per-stream path returns. Every prepared pair is completed, including one
  handed back, which `CompleteAsync` runs through the per-stream path.

Between the two, the worker writes the whole batch. The store prepares each row with
`IPerspectiveStore.PrepareWrite` (or `PreparePurge`), which the per-stream upsert also writes from, so both paths store
the same document, metadata, scope and physical columns. A store that returns null there sends the pair to the
per-stream path.

The per-stream path and the split are built from the same pieces: one row read, one fold, one decision of what to
write, and one finish after the write. Only the write between them differs, so the two cannot drift.

| Hand-back (`PerPairReason`) | When | What the per-stream path does |
|---|---|---|
| `RewindBelowPosition` | an event sits below the row's recorded position | rewinds the stream ([#1347](https://github.com/whizbang-lib/whizbang/issues/1347)) |
| `MissingRowWithHistory` | an evictable or archived row is missing and its stream has earlier events | rebuilds the row from the stream |
| `PurgedStream` | the row is missing because the stream was purged | keeps it purged unless an apply resurrects it |
| `WriteNotPreparable` | the store cannot prepare the write (another provider, a model or column it cannot write set-based) | writes it with the per-stream upsert |
| `RunnerDoesNotPrepare` | a hand-written runner that keeps the default | runs `RunWithEventsAsync` |

| Write outcome | What `CompleteAsync` does |
|---|---|
| `Written` | finishes the pair: snapshot, detached stage, completion |
| `Refused` | the ordering guard turned the write away: rewinds the stream, as a refused per-stream write does ([#1608](https://github.com/whizbang-lib/whizbang/issues/1608)) |
| `Conflict` | the row moved after it was read: reruns the pair through the per-stream path, with its retries |
| `Failed` | the database rejected the row: reruns the pair through the per-stream path, where it fails exactly as it would have, or is written by the store's fallback |

**Why this over a group-commit sink.** The alternative kept the runners unchanged and had the store collect saves
from the parallel runners behind a counting barrier, then write them together. That only batches the writes, it needs
a barrier that every runner must reach (one slow or failed runner holds up the rest), and it is timing-dependent. The
prepare and commit split is deterministic, has no barrier, and lets the reads be batched as well as the writes.

## Set-based mode (default) {#set-based}

### Batched load {#batched-load}

<a id="state-source"></a>The state source (`IPerspectiveStateSource`, default `BatchedPerspectiveStateSource`,
registered by the PostgreSQL driver) plans a batch's reads with `BeginBatch`, and every prepare of the batch reads from
the plan (`IPerspectiveBatchState`):

- A stream whose cursor is absent and whose first claimed event is the first event in its stream
  (`IsFirstInLocalStream`) is **known new**: it can have no row, no purge marker and no earlier history, so none of
  them is read. A fan-out of new streams issues no preload at all.
- Every other stream of a perspective is read once for the batch, by the first prepare that asks, through the store's
  `ReadForApplyManyAsync`: one `id = ANY` read of the versions, metadata and scopes, then one read of the models. Two
  statements per table whatever the batch's size, and the models are materialized exactly as the per-stream read
  materializes them (a Split model hydrated from its promoted columns included), so the two paths fold the same model.
- The purge-marker probe and the history probe of the rows the read found missing are one query each.

Whatever the plan cannot answer (a store that does not read in batches, a batched read that failed, which is logged) is
read per stream, exactly as without a state source. Only a prepare consults it: a pair rerun on the per-stream path
reads its row afresh.

A [rebuild](rebuild#batched-reads) plans each batch of its streams through the same seam
([#2513](https://github.com/whizbang-lib/whizbang/issues/2513)): the rows it re-derives, the purge markers of the
missing ones and the commit sequences of their events are each read once per batch. A rebuild plans **no stream as
known new**, because the row it re-derives may already exist, so every row is read; it reads no recorded position from
the planned row, as its per-stream read does not; and only the first attempt of a row's write reads from the plan, so a
row that moved under the write is read again on its own.
{verified: PerspectiveRebuilderBatchedReadTests.Rebuild_ReadsEachBatchsRowsPurgeMarkersAndCommitSequences_WithOneReadEach_NotOnePerStreamAsync, PerspectiveRebuilderBatchedReadTests.Rebuild_ARowThatMovesUnderItsWrite_IsReadAgainOnItsOwn_NotFromTheBatchsReadAsync}

### Statements grouped by table and operation {#grouped-statements}

The write sink groups the pending writes by table and by operation and writes each group with one statement:

| Operation | Statement |
|---|---|
| insert | `INSERT ... VALUES (...), (...) ON CONFLICT DO NOTHING RETURNING id` |
| update | `UPDATE ... FROM (VALUES (...), (...)) r WHERE id = r.id AND xmin = r.xmin AND <ordering guard> RETURNING id` |
| upsert | `INSERT ... VALUES (...), (...) ON CONFLICT DO UPDATE ... WHERE <ordering guard> RETURNING id` |
| purge | `DELETE ... WHERE id = ANY(@ids)` |

### Flush policy {#flush-policy}

The flush policy (`IApplyBatchStrategy`) decides when a batch's prepared writes reach the sink. The default,
`FlushEveryBatchStrategy`, writes them at once, so a batch's rows are durable before its pairs complete. It is
registered with the worker; a policy returns one outcome per write, as the sink does. The
[write-behind mode](#write-behind) holds its models before this step, and when it flushes a model it writes it
through this same policy and sink.

The ordering guard is evaluated **per row**, inside the statement, exactly as it is for a single-row write today.
Physical fields are written in the same statement as the document, so split and extracted storage stay consistent
(see [Physical Fields](physical-fields)).

### Refused and conflicted rows {#refused-rows}

An id that a statement does not return was either refused by the ordering guard or lost a row version race. That is
the same signal a single-row write gives today, and it goes to the same place:

- A row the ordering guard refused goes to the existing [rewind](rewind) path, for that stream only. The other streams
  in the batch are written and completed normally.
- A row version conflict reruns that pair through the per-stream path, which keeps its existing retry.

### Failure isolation {#failure-isolation}

- **An exception in `Apply`** drops that stream from the batch during prepare. It never reaches the write.
- **A statement that fails** (a constraint, a bad row) is split in halves and retried until the failing pair is
  found. That pair alone is reported `Failed` and takes the per-stream path, where it fails exactly as it would today;
  every other pair is written.

One bad stream never fails the batch around it.

### Locks taken as a set {#locks}

The per-(stream, perspective) apply lock is held for every pair in the batch from before prepare until after complete,
so it spans the batch write. `PrepareAsync` and `CompleteAsync` therefore take no lock themselves; the worker takes the
batch's locks with `PerspectiveApplyLockSet.AcquireAsync(coordinator, pairs)` and disposes the result after the last
completion. The locks are taken in one fixed order, `PerspectiveApplyLockSet.Order` (stream id, then perspective name
compared ordinally), each pair once, and released in reverse. Two batches that share streams then wait on the first
pair they share and never each hold a lock the other needs, so they cannot deadlock. The worker's affinity gates are
taken first, in the same order, for every pair of the batch, so a batch never holds one gate while it waits on
another a second batch holds. The lock semantics themselves are unchanged (see [Perspective Stream Locking](stream-locking)).

When a completion reruns a pair (a hand-back, a conflict, a rejected row), it runs the per-stream path's lock-free core
under the lock the worker already holds: the coordinator's lock is not reentrant, and taking it again would deadlock.

### Lifecycle and sync after commit {#lifecycle-after-commit}

`PostPerspective*` stages and the [perspective sync](perspective-sync) tracker fire after the commit that made the
model durable, exactly as they do after a single-row save today. A waiter never sees a stage for a write that rolled
back. [Snapshots](snapshots) are taken in complete, from the model that was written. The events counted toward a
stream's next snapshot are counted per stream: one runner prepares many pairs of a batch, and a count kept on the
runner would add one stream's events to another's.

### Checkpoints and completion stay batched {#checkpoints}

Checkpoints and work-row completion are already batched: they are buffered and written with one call per flush,
after the row write. The set-based mode keeps that path as it is and does not move them into the row-write
transaction. The runner already treats them as a later step, and moving them is not needed to remove the per-stream
cost.

### What still runs per stream {#still-per-stream}

| Case | Why |
|---|---|
| A rewind (a cursor that asks for one, an inversion on the drain, an event below the row's position) | it replays the stream from a snapshot or from its start, which is a per-stream read by nature |
| A bootstrap snapshot | it snapshots one stream's existing row |
| A blue-green rebuild's catch-up and swap | they write the live table's shadow row by row; its first pass uses the [staging load](rebuild#staging-load), and a rebuild in place writes [a batch at a time](rebuild#batched-writes) |
| The collective sink | a collective event has no single row; it is dispatched as before |
| A drain's later laps | events that arrive while a stream drains are applied per pair, lap by lap |
| The commit sequence of a pair's last event | read per pair from the event store; batching it is a follow-up |

## Per-stream mode {#per-stream}

The per-stream mode is today's path: each (stream, perspective) pair is loaded, folded, written and completed on its
own. It stays as a selectable mode for comparison, and it is also the path the set-based mode hands a pair to when that
pair needs it (a rewind, an evicted or purged row, a write the store cannot prepare, a conflict, a rejected row). Because both modes share the fold
and the completion, the per-stream mode is not a second implementation that can drift.

## Write-behind mode {#write-behind}

[#2247](https://github.com/whizbang-lib/whizbang/issues/2247). Opt-in, never the default. A perspective with a few very
hot streams (a counter, an aggregate) receives a few events per stream in every drain, and set-based mode writes its row
once per drain. Write-behind keeps each folded model in memory across drains and writes it later, with the same
set-based writer, so a stream's many small batches cost one write.

```csharp{
title: "Write one hot perspective behind"
description: "A per-perspective write-behind override, with the two bounds every write-behind worker needs."
framework: "NET10"
category: "Perspectives"
difficulty: "ADVANCED"
tags: ["perspectives", "write-modes", "write-behind"]
unverified: "illustrative; the bounds and the attribute are exercised by PerspectiveWriteModeConformanceTests.WriteBehind_AHotStreamsBatches_AreHeld_ThenWrittenOnceAsync"
}
services.Configure<PerspectiveWorkerOptions>(options => {
  options.WriteBehind.MaxModels = 10_000;
  options.WriteBehind.MaxBytes = 64L * 1024 * 1024;
});

[PerspectiveWriteMode(PerspectiveWriteMode.WriteBehind)]
public sealed class PageViewCounterPerspective : IPerspectiveFor<PageViewCount, PageViewed> {
  public PageViewCount Apply(PageViewCount current, PageViewed evt) {
    return current with { Views = current.Views + 1 };
  }
}
```

### How a model is held {#write-behind-hold}

Holding happens on the perspective drain, where both production coordinators hand every perspective stream. A drain's
set-based lap prepares a write-behind pair as it prepares any other, and then, instead of writing it:

1. keeps the folded model, serialized, as the pair's held row; the next batch of the stream folds onto it rather than
   reading the row from the database (a cache **hit**);
2. leaves the batch unfinished: its checkpoint, completion report, [sync](perspective-sync) signal and
   `PostPerspective*` stages all wait for its model's flush, and its work rows stay pending and leased to this instance;
3. leaves out of the next drains of the stream the events a held model already folded (their rows are still pending, so
   the claim offers the stream again), and continues from the held model's position.

A flush writes each model's held batches with **one merged write**: the first batch's operation and the row version it
was prepared on, carrying the last batch's document, metadata, scope and physical values. It goes through the same
[flush policy](#flush-policy) and [write sink](#grouped-statements) as a set-based batch. Every held batch is then
completed with that write's outcome, oldest first, and finished as the drain finishes a pair.

```mermaid{caption="Write-behind on the drain: a hot stream's batches fold onto the held model; a flush writes them with one merged write and then completes each held batch, oldest first. A model whose lease ran out is dropped, never written." tests=["PerspectiveWorkerDrainModeTests.WriteBehind_AHotStreamsBatches_AreHeld_ThenWrittenOnceWhenTheIntervalElapsesAsync", "PerspectiveWorkerDrainModeTests.WriteBehind_ASyncWaitOnAHeldEvent_FlushesItsModelAtOnceAsync", "PerspectiveWorkerDrainModeTests.WriteBehind_AModelThatOutlivesItsLease_IsDropped_NeverWrittenAsync"]}
graph TB
    Drain["Drain lap<br/>prepare each pair"]
    Fits{"Write checked against<br/>the row version, and<br/>the model fits the bounds?"}
    Hold["Hold the model<br/>batch not finished,<br/>rows stay leased"]
    Write["Written now<br/>as set-based"]
    Trigger["Flush trigger<br/>interval, batch cap, bounds,<br/>sync wait, row needed current,<br/>stop, FlushWriteBehindAsync"]
    Lease{"Lease still<br/>this instance's?"}
    Merged["One merged write<br/>same flush policy and sink"]
    Complete["Complete each held batch<br/>oldest first: checkpoint,<br/>sync, PostPerspective stages"]
    Drop["Drop unwritten<br/>replays from the checkpoint"]
    PerPair["Each held batch<br/>re-applied per pair"]

    Drain --> Fits
    Fits -->|yes| Hold
    Fits -->|no| Write
    Hold --> Trigger --> Lease
    Lease -->|yes| Merged --> Complete
    Lease -->|no| Drop
    Merged -->|"row moved, refused<br/>or rejected"| PerPair

    class Drain,Hold layer-core
    class Merged,Write layer-event
    class Complete layer-read
    class Drop,PerPair layer-command
```

A batch is written at once, as set-based writes it, when its model cannot be held: a purge, a write that is not checked
against the row's version (only a checked write can meet a writer it missed), or a new model that does not fit the
bounds. A model held for the same stream is flushed before such a write goes with its batch.
{verified: PerspectiveWorkerDrainModeTests.WriteBehind_AHotStreamsBatches_AreHeld_ThenWrittenOnceWhenTheIntervalElapsesAsync, PerspectiveWorkerDrainModeTests.WriteBehind_ALaterLapOfTheSameDrain_HoldsOntoTheModelItsFirstLapHeldAsync, PerspectiveWorkerDrainModeTests.WriteBehind_ALaterDrainOfOnlyHeldEvents_AppliesNothingAgainAsync, PerspectiveWorkerDrainModeTests.WriteBehind_ANewModelThatDoesNotFit_IsWrittenAtOnce_AndAnOverBoundCacheFlushesItsOldestAsync, PerspectiveWorkerDrainModeTests.WriteBehind_AnUncheckedWrite_IsNeverHeldAsync, PerspectiveWriteModeConformanceTests.WriteBehind_AHotStreamsBatches_AreHeld_ThenWrittenOnceAsync}

### Trade-offs {#write-behind-trade-offs}

| | What write-behind costs | Why it is safe |
|---|---|---|
| **Memory** | The held models, serialized | The cache is bounded by a model count and a byte count, both required |
| **Flush lag** | A held model's row, checkpoint, sync signal and lifecycle stages trail its events by up to the flush interval | A sync wait on a held event flushes its model at once, so a reader that waits for its write never waits for the interval |
| **A crash** | The held models are lost | Nothing else is: no held batch moved its checkpoint, so its rows are claimed again after their lease and replay from the checkpoint. Applies are pure, so the replay folds the same model |

{verified: PerspectiveWriteModeConformanceTests.WriteBehind_ACrash_LosesOnlyTheHeldModels_AndTheStreamReplaysFromItsCheckpointAsync, PerspectiveWorkerDrainModeTests.WriteBehind_ASyncWaitOnAHeldEvent_FlushesItsModelAtOnceAsync}

### Bounds {#write-behind-bounds}

The model cache has no unlimited default. Its bounds are `PerspectiveWorkerOptions.WriteBehind`
(`PerspectiveWriteBehindOptions`; the configuration keys are under the write-behind settings in the
[configuration reference](../../operations/configuration/configuration-reference#perspectiveworkeroptions)):

| Bound | Default | What it bounds |
|---|---|---|
| `MaxModels` | none, required | The most models held at once, across every write-behind perspective of the worker |
| `MaxBytes` | none, required | The most bytes the held models take, measured as their serialized size |
| `MaxFlushIntervalMilliseconds` | 1,000 | How long a model is held at most, from the batch that first held it. At most half of the lease less its grace (135,000 with the default 300 s lease and 30 s grace), so a held model is flushed while its rows are still leased to this instance |
| `MaxBatchesPerModel` | 32 | How many batches one model holds at most before it is flushed |

A worker that writes anything behind without `MaxModels` and `MaxBytes` (or with an interval or batch cap out of range)
does not start, and says what is missing and how to fix it: a service whose write mode is `WriteBehind` fails in
`StartAsync`, and a worker one of whose perspectives declares `[PerspectiveWriteMode(PerspectiveWriteMode.WriteBehind)]`
stops before it applies anything. Only the perspectives this worker applies count. A new model that does not fit
either bound is written at once, as set-based writes it; a held model's later batch is always added, and the oldest
models are flushed until the cache is back under its bounds.
{verified: PerspectiveWriteBehindOptionsTests.TheBounds_HaveNoDefault_AndTheIntervalAndBatchCapDoAsync, PerspectiveWriteBehindOptionsTests.TheServiceMode_WithoutBounds_NamesBothMissingBoundsAndTheFixAsync, PerspectiveWriteBehindOptionsTests.ADeclaredPerspective_WithoutBounds_IsNamedAsync, PerspectiveWriteBehindOptionsTests.AnIntervalBeyondHalfTheLeaseLessItsGrace_IsRefusedAsync, PerspectiveWorkerDrainModeTests.WriteBehind_TheServiceModeWithoutBounds_FailsToStartAsync, PerspectiveWorkerDrainModeTests.WriteBehind_ADeclaredPerspectiveWithoutBounds_StopsTheWorkerBeforeItAppliesAnythingAsync, PerspectiveWriteBehindCacheTests.ANewModel_IsHeld_OnlyWhenItFitsBothBoundsAsync, PerspectiveWriteBehindCacheTests.Due_FlushesOnlyAsManyOldModelsAsBringTheCacheBackUnderItsBoundsAsync}

The bounds bind from `Whizbang:Workers:Perspective:WriteBehind` (environment variables
`Whizbang__Workers__Perspective__WriteBehind__MaxModels` and so on):

```json{title="Write-behind bounds" description="The two required bounds of the write-behind model cache, with the flush interval and batch cap at their defaults." category="Configuration" difficulty="INTERMEDIATE" tags=["Perspectives", "Write-behind", "Configuration"] tests=["PerspectiveWriteBehindOptionsTests.TheBounds_HaveNoDefault_AndTheIntervalAndBatchCapDoAsync"]}
{
  "Whizbang": {
    "Workers": {
      "Perspective": {
        "WriteBehind": {
          "MaxModels": 10000,
          "MaxBytes": 67108864,
          "MaxFlushIntervalMilliseconds": 1000,
          "MaxBatchesPerModel": 32
        }
      }
    }
  }
}
```

### What forces a flush {#write-behind-flush}

A model is flushed when its interval elapses. It is flushed early (a **forced** flush, counted by reason) when:

| Reason (`reason` tag) | When |
|---|---|
| `sync` | A [perspective sync](perspective-sync) wait waits on an event the model holds |
| `bypass` | Anything else is about to touch its row and needs it current: a rewind of the stream, a purge, a per-pair drain or a perspective that no longer writes behind, or a claimed apply of the stream |
| `bounds` | The cache is over `MaxModels` or `MaxBytes`, and the model is among the oldest (eviction flushes, it never discards) |
| `batches` | The model holds `MaxBatchesPerModel` batches |
| `requested` | `PerspectiveWorker.FlushWriteBehindAsync` was called |
| `rebuild` | A [rebuild](rebuild) of the model's perspective is starting: a rebuild of every stream flushes every model of the perspective, a rebuild of named streams flushes those streams' models ([#2533](https://github.com/whizbang-lib/whizbang/issues/2533)) |
| `stop` | The worker is stopping: every held model is flushed before the detached stages are waited for |
| `handover` | The model's partition is being [handed over](../work-coordinator/partition-assignment#handover) to another instance: the models of the moving partition's streams are saved before this instance acknowledges, and the others stay held ([#2557](https://github.com/whizbang-lib/whizbang/issues/2557)) |

{verified: PerspectiveWorkerDrainModeTests.WriteBehind_ASyncWaitOnAHeldEvent_FlushesItsModelAtOnceAsync, PerspectiveWorkerDrainModeTests.WriteBehind_ClaimedWorkForAHeldStream_FlushesTheModelFirstAsync, PerspectiveWorkerDrainModeTests.WriteBehind_ANewModelThatDoesNotFit_IsWrittenAtOnce_AndAnOverBoundCacheFlushesItsOldestAsync, PerspectiveWorkerDrainModeTests.WriteBehind_AModelAtItsBatchCap_IsFlushedAfterTheBatchThatReachesItAsync, PerspectiveWorkerDrainModeTests.WriteBehind_TheWorkerStopping_FlushesEveryHeldModelAsync, PerspectiveWorkerDrainModeTests.WriteBehind_ARebuildOfAHeldStream_FlushesItsModelBeforeTheRebuildReadsItsRowAsync, PerspectiveWorkerDrainModeTests.WriteBehind_ARebuildOfEveryStream_FlushesEveryModelOfThePerspectiveBeforeItReadsARowAsync, PerspectiveWorkerDrainModeTests.WriteBehind_AHandover_SavesTheModelsOfTheMovedStreams_AndKeepsTheOthersHeldAsync, PerspectiveWorkerDrainModeTests.WriteBehind_AHandover_OnAWorkerThatHoldsNothing_DoesNothingAsync}

**A model whose lease ran out is dropped, never written.** A held model's rows are leased to this instance only for the
lease less its grace, counted from its first held batch. Past that, the stream may already be another instance's, so
the model is dropped unwritten, logged at Warning and counted on `whizbang.perspective.write_behind.dropped`; its rows
replay from the checkpoint wherever the stream is claimed next. A flush that had to wait for the stream's gate checks
again once it has it.
{verified: PerspectiveWorkerDrainModeTests.WriteBehind_AModelThatOutlivesItsLease_IsDropped_NeverWrittenAsync, PerspectiveWriteBehindCacheTests.AModelPastTheLease_IsExpired_NotFlushedAsync}

**A fenced model is dropped, never written.** With [ownership by map](../work-coordinator/partition-assignment#ownership-by-map)
on, a flush carries the partition epoch its model's work was claimed under. When the partition has moved on since (a
handover the assigner completed past its deadline, while this instance was stuck or cut off), the merged write is
[fenced](../work-coordinator/partition-assignment#fencing): the model is dropped unwritten, logged at Debug, and
counted on `whizbang.perspective.write_behind.dropped` (and as a `perspective_write` on
`whizbang.work_coordinator.fenced_writes`). Its held batches are not completed, so the partition's current owner
replays them ([#2556](https://github.com/whizbang-lib/whizbang/issues/2556)).
{verified: PerspectiveWorkerDrainModeTests.WriteBehind_AFencedFlush_DropsTheModel_AndCompletesNothingAsync, PerspectiveWorkerDrainModeTests.WriteBehind_AFencedFlush_OnAWorkerWithoutMetrics_StillDropsTheModelAsync}

### Writers outside the runner {#write-behind-outside-writers}

The merged write is checked against the row version its first batch was prepared on. A writer outside the runner that
changed the row while the model was held (a collective, a consumer's own SQL, or a rebuild that meets a model held
after it started) is met by that check as a
conflict, and every held batch is then re-applied on the per-pair path, oldest first, on the row it finds, so neither
write is lost. A merged write the ordering guard refuses is re-applied the same way, where the guard rewinds the stream
on the row it finds, and a merged write the database rejects hands every held batch to the per-pair path, where each
fails or is written as it would have been. A completion that throws fails only its own batch.
{verified: PerspectiveWriteModeConformanceTests.WriteBehind_ARowAnotherWriterChangesWhileItsModelIsHeld_KeepsBothWritesAsync, PerspectiveWorkerDrainModeTests.WriteBehind_AMergedWriteTheGuardRefuses_IsReappliedAsAConflictAsync, PerspectiveWorkerDrainModeTests.WriteBehind_AMergedWriteTheDatabaseRejects_HandsEveryHeldBatchToThePerPairPathAsync, PerspectiveWorkerDrainModeTests.WriteBehind_ACompletionThatThrows_FailsOnlyItsBatchAsync}

**A rebuild flushes first.** Before a rebuild reads any row, it flushes the models held for the perspective it
rebuilds, so a model held before the rebuild is written before it rather than over it. A flush that fails is logged
and does not fail the rebuild: its batches were released unwritten and replay from their checkpoint.
{verified: PerspectiveWorkerDrainModeTests.WriteBehind_ARebuildOfAHeldStream_FlushesItsModelBeforeTheRebuildReadsItsRowAsync, PerspectiveWorkerDrainModeTests.WriteBehind_ARebuildWhoseFlushFails_IsLogged_AndRebuildsOverNoHeldModelAsync}

A [rebuild in place](rebuild#batched-writes) of a write-behind perspective writes each row on its own: it is a
one-off write of every row, with nothing to gain from holding them.

### The API {#write-behind-api}

| Member | What it does |
|---|---|
| `PerspectiveWorker.FlushWriteBehindAsync(cancellationToken)` | Flushes every held model now, whatever its interval: each one's batches are written, completed and finished before the task completes. Nothing to do when nothing writes behind |
| `PerspectiveWorker.OnWriteBehindHeld` | Raised with the (stream, perspective) of each batch held instead of written. A diagnostic signal: a test waits on it rather than on time |
| `PerspectiveWorker.WriteBehindModels` | The models the cache holds now; zero when nothing writes behind |

{verified: PerspectiveWriteModeConformanceTests.WriteBehind_AHotStreamsBatches_AreHeld_ThenWrittenOnceAsync}

### Metrics {#write-behind-metrics}

On the `Whizbang.Perspectives` meter (see the [metrics reference](../../operations/observability/metrics#perspectives)):

| Metric | Type | What it says |
|---|---|---|
| `whizbang.perspective.write_behind.models` | ObservableGauge | Models the cache holds |
| `whizbang.perspective.write_behind.bytes` | ObservableGauge (By) | Bytes the held models take |
| `whizbang.perspective.write_behind.lookups` | Counter\<long\> | Write-behind pairs prepared on a held model (`result` = `hit`) or a database read (`miss`); the hit rate is hits over both. Tags: `perspective_name`, `result` |
| `whizbang.perspective.write_behind.flush_lag` | Histogram\<double\> (ms) | Time from a model's first held batch to its flush. Tag: `reason` |
| `whizbang.perspective.write_behind.forced_flushes` | Counter\<long\> | Models flushed before their interval. Tag: `reason` (`sync`, `bypass`, `bounds`, `batches`, `requested`, `rebuild`, `stop`, `handover`) |
| `whizbang.perspective.write_behind.dropped` | Counter\<long\> | Models dropped unwritten: their lease ran out, or their flush was fenced |

A low hit rate says the perspective's streams are not hot enough for write-behind to pay. A `dropped` with the
worker's Warning says a held model could not be flushed within its lease (its flush failed, or waited too long for its
stream), and its batches replayed from their checkpoint; the Warning names the perspective and the stream. A `dropped`
with only a Debug line is a fenced flush: the model's partition had already moved to another instance, which replays
its batches.
{verified: PerspectiveWorkerDrainModeTests.WriteBehind_AHotStreamsBatches_AreHeld_ThenWrittenOnceWhenTheIntervalElapsesAsync, PerspectiveWorkerDrainModeTests.WriteBehind_AModelThatOutlivesItsLease_IsDropped_NeverWrittenAsync}

### Measurement {#write-behind-measurement}

Measured with `Measure_HotStreamsAsync`: 5 hot streams taking 2,000 events each, committed a round at a time while the
worker drains them, through the production completion path, one mode at a time, on PostgreSQL:

| | Set-based | Write-behind |
|---|---|---|
| Events per second | 263 | 305 |
| Statements against the perspective table | 2,771 | 419 |
| Statements in total | 12,442 | 8,028 |

The run is paced by its own commit loop (one round trip per round), so events per second says little; the statement
counts are what to trust. Write-behind sent the perspective table about 15 percent of the statements. Measure a
perspective's own workload before choosing write-behind for it.

## Selecting a mode {#selection}

Set-based is the default. A service that registers nothing gets it, and every seam's default implementation is
registered by the framework (with `TryAdd`, so a deliberate override still wins): the flush policy where the worker is
registered, the state source and the write sinks by the PostgreSQL driver, which knows the DbContexts.

A service-wide default is `PerspectiveWorkerOptions.WriteMode`, and a single perspective overrides it with
`[PerspectiveWriteMode]`, which the generator reads: every generated runner registers its perspective's declared mode
(`PerspectiveWriteModes`), so the worker chooses each pair's path without resolving the runner. A perspective with no
generated runner prepares nothing and is always written per stream. A [rebuild in place](rebuild#batched-writes), or of
selected streams, follows the same write mode for each batch of streams it reads: a set-based perspective's rebuild
writes each batch's rows through the write sink, and a per-stream one writes each row on its own
([#2522](https://github.com/whizbang-lib/whizbang/issues/2522)).
{verified: PerspectiveRebuilderBatchedWriteTests.Rebuild_InPlace_WritesEachBatchsRowsThroughTheSinkWithOneWrite_NotOneWritePerRowAsync, PerspectiveRebuilderBatchedWriteTests.Rebuild_InPlace_OfAServiceThatWritesPerStream_WritesEachRowOnItsOwnAsync} Only named modes can be selected, never a free
combination of the three seams, so an invalid combination cannot be built.

| Mode | When to choose it |
|---|---|
| `SetBased` (default) | Almost always: a batch's rows are written with a few statements per table, and each row is durable before its pair completes |
| `PerStream` | For comparison, or a perspective that must be written exactly as before set-based writes |
| `WriteBehind` (opt-in) | A perspective with a few very hot streams (a counter, an aggregate) whose many small batches each cost a write. See [Write-behind mode](#write-behind) |

**Why write-behind is opt-in.** It trades guarantees the other modes give for fewer writes: a held model's row lags
its events by up to the flush interval, the service holds models in memory, and the cache needs bounds that only the
service can size, so there is no default to fall back to. A fan-out over many streams gains nothing from it, since each
stream is written once either way. A service chooses it for the perspectives it measured it on.
{verified: PerspectiveWriteModesTests.WorkerOptions_DefaultToSetBasedAsync, PerspectiveWriteBehindOptionsTests.TheBounds_HaveNoDefault_AndTheIntervalAndBatchCapDoAsync}

```csharp{
title: "Select the per-stream write mode for a service and set-based for one perspective"
description: "A service-wide write mode in the perspective options and a per-perspective override attribute."
framework: "NET10"
category: "Perspectives"
difficulty: "INTERMEDIATE"
tags: ["perspectives", "write-modes", "configuration"]
unverified: "illustrative; the option and attribute ship with #2246"
}
services.Configure<PerspectiveWorkerOptions>(options => {
  options.WriteMode = PerspectiveWriteMode.PerStream;
});

[PerspectiveWriteMode(PerspectiveWriteMode.SetBased)]
public sealed class OrderSummaryPerspective : IPerspectiveFor<OrderSummary, OrderPlaced> {
  public OrderSummary Apply(OrderSummary current, OrderPlaced evt) {
    return new OrderSummary { OrderId = evt.OrderId, Total = evt.Total };
  }
}
```

## Later modes {#later-modes}

A later mode is the same pipeline with different seams, and reuses the set-based write sink so the modes cannot drift
apart, as [write-behind](#write-behind) does.

### Staging-table rebuilds {#staging-table-rebuilds}

[#2248](https://github.com/whizbang-lib/whizbang/issues/2248). The first pass of every
[blue-green rebuild](rebuild#blue-green) writes its empty shadow table through a [staging load](rebuild#staging-load):
there is no state to read, rows are copied in with `COPY` per chunk, the shadow's plain indexes are built after the
load, and the catch-up and the swap then run the per-row write. It is selected automatically and a service can only
switch it off. A chunk `COPY` cannot take falls back to this page's set-based statements, so a refused row is isolated
the same way here as in a live batch.

## The conformance suite {#conformance-suite}

A write mode is supported only when it passes the **same conformance suite**: one integration suite on PostgreSQL,
parameterized by write mode, that runs real generated runners through the real pipeline (the claim loop, the worker,
the driver's state source and write sinks) and asserts what the read model must hold whatever the mode
(`PerspectiveWriteModeConformanceTests`). Every case runs against the set-based, the per-stream and the write-behind
mode.

Concurrent writers are driven deterministically through the flush-policy seam: a test `IApplyBatchStrategy` runs
between the batch's prepare and its write and changes the row in the database, as another writer acting in that window
would. Under the per-stream mode no batch write happens, so nothing is injected, and each case expects exactly the
writes that happened. Every wait is on the completion or failure of the work rows it asserts.

| Case | What must hold |
|---|---|
| New and existing streams in one batch | every event folded once into the document, an Extracted field in its column and the document, a Split field only in its column |
| A stream's first event finds a row already | the batch's insert conflicts and the pair folds onto the row it finds |
| Another writer changes the row after the read (row version conflict) | neither write is lost |
| Another writer moves the row past the batch (ordering guard, rewind, late event) | the stream is re-folded with every event, and the later event's own delivery is not applied twice (idempotency) |
| Purge | the row is removed, and an event after the purge does not recreate it |
| An apply that throws, and a row the database rejects | the throwing event is logged and skipped and its stream completes, as on the per-stream path; the rejected row fails only its own stream, and the batch's other rows are written |
| Perspective sync | a waiter is released only once the row is durable |

Snapshots and rewind from a snapshot, collectives on the same rows, lifecycle receptors and rebuild are not in the
suite yet; they are covered for the set-based path by focused tests of the runner's prepare and complete, and are the
next cases to add. Write-behind passes the suite, with its own cases beside it (a hot stream's batches held and written
once, a crash that loses only the held models, a row another writer changes while its model is held; see
[Write-behind mode](#write-behind)). A feature added to perspectives later is added to the suite, so every mode is held
to it.

## Measurements {#measurements}

Measured with `Measure_FanOutOfNewStreamsAsync`: new streams with one event each, applied through the real pipeline
with the completion path a service runs (the batched completion strategy and the completion flush worker), four
consumer loops and a claim batch of 1,000, one mode at a time, on PostgreSQL (2026-11-12):

| | Per-stream, 10,000 | Set-based, 10,000 | Per-stream, 100,000 | Set-based, 100,000 |
|---|---|---|---|---|
| Statements against the perspective table | 116,676 | 179 | 905,956 | 1,907 |
| of which inserts | 10,000 | 33 | 100,000 | 355 |
| Commit-sequence reads | 10,000 | 33 | 100,000 | 355 |
| Completion calls (`complete_perspective`) | 269 | 217 | 2,154 | 2,010 |
| Statements in total | 128,971 | 1,244 | 1,020,247 | 15,297 |
| Wall time | 47.8 s | 25.7 s | 1,284.1 s | 1,190.2 s |
| Rows per second | 209 | 389 | 78 | 84 |

The write goes from four to six statements per stream to a handful per batch, and a fan-out sends the database about
one percent of the statements. At 10,000 streams that makes set-based mode almost twice as fast. At 100,000 both modes
slow down, and by the same amount per 1,000 streams claimed (from 2.6 s to 11.9 s set-based, from 4.8 s to 12.8 s per
stream): the set-based run issued 15,297 statements in 1,190 seconds, so its time is no longer its statements' count
but the cost of each work-queue call (claim, stream fetch, completion, cleanup) over a backlog of 100,000 streams. That
cost is the same in both modes and is the next thing to measure for a large fan-out.

Completions are batched already: the batched completion strategy hands each batch's cursors and work rows to the
completion flush worker, which writes them with one `complete_perspective` call per flush, so no pair reports its own
completion (`NewStreams_CompletedAsAServiceCompletesThem_CostAFewBatchedCallsNotOnePerStreamAsync` locks it). The
instant completion strategy, which reports each pair with its own call, exists for tests.
