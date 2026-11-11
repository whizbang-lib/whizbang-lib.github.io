---
title: Perspective Write Modes
pageType: concept
category: Perspectives
order: 16
status: draft
version: 1.0.0
description: >-
  How the perspective runner writes a batch of folded models: set-based across streams by default,
  per-stream as an option, and the seams that later write modes plug into. Planned; not shipped yet.
tags: >-
  perspectives, write-modes, set-based, batching, round-trips, fan-out, perspective-runner,
  perspective-worker, conformance-suite
codeReferences:
  - src/Whizbang.Generators/Templates/PerspectiveRunnerTemplate.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
  - src/Whizbang.Core/Workers/BatchedCompletionStrategy.cs
  - src/Whizbang.Core/Workers/PerspectiveCompletionFlushWorker.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveRunner.cs
  - src/Whizbang.Core/Perspectives/PreparedPerspectiveApply.cs
  - src/Whizbang.Core/Perspectives/PerspectiveApplyLockSet.cs
  - src/Whizbang.Core/Perspectives/IPerspectiveWriteSink.cs
---

# Perspective Write Modes

A **write mode** decides how the perspective worker turns a batch of claimed work into durable rows. The default is
**set-based**: every stream in the batch is folded in memory, and the results are written with a few statements per
table instead of one save per stream. Today's path, one save per (stream, perspective) pair, stays available as the
**per-stream** mode.

:::planned
This page is the design for [#2246](https://github.com/whizbang-lib/whizbang/issues/2246) and is **not shipped yet**.
Today every perspective is written one (stream, perspective) pair at a time, which is the per-stream mode described
below. The type, option and attribute names on this page are illustrative and may change before release. Write-behind
([#2247](https://github.com/whizbang-lib/whizbang/issues/2247)) and staging-table rebuilds
([#2248](https://github.com/whizbang-lib/whizbang/issues/2248)) are later, separate items.
:::

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
| 2. State source | seam | where each stream's current model comes from |
| 3. Fold per stream | fixed | each stream's events applied in order, in memory |
| 4. Flush policy | seam | when the folded results become durable |
| 5. Write sink | seam | how they are written |

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

### Step 3: the fold is fixed {#fold}

Each stream's events are applied in order, and `Apply` stays a pure function (see
[Purity Enforcement](perspectives#purity-enforcement)). The [exactly-once contract](apply-exactly-once) and the
idempotency filter are unchanged. No write mode may reorder events within a stream or fold one stream's events into
another's model, which is why this step is not a seam.

### Prepare and commit {#prepare-and-commit}

Every generated runner implements two members of `IPerspectiveRunner` next to `RunWithEventsAsync`, which stays as
the per-stream path:

- **`PrepareAsync(streamId, perspectiveName, lastProcessedEventId, events)`** reads the row, runs the idempotency
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

The state source reads every stream in the batch with one query per perspective table
(`SELECT ... WHERE id = ANY(@ids)`, returning the model, its metadata and its row version). Purge markers and eviction
probes are answered with one query each, not one per stream.

A stream whose cursor is absent and whose first claimed event is the first event in its stream is **known new**: there
is no row to read, so it is not read. A fan-out of new streams therefore issues no preload at all.

### Statements grouped by table and operation {#grouped-statements}

The write sink groups the pending writes by table and by operation and writes each group with one statement:

| Operation | Statement |
|---|---|
| insert | `INSERT ... SELECT FROM jsonb_to_recordset(@rows) ON CONFLICT DO NOTHING RETURNING id` |
| update | `UPDATE ... FROM jsonb_to_recordset(@rows) r WHERE id = r.id AND xmin = r.xmin AND <ordering guard> RETURNING id` |
| purge | `DELETE ... WHERE id = ANY(@ids)` |

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
pair they share and never each hold a lock the other needs, so they cannot deadlock. The worker's affinity gate is
taken in the same order. The lock semantics themselves are unchanged (see [Perspective Stream Locking](stream-locking)).

When a completion reruns a pair (a hand-back, a conflict, a rejected row), it runs the per-stream path's lock-free core
under the lock the worker already holds: the coordinator's lock is not reentrant, and taking it again would deadlock.

### Lifecycle and sync after commit {#lifecycle-after-commit}

`PostPerspective*` stages and the [perspective sync](perspective-sync) tracker fire after the commit that made the
model durable, exactly as they do after a single-row save today. A waiter never sees a stage for a write that rolled
back. [Snapshots](snapshots) are taken in complete, from the model that was written.

### Checkpoints and completion stay batched {#checkpoints}

Checkpoints and work-row completion are already batched: they are buffered and written with one call per flush,
after the row write. The set-based mode keeps that path as it is and does not move them into the row-write
transaction. The runner already treats them as a later step, and moving them is not needed to remove the per-stream
cost.

## Per-stream mode {#per-stream}

The per-stream mode is today's path: each (stream, perspective) pair is loaded, folded, written and completed on its
own. It stays as a selectable mode for comparison, and it is also the path the set-based mode hands a pair to when that
pair needs it (a rewind, an evicted or purged row, a write the store cannot prepare, a conflict, a rejected row). Because both modes share the fold
and the completion, the per-stream mode is not a second implementation that can drift.

## Selecting a mode {#selection}

Set-based is the default. A service that registers nothing gets it, and every seam's default implementation is
registered by the framework when perspectives are registered (with `TryAdd`, so a deliberate override still wins).

A service-wide default is set in options, and a single perspective can override it with an attribute. Only named modes
can be selected, never a free combination of the three seams, so an invalid combination cannot be built.

```csharp{
title: "Select the per-stream write mode for a service and set-based for one perspective"
description: "Planned API: a service-wide write mode in the perspective options and a per-perspective override attribute."
framework: "NET10"
category: "Perspectives"
difficulty: "INTERMEDIATE"
tags: ["perspectives", "write-modes", "configuration"]
unverified: "planned API for #2246; names are illustrative and not shipped"
}
services.AddWhizbang(options => {
  options.Perspectives.WriteMode = PerspectiveWriteMode.PerStream;
});

[PerspectiveWriteMode(PerspectiveWriteMode.SetBased)]
public sealed class OrderSummaryPerspective : IPerspectiveFor<OrderSummary, OrderPlaced> {
  public OrderSummary Apply(OrderSummary current, OrderPlaced evt) {
    return new OrderSummary { OrderId = evt.OrderId, Total = evt.Total };
  }
}
```

## Later modes {#later-modes}

Each later mode is the same pipeline with different seams, and reuses the set-based write sink so the modes cannot
drift apart.

### Write-behind {#write-behind}

[#2247](https://github.com/whizbang-lib/whizbang/issues/2247), opt-in, never the default. For read models with a few
very hot streams (counters, aggregates), folded models stay in memory across batches and are flushed later. Its
guarantees: memory is bounded (a model count and a byte limit are required, and evicting a model flushes it); the
checkpoint advances only with flushed state, so a crash replays from the checkpoint, which is correct because applies
are pure; a cached model is valid only while this instance holds the stream's claim; lifecycle stages and the sync
tracker fire after the flush, and a sync wait forces an early flush of that stream; and writes outside the runner
(collectives, rewind, the ordering guard, rebuild) invalidate or refresh the cached models they touch.

### Staging-table rebuilds {#staging-table-rebuilds}

[#2248](https://github.com/whizbang-lib/whizbang/issues/2248), selected automatically during a full
[rebuild](rebuild) and never switched on by hand (a service can only switch it off). Every model starts empty, rows
are loaded into a staging table with `COPY`, indexes are built after the load, and the table is swapped in by a rename
in one transaction under a short lock. Live events that arrive during the rebuild are caught up from the recorded tail
position in the perspective's live write mode. Every feature that holds the table by name (physical fields,
snapshots, mirrors, indexes and grants) keeps working after the swap, and free disk is checked first because the table
briefly exists twice.

## The conformance suite {#conformance-suite}

A write mode is supported only when it passes the **same conformance suite**. The suite is one integration suite on
PostgreSQL, parameterized by write mode, that runs real generated runners through the worker and covers:

- the ordering guard and rewind, late events, and idempotency
- row version conflicts and model actions (purge)
- physical fields, split and inline
- snapshots and rewind from a snapshot
- collectives on the same rows
- lifecycle stages and perspective sync
- rebuild
- failure isolation: a throwing apply and a failing row

It runs against the set-based and per-stream modes when #2246 ships, and write-behind and staging-table rebuilds must
pass it before they ship. A feature added to perspectives later is added to the suite, so every mode is held to it.
