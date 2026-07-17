---
title: Overview
order: 1
---

# Adding a data engine to Whizbang

Whizbang separates "engine" (the database) from "ORM" (the .NET data access layer). Each axis extends independently.

## Project layout

```
Whizbang.Core/                          Engine-agnostic interfaces & types
  Messaging/IWorkCoordinator.cs         The 11-method contract
  Messaging/IWorkCoordinatorCapabilities.cs
  Messaging/<DTOs>.cs                   Per-method request/result records
  Notifications/IWorkNotificationListener.cs

Whizbang.Data.<Engine>/                 Engine-specific shared layer
  Migrations/*.sql                      SQL functions (single source of truth)
  Notifications/Pg<...>NotificationListener.cs   Engine's notification listener

Whizbang.Data.<ORM>.<Engine>/           Binding layer per ORM × engine combo
  <ORM><Engine>WorkCoordinator.cs       Implements IWorkCoordinator
  <ORM><Engine>Capabilities.cs          Implements IWorkCoordinatorCapabilities
  <ORM><Engine>Extensions.cs            DI registration: AddWhizbang<ORM><Engine>()
```

Today's shipping shape:

| Engine | ORM packages |
|---|---|
| Postgres | `Whizbang.Data.EFCore.Postgres`, `Whizbang.Data.Dapper.Postgres` |
| SQL Server | (future) `Whizbang.Data.EFCore.SqlServer` |
| MySQL | (future) `Whizbang.Data.EFCore.MySql` |
| SQLite | (future) `Whizbang.Data.EFCore.Sqlite`, `Whizbang.Data.Dapper.Sqlite` |

## What you write to add a new engine

1. **`Whizbang.Data.<Engine>`** — the shared SQL + notifications layer:
   - SQL implementations of [the 9 SQL function contracts](sql-function-contracts.md): `claim_work`, `commit_handler_result`, `commit_handler_batch`, `complete_outbox_published`, `complete_perspective`, `record_heartbeat`, `report_failures`, `renew_leases`, `flush_completions`, `resolve_sync_inquiries`, plus the existing `perform_maintenance`.
   - A `<Engine>WorkNotificationListener` if the engine supports server-side pub/sub (Postgres NOTIFY/LISTEN, SQL Server Service Broker). Skip if the engine doesn't — Whizbang's polling fallback covers correctness.
   - A capabilities class declaring what the engine supports.

2. **`Whizbang.Data.<ORM>.<Engine>`** — the per-ORM binding layer:
   - `<ORM><Engine>WorkCoordinator` implementing all 11 `IWorkCoordinator` methods. Each method maps 1:1 to a SQL function via the ORM's preferred call style.
   - DI registration extension: `AddWhizbang<ORM><Engine>()`.

3. **Tests** — see [Testing a new engine](testing-a-new-engine.md). The conformance suite is engine-agnostic; if your impl passes, it's correct.

## What you do NOT write

- Worker classes — they live in `Whizbang.Core/Workers/` and consume `IWorkCoordinator` polymorphically. They work as-is on any conformant engine.
- DTOs — `ClaimWorkRequest`, `HandlerCommitRequest`, `WorkBatch`, etc. live in `Whizbang.Core/Messaging/`.
- Channel/flusher infrastructure — `BatchFlusher<T>` and the per-category flush workers are engine-agnostic.

## Capability-driven fallbacks

Whizbang accommodates engines with different capability surfaces via `IWorkCoordinatorCapabilities`. Workers query capabilities at startup and adapt:

- `SupportsServerSideNotifications == false` → notification listener bound to NoOp; system runs polling-only.
- `SupportsBulkCopy == false` → batched flushers use parameterized arrays instead of COPY.
- `SupportsSavepoints == false` → `commit_handler_batch` falls back to all-or-nothing semantics.
- `SupportsListenOverPooler == false` → `DirectConnectionString` is required for notifications (e.g., pgbouncer transaction-pooling).

See [Implementing IWorkCoordinatorCapabilities](implementing-icapabilities.md) for the full matrix.

## Required vs optional features

What every engine must provide (contract — not configurable):

- ACID transactions
- READ COMMITTED isolation (or stronger) by default
- Row-level locking with skip-locked semantics (`FOR UPDATE SKIP LOCKED` or equivalent)
- Indexed lookups + partial indexes (or filtered indexes)
- Parameterized queries
- Microsecond-precision timestamps
- UUIDv7 (or equivalent monotonic id generation)

What's optional (a capability you can flip off):

- Server-side notifications (NOTIFY/Service Broker)
- Bulk copy (COPY/BULK INSERT)
- Advisory locks (`pg_advisory_lock`/`sp_getapplock`)
- Native array parameters
- LISTEN-over-pooler

If your engine can't deliver every required feature, it can't host Whizbang. Documented up front to set expectations.

## Related

- [Fundamentals: claim loop](../../fundamentals/work-coordinator/claim-loop.md)
- [Fundamentals: handler commit](../../fundamentals/work-coordinator/handler-commit.md)
- [Fundamentals: notifications and pgbouncer](../../fundamentals/work-coordinator/notifications-and-pgbouncer.md)
