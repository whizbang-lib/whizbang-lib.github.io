---
title: Stuck Row Sentinel
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Observability
order: 8
description: >-
  Structural canary that surfaces wh_outbox / wh_inbox rows claimed past
  MaxOutboxAttempts but never drained — catches any silent-stuck bug
  regardless of root cause.
tags: 'observability, maintenance, dead-letter, stuck-rows, sentinel, monitoring'
codeReferences:
  - src/Whizbang.Core/Messaging/StuckRow.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Core/Workers/MaintenanceWorker.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreWorkCoordinator.cs
  - src/Whizbang.Data.Postgres/Migrations/054_StuckRowSentinel.sql
testReferences:
  - tests/Whizbang.Core.Tests/Workers/MaintenanceWorkerStuckRowSentinelTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StuckRowSentinelSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreFindStuckRowsTests.cs
---

# Stuck Row Sentinel

The stuck-row sentinel is a structural canary that surfaces `wh_outbox` and `wh_inbox` rows that have been claimed past `MaxOutboxAttempts` / `MaxInboxAttempts` but never drained. It catches **any** "row claimed but never drained" symptom — independent of root cause.

## Background

The slot-3 forensic (June 2026) exposed a class of bug where rows accumulate `attempts` indefinitely without reaching the drainer:

- No publish attempt is made — so [Dead Letter Queue](../dead-letter-queue/internal-dlq.md) promotion never fires.
- No exception is thrown — so the failure-capture `error` column stays NULL.
- No `Warning` is emitted — so operator dashboards stay silent.

The specific instance was [Empty Stream ID](../configuration/empty-stream-id-policy.md): rows whose `stream_id = Guid.Empty` bypassed the `??` coalesce. That's now closed at three surfaces — but the class of bug ("claim_work returns the row, but it never makes it to the drain channel") is broader than the Empty-stream instance.

The sentinel surfaces the **symptom** — `attempts > N AND processed_at IS NULL` — so any future bug of the same shape produces a Warning per row within one maintenance tick, regardless of why the drainer can't reach it.

## How It Works

The `MaintenanceWorker` calls two `IWorkCoordinator` methods once per maintenance cycle (default 10 min):

| Method | Returns |
|--------|---------|
| `FindStuckOutboxRowsAsync(maxAttempts, limit)` | `wh_outbox` rows where `attempts > maxAttempts AND processed_at IS NULL` |
| `FindStuckInboxRowsAsync(maxAttempts, limit)`  | `wh_inbox` rows where `attempts > maxAttempts AND processed_at IS NULL` |

Each returned row produces one `Warning` log entry:

```
Warning: Stuck outbox row sentinel: message_id=019e92b2-1bbb-708d-...
  type=JDX.Contracts.Auth.RemoveShellUserCommand stream=...
  attempts=992 since=2026-06-06T15:30:00.000Z — row claimed past
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

At JDX-scale (millions of historical rows including processed=NOT NULL pre-cleanup), the sentinel itself doesn't show up in pg_stat_statements — the partial index makes the bulk of the table invisible to the scan.

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
   - `error IS NULL AND attempts > 100` → the drainer literally never attempted. Check the OutboxDrainWorker / WorkCoordinatorGate Debug logs for the path it absorbed.
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
