---
title: Empty Stream ID Policy
version: 1.0.0
category: Configuration
order: 8
description: >-
  Configure how Whizbang handles outbox / inbox / perspective rows with
  stream_id = Guid.Empty — the producer-side bug that causes silent stuck
  rows.
tags: 'configuration, options, stream-id, empty-stream-id, producer, dead-letter, sentinel'
codeReferences:
  - src/Whizbang.Core/Configuration/EmptyStreamIdPolicy.cs
  - src/Whizbang.Core/Configuration/WhizbangCoreOptions.cs
  - src/Whizbang.Core/Messaging/EmptyStreamIdException.cs
  - src/Whizbang.Core/Messaging/EmptyStreamIdGuard.cs
  - src/Whizbang.Core/Messaging/MessageFailureReason.cs
  - src/Whizbang.Data.EFCore.Postgres/StreamIdCoalescer.cs
  - src/Whizbang.Data.Postgres/Migrations/051_DeadLetterRecovery.sql
---

# Empty Stream ID Policy

`EmptyStreamIdPolicy` controls how Whizbang handles outbox / inbox / perspective rows whose `stream_id` is `Guid.Empty` (the all-zeros UUID, distinct from `NULL`).

## Background

Whizbang's `stream_id` column is nullable. `NULL` is the documented marker for **singleton-stream** messages — typically event-store-only writes that don't need per-stream FIFO ordering. The coordinator handles `NULL` by falling back to `WorkId` as the stream identity at drain time, so each singleton-stream row becomes its own "stream of one."

`Guid.Empty` (`00000000-0000-0000-0000-000000000000`) looks like a real UUID to C# null-checks but represents nothing. It's almost always a producer bug: passing `default(Guid)` or an uninitialized field instead of `null` when there is no stream.

Pre-v0.657, the coordinator's stream-id coalesce — `r.StreamId ?? r.WorkId ?? Guid.Empty` — only caught `NULL`. The `??` operator treats `Guid.Empty` as "valid stream," so it skipped the `WorkId` fallback. The subsequent `.Where(g => g != Guid.Empty)` filter then dropped the row from the drain channel entirely.

The result: rows with `stream_id = Guid.Empty` were **claimed by `ClaimWorker` every cycle** (attempts incremented in `claim_orphaned_outbox`) **but never reached `OutboxDrainWorker`**. No publish attempt, no DLQ promotion, no error captured, no log emitted. The bug was silent.

`EmptyStreamIdPolicy` is the structural fix — defense-in-depth across the producer, drainer, and DLQ recovery surfaces.

## Policy Values

| Value | Storage behavior | Drain behavior |
|-------|------------------|----------------|
| `Reject` (default) | Throws `EmptyStreamIdException` at `StoreOutboxMessagesAsync` / `StoreInboxMessagesAsync` time | Coordinator-side recovery is unconditional — Empty → `WorkId` fallback + Warning per row |
| `FallbackToMessageId` | Storage accepts the row | Same as Reject (always-recover at drain) |
| `DeadLetter` | Storage accepts the row | Coordinator moves to `wh_dead_letters` with `MessageFailureReason.EmptyStreamId` instead of attempting to drain |
| `Purge` | Storage accepts the row | Coordinator DELETEs the row + emits Error with the `EmptyStreamId` reason code |

The drainer's `Empty → WorkId` recovery (slice 3) runs **independently of the policy**. It recovers rows that already landed before the policy was tightened. The policy gates what the producer can write; the drainer always heals.

## Default: Reject

```csharp{title="Default Policy" description="Reject is the secure default in v0.657" category="Configuration" difficulty="BEGINNER" tags=["Configuration", "EmptyStreamId"]}
services.AddWhizbang(options => {
  // No-op — Reject is already the default.
  // options.EmptyStreamIdPolicy = EmptyStreamIdPolicy.Reject;
});
```

Under `Reject`, calling `StoreOutboxMessagesAsync` with a message whose `StreamId == Guid.Empty` throws `EmptyStreamIdException`:

```
Whizbang.Core.Messaging.EmptyStreamIdException: Producer attempted to write
  JDX.Contracts.Auth.RemoveShellUserCommand (message_id=019e92b2-1bbb-708d-...)
  with stream_id=Guid.Empty (00000000-0000-0000-0000-000000000000). Empty
  stream_id is rejected under EmptyStreamIdPolicy.Reject — pass null for
  singleton-stream messages or a real stream identity. See
  operations/configuration/empty-stream-id-policy for migration guidance.
```

The exception's `MessageId` and `MessageType` properties carry the offending row's identity so producers can locate the bad call site without grepping logs.

## Lenient Mode: FallbackToMessageId

```csharp{title="Lenient Policy for Migrations" description="Accept Empty stream_id while you fix legacy producers" category="Configuration" difficulty="INTERMEDIATE" tags=["Configuration", "EmptyStreamId", "Migration"]}
services.AddWhizbang(options => {
  options.EmptyStreamIdPolicy = EmptyStreamIdPolicy.FallbackToMessageId;
});
```

`FallbackToMessageId` is for deployments that have legacy producers writing `Guid.Empty` and can't be patched immediately. The row is accepted at storage time; the drainer's always-on recovery uses `WorkId` as the singleton-stream identity, emits a Warning naming the row, and processes it normally.

Use the Warning count to track the rate of "still-bad" producer writes. When the rate hits zero, flip the policy back to `Reject` to close the surface.

## Forensic Preservation: DeadLetter

```csharp{title="Forensic DLQ Policy" description="Move bad rows to wh_dead_letters with a distinct reason code" category="Configuration" difficulty="ADVANCED" tags=["Configuration", "EmptyStreamId", "DeadLetter"]}
services.AddWhizbang(options => {
  options.EmptyStreamIdPolicy = EmptyStreamIdPolicy.DeadLetter;
});
```

`DeadLetter` preserves every offending row in `wh_dead_letters` with `failure_reason = MessageFailureReason.EmptyStreamId` (value `11`). Use this when you want a forensic trail of producer bugs plus the option to replay rows after the producer is fixed.

Recovery is self-healing: `recover_dead_letter` (migration 051) normalizes `Guid.Empty` → `NULL` on the INSERT back into the source table, so a recovered row doesn't immediately re-stick.

## Hard Purge: Purge

```csharp{title="Hard Purge Policy" description="Delete bad rows immediately — use only for known-spammy producers" category="Configuration" difficulty="ADVANCED" tags=["Configuration", "EmptyStreamId", "Purge"]}
services.AddWhizbang(options => {
  options.EmptyStreamIdPolicy = EmptyStreamIdPolicy.Purge;
});
```

`Purge` DELETEs the row without publishing and emits an Error log with the `MessageFailureReason.EmptyStreamId` code. Data loss is permanent. Use only for known-spammy producers you've already given up on (e.g., decommissioned services still emitting bad messages).

## Defenses in Depth

Three independent surfaces close the slot-3 silent-stuck pattern:

```mermaid{title="Empty Stream ID Defenses" description="Three layers of defense across the message lifecycle"}
flowchart LR
  P[Producer call site]
  S{Storage<br/>EmptyStreamIdGuard}
  W[wh_outbox / wh_inbox]
  D{Drainer<br/>StreamIdCoalescer}
  Drain[Drain channel]
  DLQ{DLQ recovery<br/>recover_dead_letter}

  P -->|Reject ?| S
  S -->|throw EmptyStreamIdException| P
  S -->|accept| W
  W --> D
  D -->|Empty -> WorkId<br/>+ Warning| Drain
  W -->|move_to_dead_letters| DLQ
  DLQ -->|normalize Empty -> NULL| W
```

| Surface | Defense | When it fires |
|---------|---------|---------------|
| **Producer** | `EmptyStreamIdGuard.ThrowIfAnyHasEmptyStreamId` | INSERT time under `Reject` |
| **Drainer** | `StreamIdCoalescer.Coalesce` — `Empty → WorkId` + Warning per row | Every `ClaimWorkAsync` call (unconditional) |
| **DLQ replay** | `recover_dead_letter` normalizes `Empty → NULL` | On every `RecoverAsync` of an outbox/inbox source row |

The structural canary in [Stuck Row Sentinel](../observability/stuck-row-sentinel.md) catches any future bug of the same shape ("row claimed but never drained") regardless of root cause.

## Migration Guide

### Existing deployment with legacy producers

If you're on `<= v0.656` and have producers writing `Guid.Empty` today, upgrade to v0.657 with `FallbackToMessageId` first to avoid breaking the producer's commit:

```csharp{title="Phase 1: Recover then observe" description="Accept legacy producers while logging their existence" category="Configuration" difficulty="INTERMEDIATE" tags=["Configuration", "EmptyStreamId", "Migration"]}
services.AddWhizbang(options => {
  options.EmptyStreamIdPolicy = EmptyStreamIdPolicy.FallbackToMessageId;
});
```

Watch the Warning rate (`Empty stream_id detected on outbox row {MessageId}`). Each one names a producer call site you need to fix. When the rate hits zero for a meaningful window:

```csharp{title="Phase 2: Tighten to Reject" description="Close the surface once legacy producers are fixed" category="Configuration" difficulty="INTERMEDIATE" tags=["Configuration", "EmptyStreamId", "Migration"]}
services.AddWhizbang(options => {
  options.EmptyStreamIdPolicy = EmptyStreamIdPolicy.Reject;
});
```

### Net-new deployment

Stay on the default `Reject`. New producers will fail loud at INSERT time, surfacing bugs at the call site before the silent-stuck pattern can ever develop.

### Slot-3-style stuck rows already in the table

Slice 3's coordinator backstop auto-recovers existing `Guid.Empty` rows on the next claim tick — no manual `DELETE` needed. The recovery emits a Warning per row so you can audit what cleared.

## Operator Telemetry

When the drainer recovers an Empty-stream row, it emits a Warning at `Whizbang.Data.EFCore.Postgres.StreamIdCoalescer`:

```
Warning: Empty stream_id (00000000-0000-0000-0000-000000000000) detected on
  outbox row 019e92b2-1bbb-708d-... — falling back to WorkId as
  singleton-stream identity. Producer-side fix needed; see
  operations/configuration/empty-stream-id-policy.
```

Grep the Warning rate to track:
- The pace of legacy-producer cleanup (if running `FallbackToMessageId`)
- Drift after a `Reject` deploy — every Warning means a producer bypassed the storage path (e.g., raw SQL INSERT)

When `MessageFailureReason.EmptyStreamId` rows accumulate in `wh_dead_letters` under the `DeadLetter` policy, group by `message_type` to find the producer:

```sql{
title: "Find producers of Empty stream_id dead letters"
description: "Group wh_dead_letters by message_type where failure_reason is EmptyStreamId (11) to identify which producer is writing Guid.Empty under the DeadLetter policy."
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["empty-stream-id", "dead-letter", "wh_dead_letters", "message-type", "telemetry", "sql"]
}
SELECT message_type, COUNT(*) AS empty_count
FROM wh_dead_letters
WHERE failure_reason = 11  -- MessageFailureReason.EmptyStreamId
GROUP BY message_type
ORDER BY empty_count DESC;
```

## See Also

- [Stuck Row Sentinel](../observability/stuck-row-sentinel.md) — structural canary that catches any future "claimed but never drained" symptom
- [WhizbangCoreOptions](whizbang-options.md) — parent options class
- [Message Failure Reasons](../../fundamentals/work-coordinator/configuration-reference.md) — full list of `MessageFailureReason` values
