---
title: Claim loop
order: 2
---

# Claim loop

`ClaimWorker` is the only worker that polls the database. Every other worker is producer/consumer-driven (channel reads, bounded buffers, on-demand). This page describes the claim loop's design and tunables.

## What it does

```
loop:
  await wake (semaphore released by NOTIFY signal | local channel produce | adaptive timeout)
  workBatch = await coordinator.ClaimWorkAsync(req, ct)
  if workBatch.OutboxWork ∪ InboxWork ∪ PerspectiveStreamIds is non-empty:
    consecutiveEmptyPolls = 0
    OnBatchClaimed(workBatch)         ← downstream wiring (channels)
  else:
    consecutiveEmptyPolls++
  await semaphore.WaitAsync(adaptivePollWaitMs)
```

Three things make this efficient:

1. **Empty-call short-circuit in `claim_work` SQL** — when no work exists, the function returns in ≤ 1 ms (vs the legacy 17 ms floor).
2. **Adaptive backoff** — empty polls double the wait until `PollingMaxIntervalMilliseconds` (10 s default).
3. **Wake semaphore** — `RequestImmediatePoll()` releases the wait so notifications and local producers wake the worker immediately.

## Adaptive backoff

```
empty-poll #0 → wait base (250 ms)
empty-poll #1 → wait 250 ms     (no backoff yet — first non-empty resets)
empty-poll #2 → wait 500 ms
empty-poll #3 → wait 1000 ms
empty-poll #4 → wait 2000 ms
empty-poll #5 → wait 4000 ms
empty-poll #6+ → wait 10 000 ms (cap)

ANY non-empty result → reset to base (250 ms)
```

The adaptive cap is auto-clamped at startup to `AbandonStaleInstanceThresholdSeconds × 1000 / 3` so the heartbeat budget stays satisfied.

## Wake signals

Three sources can release the wake semaphore:

| Source | When |
|---|---|
| **NOTIFY listener** (`PgWorkNotificationListener.OnSignal`) | A peer (or this instance) commits `commit_handler_result` and emits `pg_notify('wh_work', ...)`. |
| **Local channel produce** | A producer in this process queues new work via `IOutboxChannelWriter.WriteAsync` and signals via `OnNewWorkAvailable`. |
| **Adaptive timeout** | The current backoff window expires. |

Wake is idempotent: multiple producers calling `RequestImmediatePoll()` between ticks coalesce into one wake (semaphore capacity = 1).

## RAISE NOTICE in-band signaling

When `claim_work` returns a full batch (more eligible work than `p_max_streams`), it `RAISE NOTICE 'whizbang.has_more=true'`. The C# claim worker can subscribe to `NpgsqlConnection.Notice` and use this as an in-band drain signal — skip the wait, re-poll immediately. This survives pgbouncer (it's a protocol message, not session state).

This is currently a hint; the polling loop's adaptive backoff will reset to base on the next non-empty result regardless.

## Distribution to channels

When `claim_work` returns work, the C# coordinator deserializes envelopes and produces an `OutboxWork`/`InboxWork`/`PerspectiveStreamIds` shape. `ClaimWorker.OnBatchClaimed` fires; downstream consumers (or DI-wired channel writers in production) route to:

- `OutboxWork` → `IWorkChannelWriter` → consumed by `OutboxPublishWorker`
- `InboxWork` → `IInboxChannelWriter` → consumed by inbox dispatch path
- `PerspectiveStreamIds` → `IPerspectiveChannelWriter` → consumed by `PerspectiveProcessWorker`

Stream order within a partition is preserved by the SQL function; the channel itself preserves FIFO.

## Configuration

| Knob | Default | Effect |
|---|---|---|
| `PollingIntervalMilliseconds` | 250 | Base poll cadence. |
| `PollingMaxIntervalMilliseconds` | 10 000 | Adaptive backoff cap. Clamped to ≤ stale-threshold/3. |
| `MaxStreamsPerBatch` | 1000 | Cap on rows returned per call. |
| `PartitionCount` | 10 000 | Modulo partition count. |
| `LeaseSeconds` | 300 | Lease duration on claimed work. |

## Observability

`ClaimWorker.OnBatchClaimed` fires per non-empty tick — wire to your metrics for batch-size histograms.

The notification listener exposes `IsHealthy` + `OnHealthChanged`; expose via `/health/notifications` for ops dashboards.

## Failure modes

| Failure | Behavior |
|---|---|
| `ClaimWorkAsync` throws | Log warn, increment empty-poll counter (back off), retry on next tick. |
| Pooled connection unreachable | Existing `WorkerRetryOptions` exponential backoff. |
| Notification listener unhealthy | `OnHealthChanged(false)` fires; claim worker can flip to fast polling cadence (current implementation: subscribers can wire this; the default ClaimWorker doesn't yet). |

## Related

- [Notifications and pgbouncer](notifications-and-pgbouncer.md)
- [Configuration reference](configuration-reference.md)
- [Failure and recovery](failure-and-recovery.md)
- [Handler commit](handler-commit.md)
