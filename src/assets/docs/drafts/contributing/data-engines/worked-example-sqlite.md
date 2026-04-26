---
title: Worked example - SQLite (polling-only, minimum-capability)
order: 8
---

# Worked example: SQLite engine (polling-only)

A walk-through of adding a SQLite engine to Whizbang. SQLite is the **minimum-capability** test case — no server-side notifications, no advisory locks, no bulk copy, no native arrays. The system still works, just on the polling-only path.

This example demonstrates that an engine doesn't need to be feature-complete to host Whizbang.

## Capability declaration

```csharp
public sealed class SqliteCapabilities : IWorkCoordinatorCapabilities {
  public string EngineName => "sqlite";
  public bool SupportsServerSideNotifications => false;  // No native pub/sub
  public bool SupportsBulkCopy => false;                  // No COPY equivalent
  public bool SupportsAdvisoryLocks => false;             // No advisory locks
  public bool SupportsNativeArrayParameters => false;     // No array type
  public bool SupportsListenOverPooler => false;          // Notifications disabled anyway
  public bool SupportsSavepoints => true;                 // SQLite supports SAVEPOINT
}
```

## What changes vs Postgres

### No notifications

`Whizbang.Data.Sqlite` doesn't ship a `SqliteWorkNotificationListener`. DI binds `NoOpWorkNotificationListener` automatically. ClaimWorker sees `IsHealthy = false` permanently and stays on aggressive polling cadence.

This is **fully correct** — polling fallback discovers all work. Idle CPU is higher than Postgres-with-notifications, but that's expected for SQLite (typically embedded / single-process scenarios where idle CPU isn't the binding constraint).

### No native arrays

The Postgres `claim_work` accepts `UUID[]`. SQLite has no array type. Two options:

1. **Pass JSON arrays**: change function signatures to accept `TEXT` (JSON-encoded array), parse inside the function via `json_each`.
2. **One id per call**: collapse arrays to single calls. Slower per round-trip but simplest.

For a SQLite implementation targeting low-throughput single-process apps, single-id-per-call is fine.

### No COPY

Same reasoning as arrays — for SQLite's typical workload, parameterized `UPDATE ... WHERE id IN (?, ?, ...)` is acceptable. Batched flushers will use parameterized arrays via the JSON or single-call approach.

### No advisory locks

The deadlock-safety fence in `claim_work` falls back to deterministic row-level lock ordering (the primary mechanism Whizbang uses anyway). SQLite's `BEGIN IMMEDIATE` provides the same guarantee with even simpler semantics.

### Savepoints supported

SQLite supports `SAVEPOINT` natively. `commit_handler_batch` works as documented — per-handler isolation, single fsync at outer commit.

## SQL function differences

SQLite syntax differs from Postgres in several places:

| Concept | Postgres | SQLite |
|---|---|---|
| UUID generation | `gen_random_uuid()` | `lower(hex(randomblob(16)))` (or compute UUIDv7 in C#) |
| JSONB | `JSONB` | `TEXT` with `json_each` |
| `EXISTS ... LIMIT 1` | works | works |
| `ON CONFLICT ... DO NOTHING` | works | works |
| `RETURNING` | works | works (3.35+) |
| `pg_notify` | works | not available |
| `RAISE NOTICE` | works | not available (use return code instead) |

The empty-call short-circuit pattern is the same:
```sql
SELECT EXISTS(SELECT 1 FROM wh_outbox WHERE processed_at IS NULL LIMIT 1)
    OR EXISTS(SELECT 1 FROM wh_inbox WHERE processed_at IS NULL LIMIT 1)
    OR EXISTS(SELECT 1 FROM wh_perspective_events WHERE processed_at IS NULL LIMIT 1)
    OR EXISTS(SELECT 1 FROM wh_receptor_processing WHERE completed_at IS NULL LIMIT 1)
INTO v_has_any_work;
```

(SQLite needs `WITH ... SELECT INTO` or equivalent — exact syntax depends on whether you use stored procedures or compose in C#.)

## Workers don't change

Same workers (`ClaimWorker`, `HeartbeatWorker`, `BatchFlusher<T>`, etc.) work polymorphically against `IWorkCoordinator`. They query capabilities at startup; SQLite's `SupportsServerSideNotifications = false` makes them adapt automatically (NoOp listener, polling-only behavior).

## DI registration

```csharp
services.AddWhizbang().WithEFCore<MyDbContext>().WithDriver.Sqlite(opts => {
  opts.PooledConnectionString = "Data Source=app.db";
  // No DirectConnectionString — notifications aren't supported.
});
services.AddWhizbangWorkers();  // Workers + NoOp listener bound automatically.
```

## Performance characteristics

- **Idle CPU**: higher than Postgres-with-notifications. ClaimWorker polls at base cadence (250 ms default) since notifications never wake it. For local dev / embedded scenarios, fine.
- **Burst latency**: bounded by polling interval. NOTIFY-driven instant wakeup not available.
- **Throughput**: bounded by SQLite's single-writer model. Use only for low-concurrency scenarios.
- **Per-handler commit**: same atomic guarantees via SAVEPOINT.

## When to use

- Local dev / unit-test fixtures (no infrastructure dependency).
- Single-process embedded apps.
- Low-throughput edge deployments.

## When NOT to use

- High concurrency (SQLite's single-writer constraint kills throughput).
- Multi-pod deployments (no shared state across processes).
- Latency-sensitive cross-service workflows (notifications aren't available).

## Test coverage

Run the standard test suite against your SQLite implementation. Expect:
- All function-existence tests pass.
- All happy-path tests pass.
- Notification-related tests are skipped (capability gates them).
- Performance benchmarks show higher idle CPU and longer burst latency than Postgres.

## Related

- [Overview](overview.md)
- [Implementing IWorkCoordinatorCapabilities](implementing-icapabilities.md)
- [Implementing notifications](implementing-notifications.md)
- [Worked example - SQL Server](worked-example-sqlserver.md)
