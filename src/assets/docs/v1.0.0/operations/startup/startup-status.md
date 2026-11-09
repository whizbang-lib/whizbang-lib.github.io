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
  - src/Whizbang.Core/Startup/StartupStandDown.cs
  - src/Whizbang.Core/Startup/StartupAssessmentSource.cs
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
  - src/Whizbang.Core/Startup/GatedHostedService.cs
  - src/Whizbang.Core/Startup/SchemaReadyGatedService.cs
  - src/Whizbang.Core/Startup/WhizbangWorkerServiceCollectionExtensions.cs
  - src/Whizbang.Core/Startup/IStartAbandonedObserver.cs
  - src/Whizbang.Core/Workers/WhizbangShutdownService.cs
  - src/Whizbang.Data.Postgres/Notifications/PostgresNotificationsServiceCollectionExtensions.cs
  - src/Whizbang.Data.Postgres/Notifications/RoleAssignmentServiceCollectionExtensions.cs
  - src/Whizbang.Data.Postgres/Notifications/PartitionAssignerRegistration.cs
  - src/Whizbang.Data.Postgres/Notifications/PgSharedNotifyConnection.cs
  - src/Whizbang.Data.Postgres/Notifications/PgWorkAvailablePollSourceBase.cs
  - src/Whizbang.Core/Signals/SignalBusServiceCollectionExtensions.cs
  - src/Whizbang.Core/Signals/SignalBusHostedService.cs
testReferences:
  - tests/Whizbang.Hosting.AspNet.Component.Tests/StartupStatusEndpointsTests.cs
  - tests/Whizbang.Transports.FastEndpoints.Tests/Unit/WhizbangStartupStatusEndpointBaseTests.cs
  - tests/Whizbang.Transports.HotChocolate.Tests/Unit/StartupStatusQueryTests.cs
  - tests/Whizbang.Core.Tests/Startup/StartupStagesTests.cs
  - tests/Whizbang.Core.Tests/Startup/StartupStageReporterTests.cs
  - tests/Whizbang.Core.Tests/Schema/SchemaInitializationStagesTests.cs
  - tests/Whizbang.Core.Tests/Startup/StartupStandDownTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupParity/StartupParityTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupStageSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupStageHostTests.cs
  - tests/Whizbang.Core.Tests/Startup/StartupStageHostLifecycleTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/HeartbeatStartPointTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/HeartbeatWorkerStartupBeatTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartingInstanceHeartbeatE2ETests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperStartupHeartbeatTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/StandbyWatcherUpgradeStandDownTests.cs
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
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupHostedServiceAuditTests.cs
  - tests/Whizbang.Core.Component.Tests/Signals/SignalBusHostingTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/WhizbangWorkerRegistrationTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/WorkerStartGateSourceGuardTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupStopBeforeReadyTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupHealthWhileMigratingTests.cs
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
| 10 | Preflight | `Stage 1 of 7` | `Connecting` | the host lifecycle, as the host starts; schema initialization reports the [Assess](rolling-upgrades#assess) read, the bootstrap closure and the instance's registration as progress within it. A [stood-down instance](#stood-down) stays here |
| 20 | Elect | `Stage 2 of 7` | `Migrating` | schema initialization: the vote for the migrator, then its result, or skipped when the schema is current |
| 30 | Migrate | `Stage 3 of 7` | `Migrating` | schema initialization: the schema pass, or skipped when the schema is current |
| 40 | Converge | `Stage 4 of 7` | `Migrating` | schema initialization: index statistics and the managed-object reconcile |
| 50 | Coordinate | `Stage 5 of 7` | `Migrating` | the shared initializer, before the schema-ready gate opens |
| 60 | Accept commands | `Stage 6 of 7` | `AcceptingCommands` | the lifecycle's AcceptingCommands transition |
| 70 | Running | `Stage 7 of 7` | `Running` | the lifecycle's Running transition |
| 80 | Draining | `Shutdown stage` | `Stopping` | the [run-control path](#shutdown-takes-the-run-control-path)'s stop, once the run permit is closed; on host shutdown, before any worker stops |
| 90 | Stopped | `Shutdown stage` | `Stopped` | the run-control path, once the work in hand is finished and held work and roles are released; on host shutdown, still before any worker stops |

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
Shutdown stage: Draining - stopping, finishing in-flight work
Shutdown stage: Stopped - stopped
```

The pattern is `Stage X of 7: <name> - <message>` for a startup stage and `Shutdown stage: <name> - <message>` for
Draining and Stopped. Stages only move forward: entering an earlier stage changes nothing. A new message within the
current stage is progress: it logs the line again and keeps the stage's entry time. A skipped stage logs
`skipped: <reason>` as its message.

### Shutdown takes the run-control path {#shutdown-takes-the-run-control-path}

When the host starts to stop, `StartupStageHostLifecycle.StoppingAsync` completes the
[one exit path](instance-exits) on the host's stop token, before any hosted service stops: the exit under way, or a
`HostShutdown` when nothing asked for one. The exit takes the
[one run-control path](../../resilience/managed-resource-run-control#one-run-control-path) with the reason `Stop`,
writes the exit's one entry and row, and sets the exit code. The path, not the host lifecycle, writes both shutdown
stages:

1. The run permit closes: no worker takes new work, and every transport consumer pauses its subscriptions.
2. **Draining** is written with `stopping, finishing in-flight work`. The instance stops being eligible for work at
   once, while its heartbeat is still fresh.
3. The work in hand is finished, bounded by [`Whizbang:Lifecycle:HeldWorkTimeout`](../configuration/configuration-reference#whizbanglifecycleoptions)
   (20 seconds by default) and by the host's stop token; the leased streams no drain has started are released, then
   every role this instance holds.
4. **Stopped** is written with `stopped`.

Only then do the hosted services stop. `StoppedAsync` writes nothing, because the path has already confirmed the stop.
{verified: StartupStageHostLifecycleTests.Stopping_CompletesTheExitPath_OnTheHostsStopTokenAsync, WhizbangInstanceExitTests.AHostStopNoCauseAskedFor_IsAHostShutdownAsync, WhizbangRunControllerTests.Halt_WithTheCallersBudgetAlreadySpent_StillClosesThePermitAndWritesBothPhasesAsync, WhizbangRunControllerTests.Halt_AReleaseThatBlocksUntilCanceled_IsCutShortByTheCallersToken_AndTheHaltCompletesAsync, StartupStageHostLifecycleTests.Stopped_WritesNothing_ThePathAlreadyConfirmedTheStopAsync, StartupStageHostTests.AGracefulStop_RecordsDraining_ThenStoppedAsync, StartupStageRunControlTests.APhaseThatIsAStage_EntersItAsync}

**Why Stopped is written before the workers stop.** `Stopped` says the instance has finished: nothing is in hand and
nothing is held. The path knows that once it has released the work and the roles; waiting for every hosted service to
stop added nothing a peer could use and risked the write being cut off by the end of the host's stop budget.

**Why the messages no longer say "host".** The killswitch's stop takes the same path and writes the same two stages, so
the message describes the stop, not who asked for it.

**Why the host's stop token bounds the path.** Releasing work and roles against an unreachable database could
otherwise wait out each command's timeout and run past `HostOptions.ShutdownTimeout`, so the process would end before
`Stopped` was written. The stop token bounds every step instead: a step it cuts short is logged and the path moves on,
and what it did not release lapses to a peer. Both phases are written on a token of their own, so even a stop whose
budget is already spent closes the permit, records Draining and Stopped, and never turns a graceful stop into an
exception.

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
| `the schema is current; registering this instance` | Preflight's last step when the [Assess verdict](rolling-upgrades#current) is `Current`: no bootstrap is applied, the instance joins the registry, then Elect and Migrate are skipped |

Before any of these, the [Assess](rolling-upgrades#assess) verdict is read, on either driver, and two more lines can appear:

| Message | When |
|---|---|
| `the schema version record could not be read for a moment (<reason>); retrying` | The version record failed to read transiently; Assess [retries within Preflight](rolling-upgrades#unreadable-version-record) |
| `the schema version record could not be read; this attempt stops here rather than migrate blind` | The failure is not transient; the attempt fails with a `StartupAssessmentException` and the next attempt reads again |

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
| `application_version` | `TEXT` | The version of the application the instance runs (migration 316): SemVer text, `deploy:<n>` for a host-supplied deploy number, `NULL` when unknown. Recorded at registration, like `library_version`; see [Both versions](#both-versions) |
| `liveness_window_seconds` | `INTEGER` | How old the instance's heartbeat may get before [the liveness rule](../../fundamentals/workers/instance-liveness#liveness-rule) calls it not live, declared by the instance from its own cadence (migration 316). Recorded at registration, with `connection_mode`, so the rule judges a starting instance by its own window from the moment its row exists; a beat without one keeps the recorded value, and `NULL` (an older build) is judged by 30 s |
| `incompatibility_override` | `TEXT` | The reason Assess would have stood the instance down, when it started past that verdict with [the incompatibility override](rolling-upgrades#the-incompatibility-override) (migration 360); `NULL` on every other instance. Written once the instance registers; the heartbeat leaves it alone |

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

#### Both versions {#both-versions}
{verified: ApplicationVersionTests.Resolve_AnExplicitVersion_OverridesTheEntryAssemblyAsync, ApplicationVersionTests.Resolve_ADeployNumber_OverridesTheEntryAssemblyAsync, ApplicationVersionTests.Resolve_EntryInformationalVersionThatIsSemVer_IsTheVersionAsync, ApplicationVersionTests.Resolve_EntryVersionThatIsNotSemVer_IsUnknownAsync, ApplicationVersionTests.Resolve_BothAnExplicitVersionAndADeployNumber_FailsLoudlyAsync}

Every instance row records **two** versions: the library version (`library_version`) and the version of the
application built on it (`application_version`). Either can be what a rollout changes, so the record keeps both, and
the [migration ledger](../infrastructure/migrations#version-auditing) records the same application version beside the
library version of whoever migrated.

The application version is resolved once per process, in this order:

1. **A version the host supplies.** `Whizbang:Application:Version` (SemVer) or `Whizbang:Application:DeployNumber` (a
   monotonic whole number, recorded as `deploy:<n>`). Set at most one; see the
   [configuration reference](../configuration/configuration-reference#application-version).
2. **The entry assembly's informational version**, when it reads as SemVer (build metadata is dropped).
3. **Otherwise unknown**: the row records `NULL`.

```bash{title="Supply the application version" description="A host that knows its own release names it; a pipeline with only a build counter supplies a deploy number instead. Setting both fails startup." category="Configuration" difficulty="BEGINNER" tags=["Startup", "Versioning", "Configuration"] tests=["ApplicationVersionTests.FromConfiguration_ReadsTheExplicitVersionAsync", "ApplicationVersionTests.FromConfiguration_ReadsTheDeployNumberAsync", "ApplicationVersionRegistrationTests.TheRegistration_ResolvesFromConfigurationAsync"]}
Whizbang__Application__Version=2.4.0
# or, instead:
Whizbang__Application__DeployNumber=418
```

The heartbeat and a [stood-down instance's](#stood-down) beat both record it, the same way as the library version:
only as a registration (a row a beat inserts, a row that records none, or a new process under the same instance id),
never over a recorded value. A host registers its own `IApplicationVersionProvider` to supply the version in code; the
worker pipeline's registration leaves it in place.

| Choice | Reason | Verified |
|---|---|---|
| A version the host supplies overrides the entry assembly's. | The host knows what it deployed; an entry assembly's version can be a default nobody sets. | {verified: ApplicationVersionTests.Resolve_AnExplicitVersion_OverridesTheEntryAssemblyAsync, ApplicationVersionTests.Resolve_ADeployNumber_OverridesTheEntryAssemblyAsync, ApplicationVersionRegistrationTests.AHostsOwnProvider_WinsAsync} |
| Setting both keys, a `Version` that is not SemVer, or a `DeployNumber` that is negative or not a whole number fails startup. | A host that says what it runs explicitly is told at once that it said it wrong, never read as unknown. | {verified: ApplicationVersionTests.Resolve_BothAnExplicitVersionAndADeployNumber_FailsLoudlyAsync, ApplicationVersionTests.Resolve_AnExplicitVersionThatIsNotSemVer_FailsLoudlyAsync, ApplicationVersionTests.Resolve_ANegativeDeployNumber_FailsLoudlyAsync, ApplicationVersionTests.FromConfiguration_ADeployNumberThatIsNotANumber_FailsLoudlyAsync} |
| An entry assembly version that is not SemVer, or none at all, is unknown. | A version that cannot be ordered must not pretend it can. | {verified: ApplicationVersionTests.Resolve_EntryVersionThatIsNotSemVer_IsUnknownAsync, ApplicationVersionTests.Resolve_NoEntryVersion_IsUnknownAsync} |
| An unknown version never orders against anything, and a SemVer and a deploy number never order against each other. | An unknown version must never stand another instance down, or be stood down by the application version alone; two schemes say nothing about each other. | {verified: ApplicationVersionTests.CompareTo_AnUnknownVersion_NeverOrdersAsync, ApplicationVersionTests.CompareTo_DifferentSchemes_NeverOrderAsync, ApplicationVersionTests.CompareTo_TwoSemVers_OrderByPrecedenceAsync, ApplicationVersionTests.CompareTo_TwoDeployNumbers_OrderNumericallyAsync} |
| The row records it at registration only, like the library version; an unknown version is sent as nothing. | One process runs one version; a beat that rewrote it could only bring back the races a registration-only write removed. | {verified: InstanceLivenessRuleSqlTests.Heartbeat_RecordsTheApplicationVersionOnlyAsARegistrationAsync, HeartbeatWorkerRequestFieldsTests.BuildRequest_CarriesTheApplicationVersionAsync, HeartbeatWorkerRequestFieldsTests.BuildRequest_AnUnknownApplicationVersion_IsNotRecordedAsync} |
| The worker pipeline registers the version once per process, and a provider the host registered is kept. | Every writer (the heartbeat, the stand-down beat, the ledger) reads the same value. | {verified: ApplicationVersionRegistrationTests.TheCorePipeline_RegistersItAsync, ApplicationVersionRegistrationTests.AHostsOwnProvider_WinsAsync} |

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

**The registration records how the instance is judged.** The bootstrap registration at the end of Preflight records
the instance's connection mode and liveness window (`InstanceRegistrationLiveness`), read the way the heartbeat reads
them: the mode from the driver (pooled when it does not say) and the window from the heartbeat's cadence. Before, the
registration recorded no window, so the rule judged a starting instance by the 30 seconds it gives a row that records
none.
{verified: SchemaBootstrapPhaseTests.ARegistration_RecordsTheConnectionModeAndTheLivenessWindowAsync, InstanceRegistrationLivenessTests.WithTheHostsSourceAndCadence_TheModeAndTheWindowAreTheHeartbeatsAsync, InstanceRegistrationLivenessTests.WithNeitherRegistered_TheModeIsPooled_AndTheWindowIsTheDefaultCadencesAsync, InstanceRegistrationLivenessTests.WithNoServices_NothingIsDeclaredAsync, DapperSchemaStartupTests.HostStart_RegistersThisInstance_WithItsConnectionModeAndLivenessWindowAsync}
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

### The startup beat {#the-startup-beat}

The heartbeat starts when the instance registers, not when its schema is ready: the worker pipeline hosts
`HeartbeatWorker` at Elect (`HeartbeatWorker.StartsAt`), the first stage after Preflight's registration. Until the
schema-ready gate opens, each beat is a **startup beat**, `IWorkCoordinator.RecordStartupHeartbeatAsync`, which calls
`wh_record_startup_heartbeat` (migration 362, in the bootstrap closure so it exists from Preflight on). A startup beat:

- refreshes the heartbeat, the connection mode and the liveness window of the instance's existing row, and nothing else;
- never inserts a row (a row without a phase reads as an older build, eligible for work);
- never writes the stage or the lifecycle phase, which only the [stage record](#one-writer-of-the-phase) writes;
- reaps no peer (a starting instance is not yet the fleet's reaper) and announces no join;
- refuses an evicted instance, as the full heartbeat does, so a starting instance that was evicted
  [exits](instance-exits#evictions).

The first beat after the gate opens is due at once, not on the next cadence boundary, and is the full heartbeat, which
registers, reaps and announces the join as before. Readiness is unchanged: a starting instance stays out of the claim
ranking and the partition assignment, holds no role but the migrator, and reads as migrating in the fleet status, until
it records Accept commands. On the Dapper driver, which applies no bootstrap closure and registers after its pass, a
startup beat before the pass has created the function is accepted and writes nothing.

| Behavior | Why | Verified by |
|---|---|---|
| The heartbeat starts at Elect, and a test fails if it moves later. | An instance registered at the end of Preflight and beat only once its schema was ready, so a peer's reap evicted an instance still electing or migrating once 30 seconds passed. | {verified: HeartbeatStartPointTests.TheHeartbeat_StartsAtElect_TheFirstStageAfterRegistrationAsync, HeartbeatStartPointTests.TheWorkerPipeline_HostsTheHeartbeatAtItsStartPoint_AndNowhereElseAsync, StartupHostedServiceAuditTests.HeldInMigrate_OnlyTheHeartbeatAndTheNotificationConnectionHaveStarted_NoRoleNorDataPlaneWorkerAsync} |
| A starting instance held in Migrate past 30 seconds is not evicted by a live peer's reap. | The rule judges it by beats it really sends, against the window it declared at registration. | {verified: StartingInstanceHeartbeatE2ETests.AStartingInstanceHeldInMigrate_PastThirtySeconds_IsNotEvictedByALivePeersReapAsync, DapperStartupHeartbeatTests.AStartupBeat_KeepsAStartingInstanceLive_PastThirtySeconds_AndAPeersReapLeavesItAsync, SchemaBootstrapPhaseTests.AnEmptyDatabase_BeatsAStartingInstanceAfterTheBootstrap_BeforeAnyMigrationAsync} |
| A startup beat never moves the stage or the phase, inserts no row, and keeps the instance ineligible for work. | The stage record is the one writer of the phase; a beat that wrote it could only bring back the races that rule removed. | {verified: StartingInstanceHeartbeatE2ETests.AStartingInstanceThatBeats_KeepsItsStageAndPhase_AndIsNotEligibleForWork_UntilItRecordsAcceptingCommandsAsync, StartingInstanceHeartbeatE2ETests.TheFleetReadModel_ShowsAStartingInstanceAsMigrating_LiveAndNotEvictedAsync, DapperStartupHeartbeatTests.AStartupBeat_NeverMovesTheStageOrThePhase_AndRecordsTheModeAndTheWindowAsync, DapperStartupHeartbeatTests.AStartupBeat_OfAnInstanceWithNoRow_InsertsNothingAsync, HeartbeatWorkerStartupBeatTests.BeforeTheSchemaIsReady_AnAcceptedBeat_IsRecorded_ButWritesNoStageAndAnnouncesNoJoinAsync} |
| A startup beat of an evicted instance is refused. | An evicted instance learns it the same way whether it is starting or running. | {verified: DapperStartupHeartbeatTests.AStartupBeat_OfAnEvictedInstance_IsRefusedAsync, StartingInstanceHeartbeatE2ETests.AStartupBeat_OfAnEvictedInstance_IsRefused_AndOfAnUnregisteredOne_WritesNothingAsync, HeartbeatWorkerStartupBeatTests.BeforeTheSchemaIsReady_ARefusedBeat_EndsTheLoopAsEvictedAsync} |
| Before the schema is ready a beat is the startup beat; once the gate opens the next beat is the full heartbeat, at once. | The full heartbeat needs tables the bootstrap closure does not create, and once they exist the row is registered and any held stage written without waiting a cadence. | {verified: HeartbeatWorkerStartupBeatTests.BeforeTheSchemaIsReady_ABeat_GoesThroughTheStartupHeartbeat_WithTheModeAndTheWindowAsync, HeartbeatWorkerStartupBeatTests.OnceTheGateOpens_TheNextBeatIsDueAtOnce_AndIsTheFullHeartbeatAsync, HeartbeatWorkerStartupBeatTests.WithAnOpenGate_EveryBeatIsTheFullHeartbeatAsync, HeartbeatWorkerStartupBeatTests.TheLoop_AfterAStartupBeat_BeatsInFullWhenTheGateOpens_WithoutWaitingForItsCadenceAsync, HeartbeatWorkerStartupBeatTests.TheWait_WhileTheGateIsClosed_EndsWhenTheGateOpensAsync, HeartbeatWorkerStartupBeatTests.TheWait_AfterAStartupBeat_WhenTheGateOpenedSinceThePlan_EndsAtOnceAsync} |
| On Dapper, a startup beat before the pass created its function is accepted and writes nothing; any other failure throws. | The Dapper driver registers after its pass; a beat before then has no row to refresh, and a real failure must not be hidden. | {verified: DapperStartupHeartbeatTests.AStartupBeat_BeforeThePassCreatedItsFunction_IsAcceptedAndWritesNothingAsync, DapperStartupHeartbeatTests.AStartupBeat_ThatFailsForAnyOtherReason_ThrowsAsync} |
| A custom `IWorkCoordinator` that does not override it sends the full heartbeat. | A coordinator with no schema to wait for has nothing to stage. | {verified: WorkCoordinatorDefaultInterfaceTests.RecordStartupHeartbeatAsync_DefaultImplementation_IsTheHeartbeatAsync} |

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

### A stood-down instance stays in Preflight {#stood-down}

An instance whose [Assess verdict](rolling-upgrades#standing-down) is `StandDown` (a newer version is online, or the
database holds a change applied since its version) never leaves Preflight. It records its stage as Preflight with the message `standing down: ` followed by the
reason, which names the version the ledger records and the binary's own, and its phase as `Pausing`, then `StandingBy`,
each a phase-only write like any [stand-by](#pause-and-standby): the stand-down takes the
[run-control path](rolling-upgrades#stand-down-takes-the-run-control-path), which writes both. It registers at once, keeps its row alive on the heartbeat interval
until the host stops, and is never eligible for work. Elect, Migrate, Converge and Coordinate are never entered, and
the schema-ready gate never opens, so readiness answers 503 while liveness stays healthy.

Each of its beats declares the window [the liveness rule](../../fundamentals/workers/instance-liveness#liveness-rule)
judges it by, derived from the beat's own interval the way the heartbeat worker derives its own (three of its beats;
the stand-down beat has no slow cadence), so it is never reaped between beats. Each beat also carries the
[application version](#both-versions), recorded at registration.
{verified: StartupStandDownTests.FromServices_BeatsOnTheHeartbeatCadence_AsTheRegisteredInstanceAsync}

```sql{title="Instances that stood down" description="Every instance held in Preflight because its Assess verdict was StandDown, with the reason" category="Operations" difficulty="BEGINNER" tags=["Startup","SQL","RollingUpgrades"] tests=["StartupStageSqlTests.Stages_ListEveryInstance_WithItsPositionMessageAndTimeInStageAsync","StartupStandDownTests.Record_StaysInPreflight_NamingTheReason_AndStandsByAsync"]}
SELECT service_name, host_name, startup_stage_message, time_in_stage
FROM wh_instance_startup_stages()
WHERE startup_stage_message LIKE 'standing down: %';
```

**A stand-down while running keeps its stage.** An instance that [stands down while serving](rolling-upgrades#cluster-wide-stand-down)
keeps the stage it reached (Running, say) and records why as the stage's message, before the run-control path writes
`Pausing` and `StandingBy`: `standing down: ` followed by the reason, which names the newer version and the instance it
runs on, or the changes the [rollback gate](rolling-upgrades#the-rollback-gate) found. When it
[resumes](rolling-upgrades#resuming), the message becomes `resumed: ` followed by the reason the verdict now gives. The
same query finds both:
{verified: StandbyWatcherUpgradeStandDownTests.StandingDown_SaysWhyOnTheRow_BeforeThePhase_AndIsLoggedOnceAsync, StandbyWatcherUpgradeStandDownTests.TheNewerInstanceDies_TheStoodDownInstanceResumes_BecauseAFreshStartWouldServeAsync}

```sql{title="Instances standing down or resumed while running" description="The stage message a runtime stand-down or resume records, with the reason" category="Operations" difficulty="BEGINNER" tags=["Startup","SQL","RollingUpgrades"] tests=["StandbyWatcherUpgradeStandDownTests.StandingDown_SaysWhyOnTheRow_BeforeThePhase_AndIsLoggedOnceAsync","StartupStageSqlTests.Stages_ListEveryInstance_WithItsPositionMessageAndTimeInStageAsync"]}
SELECT service_name, host_name, stage_name, lifecycle_phase, startup_stage_message, time_in_stage
FROM wh_instance_startup_stages()
WHERE startup_stage_message LIKE 'standing down: %' OR startup_stage_message LIKE 'resumed: %';
```

**Why Preflight and not a stage of its own.** The stage says how far startup got, and a stood-down instance got no
further than reading the verdict. The phase says why it is not serving. A new stage number would put a state that is
not a step of startup on the startup ladder.
{verified: StartupStandDownTests.Record_StaysInPreflight_NamingTheReason_AndStandsByAsync, StartupStandDownTests.KeepVisible_RegistersAtOnce_ThenOnEveryBeat_UntilTheHostStopsAsync, StartupParityTests.ANewerSchema_StandsDown_AppliesNothing_AndKeepsTheGateClosed_WhileVisibleAsync}

### Seeing every instance's stage {#seeing-every-instances-stage}

`wh_instance_startup_stages()` lists every registered instance, ordered by service, with its stage, the stage's
name and `X of 7` position (`NULL` for a shutdown stage), message, entry time, time in stage, lifecycle phase and
whether it is [eligible for work](../../fundamentals/work-coordinator/partition-assignment):

```sql{title="Every instance's startup stage" description="The operator query over the recorded startup stages" category="Operations" difficulty="BEGINNER" tags=["Startup","SQL"] tests=["StartupStageSqlTests.Stages_ListEveryInstance_WithItsPositionMessageAndTimeInStageAsync"]}
SELECT service_name, host_name, stage_name, stage_position, stage_count,
       startup_stage_message, time_in_stage, eligible_for_work
FROM wh_instance_startup_stages();
```

### What a fresh database and a restart record {#what-a-fresh-database-and-a-restart-record}

All three start the same way. Preflight is held until its last step registers the row, so the first stage the row
records is Preflight (10); every stage line before it (`host starting`, and any wait or retry) is log-only. They
differ in Elect and Migrate, which follow the [Assess verdict](rolling-upgrades#assess):

- **A fresh database** (`Migrate`): Preflight is recorded as `the bootstrap closure is in place; registering this
  instance`, Elect with the election's result, and Migrate with the schema pass it runs.
- **A restart whose schema is not yet shown current** (`Serve`): the same Preflight and Elect, and Migrate recorded as
  skipped once the pass's fast path finds every hash matching (`Stage 3 of 7: Migrate - skipped: the schema is
  already current`). The first restart after a fresh start is one of these on a model with stored forms, because
  its pass is the one that [settles them](rolling-upgrades#current).
- **A restart on a current schema** (`Current`): Preflight is recorded as `the schema is current; registering this
  instance`, then Elect and Migrate are both skipped with the reason, and nothing takes the schema lock:

```text{title="A restart on a current schema" description="The stage lines of an instance whose Assess verdict is Current: Elect and Migrate are skipped, Converge and Coordinate run" category="Operations" difficulty="BEGINNER" tags=["Startup","Logging","RollingUpgrades"] tests=["SchemaInitializationStagesTests.OnACurrentSchema_ElectAndMigrateAreSkipped_AfterRegisteringAsync","StartupParityTests.ARestartOnACurrentSchema_TakesNoSchemaLock_AndSkipsElectAndMigrateAsync"]}
Stage 1 of 7: Preflight - the schema is current; registering this instance
Stage 2 of 7: Elect - skipped: the schema is current; no migrator is needed
Stage 3 of 7: Migrate - skipped: the schema is current
Stage 4 of 7: Converge - analyzing new indexes and reconciling managed objects
Stage 5 of 7: Coordinate - recomputing partitions before the schema-ready gate opens
```

**Why skip Elect too.** The election exists to pick the one instance that migrates. With nothing to migrate there is
no migrator to pick, and a normal restart or scale-out should not wait on a lock that another instance's migration
may be holding, so a current schema skips the election and the migration locks entirely.
{verified: StartupParityTests.ARestartOnACurrentSchema_TakesNoSchemaLock_AndSkipsElectAndMigrateAsync, SchemaInitializationStagesTests.OnACurrentSchema_ElectAndMigrateAreSkipped_AfterRegisteringAsync}

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
ends Preflight for it as for the EF Core driver. On a current schema it skips Elect and Migrate with the same reasons
as the EF Core driver (`the schema is current; no migrator is needed`, `the schema is current`). The
[managed-resource health](../../resilience/managed-resource-health#startup-stage) `startup` component reports the same
stage line.

## What runs in each stage {#what-runs-in-each-stage}

An instance's own workers start at the stage they need, not when the host starts. A worker that starts with the host
reads and writes tables the migration may be altering in the same moment and, on a fresh database, tables and
functions that do not exist yet. Starting each at its stage means no worker of the instance touches the database during
Preflight, and a starting instance no longer deadlocks its own migration.

A worker does not decide its start for itself. It is **registered with its start point**, and the host starts it
there: the worker holds no wait of its own, so a new worker cannot start early by forgetting one (see
[Registering a worker with its start point](#add-whizbang-worker)). Preflight's only database work is schema
initialization's own: the [bootstrap closure](../infrastructure/migrations#bootstrap-waits-for-the-lock), then the
instance's registration as Preflight's last step, so the notification connection, which starts at Elect, starts
after the registration.

| From | What starts | Why then |
|---|---|---|
| Elect (after Preflight registers the instance) | The notification connection: its `LISTEN`s and the instance's [alive-lock](../../fundamentals/workers/instance-liveness#alive-lock-source) claim. The [signal bus](../../fundamentals/signal-bus/signal-bus#hosting-self-test-and-liveness): its transports, its pull sources and its wire-route self-test. The heartbeat (`HeartbeatWorker`), whose beats are [startup beats](#the-startup-beat) until the schema is ready. The `roles` [health component](../../resilience/managed-resource-health#roles) reads role assignments from here on. | The election that follows reads the alive-lock. The bus's self-test sends a loopback `NOTIFY` that comes back over the notification connection, so it can only pass once that connection is up. The heartbeat starts once the row exists, so a peer's reap judges the instance by beats it really sends while it elects and migrates. |
| Coordinate | The duty holder (the maintainer vote, and the vacuum it runs on winning) and the [partition assigner](../../fundamentals/work-coordinator/partition-assignment). | Both vote and write against the instance and role tables, which the migration may still be changing until then. |
| The schema-ready gate opens (the end of Coordinate) | The work-available probes send their first query; until then each probe tick sends nothing. The heartbeat's first full beat, due at once. The work that keeps the instance coordinated while it is not yet eligible for work: the instance-lifecycle monitor, the standby watcher, the statistics collectors (table statistics, event-type bytes, notify debounce), the type-definition and message-type registry reconcilers, and the shutdown deregistration. | The schema exists from here on. The full heartbeat registers, reaps and announces the join, so the fleet sees the instance as alive while it is still converging, and Kubernetes is told it is degraded rather than unresponsive (see [Probes during a migration](../../resilience/managed-resource-health#probes-during-a-migration)). |
| Accept commands, once the instance's row records it | The data plane (claim, perspective, inbox dispatch, handler and drain, outbox publish and drain, the completion, failure and lease-renewal flushes, maintenance, coalesce ship, integrity, repair drain, subscription expansion, dead-letter recovery, the transport dead-letter drain, backup ticks, schedules, multi-stream commands, the orphan-inbox janitor, the commit-order stamper and the durable-signal workers) and the **transport consumer**. | Accept commands is the stage that makes the instance eligible for work, and the gate is told of it only after the row has been written, so nothing claims, drains or receives while the row still says the instance may not. The transport consumer receives while the read models catch up, rather than waiting for Running. |

{verified: HeartbeatStartPointTests.TheHeartbeat_StartsAtElect_TheFirstStageAfterRegistrationAsync, StartupStageWiringTests.TheNotificationConnection_StartsAtTheEndOfPreflight_OnceAsync, StartupStageWiringTests.TheSignalBus_StartsAtElect_WithTheNotificationConnection_OnceAsync, StartupPreflightHostTests.HeldInPreflight_TheSignalBusStartsNoTransport_AndStartsItAtElectAsync, StartupStageWiringTests.TheDutyHolderAndThePartitionAssigner_StartAtCoordinateAsync, StartupStageWiringTests.EveryWorkAvailableProbe_ReadsTheSchemaReadyGateAsync, StartupStageWiringTests.TheRolesHealthComponent_ReadsNothingBeforeElectAsync, PgWorkAvailablePollSourceSchemaGateTests.WhileTheSchemaGateIsClosed_ATickSendsNothing_AndOnceOpenItQueriesAsync, StartupPreflightHostTests.NothingVotesBeforeCoordinate_AndNoWorkerAsksForAnObjectThatDoesNotExistYetAsync, StartupPreflightHostTests.TheInstanceRow_IsRegisteredAtTheEndOfPreflight_BeforeElectAsync}

The election for the migrator itself runs as before: it is what Elect is, run by schema initialization, and it waits
for nothing.

A stage counts as reached once the instance has entered or skipped it, or entered any later startup stage. Every stage
up to Coordinate also counts as reached once the schema-ready gate is open, because the gate opens only at the end of
Coordinate. A host whose schema is provisioned out of band has a gate that is open from the start, so its workers
never wait. A shutdown stage reaches nothing: an instance that starts to drain before a worker's stage never starts
that worker, and so never stops it.
{verified: StartupStageGateTests.EnteringAStage_ReachesItAndEveryStageBeforeIt_ButNotTheOnesAfterAsync, StartupStageGateTests.ASkippedStage_IsReachedLikeAnEnteredOneAsync, StartupStageGateTests.TheSchemaReadyGate_ReachesEveryStageUpToCoordinate_AndNoLaterOneAsync, StartupStageGateTests.AnAlreadyOpenSchemaGate_MeansNoWaitAtAllAsync, StartupStageGateTests.AShutdownStage_ReachesNothing_SoAWorkerWaitingForItsStageNeverStartsAsync, StartupStageGatedServiceTests.StoppedBeforeItsStage_TheServiceIsNeverStartedOrStoppedAsync}

### The data plane starts on the recorded transition {#data-plane-on-the-recorded-transition}
{verified: StartupStageHostTests.TheDataPlane_StartsOnlyOnceTheRowRecordsAcceptCommandsAsync, StartupStageGateTests.AnEligibleStage_WhoseRowWriteFailed_IsNotReachedUntilTheRowRecordsItAsync, WhizbangWorkerRegistrationTests.AFailedAcceptCommandsWrite_HoldsTheDataPlane_UntilTheNextHeartbeatWritesItAsync, WhizbangWorkerRegistrationTests.AHostWithNoStorage_StartsItsDataPlaneAtAcceptCommandsAsync, StartupStageReporterTests.WithoutAWorkCoordinator_ThereIsNothingToRecord_SoEachStageIsReportedAsCurrentAsync, StartupStageReporterTests.ACoordinatorThatKeepsNoInstanceRows_IsNotWritten_AndEachStageIsReportedAsCurrentAsync}

The schema-ready gate opens at the end of Coordinate; the instance's row records Accept commands, the stage that makes
it eligible for work, a moment later. Earlier releases started claim, drain, flush and the transport consumer on the
gate, so they could claim inside that window, while the row still said the instance was not eligible. Now Accept
commands counts as reached for a worker only once the [stage record](#the-instance-row) has written it:

- **The gate follows the row.** The stage gate is told of Accept commands after the reporter has written the row, so no
  data-plane worker starts before the row says the instance is eligible.
- **A failed write holds the data plane, and recovers on its own.** A stage write that fails is held, as every stage
  write is. The next accepted heartbeat's registration signal writes it, and that write opens the data plane. Holding
  is the safe direction: a stage the row does not show yet keeps the instance out of work, and the heartbeat already
  retries the write, so the instance is never stranded.
- **A host with no storage opens at once.** A work coordinator says whether it keeps instance rows
  (`IWorkCoordinator.RecordsInstanceTransitions`: false by default, true for the EF Core and Dapper drivers). With none,
  there is no row to wait for, so every stage counts as recorded and the data plane starts at Accept commands with no
  wait.

The database refuses an ineligible caller as well, so a data-plane worker that somehow runs early still claims nothing:
see [An ineligible caller claims nothing](../../fundamentals/work-coordinator/claim-loop#ineligible-caller-claims-nothing).

### Registering a worker with its start point {#add-whizbang-worker}
{verified: WhizbangWorkerRegistrationTests.AddWhizbangWorker_StartsAtAcceptCommandsByDefault_AndHostsTheRegisteredSingletonAsync, WhizbangWorkerRegistrationTests.AddWhizbangWorker_AtANamedStage_WithAFactory_HostsWhatTheFactoryReturnsAsync, WhizbangWorkerRegistrationTests.AddWhizbangWorkerAtSchemaReady_HostsTheWorkerBehindTheSchemaReadyGateAsync, WhizbangWorkerRegistrationTests.AtSchemaReady_TheWorkerStartsOnlyOnceTheGateOpensAsync, WhizbangWorkerRegistrationTests.EachWrapper_SaysWhatItStartsAndWhereAsync}

`AddWhizbangWorker<TWorker>(stage)` is the path for every worker, the framework's and your own. It registers the worker
as a singleton (unless one is registered already) and hosts it in a wrapper that the host starts with every other
hosted service; the wrapper starts the worker once the instance reaches the stage, and stops it normally on shutdown.
With no stage named, the worker starts at **Accept commands**, which is the safe point for anything that reads or writes
the message tables. `AddWhizbangWorkerAtSchemaReady<TWorker>()` starts a worker when the schema-ready gate opens
instead, for work that must run while the instance is alive but not yet eligible.

```csharp{title="Register a worker with its start point" description="The host starts each worker at its registered start point; the worker holds no gate code of its own" category="Workers" difficulty="INTERMEDIATE" tags=["Startup","Hosting","Workers","Registration"] tests=["WhizbangWorkerRegistrationTests.AddWhizbangWorker_StartsAtAcceptCommandsByDefault_AndHostsTheRegisteredSingletonAsync","WhizbangWorkerRegistrationTests.AddWhizbangWorker_AtANamedStage_WithAFactory_HostsWhatTheFactoryReturnsAsync","WhizbangWorkerRegistrationTests.AddWhizbangWorkerAtSchemaReady_HostsTheWorkerBehindTheSchemaReadyGateAsync"]}
// Reads and writes the message tables: starts at Accept commands (the default).
builder.Services.AddWhizbangWorker<OrderArchiveWorker>();

// Starts at a named stage instead.
builder.Services.AddWhizbangWorker<FleetReportWorker>(StartupStage.Running);

// Needs the schema, not eligibility: starts when the schema-ready gate opens.
builder.Services.AddWhizbangWorkerAtSchemaReady<InstanceMetricsWorker>();
```

| Choice | Reason | Locked by |
|---|---|---|
| A worker named without a stage starts at Accept commands. | The default is the conservative one: a worker that touches the message tables cannot start before the instance is eligible for work, so taking the easy path is also the safe one. | {verified: WhizbangWorkerRegistrationTests.AddWhizbangWorker_StartsAtAcceptCommandsByDefault_AndHostsTheRegisteredSingletonAsync} |
| No hosted service waits on the schema-ready gate to decide its own start, except the startup machinery. | About forty workers each held a hand-written wait at the top of their loop, each slightly different, and nothing made the next worker write one. Start is now part of the pipeline. A source guard fails when a hosted service in the library names the gate; the only exceptions are the initializer that opens it, the lifecycle and read-model drivers, the Migrate step and the two wrappers. | {verified: WorkerStartGateSourceGuardTests.NoHostedService_DecidesItsOwnStartOnTheSchemaReadyGate_ButTheStartupMachineryAsync} |
| Every hosted service a turnkey host registers has a start point, or a stated reason it needs none. | A new hosted service fails the audit by name until its author decides when it may first touch the database. | {verified: StartupHostedServiceAuditTests.EveryHostedService_HasAPlaceInTheStageTable_AndTheStagedOnesStartAtTheirStageAsync} |
| The heartbeat starts at Elect, right after registration, not at schema ready or Accept commands. | The heartbeat is what keeps the row fresh and writes a held stage, so it must run before the instance is eligible; and a starting instance that did not beat was evicted by any live peer's reap during a long Elect or Migrate. Until the schema is ready its beats are [startup beats](#the-startup-beat), which need only what Preflight created. The probes tell Kubernetes the instance is alive and degraded at once during a long migration. | {verified: HeartbeatStartPointTests.TheHeartbeat_StartsAtElect_TheFirstStageAfterRegistrationAsync, StartupHostedServiceAuditTests.HeldInMigrate_OnlyTheHeartbeatAndTheNotificationConnectionHaveStarted_NoRoleNorDataPlaneWorkerAsync, StartupHealthWhileMigratingTests.HeldInMigrate_LivenessIsHealthy_AndReadinessSaysNotReadyWithTheStageAsync} |
| Without a stage gate, a stage after Coordinate waits for the schema-ready gate. | A host composed without the worker pipeline records no stages; its workers still must not run before the schema exists. Coordinate and earlier start with the host there, as they did before they were wrapped. | {verified: WhizbangWorkerRegistrationTests.AnEligibleStage_WithNoStageGate_WaitsForTheSchemaReadyGateAsync, WhizbangWorkerRegistrationTests.AStageBeforeTheGate_WithNoStageGate_StartsWithTheHostAsync, WhizbangWorkerRegistrationTests.AnEligibleStage_WithAStageGate_IgnoresTheSchemaReadyGateAsync} |
| A wrapper's schema-ready gate is never null. | A host with no schema to initialize hands the wrapper an already-open gate, so "no gate" can never be read as "a wait was forgotten". | {verified: WhizbangWorkerRegistrationTests.AtSchemaReady_WithNoSchemaToInitialize_TheWorkerStartsWithTheHostAsync, StartupStageGateTests.ANullSchemaGate_IsRefused_BecauseAMissingOneWouldBeAWaitThatNeverHappensAsync} |

The perspective worker that the source generator registers is hosted through the same wrapper, so the generated and
the core registrations deduplicate instead of starting two copies.
{verified: PerspectiveRunnerRegistryGeneratorTests.Generator_HostsThePerspectiveWorkerAtAcceptCommandsAsync}

#### A worker others wait on {#start-abandoned}
{verified: WhizbangWorkerRegistrationTests.StoppedBeforeItsStartPoint_AWorkerThatAsksIsToldItsStartWasAbandonedAsync, WhizbangWorkerRegistrationTests.Started_AWorkerIsNeverToldItsStartWasAbandonedAsync, WhizbangWorkerRegistrationTests.AtSchemaReady_StoppedBeforeTheGateOpens_TheWorkerIsNeverStartedAsync, TransportConsumerWorkerCoverageTests.StoppedBeforeItsStartPoint_SettlesSubscriptionsReadyAsCanceledAsync, PerspectiveWorkerStartupGateTests.StoppedBeforeAcceptCommands_SettlesTheStartupScanSignalAsync}

A host that stops before a worker's start point never starts the worker, and never stops it. When something else waits
on that worker's startup, the wait must still end, so the worker implements `IStartAbandonedObserver`: the wrapper
calls `OnStartAbandoned` once, on the stopping path, for a worker that was never started, and never for one that was.
The transport and Service Bus consumers cancel their `SubscriptionsReady` signal this way, and the perspective worker
its startup-scan signal, rather than leaving them pending for whoever awaits them.

#### Upgrading: a worker added with `AddHostedService` {#upgrading-add-hosted-service}

The `ISchemaReadyGate` constructor parameter is removed from every framework worker that had one; a worker no longer
waits on the gate itself. A host that adds `ServiceBusConsumerWorker`, `PerspectiveMigrationWorker` or a worker of its
own with `AddHostedService` therefore starts it with the host, before the schema is migrated. Register it with
`AddWhizbangWorker` instead:

```csharp{title="Move a hosted worker to AddWhizbangWorker" description="AddHostedService starts a worker with the host, before migration; AddWhizbangWorker starts it at Accept commands" category="Workers" difficulty="BEGINNER" tags=["Startup","Upgrade","Workers","Registration"] tests=["WhizbangWorkerRegistrationTests.AddWhizbangWorker_StartsAtAcceptCommandsByDefault_AndHostsTheRegisteredSingletonAsync"]}
// Before: starts with the host, before the schema is migrated.
// builder.Services.AddHostedService<ServiceBusConsumerWorker>();

// After: starts once the instance's row records Accept commands.
builder.Services.AddWhizbangWorker<ServiceBusConsumerWorker>();
```

#### Finding a hosted worker in a test {#finding-a-hosted-worker}

Because every worker is hosted inside its stage wrapper, looking a worker up by its own type among
`IEnumerable<IHostedService>` finds nothing. Tests use the one shared lookup in `Whizbang.Testing`, which looks
through the wrapper, instead of unwrapping by hand:
{verified: HostedWorkersTests.GetHostedWorker_FindsAStagedWorker_AndAPlainServiceByTypeAsync, HostedWorkersTests.GetHostedWorkers_LooksThroughEveryStageWrapper_AndKeepsAPlainServiceAsync, WorkerStartGateSourceGuardTests.AHostedWorker_IsFoundThroughHostedWorkers_NotByTypeAmongTheWrappersAsync}


```csharp{title="Find a hosted worker through its stage wrapper" description="GetHostedWorker looks through the stage wrapper to the worker it hosts" category="Testing" difficulty="BEGINNER" tags=["Testing","Workers","Startup"]}
var outbox = host.Services.GetHostedWorker<OutboxDrainWorker>();
var all = host.Services.GetHostedWorkers();
```

A guard test fails when a fixture enumerates the hosted services and filters by a worker's type itself, so the shared
lookup is the only way in.

### A host stopped before its schema is ready {#stopped-before-schema-ready}
{verified: StartupStopBeforeReadyTests.AHostStoppedInPreflight_DoesNotDeregister_AndLogsNoWarningOrErrorAsync}

Shutdown deregistration is hosted at schema ready. A host stopped during Preflight or Migrate never
started it, so it has nothing to deregister and ends quietly. Earlier releases ran the deregistration against instance
tables that may not exist yet on a fresh database, and logged the failure at Warning.

### The signal bus starts at Elect {#signal-bus-at-elect}

The signal bus is started at Elect, once, together with the notification connection. Earlier releases started it
with the host, so its wire-route self-test sent `pg_notify` during Preflight, for a loopback that could only come back
over a connection that did not exist yet. A long Preflight, such as a bootstrap waiting for another instance's schema
lock, could then log the self-test as failed although nothing was wrong. Now, while Preflight is held, no signal
transport is started at all, and the bus starts once the instance reaches Elect. Calling `AddWhizbangSignalBus` more
than once still hosts the bus once. A host composed without the worker pipeline has no stage gate and starts the bus
with the host, as before.
{verified: StartupStageWiringTests.TheSignalBus_StartsAtElect_WithTheNotificationConnection_OnceAsync, StartupPreflightHostTests.HeldInPreflight_TheSignalBusStartsNoTransport_AndStartsItAtElectAsync, SignalBusHostingTests.AddWhizbangSignalBus_CalledTwice_HostedStartIsIdempotentAsync}

### When each hosted service starts {#when-each-hosted-service-starts}

Every hosted service a turnkey host registers has a stated answer to one question: when may it first touch the
database? There are five answers.

| Starts | Hosted services | How |
|---|---|---|
| At Elect or Coordinate, through the stage wrapper | Elect: the notification connection (`PgSharedNotifyConnection`), the signal bus (`SignalBusHostedService`) and the heartbeat (`HeartbeatWorker`, at `HeartbeatWorker.StartsAt`). Coordinate: the duty holder (`DutyHolderWorker`) and the partition assigner (`PartitionAssignerWorker`). | The host starts a wrapper; the wrapper starts the service once the instance reaches the stage. |
| At schema ready (`AddWhizbangWorkerAtSchemaReady`) | The instance-lifecycle monitor, the standby watcher, the statistics collectors (`TableStatisticsCollector`, `EventTypeBytesSampler`, `NotifyDebounceStatsCollector`), the type-definition reconciler, the Dapper driver's message-type registry reconciler, and shutdown deregistration (`WhizbangShutdownService`). | The wrapper starts the worker when the schema-ready gate opens, at the end of Coordinate. |
| At Accept commands (`AddWhizbangWorker`) | The data plane: claim, perspective, inbox dispatch, inbox handler, inbox drain, outbox publish, outbox drain, the outbox completion, perspective completion and failure flushes, lease renewal, maintenance, coalesce ship, integrity checkpoint, integrity audit, the integrity sweep scheduler, repair drain, subscription expansion, dead-letter recovery, the transport dead-letter drain, the backup-tick coordinator, schedules, multi-stream commands, the orphan-inbox janitor (opt-in), the commit-order stamper and the durable-signal tail and retention workers. And the transport consumer (`TransportConsumerWorker`). | The wrapper starts the worker once the instance's row records Accept commands. |
| Preflight itself | Schema initialization (`WhizbangDatabaseInitializerService`), the startup pipeline, the stage lifecycle, the ready service, and the lifecycle and read-model drivers that move the instance into Accept commands and Running. | This is the work the stages are made of. |
| No database work at start | Configuration and registration checks and startup log lines; in-memory receptor, tick and hook registrars; subscriptions on the notification connection, which only listen once it starts at Elect; in-process sweeps; the transport backlog peek, which reads the transport's management plane rather than the database; the rebuild worker, which is fed only by a command receptor whose dispatch is deferred until the schema-ready gate opens; the health-check publisher, which runs checks only for a publisher the application registers; and the services that work only when the host stops. | The service starts with the host because it has nothing to wait for. |

The table is enforced. A test composes a host the way an application does (the EF Core Postgres driver, its
notification stack, the worker pipeline, a transport and its consumer), lists every hosted service the host resolves,
finds each worker through its wrapper, and fails naming any service with no place in the table, or a worker registered
directly rather than through the wrapper, or at a different start point. A new hosted service therefore fails that test
until its author decides when it may first touch the database, rather than starting with the host by default. The
opt-in orphan-inbox janitor is checked by its own registration test, and `ServiceBusConsumerWorker` and
`PerspectiveMigrationWorker` are hosted by the application (see
[Upgrading](#upgrading-add-hosted-service)).
{verified: StartupHostedServiceAuditTests.EveryHostedService_HasAPlaceInTheStageTable_AndTheStagedOnesStartAtTheirStageAsync, StartupHostedServiceAuditTests.HeldInMigrate_OnlyTheHeartbeatAndTheNotificationConnectionHaveStarted_NoRoleNorDataPlaneWorkerAsync}

### The alive-lock on a fresh database

On a fresh database the notification connection can open before the migration that creates the alive-lock function
has run. The connection asks the catalog first and, when the function does not exist yet, logs that at Debug and makes
the claim on a later keepalive, once the function exists. `PgSharedNotifyConnection.OnAliveLockClaimed` is raised each
time the claim is made. Earlier releases sent the call anyway, logged its failure (`42883`) at Warning, and did not
claim the lock on that connection again until it was replaced.
{verified: AliveLockSourcePostgresTests.OnADatabaseWithoutTheFunctionYet_TheClaimWaitsQuietly_AndAKeepaliveMakesItOnceItExistsAsync}

### Starting your own hosted service at a stage

Use [`AddWhizbangWorker`](#add-whizbang-worker) for a worker of your own. `AddHostedServiceAtStage` is the
factory form underneath it, for a service resolved some other way; `AddWhizbangWorker(stage, factory)` is the same
with the worker vocabulary:

```csharp{title="Start a hosted service at Coordinate" description="The host starts a wrapper with every other hosted service; the wrapper starts the service once the instance reaches its stage" category="Configuration" difficulty="INTERMEDIATE" tags=["Startup","Hosting","Workers"] tests=["StartupStageGatedServiceTests.Registration_WrapsTheServiceAtItsStage_OncePerServiceTypeAsync","StartupStageGatedServiceTests.TheServiceStarts_OnlyOnceItsStageIsReachedAsync","StartupStageGatedServiceTests.StoppedBeforeItsStage_TheServiceIsNeverStartedOrStoppedAsync"]}
builder.Services.AddSingleton<OrderArchiveWorker>();
builder.Services.AddHostedServiceAtStage(
    StartupStage.Coordinate,
    sp => sp.GetRequiredService<OrderArchiveWorker>());
```

- **When it starts.** The host starts a wrapper with every other hosted service; the wrapper waits for the stage in
  the background and then starts the service. Only startup stages can be waited for.
- **When it stops.** A service stopped before its stage is never started and never stopped (a service that implements
  [`IStartAbandonedObserver`](#start-abandoned) is told). A started one is stopped with the host.
- **Failures.** A fault in a `BackgroundService`'s own loop is the wrapper's fault, so the host handles it exactly as
  it would have handled the service's.
- **Registering twice.** Registering the same service type again changes nothing.
- **Without the worker pipeline.** A host composed without the worker pipeline records no stages and registers no
  stage gate. There a service at Coordinate or earlier starts with the host, as it would unwrapped, and one at a later
  stage waits for the schema-ready gate, so it still never runs before the schema exists.

{verified: StartupStageGatedServiceTests.AFailureOfTheServicesOwnLoop_IsTheWrappersSoTheHostSeesItAsync, StartupStageGatedServiceTests.AStoppedLoop_EndsTheWrapperWithoutAFaultAsync, StartupStageGatedServiceTests.WithNoGate_TheServiceStartsWithTheHostAsync, WhizbangWorkerRegistrationTests.AnEligibleStage_WithNoStageGate_WaitsForTheSchemaReadyGateAsync, StartupStageGateTests.AShutdownStage_CannotBeWaitedForOrAskedAboutAsync, WorkerPipelineStartupStageTests.AddWhizbangWorkers_RegistersOneStageGate_TheReportersObserverAsync}

`IStartupStageGate` is the same check for code that is not a hosted service: `HasReached(stage)` answers now, and
`WaitForAsync(stage, cancellationToken)` completes once the stage is reached.

## Related

- [The Startup Pipeline](startup-pipeline) — the state the surface projects
- [Capabilities and Duties](capabilities-and-duties) — the holdings the fleet section reads
- [Rolling Upgrades](rolling-upgrades) — watching a mixed-version rollout land
- [Database Readiness](../workers/database-readiness#the-startup-status-surface) — the readiness machinery around it
