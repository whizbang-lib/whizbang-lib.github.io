---
title: Startup ordering
pageType: concept
order: 12
version: 1.0.0
description: >-
  When the work coordinator's workers start relative to the migration: the schema-ready gate, the recorded Accept
  commands transition that starts the data plane, and the claim functions that refuse an instance whose row is not
  yet eligible for work.
tags: 'work-coordinator, startup, schema-ready-gate, eligibility, claim-work, workers, registration'
codeReferences:
  - src/Whizbang.Core/Workers/ISchemaReadyGate.cs
  - src/Whizbang.Core/Workers/SchemaInitializationOptions.cs
  - src/Whizbang.Core/Startup/WhizbangWorkerServiceCollectionExtensions.cs
  - src/Whizbang.Core/Startup/GatedHostedService.cs
  - src/Whizbang.Core/Startup/StartupStageGatedService.cs
  - src/Whizbang.Core/Startup/SchemaReadyGatedService.cs
  - src/Whizbang.Core/Startup/StartupStageGate.cs
  - src/Whizbang.Core/Startup/StartupStageReporter.cs
  - src/Whizbang.Core/Messaging/IWorkCoordinator.cs
  - src/Whizbang.Data.Postgres/Migrations/300_AnIneligibleCallerClaimsNothing.sql
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupStageHostTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupHostedServiceAuditTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/WhizbangWorkerRegistrationTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/WorkerStartGateSourceGuardTests.cs
  - tests/Whizbang.Core.Tests/Startup/StartupStageGateTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/WorkEligibilitySqlTests.cs
---

# Startup ordering

The work coordinator's workers read and write tables the migration creates and alters, so none of them may run before
the schema is ready, and none that claims work may run before the instance is eligible for it. Startup enforces both in
two places: the host starts each worker at its registered start point, and the claim functions refuse an instance whose
row says it may not claim.

## The order

| Point in startup | What becomes true | What starts |
|---|---|---|
| Preflight to Coordinate | The schema is migrated; the instance is registered and elected | Schema initialization, the notification connection and signal bus (Elect), the duty holder and partition assigner (Coordinate) |
| The schema-ready gate opens (end of Coordinate) | Every Whizbang table and function exists | The heartbeat, the lifecycle monitor, the standby watcher, the statistics collectors, the reconcilers, shutdown deregistration |
| The row records Accept commands | The instance is eligible for work, and its row says so | The data plane (claim, drain, flush, perspective, inbox and outbox workers, and the rest) and the transport consumer |
| Running | The read models have caught up | Lens reads are served |

{verified: StartupStageHostTests.TheDataPlane_StartsOnlyOnceTheRowRecordsAcceptCommandsAsync, StartupHostedServiceAuditTests.EveryHostedService_HasAPlaceInTheStageTable_AndTheStagedOnesStartAtTheirStageAsync}

The full list of workers and the reason each starts where it does is in
[What runs in each stage](../../operations/startup/startup-status.md#what-runs-in-each-stage).

## Workers are started, not self-gated

A worker is registered with its start point (`AddWhizbangWorker<T>(stage)`, Accept commands by default, or
`AddWhizbangWorkerAtSchemaReady<T>()`), and the wrapper that hosts it waits for that point. No worker holds a wait on
`ISchemaReadyGate` of its own, and a source guard fails if one does, so the order above cannot be broken by a worker
that forgets its wait. See [Registering a worker with its start point](../../operations/startup/startup-status.md#add-whizbang-worker).
{verified: WhizbangWorkerRegistrationTests.AddWhizbangWorker_StartsAtAcceptCommandsByDefault_AndHostsTheRegisteredSingletonAsync, WorkerStartGateSourceGuardTests.NoHostedService_DecidesItsOwnStartOnTheSchemaReadyGate_ButTheStartupMachineryAsync}

## Why the data plane waits for the row, not the gate

The gate opens at the end of Coordinate, and the row records Accept commands a moment later. A data plane started on the
gate could claim inside that moment while its row still said it was not eligible, and peers and the partition assigner
read that row. Waiting for the recorded transition closes the window from the host's side; a held stage write is
written by the next accepted heartbeat, which then starts the data plane. A host whose coordinator keeps no instance
rows has nothing to wait for and starts the data plane at Accept commands at once.
{verified: StartupStageGateTests.AnEligibleStage_WhoseRowWriteFailed_IsNotReachedUntilTheRowRecordsItAsync, WhizbangWorkerRegistrationTests.AHostWithNoStorage_StartsItsDataPlaneAtAcceptCommandsAsync}

## The database refuses an ineligible caller too

Since migration 300, `claim_work`, `wh_claim_multi_stream_work` and the coalesce fetch give nothing to a caller whose own
row may not claim. A draining caller still claims its share, an older build that records no phase is served, a caller
with no row is served, and a refused caller with a stale row is still asked to register; each case and its reason is in
[An ineligible caller claims nothing](claim-loop.md#ineligible-caller-claims-nothing).
{verified: WorkEligibilitySqlTests.Rank_ACallerThatIsNotYetEligible_StillCountsItselfAsync, WorkEligibilitySqlTests.Claim_ADrainingCaller_StillClaimsItsShareAsync}

## How long the migration may take

`SchemaInitializationOptions` controls the initializer that opens the gate: `NonBlockingSchemaInit` (true by default,
so the host answers probes while it migrates), `MigrationTimeout`, `InitRetryDelay` and `DispatchMaxWait`. See
[Database readiness](../../operations/workers/database-readiness.md#who-marks-the-gate-ready) and, for what Kubernetes
sees meanwhile, [Probes during a migration](../../resilience/managed-resource-health.md#probes-during-a-migration).

## Related

- [Claim loop](claim-loop.md)
- [Partition assignment](partition-assignment.md)
- [Batched flushers](batched-flushers.md#when-a-flusher-starts)
- [The Startup Status Surface](../../operations/startup/startup-status.md)
