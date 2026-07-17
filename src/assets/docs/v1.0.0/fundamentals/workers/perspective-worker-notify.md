---
title: PerspectiveWorker NOTIFY Wake
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Fundamentals
order: 7
description: >-
  PerspectiveWorker subscribes to WorkSignalCategory.Perspective NOTIFY
  signals to eliminate idle polling. Polling stays as a safety-net cadence.
tags: 'workers, notify, perspective, polling, signals'
codeReferences:
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
  - src/Whizbang.Core/Notifications/IWorkNotificationListener.cs
testReferences:
  - tests/Whizbang.Core.Tests/Workers/PerspectiveWorkerStartupAndMaintenanceTests.cs
  - tests/Whizbang.Core.Tests/Workers/PerspectiveWorkerDeepPathChannelTests.cs
  - tests/Whizbang.Core.Tests/Workers/V502DefaultsTests.cs
---

# PerspectiveWorker NOTIFY wake

`WorkSignalCategory.Perspective` already fires from the database on every `wh_perspective_events` insert — the producer trigger has been live for releases. Until v0.681 the signal had no consumer, so `PerspectiveWorker` spun on a 1 s default poll loop regardless of actual perspective_event arrival.

This page documents the consumer subscription added in slice 7a.

## Wake mechanism

```mermaid
graph LR
  Producer[Producer commits<br/>wh_perspective_events row] -->|trigger fires| PG[(PostgreSQL<br/>NOTIFY 'perspective')]
  PG -->|LISTEN dispatch| Listener[IWorkNotificationListener]
  Listener -->|OnSignal(Perspective)| Worker[PerspectiveWorker._perspectiveWake.Release]
  Worker -->|Task.WhenAny wins| Drain[Scan + drain]
```

The worker's main `Task.WhenAny` now races the standard channel-readers, the safety-net `Task.Delay`, AND the wake semaphore. Whichever completes first triggers the drain.

## Options

| Property | Default | Used when |
|---|---|---|
| `PollingIntervalMilliseconds` | `1000` | NOTIFY listener is null / disabled — the worker falls back to this cadence so an outage doesn't introduce latency |
| `NotifyHealthyPollingIntervalMilliseconds` | `1000` | NOTIFY listener is wired — safety-net cadence (signal does the actual wake). Ships equal to the poll interval; raise it (e.g. `30000`+) to relax the safety net on hosts with reliable LISTEN connections |

The worker picks the max of the two when a listener is wired, so leaving `NotifyHealthyPollingIntervalMilliseconds = PollingIntervalMilliseconds` (the shipped default) means no relaxed cadence. The tight default is deliberate: new streams not yet present in `wh_active_streams` receive no per-instance NOTIFY on their first batch, so the safety net must catch them quickly.

## Operator notes

- When no `IWorkNotificationListener` is registered (legacy / no-direct-conn hosts), behaviour is bit-for-bit identical to pre-v0.681.
- The signal handler filters by `category == Perspective`; Outbox/Inbox/OrphanRedistribute don't wake this worker.
- `StopAsync` unsubscribes symmetrically; a host restart doesn't double-subscribe.

## Verification

After deploy, `pg_stat_statements` filtered to your service's database should show the perspective-fetch-shaped query call count drop sharply during idle periods once the safety-net cadence is relaxed (e.g. ~4 calls/sec on 250 ms poll-only vs ~0.03/sec at a 30 s safety-net cadence). The `whizbang.perspective.empty_batches` counter (idle wake cycles that found no work) is the observability signal that the loop is no longer poll-spinning.

## Related

- [Worker classification](./worker-classification.md) — which workers are NOTIFY-driven, channel-driven, or timer-driven.
- [Instance liveness](./instance-liveness.md) — the direct LISTEN connection also carries the advisory-lock liveness signal.
- [Pinned connection pool](./pinned-connection-pool.md) — how NOTIFY + worker traffic split across direct and pooled connections.
