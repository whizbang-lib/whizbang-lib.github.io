---
title: Recovery Worker & Policy Matrix
pageType: reference
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
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
testReferences:
  - tests/Whizbang.Core.Tests/Workers/DeadLetterRecoveryWorkerTests.cs
  - tests/Whizbang.Core.Tests/Messaging/DefaultDeadLetterRecoveryPolicyTests.cs
  - tests/Whizbang.Core.Tests/Messaging/DeadLetterRecoveryPolicyTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EFCoreDeadLetterRecoveryServiceTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/DeadLetterRecoverySqlTests.cs
  - tests/Whizbang.Core.Tests/Observability/DeadLetterMetricsTests.cs
---

# Recovery Worker & Policy Matrix

`DeadLetterRecoveryWorker` is the policy engine for `wh_dead_letters`. On a
backstop cadence (default 10 min, `ScanIntervalMinutes`) it scans for due
rows (up to `ScanBatchSize`, default 200, per cycle), consults the
configured `IDeadLetterRecoveryPolicy` for each, and either re-emits the row
onto its source work table (via the atomic `recover_dead_letter` SQL
function, which re-inserts with `attempts=0`), holds it for review, or marks
it permanently failed. Besides the backstop poll, the worker also wakes
within milliseconds of a new DLQ row when the `DeadLetterReady` NOTIFY
signal is wired — migration 056 adds an `AFTER INSERT` trigger on
`wh_dead_letters` that fires it.

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

"After exhaustion" is driven by `RecoveryPolicy.HoldForReviewAfterExhaustion`:
once `recovery_attempts` reaches the policy's `MaxRecoveryAttempts`, the
worker transitions the row to `HoldForReview` (when `true`) or
`PermanentlyFailed` (when `false`) — it never keeps retrying past the
budget. Failure reasons without an entry in `PolicyByReason` (e.g. the
newer `SecurityContextEstablishmentFailure`, `EmptyStreamId`,
`MessageBodyTooLarge` reasons) fall back to the `Unknown` policy.

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

## Stream recovery modes

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
}
services.Configure<DeadLetterRecoveryOptions>(o => o.EnableGenerationReplay = false);

// Other knobs on the same options class:
services.Configure<DeadLetterRecoveryOptions>(o => {
  o.Enabled = true;              // killswitch for the whole worker (default true)
  o.ScanIntervalMinutes = 10;    // backstop cadence (default 10)
  o.ScanBatchSize = 200;         // rows fetched per scan cycle (default 200)
});
```

## Telemetry

The worker reports through `DeadLetterMetrics` (meter `Whizbang.DeadLetters`):

| Metric | Type | Dimensions |
|---|---|---|
| `whizbang.dead_letters.recovered` | counter | `source_table` |
| `whizbang.dead_letters.held` | counter | `policy_name`, `reason` |
| `whizbang.dead_letters.permanently_failed` | counter | `policy_name`, `reason` |
| `whizbang.dead_letters.recovery_attempts` | counter | `reason` |
| `whizbang.dead_letters.generation_replay_scheduled` | counter | `generation` |

The worker also exposes in-process counters for tests and health endpoints:
`TotalScans`, `TotalRecovered`, `TotalHeld`, `TotalPermanentlyFailed`,
`TotalGenerationReplays`.

## See also

- [Internal DLQ table](./internal-dlq)
- [Operator HTTP API](./operator-api) — manual operator actions
- [Transport DLQ recovery](./transport-recovery) — the broker-side flow
