---
title: Configuration reference
pageType: reference
order: 8
version: 1.0.0
description: >-
  Every option the work coordinator and its workers read, with the section each one binds from and
  what changing it costs.
tags: 'work-coordinator, configuration, options, workers, tuning, reference'
codeReferences:
  - src/Whizbang.Core/Workers/ClaimWorker.cs
  - src/Whizbang.Core/Workers/OutboxDrainWorker.cs
  - src/Whizbang.Core/Workers/HeartbeatWorker.cs
  - src/Whizbang.Core/Notifications/WhizbangNotificationOptions.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
testReferences:
  - tests/Whizbang.Core.Component.Tests/Workers/ClaimWorkerGateCadenceTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/ClaimWorkerAcquisitionBoundsTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/OutboxDrainWorkerStreamRunTests.cs
---

# Configuration reference

Every option that affects the work coordinator. All bind via standard `IConfiguration` (appsettings.json, env vars, k8s ConfigMap, vault, etc.).

## Connection strings

Whizbang reuses the connection string of your registered DbContext — **no duplicate Whizbang connection key**.

| Key | Required | Purpose | Env var |
|---|---|---|---|
| `ConnectionStrings:db` | yes (already exists for the DbContext) | Pooled connection. | `ConnectionStrings__db` |
| `ConnectionStrings:db-direct` | no | Direct connection (bypasses pgbouncer). LISTEN-only, **1 connection per pod**. If unset → polling-only mode. | `ConnectionStrings__db-direct` |
| `ConnectionStrings:db-init` | no | Direct connection for schema initialization and migrations. | `ConnectionStrings__db-init` |

`db` is the name when the `DbContext` names none; a context that names one (`[WhizbangDbContext(ConnectionStringName = "reporting")]`) reads `reporting`, `reporting-direct` and `reporting-init`. Each connection has its own command timeout, `Whizbang:Postgres:<connection>:CommandTimeoutSeconds` (`db`, `db-direct`, `db-init`); see [ConnectionStrings Conventions](../../operations/configuration/configuration-reference#connectionstrings-conventions) and [Command timeouts](../../operations/configuration/configuration-reference#command-timeouts).

Recommended pgbouncer-aware Npgsql connection-string params on the pooled string:
```
Maximum Pool Size=50; Minimum Pool Size=0;
Max Auto Prepare=0; No Reset On Close=true; Server Compatibility Mode=PgBouncer; Pooling=true
```

See [notifications-and-pgbouncer](notifications-and-pgbouncer.md) for sizing math.

## `Whizbang:Workers:Claim` and `Whizbang:WorkCoordinator` (claim worker tuning — `ClaimWorkerOptions`, `WorkCoordinatorOptions`)

| Key | Type | Default | Notes |
|---|---|---|---|
| `Whizbang:Workers:Claim:PollingIntervalMilliseconds` | int | 250 | Base poll cadence. |
| `Whizbang:Workers:Claim:PollingMaxIntervalMilliseconds` | int | 10000 | Adaptive backoff cap. Auto-clamped to ≤ `AbandonStaleInstanceThresholdSeconds × 1000 / 3` to preserve heartbeat freshness. |
| `Whizbang:Workers:Claim:MaxStreamsPerBatch` | int | 1000 | Max rows returned per `claim_work` call. |
| `Whizbang:Workers:Claim:MaxOutboxRowsPerBatch` | int | 1000 | Outbox acquisition row bound per claim, independent of the stream window. A claim that fills it claims again at once. `0` restores the stream window as the bound. |
| `Whizbang:Workers:Claim:OutboxRunLength` | int | 100 | Consecutive rows of one outbox stream a claim may lease (see [claim loop](claim-loop.md#outbox-streams-move-in-runs)). |
| `Whizbang:Workers:Claim:MaxOutstandingOutboxRows` | int | 10000 | Ceiling on outbox rows an instance holds; bounds the immediate re-claims after full outbox acquisitions. |
| `Whizbang:WorkCoordinator:PartitionCount` | int | 10000 | Modulo partition count. |
| `Whizbang:WorkCoordinator:LeaseSeconds` | int | 300 | Lease duration on claimed work. |

## Outbox drain (`OutboxDrainWorkerOptions`)

| Option | Type | Default | Notes |
|---|---|---|---|
| `MaxPerStream` | int | 100 | Rows drained per stream per fetch, and the page a continuation round leases. |
| `ContinueStreamRuns` | bool | true | Continue a stream from the lease it holds once its rows publish, instead of waiting for the next claim cycle. A stream with a failed publish is never continued. |
| `MaxContinuationRounds` | int | 10 | Continuation rounds per drain cycle before the claim cycle takes the streams on. |

## `Whizbang:Workers:Heartbeat` (heartbeat worker tuning — `HeartbeatWorkerOptions`)

| Key | Type | Default |
|---|---|---|
| `Whizbang:Workers:Heartbeat:IntervalSeconds` | int | 5 |

Cadence must satisfy `IntervalSeconds < AbandonStaleInstanceThresholdSeconds / 3` to keep peers from falsely flagging this instance stale.

## `Whizbang:Workers:<Worker>:Flusher` (per-flusher Nagle tuning)

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
Whizbang:Workers:OutboxCompletionFlush:Flusher:CoalesceWindowMs=10
Whizbang:Workers:OutboxCompletionFlush:Flusher:MaxBatchSize=500
```

`LeaseRenewal` also has `LeaseSeconds` (default 300).

## `Whizbang:Database` (`WhizbangNotificationOptions`)

| Key | Type | Default | Notes |
|---|---|---|---|
| `Whizbang:Database:DisableNotifications` | bool | false | Kill switch; forces polling-only. |
| `Whizbang:Database:PollingFallbackInterval` | TimeSpan | `00:00:30` | Safety-net polling cadence when listener healthy. |
| `Whizbang:Database:ListenKeepaliveInterval` | TimeSpan | `00:00:30` | `SELECT 1` keepalive on listener connection. |
| `Whizbang:Database:ListenReconnectInitialDelay` | TimeSpan | `00:00:01` | First reconnect attempt delay. |
| `Whizbang:Database:ListenReconnectMaxDelay` | TimeSpan | `00:00:30` | Reconnect backoff cap. |
| `Whizbang:Database:ListenReconnectBackoffMultiplier` | double | 2.0 | Exponential growth factor. |

## Env-var equivalents

Standard .NET `__` separator:
```
ConnectionStrings__appservice-db=Host=postgres-pgbouncer:6432;...
ConnectionStrings__appservice-db-direct=Host=postgres-primary:5432;...

Whizbang__Workers__Claim__PollingIntervalMilliseconds=250
Whizbang__Workers__Claim__PollingMaxIntervalMilliseconds=10000
Whizbang__Workers__Heartbeat__IntervalSeconds=5

Whizbang__Database__PollingFallbackInterval=00:00:30
Whizbang__Database__ListenReconnectMaxDelay=00:00:30

Whizbang__Workers__OutboxCompletionFlush__Flusher__CoalesceWindowMs=10
Whizbang__Workers__OutboxCompletionFlush__Flusher__MaxBatchSize=500
```

## What devops needs to provision per service per environment

1. **One new connection string per service**: `ConnectionStrings:db-direct` — same DB target as the pooled `ConnectionStrings:db`, **bypasses pgbouncer** (typically port 5432 vs 6432). Same vault path as the pooled string with `-direct` suffix.
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
