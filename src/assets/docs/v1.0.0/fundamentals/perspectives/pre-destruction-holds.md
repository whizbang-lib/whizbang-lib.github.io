---
title: Pre-Destruction Holds
pageType: concept
verifiedAgainstCommit: 6357e43e
verifiedDate: 2026-10-21
version: 1.0.0
category: Perspectives
order: 15
description: >-
  Guard a perspective's rows before row retention destroys them: offer each about-to-die row to a
  registered guard, let it clean up the external resources the row references, and hold the row
  (defer or cancel) until that work is verifiably done.
tags: >-
  perspectives, retention, row-ttl, row-cap, stream-groups, guards, holds, destruction, blob-cleanup,
  maintenance, failure-policy
codeReferences:
  - src/Whizbang.Core/Lifecycle/PerspectiveRowDestruction.cs
  - src/Whizbang.Core/Lifecycle/OnDestroyFailure.cs
  - src/Whizbang.Core/Workers/MaintenanceWorker.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreWorkCoordinator.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperWorkCoordinator.RowRetention.cs
  - src/Whizbang.Data.Postgres/Migrations/111_PerspectiveRowDestructionSeam.sql
  - src/Whizbang.Testing/MaintenanceTestDriver.cs
testReferences:
  - tests/Whizbang.Core.Tests/Workers/MaintenanceWorkerRowGuardTests.cs
  - tests/Whizbang.Core.Tests/Workers/PerspectiveRowSweepTests.cs
  - tests/Whizbang.Core.Tests/Workers/MaintenanceWorkerStreamGroupCascadeTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PerspectiveRowGuardEndToEndTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StreamGroupCascadeSqlTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperRowRetentionTests.cs
---

# Pre-Destruction Holds

[Row retention](row-retention) removes a perspective's rows when they age out, overflow a cap, or follow
a stream group's eviction. That is safe for a row that is only a fold of its events. It is not safe for
a row that points at something outside the database: a blob, a file, an entry in another system. Delete
the row first and the resource it named is orphaned, with nothing left to say it exists.

A **pre-destruction guard** closes that gap. Before the retention sweeps destroy the rows of a guarded
perspective, the maintenance worker offers them to the guard, with their payloads. The guard cleans up
what each row references and answers per row: proceed, defer until later, or keep. A row the guard did
not release is **held**, and every eviction path skips a held row. The row outlives the resource, never
the reverse.

Registering a guard is the opt-in. A perspective no guard names keeps the plain SQL sweeps, with no
extra read and no extra round trip.

## Writing a guard {#guards}

A guard implements `IPerspectiveRowDestructionGuard`: the perspective models it protects, a call before
the sweeps, and an optional call after them.

```csharp{
title: "A guard that deletes a row's blob before the row is evicted"
description: "Reads the blob name from each offered row, deletes the blob, and releases only the rows whose blob is verifiably gone; the rest are deferred and offered again later."
framework: "NET10"
category: "Perspectives"
difficulty: "INTERMEDIATE"
tags: ["row-retention", "guards", "holds", "blob-cleanup"]
tests: ["PerspectiveRowGuardEndToEndTests.GuardedRetention_CleansTheResourceBeforeTheRowDies_EndToEndAsync"]
}
public sealed class DownloadBlobGuard(IBlobStore blobs) : IPerspectiveRowDestructionGuard {
  public IReadOnlyCollection<Type> GuardedModels => [typeof(DownloadModel)];

  public async ValueTask<IReadOnlyDictionary<Guid, PerspectiveRowDecision>> OnBeforeReapAsync(
      IReadOnlyList<PerspectiveRowDestructionTarget> targets, CancellationToken cancellationToken = default) {
    var decisions = new Dictionary<Guid, PerspectiveRowDecision>();
    foreach (var target in targets) {
      var blobName = target.Data.GetProperty("blobName").GetString()!;
      decisions[target.RowId] = await blobs.TryDeleteAsync(blobName, cancellationToken)
        ? PerspectiveRowDecision.Proceed()
        : PerspectiveRowDecision.Defer(DateTimeOffset.UtcNow.AddHours(1));
    }
    return decisions;
  }
}

// One registration; the maintenance worker resolves every registered guard each cycle
services.AddSingleton<IPerspectiveRowDestructionGuard, DownloadBlobGuard>();
```

Each offered row is a `PerspectiveRowDestructionTarget`:

| Member | What it carries |
|---|---|
| `ClrTypeName` | The perspective model's CLR type name, the registry key |
| `TableName` | The perspective's physical table |
| `RowId` | The row id; the stream id for a stream-keyed perspective |
| `Scope` | The row's scope JSON, when it has one |
| `Data` | The row's model payload JSON, where the guard finds what the row references |
| `Reason` | Which path selected it: `ttl` (the expiry ladder), `cap` (per-scope overflow) or `cascade` (a [stream group](row-retention#stream-groups) eviction) |

The offer is batched: one call per guard per maintenance cycle, with up to `RowGuardCollectLimit` rows
(default 500), so a guard can delete in bulk. Rows beyond the limit are offered in later cycles. The
offered set is exactly what the sweeps would destroy: the same predicates select both, so a guard never
sees a row the sweeps would keep, and never misses one they would take.
{verified: MaintenanceWorkerRowGuardTests.WithNoGuardsRegistered_NoRowsAreOfferedAsync, MaintenanceWorkerRowGuardTests.ProceedVerdict_ReleasesTheRowForDeletionAsync, PerspectiveRowSweepTests.Sweeps_RunEvenWithNoGuardRegistered_TheWiringThatWasMissingAsync}

## Decisions and holds {#decisions}

The guard returns a decision per row id. Each decision becomes durable before the sweeps run, in the
`wh_perspective_row_hold` table, keyed by table and row:

| Decision | Effect |
|---|---|
| `PerspectiveRowDecision.Proceed()` | Any earlier hold on the row is released; the sweep destroys it this cycle |
| `PerspectiveRowDecision.Defer(until)` | The row is held until `until`, then offered again |
| `PerspectiveRowDecision.Cancel()` | The row is held indefinitely: an explicit, visible decision to keep it |
| No decision for the row | Deferred for `DestructionRetryBackoffSeconds` (default 300), then offered again |

A row the guard says nothing about is **deferred, never destroyed**. The guard exists to prevent
orphaned resources, so silence fails safe. A canceled row stays in the hold table, where an operator can
see it, until something releases it.
{verified: MaintenanceWorkerRowGuardTests.CancelVerdict_HoldsTheRowIndefinitelyAsync, MaintenanceWorkerRowGuardTests.DeferVerdict_HoldsTheRowUntilTheRequestedTimeAsync, MaintenanceWorkerRowGuardTests.ARowTheGuardSaidNothingAbout_IsDeferredNotDeletedAsync, MaintenanceWorkerRowGuardTests.MixedVerdicts_AreEachRoutedSeparatelyAsync}

Every path that removes perspective rows honors an active hold: the TTL ladder, the cap sweep, the
stream-group cascade, and the presence reconcile a staged rebuild runs. A hold whose row is already
gone is removed by the next sweep of that table.

### After the sweeps {#after-the-sweeps}

`OnAfterReapAsync` runs once the sweeps have run, with the rows this cycle released (the ones the guard
proceeded). It is a notification: it never blocks destruction, and a throwing implementation is logged
and ignored. It has a default empty implementation, so a guard overrides it only when it wants it.
{verified: PerspectiveRowSweepTests.Guard_ProceedReleasesHolds_AndOnAfterReapSeesTheReleasedSetAsync, MaintenanceWorkerRowGuardTests.AfterReapCallbackThrowing_IsLoggedNotPropagatedAsync}

## When a guard fails {#failures}

A guard that throws is not a guard that said proceed. The rows it was offered are held for
`DestructionRetryBackoffSeconds` and their failure count goes up. After `MaxDestructionRetries` failures
(default 5) the `OnDestroyFailure` policy decides:

| `OnDestroyFailure` | Past the retry limit |
|---|---|
| `RetryThenForcedDelete` (default) | The hold is lifted and the sweeps destroy the rows, so a permanently broken guard cannot keep storage forever |
| `RetryThenKeep` | The rows are held indefinitely; never lose the row, at the cost of keeping it |
| `ForceDeleteImmediately` | No retries: the first failure lifts the hold |

The sweeps still run in a cycle where a guard failed; only that guard's rows are held.
{verified: MaintenanceWorkerRowGuardTests.GuardThrowing_RecordsAFailureAndDeletesNothingAsync, PerspectiveRowSweepTests.Guard_Throw_RecordsTheFailureLadder_AndSweepsStillRunAsync}

Cancellation is not a failure. A guard canceled because the host is shutting down stops the cycle
without recording a failure, so restarts during a deploy cannot spend a row's retry budget before any
guard was asked. An `OperationCanceledException` with no shutdown behind it is treated as the failure it
is.
{verified: MaintenanceWorkerRowGuardTests.AGuardCanceledBeforeReap_DoesNotBurnADestructionAttemptAsync, MaintenanceWorkerRowGuardTests.AGuardCanceledDuringShutdown_StopsTheCycleInsteadOfBeingLoggedAsync, MaintenanceWorkerRowGuardTests.AGuardThrowingCancellationWithNoShutdown_IsTreatedAsAFailingObserverAsync}

## Stream-group cascades {#cascades}

A [stream group](row-retention#stream-groups) evicts the rows of sibling perspectives for a stream an
announcing member evicted. Cascaded rows of guarded perspectives go through the same guard as rows the
sweeps selected, with reason `cascade`, before the cascade deletes them. A row the guard deferred
survives the cascade, and the cascade is queued again so the group converges once the hold lapses. One
member's deferral holds only that member's row; the rest of the group proceeds.
{verified: MaintenanceWorkerStreamGroupCascadeTests.GuardedFollower_ProceedVerdict_IsCascadeDeletedAsync, MaintenanceWorkerStreamGroupCascadeTests.GuardedFollower_CancelVerdict_IsHeldNotDeletedAsync, MaintenanceWorkerStreamGroupCascadeTests.GuardedFollower_DeferVerdict_RequeuesTheSeedAsync, MaintenanceWorkerStreamGroupCascadeTests.GuardedFollower_GuardThrowing_RecordsAFailureAndRequeuesAsync}

## Configuration {#configuration}

The guard settings sit on `MaintenanceWorkerOptions`, bound from `Whizbang:Workers:Maintenance`:

| Option | Default | Meaning |
|---|---|---|
| `RowGuardCollectLimit` | 500 | Rows offered to a guard per cycle |
| `DestructionRetryBackoffSeconds` | 300 | How long a failed or undecided row is held before it is offered again |
| `MaxDestructionRetries` | 5 | Failures before the `OnDestroyFailure` policy applies |
| `OnDestroyFailure` | `RetryThenForcedDelete` | What happens to the rows of a guard that keeps failing |

The backoff, retry limit and failure policy are shared with the ephemeral reap's
[destruction hooks](../events/ephemeral-events#destruction-hooks).

## Drivers {#drivers}

The EF Core and Dapper Postgres drivers both implement the guard seam, from the same SQL (migration 111
created the hold table and the collect function). A work coordinator without the seam returns no rows
to offer and records no holds, and its sweeps run as they always do.
{verified: DapperRowRetentionTests.TheMaintenanceCycle_OffersExpiringRowsToTheGuard_AndADeferHoldsThemAsync}

## Testing a guard {#testing}

`Whizbang.Testing.MaintenanceTestDriver.RunOnceAsync(worker)` runs exactly one maintenance cycle, so an
integration test can seed rows past their window, register its guard, run a cycle, and assert which rows
survived and which resources were cleaned, without waiting for the worker's timer.

```csharp{
title: "Driving one maintenance cycle in a test"
description: "Runs a single maintenance cycle against a real database, then checks that the row whose resource could not be cleaned survived."
framework: "NET10"
category: "Perspectives"
difficulty: "ADVANCED"
tags: ["row-retention", "guards", "testing", "maintenance"]
tests: ["PerspectiveRowGuardEndToEndTests.GuardedRetention_CleansTheResourceBeforeTheRowDies_EndToEndAsync"]
}
await Whizbang.Testing.MaintenanceTestDriver.RunOnceAsync(worker, cancellationToken);

// The guard verified blob-a gone, so the sweep took its row in the same cycle;
// blob-b's delete failed, so its row is held and survives
await Assert.That(await RowExistsAsync(cleanable)).IsFalse();
await Assert.That(await RowExistsAsync(outage)).IsTrue();
```

## Related

- [Perspective Row Retention](row-retention): the sweeps a guard stands in front of.
- [Ephemeral events: destruction hooks](../events/ephemeral-events#destruction-hooks): the same contract for event bodies.
- [Lifecycle stages: destruction](../lifecycle/lifecycle-stages#destruction): receptors that run around an event's destruction.
