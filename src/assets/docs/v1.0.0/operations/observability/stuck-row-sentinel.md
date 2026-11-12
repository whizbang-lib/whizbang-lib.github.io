---
title: Stuck Row Sentinel
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Observability
order: 8
description: >-
  Structural canary that surfaces wh_outbox / wh_inbox rows claimed past
  MaxOutboxAttempts but never drained — catches any silent-stuck bug
  regardless of root cause; and how the maintenance cycle concludes the
  exhausted inbox rows no dispatcher concluded.
tags: 'observability, maintenance, dead-letter, stuck-rows, sentinel, monitoring'
codeReferences:
  - src/Whizbang.Core/Messaging/StuckRow.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Core/Workers/MaintenanceWorker.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreWorkCoordinator.cs
  - src/Whizbang.Data.Postgres/Migrations/054_StuckRowSentinel.sql
  - src/Whizbang.Core/Messaging/WorkCoordinatorGate.cs
  - src/Whizbang.Core/Workers/DeadLetterDropPolicy.cs
  - src/Whizbang.Data.Postgres/CoordinatorFleetSql.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperWorkCoordinator.FleetAndCatalog.cs
  - src/Whizbang.Data.Postgres/Migrations/350_ExhaustedInboxRowsAreDropped.sql
testReferences:
  - tests/Whizbang.Core.Tests/Workers/MaintenanceWorkerStuckRowSentinelTests.cs
  - tests/Whizbang.Core.Tests/Messaging/WorkCoordinatorGateHolderDiagnosticsTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StuckRowSentinelSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreFindStuckRowsTests.cs
  - tests/Whizbang.Core.Tests/Workers/MaintenanceWorkerExhaustedInboxConclusionTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ExhaustedInboxDropSqlTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperFleetRecoveryTests.cs
  - tests/Whizbang.Core.Tests/Messaging/WorkCoordinatorDefaultsTests.cs
---

# Stuck Row Sentinel

The stuck-row sentinel is a structural canary that surfaces `wh_outbox` and `wh_inbox` rows that have been claimed past `MaxOutboxAttempts` / `MaxInboxAttempts` but never drained. It catches **any** "row claimed but never drained" symptom — independent of root cause.

## Background

A production forensic investigation exposed a class of bug where rows accumulate `attempts` indefinitely without reaching the drainer:

- No publish attempt is made — so [Dead Letter Queue](../dead-letter-queue/internal-dlq.md) promotion never fires.
- No exception is thrown — so the failure-capture `error` column stays NULL.
- No `Warning` is emitted — so operator dashboards stay silent.

The specific instance was [Empty Stream ID](../configuration/empty-stream-id-policy.md): rows whose `stream_id = Guid.Empty` bypassed the `??` coalesce. That's now closed at three surfaces — but the class of bug ("claim_work returns the row, but it never makes it to the drain channel") is broader than the Empty-stream instance.

The sentinel surfaces the **symptom** — `attempts > N AND processed_at IS NULL` — so any future bug of the same shape produces a Warning per row within one maintenance tick, regardless of why the drainer can't reach it.

The sentinel reports; it does not act. For the inbox, the maintenance cycle now also concludes the rows past `MaxInboxAttempts` that no dispatcher concluded, so a row of this shape stops retrying even before its cause is found. See [Exhausted rows are concluded](#exhausted-rows-are-concluded).

## How It Works

The `MaintenanceWorker` calls two `IWorkCoordinator` methods once per maintenance cycle (default 10 min):

| Method | Returns |
|--------|---------|
| `FindStuckOutboxRowsAsync(maxAttempts, limit)` | `wh_outbox` rows where `attempts > maxAttempts AND processed_at IS NULL` |
| `FindStuckInboxRowsAsync(maxAttempts, limit)`  | `wh_inbox` rows where `attempts > maxAttempts AND processed_at IS NULL` |

Each returned row produces one `Warning` log entry:

```
Warning: Stuck outbox row sentinel: message_id=019e92b2-1bbb-708d-...
  type=App.Contracts.Auth.RemoveUserCommand stream=...
  attempts=992 since=2026-03-12T09:15:00.000Z — row claimed past
  MaxOutboxAttempts but never drained. Investigate; see
  operations/observability/stuck-row-sentinel.
```

The Warning carries all five forensic fields from `StuckRow`:

| Field | Use |
|-------|-----|
| `MessageId` | Look up the row directly in `wh_outbox` / `wh_inbox` |
| `MessageType` | Identify the producer / `GROUP BY` to find spammy types |
| `StreamId` | Correlate with `wh_active_streams` ownership; `null` = singleton-stream |
| `Attempts` | Frame urgency — 11 vs 992 |
| `ClaimedSince` | Compare against deploy boundaries to identify regression windows |

## Configuration

The sentinel ships enabled by default with sensible knobs. All three properties live on `MaintenanceWorkerOptions`:

```csharp{title="Sentinel Configuration" description="Tune the stuck-row sentinel" category="Configuration" difficulty="INTERMEDIATE" tags=["Configuration", "Maintenance", "StuckRow"] unverified="verified by MaintenanceWorkerStuckRowSentinelTests / StuckRowSentinelSqlTests, which are outside the current coverage map"}
services.Configure<MaintenanceWorkerOptions>(options => {
  options.StuckRowSentinelEnabled = true;           // killswitch, default true
  options.StuckRowSentinelMaxAttempts = 10;         // threshold, default 10 (matches MaxOutboxAttempts)
  options.StuckRowSentinelLimit = 50;               // per-cycle Warning cap, default 50
});
```

### Killswitch — `StuckRowSentinelEnabled`

Default `true`. Set to `false` if the canary ever becomes noisy (e.g., during a planned migration when stuck rows are expected) without disabling the rest of maintenance.

### Threshold — `StuckRowSentinelMaxAttempts`

Default `10`. Matches the `OutboxDrainWorkerOptions.MaxOutboxAttempts` default (see [Internal DLQ](../dead-letter-queue/internal-dlq.md)) — rows past that threshold are by definition past the DLQ promotion gate. If you raise `MaxOutboxAttempts`, raise this knob to match so the sentinel fires after DLQ has had its chance.

### Per-cycle Cap — `StuckRowSentinelLimit`

Default `50`. Bounds Warning emission under saturation — if a deploy bug causes thousands of rows to stick simultaneously, you get 50 representative Warnings per 10-min cycle instead of a log flood.

## Exhausted rows are concluded {#exhausted-rows-are-concluded}
{verified: MaintenanceWorkerExhaustedInboxConclusionTests.ExhaustedDomainRow_IsMovedToTheDeadLetterStore_AsMaxAttemptsExceededAsync, MaintenanceWorkerExhaustedInboxConclusionTests.ExhaustedControlPlaneRow_IsDropped_NeverStoredAsync, MaintenanceWorkerExhaustedInboxConclusionTests.AConcludedDomainRow_IsCountedAsADeadLetterArrivalAsync}

The inbox attempt ceiling, `InboxDispatchWorkerOptions.MaxInboxAttempts`, is enforced where a row is dispatched: the
dispatch worker reads the row's envelope, sees `attempts > MaxInboxAttempts`, and dead-letters it (or drops it, for
[control-plane traffic](../dead-letter-queue/internal-dlq.md#control-plane-drops)) before any handler runs. That is
the right place for the decision, because it is where the row's type and its last failure are in hand and where a
handler could otherwise run. It also means a row that never reaches a dispatcher is never concluded. The claim charges
an attempt each time it leases a row, so a row the claim keeps acquiring and never hands on (a stream the re-offer
passed over, an event [held back behind an earlier event](../../fundamentals/work-coordinator/claim-loop.md#the-re-offer-hands-on-only-what-the-drain-can-fetch)
of its stream) has its lease lapse, is taken by the next claim, and climbs attempts without end. Before this change
the sentinel reported such rows and nothing else happened to them.

Each maintenance cycle now concludes them, after the sentinel has reported:

1. It reads the unprocessed inbox rows past `MaxInboxAttempts` through the sentinel's own query
   (`FindStuckInboxRowsAsync`, on its partial index), at most `ExhaustedInboxConcludeLimit` of them.
2. It sorts each row with the same `DeadLetterDropPolicy` the dispatch worker uses, so the two paths cannot disagree
   about what is stored.
3. A **domain** row is moved to the dead-letter store with reason `MaxAttemptsExceeded`. The move
   (`move_to_dead_letters`) keeps the row's last recorded error on the dead letter, and the error text says that
   maintenance concluded it and with how many attempts. It is counted as a dead-letter arrival like any other.
4. A **control-plane** row is dropped through `IWorkCoordinator.DropExhaustedInboxRowsAsync`
   (`wh_drop_exhausted_inbox_rows`, migration 350). Control-plane traffic is never stored in the dead-letter table,
   because its sender re-issues it on its own cadence.

{verified: ExhaustedInboxDropSqlTests.Drop_RemovesOnlyTheGivenUnprocessedRowsPastTheCeilingAsync, ExhaustedInboxDropSqlTests.Drop_WithNoIds_IsANoOpAsync, DapperFleetRecoveryTests.DropExhaustedInboxRows_DropsOnlyTheGivenRowsPastTheCeilingAsync, MaintenanceWorkerExhaustedInboxConclusionTests.AMoveThatFindsTheRowGone_IsNotReportedAsConcludedAsync}

**Why concluding here cannot race a handler.** A row past the ceiling never runs a handler anywhere: the dispatcher
concludes it before dispatch. Neither path trusts the list it read: the drop touches only rows still unprocessed and
still past the ceiling, and a move whose row its dispatcher already moved finds it gone. Such a row is left alone and is
not counted or logged as concluded.

**Debug mode.** With the coordinator's debug mode on, the drop keeps the row for forensics with `processed_at`
stamped and its lease cleared, as the completion functions keep a completed row; otherwise the row is deleted, and its
state row goes with it. {verified: ExhaustedInboxDropSqlTests.Drop_InDebugMode_KeepsTheRowWithItsProcessedTimeStampedAsync}

**With no dead-letter store.** A domain row is kept and reported by the sentinel, and EventId 70 says how many were
left and why; a domain message is never deleted without a record. Control-plane rows are still dropped, since they are
never stored anyway. {verified: MaintenanceWorkerExhaustedInboxConclusionTests.NoDeadLetterStore_LeavesDomainRows_AndStillDropsControlPlaneAsync, MaintenanceWorkerExhaustedInboxConclusionTests.UnregisteredDeadLetterStore_LeavesDomainRowsAsync}

**When it does nothing.** A host with no inbox dispatch options, or with `MaxInboxAttempts` unset (no ceiling), has no
ceiling to enforce and concludes nothing. {verified: MaintenanceWorkerExhaustedInboxConclusionTests.NoAttemptCeiling_ConcludesNothingAsync, MaintenanceWorkerExhaustedInboxConclusionTests.NoInboxDispatchOptions_ConcludesNothingAsync, MaintenanceWorkerExhaustedInboxConclusionTests.NoExhaustedRows_ConcludesNothingAsync}

**Failures.** A move or drop that fails is logged and tried again on the next cycle, and one failed move does not stop
the rows after it. Cancellation is shutdown and propagates. {verified: MaintenanceWorkerExhaustedInboxConclusionTests.AFailedMove_IsLogged_AndTheNextRowIsStillConcludedAsync, MaintenanceWorkerExhaustedInboxConclusionTests.AFailedDrop_IsLogged_AndDoesNotFailTheCycleAsync, MaintenanceWorkerExhaustedInboxConclusionTests.CancellationDuringAMove_PropagatesAsync, MaintenanceWorkerExhaustedInboxConclusionTests.CancellationDuringADrop_PropagatesAsync}

### Options

Both live on `MaintenanceWorkerOptions` and bind from `Whizbang:Workers:Maintenance`
([configuration reference](../configuration/configuration-reference.md#maintenanceworkeroptions)):

| Option | Default | Why this default |
|--------|---------|------------------|
| `ConcludeExhaustedInboxRows` | `true` | A row past the ceiling would be concluded by its dispatcher the moment it reached one, so concluding it here does what the framework already promises, and leaving it retries it for ever. `false` restores report-only behavior, for an investigation that needs the rows left in place. {verified: MaintenanceWorkerExhaustedInboxConclusionTests.Disabled_ConcludesNothingAsync} |
| `ExhaustedInboxConcludeLimit` | `500` | Each domain row is one dead-letter move, so the limit bounds one cycle's work and keeps a large backlog from turning a maintenance cycle into a long run of moves. The rest are concluded on later cycles. |

The conclusion is independent of `StuckRowSentinelEnabled`: turning the canary off does not stop rows being concluded,
and it uses the dispatcher's `MaxInboxAttempts`, not `StuckRowSentinelMaxAttempts`, so it concludes exactly what the
dispatcher would have.

### Logs

Category `Whizbang.Core.Workers.MaintenanceWorker`, all at Warning:

| EventId | Meaning |
|---------|---------|
| 66 | A domain row was dead-lettered by maintenance, with its message id, type, attempts and the ceiling |
| 67 | A domain row could not be moved; it is tried again next cycle |
| 68 | Control-plane rows were dropped: how many of how many found, and the ceiling |
| 69 | Control-plane rows could not be dropped; they are tried again next cycle |
| 70 | Domain rows were left because no dead-letter store is configured |

### Draining a large backlog

:::note
A host that ran a long time before this change can hold many exhausted rows. They drain at `ExhaustedInboxConcludeLimit`
(500) per maintenance cycle, so 20,000 rows take 40 cycles. To clear them faster, raise
`Whizbang__Workers__Maintenance__ExhaustedInboxConcludeLimit` for a few cycles and set it back once the sentinel stops
reporting inbox rows. The read is on the sentinel's partial index; what a higher limit costs is one dead-letter move per
domain row in the cycle that takes it.
:::

## Cost Model

The sentinel is designed to be effectively free in steady state.

### Partial Indexes

Migration `054_StuckRowSentinel.sql` creates two partial indexes:

```sql{
title: "Partial indexes for the stuck-row sentinel"
description: "Create the attempts>5 partial indexes on wh_outbox and wh_inbox that keep the sentinel scan effectively free in steady state."
category: "Observability"
difficulty: "ADVANCED"
tags: ["stuck-row", "sentinel", "partial-index", "wh_outbox", "wh_inbox", "sql"]
}
CREATE INDEX IF NOT EXISTS idx_outbox_stuck_sentinel
  ON wh_outbox (attempts)
  WHERE processed_at IS NULL AND attempts > 5;

CREATE INDEX IF NOT EXISTS idx_inbox_stuck_sentinel
  ON wh_inbox (attempts)
  WHERE processed_at IS NULL AND attempts > 5;
```

The `attempts > 5` predicate keeps the index ~0-sized under healthy traffic — most rows publish in 1-2 attempts and clear. Postgres uses the partial index for queries with `attempts > 10` because `5 < 10` and the partial-index predicate is a superset.

### Per-cycle Cost

| Cost source | Magnitude |
|-------------|-----------|
| Index write on `attempts++` | 1 btree update per `claim_orphaned_*` UPDATE (already touching the row) — negligible overhead |
| Index size | ~0 in steady state; grows proportional to stuck-row count |
| `find_stuck_*_rows` query | Index range scan on near-empty partial — O(log N) effectively free |
| Maintenance tick frequency | 1 / 10 min (default) — same cadence as `perform_maintenance` |
| `Warning` emission | At most `StuckRowSentinelLimit` per cycle per table |

At production scale (millions of historical rows including processed=NOT NULL pre-cleanup), the sentinel itself doesn't show up in pg_stat_statements — the partial index makes the bulk of the table invisible to the scan.

## Operator Workflow

When a `Warning: Stuck outbox row sentinel` fires:

1. **Correlate timing** — Check `since` against your recent deploy timeline. A row stuck since the last deploy is likely a regression in code that shipped. A row stuck longer is likely accumulating from an existing producer bug.
2. **Group by type** — Multiple Warnings naming the same `MessageType` mean a specific producer is the source. Search the producer's codebase for that type's call site.
3. **Investigate the row directly** — Query `wh_outbox` for the `message_id`:
   ```sql{
title: "Inspect a stuck outbox row by message_id"
description: "Pull the full forensic column set for a sentinel-flagged wh_outbox row so an operator can diagnose why it never drained."
category: "Observability"
difficulty: "INTERMEDIATE"
tags: ["stuck-row", "sentinel", "forensics", "wh_outbox", "operator", "sql"]
}
   SELECT message_type, stream_id, attempts, status, failure_reason,
          error, instance_id, lease_expiry, created_at
   FROM wh_outbox
   WHERE message_id = '019e92b2-1bbb-708d-...';
   ```
4. **Check for known patterns**:
   - `stream_id = '00000000-...'` → [Empty Stream ID](../configuration/empty-stream-id-policy.md) — slice 3 auto-recovery should be cleaning these.
   - `error IS NULL AND attempts > 100` → the drainer literally never attempted. Check the OutboxDrainWorker / WorkCoordinatorGate Debug logs for the path it absorbed. If the gate is saturated, its acquire-deadline Warning (`WorkCoordinatorGate.AcquireAsync timed out ...`, EventId 1) ends with `Holders: <Caller> xN (oldest S s), ...`, the held slots grouped by caller, which names what is occupying the gate instead of leaving you to infer it. {verified: WorkCoordinatorGateHolderDiagnosticsTests.Deadline_NamesTheHoldersInTheWarningAsync}
   - `error LIKE '%timeout%'` → publish hang. Check broker health / `PublishTimeoutSeconds`.
5. **File a Whizbang issue** if the symptom matches a new bug class — the sentinel surfaced it; closing the class needs a code-side fix.

## Telemetry Examples

### Per-type stuck-row rates

```sql{
title: "Aggregate stuck outbox rows by message type"
description: "Group sentinel-flagged wh_outbox rows by message_type to reveal which producer is the source of a silent-stuck symptom."
category: "Observability"
difficulty: "INTERMEDIATE"
tags: ["stuck-row", "sentinel", "telemetry", "message-type", "aggregation", "sql"]
}
SELECT message_type, COUNT(*) AS stuck_count, MAX(attempts) AS max_attempts
FROM wh_outbox
WHERE attempts > 10 AND processed_at IS NULL
GROUP BY message_type
ORDER BY stuck_count DESC;
```

### Time-since-stuck distribution

```sql{
title: "Compute the time-since-stuck distribution"
description: "Summarize oldest, newest, and average attempts of stuck wh_outbox rows per message_type to frame urgency and correlate with deploy windows."
category: "Observability"
difficulty: "INTERMEDIATE"
tags: ["stuck-row", "sentinel", "telemetry", "distribution", "deploy-correlation", "sql"]
}
SELECT
  message_type,
  MIN(created_at) AS oldest_stuck,
  MAX(created_at) AS newest_stuck,
  AVG(attempts)::INT AS avg_attempts
FROM wh_outbox
WHERE attempts > 10 AND processed_at IS NULL
GROUP BY message_type;
```

### Correlation with deploys

Match `since` (the row's `created_at`) against your deploy times. A correlation peak right after a deploy is a regression smoking gun.

## See Also

- [Empty Stream ID Policy](../configuration/empty-stream-id-policy.md) — the specific bug class this sentinel was designed to defend against future analogues of
- [Internal Dead Letter Queue](../dead-letter-queue/internal-dlq.md) — downstream defense for rows the drainer **does** reach
