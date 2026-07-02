---
title: Instance Liveness — Advisory Lock + Heartbeat Fallback
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
  - src/Whizbang.Core/Workers/IInstanceAliveLockSource.cs
  - src/Whizbang.Core/Workers/HeartbeatWorker.cs
---

# Instance liveness — advisory lock + heartbeat fallback

Whizbang has two independent signals for "this instance is alive," wired in slice 7b. Operators reading this page need to understand both signals because the slow heartbeat cadence is only safe when the lock signal is healthy.

## Two signals

| Signal | Source | Latency | When used |
|---|---|---|---|
| **Advisory lock** (primary) | Session-level lock claimed by `PgSharedNotifyConnection` on its direct (non-pgbouncer) LISTEN conn at open. Released by PostgreSQL when the session ends — TCP close, pod death, network reset. | Sub-second (TCP keepalive timeout, typically 10–30 s) | Available when the direct conn is wired. |
| **Heartbeat table** (fallback) | `wh_service_instances.last_heartbeat_at` updated by `HeartbeatWorker` on its cadence. Stale rows removed by `cleanup_stale_instances` after `p_stale_cutoff`. | 30 s (heartbeat cadence × 6 + cutoff buffer) | Always available — the table write is the universal fallback. |

The new SQL function `is_instance_alive(instance_id, threshold_seconds)` returns TRUE if EITHER signal indicates alive:

```sql
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

## Migration touch points

| Migration | What changed |
|---|---|
| **055** (new) | `claim_instance_alive_lock(uuid) → bool` and `is_instance_alive(uuid, threshold) → bool` |
| **011** (modified) | `cleanup_stale_instances` skip-while-locked clause added |

## Operator notes

- The lock acquisition is non-fatal: if it returns `false` (duplicate-startup race) or throws (migration 055 not yet applied), the heartbeat-table fallback continues to work.
- `IsAliveLockHeld` is observable on `IInstanceAliveLockSource` (implemented by `PgSharedNotifyConnection`). The HeartbeatWorker reads it every tick — no eventing/cache invalidation needed.
- DI: HeartbeatWorker takes `IInstanceAliveLockSource?` as an optional ctor param. When not registered, the worker behaves bit-for-bit like pre-v0.681.

## Verification

```sql
-- Inspect held alive-locks (one row per active instance)
SELECT * FROM pg_locks
WHERE locktype = 'advisory'
  AND classid + objid <> 0;
```

After deploy + restart, the heartbeat UPDATE call count in `pg_stat_statements` should drop ~5×–12× (depending on how long pods stay alive holding the lock). `pg_stat_database.xact_commit` for the same DB should drop proportionally.

## Related

- [Pinned connection pool](./pinned-connection-pool.md) — also uses direct conn(s); future work may add a per-pinned-conn lock for redundancy.
- [Worker classification](./worker-classification.md) — HeartbeatWorker is classified `E` (timed) with an adaptive twist.
