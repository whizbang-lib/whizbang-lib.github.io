---
title: Notifications and pgbouncer
order: 5
---

# Notifications and pgbouncer

Whizbang's work coordinator uses postgres `NOTIFY` / `LISTEN` to wake idle workers immediately when new work appears, dropping idle SQL traffic toward zero. This page explains how the dual-connection design works, why it's necessary with pgbouncer, and how to operate it.

## The problem with pgbouncer + LISTEN

PostgreSQL's `LISTEN` registration is **session-scoped**: a session declares "I want notifications on channel X" and the server delivers them on that session. pgbouncer in transaction-pooling mode (the most common Azure / RDS setup) returns a connection to the pool after each transaction, breaking session affinity. So `LISTEN wh_work` issued through pgbouncer in transaction mode loses its registration almost immediately — the next time pgbouncer hands the same client a different backend connection, the LISTEN is gone.

## Solution: dual connection strings

Each pod opens **exactly one** direct connection (bypasses pgbouncer) for LISTEN. Everything else — claim, commit, flush, heartbeat — goes through pgbouncer normally.

```
┌──────────────────────────────────────────────────────────────────┐
│                   POD (per service replica)                      │
│                                                                  │
│    ┌────────────────────────────┐    ┌──────────────────────┐    │
│    │  Whizbang workers          │    │  PgWorkNotification  │    │
│    │  (claim/flush/heartbeat)   │    │  Listener            │    │
│    │                            │    │                      │    │
│    │  uses Npgsql connection    │    │  uses Npgsql         │    │
│    │  pool                      │    │  connection (1)      │    │
│    └────────────┬───────────────┘    └──────────┬───────────┘    │
│                 │                               │                │
└─────────────────┼───────────────────────────────┼────────────────┘
                  │                               │
            via pgbouncer (port 6432)       direct (port 5432)
                  │                               │
                  ▼                               ▼
            ┌─────────────────────────────────────────┐
            │  PostgreSQL                             │
            └─────────────────────────────────────────┘
```

**Total bypass-pool connections per pod: 1.** That's the entire fleet's direct-connection budget, regardless of how many workers run. Worker connection pinning is intentionally NOT used — it would multiply backend connections across pods and defeat pgbouncer's bounding.

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

When `<dbname>-direct` is unset, Whizbang binds `NoOpWorkNotificationListener` and runs polling-only. The system stays correct — polling fallback at the configured interval (30 s default) catches any work that would otherwise be discovered by NOTIFY.

## How signals flow

1. Some service commits new work via `commit_handler_result`. Inside the SQL function:
   ```sql
   IF v_outbox_inserted_count > 0 THEN PERFORM pg_notify('wh_work', 'outbox'); END IF;
   IF v_inbox_inserted_count > 0  THEN PERFORM pg_notify('wh_work', 'inbox');  END IF;
   ```
2. Postgres queues notifications. **Dedup at COMMIT**: 10 000 inserts that all `pg_notify('wh_work', 'outbox')` collapse to **one** delivered notification per `(channel, payload)` tuple — postgres handles this automatically.
3. On COMMIT, listeners receive the notifications. `PgWorkNotificationListener` is in `WaitAsync` on its direct connection; the notification fires its event handler.
4. The listener fires `OnSignal(WorkSignalCategory.Outbox)`.
5. `ClaimWorker` is subscribed to `OnSignal`; it calls `RequestImmediatePoll()` which releases the wake semaphore.
6. The claim worker's loop returns from its sleep early and immediately polls `claim_work`.

End-to-end latency from "transport delivers a message" to "another service starts handling it" is now governed by network + listener-connection wait + claim_work execution — measured in tens of milliseconds even at idle.

## Health monitoring + auto-fallback

`PgWorkNotificationListener.IsHealthy` reflects connection state. When unhealthy:
- Reconnect with exponential backoff (1 s → 2 s → 4 s → ... → 30 s cap).
- `OnHealthChanged(false)` fires; subscribers (typically `ClaimWorker`) flip to fast polling cadence so missed notifications don't accumulate latency.
- When the connection comes back: `OnHealthChanged(true)` fires; cadence reverts.

Keepalive (`SELECT 1` every 30 s by default) detects dead connections that haven't visibly errored.

Polling stays first-class. Notifications are an accelerator; correctness never depends on them.

## Operating modes

| `DirectConnectionString` | `DisableNotifications` | Mode |
|---|---|---|
| unset | — | **Polling-only** (default for unconfigured environments). |
| set + listener healthy | false | **Notify + 30s polling fallback**. Best mode. |
| set + listener unhealthy | false | **Auto-fallback**: claim worker uses fast polling until connection recovers. |
| set | true | **Forced polling** (kill switch for ops). |

## App signals

Whizbang exposes the same NOTIFY infrastructure to application code via `IAppSignalChannel`. App topics are strictly isolated from internal `wh_work` traffic:

- App channels are named `wh_app_<topic>`.
- Topic validation rejects the `wh_` prefix in user input — app code cannot publish to or subscribe to internal categories.
- Internal listeners ignore notifications outside `wh_work`.

See [App signals](app-signals.md) for usage.

## When you don't have pgbouncer

If your deployment doesn't use pgbouncer (or runs it in session-pooling mode), the dual-connection design still works but is simpler — you can use the same connection string for both pooled and direct, or skip the direct string entirely (LISTEN survives session pooling).

For local dev (e.g., JDX Aspire), there's no pgbouncer; the pooled connection is direct and notifications work without a separate `-direct` string.

## Sizing math

For 50 pods × 11 services in production:

- Direct connections to postgres: 50 × 11 = 550 (one LISTEN per pod per service).
- Pooled connections to pgbouncer: 50 × 11 × `Maximum Pool Size` (50 default) = 27,500 client positions, oversubscribed onto ~25–50 pgbouncer backend connections per service DB = ~275–550 backend pool connections total.
- Total backend connections per service DB: ~30–55 backend pool + 50 LISTEN = ~80–105.
- `max_connections = 1000+` per service DB is plenty.

## Related

- [Configuration reference](configuration-reference.md)
- [Failure and recovery](failure-and-recovery.md)
- [App signals](app-signals.md)
- [Contributor: implementing notifications](../../contributing/data-engines/implementing-notifications.md)
