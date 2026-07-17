---
title: Versioned Apply — Strict Cross-Pod Ordering
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
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
---

# Versioned Apply — Strict Cross-Pod Ordering

## When you need it

Two pods are processing the same per-item stream. Each loads the projection row at roughly the same time and both see "no row" (or an earlier state). Each applies its own event and writes back. The writes go through independent transactions. If the staler write commits *last*, the row regresses — Pod A's `Completed` write gets overwritten by Pod B's stale-read `Running` write a few milliseconds later.

This race produced a real production per-item saga strand that survived even the stream-affinity gate: 2 of 350 items stranded at `Running` even though both their `SagaItemStartedEvent` and `SagaItemCompletedEvent` were durably committed to `wh_event_store`. The framework reconciler healed the saga, but the projection itself stayed wrong.

The default storage contract is **deliberately permissive** for this case — see [`CrossPodStaleReadRegressionRaceTests`](https://github.com/whizbang-lib/whizbang/blob/develop/tests/Whizbang.Data.EFCore.Postgres.Tests/CrossPodStaleReadRegressionRaceTests.cs). Whizbang's chosen v0.740 solution was upstream: `PerspectiveWorker`'s `(streamId, perspectiveName)` affinity gate plus `wh_active_streams` cross-pod ownership. Together they pin a stream to one pod at a time. But the gate has narrow windows where the strand can still form (lease handoff during pod restarts, the gap between `wh_active_streams` row expiry and the next pod's claim, etc.).

`IVersionedApplyTarget` is the **opt-in** marker that closes those windows for models that can't tolerate them. It adds a strict-greater UUIDv7 EventId check to the UPSERT `WHERE` clause: a stale write whose `metadata.EventId` is lexicographically older than what's already on the row is silently dropped.

## How it works

```csharp{title="Opt in"}
using Whizbang.Core.Perspectives;

public class SagaItemModel : ISagaItem, IVersionedApplyTarget {
  // ... model fields unchanged
}
```

The Postgres atomic UPSERT path detects the marker at compile-time-pinned runtime check and substitutes the WHERE clause:

```sql{
title: "Default CommitSequence guard vs the IVersionedApplyTarget EventId WHERE clause"
description: "Compares the permissive last-writer-wins CommitSequence UPSERT predicate against the opt-in strict-greater UUIDv7 EventId predicate that drops stale cross-pod writes and makes redelivered events idempotent."
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
   OR EXCLUDED.metadata->>'EventId' > wh_per_X.metadata->>'EventId'
```

UUIDv7 from `TrackedGuid.NewMedo()` orders lexicographically by emission time. "Newer event wins" is the simple, total ordering rule. **Same EventId** (a transport redelivery, a consumer retry) is a strict-greater fail → the redundant UPDATE is skipped → `version` stays at the previous value → the Apply is idempotent.

## Behavior summary

| Scenario | Default contract | Opt-in (`IVersionedApplyTarget`) |
|---|---|---|
| Newer event applied later | Wins | Wins |
| Stale event applied later (older EventId) | **Wins (overwrites the row)** | **Skipped** |
| Same EventId re-applied | Wins (bumps `version`) | Skipped (`version` unchanged) |
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
