---
title: Overview
order: 1
---

# Work coordinator overview

The work coordinator pumps messages through three queues — outbox (transport publishes), inbox (handler dispatch), and perspective_events (projection processing). It's built around a focused-function architecture: one SQL function per concern, one C# method per SQL function, one worker per active loop.

## High-level flow

```
                    ┌──────────────────────────────────────────────┐
                    │                                              │
   ┌──────────┐     │     ┌───────────┐    ┌────────────────┐      │
   │ External │─────┼────►│  inbox    │───►│ Inbox handler  │      │
   │ transport│     │     │  table    │    │ (your code)    │      │
   └──────────┘     │     └───────────┘    └───────┬────────┘      │
                    │                              │                │
                    │     ┌───────────┐            │ emits          │
                    │     │  outbox   │◄───────────┘ outbox msgs    │
                    │     │  table    │                             │
                    │     └─────┬─────┘                             │
                    │           │                                   │
   ┌────────────┐   │           ▼                                   │
   │  Transport │◄──┼────  OutboxPublishWorker                      │
   │  (publish) │   │                                               │
   └────────────┘   │     ┌───────────┐   ┌────────────────┐        │
                    │     │perspective│──►│ Perspective    │        │
                    │     │  _events  │   │ projection     │        │
                    │     │   table   │   │ (your code)    │        │
                    │     └───────────┘   └────────────────┘        │
                    │                                               │
                    │   ClaimWorker (the only poller, calls         │
                    │   claim_work) distributes work to channels    │
                    │                                               │
                    └───────────────────────────────────────────────┘
```

## The 8 workers

| Worker | Role |
|---|---|
| `ClaimWorker` | The only poller. Calls `claim_work`, distributes to channels. Adaptive backoff + wake semaphore. |
| `HeartbeatWorker` | Decoupled timer. Calls `record_heartbeat` every 5 s. |
| `InboxHandlerWorker` | Drains handler-result channel, calls `commit_handler_batch` (SAVEPOINT-per-handler). |
| `OutboxPublishWorker` | (existing) Reads outbox channel, publishes to transport, signals completion. |
| `OutboxCompletionFlushWorker` | Drains outbox-completion channel, batches, calls `complete_outbox_published`. |
| `PerspectiveProcessWorker` | Reads perspective channel, runs projection, signals completion. |
| `PerspectiveCompletionFlushWorker` | Drains perspective-completion channel, batches, calls `complete_perspective`. |
| `FailureFlushWorker` | Drains failure channel, batches per category, calls `report_failures`. |
| `LeaseRenewalWorker` | Drains lease-renewal channel, batches per category, calls `renew_leases`. |

## The 11 SQL functions

| Function | Hot? | Purpose |
|---|---|---|
| `claim_work` | yes | Polled. Empty-call short-circuit drops idle floor to ≤ 1 ms. |
| `commit_handler_result` | yes | Atomic bundle: inbox completion + emitted messages. |
| `commit_handler_batch` | yes | Throughput multiplier: SAVEPOINT-per-handler isolation. |
| `complete_outbox_published` | warm | Batched fire-and-forget. |
| `complete_perspective` | warm | Cursor advance + event-row deletion. |
| `report_failures` | warm | Per-category batched. |
| `renew_leases` | cold | Per-category batched. |
| `record_heartbeat` | cold | Decoupled UPSERT. |
| `flush_completions` | warm | Composite multi-category. |
| `resolve_sync_inquiries` | on-demand | Read-only. |
| `perform_maintenance` | cold | Bulk purges (existing). |

## Why decomposed

The legacy `process_work_batch` was a 1409-line PL/pgSQL function with 25 parameters. Calling it cost ~17 ms even on empty queues because every call ran heartbeat + 4 orphan-claim scans + 5 result CTEs. With every service polling it ~22 times/sec, postgres CPU sat at 45% just doing no-op polling.

The new shape:

- **Each function does one thing** — auditable, focused, performant.
- **Empty-call short-circuit** in `claim_work` cuts the idle floor to ≤ 1 ms.
- **Heartbeat is a separate timer** — no longer coupled to polling cadence.
- **Batched flushers** coalesce hot-path completions; one fsync covers many ids.
- **`commit_handler_batch`** SAVEPOINTs each handler result individually for partial-failure isolation while still committing the batch in one fsync.

Target metrics (per the [original baseline](https://...)):
- Idle `claim_work` calls/sec/svc: 22 → ≤ 0.5
- Idle stack postgres CPU: 45% → ≤ 2%
- Empty-call cost: 17 ms → ≤ 1 ms
- Inbox handler throughput: 200/s → ≥ 2000/s

## Related

- [Claim loop](claim-loop.md)
- [Handler commit](handler-commit.md)
- [Notifications and pgbouncer](notifications-and-pgbouncer.md)
- [Contributor: implementing IWorkCoordinator](../../contributing/data-engines/implementing-iworkcoordinator.md)
