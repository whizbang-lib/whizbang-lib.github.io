---
title: Partition assignment
pageType: concept
order: 5
version: 1.0.0
description: >-
  The elected partition assigner: one instance, in every driver, decides which instances are live
  and eligible for work and publishes an explicit map of the 10,000 partitions to them, changed
  incrementally after membership settles, fenced by the role epoch and leased by the assigner's own
  liveness. With ownership by map on (the default), the map alone decides who owns a stream, a moved
  partition is handed over, and a write made under an epoch that has moved on is fenced.
tags: 'work-coordinator, partition-assignment, partition-map, ownership-by-map, settle-window, claim-work, role-election, liveness, eligibility, fencing, handover, graceful-leave'
codeReferences:
  - src/Whizbang.Core/Workers/PartitionAssignment.cs
  - src/Whizbang.Core/Workers/PartitionAssigner.cs
  - src/Whizbang.Core/Workers/PartitionAssignerWorker.cs
  - src/Whizbang.Core/Workers/PartitionAssignmentCache.cs
  - src/Whizbang.Core/Workers/PartitionMap.cs
  - src/Whizbang.Core/Messaging/HeartbeatRequest.cs
  - src/Whizbang.Core/Workers/IInstanceConnectionModeSource.cs
  - src/Whizbang.Data.Postgres/Notifications/PgPartitionAssignmentStore.cs
  - src/Whizbang.Data.Postgres/Notifications/PartitionAssignerRegistration.cs
  - src/Whizbang.Data.Postgres/Notifications/PostgresCoordinationRegistration.cs
  - src/Whizbang.Data.Postgres/Migrations/203_PartitionAssigner.sql
  - src/Whizbang.Data.Postgres/Migrations/204_DirectInstancesAreLiveByTheirAliveLock.sql
  - src/Whizbang.Data.Postgres/Migrations/229_OnlyReadyInstancesAreEligibleForWork.sql
  - src/Whizbang.Data.Postgres/Migrations/231_StartupStageRecord.sql
  - src/Whizbang.Data.Postgres/Migrations/278_OneWriterOfTheInstancePhase.sql
  - src/Whizbang.Data.Postgres/Migrations/300_AnIneligibleCallerClaimsNothing.sql
  - src/Whizbang.Data.Postgres/Migrations/316_OneDurableInstanceRecord.sql
  - src/Whizbang.Data.Postgres/Migrations/317_EveryReaderJudgesLivenessByTheRule.sql
  - src/Whizbang.Data.Postgres/Migrations/564_ThePublishedAssignmentCarriesThePartitionMap.sql
  - src/Whizbang.Data.Postgres/Migrations/565_PartitionsAreOwnedByThePublishedMap.sql
  - src/Whizbang.Data.Postgres/Migrations/566_ClaimsDecideThroughTheOwnershipTable.sql
  - src/Whizbang.Data.Postgres/Migrations/567_StoresNameNoOwnerInMapMode.sql
  - src/Whizbang.Data.Postgres/Migrations/570_WritesAreFencedByThePartitionEpoch.sql
  - src/Whizbang.Data.Postgres/Migrations/571_MovedPartitionsAreHandedOver.sql
  - src/Whizbang.Data.Postgres/Migrations/572_FailureReportsAreFenced.sql
  - src/Whizbang.Data.Postgres/Migrations/577_PerspectiveWritesHoldTheirPartitionEpoch.sql
  - src/Whizbang.Data.Postgres/Migrations/610_WritersHoldTheEpochKeyAndFlipsNeverWait.sql
  - src/Whizbang.Core/Messaging/PartitionTenures.cs
  - src/Whizbang.Core/Workers/PartitionHandoverWorker.cs
  - src/Whizbang.Core/Perspectives/PartitionOwnershipLostException.cs
  - src/Whizbang.Data.Postgres/CoordinatorOwnershipNotices.cs
  - src/Whizbang.Data.Postgres/Perspectives/PerspectiveWriteFence.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCorePerspectiveWriteFence.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/LivenessRuleReadersSqlTests.cs
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
  - tests/Whizbang.Partitioning.Tests/PartitionMapTests.cs
  - tests/Whizbang.Partitioning.Tests/PartitionAssignerWorkerTests.cs
  - tests/Whizbang.Partitioning.Tests/PartitionAssignmentTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PartitionMapClaimSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PartitionOwnershipSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/OwnershipByMapClaimSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/OwnershipByMapStoreSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PartitionAssignerRegistrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/DriverCoordinationParityTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/ClaimPathsDecideThroughTheOwnershipTableGuardTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/ClaimsReadThePartitionMapGuardTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperCoordinationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/OwnershipFencingSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/CoordinatorOwnershipNoticesTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/CoordinatorNamesTheClaimedEpochTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PerspectiveWritesAreFencedTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PerspectiveWriteHoldSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/TenureFillTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PartitionHandoverSqlTests.cs
  - tests/Whizbang.Core.Unit.Messaging.Tests/Messaging/PartitionTenuresTests.cs
  - tests/Whizbang.Core.Unit.Workers.Tests/Workers/PartitionHandoverWorkerTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PartitionHandoverWorkerLoopTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/PerspectiveWorkerDrainModeTests.WriteBehindHandover.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperOwnershipNoticesTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/MultiStreamWriteOrderSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PartitionEpochKeySqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/FlipLockOrderSqlTests.cs
---

# Partition assignment

Every stream id hashes to one of 10,000 partitions (`compute_partition`), and work is spread across instances by
partition. The elected **partition assigner** publishes an explicit map of those partitions to the live instances that
are eligible for work, and every claim reads it: a claimer takes the partitions the map gives it. The assigner changes
the map [incrementally](#incremental-map), so a join or a leave moves about 1/N of the partitions, and only once
membership has [settled](#settle-window).

**Modulo is the fallback.** When no map is published (an assignment of an earlier release's shape, which carries only
its members), an instance of rank `r` among `n` takes the partitions where `partition_number % n = r`. The first map
the assigner publishes is exactly that modulo, so moving to the map moves nothing.

Without an assigner, every claim would rank the instances
[the liveness rule](/v1.0.0/fundamentals/workers/instance-liveness#liveness-rule) calls alive and that are eligible for
work itself (see [Claim loop](claim-loop.md#ranking-who-counts-as-alive)), which is still what a claimer does with
[ownership by map](#ownership-by-map) off and no current assignment. When that belief is wrong, the shares overlap. Two
situations make it wrong for everyone at once:

- a database pause lets every heartbeat go stale together;
- a fleet behind a connection pooler holds no alive-locks, so its heartbeats alone speak for it, and a slow database delays them all.

Each instance then ranks itself alone and claims every partition. Overlap never causes double
processing (stream leases and row locks give each stream one owner), but it wastes acquisitions and
it is the condition under which concurrent claims contend for the same stream-ledger rows.

The **partition assigner** removes the guess. One instance, elected through the role election,
decides liveness and eligibility once for everyone and publishes the assignment. Claimers read it.

**The assigner always runs, in every driver** ([#2559](https://github.com/whizbang-lib/whizbang/issues/2559)). Both
Postgres drivers register role assignment and the assigner through one shared registration
(`PostgresCoordinationRegistration`), and a parity test fails if either stops doing so. There is no switch that turns
it off: `PartitionAssignerOptions.Enabled` is removed, and a configured
`Whizbang:Database:PartitionAssigner:Enabled` is reported once at startup as a
[removed key](/v1.0.0/operations/configuration/configuration-reference#removed-keys) and changes nothing.
{verified: DriverCoordinationParityTests.EveryPieceOfTheSharedCoordination_IsRegisteredAlikeByBothDriversAsync, DriverCoordinationParityTests.BothDrivers_ResolveTheSameElectorDutyLoopAndAssignerAsync, DapperCoordinationTests.TwoInstances_OneIsElectedAssigner_AndTheOthersClaimPresentsItsMapAsync, PartitionAssignerRegistrationTests.TheRemovedEnabledKey_SetToFalse_TurnsNothingOffAsync}

## The assignment

| Field | Meaning |
|---|---|
| `Members` | The live instances that are eligible for work, in rank order. Empty when no instance is eligible. |
| `Owners` | The partition map ([#2558](https://github.com/whizbang-lib/whizbang/issues/2558)): entry `p` is the index in `Members` of the member partition `p` belongs to, 10,000 entries. Partition `p` belongs to `Members[Owners[p]]`. Null for an assignment published without a map (an earlier release's assigner), whose partition `p` belongs to `Members[p % Members.Count]`. |
| `Epoch` | The role election's epoch for the assigner's tenure. |
| `Revision` | The publish count within that tenure, from 1. |
| `AssignerInstanceId` | The instance that published it. |
| `LeaseExpiresAt` | When it stops being valid unless the assigner renews it. |

`(Epoch, Revision)` is the assignment's version. Operators can read the current assignment, its epoch
and its assigner with `SELECT * FROM wh_read_partition_assignment();`, whose trailing `partition_owners` column is the
map (migration 564; a reader that names its columns reads what it read before). In code, use
`IPartitionAssignmentSource.Current`, or `PartitionAssignerWorker.IsAssigner`, `Epoch` and
`LastPublished` on the instance that holds the role.

**An instance's share is part of its assignment.** How many partitions each instance owns, with the published map's
revision and the roles it holds, is one derived fact per instance, `wh_instance_assignments()`: in map mode a count of
its ownership rows, before the switch what a claim ranks by (the explicit map, or the modulo of the member list). An
eligible instance that owns no partition reads `awaiting-share`, and logs and reports it, but readiness does not wait
for a share. See [instance assignments](/v1.0.0/operations/startup/startup-status#instance-assignments).
{verified: InstanceAssignmentsSqlTests.Assignments_InMapMode_NameEveryKind_FromTheTablesThatDecideItAsync, InstanceAssignmentsSqlTests.Assignments_BeforeTheMapSwitch_CountTheShareFromThePublishedMapAsync, InstanceAssignmentsSqlTests.Assignments_WithNoMapPublished_AreAwaitingTheirShare_AndALapsedRoleIsNotHeldAsync}

## How it behaves

**Election.** Every instance, on either driver, runs `PartitionAssignerWorker` from the Coordinate stage and votes for
the `partition-assigner` role. The holder leads; the others vote again each renewal interval.

**Liveness is the rule's answer.** The assigner keeps no window of its own. It reads its candidates from
`wh_partition_assignment_candidates()`, which reports, for every registered instance that is not evicted, its
connection mode, whether its alive-lock is held, the age of its heartbeat and, since migration 317, `is_live`: whether
[the liveness rule](/v1.0.0/fundamentals/workers/instance-liveness#liveness-rule) calls it live. The assigner reads
`PartitionAssignmentCandidate.IsLive` and judges nothing itself; the lock and the heartbeat's age are carried for
diagnostics only. So a direct instance holding its alive-lock is live, a direct instance whose lock is released is live
for one beat, and an instance behind a transaction pooler is live inside the window it declares from its own cadence,
exactly as the claim, the reap and every other reader judge it. {verified: PartitionAssignerTests.IsLive_IsTheRulesAnswer_WhateverTheLockOrTheHeartbeatAsync, LivenessRuleReadersSqlTests.Candidates_ReportWhetherTheRuleCallsEachLiveAsync, PartitionAssignmentSqlTests.Candidates_ADirectInstanceHoldingItsAliveLock_ReportsTheLockAsync, PartitionAssignmentSqlTests.Candidates_APooledInstance_IsNeverJudgedByALockAsync, PartitionAssignmentSqlTests.Candidates_AnEvictedInstance_IsLeftOutAsync, AliveLockLivenessSqlTests.Candidates_ADirectInstanceWhoseLockIsReleased_ReportsNoLockAsync}

**Why the assigner has no windows.** It used to judge the candidates itself, with `DirectHeartbeatWindow` (180 s) for a
direct instance without its lock and `PooledHeartbeatWindow` (90 s) for a pooled one. Those were a second definition of
alive beside the claim's: the assigner could publish a member the claim and the reap already called dead, or leave out
one they still counted. With the rule's answer on every candidate, the published membership and every claimer's own
ranking agree. Both options are removed.

**Candidates are only instances eligible for work.** Alive is not the same as ready. Since migration
229, `wh_partition_assignment_candidates()` lists an instance only when it is
[eligible for work](/v1.0.0/fundamentals/workers/instance-liveness#alive-versus-eligible): its recorded
lifecycle phase is `AcceptingCommands` or `Running`, or it records no phase at all (an older build).
A starting instance (still connecting or migrating), a paused one, one standing by and a draining one
are alive but are not candidates, so the assigner never gives them a share. Their partitions go to
the eligible instances on the next publish. The assigner keeps only the candidates the rule calls
live, so a member is both alive and eligible. {verified: WorkEligibilitySqlTests.Candidates_ALiveInstanceInMigrating_IsLeftOutAsync, WorkEligibilitySqlTests.Candidates_AnInstanceThatReachesAcceptingCommands_BecomesACandidateAsync, WorkEligibilitySqlTests.Candidates_ADrainingInstanceWithAFreshHeartbeat_IsLeftOutAtOnceAsync, WorkEligibilitySqlTests.Candidates_AnOlderInstanceThatRecordsNoPhase_IsStillACandidateAsync, AliveVersusEligibleE2ETests.AnInstanceHeldInStartup_IsAliveButNeverACandidateNorRanked_WhileAReadyPeerTakesAllWorkAsync}

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
assignment with no members and no map, and leaves the [ownership table](#ownership-by-map) as it was. With ownership by
map off, a claimer that presents it finds itself absent and
[ranks itself](claim-loop.md#ranking-who-counts-as-alive) among the eligible peers, counting itself, so
claiming never stops for want of a member. With it on, a claimer the map does not name claims nothing. A claimer whose own row is not eligible is the exception: since migration
300 it claims nothing at all, member or not ([why](claim-loop.md#ineligible-caller-claims-nothing)). {verified: PartitionAssignerTests.LiveMembers_WithNoCandidateAtAll_IsEmptyAsync, PartitionAssignmentSqlTests.ClaimWork_WhenNotAMemberOfTheCurrentAssignment_RanksItselfWithoutANoticeAsync, PartitionMapClaimSqlTests.Publish_OfTheEmptyMap_StoresNoMembersAndNoMapAsync, PartitionOwnershipSqlTests.Publish_WithNoMembers_LeavesTheOwnershipAsItWasAsync, OwnershipByMapClaimSqlTests.AClaimerOutsideTheMap_ClaimsNothing_InAnyQueueAsync}

**Publishing.** Each tick of its tenure (one per role renewal interval) the assigner reads the
rule's answer for each registered instance and publishes when the live set changes (an alive-lock gained or lost, a
heartbeat gone stale or fresh) and the change has [settled](#settle-window). It also publishes when its tenure has not
published yet, and on a slow backstop (`RepublishInterval`, default 5 minutes). What it publishes is the
[incremental map](#incremental-map), and the same statement writes the [ownership table](#ownership-by-map). The
publish log line says how many partitions it moved
(`Published partition assignment {Epoch}:{Revision} with {MemberCount} members, moving {MovedPartitions} partitions ({Reason})`).

**Fencing.** The role epoch is checked in two places:

- where the assignment is written: a deposed assigner's publish is refused;
- where `claim_work` reads it: a claim accepts the version it presents only while that version is
  still the published one and its lease has not run out.

**Expiry is the assigner's liveness.** The assignment carries a lease (`AssignmentLease`, default
90 s). The assigner renews it as part of its own liveness: on its alive-lock tick while it holds the
lock, and with every heartbeat. So "the assignment expired" and "the assigner has not been seen" are
one timeout, not two.

**Missing or stale assignment.** It depends on the [ownership mode](#ownership-by-map):

- **Off.** A claimer keeps using its last assignment until it expires, then ranks itself as before. A
  claim never stops for want of an assignment.
- **On (the default).** The claim reads the published map in its own statement and ignores the claimer's cached copy. A claimer with
  no valid map claims nothing and waits; it never ranks itself, so two claimers can never use two maps at once
  ([#2554](https://github.com/whizbang-lib/whizbang/issues/2554)). See [map validity](#map-validity).
{verified: PartitionMapClaimSqlTests.ClaimWork_WithAMapButAStaleVersion_RanksItselfByTheResidueAsync, OwnershipByMapClaimSqlTests.WithNoValidMap_NothingIsClaimed_AndTheClaimSaysSoAsync}

## The incremental map {#incremental-map}
{verified: PartitionMapTests.Initial_IsTheModuloOverTheMembers_SoTheFirstMapMovesNothingAsync, PartitionMapTests.Rebalance_AJoin_TakesItsShareEvenlyFromEveryMember_AndMovesNothingElseAsync, PartitionMapTests.Rebalance_ALeave_SpreadsTheLeaversPartitionsEvenly_AndMovesNothingElseAsync, PartitionMapTests.EveryJoinOrLeave_MovesAtMostCeilPOverN_IsBalancedWithinOne_AndMovesOnlyTheChangedMembersShareAsync, PartitionMapTests.TheSameHistory_GivesTheSameMap_EveryTimeAsync, PartitionAssignerWorkerTests.Tick_AJoin_PublishesAMapThatMovesOnlyTheJoinersShareAsync, PartitionAssignerWorkerTests.Tick_ANewTenure_StartsFromThePublishedMap_SoItMovesNothingAsync}

Before [#2558](https://github.com/whizbang-lib/whizbang/issues/2558) the assignment carried only its members, and
partition `p` belonged to `Members[p % N]`. One join or leave changed `N`, and with it the owner of about N/(N+1) of
all 10,000 partitions. The assigner now keeps an explicit map (`PartitionMap`) and changes it as little as balance
allows:

- **A join** takes about 1/(N+1) of the partitions, within one of evenly from each member.
- **A leave** spreads the leaver's partitions within one of evenly over the rest.
- **Nothing else moves.** Either change moves at most `ceil(P / N)` partitions, and the map stays balanced within one
  partition per member.

Each member's quota is `P / N`, plus one for the `P % N` members that already hold the most, so the members holding
the extra partition keep it. Each staying member keeps its lowest-numbered partitions up to its quota, and the freed
partitions go to the members below theirs, in member order. The result depends only on the map and the new members,
so the same history always gives the same map.

| Behavior | Why | Verified by |
|---|---|---|
| The first map is the modulo over the members. | It is the arithmetic every claim applied before the map, so the first publish of a map moves nothing. | {verified: PartitionMapTests.Initial_IsTheModuloOverTheMembers_SoTheFirstMapMovesNothingAsync} |
| A new tenure starts from the map already published, whoever published it. | A failover of the assigner role is not a membership change, so it must not move partitions. | {verified: PartitionAssignerWorkerTests.Tick_ANewTenure_StartsFromThePublishedMap_SoItMovesNothingAsync} |
| An assignment of the older shape is read as the modulo its claimers use. | During a rolling deploy, an assigner of the previous release publishes members only; the claims then rank by modulo exactly as before, and the next assigner of this release starts from that modulo. | {verified: PartitionMapTests.FromPublished_TheOlderShape_IsTheModuloItsClaimersUseAsync, PartitionMapClaimSqlTests.Publish_WithoutAMap_StoresNone_SoTheClaimsRankByModuloAsync} |
| `wh_publish_partition_assignment` refuses a map of another length, or one naming a member it does not list. | One owner per partition by construction: no partition can be given to two members or to none. | {verified: PartitionMapClaimSqlTests.Publish_AMapOfAnotherLength_IsRefusedAsync, PartitionMapClaimSqlTests.Publish_AMapNamingAMemberItDoesNotList_IsRefusedAsync} |

**How it is stored.** The map is `wh_published_partition_assignment.partition_owners`, a `SMALLINT[10000]` whose entry
`p + 1` is the zero-based index in `members` of partition `p`'s member: a fixed 20,000 bytes whatever the member count,
and one array subscript to answer "is this mine". Every claim tests a partition through one inlined predicate,
`wh_partition_in_share(partition, rank, count, owners)`: the map's answer when a map is given, `partition % count`
otherwise. A guard test fails when a claim function tests a partition by a bare modulo instead.
{verified: PartitionMapClaimSqlTests.PartitionInShare_WithAMap_IsTheMapsAnswer_AndWithoutOne_TheResidueAsync, PartitionMapClaimSqlTests.ClaimWork_Outbox_WithAMap_TakesThePartitionsTheMapGivesIt_NotItsResidueAsync, PartitionMapClaimSqlTests.ClaimWork_Inbox_WithAMap_TakesThePartitionsTheMapGivesIt_NotItsResidueAsync, PartitionMapClaimSqlTests.ClaimWork_Perspective_WithAMap_TakesThePartitionsTheMapGivesIt_NotItsResidueAsync, ClaimsReadThePartitionMapGuardTests.EveryClaimFunction_TestsItsPartitionsThroughTheMapPredicateAsync}

The partition count is fixed at 10,000. Changing it would re-partition every stream, which is a migration of its own.

### Membership settles before the map moves {#settle-window}
{verified: PartitionAssignerTests.Evaluate_AChangeInsideTheSettleWindow_SettlesWithoutPublishingAsync, PartitionAssignerTests.Evaluate_AChangeInsideTheSettleWindow_SettlesEvenWhenTheBackstopIsDueAsync, PartitionAssignerTests.Evaluate_AChangeWithAZeroWindow_PublishesAtOnceAsync, PartitionAssignerTests.Evaluate_ANewTenure_PublishesAtOnce_WhateverTheWindowAsync, PartitionAssignerWorkerTests.Tick_KJoinsInsideTheSettleWindow_PublishOnceAsync, PartitionAssignerWorkerTests.Tick_AChangeThatRevertsInsideTheWindow_PublishesNothing_AndTheNextChangeStartsAFreshWindowAsync, PartitionAssignerWorkerTests.Tick_AfterAPublish_TheNextChangeWaitsAWindowOfItsOwnAsync, PartitionAssignerWorkerTests.Tick_WhileSettling_RenewsTheLeaseWhileTheLockIsHeldAsync}

A membership change is collected for a **settle window** (`SettleWindow`, default 5 seconds, bound from
`Whizbang:Database:PartitionAssigner:SettleWindow`) before one map is published:

- the window runs from the first change the assigner sees, and every join and leave inside it lands in the same publish;
- a change that reverts inside the window publishes nothing, and the next change starts a fresh window;
- a new tenure publishes at once, whatever the window, and the backstop does not cut a window short;
- the published map stays valid, and its lease is renewed, while a change settles;
- `00:00:00` publishes every change at once; a negative window is refused by `Validate`.

While a change settles, the evaluation's reason is `Settling` and nothing is published. A rolling deploy of K instances
therefore causes K small moves, not a reshuffle on every heartbeat.

### Ready before assigned {#ready-before-assigned}
{verified: PartitionAssignerWorkerPostgresTests.AJoiningInstance_GetsPartitions_OnlyOnceItsStartupReportsReadyAsync, PartitionAssignerWorkerTests.Tick_AnInstanceNotYetReady_IsGivenNothing_UntilItIsACandidateAsync}

A joining instance is given partitions only once its startup reports ready. The assigner's candidates are the
instances [eligible for work](#how-it-behaves) (stage Accept commands or Running, by the recorded startup stage), so an
instance still connecting or migrating is never in the map, and the map never hands a share to an instance that cannot
yet claim it. Its share arrives with the first publish after its move into Accept commands is written, and after that
change has settled.

## Ownership by map {#ownership-by-map}
{verified: PartitionOwnershipSqlTests.Publish_WritesOneActiveRowPerPartition_OwnedByTheMembersInTurn_AtEpochOneAsync, PartitionOwnershipSqlTests.Publish_WritesOwnershipFromTheMap_NotTheResidueAsync, PartitionOwnershipSqlTests.Republish_OfTheSameMap_WritesNothing_AndAMovedPartitionAdvancesAloneAsync, PartitionOwnershipSqlTests.Publish_ByADeposedAssigner_WritesNoOwnershipAsync, ClaimPathsDecideThroughTheOwnershipTableGuardTests.EveryClaimFunction_DecidesThroughWhIOwn_AndRanksOnlyInTheLegacyBranchAsync}

Without ownership by map, the assignment decides only who may take **unowned** work: once a stream has a stored owner
in the stream ledger (`wh_active_streams.assigned_instance_id`), that owner keeps it while it is live, and the first
instance to store work for a stream becomes its owner. A rebalance then moves only idle streams. **Ownership by map**
([#2555](https://github.com/whizbang-lib/whizbang/issues/2555), [#2554](https://github.com/whizbang-lib/whizbang/issues/2554))
makes the published map the only answer to "who owns stream S": the owner of `partition(S)` in the current map. It is
behind a per-service switch that is **on by default** ([#2557](https://github.com/whizbang-lib/whizbang/issues/2557)):
the assigner turns it on once every live instance of the service supports the mode, so a rolling deploy of mixed
releases keeps the stored-owner rules until the last instance of an earlier release is gone. A partition the map moves
is [handed over](#handover) rather than moved under a running owner, and a write made under an epoch that has moved on
is [fenced](#fencing). In map mode a publish never raises an epoch: a partition leaving an owner that is not live
becomes a handover with an immediate deadline, completed by the assigner's deadline sweep in the same tick.

### The ownership table

`wh_partition_ownership` holds one row per partition (10,000): its owner, the **epoch** of that ownership, its
**state** (`active`, or `handing_over`), and, while it hands over, the next owner and a deadline. Ownership is per
partition, never per stream.

- **The assigner writes it with every map it publishes**, in the same statement and under the same role epoch
  (`wh_assert_role_epoch`), so a deposed assigner can write neither.
- **Only a partition the map moves is written.** Its owner changes and its epoch rises by one; a republish of the same
  members and map writes nothing.
- **It is written whether or not the switch is on**, so it holds the current map the moment the switch flips.

The epoch is the [fencing](#fencing) token: it rises by one each time the partition changes owner, and every write
that commits a result names the epoch its work was claimed under. The `handing_over` state, with its next owner and
deadline, is the [handover](#handover) in progress.

### One predicate {#one-predicate}
{verified: PartitionOwnershipSqlTests.IOwn_AnswersTheEpochForTheActiveOwner_AndNullForAnyoneElseAsync, PartitionOwnershipSqlTests.IOwn_APartitionHandingOver_IsOwnedByNobodyNewAsync, PartitionOwnershipSqlTests.IOwn_WorkWithoutAPartition_IsAnyonesAtEpochZeroAsync, PartitionOwnershipSqlTests.IOwn_APartitionNumberPastTheTable_IsOwnedThroughItsRemainderAsync, OwnershipByMapClaimSqlTests.PartitionsIOwn_IsWhIOwnsAnswerForEveryPartitionAsync, ClaimPathsDecideThroughTheOwnershipTableGuardTests.TheGuard_FlagsABypassAndAnUnguardedRank_AndPassesTheSanctionedFormsAsync}

`wh_i_own(partition, instance)` answers "may this instance claim this partition": the epoch of its ownership when it
owns the partition and the partition is `active`, `NULL` otherwise. Work with no partition (no stream) is anyone's, at
epoch 0, and a partition number past the table is owned through its remainder. It is one primary-key probe.
`wh_partitions_i_own(instance)` is its set form, for a claim that tests a window of rows: the partitions the instance
owns and may claim, read once through an index on `(owner, partition)` of the active rows and tested by hash
membership, because a probe per row of a window of thousands cost the inbox acquisition five times its time. A guard
test fails when a claim function does not decide through `wh_i_own`, or ranks instances anywhere but in the legacy
branch.

A partition handing over is owned by nobody new until its flip, so neither side claims it.

### Map validity {#map-validity}
{verified: PartitionOwnershipSqlTests.MapIsValid_WhileItsLeaseRunsAsync, PartitionOwnershipSqlTests.MapIsValid_PastItsLease_WhileEveryMemberIsLiveAsync, PartitionOwnershipSqlTests.MapIsNotValid_PastItsLease_OnceAMemberIsNotLiveAsync, PartitionOwnershipSqlTests.MapIsNotValid_WhenNoneIsPublishedAsync, OwnershipByMapClaimSqlTests.AnAssignerLapse_DoesNotStallClaims_WhileTheMapsMembersAreLiveAsync}

With the switch on, a claim uses the published map only while `wh_partition_map_is_valid()` says so: a map is
published, and its lease runs **or** every one of its members is live by [the liveness rule](/v1.0.0/fundamentals/workers/instance-liveness#liveness-rule).
So an assigner that lapses never stalls claims while the map's members are live, and a map known to name a dead member
past its lease waits for the next assigner. Validity is judged on the database's clock alone; no host clock decides it.
The lease is tested first, so while the assigner renews its map the liveness rule (which reads `pg_locks`) is never
consulted.

### The per-service switch {#ownership-switch}
{verified: PartitionOwnershipSqlTests.Mode_IsOffUntilTheSwitchIsWrittenAsync, PartitionOwnershipSqlTests.Switch_StaysOffWhileALiveInstanceDoesNotSupportTheMode_AndTurnsOnOnceEveryLiveOneDoesAsync, PartitionOwnershipSqlTests.Switch_AStaleInstanceThatDoesNotSupportTheMode_DoesNotHoldItOffAsync, PartitionOwnershipSqlTests.Switch_WithNoMapPublished_StaysOffAsync, PartitionOwnershipSqlTests.Switch_ByADeposedAssigner_IsRefusedAsync, PartitionOwnershipSqlTests.Switch_OnceOn_StaysOn_WhenAnInstanceThatDoesNotSupportItJoinsAsync, PartitionOwnershipSqlTests.Candidates_InMapMode_LeaveOutAnInstanceThatDoesNotSupportTheMode_AndOffIncludeItAsync, PartitionOwnershipSqlTests.Supports_ReadsTheLevelTheHeartbeatRecords_AndNothingElseAsync, PartitionAssignerWorkerTests.Tick_WithOwnershipByMapOff_NeverAsksForTheSwitchAsync, PartitionAssignerWorkerTests.Tick_WithOwnershipByMapOn_AsksForTheSwitchAfterPublishing_AtItsEpochAsync, PartitionAssignerWorkerTests.Tick_WhileTheSwitchStaysOff_AsksAgainOnTheNextTickAsync, PartitionAssignerWorkerTests.Tick_OnceTheSwitchIsOn_DoesNotAskAgainAsync, HeartbeatRequestStoredFormLevelTests.PartitionOwnershipLevel_IsOne_TheLevelThatSupportsOwnershipByMapAsync}

The mode is one row in the service's own `wh_settings` (`partition_ownership_mode` = `map`), read by
`wh_partition_ownership_by_map()`. A service's instances share one schema and one map, so the switch is scoped to them,
and services that share no schema switch on their own schedules.

- **Every instance says whether it supports the mode.** Each heartbeat records `partition_ownership_level` (1 for this
  release) in the instance's registry metadata (`wh_service_instances.metadata`). An earlier release records none.
  `wh_supports_ownership_by_map(metadata)` is the one reading of that marker, shared by the switch, the publish and the
  candidates, so the three never disagree about an instance.
- **The assigner turns it on, and only when asked to.** With `PartitionAssignerOptions.OwnershipByMap` set, after each
  publish the assigner calls `wh_open_partition_ownership_by_map` under its role epoch. The switch turns on once a map
  is published at that epoch and **every live instance** of the service supports the mode; otherwise the call answers
  `closed (<n> of <m> live instances support ownership by map)` and the assigner asks again on its next tick. A stale
  instance does not hold it off. A deposed assigner is refused, which ends its tenure.
- **It is one-way.** Once on it is never cleared. An instance that does not support the mode is then no assignment
  candidate, so a publish gives it no partition, and an earlier release that joins afterwards owns nothing and claims
  nothing.
- **It is asked for by default.** `OwnershipByMap` defaults to `true`
  ([#2557](https://github.com/whizbang-lib/whizbang/issues/2557)), now that [handover](#handover) and
  [fencing](#fencing) make moving a busy partition safe, and binds from
  `Whizbang:Database:PartitionAssigner:OwnershipByMap`. The default still waits for every live instance to support the
  mode. Setting it to `false` keeps the stored-owner rules for a service whose switch is still off; it only stops the
  assigner asking, so a switch that is already on stays on.
  {verified: PartitionAssignerWorkerTests.Options_OwnershipByMap_DefaultsOn_AndTheDefaultStillWaitsForEveryInstanceAsync, PartitionAssignerWorkerTests.Tick_WithOwnershipByMapOff_NeverAsksForTheSwitchAsync, PartitionAssignerRegistrationTests.AddWhizbangPostgresNotifications_BindsEveryAssignerKeyFromConfigurationAsync}

The assigner logs `Ownership by map is on for this service (<answer>)` at Information (EventId 8) once it sees the
switch on, and `Ownership by map stays off for now: <reason>` at Debug (EventId 9) while it does not.

```json{title="Keep the stored-owner rules" description="Opt a service out of ownership by map before its switch turns on; a switch already on stays on" category="Configuration" difficulty="ADVANCED" tags=["Work coordinator", "Partition assignment", "Ownership by map"] tests=["PartitionAssignerRegistrationTests.AddWhizbangPostgresNotifications_BindsEveryAssignerKeyFromConfigurationAsync", "PartitionAssignerWorkerTests.Tick_WithOwnershipByMapOff_NeverAsksForTheSwitchAsync"]}
{
  "Whizbang": {
    "Database": {
      "PartitionAssigner": {
        "OwnershipByMap": false
      }
    }
  }
}
```

### What each mode does {#ownership-modes}

| | Off | On (the default) |
|---|---|---|
| Who may claim a stream's work | The stream's stored owner while it is live; otherwise the instance whose share of the published map (or, with no current assignment, its own ranking) holds the partition | The partition's owner in `wh_partition_ownership`, through `wh_i_own`, and nobody else |
| A live stored owner | Blocks every other instance, so a rebalance moves only idle streams | Blocks nobody; a stream follows its partition at the next publish |
| Storing outbox or inbox work | The first writer is recorded as the stream's owner | The stream is recorded in the ledger with its partition, and no owner |
| A new perspective row | Leased to the stream's stored owner or to the instance storing it | Leased to the instance storing it only when it owns the partition; otherwise left unleased for the owner |
| No current assignment | The claimer ranks itself among the live, eligible instances | The claimer claims nothing and waits ([map validity](#map-validity)) |
| Inbox stealing | After two empty claims, from unowned rows of any partition | Never |
| Outbox continuation, due schedules | The stream's stored owner | The owner of the stream's partition |
| The event fetch, multi-stream claims | As before: a live stored owner wins, otherwise the partition's holder | The partition's owner only |
| The wake-up notification | The [map's owner](#wake-up-routing) of each stream no instance holds | The map's owner of each stream's partition |

{verified: OwnershipByMapClaimSqlTests.SwitchOff_TheStoredOwnerKeepsItsStream_AsBeforeAsync, OwnershipByMapClaimSqlTests.Perspective_TheMapMovesThePartition_TheNewOwnerClaimsTheStream_AndTheStoredOwnerNothingAsync, OwnershipByMapClaimSqlTests.Outbox_TheMapMovesThePartition_TheNewOwnerClaimsTheStream_AndTheStoredOwnerNothingAsync, OwnershipByMapClaimSqlTests.Inbox_TheMapMovesThePartition_TheNewOwnerClaimsTheStream_AndTheStoredOwnerNothingAsync, OwnershipByMapClaimSqlTests.Inbox_StealingNeverTakesAPartitionThisInstanceDoesNotOwnAsync, OwnershipByMapClaimSqlTests.Inbox_AnExpiredLeaseOnAPartitionThatMovedAway_IsNotRenewedByItsHolderAsync, OwnershipByMapClaimSqlTests.Fetch_TheNewOwnerFetchesTheStream_AndTheStoredOwnerNothingAsync, OwnershipByMapClaimSqlTests.MultiStream_TheNewOwnerClaimsTheStream_AndTheStoredOwnerNothingAsync, OwnershipByMapClaimSqlTests.Continuation_ContinuesOnlyAStreamOnAPartitionThisInstanceOwnsAsync, OwnershipByMapClaimSqlTests.Schedules_FireOnThePartitionsOwner_NotTheStoredOwnerAsync, OwnershipByMapClaimSqlTests.APartitionHandingOver_IsClaimedByNeitherSideAsync, OwnershipByMapStoreSqlTests.StoreOutbox_InMapMode_RecordsTheStreamWithoutAnOwnerAsync, OwnershipByMapStoreSqlTests.StoreInbox_InMapMode_RecordsTheStreamWithoutAnOwnerAsync, OwnershipByMapStoreSqlTests.StoreOutbox_SwitchOff_PinsTheFirstWriter_AsBeforeAsync, OwnershipByMapStoreSqlTests.StorePerspectiveEvents_InMapMode_LeasesToTheCallerOnlyOnAPartitionItOwnsAsync, OwnershipByMapStoreSqlTests.EmitChain_InMapMode_LeasesByPartition_NeverToTheStoredOwnerAsync}

**The stream ledger in map mode.** `wh_active_streams` stays, as an activity ledger rather than an authority: the claim's
ledger pass names the instance that claimed the stream, which is its partition's owner, and keeps the stream's lease
and last activity for cleanup and activity tracking. Nothing reads its owner to decide who may claim.
{verified: OwnershipByMapClaimSqlTests.Ledger_TheNewOwnersClaimNamesItAsync}

Per-row leases (`instance_id`, `lease_expiry` on the work rows) stay in both modes. They recover work from a crash inside
one owner's tenure; they do not decide ownership.

**Cost.** The switch is one primary-key read of `wh_settings` per call. Under `claim_work`'s
`plan_cache_mode = force_custom_plan` it is a constant at plan time, so the branch not taken is planned away; a direct
caller of an acquisition plans both and runs one.

### Wake-up routing follows the map {#wake-up-routing}
{verified: PartitionMapClaimSqlTests.WakeUp_WithTheSwitchOff_RingsTheMapsOwnerOfTheStreamsPartition_NotTheLiveResidueAsync, PartitionMapClaimSqlTests.WakeUp_WithTheSwitchOff_AndNoMapPublished_RingsTheLiveResidueAsync, PartitionMapClaimSqlTests.WakeUp_WithTheSwitchOff_AMapOwnerThatIsNotLive_FallsBackToTheLiveResidueAsync, OwnershipByMapClaimSqlTests.WakeUp_RingsThePartitionsOwner_NotTheStoredOwnerAsync, OwnershipByMapClaimSqlTests.WakeUp_ForAStreamTheLedgerNeverHeld_RingsTheOwnerOfItsComputedPartitionAsync, ClaimPathsDecideThroughTheOwnershipTableGuardTests.TheWakeUp_RoutesByTheOwnershipTableInMapModeAsync}

The wake-up notification (`notify_instance_owners_with_payload`) rings the instance the map names, with the switch off
as well:

- **Off.** A stream an instance holds rings its holder, as before. A stream no instance holds rings its partition's
  owner in the published map while that owner is live, and the live instances' residue only when the map names no live
  owner (or no map is published).
- **On.** Every stream rings the owner of its partition by the map, for every kind, a stream the ledger never held
  included (its partition is computed from its id).

Before, an unheld stream rang the live instances' residue, which after any rebalance was usually not the instance whose
share held the partition.

## Fencing {#fencing}
{verified: OwnershipFencingSqlTests.HeldEpoch_IsTheOwnersEpochInEitherState_AndMinusOneForAnyoneElseAsync, OwnershipFencingSqlTests.EpochIsCurrent_OnlyForThePartitionsCurrentEpoch_AndAlwaysForAWriteThatNamesNoneAsync, OwnershipFencingSqlTests.Flush_AnOutboxCompletionUnderAStaleEpoch_AffectsNoRow_AndIsReportedFencedAsync, OwnershipFencingSqlTests.Flush_AnOutboxCompletionUnderTheCurrentEpoch_CompletesAsBeforeAsync, OwnershipFencingSqlTests.Flush_APerspectiveEventCompletionUnderAStaleEpoch_AffectsNoRowAsync, OwnershipFencingSqlTests.Flush_ACursorAdvanceUnderAStaleEpoch_LeavesTheCursorAsItWasAsync, OwnershipFencingSqlTests.Flush_AFailureUnderAStaleEpoch_IsNotRecordedAsync, OwnershipFencingSqlTests.ReportedFailure_UnderAStaleEpoch_IsNotRecorded_AndOneThatNamesNoEpochIsAsync, OwnershipFencingSqlTests.PublishMark_UnderAStaleEpoch_AffectsNoRowAsync, OwnershipFencingSqlTests.CompletePerspective_UnderAStaleEpoch_AffectsNoRowAsync, OwnershipFencingSqlTests.HandlerCommit_UnderAStaleEpoch_CommitsNothing_NeitherTheCompletionNorWhatTheHandlerEmittedAsync, OwnershipFencingSqlTests.HandlerBatch_AStaleItemIsReturnedFenced_AndTheRestCommitAsync, OwnershipFencingSqlTests.SwitchOff_AnEpochIsIgnored_AndTheWriteLandsAsBeforeAsync, OwnershipFencingSqlTests.MapMode_AWriteThatNamesNoEpoch_LandsAsBeforeAsync}

A partition's ownership row carries an **epoch**, which rises by one each time the partition changes owner. With
ownership by map on ([#2556](https://github.com/whizbang-lib/whizbang/issues/2556)), a write made by an instance that
no longer owns the partition at the epoch its work was claimed under lands nowhere:

1. **A claim reads the epoch.** In its own statement, a claim reads the epoch at which the claimer holds each claimed
   stream's partition (`wh_held_epoch`) and returns it with the batch (`WorkBatch.StreamEpochs`,
   `WorkBatch.StreamPartitions`).
2. **The process ledger remembers it.** The work coordinator records each claim's tenures, and each piece of work it
   fetches, in one ledger per process (`PartitionTenures`). A piece of work keeps the epoch it was fetched under, even
   after its stream is claimed again. No worker carries an epoch.
3. **Every write names it.** When a write commits a result, the coordinator fills in the epoch the ledger recorded for
   that work, and the SQL checks it in the same statement (`wh_epoch_is_current`). A write whose epoch is no longer its
   partition's changes no row, and the work stays for the partition's current owner, who replays it from the stored
   state.

| Write | Where it is checked | `kind` when fenced |
|---|---|---|
| An outbox completion, and an outbox publish mark | `flush_completions`, `wh_complete_outbox_published_fenced` | `outbox_completion` |
| A perspective work completion | `complete_perspective` | `perspective_event_completion` |
| A perspective cursor advance | `complete_perspective` | `perspective_cursor` |
| A failure, in a flush or reported on its own (migration 572) | `flush_completions`, `wh_report_failures_fenced` | `<category>_failure`, such as `outbox_failure` |
| A handler commit (the inbox completion and everything the handler emitted) | `commit_handler_result`, `commit_handler_batch` | `handler_commit` |
| A perspective row | the set-based and write-behind sink, and the per-pair upsert | `perspective_write` |

**A fenced write is never silent.** The coordinator counts it on
[`whizbang.work_coordinator.fenced_writes`](/v1.0.0/operations/observability/metrics#work-coordinator-ownership),
tagged `kind`, and logs `Fenced {Count} {Kind} write(s) in {Operation}` at Debug. A fenced handler commit is returned
as `HandlerBatchResult.Fenced`, not as a failure, so it is neither retried nor dead-lettered. Both PostgreSQL drivers
report alike.
{verified: CoordinatorOwnershipNoticesTests.AFencedWrite_IsCountedByKind_AndLoggedAsync, CoordinatorOwnershipNoticesTests.AFencedPerspectiveCompletion_IsCountedAsync, CoordinatorOwnershipNoticesTests.AFencedFlush_IsCountedAsync, CoordinatorOwnershipNoticesTests.AHandlerCommitUnderAStaleEpoch_IsReportedFenced_NotFailedAsync, DapperOwnershipNoticesTests.AFencedWrite_IsCountedByKind_AndAFencedHandlerCommitIsNotAFailureAsync}

**A write holds its epoch until it commits.** A check made before a write leaves a gap: a flip that commits between
the check and the write (the deadline takeover of a stuck owner, the one case fencing is for) would let the stale write
land. So in map mode a write holds its partition's ownership row **`FOR KEY SHARE` at the claimed epoch, inside the
write statement itself** (`wh_hold_partition_epoch(partition, epoch)`, migration 577 for perspective writes and 580 for
the coordinator's fences, held `FOR KEY SHARE` since migration 610). The epoch is a key column (a unique index on
`(partition_number, epoch)`), so only a change of the epoch conflicts with the hold: a flip, which raises it, cannot
lock the row while the write is open and skips the partition until a later pass (see [Write order](#write-order)),
so a flip can never commit while the write is open. A handover, a cancel and a redirect keep the epoch, so they never
wait for the write, and the writes made at that epoch still land. A flip that committed first is seen when the lock
re-reads the row, and the write raises SQLSTATE `WHF02` and lands nowhere. The cost is one primary-key probe and one
row lock of `wh_partition_ownership` per row written, in map mode only.
{verified: PerspectiveWriteHoldSqlTests.TheCurrentEpoch_IsHeldUntilTheWriteCommits_SoAFlipWaitsAsync, PerspectiveWriteHoldSqlTests.AnEpochThatMovedOn_RaisesTheFenceAsync, PerspectiveWriteHoldSqlTests.AWriteThatNamesNoEpoch_HoldsNothingAsync, PerspectiveWriteHoldSqlTests.TheHeldStream_IsTheStreamsIdAsync, PerspectiveWritesAreFencedTests.TheSink_AgainstAFlipThatCommitsWhileItWrites_WaitsForIt_AndIsFencedAsync, PerspectiveWritesAreFencedTests.ThePerPairUpsert_AgainstAFlipThatCommitsWhileItWrites_WaitsForIt_AndThrowsAsync}

**Perspective rows are fenced too.** Every form of perspective write carries the hold in its own statement: an insert
or upsert names its row through `wh_held_stream(id, partition, epoch)`, and an update or purge carries the call as a
predicate of the rows it touches; the Entity Framework write holds the partition first, in its transaction. The
set-based and write-behind sink isolates a row that raised `WHF02`, reports it `PerspectiveWriteStatus.Fenced`, and
writes the rest of the batch. The per-pair upsert and the per-pair checked update throw
`PartitionOwnershipLostException`. A [write-behind](../perspectives/write-modes#write-behind-flush) model whose flush
is fenced is dropped, never written.
{verified: PerspectiveWritesAreFencedTests.TheSink_FencesAWriteWhosePartitionMoved_AndWritesTheRestAsync, PerspectiveWritesAreFencedTests.TheSink_WhenEveryWriteIsCurrent_WritesThemAllAsync, PerspectiveWritesAreFencedTests.ThePerPairUpsert_OfAStreamWhosePartitionMoved_ThrowsBeforeWritingAsync, PerspectiveWritesAreFencedTests.EveryWriteForm_IsFencedInItsStatement_AndAStreamWithNoWorkInTheSameStatementIsWrittenAsync, PerspectiveWritesAreFencedTests.ThePerPairCheckedUpdate_OfAStreamWhosePartitionMoved_ThrowsAsync, PerspectiveWritesAreFencedTests.TheEntityFrameworkWrite_HoldsThePartitionFirst_AndAStaleOwnerThrows_ACurrentOneWritesAsync, PerspectiveWritesAreFencedTests.TheEntityFrameworkWrite_InATransaction_HoldsThePartitionUntilItCommitsAsync, PerspectiveWorkerDrainModeTests.WriteBehind_AFencedFlush_DropsTheModel_AndCompletesNothingAsync}

**A perspective write is fenced by the work in flight on its stream.** Its tenure is that of the perspective work this
instance has fetched and not yet finished on the stream (`PartitionTenures.OfPerspectiveWrite`), not the stream's last
claim. Once that work ends, the stream has no write tenure: a later write that applies no claimed work, such as a
local rebuild, names no epoch and is written even if the partition has since moved. A stream with no tenure in the
ledger (written outside a claim) is written as before.
{verified: PartitionTenuresTests.AStreamsWriteTenure_IsItsPerspectiveWorkInFlight_AndEndsWithTheLastOfItAsync, PartitionTenuresTests.AClaimedStream_WithNoPerspectiveWorkFetched_HasNoWriteTenureAsync, PartitionTenuresTests.PerspectiveWorkDroppedPastCapacity_NoLongerHoldsItsStreamsWriteTenureAsync, PerspectiveWritesAreFencedTests.ALocalRebuild_AfterTheStreamsWorkEnded_IsWritten_ThoughItsPartitionMovedByDeadlineAsync, PerspectiveWritesAreFencedTests.AStreamWithNoTenure_IsWrittenAsBefore_EvenOnAContextWithoutAHostAsync}

**The ledger is the coordinator's, not the worker's.** Work fetched before the partition moved is fenced although the
worker that does it names no epoch: the coordinator reads the epoch from `PartitionTenures` and fills it in. A write
that already names one keeps it. The ledger forgets the partitions this instance hands over, and keeps two generations
of entries at most, so it is bounded.
{verified: PartitionTenuresTests.AClaimedStream_HasItsTenure_AndAWorkIdFetchedOnIt_HasTheSameAsync, PartitionTenuresTests.AWorkIdFetchedBeforeAReclaim_KeepsTheTenureItWasFetchedUnderAsync, PartitionTenuresTests.ForgottenPartitions_LoseTheirStreamsAndWork_ThroughTheirRemainder_AndOthersKeepTheirsAsync, PartitionTenuresTests.PastItsCapacity_TheLedgerKeepsTwoGenerations_AndDropsTheOldestAsync, TenureFillTests.Epochs_FillTheKnownWork_LeaveTheUnknownUnnamed_AndKeepWhatTheCallerNamedAsync, CoordinatorNamesTheClaimedEpochTests.AnOutboxCompletion_OfWorkFetchedBeforeThePartitionMoved_IsFencedAsync, CoordinatorNamesTheClaimedEpochTests.AHandlerCommit_OfAMessageFetchedBeforeThePartitionMoved_CommitsNothingAsync, CoordinatorNamesTheClaimedEpochTests.AFailure_OfWorkFetchedBeforeThePartitionMoved_IsNotRecordedAsync, DapperOwnershipNoticesTests.WorkFetchedBeforeThePartitionMoved_IsFencedThoughTheWorkerNamesNoEpochAsync}

**What is not fenced.** A write that names no epoch (an inline path, or a caller built before this release) lands as
before, and so does every write while the service's switch is off. The perspective row-version check stays: it
protects concurrent edits of one row, and the epoch protects ownership; they answer different questions. While a
partition hands over, its epoch stays the old owner's, so the batch it has in flight and the models it saves still
land; the flip raises the epoch, and only what the old owner writes after that is fenced.

**A claim with no valid map says so.** In map mode a claim that waits because no valid partition map is published
sets `WorkBatch.PartitionMapUnavailable`, is counted on `whizbang.work_coordinator.partition_map_unavailable`, and is
warned once per streak (`This instance claims nothing: the service owns partitions by map and no valid partition map
is published ...`), by both PostgreSQL drivers. The warning comes again only after a claim has found a map.
{verified: CoordinatorOwnershipNoticesTests.AClaimInMapMode_CarriesTheEpochOfEachStreamsPartitionAsync, CoordinatorOwnershipNoticesTests.AClaimWithTheSwitchOff_CarriesNoEpochAsync, CoordinatorOwnershipNoticesTests.AClaimWithNoValidMap_IsCounted_AndWarnedOncePerStreakAsync, DapperOwnershipNoticesTests.AClaimWithNoValidMap_IsCounted_AndWarnedOncePerStreakAsync}

**Upgrade.** `IWorkCoordinator` gains epoch-taking overloads of `CompleteOutboxPublishedAsync` and
`CompletePerspectiveAsync`, whose default implementations ignore the epochs, so a custom coordinator is unaffected.
`HandlerBatchResult` gains an optional `Fenced`.

## Handover {#handover}
{verified: PartitionHandoverSqlTests.Publish_InMapMode_AMovedPartitionWithALiveOwner_HandsOver_KeepingTheOwnerAndEpochAsync, PartitionHandoverSqlTests.Publish_InMapMode_TheDeadlineIsTheOneThePublishNamesAsync, PartitionHandoverSqlTests.Publish_InMapMode_AMovedPartitionWhoseOwnerIsNotLive_HandsOverWithAnImmediateDeadline_AndTheSweepFlipsItAsync, PartitionHandoverSqlTests.Publish_InMapMode_APartitionHandingOverWhoseOwnerIsNoLongerLive_IsDueAtOnceAsync, PartitionHandoverSqlTests.Publish_SwitchOff_MovesAPartitionAtOnce_AsBeforeAsync, PartitionHandoverSqlTests.Claims_APartitionHandingOver_IsClaimableByNeitherSide_UntilTheFlipAsync, PartitionHandoverSqlTests.Ack_FlipsToTheNextOwnerAtEpochPlusOne_AndReleasesTheOldOwnersUnstartedRowsAsync, PartitionHandoverSqlTests.Ack_UnderAStaleEpoch_OrByAnInstanceThatIsNotTheOwner_FlipsNothingAsync, PartitionHandoverSqlTests.Ack_OfAnActivePartition_FlipsNothingAsync, PartitionHandoverSqlTests.HandingOver_ListsWhatTheOldOwnerMustHandOver_AndNothingForAnyoneElseAsync, PartitionHandoverSqlTests.Order_TheNewOwnerTakesTheStreamAfterTheOldOwnersCompletedEvent_AndNotBeforeAsync}

In map mode, a partition is never moved under a running owner
([#2557](https://github.com/whizbang-lib/whizbang/issues/2557)). A publish that moves a partition away from a **live**
owner hands it over:

```mermaid{caption="Handing a partition over: nobody claims it while the old owner finishes, saves and acknowledges; the acknowledgement flips it to the next owner at a raised epoch. Past the deadline the assigner flips it instead." tests=["PartitionHandoverSqlTests.Publish_InMapMode_AMovedPartitionWithALiveOwner_HandsOver_KeepingTheOwnerAndEpochAsync", "PartitionHandoverSqlTests.Ack_FlipsToTheNextOwnerAtEpochPlusOne_AndReleasesTheOldOwnersUnstartedRowsAsync", "PartitionHandoverWorkerTests.HeldWorkOfAReadyPartition_IsSavedBeforeTheAcknowledgement_AndNoOtherAsync", "PartitionHandoverSqlTests.ExpiredHandover_PastTheDeadline_TheAssignerFlips_AndReleasesTheOldOwnersRowsWithoutRefundAsync"]}
sequenceDiagram
    autonumber
    participant A as Partition assigner
    participant T as wh_partition_ownership
    participant O as Old owner (PartitionHandoverWorker)
    participant N as Next owner
    A->>T: publish: handing_over, next owner, deadline (owner and epoch unchanged)
    Note over T: nobody claims the partition
    O->>T: which partitions am I handing over?
    O->>O: wait until none of its streams is being worked
    O->>O: save write-behind models (reason handover), let queued writes land
    O->>T: acknowledge at the old epoch
    T->>T: release unstarted rows; active, owner = next owner, epoch + 1
    N->>T: next claim sees the partition and replays from the stored state
    Note over A,T: past the deadline with no acknowledgement, the assigner flips it itself
```

1. **The assigner marks it.** The partition goes `handing_over`, with its next owner and a deadline
   (`HandoverDeadline`, default 30 seconds, judged on the database's clock). Its owner and epoch stay the old owner's.
   In map mode a publish never raises an epoch: a partition leaving an owner that is not live becomes a handover with
   an immediate deadline, which the deadline sweep completes in the same assigner tick, after the publish
   has committed (a partition already handing over from an owner that is no longer live has its deadline brought
   forward). With the switch off a partition moves at once, as before.
2. **Nobody claims it.** `wh_i_own` answers only for an `active` partition, so neither the old owner nor the next one
   claims new work there until the flip.
3. **The old owner finishes.** Its `PartitionHandoverWorker` asks once a second which partitions it is handing over
   (`IWorkCoordinator.GetPartitionsHandingOverAsync`). It waits for a partition until none of its streams is being
   worked by the outbox, inbox or perspective drain; a partition whose batch is still in flight waits for a later pass,
   and the others go ahead.
4. **It saves what it holds.** Every participant saves what it holds for the partition's streams: the perspective
   worker flushes its [write-behind](../perspectives/write-modes#write-behind-flush) models there, with flush reason
   `handover`, and keeps the models of other partitions held. The worker then waits for its queued writes to land under
   the old epoch.
5. **It acknowledges.** `AcknowledgeHandoverAsync` releases the old owner's unstarted rows in the partition and flips
   it to `active`, owned by the next owner at epoch + 1, in one statement checked against the old epoch. An
   acknowledgement under a stale epoch, by an instance that is not the owner, or of an `active` partition, flips
   nothing. An acknowledgement can flip **part** of what it names: a partition a write holds at that moment is skipped
   (see [Write order](#write-order)), and the acknowledgement returns the partitions it flipped. The rest stay handing
   over, and the worker asks for them again on its next pass, a second later, until they move.
6. **The next owner takes over.** Its next claim sees the partition and works its streams from the stored state, so a
   stream's next event is taken only after the old owner's last one completed.

{verified: PartitionHandoverWorkerTests.NothingHandingOver_AcknowledgesNothingAsync, PartitionHandoverWorkerTests.NothingHandingOver_ResolvesNoParticipantAsync, PartitionHandoverWorkerTests.APartitionWithAStreamInFlight_Waits_AndTheOthersAreAcknowledgedAsync, PartitionHandoverWorkerTests.HeldWorkOfAReadyPartition_IsSavedBeforeTheAcknowledgement_AndNoOtherAsync, PartitionHandoverWorkerTests.TheQueuedWritesLand_BeforeTheAcknowledgementAsync, PartitionHandoverWorkerTests.DrainChannels_ReportTheStreamsTheirDrainsAreWorkingAsync, PerspectiveWorkerDrainModeTests.WriteBehind_AHandover_SavesTheModelsOfTheMovedStreams_AndKeepsTheOthersHeldAsync, PartitionHandoverWorkerLoopTests.AFailedPass_IsRetriedOnTheNextInterval_AndThenHandsOverAsync, PartitionHandoverWorkerLoopTests.AnAcknowledgementThatFlipsPartOfWhatItNamed_IsReAskedOnTheNextInterval_UntilTheRestMoveAsync, CoordinatorNamesTheClaimedEpochTests.TheCoordinator_ListsWhatThisInstanceHandsOver_AndAcknowledgesItAsync, DapperOwnershipNoticesTests.TheCoordinator_ListsWhatThisInstanceHandsOver_AndAcknowledgesItAsync}

**Past the deadline, the assigner completes it.** An old owner that is stuck, or cut off from the database, never
acknowledges. On each tick in map mode the assigner completes every handover past its deadline itself
(`IPartitionAssignmentStore.CompleteExpiredHandoversAsync`, under its role epoch, so a deposed assigner is refused): it
flips the partition to the next owner at epoch + 1 and releases what the old owner held, without refunding the attempts
those rows were charged. Like the acknowledgement, the sweep skips a partition a write holds at that moment and picks
it up on a later tick. The old owner's late writes are then [fenced](#fencing), and its held models dropped, not
written.
{verified: PartitionHandoverSqlTests.ExpiredHandover_PastTheDeadline_TheAssignerFlips_AndReleasesTheOldOwnersRowsWithoutRefundAsync, PartitionHandoverSqlTests.ExpiredHandover_BeforeTheDeadline_FlipsNothingAsync, PartitionHandoverSqlTests.ExpiredHandover_ByADeposedAssigner_IsRefusedAsync, PartitionAssignerWorkerTests.Tick_InMapMode_CompletesTheHandoversPastTheirDeadline_AtItsEpochAsync, PartitionAssignerWorkerTests.Tick_BeforeMapMode_NeverCompletesAHandoverAsync, PartitionAssignerWorkerTests.Tick_PublishesWithTheConfiguredHandoverDeadlineAsync, PartitionAssignerWorkerTests.Options_HandoverDeadline_DefaultsToThirtySeconds_AndANonPositiveOneIsRefusedAsync, PartitionEpochKeySqlTests.TheDeadlineSweep_AgainstAWriterHoldingOnePartition_FlipsTheOtherWithoutWaiting_AndTheHeldOneOnTheNextTickAsync}

**A republish can change its mind.** A map that gives the partition back to its old owner while it hands over cancels
the handover; one that names another next owner redirects it. A lease renewal keeps the old owner's row while the
partition hands over, and stops renewing it once the partition has moved, so a renewal can never keep work on a
partition the instance no longer owns.
{verified: PartitionHandoverSqlTests.Republish_GivingAPartitionBackToItsOwnerWhileHandingOver_CancelsTheHandoverAsync, PartitionHandoverSqlTests.Republish_NamingAnotherNextOwnerWhileHandingOver_RedirectsTheHandoverAsync, PartitionHandoverSqlTests.Renewal_KeepsARowWhileHandingOver_ButNotOnceThePartitionHasMovedAsync, PartitionHandoverSqlTests.Renewal_SwitchOff_RenewsAsBeforeAsync}

**How long a partition is unclaimed.** One in-flight batch plus one flush in the normal case, and the deadline in the
worst. That window is what keeps a stream's events in order and its writer single while it moves.

**Upgrade.** An implementation of `IPartitionAssignmentStore` takes the handover deadline in `PublishAsync` and
implements `CompleteExpiredHandoversAsync`. `IWorkCoordinator` gains `GetPartitionsHandingOverAsync`,
`AcknowledgeHandoverAsync` and `GetLeaveStatusAsync`, whose default implementations hand nothing over. Migration 571.

### Graceful leave {#graceful-leave}
{verified: PartitionHandoverWorkerLoopTests.Leaving_HandsOverUntilNothingIsOwned_ThenReturnsAsync, PartitionHandoverWorkerLoopTests.Leaving_BeforeTheHeartbeatsStartPoint_AsksTheDatabaseNothingAsync, PartitionHandoverWorkerLoopTests.Leaving_PastTheHeartbeatsStartPoint_ReadsWhatItOwnsAsync, PartitionHandoverWorkerLoopTests.Leaving_WithNoOtherLiveInstance_ReturnsAtOnceAsync, PartitionHandoverWorkerLoopTests.Leaving_GivesUpAfterTheHandoverDeadline_AndAStopEndsTheWaitAsync, CoordinatorNamesTheClaimedEpochTests.TheLeaveStatus_CountsWhatThisInstanceOwns_AndWhoElseCouldTakeItAsync}

A stopping instance hands its partitions over **before it deregisters**. The handover worker is one of the
[run-control path](/v1.0.0/resilience/managed-resource-run-control#halt-sequence)'s held-work releasers, so it runs
once the instance is draining (the assigner gives a draining instance no partition, so its next map moves them all)
and has finished the work in hand, and before the instance releases its roles and deregisters:

- **It hands over until it owns nothing.** Each interval it hands over what the assigner has moved, then asks again
  (`IWorkCoordinator.GetLeaveStatusAsync`), and returns once it owns no partition. A partition a write held when its
  acknowledgement ran is still owned, so it is asked for again on the next interval like any other.
- **It returns at once when nobody could take them.** With no other live instance, its partitions have nowhere to go,
  and waiting would only delay the stop.
- **It is skipped before the heartbeat's start point.** An instance that never reached Elect was never given a
  partition, so it asks the database nothing.
- **It gives up at the deadline.** After `HandoverDeadline` it logs `Leaving: {Owned} partition(s) still owned after
  {Budget}; deregistering, and the assigner completes their moves` at Warning and lets the stop go on; the assigner
  completes those moves past their own deadlines. The host's stop budget ends the wait too.

## Write order {#write-order}
{verified: MultiStreamWriteOrderSqlTests.Publish_AgainstACallerHoldingItsPartitionsOutOfOrder_NeverDeadlocks_AndHandsBothOverAsync, MultiStreamWriteOrderSqlTests.Acknowledgement_AgainstACallerHoldingItsPartitionsOutOfOrder_NeverDeadlocks_AndFlipsWhatIsFreeAsync, MultiStreamWriteOrderSqlTests.DeadlineSweep_AgainstACallerHoldingItsPartitionsOutOfOrder_NeverDeadlocks_AndFlipsWhatIsFreeAsync, PartitionEpochKeySqlTests.TheEpoch_IsAKeyColumn_ThroughAUniqueIndexOnPartitionAndEpochAsync, PartitionEpochKeySqlTests.AHold_LetsAChangeThatKeepsTheEpochThrough_AndMakesAnEpochChangeWaitAsync, PartitionEpochKeySqlTests.NoInstalledFunction_HoldsAnOwnershipRowForShare_AndEveryWriterHoldsItForKeyShareAsync, PartitionEpochKeySqlTests.APublishInMapMode_AgainstAWriter_HandsOverRedirectsAndCancelsWithoutWaiting_AndKeepsTheEpochAsync, FlipLockOrderSqlTests.AnAcknowledgement_AgainstAWriterHoldingTheEarlierPartition_FlipsTheOtherWithoutWaiting_AndTheHeldOneWhenReAskedAsync}

A caller may write streams in **any order** inside its own transaction (a handler that saves several perspective rows,
or an application transaction that appends to several streams) and never deadlocks with the framework
([#2577](https://github.com/whizbang-lib/whizbang/issues/2577), migration 610). Every transaction the framework opens
takes its partitions in partition order, but a caller's transaction takes them in the order it writes them, which the
framework cannot know. A flip that waited on one partition while holding another could close a cycle with such a
caller. Three rules remove the cycle by construction:

1. **The epoch is a key.** `wh_partition_ownership` has a unique index on `(partition_number, epoch)`, and every writer
   holds its partition `FOR KEY SHARE`. Only a change of the epoch conflicts with that hold.
2. **What keeps the epoch never waits.** A handover, a cancel and a redirect change the partition's state and next
   owner but keep its epoch, so they pass a writer's hold without waiting. In map mode a publish never raises an epoch
   (a partition leaving an owner that is not live becomes a handover with an immediate deadline), so a publish never
   waits on a writer either.
3. **What raises the epoch never waits while holding a partition.** The flips (the acknowledgement and the deadline
   sweep) lock their rows `FOR UPDATE SKIP LOCKED` in partition order and flip only the rows they locked. A partition
   a writer holds is skipped, stays handing over, and is flipped on a later pass: the old owner's handover worker asks
   again each second, and the sweep picks it up on a later assigner tick.

```mermaid{caption="What a writer's FOR KEY SHARE hold does to each ownership change: a change that keeps the epoch passes without waiting, and a flip that raises it skips the held partition and takes it on a later pass. Nothing waits on a writer while holding a partition, so no cycle can form." tests=["PartitionEpochKeySqlTests.AHold_LetsAChangeThatKeepsTheEpochThrough_AndMakesAnEpochChangeWaitAsync", "PartitionEpochKeySqlTests.APublishInMapMode_AgainstAWriter_HandsOverRedirectsAndCancelsWithoutWaiting_AndKeepsTheEpochAsync", "MultiStreamWriteOrderSqlTests.Acknowledgement_AgainstACallerHoldingItsPartitionsOutOfOrder_NeverDeadlocks_AndFlipsWhatIsFreeAsync", "MultiStreamWriteOrderSqlTests.DeadlineSweep_AgainstACallerHoldingItsPartitionsOutOfOrder_NeverDeadlocks_AndFlipsWhatIsFreeAsync"]}
flowchart LR
    W["Writer holds partition P<br/>FOR KEY SHARE at epoch E"]
    K["Handover, cancel, redirect<br/>(epoch stays E)"]
    F["Flip: acknowledgement, deadline sweep<br/>(epoch becomes E + 1)"]
    Pass["Proceeds at once, no wait"]
    Skip["Skips P (SKIP LOCKED), flips the rest"]
    Later["P flipped on a later pass,<br/>after the writer commits"]

    W --> K --> Pass
    W --> F --> Skip --> Later
```

| A writer holds the partition, and the framework... | Effect |
|---|---|
| publishes a map that hands it over, cancels a handover, or redirects one | no wait: the epoch is unchanged, so the hold does not conflict |
| acknowledges a handover of it | the acknowledgement skips it, flips what is free, and returns what it flipped; the worker asks again next pass |
| sweeps it past its deadline | the sweep skips it and flips it on a later assigner tick |

**Rolling deploy.** The function signatures are unchanged, so an instance on the previous release calls the same
functions and gets the new behavior. The one statement such an instance still writes itself, the set-based perspective
writer's hold, is `FOR SHARE`. The new flips skip it the same way, so ownership is never flipped under its write, but
it still blocks a publish's handover until it commits. Until every instance runs this release, a caller writing out of
partition order through an instance of the previous release can still meet a deadlock, which PostgreSQL resolves by
failing one side. Ownership is never corrupted either way.
{verified: PartitionEpochKeySqlTests.AWriterOnThePreviousRelease_HoldingForShare_IsNeverFlippedUnder_AndItsPartitionMovesOnceItCommitsAsync, PartitionEpochKeySqlTests.APublish_AgainstAWriterOnThePreviousRelease_WaitsForIt_ThenHandsOverKeepingTheEpochAsync, PartitionEpochKeySqlTests.ACallThePreviousReleaseMakes_StillResolvesAsync}

**Cost.** One more 10,000-row unique index on the 10,000-row ownership table, and a flip that raises the epoch is no
longer a HOT update. No claim path changes.

## Draining {#draining}

When an instance starts to drain (its lifecycle enters `Stopping`), it stops being eligible for work
at once, while its heartbeat is still fresh. It has already stopped claiming: `Stopping` is written by the
[run-control path](/v1.0.0/resilience/managed-resource-run-control#halt-sequence) after it closes the run permit, and
once the work in hand is finished the path releases the streams no drain has started and the instance's roles. The
rules below are how its peers see it, and how the claim treats an instance on an older release that keeps claiming
while it drains:

- **Its unclaimed share moves at once.** The next publish leaves it out of `Members`, and peers that
  rank themselves stop counting it on their next claim, so the partitions it would have claimed go to
  its peers without waiting for its heartbeat to lapse.
- **It still claims its own share until the assigner republishes.** Migration 300 refuses a claim from a caller whose
  row is not eligible, but keeps a draining caller claiming: under a published assignment its partitions stay its own
  until the next publish, and refusing it would leave them unclaimed for that window. The overlap with its peers is
  brief, and stream leases keep the work single.
  {verified: WorkEligibilitySqlTests.Claim_ADrainingCaller_StillClaimsItsShareAsync}
- **What happens to the streams it has already claimed depends on the [ownership mode](#ownership-modes).**
  - **Off.** A claim decides which instance owns a stream, and ownership is left alone: the draining
    instance keeps the streams it holds until it finishes them or their leases lapse. Handing a stream that is
    mid-flight to a peer would let two instances work it at once, out of order and twice. What it gives back is only
    what it has not started: once nothing is in hand, the run-control path
    [releases the streams of its last claim that no drain has begun](/v1.0.0/fundamentals/work-coordinator/claim-loop#release-on-halt),
    so the peer its partitions are now assigned to takes those over at once rather than after their leases lapse. The
    release clears each stream's stored owner, so a released stream follows the assignment, not the instance that held
    it.
  - **On (the default).** No stream is held by its stored owner, so every stream of the drained instance follows its
    partition at the next publish, which [hands each partition over](#handover) to its next owner: the drained
    instance finishes what it has in flight there, saves its write-behind models, releases the rest and acknowledges.
    Before it deregisters it waits for that to finish ([graceful leave](#graceful-leave)). A write it makes after a
    partition has moved on is [fenced](#fencing).

  A starting instance owns no streams to begin with, because an instance id is new for each process.

{verified: WorkEligibilitySqlTests.Candidates_ADrainingInstanceWithAFreshHeartbeat_IsLeftOutAtOnceAsync, WorkEligibilitySqlTests.Rank_ADrainingPeer_ItsShareMovesToTheCallerAtOnceAsync, AliveVersusEligibleE2ETests.ADrainingInstance_StopsBeingEligible_AndItsShareGoesToItsPeerAsync}

## Cost {#cost}

Claimers cache the assignment in memory (`PartitionAssignmentCache`). The assigner announces each
publish as a `PartitionAssignmentPublishedSignal` on the [signal bus](../signal-bus/signal-bus#coordination-signals),
carrying the version `epoch:revision`: `wh_publish_partition_assignment` calls the bus's SQL publish, which notifies
`wh_partition_assignment` (the channel and payload earlier releases use) and records the decision durably, so a claimer
that missed the notification is told by its tail. The cache hears it through the bus (`PartitionAssignmentCache.OnPublished`,
which replaces the earlier `OnNotification`) and owns no channel. A claimer that hears it, or
whose claim reports its copy stale, refreshes with one keyed read of a one-row table. A claim
presents only the version. Its fence is one read of a one-row table, and it replaces the claim's ranking
query instead of adding to it, so a claim with the assignment costs no more than one without.

| Behavior | Why | Verified by |
|---|---|---|
| A publish is announced on the bus, and the claimers' cache hears it there and presents the new version. | Only the bus owns `NOTIFY` and `LISTEN`; the cache subscribes to a typed signal like every other consumer. | {verified: PartitionAssignerWorkerPostgresTests.APublish_IsHeardByTheClaimersCache_WhichThenPresentsTheNewVersionAsync, PartitionAssignmentSqlTests.Publish_ByTheRoleHolder_WritesTheAssignmentAndAnnouncesItAsync} |
| An announced version the cache does not hold marks its copy stale, and the announcement is raised only once the copy is stale. | A claim made by a caller woken by the announcement must read the new version, not the copy it replaces. | {verified: PartitionAssignmentCacheTests.OnPublished_ForADifferentVersion_MarksTheCopyStaleAsync, PartitionAssignmentCacheTests.OnPublished_RaisesTheAnnouncementOnlyOnceTheCopyIsStaleAsync} |
| An announced version the cache already holds reads nothing, and still raises the announcement. | A decision can be heard twice (the notification, then the durable log's replay); the second is harmless. | {verified: PartitionAssignmentCacheTests.OnPublished_ForTheVersionAlreadyHeld_ReadsNothingAsync, PartitionAssignmentCacheTests.OnPublished_ForTheVersionAlreadyHeld_StillRaisesTheAnnouncementAsync} |

## Configuration

`PartitionAssignerOptions`:

| Option | Default | Meaning |
|---|---|---|
| `AssignmentLease` | 90 s | How long an assignment holds without renewal. Must exceed 60 s, the slow heartbeat cadence. |
| `RepublishInterval` | 5 min | The backstop: republish at least this often. |
| `SettleWindow` | 5 s | How long a membership change is collected before one map is published ([settle window](#settle-window)). `00:00:00` publishes every change at once; negative is refused. |
| `OwnershipByMap` | `true` | Ask for the service's [ownership-by-map switch](#ownership-switch) once every live instance supports it. One-way for the service: `false` stops the assigner asking, and a switch already on stays on. |
| `HandoverDeadline` | 30 s | How long a moved partition may [hand over](#handover) before the assigner completes the move itself, judged on the database's clock. Must be positive. |

Every option binds from `Whizbang:Database:PartitionAssigner`
([configuration reference](/v1.0.0/operations/configuration/configuration-reference#partition-assigner)); a key that is
absent or does not parse keeps the default, and a host's own `Configure<PartitionAssignerOptions>` still has the last
word.
{verified: PartitionAssignerRegistrationTests.AddWhizbangPostgresNotifications_BindsEveryAssignerKeyFromConfigurationAsync, PartitionAssignerRegistrationTests.AddWhizbangPostgresNotifications_WithNoAssignerKeys_KeepsTheDefaultsAsync, PartitionAssignerRegistrationTests.AddWhizbangPostgresNotifications_AHostsOwnConfigureOfTheAssigner_StillWinsAsync, PartitionAssignerWorkerTests.Tick_PublishesWithTheConfiguredHandoverDeadlineAsync, PartitionAssignerTests.SettleWindow_DefaultsToFiveSecondsAsync, PartitionAssignerTests.Validate_ANegativeSettleWindow_IsRefusedAsync, PartitionAssignerTests.Validate_AZeroSettleWindow_PassesAsync}

`Enabled` is removed ([#2559](https://github.com/whizbang-lib/whizbang/issues/2559)): the assigner always runs. A
configured `Whizbang:Database:PartitionAssigner:Enabled` is logged once at startup as a
[removed key](/v1.0.0/operations/configuration/configuration-reference#removed-keys) and changes nothing; it stops the
start only when unknown keys are set to throw. Code that set it deletes the assignment.
{verified: PartitionAssignerRegistrationTests.TheRemovedEnabledKey_SetToFalse_TurnsNothingOffAsync, UnknownConfigurationKeyCheckTests.Removed_WhizbangCoreDeclaresEveryFormerTableEntry_ThroughTheAttributeAsync}

`PooledHeartbeatWindow` and `DirectHeartbeatWindow` are removed ([#2027](https://github.com/whizbang-lib/whizbang/issues/2027)): liveness is [the liveness rule](/v1.0.0/fundamentals/workers/instance-liveness#liveness-rule), and an instance's window is the one it declares from its own heartbeat cadence. Code that set them deletes the assignment; `Validate` no longer checks them.
{verified: PartitionAssignerTests.Validate_TheDefaults_PassAsync, PartitionAssignerTests.IsLive_IsTheRulesAnswer_WhateverTheLockOrTheHeartbeatAsync}

```csharp{title="Tune the partition assigner" description="Shorten the backstop republish interval" category="Configuration" difficulty="INTERMEDIATE" tags=["Work coordinator", "Partition assignment", "Options"] tests=["PartitionAssignerTests.Validate_TheDefaults_PassAsync"]}
services.Configure<PartitionAssignerOptions>(options => {
  options.RepublishInterval = TimeSpan.FromMinutes(2);
});
```

## Signals

Every transition has a public event, for diagnostics and for tests that wait on the transition itself:

- `PartitionAssignerWorker`: `OnBecameAssigner`, `OnStoppedAssigning`, `OnEvaluated` (its reason is `Settling` while a
  change waits out the [settle window](#settle-window)), `OnPublished`.
- `PartitionAssignmentCache`: `OnPublishAnnounced`, `OnRefreshed`, `OnAssignmentChanged`.

The handover worker raises no event; it logs what each pass flipped (EventId 1, Information), a pass that failed
(EventId 2, Warning), and how a graceful leave ended (EventId 3, Information, and EventId 4, Warning, past its
deadline).

## Related

- [Claim loop](claim-loop.md)
- [Multi-instance coordination](/v1.0.0/messaging/multi-instance-coordination): stream ownership across scaling, in both modes.
- [Instance liveness](/v1.0.0/fundamentals/workers/instance-liveness#liveness-rule): the one liveness rule the candidates carry.
- [Alive versus eligible for work](/v1.0.0/fundamentals/workers/instance-liveness#alive-versus-eligible): the two tests side by side.
- [Notifications and pgbouncer](notifications-and-pgbouncer.md)
- [Commit sequence](commit-sequence.md): the commit-order stamper is elected the same way.
