---
title: Performance tuning
order: 8
---

# Performance tuning

Decision guide for the work coordinator's performance knobs. Defaults are tuned for typical SaaS workloads; tune from defaults when measurement shows a specific bottleneck.

## Idle CPU is too high

**Symptom:** Postgres `pg_stat_statements` shows high call rate of `claim_work` (or legacy `process_work_batch`) on a quiet stack.

**Diagnosis:** Polling cadence too aggressive, or notification listener unhealthy (forcing fast polling), or `claim_work` empty-call short-circuit not engaging.

**Fix:**
1. Confirm `IWorkNotificationListener.IsHealthy = true`. If not, set up the `<dbname>-direct` connection string per [notifications-and-pgbouncer](notifications-and-pgbouncer.md).
2. Verify `claim_work` returns ≤ 1 ms on empty queues:
   ```sql
   SELECT calls, mean_exec_time, total_exec_time FROM pg_stat_statements
   WHERE query LIKE '%claim_work%' ORDER BY total_exec_time DESC;
   ```
3. Increase `Whizbang:WorkCoordinator:PollingMaxIntervalMilliseconds` if your stale-threshold budget allows (cap is `AbandonStaleInstanceThresholdSeconds × 1000 / 3` — auto-clamped).

## Burst latency is too high

**Symptom:** When a transport message arrives at service A, service B takes seconds to start handling it.

**Diagnosis:** Notification not firing, or listener unhealthy, or polling fallback at default 30 s.

**Fix:**
1. Verify `pg_notify` fires inside `commit_handler_result`. Quick check via a side-channel listener:
   ```bash
   psql -d <dbname> -c "LISTEN wh_work;"
   # do something that should commit handler results, watch for output
   ```
2. Confirm the receiving service's `IsHealthy = true`.
3. Lower `Whizbang:Notifications:PollingFallbackInterval` if you can't tolerate 30 s gaps when the listener is briefly down. 10 s is a reasonable lower bound; below that, idle CPU starts climbing.

## Inbox handler throughput is too low

**Symptom:** Handlers processed at ~200/s under load; expected 2000/s+.

**Diagnosis:** `InboxHandlerWorker` is committing one handler at a time instead of batching, OR `commit_handler_batch` is falling back to all-or-nothing semantics.

**Fix:**
1. Verify `Whizbang:Flushers:InboxHandler:Flusher:CoalesceWindowMs` is non-zero (default 25). Setting to 0 forces single-handler-per-call.
2. Verify `IWorkCoordinatorCapabilities.SupportsSavepoints = true` (Postgres always does; future engines may not).
3. Increase `Whizbang:Flushers:InboxHandler:Flusher:MaxBatchSize` if individual handlers complete fast. Defaults assume 100 max — raising to 500-1000 helps at very high throughput.

## Outbox publish throughput is too low

**Symptom:** Outbox messages publish slowly under burst load.

**Diagnosis:** Transport throughput, not Whizbang.

**Fix:** Tune transport (e.g., Service Bus `MaxConcurrentSessions`, `PrefetchCount`, RabbitMQ prefetch). The completion flusher's `CoalesceWindowMs=10` (default) is already aggressive enough for any realistic transport rate.

## WAL pressure is too high

**Symptom:** Postgres logs `WalSync` waits, replication lag spikes, fsync time climbs.

**Diagnosis:** Too many small commits. Each `commit_handler_result` is its own commit; high inbox-handler throughput means many fsyncs.

**Fix:**
1. Use `commit_handler_batch` (the throughput multiplier). Default `InboxHandlerWorker` already does this; verify Nagle is engaging (look for batch sizes in metrics).
2. Increase `MaxBatchSize` for inbox handlers if you have rooms (latency budget vs WAL pressure).
3. Coalesce more aggressively (longer `CoalesceWindowMs`) — trade latency for fsync count.

## Specific scenarios

### Tight burst tolerance (sub-100ms latency goal)

- `PollingIntervalMilliseconds = 100` (faster base poll for the rare cases NOTIFY missed)
- `PollingMaxIntervalMilliseconds = 1000` (tight backoff cap)
- `PollingFallbackInterval = TimeSpan.FromSeconds(5)` (aggressive safety net)
- Confirm notifications healthy; this combo wastes CPU otherwise.

### Quiet workload, want minimum idle CPU

- `PollingIntervalMilliseconds = 1000`
- `PollingMaxIntervalMilliseconds = 30000` (only if `AbandonStaleInstanceThresholdSeconds ≥ 90` so the cap is allowed)
- `Heartbeat:IntervalSeconds = 10`
- Listener healthy → idle CPU near zero.

### Drain-heavy workload (large bursts, throughput matters)

- `MaxStreamsPerBatch = 5000` (claim more per call)
- `Flushers:OutboxCompletion:Flusher:MaxBatchSize = 2000`
- `Flushers:InboxHandler:Flusher:MaxBatchSize = 500`
- `Flushers:InboxHandler:Flusher:CoalesceWindowMs = 50` (let more handlers coalesce per fsync)
- Watch postgres CPU — at this size, claim_work mean_exec_time may climb beyond 5 ms.

## Measurement

Before tuning, capture a baseline:

```bash
# pg_stat_statements
SELECT calls, round(mean_exec_time::numeric, 2) AS mean_ms,
       round(total_exec_time::numeric, 0) AS tot_ms, rows
FROM pg_stat_statements
WHERE query NOT ILIKE '%pg_stat%'
ORDER BY total_exec_time DESC LIMIT 20;

# postgres CPU
docker stats <postgres-container> --no-stream

# WAL position diff over a measurement window
SELECT pg_current_wal_lsn();
-- wait N seconds, run again, diff
```

After tuning, re-measure. If it didn't move, the bottleneck was elsewhere.

## Related

- [Configuration reference](configuration-reference.md)
- [Notifications and pgbouncer](notifications-and-pgbouncer.md)
- [Failure and recovery](failure-and-recovery.md)
