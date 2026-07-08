# Decomposing `process_work_batch` into focused SQL functions

## Status
Accepted (2026-04-25 → 2026-04-26)

## Context

`process_work_batch` was a 1409-line PL/pgSQL function with 25 parameters. A live diagnostic on the JDNext dev environment found:

- ~22 calls/sec **per service** × 11 service DBs ≈ 242 calls/sec stack-wide
- Every idle call returned 0 rows but cost ~17 ms postgres CPU
- Structural floor: heartbeat + 4 orphan-claim scans + 5 result CTEs all fired even when queues were empty
- Idle stack consumed ~45% postgres container CPU

The monolith mixed three workloads with different transactional needs:
1. **Genuinely transactional bundles** — handler completion + emitted outbox messages, outbox storage + event_store + perspective auto-create
2. **Pure maintenance** — heartbeat, stale cleanup, orphan reclaim
3. **Pure writes** — completions, lease renewals

Mixing these forced every call to pay the worst-case cost.

## Decision

Split into 10 focused functions, each with a single transactional responsibility:

| Function | Responsibility | Cost on empty |
|---|---|---|
| `claim_work` | The only function the claim worker polls. 4-EXISTS short-circuit on empty queues. | ≤ 1 ms |
| `commit_handler_result` | Atomic bundle: inbox completion + emitted outbox/inbox + event-store + perspective auto-create | n/a (only called with work) |
| `commit_handler_batch` | SAVEPOINT-per-handler isolation, single fsync at outer commit | n/a |
| `complete_outbox_published` | Batched mark-as-processed | n/a |
| `record_heartbeat` | Decoupled UPSERT on a separate timer | < 1 ms |
| `complete_perspective` | Cursor advance + event-row deletion | n/a |
| `report_failures` | Per-category batched failure reporter | n/a |
| `renew_leases` | Per-category batched lease extension | n/a |
| `flush_completions` | Composite single-round-trip multi-category flusher | n/a |
| `resolve_sync_inquiries` | Read-only path for `PerspectiveSyncAwaiter` | n/a |

Legacy `process_work_batch` stays in place during migration; new functions live alongside it. Pre-v1.0 mutable-migration policy means once C# callers migrate, the legacy function is deleted in the same migration file (no new migration version needed).

## Consequences

**Wins:**
- Idle call cost: ~17 ms → ≤ 1 ms (17×). Idle stack call rate target ≤ 6/sec across 11 DBs (40×).
- Each function has a single SQL plan; postgres per-backend plan cache short-circuits repeats cheaply even under pgbouncer transaction-pooling (which defeats client-side prepared statements).
- `pg_notify('wh_work', '<category>')` fires from inside `commit_handler_result` and `commit_handler_batch`. Postgres deduplicates `(channel, payload)` at COMMIT — 1000 inserts in one tx → ≤ 3 notifications.
- SAVEPOINT-batched commit (`commit_handler_batch`) achieves single-fsync throughput for N handlers; target ≥ 2000 handler/s vs ~200 today.

**Costs:**
- 10 SQL functions vs 1 to maintain. Mitigated by edit-in-place pre-v1.0 policy (all in `029_ProcessWorkBatch.sql`) and one test class per function.
- C# layer adds 10 new `IWorkCoordinator` methods. Mitigated by default-throws on the interface so existing implementers opt in incrementally.

**Trade-offs deliberately accepted:**
- `commit_handler_batch` SAVEPOINT failure surfaces only `error_message`/`error_code`/`error_detail` per handler — full exception detail logged in C#, not the SQL return.
- Receptor-claim path and two-tier perspective fairness deferred until measurement shows they matter.

## Alternatives considered

- **Materialized view for "is there work?"** — adds replication lag, breaks "claim and lock" atomicity.
- **NOTIFY without function decomposition** — eliminates polling but doesn't fix the per-call cost when work IS present.
- **Pure C# event loop with no polling at all** — fragile under pgbouncer disconnects; polling is a load-bearing fallback.

## Related

- [SAVEPOINT-batched handler commit](./savepoint-batched-handler-commit.md)
- [Dual-connection notifications and pgbouncer](./dual-connection-notifications.md)
- [Engine + ORM extension model](./engine-orm-extension-model.md)
