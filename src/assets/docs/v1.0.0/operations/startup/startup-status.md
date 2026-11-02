---
title: The Startup Status Surface
pageType: guide
verifiedAgainstCommit: f1ff5bcf
verifiedDate: 2026-08-16
version: 1.0.0
category: Startup
order: 4
description: >-
  "What is it doing right now?" over the host's own API — the opt-in status
  endpoint, its instance and fleet sections, honest degradation, and the
  information-disclosure boundary
tags: >-
  startup, status, diagnostics, endpoint, fleet, observability, minimal-api,
  fastendpoints, hotchocolate, security
codeReferences:
  - src/Whizbang.Hosting.AspNet/StartupStatusEndpoints.cs
  - src/Whizbang.Hosting.AspNet/WhizbangAvailabilityExemptions.cs
  - src/Whizbang.Core/Startup/StartupStatusReport.cs
  - src/Whizbang.Core/Startup/StartupFleetStatus.cs
  - src/Whizbang.Transports.FastEndpoints/Endpoints/WhizbangStartupStatusEndpointBase.cs
  - src/Whizbang.Transports.HotChocolate/Extensions/HotChocolateStartupStatusExtensions.cs
  - src/Whizbang.Core/Startup/StartupStage.cs
  - src/Whizbang.Core/Startup/IStartupStageReporter.cs
  - src/Whizbang.Core/Startup/StartupStageReporter.cs
  - src/Whizbang.Core/Startup/StartupStageHostLifecycle.cs
  - src/Whizbang.Core/Startup/StartupStageRunControl.cs
  - src/Whizbang.Core/Startup/InstanceTransition.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Data.Postgres/SchemaInitializationStages.cs
  - src/Whizbang.Data.Postgres/SchemaBootstrapPhase.cs
  - src/Whizbang.Data.Postgres/MigratorDutyStaging.cs
  - src/Whizbang.Data.Postgres/Migrations/231_StartupStageRecord.sql
  - src/Whizbang.Data.Postgres/Migrations/244_HeartbeatNeverRollsThePhaseBack.sql
  - src/Whizbang.Data.Postgres/Migrations/277_PreflightInstanceAndRoleColumns.sql
  - src/Whizbang.Data.Postgres/Migrations/278_OneWriterOfTheInstancePhase.sql
  - src/Whizbang.Core/Startup/IStartupStageGate.cs
  - src/Whizbang.Core/Startup/StartupStageGate.cs
  - src/Whizbang.Core/Startup/StartupStageGatedService.cs
  - src/Whizbang.Data.Postgres/Notifications/PostgresNotificationsServiceCollectionExtensions.cs
  - src/Whizbang.Data.Postgres/Notifications/RoleAssignmentServiceCollectionExtensions.cs
  - src/Whizbang.Data.Postgres/Notifications/PartitionAssignerRegistration.cs
  - src/Whizbang.Data.Postgres/Notifications/PgSharedNotifyConnection.cs
  - src/Whizbang.Data.Postgres/Notifications/PgWorkAvailablePollSourceBase.cs
testReferences:
  - tests/Whizbang.Hosting.AspNet.Component.Tests/StartupStatusEndpointsTests.cs
  - tests/Whizbang.Transports.FastEndpoints.Tests/Unit/WhizbangStartupStatusEndpointBaseTests.cs
  - tests/Whizbang.Transports.HotChocolate.Tests/Unit/StartupStatusQueryTests.cs
  - tests/Whizbang.Core.Tests/Startup/StartupStagesTests.cs
  - tests/Whizbang.Core.Tests/Startup/StartupStageReporterTests.cs
  - tests/Whizbang.Core.Tests/Schema/SchemaInitializationStagesTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupStageSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupStageHostTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/HeartbeatPhaseOrderSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/InstanceTransitionSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/RecordHeartbeatBackfillTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/WorkEligibilitySqlTests.cs
  - tests/Whizbang.Core.Tests/Startup/StartupStageRunControlTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/StartupWiringAuditTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperHeartbeatPhaseOrderTests.cs
  - tests/Whizbang.Core.Tests/Startup/StartupStageGateTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/StartupStageGatedServiceTests.cs
  - tests/Whizbang.Core.Tests/Workers/WorkerPipelineStartupStageTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupStageWiringTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupPreflightHostTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/SchemaBootstrapPhaseTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PgWorkAvailablePollSourceSchemaGateTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/AliveLockSourcePostgresTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperSchemaStartupTests.cs
---

# The Startup Status Surface

The question people ask during a slow boot is *"what is it doing right now?"* — and the [startup pipeline](startup-pipeline) answers it directly, over the host's own API surface. The surface is **opt-in**: publishing internal state is the host's decision, not a package reference's. Each surface is one explicit call.

```csharp{title="Mounting the status endpoint" description="Minimal API — one call, host auth applies" category="Configuration" difficulty="BEGINNER" tags=["Startup","Status"] tests=["StartupStatusEndpointsTests.Started_ProjectsTheOrderedStepsWithLiveStatusAsync","StartupStatusEndpointsTests.SelfExemption_TheAvailabilityGateNever503sTheStatusRouteAsync"]}
// Default route /whizbang/startup — namespaced so one edge rule against /whizbang/*
// covers it and anything mounted beside it later. Overridable.
app.MapWhizbangStartupStatus();

// It returns IEndpointConventionBuilder, so host security chains as on any endpoint:
app.MapWhizbangStartupStatus("/ops/boot").RequireAuthorization("operators");
```

- **FastEndpoints** — declare an endpoint inheriting `WhizbangStartupStatusEndpointBase`; declaring it *is* the opt-in, and `Roles()` / `Permissions()` / `AccessControl()` apply as on any endpoint.
- **HotChocolate** — `AddWhizbangStartupStatus()` contributes the `whizbangStartup` query field; `[Authorize]` and the existing GraphQL security integration apply to it exactly as elsewhere.

All three serve the same `StartupStatusReport`, built by one shared reporter — the surfaces cannot drift apart in what they disclose. The minimal-API surface is primary: a GraphQL schema whose build touches lens types may not be buildable during `Migrate` at all, and a diagnostic reachable only through the subsystem under diagnosis is not a diagnostic.

## Two sections, two questions

The report has two sections because the endpoint gets reached two different ways:

- **`instance`** — the process that answered this request: current step, the ordered step list with status, duration and outcome, and whether its pipeline is complete and ready. Read from memory, so it is exact and current.
- **`fleet`** — every live instance, from the database: version, lifecycle phase, [capabilities held](capabilities-and-duties), whether it is evicted, and seconds since it was last heard from.

Behind a load balancer, the fleet section is what makes checking a rolling deployment one request instead of curling repeatedly and hoping to reach each pod; the instance section is what identifies *which* instance answered — and the responder appears in both, its id being the key that finds its row among the rest.

The sections are deliberately not symmetrical. **Fidelity differs**: step-level detail lives in each instance's memory, so the fleet section carries only the coarser persisted facts — absence of detail means *not visible from here*, never *no progress*. **Freshness differs**: the instance section is live; every fleet row is only as current as that instance's last heartbeat, so each carries its own age.

## Honest degradation

The endpoint must not share a failure domain with what it reports on, and it must not flatter:

- **Self-exempting.** Mapping the route registers it with the availability gate's exempt set alongside `/alive`, `/health` and `/version` — the gate never 503s the diagnostic that explains the 503s. Not a step the caller can forget.
- **Not-started is a stated condition.** Before the pipeline has begun, the report says so — an empty step list and a pipeline that has not started never serialize identically.
- **Fleet-unavailable is a stated condition.** Before the database is reachable — or on a host with no fleet source — the fleet section reports *unavailable* with the reason, never an empty list. "No other instances" and "cannot see the other instances" mean opposite things during an incident.
- **Auth in front of it must not depend on Whizbang having started.** Whizbang's own permission model is safe (claims-based, no database round-trip); a consumer policy that resolves roles from the database would block on the very migration the endpoint reports on — a failure that looks like a hang.

## The information-disclosure boundary

The split that matters is not *less detail versus more* but **content the framework authors versus content it does not control**. The default projection is entirely the former — step names, states, durations, every value a framework constant. The `reason` strings are the latter: they originate in exception messages, which routinely carry schema names, table names, constraint names and raw driver text. They are therefore a separate opt-in (`includeReasons`), not a verbosity dial:

```csharp{title="Reasons are an opt-in, not a dial" description="A host that secured the endpoint may turn them on" category="Configuration" difficulty="INTERMEDIATE" tags=["Startup","Status","Security"] tests=["StartupStatusEndpointsTests.Reasons_AreExcludedByDefault_TheyCarryContentTheFrameworkDoesNotControlAsync","StartupStatusEndpointsTests.Reasons_AppearWhenTheHostOptsInAsync"]}
app.MapWhizbangStartupStatus(includeReasons: true)
   .RequireAuthorization("operators");   // opt in only where the audience is trusted
```

Fleet failure text rides the same opt-in.

One route is ruled out on purpose: **`/.well-known/` is the wrong home** for an access-controlled diagnostic. That prefix is routinely allowlisted past authentication at CDNs and ingress controllers for ACME challenges, it is a registry rather than a free namespace, and it is the first place scanners enumerate. The default lives under `/whizbang/` instead.

## Startup stages {#startup-stages}

Every instance records and logs which startup stage it is in. One owner, `IStartupStageReporter`, holds the
current stage; `IStartupStageObserver` receives every change. Each stage (`StartupStage`) has a fixed number with
gaps, never a list position, so a stored value means the same thing in every release and a query can compare it
(`startup_stage >= 60`):

| Number | Stage | Logged as | `lifecycle_phase` written | Entered by |
|---|---|---|---|---|
| 10 | Preflight | `Stage 1 of 7` | `Connecting` | the host lifecycle, as the host starts; schema initialization reports the bootstrap closure and the instance's registration as progress within it |
| 20 | Elect | `Stage 2 of 7` | `Migrating` | schema initialization: the vote for the migrator, then its result |
| 30 | Migrate | `Stage 3 of 7` | `Migrating` | schema initialization: the schema pass, or skipped when the schema is current |
| 40 | Converge | `Stage 4 of 7` | `Migrating` | schema initialization: index statistics and the managed-object reconcile |
| 50 | Coordinate | `Stage 5 of 7` | `Migrating` | the shared initializer, before the schema-ready gate opens |
| 60 | Accept commands | `Stage 6 of 7` | `AcceptingCommands` | the lifecycle's AcceptingCommands transition |
| 70 | Running | `Stage 7 of 7` | `Running` | the lifecycle's Running transition |
| 80 | Draining | `Shutdown stage` | `Stopping` | the host lifecycle, before any worker stops |
| 90 | Stopped | `Shutdown stage` | `Stopped` | the host lifecycle, once the host has stopped |

{verified: StartupStagesTests.Values_AreTheFixedNumbersOnTheRow_WithGapsAsync, StartupStagesTests.Startup_IsTheSevenStartupStagesInOrderAsync, StartupStagesTests.EachStage_KeepsTheLifecyclePhaseItMapsToAsync, StartupStageReporterTests.Enter_EveryStartupStageInOrder_LogsEachLine_AndObservesEachOnceAsync}

### The log lines

Entering a stage logs one line at Information:

```text{title="Startup stage log lines" description="The line an instance logs as it enters each startup stage and each shutdown stage" category="Operations" difficulty="BEGINNER" tags=["Startup","Logging"] tests=["StartupStageReporterTests.Enter_AStartupStage_LogsStageXOfSeven_AtInformationAsync","StartupStageReporterTests.Enter_AShutdownStage_LogsAShutdownStageLineAsync","StartupStageHostTests.AFreshDatabase_EntersEveryStageInOrder_LogsEach_AndRecordsEachTheRowCanHoldAsync","StartupStageHostTests.AGracefulStop_RecordsDraining_ThenStoppedAsync"]}
Stage 1 of 7: Preflight - host starting
Stage 1 of 7: Preflight - the bootstrap closure is in place; registering this instance
Stage 2 of 7: Elect - voting for the migrator duty
Stage 2 of 7: Elect - this instance migrates the schema
Stage 4 of 7: Converge - analyzing new indexes and reconciling managed objects
Stage 5 of 7: Coordinate - recomputing partitions before the schema-ready gate opens
Stage 6 of 7: Accept commands - the schema is ready; commands are accepted while the read models catch up
Stage 7 of 7: Running - reads and writes are served
Shutdown stage: Draining - host stopping, finishing in-flight work
Shutdown stage: Stopped - host stopped
```

The pattern is `Stage X of 7: <name> - <message>` for a startup stage and `Shutdown stage: <name> - <message>` for
Draining and Stopped. Stages only move forward: entering an earlier stage changes nothing. A new message within the
current stage is progress: it logs the line again and keeps the stage's entry time. A skipped stage logs
`skipped: <reason>` as its message.

### Preflight's progress lines {#preflight-progress}
{verified: SchemaInitializationStagesTests.TheBootstrapsWaitsAndFailure_AreProgressWithinPreflightAsync, SchemaInitializationStagesTests.Registering_IsTheLastStepOfPreflightAsync, StartupPreflightHostTests.TheInstanceRow_IsRegisteredAtTheEndOfPreflight_BeforeElectAsync}

On the EF Core driver, schema initialization reports its Preflight work as progress within Preflight: the
[bootstrap closure](../infrastructure/migrations#bootstrap-waits-for-the-lock), then the instance's registration.

| Message | When |
|---|---|
| `waiting for the schema lock to apply the bootstrap closure` | Another session holds the schema lock; the bootstrap waits for it |
| `the bootstrap closure met a transient database failure; retrying` | The bootstrap failed transiently and [retries after its delay](../infrastructure/migrations#bootstrap-failures) |
| `the bootstrap closure failed with an error that is not transient` | The bootstrap failed for good; the attempt fails in Preflight with a [`SchemaBootstrapException`](../diagnostics/error-reference#schema-bootstrap-exception) |
| `the bootstrap closure is in place; registering this instance` | Preflight's last step: the instance joins the registry, then Elect begins |

**Why registration ends Preflight.** The instance row is written once the bootstrap closure and the instance and role
tables are in place, so nothing registers before its tables are ready, and Elect only votes. Earlier releases entered
Elect and then registered inside the election (`Stage 2 of 7: Elect - joining the registry and voting for the migrator
duty`), so the row's first recorded stage was Elect and registration belonged to no stage.

### The instance row {#the-instance-row}

Each transition is **one update** of the instance's `wh_service_instances` row, through
`wh_record_instance_transition` (migration 278): the stage, what it is doing, the lifecycle phase and the library
version, together. The stage columns come from migration 231, and `lifecycle_phase` is set from the stage as in the
table above. The columns, `lifecycle_phase`, `library_version` and the recorder are part of the
[bootstrap closure](../infrastructure/migrations#what-the-closure-carries) (migrations 277 and 278), so they exist from
Preflight on every database, fresh or current:

| Column | Type | Meaning |
|---|---|---|
| `startup_stage` | `SMALLINT` | The stage number; `NULL` for an older build or before the first write |
| `startup_stage_message` | `TEXT` | What the stage is doing, or why it was skipped; updated on progress |
| `startup_stage_entered_at` | `TIMESTAMPTZ` | When the stage was entered, by the database's clock; progress keeps it |
| `lifecycle_phase` | `TEXT` | The stage's phase, or a [pause or stand-by](#pause-and-standby) recorded with the stage |
| `library_version` | `TEXT` | The library version the instance runs; a write without one keeps the recorded value |

The recorder returns whether the row was written, which is `false` for an instance that has no row yet. Writing a
transition is not a heartbeat: it never touches `last_heartbeat_at`. Progress within a stage keeps
`startup_stage_entered_at`, and a new stage starts its own.
{verified: InstanceTransitionSqlTests.AStage_IsWrittenWithItsPhaseAndTheVersion_AndIsNotAHeartbeatAsync, InstanceTransitionSqlTests.ATransition_IsOneUpdateOfTheRowAsync, InstanceTransitionSqlTests.TheSameStageAgain_KeepsWhenItWasEntered_AndANewStageStartsItsOwnAsync, InstanceTransitionSqlTests.ANullVersion_KeepsTheRecordedOneAsync, InstanceTransitionSqlTests.AnInstanceWithNoRow_ReportsNothingWrittenAsync, StartupStageReporterTests.AStageWrite_CarriesTheStagesPhase_AndTheLibraryVersion_InOneCallAsync}

**Why one update.** Earlier releases wrote each transition twice: the stage recorder wrote the stage and its phase,
and a second run-control participant wrote the phase again with the library version. The next heartbeat then wrote
the phase a third time. One update costs one row version per transition, and a reader never sees a stage and a phase
from two different moments.

A stage entered before the instance's row exists is held and written when the instance registers. A write that
fails (from registration on, only when the database cannot be reached in time) or does not answer within 5 seconds is
held until the next accepted heartbeat; it is never thrown into startup.
{verified: StartupStageReporterTests.Enter_BeforeTheInstanceRegisters_HoldsTheStage_AndWritesNothingAsync, StartupStageReporterTests.AWriteThatFails_IsHeld_AndWrittenOnTheNextRegistrationSignalAsync, StartupStageReporterTests.AWriteThatDoesNotAnswer_IsAbandonedAfterItsBudget_AndHeldAsync}

### One writer of the phase {#one-writer-of-the-phase}

The stage record is the only writer of an instance's recorded phase. `IStartupStageReporter` makes every write,
through `IWorkCoordinator.RecordInstanceTransitionAsync`, on the EF Core and the Dapper drivers alike, and
`StartupStageRunControl` is the only run-control participant that writes the row: a lifecycle transition reaches the
row as one write, with the version the host registered.
{verified: StartupWiringAuditTests.RunControlPlane_RecordsTheInstanceRow_ThroughTheStageParticipantAlone_WithTheLibraryVersionAsync, DapperHeartbeatPhaseOrderTests.ATransition_IsRecorded_StagePhaseAndVersionTogether_AndAPauseKeepsTheStageAsync}

**Why one writer.** Earlier releases had three: the stage recorder on every stage, an instance-state participant on
every lifecycle transition, and every heartbeat with the phase the beat was built in. They raced. Migration 244 kept
a stale beat from rolling the phase back down the startup ladder, but a pause and a stand-by are off the ladder, so a
beat built before one could still write the earlier phase over it, and a beat ahead of the row overwrote whatever the
row recorded. The claim loop then compared the row with the phase it announced and registered again on a mismatch, a
fourth writer. With one writer, [eligibility for work](../../fundamentals/work-coordinator/partition-assignment), the
[standby handshake](rolling-upgrades) and this surface all read a phase that only the transition itself wrote, and no
later write can undo it.

### A pause and a stand-by keep the stage {#pause-and-standby}

A phase off the startup ladder (`Pausing`, `Paused`, `StandingBy`, `Resuming`, `Faulted`, `Halted`) is not a stage.
`StartupStageRunControl` sends it to `IStartupStageReporter.EnterPhaseAsync`, which writes the phase alone: the row
keeps its stage, the stage's message and when the stage was entered. No stage line is logged and no stage observer is
told, because the stage has not changed. A paused instance whose stage is Running reads as Running and `Paused`, and is
not eligible for work.

- **A phase on the ladder is refused** as a phase-only write (`ArgumentOutOfRangeException`). `Starting` through
  `Stopped` are each a stage's own phase, recorded by entering the stage, so a phase-only write can never put a stage
  and its phase out of step. `Starting`, `Connecting` and `Migrating` leave the stage to schema initialization, which
  enters each stage where its work happens.
- **A resume writes the stage's phase again.** Entering the current stage after a pause (the lifecycle's move back
  into Running) records the stage's own phase and keeps when the stage was entered. Entering an earlier stage during a
  pause changes nothing, as at any other time; entering a later one writes that stage's phase.
- **It is held like a stage.** A phase entered before registration, or whose write failed, is written with the stage
  on the next registration signal.

{verified: InstanceTransitionSqlTests.APhaseOnlyWrite_KeepsTheStage_ItsMessage_AndWhenItWasEnteredAsync, StartupStageReporterTests.EnterPhase_OffTheLadder_WritesThePhase_AndKeepsTheStageAsync, StartupStageReporterTests.EnterPhase_IsNotAStage_SoNothingIsLogged_AndNoObserverIsToldAsync, StartupStageRunControlTests.APhaseOffTheLadder_IsAPhaseOnlyWrite_ThatKeepsTheStageAsync, StartupStageRunControlTests.AStartupPhase_LeavesTheStageWhereItIsAsync, StartupStageReporterTests.EnterPhase_OnTheLadderOrUndefined_IsRefusedAsync, StartupStageReporterTests.Enter_TheCurrentStageAfterAPause_WritesItsOwnPhaseAgain_AndKeepsWhenItWasEnteredAsync, StartupStageReporterTests.Enter_AnEarlierStageDuringAPause_ChangesNothingAsync, StartupStageReporterTests.Enter_ALaterStageDuringAPause_WritesThatStagesPhaseAsync, StartupStageReporterTests.EnterPhase_BeforeRegistration_IsHeld_AndWrittenWithTheStageAtRegistrationAsync}

**Why the stage is kept.** The stage says how far startup got; the phase says whether the instance serves. A peer
that stands by for a breaking migration while it is Running has not gone back to an earlier stage, so
`wh_instance_startup_stages()` shows it at Running and `StandingBy`, not at a stage it never entered, and its stage's
entry time still says how long it has been there.

### What a registration and a heartbeat write {#registration-writes}

A heartbeat no longer writes a recorded phase or version. Migration 278's `record_heartbeat` writes them only as a
registration:

- on the row it inserts (the Dapper driver's first beat, or a claim that registers a missing row again);
- on a row that records none;
- for a new process under the same instance id (a different host name or process id), which starts at the bottom of
  the ladder and runs its own version.

Every other beat leaves both as recorded and refreshes liveness only.
{verified: HeartbeatPhaseOrderSqlTests.ABeatAheadOfTheRow_DoesNotMoveThePhase_TheStageRecordIsItsOnlyWriterAsync, HeartbeatPhaseOrderSqlTests.APhaseOffTheLadder_OnABeat_IsNotWritten_EitherWayAsync, HeartbeatPhaseOrderSqlTests.APhaseTheDatabaseDoesNotKnow_OnABeat_IsNotWrittenAsync, HeartbeatPhaseOrderSqlTests.ABeat_NeverOverwritesARecordedVersionAsync, RecordHeartbeatBackfillTests.BeatWithANewPhase_KeepsTheRecordedOneAsync, DapperHeartbeatPhaseOrderTests.ABeat_NeverMovesTheRecordedPhase_EitherWayAsync, RecordHeartbeatBackfillTests.FirstBeat_CreatesTheRowWithPhaseAndVersionAsync, HeartbeatPhaseOrderSqlTests.ABeatOnARowThatRecordsNoPhaseOrVersion_FillsThemAsync, HeartbeatPhaseOrderSqlTests.ANewProcessUnderTheSameInstanceId_RecordsItsVersionAsync, HeartbeatPhaseOrderSqlTests.ARestartUnderTheSameInstanceId_StartsBehindTheOldProcess_AndIsNotEligibleAsync}

**Why a beat may still register them.** A row needs a phase from the moment it exists: a row with none reads as an
older build, which is eligible for work whenever it is live. Only a registration can give it one before the first
transition. After that, every value a beat could repair is one the stage record already holds and writes again
itself (held, then written on the next accepted beat), so a beat that overwrote it could only bring the race back. The
version belongs to the process, so it is recorded when the process registers and not rewritten on every beat.

The bootstrap registration at the end of Preflight follows the same rule. It records Preflight's phase, `Connecting`,
through `wh_record_instance_transition`, and only where the row records none; the stage held until the row existed is
then written as the Preflight transition's one update, with the version. A starting instance's row therefore never
lacks a phase, so it is never a candidate for work while it migrates, and a registration never moves a phase the stage
record wrote.
{verified: InstanceTransitionSqlTests.Registration_RecordsThePhaseItRegistersIn_AndNeverOverwritesARecordedOneAsync, WorkEligibilitySqlTests.BootstrapRegistration_RecordsTheInstanceAsConnecting_SoItIsNotACandidateAsync, WorkEligibilitySqlTests.ARegistration_NoLongerMovesARecordedPhase_TheStageRecordMakesTheRowCurrentAsync, SchemaBootstrapPhaseTests.AnEmptyDatabaseRecordsATransitionAtRegistrationAfterTheBootstrapAsync}

:::note
With a fixed instance id, a process that restarts on the same host with the same process id (pid 1 in a
container) before its old row is reaped cannot be told from the old process: the old row's phase stands until the new
process's own stage write. Default instance ids are new for every process.

A row that a heartbeat or a claim creates again, after the instance's earlier row was removed, records its phase and
version as a registration but no stage until the instance's next transition.
:::

### Upgrading: the members this replaced {#upgrading-one-writer}

:::updated{version="1.0.0" type="breaking"}
**Removed:** `InstanceStateRunControl`, `IWorkCoordinator.RecordInstanceStateAsync` and
`IWorkCoordinator.RecordStartupStageAsync` ([#1977](https://github.com/whizbang-lib/whizbang/issues/1977)).

- **A custom `IWorkCoordinator`** that implemented either method implements
  `RecordInstanceTransitionAsync(InstanceTransition, CancellationToken)` instead. Its default records nothing, and the
  reporter then holds every transition as unwritten.
- **A registration of `InstanceStateRunControl`** is removed: `StartupStageRunControl`, which the worker pipeline
  registers, writes every transition.
- **A custom `IStartupStageReporter`** compiles unchanged: `EnterPhaseAsync` has a default that records nothing, so
  such a reporter records no pause or stand-by until it implements it.
- **Code that constructs `StartupStageReporter` directly** passes an `ILibraryVersionProvider`, now a required
  parameter, because every write records the version.
- **`ClaimWorkRequest.LifecyclePhase` stays.** The framework's claim loop passes `null`; see
  [Claim loop](../../fundamentals/work-coordinator/claim-loop#lifecycle-phase).

The SQL functions `record_instance_state` (migration 109) and `wh_record_startup_stage` (migration 231) stay in the
schema, because older builds call them during a [rolling upgrade](rolling-upgrades).
:::

### Seeing every instance's stage

`wh_instance_startup_stages()` lists every registered instance, ordered by service, with its stage, the stage's
name and `X of 7` position (`NULL` for a shutdown stage), message, entry time, time in stage, lifecycle phase and
whether it is [eligible for work](../../fundamentals/work-coordinator/partition-assignment):

```sql{title="Every instance's startup stage" description="The operator query over the recorded startup stages" category="Operations" difficulty="BEGINNER" tags=["Startup","SQL"] tests=["StartupStageSqlTests.Stages_ListEveryInstance_WithItsPositionMessageAndTimeInStageAsync"]}
SELECT service_name, host_name, stage_name, stage_position, stage_count,
       startup_stage_message, time_in_stage, eligible_for_work
FROM wh_instance_startup_stages();
```

### What a fresh database and a restart record

Both start the same way. Preflight is held until its last step registers the row, so the first stage the row records
is Preflight (10) with `the bootstrap closure is in place; registering this instance`; every stage line before it
(`host starting`, and any wait or retry of the bootstrap) is log-only. Elect is then recorded as it is entered, with
the election's result, and every stage after it is recorded as it is entered. They differ only in Migrate:

- **A fresh database:** Migrate is recorded with the schema pass it runs.
- **A restart on a current schema:** Migrate is recorded as skipped (`Stage 3 of 7: Migrate - skipped: the schema is
  already current`).

**Why a fresh database records from registration.** The stage columns, the `lifecycle_phase` and `library_version`
columns the recorder writes beside them and the recorder itself are in the
[bootstrap closure](../infrastructure/migrations#what-the-closure-carries), which Preflight applies before it
registers. Earlier releases created them only in the main pass, so on a fresh database the registration's write
failed, and Preflight, Elect and Migrate appeared in the log only; the row's first recorded stage was Converge (40).
A fresh database is exactly when an operator most needs to see where startup is.

{verified: StartupStageHostTests.AFreshDatabase_EntersEveryStageInOrder_LogsEach_AndRecordsEachTheRowCanHoldAsync, StartupStageHostTests.ARestartOnACurrentDatabase_SkipsMigrate_AndRecordsFromRegistrationAsync, SchemaBootstrapPhaseTests.AnEmptyDatabaseRecordsItsStageAtRegistrationAfterTheBootstrapAsync, SchemaBootstrapPhaseTests.AnEmptyDatabaseRecordsATransitionAtRegistrationAfterTheBootstrapAsync}

Elect, Migrate and Converge are reported by the EF Core driver's schema pass. A host on the Dapper driver logs
Preflight, Coordinate, Accept commands, Running and the shutdown stages, and since migration 278 records them on its row
through the same recorder: the row is created by the instance's first heartbeat, and the stage held until then is
written on that beat's registration signal. Earlier releases wrote no stage on this driver.
{verified: DapperHeartbeatPhaseOrderTests.ATransition_IsRecorded_StagePhaseAndVersionTogether_AndAPauseKeepsTheStageAsync, StartupStageReporterTests.InstanceRegistered_WritesTheHeldStage_OnceAsync}

A Dapper host holds no election, so once the database answers it logs Elect as skipped
(`Stage 2 of 7: Elect - skipped: no election could be held, so this instance migrates under the schema lock`), which
ends Preflight for it as for the EF Core driver. The
[managed-resource health](../../resilience/managed-resource-health#startup-stage) `startup` component reports the same
stage line.

## What runs in each stage {#what-runs-in-each-stage}

An instance's own workers start at the stage they need, not when the host starts. A worker that starts with the host
reads and writes tables the migration may be altering in the same moment and, on a fresh database, tables and
functions that do not exist yet. Starting each at its stage means no worker of the instance touches the database during
Preflight, and a starting instance no longer deadlocks its own migration. Preflight's only database work is schema
initialization's own: the [bootstrap closure](../infrastructure/migrations#bootstrap-waits-for-the-lock), then the
instance's registration as Preflight's last step, so the notification connection, which starts at Elect, starts
after the registration.

| From | What starts | Why then |
|---|---|---|
| Elect (after Preflight registers the instance) | The notification connection: its `LISTEN`s and the instance's [alive-lock](../../fundamentals/workers/instance-liveness#alive-lock-source) claim. The `roles` [health component](../../resilience/managed-resource-health#roles) reads role assignments from here on. | The election that follows reads the alive-lock. |
| Coordinate | The duty holder (the maintainer vote, and the vacuum it runs on winning) and the [partition assigner](../../fundamentals/work-coordinator/partition-assignment). | Both vote and write against the instance and role tables, which the migration may still be changing until then. |
| The schema-ready gate opens (the end of Coordinate) | The work-available probes send their first query. Until then each probe tick sends nothing. | The tables the probes read may not exist yet, and nothing claims work before the gate opens. |

{verified: StartupStageWiringTests.TheNotificationConnection_StartsAtTheEndOfPreflight_OnceAsync, StartupStageWiringTests.TheDutyHolderAndThePartitionAssigner_StartAtCoordinateAsync, StartupStageWiringTests.EveryWorkAvailableProbe_ReadsTheSchemaReadyGateAsync, StartupStageWiringTests.TheRolesHealthComponent_ReadsNothingBeforeElectAsync, PgWorkAvailablePollSourceSchemaGateTests.WhileTheSchemaGateIsClosed_ATickSendsNothing_AndOnceOpenItQueriesAsync, StartupPreflightHostTests.NothingVotesBeforeCoordinate_AndNoWorkerAsksForAnObjectThatDoesNotExistYetAsync, StartupPreflightHostTests.TheInstanceRow_IsRegisteredAtTheEndOfPreflight_BeforeElectAsync}

The election for the migrator itself runs as before: it is what Elect is, run by schema initialization, and it waits
for nothing.

A stage counts as reached once the instance has entered or skipped it, or entered any later startup stage. Every stage
up to Coordinate also counts as reached once the schema-ready gate is open, because the gate opens only at the end of
Coordinate. A host whose schema is provisioned out of band has a gate that is open from the start, so its workers
never wait. A shutdown stage reaches nothing: an instance that starts to drain before a worker's stage never starts
that worker, and so never stops it.
{verified: StartupStageGateTests.EnteringAStage_ReachesItAndEveryStageBeforeIt_ButNotTheOnesAfterAsync, StartupStageGateTests.ASkippedStage_IsReachedLikeAnEnteredOneAsync, StartupStageGateTests.TheSchemaReadyGate_ReachesEveryStageUpToCoordinate_AndNoLaterOneAsync, StartupStageGateTests.AnAlreadyOpenSchemaGate_MeansNoWaitAtAllAsync, StartupStageGateTests.AShutdownStage_ReachesNothing_SoAWorkerWaitingForItsStageNeverStartsAsync, StartupStageGatedServiceTests.StoppedBeforeItsStage_TheServiceIsNeverStartedOrStoppedAsync}

### The alive-lock on a fresh database

On a fresh database the notification connection can open before the migration that creates the alive-lock function
has run. The connection asks the catalog first and, when the function does not exist yet, logs that at Debug and makes
the claim on a later keepalive, once the function exists. `PgSharedNotifyConnection.OnAliveLockClaimed` is raised each
time the claim is made. Earlier releases sent the call anyway, logged its failure (`42883`) at Warning, and did not
claim the lock on that connection again until it was replaced.
{verified: AliveLockSourcePostgresTests.OnADatabaseWithoutTheFunctionYet_TheClaimWaitsQuietly_AndAKeepaliveMakesItOnceItExistsAsync}

### Starting your own hosted service at a stage

`AddHostedServiceAtStage` registers a hosted service that starts once the instance reaches a startup stage. Use it
for a service of your own that reads or writes the database as soon as it starts:

```csharp{title="Start a hosted service at Coordinate" description="The host starts a wrapper with every other hosted service; the wrapper starts the service once the instance reaches its stage" category="Configuration" difficulty="INTERMEDIATE" tags=["Startup","Hosting","Workers"] tests=["StartupStageGatedServiceTests.Registration_WrapsTheServiceAtItsStage_OncePerServiceTypeAsync","StartupStageGatedServiceTests.TheServiceStarts_OnlyOnceItsStageIsReachedAsync","StartupStageGatedServiceTests.StoppedBeforeItsStage_TheServiceIsNeverStartedOrStoppedAsync"]}
builder.Services.AddSingleton<OrderArchiveWorker>();
builder.Services.AddHostedServiceAtStage(
    StartupStage.Coordinate,
    sp => sp.GetRequiredService<OrderArchiveWorker>());
```

- **When it starts.** The host starts a wrapper with every other hosted service; the wrapper waits for the stage in
  the background and then starts the service. Only startup stages can be waited for.
- **When it stops.** A service stopped before its stage is never started and never stopped. A started one is stopped
  with the host.
- **Failures.** A fault in a `BackgroundService`'s own loop is the wrapper's fault, so the host handles it exactly as
  it would have handled the service's.
- **Registering twice.** Registering the same service type again changes nothing.
- **Without the worker pipeline.** A host composed without the worker pipeline records no stages and registers no
  stage gate; there the service starts with the host, as it would unwrapped.

{verified: StartupStageGatedServiceTests.AFailureOfTheServicesOwnLoop_IsTheWrappersSoTheHostSeesItAsync, StartupStageGatedServiceTests.AStoppedLoop_EndsTheWrapperWithoutAFaultAsync, StartupStageGatedServiceTests.WithNoGate_TheServiceStartsWithTheHostAsync, StartupStageGateTests.AShutdownStage_CannotBeWaitedForOrAskedAboutAsync, WorkerPipelineStartupStageTests.AddWhizbangWorkers_RegistersOneStageGate_TheReportersObserverAsync}

`IStartupStageGate` is the same check for code that is not a hosted service: `HasReached(stage)` answers now, and
`WaitForAsync(stage, cancellationToken)` completes once the stage is reached.

## Related

- [The Startup Pipeline](startup-pipeline) — the state the surface projects
- [Capabilities and Duties](capabilities-and-duties) — the holdings the fleet section reads
- [Rolling Upgrades](rolling-upgrades) — watching a mixed-version rollout land
- [Database Readiness](../workers/database-readiness#the-startup-status-surface) — the readiness machinery around it
