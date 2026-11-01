---
title: Internal DLQ (wh_dead_letters)
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
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
  - src/Whizbang.Core/Observability/DeadLetterLog.cs
  - src/Whizbang.Core/Workers/DeadLetterLoggingOptions.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/MoveToDeadLettersSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreDeadLetterStoreTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/InboxDispatchWorkerTests.cs
  - tests/Whizbang.Core.Tests/Workers/InboxDispatchWorkerDeadLetterTests.cs
  - tests/Whizbang.Core.Tests/Workers/InboxDispatchWorkerControlPlaneDropLogTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/OutboxPublishWorkerDlqPromotionTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PerspectiveWorkerDeadLetterFilterTests.cs
  - tests/Whizbang.Core.Tests/Workers/V502DefaultsTests.cs
  - tests/Whizbang.Core.Tests/Workers/InboxDispatchWorkerDeadLetterLogTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PrePublishGateForensicPreservationTests.cs
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
   `wh_event_store`. Since migration 241 the snapshot keeps every field the
   source table's store needs, so recovery can re-enter the row through that
   store: for an outbox row the envelope type, event flag, flags, scope,
   priority, schedule and coalesce group, and for perspective work its
   priority (see [outbox and perspective re-entry](./recovery#outbox-perspective-reentry)).
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
tests: ["EFCoreDeadLetterStoreTests.MoveAsync_OutboxRow_ReturnsDeadLetterIdAndMovesRowAsync", "EFCoreDeadLetterStoreTests.MoveAsync_SourceRowAlreadyGone_ReturnsNullAsync"]
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
| `PerspectiveWorker.FilterDeadLetteredAsync` | `failures > MaxPerspectiveEventAttempts` (apply failures; `attempts` counts leases and is diagnostic only) | `PerspectiveWorkerOptions.MaxPerspectiveEventAttempts` (default 10) |

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
  The message is finished for good, so it still gets its
  [dead-letter record](#dead-letter-record), which is then its only trace.
- **Outbox (drain gate)**: falls through to the publish attempt — better to
  attempt delivery than leave the row stuck; the next failure cycle retries
  the DLQ move.
- **Outbox (publish worker)**: falls through to the failure channel so
  `attempts` bumps and the next claim retries the move via the drain gate.
- **Perspective**: the row stays in the apply set and in
  `wh_perspective_events`; the next claim cycle retries the move.

This keeps `wh_dead_letters` from silently swallowing rows when the DLQ
surface itself is broken (DB unhealthy, schema mismatch, etc.).

## The dead-letter record {#dead-letter-record}

Each caller above logs one record for a message it moves into `wh_dead_letters`: EventId 1901,
`MessageDeadLettered`, under the caller's own category, with the message id and type, the reason and the
last failure (the exception when the caller has it, otherwise the recorded error text). It is logged at
Error by default, or at Warning when
[`Whizbang:DeadLetterLogging:Level`](../configuration/configuration-reference#dead-letter-logging) says so.
A failed attempt that will be retried is logged at Warning and gets no record; a move that returns `NULL`
(another path moved the row first) gets no record, because that path logged its own. See
[dead-lettered messages](../observability/logging-categories#dead-lettered-messages) for every path that
logs it and the lines it replaced.

{verified: InboxDispatchWorkerDeadLetterLogTests.MaxAttempts_MovedToTheDeadLetterStore_LogsOneErrorRecordWithTypeAndLastErrorAsync, InboxDispatchWorkerDeadLetterLogTests.MaxAttempts_RowAlreadyGone_LogsNoRecordAsync, InboxDispatchWorkerDeadLetterLogTests.MaxAttempts_DeadLetterMoveThrows_LogsTheRecordForTheTerminalCompletionAsync, PrePublishGateForensicPreservationTests.PrePublishGate_Promotes_LogsTheDeadLetterRecordAtErrorAsync, OutboxPublishWorkerDlqPromotionTests.SingularPublish_AttemptsAtCap_LogsTheDeadLetterRecordAtErrorWithTypeAndErrorAsync, PerspectiveWorkerDeadLetterFilterTests.FailuresAboveMax_MovedToDeadLetters_LogsTheDeadLetterRecordAtErrorAsync, PerspectiveWorkerDeadLetterFilterTests.FailuresAboveMax_MoveThrows_LogsNoRecordAsync}

**Upgrade note.** The record replaces the inbox's EventId 5, the outbox publish worker's EventId 6, the
outbox drain worker's EventId 10 and the perspective worker's dead-letter Warning, all of which were
Warnings. An alert keyed on Error may now fire for dead letters; set `Whizbang:DeadLetterLogging:Level`
to `Warning` to keep the old severity, and key a log query on EventId 1901 instead of the retired ones.

## Control-plane drops {#control-plane-drops}

Control-plane messages (framework coordination traffic that is re-emitted on its own cadence) are
never stored in `wh_dead_letters`. When an inbox control-plane row passes `MaxInboxAttempts`, the
dispatch worker drops it: the row is completed terminally and counted in the dead-letter metrics
under the `ControlPlaneDropped` reason. Storing it would only have the recovery worker replay a stale message
on a later boot.

Because nothing is stored, the drop log line is the only record of why the row failed, and the
[dead-letter record](#dead-letter-record) is not logged for it. It is a
Warning (EventId 11, category `Whizbang.Core.Workers.InboxDispatchWorker`) and carries the message
id, type, attempts, the row's last recorded error, and the cause of that error:

| Last cause | Meaning |
|---|---|
| `its lease lapsed without a reported outcome` | The last error is the stamp a claim writes when a lease expires with no outcome reported. The attempts were spent by lapsed leases, not by the message failing. See [claim backpressure](../workers/claim-backpressure.md). |
| `a recorded failure` | Something reported a failure; the last error is that failure's text. |
| `none recorded` | The row has no last error. |

{verified: InboxDispatchWorkerControlPlaneDropLogTests.Drop_WithARecordedFailure_LogsTheErrorAndNamesItAsARecordedFailureAsync, InboxDispatchWorkerControlPlaneDropLogTests.Drop_AfterLeaseLapses_NamesTheLapseAsTheCauseAsync, InboxDispatchWorkerControlPlaneDropLogTests.Drop_WithNothingRecorded_SaysNoneRecordedAsync}

```text{title="Control-plane drop line" description="The Warning logged when an inbox control-plane row is dropped at the attempt bound, here after its attempts were spent on lapsed leases" category="Dead Letter Queue" difficulty="INTERMEDIATE" tags=["dead-letter", "control-plane", "logging", "inbox"] tests=["InboxDispatchWorkerControlPlaneDropLogTests.Drop_AfterLeaseLapses_NamesTheLapseAsTheCauseAsync", "InboxDispatchWorkerControlPlaneDropLogTests.Drop_WithARecordedFailure_LogsTheErrorAndNamesItAsARecordedFailureAsync"]}
InboxDispatchWorker DROPPED control-plane message <id> (<type>) after 11 attempt(s); last cause: its lease lapsed
without a reported outcome; last error: Attempt 3 ended without a reported outcome: lease held by instance <id>
expired. Control-plane traffic is re-emitted on its own cadence and is never durably dead-lettered, so this line
is the only record of why it failed.
```

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
unverified: "DI configuration snippet — sets MaxInboxAttempts to null via Configure; no framework unit pins the null-disable path on this page"
}
services.Configure<InboxDispatchWorkerOptions>(o => o.MaxInboxAttempts = null);
```

## See also

- [Recovery worker + policy matrix](./recovery)
- [Operator HTTP API](./operator-api)
- [Perspective-event dead-lettering](./perspective-events)
