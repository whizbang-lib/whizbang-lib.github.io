---
title: Implementing IWorkCoordinatorCapabilities
order: 3
---

# Implementing `IWorkCoordinatorCapabilities`

`IWorkCoordinatorCapabilities` declares which optional features your engine supports. Whizbang queries it at startup and adapts: features your engine doesn't have fall back to slower-but-correct alternatives.

## The capability matrix

| Capability | Postgres | SQL Server (future) | MySQL (future) | SQLite (future) |
|---|---|---|---|---|
| `EngineName` | `"postgres"` | `"sqlserver"` | `"mysql"` | `"sqlite"` |
| `SupportsServerSideNotifications` | true (NOTIFY) | true (Service Broker) | false | false |
| `SupportsBulkCopy` | true (COPY) | true (BULK INSERT) | true (LOAD DATA) | false |
| `SupportsAdvisoryLocks` | true (`pg_advisory_lock`) | true (`sp_getapplock`) | true (`GET_LOCK`) | false |
| `SupportsNativeArrayParameters` | true | false (TVPs) | false | false |
| `SupportsListenOverPooler` | false (when pgbouncer txn-mode) | false (Service Broker has its own model) | n/a | n/a |
| `SupportsSavepoints` | true | true | true (InnoDB) | true |

## How each capability gates behavior

### `SupportsServerSideNotifications`

- **true** → driver registers a real `IWorkNotificationListener` (e.g., `PgWorkNotificationListener`).
- **false** → registers `NoOpWorkNotificationListener`. System runs polling-only. Fully correct, just higher idle baseline.

### `SupportsBulkCopy`

- **true** → batched flushers can use `COPY` / `BULK INSERT` for batches over a threshold (e.g., 100 rows). Materially faster on large bursts.
- **false** → flushers use parameterized `UPDATE ... WHERE id = ANY(...)`. Slower on huge batches but always correct.

### `SupportsAdvisoryLocks`

- **true** → engine can use advisory locks for the deadlock-safety fence in `claim_work` (defense in depth).
- **false** → claim_work falls back to deterministic row-level `FOR UPDATE` ordering (the primary mechanism Whizbang uses anyway). Same correctness, just no extra layer.

### `SupportsNativeArrayParameters`

- **true** → C# coordinator passes arrays directly (`new NpgsqlParameter("p_ids", NpgsqlDbType.Array | NpgsqlDbType.Uuid) { Value = idArray }`).
- **false** → coordinator JSON-serializes the array; SQL function unpacks via `JSON_ARRAY` / equivalent. Slower per-call, no correctness impact.

### `SupportsListenOverPooler`

- **true** → notifications work through a connection pooler in session-pooling mode. Single connection string suffices.
- **false** (e.g., pgbouncer transaction-pooling) → `WhizbangNotificationOptions.DirectConnectionString` is REQUIRED to enable notifications. System refuses to bind real listener without it; logs error + falls back to polling.

### `SupportsSavepoints`

- **true** → `commit_handler_batch` uses SAVEPOINT-per-handler isolation (the throughput multiplier).
- **false** → `commit_handler_batch` falls back to all-or-nothing semantics (any failure rolls back the entire batch). Coalesce window must shorten; throughput drops.

## Implementation pattern

```csharp
public sealed class PostgresCapabilities : IWorkCoordinatorCapabilities {
  public string EngineName => "postgres";
  public bool SupportsServerSideNotifications => true;
  public bool SupportsBulkCopy => true;
  public bool SupportsAdvisoryLocks => true;
  public bool SupportsNativeArrayParameters => true;
  public bool SupportsListenOverPooler { get; init; } = true;  // configurable
  public bool SupportsSavepoints => true;
}
```

`SupportsListenOverPooler` is the only capability that should be configurable (because it depends on deployment topology, not engine capability). Others are static per engine.

## Required vs optional features

A **capability** is something you can flip off and still have a correct system. Things that are NOT capabilities — they're contract requirements every engine must satisfy:

- ACID transactions
- READ COMMITTED isolation (or stronger) by default
- Row-level locking with skip-locked semantics (`FOR UPDATE SKIP LOCKED` or equivalent)
- Indexed lookups + partial / filtered indexes
- Parameterized queries
- Microsecond-precision timestamps (preferably nanosecond)
- UUIDv7 (or equivalent monotonic id generation)
- A way to enforce primary keys

If your engine can't deliver all of these, it can't host Whizbang. Document up front in the engine's README so users don't try.

## DI registration

```csharp
public static IServiceCollection AddWhizbangPostgres(this IServiceCollection services) {
  services.AddSingleton<IWorkCoordinatorCapabilities, PostgresCapabilities>();
  // ... register IWorkCoordinator, IWorkNotificationListener (or NoOp),
  //     migration provider, Npgsql data source, etc.
  return services;
}
```

Workers query `IWorkCoordinatorCapabilities` at startup and adapt their behavior. They never check the engine name directly.

## Related

- [Overview](overview.md)
- [Implementing IWorkCoordinator](implementing-iworkcoordinator.md)
- [Implementing notifications](implementing-notifications.md)
