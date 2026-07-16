---
title: Internal DLQ (wh_dead_letters)
pageType: concept
version: 1.0.0
category: Dead-Letter Queue
order: 1
description: >-
  How Whizbang's internal wh_dead_letters table works — the schema, the
  IDeadLetterStore.MoveAsync atomic move boundary, and which workers
  populate it.
tags: >-
  dead-letter-queue, wh_dead_letters, IDeadLetterStore, MaxInboxAttempts,
  MaxOutboxAttempts, MaxPerspectiveEventAttempts
codeReferences:
  - src/Whizbang.Core/Messaging/IDeadLetterStore.cs
  - src/Whizbang.Core/Messaging/DeadLetterRecoveryTypes.cs
  - src/Whizbang.Data.Postgres/Migrations/050_WhDeadLetters.sql
  - src/Whizbang.Core/Workers/InboxDispatchWorker.cs
  - src/Whizbang.Core/Workers/OutboxDrainWorker.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
---

# Internal DLQ — `wh_dead_letters`

The internal DLQ is a single PostgreSQL table that holds a forensic snapshot
of every work-table row Whizbang decided to permanently fail. It's the
landing zone for policy-driven recovery — operators (or the
`DeadLetterRecoveryWorker`) act on these rows, not on the raw
`wh_outbox` / `wh_inbox` / `wh_perspective_events` tables.

## Schema

`wh_dead_letters` (migration `050_WhDeadLetters.sql`):

```sql{
title: "wh_dead_letters table schema"
description: "The migration 050 table definition holding the forensic snapshot, generation-replay, and recovery-state columns for every permanently failed work-table row."
category: "Dead Letter Queue"
difficulty: "INTERMEDIATE"
tags: ["dead-letter", "wh_dead_letters", "schema", "migration", "postgres"]
}
CREATE TABLE wh_dead_letters (
  dead_letter_id     UUID NOT NULL PRIMARY KEY,
  source_table       TEXT NOT NULL,    -- 'wh_outbox' | 'wh_inbox' | 'wh_perspective_events'
  source_id          UUID NOT NULL,    -- original message_id or event_work_id
  stream_id          UUID,
  message_type       TEXT,
  envelope_type      TEXT,
  event_data         TEXT,             -- forensic snapshot of the payload
  metadata           JSONB,
  scope              JSONB,
  failure_reason     SMALLINT NOT NULL,
  attempts_when_dlq  INTEGER NOT NULL,
  error_text         TEXT,
  dead_lettered_at   TIMESTAMPTZ NOT NULL,
  instance_id        UUID,
  generation         TEXT NOT NULL,    -- e.g. "0.502.0-alpha.1"

  recovery_status              SMALLINT NOT NULL DEFAULT 0,
  recovery_attempts            INTEGER NOT NULL DEFAULT 0,
  last_recovery_attempt_at     TIMESTAMPTZ,
  next_recovery_attempt_at     TIMESTAMPTZ,
  retried_on_generations       TEXT[] NOT NULL DEFAULT '{}',
  operator_disposition         SMALLINT NOT NULL DEFAULT 0
);
```

The columns split into three groups:

1. **Snapshot** (`source_*`, `event_data`, `metadata`, `scope`, `failure_reason`,
   `error_text`) — captured at the move boundary so the original row can be
   reconstructed if recovery succeeds.
2. **Generation** (`generation`, `retried_on_generations`) — used by the
   "we-shipped-a-fix" auto-replay: on every deploy, any row whose current
   generation isn't in `retried_on_generations` gets one free retry attempt.
3. **State** (`recovery_status`, `recovery_attempts`, `next_recovery_attempt_at`,
   `operator_disposition`) — the recovery worker's bookkeeping.

## The `MoveAsync` boundary

Any worker that detects a permanent failure calls
`IDeadLetterStore.MoveAsync(...)`:

```csharp{
title: "IDeadLetterStore.MoveAsync interface"
description: "The atomic move-boundary contract every worker calls to relocate a permanently failed row from its source table into wh_dead_letters."
framework: "NET10"
category: "Dead Letter Queue"
difficulty: "ADVANCED"
tags: ["dead-letter", "IDeadLetterStore", "MoveAsync", "atomic-move"]
}
public interface IDeadLetterStore {
  Task<Guid?> MoveAsync(
    Guid deadLetterId,
    string sourceTable,
    Guid sourceId,
    MessageFailureReason failureReason,
    string? errorText,
    Guid instanceId,
    string generation,
    CancellationToken ct = default);
}
```

The SQL function `move_to_dead_letters()` (mig 050) runs the INSERT into
`wh_dead_letters` and the DELETE from the source table in a single transaction
so partial-failure crashes leave the system consistent. It's idempotent: when
the source row is already gone (e.g. two failure paths raced), it returns
`NULL` and the caller treats that as "someone else moved it first."

Callers:

| Caller | Trigger | Cap option |
|---|---|---|
| `InboxDispatchWorker._processOneInnerAsync` | `attempts > MaxInboxAttempts` | `MaxInboxAttempts` (default 10) |
| `OutboxDrainWorker` per-row check | `attempts > MaxOutboxAttempts` | `MaxOutboxAttempts` (default 10) |
| `PerspectiveWorker.FilterDeadLetteredAsync` | `attempts > MaxPerspectiveEventAttempts` | `MaxPerspectiveEventAttempts` (default 10) |

The perspective check runs at the drainer's **pre-deserialization** boundary
so the typed-envelope parse + apply cost is avoided for rows that are already
known-doomed. All three callers use one-based attempts semantics:
`attempts=N` on the Nth attempt, so `Max…Attempts=10` permits 10 attempts and
dead-letters on the 11th.

## What if `MoveAsync` throws?

Every caller has the same fallback: log a warning and leave the row in its
source table. The next claim cycle will re-pick-it up and the check runs
again. This keeps `wh_dead_letters` from silently swallowing rows when the
DLQ surface itself is broken (DB unhealthy, schema mismatch, etc.). The
retry budget is already exhausted, so a stuck row at this stage represents
a partial-availability state worth surfacing — not a correctness issue.

## Defaults

| Worker | Option | Default | Override semantics |
|---|---|---|---|
| Inbox | `InboxDispatchWorkerOptions.MaxInboxAttempts` | 10 | Set to `null` to disable dead-lettering (legacy v0.501 behavior). |
| Outbox | `OutboxDrainWorkerOptions.MaxOutboxAttempts` | 10 | Same — `null` disables. |
| Perspective | `PerspectiveWorkerOptions.MaxPerspectiveEventAttempts` | 10 | Same — `null` disables. |

The v0.501 defaults were `null` (unbounded retries). v0.502 ships the 10-attempt
cap as the floor and the DLQ pipeline as the path of recovery. To disable on
a per-worker basis, set the option to `null` explicitly in `appsettings.json`:

```json{
title: "Disable inbox dead-lettering per worker"
description: "Sets MaxInboxAttempts to null in appsettings to restore v0.501 unbounded-retry behavior instead of moving exhausted inbox rows to the DLQ."
category: "Dead Letter Queue"
difficulty: "BEGINNER"
tags: ["dead-letter", "MaxInboxAttempts", "configuration", "inbox"]
}
{
  "Whizbang": {
    "InboxDispatchWorker": { "MaxInboxAttempts": null }
  }
}
```

## See also

- [Recovery worker + policy matrix](./recovery)
- [Operator HTTP API](./operator-api)
- [Perspective-event dead-lettering](./perspective-events)
