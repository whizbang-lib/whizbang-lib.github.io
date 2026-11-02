---
title: Inbox Dispatch Worker
pageType: concept
verifiedAgainstCommit: 8c3d6ebf
verifiedDate: 2026-11-01
version: 1.0.0
category: Workers
order: 7
description: >-
  How the inbox drain and dispatch workers turn claimed inbox streams into handler
  dispatches, how to wait for the drain to go idle, and what happens to a row whose
  envelope cannot be read: failed with backoff, then dead-lettered past MaxInboxAttempts.
tags: >-
  inbox, inbox-dispatch-worker, inbox-drain-worker, dead-letter, MaxInboxAttempts,
  serialization-error, operations
codeReferences:
  - src/Whizbang.Core/Workers/InboxDrainWorker.cs
  - src/Whizbang.Core/Workers/InboxDispatchWorker.cs
  - src/Whizbang.Core/Messaging/IDeadLetterStore.cs
  - src/Whizbang.Core/Observability/DeadLetterLog.cs
testReferences:
  - tests/Whizbang.Core.Component.Tests/Workers/InboxDrainWorkerGapTests.UnreadableRows.cs
  - tests/Whizbang.Core.Component.Tests/Workers/InboxDrainWorkerGapTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/InboxDrainWorkerTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/InboxDispatchWorkerCompositeCommitTests.cs
---

# Inbox Dispatch Worker

Inbox work reaches a handler through two background workers:

- **`InboxDrainWorker`** takes the inbox stream ids that `ClaimWorker` claimed, fetches each stream's leased
  rows in `received_at` order, reads each row's envelope, and writes the result to the inbox channel. It is the
  only source of inbox work, so disabling it (`InboxDrainWorkerOptions.Enabled = false`) stops inbox dispatch.
  See [Per-stream drain](../../fundamentals/work-coordinator/per-stream-drain) for its batching and memory budgets.
- **`InboxDispatchWorker`** reads the channel, applies the attempt bound (`MaxInboxAttempts`), runs the handlers and
  lifecycle stages, and commits the result. See [Inbox dispatch](../../fundamentals/work-coordinator/inbox-dispatch)
  for held rows, lease renewal and its log events.

This page covers the operational edges of the pair: waiting for the drain to go quiet, and the rows the drain cannot
hand on at all.

## Waiting for the drain to go idle {#idle}

`InboxDrainWorker.IsIdle` is true between batches when no stream ids are waiting. `OnWorkProcessingStarted` fires
when a non-empty batch starts, and `OnWorkProcessingIdle` fires when a batch finishes, including one whose fetch
threw. Test fixtures wait on `OnWorkProcessingIdle` before truncating tables, instead of sleeping; the outbox drain
worker has the same contract.
{verified: InboxDrainWorkerGapTests.ExecuteAsync_BatchFetchThrows_MarksStreamsDrained_FiresIdle_WorkerSurvivesAsync, InboxDrainWorkerGapTests.ExecuteAsync_Disabled_NeverFetches_LogsDisabledThenStoppedOnShutdownAsync}

## Rows whose envelope cannot be read {#unreadable-rows}
{verified: InboxDrainWorkerGapTests.UnreadableRow_BelowTheAttemptBound_IsFailedForBackoff_AndLoggedAtWarningAsync, InboxDrainWorkerGapTests.UnreadableRow_PastTheAttemptBound_IsDeadLetteredWithOneRecord_AndNotFailedAgainAsync}

The attempt bound lives in the dispatch worker, and a row whose stored envelope the drain cannot read never gets
there. So the drain bounds that row itself:

- **At or below `MaxInboxAttempts`**, the row is failed through the failure channel with
  `MessageFailureReason.SerializationError`. Its lease is released, its retry is backed off, and its next claim
  counts another attempt. The attempt is logged at Warning (`InboxDrainWorker` EventId 5) with the read's
  exception and the row's attempt count. The rest of the stream keeps draining, including rows behind it in a stream
  that filled its page.
- **Past `MaxInboxAttempts`**, the drain moves the row to `wh_dead_letters` with `MaxAttemptsExceeded` and the
  read failure in its error text, counts it on `whizbang.dead_letters.added`, and logs the one
  [dead-letter record](../observability/logging-categories#dead-lettered-messages) (EventId 1901,
  `MessageDeadLettered`) at the `Whizbang:DeadLetterLogging:Level` level, Error by default. That record replaces
  the EventId 5 line for the attempt that ends it, and the row is not failed as well.
- **If the move fails**, the drain logs EventId 64 at Warning with the move's exception and fails the row instead,
  so it is backed off and the move is tried again on its next attempt. A host with no dead-letter store wired fails
  the row the same way.
- **If the row is already gone** (another path moved it), nothing is logged and nothing is failed: the path that
  moved it logged the record.
- **With `MaxInboxAttempts` set to `null`**, nothing is dead-lettered, as on the dispatch path; every attempt is
  failed with backoff.

```mermaid{caption="An inbox row whose envelope cannot be read: failed with backoff until its attempts pass MaxInboxAttempts, then dead-lettered once with one record." tests=["InboxDrainWorkerGapTests.UnreadableRow_BelowTheAttemptBound_IsFailedForBackoff_AndLoggedAtWarningAsync", "InboxDrainWorkerGapTests.UnreadableRow_PastTheAttemptBound_IsDeadLetteredWithOneRecord_AndNotFailedAgainAsync", "InboxDrainWorkerGapTests.UnreadableRow_PastTheAttemptBound_WhenTheMoveFails_IsFailedForAnotherTryAsync", "InboxDrainWorkerGapTests.UnreadableRow_PastTheAttemptBound_AlreadyGone_LogsNoRecordAndFailsNothingAsync"]}
flowchart LR
    R["Envelope read fails"] --> B{"attempts > MaxInboxAttempts?"}
    B -->|"no, or bound is null"| F["Fail the row: SerializationError<br/>backoff, lease released<br/>EventId 5, Warning"]
    B -->|"yes"| M["Move to wh_dead_letters<br/>MaxAttemptsExceeded"]
    M -->|"moved"| D["EventId 1901 record<br/>dead_letters.added + 1"]
    M -->|"already gone"| G["Nothing logged, nothing failed"]
    M -->|"move threw, or no store"| X["EventId 64, Warning<br/>fail the row, move again next attempt"]
    X --> F

    class R,B layer-core
    class F,X layer-event
    class M,D,G layer-command
```

Why the drain does this rather than skipping the row: before, the row was skipped with nothing recorded. It stayed
leased, was fetched again on every poll, was claimed again with another attempt once its lease lapsed, and was never
failed or dead-lettered, so it was fetched, logged at Error and skipped forever. A row the drain cannot read is an
attempt like any other, and is counted against the same bound the dispatch worker applies, with the same reason
(`MaxAttemptsExceeded`) on the dead letter.

| Outcome | What is recorded | Log | Verified |
|---|---|---|---|
| At or below the bound | Failure, `SerializationError`; backoff; attempt counted at the next claim | EventId 5, Warning | {verified: InboxDrainWorkerGapTests.UnreadableRow_BelowTheAttemptBound_IsFailedForBackoff_AndLoggedAtWarningAsync, InboxDrainWorkerGapTests.UnreadableRow_InTheTailOfAStreamThatFilledItsPage_IsFailedTooAsync, InboxDrainWorkerTests.InboxDrainWorker_DeserializeFails_SkipsBadRow_ContinuesDrainAsync} |
| Past the bound | Dead letter, `MaxAttemptsExceeded`; `whizbang.dead_letters.added` | EventId 1901 at the configured level; no EventId 5 | {verified: InboxDrainWorkerGapTests.UnreadableRow_PastTheAttemptBound_IsDeadLetteredWithOneRecord_AndNotFailedAgainAsync, InboxDrainWorkerGapTests.UnreadableRow_PastTheAttemptBound_LogsTheRecordAtTheConfiguredLevelAsync} |
| Past the bound, already moved | Nothing | Nothing | {verified: InboxDrainWorkerGapTests.UnreadableRow_PastTheAttemptBound_AlreadyGone_LogsNoRecordAndFailsNothingAsync} |
| Past the bound, move fails | Failure, so the move is tried again on the next attempt | EventId 64, Warning, then EventId 5 | {verified: InboxDrainWorkerGapTests.UnreadableRow_PastTheAttemptBound_WhenTheMoveFails_IsFailedForAnotherTryAsync} |
| Past the bound, no dead-letter store | Failure | EventId 5, Warning | {verified: InboxDrainWorkerGapTests.UnreadableRow_PastTheAttemptBound_WithNoDeadLetterStore_IsFailedAsync} |
| `MaxInboxAttempts` is `null` | Failure, every attempt | EventId 5, Warning | {verified: InboxDrainWorkerGapTests.UnreadableRow_WithNoAttemptBound_IsFailedAsync} |

**Upgrade note.** EventId 5 was logged at Error before. An alert keyed on it at Error stops firing; alert on EventId
1901 instead, which is logged once when the row is dead-lettered.

A payload that the drain reads but the serializer refuses at dispatch is a different failure, handled by the dispatch
worker (EventId 76); see [Inbox dispatch log events](../../fundamentals/work-coordinator/inbox-dispatch#log-events).

## Log events {#log-events}

Category `Whizbang.Core.Workers.InboxDrainWorker`:

| EventId | Level | When |
|---|---|---|
| 5 | Warning | A row's envelope could not be read; the row is failed with backoff. Carries the message id, the row's attempts and the read's exception. |
| 64 | Warning | A row past `MaxInboxAttempts` whose envelope cannot be read could not be moved to the dead-letter store; it is failed and the move is tried again on its next attempt. |
| 1901 | Error by default | The [dead-letter record](../observability/logging-categories#dead-lettered-messages), for a row past `MaxInboxAttempts` that the drain dead-lettered. |

The dispatch worker's events are listed under [Inbox dispatch log events](../../fundamentals/work-coordinator/inbox-dispatch#log-events)
and [Logging categories](../observability/logging-categories#inbox-pipeline-events).

## Related

- [Per-stream drain](../../fundamentals/work-coordinator/per-stream-drain)
- [Inbox dispatch](../../fundamentals/work-coordinator/inbox-dispatch)
- [Internal DLQ](../dead-letter-queue/internal-dlq)
- [Composite events: transactional expansion](../../fundamentals/messaging/composite-events#transactional-expansion)
- [Logging categories](../observability/logging-categories)
