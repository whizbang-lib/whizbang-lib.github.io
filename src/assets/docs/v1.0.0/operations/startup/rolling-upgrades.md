---
title: Rolling Upgrades
pageType: concept
verifiedAgainstCommit: f1ff5bcf
verifiedDate: 2026-08-16
version: 1.0.0
category: Startup
order: 3
description: >-
  Two versions against one schema: the one Assess verdict that binds startup
  (Current skips the schema lock, StandDown applies nothing and stays visible),
  the standby handshake for breaking migrations, eviction as the fence behind
  it, and revival by re-entering the pipeline
tags: >-
  rolling-upgrades, assess, verdict, current, stand-down, standby, handshake,
  eviction, semver, versioning, migrations, multi-instance, deployment
codeReferences:
  - src/Whizbang.Core/Startup/AssessStartupStep.cs
  - src/Whizbang.Core/Startup/StartupAssessmentSource.cs
  - src/Whizbang.Core/Startup/StartupStandDown.cs
  - src/Whizbang.Data.Postgres/StartupVerdictBinding.cs
  - src/Whizbang.Data.Postgres/PostgresStartupAssessment.cs
  - src/Whizbang.Data.Postgres/StoredFormSettlement.cs
  - src/Whizbang.Data.Postgres/WhizbangDatabaseInitializerService.cs
  - src/Whizbang.Data.Dapper.Postgres/DapperPostgresStartupAssessor.cs
  - src/Whizbang.Core/Startup/StandbyWatcher.cs
  - src/Whizbang.Core/Startup/StandbyHandshake.cs
  - src/Whizbang.Core/Startup/StartupFleetStatus.cs
  - src/Whizbang.Core/Messaging/StandbyRequest.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCorePostgresStartupAssessor.cs
  - src/Whizbang.Data.Postgres/Migrations/110_StandbyHandshake.sql
  - src/Whizbang.Data.Postgres/Perspectives/DeclaredKeySpellingPass.cs
  - src/Whizbang.Data.Postgres/StoredFormMigrationJournal.cs
testReferences:
  - tests/Whizbang.Core.Tests/Startup/AssessStartupStepTests.cs
  - tests/Whizbang.Core.Tests/Startup/StartupAssessmentSourceTests.cs
  - tests/Whizbang.Core.Tests/Startup/StartupStandDownTests.cs
  - tests/Whizbang.Core.Tests/Schema/StartupVerdictBindingTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/AssessBindingSourceGuardTests.cs
  - tests/Whizbang.Core.Component.Tests/Schema/SchemaInitializationRunnersTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupParity/StartupParityTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/DbContextInitializationRegistryTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperStartupAssessorTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperSchemaCurrencyTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ColdBootJourneyE2ETests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupAssessorTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StandbyHandshakeE2ETests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StandbyHandshakeSqlTests.cs
  - tests/Whizbang.Core.Tests/Startup/StandbyHandshakeCoverageTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/StandbyWatcherTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/AliveLockLivenessSqlTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/StartupWiringAuditTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/HeartbeatPhaseOrderSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Perspectives/DeclaredNameSpellingIntegrationTests.cs
---

# Rolling Upgrades

A rolling deployment runs two versions of the library — and of the consumer's application — against one database at the same time, **by design**. The startup pipeline's answer has three parts: every instance *assesses* where it stands before changing anything; a breaking migration runs a *standby handshake* that converts a silent, corrupting overlap into a bounded, announced one; and *eviction* fences the instance that will not cooperate.

Two rules anchor everything below:

- **Never apply older content over newer.** Every applied migration already records the library version that applied it; an instance whose version is behind that record refuses to re-apply its own copy. This is what stops a restarted old pod from silently downgrading the schema through `CREATE OR REPLACE` — see [Version Auditing](../infrastructure/migrations#version-auditing).
- **Every pending change from a newer version is treated as breaking.** A hash says *different*, never *incompatible*. Starting strict means the failure mode is an unnecessary, visible outage; starting permissive means silent corruption discovered later. Only one of those is safe to be wrong about. A release with **no** pending migration hits the fast path where every hash matches — code-only releases stay free.

## Assess {#assess}

`Assess` is the first stage of startup. It runs on **every instance** (an instance that will never win the [migrator duty](capabilities-and-duties) still needs to know whether it is obsolete), and it is a read of the version record: no lock, no transaction, no DDL. It produces **one verdict**, and everything that follows in startup acts on that verdict:

| What the version record says | Verdict | What the instance does |
|---|---|---|
| No migration ledger: a brand-new database | `Migrate` | Bootstraps, contends for the `migrator` duty and migrates. Safe, because nothing newer than this binary can exist yet |
| A ledger with no version table, or no version recorded | `Migrate` | The same: nothing newer is recorded |
| Nothing newer than mine, and the schema is [already current](#current) | `Current` | Skips the bootstrap, the election, the stored-form rewrite and the migration pass, so it takes **no schema lock**; Converge and Coordinate still run |
| Nothing newer than mine, and the schema could not be shown current | `Serve` | Runs startup as it always has: the election, the pass under the schema lock (which finds nothing to do when every hash matches), Converge and Coordinate |
| Any version **newer** than mine | `StandDown` | [Applies nothing and holds the data plane](#standing-down), while it stays alive and visible |
| A ledger that exists and cannot be read | none | A temporary failure is retried within Preflight; any other [fails the attempt](#unreadable-version-record) |

```csharp{title="The verdict" description="Decided once, before anything is changed, and read by every part of startup" category="Implementation" difficulty="INTERMEDIATE" tags=["Startup","RollingUpgrades"] tests=["AssessStartupStepTests.StandDownVerdict_FailsTheBlockingStep_WhichIsNotReadyWhileAliveAsync","AssessStartupStepTests.CurrentVerdict_CompletesWithTheReason_LikeServeAsync","StartupAssessorTests.AnyNewerRecorded_VerdictIsStandDownAsync","StartupAssessorTests.AnUpToDateSchema_IsCurrent_AndOneWithWorkPending_IsServeAsync"]}
public enum StartupVerdict { Migrate, Serve, StandDown, Current }

public sealed record StartupAssessment(StartupVerdict Verdict, string Reason);

public interface IStartupAssessor {
  Task<StartupAssessment> AssessAsync(CancellationToken ct);
}
```

:::updated
**Upgrading: `StartupVerdict` has a fourth value, `Current`.** A `switch` that treats every value other than `StandDown` as "migrate or serve" still compiles and behaves as before. An exhaustive `switch` needs a `Current` arm, which behaves like `Serve` for readiness. The `Assess` step reports a current schema as completed, with a reason that ends `the schema is current: nothing to apply or convert`.
:::

**Ordering is semantic versioning**, with the details that are load-bearing rather than pedantic: pre-release precedence is the common path (`0.9.4-alpha.3` < `0.9.4-beta.1` < `0.9.4`), numeric pre-release identifiers compare numerically (`alpha.10` > `alpha.2`), and build metadata is ignored. An unparseable version is never guessed at: the instance refuses to migrate and reports the condition, because every wrong answer here is worse than stopping. The consumer's application version is recorded but takes no part in the ordering; requiring an application to be semantically versioned is not the framework's call to make.

**Where this binary's version comes from.** The assessor reads it from `ILibraryVersionProvider`. The Postgres driver registers that provider from a build-time constant (`$(Version)`, the same value the migration ledger records), whoever owns the DbContext: a host that registers its own `NpgsqlDataSource` and DbContext, which makes the driver skip its generated turnkey registration, still gets one. Registering your own provider first wins. A host with no provider at all, one that bypasses the driver entirely, stands down with a reason that names the missing registration, which is a different fact from an unparseable version and is reported as one.


```csharp{title="The library version is registered whoever owns the DbContext" description="A consumer that registers its own DbContext before .WithDriver.Postgres still gets ILibraryVersionProvider; an explicit registration wins; no provider at all is reported as the missing registration it is." category="Implementation" difficulty="INTERMEDIATE" tags=["Startup", "RollingUpgrades", "Drivers"] tests=["LibraryVersionRegistrationTests.Postgres_WhenTheConsumerRegisteredItsOwnDbContext_StillRegistersTheLibraryVersionAsync", "LibraryVersionRegistrationTests.Postgres_RegistersTheLibraryVersionAsTryAdd_SoAnExplicitRegistrationWinsAsync", "StartupAssessorTests.NoLibraryVersionProvider_StandsDownNamingTheMissingRegistrationAsync"]}
services.AddDbContext<OrdersDbContext>(o => o.UseNpgsql(myDataSource));   // consumer-owned
services.AddWhizbang().WithEFCore<OrdersDbContext>().WithDriver.Postgres;  // skips turnkey DbContext registration ...
// ... but ILibraryVersionProvider is registered all the same, so Assess can compare versions.
```


### One verdict binds startup {#one-verdict}

`StartupAssessmentSource` reads the version record **once per host** and hands that one answer to every caller. Three readers take it, and none of them reads the schema again to decide:

- the `Assess` startup step, which reports it;
- the schema initializer, `WhizbangDatabaseInitializerService`, which asks for it **before any driver's runner starts**;
- each driver's schema pass, through `StartupVerdictBinding`. On the EF Core driver that is the generated pass, so a direct `EnsureWhizbangInitializedAsync` or `EnsureWhizbangDatabaseInitializedAsync` call reads the same verdict as the hosted start (see [Both drivers](../../data/turnkey-initialization#both-drivers)).

A caller that arrives while the first read is in progress waits for it. The standby watcher is the one deliberate exception: its [runtime re-check](#runtime-re-check) reads the driver's assessor directly, because a verdict that was right at boot can stop being right while the instance runs.

{verified: StartupAssessmentSourceTests.EveryCaller_ReadsTheOneVerdict_AndTheRecordIsReadOnceAsync, StartupAssessmentSourceTests.CallersArrivingTogether_ShareOneReadAsync, StartupAssessmentSourceTests.TheDefaults_RegisterOneSourceOverTheRegisteredAssessor_AndTheAssessStepReadsThroughItAsync, SchemaInitializationRunnersTests.AnyOtherVerdict_RunsTheRunnersAfterTheVerdict_ThenOpensTheGateAsync, StartupVerdictBindingTests.AnyVerdictButStandDown_IsHandedToThePass_AndOnlyCurrentSkipsItAsync}

**Why one verdict, read first.** Earlier releases reported the verdict from the `Assess` step only. The schema initializer ran its bootstrap, its election, the stored-form rewrite, the pass and the managed-object reconcile whatever the step had decided, so an instance could report `StandDown` and still change the schema, and a restart on a current schema still queued for the schema lock. Two facts, checked against the code before this change, made that more than a reporting gap:

1. **The stored-form rewrite takes the schema lock on a current schema.** The rewrite phase filters nothing in advance. For any model with a temporal path, a stored-form migration or an enum physical column, it opens a transaction and takes `pg_try_advisory_xact_lock` on the schema key, waiting up to the command timeout while another session holds it, and only then finds each table settled. The migrator and every instance that is not staged did this on every start. That is why `Current` requires every stored-form conversion to be settled, not only every hash to match.
   {verified: StartupParityTests.ARestartOnACurrentSchema_TakesNoSchemaLock_AndSkipsElectAndMigrateAsync, StartupAssessorTests.StoredForms_AreSettledOnlyWhenEveryLedgerSaysSoAsync}
2. **The reconcile's fleet gate does not fully protect against an older binary.** It gates only the drop of a managed object. It counts only instances it judges live (a heartbeat within the last two minutes in that release; [the liveness rule](../../fundamentals/workers/instance-liveness#liveness-rule) since migration 316), so a newer release whose instances are all gone (during a rollback, for example) has its declarations deleted by the older reconcile, which then drops them. It is off when `DropAfterFleetConverged` is `false`. It compares names, not versions. A missing object is re-created from the older model. And the perspective storage reconcile, the registries and the bootstrap closure are not fleet-gated at all; the bootstrap closure is keyed by hash alone, so an older closure would be applied again over newer definitions. A stood-down instance no longer reaches any of them.
   {verified: StartupParityTests.ANewerSchema_StandsDown_AppliesNothing_AndKeepsTheGateClosed_WhileVisibleAsync, SchemaInitializationRunnersTests.StandDown_RunsNoRunner_KeepsTheGateClosed_AndRegistersTheInstanceVisiblyAsync}

**No start path skips the decision.** A source guard fails the build's tests when a schema runner neither reads the verdict through `StartupVerdictBinding.ReadAsync` nor delegates to the generated pass, and when the generated pass applies the bootstrap, holds the election, runs the stored-form rewrite or begins the pass before it reads the verdict. A new runner cannot forget the decision.
{verified: AssessBindingSourceGuardTests.EverySchemaRunner_ReadsTheVerdict_OrDelegatesToThePassThatDoesAsync, AssessBindingSourceGuardTests.TheGeneratedPass_ReadsTheVerdict_BeforeItAppliesAnythingAsync, StartupParityTests.TheTurnkeyCall_OnAStoodDownInstance_IsRefused_AndAppliesNothingAsync}

### Current: the schema is already up to date {#current}

`Current` is the verdict of a normal restart or scale-out. It applies when nothing newer than this binary is recorded and the schema needs nothing:

- **EF Core:** every DbContext the host registers answers its generated `IsWhizbangSchemaCurrentAsync`, read without a lock: the hash checks of the migration's lock-free fast path pass, every declared object is present, and every stored-form conversion has settled (`StoredFormSettlement`: the temporal rewrite, the [stored-form migrations](../../fundamentals/perspectives/stored-form-migrations.md#journal), the declared-name spellings and the enum physical columns).
- **Dapper:** every migration is recorded at its hash **and at this binary's version**, the perspective and application-object hashes match, the declared keys have settled and the managed objects are present. The Dapper driver's infrastructure schema is tied to the release that built it, so a release that has not yet run its own pass is not current even when every hash matches.

A `Current` start skips the bootstrap, the election, the stored-form rewrite and the migration pass, so it takes no schema lock and cannot queue behind a migration another session is running. It still registers the instance (on EF Core, as Preflight's last step: `the schema is current; registering this instance`), reports Elect and Migrate as [skipped with the reason](startup-status#what-a-fresh-database-and-a-restart-record), and runs Converge and Coordinate.
{verified: StartupParityTests.ARestartOnACurrentSchema_TakesNoSchemaLock_AndSkipsElectAndMigrateAsync, SchemaInitializationStagesTests.OnACurrentSchema_ElectAndMigrateAreSkipped_AfterRegisteringAsync, DapperStartupAssessorTests.AfterAStart_TheSchemaIsCurrentAsync, DapperSchemaCurrencyTests.OnACurrentSchema_TheStartConverges_WithoutAnInstanceToRegisterAsync}

**A check that cannot answer is `Serve`, never `Current`.** A currency check that throws, a host with no check registered, and a stored-form conversion whose settlement cannot be read all give `Serve`, and the full path finds out for itself. A wrong `Current` would skip work that was owed; a wrong `Serve` costs only the lock it always took.
{verified: StartupAssessorTests.ACurrencyCheckThatCannotAnswer_IsServe_NeverCurrent_AndACancellationPropagatesAsync, DbContextInitializationRegistryTests.IsSchemaCurrent_WithNoCheckRegistered_IsNotCurrentAsync, DbContextInitializationRegistryTests.IsSchemaCurrent_IsCurrentOnlyWhenEveryContextThisHostRegistersIsAsync, DapperStartupAssessorTests.AMigrationLastRecordedByAnotherRelease_IsServeAsync, DapperStartupAssessorTests.APerspectiveTableWhoseDefinitionChanged_IsServeAsync}

Two cases that start as `Serve` and are expected to:

- **The first restart after a fresh start.** A generated stored-form conversion settles only on a pass that finds nothing left to convert (see [Stored documents written mid-deploy](#stored-documents-written-mid-deploy)), so on a model with stored forms the restart that follows the first start makes that pass and settles. The start after it is `Current`.
- **An application whose stored rows lack a required key.** A table with rows missing a [required member](../../fundamentals/perspectives/stored-form-migrations.md#declared-names-required) stays unsettled until the rows are filled, so that application never reaches `Current` and starts as `Serve` every time, exactly as it did before this verdict existed. That is safe; it only keeps taking the schema lock.

### Standing down {#standing-down}

A `StandDown` verdict means the schema is newer than this binary. The instance:

- **applies nothing**: no bootstrap closure, no election, no stored-form rewrite, no pass, no managed-object reconcile;
- **holds the data plane**: the schema-ready gate stays closed, so no worker that needs the schema starts, no claim is made, and readiness answers 503 while liveness stays healthy. The `Assess` step fails as a blocking step, which keeps the pipeline incomplete;
- **stands down through the one run-control path**: the same path, and the same code, as a stand-down while running, a pause or a stop (see [below](#stand-down-takes-the-run-control-path));
- **stays visible**: it registers at once and records its stage as Preflight with the message `standing down: ` followed by the reason, which names the version the ledger records and this binary's own, and its phase as `Pausing`, then `StandingBy`. At stage Preflight it is never eligible for work;
- **keeps its row alive** with the heartbeat's own call, on the heartbeat interval, until the host stops. The heartbeat worker itself starts when the schema-ready gate opens, which for this instance never happens. A beat that fails is logged and tried again on the next beat; a beat the registry refuses (the instance was evicted) ends the beating.

**Why it registers and stays visible.** The tables exist, because the database is newer than the binary, so registering is safe without a bootstrap. An operator watching a rollout that does not progress sees each stood-down instance in [`wh_instance_startup_stages()`](startup-status#seeing-every-instances-stage) with the reason, instead of a pod that is not ready for no stated reason. A host with no instance identity logs the stand-down at Warning and still applies nothing.
{verified: StartupParityTests.ANewerSchema_StandsDown_AppliesNothing_AndKeepsTheGateClosed_WhileVisibleAsync, SchemaInitializationRunnersTests.StandDown_RunsNoRunner_KeepsTheGateClosed_AndRegistersTheInstanceVisiblyAsync, SchemaInitializationRunnersTests.StandDown_WithNoInstanceIdentity_StillAppliesNothingAsync, StartupStandDownTests.Record_StaysInPreflight_NamingTheReason_AndStandsByAsync, StartupStandDownTests.KeepVisible_RegistersAtOnce_ThenOnEveryBeat_UntilTheHostStopsAsync, StartupStandDownTests.FromServices_BeatsOnTheHeartbeatCadence_AsTheRegisteredInstanceAsync, StartupStandDownTests.KeepVisible_AFailedBeat_IsRetriedOnTheNextBeatAsync, StartupStandDownTests.KeepVisible_WhenTheRegistryEvictedTheInstance_StopsBeatingAsync, AssessStartupStepTests.StandDown_ThroughTheRealPipeline_KeepsReadinessPendingForeverAsync}

**A direct call is refused.** `EnsureWhizbangInitializedAsync` (or a DbContext's `EnsureWhizbangDatabaseInitializedAsync`) on a stood-down host throws `SchemaStandDownException`, naming the reason, and applies nothing.
{verified: StartupParityTests.TheTurnkeyCall_OnAStoodDownInstance_IsRefused_AndAppliesNothingAsync, StartupVerdictBindingTests.AStandDown_IsRefused_NamingTheReasonAsync}

The stand-down composes with machinery that already exists: readiness stays withheld, the data-plane seams keep refusing, and liveness stays healthy, which is precisely the state that tells an orchestrator to replace the instance and a load balancer to stop sending it traffic. The fence runs *backwards* on purpose: a migrating instance can never wait for older instances to be retired (the orchestrator will not retire them until the new instance is ready, which requires migrating first), so the **older instance stands itself down** instead.

This covers an older instance **at its own start**. An older instance that is already running when a newer one comes online stands down through the [standby handshake](#the-standby-handshake) or its own [re-check](#runtime-re-check), on the same path.

#### A stand-down takes the run-control path {#stand-down-takes-the-run-control-path}

Standing down is "stop taking work and finish what it holds", which is what a pause and a host stop do too, so all
three take the [one run-control path](../../resilience/managed-resource-run-control#one-run-control-path) with a
reason. For a stand-down, at startup (`StartupStandDown`) or while running (`StandbyWatcher`):

1. the run permit closes, so no worker claims and every transport consumer pauses its subscriptions;
2. `Pausing` is recorded on the instance's row;
3. the work in hand finishes, bounded by `Whizbang:Lifecycle:HeldWorkTimeout`; the leased streams no drain has started
   are released, then every role this instance holds, so the newer instance can win the maintainer and migrator duties
   at once;
4. `StandingBy` is recorded.

At Preflight nothing is held and no role is won, so the path closes the permit and writes the two phases. A revival is
the path's resume: `Resuming` is recorded, the permit reopens, and `Running` is recorded. A host without the worker
pipeline has no permit, no held work and no roles, and records `StandingBy` alone.
{verified: StartupStandDownTests.Record_WithTheRunControlPath_StandsDownThroughItAsync, StartupStandDownTests.FromServices_TakesTheRegisteredRunControlPathAsync, StandbyWatcherTests.ANewerLivePeersRequest_StandsDownThroughTheRunControlPathAsync, StandbyWatcherTests.AWithdrawnRequestAndARollback_RevivesUsAsync, CoordinationSourceGuardTests.HaltingPhases_AreWrittenOnlyByTheRunControlPathAsync}

**Why `Pausing` comes before `StandingBy`.** `StandingBy` tells the migrator that this instance holds nothing and takes
nothing. Writing it directly, as earlier releases did, said so while the workers were still claiming, because nothing
closed the permit. `Pausing` is the honest phase for the window in which the permit is closed and the work in hand is
still finishing.

**Why one path.** Earlier releases had three: the standby watcher and the Assess stand-down wrote `StandingBy`
directly, and host shutdown wrote its stages in one service and released roles in another, ordered only by
registration. Three paths meant three chances for one to forget a step; a source guard now fails a halting phase
written anywhere but the path.

### When the version record cannot be read {#unreadable-version-record}

The assessment probes the catalog before it reads the record:

- **No migration ledger** is a brand-new database: `Migrate`. Nothing newer can exist, so the bootstrap that follows is safe.
- **No version table** records no version: `Migrate`.
- **A ledger that exists and cannot be read** never becomes either of those. A temporary failure (one `TransientDatabaseFailure` classifies as transient) is retried within Preflight, one second after the first failure and doubling to at most thirty, and each retry is said on the stage record (`the schema version record could not be read for a moment (<reason>); retrying`). Any other failure fails the attempt with a `StartupAssessmentException`, records `the schema version record could not be read; this attempt stops here rather than migrate blind`, and is handled like a [bootstrap that cannot be applied](../infrastructure/migrations#bootstrap-failures): the initializer's next attempt reads the record again, because a failure is never cached.

**Why never migrate blind.** An instance that cannot tell whether the schema is newer than its binary cannot know whether migrating it is a downgrade. Stopping is visible and recoverable; an older binary applying its definitions over a newer schema is neither.
{verified: StartupAssessmentSourceTests.ATemporaryFailure_IsRetriedWithinPreflight_UntilTheVerdictLandsAsync, StartupAssessmentSourceTests.RetryDelay_DoublesFromOneSecond_CappedAtThirtyAsync, StartupAssessmentSourceTests.AnyOtherFailure_FailsStartupLoudly_AndIsNotLatchedAsync, SchemaInitializationRunnersTests.AnUnreadableVersionRecord_FailsTheAttemptLoudly_BeforeAnyRunnerAsync, StartupAssessorTests.ABrandNewDatabase_HasNoVersionRecord_AndMigratesAsync, StartupAssessorTests.ALedgerWithNoVersionTable_RecordsNothingNewer_AndMigratesAsync, StartupAssessorTests.AVersionRecordThatCannotBeRead_IsNeverTakenForABrandNewDatabaseAsync}

**The Dapper ledger is read whole.** The EF Core ledger has an `owner` column and is read for the framework's own rows; the Dapper ledger has none. Earlier releases took a missing `owner` column for a ledger still being created and answered `Migrate`, which on the Dapper driver would have migrated a newer schema. Both drivers now share one verdict table and one ledger read, and the Dapper driver registers its own assessor (`DapperPostgresStartupAssessor`).
{verified: StartupAssessorTests.ALedgerWithoutAnOwnerColumn_IsReadWhole_SoANewerVersionStillStandsDownAsync, DapperStartupAssessorTests.ANewerRelease_StandsThisBinaryDownAsync, DapperStartupAssessorTests.ABrandNewDatabase_MigratesAsync, StartupParityTests.EachDriver_SuppliesAnAssessor_ThatReadsTheVersionRecordAsync}

### Re-checking while running {#runtime-re-check}

The verdict is **not a startup-only fact**. An instance that was current when it booted becomes obsolete the moment a newer peer migrates underneath it, so a lightweight watcher re-checks on the same signal-plus-poll footing as capability re-attempt (`ObsolescenceInterval`, see [the watcher's clock](#the-watchers-clock)), and standing down is a state an instance can enter at any time.

## The standby handshake

A breaking migration is a **planned outage** — that is the honest description of a breaking schema change. The handshake's job is to make it bounded, announced and reversible instead of silent and corrupting.

```mermaid{caption="The standby handshake — peers drain and stand by, the migration commits or rolls back, and every path out is bounded." tests=["StandbyHandshakeE2ETests.Handshake_CommitPath_PeersDrainAcknowledgeAndShutDownAsync","StandbyHandshakeE2ETests.Handshake_RollbackPath_PeersReviveByReEnteringThePipelineAsync"]}
graph TB
    New["New instance · Assess<br/>verdict: older peers live, changes pending"]
    Ask["Requests standby<br/>recorded against the fleet"]
    Old["Live older instances<br/>drain in-flight work, hold the data plane,<br/>release capabilities, post STANDING BY"]
    Wait["New instance waits<br/>for every LIVE peer to acknowledge"]
    Mig["Migrate<br/>one transaction, commit or rollback"]
    Ok["Committed → peers shut down"]
    Bad["Rolled back → peers revive"]

    New --> Ask --> Old --> Wait --> Mig
    Mig -->|"success"| Ok
    Mig -->|"failure"| Bad

    style Old fill:#fff3cd,stroke:#ffc107,stroke-width:2px
    style Mig fill:#cce5ff,stroke:#0d6efd,stroke-width:2px
    style Ok fill:#d4edda,stroke:#28a745,stroke-width:2px
    style Bad fill:#f8d7da,stroke:#dc3545,stroke-width:2px
```

Four properties keep the handshake from becoming its own outage — each carried by a dedicated [end-to-end test](#verification):

- **Standby is not termination.** A standing-by instance stays alive and keeps passing liveness (`LifecyclePhase.StandingBy` is a settled phase); it simply stops serving. The orchestrator is never asked to retire anything, so the handshake completes without needing the very readiness it is blocking on.
- **Only live peers must acknowledge.** A peer the rule calls dead stops counting, so the wait is bounded by lease expiry rather than by the goodwill of a process that may already be dead. Evicted and dead peers are skipped; peers already on the same or newer version have nothing to stand by for. Live is [the liveness rule](../../fundamentals/workers/instance-liveness#liveness-rule), read from the database as `FleetInstanceStatus.IsLive`: a direct peer holding its alive-lock counts between two of its slow beats, and a peer behind a transaction pooler counts inside its own window. {verified: StandbyHandshakeCoverageTests.AwaitPeersStandingByAsync_AnOlderPeerHoldingItsAliveLock_StillCountsAsync, StandbyHandshakeCoverageTests.AwaitPeersStandingByAsync_StaleHeartbeatAndNewerPeer_NeitherCountsAsBlockingAsync, AliveLockLivenessSqlTests.FleetSource_ReportsWhetherAPeersAliveLockIsHeldAsync}
- **A standing-by instance watches the migrator.** If the migrator dies rather than failing cleanly, its instance record goes stale, the wait ends and revival begins. Every path out of standby is bounded: success, clean failure, or a dead migrator. The rule decides whether the requester is alive, and the request carries its answer (`StandbyRequest.RequesterIsLive`): a requester the rule calls live binds its peers (a direct migrator holding its alive-lock between slow beats included), and one it calls dead, or one with no row, voids its request. {verified: StandbyWatcherTests.ARequesterTheRuleCallsLive_BindsUs_AndOneItCallsDead_IsVoidAsync, StandbyWatcherTests.ADeadRequestersRequest_IsVoidAsync, AliveLockLivenessSqlTests.StandbyRequest_ReportsWhetherTheRequestersAliveLockIsHeldAsync}
- **Revival is not a second pipeline.** The migration is one transaction: a rollback leaves the ledger exactly as the standing-by instances last read it. Coming out of standby is **re-entering the pipeline at `Assess`**: the verdict comes back *same as me*, `Migrate` finds matching hashes and no-ops, capabilities are re-acquired, and the run-control path's resume writes `Resuming`, reopens the run permit and writes `Running`, so the data plane takes work again. The [pipeline runner](startup-pipeline) is re-entrant for exactly this reason.

A peer's `StandingBy` reaches its row as a phase-only write of the [stage record](startup-status#pause-and-standby), the one writer of an instance's phase: the row keeps its stage (a peer standing by from Running still records Running), and no heartbeat built before the stand-by can write an earlier phase back over it while the migrator waits. {verified: StartupWiringAuditTests.RunControlPlane_RecordsTheInstanceRow_ThroughTheStageParticipantAlone_WithTheLibraryVersionAsync, HeartbeatPhaseOrderSqlTests.APhaseOffTheLadder_OnABeat_IsNotWritten_EitherWayAsync, StandbyHandshakeE2ETests.Handshake_CommitPath_PeersDrainAcknowledgeAndShutDownAsync}

Both the migrator's wait and the watcher read the rule through `wh_instance_is_live(id)`. The rule is in Preflight's [bootstrap region](../infrastructure/migrations#what-the-closure-carries) (migration 316), so it exists before the new release's main pass, which is when the handshake runs.

**Why the rule decides, and the watcher keeps no window.** Earlier releases compared the requester's last heartbeat, a database timestamp, with the host's clock against `RequesterLivenessWindow`, and the migrator's wait did the same against a window of its own. A host clock that drifted from the database's moved the window by the drift, and either side could call alive an instance the claim and the reap had already called dead, or the reverse. Reading the rule's answer from the database gives both sides the claim's and the reap's verdict.

:::updated{version="1.0.0" type="breaking"}
**Removed:** `StandbyWatcherOptions.RequesterLivenessWindow` and its key `Whizbang:StandbyWatcher:RequesterLivenessWindow` ([#2027](https://github.com/whizbang-lib/whizbang/issues/2027)). The startup check reports the key as [removed](../configuration/configuration-reference#removed-keys) and names `Whizbang:Workers:Heartbeat:IntervalSeconds`, the cadence each instance's declared window is derived from. `StandbyRequest` carries `RequesterIsLive` in place of `RequesterLastHeartbeatAt` and `RequesterAliveLockHeld`, and `FleetInstanceStatus.AliveLockHeld` is now `IsLive`.
:::

### The watcher's clock {#the-watchers-clock}

`StandbyWatcher` takes a `TimeProvider`, as a required constructor parameter, and reads no other clock. It governs:

| Cadence or bound | Option (default) | Verified |
|---|---|---|
| How often the watcher checks for a standby request | `PollInterval` (5 seconds) | {verified: StandbyWatcherTests.ExecuteAsync_ATickThatThrows_DoesNotKillTheWatcherAsync, StartupWiringAuditTests.TheReadyServiceAndTheStandbyWatcher_RunOnTheHostsRegisteredClockAsync} |
| How often a serving instance re-assesses its own verdict | `ObsolescenceInterval` (60 seconds) | {verified: StandbyWatcherTests.TheObsolescenceCheckIsRateLimitedAsync} |

A host gets the clock registered in its container. The worker pipeline registers `TimeProvider.System` with `TryAdd`, so a host that registers its own `TimeProvider` first, a fake clock in a test included, runs the watcher on that clock. Code that constructs the watcher directly passes a clock explicitly. The clock paces the watcher only: whether the requester is alive is the database's answer, so a host clock that drifts from the database's changes no liveness verdict.

## Eviction: the fence behind the handshake

Bounding the wait by liveness handles the *decision*; it does not handle the *process*, which may still be running — a pod paused by a long collection or a brief partition comes back and carries on against a schema that has moved. For a breaking migration that is not survivable, so the migrator (or an operator) **evicts** the unresponsive peer: a durable tombstone recording who issued it and when, delivered through the instance's own next heartbeat, and enforced where effect happens — [capability acquisition refuses an evicted instance](capabilities-and-duties#winning-a-duty). A restarted pod draws a new instance id and is unevicted; the zombie keeps its id and stays fenced.

The full mechanics live in [Instance Liveness](../../fundamentals/workers/instance-liveness#eviction-reaping-is-a-fence-not-just-a-deletion).

## Stored documents written mid-deploy {#stored-documents-written-mid-deploy}

{verified: DeclaredNameSpellingIntegrationTests.ASecondStart_ChangesNoRow_AndSettlesTheTableAsync, DapperDeclaredNameSpellingTests.ASecondStart_ChangesNoRowAsync, StoredFormMigrationTests.ASecondRun_ChangesNothing_AndSettles_AndAThirdSkipsWithoutAScanAsync}

A rewrite of stored perspective documents runs once, at the start of the new release, while instances of the
previous release may still be serving and writing documents in the old form. The
[declared-name rewrite](../../fundamentals/perspectives/stored-form-migrations.md#declared-names) (stored keys
moved to their declared JSON spelling) and the generated
[stored-form migrations](../../fundamentals/perspectives/stored-form-migrations.md#journal) handle this the same
way: a pass that changed rows is **not settled** in `wh_stored_form_migrations`, so the next start scans the
table again. That **second start catches the rows an older instance wrote mid-deploy**, and the table settles
on the first pass that finds nothing left to change. After that, it is skipped with one lookup.

So either deploy the release without a mixed fleet, or plan on a second start of the new release (a later
rollout, a scale event or a restart) once every older instance is gone. Until then, a document an older
instance wrote in the old form reads as it did before the upgrade: a key in the old spelling, for example,
reads as its member's default.

## Verification

The behaviour above is fleet behaviour, so its tests are multi-instance end-to-end tests: each simulated instance is its own coordinator over its own connection, against a real database. `StandbyHandshakeE2ETests` covers the four paths by name — commit (peers drain, acknowledge, shut down), rollback (peers revive by re-entering the pipeline), a dead migrator (strands nobody), and an unresponsive peer (evicted, and the handshake completes without it).

## Related

- [The Startup Pipeline](startup-pipeline) — the step contract and the re-entrant runner
- [Capabilities and Duties](capabilities-and-duties) — the migrator duty and the eviction fence at election
- [Migration Tracking](../infrastructure/migrations) — the ledger, version auditing, never-downgrade
- [Instance Liveness](../../fundamentals/workers/instance-liveness) — heartbeats, standby, eviction
- [The Startup Status Surface](startup-status) — watching a mixed-version rollout instance by instance
