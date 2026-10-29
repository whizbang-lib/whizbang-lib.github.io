---
title: Batched flushers
pageType: concept
order: 5
version: 1.0.0
description: >-
  The shared batch flusher behind completion, failure and lease-renewal writes: how work is
  coalesced and what happens when a flush fails.
tags: 'work-coordinator, flushers, batching, completions, lease-renewal, backpressure'
codeReferences:
  - src/Whizbang.Core/Workers/BatchFlusher.cs
  - src/Whizbang.Core/Workers/FailureFlushWorker.cs
  - src/Whizbang.Core/Workers/PerspectiveCompletionFlushWorker.cs
  - src/Whizbang.Core/Workers/OutboxCompletionFlushWorker.cs
  - src/Whizbang.Core/Workers/LeaseRenewalWorker.cs
  - src/Whizbang.Data.Postgres/Migrations/016_UpdatePerspectiveCheckpoints.sql
  - src/Whizbang.Data.Postgres/Migrations/255_LeaseRenewalIsScopedToTheHolder.sql
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Core/Messaging/WorkCategory.cs
  - src/Whizbang.Core/Workers/OutboxPublishWorker.cs
  - src/Whizbang.Core/Workers/OutboxDrainWorker.cs
  - src/Whizbang.Core/Workers/InboxDispatchWorker.cs
testReferences:
  - tests/Whizbang.Core.Component.Tests/Workers/BatchFlusherRetryTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/OutboxCompletionFlushWorkerTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/LeaseRenewalWorkerCoverageTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Cursors/PerspectiveCursorAdvanceSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/HeldLeaseRenewalSqlTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/OutboxPublishWorkerHoldRenewalTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/OutboxDrainWorkerTransportReadinessTests.cs
  - tests/Whizbang.Core.Tests/Workers/InboxDispatchWorkerHeldLeaseTests.cs
---

# Batched flushers

Four batched flush workers turn high-frequency completion writes into coalesced batches with one fsync per batch. All built on the same `BatchFlusher<T>` primitive (Nagle pattern over a bounded channel).

## The pattern

```
Producer enqueues item     ─┐
                            ├──►  BatchFlusher<T> (bounded channel)
Producer enqueues item     ─┤      ─ wait for first item
Producer enqueues item     ─┘      ─ then coalesce additional items for CoalesceWindowMs
                                   ─ OR until MaxBatchSize OR ImmediateFlushThreshold
                                                  │
                                                  ▼
                                          await FlushAsync(IReadOnlyList<T>, ct)
                                                  │
                                                  ▼
                                          IWorkCoordinator.<MethodPerCategory>(batch)
```

## The four batched flush workers

| Worker | Channel item | SQL function | Default tuning |
|---|---|---|---|
| `OutboxCompletionFlushWorker` | `Guid` (outbox message id) | `complete_outbox_published` | 500 max / 10 ms / 250 immediate |
| `PerspectiveCompletionFlushWorker` | `PerspectiveCompletionItem` (event_work_id OR cursor) | `complete_perspective` | 1000 max / 25 ms / 500 immediate |
| `FailureFlushWorker` | `CategorizedFailure` (category + MessageFailure) | `report_failures` per category | 100 max / 100 ms / 50 immediate |
| `LeaseRenewalWorker` | `CategorizedLeaseRenewal` (category + Guid) | `wh_renew_held_leases` per category | 200 max / 200 ms / 100 immediate |

Each follows the same shape: a `BackgroundService` exposing a channel-writer interface, owning a `BatchFlusher<T>` that calls the appropriate `IWorkCoordinator` method per batch.

## Tuning knobs

Each flusher has `BatchFlusherOptions`:

| Knob | Effect |
|---|---|
| `ChannelCapacity` | Bounded back-pressure when full. |
| `MaxBatchSize` | Cap on items per flush call. |
| `CoalesceWindowMs` | Max wait coalescing additional items after the first. |
| `ImmediateFlushThreshold` | Flush early when batch reaches this size. |

Override via `Whizbang:Workers:<Worker>:Flusher:<Knob>`.

## Why this pattern wins

Each flush call costs: round-trip + fsync (typically 3-10 ms). Doing one round-trip per completion at 1000 completions/sec = 1000 fsyncs/sec; postgres can't keep up.

With Nagle (25 ms window, 1000 max): 1000 completions/sec coalesces into 40 calls/sec; 25× fewer round-trips, 25× fewer fsyncs. Latency for any individual completion rises from ~3-10 ms to ~25-35 ms — acceptable for fire-and-forget completion semantics.

## Perspective cursors {#perspective-cursors}

A perspective completion carries the last event the run applied (`LastEventId`), and `complete_perspective` persists the stream's cursor from it through `update_perspective_cursors`:

- A missing cursor is created at that event.
- An existing cursor advances when the event sorts later in its stream (by stream version), and is never moved back by an earlier one.
- It never passes the first event still unprocessed for that perspective, so an event behind the cursor is never skipped.
- Two completions for the same stream and perspective in one batch keep the later event.
- A completion with no event (a run that applied nothing) records no position, and an event the store does not hold is skipped without failing the rest of the batch.
- The status becomes completed for every reported stream with nothing left unprocessed, whether or not its position moved.

The position comes from the completion as well as from the processed `wh_perspective_events` rows: in production those rows are deleted as they complete, before the cursor is written, and only debug mode keeps them. Until #1363, the cursor was derived from those rows, so a missing cursor was never created and an existing one never advanced; only its status changed.

To see whether a perspective's cursors are behind on a database that ran an affected release, compare each cursor with the events committed after it, **in commit order** and **only for the event types that perspective handles**:

- **Commit order, not stream version.** A cursor can point at an event in another stream: a collective event updates many records at once and lives in a stream of its own, where it may be version 1. Comparing versions across streams reads every record a collective event touched as "behind".
- **Only handled event types.** A stream carries events for many perspectives. An event the perspective ignores never moves its cursor, so counting it reads a healthy cursor as "behind". Without the list, the count is an upper bound, not a measurement.

```sql{
title: "Measure how far one perspective's cursors are behind"
description: "Read-only: cursors with a later-committed event of a type the perspective handles, and streams with that perspective's events but no cursor."
framework: "NET10"
category: "Operations"
difficulty: "INTERMEDIATE"
tags: ["perspective-cursors", "runbook", "postgres", "diagnostics"]
}
-- Set these two first: the perspective's registered name, and the event types it handles
-- (the type name before the comma in wh_event_store.event_type, e.g. 'My.Contracts+OrderPlacedEvent').
\set perspective 'My.Service.Orders.OrderSummary+Projection'
\set handled '{My.Contracts+OrderPlacedEvent,My.Contracts+OrderShippedEvent}'

-- Cursors with a handled event committed after the one they point at
SELECT count(*) AS cursors_behind
FROM wh_perspective_cursors c
JOIN wh_event_store at_cursor ON at_cursor.event_id = c.last_event_id
WHERE c.perspective_name = :'perspective'
  AND EXISTS (
    SELECT 1 FROM wh_event_store e
    WHERE e.stream_id = c.stream_id
      AND e.commit_sequence > at_cursor.commit_sequence
      AND split_part(e.event_type, ',', 1) = ANY (:'handled'::text[]));

-- Streams with a handled event and no cursor for this perspective
SELECT count(DISTINCT e.stream_id) AS streams_without_a_cursor
FROM wh_event_store e
WHERE split_part(e.event_type, ',', 1) = ANY (:'handled'::text[])
  AND NOT EXISTS (SELECT 1 FROM wh_perspective_cursors c
                  WHERE c.stream_id = e.stream_id AND c.perspective_name = :'perspective');
```

Both counts fall as the fixed release completes new work: each completion creates or advances its stream's cursor. A stream that receives no new events keeps its old cursor until it is next processed or rebuilt.

**To repair rather than measure**, rebuild the affected records (`RebuildMode.SelectedStreams` with their stream ids). The rebuild replays each record on the instance that owns it and writes the cursor from what it applied, so it is exact where these queries can only estimate. Do not move cursors with SQL: a cursor set past an event the perspective has not applied makes that event look like a late arrival and triggers a replay, and SQL cannot tell which events were applied.

## Held lease renewal {#held-lease-renewal}

Every lease renewal goes through `IWorkCoordinator.RenewHeldLeasesAsync(category, instanceId, ids, leaseSeconds)`,
which calls `wh_renew_held_leases` (migration 255). The caller names itself, and a row is renewed only
while that instance holds it and it is unprocessed. The stream leases of the renewed rows' streams that
the instance is assigned are extended with them. The call returns the ids it did **not** renew: a row
another instance claimed after the caller's lease on it lapsed, a row that completed, or a row the
store no longer has. An unknown category is refused.
{verified: HeldLeaseRenewalSqlTests.RenewHeldLeases_Inbox_AFormerHolder_DoesNotExtendTheNewHoldersLease_AndReportsTheRowAsync, HeldLeaseRenewalSqlTests.RenewHeldLeases_Inbox_TheHolder_RenewsTheRowAndItsStreamAsync, HeldLeaseRenewalSqlTests.RenewHeldLeases_Outbox_AFormerHolder_DoesNotExtendTheNewHoldersLease_AndReportsTheRowAsync, HeldLeaseRenewalSqlTests.RenewHeldLeases_Outbox_TheHolder_RenewsTheRowAndItsStreamAsync, HeldLeaseRenewalSqlTests.RenewHeldLeases_PerspectiveEvent_AFormerHolder_DoesNotExtendTheNewHoldersLease_AndReportsTheRowAsync, HeldLeaseRenewalSqlTests.RenewHeldLeases_PerspectiveEvent_TheHolder_RenewsTheRowAndItsStreamAsync, HeldLeaseRenewalSqlTests.RenewHeldLeases_ARowThatIsGoneOrCompleted_IsReportedNotRenewedAsync, HeldLeaseRenewalSqlTests.RenewHeldLeases_AnUnknownCategory_IsRefusedAsync}

Before migration 255, renewal matched rows by id alone. An instance whose lease had lapsed, and whose
row another instance had since claimed, still had the row in memory, and its next renewal extended
the new holder's row and stream leases. Both instances then treated the row as theirs.

Every caller stops holding what the call returns:

| Caller | What it does with a row it was not renewed for |
|---|---|
| Inbox lease keeper (`InboxDispatchWorker`) | Stops holding the row: a queued copy is not dispatched and a running handler's deadline is not extended. Logged at Warning, the first five individually, then a count. See [inbox dispatch](inbox-dispatch.md#renewal-not-covered). |
| Outbox publisher, transport-not-ready hold (`OutboxPublishWorker`) | Stops re-buffering the row and tracking it in flight, so this instance does not publish it. Logged at Warning. |
| Outbox drain, transport-not-ready hold (`OutboxDrainWorker`) | Stops reporting the row as held in its held-publish signal. |
| `LeaseRenewalWorker` | Logs each row at Warning. A handler still running on the row keeps running. |

{verified: InboxDispatchWorkerHeldLeaseTests.Keeper_ARowItsRenewalDidNotCover_StopsBeingHeld_AndIsNotDispatchedAsync, OutboxPublishWorkerHoldRenewalTests.Bulk_ARowItsRenewalDidNotCover_IsNoLongerHeldOrPublishedAsync, OutboxDrainWorkerTransportReadinessTests.NotReady_ARowItsRenewalDidNotCover_IsNotReportedHeldAsync, LeaseRenewalWorkerCoverageTests.FlushBatchAsync_RowsTheRenewalDidNotCover_AreLoggedAsync}

`renew_leases`, the function renewal used before migration 255, is left in the schema unchanged and
unused by this release. During a rolling deployment, instances still on the previous release keep
renewing through it.

## Composite flush

When the C# layer has multiple categories buffered, `flush_completions` SQL function combines them into one round-trip (covered by a single fsync at the outer commit). Used by future work that wires multiple flushers to a shared connection; today the per-worker flushers commit independently.

Because one call can complete some outbox rows and fail others in the same transaction, `flush_completions`
locks every outbox row it will write before it writes any (migration 245): the completed rows, the failed
rows, and the rest of each failed row's run that the failure releases, in one pass in the canonical
`(stream_id, created_at, message_id)` order. Two separate ordered passes in one transaction are not one order,
and could deadlock against another instance completing the same rows. Its steps then run in the canonical
table order: outbox completions and failures, inbox failures, then perspective completions and failures.
{verified: OutboxStreamRunDeadlockSqlTests.FlushCompletions_FailingARowAnotherTransactionCompletesFirst_NeverDeadlocksAsync, OutboxStreamRunDeadlockSqlTests.FlushCompletions_ReleasingARunAnotherTransactionCompletesFirst_NeverDeadlocksAsync}

## Failure handling

If a flush throws:
- `BatchFlusher` logs a warning and continues to the next batch.
- The items in the failed batch are LOST — caller's responsibility to make the flush idempotent.

For Whizbang's coordinator methods, all flush calls are idempotent (UPDATE WHERE processed_at IS NULL — already-processed rows ignored). So lost items get retried on the next claim tick when their lease expires and they're re-claimed.

## InboxHandlerWorker — special case

`InboxHandlerWorker` is also a batched flusher (uses the same `BatchFlusher<T>` primitive) but its SQL call is `commit_handler_batch` which has SAVEPOINT-per-handler isolation. Per-handler failures are routed to `FailureFlushWorker` for retry tracking instead of being silently lost. See [Handler commit](handler-commit.md).

## Related

- [Handler commit](handler-commit.md)
- [Configuration reference](configuration-reference.md)
- [Performance tuning](performance-tuning.md)
