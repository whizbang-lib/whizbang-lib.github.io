---
title: Capabilities and Duties
pageType: concept
verifiedAgainstCommit: 924d20f7
verifiedDate: 2026-10-22
version: 1.0.0
category: Startup
order: 2
description: >-
  The capability model behind fleet-exclusive startup work: every duty a role
  assignment won by a vote, with a lease and epoch fencing, takeover with no
  coordinator, the eviction fence, and the advisory locks that remain and why
  they are not duties
tags: >-
  capabilities, duties, election, role-assignment, lease, epoch, advisory-lock,
  migrator, maintainer, takeover, fencing, multi-instance, rolling-deploy
codeReferences:
  - src/Whizbang.Core/Startup/IDutyElector.cs
  - src/Whizbang.Data.Postgres/Notifications/PgRoleElector.cs
  - src/Whizbang.Data.Postgres/MigratorWatch.cs
  - src/Whizbang.Data.Postgres/SchemaBootstrapPhase.cs
  - src/Whizbang.Data.Postgres/Migrations/278_OneWriterOfTheInstancePhase.sql
  - src/Whizbang.Data.Postgres/Migrations/184_RoleAssignmentResilience.sql
  - src/Whizbang.Data.Postgres/Migrations/326_EveryDutyIsARoleAssignment.sql
  - src/Whizbang.Data.Postgres/AdvisoryLockProbe.cs
  - src/Whizbang.Data.Postgres/Schema/ManagedSchemaReconciler.cs
  - src/Whizbang.Data.Postgres/Migrations/108_InstanceCapabilities.sql
  - src/Whizbang.Core/Startup/IDutyAcquisitionHandler.cs
  - src/Whizbang.Core/Startup/DutyHolderWorker.cs
  - src/Whizbang.Core/Workers/WorkTableVacuumOnAcquisition.cs
  - src/Whizbang.Core/Startup/MaintainerDuty.cs
  - src/Whizbang.Core/RunControl/WhizbangRunPermit.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/WorkEligibilitySqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/InstanceTransitionSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/SchemaBootstrapPhaseTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/StartupWiringAuditTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/DutyElectionE2ETests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/TableRewriteJourneyE2ETests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/InstanceCapabilitiesSqlTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/StartupPipelineRunnerDutyTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Chaos/RoleAssignmentChaosTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Chaos/MaintainerAcquisitionVacuumTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/WorkTableVacuumTests.cs
  - tests/Whizbang.Core.Tests/Startup/MaintainerDutyTests.cs
  - tests/Whizbang.Core.Tests/Workers/IntegrityTimerWorkersOnTheMaintainerTests.cs
  - tests/Whizbang.Core.Tests/Workers/IntegrityDeliveryWorkerTests.cs
  - tests/Whizbang.Core.Tests/Workers/WorkTableVacuumOnAcquisitionTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/DutyHolderWorkerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/RoleAssignmentElectorE2ETests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/RoleAssignmentResilienceSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/RoleAssignmentResilienceE2ETests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/RoleAssignmentSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/SchemaInitializationConcurrencyTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/ManagedSchemaReconcilerPoolerTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/CoordinationSourceGuardTests.cs
---

# Capabilities and Duties

"Exactly one instance does this" appears throughout a multi-instance deployment: one instance migrates the schema, one runs the table rewrites. A **capability** names that idea: something an instance **holds**, acquired by winning it. Nothing declares in advance which instances may hold what: every instance attempts everything, and holding is a named, recorded fact rather than an implicit consequence of winning a race.

Capabilities come in two kinds, and [step exclusivity](startup-pipeline#the-step-contract) falls out of the distinction rather than being a separate property:

- **Exclusive capabilities** — held by one instance at a time. An exclusive capability is a **duty**: `migrator`, `maintainer`. Election decides which instance holds it.
- **Shared capabilities** — held by every instance at once, like the default `every-instance` capability a step gets when it declares nothing.

A step requiring a duty runs on one instance; a step requiring a shared capability runs on all of them. A step therefore cannot declare a contradiction — there is no way to claim fleet-exclusivity while requiring a capability every instance holds.

## The vote decides, the row reports {#the-lock-decides-the-row-reports}

Capability holdings are **recorded** in `wh_instance_capabilities`, but that record is not what grants a duty:

> An instance acquires a duty by voting for it, not by reading a table. The vote decides, and the assignment row it writes (`wh_role_assignments`, with a lease and an epoch) is the authority from then on. The capability record reports who holds what.

Treating the capability record as authoritative is what reintroduces orphaned state: a dead instance's row goes on claiming a capability until something reaps it. Treating it as *derived* state costs nothing and buys the questions that matter during an incident: *which instance is the migrator right now, how long has it been, is a duty currently unheld*, answered as a query, not a broadcast to instances that may not be answering. The [status surface's fleet section](startup-status) reads exactly this record.

Holdings live in their own table keyed by *(instance, capability)* rather than as a column on the instance row: an instance holds several at once, the relationship carries its own `acquired_at`, and capability writes stay off the heartbeat's write-suppression path. Reaping stays free — stale instances are genuinely deleted and the foreign key cascades.

## Election is not membership

These are two different problems and they use two different mechanisms:

| Concern | Mechanism | Why |
|---|---|---|
| **Election**: who performs a duty | A one-statement vote that assigns the duty as a row with an epoch and a lease ([role assignment](#role-assignment-the-default)) | Linearizable against the authority every instance already depends on, and decided entirely in the database |
| **Membership**: who is alive, what they hold | [The one liveness rule](../../fundamentals/workers/instance-liveness#liveness-rule) over the heartbeat and the instance-alive lock | Drives re-attempt prompts, observability, and the reap |

Liveness can end a tenure, never share one. The vote voids an assignment whose holder the rule had reaped or evicted, so a holder that died without releasing is replaced as soon as the rule calls it dead, not only when its lease runs out. A holder that is alive but was judged dead anyway (paused, partitioned) is not a second holder: its epoch is stale, and the database refuses its writes (`wh_assert_role_epoch`). Heartbeats and `InstanceDiedSignal` only *prompt re-attempts*; the vote grants or refuses.
{verified: DutyElectionE2ETests.DirtyDeath_JudgedByTheLivenessRule_HandsTheDutyOver_AndTheGrantKnowsItIsLostAsync, RoleAssignmentSqlTests.Elect_WhenTheHolderIsNoLongerRegistered_VoidsItAsUnregisteredAsync, RoleAssignmentElectorE2ETests.StaleHolder_AfterLosingTheRole_FailsVerification_AndTheDatabaseRefusesItsWriteAsync}

<a id="bootstrap-registration-records-migrating"></a>

### The bootstrap registration records a phase {#bootstrap-registration-records-a-phase}
{verified: WorkEligibilitySqlTests.BootstrapRegistration_RecordsTheInstanceAsConnecting_SoItIsNotACandidateAsync, InstanceTransitionSqlTests.Registration_RecordsThePhaseItRegistersIn_AndNeverOverwritesARecordedOneAsync}

An instance has to be registered before it can vote for a duty, so the schema bootstrap registers it as Preflight's
last step, before the migrator election. That registration also records the instance's lifecycle phase as
`Connecting`, Preflight's phase, and only where the row records none.

The phase matters because only an instance whose recorded phase is `AcceptingCommands` or `Running` is
[eligible for work](../../fundamentals/workers/instance-liveness#alive-versus-eligible), while a row that records no
phase reads as an older build, which is eligible whenever it is alive. In earlier releases the bootstrap row had no
phase, so a starting instance looked like an older build and was handed a share of the partitions for its whole
migration, a share nobody worked until it was ready.

**Why only where the row records none.** Since migration 278 the
[stage record is the only writer of the phase](startup-status#one-writer-of-the-phase): the instance-state
participant that used to write each lifecycle transition is gone, and every transition, a stand-by during the
[standby handshake](rolling-upgrades) included, reaches the row through the stage record. A registration that
overwrote the phase would be a second writer, so it fills the phase only where none is recorded, and the stage held
until the row existed is then written as the Preflight transition's one update. The registration writes through the
same recorder, `wh_record_instance_transition`, which is in the
[bootstrap closure](../infrastructure/migrations#what-the-closure-carries), so an empty database records the phase at
registration too.
{verified: SchemaBootstrapPhaseTests.AnEmptyDatabaseRecordsATransitionAtRegistrationAfterTheBootstrapAsync, StartupWiringAuditTests.RunControlPlane_RecordsTheInstanceRow_ThroughTheStageParticipantAlone_WithTheLibraryVersionAsync}

## Winning a duty

```csharp{title="The elector seam" description="Attempt acquisition: the vote grants, or refuses with a reason" category="Implementation" difficulty="INTERMEDIATE" tags=["Startup","Duties"] tests=["DutyElectionE2ETests.Contention_ExactlyOneWins_AndTheRowReportsTheLockHolderAsync","DutyElectionE2ETests.DirtyDeath_JudgedByTheLivenessRule_HandsTheDutyOver_AndTheGrantKnowsItIsLostAsync","StartupPipelineRunnerDutyTests.AwaitDutyStep_WhoseDutyIsNeverGrantable_FailsBoundedlyInsteadOfHangingAsync"]}
public interface IDutyElector {
  // Grants, or refuses WITH A REASON — losing the race is the only refusal worth retrying,
  // and a caller that cannot tell the reasons apart retries the unretryable forever.
  Task<DutyAttempt> TryAcquireAsync(string duty, CancellationToken ct);
}

public enum DutyRefusal {
  Contended,     // another instance holds it — retry; the holder's release frees it
  Unavailable,   // no coordination connection at all — a standing misconfiguration
  Refused,       // this instance is evicted/unregistered — needs an operator, not a retry
  Halted,        // this instance's run permit is closed (paused, standing down, stopping); wait for it to reopen, then vote again
}

public sealed record DutyAttempt {   // exactly one of Grant / Refusal is present
  public IDutyGrant? Grant { get; }
  public DutyRefusal? Refusal { get; }
  public string? Detail { get; }     // the human-readable diagnosis a log line should carry
}

public interface IDutyGrant : IAsyncDisposable {
  string Duty { get; }
  DateTimeOffset AcquiredAt { get; }

  // Fencing: confirms the grant is still held, renewing its lease when due. A long-tenure
  // holder calls this before each unit of exclusive work: a grant that lapsed or was taken
  // over is a grant another instance may already hold.
  Task<bool> VerifyStillHeldAsync(CancellationToken ct);

  long? Epoch => null;   // the fencing token exclusive writes present
}
```

The Postgres implementation, `PgRoleElector`, votes for the duty in one statement and holds it as a [role assignment](#role-assignment-the-default); no session stays open while the duty is held. Winning records the holding; a refusal carries its reason and the [pipeline](startup-pipeline) acts on it: `Skip` non-holders carry on; `Await` non-holders retry **only while the refusal is `Contended`**; an `Unavailable` or `Refused` duty fails the step immediately (a [`Halted`](#halted-refusal) one waits for the run permit to reopen), naming the duty and the elector's detail, because boot failing loudly beats boot hanging silently. While a legitimate contended wait persists, the runner narrates it through `IStartupStepObserver.OnStepWaitingAsync` on a backoff, so a long wait is a story in the logs rather than silence.

The **eviction fence reaches election**: an instance that has been [evicted](../../fundamentals/workers/instance-liveness#eviction-reaping-is-a-fence-not-just-a-deletion) is refused at acquisition, whoever holds the duty, and its renewal is refused too. That is what turns eviction from a request into a guarantee for exclusive work.
{verified: DutyElectionE2ETests.EvictedInstance_IsRefusedAtAcquisition_EvenWithTheLockFreeAsync, RoleAssignmentElectorE2ETests.EvictedInstance_IsRefused_NotContendedAsync, RoleAssignmentSqlTests.Renew_ByATombstonedHolder_IsRefusedAsync}

### A halted instance holds no role {#halted-refusal}

While the instance's [run permit](../../resilience/managed-resource-run-control#one-run-control-path) is closed (it is
paused, standing down or stopping), `PgRoleElector` refuses every vote as `DutyRefusal.Halted` without asking the
database, the batched vote included. The [run-control path](../../resilience/managed-resource-run-control#halt-sequence)
has already released the roles this instance held; the refusal keeps the holder loop, the partition assigner and the
commit-order stamper from winning one back in the meantime. A resume reopens the permit and the next vote is answered
as usual; a stop is final.
{verified: RoleAssignmentElectorE2ETests.WhileTheRunPermitIsClosed_EveryVoteIsRefusedAsHalted_UntilItReopensAsync}

**A halted refusal is waited out, not failed.** Unlike `Unavailable` and `Refused`, `Halted` ends when the permit
reopens, and the permit says when. So:

- **An awaited startup step** refused as `Halted` reports itself waiting once, before the wait (`IStartupStepObserver.OnStepWaitingAsync`),
  waits on the elector's run permit to reopen, and votes again. The run's cancellation (host shutdown) ends the wait. A
  permit that is stopped instead fails the step: the instance is stopping, so the step cannot run. An elector with no
  permit to wait on is retried like a contention.
- **The migrator election** waits the same way, logs the refusal at Information as halted (event id 8, `The migrator
  duty for schema {Schema} was refused because this instance is halted`) rather than as unavailable, and ends as
  canceled on a stopped permit. An elector with no permit is logged as halted and leaves the schema unstaged, as for
  any other refusal; the schema lock still guards.

{verified: StartupPipelineRunnerHaltedDutyTests.AnAwaitedStepRefusedAsHalted_NarratesTheWaitOnce_BeforeWaitingForThePermitAsync, StartupPipelineRunnerHaltedDutyTests.AnAwaitedStepThatIsNotHalted_IsNeverNarratedAsWaitingAsync, StartupPipelineRunnerHaltedDutyTests.AnAwaitedStepRefusedAsHalted_WaitsForThePermitToReopen_ThenRunsAsync, StartupPipelineRunnerHaltedDutyTests.AnAwaitedStepRefusedAsHalted_WhenThePermitIsStopped_FailsAsync, StartupPipelineRunnerHaltedDutyTests.AnAwaitedStepRefusedAsHalted_TheRunsCancellation_EndsTheWaitAsync, StartupPipelineRunnerHaltedDutyTests.AnAwaitedStepRefusedAsHalted_ByAnElectorWithNoPermit_IsRetriedLikeAContentionAsync, MigratorDutyStagingTests.AHaltedRefusal_WaitsForThePermitToReopen_ThenElectsAsync, MigratorDutyStagingTests.AHaltedRefusal_WhenThePermitIsStopped_EndsTheElectionAsCanceledAsync, MigratorDutyStagingTests.AHaltedRefusal_FromAnElectorWithNoPermit_IsLoggedAsHalted_AndUnstagedAsync}

**Why wait rather than fail.** A pause or a stand-down during startup is resumable. Failing the step would turn an
operator's pause into a startup that never completes, and polling would vote against a permit that cannot answer
differently until it reopens. Waiting on the permit's own signal resumes the step the moment it can succeed; a stop is
the one closed permit that never reopens, so only it fails the step.

**Why a refusal of its own.** `Contended` says another instance holds the duty, and `Refused` says this instance needs
an operator. A halted instance is neither: nobody else may hold the role, and nothing is wrong with the instance. It
has chosen to hold nothing until it resumes, and a reason of its own lets a log line say so.

### When the elector itself fails

A refusal is an *answer*. Separately, the question can fail to be asked at all: the elector reaches its vote over a network, so a read timeout there is neither a grant nor a refusal; it is the absence of a verdict, and it says nothing about whether the step should run.

Such a failure is **absorbed and retried**, exactly as a `Contended` refusal is, because it is the same class of blip every other worker rides out on its next tick. It is also **bounded**: after `MaxTransientDutyFailures` consecutive failures the step fails, naming the underlying exception. Both halves matter, and for the same reason — retrying a standing outage forever is the other way to be silently broken. A clean refusal in between resets the count, because it proves the elector is reachable and therefore that the earlier failures were blips rather than the leading edge of an outage.

What this deliberately does *not* do is stop the host. The startup pipeline runs as a `BackgroundService`, and .NET's default `HostOptions.BackgroundServiceExceptionBehavior` is `StopHost` — so an exception escaping the pipeline terminates the whole process. Worse, it terminates it *gracefully*: the process exits **zero** and writes an orderly shutdown log, making a host destroyed this way indistinguishable from one that was asked to stop. Nothing watching exit codes, restart reasons, or OOM kills can see it, so it can recur indefinitely while every crash signal stays clean.

Staying up is also the more informative outcome, and fail-closed is what makes it safe: a pipeline that never completes leaves the availability filter refusing writes, so the instance is up, [reports unready](startup-status), and carries the reason in its logs. `NonHolderBehavior.Skip` keeps its single non-blocking attempt throughout — a transient failure reports the step skipped with the elector's error as the reason, rather than quietly promoting it into a waiter.

## Every duty is a role assignment {#role-assignment-the-default}

With the Postgres driver every duty is held by **role assignment**: `maintainer`, `migrator`, the commit-order stamper's leadership (`commit-stamper`), the partition assigner's, and any duty a host names for its own steps. There is no other way to hold a duty, and no setting that turns it off. The vote is a single statement, and its transaction-scoped lock only serializes votes for the same role; it is released when the statement commits. From then on the duty is a row in `wh_role_assignments` with a holder, an **epoch** and a **lease** in database time. The holder's own work loop renews the lease through `VerifyStillHeldAsync`, so a holder that is stuck, paused or partitioned stops renewing and loses the duty after one lease, and exclusive work presents `(holder, epoch)` to the database (`wh_assert_role_epoch`), so a holder that lost the duty cannot write. The grant carries the epoch as `IDutyGrant.Epoch`.

`RoleAssignmentOptions.Roles` lists the duties the [holder loop](#the-holder-loop) holds and the `roles` health component reports. A duty not listed there is still held by assignment whenever something asks for it.

### Design choices {#role-assignment-design-choices}

| Choice | Reason | Verified |
|---|---|---|
| Every duty, a host's own included, is voted in the role table. No duty is held by a session advisory lock (#2044). | One way to hold a duty means one place that says who holds it, one fence and one takeover rule. A session lock needs a pinned direct connection for the whole tenure, cannot be taken from a holder that is alive but stuck, and is lost on every database restart. | {verified: RoleAssignmentElectorE2ETests.EveryDuty_IsHeldByAssignment_EvenOneTheHolderLoopDoesNotHoldAsync, DutyElectionE2ETests.TwoPipelines_RaceADutyStep_ExactlyOneInstanceRunsItAsync, CoordinationSourceGuardTests.NoDuty_IsHeldByAnAdvisoryLockAnywhereAsync} |
| Exclusive work presents `(holder, epoch)`, and a stale epoch is refused in SQL, in the writer's own transaction. | A holder that wakes after losing the duty cannot argue with a check the database runs. | {verified: RoleAssignmentSqlTests.AssertEpoch_WithAStaleEpoch_RaisesInSql_AndTheWriteBesideItRollsBackAsync, RoleAssignmentElectorE2ETests.StaleHolder_AfterLosingTheRole_FailsVerification_AndTheDatabaseRefusesItsWriteAsync} |
| A holder that dies without releasing is replaced once its lease lapses or [the one liveness rule](../../fundamentals/workers/instance-liveness#liveness-rule) has it reaped, about 30 seconds for a direct instance, not the moment its connection drops. | Nothing is held by a session, so there is nothing for the server to free. The rule is the one definition of dead every reader uses, and the lease bounds a holder that is alive but stuck. Earlier releases handed a host's own duty over the instant its session ended; a slower takeover is the cost of one mechanism with a fence. | {verified: DutyElectionE2ETests.DirtyDeath_JudgedByTheLivenessRule_HandsTheDutyOver_AndTheGrantKnowsItIsLostAsync, RoleAssignmentElectorE2ETests.CrashedHolder_VoidsAfterTheLapseBound_AndTheNextVoteTakesOverAsync, RoleAssignmentChaosTests.KillNine_TheHolderVanishes_AndTheNextHolderFinishesTheWorkOnceAsync} |
| A clean release hands the duty over at once and announces it as a `RoleReleasedSignal` on the [signal bus](../../fundamentals/signal-bus/signal-bus#coordination-signals) (channel `wh_role_released`, payload the role). | A release is not a health signal, so it carries no lapse wait and no cool-down. | {verified: RoleAssignmentElectorE2ETests.GracefulRelease_HandsOffAtOnce_WithNoLapseWaitAsync, RoleAssignmentSqlTests.Release_NotifiesWaiters_SoTheyReVoteAtOnceAsync} |
| The release is a decision, so it is recorded durably with the role and replayed to an instance that missed the notification. | A waiter that missed it would otherwise vote only on its next renew interval; a release that rolls back announces nothing. | {verified: RoleAssignmentSqlTests.Release_IsRecordedDurably_SoAnInstanceThatMissedTheNotificationIsStillToldAsync, CoordinationSignalsSqlTests.TheTail_ReplaysAMissedDecision_WithItsPayloadAsync, CoordinationSignalsSqlTests.PublishSignal_InsideATransactionThatRollsBack_LeavesNoTraceAsync} |
| The grant holds no connection. Each vote, renewal and release is one statement on any connection, a pooled one included. | A transaction pooler serves it, and a database restart does not cost the duty: the row survives, and the next renewal presents the same epoch. | {verified: RoleAssignmentElectorE2ETests.Assignment_SurvivesEveryConnectionBeingTerminated_WithTheSameEpochAsync, RoleAssignmentDatabaseRestartChaosTests.DatabaseRestart_TheAssignmentSurvives_AndTheHolderKeepsItsEpochAsync} |
| No role function reads an advisory lock. The lock reader is dropped (migration 326), and a legacy key or bridge session passed by an older caller is ignored. | A lock is a second answer to who holds a duty, and one a pooler can strand on the wrong backend. | {verified: RoleAssignmentResilienceSqlTests.TheAdvisoryLockReader_IsGoneAsync, RoleAssignmentResilienceSqlTests.Vote_IgnoresAnAdvisoryLockOnTheLegacyKey_AndRecordsNoBridgeSessionAsync, RoleAssignmentResilienceSqlTests.VoteRoles_TakesNoLegacyKeysAsync} |

A few more behaviors to know:

- **A newer release takes over cooperatively.** An instance on a newer library version asks an older holder to drain (`IDutyGrant.DrainRequested`); the holder finishes its current step and releases. A vacant duty goes to the newest version voting for it.
- **One long statement does not lose the duty.** Each duty may declare its own lease, and a holder that marks the backend running its statement (`PgRoleElector.MarkDutyBackendAsync`) stays live while that statement runs.
- **A database outage does not cool anyone down.** After an involuntary lapse an instance waits `CooldownAfterLapse` before winning the duty back, unless every holder lapsed together.

Health reports the duties under the [`roles` component](../../resilience/managed-resource-health#roles) and the meter `Whizbang.Roles` counts elections, hand-offs, drains and losses. The full design, the resilience requirements it meets and the chaos suite that tests them are in the [Duty Role Assignment](../../../proposals/duty-role-assignment) proposal; the options are in the [configuration reference](../configuration/configuration-reference#role-assignment-options).

### A rolling deploy from a release that held duties by session lock {#legacy-holder}

An instance on an older release may still hold a duty by its own session advisory lock. Its elector records the holding (`record_capability`) when it wins, and that record is what this release reads; the lock itself is never read. While the instance that recorded the holding is live by the one liveness rule:

- the vote answers `legacy_holder` and writes no assignment;
- a holder that finds such a holding at its next renewal steps aside (the role is vacated with reason `legacy_holder`), so an older instance that took the duty after the vote overlaps the new holder for at most one renew interval.

A holding recorded by an instance the rule calls dead does not count, and is reaped with its instance row. The role functions an older release calls keep their signatures (`wh_vote_role`, `wh_renew_role_lease`, `wh_vote_roles`, `wh_end_lapsed_bridge`), so its calls are answered from the table alone; the bridge expiry ends no session and always answers `NULL`.

| Choice | Reason | Verified |
|---|---|---|
| The vote refuses with `legacy_holder` while a live instance records a holding outside the table. | Old and new must not both act, and the record is the one thing an older release writes that this one can read without a lock. | {verified: RoleAssignmentResilienceSqlTests.Vote_WhileALiveInstanceHoldsTheDutyOutsideTheTable_AnswersLegacyHolderAsync, RoleAssignmentSqlTests.Elect_WhileAnotherBackendHoldsTheLegacySessionLock_AnswersLegacyHolderAsync, RoleAssignmentElectorE2ETests.MixedFleet_AnOlderReleasesRecordedHolding_IsSeenByTheVote_AndNoAssignmentIsWrittenAsync} |
| A holding recorded by an instance the rule calls dead does not count. | Otherwise a crashed older instance would block the duty until the reap ran. | {verified: RoleAssignmentResilienceSqlTests.Vote_DoesNotCountAHolderOutsideTheTable_ThatTheLivenessRuleCallsDeadAsync} |
| A holder steps aside within one renewal once a live older instance records the duty. | The older instance cannot see the row, so the newer one yields. The overlap of at most one renew interval replaces the bridge, which held a pinned connection per duty to close it. | {verified: RoleAssignmentResilienceSqlTests.RenewLease_StepsAside_WhenALegacyHolderTookTheLockAfterTheVoteAsync, RoleAssignmentResilienceE2ETests.AHolder_StepsAsideWithinOneRenewal_WhenAnOlderReleaseTookTheDutyOutsideTheTableAsync, RoleAssignmentChaosTests.RollingDeploy_FromTheSessionLockRelease_NeverHasBothActingAsync} |
| An older bridged instance's drain request still reaches an older holder. | A release before this one may still be rolling out beside an even older one. | {verified: RoleAssignmentResilienceE2ETests.ABridgedNewerInstance_StillAsksTheOlderHolderToDrainAsync} |

**The gap that remains.** An older instance configured with role assignment off, whose stamper takes its own leader lock, records nothing, so the vote cannot see it. The fleet-wide stand-down planned under [#2022](https://github.com/whizbang-lib/whizbang/issues/2022) closes it. The keys that configured the old mechanisms are [removed keys](../configuration/configuration-reference#removed-keys): a deployment that still sets one is told so at startup.

### The advisory locks that remain, and why they are not duties {#remaining-advisory-locks}

Every advisory lock left in the library is mutual exclusion around one statement or one DDL pass, never a duty: it decides nothing about which instance does work afterward, and it is gone when the statement or pass ends. Two of them guard schema work and are the ones an operator meets:

| Lock | Why it stays | Verified |
|---|---|---|
| **The schema lock**, transaction-scoped (`pg_try_advisory_xact_lock`), held around one schema pass and released at commit. `AdvisoryLockProbe` reads only whether it is held elsewhere, so a contender waits for that pass instead of queuing behind it. | The migrator duty decides who migrates; the lock keeps DDL to one pass at a time even when the duty is wrong or no elector is registered. A transaction lock cannot outlive its pass, so it cannot be stranded. | {verified: SchemaInitializationConcurrencyTests.XactLock_WhenTransactionCommitted_AutoReleasesLockAsync, SchemaInitializationConcurrencyTests.SlowPath_WhenAnotherProcessHoldsTheSchemaLock_WaitsInsteadOfMigratingAsync, SchemaInitializationConcurrencyTests.Staged_WithNoElectorTheLockIsStillTheGuardAsync} |
| **The concurrent index drop.** `DROP INDEX CONCURRENTLY` cannot run in a transaction, so the schema lock is taken at session level for the drop's three statements (lock, drop, record) and released after. It runs only on a connection whose statements reach one backend; through a transaction pooler the drop waits for a direct connection and says why. | No transaction-scoped or row lock is possible around a statement that refuses a transaction, and sharing the schema pass's key keeps the drop and the pass apart. A release that finds nothing is logged, naming the lock. | {verified: ManagedSchemaReconcilerPoolerTests.ThroughATransactionPooler_IndexDropsWaitForADirectConnection_AndSayWhyAsync, ManagedSchemaReconcilerTests.WhileAnotherSessionHoldsTheSchemaLock_ItDoesNothingAsync, AdvisoryLockReleaseTests.ReleasingALockAnotherSessionHolds_ReturnsFalse_AndWarnsNamingTheLockAndKeyAsync} |

The vote's own transaction lock is the same kind: it orders concurrent votes for one role for the length of one statement. A source guard holds the line: an advisory lock anywhere else in the library fails a test, and so does one in a file that holds a duty (see [one way to coordinate](../../../contributors/gravity.md#coordination-source-guard)).
{verified: CoordinationSourceGuardTests.AdvisoryLocks_AppearOnlyInTheAllowlistedFilesAsync, CoordinationSourceGuardTests.NoDuty_IsHeldByAnAdvisoryLockAnywhereAsync}

## Takeover

An instance never looks up whether it has been *assigned* a capability; it votes. Takeover therefore needs no coordinator:

1. The holder holds the assignment and renews its lease from its work loop; its record names the capability.
2. The holder releases cleanly, which vacates the row at once and announces it; or it dies, and stops renewing.
3. After a death the row is stale until its lease lapses in database time or the liveness rule has the instance reaped.
4. Another instance votes: on a release announcement, on its next poll, or prompted by `InstanceDiedSignal`.
5. The vote voids the lapsed or orphaned assignment and grants a new epoch. The new holder **is the holder from that instant**; the old epoch's writes are refused.
6. Its record is written; the dead instance's rows are reaped and cascade away.

No session or TCP timeout is involved at any step: a hard kill on a half-open connection is bounded by the lease and the rule, not by keepalive.

For `Migrate`, waiters watch the migrator directly (`MigratorWatch`): its assignment row, and any holding recorded outside the table by a live migrator on an older release. A migrator that stops cleanly releases its duty, so a waiter that finds the schema current exits at once; a migrator that dies is noticed when its lease lapses (30 seconds by default, held open while its migration statement runs), and the schema lock still guarantees that only one instance applies DDL at a time. The duties that rely on signal-plus-poll re-attempt (`maintainer` among them) are precisely the ones for which tens of seconds is immaterial.
{verified: MigratorWatchTests.AMigratorHoldingTheRole_IsMigrating_UntilItReleasesItAsync, MigratorWatchTests.AMigratorOnAnOlderRelease_IsSeenByItsRecordedHolding_WhileTheRuleCallsItLiveAsync, SchemaInitializationConcurrencyTests.Staged_AKilledDutyHolderIsTakenOverAsync}

## Acquiring a duty {#acquiring-a-duty}

Some work belongs to *winning* a duty rather than to holding it. An `IDutyAcquisitionHandler` names a role and runs on the holder loop's pass that wins that role, before the role's owed work. It does not run again on the passes that merely keep the role, and it runs again each time the role is lost and won back. An instance that never wins the role never runs it.

The grant tells the handler where the role came from. `IDutyGrant.PreviousHolderInstanceId` is the instance that held the role before, when this grant took it over (a hand-off or a takeover after a lapse), and `null` for a first assignment. It is the last holder the role recorded, so after the whole fleet stops, the next cold start counts as a takeover from the last instance that held it.

A handler runs on the holder loop, so it is bounded the same way owed work is: one that hangs stops the loop and the role lapses to another instance. A failure is logged with the handler and the role, and the role is kept. Handlers need the holder loop; a host without one holds no duty from the loop, and no handler runs. A role held only for its acquisition work is still woken at once when its holder releases it, like any other role (see [what starts a pass](#what-starts-a-pass)).

### Vacuum on acquiring the maintainer duty {#vacuum-on-acquiring-the-maintainer-duty}

The work tables (`wh_outbox`, `wh_inbox`, `wh_perspective_events`, `wh_message_deduplication`) are vacuumed by the instance that acquires the `maintainer` duty, never merely by an instance that started:

| The duty | Vacuum |
|---|---|
| First assigned in the fleet | Always, once per process |
| Handed off, or taken over after the holder lapsed | Yes, unless `MaintainOnReassignment` is off |
| Kept by its holder, or regained by the same instance | No |
| Not acquired (an instance joining a fleet with a live holder) | Never |

Schema initialization no longer purges or vacuums. It runs on every instance at every start, and a service that scales out on its backlog starts instances at the peak of a load, so every new instance vacuumed the work tables at the worst moment. The purge runs in the maintenance cycle behind its busy check; between acquisitions, autovacuum and that cycle carry the tables.

Every vacuum runs with the table owner's rights. Postgres does not refuse a non-owner's `VACUUM`: it warns, skips the table, and reports success. So the vacuum runs on the schema-initialization connection (`ConnectionStrings:{name}-init`) when one is configured. Without one, it runs on the application connection only for a table that role owns, and every other table is logged as a warning that names the table and the role, rather than passing for done. The post-ready table rewrite follows the same rule.

```json{
title: "Turn off the vacuum on a maintainer hand-off"
description: "MaintainOnReassignment controls whether an instance that takes the maintainer duty over from another instance vacuums the work tables."
framework: "NET10"
category: "Configuration"
difficulty: "BEGINNER"
tags: ["maintenance", "vacuum", "maintainer-duty", "configuration"]
}
{
  "Whizbang": {
    "Workers": {
      "Maintenance": {
        "MaintainOnReassignment": false
      }
    }
  }
}
```

Turn `MaintainOnReassignment` off when hand-offs are frequent and the maintenance cycle is enough between them.

## The maintainer duty governs fleet-wide work {#the-maintainer-duty-governs-fleet-wide-work}

{verified: MaintainerDutyTests.WithTheMaintainerDutyAssigned_OnlyItsHolderHasATurnAsync, MaintainerDutyTests.WithoutRoleAssignment_EveryInstanceHasATurnAsync, MaintainerDutyTests.WithADutyLoopThatDoesNotManageTheMaintainerDuty_EveryInstanceHasATurnAsync, IntegrityTimerWorkersOnTheMaintainerTests.TheAudit_OnAnInstanceThatDoesNotHoldTheMaintainerDuty_DoesNothingAsync, IntegrityTimerWorkersOnTheMaintainerTests.TheRepairDrain_OnAnInstanceThatDoesNotHoldTheMaintainerDuty_ClaimsNothingAsync, IntegrityTimerWorkersOnTheMaintainerTests.Checkpoints_OnAnInstanceThatDoesNotHoldTheMaintainerDuty_AreNotPublishedAsync, IntegrityDeliveryWorkerTests.OnAnInstanceThatDoesNotHoldTheMaintainerDuty_ThePassDoesNothingAsync}

Background work that touches tables the whole fleet shares runs on the instance holding the `maintainer` duty, so N
instances do it once instead of N times:

- the maintenance sweep (`MaintenanceWorker`);
- claim pruning (emitted-event claims and saga claims);
- partition maintenance;
- stream-integrity work: the integrity delivery drain, the deep audit, the paced repair drain, the paced subscription
  backfill, re-attribution, the idle ledger re-check (`IntegrityLedgerRecheckWorker`) and checkpoint publishing (see [integrity work runs on the maintainer](../../resilience/stream-integrity#integrity-work-runs-on-the-maintainer)).

When role assignment does not manage the duty (no duty loop registered, or a loop without the `maintainer` role),
**every instance** does the work, as before. There is no holder to defer to, and a check that waited for one would
disable the work it guards.

Every one of these callers asks the same question through one helper, `MaintainerDuty.IsThisInstancesTurn(services)`:
true when this instance's run permit is open and it holds the duty, or when its run permit is open and role assignment
does not manage the duty. The rule used to be written out in
each caller, and four copies of a three-clause condition were four chances for one to drift. With one helper, a new
kind of fleet-wide work joins the rule by calling it, and a change to the rule reaches every caller at once.

**No instance has a turn while its run permit is closed.** A paused, stood-down or stopping instance does no
fleet-wide work, with role assignment or without it, even in the moment between the
[run-control path](../../resilience/managed-resource-run-control#halt-sequence) releasing the maintainer role and the
holder loop learning of it. Every maintenance worker and step asks this one question, so the permit is obeyed here once
for all of them, and the [run-permit audit](../../resilience/managed-resource-run-control#run-permit-enforcement)
places each maintenance worker by it.
{verified: MaintainerDutyTests.WhileTheRunPermitIsClosed_NoInstanceHasATurnAsync, MaintainerDutyTests.WithoutRoleAssignment_AClosedPermit_StillHasNoTurnAsync, MaintainerDutyTests.AnOpenPermit_LeavesTheAnswerToTheDutyAsync}

Holding the duty decides *where* the work runs, not *when*. The maintenance sweep and the deferrable integrity work
also wait for the service to be idle, under [housekeeping arbitration](../workers/housekeeping-arbitration).

## The holder loop {#the-holder-loop}

Under role assignment, `DutyHolderWorker` holds every duty this instance has work for: owed duty work (an `IDutyWorkHandler`), or [work that runs on acquiring the duty](#acquiring-a-duty). Each pass keeps every duty it holds by verifying it, which renews the lease, and votes in one call for every duty it does not hold. Then, for each duty it holds, it runs the acquisition work if this pass won the duty, then the owed work that is due, then a drain if a newer release asked for one.

```mermaid{caption="One pass of the holder loop: keep what is held, vote for the rest, then run each held duty's work. A pass starts on the renew interval or at once on a release." tests=["DutyHolderWorkerTests.TheHostedLoop_PassesOnItsInterval_WakesOnARelease_AndReleasesOnStopAsync","DutyHolderWorkerTests.APass_VotesForEveryRoleItDoesNotHold_InOneCallAsync","DutyHolderWorkerTests.WinningTheRole_RunsTheAcquisitionHandlerOnce_WithTheGrantThatWonItAsync"]}
graph TB
    Wait["Wait<br/>RenewInterval, or a wake"]
    Keep["Keep each held duty<br/>verify, which renews the lease"]
    Vote["Vote for every duty not held<br/>one call"]
    Won["Won a duty<br/>OnBecameHolder"]
    Acq["Acquisition work<br/>only on the pass that won it"]
    Owed["Owed work that is due"]
    Drain["Drain if a newer release asked"]

    Wait --> Keep --> Vote
    Vote -->|"granted"| Won --> Acq --> Owed
    Vote -->|"already held"| Owed
    Owed --> Drain --> Wait

    style Won fill:#d4edda,stroke:#28a745,stroke-width:2px
    style Wait fill:#cce5ff,stroke:#0d6efd,stroke-width:2px
```

### What starts a pass {#what-starts-a-pass}

| Trigger | Effect | Verified |
|---|---|---|
| `RoleAssignmentOptions.RenewInterval` elapses (5 seconds by default) | The next pass runs | {verified: DutyHolderWorkerTests.TheHostedLoop_PassesOnItsInterval_WakesOnARelease_AndReleasesOnStopAsync} |
| A `RoleReleasedSignal` on the bus for a duty this instance holds or votes for | A pass runs at once, so a graceful hand-off does not wait for the interval | {verified: DutyHolderWorkerTests.TheHostedLoop_PassesOnItsInterval_WakesOnARelease_AndReleasesOnStopAsync} |
| The same release, for a duty held only for its acquisition work | A pass runs at once, as for any other duty | {verified: DutyHolderWorkerTests.TheHostedLoop_ARelease_OfARoleHeldOnlyForItsAcquisitionWork_WakesAPassAsync} |
| A release of a duty this instance has no work for | Nothing; the duty is not this instance's to take | {verified: DutyHolderWorkerTests.TheHostedLoop_PassesOnItsInterval_WakesOnARelease_AndReleasesOnStopAsync} |
| `DutyHolderWorker.Wake()` | A pass runs at once | {verified: DutyHolderWorkerTests.TheHostedLoop_PassesOnItsInterval_WakesOnARelease_AndReleasesOnStopAsync} |
| The host stops | Every held duty is released, which announces it to the rest of the fleet | {verified: DutyHolderWorkerTests.TheHostedLoop_PassesOnItsInterval_WakesOnARelease_AndReleasesOnStopAsync} |

The loop hears a release through its subscription on the [signal bus](../../fundamentals/signal-bus/signal-bus#coordination-signals): `DutyHolderWorker` takes an `ISignalBus` where earlier releases took the shared notification connection, and owns no channel. The release arrives by the notification, or, if this instance missed it, by its durable-signal tail. Once the host stops, the loop has left the bus and a later release wakes nothing.
{verified: DutyHolderWorkerTests.TheHostedLoop_PassesOnItsInterval_WakesOnARelease_AndReleasesOnStopAsync, RoleAssignmentSqlTests.Release_IsRecordedDurably_SoAnInstanceThatMissedTheNotificationIsStillToldAsync}

A duty can be held only because work runs on acquiring it, such as the [maintainer's vacuum](#vacuum-on-acquiring-the-maintainer-duty) on an instance that has no owed maintainer work. Earlier releases woke the loop only for duties with owed work, so a hand-off of such a duty waited up to one renew interval. A release of it now wakes the loop like any other.

### Watching the loop {#watching-the-holder-loop}

`DutyHolderWorker` raises two events. Both must not block: one runs on the loop, and the other on whichever thread announced the release.

| Event | Raised | Verified |
|---|---|---|
| `OnBecameHolder` (`Action<string>`, the duty) | Once this instance wins a duty and records it as held, so `Holds(duty)` already returns true. It is raised on the pass that won the duty, before the duty's acquisition and owed work run. | {verified: DutyHolderWorkerTests.TheHostedLoop_PassesOnItsInterval_WakesOnARelease_AndReleasesOnStopAsync} |
| `OnWakeRequested` (`Action`) | On the caller's thread, each time the next pass is asked to run at once: a release of a duty this instance holds or votes for, or a call to `Wake()`. A release of any other duty does not raise it. | {verified: DutyHolderWorkerTests.TheHostedLoop_PassesOnItsInterval_WakesOnARelease_AndReleasesOnStopAsync, DutyHolderWorkerTests.TheHostedLoop_ARelease_OfARoleHeldOnlyForItsAcquisitionWork_WakesAPassAsync} |

```csharp{
title: "Log and count the duty holder's transitions"
description: "Subscribes to the duty holder loop's events: one line when this instance wins a duty, and a counter of passes woken early by a release."
framework: "NET10"
category: "Observability"
difficulty: "INTERMEDIATE"
tags: ["duties", "role-assignment", "holder-loop", "events", "observability"]
tests: ["DutyHolderWorkerTests.TheHostedLoop_PassesOnItsInterval_WakesOnARelease_AndReleasesOnStopAsync"]
}
// Null when this host has no duty work to hold.
if (app.Services.GetService<DutyHolderWorker>() is { } holder) {
  holder.OnBecameHolder += duty => logger.LogInformation("This instance now holds {Duty}", duty);
  holder.OnWakeRequested += () => earlyPasses.Add(1);
}
```

Because `OnWakeRequested` is raised before the notification call returns, whether a release woke the loop is known at once. That makes it the signal to wait on in a test, where waiting for a pass to happen, or not, would be a race.

## Related

- [The Startup Pipeline](startup-pipeline) — where duties decide who runs an exclusive step
- [Rolling Upgrades](rolling-upgrades) — standby, eviction, and the verdict that releases capabilities
- [Instance Liveness](../../fundamentals/workers/instance-liveness) — the heartbeat, the alive lock, and the eviction tombstone
- [The Startup Status Surface](startup-status) — holdings as a fleet-level query
