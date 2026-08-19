---
title: Commit Sequence & the Order Stamper
order: 6
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

## How stamping runs

Every service instance hosts the stamper worker; a `pg_try_advisory_lock` elects one leader per
database. The leader wakes from two sources:

- **`wh_committed` NOTIFY** — the event-store emit chains ring this channel at commit time,
  waking the leader sub-millisecond through the shared LISTEN connection.
- **Backstop tick** — a polling floor for deployments where LISTEN is unavailable, relaxed to a
  slow cadence while the signaling gate reports NOTIFY healthy.

On each wake the leader calls `stamp_pending_commit_sequences`, which assigns `commit_sequence`
values (in `xmin` order, `FOR UPDATE SKIP LOCKED`) to every unstamped row past the ordering
fence.

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

## Configuration

```csharp{title="Commit-order stamper options" description="Stamping cadence knobs — defaults suit almost every deployment" category="Configuration" difficulty="ADVANCED" tags=["WorkCoordinator","Stamper","Postgres"] framework="NET10"}
services.Configure<CommitOrderStamperOptions>(o => {
  o.PollingInterval = TimeSpan.FromMilliseconds(250);   // backstop floor when NOTIFY is unavailable
  o.FencedRetryInterval = TimeSpan.FromMilliseconds(250); // re-stamp cadence while the fence is held
  o.BatchSize = 1000;                                   // rows per stamp call
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
