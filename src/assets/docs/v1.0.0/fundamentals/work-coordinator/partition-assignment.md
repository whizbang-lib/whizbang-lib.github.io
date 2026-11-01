---
title: Partition assignment
pageType: concept
order: 5
version: 1.0.0
description: >-
  The elected partition assigner: one instance decides which instances are live and eligible for
  work and publishes the partition assignment every claimer uses, fenced by the role epoch, leased
  by the assigner's own liveness, and cached by claimers at no cost per claim.
tags: 'work-coordinator, partition-assignment, claim-work, role-election, liveness, eligibility, fencing'
codeReferences:
  - src/Whizbang.Core/Workers/PartitionAssignment.cs
  - src/Whizbang.Core/Workers/PartitionAssigner.cs
  - src/Whizbang.Core/Workers/PartitionAssignerWorker.cs
  - src/Whizbang.Core/Workers/PartitionAssignmentCache.cs
  - src/Whizbang.Core/Workers/IInstanceConnectionModeSource.cs
  - src/Whizbang.Data.Postgres/Notifications/PgPartitionAssignmentStore.cs
  - src/Whizbang.Data.Postgres/Migrations/203_PartitionAssigner.sql
  - src/Whizbang.Data.Postgres/Migrations/204_DirectInstancesAreLiveByTheirAliveLock.sql
  - src/Whizbang.Data.Postgres/Migrations/229_OnlyReadyInstancesAreEligibleForWork.sql
  - src/Whizbang.Data.Postgres/Migrations/231_StartupStageRecord.sql
  - src/Whizbang.Data.Postgres/Migrations/278_OneWriterOfTheInstancePhase.sql
testReferences:
  - tests/Whizbang.Partitioning.Tests/PartitionAssignerTests.cs
  - tests/Whizbang.Partitioning.Tests/PartitionAssignmentCacheTests.cs
  - tests/Whizbang.Core.Component.Tests/PartitionAssignerWorkerLoopTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PartitionAssignmentSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PartitionAssignerWorkerPostgresTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/AliveLockLivenessSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/WorkEligibilitySqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/AliveVersusEligibleE2ETests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupStageSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/InstanceTransitionSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/HeartbeatPhaseOrderSqlTests.cs
---

# Partition assignment

Unowned work is spread across instances by partition: an instance of rank `r` among `n` takes the
partitions where `partition_number % n = r`. Something has to decide `r` and `n`. Without an
assigner, every claim ranks the instances it believes are alive (a fresh heartbeat row, or a direct
instance holding its alive-lock) and eligible for work (see [Claim loop](claim-loop.md#ranking-who-counts-as-alive)). When that
belief is wrong, the shares overlap. Two situations make it wrong for everyone at once:

- a database pause lets every heartbeat go stale together;
- a connection pooler hides the application names that would otherwise show an instance as live.

Each instance then ranks itself alone and claims every partition. Overlap never causes double
processing (stream leases and row locks give each stream one owner), but it wastes acquisitions and
it is the condition under which concurrent claims contend for the same stream-ledger rows.

The **partition assigner** removes the guess. One instance, elected through the role election,
decides liveness and eligibility once for everyone and publishes the assignment. Claimers read it.

## The assignment

| Field | Meaning |
|---|---|
| `Members` | The live instances that are eligible for work, in rank order. Partition `p` belongs to `Members[p % Members.Count]`. Empty when no instance is eligible. |
| `Epoch` | The role election's epoch for the assigner's tenure. |
| `Revision` | The publish count within that tenure, from 1. |
| `AssignerInstanceId` | The instance that published it. |
| `LeaseExpiresAt` | When it stops being valid unless the assigner renews it. |

`(Epoch, Revision)` is the assignment's version. Operators can read the current assignment, its epoch
and its assigner with `SELECT * FROM wh_read_partition_assignment();`. In code, use
`IPartitionAssignmentSource.Current`, or `PartitionAssignerWorker.IsAssigner`, `Epoch` and
`LastPublished` on the instance that holds the role.

## How it behaves

**Election.** Every instance runs `PartitionAssignerWorker` and votes for the `partition-assigner`
role. The holder leads; the others vote again each renewal interval.

**Liveness, by connection mode.** Each instance records at registration how it reaches the database:

- `direct`: a dedicated direct connection that holds the instance's session alive-lock. The lock is
  authoritative: held, the instance is live. Without the lock, the heartbeat decides, over
  `DirectHeartbeatWindow` (default 180 s, three of the slow beats a lock holder makes).
- `pooled`: pooled connections only, so no lock or application name can be seen. The heartbeat
  decides, over `PooledHeartbeatWindow` (default 90 s).

This is the assigner's form of the [liveness rule](/v1.0.0/fundamentals/workers/instance-liveness#liveness-rule)
every reader applies. The assigner reads its candidates from `wh_partition_assignment_candidates()`, which
reports, for every registered instance that is not evicted, its connection mode, whether its alive-lock is
held and the age of its heartbeat. Since migration 204 the lock column comes from
`wh_direct_alive_lock_holders()`, the same definition `claim_work` ranks by, so it is only ever true for a
direct instance: a pooled instance's lock is never consulted. A direct instance whose lock is released is
judged by its heartbeat on the assigner's next tick. {verified: PartitionAssignmentSqlTests.Candidates_ADirectInstanceHoldingItsAliveLock_ReportsTheLockAsync, PartitionAssignmentSqlTests.Candidates_APooledInstance_IsNeverJudgedByALockAsync, PartitionAssignmentSqlTests.Candidates_AnEvictedInstance_IsLeftOutAsync, AliveLockLivenessSqlTests.Candidates_ADirectInstanceWhoseLockIsReleased_ReportsNoLockAsync}

**Candidates are only instances eligible for work.** Alive is not the same as ready. Since migration
229, `wh_partition_assignment_candidates()` lists an instance only when it is
[eligible for work](/v1.0.0/fundamentals/workers/instance-liveness#alive-versus-eligible): its recorded
lifecycle phase is `AcceptingCommands` or `Running`, or it records no phase at all (an older build).
A starting instance (still connecting or migrating), a paused one, one standing by and a draining one
are alive but are not candidates, so the assigner never gives them a share. Their partitions go to
the eligible instances on the next publish. The assigner applies its liveness windows only to the
candidates, so a member is both alive and eligible. {verified: WorkEligibilitySqlTests.Candidates_ALiveInstanceInMigrating_IsLeftOutAsync, WorkEligibilitySqlTests.Candidates_AnInstanceThatReachesAcceptingCommands_BecomesACandidateAsync, WorkEligibilitySqlTests.Candidates_ADrainingInstanceWithAFreshHeartbeat_IsLeftOutAtOnceAsync, WorkEligibilitySqlTests.Candidates_AnOlderInstanceThatRecordsNoPhase_IsStillACandidateAsync, AliveVersusEligibleE2ETests.AnInstanceHeldInStartup_IsAliveButNeverACandidateNorRanked_WhileAReadyPeerTakesAllWorkAsync}

**Since migration 231 the recorded startup stage decides too.** An instance that records a
[startup stage](/v1.0.0/operations/startup/startup-status#startup-stages) is eligible only at stage 60
(Accept commands) or 70 (Running), and its lifecycle phase must still allow work, so a paused or
standing-by instance stays out even while its stage is Running. A row with no stage (an older build,
or one written before the instance's first stage write) is judged by its phase alone, as above. A
starting instance becomes a candidate exactly when its move into Accept commands is written, and a
draining one drops out the moment Draining is written. {verified: StartupStageSqlTests.Eligible_EachRecordedStage_IsEligibleOnlyInAcceptCommandsOrRunningAsync, StartupStageSqlTests.Eligible_ARowThatRecordsNoStage_IsJudgedByItsPhaseAsync, StartupStageSqlTests.Eligible_ARunningInstanceThatIsPaused_IsNotEligibleAsync, StartupStageSqlTests.Candidates_FollowTheRecordedStageAsync}

**Since migration 278 the stage and the phase are one write.** Eligibility reads one recorded phase, and the
[stage record](/v1.0.0/operations/startup/startup-status#one-writer-of-the-phase) is its only writer: each transition
writes the stage, its phase and the library version in one update, a pause or a stand-by writes its phase and keeps
the stage, and a heartbeat or a registration fills the phase only on a row that records none. A candidate list is
never read between a stage and its phase, and a heartbeat built before a pause or a stand-by can no longer write an
eligible phase back over it, so a paused or standing-by instance stays out until the transition that ends it. A starting
instance's row records `Connecting` from its registration, so it is never a candidate while it migrates.
{verified: InstanceTransitionSqlTests.ATransition_IsOneUpdateOfTheRowAsync, InstanceTransitionSqlTests.APhaseOnlyWrite_KeepsTheStage_ItsMessage_AndWhenItWasEnteredAsync, HeartbeatPhaseOrderSqlTests.APhaseOffTheLadder_OnABeat_IsNotWritten_EitherWayAsync, WorkEligibilitySqlTests.BootstrapRegistration_RecordsTheInstanceAsConnecting_SoItIsNotACandidateAsync, AliveVersusEligibleE2ETests.AnInstanceHeldInStartup_IsAliveButNeverACandidateNorRanked_WhileAReadyPeerTakesAllWorkAsync}

The decision lives in the database, in one function every reader shares, so an assigner on an older
build that reads the candidates during a rolling upgrade leaves out the same instances a newer one
does.

**The assigner is a member only when it is a candidate.** The assigner is running the evaluation, so
when it is a candidate it is a member whatever the age of its own heartbeat. When it is not a
candidate (it won the role while still migrating, or it is draining) it leaves itself out, exactly as
it leaves out any other instance that cannot claim a share. An instance that wins the assigner role
during its own startup therefore does not hand itself partitions it cannot yet work. {verified: PartitionAssignerTests.LiveMembers_TheAssignerAmongTheCandidates_IsAMemberWhateverItsHeartbeatAsync, PartitionAssignerTests.LiveMembers_TheAssignerNotAmongTheCandidates_IsNotAMemberAsync, AliveVersusEligibleE2ETests.TheStall_AnAssignerHeldInStartup_StrandsNoWork_AndTheReadyPeerDrainsTheBacklogAsync}

**Nobody eligible: an empty assignment.** When no instance is a candidate, the assigner publishes an
assignment with no members. A claimer that presents it finds itself absent and
[ranks itself](claim-loop.md#ranking-who-counts-as-alive) among the eligible peers, counting itself, so
claiming never stops for want of a member. {verified: PartitionAssignerTests.LiveMembers_WithNoCandidateAtAll_IsEmptyAsync, PartitionAssignmentSqlTests.ClaimWork_WhenNotAMemberOfTheCurrentAssignment_RanksItselfWithoutANoticeAsync}

**Publishing.** Each tick of its tenure (one per role renewal interval) the assigner judges the
registered instances and publishes when the live set changes: an alive-lock gained or lost, a
heartbeat gone stale or fresh. It also publishes when its tenure has not published yet, and on a
slow backstop (`RepublishInterval`, default 5 minutes).

**Fencing.** The role epoch is checked in two places:

- where the assignment is written: a deposed assigner's publish is refused;
- where `claim_work` reads it: a claim accepts the version it presents only while that version is
  still the published one and its lease has not run out.

**Expiry is the assigner's liveness.** The assignment carries a lease (`AssignmentLease`, default
90 s). The assigner renews it as part of its own liveness: on its alive-lock tick while it holds the
lock, and with every heartbeat. So "the assignment expired" and "the assigner has not been seen" are
one timeout, not two.

**Missing or stale assignment.** A claimer keeps using its last assignment until it expires, then
ranks itself as before. A claim never stops for want of an assignment.

## Draining {#draining}

When an instance starts to drain (its lifecycle enters `Stopping`), it stops being eligible for work
at once, while its heartbeat is still fresh. Two kinds of work are affected differently:

- **Its unclaimed share moves at once.** The next publish leaves it out of `Members`, and peers that
  rank themselves stop counting it on their next claim, so the partitions it would have claimed go to
  its peers without waiting for its heartbeat to lapse.
- **Streams it has already claimed stay with it.** A claim decides which instance owns a stream, not
  who gets a share, and ownership is left alone: the draining instance keeps the streams it holds
  until it finishes them or their leases lapse. Handing a stream that is mid-flight to a peer would
  let two instances work it at once, out of order and twice. A starting instance owns no streams to
  begin with, because an instance id is new for each process.

{verified: WorkEligibilitySqlTests.Candidates_ADrainingInstanceWithAFreshHeartbeat_IsLeftOutAtOnceAsync, WorkEligibilitySqlTests.Rank_ADrainingPeer_ItsShareMovesToTheCallerAtOnceAsync, AliveVersusEligibleE2ETests.ADrainingInstance_StopsBeingEligible_AndItsShareGoesToItsPeerAsync}

## Cost

Claimers cache the assignment in memory (`PartitionAssignmentCache`). The assigner announces each
publish with `NOTIFY wh_partition_assignment` (payload `epoch:revision`). A claimer that hears it, or
whose claim reports its copy stale, refreshes with one keyed read of a one-row table. A claim
presents only the version. Its fence is one read of a one-row table, and it replaces the claim's ranking
query instead of adding to it, so a claim with the assignment costs no more than one without.

## Configuration

`PartitionAssignerOptions`:

| Option | Default | Meaning |
|---|---|---|
| `Enabled` | `true` | Elect an assigner and use its assignment. Takes effect where role assignment is enabled. |
| `PooledHeartbeatWindow` | 90 s | How long a pooled instance's heartbeat counts it as live. |
| `DirectHeartbeatWindow` | 180 s | How long a direct instance's heartbeat counts it as live while its lock is not held. |
| `AssignmentLease` | 90 s | How long an assignment holds without renewal. Must exceed 60 s, the slow heartbeat cadence. |
| `RepublishInterval` | 5 min | The backstop: republish at least this often. |

```csharp{title="Tune the partition assigner" description="Shorten the backstop republish interval" category="Configuration" difficulty="INTERMEDIATE" tags=["Work coordinator", "Partition assignment", "Options"] tests=["PartitionAssignerTests.Validate_TheDefaults_PassAsync"]}
services.Configure<PartitionAssignerOptions>(options => {
  options.RepublishInterval = TimeSpan.FromMinutes(2);
});
```

## Signals

Every transition has a public event, for diagnostics and for tests that wait on the transition itself:

- `PartitionAssignerWorker`: `OnBecameAssigner`, `OnStoppedAssigning`, `OnEvaluated`, `OnPublished`.
- `PartitionAssignmentCache`: `OnPublishAnnounced`, `OnRefreshed`, `OnAssignmentChanged`.

## Related

- [Claim loop](claim-loop.md)
- [Instance liveness](/v1.0.0/fundamentals/workers/instance-liveness#liveness-rule): the liveness rule and `wh_direct_alive_lock_holders`.
- [Alive versus eligible for work](/v1.0.0/fundamentals/workers/instance-liveness#alive-versus-eligible): the two tests side by side.
- [Notifications and pgbouncer](notifications-and-pgbouncer.md)
- [Commit sequence](commit-sequence.md): the commit-order stamper is elected the same way.
