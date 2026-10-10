---
title: Instance Liveness — Advisory Lock + Heartbeat Fallback
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Fundamentals
order: 8
description: >-
  Dual-signal liveness scheme: a session-level advisory lock on the direct
  LISTEN connection (primary) plus the heartbeat-table fallback. One rule for
  every reader: alive by a heartbeat within the reader's window, or, for a
  direct instance, by its held alive-lock. The stale threshold is derived from
  the heartbeat cadence and shared by the writer, the lifecycle monitor and
  the SQL reap; the writer carries a watchdog and death announcements are
  reversible.
tags: 'liveness, heartbeat, advisory-lock, recovery, workers, watchdog, lifecycle-monitor, connection-mode'
codeReferences:
  - src/Whizbang.Data.Postgres/Migrations/204_DirectInstancesAreLiveByTheirAliveLock.sql
  - src/Whizbang.Data.Postgres/Notifications/PostgresNotificationsServiceCollectionExtensions.cs
  - src/Whizbang.Data.Postgres/Migrations/055_InstanceAliveAdvisoryLock.sql
  - src/Whizbang.Data.Postgres/Migrations/011_CleanupStaleInstances.sql
  - src/Whizbang.Data.Postgres/Migrations/147_HeartbeatRegistryBackfill.sql
  - src/Whizbang.Data.Postgres/Notifications/PgSharedNotifyConnection.cs
  - src/Whizbang.Data.Postgres/Notifications/PgInstanceLifecycleMonitor.cs
  - src/Whizbang.Core/Workers/IInstanceAliveLockSource.cs
  - src/Whizbang.Core/Workers/HeartbeatWorker.cs
  - src/Whizbang.Core/Workers/HeartbeatLivenessThreshold.cs
  - src/Whizbang.Core/Observability/InstanceLivenessMetrics.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/AliveLockLivenessSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/AliveLockSourcePostgresTests.cs
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
---

# Instance liveness — advisory lock + heartbeat fallback

Whizbang has two independent signals for "this instance is alive," wired in slice 7b. Operators reading this page need to understand both signals because the slow heartbeat cadence is only safe when the lock signal is healthy.

## Two signals

| Signal | Source | Latency | When used |
|---|---|---|---|
| **Advisory lock** (primary) | Session-level lock claimed by `PgSharedNotifyConnection` on its direct (non-pgbouncer) LISTEN conn at open. Released by PostgreSQL when the session ends — TCP close, pod death, network reset. | Sub-second (TCP keepalive timeout, typically 10–30 s) | Direct instances only: reported held only while the LISTEN connection is one of the instance's own. See [the liveness rule](#liveness-rule). |
| **Heartbeat table** (fallback) | `wh_service_instances.last_heartbeat_at` updated by `HeartbeatWorker` on its cadence. Stale rows removed by `cleanup_stale_instances` after `p_stale_cutoff`. | ~30–60 s (heartbeat cadence 30 s + stale cutoff) | Always available — the table write is the universal fallback. |

The new SQL function `is_instance_alive(instance_id, threshold_seconds)` returns TRUE if EITHER signal indicates alive:

```sql{
title: "Check whether an instance is alive"
description: "Calls the migration-055 is_instance_alive function, which returns TRUE if either the advisory lock or a fresh heartbeat row indicates the instance is still live."
category: "Workers"
difficulty: "INTERMEDIATE"
tags: ["liveness", "advisory-lock", "heartbeat", "postgres", "migration-055"]
}
-- migration 055
SELECT is_instance_alive('11111111-...'::uuid, 30);
```

## One liveness rule, by connection mode {#liveness-rule}
{verified: AliveLockLivenessSqlTests.Rank_ADirectPeerOnTheSlowCadenceHoldingItsLock_IsCountedAsync, AliveLockLivenessSqlTests.Rank_ADirectPeerWhoseLockIsReleased_IsCountedOutAtOnceAsync, AliveLockLivenessSqlTests.Rank_APooledPeerPastTheCutoff_IsCountedOutWhateverLockItsSessionHoldsAsync, AliveLockLivenessSqlTests.Rank_APooledPeerWithAFreshHeartbeat_IsCountedAsync, AliveLockLivenessSqlTests.Rank_ARowWithNoRecordedMode_IsJudgedAsPooledAsync}

Each instance records at registration how it reaches the database, in `wh_service_instances.connection_mode` (migration 203, see [Partition assignment](/v1.0.0/fundamentals/work-coordinator/partition-assignment)):

- `direct`: the instance has a dedicated connection of its own, which holds its session alive-lock.
- `pooled`: the instance reaches the database only through pooled connections. Its session cannot be attributed to it through a pooler, so no lock of its can be seen.

Every reader that judges a peer by its heartbeat applies the same rule:

> An instance is **alive** if its heartbeat is within the reader's own window, **or** it is direct and holds its alive-lock.

| Instance | What decides | Heartbeat cadence |
|---|---|---|
| Direct, alive-lock held | The lock. The instance is alive whatever the age of its heartbeat. | Slow (`SlowIntervalSeconds`, 60 s) |
| Direct, alive-lock not held | The heartbeat, at once, exactly as for a pooled instance. | Fast (`IntervalSeconds`, 30 s) |
| Pooled, or no mode recorded | The heartbeat alone. Its lock is never consulted. | Fast (`IntervalSeconds`, 30 s) |

Pooled instances are judged exactly as before this rule existed.

### Where the lock state comes from {#alive-lock-source}
{verified: AliveLockSourceRegistrationTests.AddWhizbangPostgresNotifications_RegistersTheSharedConnectionAsTheAliveLockSourceAsync, AliveLockSourceRegistrationTests.AddWhizbangPostgresNotifications_DisplacesTheNullDefault_InEitherOrderAsync, AliveLockSourceRegistrationTests.AHostsOwnAliveLockSource_IsLeftInPlaceAsync, AliveLockSourceRegistrationTests.WithoutTheNotifications_TheNullDefaultHoldsNoLockAsync, AliveLockSourcePostgresTests.OnADirectConnection_TheLockIsHeld_AndReportedAsync, AliveLockSourcePostgresTests.BehindThePooledFallback_NoLockIsReported_WhateverTheSessionTookAsync}

`AddWhizbangPostgresNotifications` registers `PgSharedNotifyConnection` as the instance's `IInstanceAliveLockSource`. It replaces the core's `NullInstanceAliveLockSource` default whichever of the two is registered first, and a source the host registered itself is left in place.

`PgSharedNotifyConnection.IsAliveLockHeld` is true only when the connection holds the alive-lock **and** is a dedicated connection of its own. Behind the pooled fallback it reports no lock, even if that session took one: its peers could not attribute the lock to the instance, so reporting it would put a pooled instance on the slow cadence and let its peers count it out between beats. A host without the Postgres notifications keeps the null default, holds no lock and beats on the fast cadence.

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

| Reader | How it applies the rule |
|---|---|
| `claim_work`, its rank | A peer is ranked live with a heartbeat inside the 30 s cutoff, or as a direct instance holding its alive-lock. The lock is read only for a direct row past the cutoff, once per claim. See [Claim loop](/v1.0.0/fundamentals/work-coordinator/claim-loop#ranking-who-counts-as-alive). |
| `claim_work`, its re-register notice | The caller passes `p_alive_lock_held`. A direct caller holding its lock is not asked to re-register between its slow beats. |
| The partition assigner's candidates | `wh_partition_assignment_candidates` reports `alive_lock_held` through `wh_direct_alive_lock_holders`, and the assigner applies its per-mode windows. See [Partition assignment](/v1.0.0/fundamentals/work-coordinator/partition-assignment). |
| The standby handshake and `StandbyWatcher` | A peer or requester holding its alive-lock counts as live whatever its heartbeat's age. See [The standby handshake](#the-standby-handshake). |
| The stale-peer reap (`cleanup_stale_instances`) | Unchanged: it already spared any row whose alive-lock is held (055, v0.687). |
| `is_instance_alive` and the lifecycle monitor | Unchanged: the predicate already answers with either signal. |
| `claim_orphaned_*`, a stream's owner | Unchanged: an owner is live with a fresh heartbeat or with its direct connection's application name in `pg_stat_activity`, the same session that holds the lock. |
| Role votes and bridge expiry | Unchanged: they read the registration, which only the reap removes. |

### When a direct instance loses its lock {#lock-loss}
{verified: AliveLockLivenessSqlTests.Rank_ADirectPeerWhoseLockIsReleased_IsCountedOutAtOnceAsync, AliveLockLivenessSqlTests.Reap_ADirectPeerHoldingItsLock_IsNeverReapedAsync, AliveLockLivenessSqlTests.Reap_ADirectPeerWhoseLockIsReleased_IsReapedOnTheNextPeerBeatAsync, AliveLockLivenessSqlTests.Vote_ARoleHeldByADirectInstanceHoldingItsLock_IsNotVotedAwayAsync, AliveLockLivenessSqlTests.Vote_ARoleHeldByADirectInstanceWhoseLockIsReleased_IsVotedAwayOnTheNextPeerBeatAsync}

The lock goes with the session: a network reset, a dropped connection or a dead process ends it, and PostgreSQL releases the lock. From then on the instance is judged by its heartbeat at once, with no grace period for having been direct:

1. **Ranked out at once.** The next claim of any peer ranks it by its heartbeat. A heartbeat older than the 30 s cutoff (likely, since it was on the slow cadence) counts it out, and the partition shares re-spread on that claim.
2. **Reaped or voted away on the next peer heartbeat.** Once its heartbeat is past the reap threshold, the next heartbeat of any peer reaps and tombstones it, and the roles it held are voted away.
3. **A live instance recovers on its own.** If the process is still running, `HeartbeatWorker` sees the lock gone on its next tick and returns to the fast cadence. A beat that lands before the reap ranks it back in.

```mermaid{caption="A direct instance on the slow cadence is live by its alive-lock. When the lock is released it is judged by its heartbeat at once: ranked out by the next claim, then reaped on the next peer heartbeat." tests=["AliveLockLivenessSqlTests.Rank_ADirectPeerOnTheSlowCadenceHoldingItsLock_IsCountedAsync", "AliveLockLivenessSqlTests.Rank_ADirectPeerWhoseLockIsReleased_IsCountedOutAtOnceAsync", "AliveLockLivenessSqlTests.Reap_ADirectPeerWhoseLockIsReleased_IsReapedOnTheNextPeerBeatAsync"]}
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
    DB-->>P: D ranked out: heartbeat past the 30 s cutoff
    P->>DB: record_heartbeat
    Note over DB: D past the reap threshold: reaped and tombstoned
```

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
**Updated**: the 30 s figures above describe the heartbeat *cadence*, not the stale *threshold*. The threshold is no longer a constant. Reader and writer both derive it from the cadence (`HeartbeatLivenessThreshold`), the lifecycle monitor asks the two-signal predicate instead of comparing a timestamp, the writer carries a watchdog, a death announcement can be retracted, and the heartbeat backfills the registry row (migration 147). The next five sections describe the current design.
:::

## The stale threshold is derived from the cadence
{verified: HeartbeatLivenessThresholdTests.Defaults_TwoSlowIntervalsPlusOneFastAsync, HeartbeatLivenessThresholdTests.HeartbeatTableOnly_IgnoresTheSlowCadenceAsync, HeartbeatLivenessThresholdTests.SlowIntervalBelowFast_UsesTheFastIntervalAsTheSlowestAsync, HeartbeatLivenessThresholdTests.NonPositiveInterval_IsFlooredAtOneSecondAsync, HeartbeatLivenessThresholdTests.WatchdogLead_IsOneFastIntervalAsync}

The failure this closes: the lifecycle monitor used to scan `wh_service_instances` for `last_heartbeat_at` older than a 30 s constant and ignored the alive-lock entirely. The writer beats every 30 s on its fast cadence and every 60 s on its slow cadence (lock held). That is zero margin at fast cadence and a coin toss on every slow beat: one beat delayed by a stalled commit read as a death, and the instance's leased work was handed away while the instance was still running it.

`HeartbeatLivenessThreshold` is the one derivation of "how stale may the row get before the instance reads as dead", and every reader and the writer use it:

- **`StaleThreshold(options)`** = two of the slowest configured cadence plus one fast interval as a latency allowance. A beat late by a whole fast interval, or one whole slow beat lost, still leaves the row fresh. Non-positive intervals are floored at one second; a slow interval configured below the fast one uses the fast interval as the slowest.
- **`StaleThresholdSeconds(options)`** rounds up to whole seconds for `is_instance_alive(instance_id, threshold_seconds)` and `record_heartbeat(..., p_stale_threshold_seconds)`.
- **`WatchdogLead(options)`** = one fast interval: how far ahead of the threshold the writer forces an out-of-cadence beat.

| `LivenessSourceMode` | Fast interval | Slow interval | Stale threshold | Watchdog lead |
|---|---|---|---|---|
| `AdvisoryLockWhenAvailable` (defaults) | 30 s | 60 s | 150 s | 30 s |
| `HeartbeatTableOnly` (defaults) | 30 s | not used | 90 s | 30 s |

No new options were introduced. The threshold follows `HeartbeatWorkerOptions`, so it can never sit below the cadence again.

## The lifecycle monitor asks the two-signal predicate
{verified: PgInstanceLifecycleMonitorIntegrationTests.Tick_StaleHeartbeatButAliveLockHeld_DoesNotAnnounceDeathAsync, PgInstanceLifecycleMonitorIntegrationTests.Tick_HeartbeatFortySecondsOldWithoutLock_IsNotDeadUnderTheDerivedThresholdAsync, PgInstanceLifecycleMonitorUnitTests.StaleThreshold_DefaultHeartbeatOptions_IsOneHundredFiftySecondsAsync, PgInstanceLifecycleMonitorUnitTests.StaleThreshold_FollowsAConfiguredCadenceAsync}

`PgInstanceLifecycleMonitor`, which publishes `InstanceDiedSignal` for orphan takeover, no longer compares a timestamp. Each tick asks the same predicate the SQL reap uses:

```sql{
title: "The lifecycle monitor's liveness scan"
description: "One query per tick: is_instance_alive (migration 055) answers with the alive-lock OR the derived heartbeat threshold, and the oldest age drives the next tick interval."
category: "Workers"
difficulty: "ADVANCED"
tags: ["liveness", "lifecycle-monitor", "is-instance-alive", "postgres"]
tests: ["PgInstanceLifecycleMonitorIntegrationTests.Tick_StaleHeartbeatButAliveLockHeld_DoesNotAnnounceDeathAsync", "PgInstanceLifecycleMonitorIntegrationTests.Tick_HeartbeatFortySecondsOldWithoutLock_IsNotDeadUnderTheDerivedThresholdAsync"]
}
SELECT instance_id,
       EXTRACT(EPOCH FROM (NOW() - last_heartbeat_at))::double precision AS age_seconds,
       is_instance_alive(instance_id, @threshold_seconds) AS alive
FROM wh_service_instances;
-- @threshold_seconds = HeartbeatLivenessThreshold.StaleThresholdSeconds(options), 150 with the defaults
```

An instance whose row is stale but whose session alive-lock is still held on a second connection is alive. A row 40 s old without the lock is alive under the derived threshold, where it used to be announced dead.

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
    participant DB as is_instance_alive(id, threshold)
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
{verified: RecordHeartbeatBackfillTests.FirstBeat_CreatesTheRowWithPhaseAndVersionAsync, RecordHeartbeatBackfillTests.LaterBeat_BackfillsARowThatWasCreatedBlankAsync, RecordHeartbeatBackfillTests.BeatWithNulls_KeepsWhatTheRowAlreadyHoldsAsync, RecordHeartbeatBackfillTests.BeatWithANewPhase_OverwritesTheOldOneAsync, RecordHeartbeatBackfillTests.ExactlyOneOverloadExistsAsync}

Two gaps closed on the heartbeat write:

1. **Blank registry rows.** `record_instance_state` (migration 109) is UPDATE-only and returns `false` when the row does not exist yet, which is expected during early startup. The row is then created by the first heartbeat, or by `claim_work`'s fallback INSERT, with `lifecycle_phase` and `library_version` NULL. If no later transition happens (the common case: the last transition to `Running` preceded the row), the columns stay blank for the life of the instance and every reader keyed on them treats the instance as unknown. `HeartbeatRequest` now carries `LifecyclePhase`, `LibraryVersion` and `StaleThresholdSeconds`, filled from `IWhizbangLifecycleState` and `ILibraryVersionProvider` when they are registered, and `record_heartbeat` backfills with `COALESCE(EXCLUDED.x, existing.x)`: a non-null value is the live truth from the process and wins; a null leaves what `record_instance_state` wrote. {verified: HeartbeatWorkerRequestFieldsTests.BuildRequest_CarriesThePhaseVersionAndDerivedThresholdAsync, HeartbeatWorkerRequestFieldsTests.BuildRequest_WithoutLifecycleOrVersionProviders_LeavesThemNullAsync}
2. **The opportunistic peer reap used the 30 s constant.** `record_heartbeat` reaps silent peers as a side effect of a beat. It compared them against 30 s, equal to the fast cadence, so a peer late by any latency at all could be tombstoned by a healthy neighbor on a host without the alive-lock (pooled connections). The cutoff is now `p_stale_threshold_seconds`, the caller's derived threshold; callers that pass nothing keep the old default. The definitive-dead bypass keeps its 5 minute floor but never falls below twice the stale threshold, so the two cutoffs cannot cross. {verified: RecordHeartbeatBackfillTests.PeerLateByFortySeconds_SurvivesABeatCarryingTheDerivedThresholdAsync, RecordHeartbeatBackfillTests.PeerPastTheDerivedThreshold_IsStillReapedAsync}

```sql{
title: "record_heartbeat after migration 147"
description: "Three optional parameters appended: the instance's lifecycle phase and library version backfill the registry row (non-null wins, null keeps), and the caller's derived stale threshold replaces the 30 s peer-reap constant. The previous overload is dropped first, so exactly one overload exists."
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
  p_lifecycle_phase         => 'Running',   -- NULL keeps what record_instance_state wrote
  p_library_version         => '1.0.0',     -- NULL keeps the recorded value
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
- `HeartbeatWorker` **stops its loop** on a refused heartbeat and logs the eviction at Error. Retrying can never succeed: the tombstone does not expire on the evicted instance's clock.

The fence is per **process**, not per pod: instance ids are generated per process, so a restarted pod draws a fresh id and is unaffected — correct, because a restart means fresh state — while the zombie keeps its id and stays fenced.

Tombstones are bounded: `perform_maintenance` purges rows older than `instance_eviction_retention_hours` (`wh_settings`, default 24). The tombstone only needs to outlive a realistic pause-and-resume window, and since ids are per-process, anything calling with that id after a day is not the process that was reaped.

## Capabilities: won, recorded, and fenced

A **capability** names what an instance may do; an exclusive one — `migrator`, `maintainer` — is a **duty**, held by one instance at a time. Capabilities are *won*, never assigned: an instance attempts the primitive (a session advisory lock on a dedicated direct connection, via `IDutyElector`), and the primitive grants or refuses. That keeps the failure path free — a dead instance's lock releases server-side as its session ends, with no timeout to tune, no split-brain window, and no durable "this one is the migrator" flag to orphan.

Holdings are **recorded but never consulted to decide**: *the lock decides, the row reports.* `wh_instance_capabilities` is keyed `(instance, capability)` with `acquired_at` — "which instance is the migrator right now, and for how long" as a query (and in the startup status surface's fleet section, as a join). It rides the same rails as liveness: reaped instances cascade their holdings, so the record's only staleness window is the heartbeat lease the system already bounds.

The eviction fence reaches acquisition: `record_capability` refuses a tombstoned instance, and the elector releases the lock it just won and stands down — a zombie can win a race but cannot hold a duty. Long-tenure holders fence themselves with `IDutyGrant.VerifyStillHeldAsync`: a grant whose session died (the OOMKill half-open-TCP shape) reports lost before the next unit of exclusive work, because another instance may already hold it.

## The Standby Handshake {#the-standby-handshake}

A breaking migration is a **planned outage** — the honest description of what a breaking schema change is — and the framework converts an outage that would otherwise be silent and corrupting into one that is bounded, announced and observable.

The migrating instance records **one fleet-wide standby request** (`wh_standby_requests` — single-row by table shape: one handshake at a time, which is what the migrator duty already guarantees). Live older peers' `StandbyWatcher` sees a binding request — from a *newer* version, requester *alive* — and drains: the lifecycle advances to `StandingBy`, pausing every run-control participant and posting `StandingBy` on the instance row for the migrator to observe. The migrator waits for every **live** older peer's recorded acknowledgment — an instance that stops heartbeating stops counting, so the wait is bounded by lease expiry, never by the goodwill of a process that may already be dead. Live follows [the liveness rule](#liveness-rule): a peer holding its alive-lock is live whatever its heartbeat's age, so a direct peer between two slow beats is still waited for, and a requester holding its lock still binds its peers. {verified: StandbyHandshakeCoverageTests.AwaitPeersStandingByAsync_AnOlderPeerHoldingItsAliveLock_StillCountsAsync, StandbyWatcherTests.ARequesterHoldingItsAliveLock_BindsUs_BetweenItsSlowBeatsAsync, StandbyWatcherTests.ARequesterPastTheWindowWithoutItsLock_IsVoidAsync, AliveLockLivenessSqlTests.FleetSource_ReportsWhetherAPeersAliveLockIsHeldAsync, AliveLockLivenessSqlTests.StandbyRequest_ReportsWhetherTheRequestersAliveLockIsHeldAsync}

The handshake reads the lock through `is_instance_alive(id, 0)` (migration 055, a zero heartbeat threshold answers the lock alone) rather than `wh_direct_alive_lock_holders`, because it runs before the new release's migrations have been applied.

Every path out of standby is bounded:

- **Committed** — the ledger now records the newer version; standing-by peers re-assess, see `StandDown`, and shut down, as the handshake promises. The orchestrator replaces them.
- **Rolled back** — the requester withdraws; the ledger is exactly as peers last read it. Revival is *not a second pipeline*: peers re-enter the re-entrant runner at `Assess`, find the schema unchanged, and resume.
- **Dead migrator** — its heartbeat lapses, its request is void, revival begins. Nobody is stranded.
- **Unresponsive peer** — eviction is the deliberate instrument (never an automatic consequence of slowness): `evict_instance` writes the tombstone the fence already honours, recording **who** issued it and why, and the handshake completes without the fenced peer — which can no longer heartbeat, win capabilities, or claim work.

The verdict is also **not a startup-only fact**: the watcher re-assesses on a slow cadence, so an instance that was current when it booted stands down when a newer peer migrates underneath it — alive, not ready, reapable, awaiting replacement.

## Migration touch points

| Migration | What changed |
|---|---|
| **055** (new) | `claim_instance_alive_lock(uuid) → bool` and `is_instance_alive(uuid, threshold) → bool` |
| **011** (modified) | `cleanup_stale_instances` skip-while-locked clause added; a later revision (v0.687) added an optional `p_definitive_dead_cutoff` parameter that bypasses the lock guard when the heartbeat is so old the instance is definitely dead (covers OOMKilled pods whose advisory lock lingers on a half-open TCP session until OS keepalive fires) |
| **106** (new) | `wh_instance_evictions` tombstone table; `cleanup_stale_instances` tombstones what it reaps; `record_heartbeat` returns `BOOLEAN` and refuses evicted instances |
| **107** (modified) | `perform_maintenance` Task 10 purges tombstones past `instance_eviction_retention_hours` (default 24) |
| **147** (new) | `record_heartbeat` gains `p_lifecycle_phase`, `p_library_version` (registry backfill, non-null wins) and `p_stale_threshold_seconds` (the caller's derived threshold for the opportunistic peer reap; definitive-dead cutoff never below twice it). Previous overload dropped; exactly one remains |
| **204** (new) | `wh_direct_alive_lock_holders()`: the direct instances whose alive-lock is held. `claim_work` ranks peers by [the liveness rule](#liveness-rule) and takes `p_alive_lock_held`; `wh_partition_assignment_candidates` reads the lock through the new function |

## Operator notes

- The lock acquisition is non-fatal: if it returns `false` (duplicate-startup race) or throws (migration 055 not yet applied), the heartbeat-table fallback continues to work.
- `IsAliveLockHeld` is observable on `IInstanceAliveLockSource` (implemented by `PgSharedNotifyConnection`, registered by `AddWhizbangPostgresNotifications`). The HeartbeatWorker reads it every tick, and `ClaimWorker` passes it to every claim as `ClaimWorkRequest.AliveLockHeld`; no eventing or cache invalidation is needed.
- DI: a host without the Postgres notifications keeps `NullInstanceAliveLockSource`, holds no lock and beats on the fast cadence. A host that registers its own `IInstanceAliveLockSource` keeps it.
- To see which instances are live by their lock right now, `SELECT * FROM wh_direct_alive_lock_holders();`. A direct instance missing from that list is judged by its heartbeat alone.
- An instance logging `has been evicted … heartbeat refused` is not broken and needs no intervention — it was reaped as stale while paused, its work was redistributed, and it is correctly refusing to rejoin. Restart the pod (a new process gets a new instance id) if it should return to service.
- A Warning `is alive again after being announced dead; retracting with InstanceJoinedSignal` means a heartbeat landed late, not that the monitor is wrong. The fleet has already healed; look for what stalled the beat (a long-running commit on the writer's connection, a saturated pool). `whizbang.liveness.deaths_retracted` counts these.
- Watchdog Warnings (EventId 9) mean the regular beat ran late enough to approach the threshold and the writer forced one. Occasional watchdog beats under load are the mechanism working; a steady stream points at a starved heartbeat writer.
- The monitor, the writer's watchdog and the SQL reap all read the threshold from `HeartbeatWorkerOptions`. Changing `IntervalSeconds` or `SlowIntervalSeconds` changes the threshold everywhere at once; there is no separate threshold to keep in step.

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

- [Capabilities and Duties](/v1.0.0/operations/startup/capabilities-and-duties) — election over the same session-lock machinery; holdings ride the liveness rails.
- [Rolling Upgrades](/v1.0.0/operations/startup/rolling-upgrades) — the standby handshake and eviction in the deployment story.
- [Pinned connection pool](./pinned-connection-pool.md) — also uses direct conn(s); future work may add a per-pinned-conn lock for redundancy.
- [Worker classification](./worker-classification.md) — HeartbeatWorker is classified `E` (timed) with an adaptive twist.
- [Idle footprint](./idle-footprint.md): the lifecycle monitor's adaptive tick alongside the other probes that relax when idle, and the `Whizbang.Probes` meter.
- [Metrics reference](/v1.0.0/operations/observability/metrics#liveness): the `Whizbang.Liveness` meter.
