---
title: Inbox Batch Strategy
pageType: concept
version: 1.0.0
category: Architecture
order: 4
description: >-
  The inbox batcher a consumer can append received messages to: how it buffers per stream, who uses it
  (no built-in transport does), and what it does when a store fails (retry, then dead-letter, never drop).
tags: >-
  inbox, batching, sliding-window, dead-letter-queue, retry, InboxStoreFailed,
  IInboxFlushFailureObserver, IInboxBatchStrategy
codeReferences:
  - src/Whizbang.Core/Messaging/IInboxBatchStrategy.cs
  - src/Whizbang.Core/Messaging/InboxFlushFailure.cs
  - src/Whizbang.Core/Messaging/MessageFailureReason.cs
  - src/Whizbang.Core/Messaging/DeadLetterRecoveryTypes.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Core/Workers/SlidingWindowInboxBatchStrategy.cs
  - src/Whizbang.Core/Workers/SlidingWindowInboxOptions.cs
  - src/Whizbang.Core/Workers/InboxFlushFailureRecorder.cs
  - src/Whizbang.Core/Workers/BatchStoreRetry.cs
  - src/Whizbang.Core/Workers/TransientDatabaseFailure.cs
  - src/Whizbang.Core/Workers/WorkerPipelineExtensions.cs
  - src/Whizbang.Core/Observability/WorkCoordinatorMetrics.cs
  - src/Whizbang.Data.Postgres/Migrations/257_UnstoredInboxMessagesAreDeadLettered.sql
  - src/Whizbang.Data.EFCore.Postgres/EFCoreWorkCoordinator.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperWorkCoordinator.cs
testReferences:
  - tests/Whizbang.Core.Component.Tests/Workers/SlidingWindowInboxFlushFailureTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/BatcherAmbientContextTests.cs
  - tests/Whizbang.Core.Tests/Workers/InboxFlushFailureRecorderTests.cs
  - tests/Whizbang.Core.Tests/Workers/BatchStrategyFlushCallbackWiringTests.cs
  - tests/Whizbang.Core.Tests/Messaging/DefaultDeadLetterRecoveryPolicyTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/InboxFlushDeadLetterTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperInboxDeadLetterTests.cs
---

# Inbox Batch Strategy

`IInboxBatchStrategy` buffers received messages per stream and stores each stream's batch in `wh_inbox`
through `IWorkCoordinator.StoreInboxMessagesAsync`. `AppendAsync` returns once the message is buffered, not
once it is stored. The default, `SlidingWindowInboxBatchStrategy`, works like the
[outbox batcher](outbox-batch-strategy.md): one buffer and one worker per stream, a batch stored after a quiet
`SlidingWindow` (300 ms), at `MaxWait` (3 s) or at `MaxSize` (1000), and `FlushAndStopAsync` at shutdown.
`ImmediateInboxBatchStrategy` stores each append before it returns. Register either, or your own, with
`AddWhizbangInboxStrategy`.

:::note[Who uses this batcher]
No built-in transport feeds it. The transports' own receive paths store each delivery directly, before
settling it with the broker, so a failed store there leaves the delivery for the broker to deliver again. The
inbox batcher's callers are consumers that resolve `IInboxBatchStrategy` and append to it themselves.
:::

Because `AppendAsync` returns once the message is buffered, the code that appended it may already have
settled it with its broker before the store runs. The batcher holds no acknowledgement it could withhold, so
it cannot leave a failed message for the broker: what it accepted, it must keep.

## Settings {#settings}

Bound from `Whizbang:Workers:InboxBatch` with no registration call. The batching keys are in the
[configuration reference](../../operations/configuration/configuration-reference.md#sliding-window-options).

| Key | Default | Meaning |
|-----|---------|---------|
| `Whizbang:Workers:InboxBatch:MaxFlushAttempts` | 5 | Attempts to store a batch, the first included, before it is [dead-lettered](#when-a-flush-fails). At least 1 |
| `Whizbang:Workers:InboxBatch:FlushRetryBackoff` | 100 ms | Wait before the first retry; each further retry waits twice as long |
| `Whizbang:Workers:InboxBatch:FlushRetryMaxBackoff` | 5 s | Longest wait between two attempts |

{verified: SlidingWindowInboxFlushFailureTests.FlushFailsTransientlyOnEveryAttempt_DeadLettersTheBatchAfterMaxFlushAttemptsAsync, SlidingWindowInboxFlushFailureTests.FlushRetryBackoff_DoublesUpToTheMaximumAsync, SlidingWindowInboxFlushFailureTests.Constructor_MaxFlushAttemptsBelowOne_ThrowsAsync}

Each store holds a slot of the process-wide `WorkCoordinatorGate` (caller `InboxBatchFlush`), the same cap the
[outbox batch stores](outbox-batch-strategy.md#connection-cap) take, so concurrent per-stream stores cannot
open more connections than the gate allows. A stream's drain worker carries no ambient context from the code
that appended first, and neither do the shared batch flushes and their timers upstream of it: the transport batch
collector's and the `Batch` work coordinator strategy's flushes start without the ambient context of the caller that
filled the batch or created them ([details](outbox-batch-strategy.md#ambient-context)).

## When a flush fails {#when-a-flush-fails}

{verified: SlidingWindowInboxFlushFailureTests.FlushFailsOnceForSomeStreams_EveryAcceptedMessageIsStoredAsync, SlidingWindowInboxFlushFailureTests.ConcurrentPerStreamFlushes_SomeFindThePoolExhausted_EveryAcceptedMessageIsStoredAsync, SlidingWindowInboxFlushFailureTests.FlushFailsWithANonTransientError_IsReportedAtOnceAndLoggedAsLostWhenNotDeadLetteredAsync, BatchStrategyFlushCallbackWiringTests.SlidingWindowInboxBatchStrategy_ABatchItCannotStore_IsDeadLetteredThroughTheRegisteredRecorderAsync}

:::updated
A message the inbox batcher accepted is never dropped. Before this release, a batch whose store failed was
logged and dropped, counting on the broker to deliver it again, although the appending code may already have
settled it.
:::

The batcher handles a failed store the way the [outbox batcher](outbox-batch-strategy.md#when-a-flush-fails)
does:

1. **Retry a transient failure** (a lost connection, an exhausted pool, a command timeout, the server out of
   connection slots, a deadlock, and the other kinds listed on the
   [outbox page](outbox-batch-strategy.md#flush-retry)) on the stream's own worker, with backoff on the
   strategy's `TimeProvider`, so the stream's order is kept. Each retry is logged at Warning and counted on
   `whizbang.work_coordinator.inbox_flush.retries`, tagged `reason`.
2. **Dead-letter** a batch whose attempts ran out, or whose store failed with an error a retry cannot fix,
   through `IWorkCoordinator.StoreInboxDeadLettersAsync`, which calls `wh_store_inbox_dead_letters`
   (migration 257). Both Postgres drivers implement it. Each message becomes one `wh_inbox` dead letter with
   reason **`InboxStoreFailed` (24)** holding the message's envelope, and one `wh_log` row (source
   `inbox_flush`) in the same transaction. A message that already has an inbox row, a deduplication row or a
   dead letter not yet recovered is skipped: its store committed and only the reply was lost, or the batch was
   reported twice.
3. **Report it**: counted on `whizbang.work_coordinator.inbox_flush.failed_messages`, tagged `cause`
   (`RetriesExhausted`, `NotRetryable`, `AbandonedAtShutdown`) and `outcome` (`dead_lettered` or
   `not_recorded`), logged at Error with every message id, and passed to every registered
   `IInboxFlushFailureObserver` as an `InboxFlushFailure` with `DeadLettered` set. An observer that throws is
   logged and does not stop the others. When the dead-letter write fails too, the Error says the messages are
   lost unless their broker delivers them again.

{verified: InboxFlushDeadLetterTests.StoreInboxDeadLetters_WritesARecoverableDeadLetterAndALogRowPerMessageAsync, InboxFlushDeadLetterTests.StoreInboxDeadLetters_SkipsAMessageAlreadyStoredOrAlreadyDeadLetteredAsync, DapperInboxDeadLetterTests.StoreInboxDeadLetters_WritesARecoverableDeadLetterAndALogRowPerMessageAsync, InboxFlushFailureRecorderTests.RecordAsync_CoordinatorDeadLetters_CountsTheArrivalsAndTellsObserversItWasKeptAsync, InboxFlushFailureRecorderTests.RecordAsync_DeadLetterWriteFails_IsLoggedAndObserversAreToldItWasNotKeptAsync, InboxFlushFailureRecorderTests.RecordAsync_AnObserverThrows_TheOthersAreStillToldAndItIsLoggedAsync}

```csharp{title="Watch for inbox messages the batcher could not store" description="An observer the inbox batcher calls for every batch it could not store, after it tried to keep the batch in the dead-letter table." framework="NET10" category="Observability" difficulty="INTERMEDIATE" tags=["inbox", "dead-letter-queue", "observability", "IInboxFlushFailureObserver"] tests=["InboxFlushFailureRecorderTests.RecordAsync_CoordinatorDeadLetters_CountsTheArrivalsAndTellsObserversItWasKeptAsync", "InboxFlushFailureRecorderTests.RecordAsync_AnObserverThrows_TheOthersAreStillToldAndItIsLoggedAsync"]}
public sealed class InboxFailureAlert(ILogger<InboxFailureAlert> logger) : IInboxFlushFailureObserver {
    public ValueTask OnInboxFlushFailedAsync(InboxFlushFailure failure, CancellationToken cancellationToken) {
        if (!failure.DeadLettered) {
            // Not kept anywhere: ask the sender to send these message ids again
            logger.LogCritical("Inbox messages lost: {Ids}",
                string.Join(", ", failure.Messages.Select(m => m.MessageId)));
        }
        return ValueTask.CompletedTask;
    }
}

// Program.cs
builder.Services.AddSingleton<IInboxFlushFailureObserver, InboxFailureAlert>();
```

A stop whose deadline passes while batches are still buffered, being stored or waiting to be retried reports
them with cause `AbandonedAtShutdown` and dead-letters them while the container is alive.

{verified: SlidingWindowInboxFlushFailureTests.CanceledStop_AbandonsTheBatchInFlightAndTheOnesBufferedBehindIt_ReportsThemOnceAsync, SlidingWindowInboxFlushFailureTests.CanceledStop_DuringRetryBackoff_AbandonsAndReportsTheBatchAsync, InboxFlushFailureRecorderTests.RecordAsync_AbandonedWithoutAnError_RecordsWhyItWasNotStoredAsync}

### Recovering the messages {#recovering}

The [recovery worker](../../operations/dead-letter-queue/recovery.md) re-enters an `InboxStoreFailed` dead
letter through `store_inbox_messages`, as a delivery of the same envelope is stored, on its default policy
`AggressiveRetry`: five recoveries a minute apart, then held for review.

{verified: DefaultDeadLetterRecoveryPolicyTests.GetPolicy_InboxStoreFailed_RetriesAggressivelyThenHoldsAsync}

To recover them now, select them with `source_table = 'wh_inbox' AND failure_reason = 24` (the
[outbox query](outbox-batch-strategy.md#recovering) with those two values) and schedule each with
`POST /whizbang/dlq/{id}/retry` from the [operator API](../../operations/dead-letter-queue/operator-api.md).

## Related

- [Outbox batch strategy](outbox-batch-strategy.md)
- [Inbox pattern](../../messaging/inbox-pattern.md)
- [Recovery worker and policy matrix](../../operations/dead-letter-queue/recovery.md)
- [Metrics: Whizbang.WorkCoordinator](../../operations/observability/metrics.md#work-coordinator)
