---
title: Recovery Worker & Policy Matrix
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
  - src/Whizbang.Data.Postgres/Migrations/051_DeadLetterRecovery.sql
---

# Recovery Worker & Policy Matrix

`DeadLetterRecoveryWorker` is the policy engine for `wh_dead_letters`. On a
backstop cadence (default 10 min) it scans for due rows, consults the
configured `IDeadLetterRecoveryPolicy` for each, and either re-emits the row
onto its source work table, holds it for review, or marks it permanently
failed.

## Default policy by failure reason

`DeadLetterRecoveryOptions.PolicyByReason` ships with this matrix:

| `MessageFailureReason` | Policy | Max retries | Cooldown | After exhaustion |
|---|---|---|---|---|
| `Throttled` | AggressiveRetry | 3 | 30 min | Pending (keep retrying) |
| `TransportException` | MediumRetry | 3 | 1 h | Pending |
| `LeaseExpired` | AggressiveRetry | 5 | immediate | Pending |
| `MaxAttemptsExceeded` | ConservativeRetry | 1 | 6 h | HoldForReview |
| `EventStorageFailure` | HoldForReview | 0 | — | HoldForReview |
| `ValidationError` | HoldForReview | 0 | — | HoldForReview |
| `SerializationError` | HoldForReview | 0 | — | HoldForReview |
| `TransportNotReady` | MediumRetry | 3 | 30 min | Pending |
| `Unknown` | OneShotThenHold | 1 | 1 h | HoldForReview |

Reasons that indicate **data corruption or schema mismatch**
(`ValidationError`, `SerializationError`, `EventStorageFailure`) skip recovery
entirely — they're held for an operator to look at. Reasons that indicate
**transient broker stress** (`Throttled`, `TransportException`) retry
aggressively. `MaxAttemptsExceeded` gets one careful retry after a 6-hour
cooldown — long enough that whatever caused the original attempt to fail
has likely passed.

## Custom policy

Operators that need finer control replace the default policy via DI:

```csharp{
title: "Register a custom DLQ recovery policy"
description: "Replaces the default IDeadLetterRecoveryPolicy via DI to customize retry counts, cooldowns, stream recovery mode, and whether a given DLQ entry should recover at all."
framework: "NET10"
category: "Dead Letter Queue"
difficulty: "ADVANCED"
tags: ["dead-letter", "recovery", "IDeadLetterRecoveryPolicy", "RecoveryPolicy", "custom-policy"]
}
services.AddSingleton<IDeadLetterRecoveryPolicy, MyCustomPolicy>();

public sealed class MyCustomPolicy : IDeadLetterRecoveryPolicy {
  public RecoveryPolicy GetPolicy(DeadLetterEntry entry) {
    if (entry.MessageType.Contains("InventoryAdjust")) {
      return new("InventorySpecific", MaxRetries: 5, Cooldown: TimeSpan.FromHours(2),
                 HoldForReviewAfterExhaustion: true);
    }
    return DefaultDeadLetterRecoveryPolicy.Default.GetPolicy(entry);
  }

  public StreamRecoveryMode GetStreamMode(DeadLetterEntry entry)
    => entry.StreamId is null ? StreamRecoveryMode.PerMessage
                              : StreamRecoveryMode.TailAware;

  public bool ShouldRecover(DeadLetterEntry entry) {
    if (entry.RecoveryStatus == DeadLetterRecoveryStatus.HoldForReview) return false;
    return true;
  }
}
```

## Stream recovery modes

`StreamRecoveryMode` controls how sibling DLQ entries on the same `stream_id`
are coordinated:

- **`PerMessage`** — recover each row independently. Default for any DLQ row
  without a `stream_id`. Faster but doesn't preserve original event ordering
  if multiple entries on the same stream all need recovery.
- **`TailAware`** — gather all sibling entries for the same `stream_id`, sort
  by original event order, and re-emit them together. FIFO preserved when
  every recovery succeeds. When any one fails, the rest stay in DLQ; ordering
  is best-effort.

Use `TailAware` for streams that drive aggregate-mutation receptors or
perspectives where re-applying out of order would surface a temporary bad
state.

## Generation-tagged auto-replay

Every DLQ row records the `generation` (typically the Whizbang+app version
combo) it dead-lettered under. On every deploy:

1. The `DeadLetterRecoveryWorker` runs one extra scan at startup.
2. For every row whose current generation is NOT in
   `retried_on_generations`, `next_recovery_attempt_at` is reset to `NOW()`.
3. Row is appended to `retried_on_generations` so the next deploy doesn't
   re-trigger it.

This implements the "we shipped a fix — try again" semantic. Operators don't
need to manually trigger a sweep after a hotfix; the row gets a free attempt
on the new generation. If the fix didn't address it, the row falls back to
its normal recovery cadence.

Disable globally via:

```json{
title: "Disable generation-tagged auto-replay"
description: "Sets EnableGenerationReplay to false so DLQ rows are not automatically given a free retry attempt on each new deploy generation."
category: "Dead Letter Queue"
difficulty: "BEGINNER"
tags: ["dead-letter", "recovery", "generation-replay", "configuration"]
}
{
  "Whizbang": {
    "DeadLetterRecovery": { "EnableGenerationReplay": false }
  }
}
```

## See also

- [Internal DLQ table](./internal-dlq)
- [Operator HTTP API](./operator-api) — manual operator actions
- [Transport DLQ recovery](./transport-recovery) — the broker-side flow
