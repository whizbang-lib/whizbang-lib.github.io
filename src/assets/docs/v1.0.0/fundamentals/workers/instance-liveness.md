---
title: Instance Liveness — Advisory Lock + Heartbeat Fallback
pageType: concept
verifiedAgainstCommit: 924d20f7
verifiedDate: 2026-10-22
version: 1.0.0
category: Fundamentals
order: 8
description: >-
  One liveness rule, defined once in the database and asked by every reader: a
  direct instance holding its alive-lock is live up to a definitive-dead cutoff,
  a direct instance without its lock is live for one beat, and an instance
  behind a transaction pooler is live within the window it declares from its own
  heartbeat cadence. The heartbeat cadence, its watchdog, reversible death
  announcements and eviction are described here too. Alive is a separate test
  from eligible for work: only a live instance whose recorded lifecycle phase is
  ready is given work.
tags: 'liveness, eligibility, heartbeat, advisory-lock, recovery, workers, watchdog, lifecycle-monitor, connection-mode'
codeReferences:
  - src/Whizbang.Data.Postgres/Migrations/316_OneDurableInstanceRecord.sql
  - src/Whizbang.Data.Postgres/Migrations/317_EveryReaderJudgesLivenessByTheRule.sql
  - src/Whizbang.Data.Postgres/Migrations/355_RoleHoldersAreJudgedByTheLivenessRule.sql
  - src/Whizbang.Data.Postgres/Migrations/204_DirectInstancesAreLiveByTheirAliveLock.sql
  - src/Whizbang.Data.Postgres/Migrations/229_OnlyReadyInstancesAreEligibleForWork.sql
  - src/Whizbang.Data.Postgres/Notifications/PostgresNotificationsServiceCollectionExtensions.cs
  - src/Whizbang.Data.Postgres/Migrations/055_InstanceAliveAdvisoryLock.sql
  - src/Whizbang.Data.Postgres/Migrations/011_CleanupStaleInstances.sql
  - src/Whizbang.Data.Postgres/Migrations/147_HeartbeatRegistryBackfill.sql
  - src/Whizbang.Data.Postgres/Migrations/278_OneWriterOfTheInstancePhase.sql
  - src/Whizbang.Data.Postgres/Notifications/PgSharedNotifyConnection.cs
  - src/Whizbang.Data.Postgres/Notifications/PgInstanceLifecycleMonitor.cs
  - src/Whizbang.Core/Workers/IInstanceAliveLockSource.cs
  - src/Whizbang.Core/Workers/HeartbeatWorker.cs
  - src/Whizbang.Core/Workers/HeartbeatLivenessThreshold.cs
  - src/Whizbang.Core/Observability/InstanceLivenessMetrics.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/InstanceLivenessRuleSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/LivenessRuleReadersSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/RoleHolderLivenessSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ListenLivenessSqlTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/CoordinationSourceGuardTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/AliveLockLivenessSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/WorkEligibilitySqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/AliveVersusEligibleE2ETests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/AliveLockSourcePostgresTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupStageWiringTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/AliveLockSourceRegistrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Performance/AliveLockRankCostScenarioTests.cs
  - tests/Whizbang.Core.Tests/Workers/HeartbeatWorkerAdaptiveCadenceTests.cs
  - tests/Whizbang.Core.Tests/Workers/HeartbeatLivenessThresholdTests.cs
  - tests/Whizbang.Core.Tests/Workers/HeartbeatWorkerTickPlanTests.cs
  - tests/Whizbang.Core.Tests/Workers/HeartbeatWorkerRequestFieldsTests.cs
  - tests/Whizbang.Core.Tests/Observability/InstanceLivenessMetricsTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PgInstanceLifecycleMonitorUnitTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PgInstanceLifecycleMonitorIntegrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/RecordHeartbeatBackfillTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/HeartbeatPhaseOrderSqlTests.cs
  - tests/Whizbang.Core.Tests/Startup/StartupStageReporterTests.cs
---

# Instance liveness — advisory lock + heartbeat fallback

Whizbang has two independent signals for "this instance is alive", and **one rule** that combines them. The rule is
defined once, in the database, and every reader asks it: the claim's ranking, the reap, the orphan claims, the
partition assigner, the standby handshake, the fleet readers and the lifecycle monitor. Operators reading this page
need to understand both signals because the slow heartbeat cadence is only safe when the lock signal is healthy.

## Two signals

| Signal | Source | Latency | When used |
|---|---|---|---|
| **Advisory lock** (primary) | Session-level lock claimed by `PgSharedNotifyConnection` on its direct (non-pgbouncer) LISTEN conn at open. Released by PostgreSQL when the session ends: TCP close, pod death, network reset. | Sub-second (TCP keepalive timeout, typically 10 to 30 s) | Direct instances only: reported held only while the LISTEN connection is one of the instance's own. See [the liveness rule](#liveness-rule). |
| **Heartbeat table** (fallback) | `wh_service_instances.last_heartbeat_at` updated by `HeartbeatWorker` on its cadence. Rows the rule calls not live are removed by `cleanup_stale_instances`. | One beat for a direct instance without its lock; the instance's own window otherwise | Always available: the table write is the universal fallback. |

Ask the rule, never the timestamp. `wh_instance_is_live(id)` answers for one instance and `wh_live_instance_ids()`
lists every instance the rule calls live (migration 316):

```sql{
title: "Ask the one liveness rule"
description: "wh_instance_is_live answers for one instance (an instance with no row is not live); wh_live_instance_ids lists every instance the rule calls live, reading the alive-locks once."
category: "Workers"
difficulty: "INTERMEDIATE"
tags: ["liveness", "advisory-lock", "heartbeat", "postgres", "migration-316"]
tests: ["InstanceLivenessRuleSqlTests.Liveness_AFreshHeartbeatWithinTheInstancesOwnWindow_IsLiveAsync", "InstanceLivenessRuleSqlTests.IsLive_AnInstanceWithNoRow_IsNotLiveAsync", "InstanceLivenessRuleSqlTests.Liveness_ADirectInstanceHoldingItsAliveLock_IsLivePastItsWindowAsync"]
}
-- migration 316
SELECT wh_instance_is_live('11111111-...'::uuid);
SELECT instance_id FROM wh_live_instance_ids();
```

`is_instance_alive(instance_id, threshold_seconds)` from migration 055 keeps its signature for the callers of older
releases and delegates to the rule; the threshold it is passed is no longer read.
{verified: InstanceLivenessRuleSqlTests.IsInstanceAlive_DelegatesToTheRule_WhateverThresholdTheCallerPassesAsync}

## The liveness rule {#liveness-rule}
{verified: InstanceLivenessRuleSqlTests.Liveness_ADirectInstanceHoldingItsAliveLock_IsLivePastItsWindowAsync, InstanceLivenessRuleSqlTests.Liveness_ADirectInstanceHoldingItsAliveLock_PastTheDefinitiveCutoff_IsNotLiveAsync, InstanceLivenessRuleSqlTests.Liveness_ADirectInstanceWithoutItsLock_IsLiveForOneBeatAsync, InstanceLivenessRuleSqlTests.Liveness_ADirectInstanceWithoutItsLock_PastOneBeat_IsNotLiveInsideItsWindowAsync, InstanceLivenessRuleSqlTests.Liveness_APooledInstance_IsLiveInsideItsWindowPastOneBeatAsync, InstanceLivenessRuleSqlTests.Liveness_ARowThatRecordsNoWindow_IsJudgedByThirtySecondsAsync}

Each instance records two facts on its `wh_service_instances` row at registration:

- **How it reaches the database**, in `connection_mode` (migration 203, see [Partition assignment](/v1.0.0/fundamentals/work-coordinator/partition-assignment)).
  `direct`: the instance has a dedicated connection of its own, which holds its session alive-lock. `pooled`: it
  reaches the database only through a transaction pooler, so its session cannot be attributed to it and no lock of
  its can be seen.
- **Its liveness window**, in `liveness_window_seconds` (migration 316): how old its heartbeat may get, declared by
  the instance from its own cadence (`HeartbeatLivenessThreshold`, see [below](#the-stale-threshold-is-derived-from-the-cadence)).

The rule, `wh_instance_liveness(row, alive_lock_held)`, judges an instance by them:

| Instance | Live while | With the defaults |
|---|---|---|
| Direct, alive-lock held | Its heartbeat is newer than the **definitive-dead cutoff**: twice its window, at least 5 minutes | 5 minutes (window 150 s) |
| Direct, alive-lock not held | Its heartbeat is newer than **one beat** | 30 s |
| Behind a transaction pooler (`pooled`, or no mode recorded) | Its heartbeat is newer than **its own declared window** | 150 s on the default cadence; 90 s in `HeartbeatTableOnly` mode |
| A row that records no window (an older build) | As above, with a window of 30 s | 30 s |
| No row at all | Never | |

**Why it is shaped this way (owner decision, [#2022](https://github.com/whizbang-lib/whizbang/issues/2022)).** Slack
belongs only where death cannot be detected:

- **A direct instance's death is detectable through its lock.** PostgreSQL releases the lock when the session ends,
  so a hard crash is visible at once and the instance is taken over after one beat, about as fast as before this rule.
  While the lock is held the heartbeat's age does not matter, so the instance can beat on the slow cadence. The lock
  is bounded by the definitive-dead cutoff because a lock can outlive its process on a half-open connection until the
  operating system's keepalive notices.
- **An instance behind a transaction pooler cannot hold the lock,** so its heartbeat is its only signal, and it is
  judged by the window it declares from its own cadence. Before this rule the claim judged it by 30 seconds against a
  30 second cadence, so one late beat read a live instance as dead and its share was handed away while it was still
  working it.
- **A row from an older build records no window** and is judged by 30 seconds, the cutoff the claim always used, so
  a rolling upgrade changes nothing for it.

```sql{
title: "The one liveness rule"
description: "wh_instance_liveness from migration 316: a direct instance is live for one beat, or while it holds its alive-lock inside the definitive-dead cutoff; any other instance is live inside its own declared window (30 seconds when unrecorded)."
category: "Workers"
difficulty: "ADVANCED"
tags: ["liveness", "advisory-lock", "connection-mode", "postgres", "migration-316"]
tests: ["InstanceLivenessRuleSqlTests.Liveness_ADirectInstanceWithoutItsLock_IsLiveForOneBeatAsync", "InstanceLivenessRuleSqlTests.Liveness_ADirectInstanceHoldingItsAliveLock_PastTheDefinitiveCutoff_IsNotLiveAsync", "InstanceLivenessRuleSqlTests.Liveness_APooledInstance_IsLiveInsideItsWindowPastOneBeatAsync", "InstanceLivenessRuleSqlTests.Liveness_ARowThatRecordsNoWindow_IsJudgedByThirtySecondsAsync"]
}
-- migration 316 (simplified)
SELECT CASE
  WHEN p_instance.connection_mode = 'direct' THEN
    p_instance.last_heartbeat_at >= now() - INTERVAL '30 seconds'
    OR (p_instance.last_heartbeat_at >= now() - GREATEST(INTERVAL '5 minutes',
          make_interval(secs => 2 * COALESCE(p_instance.liveness_window_seconds, 30)))
        AND p_alive_lock_held)
  ELSE p_instance.last_heartbeat_at
         >= now() - make_interval(secs => COALESCE(p_instance.liveness_window_seconds, 30))
END
```

The rule is a plain SQL expression the planner inlines into the scan that reads the row. The alive-lock answer is the
caller's argument and is evaluated last, so `pg_locks` is read (through
[`wh_direct_alive_lock_holders`](#wh-direct-alive-lock-holders), as a subplan built once per statement) only for a
direct row past one beat and inside the definitive-dead cutoff. A fleet whose instances all beat on time never reads
`pg_locks`.

The columns and the three functions are in Preflight's [bootstrap region](/v1.0.0/operations/infrastructure/migrations#what-the-closure-carries),
so they exist before the main migration pass on every database: the migrator reads the rule before its pass (to name
other releases still alive), and the [standby handshake](#the-standby-handshake) reads it before this release's pass
has run.

### Design choices {#liveness-rule-design-choices}

| Choice | Reason | Verified |
|---|---|---|
| One rule, `wh_instance_liveness`, defined once in SQL; every reader asks it through `wh_live_instance_ids()` or `wh_instance_is_live(id)`. | Before it, "alive" had about a dozen definitions (the partition assigner's two windows, the standby watcher's option, two fleet readers with 2 minute windows, the claim's 30 s, the reap's caller cutoffs, the orphan claims' named connections, the doorbells' 30 s and 5 minutes), and the lifecycle monitor and the reap could disagree about the same instance at the same moment. | {verified: LivenessRuleReadersSqlTests.CalculateInstanceRank_CountsOnlyInstancesTheRuleCallsLiveAsync, LivenessRuleReadersSqlTests.NotifyOwners_TargetsOnlyInstancesTheRuleCallsLiveAsync, LivenessRuleReadersSqlTests.DeadLetterReady_WakesOnlyInstancesTheRuleCallsLiveAsync, LivenessRuleReadersSqlTests.Candidates_ReportWhetherTheRuleCallsEachLiveAsync} |
| A direct instance holding its alive-lock is live whatever its heartbeat's age, up to twice its window (at least 5 minutes). | The lock is released when the session ends, so it is the fastest death signal there is; the cutoff covers a lock left behind on a half-open connection. | {verified: InstanceLivenessRuleSqlTests.Liveness_ADirectInstanceHoldingItsAliveLock_IsLivePastItsWindowAsync, InstanceLivenessRuleSqlTests.Liveness_ADirectInstanceHoldingItsAliveLock_PastTheDefinitiveCutoff_IsNotLiveAsync, InstanceLivenessRuleSqlTests.Reap_ADirectInstanceHoldingItsLockPastTheDefinitiveCutoff_IsRemovedAsync} |
| A direct instance without its lock is live for one beat (30 s), not for its declared window (owner decision on #2022). | Its death was detectable through the lock, so once the lock is gone a hard crash is taken over about as fast as before; slack is given only where death cannot be detected. | {verified: InstanceLivenessRuleSqlTests.Liveness_ADirectInstanceWithoutItsLock_IsLiveForOneBeatAsync, InstanceLivenessRuleSqlTests.Liveness_ADirectInstanceWithoutItsLock_PastOneBeat_IsNotLiveInsideItsWindowAsync, LivenessRuleReadersSqlTests.Rank_ADirectPeerThatLostItsLock_IsNotCountedPastOneBeatAsync, LivenessRuleReadersSqlTests.Rank_ADirectPeerWithoutItsLock_IsCountedInsideOneBeatAsync} |
| An instance behind a transaction pooler is judged by its own declared window: 90 s in `HeartbeatTableOnly` mode, 150 s on the default cadence. | It cannot hold the lock, so its heartbeat is all there is; judging it by 30 s against a 30 s cadence read one late beat as a death. | {verified: InstanceLivenessRuleSqlTests.Liveness_APooledInstance_IsLiveInsideItsWindowPastOneBeatAsync, InstanceLivenessRuleSqlTests.Liveness_AHeartbeatPastTheInstancesOwnWindow_IsNotLiveAsync, LivenessRuleReadersSqlTests.Rank_APeerInsideItsOwnWindow_IsCountedPastTheOldThirtySecondCutoffAsync, LivenessRuleReadersSqlTests.Caller_LiveByTheRule_IsNotAskedToReRegisterAsync} |
| A lock taken by a pooled instance's session is never consulted. | Through a pooler the session is not the instance's own, so the lock says nothing about it. | {verified: InstanceLivenessRuleSqlTests.Liveness_APooledInstanceHoldingALock_IsJudgedByItsHeartbeatAloneAsync} |
| The window is declared by the instance from its own cadence and recorded on its row; a beat without one keeps what is recorded. | Only the writer knows how often it beats; a window kept by each reader drifted from the cadence it was meant to cover. | {verified: InstanceLivenessRuleSqlTests.Heartbeat_RecordsTheWindowAndTheApplicationVersionAsync, InstanceLivenessRuleSqlTests.Heartbeat_ANullWindowKeepsTheRecordedOneAsync, HeartbeatWorkerRequestFieldsTests.BuildRequest_CarriesThePhaseVersionAndDerivedThresholdAsync} |
| A row that records no window is judged by 30 s. | It comes from an older build during a rolling upgrade; 30 s is what the claim always judged it by. | {verified: InstanceLivenessRuleSqlTests.Liveness_ARowThatRecordsNoWindow_IsJudgedByThirtySecondsAsync} |
| An instance with no row is not live. | A reaped or never-registered instance has nothing to vouch for it. | {verified: InstanceLivenessRuleSqlTests.IsLive_AnInstanceWithNoRow_IsNotLiveAsync} |
| The reap removes exactly the instances the rule calls not live, whatever cutoffs its caller passes, and wakes only the live ones. Each wake is a `WorkOrphanedSignal` published through the [signal bus](/v1.0.0/fundamentals/signal-bus/signal-bus#coordination-signals) (migration 330), heard by the work listener on the bus. | A reap with cutoffs of its own is a second definition of dead; the parameters stay for older callers. The wake is a doorbell with the claim loop's poll behind it, so it is not recorded; routing it through the bus's one publish costs the reap about 38 µs instead of about 7 µs with 50 live instances, on a cold path. | {verified: InstanceLivenessRuleSqlTests.Reap_RemovesExactlyTheInstancesTheRuleSaysAreNotLive_WhateverCutoffTheCallerPassesAsync, InstanceLivenessRuleSqlTests.Reap_WakesOnlyLiveInstancesAsync, CleanupStaleInstancesOrphanNotifySqlTests.CleanupStaleInstances_OneStaleOneLive_EmitsOrphanOnLiveChannelAsync, PostgresSignalTransportUnitTests.TheWorkChannel_DeliversOrphanedWorkAndDeadLetters_AsSignalsAsync, CleanupStaleInstancesDefinitiveDeathSqlTests.CleanupStaleInstances_NoDefinitiveCutoff_TheRulesCutoffStillAppliesAsync} |
| `is_instance_alive` keeps its signature and delegates to the rule; its threshold is not read. | Older builds call it during a rolling upgrade, and they must get the same answer as everyone else. | {verified: InstanceLivenessRuleSqlTests.IsInstanceAlive_DelegatesToTheRule_WhateverThresholdTheCallerPassesAsync} |
| A connection named for an instance in `pg_stat_activity`, or merely having a row, is not a liveness signal. | A name can be set by any session and a row outlives its process; the alive-lock that the instance's LISTEN connection takes is the signal that connection used to stand for. | {verified: ListenLivenessSqlTests.ClaimOrphanedOutbox_StaleHeartbeat_WithOnlyAConnectionNamedForIt_LeasesReclaimableAsync, ListenLivenessSqlTests.ClaimOrphanedOutbox_DirectOwnerHoldingItsAliveLock_LeasesNotReclaimedAsync, ListenLivenessSqlTests.ClaimOrphanedPerspectiveEvents_AStaleOwnerRowTheRuleCallsDead_LeasesReclaimableAsync} |
| C# readers keep no windows; they carry the rule's answer (`IsLive`) read from the database. | A window compared against the host's clock moves with the host's drift and can disagree with the claim and the reap. | {verified: PartitionAssignerTests.IsLive_IsTheRulesAnswer_WhateverTheLockOrTheHeartbeatAsync, StandbyWatcherTests.ARequesterTheRuleCallsLive_BindsUs_AndOneItCallsDead_IsVoidAsync, StandbyHandshakeCoverageTests.AwaitPeersStandingByAsync_AnOlderPeerHoldingItsAliveLock_StillCountsAsync, FleetVersionsTests.AnOlderReleaseLiveOnlyByItsAliveLock_IsReportedAsync} |
| A new liveness check outside the rule fails the build's tests. | Gravity: the next author cannot quietly add another definition of "alive". See [the coordination source guard](../../../contributors/gravity.md#coordination-source-guard). | {verified: CoordinationSourceGuardTests.LivenessChecks_AppearOnlyInTheAllowlistedFilesAsync, CoordinationSourceGuardTests.SqlLivenessChecks_AppearOnlyInTheRuleAndTheAllowlistedFunctionsAsync} |

:::updated{version="1.0.0" type="breaking"}
**Removed** ([#2027](https://github.com/whizbang-lib/whizbang/issues/2027)): every per-reader liveness window.

- `PartitionAssignerOptions.PooledHeartbeatWindow` and `DirectHeartbeatWindow`; the assigner reads
  `PartitionAssignmentCandidate.IsLive`. `PartitionAssigner.IsLive` and `LiveMembers` no longer take options.
- `StandbyWatcherOptions.RequesterLivenessWindow` (configuration key `Whizbang:StandbyWatcher:RequesterLivenessWindow`,
  now reported at startup as [removed](/v1.0.0/operations/configuration/configuration-reference#removed-keys)).
- `FleetInstanceStatus.AliveLockHeld` is now `IsLive`; `StandbyRequest` carries `RequesterIsLive` in place of
  `RequesterLastHeartbeatAt` and `RequesterAliveLockHeld`.
- `FleetVersions.OtherLiveVersionsAsync` no longer takes a window.
- `HeartbeatWorker` requires an `IApplicationVersionProvider`, which the worker pipeline registers; code that
  constructs the worker directly passes one.

Code that judged an instance from `LastHeartbeatAt` reads `IsLive`, or asks `wh_instance_is_live(id)`.
:::

### Where the lock state comes from {#alive-lock-source}
{verified: AliveLockSourceRegistrationTests.AddWhizbangPostgresNotifications_RegistersTheSharedConnectionAsTheAliveLockSourceAsync, AliveLockSourceRegistrationTests.AddWhizbangPostgresNotifications_DisplacesTheNullDefault_InEitherOrderAsync, AliveLockSourceRegistrationTests.AHostsOwnAliveLockSource_IsLeftInPlaceAsync, AliveLockSourceRegistrationTests.WithoutTheNotifications_TheNullDefaultHoldsNoLockAsync, AliveLockSourcePostgresTests.OnADirectConnection_TheLockIsHeld_AndReportedAsync, AliveLockSourcePostgresTests.BehindThePooledFallback_NoLockIsReported_WhateverTheSessionTookAsync}

`AddWhizbangPostgresNotifications` registers `PgSharedNotifyConnection` as the instance's `IInstanceAliveLockSource`. It replaces the core's `NullInstanceAliveLockSource` default whichever of the two is registered first, and a source the host registered itself is left in place.

`PgSharedNotifyConnection.IsAliveLockHeld` is true only when the connection holds the alive-lock **and** is a dedicated connection of its own. Behind the pooled fallback it reports no lock, even if that session took one: its peers could not attribute the lock to the instance, so reporting it would put a pooled instance on the slow cadence and let its peers count it out between beats. A host without the Postgres notifications keeps the null default, holds no lock and beats on the fast cadence.

The connection, and with it the alive-lock claim, starts at the end of the instance's Preflight
[startup stage](../../operations/startup/startup-status#what-runs-in-each-stage), before the election that reads the
lock. On a fresh database the function that claims the lock may not exist yet: the connection asks the catalog first,
logs at Debug that the claim waits, and makes it on a later keepalive once the migration has created the function.
`PgSharedNotifyConnection.OnAliveLockClaimed` is raised each time the claim is made. Until then the heartbeat is the
instance's liveness signal, as for any instance not holding its lock.
{verified: AliveLockSourcePostgresTests.OnADatabaseWithoutTheFunctionYet_TheClaimWaitsQuietly_AndAKeepaliveMakesItOnceItExistsAsync, StartupStageWiringTests.TheNotificationConnection_StartsAtTheEndOfPreflight_OnceAsync}

:::updated
Earlier releases took the alive-lock but never registered the shared connection as the lock source, so every instance beat on the fast cadence and the slow cadence below was dormant. Registering it is what puts direct instances on the slow cadence, and the rule above is what makes that safe: without it, a reader comparing heartbeat age against its own window would take a direct instance for dead between two slow beats.
:::

### The lock check: `wh_direct_alive_lock_holders` {#wh-direct-alive-lock-holders}
{verified: AliveLockLivenessSqlTests.Holders_ADirectInstanceHoldingItsLock_IsListedAsync, AliveLockLivenessSqlTests.Holders_APooledInstanceHoldingALock_IsNotListedAsync, AliveLockLivenessSqlTests.Holders_ADirectInstanceWhoseLockIsReleased_IsNotListedAsync}

Migration 204 adds `wh_direct_alive_lock_holders()`, the one SQL definition of "this direct instance holds its alive-lock". It returns the ids of instances recorded as `direct` whose alive-lock (the migration 055 key) is granted in `pg_locks`. Pooled instances are never listed, whatever locks their sessions hold. The SQL readers below consult the lock through it.

```sql{
title: "List the direct instances whose alive-lock is held"
description: "Calls the migration-204 wh_direct_alive_lock_holders function: one row per instance recorded as direct whose session alive-lock is held right now. Pooled instances never appear."
category: "Workers"
difficulty: "INTERMEDIATE"
tags: ["liveness", "advisory-lock", "connection-mode", "postgres", "migration-204"]
tests: ["AliveLockLivenessSqlTests.Holders_ADirectInstanceHoldingItsLock_IsListedAsync", "AliveLockLivenessSqlTests.Holders_APooledInstanceHoldingALock_IsNotListedAsync", "AliveLockLivenessSqlTests.Holders_ADirectInstanceWhoseLockIsReleased_IsNotListedAsync"]
}
-- migration 204
SELECT instance_id FROM wh_direct_alive_lock_holders();
```

### Who applies the rule {#liveness-readers}
{verified: LivenessRuleReadersSqlTests.Rank_ADirectPeerThatLostItsLock_IsNotCountedPastOneBeatAsync, LivenessRuleReadersSqlTests.Rank_APeerInsideItsOwnWindow_IsCountedPastTheOldThirtySecondCutoffAsync, LivenessRuleReadersSqlTests.Caller_LiveByTheRule_IsNotAskedToReRegisterAsync, LivenessRuleReadersSqlTests.Candidates_ReportWhetherTheRuleCallsEachLiveAsync, LivenessRuleReadersSqlTests.CalculateInstanceRank_CountsOnlyInstancesTheRuleCallsLiveAsync, LivenessRuleReadersSqlTests.NotifyOwners_TargetsOnlyInstancesTheRuleCallsLiveAsync, LivenessRuleReadersSqlTests.DeadLetterReady_WakesOnlyInstancesTheRuleCallsLiveAsync}

Every reader asks the rule; none keeps a window of its own. Migration 317 moved the SQL readers onto it, each copied
from its last definition with only the liveness check replaced, and the C# readers were changed to read its answer.

| Reader | What it checked before | Now |
|---|---|---|
| `claim_work` and `wh_claim_multi_stream_work`, their rank | A heartbeat inside a fixed 30 s, or a held alive-lock | The rule. Since 229 a live peer is ranked only when it is also [eligible for work](#alive-versus-eligible). See [Claim loop](/v1.0.0/fundamentals/work-coordinator/claim-loop#ranking-who-counts-as-alive). |
| `claim_work`, its re-register notice | The caller's heartbeat inside 30 s, or the caller's own lock (`p_alive_lock_held`) | The rule, with the caller's own lock answer. A pooled caller inside its window is not asked to register again. |
| `wh_partition_assignment_candidates` and the partition assigner | The heartbeat's age, judged by the assigner's own two windows | The function returns `is_live`; the assigner reads it. See [Partition assignment](/v1.0.0/fundamentals/work-coordinator/partition-assignment). |
| `claim_orphaned_outbox`, `claim_orphaned_inbox`, a stream's owner | A heartbeat inside the caller's cutoff, or a connection named for the owner in `pg_stat_activity` | The rule. A named connection is no longer a signal; see [LISTEN as heartbeat](/v1.0.0/fundamentals/work-coordinator/notifications-and-pgbouncer#listen-as-heartbeat). |
| `claim_orphaned_perspective_events`, `get_stream_events` | Any row at all, or a named connection | The rule. An owner whose row the reap has not removed yet, but whom the rule calls dead, no longer holds its streams. |
| `calculate_instance_rank`, `notify_instance_owners_with_payload`, `_notify_debounced` | A heartbeat inside a fixed 30 s | The rule. |
| `_notify_dead_letter_ready` | A heartbeat inside 5 minutes | The rule. |
| The stale-peer reap (`cleanup_stale_instances`) and the heartbeat's opportunistic reap | The caller's cutoff and its definitive-dead cutoff, sparing a held lock | Removes exactly what the rule calls not live and wakes exactly what it calls live; the cutoff parameters stay for older callers and are not read. The heartbeat's cheap pre-check asks the rule by heartbeat alone (no lock read) before calling the reap. |
| `is_instance_alive` | A held lock or the caller's threshold | Delegates to the rule; the threshold is not read. |
| The lifecycle monitor | `is_instance_alive` with its own derived threshold | `wh_instance_is_live`; the threshold only paces its scan. |
| The standby handshake and `StandbyWatcher` | The heartbeat against the host's clock and `RequesterLivenessWindow`, or a held lock | `FleetInstanceStatus.IsLive` and `StandbyRequest.RequesterIsLive`, read through `wh_instance_is_live`. See [The standby handshake](#the-standby-handshake). |
| The migrator's other-releases warning (`FleetVersions`) and the managed-schema fleet gate | A heartbeat inside 2 minutes | `wh_live_instance_ids()`. See [Managed schema objects](/v1.0.0/fundamentals/perspectives/managed-schema-objects#rolling-deploys). |
| Role votes, renewals, the role status and the epoch fence (`_role_lapse_reason`, `wh_assert_role_epoch`) | The registration, and the role's own lease: a holder lapsed 15 s after its last renewal whatever the rule said | The rule, through one helper, `_role_holder_kept_live` (migration 355): a holder past its lease keeps its role while the rule calls it live and it renewed inside its progress window. See [Role holders](#role-holders). |
| Bridge expiry | The registration | Unchanged; since migration 326 it ends nothing. |

### Role holders {#role-holders}
{verified: RoleHolderLivenessSqlTests.Vote_AHolderPastItsLease_ThatTheRuleCallsLive_AndThatMadeProgressInsideItsWindow_KeepsTheRoleAsync, RoleHolderLivenessSqlTests.Vote_ADirectHolderHoldingItsAliveLock_DoesNotLapse_WhileItsHeartbeatIsPastOneBeatAsync, RoleHolderLivenessSqlTests.Vote_AHolderTheRuleCallsDead_LapsesAtItsLease_InsideItsWindowAsync, RoleHolderLivenessSqlTests.Vote_AConnectedButStuckHolder_LapsesAtItsProgressWindow_ThoughTheRuleCallsItLiveAsync, CoordinationSourceGuardTests.ARoleHolder_IsJudgedPastItsLeaseByTheOneLivenessRuleAsync, CoordinationSourceGuardTests.SqlLeaseVerdicts_AppearOnlyInTheAllowlistedFunctionsAsync}

A duty's holder ([role assignment](/v1.0.0/operations/startup/capabilities-and-duties#role-assignment-the-default)) is
the last reader that kept a rule of its own, and since [#2140](https://github.com/whizbang-lib/whizbang/issues/2140) it
asks this one. Inside its lease a holder holds. Past its lease it keeps the role only while this rule calls its instance
live **and** it renewed inside the progress window it declared for its epoch (`RoleAssignmentOptions.ProgressWindow`, 2
minutes by default). The vote and the fence both decide through one helper, `_role_holder_kept_live`, so they never
disagree about a holder.

- **Why the rule.** A holder busy with startup, or inside one long unit of work, used to lapse 15 seconds after its last
  renewal while every other reader called it live, and a restart could bounce the role between instances.
- **Why a progress window as well.** This rule answers whether the instance is there, not whether its duty loop is
  moving: the heartbeat comes from `HeartbeatWorker`, so a holder whose duty loop is wedged keeps beating. Progress is
  counted from renewals, which only the duty loop sends, so a holder that is connected but stuck loses the role at the
  end of its window.
- **What it costs.** A crashed holder is replaced when this rule calls it dead, never before its lease: about one beat
  (30 s) for a direct instance, whose alive-lock goes with its process, and at most the progress window for one behind a
  transaction pooler, whose heartbeat window is longer. A holder on an older release declares no window and is judged
  by its lease alone, as before.
- **Gravity.** A lease comparison outside the role's two deciding functions fails
  [the coordination source guard](../../../contributors/gravity.md#coordination-source-guard), so the lease cannot become
  a liveness verdict again.

The full model, the grant watch that tells a holder of its loss within one renew interval, and each trade-off are in
[Duty Role Assignment](../../../proposals/duty-role-assignment#liveness).

### When a direct instance loses its lock {#lock-loss}
{verified: AliveLockLivenessSqlTests.Rank_ADirectPeerWhoseLockIsReleased_IsCountedOutAtOnceAsync, AliveLockLivenessSqlTests.Reap_ADirectPeerHoldingItsLock_IsNeverReapedAsync, AliveLockLivenessSqlTests.Reap_ADirectPeerWhoseLockIsReleased_IsReapedOnTheNextPeerBeatAsync, AliveLockLivenessSqlTests.Vote_ARoleHeldByADirectInstanceHoldingItsLock_IsNotVotedAwayAsync, AliveLockLivenessSqlTests.Vote_ARoleHeldByADirectInstanceWhoseLockIsReleased_IsVotedAwayOnTheNextPeerBeatAsync}

The lock goes with the session: a network reset, a dropped connection or a dead process ends it, and PostgreSQL releases the lock. From then on the instance is live only within one beat (30 s) of its last heartbeat, with no grace period for having been direct:

1. **Ranked out at once.** The next claim of any peer asks the rule. A heartbeat older than one beat (likely, since it was on the slow cadence) counts it out, and the partition shares re-spread on that claim.
2. **Reaped or voted away on the next peer heartbeat.** The next heartbeat of any peer reaps and tombstones every instance the rule calls not live, and the roles it held are voted away.
3. **A live instance recovers on its own.** If the process is still running, `HeartbeatWorker` sees the lock gone on its next tick and returns to the fast cadence. A beat that lands before the reap ranks it back in.

```mermaid{caption="A direct instance on the slow cadence is live by its alive-lock. When the lock is released it is live for one beat only: ranked out by the next claim, then reaped on the next peer heartbeat." tests=["AliveLockLivenessSqlTests.Rank_ADirectPeerOnTheSlowCadenceHoldingItsLock_IsCountedAsync", "AliveLockLivenessSqlTests.Rank_ADirectPeerWhoseLockIsReleased_IsCountedOutAtOnceAsync", "AliveLockLivenessSqlTests.Reap_ADirectPeerWhoseLockIsReleased_IsReapedOnTheNextPeerBeatAsync", "LivenessRuleReadersSqlTests.Rank_ADirectPeerThatLostItsLock_IsNotCountedPastOneBeatAsync"]}
sequenceDiagram
    autonumber
    participant D as Direct instance D
    participant DB as PostgreSQL
    participant P as Peer instance P
    D->>DB: holds alive-lock, beats every 60 s
    P->>DB: claim_work (D's heartbeat is 45 s old)
    DB-->>P: D ranked live: direct, lock held
    Note over D,DB: D's session ends, the lock is released
    P->>DB: claim_work
    DB-->>P: D ranked out: past one beat without its lock
    P->>DB: record_heartbeat
    Note over DB: the rule calls D not live: reaped and tombstoned
```

## Alive versus eligible for work {#alive-versus-eligible}
{verified: WorkEligibilitySqlTests.Eligible_EachRecordedPhase_IsEligibleOnlyWhenReadyAsync, WorkEligibilitySqlTests.Eligible_ARowThatRecordsNoPhase_IsEligibleAsync, AliveVersusEligibleE2ETests.AnInstanceHeldInStartup_IsAliveButNeverACandidateNorRanked_WhileAReadyPeerTakesAllWorkAsync, AliveVersusEligibleE2ETests.AHeldInstance_BecomesEligibleExactlyWhenItRecordsAcceptingCommandsAsync}

Liveness says a process exists. It does not say the process is ready to do anything. An instance registers during the migrator election, before its migration pass, and a direct instance holds its alive-lock from host start, so a starting instance is alive long before it can claim work. A draining instance stays alive until it exits. Since migration 229 the framework asks two separate questions:

| Test | An instance passes when | Who reads it |
|---|---|---|
| **Alive** | It is registered, it is not evicted, and [the liveness rule](#liveness-rule) calls it live. | The stale-peer reap and eviction, role votes, the standby handshake, the notify targets, and the lifecycle monitor. |
| **Eligible for work** | It is alive, **and** its recorded lifecycle phase is `AcceptingCommands` or `Running`, **and** (since migration 231) its recorded [startup stage](/v1.0.0/operations/startup/startup-status#startup-stages), when it records one, is 60 or 70. | The partition assigner's candidates, `claim_work`'s peer ranking and the multi-stream claim's ranking. |

A row that records no phase at all (`lifecycle_phase` is `NULL`) comes from an older build that never writes one. It is eligible whenever it is alive, exactly as before, so a rolling upgrade never strands an older peer's share.

Every other phase is alive but not eligible: `Starting`, `Connecting`, `Migrating`, `Pausing`, `Paused`, `StandingBy`, `Resuming`, `Stopping`, `Stopped`, `Faulted` and `Halted`. Such an instance's share goes to its peers at once, with no wait for a heartbeat to lapse.

The eligibility half lives in one SQL function, `wh_instance_is_eligible_for_work(row)`, which takes the instance's whole registration row. Liveness is not part of it, because every reader already asks [the liveness rule](#liveness-rule) for that. The planner inlines it into the scan that reads the row, so it adds no table, call or lock.

```sql{
title: "List the live instances and whether each is eligible for work"
description: "Calls the migration-229 wh_instance_is_eligible_for_work function over each registered instance's row, beside the phase that instance records and the age of its heartbeat."
category: "Workers"
difficulty: "INTERMEDIATE"
tags: ["liveness", "eligibility", "lifecycle-phase", "postgres", "migration-229"]
tests: ["WorkEligibilitySqlTests.Eligible_EachRecordedPhase_IsEligibleOnlyWhenReadyAsync", "WorkEligibilitySqlTests.Eligible_ARowThatRecordsNoPhase_IsEligibleAsync"]
}
-- migration 229
SELECT si.instance_id,
       si.lifecycle_phase,
       clock_timestamp() - si.last_heartbeat_at AS heartbeat_age,
       wh_instance_is_eligible_for_work(si) AS eligible_for_work
FROM wh_service_instances si
ORDER BY si.instance_id;
```

**Liveness consumers are unchanged.** The reap, eviction, role votes, the standby handshake and the notify targets still read alive. An instance that is alive but not eligible is never reaped or evicted for being unready, including a direct instance whose heartbeat is old but which holds its alive-lock. {verified: AliveVersusEligibleE2ETests.AnAliveButIneligibleInstance_IsNeverReapedNorEvictedAsync}

**Stream ownership is unchanged too.** The orphan claims, and the multi-stream claim's test of whether a live sibling holds a stream's lease, decide which instance owns a stream, not who gets a share, so they read alive. A starting instance owns no streams, because its instance id is new for the process. A draining instance keeps the streams it holds until it finishes them or their leases lapse; see [Draining](/v1.0.0/fundamentals/work-coordinator/partition-assignment#draining).

**Keeping the recorded phase right.** Eligibility is only as good as the phase the row records, so the phase has one
writer: the [stage record](/v1.0.0/operations/startup/startup-status#one-writer-of-the-phase), which writes the stage,
the phase and the library version in one update on every transition (migration 278).

- The bootstrap registration at the end of Preflight records `Connecting` where the row records none (see
  [Capabilities and duties](/v1.0.0/operations/startup/capabilities-and-duties#bootstrap-registration-records-a-phase)).
- A pause or a stand-by is recorded by the stage record as a phase-only write that keeps the stage (see
  [A pause and a stand-by keep the stage](/v1.0.0/operations/startup/startup-status#pause-and-standby)).
- A heartbeat, and the claim loop's registration, record the phase only as a registration: on a row they insert, on a
  row that records none, or for a new process under the same instance id. They never overwrite a recorded phase, and a
  claim no longer compares the row with an announced phase (see [Claim loop](/v1.0.0/fundamentals/work-coordinator/claim-loop#lifecycle-phase)).

**Why one writer.** A heartbeat is built before it is sent, so a beat that wrote the phase could carry one from
before a transition and undo it; a pause or a stand-by, which are off the startup ladder, had no ordering to protect
them. A write the stage record could not make is held and written again on the next accepted heartbeat, so nothing is
left for a beat to repair.
{verified: HeartbeatPhaseOrderSqlTests.ABeatAheadOfTheRow_DoesNotMoveThePhase_TheStageRecordIsItsOnlyWriterAsync, HeartbeatPhaseOrderSqlTests.APhaseOffTheLadder_OnABeat_IsNotWritten_EitherWayAsync, StartupStageReporterTests.AWriteThatFails_IsHeld_AndWrittenOnTheNextRegistrationSignalAsync, WorkEligibilitySqlTests.ARegistration_NoLongerMovesARecordedPhase_TheStageRecordMakesTheRowCurrentAsync}

## The heartbeat starts at registration {#startup-beat}

An instance registers at the end of Preflight, and its heartbeat starts right after, at Elect, not when its schema is
ready. Until the schema-ready gate opens, each beat is a [startup beat](/v1.0.0/operations/startup/startup-status#the-startup-beat)
(`wh_record_startup_heartbeat`, migration 362): it refreshes the heartbeat, the connection mode and the liveness window
of the instance's row and nothing else, and it refuses an evicted instance. The registration itself records the
connection mode and the window, so the rule judges a starting instance by its own window from the moment its row
exists.

**Why.** The heartbeat used to start at schema ready, and the registration recorded no window, so the rule judged a
starting instance by 30 seconds: any live peer's reap evicted an instance still electing or migrating (seen after a 63
second Migrate). A starting instance is now live by beats it really sends, and is still not
[eligible for work](#alive-versus-eligible) until it records Accept commands.
{verified: StartingInstanceHeartbeatE2ETests.AStartingInstanceHeldInMigrate_PastThirtySeconds_IsNotEvictedByALivePeersReapAsync, HeartbeatStartPointTests.TheHeartbeat_StartsAtElect_TheFirstStageAfterRegistrationAsync, SchemaBootstrapPhaseTests.ARegistration_RecordsTheConnectionModeAndTheLivenessWindowAsync, StartingInstanceHeartbeatE2ETests.AStartingInstanceThatBeats_KeepsItsStageAndPhase_AndIsNotEligibleForWork_UntilItRecordsAcceptingCommandsAsync}

## Adaptive HeartbeatWorker cadence

`HeartbeatWorkerOptions.LivenessSourceMode` controls the cadence decision:

| Mode | Behaviour |
|---|---|
| `AdvisoryLockWhenAvailable` (default) | Use `SlowIntervalSeconds` (60 s) when the lock is held; fall back to `IntervalSeconds` (30 s) when not. Only a direct instance ever reports the lock held, so pooled instances always beat on the fast cadence. |
| `HeartbeatTableOnly` | Always use `IntervalSeconds`. Legacy / opt-out for environments that don't trust the adaptive behaviour. |

Per-tick resolution means:

- **Reconnect** (lock acquired) → next tick uses slow cadence.
- **Disconnect** (lock released) → next tick reverts to fast cadence.

The 30 s `cleanup_stale_instances` recovery guarantee is preserved in both cases because:

- **Lock-held path**: TCP keepalive detects pod death within 10–30 s. `cleanup_stale_instances` (updated in slice 7b) also skips rows whose advisory lock is still held, so the slow heartbeat write doesn't trip false cleanups.
- **Lock-not-held path**: HeartbeatWorker reverts to fast cadence automatically; `cleanup_stale_instances` 30 s cutoff catches stale rows on schedule.

:::updated
**Updated**: the 30 s figures above describe the heartbeat *cadence*, not the stale *threshold*. The threshold is no longer a constant. The writer derives it from its cadence (`HeartbeatLivenessThreshold`) and, since migration 316, declares it on its row as the window [the liveness rule](#liveness-rule) judges it by; the lifecycle monitor asks the rule instead of comparing a timestamp, the writer carries a watchdog, a death announcement can be retracted, and the heartbeat backfills the registry row (migration 147). The next five sections describe the current design.
:::

## The stale threshold is derived from the cadence
{verified: HeartbeatLivenessThresholdTests.Defaults_TwoSlowIntervalsPlusOneFastAsync, HeartbeatLivenessThresholdTests.HeartbeatTableOnly_IgnoresTheSlowCadenceAsync, HeartbeatLivenessThresholdTests.SlowIntervalBelowFast_UsesTheFastIntervalAsTheSlowestAsync, HeartbeatLivenessThresholdTests.NonPositiveInterval_IsFlooredAtOneSecondAsync, HeartbeatLivenessThresholdTests.WatchdogLead_IsOneFastIntervalAsync}

The failure this closes: the lifecycle monitor used to scan `wh_service_instances` for `last_heartbeat_at` older than a 30 s constant and ignored the alive-lock entirely. The writer beats every 30 s on its fast cadence and every 60 s on its slow cadence (lock held). That is zero margin at fast cadence and a coin toss on every slow beat: one beat delayed by a stalled commit read as a death, and the instance's leased work was handed away while the instance was still running it.

`HeartbeatLivenessThreshold` is the one derivation of "how stale may the row get before the instance reads as dead". The writer computes it and records it on its row as `liveness_window_seconds` (migration 316); readers never compute it, they ask [the liveness rule](#liveness-rule), which reads the recorded window:

- **`StaleThreshold(options)`** = two of the slowest configured cadence plus one fast interval as a latency allowance. A beat late by a whole fast interval, or one whole slow beat lost, still leaves the row fresh. Non-positive intervals are floored at one second; a slow interval configured below the fast one uses the fast interval as the slowest.
- **`StaleThresholdSeconds(options)`** rounds up to whole seconds for `record_heartbeat(..., p_stale_threshold_seconds)`, which records it as the instance's window. A stood-down instance declares the window of its own beat the same way (three of its beats; see [A stood-down instance stays in Preflight](/v1.0.0/operations/startup/startup-status#stood-down)).
- **`WatchdogLead(options)`** = one fast interval: how far ahead of the threshold the writer forces an out-of-cadence beat.

| `LivenessSourceMode` | Fast interval | Slow interval | Stale threshold | Watchdog lead |
|---|---|---|---|---|
| `AdvisoryLockWhenAvailable` (defaults) | 30 s | 60 s | 150 s | 30 s |
| `HeartbeatTableOnly` (defaults) | 30 s | not used | 90 s | 30 s |

No new options were introduced. The threshold follows `HeartbeatWorkerOptions`, so it can never sit below the cadence again. It is the window of an instance behind a transaction pooler; a direct instance is judged by one beat without its lock and by the definitive-dead cutoff (twice the window, at least 5 minutes) with it.
{verified: HeartbeatWorkerRequestFieldsTests.BuildRequest_CarriesThePhaseVersionAndDerivedThresholdAsync, InstanceLivenessRuleSqlTests.Heartbeat_RecordsTheWindowAndTheApplicationVersionAsync}

## The lifecycle monitor asks the liveness rule {#the-lifecycle-monitor-asks-the-two-signal-predicate}
{verified: PgInstanceLifecycleMonitorIntegrationTests.Tick_StaleHeartbeatButAliveLockHeld_DoesNotAnnounceDeathAsync, PgInstanceLifecycleMonitorUnitTests.StaleThreshold_DefaultHeartbeatOptions_IsOneHundredFiftySecondsAsync, PgInstanceLifecycleMonitorUnitTests.StaleThreshold_FollowsAConfiguredCadenceAsync}

`PgInstanceLifecycleMonitor`, which publishes `InstanceDiedSignal` for orphan takeover, no longer compares a timestamp. Each tick asks [the liveness rule](#liveness-rule), the same rule the claim and the reap ask, so the monitor and the reap can never disagree about who is dead:

```sql{
title: "The lifecycle monitor's liveness scan"
description: "One query per tick: wh_instance_is_live (migration 316) answers with the one liveness rule, and the oldest heartbeat age paces the next tick."
category: "Workers"
difficulty: "ADVANCED"
tags: ["liveness", "lifecycle-monitor", "postgres", "migration-316"]
tests: ["PgInstanceLifecycleMonitorIntegrationTests.Tick_StaleHeartbeatButAliveLockHeld_DoesNotAnnounceDeathAsync", "PgInstanceLifecycleMonitorIntegrationTests.Tick_StaleInstance_PublishesInstanceDiedSignalAsync"]
}
SELECT instance_id,
       EXTRACT(EPOCH FROM (NOW() - last_heartbeat_at))::double precision AS age_seconds,
       wh_instance_is_live(instance_id) AS alive
FROM wh_service_instances;
```

A direct instance whose heartbeat is past its window but whose session alive-lock is still held on a second connection is alive. An instance behind a transaction pooler is alive inside the window it declared; a direct instance without its lock is alive for one beat. The monitor's own threshold (`HeartbeatLivenessThreshold.StaleThreshold`, 150 s with the defaults) no longer decides anything: it only paces the scan.

**The tick is adaptive.** `ComputeTickInterval(oldestAge, threshold)` returns 5 s while any row's age is at or past half the threshold (a death may be imminent, and takeover latency is bounded by the tick), otherwise a sixth of the threshold clamped between 5 s and 30 s (25 s with the defaults). An empty registry ticks at the relaxed cadence. Failover latency is unchanged when it matters and the idle scan rate drops about fivefold. Each tick is recorded on `whizbang.probes.ticks{probe="instance-lifecycle"}`; see [Idle footprint](./idle-footprint.md). {verified: PgInstanceLifecycleMonitorUnitTests.ComputeTickInterval_FleetFresh_RelaxesToASixthOfTheThresholdAsync, PgInstanceLifecycleMonitorUnitTests.ComputeTickInterval_RelaxedInterval_IsBoundedAtThirtySecondsAsync, PgInstanceLifecycleMonitorUnitTests.ComputeTickInterval_RelaxedInterval_NeverFallsBelowTheFastTickAsync, PgInstanceLifecycleMonitorUnitTests.ComputeTickInterval_SomeoneHalfwayToTheThreshold_TicksFastAsync, PgInstanceLifecycleMonitorUnitTests.ComputeTickInterval_NoRegisteredInstances_RelaxesAsync}

## The writer carries a watchdog
{verified: HeartbeatWorkerTickPlanTests.LastAcceptedBeatNearTheThreshold_BeatsAsWatchdogAsync, HeartbeatWorkerTickPlanTests.WatchdogDeadline_TakesPrecedenceOverRegularAsync, HeartbeatWorkerTickPlanTests.RegularBeatUnaccepted_WatchdogFiresOneLeadBeforeTheThresholdAsync, HeartbeatWorkerTickPlanTests.FailedAttempt_RetriesAfterHalfTheLeadAsync, HeartbeatWorkerTickPlanTests.JustAccepted_SlowCadence_WaitNeverExceedsOneFastIntervalAsync, HeartbeatWorkerTickPlanTests.LockToggle_ChangesTheCadenceOnTheNextPlanAsync}

Belt and suspenders on the writer side: a stalled tick must never let the row reach the reader's threshold. `HeartbeatWorker` tracks the last beat the database **accepted** (`LastAcceptedAt`) and decides every wake with `PlanNextTick(now)`, a pure function of the clock, so the whole cadence and watchdog contract is testable with a sequence of timestamps. The rules, in order:

1. A **failed attempt** is not retried tighter than half of the smaller of the watchdog lead and the cadence, so a database that is refusing beats is not hammered in a hot loop.
2. Before any accepted beat, the first beat is **immediate** (`Initial`).
3. A row whose age has reached the threshold minus one lead is beaten immediately as a **`Watchdog`** beat, regardless of cadence.
4. A row older than the cadence is beaten as a **`Regular`** beat.
5. Otherwise the worker waits until the earlier of the cadence boundary and the watchdog deadline, capped at one fast interval, so a change in lock state (fast to slow cadence or back) is re-planned promptly.

```csharp{
title: "PlanNextTick drives the heartbeat loop"
description: "The plan says whether to beat now and why (Initial, Regular, Watchdog) or how long to wait; watchdog beats are counted and logged at Warning because they mean the regular beat ran late."
framework: "NET10"
category: "Workers"
difficulty: "ADVANCED"
tags: ["liveness", "heartbeat", "watchdog", "time-provider"]
tests: ["HeartbeatWorkerTickPlanTests.NoBeatYet_BeatsImmediatelyAsInitialAsync", "HeartbeatWorkerTickPlanTests.CadenceElapsed_BeatsAsRegularAsync", "HeartbeatWorkerTickPlanTests.LastAcceptedBeatNearTheThreshold_BeatsAsWatchdogAsync", "HeartbeatWorkerTickPlanTests.LastAcceptedAt_IsNullUntilABeatIsAcceptedAsync"]
}
public enum HeartbeatBeatReason { Initial, Regular, Watchdog }
public readonly record struct HeartbeatTickPlan(bool BeatNow, TimeSpan Wait, HeartbeatBeatReason Reason);

// Inside the worker loop: no I/O in the decision, so it is provable with timestamps alone.
var plan = worker.PlanNextTick(timeProvider.GetUtcNow());
if (plan.BeatNow) {
  await BeatAsync(plan.Reason, stoppingToken);   // Watchdog: whizbang.liveness.watchdog_beats + EventId 9 Warning
} else {
  await Task.Delay(plan.Wait, timeProvider, stoppingToken);
}
```

Watchdog beats are counted on `whizbang.liveness.watchdog_beats` and logged at Warning (EventId 9). A beat whose round trip took at least one fast interval is counted on `whizbang.liveness.slow_beats` and logged at Warning (EventId 10). Beats still travel over the pinned connection when one exists, and the call-saving slow cadence is kept.

## Death announcements are reversible
{verified: PgInstanceLifecycleMonitorIntegrationTests.Tick_AnnouncedInstanceBeatsAgain_RetractsWithInstanceJoinedAsync, PgInstanceLifecycleMonitorIntegrationTests.Tick_RetractedThenDeadAgain_AnnouncesASecondTimeAsync, PgInstanceLifecycleMonitorIntegrationTests.Tick_SameDeath_PublishesOnlyOnceAsync}

The monitor keeps the deaths it has announced in process so the same `InstanceDiedSignal` is not republished every tick. That set is no longer write-once. When a later tick finds an announced-dead instance alive again (it heartbeats, or its lock is held), the monitor removes it from the set and publishes `InstanceJoinedSignal`, the same signal a freshly started instance raises, so peers that reacted to the death re-read topology and stop treating the instance's leases as orphaned. No new subscriber code is needed. A later real death of the same instance is announced again.

```mermaid{caption="A death that does not hold is retracted: the monitor announces InstanceDied once, and when the instance is alive on a later tick it publishes InstanceJoined and forgets the announcement, so a second real death is announced again." tests=["PgInstanceLifecycleMonitorIntegrationTests.Tick_AnnouncedInstanceBeatsAgain_RetractsWithInstanceJoinedAsync", "PgInstanceLifecycleMonitorIntegrationTests.Tick_RetractedThenDeadAgain_AnnouncesASecondTimeAsync", "PgInstanceLifecycleMonitorIntegrationTests.Tick_SameDeath_PublishesOnlyOnceAsync"]}
sequenceDiagram
    autonumber
    participant M as PgInstanceLifecycleMonitor
    participant DB as wh_instance_is_live(id)
    participant Bus as ISignalBus (broadcast)
    M->>DB: tick
    DB-->>M: instance X: not alive
    M->>Bus: InstanceDiedSignal (deaths_announced + 1)
    M->>DB: tick
    DB-->>M: instance X: still not alive
    Note over M: already announced, nothing published
    M->>DB: tick
    DB-->>M: instance X: alive (late beat landed)
    M->>Bus: InstanceJoinedSignal (deaths_retracted + 1)
    Note over M: Warning: the beat was late, not absent
    M->>DB: tick
    DB-->>M: instance X: not alive
    M->>Bus: InstanceDiedSignal (announced again)
```

The retraction is logged at Warning: *a death that does not hold means the heartbeat was late, not absent; look for what stalled it.* A retraction is a symptom worth chasing (a long commit holding the writer's connection, a saturated pool), but the fleet has already healed itself. If publishing the retraction fails, the instance is put back into the announced set and the retraction is retried on the next tick, mirroring how a failed announcement is retried. {verified: PgInstanceLifecycleMonitorIntegrationTests.Tick_PublishFails_RetriesTheAnnouncementOnTheNextTickAsync}

## Migration 147: the heartbeat backfills the registry
{verified: RecordHeartbeatBackfillTests.FirstBeat_CreatesTheRowWithPhaseAndVersionAsync, RecordHeartbeatBackfillTests.LaterBeat_BackfillsARowThatWasCreatedBlankAsync, RecordHeartbeatBackfillTests.BeatWithNulls_KeepsWhatTheRowAlreadyHoldsAsync, RecordHeartbeatBackfillTests.BeatWithANewPhase_KeepsTheRecordedOneAsync, RecordHeartbeatBackfillTests.ExactlyOneOverloadExistsAsync}

Two gaps closed on the heartbeat write:

1. **Blank registry rows.** `record_instance_state` (migration 109) is UPDATE-only and returns `false` when the row does not exist yet, which is expected during early startup. The row is then created by the first heartbeat, or by `claim_work`'s fallback INSERT, with `lifecycle_phase` and `library_version` NULL. If no later transition happens (the common case: the last transition to `Running` preceded the row), the columns stay blank for the life of the instance and every reader keyed on them treats the instance as unknown. `HeartbeatRequest` now carries `LifecyclePhase`, `LibraryVersion` and `StaleThresholdSeconds`, filled from `IWhizbangLifecycleState` and `ILibraryVersionProvider`, which the heartbeat worker requires, and `record_heartbeat` backfills a blank row with them. Since migration 278 a beat writes the phase and version only as a registration (a row it inserts, a row that records none, a new process under the same instance id) and never over a recorded value; see [What a registration and a heartbeat write](/v1.0.0/operations/startup/startup-status#registration-writes). {verified: HeartbeatWorkerRequestFieldsTests.BuildRequest_CarriesThePhaseVersionAndDerivedThresholdAsync, HeartbeatWorkerRequestFieldsTests.Constructor_WithoutLifecycleOrVersionProviders_ThrowsAsync}
2. **The opportunistic peer reap used the 30 s constant.** `record_heartbeat` reaps silent peers as a side effect of a beat. It compared them against 30 s, equal to the fast cadence, so a peer late by any latency at all could be tombstoned by a healthy neighbor on a host without the alive-lock (pooled connections). The cutoff is now `p_stale_threshold_seconds`, the caller's derived threshold; callers that pass nothing keep the old default. The definitive-dead bypass keeps its 5 minute floor but never falls below twice the stale threshold, so the two cutoffs cannot cross. {verified: RecordHeartbeatBackfillTests.PeerLateByFortySeconds_SurvivesABeatCarryingTheDerivedThresholdAsync, RecordHeartbeatBackfillTests.PeerPastTheDerivedThreshold_IsStillReapedAsync} Since migration 316 the threshold a beat carries is recorded as the instance's own window, and the reap judges every peer by [the liveness rule](#liveness-rule), which reads each peer's recorded window and carries the definitive-dead cutoff itself.

```sql{
title: "record_heartbeat after migration 147"
description: "Three optional parameters appended: the instance's lifecycle phase and library version backfill the registry row (since migration 278, only as a registration, never over a recorded value), and the caller's derived stale threshold replaces the 30 s peer-reap constant. The previous overload is dropped first, so exactly one overload exists."
category: "Workers"
difficulty: "ADVANCED"
tags: ["liveness", "heartbeat", "migration-147", "registry", "postgres"]
tests: ["RecordHeartbeatBackfillTests.LaterBeat_BackfillsARowThatWasCreatedBlankAsync", "RecordHeartbeatBackfillTests.LegacyFiveArgumentCall_StillWorksAsync", "RecordHeartbeatBackfillTests.ExactlyOneOverloadExistsAsync", "RecordHeartbeatBackfillTests.Coordinator_PassesPhaseVersionAndThresholdThroughAsync"]
}
SELECT record_heartbeat(
  p_instance_id             => '11111111-...'::uuid,
  p_service_name            => 'order-service',
  p_host_name               => 'host-a',
  p_process_id              => 4242,
  p_metadata                => '{}'::jsonb,
  p_lifecycle_phase         => 'Running',   -- written only where the row records none (278)
  p_library_version         => '1.0.0',     -- likewise; NULL keeps the recorded value
  p_stale_threshold_seconds => 150);        -- NULL keeps the pre-147 default of 30

-- The legacy five-argument call still works through the defaults.
SELECT record_heartbeat('11111111-...'::uuid, 'order-service', 'host-a', 4242, '{}'::jsonb);
```

Both coordinators (EF Core and Dapper) pass the three new values, with `NULL` for anything the process cannot supply. {verified: RecordHeartbeatBackfillTests.Coordinator_LegacyRequest_StillBeatsAsync}

## Observability
{verified: InstanceLivenessMetricsTests.Counters_ReportWhatWasAddedWhenPolledAsync, InstanceLivenessMetricsTests.Meter_IsNamedForTheLivenessDomainAsync, InstanceLivenessMetricsTests.WithoutAMeterFactory_StillConstructsAsync}

`InstanceLivenessMetrics` (meter `Whizbang.Liveness`) exposes four [passive counters](/v1.0.0/operations/observability/metrics#passive-counters). Every series exists at zero from construction, so a fleet that never had a false death shows `deaths_retracted = 0` rather than a missing instrument.

| Metric | Meaning | What a non-zero value says |
|---|---|---|
| `whizbang.liveness.watchdog_beats` | Beats forced ahead of cadence because the regular beat ran late enough to approach the threshold | The writer is being starved or stalled; the row stayed fresh anyway |
| `whizbang.liveness.slow_beats` | Beats whose round trip took at least one fast interval | The database is slow to accept the heartbeat write |
| `whizbang.liveness.deaths_announced` | `InstanceDiedSignal` publications by the lifecycle monitor | Instances left the fleet (planned or not) |
| `whizbang.liveness.deaths_retracted` | Announced deaths retracted because the instance was alive on a later tick | A beat was late, not absent; find what stalled it |

## Eviction: reaping is a fence, not just a deletion

Reaping alone never stopped anything. `cleanup_stale_instances` deletes the stale row and releases its leases, but `record_heartbeat` was an unguarded upsert — a reaped instance's next heartbeat simply re-inserted the row and it rejoined as though nothing had happened, still believing it owned work the fleet had already redistributed. A pod paused by a long collection, a brief partition, or a throttled node would return and resume against state that had moved on without it.

Migration **106** closes that:

- Every reaped instance is **tombstoned** in `wh_instance_evictions` (instance id, when, why). A tombstone rather than the deletion itself, because deletion is precisely what the returning zombie's heartbeat undoes.
- `record_heartbeat` **consults the tombstone and refuses** — its return type changed `VOID → BOOLEAN`. `true` = registered/renewed; `false` = this instance has been evicted and must not consider itself part of the fleet.
- The refusal travels through the **heartbeat itself** — the same call that used to let the zombie back in is now the one that tells it it may not. No new channel, no dependency on the signal bus, and notice is bounded by one heartbeat interval.
- `HeartbeatWorker` **stops its loop** on a refused heartbeat, and the instance **exits** through the [one exit path](/v1.0.0/operations/startup/instance-exits#evictions) with `ClusterEviction`, exit code 3, so its host restarts it. Retrying can never succeed: the tombstone does not expire on the evicted instance's clock. A refused startup beat or claim registration exits the same way.

The fence is per **process**, not per pod: instance ids are generated per process, so a restarted pod draws a fresh id and is unaffected — correct, because a restart means fresh state. The zombie keeps its id only until its next beat is refused; then it exits and its host starts a new process under a new id. Nothing re-registers in place.
{verified: HeartbeatWorkerStartupBeatTests.OnceTheSchemaIsReady_ARefusedBeat_ExitsOnce_AsAClusterEvictionAsync, StartingInstanceHeartbeatE2ETests.AnInstanceEvictedWhileRunning_ExitsOnce_WithCodeThree_AndRecordsWhoEvictedItAsync, ClaimWorkerLifecyclePhaseTests.ARefusedRegistration_ExitsAsAClusterEvictionAsync}

**Why exit rather than stay sidelined.** An evicted instance that kept running held nothing, served nothing and could
not rejoin under its id, so it sat out of the fleet until someone noticed and restarted it. Exiting with a failure code
hands that to the supervisor that already restarts failed processes.

**The tombstone says what the rule judged.** Since migration 363 the tombstone records the evicting peer for a reap
too (`evicted_by`; before, only the standby handshake's fence recorded it), the instance's last heartbeat as the reap
saw it (`last_heartbeat_at`), and the liveness window it was judged by (`liveness_window_seconds`, `NULL` when its row
recorded none and the rule used 30 seconds). `record_heartbeat` names itself as the reaper for the reap it runs, and
`cleanup_stale_instances` writes that name; a reap by any other caller records no reaper. The exit's entry states all
of it.
{verified: InstanceExitRecordSqlTests.APeersReap_RecordsTheReaper_AndTheHeartbeatAndWindowItJudgedAsync, InstanceExitRecordSqlTests.AReapByAnyOtherCaller_RecordsNoReaperAsync}

Tombstones are bounded: `perform_maintenance` purges rows older than `instance_eviction_retention_hours` (`wh_settings`, default 24; set from `Whizbang__Workers__Maintenance__Retention__InstanceEvictionTombstoneHours`, see [database-side settings](../../operations/configuration/configuration-reference#database-side-settings)). The tombstone only needs to outlive a realistic pause-and-resume window, and since ids are per-process, anything calling with that id after a day is not the process that was reaped.

## Capabilities: won, recorded, and fenced

A **capability** names what an instance may do; an exclusive one (`migrator`, `maintainer`) is a **duty**, held by one instance at a time. Capabilities are *won*, never handed out: an instance votes through `IDutyElector`, and the vote grants or refuses. Every duty is then a [role assignment](/v1.0.0/operations/startup/capabilities-and-duties#role-assignment-the-default), a row with a lease and an epoch; no duty is held by a session advisory lock. A holder that dies stops renewing, and the duty goes to the next vote once this page's rule calls it dead, no earlier than its lease (see [Role holders](#role-holders)). Its writes are fenced by the epoch, so a holder judged dead while still running cannot act beside its successor.

Holdings are **recorded**: *the vote decides, the row reports.* `wh_instance_capabilities` is keyed `(instance, capability)` with `acquired_at`: "which instance is the migrator right now, and for how long" as a query (and in the startup status surface's fleet section, as a join). It rides the same rails as liveness: reaped instances cascade their holdings, so the record's only staleness window is the heartbeat lease the system already bounds.

The eviction fence reaches acquisition: the vote refuses a tombstoned instance, and so does `record_capability`, so a zombie cannot hold a duty. Long-tenure holders fence themselves with `IDutyGrant.VerifyStillHeldAsync`: a grant that lapsed or was taken over reports lost before the next unit of exclusive work, because another instance may already hold it. Each grant also watches its assignment once per renew interval and cancels `IDutyGrant.LostToken` on a loss, so a holder learns of it without waiting for its next verify. During a rolling deploy, a holding that an older release records outside the role table counts only while this rule calls that instance live (see [a rolling deploy from a release that held duties by session lock](/v1.0.0/operations/startup/capabilities-and-duties#legacy-holder)).
{verified: DutyElectionE2ETests.DirtyDeath_JudgedByTheLivenessRule_HandsTheDutyOver_AndTheGrantKnowsItIsLostAsync, RoleAssignmentElectorE2ETests.EvictedInstance_IsRefused_NotContendedAsync, RoleAssignmentResilienceSqlTests.Vote_DoesNotCountAHolderOutsideTheTable_ThatTheLivenessRuleCallsDeadAsync}

## The Standby Handshake {#the-standby-handshake}

A breaking migration is a **planned outage** — the honest description of what a breaking schema change is — and the framework converts an outage that would otherwise be silent and corrupting into one that is bounded, announced and observable.

The migrating instance records **one fleet-wide standby request** (`wh_standby_requests`, single-row by table shape: one handshake at a time, which is what the migrator duty already guarantees). Live older peers' `StandbyWatcher` sees a binding request (from a *newer* version, requester *alive*) and drains: the lifecycle advances to `StandingBy`, pausing every run-control participant and posting `StandingBy` on the instance row for the migrator to observe. The migrator waits for every **live** older peer's recorded acknowledgment: an instance the rule calls dead stops counting, so the wait is bounded by lease expiry, never by the goodwill of a process that may already be dead. Live is [the liveness rule](#liveness-rule), read from the database: the fleet source carries its answer as `FleetInstanceStatus.IsLive` and the standby request as `StandbyRequest.RequesterIsLive`, so a direct peer between two slow beats is still waited for, a requester holding its lock still binds its peers, and neither side compares a heartbeat with the host's clock. {verified: StandbyHandshakeCoverageTests.AwaitPeersStandingByAsync_AnOlderPeerHoldingItsAliveLock_StillCountsAsync, StandbyHandshakeCoverageTests.AwaitPeersStandingByAsync_StaleHeartbeatAndNewerPeer_NeitherCountsAsBlockingAsync, StandbyWatcherTests.ARequesterTheRuleCallsLive_BindsUs_AndOneItCallsDead_IsVoidAsync, AliveLockLivenessSqlTests.FleetSource_ReportsWhetherAPeersAliveLockIsHeldAsync, AliveLockLivenessSqlTests.StandbyRequest_ReportsWhetherTheRequestersAliveLockIsHeldAsync}

The handshake reads the rule through `wh_instance_is_live(id)`. The rule is in Preflight's bootstrap region (migration 316), so it exists before the new release's main pass has run, which is when the handshake reads it.

Every path out of standby is bounded:

- **Committed** — the ledger now records the newer version; standing-by peers re-assess, see `StandDown`, and [exit](/v1.0.0/operations/startup/instance-exits) with `UpgradeStandDown`, exit code 0, as the handshake promises. The orchestrator replaces them.
- **Rolled back** — the requester withdraws; the ledger is exactly as peers last read it. Revival is *not a second pipeline*: peers re-enter the re-entrant runner at `Assess`, find the schema unchanged, and resume.
- **Dead migrator** — its heartbeat lapses, its request is void, revival begins. Nobody is stranded.
- **Unresponsive peer** — eviction is the deliberate instrument (never an automatic consequence of slowness): `evict_instance` writes the tombstone the fence already honours, recording **who** issued it and why, and the handshake completes without the fenced peer — which can no longer heartbeat, win capabilities, or claim work.

The verdict is also **not a startup-only fact**: the watcher re-assesses on a slow cadence, and at once when a newer version comes online or an instance goes away, so an instance that was current when it booted stands down when a newer peer serves or migrates underneath it — alive, not ready, reapable — and resumes if nothing newer is serving any more (see [cluster-wide stand-down](/v1.0.0/operations/startup/rolling-upgrades#cluster-wide-stand-down)).

## Migration touch points

| Migration | What changed |
|---|---|
| **055** (new) | `claim_instance_alive_lock(uuid) → bool` and `is_instance_alive(uuid, threshold) → bool` |
| **011** (modified) | `cleanup_stale_instances` skip-while-locked clause added; a later revision (v0.687) added an optional `p_definitive_dead_cutoff` parameter that bypasses the lock guard when the heartbeat is so old the instance is definitely dead (covers OOMKilled pods whose advisory lock lingers on a half-open TCP session until OS keepalive fires) |
| **106** (new) | `wh_instance_evictions` tombstone table; `cleanup_stale_instances` tombstones what it reaps; `record_heartbeat` returns `BOOLEAN` and refuses evicted instances |
| **107** (modified) | `perform_maintenance` Task 10 purges tombstones past `instance_eviction_retention_hours` (default 24) |
| **147** (new) | `record_heartbeat` gains `p_lifecycle_phase`, `p_library_version` (registry backfill, non-null wins) and `p_stale_threshold_seconds` (the caller's derived threshold for the opportunistic peer reap; definitive-dead cutoff never below twice it). Previous overload dropped; exactly one remains |
| **204** (new) | `wh_direct_alive_lock_holders()`: the direct instances whose alive-lock is held. `claim_work` ranks peers by [the liveness rule](#liveness-rule) and takes `p_alive_lock_held`; `wh_partition_assignment_candidates` reads the lock through the new function |
| **229** (new) | `wh_instance_is_eligible_for_work(row)`: the one definition of [eligible for work](#alive-versus-eligible). `wh_partition_assignment_candidates`, `claim_work`'s ranking and `wh_claim_multi_stream_work`'s ranking count only eligible instances; `claim_work` takes `p_lifecycle_phase` and reports a row recording another phase as stale |
| **316** (new) | [The liveness rule](#liveness-rule): `wh_instance_liveness(row, alive_lock_held)`, `wh_live_instance_ids()` and `wh_instance_is_live(id)`, with the `liveness_window_seconds` and `application_version` columns, all in the bootstrap region. `is_instance_alive` delegates to the rule; `record_heartbeat` records the window and the application version; `cleanup_stale_instances` removes exactly what the rule calls not live |
| **317** (new) | Every SQL reader asks the rule: `claim_work`, `wh_claim_multi_stream_work`, `wh_partition_assignment_candidates` (now returns `is_live`), the three orphan claims, `get_stream_events`, `calculate_instance_rank`, `notify_instance_owners_with_payload`, `_notify_debounced` and `_notify_dead_letter_ready`. See [Who applies the rule](#liveness-readers) |
| **330** (new) | `cleanup_stale_instances` redefined from 316, changing only how it wakes the live instances: each `orphan` wake goes through the signal bus's SQL publish, `wh_publish_signal`, as a best-effort doorbell (never recorded). Channel and payload are unchanged (`wh_work_i_<instance>`, `orphan`). See [Coordination signals](/v1.0.0/fundamentals/signal-bus/signal-bus#coordination-signals) |
| **355** (new) | Role holders ask the rule: `_role_holder_kept_live` (the rule plus the holder's per-epoch progress window), called by the redefined `_role_lapse_reason` and `wh_assert_role_epoch`; `wh_declare_role_progress_window` and `wh_role_is_held`; the `progress_window` and `progress_epoch` columns on `wh_role_assignments`. All in the bootstrap region. See [Role holders](#role-holders) |
| **362** (new) | `wh_record_startup_heartbeat`: [the startup beat](#startup-beat), in the bootstrap region; refreshes the heartbeat, the connection mode and the window of an existing row, inserts nothing, writes no stage or phase, reaps no peer, refuses an evicted instance |
| **363** (new) | `wh_instance_evictions` gains `last_heartbeat_at` and `liveness_window_seconds`; `record_heartbeat` and `cleanup_stale_instances` record the reaper for a reap; `wh_instance_exits` and `wh_record_instance_exit` record every [exit](/v1.0.0/operations/startup/instance-exits#the-exit-record) |

## Operator notes

- The lock acquisition is non-fatal: if it returns `false` (duplicate-startup race) or throws (migration 055 not yet applied), the heartbeat-table fallback continues to work.
- `IsAliveLockHeld` is observable on `IInstanceAliveLockSource` (implemented by `PgSharedNotifyConnection`, registered by `AddWhizbangPostgresNotifications`). The HeartbeatWorker reads it every tick, and `ClaimWorker` passes it to every claim as `ClaimWorkRequest.AliveLockHeld`; no eventing or cache invalidation is needed.
- DI: a host without the Postgres notifications keeps `NullInstanceAliveLockSource`, holds no lock and beats on the fast cadence. A host that registers its own `IInstanceAliveLockSource` keeps it.
- To see which instances the rule calls live, `SELECT * FROM wh_live_instance_ids();`; to see each one's window, `SELECT instance_id, connection_mode, liveness_window_seconds, clock_timestamp() - last_heartbeat_at AS heartbeat_age FROM wh_service_instances;`.
- To see which instances are live by their lock right now, `SELECT * FROM wh_direct_alive_lock_holders();`. A direct instance missing from that list is live for one beat (30 s) past its last heartbeat.
- An instance that is up but receives no work is usually alive and not eligible: check the `lifecycle_phase` its row records (see [Alive versus eligible for work](#alive-versus-eligible)). A row stuck in `Migrating` or `Connecting` means its startup has not reached `AcceptingCommands`; a row in `Stopping` is draining.
- An instance that exits with `ClusterEviction` (exit code 3; `WhizbangInstanceExit` EventId 1) was reaped as stale while paused or starved, and its work was redistributed. Its host restarts it under a new instance id, so it needs no intervention. The exit's entry and its row in `wh_instance_exits` name the evicting peer, the last heartbeat and the window it was judged by; a steady stream of them points at heartbeat starvation or connectivity, which the entry names. Earlier releases logged `has been evicted … heartbeat refused` (`HeartbeatWorker` EventId 8) and left the process running sidelined until restarted by hand.
- A Warning `is alive again after being announced dead; retracting with InstanceJoinedSignal` means a heartbeat landed late, not that the monitor is wrong. The fleet has already healed; look for what stalled the beat (a long-running commit on the writer's connection, a saturated pool). `whizbang.liveness.deaths_retracted` counts these.
- Watchdog Warnings (EventId 9) mean the regular beat ran late enough to approach the threshold and the writer forced one. Occasional watchdog beats under load are the mechanism working; a steady stream points at a starved heartbeat writer.
- Each instance declares its own window from its `HeartbeatWorkerOptions` on every beat, and every reader asks the rule, which reads it. Changing `IntervalSeconds` or `SlowIntervalSeconds` changes the window of the instances that run the change, from their next beat; there is no reader-side threshold to keep in step.

## Verification

```sql{
title: "Inspect held instance alive-locks"
description: "Queries pg_locks for the session-level advisory locks each live instance holds on its direct LISTEN connection, giving one row per active instance."
category: "Workers"
difficulty: "ADVANCED"
tags: ["liveness", "advisory-lock", "pg-locks", "postgres", "verification"]
}
-- Inspect held alive-locks (one row per active instance)
SELECT * FROM pg_locks
WHERE locktype = 'advisory'
  AND classid + objid <> 0;
```

After deploy + restart, the heartbeat UPDATE call count in `pg_stat_statements` should drop ~5×–12× (depending on how long pods stay alive holding the lock). `pg_stat_database.xact_commit` for the same DB should drop proportionally.

## Related

- [Capabilities and Duties](/v1.0.0/operations/startup/capabilities-and-duties): every duty a role assignment; a holder past its lease is judged by this rule, and holdings ride the liveness rails.
- [Rolling Upgrades](/v1.0.0/operations/startup/rolling-upgrades) — the standby handshake and eviction in the deployment story.
- [Pinned connection pool](./pinned-connection-pool.md) — also uses direct conn(s); future work may add a per-pinned-conn lock for redundancy.
- [Worker classification](./worker-classification.md) — HeartbeatWorker is classified `E` (timed) with an adaptive twist.
- [Idle footprint](./idle-footprint.md): the lifecycle monitor's adaptive tick alongside the other probes that relax when idle, and the `Whizbang.Probes` meter.
- [Metrics reference](/v1.0.0/operations/observability/metrics#liveness): the `Whizbang.Liveness` meter.
