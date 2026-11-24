---
title: Stream Order Rule
pageType: concept
version: 1.0.0
category: Architecture
order: 2
description: >-
  Every worker, runner and driver hands a stream on by the position each item carries (a fetched inbox row's
  StreamPosition, an event's LocalStreamVersion), ordered through StreamOrder, and never by event or message id. A
  source guard fails on any sort or comparison of ids outside the documented fallbacks.
tags: >-
  architecture, ordering, stream-order, StreamOrder, StreamPosition, LocalStreamVersion, cursor-inversion,
  perspective-apply, event-sourcing, uuidv7
codeReferences:
  - src/Whizbang.Core/Messaging/StreamOrder.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Core/Messaging/InMemoryEventStore.cs
  - src/Whizbang.Core/Perspectives/ReplayEventOrder.cs
  - src/Whizbang.Core/Perspectives/LastInReplayOrder.cs
  - src/Whizbang.Core/Perspectives/PerspectiveRunnerBase.cs
  - src/Whizbang.Core/Perspectives/PerspectiveSnapshotOptions.cs
  - src/Whizbang.Core/Workers/SlidingWindowOutboxBatchStrategy.cs
  - src/Whizbang.Core/Workers/CoalescingOutboxBatchStrategy.cs
  - src/Whizbang.Core/Workers/SlidingWindowInboxBatchStrategy.cs
  - src/Whizbang.Core/Workers/InboxDrainWorker.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
  - src/Whizbang.Data.Postgres/Collective/CollectiveReplayApplier.cs
  - src/Whizbang.Data.EFCore.Postgres/BaseUpsertStrategy.cs
  - src/Whizbang.Data.Postgres/Migrations/038_GetStreamEvents.sql
  - src/Whizbang.Data.Postgres/Migrations/580_StreamsAreVersionedInEmissionOrder.sql
  - src/Whizbang.Data.Postgres/Migrations/581_ReceivedStreamsAreVersionedInReceiveOrder.sql
  - src/Whizbang.Data.Postgres/Migrations/582_StreamReadsFollowStreamOrder.sql
  - src/Whizbang.Data.Postgres/Migrations/583_LiveReadsCarryTheirStreamOrder.sql
testReferences:
  - tests/Whizbang.Core.Unit.Messaging.Tests/Messaging/StreamOrderTests.cs
  - tests/Whizbang.Core.Component.Tests/Messaging/StreamOrderSourceGuardTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/StreamOrderNeverByIdGuardTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/InboxDrainWorkerGapTests.cs
  - tests/Whizbang.Core.Unit.Workers.Tests/Workers/PerspectiveWorkerOrderingTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/SlidingWindowOutboxBatchStrategyTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/CoalescingOutboxBatchStrategyTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/SlidingWindowInboxBatchStrategyTests.cs
  - tests/Whizbang.Core.Unit.Messaging.Tests/Messaging/InMemoryEventStoreReadOrderingChangeLevelTests.cs
  - tests/Whizbang.Core.Unit.Messaging.Tests/Messaging/InMemoryEventStoreReplayOrderTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/GetStreamEventsClaimSlice25Tests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/BaseUpsertStrategyInPlaceUpdateTests.cs
---

# Stream Order Rule

> **Rule.** Every work item carries its position in its stream, and every worker, runner and driver hands a stream on
> by that position, through `StreamOrder`, or in the order the read returned. Nothing orders a stream by event or
> message id ([#2551](https://github.com/whizbang-lib/whizbang/issues/2551)).

## Why an id is not a position {#why}

An event or message id is a UUIDv7: it records when it was minted and by whom, not where it sits in its stream.

1. **Ids derived inside a handling sort at their cause.** An event a receptor returns, or a message it sends, takes an
   id derived from the handling ([emission identity](/v1.0.0/fundamentals/dispatcher/message-cascade#emission-identity)),
   so a retry reproduces it. Since [#2520](https://github.com/whizbang-lib/whizbang/issues/2520) and
   [#2543](https://github.com/whizbang-lib/whizbang/issues/2543) such an id sorts with the message that caused it, so
   the effect a cause's local receptor emits can sort ahead of the cause.
2. **Parallel emission in one process.** Threads issue ids in the order they reach the generator's lock, which is not
   the order their work happened in ([how `New()` orders ids](/v1.0.0/fundamentals/identity/whizbang-ids#uuid7-generator)).
3. **Several producers on one stream.** A saga stream gathers events from several services, which share no clock and
   no counter.

Earlier releases sorted each batch boundary by id and numbered versions by id. That made a cause and its derived
effect, stored together, take their versions the wrong way round, and it made every layer re-derive an order the
store had already decided. Now the store decides the position once and the position travels with the item.

## Where a position comes from {#positions}

| Item | Position | Set by |
|---|---|---|
| A stored event | `wh_event_store.version` | [Emission order](/v1.0.0/fundamentals/event-store/version-ordering#emission-order) for a stored batch, [receive order](/v1.0.0/fundamentals/event-store/version-ordering#receive-order) for a received stream |
| A fetched inbox row | `InboxBatchRow.StreamPosition` | `fetch_inbox_batch_in_stream_order`: a received event's stored version, a command's arrival (`wh_inbox.arrival_position`), each kind dealt into the arrival slots it holds ([dispatch order](/v1.0.0/fundamentals/event-store/version-ordering#dispatch-order)) |
| An event read for a perspective | `MessageEnvelope<T>.LocalStreamVersion` | `get_stream_events_in_stream_order` returns each event's version, carried as `StreamEventData.Version` |
| A message the producer appends | Its place in the batch | The outbox strategies flush a stream in the order its messages were appended |

## Where the rule is enforced {#enforced}

{verified: StreamOrderTests.InboxRows_AreOrderedByTheirStreamPosition_NotByIdAsync, StreamOrderTests.InboxRows_WithoutAPosition_KeepTheFetchsOrder_AfterThePositionedOnesAsync, StreamOrderTests.Events_AreOrderedByTheirVersion_NotByIdAsync, InboxDrainWorkerGapTests.ExecuteAsync_AStreamsRows_AreDispatchedByTheirStreamPosition_NeverByIdAsync, PerspectiveWorkerOrderingTests.GroupAndDedupe_GivenShuffledEventsForOneStream_ReturnsTheGroupInVersionOrder_NotByIdAsync, SlidingWindowOutboxBatchStrategyTests.AppendAsync_SameStream_SingleBatchKeepsTheOrderAppendedAsync, CoalescingOutboxBatchStrategyTests.WithinAFlush_MessagesAreGroupedByStream_EachInTheOrderAppendedAsync, SlidingWindowInboxBatchStrategyTests.AppendAsync_OutOfOrderArrivals_FlushedInTheOrderTheyArrivedAsync}

- **`StreamOrder` is the one ordering.** `StreamOrder.InStreamOrder` orders fetched inbox rows by `StreamPosition`, and
  one stream's envelopes by `LocalStreamVersion`. Both are stable: an item without a position keeps the order the read
  returned it in, after the positioned ones. It replaces `MessageOrderingExtensions.OrderByMessageId`, which is
  removed.
- **The batch strategies keep the order they were given.** The outbox strategies flush each stream in the order its
  messages were appended, and the inbox sliding window flushes what it holds in the order it arrived. Neither sorts by
  id; the store and the fetch decide the position.
- **The inbox drain** dispatches a stream's rows by their `StreamPosition`, and the inbox dispatch worker's stream
  affinity keeps one stream on one partition queue, so the order the drain hands it is the order it runs in.
- **The perspective drain and the runners** apply a stream by the version each event carries. A rebuild and a rewind
  fold the stream they read in the replay order (`ReplayEventOrder`: stream version, then commit sequence, then each
  origin's events in origin order within its slots), which is the order the stream was written in.
- **The outbox publishes in emission order**, the order the stream's messages were stored in.

**The guard.** `StreamOrderSourceGuardTests` reads the source of every worker, runner, the messaging layer and every
driver, and fails on any sort keyed on an id, any comparison of ids, or any use of the retired helper, outside the
fallbacks below, each allowed by its exact text in the one file that defines it. An allowed text that no longer
appears also fails, so the list cannot go stale. `StreamOrderNeverByIdGuardTests` does the same for the latest
definition of every store, receive and replay function in the SQL migrations.
{verified: StreamOrderSourceGuardTests.NoWorkerRunnerOrDriver_OrdersAStreamById_OutsideTheReplaysFallbackAsync, StreamOrderSourceGuardTests.TheGuard_FlagsEachWayOfOrderingById_AndPassesAPositionOrderAndACommentAsync, StreamOrderNeverByIdGuardTests.NoStoreReceiveOrReplayFunction_OrdersAStreamById_InItsLatestDefinitionAsync, StreamOrderNeverByIdGuardTests.TheGuard_FlagsEachWayOfOrderingAStreamById_AndPassesPositionalOrdersAsync}

## The documented fallbacks {#documented-fallbacks}

An id decides an order only where nothing positional exists. Each case is the replay's one fallback, shared by the
store, the reads and the replay so they cannot disagree:

| Case | What decides | Where |
|---|---|---|
| An event with no version and no commit sequence (an unstamped event in a replay batch) | The batch falls back to id order, because a partial mix would interleave two orderings | `ReplayEventOrder`, `LastInReplayOrder` |
| A received event with no origin position (a fan-out child, a redelivery that lost it) | It goes before the first of its origin's positioned events whose id sorts after its own | `_emit_event_store_chain_for_inbox` (migration 581), `ReplayEventOrder` |
| An anchor or checkpoint the stream does not hold (a read after, or between, events of another stream) | The anchor has no position in the stream, so the read compares by id, as the PostgreSQL stores read it | `InMemoryEventStore` ([#2379](https://github.com/whizbang-lib/whizbang/issues/2379), [#2381](https://github.com/whizbang-lib/whizbang/issues/2381)) |
| Collectives of different streams in one replay | They share no stream position: each is placed by its commit sequence, and an unstamped one by its id ([#2449](https://github.com/whizbang-lib/whizbang/issues/2449)) | `CollectiveReplayApplier`, `CollectiveReplayStart` |

{verified: ReceiveOrderVersioningSqlTests.AnUnpositionedEvent_TakesTheReplaysPlace_AmongItsOriginsPositionedEventsAsync, InMemoryEventStoreReadOrderingChangeLevelTests.ReadAsync_AfterAnEventTheStreamDoesNotHold_ComparesByIdAndReturnsStreamOrderAsync, InMemoryEventStoreReplayOrderTests.ReadPolymorphicAsync_FromAnEventTheStreamDoesNotHold_ReadsAfterItsIdAsync, InMemoryEventStoreReplayOrderTests.GetEventsBetweenPolymorphicAsync_BetweenEventsTheStreamDoesNotHold_SelectsByTheirIdsAsync}

Anything else that orders a stream by id is a defect, and the guard fails on it.

## Symptoms of an order by id {#symptoms}

A path that hands a stream on by id instead of by position shows as:

- `[WRN] Cursor inversion detected` on streams with derived ids or several producers;
- `[WRN] No qualifying snapshot found ... performing full replay` after each inversion;
- a perspective row holding an older value after a rebuild, because the stream's first event was applied last.

A clean bulk-import run produces no `Cursor inversion detected` entries.

## Companion invariant: idempotent perspective upsert (slice 19)

Even with every stream handed on in its stream order, a late arrival (an event stored below a cursor) can still trigger the rewind path. When that fires, the runner re-applies the stream's full history into perspective tables. The apply target, `BaseUpsertStrategy`, must therefore be idempotent: re-applying an event whose perspective row already exists must succeed, not throw PostgreSQL 23505.

:::updated
The upsert now has two paths. **Path 1 (slice 21, preferred)**: an atomic raw-SQL `INSERT … ON CONFLICT (id) DO UPDATE`, attempted first on Npgsql. It serializes the document with the serialization registry's persistence profile, which each assembly's generated `PerspectivePersistenceJsonContext` joins from its own module initializer, so no startup hook has to run and no process-wide slot decides the path; this structurally eliminates the 23505 dup-key storm. **Fallback (slice 19)**: the EF SELECT-then-INSERT/UPDATE pattern wrapped in a bounded retry loop, used when Path 1 does not apply: a provider other than Npgsql, a table or column name that is not a plain identifier, a type the persistence union cannot resolve, or a value Npgsql cannot bind.
:::

The slice-19 fallback retry loop:

- On `DbUpdateException` carrying `23505`, the change tracker is cleared and the inner call retries.
- After `MAX_DUPLICATE_KEY_RETRIES = 3` attempts the exception propagates, and the failed work is routed to the failure channel.
- `BaseUpsertStrategy.DuplicateKeyRetriesRecovered` exposes a process-wide counter for observability; a non-zero value under load is expected, growth in step with traffic is the canary signal.

Code: [`src/Whizbang.Data.EFCore.Postgres/BaseUpsertStrategy.cs`](https://github.com/whizbang-lib/whizbang/blob/main/src/Whizbang.Data.EFCore.Postgres/BaseUpsertStrategy.cs)

Tests: `BaseUpsertStrategyInPlaceUpdateTests.cs` covers the in-place update path.

**Known follow-up (fallback path only)**: EF Core logs each 23505 conflict at `[ERR]` level *before* the retry can catch and recover. The retry is correct (data integrity preserved) but the log is noisy under high contention on the fallback path.

## Post-slice-18 residual: cursor-advances-past-orphaned-rows race (slice 25)

Production once produced residual inversions that were **not** an ordering fault: an atomicity gap in the perspective worker's fetch path.

The pre-slice-25 `get_stream_events` SQL filtered by `instance_id = p_instance_id AND lease_expiry > p_now`. Rows whose `instance_id` was `NULL` (orphaned at insert), or whose lease had expired, were *invisible* to the fetch. The worker would:

1. Fetch and apply only the rows currently leased to this instance.
2. Advance its cursor past those events.
3. `claim_orphaned_perspective_events` would later claim the orphaned rows.
4. The next fetch would surface them, now behind the cursor, triggering a rewind.

**Slice 25 fix.** `get_stream_events` now performs `UPDATE` (claim every eligible row for the requested streams) and `SELECT` (return everything now leased) in one PL/pgSQL function, sharing one MVCC snapshot:

- Eligible rows: unprocessed AND (orphaned OR expired-lease OR already ours).
- `attempts` increments only on lease takeover (instance change); same-instance re-lease doesn't inflate the counter.
- Caller invariant after the call: no unprocessed rows for the requested streams exist unleased to anyone else.

Code: [`src/Whizbang.Data.Postgres/Migrations/038_GetStreamEvents.sql`](https://github.com/whizbang-lib/whizbang/blob/main/src/Whizbang.Data.Postgres/Migrations/038_GetStreamEvents.sql)

Tests: `GetStreamEventsClaimSlice25Tests`: orphan-row claim, expired-lease reclaim, other-instance-valid-lease NOT poached, attempts bumps only on takeover.

Companion API: `IWorkCoordinator.ClaimAndFetchPendingPerspectiveEventsAsync` (per-stream-per-perspective variant) for callers that want the same atomic claim+fetch semantics scoped to one `(stream_id, perspective_name)` pair instead of multi-stream batches.

:::updated
Two later migrations refine `get_stream_events` eligibility on top of the slice-25 claim+fetch:

- **058 (unstamped gate)**: rows whose `commit_sequence` is still NULL are neither claimed nor returned (closing the stamper-lag inversion window), but only within a grace window; rows pending longer than the grace flow again NULLS-LAST, so a lagging/absent stamper degrades to pre-058 behavior instead of stalling the drain.
- **059 (ownership gate)**: a row whose stream is owned by a *different, live* instance is not claimable even if its row lease expired (enforcing single-writer-per-stream in the live drain). Unowned streams and streams whose owner is dead still fail over.
:::

## Cheap rewinds: intermediate snapshots during replay (slice 24c)

The existing rewind path (`PerspectiveRunner.RewindAndRunAsync`) wrote ONE snapshot at the end of each replay. For a late event that falls *between* the end-of-rewind snapshot and earlier events, that snapshot didn't qualify (it must come before the triggering event, now judged in stream order by `GetLatestSnapshotBeforeEventInStreamOrderAsync`), so the rewind replayed from event zero: the "No qualifying snapshot found" log line.

**Slice 24c fix.** During replay, the runner takes an intermediate snapshot every `RewindSnapshotIntervalEvents` events (default 10). A 50-event rewind ends up with ~5 snapshots at events 10, 20, 30, 40, 50; `MaxSnapshotsPerStream` (default 5) bounds storage. Future late events almost always find a qualifying snapshot before them in stream order. Intermediate snapshot failures are best-effort (logged at Debug), and don't break the replay.

Code: [`src/Whizbang.Core/Perspectives/PerspectiveRunnerBase.cs`](https://github.com/whizbang-lib/whizbang/blob/develop/src/Whizbang.Core/Perspectives/PerspectiveRunnerBase.cs)

Options: `PerspectiveSnapshotOptions.RewindSnapshotIntervalEvents` (set to 0 to disable and keep end-of-rewind-only legacy behavior).

## Apply-boundary batching (slice 22c)

Independent of ordering, the perspective drain path also benefits from coalescing same-stream signals before applying. The pre-slice-22c default sliding window for drain stream-ids was 50 ms / 1 s (too short for a production hot-spot where a single stream (`Order` saga aggregate) receives many events in rapid succession). Each tick triggered a separate apply cycle (read snapshot → apply 1 event → atomic UPSERT) even though all events were already pending.

Slice 22c retunes the in-loop `_accumulateDrainSignalsWithinWindowAsync` accumulator (`PerspectiveWorkerOptions.DrainBatcher`) to 300 ms / 3 s / 1000, the same window used by the inbox per-stream batcher in slice 23. That accumulator is the live coalescer of the apply boundary.

Result: many events for one stream collapse into one drain cycle; the worker reads the snapshot once, applies all of them in one Apply pass, writes one atomic UPSERT. CPU on hot streams drops; PG round-trips drop accordingly.

A pluggable per-stream `SlidingWindowApplyBatchStrategy` was added alongside it but never wired, and it was removed (#2246). The name `IApplyBatchStrategy` now belongs to the flush policy of [set-based perspective writes](../../fundamentals/perspectives/write-modes.md#flush-policy), which decides when a batch's prepared rows are written.

## See also

- [Message Lifecycle & Architecture](message-lifecycle.md)
- [Stream version ordering](../../fundamentals/event-store/version-ordering): where each position comes from
- Phase H plan: `plans/pump-then-process.md` (slices 19, 22c, 24c, 25)
