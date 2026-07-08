---
title: Configuration reference
order: 7
---

# Configuration reference

Every option that affects the work coordinator. All bind via standard `IConfiguration` (appsettings.json, env vars, k8s ConfigMap, vault, etc.).

## Connection strings

Whizbang reuses the connection string of your registered DbContext — **no duplicate Whizbang connection key**.

| Key | Required | Purpose | Env var |
|---|---|---|---|
| `ConnectionStrings:<dbname>` | yes (already exists for the DbContext) | Pooled connection. | `ConnectionStrings__<dbname>` |
| `ConnectionStrings:<dbname>-direct` | no | Direct connection (bypasses pgbouncer). LISTEN-only, **1 connection per pod**. If unset → polling-only mode. | `ConnectionStrings__<dbname>-direct` |

Recommended pgbouncer-aware Npgsql connection-string params on the pooled string:
```
Maximum Pool Size=50; Minimum Pool Size=0;
Max Auto Prepare=0; No Reset On Close=true; Server Compatibility Mode=PgBouncer; Pooling=true
```

See [notifications-and-pgbouncer](notifications-and-pgbouncer.md) for sizing math.

## `Whizbang:WorkCoordinator` (claim worker tuning — `ClaimWorkerOptions`)

| Key | Type | Default | Notes |
|---|---|---|---|
| `Whizbang:WorkCoordinator:PollingIntervalMilliseconds` | int | 250 | Base poll cadence. |
| `Whizbang:WorkCoordinator:PollingMaxIntervalMilliseconds` | int | 10000 | Adaptive backoff cap. Auto-clamped to ≤ `AbandonStaleInstanceThresholdSeconds × 1000 / 3` to preserve heartbeat freshness. |
| `Whizbang:WorkCoordinator:MaxStreamsPerBatch` | int | 1000 | Max rows returned per `claim_work` call. |
| `Whizbang:WorkCoordinator:PartitionCount` | int | 10000 | Modulo partition count. |
| `Whizbang:WorkCoordinator:LeaseSeconds` | int | 300 | Lease duration on claimed work. |

## `Whizbang:Heartbeat` (heartbeat worker tuning — `HeartbeatWorkerOptions`)

| Key | Type | Default |
|---|---|---|
| `Whizbang:Heartbeat:IntervalSeconds` | int | 5 |

Cadence must satisfy `IntervalSeconds < AbandonStaleInstanceThresholdSeconds / 3` to keep peers from falsely flagging this instance stale.

## `Whizbang:Flushers` (per-flusher Nagle tuning)

Each flusher has the same option shape: `BatchFlusherOptions { ChannelCapacity, MaxBatchSize, CoalesceWindowMs, ImmediateFlushThreshold }`.

| Flusher | Default tuning |
|---|---|
| `OutboxCompletion` | (10000, 500, 10ms, 250) |
| `PerspectiveCompletion` | (20000, 1000, 25ms, 500) |
| `Failure` | (5000, 100, 100ms, 50) |
| `LeaseRenewal` | (5000, 200, 200ms, 100) |
| `InboxHandler` | (5000, 100, 25ms, 50) |

Override individual values:
```
Whizbang:Flushers:OutboxCompletion:Flusher:CoalesceWindowMs=10
Whizbang:Flushers:OutboxCompletion:Flusher:MaxBatchSize=500
```

`LeaseRenewal` also has `LeaseSeconds` (default 300).

## `Whizbang:Notifications` (`WhizbangNotificationOptions`)

| Key | Type | Default | Notes |
|---|---|---|---|
| `Whizbang:Notifications:DisableNotifications` | bool | false | Kill switch; forces polling-only. |
| `Whizbang:Notifications:PollingFallbackInterval` | TimeSpan | `00:00:30` | Safety-net polling cadence when listener healthy. |
| `Whizbang:Notifications:ListenKeepaliveInterval` | TimeSpan | `00:00:30` | `SELECT 1` keepalive on listener connection. |
| `Whizbang:Notifications:ListenReconnectInitialDelay` | TimeSpan | `00:00:01` | First reconnect attempt delay. |
| `Whizbang:Notifications:ListenReconnectMaxDelay` | TimeSpan | `00:00:30` | Reconnect backoff cap. |
| `Whizbang:Notifications:ListenReconnectBackoffMultiplier` | double | 2.0 | Exponential growth factor. |

## Env-var equivalents

Standard .NET `__` separator:
```
ConnectionStrings__bffservice-db=Host=postgres-pgbouncer:6432;...
ConnectionStrings__bffservice-db-direct=Host=postgres-primary:5432;...

Whizbang__WorkCoordinator__PollingIntervalMilliseconds=250
Whizbang__WorkCoordinator__PollingMaxIntervalMilliseconds=10000
Whizbang__Heartbeat__IntervalSeconds=5

Whizbang__Notifications__PollingFallbackInterval=00:00:30
Whizbang__Notifications__ListenReconnectMaxDelay=00:00:30

Whizbang__Flushers__OutboxCompletion__Flusher__CoalesceWindowMs=10
Whizbang__Flushers__OutboxCompletion__Flusher__MaxBatchSize=500
```

## What devops needs to provision per service per environment

1. **One new connection string per service**: `ConnectionStrings:<dbname>-direct` — same DB target as the existing pooled string, **bypasses pgbouncer** (typically port 5432 vs 6432). Same vault path as the existing pooled string with `-direct` suffix.
2. **(Optional) ConfigMap for the `Whizbang:*` tuning knobs** — defaults are sane.
3. **Network policy**: pods need outbound to **both** the pgbouncer port and postgres-direct port for each service DB. Same DB host, different ports — typically already permitted; just confirm.
4. **(Recommended) Health probe**: expose `IWorkNotificationListener.IsHealthy` per pod via `/health/notifications`.

## What devops does NOT need to do

- Open additional bypass-pool connections per worker — there are none.
- Track per-flusher pool sizing — flushers share the pooled pool.
- Configure pgbouncer for LISTEN — LISTEN traffic doesn't go through pgbouncer.
- Manage prepared statement caches — disabled by default in our recommended Npgsql config.

## Related

- [Notifications and pgbouncer](notifications-and-pgbouncer.md)
- [Performance tuning](performance-tuning.md)
- [Failure and recovery](failure-and-recovery.md)
