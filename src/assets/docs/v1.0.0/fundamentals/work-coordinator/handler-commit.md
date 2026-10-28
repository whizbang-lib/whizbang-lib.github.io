---
title: Handler commit
pageType: concept
order: 3
version: 1.0.0
description: >-
  How a batch of handler results is committed in one round trip, and why a cancelled commit costs
  more than a slow one.
tags: 'work-coordinator, handler-commit, batching, savepoints, exactly-once, inbox'
codeReferences:
  - src/Whizbang.Core/Workers/InboxHandlerWorker.cs
  - src/Whizbang.Core/Workers/FailureFlushWorker.cs
  - src/Whizbang.Core/Workers/BatchFlusher.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Core/Messaging/HandlerCommitRequest.cs
  - src/Whizbang.Core/Workers/InboxDispatchWorker.cs
testReferences:
  - tests/Whizbang.Core.Component.Tests/Workers/InboxHandlerWorkerTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/BatchFlusherRetryTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/FailureFlushWorkerTests.cs
  - tests/Whizbang.Core.Tests/Workers/InboxDispatchWorkerControlPlaneDropLogTests.cs
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

```sql{
title: "Per-handler SAVEPOINT inside the commit batch"
description: "The commit function wraps each handler result in its own SAVEPOINT, so one failing handler rolls back alone instead of losing the whole batch."
category: "Workers"
difficulty: "ADVANCED"
tags: ["handler-commit", "savepoint", "batching", "plpgsql"]
}
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

```csharp{
title: "Read per-handler outcomes back from a commit batch"
description: "CommitHandlerBatchAsync returns one result per handler, so the caller can tell which handlers failed without re-running the batch."
framework: "NET10"
category: "Workers"
difficulty: "INTERMEDIATE"
tags: ["handler-commit", "batching", "error-reporting"]
}
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

## Commit failures are logged {#commit-failures-logged}

A row whose bundle fails in `commit_handler_batch` stays unprocessed, and the next claim re-delivers
it. So that an operator can see which traffic is failing without reading the rows, each failure is
logged at Warning with the message id, its message type and the error, then routed to the failure
channel as before.

One flush logs its first five failures individually and counts the rest in a single summary line, so
a flush where every row fails stays readable. Routing is never capped: every failed row still reaches
the failure channel, which records its error on the row. A failure result that names no request in
the flush cannot be routed; it is logged too, and its row keeps its lease until it lapses.
{verified: InboxHandlerWorkerTests.CommitFailure_IsLoggedAtWarning_WithTheMessageIdTypeAndErrorAsync, InboxHandlerWorkerTests.ManyCommitFailuresInOneFlush_LogTheFirstIndividually_ThenOneSummaryOfTheRestAsync, InboxHandlerWorkerTests.CommitFailure_ForAResultNamingNoRequest_IsStillLoggedAsync}

The type comes from `HandlerCommitRequest.MessageType`, an init-only property the dispatch worker
sets from the row it completes. It is used for logging only and is never part of the commit payload.
A request built without it logs the type as `unknown`.
{verified: InboxDispatchWorkerControlPlaneDropLogTests.Drop_CommitRequest_CarriesTheMessageTypeAsync}

```csharp{
title: "Naming the message type on a commit request"
description: "MessageType is init-only on the positional record, so a request gains it with an initializer or a with expression; it reaches the failure log line and never the commit payload."
framework: "NET10"
category: "Workers"
difficulty: "INTERMEDIATE"
tags: ["handler-commit", "logging", "inbox"]
tests: ["InboxHandlerWorkerTests.CommitFailure_IsLoggedAtWarning_WithTheMessageIdTypeAndErrorAsync", "InboxDispatchWorkerControlPlaneDropLogTests.Drop_CommitRequest_CarriesTheMessageTypeAsync"]
}
// request: a HandlerCommitRequest acknowledging one inbox row
var named = request with { MessageType = "Contracts.Orders.OrderPlaced, Contracts" };
await inboxHandlerWorker.EnqueueAsync(named, ct);

// If this row's bundle fails, the Warning names it:
// InboxHandlerWorker could not commit inbox message <id> (Contracts.Orders.OrderPlaced, Contracts): <error>. ...
```

Every row in a flush is released from this process's [held rows](inbox-dispatch.md#held-rows) when
the flush ends, whether its commit landed or failed, so a failed row can be claimed again.
{verified: InboxHandlerWorkerTests.CommitFlush_ReleasesTheHeldRow_WhetherItCommittedOrNotAsync, InboxHandlerWorkerTests.DisabledCommits_ReleaseTheHeldRow_TheyRefuseAsync}

### Log events {#log-events}

Category `Whizbang.Core.Workers.InboxHandlerWorker`.

| EventId | Level | When |
|---|---|---|
| 26 | Warning | A row's commit failed. Carries the message id, message type and error. |
| 27 | Warning | Summary of the failures in one flush beyond the first five. Carries the count and the flush size. |
| 28 | Warning | A failure result names no request in the flush. Carries the handler id and error. |

## NOTIFY emission

After a successful bundle commits, `pg_notify('wh_work', '<category>')` fires for each category that received new rows. Postgres dedups `(channel, payload)` pairs at COMMIT, so 10 000 outbox inserts in one bundle deliver exactly **one** notification — burst-tolerant by design.

Listeners on other instances wake immediately (see [Notifications and pgbouncer](notifications-and-pgbouncer.md)).

## Related

- [Claim loop](claim-loop.md)
- [Batched flushers](batched-flushers.md)
- [Notifications and pgbouncer](notifications-and-pgbouncer.md)
- [Inbox dispatch](inbox-dispatch.md)
