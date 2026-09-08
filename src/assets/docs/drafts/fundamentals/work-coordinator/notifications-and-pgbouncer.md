---
title: Notifications and pgbouncer
order: 5
description: >-
  How LISTEN/NOTIFY wakes idle workers through one shared direct connection per
  pod, the signaling gate, the doorbell debounce, why doorbells queue inside the
  hot transaction and ring in their own commit, and how to operate it.
tags: 'work-coordinator, notifications, listen-notify, pgbouncer, doorbell, debounce'
codeReferences:
  - src/Whizbang.Data.Postgres/Notifications/PgSharedNotifyConnection.cs
  - src/Whizbang.Data.Postgres/DoorbellRinger.cs
  - src/Whizbang.Data.Postgres/Migrations/143_NotifyStateNeverWaits.sql
  - src/Whizbang.Data.Postgres/Migrations/146_DoorbellsRingAfterCommit.sql
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/DoorbellsRingAfterCommitSqlTests.cs
---

# Notifications and pgbouncer

Whizbang's work coordinator uses postgres `NOTIFY` / `LISTEN` to wake idle workers immediately when new work appears, dropping idle SQL traffic toward zero. This page explains how the shared-connection design works, why it's necessary with pgbouncer, how the signaling gate decides whether to use NOTIFY at all, and how to operate the system.

## The problem with pgbouncer + LISTEN

PostgreSQL's `LISTEN` registration is **session-scoped**: a session declares "I want notifications on channel X" and the server delivers them on that session. pgbouncer in transaction-pooling mode (the most common Azure / RDS setup) returns a connection to the pool after each transaction, breaking session affinity. So `LISTEN wh_work` issued through pgbouncer in transaction mode loses its registration almost immediately — the next time pgbouncer hands the same client a different backend connection, the LISTEN is gone.

## Solution: one shared direct connection per pod

Each pod opens **exactly one** direct connection (bypasses pgbouncer) and multiplexes every per-channel subscription onto it. Everything else — claim, commit, flush, heartbeat — goes through pgbouncer normally.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          POD (per service replica)                      │
│                                                                         │
│   ┌────────────────────────────┐   ┌─────────────────────────────────┐  │
│   │  Whizbang workers          │   │  PgSharedNotifyConnection       │  │
│   │  (claim/flush/heartbeat)   │   │   • implements                  │  │
│   │                            │   │     INotifySignalingGate        │  │
│   │  uses Npgsql connection    │   │     (IsAvailable killswitch)    │  │
│   │  pool                      │   │   • implements                  │  │
│   └────────────┬───────────────┘   │     ISharedNotifyConnection     │  │
│                │                   │     (subscription registry)     │  │
│                │                   │   • runs self-test probe        │  │
│                │                   │   • dispatches to subscribers   │  │
│                │                   │     by channel name             │  │
│                │                   │                                 │  │
│                │                   │  uses ONE Npgsql connection     │  │
│                │                   │  ┌───────────────────────────┐  │  │
│                │                   │  │ Subscribers:              │  │  │
│                │                   │  │   PgWorkNotificationListener  │
│                │                   │  │   PgCommitOrderStamperWorker  │
│                │                   │  │   PgAppSignalChannel      │  │  │
│                │                   │  └───────────────────────────┘  │  │
│                │                   └─────────────────┬───────────────┘  │
│                │                                     │                  │
└────────────────┼─────────────────────────────────────┼──────────────────┘
                 │                                     │
           via pgbouncer (port 6432)             direct (port 5432)
                 │                                     │
                 ▼                                     ▼
           ┌──────────────────────────────────────────────────┐
           │                  PostgreSQL                      │
           └──────────────────────────────────────────────────┘
```

**Total bypass-pool connections per pod: 1.** Multiple subscribers (work signals, commit-order stamping, app signals, future channels) all share that single direct conn. Pre-slice-33 design opened one direct connection per listener type (3 per pod). With horizontal scaling — many pods × many services × many environments — that adds up fast on the Postgres `max_connections` budget.

## The signaling gate

`INotifySignalingGate` is the **single source of truth** for "is NOTIFY actually working in this process right now?". Every consumer that depends on NOTIFY consults the gate instead of making its own decision.

```csharp
public interface INotifySignalingGate {
  bool IsAvailable { get; }
  DateTimeOffset? LastVerifiedAt { get; }
  DateTimeOffset? LastFailureAt { get; }
  string? LastFailureReason { get; }
  event Action<bool>? OnAvailabilityChanged;
  Task<bool> ProbeNowAsync(CancellationToken cancellationToken = default);
}
```

`IsAvailable = true` only when the most recent **self-test probe** round-tripped successfully AND the shared connection is currently usable. The probe catches configurations that "is the connection string set?" would miss — pgbouncer in transaction-pooling mode, broken producer-side `pg_notify` SQL functions, firewall rules that allow SQL but drop NOTIFY traffic, etc.

### Probe mechanics

On startup (and periodically thereafter via `PeriodicReprobeInterval`, default 5 min, while unavailable):

1. Open the shared direct connection.
2. `LISTEN` on `wh_selftest_{instanceId}_{nonce}` (single-use channel, fresh UUIDv7 nonce per probe).
3. Open a second ephemeral connection. `SELECT pg_notify('wh_selftest_{instanceId}_{nonce}', 'ping')`. Close it. This second connection exists because Postgres's LISTENing backend doesn't observe its own pre-commit `NOTIFY` on the same backend.
4. Wait up to `SelfTestTimeout` (default 2 s) for the notification to arrive on the shared connection.
5. On success → `IsAvailable = true`, drop the self-test channel.
6. On timeout → `IsAvailable = false`, schedule the next periodic re-probe.

`ProbeNowAsync()` is the ops escape hatch — forces an immediate re-probe without waiting for the periodic schedule.

## How signals flow

1. Some service commits new work via `commit_handler_result`. Inside the SQL function:
   ```sql
   IF v_outbox_inserted_count > 0 THEN PERFORM pg_notify('wh_work_i_{owner}', 'outbox'); END IF;
   IF v_inbox_inserted_count > 0  THEN PERFORM pg_notify('wh_work_i_{owner}', 'inbox');  END IF;
   ```
2. Postgres queues notifications. **Dedup at COMMIT**: 10 000 inserts that all `pg_notify('wh_work_i_{owner}', 'outbox')` collapse to **one** delivered notification per `(channel, payload)` tuple — postgres handles this automatically.
3. On COMMIT, the owning instance's `PgSharedNotifyConnection` is in `WaitAsync` on its direct connection. The notification fires its handler. The handler looks up the channel name in the subscription registry and invokes each subscriber's `OnNotification(payload)` callback synchronously.
4. `PgWorkNotificationListener` (a thin subscriber) parses the payload and fires `OnSignal(WorkSignalCategory.Outbox)`.
5. `ClaimWorker` is subscribed to `OnSignal`; it calls `RequestImmediatePoll()` which releases the wake semaphore.
6. The claim worker's loop returns from its sleep early and immediately polls `claim_work`.

End-to-end latency from "transport delivers a message" to "another service starts handling it" is now governed by network + listener-connection wait + `claim_work` execution — measured in tens of milliseconds even at idle.

:::updated
**Updated (migration 146)**: the `PERFORM pg_notify(...)` shown in step 1 is now `PERFORM _queue_doorbell(...)`. The hot transaction queues the doorbell and commits; the driver rings the queue in its own autocommit statement immediately afterwards. Channels, payloads and delivery are unchanged. See [Doorbells ring after commit](#doorbells-ring-after-commit).
:::

### Doorbell debounce: the key and the payload

Every emission goes through `_notify_debounced(instance, kind, payload, window)`. The **kind** keys the per-instance debounce state in `wh_notify_state` (`claim_work` stamps a found-work watermark per kind; a store toward a live instance whose watermark for that kind is fresh is suppressed, because the drainer is awake and its linger poll will find the work). The **payload** is what `pg_notify` carries when the doorbell fires. For a doorbell the two are the same word, so the store procs call the doorbell form, `notify_instance_owners(payload, stream_ids)`, which accepts only `outbox`, `inbox`, `perspective` and `schedule` and rejects anything else up front. Signals carry their wire name (by default a fully qualified type name) as both, through `notify_instance_owners_with_payload(kind, payload, stream_ids)`; the key column is unbounded text. {verified: NotifyKindAndPayloadSqlTests.NotifyInstanceOwners_KindAndPayloadAreIndependent_PayloadReachesTheWire_KindKeysTheStateAsync, NotifyKindAndPayloadSqlTests.NotifyState_KeyColumnIsUnboundedTextAsync, NotifyKindAndPayloadSqlTests.NotifyInstanceOwners_DoorbellForm_PayloadIsTheKindAsync}

### Doorbell probes never wait on a held row

The stores ring the empty-to-non-empty edge: before inserting, `store_inbox_messages` and `store_outbox_messages` probe whether the stream's queue is empty. The probe is a locking read (`FOR SHARE`) so a store racing the completion of the stream's last pending row re-reads after the completion commits instead of missing the edge, and it is `SKIP LOCKED`: a pending row that is locked is a row being completed, so treating the queue as empty and ringing is the safe side of the race (the drain's refetch-until-empty loop absorbs a spurious doorbell). Without `SKIP LOCKED`, a commit batch holding fifty rows for seconds, hundreds of receivers probing the same hot streams, and the claim tick stamping its watermark inside the lease transaction took the same rows in three lock orders: nearly every session waited in the inbox store, commits took seconds, and deadlocks (`40P01`) resolved the rest. The claim tick's watermark stamp likewise skips rows another session holds (it is a freshness hint the next tick re-stamps), and the perspective claim leases under `FOR UPDATE SKIP LOCKED` like the inbox and outbox claims. {verified: DoorbellProbeLockFreeSqlTests.InboxStore_WhileTheStreamsLastPendingRowIsBeingCompleted_DoesNotWaitAsync, DoorbellProbeLockFreeSqlTests.OutboxStore_WhileTheStreamsLastPendingRowIsBeingCompleted_DoesNotWaitAsync, DoorbellProbeLockFreeSqlTests.ClaimTick_WhileItsNotifyStateRowsAreHeld_DoesNotWaitAsync, DoorbellProbeLockFreeSqlTests.ClaimTick_WhileAPendingPerspectiveRowIsBeingCompleted_DoesNotWaitAsync}

### The debounce state row never waits either
{verified: NotifyStateLockFreeSqlTests.Doorbell_WhileAnotherTransactionHoldsTheTargetsNotifyState_DoesNotWaitAndStillRingsAsync, NotifyStateLockFreeSqlTests.Doorbell_WhileAnotherTransactionIsCreatingTheTargetsNotifyState_DoesNotWaitAndStillRingsAsync, NotifyStateLockFreeSqlTests.Doorbell_WhenTheStateRowIsFree_StillSuppressesAFloodTowardADrainingTargetAsync}

Every doorbell goes through `_notify_debounced`, which decides suppress-or-fire for one target instance and records the decision on that instance's `wh_notify_state` row: the watermark slide and the suppressed counter on the suppress branch, the attempt stamp and the fired counter on the fire branch. Both writes run inside the caller's transaction, so the row lock is held until the caller commits. The callers are the hot paths: the inbox and outbox stores and the handler commits all ring the owners of the streams they touched. Before migration 143, every store and handler commit toward one instance serialized on that instance's row for the duration of whichever transaction held it first. A handler-commit batch toward a busy instance holds its transaction for seconds under a bulk ingest, and every store toward the same instance that arrived during it queued on that one row. The stores are the receive path, so the transport's receivers stalled, the inbox lease pool filled with rows nobody completed, and the receiving service's progress froze and jumped. The lock graph showed the chain in the open: a dozen store calls waiting behind one handler commit, itself behind another, and the only ungranted tuple lock in the database on `wh_notify_state`. The probe and claim fixes above had removed the `FOR SHARE` deadlocks that were hiding this one.

Migration 143 states the rule: **a doorbell never waits on another writer's transaction.** The state row is taken `FOR UPDATE SKIP LOCKED`, and what happens next depends on why the row was or was not obtained:

- **Owned.** The suppress-or-fire logic and the counter writes run against the row exactly as before. Nothing waits on the holder except the next writer, who skips.
- **Held by another writer.** That writer is ringing or sliding this target right now, so the doorbell fires without touching the state and returns. Suppression is decided only on the owned path, so the debounce contract holds whenever the row is free and degrades to "ring" under contention instead of "wait".
- **Absent.** The row is created under a transaction-scoped advisory try-lock keyed on the instance and the kind (`pg_try_advisory_xact_lock`), one creator at a time. A creator that loses the try-lock, or whose insert finds the row already committed by someone else, rings and returns rather than queueing behind the winner's transaction.
- **The hygiene delete** on the fire path (rows for instances with no activity for seven days) takes its rows `FOR UPDATE SKIP LOCKED` for the same reason. A row someone holds is, by definition, not long-departed.

The asymmetry behind every branch: a spurious doorbell is absorbed by the drain's refetch-until-empty loop, a lost wakeup is not, and waiting is the storm. So every contended case rings.

**Residual.** An `INSERT ... ON CONFLICT DO NOTHING` waits when a concurrent transaction holds an uncommitted insert of the same key. Debounce creators are serialized by the advisory lock, so they never meet that way. The only other creator is `claim_work`'s watermark stamp, so the wait is bounded by one claim tick and happens at most once per `(instance, kind)` row lifetime.

## Doorbells ring after commit
{verified: DoorbellsRingAfterCommitSqlTests.Doorbell_InsideAHotTransaction_QueuesInsteadOfNotifyingAsync, DoorbellsRingAfterCommitSqlTests.HotStore_DoesNotTakeTheNotifySerializationLockAsync, DoorbellsRingAfterCommitSqlTests.RingDoorbells_DeliversQueuedRingsAndCoalescesDuplicatesAsync, DoorbellsRingAfterCommitSqlTests.RingDoorbells_TwoRingersDoNotDoubleRingOrBlockEachOtherAsync}

Migration 143 removed the row lock on `wh_notify_state`. Underneath it was a lock that belongs to PostgreSQL itself. **Every transaction that has issued `NOTIFY` serializes its commit with every other notifying transaction**: at pre-commit the backend takes an `AccessExclusiveLock` on the database object (`pg_locks`: `locktype = object`, `classid = pg_database`, `objid = 0`) and holds it until the transaction commits, so that notification queue entries appear in commit order. Every hot path here rang a doorbell inside its own transaction (the stores, the handler commits, the perspective completions, the commit-sequence stamp, the claim), so under load every notifying commit queued behind the longest one: a handler-commit batch that took seconds to commit held every store and completion toward any instance behind it, and a bulk ingest's progress froze for the length of each batch.

**The rule since migration 146: the hot transaction never calls `pg_notify`.**

1. Where a hot function used to ring, it calls `_queue_doorbell(channel, payload)`: a plain `INSERT` into the **unlogged** table `wh_doorbell_queue`, taking no lock the caller does not already hold and never the NOTIFY lock. The debounce decision and its bookkeeping (migrations 137, 141, 143) are unchanged; only the final ring moves. `_notify_debounced`, both `_emit_event_store_chain` variants (the `wh_committed` doorbell for the commit-order stamper) and the dead-letter-ready trigger all queue instead of notifying.
2. After the hot statement's transaction has committed, the driver runs `ring_doorbells(p_max DEFAULT 1000)` as its **own autocommit statement** on the connection the hot call just used. It deletes up to `p_max` queued rows `FOR UPDATE SKIP LOCKED`, coalesces identical `(channel, payload)` pairs with `DISTINCT`, issues one `pg_notify` per distinct pair, and returns how many it sent. That transaction holds the NOTIFY lock for the microseconds it takes to commit a few notifies, not for the length of a batch.

```mermaid{caption="Doorbells ring after commit: the hot transaction queues a row in the unlogged wh_doorbell_queue and commits without touching the NOTIFY serialization lock; the driver then rings the queue in a separate tiny autocommit statement that coalesces duplicate (channel, payload) pairs." tests=["DoorbellsRingAfterCommitSqlTests.Doorbell_InsideAHotTransaction_QueuesInsteadOfNotifyingAsync", "DoorbellsRingAfterCommitSqlTests.HotStore_DoesNotTakeTheNotifySerializationLockAsync", "DoorbellsRingAfterCommitSqlTests.RingDoorbells_DeliversQueuedRingsAndCoalescesDuplicatesAsync"]}
sequenceDiagram
    autonumber
    participant D as Driver (EF Core or Dapper coordinator)
    participant H as Hot function (store, commit, completion, claim)
    participant Q as wh_doorbell_queue (UNLOGGED)
    participant R as ring_doorbells()
    participant L as LISTEN-ing instances
    D->>H: BEGIN; store_inbox_messages(...)
    H->>Q: _queue_doorbell('wh_work_i_<owner>', 'inbox')  (plain INSERT)
    H-->>D: COMMIT (NOTIFY lock never taken)
    D->>R: SELECT ring_doorbells()  (autocommit)
    R->>Q: DELETE ... FOR UPDATE SKIP LOCKED, DISTINCT (channel, payload)
    R->>L: pg_notify per distinct pair
    R-->>D: number of notifications sent
```

`DoorbellRinger.RingAsync(connection, qualifiedFunctionName, logger, cancellationToken)` is the one helper every driver uses, placed immediately after every hot call: the inbox and outbox stores, the handler commits, the perspective completions, the schedule claim and the schedule manager's writes, the commit-order stamper, the signal transport. Three properties are worth knowing:

- **A ring never fails the caller.** The work the doorbell points at is already committed. A ring that does not happen costs latency until the next ring from any instance or the claim poll, so a failure is logged at Warning naming the function and swallowed (the call returns -1). Cancellation at shutdown is treated the same way: the queued doorbells are rung by the next ring from any instance.
- **Any instance may ring what any other queued**, and two ringers never wait on each other (`SKIP LOCKED`). A ring left in the queue by a driver that died between its commit and its ring is picked up by the next ring from anywhere.
- **The ring is bounded**: a five-second command timeout on a statement that touches a handful of rows in an unlogged table.

**Ambient transactions.** When a store runs inside an ambient transaction (an EF Core `Database.CurrentTransaction` is open, for example a handler commit writing through the same DbContext), the queued rows commit with that transaction and would not be visible to a ring issued before it. The drivers skip the ring in that case rather than ring nothing, and **the next hot call on the connection rings them** along with its own. Latency inside that window is bounded by the next hot call or the claim poll; nothing is lost.

Three properties carry over from the previous design: a doorbell queued by a transaction that **rolls back** is rolled back with it, so there is no spurious ring for work that never committed; the claim poll remains the safety net beneath all of it; and the queue is **unlogged on purpose**, because a crash loses only a doorbell, never the work it pointed at. `cleanup_stale_instances` still notifies directly: it runs on the maintenance path, never inside a hot transaction, and its eviction broadcast is rare by nature.

Also in migration 146: `store_inbox_messages` treats an all-zero `source_service_id` on an inbound envelope as unknown, so the existing fallback to the receiving service's own id applies; see [Source service id on published envelopes](/v1.0.0/fundamentals/dispatcher/message-cascade#source-service-id).

## Health monitoring + auto-fallback

When the shared connection fails:
- The gate flips `IsAvailable = false`. `OnAvailabilityChanged` fires; subscribers (notably `ClaimWorker`) react.
- Reconnect with exponential backoff (1 s → 2 s → 4 s → ... → 30 s cap).
- After `FailuresBeforeFallback` consecutive failures (default 5), the backoff stretches to `PeriodicReprobeInterval` (default 5 min) — stops hammering a broken connection while still re-probing periodically so the system heals when the underlying problem is fixed out-of-band.
- When the connection comes back AND the probe succeeds: `OnAvailabilityChanged(true)` fires; `ClaimWorker.RequestImmediatePoll()` runs so any work that accumulated during the unavailable window doesn't wait out the next adaptive-backoff tick.

`ClaimWorker`'s adaptive polling cadence reacts to the gate:
- When gate `IsAvailable = true`: empty-poll streaks let the wait grow up to `PollingMaxIntervalMilliseconds` (10 s default). The NOTIFY wakes the worker when work arrives, so longer waits are fine.
- When gate `IsAvailable = false`: the adaptive backoff is clamped to `PollingIntervalMilliseconds` (250 ms default). NOTIFY won't wake us, so we MUST keep polling tight.

Polling stays first-class. Notifications are an accelerator; correctness never depends on them.

## Configuration

Each service has two connection strings:

```json
{
  "ConnectionStrings": {
    "appservice-db":         "Host=postgres-pgbouncer:6432;Database=appservice-db;...",
    "appservice-db-direct":  "Host=postgres-primary:5432;Database=appservice-db;..."
  }
}
```

The `-direct` suffix is convention. Same DB, different port, no pooler.

When `<dbname>-direct` is unset, the gate reports `IsAvailable = false` and the system runs polling-only. The system stays correct — polling fallback at the configured base interval (250 ms default) catches any work that would otherwise be discovered by NOTIFY.

### `WhizbangNotificationOptions`

Bound from the `Whizbang:Database` section in `IConfiguration`:

| Option | Default | Description |
|---|---|---|
| `SignalingMode` | `Auto` | `Auto` falls back to polling if no connection string; `ListenNotify` throws at startup if missing (fail-fast); `Polling` forces polling-only. |
| `ConnectionStringKey` | (unset) | `IConfiguration` key whose value is the pooled connection string. Resolver looks up `{Key}-direct` first, then `{Key}` as fallback. |
| `DirectConnectionString` | (unset) | Explicit direct connection string. Bypasses key-based lookup. |
| `DisableNotifications` | `false` | Killswitch — legacy synonym for `SignalingMode.Polling`. |
| `SelfTestTimeout` | `2 s` | Probe round-trip timeout. |
| `PeriodicReprobeInterval` | `5 min` | Re-probe cadence while unavailable. |
| `FailuresBeforeFallback` | `5` | Consecutive reconnect failures before reconnect backoff stretches to `PeriodicReprobeInterval`. |
| `ListenKeepaliveInterval` | `30 s` | Cadence of `SELECT 1` keepalive on the listener connection. |
| `ListenReconnectInitialDelay` | `1 s` | First reconnect attempt delay after a disconnect. |
| `ListenReconnectMaxDelay` | `30 s` | Cap on reconnect backoff. |
| `ListenReconnectBackoffMultiplier` | `2.0` | Exponential growth factor for reconnect backoff. |

## Operating modes

| Config | Mode |
|---|---|
| `SignalingMode = Auto`, no connection string | **Polling-only**. Gate reports unavailable. `ClaimWorker` polls at base cadence. |
| `SignalingMode = Auto`, direct string + probe succeeds | **Notify + adaptive polling fallback**. Best mode — sub-100 ms work latency. |
| `SignalingMode = Auto`, direct string + probe fails | **Polling-only**. Gate flips back to available on the next periodic re-probe success. |
| `SignalingMode = ListenNotify`, no direct string | **Throws at startup** — fail-fast for environments that expect NOTIFY. |
| `SignalingMode = Polling`, any config | **Forced polling** (kill switch for ops). |

## App signals

Whizbang exposes the same NOTIFY infrastructure to application code via `IAppSignalChannel`. App topics share the per-pod shared connection just like internal channels:

- App channels are named `wh_app_<topic>`.
- Topic validation rejects the `wh_` prefix in user input — app code cannot publish to or subscribe to internal categories.
- `Subscribe(topic, handler)` registers an `INotifySubscription` on the shared connection (one per topic, lazily); multiple handlers on the same topic share the underlying `LISTEN` and fan out in memory.

See [App signals](app-signals.md) for usage.

## Operations

### Forcing a re-probe after fixing a misconfig

Ops scenario: the direct connection string was misconfigured; the gate reported unavailable; ops corrected the config but the next periodic re-probe is up to 5 min away. To trigger an immediate re-test:

```csharp
// Inside an ops endpoint or admin shell:
var gate = serviceProvider.GetRequiredService<INotifySignalingGate>();
var nowHealthy = await gate.ProbeNowAsync();
```

`ProbeNowAsync` is independent of the BackgroundService loop. It opens a fresh connection, runs a probe, and updates `IsAvailable` based on the result. The next `ClaimWorker` tick reacts to the new availability state immediately.

### Diagnosing "why is the gate reporting unavailable?"

`INotifySignalingGate` surfaces three diagnostic properties:
- `LastVerifiedAt` — UTC timestamp of the most recent successful probe (null if never).
- `LastFailureAt` — UTC timestamp of the most recent failure.
- `LastFailureReason` — human-readable error (timeout, exception message, "no connection string resolvable", etc.).

Log them on an ops endpoint:

```csharp
return Ok(new {
  IsAvailable = gate.IsAvailable,
  LastVerifiedAt = gate.LastVerifiedAt,
  LastFailureAt = gate.LastFailureAt,
  LastFailureReason = gate.LastFailureReason
});
```

### Verifying connection-count budget in production

```sql
-- Distinct backend sessions LISTENing on Whizbang channels for this database.
-- After slice 33 there should be ~1 per pod (transient +1 during a probe).
SELECT count(DISTINCT pid)
FROM pg_stat_activity
WHERE datname = current_database()
  AND state IS NOT NULL
  AND (query LIKE '%LISTEN%"wh_work_i_%'
    OR query LIKE '%LISTEN%"wh_committed"%'
    OR query LIKE '%LISTEN%"wh_app_%');
```

## When you don't have pgbouncer

If your deployment doesn't use pgbouncer (or runs it in session-pooling mode), the dual-connection design still works but is simpler — you can use the same connection string for both pooled and direct, or skip the direct string entirely (LISTEN survives session pooling).

For a local Aspire setup, there's no pgbouncer; the pooled connection is direct and notifications work without a separate `-direct` string.

## Sizing math

For 50 pods × 11 services in production (illustrative numbers — scale to your own deployment):

- **Direct connections to postgres (slice 33+)**: 50 × 11 = 550 (one shared LISTEN per pod per service, regardless of how many subscribers — work signals, commit-order stamping, app signals, etc.).
- **Pre-slice-33 baseline**: 50 × 11 × 3 = 1 650 (three listeners per pod). Slice 33 cuts the direct-conn budget by ~67%.
- **Pooled connections to pgbouncer**: 50 × 11 × `Maximum Pool Size` (50 default) = 27 500 client positions, oversubscribed onto ~25–50 pgbouncer backend connections per service DB = ~275–550 backend pool connections total.
- **Total backend connections per service DB**: ~30–55 backend pool + 50 direct = ~80–105.
- `max_connections = 1000+` per service DB is plenty.

## Related

- [Configuration reference](configuration-reference.md)
- [Failure and recovery](failure-and-recovery.md)
- [App signals](app-signals.md)
- [Contributor: implementing notifications](../../contributing/data-engines/implementing-notifications.md)

## When the doorbell rings: the empty→non-empty edge

A store-level NOTIFY fires exactly when a store call creates a stream's **first pending row** — the moment its queue transitions from empty to non-empty, judged per category (`outbox`, `inbox`, `perspective`) by the **same eligibility predicate the drain fetch uses**. Rows that pile up behind already-pending work are silent: a wake is already owed, and the drain loop's refetch will carry them. A stream whose queue drained to empty **re-arms the edge**, so the next store — seconds or weeks later — rings again.

```mermaid {caption="The doorbell fires on the queue's empty→non-empty transition; pile-ups are silent; draining to empty re-arms the edge" tests=["NotifyAfterStoreSqlTests.StoreInboxMessages_DrainedStreamThenStore_FiresNotifyAsync","NotifyAfterStoreSqlTests.StoreInboxMessages_SecondCallSameStream_DoesNotFireNotifyAsync","NotifyAfterStoreSqlTests.StoreInboxMessages_NewStream_FiresInboxNotifyToCallerAsync"]}
stateDiagram-v2
    direction LR
    Empty : Stream queue EMPTY<br/>(no drainable rows)
    Busy : Stream queue NON-EMPTY<br/>(work pending / drain in flight)

    Empty --> Busy : store inserts first pending row<br/>🔔 NOTIFY owner
    Busy --> Busy : store inserts more rows<br/>(silent — wake already owed)
    Busy --> Empty : drain fetches until an<br/>EMPTY fetch, then parks
```

This one rule serves both workload extremes with **zero configuration**:

- **Bulk throughput** — a burst of events per stream rings once (the first row), then piles silently behind the backlog. A 17k-event import across 350 streams emits ~350 notifies, not 17k.
- **Interactive latency** — a conversational stream drains to empty between hops, so every hop is a fresh edge: the owner wakes in milliseconds instead of waiting for the safety-net poll.

| Moment | Queue just before the store | Doorbell |
|---|---|---|
| First message of a new session | empty (stream doesn't exist yet) | 🔔 rings |
| Reply seconds later (previous hop drained) | empty | 🔔 rings |
| Message after 45 minutes — or a week — idle | empty | 🔔 rings |
| Burst while the consumer is mid-drain | non-empty | silent |

Three details make the rule exact rather than approximate:

1. **The probe mirrors the drain fetch.** "Pending" means *drainable now*: `processed_at IS NULL` (outbox also `published_at IS NULL`) and schedule-eligible. A retry parked with a future `scheduled_for` is invisible to the drain, so it is invisible to the probe — it can never absorb another store's doorbell.
2. **The probe is a locking read (`FOR SHARE`).** A plain read racing a concurrent completion of the stream's last pending row could see the stale "still pending" version and stay silent while the drain's final refetch predates the store's commit — a lost wakeup. The locking read serializes against the completion `UPDATE`: whichever side commits second sees the other, so exactly one wake mechanism always fires.
3. **The `perspective` doorbell is precise.** It rings only when the emit chain actually *created* work items for a previously-empty perspective queue. Event types with no perspective associations create no work — ringing for them would fire on every store, since their queue is permanently empty.

```mermaid {caption="A store into a drained hot stream wakes the pinned owner's claim loop through the real NOTIFY path — the interactive hop never waits on the safety-net poll" tests=["ClaimWorkerNotificationWakeIntegrationTests.ClaimWorker_StoreIntoDrainedHotStream_EdgeDoorbellWakesOwnerAsync","NotifyAfterStoreSqlTests.StoreInboxMessages_CompletionHeldOpenConcurrently_StoreStillWakesOwnerAsync"]}
sequenceDiagram
    autonumber
    participant P as Producer (any instance)
    participant DB as store_inbox_messages
    participant O as Pinned owner's ClaimWorker

    Note over O: idle — stream drained, poll relaxed
    P->>DB: store (stream's queue is EMPTY)
    DB->>O: 🔔 NOTIFY wh_work_i_&lt;owner&gt; (empty→non-empty edge)
    O->>DB: claim_work + drain immediately
    Note over P,O: hop latency: milliseconds, not the poll interval
```

Routing is unchanged by the edge rule: `notify_instance_owners` still targets the pinned owner's channel (Step 1) or the deterministic partition target for unpinned streams (Step 2). Any instance may produce into any stream — the queue lives in the shared database, so emptiness is a global per-stream fact, and several concurrent producers still collapse to one doorbell while work is pending. The safety-net poll remains as the crash/orphan backstop (a stranded row from a dead worker suppresses the doorbell precisely because a wake is owed to work that lease-expiry will re-offer), never as the interactive latency path.

## Doorbell debounce and drain linger

Under fan-out load, one `pg_notify` per stored message is almost entirely redundant — the
target instance is already awake and draining. The debounce collapses it to **one doorbell
per idle-to-busy edge per payload kind**, with two cooperating halves and one invariant:

- **SQL half** (`wh_notify_state` + the `notify_debounce_seconds` setting in `wh_settings`,
  default **7**, live-tunable): `claim_work` stamps a per-`(instance, payload kind)`
  watermark whenever the instance finds work. While a target's same-kind watermark is
  fresher than the window, a notify toward it is suppressed and the watermark slides — the
  suppressed store is work the linger poll will find. Firing stamps a predicted-awake
  watermark. Suppression never applies toward a non-live instance, and a non-positive
  setting disables the debounce.
- **C# half** (`Whizbang:Workers:Claim:NotifyDrainLingerSeconds`, default **8**): after
  fresh work, empty claim polls run at ~500 ms for the linger window before the
  notify-healthy elevation and adaptive backoff resume. Repeat claims opt out (re-offer
  damping is preserved), and the doorbell-liveness accounting treats a poll-discovered edge
  inside the linger as expected-unnotified.

**The invariant: C# linger > SQL window** (8 > 7). Any suppressed doorbell's work is picked
up by a poll before the drainer slows down — the suppression self-expires first, so there
is no sleep handshake and no stranded message; the safety-net poll remains the correctness
floor for every residual race (a target dying inside the window, topology shifts).
