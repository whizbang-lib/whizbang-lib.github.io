---
title: Worker Classification — A through F
version: 1.0.0
category: Fundamentals
order: 9
description: >-
  Reference table for which Whizbang background workers are NOTIFY-driven,
  channel-driven, transport-driven, timer-driven, or one-shot lifecycle.
tags: 'workers, notify, polling, classification, reference'
---

# Worker classification

Every Whizbang background worker falls into one of six classes. The class tells operators "what wakes this worker?" and tells contributors "what should I touch when changing this worker's cadence?"

## Legend

| Class | Meaning |
|---|---|
| **A — NOTIFY-driven** | Subscribes to `IWorkNotificationListener.OnSignal` for its primary wake. Polling may still exist as a safety-net. |
| **B — Channel-driven** | Wakes on a `Channel<T>` / `BatchFlusher<T>` write from an in-process producer. No DB polling. |
| **C — Transport-driven** | Wakes on a broker (RabbitMQ / ASB) message arrival. Not a DB concern. |
| **D — Polling, NOTIFY-eligible** | Has a `Task.Delay` / `PeriodicTimer` loop AND a NOTIFY signal would semantically apply if wired. Highest-value conversion candidates. |
| **E — Necessarily timed** | Heartbeat / TTL sweep / scheduled maintenance — must be timer-driven by definition. NOTIFY doesn't apply. |
| **F — One-shot / lifecycle** | Runs once at start / shutdown / migration. Not a polling concern. |

After v0.681 (this PR), zero D-class workers remain — every previously-polling worker either converted to A (NOTIFY-driven) or stayed at the only-makes-sense-as-timed E class.

## Per-worker table

| Worker | Class | Cadence / driver | Notes |
|---|---|---|---|
| `ClaimWorker` | A | `OnSignal` + 30 s safety-net | Outbox/Inbox/Perspective/OrphanRedistribute via `_onSignal` |
| `PerspectiveWorker` | A | `WorkSignalCategory.Perspective` + `NotifyHealthyPollingIntervalMilliseconds` safety-net (30 s default) | v0.681 slice 7a wired the previously-unused signal |
| `DeadLetterRecoveryWorker` | A | `WorkSignalCategory.DeadLetterReady` + `ScanIntervalMinutes` backstop (10 min) | v0.681 slice 7c added the AFTER INSERT trigger |
| `TransportDeadLetterDrainWorker` | A (mixed) | Broker push subscription (when transport overrides `SubscribeToDeadLetterAsync`) + polling fallback | v0.681 slice 7d added the contract; per-transport push implementations follow up |
| `OutboxPublishWorker` | B | `IWorkChannelWriter` | Drained when ClaimWorker dispatches |
| `InboxHandlerWorker` | B | `BatchFlusher<HandlerCommitRequest>` | |
| `InboxDispatchWorker` | B | `IInboxChannelWriter` | |
| `InboxDrainWorker` | B | `IInboxDrainChannel` | |
| `OutboxDrainWorker` | B | `IOutboxDrainChannel` | |
| `OutboxCompletionFlushWorker` | B | `BatchFlusher<Guid>` | |
| `PerspectiveCompletionFlushWorker` | B | `BatchFlusher` | |
| `FailureFlushWorker` | B | `BatchFlusher` | |
| `LeaseRenewalWorker` | B | `BatchFlusher<RenewalRequest>` | |
| `TransportConsumerWorker` | C | Transport subscription | |
| `ServiceBusConsumerWorker` | C | ASB receiver loop | |
| `HeartbeatWorker` | E | 30 s default; adaptive 60 s when alive-lock held (slice 7b) | See [instance liveness](./instance-liveness.md) |
| `MaintenanceWorker` | E | 5 min | Full-table scan; not event-driven |
| `RecentlyProcessedEventCacheSweepWorker` | E | 60 s | In-memory TTL eviction |
| `OrphanInboxJanitor` | F | StartAsync once | |
| `PerspectiveMigrationWorker` | F | On-demand rebuild | |

## When to read this page

- Adding a new worker → pick the right class and cite the existing examples.
- Reviewing a worker's cadence → confirm the class is honoured (e.g. an A-class worker MUST have a NOTIFY subscription, not just a backstop poll).
- Investigating a "why isn't this worker waking" → start with the column "Cadence / driver" and trace it to the source.

## Related

- [PerspectiveWorker NOTIFY wake](./perspective-worker-notify.md)
- [Instance liveness](./instance-liveness.md)
- [Pinned connection pool](./pinned-connection-pool.md)
- [Notifications & pgbouncer](../work-coordinator/notifications-and-pgbouncer.md)
