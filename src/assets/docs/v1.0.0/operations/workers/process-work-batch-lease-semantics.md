---
title: Work Pump — Lease & Heartbeat Semantics
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Workers
order: 4
description: >-
  How the decomposed work pump (ClaimWorker, HeartbeatWorker,
  LeaseRenewalWorker) paces polling, renews work-row leases, and refreshes
  instance heartbeats. Covers the renew_leases and record_heartbeat SQL
  functions, the adaptive poll-interval backoff, tuning knobs, and failover
  SLAs.
tags: >-
  work-coordinator, claim-work, renew-leases, record-heartbeat, lease-renewal,
  heartbeat, polling, backoff, wal, orphan-claim
codeReferences:
  - src/Whizbang.Core/Workers/ClaimWorker.cs
  - src/Whizbang.Core/Workers/HeartbeatWorker.cs
  - src/Whizbang.Core/Workers/LeaseRenewalWorker.cs
  - src/Whizbang.Core/Workers/LeaseHandleOptions.cs
  - src/Whizbang.Data.Postgres/Migrations/029_ProcessWorkBatch.sql
  - src/Whizbang.Data.Postgres/Migrations/011_CleanupStaleInstances.sql
testReferences:
  - tests/Whizbang.Core.Tests/Workers/ClaimWorkerTests.cs
  - tests/Whizbang.Core.Tests/Workers/ClaimWorkerGateCadenceTests.cs
  - tests/Whizbang.Core.Tests/Workers/HeartbeatWorkerAdaptiveCadenceTests.cs
  - tests/Whizbang.Core.Tests/Workers/LeaseRenewalWorkerCapTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ClaimWorkSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/RenewLeasesSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/RecordHeartbeatSqlTests.cs
---

# Work Pump — Lease & Heartbeat Semantics

:::updated
The monolithic `process_work_batch` orchestrator has been **dropped** (migration `029_ProcessWorkBatch.sql` removes it at the top of the file) and decomposed into focused SQL functions, each paired with a dedicated C# worker:

| Concern | SQL function | C# worker |
|---------|--------------|-----------|
| Claiming + orphan reclaim | `claim_work` | `ClaimWorker` (the only caller of `IWorkCoordinator.ClaimWorkAsync`) |
| Instance heartbeat | `record_heartbeat` | `HeartbeatWorker` (own timer, decoupled from polling) |
| Lease renewal | `renew_leases` | `LeaseRenewalWorker` (coalesced batch flusher) |
| Stale-instance eviction | `cleanup_stale_instances` | Opportunistic via `record_heartbeat` + `MaintenanceWorker` backstop |

`WorkCoordinatorPublisherWorker` no longer exists; this page describes the shipped decomposition.
:::

This page documents three contracts that shape the work pump's write volume and failover behaviour:

1. **Work-row lease renewal** is explicit and capped — the `LeaseRenewalWorker` extends leases for in-flight work, and a per-work renewal cap surfaces hung handlers.
2. **Instance heartbeat** runs on its own timer with an adaptive cadence — slow while the session alive-lock proves liveness, fast otherwise.
3. **Poll interval** is adaptive — doubles on consecutive empty polls up to a configurable cap, with LISTEN/NOTIFY wake signals bypassing the wait entirely.

## Work-row leases

`claim_work` leases work rows to the calling instance by setting `instance_id` and `lease_expiry = NOW() + p_lease_seconds` (default **300 s**, from `ClaimWorkerOptions.LeaseSeconds`). Leases apply per row:

- `wh_outbox` / `wh_inbox` rows, keyed by `message_id`
- `wh_perspective_events` rows, keyed by `event_work_id`

A row is claimable by another instance only when it is unprocessed AND either unowned or expired — the orphan predicate used by the per-category guards inside `claim_work`:

```sql{
title: "Orphan-claim eligibility predicate"
description: "claim_work only invokes a claim_orphaned_* sub-function when at least one row in that category is unprocessed and either unowned or lease-expired."
category: "Workers"
difficulty: "ADVANCED"
tags: ["work-coordinator", "claim-work", "orphan-claim", "lease-expiry", "sql"]
}
IF EXISTS (
  SELECT 1 FROM wh_outbox
  WHERE processed_at IS NULL
    AND (instance_id IS NULL OR lease_expiry < v_now)
  LIMIT 1
) THEN
  PERFORM claim_orphaned_outbox(...);
END IF;
```

### Renewal — `renew_leases`

Long-running dispatches renew their leases through `renew_leases(p_category, p_ids, p_lease_seconds DEFAULT 300)`. It sets `lease_expiry = NOW() + p_lease_seconds` for the supplied ids in the chosen category table (`outbox`, `inbox`, or `perspective_event`), skips rows already processed, returns the rows-affected count, and raises on an unknown category.

On the C# side, dispatch workers enqueue `(category, work_id)` pairs onto `ILeaseRenewalChannel`; `LeaseRenewalWorker` coalesces them through a `BatchFlusher` (defaults: max batch 200, coalesce window 200 ms, immediate-flush threshold 100, channel capacity 5 000) and calls `IWorkCoordinator.RenewLeasesAsync` per category.

### The renewal cap

Every dispatch holds a `LeaseHandle` whose token cancels at `lease_expiry − LeaseGraceSeconds` (default **30 s** of grace). `LeaseRenewalWorker` consults the handle before each DB renewal:

- `TryExtendDeadline` succeeds → the id is included in the `renew_leases` call.
- The handle has hit `MaxRenewalsPerWork` (default **6**) or is disposed → the id is *skipped*. The DB lease expires naturally, `claim_orphaned_*` re-issues the row with a bumped `attempts` count, and the hung handler surfaces through the standard failure path instead of being silently renewed forever.

At the default 300 s lease and 6 renewals, a single dispatch gets up to ~30 minutes of extension budget.

### Failover SLA

Cross-instance orphan claims gate on `lease_expiry < NOW()`. When an instance dies, its rows become claimable at their last-renewed expiry — worst case `LeaseSeconds` (default 300 s) after the final renewal. Instance death is additionally detected by heartbeat staleness (below), which releases all of a dead instance's leases at once.

## Instance heartbeat

`HeartbeatWorker` calls `record_heartbeat` on its own timer, independent of the polling cadence. `record_heartbeat` is a plain UPSERT into `wh_service_instances` — it unconditionally updates `last_heartbeat_at = NOW()` — plus an opportunistic stale-peer sweep:

```sql{
title: "Opportunistic stale-peer cleanup inside record_heartbeat"
description: "record_heartbeat UPSERTs the caller's row, then runs cleanup_stale_instances only when a cheap indexed EXISTS probe finds a peer whose heartbeat is older than the 30 s stale cutoff."
category: "Workers"
difficulty: "ADVANCED"
tags: ["work-coordinator", "heartbeat", "record-heartbeat", "cleanup-stale-instances", "sql"]
}
v_stale_cutoff           := NOW() - INTERVAL '30 seconds';
v_definitive_dead_cutoff := NOW() - INTERVAL '5 minutes';

-- UPSERT own row, then:
IF EXISTS (
  SELECT 1 FROM wh_service_instances
  WHERE last_heartbeat_at < v_stale_cutoff
    AND instance_id != p_instance_id
  LIMIT 1
) THEN
  PERFORM cleanup_stale_instances(v_stale_cutoff, v_definitive_dead_cutoff);
END IF;
```

`cleanup_stale_instances(p_stale_cutoff, p_definitive_dead_cutoff DEFAULT NULL)` deletes stale rows and releases all their leased work (`instance_id = NULL, lease_expiry = NULL` across `wh_outbox`, `wh_inbox`, `wh_perspective_events`). Two guards refine the staleness decision:

- **Alive-lock guard**: a row whose session-level advisory alive-lock (migration 055) is still held in `pg_locks` is *not* deleted, even past the stale cutoff — the lock is the primary liveness signal under the adaptive heartbeat cadence.
- **Definitive-dead bypass**: a heartbeat older than `p_definitive_dead_cutoff` (5 minutes on the `record_heartbeat` path) bypasses the alive-lock guard. This covers OOM-killed pods on half-open TCP, where the server-side session can hold the advisory lock until OS keepalive fires (~2 h default on Linux).

### Adaptive cadence

`HeartbeatWorkerOptions` controls the timer:

| Option | Default | Meaning |
|--------|---------|---------|
| `IntervalSeconds` | 30 | Fast cadence — used when the alive-lock is not held (or `LivenessSourceMode = HeartbeatTableOnly`) |
| `SlowIntervalSeconds` | 60 | Slow cadence — used while the session alive-lock is held (lock proves liveness; the table write is a fallback) |
| `LivenessSourceMode` | `AdvisoryLockWhenAvailable` | Set `HeartbeatTableOnly` to force the fast cadence regardless of lock state |
| `Enabled` | `true` | Killswitch — disabling lets peers flag this instance stale, useful for graceful drain |

A legacy `register_instance_heartbeat` function (migration 010) still exists with a 10-second freshness guard on its UPDATE path, but the shipped coordinator path (`IWorkCoordinator.RecordHeartbeatAsync`) calls `record_heartbeat`.

## Adaptive poll interval

`ClaimWorker` is the only place that calls `IWorkCoordinator.ClaimWorkAsync`. Locally-produced work bypasses the poll timer altogether: `IWorkChannelWriter.OnNewWorkAvailable`, `IInboxChannelWriter.OnNewInboxWorkAvailable`, LISTEN/NOTIFY signals (`Outbox`, `Inbox`, `OrphanRedistribute`), and NOTIFY-gate availability transitions all raise `RequestImmediatePoll()`, releasing the internal wake semaphore so the next tick fires immediately.

The periodic tick exists to cover:

- Work whose owning instance is unknown to `notify_instance_owners` (no routed NOTIFY is emitted for unclaimed streams).
- Orphan claim and lease-expiry enforcement.
- Scheduled / deferred promotion.
- Anything missed while LISTEN/NOTIFY is unhealthy.

### The backoff

When a poll returns no work (or errors), `_consecutiveEmptyPolls` is incremented. The wait doubles starting at the *second* consecutive empty poll, up to a cap:

```
wait = min(base << min(emptyPolls - 1, 10), PollingMaxIntervalMilliseconds)
```

| Consecutive empty polls | Wait (ms, base = 250, max = 10 000) |
|-------------------------|--------------------------------------|
| 0 (work found this tick) | 250 |
| 1 | 250 |
| 2 | 500 |
| 3 | 1000 |
| 4 | 2000 |
| 7 and above | **10 000** (capped) |

Any non-empty batch resets `_consecutiveEmptyPolls` to zero, so the first wait after activity is the base interval again.

### NOTIFY-gate interaction

The `INotifySignalingGate` modulates the baseline:

- **Gate unavailable** (LISTEN/NOTIFY broken): the loop pins to the tight `PollingIntervalMilliseconds` base — backoff is suspended so a listener outage never silently stretches claim latency.
- **Gate healthy + `NotifyHealthyPollingIntervalMilliseconds` set** (default **5 000 ms**): the relaxed value replaces the tight base as the backoff's starting point (only when greater than the base). Set it to `null` to restore tight polling always.
- **Gate healthy + `EnableSafetyNetPoll = false`**: pure NOTIFY-only mode — the loop sleeps indefinitely until an actual signal arrives. The safety net re-engages automatically the moment the gate flips unavailable.

### Wake-signal interruption

`RequestImmediatePoll()` works regardless of the current backoff depth — it releases the semaphore and the wait returns immediately. The adaptive path only affects the *timeout* on the wait, not its *interruptibility*.

### Tuning knobs (`ClaimWorkerOptions`)

| Option | Default | Notes |
|--------|---------|-------|
| `PollingIntervalMilliseconds` | 250 | Tight base cadence (used when NOTIFY is unhealthy) |
| `PollingMaxIntervalMilliseconds` | 10 000 | Backoff cap. Set ≤ the base interval to disable backoff entirely (kill-switch) |
| `NotifyHealthyPollingIntervalMilliseconds` | 5 000 | Relaxed baseline while NOTIFY is healthy; `null` restores tight polling |
| `EnableSafetyNetPoll` | `true` | `false` = pure NOTIFY-only when the gate is healthy |
| `MaxStreamsPerBatch` | 1000 | Cap on rows per `claim_work` call; filling it triggers the drain-mode `whizbang.has_more` re-poll hint |
| `LeaseSeconds` | 300 | Lease duration applied to claimed work |
| `PartitionCount` | 10 000 | Modulo partition count |
| `Enabled` | `true` | Killswitch for the claim loop |

## Tests

- **ClaimWorker**: `ClaimWorkerTests.cs` — initial heartbeat before first claim, wake-signal bypass, killswitch, schema gate, drain-channel distribution.
- **Gate cadence + backoff**: `ClaimWorkerGateCadenceTests.cs` — backoff stretches to max when healthy, pins to base when unavailable, relaxed-baseline override, NOTIFY-only mode, reconnect/startup catch-up.
- **Heartbeat cadence**: `HeartbeatWorkerAdaptiveCadenceTests.cs` — fast/slow cadence selection across lock states and `LivenessSourceMode`.
- **Renewal cap**: `LeaseRenewalWorkerCapTests.cs` — renewal bumps handle count, cap stops DB renewals, disposed handles skipped, null-registry fallback.
- **SQL**: `ClaimWorkSqlTests.cs`, `RenewLeasesSqlTests.cs`, `RecordHeartbeatSqlTests.cs` — function existence and lease/heartbeat effects against a live Postgres.

## See also

- [Stream locking](../../fundamentals/perspectives/stream-locking)
- [Perspective worker](perspective-worker)
- [Work coordination overview](../../messaging)
