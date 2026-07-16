---
title: Event Ordering Invariant
pageType: concept
version: 1.0.0
category: Architecture
order: 2
description: >-
  Every batch boundary in Whizbang's pump-then-process pipeline delivers
  event_id-sorted output. This is the invariant that lets cursor-by-event_id
  comparisons remain correct under parallel emission and cross-process saga
  fan-out.
tags: >-
  architecture, ordering, sliding-window, cursor-inversion, perspective-apply,
  event-sourcing, uuidv7
codeReferences:
  - src/Whizbang.Core/Workers/SlidingWindowOutboxBatchStrategy.cs
  - src/Whizbang.Core/Workers/SlidingWindowInboxBatchStrategy.cs
  - src/Whizbang.Core/Workers/InboxDispatchWorker.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
  - src/Whizbang.Data.Postgres/Migrations/_emit_event_store_chain.sql
testReferences:
  - tests/Whizbang.Core.Tests/Workers/SlidingWindowOutboxBatchStrategyTests.cs
  - tests/Whizbang.Core.Tests/Workers/SlidingWindowInboxBatchStrategyTests.cs
---

# Event Ordering Invariant

> **Invariant.** Every batch boundary in Whizbang's pump-then-process pipeline must deliver output sorted by `event_id` (UUIDv7) ascending. Cross-batch ordering is the responsibility of the layer that allocates `event_id`s; *within* each batch, the holding layer (sliding window, SQL function, drain fetch) must sort before passing the batch downstream.

## Why this exists

`event_id` is a UUIDv7 generated at the point of `Dispatcher.PublishAsync(...)`. UUIDv7 is lexicographically ordered by emission *time* — but only with respect to a single allocator. Two race conditions can produce non-monotonic `event_id`s on the same stream:

1. **Parallel emission inside one process.** A receptor running on N threads (`Parallel.ForEachAsync`, concurrent saga handlers) calls `TrackedGuid.NewMedo()` from each thread. `NewMedo` is monotonic per allocation context; under same-millisecond contention across threads the random suffix can produce two UUIDs whose lex sort doesn't match wall-clock emission order.
2. **Cross-process emission into one saga stream.** A saga stream aggregates events emitted by multiple services. Each service is internally monotonic but no two services share a clock or counter. Same-millisecond emissions from different processes interleave at `wh_event_store` in commit order, not in `event_id` lex order.

The downstream cost when ordering breaks: the perspective apply cursor uses `event_id` as its "last applied" marker. An event arriving after the cursor advanced past a higher `event_id` triggers `Cursor inversion detected → rewind → full replay`. If the replay path doesn't upsert, every replay multiplies into 23505 unique-constraint violations.

The sliding windows exist *for this reason* — they coalesce same-stream emissions over a brief time window so that downstream sees one canonical, sorted batch.

## Where the invariant is enforced

Every layer that holds events in a batch sorts by `event_id` before passing the batch on.

### 1. `SlidingWindowOutboxBatchStrategy._drainBufferAsync`

Per-stream-keyed sliding window. On flush, each per-stream batch is sorted by `MessageId` (= `event_id`) before the bulk-flush callback fires.

Code: [`src/Whizbang.Core/Workers/SlidingWindowOutboxBatchStrategy.cs`](https://github.com/whizbang-lib/whizbang/blob/main/src/Whizbang.Core/Workers/SlidingWindowOutboxBatchStrategy.cs)

Test: `SlidingWindowOutboxBatchStrategyTests.AppendAsync_SameStream_SingleBatchSortedByMessageIdAsync` — appends `[m3, m1, m2]`; asserts flushed batch is `[m1, m2, m3]`.

### 2. `SlidingWindowInboxBatchStrategy._drainBufferAsync` (slice 23)

**Per-stream-keyed sliding window** (since slice 23) — same shape as the outbox strategy. Each stream_id has its own bounded channel + drain task + sliding-window batcher + idle eviction. On flush, the per-stream batch is sorted by `MessageId` ASC.

Why per-stream (not global): cross-service fan-in. Saga aggregates (e.g. `BulkJobImportOrchestration`, `UberDraftJob`) receive events from multiple concurrent producers. The pre-slice-23 global channel flushed everything in a 50 ms window — two transport messages for the same stream arriving more than 50 ms apart landed in *different* flush batches. Each batch was internally sorted but cross-batch ordering was arrival order, which on a fan-in stream is guaranteed to deviate from `MessageId` order. Result on the JDX bulk-import smoke: ~5,600 `Cursor inversion detected` warnings per run.

With per-stream buffers + 300 ms / 3 s default window, same-stream messages from multiple producers coalesce within the window; the sort runs over the merged per-stream batch; events flush in `MessageId` order even when arrival was out of order. Different streams remain fully parallel. `InboxMessage.StreamId == null` (broadcast-style) routes to a default `Guid.Empty` buffer.

Code: [`src/Whizbang.Core/Workers/SlidingWindowInboxBatchStrategy.cs`](https://github.com/whizbang-lib/whizbang/blob/main/src/Whizbang.Core/Workers/SlidingWindowInboxBatchStrategy.cs)

Tests:
- `SlidingWindowInboxBatchStrategyTests.AppendAsync_OutOfOrderArrivals_FlushedSortedByMessageIdAsync` — appends `[m3, m1, m2]`; asserts flushed batch is `[m1, m2, m3]`.
- `SlidingWindowInboxBatchStrategyTests.AppendAsync_SameStream_CrossWindowArrivals_CoalesceInOneFlushAsync` — locks the cross-batch coalesce invariant.
- `SlidingWindowInboxBatchStrategyTests.AppendAsync_DifferentStreams_FlushIndependentBatchesAsync` — different streams remain isolated.
- `SlidingWindowInboxBatchStrategyTests.AppendAsync_NullStreamId_RoutesToDefaultBufferAsync` — broadcast routing.

### 3. `_emit_event_store_chain` SQL

Belt-and-suspenders: the SQL function that fans the C# batch into `wh_event_store` rows sorts the input array by `event_id` ASC before assigning per-stream versions. Catches any caller that forgot to pre-sort.

(Status: planned — see plan file `plans/pump-then-process.md` slice 18c.)

### 4. `InboxDispatchWorker._distributeAsync`

The slice-14 partition writer groups per-stream batches before fanning out to `Channel<InboxWork>` partitions. Each per-stream group is sorted by `event_id` before the partition-channel writes so parallel consumers see in-order events.

(Status: planned — slice 18d.)

### 5. `PerspectiveWorker` drain fetch

`fetch_pending_perspective_events`, `fetch_event_store_by_ids`, and the `claim_work` per-stream projection all `ORDER BY event_id ASC`. The runner template applies events in the order it receives them.

(Status: planned — slice 18e.)

## Symptoms of a missing sort

If a new touchpoint is added that batches events without sorting, the JDX bulk-import load test produces the following pattern:

- `[WRN] Cursor inversion detected: pending event "<lex-lower>" ≤ cached cursor "<lex-higher>"` — many hundreds per minute on saga streams.
- `[WRN] No qualifying snapshot found ... performing full replay` — every inversion triggers one.
- `[ERR] 23505: duplicate key value violates unique constraint "wh_per_*_pkey"` — ~140 per replay (one per pre-existing perspective row that the replay re-inserts).
- Perspective backlog grows faster than it drains; UI freshness collapses.

The production-grade regression test is the JDX bulk-import smoke run (350 jobs, 20k+ events). A clean run produces zero `Cursor inversion detected` log entries; any non-zero count points at a touchpoint that lost the sort.

## What this invariant does *not* guarantee

- **Cross-batch ordering.** If batch A flushes with the only event for stream S, then batch B flushes with a later event for stream S, and B was *committed* before A despite being emitted later — wh_event_store sees B before A and assigns `version = N` to B, `N+1` to A. That's a separate concern handled by the rewind path (`IPerspectiveRunner.RewindAndRunAsync`) and the idempotent upsert on perspective tables (see slice 19 below).
- **Cross-process global monotonicity.** No layer in this pipeline coordinates UUID allocation across services. Cross-process inversions on saga streams are tolerated via the rewind + upsert paths, not prevented.

## Companion invariant: idempotent perspective upsert (slice 19)

Even with every batch boundary sorted, cross-batch and cross-process scenarios can still trigger the rewind path. When that fires, the runner re-applies the stream's full history into perspective tables. The apply target — `BaseUpsertStrategy._upsertCoreInnerAsync` — must therefore be idempotent: re-applying an event whose perspective row already exists must succeed, not throw PostgreSQL 23505.

Today's implementation uses a SELECT-then-INSERT/UPDATE pattern (not an atomic SQL upsert), which is racy under concurrent application (parallel perspective consumers + rewind re-firing while a normal apply is in flight). `_upsertCoreAsync` wraps the inner call in a bounded retry loop:

- On `DbUpdateException` carrying `23505`, the change tracker is cleared and the inner call retries.
- After `MAX_DUPLICATE_KEY_RETRIES = 3` attempts the exception propagates — the failed work is routed to the failure channel.
- `BaseUpsertStrategy.DuplicateKeyRetriesRecovered` exposes a process-wide counter for observability; a non-zero value under load is expected, growth in step with traffic is the canary signal.

Code: [`src/Whizbang.Data.EFCore.Postgres/BaseUpsertStrategy.cs`](https://github.com/whizbang-lib/whizbang/blob/main/src/Whizbang.Data.EFCore.Postgres/BaseUpsertStrategy.cs)

Tests: `BaseUpsertStrategyInPlaceUpdateTests.cs` covers the in-place update path; concurrent-upsert regression test is a planned follow-up under heavy-PG harness.

**Known follow-up**: EF Core logs each 23505 conflict at `[ERR]` level *before* the retry can catch and recover. The retry is correct (data integrity preserved) but the log is noisy under high contention. Suppressing the EF-level log for caught-and-recovered 23505s is slice 20.

## Post-slice-18 residual: cursor-advances-past-orphaned-rows race (slice 25)

After slice 23 narrowed the cross-batch ordering window, JDX still produced residual inversions with multi-second `MessageId` deltas. Investigation found the source was **not** a missing sort — it was an atomicity gap in the perspective worker's fetch path.

The pre-slice-25 `get_stream_events` SQL filtered by `instance_id = p_instance_id AND lease_expiry > p_now`. Rows whose `instance_id` was `NULL` (orphaned at insert), or whose lease had expired, were *invisible* to the fetch. The worker would:

1. Fetch and apply only the rows currently leased to this instance.
2. Advance its cursor through those events' `MessageId`s.
3. `claim_orphaned_perspective_events` would later claim the orphaned rows.
4. The next fetch would surface them — now behind the cursor — triggering a rewind.

**Slice 25 fix.** `get_stream_events` now performs `UPDATE` (claim every eligible row for the requested streams) and `SELECT` (return everything now leased) in one PL/pgSQL function, sharing one MVCC snapshot:

- Eligible rows: unprocessed AND (orphaned OR expired-lease OR already ours).
- `attempts` increments only on lease takeover (instance change); same-instance re-lease doesn't inflate the counter.
- Caller invariant after the call: no unprocessed rows for the requested streams exist unleased to anyone else.

Code: [`src/Whizbang.Data.Postgres/Migrations/038_GetStreamEvents.sql`](https://github.com/whizbang-lib/whizbang/blob/main/src/Whizbang.Data.Postgres/Migrations/038_GetStreamEvents.sql)

Tests: `GetStreamEventsClaimSlice25Tests` — orphan-row claim, expired-lease reclaim, other-instance-valid-lease NOT poached, attempts bumps only on takeover.

Companion API: `IWorkCoordinator.ClaimAndFetchPendingPerspectiveEventsAsync` (per-stream-per-perspective variant) for callers that want the same atomic claim+fetch semantics scoped to one `(stream_id, perspective_name)` pair instead of multi-stream batches.

## Cheap rewinds: intermediate snapshots during replay (slice 24c)

The existing rewind path (`PerspectiveRunner.RewindAndRunAsync`) wrote ONE snapshot at the end of each replay. For "very late" events whose `MessageId` falls *between* the end-of-rewind snapshot and earlier events, that snapshot didn't qualify (`GetLatestSnapshotBeforeAsync` requires `snapshot.event_id < triggeringEventId`), so the rewind replayed from event zero — the "No qualifying snapshot found" log line.

**Slice 24c fix.** During replay, the runner takes an intermediate snapshot every `RewindSnapshotIntervalEvents` events (default 10). A 50-event rewind ends up with ~5 snapshots at events 10, 20, 30, 40, 50; `MaxSnapshotsPerStream` (default 5) bounds storage. Future late events almost always find a qualifying snapshot at or below their `MessageId`. Intermediate snapshot failures are best-effort — logged at Debug, don't break the replay.

Code: [`src/Whizbang.Generators/Templates/PerspectiveRunnerTemplate.cs`](https://github.com/whizbang-lib/whizbang/blob/main/src/Whizbang.Generators/Templates/PerspectiveRunnerTemplate.cs)

Options: `PerspectiveSnapshotOptions.RewindSnapshotIntervalEvents` (set to 0 to disable and keep end-of-rewind-only legacy behavior).

## Apply-boundary batching (slice 22c)

Independent of ordering, the perspective drain path also benefits from coalescing same-stream signals before applying. The pre-slice-22c default sliding window for drain stream-ids was 50 ms / 1 s — too short for the JDX hot-spot where a single stream (`UberDraftJob` saga aggregate) receives ~46 events in rapid succession. Each tick triggered a separate apply cycle (read snapshot → apply 1 event → atomic UPSERT) even though all events were already pending.

Slice 22c.1 introduces `IApplyBatchStrategy` + per-stream `SlidingWindowApplyBatchStrategy` as a pluggable strategy interface for the apply boundary. Slice 22c.2 retunes the existing in-loop `_accumulateDrainSignalsWithinWindowAsync` accumulator default to 300 ms / 3 s / 1000 — the same window used by the inbox per-stream batcher in slice 23.

Result: 46 events for one stream collapse into one drain cycle; the worker reads the snapshot once, applies all 46 in one Apply pass, writes one atomic UPSERT. CPU on hot streams drops; PG round-trips drop accordingly.

Code: [`src/Whizbang.Core/Messaging/IApplyBatchStrategy.cs`](https://github.com/whizbang-lib/whizbang/blob/main/src/Whizbang.Core/Messaging/IApplyBatchStrategy.cs) — pluggable interface.

Tests: `SlidingWindowApplyBatchStrategyTests` covers per-stream coalesce + independent flush + drain semantics.

## See also

- [Message Lifecycle & Architecture](message-lifecycle.md)
- Phase H plan: `plans/pump-then-process.md` (slice 18a–18e, 19, 22, 23, 24c, 25)
- `feedback_lock_invariants_in_tests` — architectural invariants must be locked by regression tests, not just comments.
