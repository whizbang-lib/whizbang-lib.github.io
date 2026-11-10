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
  the cluster-wide stand-down when a newer version comes online (application
  version first), the rollback gate and its override, rolling back what a newer
  version applied, the standby handshake for
  breaking migrations, eviction as the fence behind it, and revival by
  re-entering the pipeline
tags: >-
  rolling-upgrades, assess, verdict, current, stand-down, standby, handshake,
  eviction, semver, versioning, migrations, multi-instance, deployment,
  rollback, application-version, override, down-migrations, allow-lossy-rollback
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
  - src/Whizbang.Core/Versioning/UpgradeOrder.cs
  - src/Whizbang.Core/Versioning/IOnlineVersionReader.cs
  - src/Whizbang.Core/Signals/CoordinationSignals.cs
  - src/Whizbang.Data.Postgres/Migrations/359_TheLedgerRecordsWhoAppliedEachChange.sql
  - src/Whizbang.Data.Postgres/Migrations/360_TheInstanceRowRecordsAnOverriddenIncompatibility.sql
  - src/Whizbang.Data.Postgres/Migrations/385_StoredFormConversionsRecordWhoAppliedThem.sql
  - src/Whizbang.Data.Postgres/Migrations/386_TheLedgerRecordsHowToReverseEachChange.sql
  - src/Whizbang.Data.Postgres/SchemaRollback.cs
  - src/Whizbang.Data.Postgres/StoredFormApplier.cs
  - src/Whizbang.Data.Postgres/MigrationReversal.cs
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
  - tests/Whizbang.Core.Tests/Versioning/UpgradeOrderTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/StandbyWatcherUpgradeStandDownTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/UpgradeStandDownE2ETests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/RollbackGateTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/SchemaRollbackTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StoredFormApplierTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/Migrations/OnePassReadsCurrentTests.cs
  - tests/Whizbang.Data.Dapper.Postgres.Tests/DapperSchemaRollbackTests.cs
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
| Nothing newer online, nothing applied since my version, and the schema is [already current](#current) | `Current` | Skips the bootstrap, the election, the stored-form rewrite and the migration pass, so it takes **no schema lock**; Converge and Coordinate still run |
| Nothing newer online, nothing applied since my version, and the schema could not be shown current | `Serve` | Runs startup as it always has: the election, the pass under the schema lock (which finds nothing to do when every hash matches), Converge and Coordinate. A ledger that records a newer version which applied nothing since mine is here too: a rollback with nothing migrated since serves |
| A strictly **newer** application or library version is [online](#cluster-wide-stand-down) (a live, serving instance) | `StandDown` | [Applies nothing and holds the data plane](#standing-down), while it stays alive and visible; it resumes once nothing newer is serving |
| Schema changes were [applied after my version](#the-rollback-gate) by a newer version, nothing newer is online, and [every one can be reversed](#rolling-back) | `Migrate`, with a rollback owed | The instance doing the schema work runs the reverse scripts the newer version stored, then migrates as usual. A change whose reversal discards data counts only when `Whizbang:Startup:AllowLossyRollback` is `true` |
| A schema change was [applied after my version](#the-rollback-gate) by a newer version, and one of them cannot be reversed (or would discard data, and the operator has not allowed it) | `StandDown`, or `Current` when [the override](#the-incompatibility-override) is on | Stands down with an error naming each change that blocks the rollback and who applied it; with the override, serves the schema as it is |
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

**Both versions order, the application first** (see [application version first](#application-version-first)). The library version orders by semantic versioning, with the details that are load-bearing rather than pedantic: pre-release precedence is the common path (`0.9.4-alpha.3` < `0.9.4-beta.1` < `0.9.4`), numeric pre-release identifiers compare numerically (`alpha.10` > `alpha.2`), and build metadata is ignored. An unparseable library version of this binary is never guessed at: the instance refuses to migrate and reports the condition, because every wrong answer here is worse than stopping. The application version orders only like with like (SemVer, or a host-supplied deploy number), and an unknown one never orders, so an application that is not versioned is never stood down, or stands another down, by its application version.

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

**A database one complete schema pass has built reads as current on its next start.** The stored-form conversions
run before the pass, and the pass is what creates a new perspective table, so on a new database every conversion
finds its table missing and records nothing. A conversion with no record, on a table that holds no row, has nothing
to convert, and the currency check counts it as settled. A restart after the first start is therefore `Current`, and
takes no schema lock. Earlier releases counted every unrecorded conversion as pending: the second start ran a pass it
did not need, and a new database read as current only from its third start.

Nothing is recorded for such a table, so it is not settled for good. **Rows written into it later make the schema not
current again**, whoever wrote them (this release, or an earlier one still serving during a rollout), and the next
start runs the conversion over them, which settles it as usual. The check costs one existence read per unrecorded
table that exists, and only when the conversion has no record at all.

| Behavior | Why | Verified by |
|---|---|---|
| A conversion with no record, on a table with no row, has nothing to convert; one with no record on a table holding rows is still open. | The conversions run before the pass that builds the tables, so "no record" on a new table means "nothing was there", not "not checked"; a table that holds rows has not been checked, and calling it settled would skip owed work. | {verified: OnePassReadsCurrentTests.ADatabaseOnePassBuilt_ReadsAsCurrentOnTheNextStartAsync, StartupAssessorTests.StoredForms_AreSettledOnlyWhenEveryLedgerSaysSoAsync} |

Two cases that start as `Serve` and are expected to:

- **The first restart after rows reached a table the first start built.** The conversion has no record on that table
  and the table now holds rows, so the restart runs the conversion over them; it finds them already in the current
  form, settles, and the start after it is `Current`.
- **The start after a table's keys were rewritten.** A table whose keys a start rewrote stays open, and the next start checks it again (and reports any row still missing a [required member](../../fundamentals/perspectives/stored-form-migrations.md#declared-names-required), once); the start after that is `Current`. A table with rows missing a required member, which nothing at startup can repair, is settled after its check and reported once, so it no longer keeps the application at `Serve` on every start.
  {verified: DeclaredKeySpellingPassTests.UnrepairableRows_AreReportedOnce_AndTheirTableIsNotScannedAgainAsync, DeclaredKeySpellingPassTests.ATableRewrittenThisStart_ReportsItsMissingRowsOnTheNextStart_OnceAsync}

### Standing down {#standing-down}

A `StandDown` verdict means a newer version is online, or the database holds a change this binary did not make
(see [the rollback gate](#the-rollback-gate)). The instance:

- **applies nothing**: no bootstrap closure, no election, no stored-form rewrite, no pass, no managed-object reconcile;
- **holds the data plane**: the schema-ready gate stays closed, so no worker that needs the schema starts, no claim is made, and readiness answers 503 while liveness stays healthy. The `Assess` step fails as a blocking step, which keeps the pipeline incomplete;
- **stands down through the one run-control path**: the same path, and the same code, as a stand-down while running, a pause or a stop (see [below](#stand-down-takes-the-run-control-path));
- **stays visible**: it registers at once and records its stage as Preflight with the message `standing down: ` followed by the reason, which names the version the ledger records and this binary's own, and its phase as `Pausing`, then `StandingBy`. At stage Preflight it is never eligible for work;
- **keeps its row alive** with the heartbeat's own call, on the heartbeat interval, until the host stops. The heartbeat worker itself starts at Elect, which this instance never reaches. A beat that fails is logged and tried again on the next beat; a beat the registry refuses (the instance was evicted) ends the beating and [exits](instance-exits#evictions) with `ClusterEviction`, exit code 3.
- **does not exit.** It stays alive and standing by, because a stand-down can end: it [resumes](#resuming) when nothing newer is serving.

**Why it registers and stays visible.** The tables exist, because the database is newer than the binary, so registering is safe without a bootstrap. An operator watching a rollout that does not progress sees each stood-down instance in [`wh_instance_startup_stages()`](startup-status#seeing-every-instances-stage) with the reason, instead of a pod that is not ready for no stated reason. A host with no instance identity logs the stand-down at Warning and still applies nothing.
{verified: StartupParityTests.ANewerSchema_StandsDown_AppliesNothing_AndKeepsTheGateClosed_WhileVisibleAsync, SchemaInitializationRunnersTests.StandDown_RunsNoRunner_KeepsTheGateClosed_AndRegistersTheInstanceVisiblyAsync, SchemaInitializationRunnersTests.StandDown_WithNoInstanceIdentity_StillAppliesNothingAsync, StartupStandDownTests.Record_StaysInPreflight_NamingTheReason_AndStandsByAsync, StartupStandDownTests.KeepVisible_RegistersAtOnce_ThenOnEveryBeat_UntilTheHostStopsAsync, StartupStandDownTests.FromServices_BeatsOnTheHeartbeatCadence_AsTheRegisteredInstanceAsync, StartupStandDownTests.KeepVisible_AFailedBeat_IsRetriedOnTheNextBeatAsync, StartupStandDownTests.KeepVisible_WhenTheRegistryEvictedTheInstance_StopsBeatingAsync, StartupStandDownTests.KeepVisible_WhenTheRegistryEvictedTheInstance_ExitsOnce_AsAClusterEvictionAsync, AssessStartupStepTests.StandDown_ThroughTheRealPipeline_KeepsReadinessPendingForeverAsync}

**A direct call is refused.** `EnsureWhizbangInitializedAsync` (or a DbContext's `EnsureWhizbangDatabaseInitializedAsync`) on a stood-down host throws `SchemaStandDownException`, naming the reason, and applies nothing.
{verified: StartupParityTests.TheTurnkeyCall_OnAStoodDownInstance_IsRefused_AndAppliesNothingAsync, StartupVerdictBindingTests.AStandDown_IsRefused_NamingTheReasonAsync}

The stand-down composes with machinery that already exists: readiness stays withheld, the data-plane seams keep refusing, and liveness stays healthy, which is precisely the state that tells an orchestrator to replace the instance and a load balancer to stop sending it traffic. The fence runs *backwards* on purpose: a migrating instance can never wait for older instances to be retired (the orchestrator will not retire them until the new instance is ready, which requires migrating first), so the **older instance stands itself down** instead.

This covers an older instance **at its own start**. An older instance that is already running when a newer one comes online stands down through the [cluster-wide stand-down](#cluster-wide-stand-down), the [standby handshake](#the-standby-handshake) or its own [re-check](#runtime-re-check), on the same path.

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

At Preflight nothing is held and no role is won, so the path closes the permit and writes the two phases. A revival
lifts the stand-down and nothing else: when no other reason holds, `Resuming` is recorded, the permit reopens, and
`Running` is recorded. An instance an operator also paused stays `Paused` after the revival, until the operator
resumes it ([several reasons at once](../../resilience/managed-resource-run-control#several-reasons)). A host without the worker
pipeline has no permit, no held work and no roles, and records `StandingBy` alone.
{verified: StartupStandDownTests.Record_WithTheRunControlPath_StandsDownThroughItAsync, StartupStandDownTests.FromServices_TakesTheRegisteredRunControlPathAsync, StandbyWatcherTests.ANewerLivePeersRequest_StandsDownThroughTheRunControlPathAsync, StandbyWatcherTests.AWithdrawnRequestAndARollback_RevivesUsAsync, StandbyWatcherTests.ARevival_WhileAnOperatorsPauseHolds_LeavesTheInstancePausedAsync, CoordinationSourceGuardTests.HaltingPhases_AreWrittenOnlyByTheRunControlPathAsync}

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

The verdict is **not a startup-only fact**. An instance that was current when it booted becomes obsolete the moment a newer peer comes online or migrates underneath it, so a lightweight watcher re-checks on the same signal-plus-poll footing as capability re-attempt (`ObsolescenceInterval`, see [the watcher's clock](#the-watchers-clock)), and asks at once when a signal says something changed (see [cluster-wide stand-down](#cluster-wide-stand-down)). Standing down is a state an instance can enter at any time, and leave when the verdict no longer says so.
{verified: StandbyWatcherTests.OnceStoodDown_FurtherTicksInsideTheSlowCadence_DoNothingAsync, StandbyWatcherTests.OnceStoodDown_AVerdictThatStillSaysStandDown_ChangesNothingAsync}

## Cluster-wide stand-down {#cluster-wide-stand-down}

A rollout of a newer version, of the application or of the library, stands every older instance down, wherever it is
in its life. Before, an older instance stood down only at its own start or through the standby handshake of a breaking
migration; an older instance already serving kept serving beside the newer one until the orchestrator replaced it.

1. **The newer instance announces itself.** Once it serves (Accept commands or Running), the `StandbyWatcher` of an
   instance that the one version rule finds newer than some online instance publishes a durable
   [`NewerVersionOnlineSignal`](../../fundamentals/signal-bus/signal-bus#coordination-signals), once, and again after
   each resume, so an older instance that resumed meanwhile hears it. An instance with nothing older online announces
   nothing.
2. **Every older instance asks the verdict again.** The signal, and an `InstanceDiedSignal` or `InstanceLeavingSignal`
   (an instance went away), make the watcher's next tick read the one [Assess verdict](#assess) at once; without a
   signal it reads it on its slow cadence (`ObsolescenceInterval`). The verdict now reads the live, serving instances
   beside the migration ledger, on both drivers (`IOnlineVersionReader`), so it is the same verdict a fresh start of
   this binary would get.
3. **An older instance stands down** through the [one run-control path](#stand-down-takes-the-run-control-path): stop
   claiming, finish or release held work, release its roles, record `StandingBy`. Before the phase, its row's stage
   message says why, `standing down: ` followed by the reason, which names the newer version and the instance it runs
   on (`instance <id> is online with application version 2.4.0, newer than this instance's 2.3.1`). The stand-down is
   logged once, at Warning (`StandbyWatcher` EventId 3, `Standing down as obsolete: <reason>`).
4. **The maintenance role moves** on the newer instance's normal vote, since the older holder released it.

An instance that **starts** while a newer one is online gets the same verdict at Assess and stands down at once.

| Behavior | Why | Verified by |
|---|---|---|
| A newer instance announces itself once it serves, once per time it comes to serve, and only when an older instance is online. | An announcement before the newer instance can take over would stand the fleet down with nobody to serve; one with no older instance online is noise. | {verified: StandbyWatcherUpgradeStandDownTests.OnceServing_ANewerInstance_AnnouncesItselfOnce_WhenAnOlderOneIsOnlineAsync, StandbyWatcherUpgradeStandDownTests.WithNoOlderInstanceOnline_NothingIsAnnouncedAsync, StandbyWatcherUpgradeStandDownTests.BeforeTheInstanceServes_NothingIsReadOrAnnouncedAsync, StandbyWatcherUpgradeStandDownTests.AnInstanceThatResumes_AnnouncesAgain_SoAnOlderOneThatResumedMeanwhileStandsDownAsync} |
| The signal is a durable decision. | An older instance that missed the notification is told by its tail; one that starts later reads the online instances at Assess. | {verified: UpgradeStandDownE2ETests.ANewerApplicationVersionOnline_StandsAnOlderInstanceDown_NamingTheNewerInstanceAsync, UpgradeStandDownE2ETests.ANewerLibraryVersionOnline_StandsAnOlderInstanceDownAsync} |
| The signal makes the next tick ask the verdict; an instance going away does too; without either, the slow cadence decides. | The signal is a doorbell for a decision the database makes: who is newer is read from the instance rows through the one rule, never taken from the signal. | {verified: StandbyWatcherUpgradeStandDownTests.ANewerVersionOnlineSignal_IsAskedAboutOnTheNextTick_InsideTheSlowCadenceAsync, StandbyWatcherUpgradeStandDownTests.AGracefulLeave_AlsoPromptsTheQuestionAsync, StandbyWatcherUpgradeStandDownTests.OnceStoodDown_ATickInsideTheSlowCadence_WithNoSignal_ReadsNothingAsync, StandbyWatcherUpgradeStandDownTests.WithTheBusButNoFleetReader_NothingIsAnnounced_AndTheSignalsStillPromptTheQuestionAsync} |
| Standing down says why on the row before the phase, and is logged once; two newer instances arriving together stand it down once. | An operator watching a rollout sees why each older instance stopped serving, without one line per tick. | {verified: StandbyWatcherUpgradeStandDownTests.StandingDown_SaysWhyOnTheRow_BeforeThePhase_AndIsLoggedOnceAsync, StandbyWatcherUpgradeStandDownTests.TwoNewerInstancesComingOnlineAtOnce_StandTheInstanceDownOnceAsync, StandbyWatcherUpgradeStandDownTests.WithoutAStageRecorded_TheStandDownStillTakesThePathAsync} |
| Only live, serving instances count as online; an instance the rule calls dead, an evicted one, or one not yet serving does not. The instance's own row never stands it down. | A newer instance still migrating, or one that died, must not take the fleet down with it. | {verified: UpgradeStandDownE2ETests.ANewerInstanceTheRuleCallsDead_OrOneEvicted_IsNotOnlineAsync, UpgradeStandDownE2ETests.TheInstancesOwnRow_NeverStandsItDownAsync, UpgradeStandDownE2ETests.ReadOnline_ReturnsEveryServingLiveInstance_WithBothVersionsAsync, DapperStartupAssessorTests.AnEqualOrOlderVersionOnline_OrOneNotYetServing_StandsNothingDownAsync} |
| Both drivers read the online instances at Assess. | The drivers are meant to start near-identically; a Dapper host must stand down beside a newer instance exactly as an EF Core host does. | {verified: DapperStartupAssessorTests.ANewerApplicationVersionOnline_StandsAnOlderInstanceDown_AsTheEFCoreDriverDoesAsync, DapperStartupAssessorTests.TheOnlineVersions_AreReadForTheAnnouncementAsync, UpgradeStandDownE2ETests.OnADatabaseWithoutTheLivenessRule_OnlyTheLedgerIsReadAsync} |
| The stood-down holder releases the maintenance role; the newer instance takes it on its next vote, and a re-vote follows its death. | One-way handover on the normal role cycle: no special transfer to get wrong. | {verified: UpgradeStandDownE2ETests.AStoodDownHolder_ReleasesTheMaintenanceRole_TheNewerInstanceTakesItOnItsNextVote_AndAReVoteFollowsItsDeathAsync} |

### Application version first {#application-version-first}

Every instance records [two versions](startup-status#both-versions): the application's and the library's. Either can
be what a rollout changes. One rule orders them, `UpgradeOrder`, and it is the only place a version is compared:
Assess, the running re-assessment, the announcement, the standby handshake and the migration guard all ask it.

- **The application version decides first.** The newest application has priority. Application versions order like
  with like: SemVer against SemVer, a host's deploy number against a deploy number.
- **The library version decides only when the application versions are equal, unknown, or of different schemes.**
- **Only a strictly newer version is found.** Equal versions do nothing, and an older instance never stands a newer one
  down.
- **An unknown application version never orders.** It neither stands another instance down nor is stood down by
  application version alone; the library version still decides between such instances.

**Why the application first.** Read separately, crossed versions (a newer application on an older library, against an
older application on a newer library) would stand both down and take the fleet with them. Read in this order, exactly
one of the pair stands down: the older application. Whether the newer application may then serve a schema its library
did not create is the [rollback gate's](#the-rollback-gate) question, not this order's.

| Behavior | Why | Verified by |
|---|---|---|
| Crossed versions: the application decides, so exactly one of the pair stands down. | The newest application has priority (owner decision); two stand-downs would leave nothing serving. | {verified: UpgradeOrderTests.CrossedVersions_TheApplicationDecides_SoExactlyOneOfThePairStandsDownAsync, UpgradeOrderTests.ALaterLibraryFinding_NeverDisplacesAnApplicationOne_AndTheLedgerNeverDisplacesAnEqualOnlineOneAsync} |
| Application versions of different schemes do not order; an unreadable library version leaves the application to decide. | Two schemes say nothing about each other, and a version that cannot be ordered must not pretend it can. | {verified: UpgradeOrderTests.ApplicationVersionsOfDifferentSchemes_DoNotOrderAsync, UpgradeOrderTests.AnUnreadableLibraryVersion_LeavesTheApplicationVersionToDecideAsync, StandbyWatcherUpgradeStandDownTests.WithoutAnApplicationVersion_OnlyTheLibraryVersionCanMakeItNewerAsync} |
| A newer instance never finds an older one newer; equal versions find nothing. | One-way only: a stand-down for a version that is not strictly newer would be a stand-down for nothing. | {verified: UpgradeOrderTests.ANewerInstance_NeverFindsAnOlderOne_AndEqualVersionsFindNothingAsync, UpgradeOrderTests.OlderThan_IsTheSameRuleAskedFromTheNewerSideAsync, UpgradeOrderTests.TheInstancesOwnRow_IsNeverASightingAsync} |
| Of several findings, the reason names the application one, the newest, an online instance over the ledger, then the lowest instance id. | The reason does not depend on the order things were read in, so two instances report the same cause. | {verified: UpgradeOrderTests.OfSeveralFindings_TheApplicationOne_TheNewest_AndAnOnlineInstanceOverTheLedger_IsReportedAsync, UpgradeOrderTests.OfTwoInstancesOnlineAtTheSameNewerVersion_TheLowerIdIsReported_WhicheverIsSeenFirstAsync, UpgradeOrderTests.TheReason_NamesTheVersionsAndWhereTheNewerOneWasSeenAsync} |
| No version is compared outside `UpgradeOrder`. | A second comparison is a second rule, and two rules are how one instance read as newer to one reader and older to another. A source guard fails the build's tests on any comparison elsewhere ([gravity](../../../contributors/gravity.md#version-rule-guard)). | {verified: CoordinationSourceGuardTests.VersionOrdering_AppearsOnlyInTheOneRuleAsync, CoordinationSourceGuardTests.TheVersionScan_SeesWhatItGuardsAsync} |

### The rollback gate {#the-rollback-gate}

A newer version recorded in the migration ledger used to stand an older binary down, whatever it had recorded: an
application rolled back to the version before it could not serve, even when the newer version had changed nothing in
the schema. Now an instance serves a database a newer version has touched **only when nothing was applied after its
own version**:

- no W! migration applied by a newer **library**;
- no application schema change (a perspective table, an association, an application object) applied by a newer
  **application or library**, since the library generates those from the application's model;
- no stored-form conversion applied by a newer **application or library** (see below).

When something was applied since, Assess asks whether every such change can be reversed. When it can, and nothing
newer is online, the verdict is `Migrate` with a rollback owed, and the instance [rolls the schema back](#rolling-back)
before its pass. Otherwise the instance stands down at Assess. The stand-down reason, on the row and in the log, is the
gate's error. It names this instance's versions, how many changes were applied since, and the first five changes that
block the rollback, by name, with who applied each:

```text{title="The rollback gate's error" description="An instance rolled back after a newer version applied a change that cannot be reversed stands down naming the change and who applied it" category="Operations" difficulty="BEGINNER" tags=["Startup","RollingUpgrades","Rollback"] tests=["UpgradeOrderTests.AnIrreversibleChange_RefusesTheRollback_NamingOnlyWhatCannotBeReversed_AndTheVersionsAsync","UpgradeOrderTests.TheRefusal_NamesTheFirstFive_AndCountsTheRestAsync"]}
since this instance's version (library 1.0.0, application 1.9.0), 2 schema change(s) were applied by a newer version
that this version did not make, and 1 cannot be reversed: 351_X.sql (applied by library 2.0.0, application unknown);
a rollback runs only when every change since this version can be reversed; standing down: never apply anything, hold
the data plane, report not-ready-while-alive
```

A change that would discard data the newer version wrote is named the same way, with the key that allows it:

```text{title="The rollback gate's error for a lossy change" description="A rollback that would discard data stands down until the operator allows it" category="Operations" difficulty="BEGINNER" tags=["Startup","RollingUpgrades","Rollback"] tests=["UpgradeOrderTests.ALossyChange_RefusesTheRollback_UnlessTheOperatorAllowsItAsync"]}
since this instance's version (library 1.0.0, application 1.9.0), 2 schema change(s) were applied by a newer version
that this version did not make, and reversing 1 would discard data the newer version wrote: perspective:wh_per_orders
(applied by library 1.0.0, application 2.0.0); set Whizbang:Startup:AllowLossyRollback to true to roll back anyway
```

More than five changes end with `, and N more`. A change whose applier is unknown never stands an instance down.

**Stored-form conversions count too.** A stored-form conversion rewrites stored documents rather than the schema, and
is recorded in its own journal, not in `wh_schema_migrations`. Migration 385 has each journal record the library and
application version that converted rows: the stored-form migrations and the declared-key pass in
`wh_stored_form_migrations` (`applied_library_version`, `applied_application_version`), and the canonical temporal
rewrite in `wh_perspective_forms`. Assess reads each recorded conversion as an application schema change named
`stored-form:<name>` or `temporal-form:<table>`, so an older instance started after a newer one converted stored
documents stands down naming the conversion and who applied it. A conversion is never reversed (nothing can convert
the documents back), so a rollback across one always stands down.

- A pass that **converted rows**, or ran a custom migration (never assumed reversible), records its versions.
- A pass that **converted nothing** (a check, a settle) keeps what is recorded: a newer version that only found the
  documents already converted applied nothing.
- **Conversions recorded before this release name nobody** (the columns are `NULL`), and never stand an instance down,
  exactly as a ledger row with no known applier.

The schema initializer sets who applies the conversions once, for its whole start (`StoredFormApplier.ScopeTo`), and
every conversion records it from there, so no conversion added later has to be handed the versions or can forget them.

| Behavior | Why | Verified by |
|---|---|---|
| Each conversion that converts rows records who applied it, and a pass that converts nothing keeps the record. | A rollback after a newer version rewrote stored documents went unseen: the older version read documents in a form it does not know. A pass that only found them converted changed nothing a rollback could break. | {verified: StoredFormApplierTests.AStoredFormMigration_RecordsWhoConvertedRows_AndKeepsItThroughAPassThatConvertsNothingAsync, StoredFormApplierTests.ACustomMigration_RecordsWhoRanItAsync, StoredFormApplierTests.TheTemporalRewrite_RecordsWhoConvertedATable_AndKeepsItAsync, StoredFormApplierTests.TheDeclaredKeyPass_RecordsWhoMovedKeysAsync} |
| A conversion by a newer application or library stands the older instance down, naming it; one by this version or by nobody known does not. | The same rule as every other change applied since, so a conversion is judged exactly like a migration. | {verified: StoredFormApplierTests.AStoredFormConversionByANewerApplication_StandsTheOlderDown_NamingItAsync, StoredFormApplierTests.ATemporalConversionByANewerLibrary_StandsTheOlderDown_NamingItAsync, StoredFormApplierTests.AConversionByThisVersion_OrByNobodyKnown_DoesNotStandItDownAsync} |
| Outside the initializer's scope a conversion records nobody; on journals older than 385 the gate reads the ledger alone, and the declared-key pass still moves keys. | A version nobody set must not be invented, and a database an older release migrated must still start. | {verified: StoredFormApplierTests.OutsideAnyScope_AConversionRecordsNobodyAsync, StoredFormApplierTests.OnJournalsOlderThanTheRecord_TheGateReadsTheLedgerAloneAsync, StoredFormApplierTests.TheDeclaredKeyPass_OnAJournalOlderThanTheRecord_StillMovesTheKeysAsync, StoredFormApplierTests.ScopeTo_RestoresTheApplierBefore_AndRefusesNoneAsync} |

**Who applied each change** is recorded by migration 359 in `wh_schema_migrations.applied_version_id`, kept by a
trigger, so both drivers' ledger writers record it without a change and a writer added later cannot forget it:

- set to the row's version when the row is inserted or its content hash changes (the file was applied, or a
  perspective table or application object was rebuilt);
- kept as it was on every other write: a skip, a status update, a re-stamp;
- never moved by a failure: a failed step rolled back and applied nothing.

359 rewrites no existing row. A row last applied before it names its applier in `version_id` (the trigger carries it
over on its next write); a row last skipped names nobody and never blocks; and a ledger older than 359 takes the
version that last stamped each row, as before. During a rolling deploy an older release writes the ledger as before
and the trigger records what its writes applied.

| Behavior | Why | Verified by |
|---|---|---|
| An application or W! rollback with nothing migrated since serves. | A rollback that changed no schema is safe, and refusing it turned every bad application release into an outage. | {verified: RollbackGateTests.AnApplicationRollback_WithNothingMigratedSince_ServesAsync, RollbackGateTests.AWizbangRollback_WithNothingMigratedSince_ServesAsync, DapperStartupAssessorTests.AnApplicationRollback_WithNothingMigratedSince_ServesAsync, UpgradeOrderTests.NothingAppliedSinceThisVersion_AnApplicationRollbackHasNothingToFearAsync} |
| A rollback after a change it did not make, and cannot reverse, stands down, naming the change. | Serving a schema the binary does not know is the silent corruption the stand-down exists to prevent (owner decision: an irreversible rollback is an outage with an error that names why). | {verified: RollbackGateTests.AnApplicationRollback_AfterAnApplicationSchemaChange_StandsDown_NamingItAsync, RollbackGateTests.AWizbangRollback_AfterAWizbangMigration_StandsDown_NamingItAsync, DapperStartupAssessorTests.AnApplicationRollback_AfterAnApplicationSchemaChange_StandsDown_NamingItAsync, DapperStartupAssessorTests.AWizbangRollback_AfterAWizbangMigration_StandsDown_AndOneThatOnlyReStamped_ServesAsync} |
| A W! migration is judged by the library version alone; an application schema change by either version. | The library owns its migrations; it also generates the application's schema from the model, so a newer library can change that schema too. | {verified: UpgradeOrderTests.APlatformMigration_IsJudgedByTheLibraryVersionAloneAsync, UpgradeOrderTests.AnApplicationSchemaChange_AppliedByANewerApplication_IsFoundAsync, UpgradeOrderTests.AnApplicationSchemaChange_AppliedByANewerLibrary_IsFound_WhateverTheApplicationVersionAsync, UpgradeOrderTests.AChangeWithNoReadableApplier_NeverStandsAnInstanceDownAsync, UpgradeOrderTests.EqualVersions_FindNothingAppliedSinceAsync} |
| The ledger records who applied a change and keeps it through skips, re-stamps and failures; a step row is progress, not a change. | `version_id` is rewritten by every pass, a skipping one included, so it says who last looked at a file, not who changed the schema. | {verified: RollbackGateTests.TheLedger_RecordsWhoAppliedAChange_AndKeepsItThroughSkipsAndFailuresAsync, RollbackGateTests.AStepRow_IsProgress_NotAChangeAsync, RollbackGateTests.EqualVersions_DoNothingAsync, UpgradeStandDownE2ETests.ALedgerOnlyReStampedByANewerApplication_StandsNothingDownAsync} |
| A row last applied before 359 is read as applied by its version; on a ledger older than 359 whoever last stamped a row applied it. | No ledger row is rewritten (a ledger write is what a pass and its observers count as work), and an older ledger keeps the rule it had. | {verified: RollbackGateTests.ARowLastAppliedBeforeTheRecord_IsTakenAsAppliedByItsVersion_ThroughLaterSkipsAsync, RollbackGateTests.ARowLastAppliedBeforeTheRecord_AndNotWrittenSince_IsReadAsAppliedByItsVersionAsync, RollbackGateTests.OnALedgerOlderThanTheRecord_WhoeverLastStampedARow_IsTakenToHaveAppliedItAsync, UpgradeStandDownE2ETests.ALedgerThatRecordsNoApplicationVersion_IsReadForItsLibraryVersionsAloneAsync} |

:::updated{version="1.0.0" type="breaking"}
**Behavior change: the rollback gate replaces "the ledger records a newer version".** An application or W! rollback
with nothing migrated since now serves normally, where before any newer version the ledger named stood it down. A
rollback after a newer version applied a change still stands down, now with an error naming each change.
:::

:::new
**Rollbacks.** A rollback after a newer version applied only changes that can be reversed now
[rolls the schema back](#rolling-back) instead of standing down, and stored-form conversions count as changes applied
since. Every migration before this release, every stored-form conversion and every Dapper perspective change is
irreversible, so those rollbacks stand down exactly as before.
:::

### Rolling back {#rolling-back}

An older version started against a database a newer version migrated **rolls the schema back to its own version** when
three things are true:

- **nothing newer is online**: a newer instance still serving is a rollout in progress, and the
  [newer-version-online rule](#cluster-wide-stand-down) still wins;
- **every change applied since its version can be reversed**, as the newer version recorded when it applied each one
  ([how a migration is reversed](../infrastructure/migrations#how-a-migration-is-reversed));
- **no change would discard data**, or the operator allows it with `Whizbang:Startup:AllowLossyRollback=true`.

Assess then returns `Migrate` with a rollback owed (`StartupAssessment.Rollback`), and its reason names every change it
reverses:

```text{title="Assess decides on a rollback" description="The reason of a Migrate verdict that owes a rollback" category="Operations" difficulty="BEGINNER" tags=["Startup","RollingUpgrades","Rollback"] tests=["UpgradeOrderTests.TheRollback_IsDescribedWithEveryChangeItReversesAsync","RollbackGateTests.EveryChangeSinceReversible_MigratesWithARollbackOwed_NamingWhatItReversesAsync"]}
since this instance's version (library 1.0.0, application 1.9.0), 1 schema change(s) were applied by a newer version
that this version did not make, and every one can be reversed: rolling back perspective:wh_per_orders (applied by
library 1.0.0, application 2.0.0)
```

**Who runs it.** Only the instance doing the schema work: on the EF Core driver the elected migrator, as the first of
the [phases it runs before the schema lock](../infrastructure/migrations#pre-lock-phases), before the stored-form
rewrite; on the Dapper driver, which holds no election, the schema runner before its pass. Either way it runs under the
schema lock, so it is kept to one instance. On the EF Core driver it needs a connection of its own: a start that owes
a rollback with no initialization connection string and no registered `NpgsqlDataSource` fails, naming the schema,
rather than running the pass over the newer version's schema.

**How it runs** (`SchemaRollback`):

1. It opens one transaction and takes the schema lock in it.
2. It **decides again under the lock**, from the same ledger and the same rule: another instance may have finished the
   rollback while this one waited (nothing is left, and nothing runs), a newer version may have come online, or a
   change may have been recorded that cannot be reversed. In the last two cases nothing runs and the start fails,
   naming why.
3. It runs the reverse scripts the newer version stored in the ledger, **newest first**: the changes the latest
   version applied, then the version before it; within one version the application schema before the library's
   migrations (the pass applies them the other way round), each in reverse name order.
4. **Each reversed change leaves the ledger**, so the pass that follows migrates from this version's point of view and
   re-applies what this version wants.
5. It commits. A reverse script that fails undoes the whole rollback; the error names the change and who applied it,
   nothing was rolled back, and the next start decides again.

**An instance already running never rolls back in place.** When the verdict of a running instance comes to owe a
rollback (for example, one that stood down for a newer version that applied only reversible changes and then went
offline), it does not resume: it exits as an intended `UpgradeStandDown`, and its restart runs startup, where the
instance doing the schema work rolls the schema back before anything serves. Resuming reopens only the run permit and
never runs the schema pass again, so resuming in place would serve the newer schema with nothing rolled back.

It logs a Warning when it starts (`Rolling back schema <schema> to library <v>, application <v>: <n> change(s) a newer
version applied, newest first`), one Information line per change (`Reversing <change> (<kind>) (<i>/<n>)`), and a
Warning when it finishes (`Rolled back schema <schema>: <n> change(s) reversed in <elapsed>`). Each change reversed
also counts as progress for [the migrator's stall limit](../infrastructure/migrations#a-stuck-migrator-loses-its-role).

**What cannot be rolled back.** An irreversible change always stands the instance down, with an error naming the
change and the versions (`AllowLossyRollback` does not lift it). Three kinds of change are irreversible:

- **every migration before this release** (through 384): none recorded a reverse, so a rollback across any of them is
  refused exactly as before;
- **every stored-form conversion**: nothing converts stored documents back;
- **every perspective change the Dapper driver makes**: it knows a perspective by its key, not by its table, so it
  cannot generate the drop that would reverse a table it created.

The [incompatibility override](#the-incompatibility-override) still applies to a refused rollback as it always did: the
instance starts as `Current` and serves the schema as it is, with nothing rolled back.

```json{title="Allow a rollback that discards data" description="Off by default. Lets an older version drop what a newer one added, rows included" category="Configuration" difficulty="ADVANCED" tags=["Startup","RollingUpgrades","Rollback","Configuration"] tests=["UpgradeOrderTests.TheLossyRollbackKey_IsOffUnlessItSaysTrue_AndRefusedLoudlyWhenItIsNotABooleanAsync","SchemaRollbackTests.ALossyChange_IsReversedOnlyWhenAllowedAsync"]}
{
  "Whizbang": {
    "Startup": {
      "AllowLossyRollback": true
    }
  }
}
```

Only `true` turns it on; a value that is not a boolean fails startup naming the key, rather than being read as off.

| Behavior | Why | Verified by |
|---|---|---|
| The newer version stores each reverse in the ledger when it applies the change, and the older version runs what is stored. | An older binary cannot know a newer migration any other way (owner decision). | {verified: RollbackGateTests.TheLedger_RecordsHowEachChangeIsReversed_AndAssessReadsItAsync, DapperSchemaRollbackTests.AnOwedRollback_RunsTheStoredReverseScripts_ThenThePassMigratesAsync} |
| A rollback runs by itself only when every change since is reversible and nothing newer is online; a lossy change needs the operator's key; an irreversible one always stands down. | Losing data the newer version wrote is the operator's call, never the library's; a change that cannot be undone is an outage with an error that names why (owner decision). | {verified: RollbackGateTests.EveryChangeSinceReversible_MigratesWithARollbackOwed_NamingWhatItReversesAsync, RollbackGateTests.ALossyChange_StandsDown_UnlessTheOperatorAllowsItAsync, RollbackGateTests.AReversibleChange_StillStandsDown_WhileANewerVersionIsOnlineAsync, UpgradeOrderTests.WhenEveryChangeSinceIsReversible_NothingRefusesTheRollbackAsync, UpgradeOrderTests.AChangeWhoseReversalIsNotRecorded_IsIrreversibleAsync} |
| Newest first, in one transaction under the schema lock, each reversed change leaving the ledger; a failing script undoes the whole rollback and names the change. | A half-reversed schema matches no version; one transaction leaves either the newer schema or this version's, and the pass that follows starts from what this version knows. | {verified: SchemaRollbackTests.EveryChangeSince_IsReversedNewestFirst_InOneTransaction_AndLeavesTheLedgerAsync, SchemaRollbackTests.AReverseScriptThatFails_RollsBackTheWholeRollback_NamingItAsync} |
| It decides again under the lock: nothing left runs nothing; a newer version online, or an irreversible change, refuses. | The verdict was read without a lock, and another instance may have moved the database since. | {verified: SchemaRollbackTests.NothingAppliedSince_ReversesNothingAsync, SchemaRollbackTests.ANewerVersionOnlineUnderTheLock_IsRefusedAsync, SchemaRollbackTests.AnIrreversibleChangeUnderTheLock_IsRefused_NamingItAndTheVersionsAsync, SchemaRollbackTests.ARequestWithoutWhatItNeeds_IsRefusedAsync} |
| The Dapper runner runs the owed rollback before its pass, and records every perspective change it applies as irreversible. | The runner is the one place both happen, so no host-side step has to remember them; a driver that cannot generate a reverse must not claim one. | {verified: DapperSchemaRollbackTests.TheRunner_RunsTheRollbackTheVerdictOwes_BeforeThePassAsync, DapperSchemaRollbackTests.APerspectiveTableThePassApplies_IsRecordedAsIrreversible_SinceTheDriverKnowsItOnlyByKeyAsync} |

### The incompatibility override {#the-incompatibility-override}

`Whizbang:Startup:OverrideIncompatibility` (off by default) lets an instance start when Assess would stand it down for
an **incompatibility**: the schema newer than its build, or a change it cannot reverse applied since its version.

- **What it does.** The instance starts as `Current`: no election, no pass, no converge, nothing applied, and no
  migration run backward. It serves the schema as it is.
- **What it does not override.** The stand-down for a [newer version online](#cluster-wide-stand-down), which is not an
  incompatibility, and the refusal of a build whose own library version is missing or unreadable.
- **It says so, loudly, at every start.** An Error from `StartupAssessmentSource` (EventId 3):
  `Running past an incompatibility verdict because Whizbang:Startup:OverrideIncompatibility is on: startup's verdict was StandDown: <the full reason>. This build serves a schema it did not create; nothing is applied and no migration runs, and the instance row records the override`.
- **It is on the row.** The reason the verdict would have stood the instance down is written to
  `wh_service_instances.incompatibility_override` (migration 360) once the instance registers, so operators and peers
  can see it without reading logs. Every other instance's column is `NULL`.
- **Only `true` turns it on.** A value that is not a boolean fails startup naming the key, rather than being read as
  off.

Only the one verdict reads and honors the key; everything else learns of an override from
`StartupAssessment.OverriddenReason`. A source guard fails the build's tests on any other reader.

```json{title="Run past an incompatibility verdict" description="Off by default. An emergency setting for serving a schema this build did not create; it logs at Error on every start and records the override on the instance row." category="Configuration" difficulty="ADVANCED" tags=["Startup","RollingUpgrades","Configuration"] tests=["UpgradeOrderTests.TheOverride_IsOffUnlessTheHostTurnsItOnAsync","RollbackGateTests.TheOverride_LetsAnIncompatibleInstanceServe_WithoutAMigration_AndCarriesTheFullReasonAsync"]}
{
  "Whizbang": {
    "Startup": {
      "OverrideIncompatibility": true
    }
  }
}
```

| Behavior | Why | Verified by |
|---|---|---|
| With the override on, an incompatible instance serves as `Current`, applying nothing, and carries the full reason. | An operator who must keep an older build serving (a rollback across a change that cannot be reversed) gets a way to do it that changes nothing in the schema. | {verified: RollbackGateTests.TheOverride_LetsAnIncompatibleInstanceServe_WithoutAMigration_AndCarriesTheFullReasonAsync, RollbackGateTests.TheOverride_AgainstTheRealLedger_ServesWhatTheGateRefusesAsync, StartupParityTests.TheIncompatibilityOverride_StartsWhatTheGateRefuses_LogsIt_RecordsIt_AndAppliesNothingAsync} |
| It never lifts the stand-down for a newer version online, nor serves a build that cannot say what it is. | A newer version online is a rollout in progress, not an incompatibility; and an unknown build cannot be judged at all. | {verified: RollbackGateTests.TheOverride_NeverOverridesANewerVersionOnlineAsync, StartupParityTests.TheIncompatibilityOverride_DoesNotOverrideANewerVersionOnlineAsync, RollbackGateTests.TheOverride_NeverServesABuildThatCannotSayWhatItIsAsync} |
| On a compatible instance it changes nothing, logs nothing and records nothing. | Leaving it on after the emergency must not make every later start look overridden. | {verified: RollbackGateTests.TheOverride_OnACompatibleInstance_ChangesNothingAsync, StartupParityTests.TheIncompatibilityOverride_OnACompatibleInstance_LogsNothing_AndRecordsNothingAsync, StartupAssessmentSourceTests.ACompatibleVerdict_LogsNoOverrideAsync} |
| An override in use is logged at Error once per start, with the verdict and its full reason, and recorded on the row. | Running past a verdict is a decision an operator must keep seeing (owner decision), and peers must be able to see it without reading logs. | {verified: StartupAssessmentSourceTests.AnOverriddenIncompatibility_IsLoggedLoudly_OncePerStart_WithTheVerdictAndItsFullReasonAsync, RollbackGateTests.TheOverrideRecord_IsWrittenOnlyWhereThereIsARowAndAPlaceForItAsync, DapperStartupAssessorTests.ServingAsItIs_RegistersTheInstance_WithItsConnectionModeAndLivenessWindow_AndTheOverrideAsync} |
| Off unless the host says `true`; anything that is not a boolean is refused. | An explicit setting stated wrong is told at once, never silently read as off. | {verified: UpgradeOrderTests.TheOverride_IsOffUnlessTheHostTurnsItOnAsync, UpgradeOrderTests.AnOverrideThatIsNotABoolean_IsRefusedLoudly_NeverReadAsOffAsync} |
| Only the one verdict reads and honors the key. | Anything else that read it could start an instance the verdict refused. | {verified: CoordinationSourceGuardTests.TheIncompatibilityOverride_IsHonoredOnlyByTheOneVerdictAsync, CoordinationSourceGuardTests.TheOverrideScan_SeesWhatItGuardsAsync} |

### Resuming after a stand-down {#resuming}

A stood-down instance **resumes** when the verdict no longer says stand down: the verdict a fresh start of this binary
would get. For example, the newer instance died, so nothing newer is serving. It resumes through the run-control path,
re-entering the pipeline at Assess: `Resuming`, the permit reopens, `Running`, unless an operator's pause still holds.
Its row's stage message then reads `resumed: ` followed by the reason, and the watcher logs it once at Information
(EventId 6, `Resuming after standing down: nothing newer is recorded or online any more (<reason>)`). The older
instances then vote for the roles normally. A newer instance that **migrated** the schema before it died left its
change in the ledger, which keeps them down (the [rollback gate](#the-rollback-gate)); a [rollback](#rolling-back)
runs only when an instance starts, on the instance doing the schema work.

| Behavior | Why | Verified by |
|---|---|---|
| A stood-down instance resumes when the newer instance dies, because a fresh start would serve. | Before, an instance stood down at runtime stayed down until replaced; if the rollout failed, the fleet was left with nothing serving (owner decision: resume, unless the database moved beyond what it can serve). | {verified: StandbyWatcherUpgradeStandDownTests.TheNewerInstanceDies_TheStoodDownInstanceResumes_BecauseAFreshStartWouldServeAsync, StandbyWatcherUpgradeStandDownTests.WhileTheVerdictStillSaysStandDown_ADeathResumesNothingAsync} |
| A flapping deploy takes each transition once and ends where the last verdict says. | Each stand-down and resume is a release and a re-acquire of work and roles; churn would cost more than either state. | {verified: StandbyWatcherUpgradeStandDownTests.AFlappingDeploy_TakesEachTransitionOnce_AndEndsWhereTheLastVerdictSaysAsync} |
| An operator's pause outlives the resume. | Each reason belongs to its owner; the resume lifts only the stand-down. | {verified: StandbyWatcherUpgradeStandDownTests.AnOperatorsPause_OutlivesTheResumeAsync} |
| A watcher without a stage reporter, the bus or the fleet reader still stands down and resumes through the path; it neither announces nor subscribes without the bus. | A host composed with less still takes the one path; it only loses what it has no way to do. | {verified: StandbyWatcherUpgradeStandDownTests.WithoutAStageReporter_TheStandDownAndTheResumeStillTakeThePathAsync, StandbyWatcherUpgradeStandDownTests.AWatcherWithoutTheBusOrTheFleet_NeitherAnnouncesNorSubscribesAsync, StandbyWatcherUpgradeStandDownTests.WithoutALifecycleToTellWhenItServes_NothingIsAnnouncedAsync, StandbyWatcherUpgradeStandDownTests.Disposing_TheWatcher_ReleasesItsSubscriptionsAsync, StandbyWatcherUpgradeStandDownTests.AFailedReadOrPublish_IsTriedAgainOnTheNextTickAsync} |

:::updated{version="1.0.0" type="breaking"}
**Behavior change:** a stood-down instance resumes when the verdict no longer says stand down. Before, an instance
stood down by the runtime re-assessment stayed down until it was replaced. A change applied since its version still
keeps it down.
:::

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
- **Revival is not a second pipeline.** The migration is one transaction: a rollback leaves the ledger exactly as the standing-by instances last read it. Coming out of standby is **re-entering the pipeline at `Assess`**: the verdict comes back *same as me*, `Migrate` finds matching hashes and no-ops, capabilities are re-acquired, and the run-control path lifts the stand-down: it writes `Resuming`, reopens the run permit and writes `Running`, so the data plane takes work again, unless an operator's pause still holds. The [pipeline runner](startup-pipeline) is re-entrant for exactly this reason.

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

Bounding the wait by liveness handles the *decision*; it does not handle the *process*, which may still be running: a pod paused by a long collection or a brief partition comes back and carries on against a schema that has moved. For a breaking migration that is not survivable, so the migrator (or an operator) **evicts** the unresponsive peer: a durable tombstone recording who issued it and when, delivered through the instance's own next heartbeat, and enforced where effect happens: [capability acquisition refuses an evicted instance](capabilities-and-duties#winning-a-duty). A restarted pod draws a new instance id and is unevicted. The zombie learns of its eviction on its next beat and [exits](instance-exits#evictions) with `ClusterEviction`, exit code 3, so its host restarts it under a new instance id; it never rejoins under the old one.

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
- [Instance Exits](instance-exits): the one exit path, an eviction's exit, and why a stood-down instance does not exit
