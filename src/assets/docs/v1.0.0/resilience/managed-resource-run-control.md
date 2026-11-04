---
title: Managed-Resource Run-Control
pageType: guide
version: 1.0.0
category: Resilience
order: 3
description: The coordinated lifecycle state machine, where each resource interprets the phase and acknowledges, and the one run-control path that stand-down, pause and stop all take over the instance's one run permit
tags: 'run-control, run-permit, killswitch, stand-down, pause, stop, lifecycle, state-machine, acknowledgement, drain, migration, resilience'
codeReferences:
  - src/Whizbang.Core/RunControl/LifecyclePhase.cs
  - src/Whizbang.Core/RunControl/IWhizbangRunControl.cs
  - src/Whizbang.Core/RunControl/WhizbangLifecycleCoordinator.cs
  - src/Whizbang.Core/RunControl/WhizbangLifecycleState.cs
  - src/Whizbang.Core/RunControl/IWhizbangKillswitch.cs
  - src/Whizbang.Core/RunControl/IWhizbangLifecycleState.cs
  - src/Whizbang.Core/RunControl/IWhizbangRunController.cs
  - src/Whizbang.Core/RunControl/WhizbangRunController.cs
  - src/Whizbang.Core/RunControl/WhizbangRunPermit.cs
  - src/Whizbang.Core/RunControl/RunPermitHold.cs
  - src/Whizbang.Core/RunControl/RunState.cs
  - src/Whizbang.Core/RunControl/WhizbangLifecycleOptions.cs
  - src/Whizbang.Core/RunControl/LifecycleAckTimeoutException.cs
  - src/Whizbang.Core/RunControl/LifecyclePhaseWorker.cs
  - src/Whizbang.Core/Startup/StartupStageRunControl.cs
  - src/Whizbang.Core/RunControl/WhizbangRunControlServiceCollectionExtensions.cs
  - src/Whizbang.Core/Startup/StartupStageHostLifecycle.cs
  - src/Whizbang.Core/Startup/StandbyWatcher.cs
  - src/Whizbang.Core/Startup/StartupStandDown.cs
  - src/Whizbang.Core/Startup/MaintainerDuty.cs
  - src/Whizbang.Core/Workers/ClaimWorker.cs
  - src/Whizbang.Core/Workers/TransportConsumerWorker.cs
  - src/Whizbang.Core/Workers/ServiceBusConsumerWorker.cs
  - src/Whizbang.Data.Postgres/Notifications/PgRoleElector.cs
testReferences:
  - tests/Whizbang.Core.Tests/RunControl/LifecyclePhaseTests.cs
  - tests/Whizbang.Core.Component.Tests/RunControl/WhizbangLifecycleCoordinatorTests.cs
  - tests/Whizbang.Core.Tests/RunControl/WhizbangLifecycleStateTests.cs
  - tests/Whizbang.Core.Tests/Workers/HeartbeatWorkerRequestFieldsTests.cs
  - tests/Whizbang.Core.Tests/Startup/StartupStageRunControlTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/StartupWiringAuditTests.cs
  - tests/Whizbang.Core.Tests/RunControl/WhizbangRunPermitTests.cs
  - tests/Whizbang.Core.Tests/RunControl/WhizbangKillswitchTests.cs
  - tests/Whizbang.Core.Tests/RunControl/WhizbangRunControlDiTests.cs
  - tests/Whizbang.Core.Component.Tests/RunControl/LifecyclePhaseWorkerTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/WhizbangDatabaseInitializerServiceTests.cs
  - tests/Whizbang.Core.Tests/RunControl/WhizbangRunControllerTests.cs
  - tests/Whizbang.Core.Tests/Startup/StartupStageHostLifecycleTests.cs
  - tests/Whizbang.Core.Tests/Startup/StartupStandDownTests.cs
  - tests/Whizbang.Core.Tests/Startup/MaintainerDutyTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/StandbyWatcherTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/CoordinationSourceGuardTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/ClaimWorkerRunPermitTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/TransportConsumerWorkerRunPermitTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/ServiceBusConsumerWorkerRunPermitTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/RunPermitAuditTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/RoleAssignmentElectorE2ETests.cs
verifiedAgainstCommit: 924d20f7
verifiedDate: 2026-10-22
---

# Managed-Resource Run-Control

Run-control is the **enforcement** face of the managed-resource control plane (its partner is
[health](managed-resource-health)). Both are driven by **one thing**: a single lifecycle **state
machine** Whizbang owns and advances. Whizbang broadcasts the current phase; **each resource interprets
it for itself** (stay up, pause, drain, stop) and **acknowledges**. There is no central table deciding
what a phase means per component — only the resource knows (the DB stays up during a migration; a worker
drains on shutdown), so the resource owns the decision.

This generalizes the one-way `ISchemaReadyGate` (which gated only workers) into coordinated control over
every managed resource — workers, transport-consume, the write path, offload, temporal, the signal bus.

## The lifecycle state machine

```csharp{title="Lifecycle phases" description="The one state Whizbang owns and advances" category="Implementation" difficulty="BEGINNER" tags=["Resilience","RunControl"] tests=["LifecyclePhaseTests.TransitionalPhases_AreTransitional_NotSettledAsync","WhizbangLifecycleCoordinatorTests.Transition_BroadcastsToEveryParticipantAsync","ColdBootJourneyE2ETests.ColdBoot_DispatchWaitsForMigrateAndReadsRefuse_ThenTheLadderOpensInOrderAsync"]}
public enum LifecyclePhase {
  Starting,           // process booted (transitional)
  Connecting,         // network warmup — DB/transport/offload connecting, before the migration (transitional)
  Migrating,          // schema/data migration in progress (transitional)
  AcceptingCommands,  // the WRITE side is live, the READ side (lenses) not yet (transitional)
  Running,            // fully operational — reads AND writes serving (settled)
  Pausing, Paused,    // pause (transitional → settled)
  StandingBy,         // yielded to a newer migrator; revives or shuts down when it resolves (settled)
  Resuming,           // resume (transitional)
  Stopping, Stopped,  // graceful shutdown
  Faulted,            // bounded window to record/report before dying (transitional)
  Halted              // terminal — reachable ONLY from Faulted (settled)
}
```

A **transitional** phase is the window in which the coordinator has broadcast the change and is awaiting
every resource's ack; the **settled** phase on the other side is "all acknowledged". `Connecting` sits
before `Migrating` because the migration needs a live DB connection.

`AcceptingCommands` makes the CQRS split visible in the ladder. From the schema gate the entire
**write side** is live — commands land durably in the event store and outbox, events flow, the
transport delivers (its client connected back in `Connecting`), and the perspective startup repair is
itself perspective-writing in progress. The **read side** (lenses) keeps refusing: a lens read is a
synchronous claim about *now*, and during the repair window it could be **wrong**, not merely late.
`Running` means the read-model barrier released too — reads and writes both serve. Per dispatch mode:
an outbox-routed command is a durable promise, safe here unconditionally; a *local* command executes
its receptor immediately — its event-store writes are safe (the repair rewrites perspectives, never
events), and if the receptor reads a perspective it inherits the read barrier at the lens seam and
refuses. Each dispatch gets exactly the barrier its actual dependencies require — the point of
seam-level gating over edge gating.

Before `AcceptingCommands`, while the phase is still `Migrating`, a dispatch is not refused: it waits
for the schema gate to open, bounded by `SchemaInitializationOptions.DispatchMaxWait`, and then runs
(see [Database Readiness](../operations/workers/database-readiness#dispatch-waits-for-the-migration)).
Lenses keep refusing until the read-model barrier releases
{verified: ColdBootJourneyE2ETests.ColdBoot_DispatchWaitsForMigrateAndReadsRefuse_ThenTheLadderOpensInOrderAsync}.

`StandingBy` is the rolling-upgrade rung: an older instance yields when a newer migrator requests
standby, then either revives (rollback: `Resuming`, then `Running`, without going back through
`AcceptingCommands`, because both gates are sticky-open) or shuts down (the migration committed beneath its
binary). Standing by, pausing and stopping all take [the one run-control path](#one-run-control-path).
`Faulted → Halted` is a two-step death: `Faulted` is a bounded window to log/emit/flush, *then* the terminal
`Halted` (a graceful shutdown ends in `Stopped`, never `Halted`).

## Each resource interprets the phase

```csharp{title="Run-control participant" description="A resource interprets the phase and acknowledges" category="Implementation" difficulty="BEGINNER" tags=["Resilience","RunControl"] tests=["WhizbangLifecycleCoordinatorTests.Transition_BroadcastsToEveryParticipantAsync","WhizbangRunControlDiTests.AddWhizbangRunControl_BroadcastsToRegisteredAdaptersAsync"]}
public interface IWhizbangRunControl {
  string Component { get; }                                    // "workers", "transport", "event-store", ...
  // Interpret the phase for THIS resource, do the work, ack by completing. Mandatory: a resource
  // with nothing to do returns a completed task.
  ValueTask OnPhaseAsync(LifecyclePhase phase, CancellationToken cancellationToken);
}
```

A participant decides what a phase means for its resource: the database stays up during a migration, and the
[stage record](#announced-phase) writes the phase on the instance's row. Whether the instance **takes work** is not a
participant's interpretation. It is one fact, the instance's run permit, and one path changes it (see
[One run permit, one path](#one-run-control-path)).

:::updated{version="1.0.0" type="breaking"}
**Removed:** `RunPermitControl` and `RunPermitControl.ForWorkers` ([#2045](https://github.com/whizbang-lib/whizbang/issues/2045)).
The adapter drove a `WhizbangRunPermit` from the broadcast phase, and nothing registered it, so the phase said "paused"
while every worker kept claiming. The permit is now closed and reopened by the run-control path alone.
:::

## Coordinated transitions — every resource acknowledges

```csharp{title="The coordinator" description="Broadcast, barrier, queue, timeout" category="Implementation" difficulty="INTERMEDIATE" tags=["Resilience","RunControl"] tests=["WhizbangLifecycleCoordinatorTests.Transition_Barrier_WaitsForAllAcksBeforeReturningAsync","WhizbangLifecycleCoordinatorTests.Transition_Queue_SerializesTransitionsAsync","WhizbangLifecycleCoordinatorTests.Transition_Timeout_RaisesAckTimeoutAsync"]}
// WhizbangLifecycleCoordinator coordinates each transition:
//   • Barrier  — invoke all resources, await ALL acks before returning.
//   • Timeout  — bound each ack by WhizbangLifecycleOptions.TransitionAckTimeout;
//                a timeout raises LifecycleAckTimeoutException.
//   • Queue    — serialize transitions; concurrent calls queue.
await lifecycle.AdvanceToAsync(LifecyclePhase.Migrating, ct); // broadcasts + awaits all acks
```

A resource that throws or times out surfaces to `WhizbangLifecycleState`, which owns the **fault path**:
it drives the system to `Faulted`, holds for `WhizbangLifecycleOptions.FaultRecordWindow` so resources can
record, then reaches terminal `Halted`.

```csharp{title="Fault path" description="A failed transition faults then halts" category="Implementation" difficulty="INTERMEDIATE" tags=["Resilience","RunControl"] tests=["WhizbangLifecycleStateTests.AdvanceTo_ParticipantThrows_FaultsThenHaltsAfterRecordWindowAsync"]}
// A participant that throws on a transition => Faulted (record window) => Halted.
// AdvanceToAsync does not rethrow — the fault is handled by the machine.
```

## The announced phase {#announced-phase}
{verified: WhizbangLifecycleStateTests.AnnouncedPhase_BeforeAnyTransition_IsStartingAsync, WhizbangLifecycleStateTests.AnnouncedPhase_DuringATransition_IsThePhaseBeingEnteredAsync, WhizbangLifecycleStateTests.AnnouncedPhase_OnTheFaultPath_FollowsThePhaseAsync, WhizbangLifecycleStateTests.AnnouncedPhase_OfAStateThatDoesNotTrackIt_IsItsPhaseAsync, HeartbeatWorkerRequestFieldsTests.BuildRequest_DuringATransition_CarriesThePhaseBeingEnteredAsync}

`IWhizbangLifecycleState` exposes two phases:

| Property | Value |
|---|---|
| `Phase` | The settled phase: it changes only after every resource has acknowledged the transition. |
| `AnnouncedPhase` | The phase this instance announces: the one being entered while a transition is in flight, otherwise `Phase`. |

`AdvanceToAsync` sets `AnnouncedPhase` before it broadcasts the change, and `Phase` after the acks. On the fault path both follow `Faulted` and then `Halted`. An implementation that does not track a separate announced phase gets the default, which returns `Phase`.

The instance's registration row records its phase, and that is what decides whether the instance is [eligible for work](/v1.0.0/fundamentals/workers/instance-liveness#alive-versus-eligible). The row's phase has one writer, the [stage record](/v1.0.0/operations/startup/startup-status#one-writer-of-the-phase): `StartupStageRunControl` is the run-control participant that records each transition, during the transition and before `Phase` changes, in one write of the stage, the phase and the library version. A phase that is a stage's own (`AcceptingCommands`, `Running`, `Stopping`, `Stopped`) enters that stage; a phase off the startup ladder (`Pausing`, `Paused`, `StandingBy`, `Resuming`, `Faulted`, `Halted`) is written alone and keeps the stage. {verified: StartupStageRunControlTests.APhaseThatIsAStage_EntersItAsync, StartupStageRunControlTests.APhaseOffTheLadder_IsAPhaseOnlyWrite_ThatKeepsTheStageAsync, StartupWiringAuditTests.RunControlPlane_RecordsTheInstanceRow_ThroughTheStageParticipantAlone_WithTheLibraryVersionAsync}

The heartbeat and the claim loop's registrations still carry `AnnouncedPhase`, but only so that a row they create, or a row that records no phase, starts with the phase being entered rather than none. They never overwrite a recorded phase, and a claim no longer sends a phase at all (see [Claim loop](/v1.0.0/fundamentals/work-coordinator/claim-loop#lifecycle-phase)).

Entering `AcceptingCommands` is therefore the moment an instance becomes eligible for work, and entering `Stopping` is the moment it stops being eligible, while its heartbeat is still fresh.

## Turnkey — you get this by default

`AddWhizbang()` registers the coordinator, the shared `IWhizbangLifecycleState`, options, the instance's one
`WhizbangRunPermit`, the one run-control path (`IWhizbangRunController`) and the killswitch, plus a driver that
advances the lifecycle from the gates: `Connecting → Migrating` at startup (participants pause or stay up per their
own interpretation), `AcceptingCommands` when the schema gate opens (the write side is live), and `Running` when the
read-model barrier releases (lenses serve). A host without the read barrier registered collapses the last two moments
into one, exactly as before. If initialization never completes the gates never open, so the phase stays `Migrating`:
fail-closed.
{verified: WhizbangRunControlDiTests.AddWhizbangRunControl_RegistersCoordinatorAndStateAsync, WhizbangRunControlDiTests.AddWhizbangRunControl_RegistersOnePermitAndTheOnePathOverItAsync}

## One run permit, one path {#one-run-control-path}

An instance has **one run permit**, and **one path** closes and reopens it: `WhizbangRunController`, registered as
`IWhizbangRunController`. A stand-down, a pause and a stop are the same process and the same code: stop taking work,
finish what is in hand, give back what is held, and say where the instance stands. Only the reason differs.

```csharp{title="The run-control path" description="One path halts the instance for a reason and resumes it after a pause or a stand-down" category="Implementation" difficulty="INTERMEDIATE" tags=["Resilience","RunControl"] tests=["WhizbangRunControllerTests.Halt_ClosesThePermit_ReleasesWorkThenRoles_ThenWritesTheSettledPhaseAsync","WhizbangRunControllerTests.Resume_AfterAPauseOrAStandDown_ReopensThePermitAsync","WhizbangRunControllerTests.Resume_AfterAStop_IsRefusedAsync"]}
public enum RunHaltReason {
  Pause,      // an operator paused the instance; resumable; settles in Paused
  StandDown,  // a newer version needs the schema; resumable on rollback; settles in StandingBy
  Stop,       // host shutdown or the killswitch's stop; final; settles in Stopped
}

public interface IWhizbangRunController {
  WhizbangRunPermit Permit { get; }   // the one permit every claiming worker obeys
  RunHaltReason? HaltedFor { get; }   // null while running
  Task HaltAsync(RunHaltReason reason, CancellationToken cancellationToken);
  Task ResumeAsync(CancellationToken cancellationToken);   // after a pause or a stand-down; refused after a stop
}
```

`WhizbangRunPermit.ChangeAsync` is internal, so nothing outside the library can close or reopen the permit, and the
path is the only caller inside it.

### The sequence {#halt-sequence}

Every halt runs the same six steps:

| Step | What happens | Pause | Stand-down | Stop |
|---|---|---|---|---|
| 1. Close the permit | No new hold is granted, and every obeyer (a transport consumer) has acted on the close before the step completes. | `Paused` | `Paused` | `Stopped` |
| 2. Write the transitional phase | Recorded on the instance's row; the instance stops being eligible for work. | `Pausing` | `Pausing` | `Stopping` |
| 3. Wait for work in hand | Until every hold is disposed, bounded by [`HeldWorkTimeout`](#held-work-timeout). | | | |
| 4. Release unstarted work | Each `IReleasesHeldWork`: the claim worker gives back the leased streams of its last claim that no drain has started. | | | |
| 5. Release roles | Each `IReleasesHeldRoles`: the role elector releases every role it holds, so a peer takes each one over at once. | | | |
| 6. Confirm | The settled phase is written. | `Paused` | `StandingBy` | `Stopped` |

A resume writes `Resuming`, reopens the permit, then writes `Running`.
{verified: WhizbangRunControllerTests.Halt_ClosesThePermit_ReleasesWorkThenRoles_ThenWritesTheSettledPhaseAsync, WhizbangRunControllerTests.Halt_WaitsForEveryHoldBeforeReleasingAsync, WhizbangRunControllerTests.Resume_AfterAPauseOrAStandDown_ReopensThePermitAsync, WhizbangRunPermitTests.Change_TellsEveryObeyerAndAwaitsItAsync}

**Why the permit closes before anything is written.** A phase that says "paused" while workers still claim is the
failure this path exists to remove. Closing first means that by the time a peer, an operator or the migrator reads
`Pausing`, `StandingBy` or `Stopping` on the row, nothing on this instance takes new work.

**Why work is released before roles.** A held stream is released only once nothing is in hand, so a stream a drain has
begun is finished here, never handed to a peer under it. Roles go last because the maintainer and the partition
assigner can keep the fleet's work moving while this instance gives its work back.

**Both phases are written even when nothing is held.** A halt with no holds and no releasers still writes the
transitional and the settled phase, so a fast halt is as visible as a slow one, and the same call twice reports twice.
{verified: WhizbangRunControllerTests.Halt_WithNothingHeldAndNoReleasers_StillWritesBothPhasesAsync, WhizbangRunControllerTests.Halt_Repeated_ReportsAgainAsync}

### The bounded wait {#held-work-timeout}

Step 3 waits at most `WhizbangLifecycleOptions.HeldWorkTimeout`, key `Whizbang:Lifecycle:HeldWorkTimeout`, default
**20 seconds** (see the [configuration reference](../operations/configuration/configuration-reference#whizbanglifecycleoptions)).
Work still in hand after the bound keeps its leases, the path logs how many holds were left, and the halt goes on.
{verified: WhizbangRunControllerTests.Halt_AHoldThatOutlastsTheBound_IsLeftAndTheHaltGoesOnAsync, WhizbangRunControlDiTests.AddWhizbangRunControl_TheHeldWorkBound_BindsFromConfigurationAsync}

**Why 20 seconds.** Host shutdown takes this path while every worker is still running, inside the host's default
30-second shutdown budget. Twenty seconds for the work in hand leaves the rest for the hosted services to stop and the
instance to deregister. A host that raises `HostOptions.ShutdownTimeout` can raise this bound with it.

### Every step after the close is best-effort {#best-effort-steps}

An obeyer that fails to act on the close, a releaser that cannot reach the database, and work that outlasts the bound
are each logged at Warning, and the halt still finishes: the instance must still confirm where it stands. Whatever was
not released is taken over by a peer when its lease lapses, exactly as after a crash, which the design already bounds.
Cancellation by the caller is the one thing that ends the path early: it propagates, and the next halt or resume is
not blocked behind it.
{verified: WhizbangRunControllerTests.Halt_AnObeyerThatFails_DoesNotStopTheHaltAsync, WhizbangRunControllerTests.Halt_AReleaserThatFails_IsLoggedAndTheRestStillRunAsync, WhizbangRunControllerTests.Halt_AnOperationCanceledThatIsNotTheCallers_IsAFailedStep_AndTheHaltGoesOnAsync, WhizbangRunControllerTests.Halt_Canceled_ThrowsAndReleasesTheSerializationAsync, WhizbangRunControllerTests.Halt_CanceledWhileAnObeyerActs_ThrowsAsync, WhizbangRunControllerTests.Halt_CanceledWhileReleasing_ThrowsAsync}

**Why not fail the halt.** A halt that throws halfway leaves an instance that has stopped claiming and still reports
`Running`, which is worse than either state. The lease lapse is the fallback every coordination path already relies
on, so a failed release costs a delay, never a duplicate.

### A pause or a stand-down resumes; a stop is final {#resume-and-stop}

Halts and resumes are serialized, so a stand-down and a host stop that arrive together run one after the other.

- **A resume** after a pause or a stand-down writes `Resuming`, reopens the permit and writes `Running`. A resume while
  running changes nothing.
- **A stop wins.** Once stopped, a later pause or stand-down changes nothing, and a resume throws
  `InvalidOperationException`. The permit's `Stopped` state cancels every waiter and never reopens.
- **A stop after a pause stops.** A paused instance that is then stopped goes on to `Stopped`.
- **The path keeps one reason.** A stand-down over a pause records the stand-down, and a resume reopens the permit
  whichever halt closed it.

{verified: WhizbangRunControllerTests.Resume_AfterAPauseOrAStandDown_ReopensThePermitAsync, WhizbangRunControllerTests.Resume_WhenRunning_ChangesNothingAsync, WhizbangRunControllerTests.Resume_AfterAStop_IsRefusedAsync, WhizbangRunControllerTests.Halt_AfterAStop_IsNotAPauseAsync, WhizbangRunControllerTests.Halt_AStopAfterAPause_StopsAsync, WhizbangRunPermitTests.Stopped_NeverReopensAsync, WhizbangRunPermitTests.Enter_WhenStopped_IsCanceledAsync}

**Why a stop is final.** A stop is host shutdown or an operator saying the process is done. Workers whose waits the stop
canceled have ended their loops, so reopening the permit would bring back an instance with half its workers gone. A
stopped instance is restarted, not resumed.

### The lifecycle guard {#lifecycle-guard}

`WhizbangLifecycleState` refuses two moves:

- **Nothing leaves a terminal phase.** `Stopped` and `Halted` are final; a later advance is ignored.
- **No startup phase while halted.** While the phase is `Pausing`, `Paused`, `StandingBy` or `Stopping`, a move onto
  the startup ladder (`Starting`, `Connecting`, `Migrating`, `AcceptingCommands`, `Running`) is ignored. Only the path
  moves a halted instance on: `Resuming`, a further halt, or the settled phase of its own halt.

{verified: WhizbangLifecycleStateTests.AdvanceTo_FromATerminalPhase_IsIgnoredAsync, WhizbangLifecycleStateTests.AdvanceTo_AStartupPhaseWhileHalted_IsIgnoredAsync, WhizbangLifecycleStateTests.AdvanceTo_TheRunControlPathFromAHalt_IsAcceptedAsync}

**Why.** The startup driver advances the phase as the gates open. A startup step that finishes late, after an operator
paused the instance or a newer version asked it to stand by, would otherwise write `Running` over the halt and say the
instance serves while its permit is closed.

### Who calls the path {#who-calls-the-path}

| Caller | Reason | When |
|---|---|---|
| The killswitch: `PauseAsync`, `ResumeAsync`, `StopAsync` | `Pause`, resume, `Stop` | An operator asks |
| `StandbyWatcher` | `StandDown`, then resume on revival | A newer live peer requests standby, or the running instance finds itself obsolete; revival after a rollback or a dead migrator |
| The Assess stand-down (`StartupStandDown`) | `StandDown` | The schema is newer than this binary at startup ([standing down](../operations/startup/rolling-upgrades#standing-down)) |
| Host shutdown (`StartupStageHostLifecycle.StoppingAsync`) | `Stop` | The host starts to stop, before any hosted service stops ([shutdown stages](../operations/startup/startup-status#startup-stages)) |
| `ServiceBusConsumerWorker.PauseAllSubscriptionsAsync` and `ResumeAllSubscriptionsAsync` | `Pause`, resume | Only when the registered path closes this consumer's permit ([the transport consumer](../messaging/transports/transport-consumer#run-permit)) |

{verified: WhizbangKillswitchTests.PauseAsync_TakesTheRunControlPath_ClosingThePermitUntilResumedAsync, WhizbangKillswitchTests.StopAsync_ClosesThePermitForGood_AndAResumeIsRefusedAsync, StandbyWatcherTests.ANewerLivePeersRequest_StandsDownThroughTheRunControlPathAsync, StandbyWatcherTests.AWithdrawnRequestAndARollback_RevivesUsAsync, StartupStandDownTests.Record_WithTheRunControlPath_StandsDownThroughItAsync, StartupStandDownTests.FromServices_TakesTheRegisteredRunControlPathAsync, StartupStageHostLifecycleTests.Stopping_TakesTheRunControlPathToStop_EvenWhenTheStopBudgetIsSpentAsync, ServiceBusConsumerWorkerRunPermitTests.PauseAll_WithTheRunControlPathRegistered_TakesThePath_AndResumeAllReopensItAsync}

A host without the worker pipeline has no permit, no held work and no roles, so its Assess stand-down only records
`StandingBy`.
{verified: StartupStandDownTests.Record_StaysInPreflight_NamingTheReason_AndStandsByAsync}

### Who obeys the permit {#who-obeys-the-permit}

| Hosted service | How it obeys | Verified |
|---|---|---|
| `ClaimWorker`, `MultiStreamCommandWorker`, `CoalesceShipWorker`, `ScheduleWorker` | Each claim is taken inside a hold of the permit (`RunPermit.EnterAsync`), so a closed permit holds the next claim and the path waits for the one in hand. A stopped permit ends the loop without a claim. | {verified: ClaimWorkerRunPermitTests.AClosedPermit_HoldsTheFirstClaim_AndEveryClaimIsTakenInsideAHoldAsync, ClaimWorkerRunPermitTests.AStoppedPermit_EndsTheClaimLoopWithoutAClaimAsync, MultiStreamCommandWorkerTests.RunOnceAsync_WhileTheRunPermitIsClosed_ClaimsNothingUntilItReopensAsync, MultiStreamCommandWorkerTests.RunOnceAsync_WhenTheRunPermitIsStopped_EndsWithoutClaimingAsync, MultiStreamCommandWorkerLoopTests.Loop_AStoppedRunPermit_EndsTheLoopWithoutAClaimAsync, CoalesceShipWorkerTests.RunOnce_WhileTheRunPermitIsClosed_FoldsNothingUntilItReopensAsync, ScheduleWorkerTests.TickOnce_WhileTheRunPermitIsClosed_FiresNothingUntilItReopensAsync} |
| `TransportConsumerWorker`, and `ServiceBusConsumerWorker` when a host registers it | Called back by the transport rather than looping, so it acts on each change (`RunPermit.Obey`): every subscription is paused before the close completes and resumed on the reopening. A subscription established while the permit is closed is paused at once. | {verified: TransportConsumerWorkerRunPermitTests.AClose_PausesEverySubscriptionBeforeTheChangeCompletes_AndAReopeningResumesThemAsync, TransportConsumerWorkerRunPermitTests.APermitClosedBeforeSubscribing_LeavesTheSubscriptionsPausedAsync, ServiceBusConsumerWorkerRunPermitTests.AClose_PausesEverySubscriptionBeforeTheChangeCompletes_AndAReopeningResumesThemAsync, ServiceBusConsumerWorkerRunPermitTests.APermitClosedBeforeSubscribing_LeavesEverySubscriptionPausedAsync} |
| The maintenance and integrity workers | Through the one maintainer question: no instance has a turn while its permit is closed. | {verified: MaintainerDutyTests.WhileTheRunPermitIsClosed_NoInstanceHasATurnAsync, MaintainerDutyTests.WithoutRoleAssignment_AClosedPermit_StillHasNoTurnAsync} |
| The duty holders (the holder loop, the partition assigner, the commit-order stamper) | Through the role elector: while the permit is closed every vote is refused as `DutyRefusal.Halted`. | {verified: RoleAssignmentElectorE2ETests.WhileTheRunPermitIsClosed_EveryVoteIsRefusedAsHalted_UntilItReopensAsync} |
| The drain, flush and lease-renewal workers | They take no work; they finish the work this instance already holds, so they keep running while the permit is closed. | {verified: RunPermitAuditTests.EveryHostedService_SaysHowItObeysTheRunPermit_AndTheObeyersHoldTheOnePermitAsync} |
| Dead-letter recovery, the transport dead-letter drain and subscription expansion | They return dead letters to the queues for every instance, or configure subscriptions; this instance takes that work back only through the claim worker and the consumer, which obey the permit. They keep running. | {verified: RunPermitAuditTests.EveryHostedService_SaysHowItObeysTheRunPermit_AndTheObeyersHoldTheOnePermitAsync} |

A worker built without a permit gets a private one that is never closed: it is under no run control, which is what a
test that constructs a worker directly wants. A worker resolved from the container gets the container's one permit.

**Why holds rather than a phase check.** A worker that checked the phase before claiming would race the path: it could
read `Running`, the path could close and find nothing held, and the claim would land after the halt was confirmed. A
hold is taken under the permit's lock, so the path either sees it and waits for it, or the worker never gets it.

### Enforcement {#run-permit-enforcement}

Two tests keep every worker on the permit, so the next hosted service cannot take work through a stand-down, a pause
or a stop by accident:

- **`RunPermitAuditTests`** composes a real host the way a consumer does, registers `ServiceBusConsumerWorker` the way a
  host does, and builds it. Every hosted service must have a stated place: it obeys the permit itself and holds the
  container's one permit, obeys through the maintainer question or the elector, finishes work it already holds, or
  takes no work. A hosted service with no place fails, naming it.
- **`CoordinationSourceGuardTests`** scans the source. It fails on a claim call that neither takes a hold nor asks the
  maintainer question, on a halting phase (`Pausing`, `Paused`, `StandingBy`, `Stopping`, `Stopped`, `Resuming`)
  written outside the path, and on a hosted worker that subscribes to a transport without obeying the permit. It also
  checks that each scan finds what it guards (both consumers among them), so it cannot pass by reading nothing. See
  [Gravity](../../contributors/gravity.md#run-permit-guard).

{verified: RunPermitAuditTests.EveryHostedService_SaysHowItObeysTheRunPermit_AndTheObeyersHoldTheOnePermitAsync, CoordinationSourceGuardTests.EveryClaim_ObeysTheRunPermitAsync, CoordinationSourceGuardTests.HaltingPhases_AreWrittenOnlyByTheRunControlPathAsync, CoordinationSourceGuardTests.EveryHostedConsumer_ObeysTheRunPermitAsync, CoordinationSourceGuardTests.TheRunControlScans_SeeWhatTheyGuardAsync}

### Kept on purpose {#run-control-kept-on-purpose}

- **The per-role drain request.** A newer release still asks an older holder to drain a role
  (`IDutyGrant.DrainRequested`): instances on an older release understand that request and not this path, and they are
  what a rolling deploy runs beside.
- **A stopping instance may still claim in SQL.** Migration 300 keeps a caller whose phase is `Stopping` claiming its
  share ([the claim's kept cases](../fundamentals/work-coordinator/claim-loop#ineligible-caller-claims-nothing)). An
  instance on this release has closed its permit before it writes `Stopping`, so only older instances reach that rule
  now. Its removal is tracked in [#2053](https://github.com/whizbang-lib/whizbang/issues/2053).

:::updated{version="1.0.0" type="breaking"}
**Changed** ([#2045](https://github.com/whizbang-lib/whizbang/issues/2045)):

- A pause stops claiming in the process. Earlier releases broadcast `Pausing` and `Paused` while workers kept polling,
  and only the claim SQL refused them.
- On host shutdown `Stopped` is written once held work and roles are released, before the hosted services stop, and the
  shutdown stage messages are `stopping, finishing in-flight work` and `stopped`.
- A stand-down writes `Pausing` before `StandingBy`, and a revival writes `Resuming` before `Running`.
- `TransportConsumerWorker.PauseAllSubscriptionsAsync` and `ResumeAllSubscriptionsAsync` are internal. Pause through the
  killswitch.

**Removed:** `RunPermitControl`, `DutyShutdownReleaseService`, and `IReleasesDutiesOnShutdown`, replaced by
`IReleasesHeldRoles`, which the path calls in step 5.
:::

## Operator killswitch

```csharp{title="Operator control" description="Pause or stop everything through the run-control path, or pin one component" category="Configuration" difficulty="INTERMEDIATE" tags=["Resilience","RunControl"] tests=["WhizbangKillswitchTests.PauseAsync_TakesTheRunControlPath_ClosingThePermitUntilResumedAsync","WhizbangKillswitchTests.StopAsync_ClosesThePermitForGood_AndAResumeIsRefusedAsync","WhizbangKillswitchTests.PauseAsync_DrivesPausingThenPausedAsync","WhizbangKillswitchTests.OverrideComponent_PinsOneResource_IndependentOfSystemPhaseAsync"]}
// Coarse: the one run-control path, the same one a stand-down and host shutdown take.
await killswitch.PauseAsync();   // permit closes, Pausing, held work and roles released, Paused
await killswitch.ResumeAsync();  // Resuming, permit reopens, Running
await killswitch.StopAsync();    // permit closes for good, Stopping, held work and roles released, Stopped

// Fine: pin ONE component independent of the system phase (e.g. drain a transport for maintenance).
await killswitch.OverrideComponentAsync("transport", LifecyclePhase.Stopping);
await killswitch.ClearComponentOverrideAsync("transport"); // back to the current system phase
```

The coarse controls are the [run-control path](#one-run-control-path): a pause stops every claiming worker and every
transport consumer in the process and hands this instance's roles to its peers. A stop is final; the process keeps
running in `Stopped` until it is restarted. A pinned component ignores system transitions until cleared, and every
change, coarse or fine, still goes through the ack barrier. Tune the ack timeout, the fault window and the held-work
bound via `services.AddWhizbangRunControl(o => …)` or `Whizbang:Lifecycle`.

See [Managed-Resource Health](managed-resource-health) for the observe face (the same phase decides what
each resource's health *means*) and the [availability gate](database-availability-middleware).
