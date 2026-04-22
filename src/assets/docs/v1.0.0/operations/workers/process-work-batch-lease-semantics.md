---
title: Process Work Batch — Lease & Heartbeat Semantics
version: 1.0.0
category: Workers
order: 4
description: >-
  How WorkCoordinatorPublisherWorker paces its ticks and when it refreshes
  stream leases and instance heartbeats. Covers the conditional-refresh guards,
  the adaptive poll-interval backoff, tuning knobs, and failover SLAs.
tags: >-
  work-coordinator, process-work-batch, lease-renewal, heartbeat, polling,
  backoff, wal, instance-stickiness, orphan-claim
codeReferences:
  - src/Whizbang.Core/Workers/WorkCoordinatorPublisherWorker.cs
  - src/Whizbang.Data.Postgres/Migrations/029_ProcessWorkBatch.sql
  - src/Whizbang.Data.Postgres/Migrations/010_RegisterInstanceHeartbeat.sql
  - src/Whizbang.Data.Postgres/Migrations/011_CleanupStaleInstances.sql
testReferences:
  - >-
    tests/Whizbang.Data.Dapper.Postgres.Tests/ProcessWorkBatchLeaseRenewalTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreLeaseRenewalTests.cs
  - >-
    tests/Whizbang.Core.Tests/Workers/WorkCoordinatorPublisherWorkerDrainTests.cs
---

# Process Work Batch — Lease & Heartbeat Semantics

`WorkCoordinatorPublisherWorker` polls `process_work_batch` periodically to discover new work, renew leases, refresh heartbeats, and evict stale instances. This page documents three contracts that shape its write volume and failover behaviour:

1. **Stream lease refresh** is conditional — near-expiry only.
2. **Instance heartbeat** is conditional — fresh heartbeats are skipped.
3. **Poll interval** is adaptive — doubles on consecutive empty polls up to a configurable cap.

Together these reduce per-tick UPDATE volume by 100× or more on idle services while preserving the failover SLA.

## Stream lease refresh

When an instance owns a stream (present in `wh_active_streams.assigned_instance_id`), the worker refreshes `lease_expiry` to `now() + p_lease_duration_seconds` so another instance doesn't re-claim it while the current owner is still live. Historically this was unconditional — every tick rewrote every owned stream's row.

### The guard

Migration 029 (`process_work_batch`) tracks a refresh threshold alongside the computed expiry:

```sql
v_lease_expiry      := p_now + (p_lease_duration_seconds          || ' seconds')::INTERVAL;
v_refresh_threshold := p_now + ((p_lease_duration_seconds / 3)    || ' seconds')::INTERVAL;
```

and guards the end-of-tick UPDATE:

```sql
UPDATE wh_active_streams
SET lease_expiry = v_lease_expiry
WHERE assigned_instance_id = p_instance_id
  AND lease_expiry < v_refresh_threshold;
```

**Meaning.** A stream whose lease expires in more than `p_lease_duration_seconds / 3` seconds from now is left alone. With the default 300 s lease duration, that means a freshly-renewed stream is not touched again for another ~200 seconds.

### Tuning `p_lease_duration_seconds`

The refresh window is always one-third of the lease duration. Lowering the lease shortens both the refresh cadence (higher write volume) and the orphan-detection window (faster failover):

| `p_lease_duration_seconds` | Refresh cadence per stream | Max time to orphan detection |
|----------------------------|----------------------------|------------------------------|
| 60 (aggressive) | ~20 s | 60 s |
| 300 (default) | ~200 s | 300 s |
| 900 | ~600 s | 900 s |

### Why the orphan SLA is unchanged

The guard only affects *refresh* — it does not affect *expiry*. When an instance dies, its stream's `lease_expiry` still elapses at the same wall-clock time as before (the last refresh + `p_lease_duration_seconds`). Cross-instance orphan claims still gate on `now() > lease_expiry`, so the maximum time to re-claim an orphaned stream is unchanged at `p_lease_duration_seconds`.

## Instance heartbeat

`register_instance_heartbeat` is called on every `process_work_batch` tick. It upserts the instance row in `wh_service_instances`, updating `last_heartbeat_at` to `p_now`. `cleanup_stale_instances` removes any instance whose heartbeat is older than `p_stale_threshold_seconds` (default **30 s**).

### The guard

Migration 010 now skips the UPDATE side of the UPSERT when the existing heartbeat is already fresh:

```sql
ON CONFLICT (instance_id) DO UPDATE SET
  last_heartbeat_at = p_now,
  metadata          = COALESCE(EXCLUDED.metadata, wh_service_instances.metadata)
WHERE wh_service_instances.last_heartbeat_at < p_now - interval '10 seconds';
```

**Meaning.** If the instance heartbeated less than 10 s ago, the UPDATE is skipped entirely. With the default poll interval (250 ms) that takes a heartbeat write rate of `~4 / sec / pod` down to `~0.1 / sec / pod`.

### Why 10 s

It has to be strictly less than `p_stale_threshold_seconds` (default 30 s) or an instance would go stale between forced refreshes. 10 s leaves a **20 s safety margin**: at worst the heartbeat is 10 s old when the next tick fires, still 20 s inside the stale cutoff.

If you shorten `p_stale_threshold_seconds` for faster failure detection, the 10 s window is still safe down to thresholds of around 15 s. Below that, the heartbeat-freshness constant should be reduced in lock-step.

## Adaptive poll interval

Locally-produced work bypasses the poll timer altogether: `IWorkChannelWriter.OnNewWorkAvailable` and `IInboxChannelWriter.OnNewInboxWorkAvailable` raise `RequestImmediatePoll()`, releasing the internal `_pollWakeSignal` semaphore and making the next tick fire immediately.

The periodic tick exists to cover:

- Transport-received inbox writes (no in-process signal — the transport consumer writes straight to `wh_inbox`).
- Orphan claim and lease-expiry enforcement.
- Scheduled / deferred `wh_inbox.scheduled_for` promotion.
- Heartbeat + lease renewal.

### The backoff

When `process_work_batch` returns no work, `_consecutiveEmptyPolls` is incremented. The worker's wait doubles per empty poll up to a configurable cap:

| `_consecutiveEmptyPolls` | Wait (ms, default base = 250, max = 2000) |
|--------------------------|-------------------------------------------|
| 0 (work found this tick) | 250 |
| 1 | 500 |
| 2 | 1000 |
| 3 and above | **2000** (capped) |

Any non-empty batch resets `_consecutiveEmptyPolls` to zero (via `_trackWorkStateTransitions(hasWork)`), so the first empty poll after activity waits the base interval again.

### Wake-signal interruption

`RequestImmediatePoll()` works regardless of the current backoff depth — it releases the semaphore and the wait returns immediately. The adaptive path only affects the *timeout* on the wait, not its *interruptibility*.

### Tuning the cap

`WorkCoordinatorPublisherOptions.PollingMaxIntervalMilliseconds` (default 2000):

- **Larger** caps reduce idle write load further but increase worst-case latency for transport-received work discovery (up to the cap).
- **Set equal to `PollingIntervalMilliseconds`** to disable backoff entirely (kill-switch — restores the pre-fix fixed-interval behaviour with zero other code changes).
- **Lower** caps (e.g. 1000 ms) for services that receive bursts of transport-sourced work and need faster pickup at the cost of some idle overhead.

## Tests

- **Dapper**: `ProcessWorkBatchLeaseRenewalTests.cs` — 5 scenarios covering the lease-fresh no-op, near-expiry refresh, orphan SLA, heartbeat-fresh no-op, and heartbeat-stale refresh.
- **EFCore**: `EFCoreLeaseRenewalTests.cs` — single mirror test proving the guard applies through the EFCore work coordinator too (the guard lives in the Postgres function body).
- **Backoff**: `WorkCoordinatorPublisherWorkerDrainTests.cs` — 4 scenarios covering the doubling schedule, reset on non-empty batch, wake-signal interruption, and kill-switch.

## See also

- [Stream locking](../../fundamentals/perspectives/stream-locking)
- [Perspective worker](perspective-worker)
- [Work coordination overview](../../messaging)
