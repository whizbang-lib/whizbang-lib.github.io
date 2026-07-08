---
title: Handler commit
order: 3
---

# Handler commit

The handler commit is the only true transactional unit in Whizbang. When an inbox handler runs successfully and emits new outbox messages, those writes must commit together with the inbox completion — otherwise crashes between the two produce duplicates or lost messages.

## The atomic bundle

`commit_handler_result` (and its batched cousin `commit_handler_batch`) carry the full handler result:

```
Atomic transaction:
  ┌──────────────────────────────────────────┐
  │  Mark inbox row M as processed           │  ← inbox completion
  │  INSERT outbox rows [O1, O2, ...]        │  ← messages handler emitted
  │  INSERT inbox rows [I1, I2, ...] (rare)  │  ← inbox messages handler emitted
  │  INSERT event_store rows for new events  │  ← (auto, downstream of outbox storage)
  │  INSERT perspective_event rows           │  ← (auto, from message_associations)
  │  pg_notify('wh_work', 'outbox')          │  ← if any outbox rows inserted
  │  pg_notify('wh_work', 'inbox')           │  ← if any inbox rows inserted
  │  pg_notify('wh_work', 'perspective')     │  ← if any perspective rows created
  └──────────────────────────────────────────┘
```

If any step fails, the whole bundle rolls back. The inbox row stays unprocessed; the next claim re-delivers it.

## Why atomic matters

Without atomicity, two failure scenarios produce silent corruption:

1. **Crash after outbox stored, before inbox completion**: next claim re-runs handler M, emits O1', O2' duplicates of O1, O2. Downstream consumers see duplicates.
2. **Crash after inbox completion, before outbox stored**: handler effects (the emitted O1, O2) are lost. Downstream never sees them.

Both are eliminated when the bundle commits in one transaction.

## Single-handler vs batched

| Method | Use when |
|---|---|
| `CommitHandlerResultAsync(req)` | One handler at a time. Simpler reasoning. |
| `CommitHandlerBatchAsync([req1, req2, ...])` | Multiple handlers per flush tick. Throughput multiplier — N handlers commit in ONE round-trip with one fsync. |

The C# `InboxHandlerWorker` defaults to the batched form via Nagle coalescing (default 25 ms window, 100 max batch).

## SAVEPOINT-per-handler isolation

`commit_handler_batch` uses PL/pgSQL `BEGIN..EXCEPTION` blocks to wrap each handler's bundle in an implicit subtransaction (savepoint):

```sql
FOR r IN SELECT elem FROM jsonb_array_elements(p_results) AS elem
LOOP
  BEGIN
    PERFORM commit_handler_result(r.elem);
    RETURN QUERY SELECT (r.elem->>'handler_id')::uuid, TRUE, NULL::text;
  EXCEPTION WHEN OTHERS THEN
    -- Implicit ROLLBACK TO SAVEPOINT: only THIS handler's writes rolled back.
    RETURN QUERY SELECT (r.elem->>'handler_id')::uuid, FALSE, SQLERRM::text;
  END;
END LOOP;
```

A failing bundle rolls back ONLY its own effects; siblings commit normally. The `InboxHandlerWorker` reads per-handler results and routes failures to the `FailureFlushWorker` for retry tracking.

## Throughput math

Single-handler-per-call (Option A): ~3-5 ms per call (commit + fsync). 100 handlers = 300-500 ms wall-clock latency, fundamentally serial.

Batched (Option B with savepoints): coalesce ~50 handlers in 25 ms, single fsync at outer commit. 50 handlers in ~10 ms = 50× speedup at burst.

## Cost: per-handler error reporting

The C# layer must read per-handler results and route failures individually:

```csharp
var results = await coordinator.CommitHandlerBatchAsync(batch, ct);
foreach (var result in results) {
  if (!result.Success) {
    var matching = batch.First(r => r.HandlerId == result.HandlerId);
    await failureChannel.EnqueueAsync(WorkCategory.Inbox, new MessageFailure {
      MessageId = matching.InboxCompletion.MessageId,
      CompletedStatus = MessageProcessingStatus.None,
      Error = result.ErrorMessage ?? "unknown",
      Reason = MessageFailureReason.Unknown
    }, ct);
  }
}
```

This is the only place per-handler success/failure tracking exists. Worth the complexity for the throughput win.

## NOTIFY emission

After a successful bundle commits, `pg_notify('wh_work', '<category>')` fires for each category that received new rows. Postgres dedups `(channel, payload)` pairs at COMMIT, so 10 000 outbox inserts in one bundle deliver exactly **one** notification — burst-tolerant by design.

Listeners on other instances wake immediately (see [Notifications and pgbouncer](notifications-and-pgbouncer.md)).

## Related

- [Claim loop](claim-loop.md)
- [Batched flushers](batched-flushers.md)
- [Notifications and pgbouncer](notifications-and-pgbouncer.md)
