---
title: Instance Liveness — Advisory Lock + Heartbeat Fallback
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Fundamentals
order: 8
description: >-
  Dual-signal liveness scheme — session-level advisory lock on the direct
  LISTEN conn (primary) plus the heartbeat-table fallback (legacy). Adaptive
  HeartbeatWorker cadence preserves the 30 s recovery guarantee.
tags: 'liveness, heartbeat, advisory-lock, recovery, workers'
codeReferences:
  - src/Whizbang.Data.Postgres/Migrations/055_InstanceAliveAdvisoryLock.sql
  - src/Whizbang.Data.Postgres/Migrations/011_CleanupStaleInstances.sql
  - src/Whizbang.Data.Postgres/Notifications/PgSharedNotifyConnection.cs
  - src/Whizbang.Core/Workers/IInstanceAliveLockSource.cs
  - src/Whizbang.Core/Workers/HeartbeatWorker.cs
testReferences:
  - tests/Whizbang.Core.Tests/Workers/HeartbeatWorkerAdaptiveCadenceTests.cs
---

# Instance liveness — advisory lock + heartbeat fallback

Whizbang has two independent signals for "this instance is alive," wired in slice 7b. Operators reading this page need to understand both signals because the slow heartbeat cadence is only safe when the lock signal is healthy.

## Two signals

| Signal | Source | Latency | When used |
|---|---|---|---|
| **Advisory lock** (primary) | Session-level lock claimed by `PgSharedNotifyConnection` on its direct (non-pgbouncer) LISTEN conn at open. Released by PostgreSQL when the session ends — TCP close, pod death, network reset. | Sub-second (TCP keepalive timeout, typically 10–30 s) | Available when the direct conn is wired. |
| **Heartbeat table** (fallback) | `wh_service_instances.last_heartbeat_at` updated by `HeartbeatWorker` on its cadence. Stale rows removed by `cleanup_stale_instances` after `p_stale_cutoff`. | ~30–60 s (heartbeat cadence 30 s + stale cutoff) | Always available — the table write is the universal fallback. |

The new SQL function `is_instance_alive(instance_id, threshold_seconds)` returns TRUE if EITHER signal indicates alive:

```sql{
title: "Check whether an instance is alive"
description: "Calls the migration-055 is_instance_alive function, which returns TRUE if either the advisory lock or a fresh heartbeat row indicates the instance is still live."
category: "Workers"
difficulty: "INTERMEDIATE"
tags: ["liveness", "advisory-lock", "heartbeat", "postgres", "migration-055"]
}
-- migration 055
SELECT is_instance_alive('11111111-...'::uuid, 30);
```

## Adaptive HeartbeatWorker cadence

`HeartbeatWorkerOptions.LivenessSourceMode` controls the cadence decision:

| Mode | Behaviour |
|---|---|
| `AdvisoryLockWhenAvailable` (default) | Use `SlowIntervalSeconds` (60 s) when the lock is held; fall back to `IntervalSeconds` (30 s) when not. |
| `HeartbeatTableOnly` | Always use `IntervalSeconds`. Legacy / opt-out for environments that don't trust the adaptive behaviour. |

Per-tick resolution means:

- **Reconnect** (lock acquired) → next tick uses slow cadence.
- **Disconnect** (lock released) → next tick reverts to fast cadence.

The 30 s `cleanup_stale_instances` recovery guarantee is preserved in both cases because:

- **Lock-held path**: TCP keepalive detects pod death within 10–30 s. `cleanup_stale_instances` (updated in slice 7b) also skips rows whose advisory lock is still held, so the slow heartbeat write doesn't trip false cleanups.
- **Lock-not-held path**: HeartbeatWorker reverts to fast cadence automatically; `cleanup_stale_instances` 30 s cutoff catches stale rows on schedule.

## Eviction: reaping is a fence, not just a deletion

Reaping alone never stopped anything. `cleanup_stale_instances` deletes the stale row and releases its leases, but `record_heartbeat` was an unguarded upsert — a reaped instance's next heartbeat simply re-inserted the row and it rejoined as though nothing had happened, still believing it owned work the fleet had already redistributed. A pod paused by a long collection, a brief partition, or a throttled node would return and resume against state that had moved on without it.

Migration **106** closes that:

- Every reaped instance is **tombstoned** in `wh_instance_evictions` (instance id, when, why). A tombstone rather than the deletion itself, because deletion is precisely what the returning zombie's heartbeat undoes.
- `record_heartbeat` **consults the tombstone and refuses** — its return type changed `VOID → BOOLEAN`. `true` = registered/renewed; `false` = this instance has been evicted and must not consider itself part of the fleet.
- The refusal travels through the **heartbeat itself** — the same call that used to let the zombie back in is now the one that tells it it may not. No new channel, no dependency on the signal bus, and notice is bounded by one heartbeat interval.
- `HeartbeatWorker` **stops its loop** on a refused heartbeat and logs the eviction at Error. Retrying can never succeed: the tombstone does not expire on the evicted instance's clock.

The fence is per **process**, not per pod: instance ids are generated per process, so a restarted pod draws a fresh id and is unaffected — correct, because a restart means fresh state — while the zombie keeps its id and stays fenced.

Tombstones are bounded: `perform_maintenance` purges rows older than `instance_eviction_retention_hours` (`wh_settings`, default 24). The tombstone only needs to outlive a realistic pause-and-resume window, and since ids are per-process, anything calling with that id after a day is not the process that was reaped.

## Capabilities: won, recorded, and fenced

A **capability** names what an instance may do; an exclusive one — `migrator`, `maintainer` — is a **duty**, held by one instance at a time. Capabilities are *won*, never assigned: an instance attempts the primitive (a session advisory lock on a dedicated direct connection, via `IDutyElector`), and the primitive grants or refuses. That keeps the failure path free — a dead instance's lock releases server-side as its session ends, with no timeout to tune, no split-brain window, and no durable "this one is the migrator" flag to orphan.

Holdings are **recorded but never consulted to decide**: *the lock decides, the row reports.* `wh_instance_capabilities` is keyed `(instance, capability)` with `acquired_at` — "which instance is the migrator right now, and for how long" as a query (and in the startup status surface's fleet section, as a join). It rides the same rails as liveness: reaped instances cascade their holdings, so the record's only staleness window is the heartbeat lease the system already bounds.

The eviction fence reaches acquisition: `record_capability` refuses a tombstoned instance, and the elector releases the lock it just won and stands down — a zombie can win a race but cannot hold a duty. Long-tenure holders fence themselves with `IDutyGrant.VerifyStillHeldAsync`: a grant whose session died (the OOMKill half-open-TCP shape) reports lost before the next unit of exclusive work, because another instance may already hold it.

## Migration touch points

| Migration | What changed |
|---|---|
| **055** (new) | `claim_instance_alive_lock(uuid) → bool` and `is_instance_alive(uuid, threshold) → bool` |
| **011** (modified) | `cleanup_stale_instances` skip-while-locked clause added; a later revision (v0.687) added an optional `p_definitive_dead_cutoff` parameter that bypasses the lock guard when the heartbeat is so old the instance is definitely dead (covers OOMKilled pods whose advisory lock lingers on a half-open TCP session until OS keepalive fires) |
| **106** (new) | `wh_instance_evictions` tombstone table; `cleanup_stale_instances` tombstones what it reaps; `record_heartbeat` returns `BOOLEAN` and refuses evicted instances |
| **107** (modified) | `perform_maintenance` Task 10 purges tombstones past `instance_eviction_retention_hours` (default 24) |

## Operator notes

- The lock acquisition is non-fatal: if it returns `false` (duplicate-startup race) or throws (migration 055 not yet applied), the heartbeat-table fallback continues to work.
- `IsAliveLockHeld` is observable on `IInstanceAliveLockSource` (implemented by `PgSharedNotifyConnection`). The HeartbeatWorker reads it every tick — no eventing/cache invalidation needed.
- DI: HeartbeatWorker takes `IInstanceAliveLockSource?` as an optional ctor param. When not registered, the worker behaves bit-for-bit like pre-v0.681.
- An instance logging `has been evicted … heartbeat refused` is not broken and needs no intervention — it was reaped as stale while paused, its work was redistributed, and it is correctly refusing to rejoin. Restart the pod (a new process gets a new instance id) if it should return to service.

## Verification

```sql{
title: "Inspect held instance alive-locks"
description: "Queries pg_locks for the session-level advisory locks each live instance holds on its direct LISTEN connection, giving one row per active instance."
category: "Workers"
difficulty: "ADVANCED"
tags: ["liveness", "advisory-lock", "pg-locks", "postgres", "verification"]
}
-- Inspect held alive-locks (one row per active instance)
SELECT * FROM pg_locks
WHERE locktype = 'advisory'
  AND classid + objid <> 0;
```

After deploy + restart, the heartbeat UPDATE call count in `pg_stat_statements` should drop ~5×–12× (depending on how long pods stay alive holding the lock). `pg_stat_database.xact_commit` for the same DB should drop proportionally.

## Related

- [Pinned connection pool](./pinned-connection-pool.md) — also uses direct conn(s); future work may add a per-pinned-conn lock for redundancy.
- [Worker classification](./worker-classification.md) — HeartbeatWorker is classified `E` (timed) with an adaptive twist.
