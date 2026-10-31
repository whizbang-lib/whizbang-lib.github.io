---
title: Recovery Worker & Policy Matrix
pageType: reference
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Dead-Letter Queue
order: 2
description: >-
  How DeadLetterRecoveryWorker drives wh_dead_letters back through the work
  tables — per-MessageFailureReason policy defaults, generation-tagged
  auto-replay, and how to register a custom IDeadLetterRecoveryPolicy.
tags: >-
  dead-letter-queue, recovery, IDeadLetterRecoveryPolicy, RecoveryPolicy,
  MessageFailureReason, generation-replay
codeReferences:
  - src/Whizbang.Core/Messaging/IDeadLetterRecoveryService.cs
  - src/Whizbang.Core/Messaging/DeadLetterRecoveryTypes.cs
  - src/Whizbang.Core/Workers/DeadLetterRecoveryWorker.cs
  - src/Whizbang.Core/Observability/DeadLetterMetrics.cs
  - src/Whizbang.Data.Postgres/Migrations/051_DeadLetterRecovery.sql
  - src/Whizbang.Data.Postgres/Migrations/056_DeadLetterReadyNotify.sql
  - src/Whizbang.Data.Postgres/Migrations/241_RecoveredWorkReentersThroughItsStore.sql
  - src/Whizbang.Data.Postgres/Migrations/256_UnstoredOutboxMessagesAreDeadLettered.sql
  - src/Whizbang.Data.Postgres/Migrations/257_UnstoredInboxMessagesAreDeadLettered.sql
  - src/Whizbang.Data.EFCore.Postgres/EFCoreDeadLetterRecoveryService.cs
testReferences:
  - tests/Whizbang.Core.Component.Tests/Workers/DeadLetterRecoveryWorkerTests.cs
  - tests/Whizbang.Core.Tests/Messaging/DefaultDeadLetterRecoveryPolicyTests.cs
  - tests/Whizbang.Core.Tests/Messaging/DeadLetterRecoveryPolicyTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreDeadLetterRecoveryServiceTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/DeadLetterRecoverySqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/RecoveredWorkReentrySqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/RecoveredOutboxDeadLetterPublishTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/RecoveredPerspectiveDeadLetterApplyTests.cs
  - tests/Whizbang.Core.Tests/Observability/DeadLetterMetricsTests.cs
---

# Recovery Worker & Policy Matrix

`DeadLetterRecoveryWorker` is the policy engine for `wh_dead_letters`. On a
backstop cadence (default 10 min, `ScanIntervalMinutes`) it scans for due
rows (up to `ScanBatchSize`, default 2000 — see Adaptive scan batch below, per cycle), consults the
configured `IDeadLetterRecoveryPolicy` for each, and either re-emits the row
onto its source work table, holds it for review, or marks
it permanently failed. Every recovered row re-enters through the store a new
arrival of the same work goes through, and its dead letter reads Recovered only
once the work has run: inbox and broker rows through the inbox's arrival path
(`store_inbox_messages`, see [re-entry](./transport-recovery#reentry)), outbox
and perspective rows through `store_outbox_messages` and
`store_perspective_events` (see [outbox and perspective
re-entry](#outbox-perspective-reentry)). Besides the backstop poll, the worker also wakes
within milliseconds of a new DLQ row when the `DeadLetterReady` NOTIFY
signal is wired — migration 056 adds an `AFTER INSERT` trigger on
`wh_dead_letters` that fires it.

## Outbox and perspective re-entry {#outbox-perspective-reentry}

An outbox dead letter re-enters through `store_outbox_messages` and a perspective dead letter through
`store_perspective_events`, the stores a new message or a new event's perspective work goes through. The
recovered row is stored in the same shape as the original: its envelope type, event flag, flags, scope,
priority, schedule and coalesce group for an outbox message, and its priority for perspective work, all kept
by the dead-letter capture. It runs every step the store runs for a new row, so a recovered outbox event is
appended to the event store and published under its own envelope type, and a recovered perspective event
behind its cursor rewinds the perspective. The row differs from a new one in two ways only:

- the store claims its dead letter (**Recovering**) in the same transaction;
- the row names the dead letter it came from (`recovered_from_dead_letter_id`).

```mermaid{caption="Outbox and perspective dead-letter recovery: the store claims the dead letter, the completion settles it, and a second failure holds it for review." tests=["RecoveredOutboxDeadLetterPublishTests.ARecoveredOutboxEvent_IsPublishedAsTheEventItWasStoredAs_AndReadsRecoveredOncePublishedAsync", "RecoveredWorkReentrySqlTests.ARecoveredOutboxMessage_DeadLetteredAgain_IsHeldForReview_NamingTheNewDeadLetterAsync", "RecoveredWorkReentrySqlTests.ARecoveredPerspectiveEvent_NoLongerInTheEventStore_IsHeldForReview_AndNotReEnteredAsync"]}
flowchart LR
    DL["Dead letter<br/>(Pending)"] -->|"wh_recover_dead_letter"| ST["store_outbox_messages /<br/>store_perspective_events<br/>dead letter: Recovering"]
    ST -->|"published / applied"| OK["Dead letter: Recovered"]
    ST -->|"dead-lettered again"| HR["Dead letter: HoldForReview<br/>(note names the new dead letter)"]
    DL -->|"perspective event purged"| HP["Dead letter: HoldForReview<br/>(note gives the reason)"]

    class DL,ST layer-core
    class OK layer-command
    class HR,HP layer-event
```

The dead letter reads **Recovering** until the work has run, then **Recovered**: an outbox message once
`complete_outbox_published` records it published, perspective work once
`process_perspective_event_completions` records the event applied. When the recovered row is dead-lettered
again, the dead letter it came from becomes **HoldForReview** under an operator hold, and its
`operator_notes` name the new dead letter, which now holds custody. Recovered is never written for a
recovery that did not complete. A perspective dead letter whose event is no longer in the event store (its
stream was purged) can apply nothing, so it is held for review with that reason instead of being re-entered.
When the message id is still in the outbox, the store keeps the existing row and the dead letter stays due.

Recovered work runs at the priority it was stored with (see
[message priority](../../fundamentals/messaging/message-priority#recovered-dead-letters)). A dead letter
captured before migration 241 kept no priority and re-enters as background, as recovery used to store it.
It also kept no envelope type: it re-enters under the envelope type its message type names, and an outbox
message whose event is in the event store re-enters as that event, with its flags and scope.
{verified: RecoveredWorkReentrySqlTests.ARecoveredOutboxMessage_IsStoredInTheShapeItWasStoredInAsync, RecoveredWorkReentrySqlTests.AnOutboxEventRefusedBeforeItWasAppended_IsAppendedWhenRecovered_WithItsScopeAndFlagsAsync, RecoveredWorkReentrySqlTests.ARecoveredPerspectiveWorkRow_IsStoredInTheShapeTheEventStoreChainStoresItInAsync, RecoveredWorkReentrySqlTests.ARecoveredPerspectiveEvent_BehindItsCursor_FlagsTheCursorForRewindAsync, RecoveredWorkReentrySqlTests.ARecoveredOutboxMessage_DeadLetteredAgain_IsHeldForReview_NamingTheNewDeadLetterAsync, RecoveredWorkReentrySqlTests.ARecoveredPerspectiveWorkRow_DeadLetteredAgain_IsHeldForReview_NamingTheNewDeadLetterAsync, RecoveredWorkReentrySqlTests.ARecoveredPerspectiveEvent_NoLongerInTheEventStore_IsHeldForReview_AndNotReEnteredAsync, RecoveredWorkReentrySqlTests.ARecovery_OfAnOutboxMessageStillInTheOutbox_LeavesItsDeadLetterDueAsync, RecoveredWorkReentrySqlTests.ASecondRecovery_OfAnOutboxDeadLetterAlreadyRecovering_StoresNothingAsync, RecoveredOutboxDeadLetterPublishTests.ARecoveredOutboxEvent_IsPublishedAsTheEventItWasStoredAs_AndReadsRecoveredOncePublishedAsync, RecoveredOutboxDeadLetterPublishTests.AnOutboxDeadLetterCapturedBeforeItKeptTheEnvelopeType_IsPublishedUnderTheNameItsStoreWritesAsync, RecoveredPerspectiveDeadLetterApplyTests.ARecoveredPerspectiveWorkRow_IsApplied_AndReadsRecoveredOnceAppliedAsync}

### The SQL entry points {#recovery-sql}

| Function | Use |
|---|---|
| `wh_recover_dead_letter(dead_letter_id uuid, partition_count integer)` | Re-enters an outbox or perspective dead letter, storing the row with the partition count every arrival is stored with. Returns whether the row re-entered. `EFCoreDeadLetterRecoveryService` calls it with `ClaimWorkerOptions.PartitionCount`. |
| `recover_dead_letter(dead_letter_id uuid)` | Unchanged signature: calls `wh_recover_dead_letter` at the claim's default partition count (10000). Kept so scripts and older migrations replay. |

Both decline an inbox or broker dead letter (those re-enter through `store_inbox_messages` from the
recovery worker) and a dead letter that is already Recovering, held for review or settled, leaving it as it was.

:::note[Before migration 241]
`recover_dead_letter` re-inserted outbox and perspective rows with column lists of its own and marked the
dead letter Recovered in the same call, before anything ran. The outbox copy carried the envelope type
`recovered`, which the drain sends as the wire's envelope type header, so a receiving service could not
resolve the message: Azure Service Bus completed and dropped it, and RabbitMQ dead-lettered it. Both copies
were stored as background work on partition 0.
:::

## Default policy by failure reason

`DeadLetterRecoveryOptions.PolicyByReason` ships with this matrix:

| `MessageFailureReason` | Policy | Max recovery attempts | Cooldown | After exhaustion |
|---|---|---|---|---|
| `Throttled` | AggressiveRetry | 3 | 30 min | PermanentlyFailed |
| `TransportException` | MediumRetry | 3 | 1 h | PermanentlyFailed |
| `LeaseExpired` | AggressiveRetry | 5 | immediate | PermanentlyFailed |
| `MaxAttemptsExceeded` | ConservativeRetry | 1 | 6 h | HoldForReview |
| `EventStorageFailure` | HoldForReview | 0 | — | HoldForReview |
| `ValidationError` | HoldForReview | 0 | — | HoldForReview |
| `SerializationError` | HoldForReview | 0 | — | HoldForReview |
| `TransportNotReady` | MediumRetry | 3 | 30 min | PermanentlyFailed |
| `Unknown` | OneShotThenHold | 1 | 1 h | HoldForReview |
| `MixedStreamRefused` ([WHIZ133](../diagnostics/whiz133)) | HoldForReview | 0 | none | HoldForReview |
| `OutboxStoreFailed` (23, [outbox batcher](../../extending/internals/outbox-batch-strategy.md#when-a-flush-fails)) | AggressiveRetry | 5 | 1 min | HoldForReview |
| `InboxStoreFailed` (24, [inbox batcher](../../extending/internals/inbox-batch-strategy.md#when-a-flush-fails)) | AggressiveRetry | 5 | 1 min | HoldForReview |
| `StreamSealed` (25, [a sealed stream](../../fundamentals/events/stream-end-of-life.md#a-sealed-stream-refuses-appends)) | HoldForReview | 0 | none | HoldForReview |
| `StreamArchived` (26, [an archived stream under Refuse](../../fundamentals/events/archive-store.md#appending-to-an-archived-stream)) | HoldForReview | 0 | none | HoldForReview |
| `AwaitingRestore` (27, [an archived stream under AutoRestore](../../fundamentals/events/archive-store.md#restore-requests); held by its restore request until the restore makes it due) | AfterRestore | 3 | 1 min | HoldForReview |

{verified: DefaultDeadLetterRecoveryPolicyTests.GetPolicy_OutboxStoreFailed_RetriesAggressivelyThenHoldsAsync, DefaultDeadLetterRecoveryPolicyTests.GetPolicy_InboxStoreFailed_RetriesAggressivelyThenHoldsAsync, DefaultDeadLetterRecoveryPolicyTests.GetPolicy_StreamSealed_HoldsForReviewWithoutRetryAsync, DefaultDeadLetterRecoveryPolicyTests.GetPolicy_StreamArchived_HoldsForReviewWithoutRetryAsync, DefaultDeadLetterRecoveryPolicyTests.GetPolicy_AwaitingRestore_RedrivesSoonAfterTheRestore_ThenHoldsAsync}

"After exhaustion" is driven by `RecoveryPolicy.HoldForReviewAfterExhaustion`:
once `recovery_attempts` reaches the policy's `MaxRecoveryAttempts`, the
worker transitions the row to `HoldForReview` (when `true`) or
`PermanentlyFailed` (when `false`) — it never keeps retrying past the
budget.

:::note[`MaxRecoveryAttempts` counts one row, not one message]
A recovery re-delivers the message; if it fails again the framework records that
as a **new** dead-letter row with a new `source_id`, not an update to the row it
came from. Each pass therefore presents a row on its first attempt, so a per-row
budget alone cannot see a message that keeps coming back, and raising it does not
help. What bounds that cycle is the redelivery observation counter described
below.
::: Failure reasons without an entry in `PolicyByReason` (e.g. the
newer `SecurityContextEstablishmentFailure`, `EmptyStreamId`,
`MessageBodyTooLarge` reasons) fall back to the `Unknown` policy.

Reasons that indicate **data corruption or schema mismatch**
(`ValidationError`, `SerializationError`, `EventStorageFailure`) skip recovery
entirely — they're held for an operator to look at. Reasons that indicate
**transient broker stress** (`Throttled`, `TransportException`) retry
aggressively. `MaxAttemptsExceeded` gets one careful retry after a 6-hour
cooldown — long enough that whatever caused the original attempt to fail
has likely passed.
`OutboxStoreFailed` and `InboxStoreFailed` are messages a batcher accepted
and could not store, nearly always because the database was unreachable or out
of connections for longer than the batcher's own retries, so they are re-driven
soon and often, then held for review so a store that keeps refusing is visible.

## Custom policy

Operators that need finer control replace the default policy via DI:

```csharp{
title: "Register a custom DLQ recovery policy"
description: "Replaces the default IDeadLetterRecoveryPolicy via DI to customize retry counts, cooldowns, stream recovery mode, and whether a given DLQ entry should recover at all."
framework: "NET10"
category: "Dead Letter Queue"
difficulty: "ADVANCED"
tags: ["dead-letter", "recovery", "IDeadLetterRecoveryPolicy", "RecoveryPolicy", "custom-policy"]
unverified: "user-domain custom-policy illustration — MyCustomPolicy is example consumer code; the DefaultDeadLetterRecoveryPolicy it delegates to is verified by DefaultDeadLetterRecoveryPolicyTests, outside the current coverage map"
}
services.AddSingleton<IDeadLetterRecoveryPolicy, MyCustomPolicy>();

public sealed class MyCustomPolicy(
    IOptions<DeadLetterRecoveryOptions> options) : IDeadLetterRecoveryPolicy {
  // Delegate to the default dictionary-lookup policy for anything we don't override.
  private readonly DefaultDeadLetterRecoveryPolicy _fallback = new(options);

  public RecoveryPolicy GetPolicy(DeadLetterEntry entry) {
    if (entry.MessageType.Contains("InventoryAdjust")) {
      return new("InventorySpecific", MaxRecoveryAttempts: 5,
                 Cooldown: TimeSpan.FromHours(2),
                 HoldForReviewAfterExhaustion: true);
    }
    return _fallback.GetPolicy(entry);
  }

  public StreamRecoveryMode GetStreamMode(DeadLetterEntry entry)
    => entry.StreamId is null ? StreamRecoveryMode.PerMessage
                              : StreamRecoveryMode.TailAware;

  public bool ShouldRecover(DeadLetterEntry entry) {
    if (entry.RecoveryStatus == DeadLetterRecoveryStatus.HoldForReview) { return false; }
    return _fallback.ShouldRecover(entry);
  }
}
```

## Stream recovery modes {#stream-recovery-modes}

`StreamRecoveryMode` is the stream-coordination hint on the policy surface:

- **`PerMessage`** — recover each row independently. Default for any DLQ row
  without a `stream_id`.
- **`TailAware`** — coordinate recovery with sibling DLQ entries on the same
  `stream_id`, preserving FIFO when every recovery succeeds. The default
  policy returns `TailAware` whenever `stream_id` is set.

:::updated
At this commit the recovery worker does **not** consult
`IDeadLetterRecoveryPolicy.GetStreamMode` — rows recover per-message, in
FIFO order by `dead_lettered_at` (the order `fetch_dead_letters_due`
returns them). `StreamRecoveryMode` ships on the policy interface so custom
policies compile against the final shape, but TailAware gather-and-re-emit
coordination is design intent, not shipped behavior.
:::

## Generation-tagged auto-replay

Every DLQ row records the `generation` (typically the Whizbang+app version
combo) it dead-lettered under. On every deploy:

1. The `DeadLetterRecoveryWorker` runs the sweep
   (`reset_dead_letters_for_generation`) once at startup.
2. For every row whose current generation is NOT in
   `retried_on_generations`, `next_recovery_at` is reset to `NOW()` and
   `recovery_status` returns to `Pending`. The sweep skips
   `PermanentlyFailed` rows and rows held via operator disposition
   `HoldIndefinitely` — but `HoldForReview` rows are included, so a held
   row gets one fresh attempt on each new build.
3. The generation is appended to `retried_on_generations` so the next
   deploy doesn't re-trigger it.

This implements the "we shipped a fix — try again" semantic. Operators don't
need to manually trigger a sweep after a hotfix; the row gets a free attempt
on the new generation. If the fix didn't address it, the row falls back to
its normal recovery cadence.

Disable via the options API (`DeadLetterRecoveryOptions` is registered with
`AddOptions()` and is not auto-bound from `appsettings.json`):

```csharp{
title: "Disable generation-tagged auto-replay"
description: "Sets EnableGenerationReplay to false via Configure so DLQ rows are not automatically given a free retry attempt on each new deploy generation."
framework: "NET10"
category: "Dead Letter Queue"
difficulty: "BEGINNER"
tags: ["dead-letter", "recovery", "generation-replay", "configuration"]
unverified: "DI configuration snippet — the Enabled killswitch is exercised by DeadLetterRecoveryWorkerTests.DisabledWorker_DoesNotScanAsync, but no unit pins EnableGenerationReplay=false"
}
services.Configure<DeadLetterRecoveryOptions>(o => o.EnableGenerationReplay = false);

// Other knobs on the same options class:
services.Configure<DeadLetterRecoveryOptions>(o => {
  o.Enabled = true;              // killswitch for the whole worker (default true)
  o.ScanIntervalMinutes = 10;    // backstop cadence (default 10)
  o.ScanBatchSize = 2000;        // CEILING the adaptive controller ramps toward (default 2000)
  o.AdaptiveScanBatchEnabled = true;  // AIMD sizing on by default; false = fixed ScanBatchSize
  o.MinScanBatchSize = 50;       // floor / starting batch, and the pressure back-off target
  o.ScanBatchIncreaseStep = 200; // additive growth per clean, saturated scan
  o.ScanBatchChurnThreshold = 0.5; // ratio above which the batch halves under pressure
});
```

## Adaptive scan batch

The settled-path scan batch is sized by an AIMD controller — the same
`AdaptiveStreamBatch` the claim path uses — rather than a fixed number:

- It starts at `MinScanBatchSize` (default 50), the width a freshly started worker uses
  before it has any drain feedback.
- Each clean, **saturated** scan (a full batch returned, zero re-drive failures) grows it by
  `ScanBatchIncreaseStep` (default 200), up to the `ScanBatchSize` ceiling (default 2000).
- A pass forced through the settledness gate while the service is busy counts as full churn
  and **halves** the batch, walking it back toward `MinScanBatchSize`.

Because the batch ramps into the ceiling instead of bursting to it cold, a high `ScanBatchSize`
is safe: an idle service drains a large backlog an order of magnitude faster than the old fixed
200, while a busy service still trickles at `PressuredScanBatchSize` and backs the batch down.
Set `AdaptiveScanBatchEnabled = false` to pin every settled scan to the fixed `ScanBatchSize`
(the pre-2.x behavior).

## Canary verdicts are standing evidence

A held cohort's canary campaign resolves per `(error_fingerprint, build generation)`.
The verdict is not a one-shot release trigger — it is a durable statement about the
build, and the recovery worker keeps consulting it:

- **Pass** releases the rows currently in `HoldForReview` *and* grants every later
  exhausted row of the same fingerprint a fresh attempt on the paced scan cadence
  (`get_passed_campaign_fingerprints`). Without this, a proven-safe cohort re-quarantined
  itself one scan batch at a time after the campaign retired, and only a process restart
  released another slice.
- A row that keeps failing after the grant still paces itself through the policy
  cooldown — the bypass never produces a hot loop.
- Verdicts are generation-scoped: a Pass on one build proves nothing about the next.

### Evidence can be destroyed — verdicts cannot be vacuous

Probe rows live in `wh_dead_letters` like any other row, so retention purges and
operator deletes can destroy a live campaign's evidence. Two guards make that safe:

- `evaluate_canary_campaign` resolves an empty evidence set (0 succeeded, 0 failed,
  0 outstanding) to **Pending**, never to a terminal verdict. The `failed = 0` branch
  previously returned Pass on zero surviving probes.
- On that empty-evidence Pending, the worker re-mints probes: `begin_canary_probes`
  refreshes an unresolved campaign's `probe_ids` from the surviving held rows
  (`started_at` moves with the refresh). While probe rows survive, the call remains
  the idempotent resume it always was.

### Settled-row retention

`perform_maintenance` purges Recovered rows by **`recovered_at`** (setting
`dead_letter_retention_days`, default 7) — a freshly recovered row gets its full
window regardless of how old the original failure was. Retention previously keyed on
`dead_lettered_at`, which deleted the receipts of an old backlog within one
maintenance cycle of the drain doing its work. Rows referenced by an unresolved
campaign's `probe_ids` are exempt until the campaign resolves.

## Disabled subsystems dispose of their dead letters

A dead letter whose inner payload type belongs to a disabled subsystem (for example
`IntegrityCheckpoint` with `StreamIntegrity:CheckpointsEnabled=false`) is **settled by
the recovery worker itself** — `mark_dead_letter_discarded` moves it to Recovered with
an explanatory `operator_notes` entry, and the retention purge ages it out. The check
runs ahead of the exhaustion transition because quarantine-on-sight policies
(`PoisonRedeliveryLoop`, MaxAttempts 0) hold rows **before any dispatch**, so the
inbox-gate discard can never reach them; without the worker-side arm those rows were
permanently undisposable.

## Telemetry

The worker reports through `DeadLetterMetrics` (meter `Whizbang.DeadLetters`):

| Metric | Type | Dimensions |
|---|---|---|
| `whizbang.dead_letters.recovered` | counter | `source_table` |
| `whizbang.dead_letters.held` | counter | `policy_name`, `reason` |
| `whizbang.dead_letters.permanently_failed` | counter | `policy_name`, `reason` |
| `whizbang.dead_letters.recovery_attempts` | counter | `reason` |
| `whizbang.dead_letters.generation_replay_scheduled` | counter | `generation` |

`whizbang.dead_letters.recovered` counts re-entries: the row it counts reads Recovering at that moment and
reads Recovered once the work has run. A hold for review that the database makes (a recovery dead-lettered
again, or perspective work whose event was purged) is recorded in `operator_notes` and is not counted by
`whizbang.dead_letters.held`, which counts the worker's own transitions.

The worker also exposes in-process counters for tests and health endpoints:
`TotalScans`, `TotalRecovered`, `TotalHeld`, `TotalPermanentlyFailed`,
`TotalGenerationReplays`.

## Bounding the recovery cycle

Recovery re-delivers a message by writing it back into `wh_inbox`. That is a real
delivery and is counted like any other: storing it increments
`wh_message_deduplication.observation_count` for the message, which is the same
counter `store_inbox_messages` maintains for normal arrivals and the one
`PoisonMessageDetector` reads. A message that keeps returning through recovery
therefore accumulates observations and can be quarantined like any other poison
message.

The observation is charged only when the insert actually inserted. A
double-recovery race that delivered nothing is not charged, because spending a
message's budget on a delivery that never happened would push a healthy message
toward quarantine.

### The loop breaker

As a second line of defence, `DeadLetterRecoveryWorker` watches whether the rows
it is recovering are ones it created. A genuine backlog is made of rows that
already existed before the previous scan and it shrinks; a self-inflicted cycle
is made of rows that appeared after the previous scan began.

| Option | Default | Meaning |
| --- | --- | --- |
| `LoopBreakerEnabled` | `true` | Suspend recovery when it is generating what it recovers |
| `LoopBreakerFreshFraction` | `0.5` | Share of a batch postdating the last scan that counts as self-inflicted |
| `LoopBreakerConsecutiveCycles` | `3` | Consecutive such cycles before suspending |
| `LoopBreakerCooldownMinutes` | `60` | How long it stays suspended; `0` keeps it open until restart |

It never trips on the first scan of a process, which has no baseline to compare
against and is exactly when a real backlog most needs draining. A quiet cycle
clears the consecutive run. When it trips it logs at `Error` with the evidence,
and says plainly that dead letters accumulate while suspended and the underlying
failure still needs fixing: suspending recovery treats the symptom.

## Retention

`wh_dead_letters` is swept by `perform_maintenance`. Only rows that are settled
are eligible, meaning `Recovered(3)`, older than `dead_letter_retention_days`
(default 7). A recovered row is a receipt, not work.

Rows awaiting a human decision (`Pending`, `Recovering`, `HoldForReview`) and the
forensic record of what never succeeded (`PermanentlyFailed`) are kept regardless
of age, because age is not evidence that anyone looked at them. The sweep is
skipped entirely under `debug_mode`, where dead letters are the evidence an
operator asked to keep.


## See also

- [Internal DLQ table](./internal-dlq)
- [Operator HTTP API](./operator-api) — manual operator actions
- [Transport DLQ recovery](./transport-recovery) — the broker-side flow
