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
  - src/Whizbang.Core/Notifications/CommitOrderStampSizer.cs
  - src/Whizbang.Data.Postgres/Migrations/247_StampReadsOnlyTheBatchItStamps.sql
  - src/Whizbang.Data.Postgres/Notifications/PgCommitOrderStamperWorker.cs
testReferences:
  - tests/Whizbang.Core.Component.Tests/Notifications/PgNotificationStackStartupGateTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/CommitSequenceStreamOrderSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Performance/RoleVoteBehindAHeldBackStampScenarioTests.cs
  - tests/Whizbang.Core.Tests/Notifications/CommitOrderStampBatchTests.cs
  - tests/Whizbang.Core.Tests/Notifications/CommitOrderStampSizerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PgCommitOrderStamperWorkerIntegrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EventStoreUpdateChurnSqlTests.cs
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

## Batch size grows while draining, within a time budget, and backs off on a timeout {#batch-size}

A call has a fixed cost of its own, so while calls keep filling their batch the leader doubles the
next one, up to `DrainBatchSize`, and returns to `BatchSize` once a call comes back short (the
backlog is drained to the fence).
{verified: CommitOrderStampBatchTests.Next_ClimbsFromTheConfiguredSizeToTheCeilingInAFewCallsAsync}
{verified: CommitOrderStampBatchTests.Next_AShortBatch_ReturnsToTheConfiguredSizeAsync}

Rows alone cannot bound a call, so the batch also answers to how long the last call took. The call
budget is half the stamper role's renewal interval (2.5 s by default). A full call that ran past the
budget halves the next one. A full call that took more than half the budget keeps its size, because
doubling it would take about twice as long. Only a call well inside the budget grows, and it grows
past any size a slower call backed off to: a call that fits doubled shows that whatever slowed the
earlier ones is over. A slow call logs a warning naming the call, the budget and the next size, and
raises `OnStampRanLong`.
{verified: CommitOrderStampSizerTests.AfterCall_AFirstFullCallPastTheBudget_HalvesAsync}
{verified: CommitOrderStampSizerTests.AfterCall_AFullCallPastHalfTheBudget_HoldsItsSizeAsync}
{verified: CommitOrderStampSizerTests.AfterCall_CheapCallsAfterSlowOnes_GrowPastTheSizeTheSlowOnesBackedOffToAsync}
{verified: PgCommitOrderStamperWorkerIntegrationTests.Worker_AFullStampRunsPastTheCallBudget_HalvesTheBatchAndStillDrainsAsLeaderAsync}

Part of what a call costs does not depend on its size: the round trip, the fence, and whatever else
the database is busy with, such as another service's migration on the same server. Halving answers
only the part that follows the size. When a halved call costs at least three quarters of what the
call twice its size cost, nearly all of it is the fixed part, and a smaller batch would pay that part
more often for the same rows. The batch stops shrinking there and holds that size through further
slow calls, until a call is cheap again, a call times out, or the backlog drains. A cost that does
follow the size keeps halving until a call fits.
{verified: CommitOrderStampSizerTests.AfterCall_HalvingDidNotMakeTheCallCheaper_StopsShrinkingAsync}
{verified: CommitOrderStampSizerTests.AfterCall_AFixedCostPastTheBudget_DoesNotCollapseToOneRowAsync}
{verified: CommitOrderStampSizerTests.AfterCall_ACostThatFollowsTheSize_KeepsHalvingAsync}
{verified: CommitOrderStampSizerTests.AfterCall_TheFloorEndsWithTheConditionsThatSetItAsync}

```mermaid{caption="How the stamper sizes its next call from the last one: what it returned and how long it took." tests=["CommitOrderStampSizerTests.AfterCall_AShortCall_ReturnsToTheConfiguredSizeAsync","CommitOrderStampSizerTests.AfterCall_AFullCheapCall_GrowsAsync","CommitOrderStampSizerTests.AfterCall_AFullCallPastHalfTheBudget_HoldsItsSizeAsync","CommitOrderStampSizerTests.AfterCall_HalvingDidNotMakeTheCallCheaper_StopsShrinkingAsync","CommitOrderStampSizerTests.AfterCall_ACostThatFollowsTheSize_KeepsHalvingAsync"]}
flowchart TD
  call["A call returns"] --> short{"Fewer rows<br/>than asked?"}
  short -- yes --> reset["Back to BatchSize"]
  short -- no --> cheap{"Took at most<br/>half the budget?"}
  cheap -- yes --> grow["Double, up to DrainBatchSize"]
  cheap -- no --> over{"Took more than<br/>the budget?"}
  over -- no --> hold["Keep the size"]
  over -- yes --> fixed{"At the floor, or cost at least 3/4<br/>of the call twice its size?"}
  fixed -- yes --> floor["Keep the size: the floor"]
  fixed -- no --> halve["Halve"]
```

The budget exists because of the role. The holder renews its lease only between calls, and a call
holds the role row for as long as it runs, so every other instance's vote waits behind it. A call
kept within half the renewal interval keeps each gap between renewals well inside the lease.

A call that runs past the command timeout (or a server statement timeout) is canceled and rolls
back everything it did, so the same size can never succeed. The leader halves the batch, down to a
single row, and retries at once without giving up the stamper role. The batch grows back only after
a call well inside the budget, which a size that just timed out does not produce.
{verified: CommitOrderStampSizerTests.AfterTimeout_HalvesAsync}
{verified: CommitOrderStampSizerTests.AfterCall_CheapCallsAfterATimeout_GrowAgainAsync}
{verified: CommitOrderStampBatchTests.AfterTimeout_FallsBelowTheConfiguredSizeAndStopsAtOneAsync}
{verified: PgCommitOrderStamperWorkerIntegrationTests.Worker_AStampTimesOut_HalvesTheBatchAndKeepsStampingAsLeaderAsync}

:::updated
The batch used to grow with the row count alone. On a store where a few thousand rows took longer
than the 15-second role lease, a draining stamper's calls outlasted the lease, and the holder lost
the role to its own lapse between calls, even when no other instance could take it.

The batch also used to be resized only after a call that returned. After a bulk import had grown it, a
call that could not finish in time was canceled, the leader came back with the same size, and the
stamper repeated the same timeout every 30 seconds until the service restarted. Nothing was stamped
in that time, so none of the service's read models moved.

Earlier versions always halved a call past the budget, and growth was capped at the halved size until
the backlog drained. After an upgrade that left every historical event unstamped, calls slowed by
migration I/O on the same server cost about 2.5 s however few rows they asked for, so the batch
halved to a single row and the cap held it there for a backlog of hundreds of thousands of events.
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

## A call costs what it stamps, whatever the statistics say {#any-plan}

An upgrade from a version that predates the commit sequence leaves every historical event unstamped,
and the columns the stamper plans on are written by the same migration pass that creates them, so the
table's statistics know nothing about the backlog until the next `ANALYZE`. A long-lived stamper
connection also settles on a generic plan after a few calls. The stamp is written so that neither
changes what a call reads:

- **The walk is its own statement, with sorting switched off for it.** The only plan that returns
  unstamped rows in stamping order without a sort is the range scan of the index on the writing
  transaction's id, which stops at the batch. No plan that reads and sorts the whole unstamped set
  is available to it.
- **No step joins the batch with itself.** The rows a call locked are matched to the stream
  prefixes they came from by grouping the two lists together, and the insertion-order ranks are
  handed to each stream's rows in version order by sorting both lists by stream and pairing them
  by position. Grouping and sorting cost the batch at any estimate; a join of two sets the planner
  believes are tiny was planned as every row against every row.
- **The update reaches each row by its key**, with hash and merge joins switched off for that
  statement alone.

{verified: CommitSequenceStreamOrderSqlTests.Stamp_ABacklogTheStatisticsDoNotKnow_IsReadOnceThroughTheInsertXidIndexAsync}
{verified: CommitSequenceStreamOrderSqlTests.Stamp_ABacklogTheStatisticsDoNotKnow_NeverComparesTheBatchWithItselfAsync}

None of this changes the order: the fence, which rows a call takes, insertion order across a batch,
version order within a stream, and rows held by another session are exactly as described above.
{verified: CommitSequenceStreamOrderSqlTests.Stamp_ABacklogTheStatisticsDoNotKnow_DrainsInInsertionOrderBehindTheFenceAsync}

:::updated
The stamp was one statement of chained steps. On a backlog its statistics did not know, the planner
joined the batch's intermediate sets by nested loop, so a call of 1,000 rows compared about a million
pairs, twice, and cost the square of its size: 0.4 to 1.2 s a call once the plan was generic, where
the rewritten stamp takes 0.03 to 0.2 s on the same backlog.
:::

## The stamp is the only update an event row takes {#one-update-per-event}

The event store is append-only apart from the stamp. The emit chains insert each event with
`ON CONFLICT DO NOTHING` and never update it, and a stamp sets `commit_sequence` once, only on rows
where it is still empty, so every event row is updated exactly once after it is inserted. Startup
reclassification of a type that became ephemeral sets a flag once per affected event and skips
rows already flagged, so a later boot rewrites nothing.
{verified: EventStoreUpdateChurnSqlTests.Stamp_EventsWrittenThroughTheEmitChain_AreEachUpdatedExactlyOnceAsync}
{verified: EventStoreUpdateChurnSqlTests.Reclassify_RunTwice_RewritesNoRowTheFirstRunAlreadyFlaggedAsync}

The stamp is never a heap-only (HOT) update. Postgres can skip writing index entries for an update
only when no column any index references changes, and `commit_sequence` is referenced by six
indexes on `wh_event_store`: it is the key of the committed-order index, the predicate of the four
partial indexes the stamp uses to find unstamped rows, and an included column of the ephemeral reap
index. Each stamp therefore adds one entry to every index that covers the row. A `fillfactor` does
not change that, because free space on the page matters only to an update that could be HOT.
{verified: EventStoreUpdateChurnSqlTests.Stamp_InsideATransactionThatCommits_IsOneNonHotUpdatePerEventAsync}

**Reading `pg_stat_user_tables`.** Expect `n_tup_upd` close to `n_tup_ins` and `n_tup_hot_upd` close
to zero for `wh_event_store`. A ratio well above one update per insert does not mean a second writer:
`n_tup_upd` also counts updates made by transactions that rolled back, and a stamp that is canceled
leaves its rows unstamped, so the next call updates them again. A stamp canceled after it had
written its batch counts that batch once per attempt, and leaves dead row versions and index entries
behind until vacuum; this is why the batch [backs off on a timeout](#batch-size) instead of retrying
the same size. One-time backfills run by migrations count once per row they touched.

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
