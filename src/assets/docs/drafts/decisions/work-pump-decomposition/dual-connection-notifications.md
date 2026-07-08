# Dual-connection notifications: LISTEN bypasses pgbouncer

## Status
Accepted (2026-04-26)

## Context

Whizbang needs server-push notifications so workers can wake on new work without paying the cost of constant polling. Postgres `LISTEN/NOTIFY` is the natural primitive, but the JDNext production deployment runs pgbouncer in **transaction-pooling mode** between the application and Postgres.

LISTEN doesn't survive transaction pooling: the listening session can be handed to a different client between transactions, breaking the `(connection, channel)` subscription. Pgbouncer documentation explicitly warns against using LISTEN through it.

Constraints:
- ~5 pods × 11 services × multiple environments = hundreds of pods total. Each pod cannot afford a fleet of bypass-pool connections — that defeats pgbouncer's whole purpose.
- Network policy in production permits both the pgbouncer port (6432) and the postgres-direct port (5432) from each pod, but auditors care about the count.

## Decision

**Exactly one direct connection per pod for LISTEN. Everything else through pgbouncer.**

| Consumer | Connection model | Connections per pod |
|---|---|---|
| `PgWorkNotificationListener` | direct (bypasses pgbouncer) | **1** |
| Every worker (claim, flush, heartbeat, maintenance, …) | pooled via existing Npgsql pool through pgbouncer | 0 dedicated |
| `IAppSignalChannel.PublishAsync` | pooled | 0 dedicated |

The listener owns the only direct connection. It dispatches both internal (`wh_work`) and app-level (`wh_app_<topic>`) notifications via in-process events; subscribers (e.g., `ClaimWorker.RequestImmediatePoll`) never touch the direct connection themselves.

Configuration: a new `<dbname>-direct` connection-string key per service (resolved by convention from the same `IConfiguration` the DbContext uses). Optional — if unset, the system runs polling-only and is fully functional.

Listener health (`IsHealthy`) flips to `false` on disconnect/keepalive failure; `ClaimWorker` subscribes to `OnHealthChanged` and tightens its polling cap when notifications are degraded.

## Consequences

**Wins:**
- Burst latency target: transport-arrived inbox → claim ≤ 50 ms with NOTIFY healthy, ≤ 30 s with polling fallback.
- Per-pod connection footprint: `Maximum Pool Size + 1` (default 51). Devops sizing math is simple.
- App code can `pg_notify` for its own pub/sub without provisioning a separate transport.

**Costs:**
- Devops provisions a second connection string per service per environment.
- 1 always-on connection per pod, even when no work is in flight.

**Trade-offs deliberately accepted:**
- pgbouncer transaction-pooling defeats client-side persistent prepared statements (`Max Auto Prepare=0`). Per-call parse overhead is ~50–200 µs; at our target call rates (~6/s idle, ~2k handler/s under burst) this is ≤ 0.5 ms/s — negligible compared to the ~17 ms/call we're cutting elsewhere.
- The system MUST work without notifications. Polling is a first-class fallback, not a degraded mode. Documented in `polling-first-class.md`.

## Alternatives considered

- **All workers open their own bypass-pool connections**: violates the production connection budget.
- **App-level pub/sub via Service Bus / Kafka**: introduces another infrastructure dependency. The `wh_app_*` channel design lets app code reuse the existing connection.
- **No LISTEN at all (polling only)**: misses the burst-latency target; doesn't help the dev-machine sluggishness problem the project started from.

## Related

- [SQL function decomposition](./sql-function-decomposition.md) — `pg_notify` is emitted from inside the new functions
- [Engine + ORM extension model](./engine-orm-extension-model.md) — `IWorkNotificationListener` is per-engine; non-Postgres engines can return NoOp
