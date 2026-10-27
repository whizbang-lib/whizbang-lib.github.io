---
title: Versioned Apply — Strict Cross-Pod Ordering
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Fundamentals
order: 5
description: >-
  Opt-in marker that gates a perspective model's UPSERT on UUIDv7 EventId
  ordering. Stops stale-read cross-pod writes from overwriting a row that a
  newer event already advanced — the strand-prevention guard SagaItemModel
  needed beyond v0.740's stream-affinity gate.
tags: 'perspectives, sagas, cross-pod, strand, ordering, idempotency'
codeReferences:
  - src/Whizbang.Core/Perspectives/IVersionedApplyTarget.cs
  - src/Whizbang.Data.EFCore.Postgres/BaseUpsertStrategy.cs
  - src/Whizbang.Sagas/Models/SagaItemModel.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/VersionedApplyTargetTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/CrossPodStaleReadRegressionRaceTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/PerspectiveLateEventApplyTests.cs
---

# Versioned Apply — Strict Cross-Pod Ordering

## When you need it

Two pods are processing the same per-item stream. Each loads the projection row at roughly the same time and both see "no row" (or an earlier state). Each applies its own event and writes back. The writes go through independent transactions. If the staler write commits *last*, the row regresses — Pod A's `Completed` write gets overwritten by Pod B's stale-read `Running` write a few milliseconds later.

This race produced a real production per-item saga strand that survived even the stream-affinity gate: 2 of 350 items stranded at `Running` even though both their `SagaItemStartedEvent` and `SagaItemCompletedEvent` were durably committed to `wh_event_store`. The framework reconciler healed the saga, but the projection itself stayed wrong.

The default storage contract is **deliberately permissive** for this case — see [`CrossPodStaleReadRegressionRaceTests`](https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Data.EFCore.Postgres.Tests/CrossPodStaleReadRegressionRaceTests.cs). Whizbang's chosen v0.740 solution was upstream: `PerspectiveWorker`'s `(streamId, perspectiveName)` affinity gate plus `wh_active_streams` cross-pod ownership. Together they pin a stream to one pod at a time. But the gate has narrow windows where the strand can still form (lease handoff during pod restarts, the gap between `wh_active_streams` row expiry and the next pod's claim, etc.).

`IVersionedApplyTarget` is the **opt-in** marker that closes those windows for models that can't tolerate them. It adds a UUIDv7 EventId check to the UPSERT `WHERE` clause: a write whose `metadata.EventId` is lexicographically older than what's already on the row is dropped.

## How it works

```csharp{title="Opt in" tests=["VersionedApplyTargetTests.StaleEventWrite_OnVersionedTarget_DoesNotRegressTerminalRowAsync", "VersionedApplyTargetTests.NewerEventWrite_OnVersionedTarget_AdvancesRowAsync", "VersionedApplyTargetTests.WriteAtTheStoredEventId_OnVersionedTarget_LandsAsync"]}
using Whizbang.Core.Perspectives;

public class SagaItemModel : ISagaItem, IVersionedApplyTarget {
  // ... model fields unchanged
}
```

The Postgres atomic UPSERT path detects the marker at compile-time-pinned runtime check and substitutes the WHERE clause:

```sql{
title: "Default CommitSequence guard vs the IVersionedApplyTarget EventId WHERE clause"
description: "Compares the permissive last-writer-wins CommitSequence UPSERT predicate against the opt-in UUIDv7 EventId predicate that drops writes older than the row's newest event."
category: "Perspectives"
difficulty: "ADVANCED"
tags: ["versioned-apply", "cross-pod", "upsert", "uuidv7", "strand-prevention"]
}
-- Default (non-opted-in models)
WHERE wh_per_X.metadata->>'CommitSequence' IS NULL
   OR EXCLUDED.metadata->>'CommitSequence' IS NULL
   OR (EXCLUDED.metadata->>'CommitSequence')::bigint >=
      (wh_per_X.metadata->>'CommitSequence')::bigint

-- IVersionedApplyTarget opt-in
WHERE wh_per_X.metadata->>'EventId' IS NULL
   OR EXCLUDED.metadata->>'EventId' >= wh_per_X.metadata->>'EventId'
```

UUIDv7 from `TrackedGuid.New()` orders lexicographically by emission time, so "never go back to an older event" is a simple, total ordering rule.

**A write at the stored EventId lands.** When a stream's later event reaches the row first, the runner folds the earlier event onto the row by rewinding the stream, and the corrected row records the stream's frontier, which is the EventId the row already holds. A strictly-greater check refused that correction, so the earlier event was reported applied and never reached the row ([#1608](https://github.com/whizbang-lib/whizbang/issues/1608)). Admitting the stored EventId lets the correction land. A live write the guard does refuse is re-folded from the batch's earliest event rather than reported applied.

**A rebuild's write is not ordered on the EventId.** A rebuild re-derives the row from every event of the stream, folded from an empty model in stream-version order, so its write carries the EventId of the stream's last event by version. When events were appended out of EventId order, that id sorts below the one the stored row records, and the EventId check refused the only write that could repair the row ([#1819](https://github.com/whizbang-lib/whizbang/issues/1819)). A rebuild's write to an opted-in model therefore takes the default CommitSequence guard, which passes because a rebuild records the highest CommitSequence it folded. Live apply and the rewind keep the EventId check, and the row-version check still refuses a stale read in every mode.

A redelivered event (a transport redelivery, a consumer retry) is still applied once: the runner's idempotency filter drops an event the row already carries before it reaches the store. A stale cross-pod read is still refused by the row-version check.

## Behavior summary

| Scenario | Default contract | Opt-in (`IVersionedApplyTarget`) |
|---|---|---|
| Newer event applied later | Wins | Wins |
| Stale event applied later (older EventId) | **Wins (overwrites the row)** | **Skipped** |
| Write at the row's own EventId (a rewind's correction) | Wins | Wins |
| Rebuild write whose last event (by version) has an older EventId | Wins | **Wins** (CommitSequence guard) |
| Same event redelivered | Dropped by the runner's idempotency filter | Dropped by the runner's idempotency filter |
| Null `metadata.CommitSequence` on both sides | Last-writer-wins (current contract) | Falls back to EventId comparison |
| Null `metadata.EventId` on existing row | Initial write proceeds | Initial write proceeds |

## When to opt in

Opt in when **all** of:

- The model is updated from a per-item or other narrow stream where two pods can briefly race on the same row.
- The Apply transitions are state-machine-like — once advanced to a terminal state, regressing is wrong (e.g., a `SagaItemModel` going from `Completed` back to `Running`).
- Stamper-lag forwarding doesn't apply — the model's writes ship with `metadata.CommitSequence = null` and you can't rely on the CommitSequence-based legacy guard.

The first opt-in is `Whizbang.Sagas.Models.SagaItemModel` (2026-06-26 release). Other model authors can add the marker on the same release without further changes.

## When NOT to opt in

Don't opt in for:

- **Replay-driven models that depend on stamper-lag forwarding.** The forwarding contract assumes the storage layer is permissive when CommitSequence is null. Pinning to strict EventId ordering breaks that.
- **Models with concurrent Apply paths that don't share a stream id.** EventId ordering across distinct streams isn't meaningful — newer EventId can be a totally unrelated event.
- **Aggregations / global perspectives.** These typically need event coalescing logic that EventId ordering doesn't express.

If in doubt, leave the marker off. The default contract is the documented, locked-in behavior; the opt-in is the safety upgrade for the narrow class of streams that need it.

## Why opt-in, not default

The opt-in design preserves backward compatibility with three deliberate behaviors:

1. **Stamper-lag forwarding.** Existing consumers depend on the storage layer accepting null-CommitSequence writes so the runner's idempotency logic can decide whether to forward.
2. **Order-independent forward progress.** Two unrelated forward writes (e.g., `Running` first, `Completed` second) must converge to the most-advanced state regardless of arrival order. The default contract preserves this.
3. **Last-writer-wins regression test lock-ins** (`CrossPodStaleReadRegressionRaceTests`). A regression here would silently break consumers; the opt-in surfaces deliberate intent and isolates the change.

## Related

- [Completion Orchestration & Adaptive Watchdog](../sagas/completion-orchestration) — covers the saga-side framework that depends on `SagaItemModel`'s strict ordering for cross-pod strand prevention.
- [PublishOnceAsync](../dispatcher/publish-once) — the dispatcher-level exactly-once primitive sagas use for terminal-event emission.
- `Whizbang.Data.EFCore.Postgres.Tests/CrossPodStaleReadRegressionRaceTests.cs` — the lock-in tests for the **default** non-strict contract this opt-in deliberately bypasses.
