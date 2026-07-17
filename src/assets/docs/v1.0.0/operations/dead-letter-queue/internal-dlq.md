---
title: Internal DLQ (wh_dead_letters)
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
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
  - src/Whizbang.Core/Workers/OutboxPublishWorker.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/MoveToDeadLettersSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreDeadLetterStoreTests.cs
  - tests/Whizbang.Core.Tests/Workers/InboxDispatchWorkerTests.cs
  - tests/Whizbang.Core.Tests/Workers/OutboxPublishWorkerDlqPromotionTests.cs
  - tests/Whizbang.Core.Tests/Workers/PerspectiveWorkerDeadLetterFilterTests.cs
  - tests/Whizbang.Core.Tests/Workers/V502DefaultsTests.cs
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
CREATE TABLE IF NOT EXISTS wh_dead_letters (
  -- identity
  dead_letter_id     UUID PRIMARY KEY,     -- generated; survives re-emission
  source_table       TEXT NOT NULL,        -- 'wh_outbox' | 'wh_inbox' | 'wh_perspective_events'
  source_id          UUID NOT NULL,        -- original message_id / event_work_id
  stream_id          UUID,                 -- nullable for single-source messages
  message_type       TEXT NOT NULL,
  destination        TEXT,                 -- routing destination (outbox source)
  perspective_name   TEXT,                 -- perspective source

  -- payload (forensic preservation)
  envelope           JSONB NOT NULL,       -- full envelope at time of failure
  metadata           JSONB NOT NULL DEFAULT '{}'::JSONB,

  -- failure provenance
  failure_reason     INTEGER NOT NULL,     -- MessageFailureReason enum
  error_text         TEXT,
  attempts_when_dlq  INTEGER NOT NULL,     -- attempts at time of dead-lettering
  dead_lettered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dead_lettered_by   UUID,                 -- instance_id

  -- recovery state
  recovery_status    INTEGER NOT NULL DEFAULT 0,  -- DeadLetterRecoveryStatus enum
  recovery_attempts  INTEGER NOT NULL DEFAULT 0,
  last_recovery_at   TIMESTAMPTZ,
  next_recovery_at   TIMESTAMPTZ,
  recovered_at       TIMESTAMPTZ,          -- non-null when permanently recovered

  -- generation tagging (deploy-aware auto-replay)
  generation                TEXT NOT NULL, -- e.g., "0.502.0-alpha.1+consumer-1.42.0"
  retried_on_generations    TEXT[] NOT NULL DEFAULT '{}',

  -- operator disposition
  operator_disposition INTEGER NOT NULL DEFAULT 0, -- DeadLetterDisposition enum
  operator_notes       TEXT,
  operator_actor       TEXT,

  -- error fingerprint (first 16 hex chars of SHA256 over type + top frames;
  -- lets operators triage large backlogs via GROUP BY error_fingerprint)
  error_fingerprint         VARCHAR(16),
  error_fingerprint_version SMALLINT
);
```

The columns split into four groups:

1. **Snapshot** (`source_*`, `stream_id`, `message_type`, `destination`,
   `perspective_name`, `envelope`, `metadata`, `failure_reason`, `error_text`,
   `error_fingerprint`) — captured at the move boundary so the original row can
   be reconstructed if recovery succeeds. For `wh_perspective_events` rows the
   envelope holds an `event_id` pointer that recovery rejoins against
   `wh_event_store`.
2. **Generation** (`generation`, `retried_on_generations`) — used by the
   "we-shipped-a-fix" auto-replay: on every deploy, any row whose current
   generation isn't in `retried_on_generations` gets one free retry attempt.
3. **State** (`recovery_status`, `recovery_attempts`, `last_recovery_at`,
   `next_recovery_at`, `recovered_at`) — the recovery worker's bookkeeping.
4. **Operator** (`operator_disposition`, `operator_notes`, `operator_actor`) —
   manual triage state set through the operator API.

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
| `InboxDispatchWorker.ProcessOneInnerAsync` | `attempts > MaxInboxAttempts` (also composite fan-out failures, cap-independent) | `InboxDispatchWorkerOptions.MaxInboxAttempts` (default 10) |
| `OutboxDrainWorker` pre-publish gate | `attempts > MaxOutboxAttempts`, checked before any publish attempt | `OutboxDrainWorkerOptions.MaxOutboxAttempts` (default 10) |
| `OutboxPublishWorker` post-failure promotion | `attempts >= MaxOutboxAttempts` after a publish failure | `OutboxPublishWorkerOptions.MaxOutboxAttempts` (default 10) |
| `PerspectiveWorker.FilterDeadLetteredAsync` | `attempts > MaxPerspectiveEventAttempts` | `PerspectiveWorkerOptions.MaxPerspectiveEventAttempts` (default 10) |

The perspective check runs at the drainer's **pre-deserialization** boundary
so the typed-envelope parse + apply cost is avoided for rows that are already
known-doomed. The claim-side callers use one-based attempts semantics:
`attempts=N` on the Nth attempt, so `Max…Attempts=10` permits 10 attempts and
dead-letters on the 11th. Dead-lettering only activates when the DLQ surface
is fully wired (`IDeadLetterStore` + generation provider registered) — when
unwired, the legacy v0.501 behavior applies.

## What if `MoveAsync` throws?

Every caller treats the move as best-effort — log and fall through — but the
fallback differs per worker:

- **Inbox**: falls back to the legacy terminal-commit path (row is marked
  terminal so it never re-claims — the retry budget is already exhausted).
- **Outbox (drain gate)**: falls through to the publish attempt — better to
  attempt delivery than leave the row stuck; the next failure cycle retries
  the DLQ move.
- **Outbox (publish worker)**: falls through to the failure channel so
  `attempts` bumps and the next claim retries the move via the drain gate.
- **Perspective**: the row stays in the apply set and in
  `wh_perspective_events`; the next claim cycle retries the move.

This keeps `wh_dead_letters` from silently swallowing rows when the DLQ
surface itself is broken (DB unhealthy, schema mismatch, etc.).

## Defaults

| Worker | Option | Default | Override semantics |
|---|---|---|---|
| Inbox | `InboxDispatchWorkerOptions.MaxInboxAttempts` | 10 | Set to `null` to disable dead-lettering (legacy v0.501 behavior). |
| Outbox | `OutboxDrainWorkerOptions.MaxOutboxAttempts` | 10 | Same — `null` disables. |
| Perspective | `PerspectiveWorkerOptions.MaxPerspectiveEventAttempts` | 10 | Same — `null` disables. |

The v0.501 defaults were `null` (unbounded retries). v0.502 ships the 10-attempt
cap as the floor and the DLQ pipeline as the path of recovery. To disable on
a per-worker basis, set the option to `null` explicitly via the options API
(these worker options are not auto-bound from `appsettings.json`):

```csharp{
title: "Disable inbox dead-lettering per worker"
description: "Sets MaxInboxAttempts to null via Configure to restore v0.501 unbounded-retry behavior instead of moving exhausted inbox rows to the DLQ."
category: "Dead Letter Queue"
difficulty: "BEGINNER"
tags: ["dead-letter", "MaxInboxAttempts", "configuration", "inbox"]
}
services.Configure<InboxDispatchWorkerOptions>(o => o.MaxInboxAttempts = null);
```

## See also

- [Recovery worker + policy matrix](./recovery)
- [Operator HTTP API](./operator-api)
- [Perspective-event dead-lettering](./perspective-events)
