---
title: PerspectiveWorker NOTIFY Wake
version: 1.0.0
category: Fundamentals
order: 7
description: >-
  PerspectiveWorker subscribes to WorkSignalCategory.Perspective NOTIFY
  signals to eliminate idle polling. Polling stays as a safety-net cadence.
tags: 'workers, notify, perspective, polling, signals'
codeReferences:
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
---

# PerspectiveWorker NOTIFY wake

`WorkSignalCategory.Perspective` already fires from the database on every `wh_perspective_events` insert — the producer trigger has been live for releases. Until v0.681 the signal had no consumer, so `PerspectiveWorker` spun on a 1 s default poll loop regardless of actual perspective_event arrival.

This page documents the consumer subscription added in slice 7a.

## Wake mechanism

```mermaid
graph LR
  Producer[Producer commits<br/>wh_perspective_events row] -->|trigger fires| PG[(PostgreSQL<br/>NOTIFY 'perspective')]
  PG -->|LISTEN dispatch| Listener[IWorkNotificationListener]
  Listener -->|OnSignal(Perspective)| Worker[PerspectiveWorker._wake.Release]
  Worker -->|Task.WhenAny wins| Drain[Scan + drain]
```

The worker's main `Task.WhenAny` now races the standard channel-readers, the safety-net `Task.Delay`, AND the wake semaphore. Whichever completes first triggers the drain.

## Options

| Property | Default | Used when |
|---|---|---|
| `PollingIntervalMilliseconds` | `1000` | NOTIFY listener is null / disabled — the worker falls back to this cadence so an outage doesn't introduce latency |
| `NotifyHealthyPollingIntervalMilliseconds` | `30000` | NOTIFY listener is wired — relaxed safety-net cadence (signal does the actual wake) |

The worker picks the max of the two when a listener is wired, so setting `NotifyHealthyPollingIntervalMilliseconds = PollingIntervalMilliseconds` disables the relaxed cadence entirely.

## Operator notes

- When no `IWorkNotificationListener` is registered (legacy / no-direct-conn hosts), behaviour is bit-for-bit identical to pre-v0.681.
- The signal handler filters by `category == Perspective`; Outbox/Inbox/OrphanRedistribute don't wake this worker.
- `StopAsync` unsubscribes symmetrically; a host restart doesn't double-subscribe.

## Verification

After deploy, `pg_stat_statements` filtered to slot 3 should show the `fetch_perspective_events`-shaped query call count drop sharply during idle periods (was ~4 calls/sec on poll-only; expect ~0.03/sec on safety-net cadence). The new tick attribute on `whizbang.perspective.tick.duration` carries `triggered_by={notify,safety_net}` so observability dashboards can confirm the wake path is actually NOTIFY-driven.

## Related

- [Notifications & pgbouncer](../work-coordinator/notifications-and-pgbouncer.md) — overall LISTEN/NOTIFY topology.
- [Worker classification](./worker-classification.md) — which workers are NOTIFY-driven, channel-driven, or timer-driven.
