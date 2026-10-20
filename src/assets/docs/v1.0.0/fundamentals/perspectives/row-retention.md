---
title: Perspective Row Retention
pageType: concept
version: 1.0.0
category: Perspectives
order: 14
description: >-
  Let a perspective's rows age out or stay under a per-scope cap while the read model stays a function
  of its events: what [RowTtl] and [RowCap] declare, how the maintenance sweeps and the stream-group
  cascade evict rows, what an eviction removes, and how the next event rebuilds an evicted row.
tags: >-
  perspectives, retention, row-ttl, row-cap, stream-groups, eviction, cursors, snapshots, rebuild,
  resurrection, maintenance, read-models, storage-economy
codeReferences:
  - src/Whizbang.Core/Attributes/RowTtlAttribute.cs
  - src/Whizbang.Core/Attributes/RowCapAttribute.cs
  - src/Whizbang.Core/Attributes/StreamGroupAttribute.cs
  - src/Whizbang.Core/Perspectives/PerspectiveRowEviction.cs
  - src/Whizbang.Core/Perspectives/PerspectiveTtlRegistry.cs
  - src/Whizbang.Core/Perspectives/PerspectiveRowCapRegistry.cs
  - src/Whizbang.Core/Workers/MaintenanceWorker.cs
  - src/Whizbang.Generators/Templates/PerspectiveRunnerTemplate.cs
  - src/Whizbang.Data.Postgres/Migrations/211_EvictionRemovesItsCompanions.sql
  - src/Whizbang.Data.Postgres/PerspectiveRowRetentionSql.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperWorkCoordinator.RowRetention.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EvictionCompanionCleanupSqlTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperEvictionCompanionCleanupTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperRowRetentionTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/EvictedRowRebuildTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/PerspectiveRowEvictionTests.cs
  - tests/Whizbang.Core.Tests/Perspectives/ResurrectionProbeIsPerspectiveAwareTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EnrolledRowReaperSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PerspectiveRowCapSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StreamGroupCascadeSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/RetentionAutoAdoptionTests.cs
---

# Perspective Row Retention

Some read models are worth keeping only while they are in use: conversations, sessions, activity
feeds. Their streams are created constantly and stop mattering after a while, yet their rows would
accumulate forever unless the domain deletes each one. Row retention lets a perspective declare how
long its rows live, or how many it keeps, and lets maintenance remove the rest.

Retention reclaims **storage**. It never changes what the read model is: a row is the fold of its
stream's events, before an eviction and after one. When an evicted row's stream receives another
event, the row is rebuilt from the events, not started over from the one that just arrived.

Event-driven deletion (an `Apply` that returns a delete action on a lifecycle event) is still the
right tool when a deletion is a business fact. Retention is the time-based and size-based backstop
for rows that merely go stale.

## Declaring retention

### `[RowTtl]`: rows that age out

```csharp{title="A row TTL" description="Rows of this perspective expire 60 days after the last event applied to them" framework="NET10" category="Perspectives" difficulty="BEGINNER" tags=["row-retention", "row-ttl", "perspectives"] tests=["EnrolledRowReaperSqlTests.SlidingRule_ReapsIdleRowsWithNoStampedExpiryAsync", "ResurrectionProbeIsPerspectiveAwareTests.ReapedRow_OnStreamWithHandledHistory_StillResurrectsAsync"]}
[RowTtl(Days = 60)]
public class ConversationProjection : IPerspectiveFor<ConversationModel,
    MessageReceived, ReplySent> {
  // Apply methods...
}
```

The window slides: it starts from the **event time** of the last event applied to the row, not from
the moment it was applied. A rebuild therefore reproduces the same expiry the row had before: a row
idle since March rebuilds already expired, is never visible, and is removed on the next maintenance
pass. A rebuild cannot bring expired rows back to life.

Expiry has two phases. Reads filter an expired row out the moment it expires; maintenance deletes it
on its next cycle. The write path still loads an expired row that has not been deleted yet, so a late
event continues from the real state.

`Seconds` outranks `Days` when both are set. An explicit `[RowTtl]` outranks a TTL derived from the
perspective's `[Ephemeral(Storage = TransientStorage.TtlRow)]` events, and runtime configuration
outranks both (see [Configuration](#configuration)).

### `[RowCap]`: a bound on how many rows a scope keeps

```csharp{title="A row cap" description="Keep the 200 most recently active rows per user and evict the rest" framework="NET10" category="Perspectives" difficulty="BEGINNER" tags=["row-retention", "row-cap", "perspectives"] tests=["PerspectiveRowCapSqlTests.Cap_KeepsNewestPerScope_AndEvictsTheRestAsync"]}
[RowCap(PerScope = 200)]
public class RecentActivityProjection : IPerspectiveFor<RecentActivityModel, ActivityRecorded> {
  // Apply methods...
}
```

A TTL bounds how old rows get; a cap bounds how many there are. The cap ranks rows by business time
(`updated_at`), newest first, so "keep the newest N" means the N most recently active, and a rebuild
ranks them the same way. A cap is a complete policy on its own and needs no TTL.

### Stream groups: evicting related rows together {#stream-groups}

A perspective that joins a `[StreamGroup]` has its rows evicted when an announcing member of the
group evicts the row for the same stream, in the same maintenance cycle. A member can declare no
retention of its own and still lose rows this way. See the `StreamGroupAttribute` reference for
`Announce`, `Follow` and `Bridge`.

## How rows are evicted

Each maintenance cycle runs these, all in SQL so the Dapper and EF Core drivers behave the same:

| Path | Function | Removes |
|---|---|---|
| Row TTL and max age | `reap_enrolled_perspective_rows` | Rows past their sliding window or absolute age |
| Stamped expiry | `perform_maintenance` (task 9) | Rows whose own write path stamped an `expires_at` that has passed |
| Row cap | `reap_perspective_row_caps` | Rows ranked beyond the cap in their scope |
| Stream-group cascade | `cascade_delete_perspective_rows` | Rows of group members for the streams the sweeps evicted |

Every path honors pre-destruction holds: a row a registered guard deferred or canceled is skipped and
offered again when the hold lapses. The TTL and cap sweeps are batched, so a large backlog drains
across cycles, and they are gated on adoption so a new declaration reports before it removes (see
[Adoption is automatic](#adoption-is-automatic)). Under `debug_mode` nothing is evicted.

### On the Dapper driver {#dapper-driver}

{verified: DapperRowRetentionTests.TheMaintenanceCycle_AdoptsTheDeclaredWindow_SweepsExpiredRows_AndCascadesToTheGroupAsync, DapperRowRetentionTests.TheMaintenanceCycle_OffersExpiringRowsToTheGuard_AndADeferHoldsThemAsync, DapperRowRetentionTests.TheCapSweep_IsClaimedOncePerWindow_AndEvictsTheOverflowAsync, DapperRowRetentionTests.TheAdoptionGate_CountsTheBacklog_AndAcknowledgingOpensItAsync, DapperRowRetentionTests.ADeclarationWithNoRegistryRow_IsReportedAsync}

The Dapper work coordinator runs the same sweeps, guard seam, stream-group cascade and presence reconcile as the EF Core driver, from the same SQL, in the schema the coordinator is configured for (see [Which schema the Dapper work coordinator uses](../../data/drivers.md#dapper-coordinator-schema)). Before this release every retention member on Dapper fell back to a no-op, so declared retention removed nothing.

Both sweeps act only on acknowledged perspectives, on either driver; with automatic adoption on, each cycle acknowledges eligible perspectives just before the TTL sweep. The cap sweep runs at most once per claim window across the whole service (the `row_cap_sweep_last_run` setting records the claim).

:::warning
Enrollment matches each declaration against `wh_perspective_registry`, and today only the EF Core driver's generated schema extension fills that table. On a Dapper host each declared perspective is therefore reported as matching no registry row and stays un-enrolled, so nothing is evicted yet. Tracked in whizbang-lib/whizbang#1548.
:::

## What an eviction removes {#what-an-eviction-removes}

An eviction of row **R** of model **M** removes, in the same transaction as the row itself:

- **The row.** Its entry in the perspective table, and any hold that no longer has a row to hold.
- **The cursor of every perspective that folds M**, for stream R. Without a cursor, the next event on
  the stream is not treated as the continuation of a row that no longer exists.
- **Every snapshot of R except the latest**, per perspective of M. The latest snapshot is the floor
  the rebuild restores from. "Latest" means the one a rewind would restore: the highest stream
  version, and a snapshot that records no version (written before snapshots carried one) only when
  there is no versioned one.

It leaves alone:

- **Other perspectives' cursors and snapshots on the same stream.** A stream can feed several models;
  evicting one model's row says nothing about the others.
- **The events.** The event log is the authority the row is rebuilt from. Event retention is a
  separate axis (see [ephemeral event retention](../../operations/configuration/configuration-reference.md#ephemeraloptions)).

The SQL learns which perspectives fold a model from the perspective registry: at startup,
`reconcile_perspective_registry` records each model's perspectives (their CLR type names, the form
cursors and snapshots are keyed by) in `wh_perspective_registry.perspective_names` (migration 211). A registry row
written before the names were recorded has none, and an eviction from it removes only the row until
the next startup records them. {verified: EvictionCompanionCleanupSqlTests.TtlReap_RemovesTheEvictedRowsCursors_KeepsItsLatestSnapshot_LeavesTheRestAsync, EvictionCompanionCleanupSqlTests.CapReap_RemovesTheEvictedRowsCursors_KeepsItsLatestSnapshot_LeavesTheRestAsync, EvictionCompanionCleanupSqlTests.Cascade_RemovesTheEvictedRowsCursors_KeepsItsLatestSnapshot_LeavesTheRestAsync, EvictionCompanionCleanupSqlTests.StampedExpiryReap_RemovesTheEvictedRowsCursors_KeepsItsLatestSnapshot_LeavesTheRestAsync, EvictionCompanionCleanupSqlTests.Eviction_KeepsTheSnapshotARewindCanPlace_NotANewerVersionlessOneAsync, EvictionCompanionCleanupSqlTests.Eviction_ModelWithNoKnownPerspectives_RemovesOnlyTheRowAsync, EvictionCompanionCleanupSqlTests.Reconcile_RecordsEveryPerspectiveOfTheModelAsync, DapperEvictionCompanionCleanupTests.Cascade_OnADapperMigratedDatabase_RemovesCursor_KeepsLatestSnapshotAsync}

### The next event rebuilds the row

When an event arrives for a stream whose row is missing, the generated runner asks the event store
whether the stream already holds events of the types this perspective folds. For a perspective whose
rows can be evicted (a TTL, a cap, or a stream-group membership), that question tells a new stream
from an evicted row:

| Situation | What the runner does |
|---|---|
| No earlier event of a folded type | A new stream: the row starts from the incoming event |
| Earlier events, durable history | Restores the latest snapshot, replays the events after it (the incoming one included), and writes the whole row |
| Earlier events, ephemeral history, a snapshot survives | The same: the snapshot is the floor, and the events after it are still readable |
| Earlier events, ephemeral history, no snapshot | Nothing can rebuild the row: it starts from the incoming event, and the runner logs a warning that the row is starting fresh |
| Earlier events, ephemeral history, the surviving snapshot is in an older format | The same as no snapshot: the snapshot cannot be read and the history is reaped, so the row starts from the incoming event, the batch is applied and the cursor advances. The warning names the unreadable snapshot's event id and the event the row restarts from |

The probe runs only for perspectives whose rows can be evicted, so a perspective that declares no
retention and joins no group pays nothing on first contact. It is perspective-aware: a stream shared
by several contracts holds history this perspective never folded, and that history is not a sign of
an evicted row. {verified: EvictedRowRebuildTests.CappedPerspective_EvictedRow_NextEventRebuildsTheWholeRowFromHistoryAsync, EvictedRowRebuildTests.CappedPerspective_EvictedRowWithSnapshot_RestoresTheSnapshotAndReplaysTheTailAsync, EvictedRowRebuildTests.CascadedGroupMember_EvictedRow_NextEventRebuildsTheWholeRowFromHistoryAsync, EvictedRowRebuildTests.EphemeralPerspective_EvictedRowWithSnapshot_RestoresTheSnapshotAndReplaysTheTailAsync, EvictedRowRebuildTests.EphemeralPerspective_EvictedRowWithoutSnapshot_StartsFreshAndWarnsAsync, EvictedRowRebuildTests.EphemeralPerspective_EvictedRowWithStaleSnapshot_StartsFreshFromTheIncomingBatchAndWarnsAsync, EvictedRowRebuildTests.UnretainedPerspective_MissingRow_NeverProbesTheLogAsync, ResurrectionProbeIsPerspectiveAwareTests.FirstContact_OnStreamWithUnhandledHistory_CreatesRow_DoesNotRewindAsync}

## Rebuild, rewind and replay

| Operation | Behavior on a perspective with row retention |
|---|---|
| Live apply | Row upserted; a TTL window slides from the applied event's time |
| Rebuild | Deterministic: active rows rebuild live, rows idle past their TTL rebuild already expired and are removed next cycle |
| Rewind | Deterministic: the same events produce the same expiry |
| Row expired, not yet deleted | Invisible to reads; the write path still sees it; a new event revives it |
| Row evicted | Row, cursor and all but the latest snapshot removed; events kept |
| New event after eviction | Latest snapshot plus the events after it; the row returns whole |

## Configuration {#configuration}

```csharp{title="Perspective row retention options" description="The runtime rung of the retention ladder: the kill switch, the automatic adoption gate, and per-model TTL overrides that win over the attribute without a redeploy." framework="NET10" category="Perspectives" difficulty="INTERMEDIATE" tags=["row-retention", "row-ttl", "perspectives", "configuration", "auto-adoption"] tests=["MaintenanceWorkerRetentionAdoptionTests.AutoAcknowledge_DefaultsToOnAsync", "RetentionAutoAdoptionTests.MaintenanceCycle_WithAutoAcknowledgeOff_KeepsTheGateAsync"]}
services.Configure<PerspectiveRowRetentionOptions>(o => {
  o.Enabled = true;                                          // kill switch for row TTLs
  o.AutoAcknowledge = true;                                  // maintenance opens the adoption gate itself
  o.Overrides["MyApp.Chat.ConversationModel"] = 7_776_000;   // TTL override in seconds
  o.Overrides["MyApp.Feed.RecentActivityModel"] = null;      // null disables the TTL for one model
});
```

- **`Enabled`** turns row TTLs off at one consult point, so stamping, the read filter and the TTL side
  of the rebuild probe stand down together. Caps and stream groups are separate declarations and are
  not affected.
- **`AutoAcknowledge`** (default `true`) lets the maintenance cycle open each perspective's adoption
  gate itself. `false` keeps the manual gate.
- **`Overrides`** maps a model's CLR type name to a TTL in seconds, or to `null` to disable it, without
  a redeploy.
- Keeping the latest snapshot on eviction is unconditional; it is what the rebuild restores from.
- The cadence is `MaintenanceWorkerOptions.IntervalMinutes`; the batch size is
  `MaintenanceWorkerOptions.RowReapBatchSize` (default 5000).

### Adoption is automatic {#adoption-is-automatic}

A newly declared window would otherwise drain a historical backlog on the first deploy. The enrolled
sweeps are therefore gated per perspective on `wh_perspective_registry.retention_enforcement_acknowledged`:
until a perspective is acknowledged, its backlog is reported and nothing is removed.

With `AutoAcknowledge` on, the maintenance worker calls `adopt_enrolled_perspective_retention()`
immediately before the enrolled sweep each cycle. For every enrolled, unacknowledged perspective it
reads the backlog, opens the gate and returns one row; the worker logs one Information line (EventId 55)
and records `whizbang.maintenance.retention_adopted` tagged by `perspective`. Rows are taken
`FOR UPDATE SKIP LOCKED`, so instances adopting in the same window split the work, and a second cycle
reports nothing. The batch size paces the drain. {verified: RetentionAutoAdoptionTests.MaintenanceCycle_DrainsADeclaredWindowWithoutAnAcknowledgeCallAsync, RetentionAutoAdoptionTests.Adopt_SecondCycle_ReportsNothingAsync, MaintenanceWorkerRetentionAdoptionTests.Adoption_RunsImmediatelyBeforeTheEnrolledReap_AndLogsEachPerspectiveAsync}

With `AutoAcknowledge` off, the operator opens the gate with
`IWorkCoordinator.AcknowledgeRetentionEnforcementAsync`.

## Observability

On the `Whizbang.Maintenance` meter:

- `whizbang.maintenance.rows_affected` (counter, tagged by `task`): rows a maintenance task removed.
- `whizbang.maintenance.task_duration` (histogram, ms, tagged by `task`): each task's wall time per cycle.
- `whizbang.maintenance.retention_adopted` (counter, tagged by `perspective`): the backlog at the moment
  a perspective's retention was adopted.

A rebuild after eviction logs at Information ("is missing but the stream has history: resurrecting via re-fold") and runs as a
rewind, so it appears in the rewind span family and the rewind system events. A row that starts fresh
because its ephemeral history is gone logs a Warning.

## AOT

Everything is source-generated or plain code. The attributes are read by the perspective-runner
generator at compile time and registered through `[ModuleInitializer]` into type-keyed registries; the
perspective names reach the registry through the payload the EF Core generator emits; configuration
binds through standard options. Nothing inspects attributes or scans types at runtime.

## Related

- [Perspective Snapshots](snapshots): the floor an evicted row is rebuilt from.
- [Perspective Rewind](rewind): the machinery the rebuild runs on.
- [Perspective Registry](registry): where the model, its table and its perspectives are recorded.
- [ephemeral event retention](../../operations/configuration/configuration-reference.md#ephemeraloptions): retention for the event log, the other axis.
