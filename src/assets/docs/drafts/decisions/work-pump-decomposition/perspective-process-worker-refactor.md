# PerspectiveProcessWorker — refactor plan

## Status
Designed (2026-04-26). Implementation deferred to a dedicated session.

## Context

`PerspectiveWorker` is the last worker that polls `IWorkCoordinator.ProcessWorkBatchAsync` directly. Phase C migrated outbox/inbox traffic to the new claim/commit/flush channel architecture; perspective traffic still uses the legacy SQL function. This worker must migrate so the legacy `process_work_batch` can be retired.

The worker is 3044 lines with 21 `IWorkCoordinator` references and 12 test classes (108 tests). Refactor is genuinely all-or-nothing — `ProcessWorkBatchAsync` couples claim + complete + lease-renew in one transaction, so partial migration leaves the buffer-and-completion state machine in an undefined state.

## Decision: file-level plan

### What stays bit-for-bit

- **The 7-stage handler chain** (PrePerspectiveDetached → PrePerspectiveInline → handler → ImmediateDetached → PostPerspectiveInline → PostPerspectiveDetached → PostLifecycle*). All inline/detached classifications preserved.
- **Drain-mode subsystem** (6 methods, ~400 lines). Triggered when incoming work has `PerspectiveStreamIds`. Unchanged.
- **Completion strategies** (`BatchedCompletionStrategy`, `InstantCompletionStrategy`). Kept pluggable.
- **Security context propagation** through detached stages.
- **Telemetry, metrics, tracing** — all `PerspectiveMetrics` calls and `Activity` tags unchanged.

### What changes

| Method | Action | Notes |
|---|---|---|
| `ExecuteAsync` | REPLACE | Body switches from `WaitAsync(interval)` poll loop to `await foreach (var work in reader.ReadAllAsync(ct))` |
| `_processWorkBatchAsync` (~365 lines) | REMOVE | Replaced by channel-driven dispatch |
| `_submitCompletionsAndClaimWorkAsync` (~85 lines) | REMOVE | Completions route to `IPerspectiveCompletionChannel`, failures to `IFailureChannel` |
| `_reconcileOrphanedLifecyclesAsync` | KEEP for now | Still calls `IWorkCoordinator` directly; can stay on legacy path for startup-only reconciliation |
| `_scanAndRepairRewindsOnStartupAsync` | KEEP for now | Same — startup path, safe to leave on legacy `IWorkCoordinator` |
| All 7-stage handler methods | KEEP | Dispatch mechanism is transparent to lifecycle stages |
| All drain-mode methods | KEEP | Sub-workflow is per-stream-group, channel-agnostic |

### New dependencies

`PerspectiveProcessWorker` constructor adds:

- `IPerspectiveChannelReader` — fed by `ClaimWorker` (already wired via `WorkerPipelineExtensions`)
- `IPerspectiveCompletionChannel` — fire-and-forget completion writes
- `IFailureChannel` — failure reports per `WorkCategory.Perspective`
- `ILeaseRenewalChannel` — lease extensions during long-running runners

### Two sub-refactors required

1. **Extract `PerspectiveEventCacheManager`** from the inline `ProcessedEventCache` field. Cache eviction is currently triggered "after `ProcessWorkBatchAsync` ack." With channels, ack arrives asynchronously through a different path. Manager owns eviction lifecycle on its own timer + end-of-batch trigger.
2. **Add a completion-ack monitoring path.** Today the buffer is bounded by `ProcessWorkBatchAsync` providing back-pressure. With fire-and-forget completion channels, the buffer can grow if the flush worker lags. Either dual-channel-select in the main loop or a `PerspectiveCompletionFlushHandler` that observes the flush worker's depth.

## Test impact

| Class | Tests | Action |
|---|---|---|
| PerspectiveWorkerCoverageTests | 36 | REWRITE (channel mocks) |
| PerspectiveWorkerDedupTests | 10 | KEEP if cache extracted as helper |
| PerspectiveWorkerDrainModeLifecycleTests | 13 | KEEP |
| PerspectiveWorkerDrainModeTests | 1 | KEEP |
| PerspectiveWorkerEventTypeProviderTests | 2 | KEEP |
| PerspectiveWorkerParallelTests | 3 | KEEP |
| PerspectiveWorkerPostLifecycleTests | 7 | REWRITE |
| PerspectiveWorkerReceptorInvokerTests | 3 | KEEP |
| PerspectiveWorkerRewindTests | 9 | REWRITE |
| PerspectiveWorkerScopeContextTests | 4 | KEEP |
| PerspectiveWorkerSecurityContextTests | 14 | REWRITE if detached-stage propagation needs the fix described in §4D of the scoping report |
| PerspectiveWorkerStrategyTests | 6 | REWRITE |

Net: 47 tests stay, 65 rewrite, ~14 new tests for extracted helpers.

## Acceptance criteria

Bit-for-bit preserved:
- 7-stage handler ordering and inline/detached classification
- Per-stream PostLifecycle ordering (prior cycle awaits before next fires)
- Dedup TTL semantics
- Drain-mode triggering and per-stream cursor prefetch
- Security context capture across detached scopes
- All telemetry / metrics / tracing tags

Allowed to change:
- Polling-loop wait → channel async-foreach
- Direct RPC calls → channel writes
- `MaxStreamsPerBatch` may be deprecated (channel naturally throttles)
- Cache eviction trigger may shift from RPC ack to end-of-batch

## Estimated effort

- Code: ~450 lines removed, ~100 modified, ~200 added → **net ~150 lines reduction**
- Tests: ~65 to rewrite, ~14 new
- Realistically a multi-day focused effort; not safe to half-ship.

## Why this isn't shipped now

The work is concrete and well-scoped — but the implementation cost is bounded only by review/test/regression cycles, not by remaining design uncertainty. Half-shipping a 3000-line worker rewrite invites latent bugs in test paths that only surface under production load. Better to land this as a focused PR after Phase F is exercising the new path on outbox/inbox traffic — then this refactor has the operational confidence baseline to land cleanly.

Until landed, perspective traffic continues through legacy `process_work_batch`. Outbox/inbox traffic uses the new path. That's a valid intermediate state.
