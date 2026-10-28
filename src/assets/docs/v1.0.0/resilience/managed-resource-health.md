---
title: Managed-Resource Health
pageType: guide
version: 1.0.0
category: Resilience
order: 2
description: State-relative health for the resources Whizbang manages — migrating and paused states are healthy by default
tags: 'health, liveness, readiness, migration, resilience, kubernetes'
codeReferences:
  - src/Whizbang.Core/Health/IWhizbangHealthSource.cs
  - src/Whizbang.Core/Health/HealthPolicy.cs
  - src/Whizbang.Core/Health/WhizbangHealthAggregator.cs
  - src/Whizbang.Hosting.AspNet/WhizbangManagedHealthCheck.cs
  - src/Whizbang.Core/Health/ComponentHealth.cs
  - src/Whizbang.Core/Health/ConnectivityHealthSource.cs
  - src/Whizbang.Core/Health/SchemaHealthSource.cs
  - src/Whizbang.Core/Health/WorkerHealthSource.cs
  - src/Whizbang.Core/Health/StoredFormHealthSource.cs
  - src/Whizbang.Core/Health/WhizbangHealthOptions.cs
  - src/Whizbang.Core/Health/WhizbangHealthServiceCollectionExtensions.cs
  - src/Whizbang.Hosting.AspNet/WhizbangManagedHealthCheckExtensions.cs
  - src/Whizbang.Core/Transports/ITransport.cs
  - src/Whizbang.Core/Offloads/IMessageBodyStore.cs
  - src/Whizbang.Core/Observability/BacklogAgeWorker.cs
  - src/Whizbang.Core/Health/BacklogAgeHealthSource.cs
  - src/Whizbang.Core/Transports/IBacklogPeek.cs
  - src/Whizbang.Transports.AzureServiceBus/AzureServiceBusTransport.cs
  - src/Whizbang.Core/Health/StartupPipelineHealthSource.cs
  - src/Whizbang.Core/Health/RoleAssignmentHealthSource.cs
testReferences:
  - tests/Whizbang.Core.Component.Tests/Health/HealthProbeMustAlwaysAnswerTests.cs
  - tests/Whizbang.Core.Tests/Health/WhizbangHealthAggregatorTests.cs
  - tests/Whizbang.Core.Tests/Health/SchemaHealthSourceTests.cs
  - tests/Whizbang.Core.Tests/Health/WorkerHealthSourceTests.cs
  - tests/Whizbang.Core.Tests/Health/StoredFormHealthSourceTests.cs
  - tests/Whizbang.Core.Tests/Health/ConnectivityHealthSourceTests.cs
  - tests/Whizbang.Core.Tests/Health/TransportHealthWiringTests.cs
  - tests/Whizbang.Core.Tests/Health/OffloadHealthWiringTests.cs
  - tests/Whizbang.Core.Tests/Health/WhizbangHealthDiTests.cs
  - tests/Whizbang.Hosting.AspNet.Tests/WhizbangManagedHealthCheckTests.cs
  - tests/Whizbang.Hosting.AspNet.Tests/AddWhizbangAspNetTurnkeyTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/EventStoreHealthSourceIntegrationTests.cs
  - tests/Whizbang.Core.Tests/Health/RoleAssignmentHealthSourceTests.cs
verifiedAgainstCommit: a64ba9a0
verifiedDate: 2026-08-04
---

# Managed-Resource Health

Whizbang manages infrastructure on your behalf — the event-store database, the message transport, the
body-offload store, the worker pipeline, schema initialization. **Health for those resources is
*state-relative*:** a resource that is intentionally `Starting`, `Migrating`, or `PausedByDesign` is
operating *correctly for the state it is in* — it is **healthy**, not failing. Only the resource can
say whether it is genuinely broken; the framework decides what each state *means* for a probe.

This is why a long non-blocking startup migration no longer rolls a pod back: the readiness check
reports **ready** while migrating (by default), instead of failing and letting a deploy pipeline give
up and revert.

## Turnkey — you get this by default

When the ASP.NET hosting package is present, `AddWhizbang()` folds in
[`AddWhizbangAspNet()`](database-availability-middleware) automatically, which registers two health
checks over every managed resource:

- a **liveness** check tagged `live` (never fails for an intentional state), and
- a **readiness** check tagged `ready` (migrating ⇒ ready by default).

Map them the usual way (`/alive` → `live`, `/health` → `ready`) and a migrating host answers `/alive`
green and `/health` ready — no rollback, no extra code.

## The two layers

**1. A health source per managed resource.** Each resource reports its own state via
`IWhizbangHealthSource`, judged against the current [lifecycle phase](managed-resource-run-control)
(which it reads) — only the resource knows whether, in this phase, it is *supposed to be running*
(report real health) or *supposed to be off* (report healthy-by-design):

```csharp{title="Health source contract" description="Each managed resource reports its own state, phase-aware" category="Implementation" difficulty="BEGINNER" tags=["Resilience","Health"] tests=["WhizbangHealthAggregatorTests.LenientDefault_Migrating_IsDegradedButServingAsync","SchemaHealthSourceTests.FaultedPhase_ReportsDegradedWarningAsync","SchemaHealthSourceTests.HaltedPhase_ReportsFaultedFailureAsync"]}
public enum ComponentState {
  Operational, Starting, Connecting, Migrating,   // coming up / migrating (intentional)
  PausedByDesign, Draining,                        // intentionally off / finishing in-flight
  Degraded, Faulted                               // impaired / genuinely broken
}

public interface IWhizbangHealthSource {
  string Component { get; }                                   // "schema", "workers", "event-store", …
  ValueTask<ComponentHealth> ReportAsync(CancellationToken ct);   // reads IWhizbangLifecycleState
}
```

Whizbang ships the sources for what it owns: `SchemaHealthSource` (→ `Connecting`/`Migrating` while the
gate is closed, → `Degraded` during the fault-record window of a failed migration, → `Faulted` only once
the lifecycle settles in `Halted` — a warning-then-failure escalation), `WorkerHealthSource`
(→ `PausedByDesign` while held, `Draining` on stop), and `ConnectivityHealthSource` — the reusable phase-aware reachability probe drivers
wire for the **event-store DB, transport, and offload**. An `AlwaysRequired` resource (the DB) reports a
failed probe as `Faulted` **even during a migration** (the migration needs it — the depended-on
dependency is never masked); a `RequiredWhenRunning` resource (transport, offload) is only probed while
`Running`. Register your own with `services.AddWhizbangHealthSource<T>()` — you never hand-roll a naive
`SELECT count(*)` that a migration would make fail.

The worker pipeline also registers `StoredFormHealthSource` as the `perspective-stored-forms` component:
`Degraded`, never `Faulted`, while any perspective stream holds a stored document no reader of this
release takes, with the count and the first stream's path and refusal in the detail. The rows are parked
with backoff in the database rather than lost, so the service serves; the component is what makes the
condition visible after the log line scrolled away. See
[when a row cannot be read](../operations/infrastructure/migrations#when-a-row-cannot-be-read).
{verified: StoredFormHealthSourceTests.NothingUnreadableIsOperationalAsync, StoredFormHealthSourceTests.AnUnreadableStreamIsDegradedWithDetailAsync, StoredFormHealthSourceTests.TheWorkerPipelineRegistersTheSourceAsync}

Most surfaces now have **real** probes: **event-store/DB** (`SELECT 1` in the Postgres driver),
**transport** (broker connectivity via `ITransport.CheckConnectivityAsync` — RabbitMQ `IConnection.IsOpen`,
Service Bus `!ServiceBusClient.IsClosed`), and **offload** (`IMessageBodyStore.CheckConnectivityAsync` — a
blob-service round-trip; in-memory stores are always reachable). Each is registered *smartly*: a real probe
when the driver is present, an assumed-healthy placeholder when it isn't (single-service apps with no
transport/offload). **signal-bus** stays assumed-healthy — its real dependency is the same Postgres the
event-store source already probes (`wh_signals` + `LISTEN/NOTIFY`), so a DB outage surfaces there. Surfaces
still on placeholders use `ConnectivityHealthSource.AssumedHealthy`: hard-coded healthy but phase-aware, so
they appear in the health model and never fail readiness.

**2. The framework maps state → status via policy.** `WhizbangHealthAggregator` runs every source
through its `HealthPolicy` and takes the worst status. The default policy is **Lenient**:

| State | Liveness | Readiness |
|---|---|---|
| Operational / Ready | Healthy | **Healthy** |
| Starting / Connecting / Migrating / PausedByDesign / Draining | Healthy | **Degraded** — HTTP 200, visible |
| Degraded | Healthy | Degraded |
| Faulted | Healthy | Unhealthy |

Intentional startup states report **Degraded, not Healthy and not Unhealthy** — the honest middle.
Unhealthy rolls deployments back: tooling that waits on readiness with a bounded timeout (helm's
default is three minutes) times out on any migration longer than that, punishing exactly the
deploys that carry schema changes. Plain Healthy has the mirror flaw: the migration is invisible on
every dashboard. Degraded is HTTP 200 — the rollout completes and the pod stays in rotation, with
the availability gate and [data-plane seams](../operations/workers/database-readiness#the-seam-level-barriers-reads-and-writes-hold-themselves)
refusing what genuinely cannot be served yet — while the state remains visible. The same reasoning
applies to the legacy opt-in `SchemaReadyHealthCheck`, which now reports Degraded (not hard
Unhealthy) while the schema gate is closed: one hard-Unhealthy check in an aggregate rolls
deployments back regardless of policy.

Liveness never fails for an intentional state under any policy — an intentional or dependency-fault
state must never restart the pod. A genuine `Faulted` (transport dropped while `Ready`, offload
unreachable) still fails readiness — the policy never masks a real fault.

## Backlog age {#backlog-age}

The `backlog` component comes from the backlog-age duty (`BacklogAgeWorker`), which peeks each broker entity
this instance consumes from for its depth and the age of its oldest waiting message. It reports `Degraded`, never
`Faulted`, while any entity's oldest message is older than `BacklogAgeOptions.AgeThreshold` (15 minutes by
default), with the entity named in the detail: a backlog that old is a consumer that is not draining, which depth
alone cannot tell apart from a burst. An entity whose age cannot be read reports its depth with no age and does
not degrade health. See [`BacklogAgeOptions`](../operations/configuration/configuration-reference#backlogageoptions)
for the settings.
{verified: BacklogAgeDutyTests.PeekOnce_AgedBacklog_DegradesHealthNamingTheEntityAsync, BacklogAgeDutyTests.PeekOnce_FreshBacklog_StaysOperationalAsync, BacklogAgeDutyTests.PeekOnce_UnknownAge_DoesNotDegradeButIsReportedAsCapabilityGapAsync}

On Azure Service Bus the age comes from a peek at each subscription's oldest message. When that peek fails (a
missing permission, a deleted entity, a broker error), the failure is logged at Warning with the entity, the
exception type and its message, at most once every five minutes per entity, and the entity's depth is still
reported. Before, a failed peek looked the same as an empty entity.
{verified: AsbBacklogPeekFailureLoggingTests.PeekBacklogsAsync_HeadPeekThrows_LogsWarningWithEntityAndExceptionAsync, AsbBacklogPeekFailureLoggingTests.PeekBacklogsAsync_RepeatedFailures_LogOncePerIntervalAsync, AsbBacklogPeekFailureLoggingTests.PeekBacklogsAsync_FailuresOnTwoEntities_EachEntityLogsAsync, AsbBacklogPeekFailureLoggingTests.PeekBacklogsAsync_EmptyEntityHead_LogsNoWarningAsync}

## Startup stage {#startup-stage}

Once the instance has entered a [startup stage](../operations/startup/startup-status#startup-stages), the `startup`
component's detail leads with the stage's line, the same text the instance logs, followed by the startup
pipeline's own detail:

```text{title="The startup component's detail" description="The startup health component leads with the current startup stage line" category="Operations" difficulty="BEGINNER" tags=["Resilience","Health","Startup"] tests=["StartupPipelineHealthSourceTests.WithAStageEntered_TheDetailLeadsWithTheStagesLineAsync","StartupStageHostTests.AFreshDatabase_EntersEveryStageInOrder_LogsEach_AndRecordsEachTheRowCanHoldAsync"]}
Stage 7 of 7: Running - reads and writes are served; <pipeline detail>
```

The component's state is the pipeline's, unchanged; the stage only adds the line. Before any stage is entered, the
detail is the pipeline's alone.
{verified: StartupPipelineHealthSourceTests.WithAStageEntered_BeforeThePipelineStarts_TheDetailStillLeadsWithItAsync, StartupPipelineHealthSourceTests.WithAReporterButNoStageYet_TheDetailIsThePipelinesAloneAsync}

Every evaluation also carries the stage on `AggregatedHealth.Stage` (a `StartupStageSnapshot` with the stage, its
name, message, whether it was skipped and when it was entered), or `null` when no stage reporter is registered or no
stage has been entered yet. The ASP.NET liveness and readiness checks add it to their result's data:

| Data key | Value |
|---|---|
| `startup_stage` | The stage number, for example `70` |
| `startup_stage_name` | The stage name, for example `Running` |
| `startup_stage_message` | What the stage is doing, for example `reads and writes are served` |

The keys are absent while there is no stage.
{verified: WhizbangHealthAggregatorTests.Evaluate_CarriesTheStartupStage_ForEveryProbeAsync, WhizbangHealthAggregatorTests.Evaluate_WithoutAStageReporter_CarriesNoStageAsync, WhizbangManagedHealthCheckTests.Result_CarriesTheStartupStagesNumberNameAndMessageAsync, WhizbangManagedHealthCheckTests.Result_WithNoStage_CarriesNoStageKeysAsync}

## Roles {#roles}

With [role assignment](../operations/startup/capabilities-and-duties#role-assignment-the-default), the `roles`
component reports each duty: who holds it, its epoch and any owed work, or why it is vacant or lapsed. It reads the
role assignments from the instance's [Elect stage](../operations/startup/startup-status#what-runs-in-each-stage) on.
Before that the tables it reads may not exist yet, so it reads nothing and reports `Degraded` with the detail
`role assignments are read from the Elect stage on; this instance is in an earlier one`. Like any intentional startup
state, that is HTTP 200 on readiness under the default policy and never fails liveness.
{verified: RoleAssignmentHealthSourceTests.BeforeTheElectionStage_NothingIsRead_AndTheRolesAreDegradedAsync, RoleAssignmentHealthSourceTests.FromTheElectionStageOn_TheAssignmentsAreReadAsync, StartupStageWiringTests.TheRolesHealthComponent_ReadsNothingBeforeElectAsync}

## A slow or blocked source {#slow-sources}

The probe always answers. Each source is asked on its own thread-pool thread and given
`WhizbangHealthOptions.SourceTimeout` (two seconds by default); a source that has not answered by then is
reported `Faulted` and named in the result, and the others are unaffected. The deadlines run side by side,
so several hanging sources cost one timeout, not one each. This holds even for a source that blocks inside
`ReportAsync` before it returns a task: it never holds the caller's thread, so liveness keeps answering
and the pod is not restarted for it.

The deadline is measured on the `TimeProvider` registered in the container (`TimeProvider.System` when
none is), so a test can drive it with a fake clock.
{verified: HealthProbeMustAlwaysAnswerTests.SeveralHangingSourcesDoNotAddUpAsync, HealthProbeMustAlwaysAnswerTests.ASourceThatBlocksBeforeItReturnsIsTimedOutAsync, HealthProbeMustAlwaysAnswerTests.ATimedOutSourceIsReportedAsFaultedAndNamedAsync}

## Configuring / overriding

Switch a component (or everything) to the stricter posture — "not ready until fully up":

```csharp{title="Strict policy override" description="Hold a component out of rotation until fully ready" category="Configuration" difficulty="INTERMEDIATE" tags=["Resilience","Health"] tests=["WhizbangHealthDiTests.AddWhizbangManagedHealth_AppliesPolicyConfigurationAsync"]}
services.AddWhizbangManagedHealth(o => o.Components["schema"] = HealthPolicy.Strict);
```

The gate and the health check are independent: run-control decides *what is paused*; the health
source reports *whether the current state is the intended one*. See
[Managed-Resource Run-Control](managed-resource-run-control) and the
[availability gate](database-availability-middleware).
