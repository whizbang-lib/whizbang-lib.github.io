---
title: Failure and recovery
order: 9
---

# Failure and recovery

What happens when each component fails, and how the system recovers.

## Pooled connection (pgbouncer / postgres) unreachable

**What:** `IWorkCoordinator` calls fail with `NpgsqlException` / connection refused.

**Behavior:**
- Each worker catches the exception, logs warn, increments its retry counter.
- Existing `WorkerRetryOptions` exponential backoff applies.
- The Npgsql pool re-establishes connections on its own; first successful operation after recovery resumes normal flow.

**Recovery:** automatic when DB returns. No manual intervention needed.

## Direct connection (LISTEN listener) drops

**What:** `PgWorkNotificationListener` connection breaks (DB restart, network blip, idle eviction).

**Behavior:**
- `IsHealthy` flips to `false`; `OnHealthChanged(false)` fires.
- Reconnect with exponential backoff (1 s → 2 s → 4 s → ... → 30 s cap).
- During reconnect, claim worker can flip to fast polling cadence (subscriber-controlled).

**Recovery:** automatic. When connection comes back, `IsHealthy = true` and `OnHealthChanged(true)` fires; cadence reverts.

**Polling fallback:** notifications are an accelerator. Claim worker polls at `PollingFallbackInterval` (30 s default) regardless. Missed notifications cost ≤ 30 s of latency, never correctness.

## DB completely unreachable (full outage)

**What:** Both pooled AND direct connections fail.

**Behavior:**
- Listener: as above (unhealthy + reconnect loop).
- Workers: retry per `WorkerRetryOptions`.
- Heartbeat worker: critical — if it can't heartbeat for `AbandonStaleInstanceThresholdSeconds`, peers may flag this instance as stale and steal its work.

**Recovery:** when DB returns, this instance re-claims its leases via the normal claim path (orphan reclaim handles "I was leasing X but my lease expired during the outage").

## Heartbeat worker can't reach DB

**What:** Heartbeat fails for an extended period.

**Behavior:** logs critical warning. Other instances see this instance's `last_heartbeat_at` age out and treat it as stale, allowing them to claim its in-flight work after the lease expires. Standard orphan-reclaim semantics.

**Recovery:** when this instance comes back and successfully heartbeats again, it re-registers and resumes claiming new work. In-flight items it lost during the outage have been re-leased to peers — those will run wherever they got reassigned.

## Inbox handler bundle fails mid-commit

**What:** `commit_handler_result` throws (constraint violation, partial DB write, etc.).

**Behavior:** Whole bundle rolls back atomically. Inbox row stays unprocessed. Next claim re-delivers.

**Recovery:** automatic via re-delivery. If the failure is deterministic (e.g., a bug), the message will keep failing until the bug is fixed or the message is manually moved to DLQ.

## One handler in a batch fails

**What:** `commit_handler_batch` SAVEPOINT-isolated failure on one handler in N.

**Behavior:**
- Failing handler's bundle rolls back to its savepoint; siblings commit normally.
- `CommitHandlerBatchAsync` returns per-handler results.
- `InboxHandlerWorker` routes the failed handler's id to `FailureFlushWorker` for retry tracking.
- Inbox row stays unprocessed; re-delivered on next claim.

## Flush worker fails mid-batch

**What:** `complete_outbox_published` (or any batched flush) throws.

**Behavior:**
- `BatchFlusher` logs warning, continues with next batch. Items in the failed batch are LOST from the channel.
- All flush calls are idempotent (UPDATE WHERE processed_at IS NULL); already-processed rows ignored.
- Items the flush would have completed are still claimable (or have a lease that will expire). Next claim re-delivers them; their handler runs again. Idempotency of handlers is required.

## Pinned-connection drops (NOT applicable in current design)

Whizbang's production design uses **only one** bypass-pool connection per pod (the LISTEN listener). Workers all use the pooled connection. So there's no "worker pinned connection" failure mode — workers ride the Npgsql pool's reconnect path.

## Notification listener at scale

In production with 50+ pods, each pod opens 1 LISTEN connection. Postgres handles thousands of LISTENers efficiently (NOTIFY is O(1) per delivered listener). At realistic deployment sizes:

- 50 pods × 11 services = 550 LISTEN connections to postgres.
- pg_notify queue: 8 GB default, deduped per-tx; collapse rate is high in practice.

If notifications fall behind (backlog grows), the polling fallback at 30 s safety-net catches everything. Worst-case latency degrades; correctness doesn't.

## Health probes

Recommended `/health` endpoints:

- `/health/live` — process is alive (default ASP.NET Core liveness).
- `/health/ready` — pooled connection works (existing `IDatabaseReadinessCheck`).
- `/health/notifications` — `IWorkNotificationListener.IsHealthy`. Flag in dashboards but don't fail readiness on this — polling fallback keeps the system functional.

## Related

- [Notifications and pgbouncer](notifications-and-pgbouncer.md)
- [Configuration reference](configuration-reference.md)
- [Claim loop](claim-loop.md)
