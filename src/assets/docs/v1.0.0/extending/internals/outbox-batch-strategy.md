---
title: Outbox Batch Strategy
pageType: concept
version: 1.0.0
category: Architecture
order: 3
description: >-
  How the producer-side outbox batcher buffers each stream's messages and stores them after the caller
  has returned, what it does when a store fails (retry, then dead-letter, never drop), how to watch
  for and recover those messages, and why its drain workers carry no ambient context.
tags: >-
  outbox, batching, sliding-window, dead-letter-queue, retry, LocalInvokeAsync, OutboxStoreFailed,
  IOutboxFlushFailureObserver, ambient-context
codeReferences:
  - src/Whizbang.Core/Messaging/IOutboxBatchStrategy.cs
  - src/Whizbang.Core/Messaging/OutboxFlushFailure.cs
  - src/Whizbang.Core/Messaging/OutboxDeadLetterRequest.cs
  - src/Whizbang.Core/Messaging/MessageFailureReason.cs
  - src/Whizbang.Core/Messaging/DeadLetterRecoveryTypes.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Core/Workers/SlidingWindowOutboxBatchStrategy.cs
  - src/Whizbang.Core/Workers/SlidingWindowOutboxOptions.cs
  - src/Whizbang.Core/Workers/OutboxFlushFailureRecorder.cs
  - src/Whizbang.Core/Workers/BatchStoreRetry.cs
  - src/Whizbang.Core/Workers/TransientDatabaseFailure.cs
  - src/Whizbang.Core/Workers/AmbientFreeTask.cs
  - src/Whizbang.Core/Workers/WorkerPipelineExtensions.cs
  - src/Whizbang.Core/Observability/WorkCoordinatorMetrics.cs
  - src/Whizbang.Data.Postgres/Migrations/256_UnstoredOutboxMessagesAreDeadLettered.sql
  - src/Whizbang.Data.EFCore.Postgres/EFCoreWorkCoordinator.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperWorkCoordinator.cs
testReferences:
  - tests/Whizbang.Core.Component.Tests/Workers/SlidingWindowOutboxFlushFailureTests.cs
  - tests/Whizbang.Core.Component.Tests/Dispatcher/LocalInvokeResultOutboxFlushFailureComponentTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/BatcherAmbientContextTests.cs
  - tests/Whizbang.Core.Tests/Workers/OutboxFlushFailureCallbackTests.cs
  - tests/Whizbang.Core.Tests/Workers/BatchStrategyFlushCallbackWiringTests.cs
  - tests/Whizbang.Core.Tests/Messaging/DefaultDeadLetterRecoveryPolicyTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/OutboxFlushPoolExhaustionTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperOutboxDeadLetterTests.cs
---

# Outbox Batch Strategy

An event a receptor returns through `LocalInvokeAsync`, or one it publishes, is not written to `wh_outbox` by
the call that produced it. It is appended to the **outbox batch strategy** (`IOutboxBatchStrategy`), which
buffers it under its stream and returns as soon as it is buffered. A worker of that stream stores the
stream's batch a moment later through `IWorkCoordinator.StoreOutboxMessagesAsync`. The caller does not wait
for the write.

The default strategy, `SlidingWindowOutboxBatchStrategy`, keeps one buffer per stream id:

- Messages of one stream are stored by one worker, one batch at a time, in order. Different streams batch and
  store independently.
- A stream's batch is stored when no message has arrived for `SlidingWindow` (50 ms), when `MaxWait` (1 s) has
  passed since its first message, or when it holds `MaxSize` (100) messages, whichever comes first.
- A message without a stream id goes to a default stream key.
- At shutdown, `FlushAndStopAsync` stores what is still buffered and stops accepting appends.

`ImmediateOutboxBatchStrategy` is the alternative with no batching: each append is stored before it returns.
Register either, or your own, with `AddWhizbangOutboxStrategy`. The ordering guarantees the batcher keeps are
described in the [event ordering invariant](event-ordering-invariant.md).

## Settings {#settings}

Bound from `Whizbang:Workers:OutboxBatch` with no registration call. See the
[configuration reference](../../operations/configuration/configuration-reference.md#sliding-window-options) for
the inbox and apply shapes beside it.

| Key | Default | Meaning |
|-----|---------|---------|
| `Whizbang:Workers:OutboxBatch:SlidingWindow` | 50 ms | Quiet period after a stream's last message before its batch is stored |
| `Whizbang:Workers:OutboxBatch:MaxWait` | 1 s | Longest a stream's first buffered message waits |
| `Whizbang:Workers:OutboxBatch:MaxSize` | 100 | Messages per stream batch |
| `Whizbang:Workers:OutboxBatch:IdleEvictionWindow` | 30 s | An idle stream's buffer is evicted after this |
| `Whizbang:Workers:OutboxBatch:IdleSweepInterval` | 10 s | How often idle buffers are looked for |
| `Whizbang:Workers:OutboxBatch:MaxFlushAttempts` | 5 | Attempts to store a batch, the first included, before it is [dead-lettered](#when-a-flush-fails). At least 1 |
| `Whizbang:Workers:OutboxBatch:FlushRetryBackoff` | 100 ms | Wait before the first retry; each further retry waits twice as long |
| `Whizbang:Workers:OutboxBatch:FlushRetryMaxBackoff` | 5 s | Longest wait between two attempts |

{verified: SlidingWindowOutboxFlushFailureTests.FlushFailsTransientlyOnEveryAttempt_DeadLettersTheBatchAfterMaxFlushAttemptsAsync, SlidingWindowOutboxFlushFailureTests.FlushRetryBackoff_DoublesUpToTheMaximumAsync, SlidingWindowOutboxFlushFailureTests.Constructor_MaxFlushAttemptsBelowOne_ThrowsAsync}

## Concurrent stores share the gate {#connection-cap}

Each stream's batch is stored on that stream's own worker, so a burst across many streams would open as many
connections at once and overflow the connection pool. Every outbox batch store therefore holds a slot of the
process-wide `WorkCoordinatorGate` (caller `OutboxBatchFlush` on `whizbang.gate.hold_duration_ms`), and the
stores never open more connections than the gate allows. The inbox batcher's stores take a slot of the same
gate.

{verified: BatchStrategyFlushCallbackWiringTests.OutboxAndInboxBulkFlushCallbacks_StoreThroughAWorkCoordinatorGateSlotAsync, OutboxFlushPoolExhaustionTests.PerStreamFlushes_PoolExhausted_EveryAcceptedMessageReachesTheOutboxAsync}

## When a flush fails {#when-a-flush-fails}

{verified: SlidingWindowOutboxFlushFailureTests.FlushFailsOnceForSomeStreams_EveryAcceptedMessageIsStoredAsync, SlidingWindowOutboxFlushFailureTests.ConcurrentPerStreamFlushes_SomeFindThePoolExhausted_EveryAcceptedMessageIsStoredAsync, LocalInvokeResultOutboxFlushFailureComponentTests.LocalInvokeResults_StoreFailsOnceForSomeStreams_EveryReturnedEventReachesTheOutboxAsync, LocalInvokeResultOutboxFlushFailureComponentTests.LocalInvokeResult_StoreKeepsFailing_IsDeadLetteredAndObserversAreToldAsync}

:::updated
A message the batcher accepted is never dropped. Before this release, a batch whose store failed was logged
("Dispatcher re-emission will recover") and thrown away, although nothing re-emits an event a receptor
returned. A burst across many streams against a remote database could lose a random subset of events: the
per-stream stores overflowed the connection pool, and the store retried only deadlocks.
:::

The caller has already returned when the store runs, so a failure cannot be handed back to it. The batcher
handles it in three steps.

```mermaid{caption="An outbox batch store: a transient failure is retried on the stream's worker; a batch that still cannot be stored is dead-lettered, counted, logged and reported to every observer." tests=["SlidingWindowOutboxFlushFailureTests.FlushFailsOnceForSomeStreams_EveryAcceptedMessageIsStoredAsync", "SlidingWindowOutboxFlushFailureTests.FlushFailsTransientlyOnEveryAttempt_DeadLettersTheBatchAfterMaxFlushAttemptsAsync", "SlidingWindowOutboxFlushFailureTests.FlushFailsWithANonTransientError_IsReportedAtOnceAndLoggedAsLostWhenNotDeadLetteredAsync"]}
flowchart TB
    A["Stream worker stores the batch<br/>(holds a gate slot)"] -->|"stored"| OK["Done"]
    A -->|"transient database failure,<br/>attempts left"| W["Wait the backoff<br/>(doubles up to FlushRetryMaxBackoff)"]
    W --> A
    A -->|"attempts used up, or an error<br/>a retry cannot fix"| DL["wh_store_outbox_dead_letters<br/>reason OutboxStoreFailed (23)"]
    DL --> R["Counted, logged at Error,<br/>IOutboxFlushFailureObserver told"]
    R --> REC["Dead-letter recovery stores it again"]
```

### 1. Retry a transient failure {#flush-retry}

A store that fails with a transient database failure is retried **on the stream's own worker**, so the
stream's later batches wait behind it and its order is kept. Transient means: a lost connection, an exhausted
connection pool, a command timeout, the server out of connection slots (SQLSTATE class 53), a deadlock, a
serialization failure, a canceled statement, a lock timeout, or a failure the provider itself flags as
transient. Each retry is logged at Warning with the kind of failure, the attempt and the wait, and counted on
`whizbang.work_coordinator.outbox_flush.retries`, tagged `reason`.

The wait starts at `FlushRetryBackoff` and doubles per retry up to `FlushRetryMaxBackoff`, measured on the
strategy's `TimeProvider`. With the defaults, five attempts span about 1.5 seconds of waiting.

Any other failure (a constraint the message breaks, a serialization error) is not retried.

### 2. Dead-letter what still cannot be stored {#flush-dead-letter}

A batch whose attempts ran out, or whose store failed with an error a retry cannot fix, is written to
`wh_dead_letters` through `IWorkCoordinator.StoreOutboxDeadLettersAsync`, which calls
`wh_store_outbox_dead_letters` (migration 256). Both Postgres drivers implement it.

- Each message becomes one `wh_outbox` dead letter with reason **`OutboxStoreFailed` (23)**, in the same
  shape a stored outbox row's dead letter has, so recovery stores it through `store_outbox_messages` as if it
  had just been sent. The error text is the store's last failure.
- Each message written is also logged in `wh_log` (source `outbox_flush`), in the same transaction.
- A message that is already stored (an outbox row or an event-store event with its id: the store committed and
  only its reply was lost) or that already has a dead letter not yet recovered is skipped.
- The batch is logged at Error with every message id and how to recover it. When the dead-letter write fails
  too, the Error says the messages exist nowhere else and are lost unless their source sends them again.

{verified: OutboxFlushPoolExhaustionTests.StoreOutboxDeadLetters_WritesARecoverableDeadLetterAndALogRowPerMessageAsync, OutboxFlushPoolExhaustionTests.StoreOutboxDeadLetters_SkipsAMessageAlreadyStoredOrAlreadyDeadLetteredAsync, DapperOutboxDeadLetterTests.StoreOutboxDeadLetters_WritesARecoverableDeadLetterAndALogRowPerMessageAsync, SlidingWindowOutboxFlushFailureTests.FlushFailsWithANonTransientError_IsReportedAtOnceAndLoggedAsLostWhenNotDeadLetteredAsync, OutboxFlushFailureCallbackTests.RecordAsync_DeadLetterWriteFails_IsLoggedAndObserversAreToldItWasNotKeptAsync}

A dead-lettered batch does not hold up its stream: the stream's later batches are stored without waiting for
it. Recovery puts it back on its stream in stream-aware order (see
[stream recovery modes](../../operations/dead-letter-queue/recovery.md#stream-recovery-modes)).

### 3. Report it {#flush-failure-report}

Every batch that was not stored is counted on `whizbang.work_coordinator.outbox_flush.failed_messages`, tagged
`cause` (`RetriesExhausted`, `NotRetryable` or `AbandonedAtShutdown`) and `outcome` (`dead_lettered`, or
`not_recorded` when the dead-letter write failed too). Any `not_recorded` count is messages that exist only in
the error log: alert on it.

Every registered `IOutboxFlushFailureObserver` is then told, after the dead-letter write, with an
`OutboxFlushFailure`: the stream, the messages, the cause, the attempts, the last error, and `DeadLettered`.
Register any number. Each is called in turn, and one that throws is logged and does not stop the others.

```csharp{title="Watch for outbox messages that could not be stored" description="An observer the batcher calls for every outbox batch it could not store, after it tried to keep the batch in the dead-letter table." framework="NET10" category="Observability" difficulty="INTERMEDIATE" tags=["outbox", "dead-letter-queue", "observability", "IOutboxFlushFailureObserver"] tests=["OutboxFlushFailureCallbackTests.RecordAsync_CoordinatorDeadLetters_CountsTheArrivalsAndTellsObserversItWasKeptAsync", "OutboxFlushFailureCallbackTests.RecordAsync_AnObserverThrows_TheOthersAreStillToldAndItIsLoggedAsync", "LocalInvokeResultOutboxFlushFailureComponentTests.LocalInvokeResult_StoreKeepsFailing_IsDeadLetteredAndObserversAreToldAsync"]}
public sealed class OutboxFailureAlert(IAlertSink alerts) : IOutboxFlushFailureObserver {
    public async ValueTask OnOutboxFlushFailedAsync(OutboxFlushFailure failure, CancellationToken cancellationToken) {
        // DeadLettered = false: the messages are only in this record and the error log
        var severity = failure.DeadLettered ? "warning" : "critical";
        await alerts.RaiseAsync(
            severity,
            $"{failure.Messages.Count} outbox message(s) of stream {failure.StreamId} not stored: {failure.Cause}",
            cancellationToken);
    }
}

// Program.cs
builder.Services.AddSingleton<IOutboxFlushFailureObserver, OutboxFailureAlert>();
```

### Shutdown past its deadline {#shutdown-past-deadline}

A stop whose deadline passes while batches are still buffered, being stored or waiting to be retried abandons
them: each is reported with cause `AbandonedAtShutdown` and dead-lettered while the container is still alive,
instead of being discarded silently. The stop waits for that report.

{verified: SlidingWindowOutboxFlushFailureTests.CanceledStop_AbandonsTheBatchInFlightAndTheOnesBufferedBehindIt_ReportsThemOnceAsync, SlidingWindowOutboxFlushFailureTests.CanceledStop_DuringRetryBackoff_AbandonsAndReportsTheBatchAsync, OutboxFlushFailureCallbackTests.RecordAsync_AbandonedWithoutAnError_RecordsWhyItWasNotStoredAsync}

### Recovering the messages {#recovering}

Nothing has to be done for a dead-lettered batch: the [recovery worker](../../operations/dead-letter-queue/recovery.md)
re-enters `OutboxStoreFailed` dead letters on its default policy, `AggressiveRetry`: five recoveries a minute
apart, then held for review so a store that keeps refusing is visible.

{verified: DefaultDeadLetterRecoveryPolicyTests.GetPolicy_OutboxStoreFailed_RetriesAggressivelyThenHoldsAsync}

To recover them now, for example once the database is back, find the dead letters by the message ids in the
Error log, or by reason:

```sql{
title: "Find the outbox messages the batcher could not store"
description: "Lists the dead letters written for outbox batches that were not stored, oldest first, with their recovery state."
category: "Dead Letter Queue"
difficulty: "INTERMEDIATE"
tags: ["dead-letter-queue", "outbox", "OutboxStoreFailed", "runbook"]
}
SELECT dead_letter_id, source_id AS message_id, stream_id, message_type,
       recovery_status, recovery_attempts, dead_lettered_at, error_text
FROM wh_dead_letters
WHERE source_table = 'wh_outbox'
  AND failure_reason = 23          -- OutboxStoreFailed
  AND recovered_at IS NULL
ORDER BY dead_lettered_at;
```

Then schedule each one for immediate recovery with `POST /whizbang/dlq/{id}/retry` from the
[operator API](../../operations/dead-letter-queue/operator-api.md), which also brings back a row already held
for review.

## Drain workers carry no ambient context {#ambient-context}

{verified: BatcherAmbientContextTests.OutboxFlush_DoesNotSeeTheFirstAppendersAmbientContextAsync, BatcherAmbientContextTests.InboxFlush_DoesNotSeeTheFirstAppendersAmbientContextAsync, BatcherAmbientContextTests.ApplyFlush_DoesNotSeeTheFirstAppendersAmbientContextAsync, BatcherAmbientContextTests.PerStreamSerializerProcessor_DoesNotSeeTheFirstEnqueuersAmbientContextAsync}

A stream's drain worker is started from inside the first append for that stream, but it does not inherit
that caller's ambient (`AsyncLocal`) state: its pinned connection, scope, tenant or activity. Every store of
the stream, whoever appended the messages in it, runs with no ambient state from the first appender. The same
holds for the inbox and perspective-apply batchers and the per-stream serializer.

:::updated
Before this release, the worker was started with `Task.Run`, which copied the first appender's execution
context. Every later store of the stream saw that caller's pinned connection after it had released it, or
while it was still using it, and carried its scope, tenant and activity into stores of other callers'
messages.
:::

## Related

- [Inbox batch strategy](inbox-batch-strategy.md): the same failure handling for the inbox batcher.
- [Recovery worker and policy matrix](../../operations/dead-letter-queue/recovery.md)
- [Metrics: Whizbang.WorkCoordinator](../../operations/observability/metrics.md#work-coordinator)
- [Outbox pattern](../../messaging/outbox-pattern.md)
