---
title: The Startup Pipeline
pageType: concept
verifiedAgainstCommit: 147ab39b
verifiedDate: 2026-11-26
version: 1.0.0
category: Startup
order: 1
description: >-
  Startup as a declared, ordered pipeline of steps — the step contract,
  the framework's own steps, observation and interrogation hooks, and how
  readiness and the data-plane seams compose from it
tags: >-
  startup, pipeline, steps, ordering, readiness, hooks, observers,
  schema-ready-gate, lifecycle, heavy-startup-work, heavy-start-cap
codeReferences:
  - src/Whizbang.Core/Startup/StartupStepDescriptor.cs
  - src/Whizbang.Core/Startup/StartupPipelineRunner.cs
  - src/Whizbang.Core/Startup/StartupPipelineState.cs
  - src/Whizbang.Core/Startup/IStartupStepObserver.cs
  - src/Whizbang.Core/Startup/StartupPipelineHosting.cs
  - src/Whizbang.Core/Startup/StartupReadiness.cs
  - src/Whizbang.Core/Health/StartupPipelineHealthSource.cs
  - src/Whizbang.Core/Startup/StartupWork.cs
  - src/Whizbang.Core/Startup/StartupWorkSession.cs
  - src/Whizbang.Core/Startup/StartupWorkOptions.cs
  - src/Whizbang.Data.Postgres/PgStartupWorkLedger.cs
  - src/Whizbang.Data.Postgres/StartupWorkSessions.cs
  - src/Whizbang.Data.Postgres/Migrations/630_HeavyStartupWorkIsCappedAndSharedWorkRunsOncePerBuild.sql
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ColdBootJourneyE2ETests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/TableRewriteJourneyE2ETests.cs
  - tests/Whizbang.Core.Unit.Workers.Tests/Startup/StartupPipelineRunnerTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/StartupPipelineHooksTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/StartupPipelineRunnerDutyTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/StartupReadyCompositeTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/StartupReadinessCoverageTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/StartupWiringAuditTests.cs
  - tests/Whizbang.Core.Unit.Workers.Tests/Startup/StartupStepOrderResolverTests.cs
  - tests/Whizbang.Core.Unit.Workers.Tests/Health/StartupPipelineHealthSourceTests.cs
  - tests/Whizbang.Core.Unit.Workers.Tests/Startup/StartupWorkCatalogTests.cs
  - tests/Whizbang.Core.Unit.Workers.Tests/Startup/StartupWorkSessionTests.cs
  - tests/Whizbang.Core.Component.Tests/Startup/StartupWorkDeclarationGuardTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupWorkLedgerSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupWorkSessionsTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupParity/StartupWorkParityTests.cs
---

# The Startup Pipeline

Whizbang startup is a **declared pipeline**: an explicit, ordered, individually-controllable sequence of steps. Each step states what it is, what it needs, who runs it, and whether the system may be considered ready without it — so "run this after that", "run this on exactly one instance", and "run this last" are things the framework expresses instead of things a comment claims.

Every instance walks the whole pipeline. What differs between instances is what happens at an *exclusive* step — one whose required capability is a [duty](capabilities-and-duties): there, one instance does the work and the rest either await its completion or skip past, per the step's declaration.

```mermaid{caption="The startup pipeline — every instance walks it; one instance runs each duty step, and a stand-down verdict holds the pipeline open." tests=["StartupPipelineRunnerDutyTests.DutyStep_NonHolderWithAwait_ReAttemptsUntilTheHoldersReleaseLetsItWinAsync","AssessStartupStepTests.StandDown_ThroughTheRealPipeline_KeepsReadinessPendingForeverAsync"]}
graph TB
    subgraph Assess["Assess &nbsp;&nbsp;(every instance)"]
        A1["compare my version against the ledger<br/>verdict: migrate · serve · stand down"]
    end
    subgraph Migrate["Migrate &nbsp;&nbsp;[migrator duty · non-holders await]"]
        M1["schema init · ledger · version stamp<br/>registry reconciles (in-transaction)"]
    end
    subgraph Ready["Ready"]
        Y1["blocking steps drained · consumers subscribed<br/>health flips · data plane opens"]
    end
    subgraph Post["Rewrite &nbsp;&nbsp;[maintainer duty · non-holders skip · post-ready]"]
        Z1["requested table rewrites<br/>observed, never awaited"]
    end
    Down["stand down<br/>capabilities released · data plane held<br/>not ready, still alive"]

    Assess --> Migrate --> Ready --> Post
    Assess -->|"newer schema found"| Down

    style Migrate fill:#cce5ff,stroke:#0d6efd,stroke-width:2px
    style Post fill:#e2e3e5,stroke:#6c757d,stroke-width:2px
    style Ready fill:#d4edda,stroke:#28a745,stroke-width:2px
    style Assess fill:#fff3cd,stroke:#ffc107,stroke-width:2px
    style Down fill:#f8d7da,stroke:#dc3545,stroke-width:2px
```

The run is **fail-closed by construction**: a blocking step that never completes keeps the pipeline incomplete, readiness withheld, and the data-plane seams refusing. And the runner is **re-entrant, not one-shot** — [revival from standby](rolling-upgrades#the-standby-handshake) re-enters the pipeline at `Assess` rather than needing a second mechanism.

## The step contract

Every step declares, rather than implies:

```csharp{title="The step descriptor" description="What a step states about itself" category="Implementation" difficulty="INTERMEDIATE" tags=["Startup","Pipeline"] tests=["StartupStepOrderResolverTests.Resolve_IsIndependentOfRegistrationOrderAsync","StartupStepOrderResolverTests.Resolve_PlacesDependencyBeforeDependentAsync"]}
public sealed record StartupStepDescriptor {
  public required string Name { get; init; }          // identity — appears in logs, metrics, status
  public IReadOnlyList<string> DependsOn { get; init; } = [];   // by name, not registration position

  // The capability an instance must hold to run this step. An exclusive capability (a duty)
  // means one instance runs it; the default shared capability means every instance does.
  public string RequiredCapability { get; init; } = StartupCapabilities.EVERY_INSTANCE;

  // Where the capability is a duty: what non-holders do — Await the holder, or Skip and carry on.
  public NonHolderBehavior NonHolderBehavior { get; init; } = NonHolderBehavior.Await;

  public bool Blocking { get; init; } = true;    // must complete before Ready, or runs after it
  public bool Enabled { get; init; } = true;     // individually switchable
}
```

A step's execution reports a `StartupStepReport` — an outcome plus a reason:

```csharp{title="Outcomes are three different facts" description="Completed, Skipped and Failed are distinguishable on purpose" category="Implementation" difficulty="BEGINNER" tags=["Startup","Pipeline"]}
public enum StartupStepOutcome {
  Completed,   // the step did its work
  Skipped,     // ran and deliberately did nothing — always with a reason
  Failed,      // could not complete — the reason carries what went wrong
}
```

The outcome field is load-bearing on its own: it is what makes *"this step found nothing to do"* distinguishable from *"this step could not run"*. A step that silently does nothing is otherwise indistinguishable from a step that succeeded — the pathology the pipeline exists to eliminate. At an exclusive step the same call reports a different outcome per instance: `Completed` on the instance that did the work, `Skipped("completed by another instance")` on the peers that awaited it. Those are genuinely different facts, and an operator needs to tell them apart.

Two rules from the contract generalize beyond any one step:

- **A step whose completion is not locally decidable must declare `Blocking = false`**, or the pipeline deadlocks on a distributed condition. Non-blocking steps are still steps — identity, dependencies, outcome, duration — they simply never gate `Ready`.
- **An every-instance step that touches shared rows must claim them** (partition scoping, `FOR UPDATE SKIP LOCKED`), otherwise "runs everywhere" means N replicas doing identical work against the same rows.

## Framework steps

The framework registers its own steps through the same contract — the built-in path and the consumer-visible path are the same path:

| Step | Capability | Non-holders | Blocking | What it does |
|---|---|---|---|---|
| `Assess` | every instance | — | yes | Compares this binary's library version against the migration ledger and produces a [verdict](rolling-upgrades#assess) before anything changes: `Migrate`, `Serve`, `Current` (the schema is already up to date, so the election and the migration are skipped and no schema lock is taken) or `StandDown`. The schema initializer acts on the same verdict, read once per host. `Current` completes like `Serve`. A `StandDown` verdict fails the step, which keeps the pipeline incomplete and readiness withheld: not-ready-while-alive. {verified: AssessStartupStepTests.CurrentVerdict_CompletesWithTheReason_LikeServeAsync, StartupAssessmentSourceTests.TheDefaults_RegisterOneSourceOverTheRegisteredAssessor_AndTheAssessStepReadsThroughItAsync} |
| `Migrate` | `migrator` (duty) | `Await` | yes | Schema initialization under the advisory lock; completes when the schema-ready gate opens. Depends on `Assess`. |
| `Rewrite` | `maintainer` (duty) | `Skip` | **no** | [Requested table rewrites](../infrastructure/migrations#table-rewrites-run-post-ready-under-the-maintainer-duty) (`VACUUM FULL`) — post-ready and deliberately unbounded, because a half-finished rewrite is worse than a slow one. Nobody blocks on it. |

`Migrate` and `Rewrite` want opposite non-holder answers, which is why the behaviour is a declared field and not a global rule: every instance must wait for the schema to exist, and no instance should ever wait on a `VACUUM FULL`.

## Heavy startup work {#heavy-startup-work}

The [Converge stage](startup-status#startup-stages) runs on every instance at every start. A mass restart (a rollout, an autoscaler adding instances under load) used to start that work on every instance at once, against the same schema. Each unit of it is now **declared with a scope**, and both Postgres drivers run every unit only through one startup work session (`StartupWorkSession`), which refuses a name nothing declares. So the fleet-wide cap and the once-per-build rule apply to all of it, and a new unit cannot skip them by forgetting a call: a source guard fails the build when heavy Converge work runs outside a session. {verified: StartupWorkDeclarationGuardTests.EveryHeavyConvergeCall_RunsInsideASessionRunOfADeclaredNameAsync, StartupWorkDeclarationGuardTests.EverySessionRun_NamesADeclaredUnit_AndEachDriverRunsEveryUnitItHasAsync, StartupWorkSessionTests.AnUndeclaredName_IsRefused_AndItsWorkNeverRunsAsync}

| Unit (`FrameworkStartupWork`) | Scope | What it does |
|---|---|---|
| `perspective-registry` | `PerSchemaPerBuild` | Checks the stored perspective registry against what this build declares, and reconciles it when they differ ([the registry check](../infrastructure/migrations#registry-check)) |
| `perspective-storage-settings` | `PerSchemaPerBuild` | Brings each perspective table's fillfactor and autovacuum settings in line with its model ([storage settings](../../fundamentals/perspectives/physical-fields#removed-storage-settings)) |
| `managed-object-reconcile` | `PerSchemaPerBuild` | Reconciles the [managed schema objects](../../fundamentals/perspectives/managed-schema-objects): creates, alters and drops. What each instance declares is reported apart from it, at every start ([the report](#the-managed-object-report)) |
| `analyze-new-indexes` | `PerInstance` | EF Core driver: statistics for each table this instance's own schema pass indexed |

{verified: StartupWorkCatalogTests.TheFrameworkWork_IsDeclared_WithTheScopeEachRunsUnderAsync, StartupWorkCatalogTests.WorkDeclaredWithoutADefinedScope_IsRefusedAsync}

There are two scopes and no default: a declaration states its scope or is refused.

- **`PerInstance`**: the work changes this instance, or records something about it. Every instance runs it at every start, within the [heavy-start cap](#the-heavy-start-cap).
- **`PerSchemaPerBuild`**: the work changes state the whole schema shares, the same way from any instance of one build. The first start of a build runs it, once per schema; every other start of that build skips it.

```mermaid{caption="How one unit of heavy startup work runs. Shared work is claimed before a permit is asked for, so a start whose shared work a peer did, or is doing, takes no permit for it." tests=["StartupWorkSessionTests.SharedWorkThisBuildFinished_IsSkipped_AndTakesNoPermitAsync","StartupWorkSessionTests.ClaimedSharedWork_RunsUnderAPermit_AndIsRecordedDoneForThisBuildsFingerprintAsync","StartupWorkSessionTests.PastTheCap_TheStartWaitsForAPermit_SaysSoOnce_AndRunsOnceOneIsFreeAsync","StartupWorkSessionTests.OnASchemaWithoutTheFunctions_EveryUnitRunsDirectly_AndAvailabilityIsAskedOnceAsync"]}
graph TB
    U["a declared unit"] --> A{"schema has<br/>migration 630?"}
    A -->|no| D["run it directly,<br/>uncapped, as before"]
    A -->|yes| S{"scope"}
    S -->|PerInstance| P
    S -->|PerSchemaPerBuild| C{"claim for this<br/>build's fingerprint"}
    C -->|done| K1["skip: already ran<br/>for this build"]
    C -->|running| K2["skip: a live instance<br/>of this build runs it"]
    C -->|claimed| P{"heavy-start permit<br/>(once per start)"}
    P -->|granted| R["run the work"]
    P -->|"cap reached"| W["wait in Converge,<br/>ask again"]
    W -->|"freed"| R
    W -->|"PermitWaitLimit"| R
    R -->|"completed"| X["record done"]
    R -->|"failed or unfinished"| Y["release the claim"]

    style D fill:#e2e3e5,stroke:#6c757d,stroke-width:2px
    style K1 fill:#d4edda,stroke:#28a745,stroke-width:2px
    style K2 fill:#d4edda,stroke:#28a745,stroke-width:2px
    style W fill:#fff3cd,stroke:#ffc107,stroke-width:2px
    style Y fill:#f8d7da,stroke:#dc3545,stroke-width:2px
```

### Once per schema per build {#once-per-build}

The record is `wh_startup_work` ([migration 630](../infrastructure/migrations)), one row per unit, read and written only through `wh_claim_startup_work` and `wh_complete_startup_work`, so every release that knows them runs one rule.

- **The identity is the build.** A claim is keyed by the unit's fingerprint: a SHA-256 of the library version, the unit's name and what that build gives the work (the registry payloads, the perspective schema, the managed objects declared and the reconcile settings). Two builds of one library version whose perspectives differ have different fingerprints. {verified: StartupWorkSessionTests.TheFingerprint_FollowsTheNameAndTheInputs_AndIsStableAsync, StartupWorkSessionsTests.TheInputs_KeepEveryListOfPartsDistinct_AndFollowEachPayloadAsync}
- **The first start claims it; the rest skip it.** Another start of the same build skips the unit while a live instance runs it and after it finished, and logs which at Information. A start that skips does not wait for the claimer; the claimer brings the shared state in line. Ten starts of one build at once claim it exactly once. {verified: StartupWorkLedgerSqlTests.TheFirstStartOfABuild_ClaimsSharedWork_ThePeersSkipIt_AndOnceDoneEveryLaterStartSkipsItAsync, StartupWorkLedgerSqlTests.TenStartsOfOneBuildAtOnce_ClaimTheWorkExactlyOnceAsync, StartupWorkParityTests.TheFirstStart_RecordsItsSharedWorkDone_ARestartOfTheBuildSkipsIt_AndNoPermitStaysHeldAsync}
- **A run that does not finish releases its claim.** A run that throws, is canceled, or completes without finishing (a registry check that failed, a storage pass that left a table behind) removes the row, so the next start runs it again. A throw still reaches the caller, after the release. {verified: StartupWorkLedgerSqlTests.ARunThatDidNotFinish_ReleasesItsClaim_AndTheNextStartClaimsItAsync, StartupWorkSessionTests.ARunThatDidNotFinish_ReleasesItsClaim_SoTheNextStartRunsItAgainAsync, StartupWorkSessionTests.ARunThatThrows_ReleasesItsClaim_AndTheFailureReachesTheCallerAsync, StartupWorkSessionTests.ACanceledRun_ReleasesItsClaim_OnAnUncanceledTokenAsync, StartupWorkSessionsTests.AStorageReconcile_IsCompleteOnlyWhenItReadEverything_AndLeftNoTableBehindAsync}
- **A claimer that is no longer live is taken over.** A claim held by an instance [the one liveness rule](../../fundamentals/workers/instance-liveness#liveness-rule) calls dead is claimed by the next start, with no deadline to tune; the dead claimer's late completion changes nothing. {verified: StartupWorkLedgerSqlTests.AClaimHeldByAnInstanceNoLongerLive_IsTakenOver_AndItsLateCompletionChangesNothingAsync}
- **It runs again on another build, a rollback included.** A different fingerprint claims the unit again, so the row always names the build that last changed the shared state, and rolling back re-runs what the newer build changed. {verified: StartupWorkLedgerSqlTests.AnotherBuild_ClaimsTheWorkAgain_SoARollbackRerunsWhatTheNewerBuildChangedAsync}
- **It runs again when the start's own schema pass applied anything.** Such a start claims the unit whatever the record says. {verified: StartupWorkLedgerSqlTests.AStartWhosePassAppliedSomething_ClaimsDoneWork_AndARetryOfItsOwnClaimSucceedsAsync, StartupWorkSessionTests.AStartWhosePassAppliedSomething_ClaimsSharedWorkEvenWhenItIsDoneAsync}

### Mixed versions {#heavy-startup-work-mixed-versions}

Nothing here is fatal, and nothing weakens what ran before:

- **An older release** never calls the new functions. It runs its startup work uncapped, as before, and holds no permit, so it is not counted against the cap.
- **A newer instance on a schema without migration 630** (the functions are looked up with `to_regprocedure`) runs every unit directly, uncapped, as before the cap existed. So does a start with no instance id or no connection of its own.
- **A ledger call that fails** (the availability read, a claim, a permit request) is logged at Warning, and the unit runs without the record or the permit. A claim or permit that cannot be given back is logged at Warning and is reclaimed once the instance is no longer live.

{verified: StartupWorkLedgerSqlTests.OnAMigratedSchema_TheLedgerIsAvailable_AndOnOneWithoutTheFunctionsItIsNotAsync, StartupWorkSessionTests.OnASchemaWithoutTheFunctions_EveryUnitRunsDirectly_AndAvailabilityIsAskedOnceAsync, StartupWorkSessionTests.WithNoInstanceId_TheWorkRunsDirectly_AndTheLedgerIsNotAskedAsync, StartupWorkSessionsTests.WithNoHostAndNoConnection_TheWorkRunsDirectlyAsync, StartupWorkSessionTests.AClaimThatCannotBeMade_RunsTheWorkDirectly_AtWarningAsync, StartupWorkSessionTests.APermitThatCannotBeGivenBack_IsSaidAtWarningAsync}

### The managed-object report {#the-managed-object-report}

The managed-object reconcile changes the schema the whole fleet shares, so it runs once per schema per build. But the [drop gate](../../fundamentals/perspectives/managed-schema-objects#rolling-deploys) keeps an object while any live instance still declares it, or has never said what it declares, so it needs a record from **every** live instance. If only the first start of a build recorded one, every other instance would stay unreported, and nothing would ever be dropped again.

So the record is its own step. **Every start reports** what its instance declares (one upsert of its own row in `wh_managed_object_declarations`, after a few catalog reads), and the **reconcile** (create, alter and drop) runs through the session, once per schema per build. The report takes no lock and no heavy-start permit, so it is made even while another session holds the schema lock, and it never fails a start: a report that cannot be made is logged at Warning, and the gate keeps every object while that instance runs unreported. {verified: StartupParityTests.ASecondStartOfTheBuild_ReportsWithoutReconciling_AndTheDropLandsOnceEveryLiveInstanceHasReportedAsync, ManagedSchemaReportTests.AReport_RecordsWhatThisInstanceDeclares_AndChangesNothingElseAsync, ManagedSchemaReportTests.AReportThatFails_IsSaidAtWarning_AndNotThrownAsync}

- **A second start of the build reports and does not reconcile.** It logs `Startup work managed-object-reconcile already ran for this build; skipped`.
- **A drop the gate held back lands once every live instance has reported.** The [periodic re-run](../../fundamentals/perspectives/managed-schema-objects#rolling-deploys) reconciles on one instance every 15 minutes and finds every report.
- **A reconcile that finds the schema lock taken did nothing**, so it is not recorded done, and the next start runs it. {verified: StartupParityTests.AReconcileThatCannotTakeTheSchemaLock_ReleasesItsClaim_SoTheNextStartRunsItAsync}
- **With `Whizbang:Schema:Reconcile:Mode=Off`** a start neither reports nor claims the reconcile, and takes no permit for it. {verified: StartupParityTests.WithTheReconcileOff_AStartNeitherReportsNorClaimsTheReconcileAsync}
- **A changed setting runs it again.** The settings are part of its fingerprint, so a restart with another mode, kind kept, pin or fleet-gate setting reconciles. {verified: StartupWorkSessionsTests.TheReconcileInputs_FollowEachDeclarationAndSetting_InAnyOrder_AndAgreeAcrossDriversAsync}

An older release that still reconciles at every start runs beside this one safely: it reports as part of its reconcile, reads this release's reports, and keeps what they declare; this release's reconcile keeps what the older one declares. {verified: StartupParityTests.AnOlderReleaseThatReconcilesAtEveryStart_AndThisReleaseThatReportsOnly_DropNothingTheOtherDeclaresAsync}

The analyze of newly indexed tables stays per instance: only that instance's own pass queued those tables.

### The heavy-start cap {#the-heavy-start-cap}

While any of its heavy work runs, an instance holds one of the fleet's **heavy-start permits**, at most `MaxConcurrentHeavyStarts` at once (default **2**). The permits are `wh_startup_permits`, one row per holder, written only by `wh_try_acquire_startup_permit` and `wh_release_startup_permit`.

- **One permit per start.** It is taken at the first unit that runs and given back when the Converge work is done, so it covers every unit of that start. A start whose only work was shared work a peer had done takes none. {verified: StartupWorkSessionTests.OnePermit_CoversEveryUnitOfTheStart_AndIsGivenBackOnDisposeAsync, StartupWorkSessionTests.SharedWorkThisBuildFinished_IsSkipped_AndTakesNoPermitAsync}
- **Never more than the cap.** Ten starts asking at once are granted no more than the cap. {verified: StartupWorkLedgerSqlTests.NoMoreThanTheCap_HoldAPermit_AndAPermitGivenBackIsFreeAsync, StartupWorkLedgerSqlTests.TenStartsAskingAtOnce_AreGrantedNoMoreThanTheCapAsync}
- **A permit of an instance no longer live is free.** A row whose instance the liveness rule calls dead does not count, and is removed as the next request is made, so a crashed instance never holds the cap. {verified: StartupWorkLedgerSqlTests.APermitHeldByAnInstanceNoLongerLive_IsFreeAsync}
- **Past the cap a start waits, and says so once.** It waits in Converge, asking again every `PermitPollInterval` (default 1 second), and enters Converge with the message below, which the [stage line](startup-status#the-log-lines) and the status surface show. {verified: StartupWorkSessionTests.PastTheCap_TheStartWaitsForAPermit_SaysSoOnce_AndRunsOnceOneIsFreeAsync, StartupWorkParityTests.PastTheCap_AStartWaitsInConvergeForAPermit_AndGoesOnOnceOneIsFreeAsync}
- **A wait is bounded.** After `PermitWaitLimit` (default 5 minutes) the start runs its heavy work without a permit and says so at Warning, so permit holders that are stuck never keep a new instance from starting. {verified: StartupWorkSessionTests.AWaitPastItsLimit_RunsTheWorkWithoutAPermit_AtWarningAsync}
- **The cap is per service schema**, not per database server. Two services sharing one server each have their own permits, because each schema has its own table.

```text{title="A start past the heavy-start cap" description="The Converge stage line of a start that waits for a permit, and the Warning when no permit came free within PermitWaitLimit" category="Operations" difficulty="BEGINNER" tags=["Startup","Logging","Converge"] tests=["StartupWorkSessionTests.PastTheCap_TheStartWaitsForAPermit_SaysSoOnce_AndRunsOnceOneIsFreeAsync","StartupWorkSessionTests.AWaitPastItsLimit_RunsTheWorkWithoutAPermit_AtWarningAsync"]}
Stage 4 of 7: Converge - waiting for a heavy-start permit (2 of 2 held across the fleet)
No heavy-start permit came free within 00:05:00 (2 of 2 held); this start runs its heavy work without one
```

The three settings bind from `Whizbang:Database:StartupWork` on both Postgres drivers ([Startup work](../configuration/configuration-reference#startup-work)). A cap below 1, or a non-positive interval or limit, fails the start. Raise `MaxConcurrentHeavyStarts` when a large fleet should start faster and the database has the headroom. {verified: StartupWorkParityTests.TheCap_BindsFromConfiguration_AndKeepsItsDefaultsWithoutItAsync, StartupWorkSessionsTests.ACapThatCannotWork_FailsTheStartAsync, StartupWorkCatalogTests.TheOptions_RefuseACapBelowOne_AndANonPositiveIntervalOrLimitAsync}

### Upgrading {#heavy-startup-work-upgrading}

Nothing to change. Two behaviors move from every restart to once per build:

- **A storage setting changed by hand** on a perspective table (a fillfactor or autovacuum value set with `ALTER TABLE`) is now brought back in line by the first start of the next build, not by every restart. To keep a hand-set value, list the table as [managed by hand](../../fundamentals/perspectives/physical-fields#manually-managed-tables).
- **The registry check** runs once per build, and again on any start whose schema pass applied something. A registry edited by hand between two restarts of one build is no longer noticed until the next build.
- **The managed-object reconcile** runs once per build, and again on any start whose schema pass applied something or whose reconcile settings changed. An index added by hand between two restarts of one build is recorded, and a drop the fleet gate held back lands, through the periodic re-run (every 15 minutes) rather than at the next restart. Every start still reports what its instance declares.

### Design choices {#heavy-startup-work-design-choices}

| Choice | Reason | Verified |
|---|---|---|
| Every unit of heavy Converge work is a declared name with a scope, and runs only through the session. | One path means the cap and the once-per-build rule cannot be bypassed by a call that forgot them; a new unit that skips the session fails a source guard. | {verified: StartupWorkDeclarationGuardTests.EveryHeavyConvergeCall_RunsInsideASessionRunOfADeclaredNameAsync, StartupWorkSessionTests.AnUndeclaredName_IsRefused_AndItsWorkNeverRunsAsync} |
| Shared work is keyed by the build (library version, name, inputs), not by a time window. | The same build changes shared state the same way from any instance, so one run is enough; another build, a rollback included, may change it differently, so it runs again. | {verified: StartupWorkLedgerSqlTests.AnotherBuild_ClaimsTheWorkAgain_SoARollbackRerunsWhatTheNewerBuildChangedAsync, StartupWorkSessionTests.TheFingerprint_FollowsTheNameAndTheInputs_AndIsStableAsync} |
| A claim or a permit of an instance that is no longer live is free, judged by the one liveness rule. | No lease or deadline to tune, and a crashed instance never holds the cap or a unit. | {verified: StartupWorkLedgerSqlTests.AClaimHeldByAnInstanceNoLongerLive_IsTakenOver_AndItsLateCompletionChangesNothingAsync, StartupWorkLedgerSqlTests.APermitHeldByAnInstanceNoLongerLive_IsFreeAsync} |
| The managed-object reconcile runs once per build; the report of what each instance declares runs at every start, apart from it. | The reconcile changes shared state; the drop gate needs a report from every live instance, and a report is one cheap upsert. | {verified: StartupWorkCatalogTests.TheFrameworkWork_IsDeclared_WithTheScopeEachRunsUnderAsync, StartupParityTests.ASecondStartOfTheBuild_ReportsWithoutReconciling_AndTheDropLandsOnceEveryLiveInstanceHasReportedAsync} |
| A wait for a permit ends after `PermitWaitLimit`, and the start runs uncapped at Warning. | A cap that could keep an instance from ever starting would turn a stuck holder into an outage. | {verified: StartupWorkSessionTests.AWaitPastItsLimit_RunsTheWorkWithoutAPermit_AtWarningAsync} |
| Without migration 630, or when a ledger call fails, the work runs directly, as before. | Rolling-deploy integrity: an instance never does less than an older release did. | {verified: StartupWorkSessionTests.OnASchemaWithoutTheFunctions_EveryUnitRunsDirectly_AndAvailabilityIsAskedOnceAsync, StartupWorkSessionTests.APermitThatCannotBeAskedFor_RunsTheWorkWithoutOne_AtWarningAsync} |

## Hooks

The pipeline publishes its startup story through two explicit seams — no assembly scanning, consistent with the zero-reflection and native-AOT constraints.

**Observation.** An `IStartupStepObserver` registered in DI is called as the run is planned, as each step starts and finishes, and when the run completes:

```csharp{title="Observing the pipeline" description="Advisory observers — a diagnostic must not be able to break a boot" category="Implementation" difficulty="INTERMEDIATE" tags=["Startup","Hooks"] tests=["StartupPipelineHooksTests.RunAsync_NotifiesStartingAndCompletedForEachStepInOrderAsync","StartupPipelineHooksTests.RunAsync_ThrowingObserver_DoesNotFailTheStepOrThePipelineAsync"]}
public interface IStartupStepObserver {
  ValueTask OnRunStartingAsync(StartupRunPlan plan, CancellationToken ct);       // the ordered plan, before the first step
  ValueTask OnStepStartingAsync(StartupStepContext context, CancellationToken ct);
  ValueTask OnStepCompletedAsync(StartupStepResult result, CancellationToken ct); // outcome, duration, reason
  ValueTask OnPipelineCompletedAsync(StartupSummary summary, CancellationToken ct);
  // A step blocked on a contended duty, emitted on a backoff — a long wait narrates itself
  // instead of hanging silently. Default no-op, so existing observers are unaffected.
  ValueTask OnStepWaitingAsync(StartupStepWaitContext context, CancellationToken ct) => default;
}
```

Observers are **advisory**: one that throws is logged and skipped for that notification. The framework's own logging and metrics are written as observers, so the public seam gets exactly the care the internal one does.

**Interrogation.** `IStartupPipelineState` answers questions at any moment, for code that needs to make a decision rather than watch a transition:

```csharp{title="Asking the pipeline" description="Per-step queries replace one over-broad barrier" category="Implementation" difficulty="INTERMEDIATE" tags=["Startup","Hooks"] tests=["StartupPipelineHooksTests.State_WaitForAsync_ReleasesWhenTheStepCompletesAsync"]}
public interface IStartupPipelineState {
  bool HasRunStarted { get; }
  bool IsComplete { get; }                       // every planned step reached a terminal state
  bool IsReady { get; }                          // every planned BLOCKING step completed, none failed
  StartupStepStatus StatusOf(string stepName);
  IReadOnlyList<StartupStepResult> Completed { get; }
  Task WaitForAsync(string stepName, CancellationToken ct);
  Task WaitForReadyAsync(CancellationToken ct);
}
```

`WaitForAsync` is what lets a hosted service — the framework's or a consumer's — say *"after `Migrate`"* instead of guessing at registration order. An extension that reads perspectives waits on the step it actually depends on; one that only appends events waits on `Migrate`. A per-step query replaces one over-broad barrier with the dependency each caller actually has.

## Ready is a composite

`Ready` is the terminal signal — *startup finished*, a different fact from *the schema is ready*. It rides the `IHostedLifecycleService.StartedAsync` seam (after every hosted service's `StartAsync` has returned) and composes blocking-step completion with `IStartupReadinessContributor`s — transport consumers contribute their subscription readiness, so "ready" includes "subscribed". The sticky `IStartupReadySignal` then flips, `ComponentState.Ready` lands in health, and the [status surface](startup-status) reports the pipeline complete.

The composite is **fail-closed but never silent**: while `StartedAsync` is blocked it names what it is still waiting on — the pending blocking steps with their statuses, the readiness contributor by name, or *"no run has started yet"* — as a Warning on a backoff. A boot that cannot finish is a boot that says why, not a hang with no output.

The narration runs on the `TimeProvider` that `StartupReadyService` is given, a required constructor parameter. Through the worker pipeline that is the host's registered clock: the pipeline registers `TimeProvider.System` with `TryAdd`, so a host that registers its own `TimeProvider` first, a fake clock in a test included, drives the narration with it. The service probes its wait every 5 seconds and narrates on the 3rd, 10th and 30th probe and then every 60 probes, so the first narration comes 15 seconds into a blocked boot. The elapsed time it reports comes from the same clock. {verified: StartupReadyCompositeTests.ReadyService_NarratesWhichBlockingStepIsHoldingItUpAsync, StartupReadyCompositeTests.StartedAsync_WhileBlockedOnAContributor_NarratesWhatItIsWaitingOnAsync, StartupWiringAuditTests.TheReadyServiceAndTheStandbyWatcher_RunOnTheHostsRegisteredClockAsync}

A host told to stop while it waits ends the wait there and says nothing more about readiness. The stop is not counted as a probe, so it never produces a "not ready after 0s" warning, even when a readiness contributor does not watch for the stop itself. {verified: StartupReadyCompositeTests.ReadyService_StoppedWhileWaiting_DoesNotNarrateTheStopAsAProbeAsync, StartupStopBeforeReadyTests.AHostStoppedInPreflight_DoesNotDeregister_AndLogsNoWarningOrErrorAsync}

See [Database Readiness](../workers/database-readiness#ready-is-more-than-the-gate) for the composite's roster and the health-policy rows.

## Seams

While the pipeline runs, the data plane holds **at its own seams** rather than at the HTTP edge: `IDispatcher` waits until `Migrate` completes (a dispatch needs the event store and outbox), up to `SchemaInitializationOptions.DispatchMaxWait`, and lens resolution refuses until the **read-model barrier** releases (`Migrate` *plus* the perspective startup scan). A refused read, and a dispatch whose wait runs out, throw `WhizbangNotReadyException`, which HTTP layers map to 503; both seams are inert when no gate is registered, so fixtures behave exactly as before.

The two seams project onto the lifecycle ladder as [`LifecyclePhase.AcceptingCommands`](../../resilience/managed-resource-run-control#the-lifecycle-state-machine) — the write side live, the read side not yet. The seams themselves are documented in [Database Readiness](../workers/database-readiness#the-seam-level-barriers-reads-and-writes-hold-themselves).

## Health during startup

A pipeline health source reports the current step into the managed health system, so probes answer from pipeline state rather than one boolean:

| Pipeline state | Liveness | Readiness |
|---|---|---|
| Before `Migrate` completes | Healthy | Not ready |
| `Migrate` … `Ready` | Healthy | Not ready |
| After `Ready` | Healthy | Ready |
| Post-ready steps still running | Healthy | Ready |

Liveness stays `Healthy` in every row — restarting a process cannot finish a migration; it can only discard the progress that was making one.

## Related

- [Capabilities and Duties](capabilities-and-duties) — who runs an exclusive step, and how the fleet knows
- [Rolling Upgrades](rolling-upgrades) — `Assess`, the standby handshake, eviction, revival
- [The Startup Status Surface](startup-status) — *"what is it doing right now?"* over the host's own API
- [Database Readiness](../workers/database-readiness) — the schema gate, the Ready composite, the seam barriers
- [Managed-Resource Run Control](../../resilience/managed-resource-run-control) — the lifecycle phase ladder the pipeline drives
