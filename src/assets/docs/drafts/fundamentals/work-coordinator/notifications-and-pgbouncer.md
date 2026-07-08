---
title: Notifications and pgbouncer
order: 5
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

**Total bypass-pool connections per pod: 1.** Multiple subscribers (work signals, commit-order stamping, app signals, future channels) all share that single direct conn. Pre-slice-33 design opened one direct connection per listener type (3 per pod). With horizontal scaling — N pods × M services × E environments — that adds up fast on the Postgres `max_connections` budget.

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
    "bffservice-db":         "Host=postgres-pgbouncer:6432;Database=bffservice-db;...",
    "bffservice-db-direct":  "Host=postgres-primary:5432;Database=bffservice-db;..."
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

For local dev (e.g., JDX Aspire), there's no pgbouncer; the pooled connection is direct and notifications work without a separate `-direct` string.

## Sizing math

For 50 pods × 11 services in production:

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
