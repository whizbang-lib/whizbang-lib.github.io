---
title: Commit Sequence & the Order Stamper
pageType: concept
order: 4
version: 1.0.0
description: >-
  The commit-order stamper: how a total order is stamped over rows whose insertion order and
  transaction order disagree, and what that order promises. Stream order takes precedence; across
  streams, order follows when the writing transactions began.
tags: 'work-coordinator, commit-sequence, ordering, stamper, leader-election'
codeReferences:
  - src/Whizbang.Core/Notifications/CommitOrderStamperOptions.cs
  - src/Whizbang.Data.Postgres/Notifications/PgCommitOrderStamperWorker.cs
testReferences:
  - tests/Whizbang.Core.Component.Tests/Notifications/PgNotificationStackStartupGateTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/CommitSequenceStreamOrderSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Performance/RoleVoteBehindAHeldBackStampScenarioTests.cs
  - tests/Whizbang.Core.Tests/Notifications/CommitOrderStampBatchTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PgCommitOrderStamperWorkerIntegrationTests.cs
---

# Commit Sequence & the Order Stamper

Every event-store row carries a `commit_sequence` — a gapless, monotonically increasing number
assigned **after** commit by a per-database singleton worker, the commit-order stamper. It exists
because transaction IDs and clock timestamps are both unsafe orderings for consumers: a
transaction that started first can commit last. Downstream machinery (perspective fetches,
cross-service integrity cursors) relies on `commit_sequence` order for monotonic cursor
advancement, so the stamper only assigns numbers to rows that are *provably stable* — committed,
with no older transaction still in flight that could commit rows behind them.

Until a row is stamped, `get_stream_events` treats it as not-yet-visible (the unstamped gate).
**Stamping latency is therefore perspective-visibility latency**: every millisecond between an
event's commit and its stamp is a millisecond the read model lags the write.

## What the order promises {#ordering}

Whizbang's ordering is built around the stream. **Stream order takes precedence over every other
order**: the framework gives up a global order across streams before it lets one stream's events
be seen out of version order. In tiers, from strongest to weakest:

1. **Within a stream, `commit_sequence` follows the versions. Always.** Version 2 is numbered
   above version 1 however the two were written: in one transaction in any order, in two
   transactions that started in either order, or across two stamp calls. When an earlier version
   is not yet stampable, the later versions of that stream wait for it.
   {verified: CommitSequenceStreamOrderSqlTests.Stamp_ALowerIdTransactionAppendsAfterAHigherOne_TheStreamKeepsItsVersionOrderAsync}
   {verified: CommitSequenceStreamOrderSqlTests.Stamp_TheEarlierVersionIsNotYetEligible_TheLaterOneWaitsForItAsync}
   {verified: CommitSequenceStreamOrderSqlTests.Stamp_OneTransactionInsertsAStreamOutOfVersionOrder_TheSequenceStillFollowsTheVersionsAsync}
2. **Across streams, order follows when the writing transactions began, not a global insertion or
   commit order.** When events for several streams are written concurrently, the stamper takes the
   events whose transactions began writing first. Events it numbers in the same pass are numbered
   in the order they were inserted. Two events in different streams can therefore be numbered in
   either order relative to when they were inserted or committed; nothing reads across streams
   expecting more than this.
   {verified: CommitSequenceStreamOrderSqlTests.Stamp_StreamsInDifferentBatches_FollowTheOrderTheirTransactionsBeganInAsync}
   {verified: CommitSequenceStreamOrderSqlTests.Stamp_StreamsEligibleTogether_AreNumberedInInsertionOrderAsync}
3. **Every number is higher than every number assigned before it.** A row is stamped only once no
   older transaction in the database can still commit a row behind it, so a consumer that has read
   up to a given `commit_sequence` never later finds a lower one. This is what makes a cursor safe.

If two events in different streams must be seen in a particular order, they belong in the same
stream, or the second should carry the first as its cause. Do not rely on `commit_sequence` to
order them.

Stream order wins because every reader of the order is a stream reader. Perspective fetches,
collective replay and the outbox publish order all walk a stream in `commit_sequence` order, and a
stream read out of order corrupts the state built from it. A strict order across streams would
cost more than it buys: the stamper could not find its next batch through an index, and an
import's open transactions would stall it (see [A held-back stamp reads nothing it cannot
stamp](#held-back)).

## How stamping runs

Every service instance hosts the stamper worker; a `pg_try_advisory_lock` elects one leader per
service schema. The lock key is derived from `AdvisoryLockKey` plus the schema, the same way the
duty lock is, so services that share one database in separate schemas each elect their own
stamper. (Before 0.2604.0 the key was fixed per database: only one of those services got a leader,
and the others' events became visible only after the unstamped-row grace window, several seconds
per event.) The leader wakes from two sources:

- **`wh_committed` NOTIFY** — the event-store emit chains ring this channel at commit time,
  waking the leader sub-millisecond through the shared LISTEN connection.
- **Backstop tick** — a polling floor for deployments where LISTEN is unavailable, relaxed to a
  slow cadence while the signaling gate reports NOTIFY healthy.

On each wake the leader calls `stamp_pending_commit_sequences`, which assigns `commit_sequence`
values to a batch of unstamped rows past the ordering fence, in the order described in
[What the order promises](#ordering), taking each row `FOR UPDATE SKIP LOCKED` so two callers never
stamp the same row.

### Nothing unstamped, nothing runs

The stamp's eligibility query once sorted every unstamped row by transaction id before taking a
batch, and it ran on every wake whether or not anything was unstamped, and on a backstop tick during a
bulk load that was measured at roughly half a core per busy database. The leader now asks the
partial index whether any row is unstamped first, a probe that costs nothing, and runs the stamp only
when the answer is yes. A wake that finds nothing raises `OnStampSkipped` rather than a stamp of
zero, so a healthy idle stamper is visible as such.
{verified: PgCommitOrderStamperWorkerIntegrationTests.Worker_NothingUnstamped_SkipsTheStampOnPollingTicksAsync}

## The ordering fence is per-database

A row is stampable when its inserting transaction is older than every in-flight transaction
that could still write **this database's** event store. Only backends connected to the current
database (plus prepared transactions targeting it) can do that, so the fence is:

- the oldest assigned `backend_xid` among `pg_stat_activity` rows for `current_database()`, and
- the oldest `pg_prepared_xacts` transaction for `current_database()`,

whichever is older — falling back to the snapshot's `xmax` when neither exists.

:::updated
Earlier versions fenced on `pg_snapshot_xmin(pg_current_snapshot())`, which is **cluster-wide**:
transaction IDs are global to the server, so a long-running transaction in *any* database — an
unrelated service sharing the cluster, an idle-in-transaction session, a handler holding a
transaction across an external call — froze stamping everywhere. On shared clusters this
surfaced as multi-second perspective lag injected by workloads that could not possibly have
written the affected database. The fence is now scoped to the current database.
:::

## Fenced work retries until drained {#fenced-retry}

A commit's own `wh_committed` wake can arrive while an older same-database transaction is still
open. The stamp call then legitimately assigns nothing — but that wake will not repeat, and
without care the pending rows would sit invisible until the next backstop tick.

The leader therefore distinguishes *idle* from *fenced*: after a stamp call returns zero, it
probes for remaining unstamped rows (a partial-index `EXISTS`), and while any exist it keeps
re-stamping on `CommitOrderStamperOptions.FencedRetryInterval` (default 250 ms) instead of
sleeping on the wake sources. A full batch likewise triggers an immediate follow-up call until
the pending set drains. Idle means **no pending work** — never merely "no recent doorbell."

## Batch size grows while draining and backs off on a timeout {#batch-size}

A call has a fixed cost of its own, so while calls keep filling their batch the leader doubles the
next one, up to `DrainBatchSize`, and returns to `BatchSize` once a call comes back short (the
backlog is drained to the fence).
{verified: CommitOrderStampBatchTests.Next_ClimbsFromTheConfiguredSizeToTheCeilingInAFewCallsAsync}
{verified: CommitOrderStampBatchTests.Next_AShortBatch_ReturnsToTheConfiguredSizeAsync}

A call that runs past the command timeout (or a server statement timeout) is canceled and rolls
back everything it did, so the same size can never succeed. The leader halves the batch, down to a
single row, and retries at once without giving up the stamper role. Until the backlog drains, the
batch does not grow back past the size that completed, so a drain does not climb back into the
timeout.
{verified: CommitOrderStampBatchTests.AfterTimeout_FallsBelowTheConfiguredSizeAndStopsAtOneAsync}
{verified: CommitOrderStampBatchTests.Next_AfterATimeout_DoesNotGrowBackToTheSizeThatTimedOutAsync}
{verified: PgCommitOrderStamperWorkerIntegrationTests.Worker_AStampTimesOut_HalvesTheBatchAndKeepsStampingAsLeaderAsync}

:::updated
The batch used to be resized only after a call that returned. After a bulk import had grown it, a
call that could not finish in time was canceled, the leader came back with the same size, and the
stamper repeated the same timeout every 30 seconds until the service restarted. Nothing was stamped
in that time, so none of the service's read models moved.
:::

## A held-back stamp reads nothing it cannot stamp {#held-back}

A bulk import keeps the fence low for as long as it runs: its oldest open transaction holds the
fence while the rest of the import commits behind it, so the stamper retries on
`FencedRetryInterval` with rows pending that it may not stamp yet. Each of those calls runs under the
stamper's role fence, and the role holder's own renewal vote waits for it to commit.

A call therefore has to find its batch without reading the rows it cannot stamp. The stamper records
the id of the transaction that wrote each event, and finds eligible events through an index on it,
earliest transaction first; rows behind the fence are never read. A call costs what it stamps,
whatever is waiting behind the fence.
{verified: CommitSequenceStreamOrderSqlTests.Stamp_RowsBehindAnOpenTransaction_AreNotReadToFindNothingEligibleAsync}
{verified: CommitSequenceStreamOrderSqlTests.Stamp_ABacklog_CostsWhatTheBatchStampsNotWhatTheBacklogHoldsAsync}

:::updated
Earlier versions walked unstamped rows in insertion order and checked each against the fence. With
nothing eligible the walk never reached its batch, so every fenced retry read every row an import
held back, stamped none, and held the role row while it did. Under bulk imports the role holder's
renewal vote waited a median of 14.5 s, and up to 30 s, behind those calls. Batches are now chosen
earliest writing transaction first, which is the cross-stream order described above.
:::

## Configuration

```csharp{title="Commit-order stamper options" description="Stamping cadence knobs — defaults suit almost every deployment" category="Configuration" difficulty="ADVANCED" tags=["WorkCoordinator","Stamper","Postgres"] framework="NET10"}
services.Configure<CommitOrderStamperOptions>(o => {
  o.PollingInterval = TimeSpan.FromMilliseconds(250);   // backstop floor when NOTIFY is unavailable
  o.FencedRetryInterval = TimeSpan.FromMilliseconds(250); // re-stamp cadence while the fence is held
  o.BatchSize = 1000;                                   // rows per stamp call once drained
  o.DrainBatchSize = 25_000;                            // largest batch while a backlog drains
  o.LeaderElectionRetry = TimeSpan.FromMilliseconds(1500);
});
```

`DisableStamper` is a killswitch for diagnostics only — with stamping disabled, newly committed
events never become visible to perspective fetches.

## Operational signals

- A healthy system stamps within milliseconds of commit; sustained unstamped backlog with a
  quiet stamper means the leader lock is stranded or the direct connection is routed through a
  transaction-pooling proxy (see [Notifications and pgbouncer](notifications-and-pgbouncer)).
- Persistent fenced retries point at a long-running write transaction **in the same database**
  — typically a handler holding its transaction across an external call. The retry loop bounds
  the damage to that transaction's own duration; fixing the handler removes it entirely.
