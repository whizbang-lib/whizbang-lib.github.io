# Engine + ORM extension model

## Status
Accepted (2026-04-26)

## Context

Whizbang ships with a Postgres + EFCore reference implementation, but the architecture must accommodate other engines (SQL Server, MySQL, SQLite) and other ORMs (Dapper, future LINQ providers) without forcing every backend to support every feature.

Capabilities differ widely:
- Postgres: NOTIFY, COPY, advisory locks, native arrays, savepoints — all yes.
- SQL Server: Service Broker for notifications, BULK INSERT, sp_getapplock, savepoints — yes; native arrays — no (TVP fallback).
- SQLite: no notifications, no advisory locks, no bulk copy, no native arrays — but savepoints yes.

The extension model needs to let an engine declare what it supports, let Whizbang fall back gracefully when a feature isn't available, and not force contributors to implement features they can't.

## Decision

Three-axis decomposition:

1. **`IWorkCoordinator`** — 10 focused methods, one per SQL function. Each method has a default-throws body on the interface so existing implementers opt in incrementally. New engines implement what they can; the rest stays NotImplemented until needed.

2. **`IWorkCoordinatorCapabilities`** — declarative capability flags. Workers query at startup and choose the right path. No exception-driven fallbacks.

   | Capability | Required for production? | Fallback when false |
   |---|---|---|
   | `SupportsServerSideNotifications` | optional | polling-only (already first-class) |
   | `SupportsBulkCopy` | optional | per-row UPDATE |
   | `SupportsAdvisoryLocks` | optional | row-level FOR UPDATE |
   | `SupportsNativeArrayParameters` | optional | JSON-encoded fallback |
   | `SupportsListenOverPooler` | optional | gates whether `DirectConnectionString` is required when notifications are wanted |
   | `SupportsSavepoints` | optional | `commit_handler_batch` falls back to all-or-nothing |

3. **`IWorkNotificationListener`** — separate from the coordinator. Engines that support push notifications ship a real impl; everyone else gets `NoOpWorkNotificationListener` and the system runs polling-only.

Reference implementations live in `Whizbang.Data.Postgres` (engine-specific SQL + listener) and `Whizbang.Data.EFCore.Postgres` / `Whizbang.Data.Dapper.Postgres` (ORM-specific binding). New backends follow the same layering — engine project owns SQL and connection-level concerns; ORM project is a thin binding layer.

## Consequences

**Wins:**
- A SQLite engine that returns `false` for everything except savepoints + transactions can pass the conformance test suite. The system runs (slower, on polling) without code changes.
- Contributors don't have to implement notifications, bulk copy, or advisory locks to ship a working backend. They opt in as the workload demands.
- Capability checks are compile-time-discoverable; workers can build different code paths without try/catch.

**Costs:**
- More test scaffolding — every capability needs a "with" and "without" test variant.
- Documentation overhead — each capability needs an explanation of what falls back to what. Mitigated by the `contributing/data-engines/` section in the docs.

**Trade-offs deliberately accepted:**
- Default-throws on `IWorkCoordinator` means a runtime error if a worker calls a method the engine hasn't implemented. Capability flags should prevent this in practice, but the safety net is the exception, not a compile-time check. The alternative (one interface per capability) was rejected as too heavy for the actual use case.

## Alternatives considered

- **One mega-interface with every capability as a method**: forces every implementer to either implement or stub everything. Rejected.
- **One interface per capability, mixed via marker interfaces**: each engine implements N small interfaces. Workable but over-engineered for the 10 methods we have.
- **Runtime feature detection ("can I do X here?")**: replaces compile-time discoverability with runtime probing. Slow startup; harder to reason about.

## Related

- [SQL function decomposition](./sql-function-decomposition.md)
- [Dual-connection notifications](./dual-connection-notifications.md)
- Contributing guide: `contributing/data-engines/`
