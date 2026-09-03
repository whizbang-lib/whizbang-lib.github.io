---
title: Rolling Upgrades
pageType: concept
verifiedAgainstCommit: f1ff5bcf
verifiedDate: 2026-08-16
version: 1.0.0
category: Startup
order: 3
description: >-
  Two versions against one schema — the Assess verdict, the standby handshake
  for breaking migrations, eviction as the fence behind it, and revival by
  re-entering the pipeline
tags: >-
  rolling-upgrades, assess, standby, handshake, eviction, semver, versioning,
  migrations, multi-instance, deployment
codeReferences:
  - src/Whizbang.Core/Startup/AssessStartupStep.cs
  - src/Whizbang.Core/Startup/StandbyWatcher.cs
  - src/Whizbang.Core/Startup/StandbyHandshake.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCorePostgresStartupAssessor.cs
  - src/Whizbang.Data.Postgres/Migrations/110_StandbyHandshake.sql
testReferences:
  - tests/Whizbang.Core.Tests/Startup/AssessStartupStepTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ColdBootJourneyE2ETests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StartupAssessorTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StandbyHandshakeE2ETests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/StandbyHandshakeSqlTests.cs
---

# Rolling Upgrades

A rolling deployment runs two versions of the library — and of the consumer's application — against one database at the same time, **by design**. The startup pipeline's answer has three parts: every instance *assesses* where it stands before changing anything; a breaking migration runs a *standby handshake* that converts a silent, corrupting overlap into a bounded, announced one; and *eviction* fences the instance that will not cooperate.

Two rules anchor everything below:

- **Never apply older content over newer.** Every applied migration already records the library version that applied it; an instance whose version is behind that record refuses to re-apply its own copy. This is what stops a restarted old pod from silently downgrading the schema through `CREATE OR REPLACE` — see [Version Auditing](../infrastructure/migrations#version-auditing).
- **Every pending change from a newer version is treated as breaking.** A hash says *different*, never *incompatible*. Starting strict means the failure mode is an unnecessary, visible outage; starting permissive means silent corruption discovered later. Only one of those is safe to be wrong about. A release with **no** pending migration hits the fast path where every hash matches — code-only releases stay free.

## Assess

`Assess` is the first pipeline step, runs on **every instance** (an instance that will never win the [migrator duty](capabilities-and-duties) still needs to know whether it is obsolete), and is a pure read of the ledger — no lock, no transaction, no DDL:

| What the ledger says | Verdict | What the instance does |
|---|---|---|
| Nothing — fresh database | `Migrate` | Contend for the `migrator` duty |
| Only versions older than or equal to mine | `Serve` / `Migrate` | Proceed; migrate only if there are changes to apply (after the handshake, when peers are live) |
| Any version **newer** than mine | `StandDown` | Never apply anything; the step **fails**, readiness is withheld — not-ready-while-alive |

```csharp{title="The verdict" description="Decided before anything is changed" category="Implementation" difficulty="INTERMEDIATE" tags=["Startup","RollingUpgrades"] tests=["AssessStartupStepTests.StandDownVerdict_FailsTheBlockingStep_WhichIsNotReadyWhileAliveAsync","StartupAssessorTests.AnyNewerRecorded_VerdictIsStandDownAsync"]}
public enum StartupVerdict { Serve, Migrate, StandDown }

public sealed record StartupAssessment(StartupVerdict Verdict, string Reason);

public interface IStartupAssessor {
  Task<StartupAssessment> AssessAsync(CancellationToken ct);
}
```

`StandDown` composes with machinery that already exists: the failed blocking step keeps the pipeline incomplete, readiness stays withheld, the data-plane seams keep refusing, and liveness stays healthy — precisely the state that tells an orchestrator to replace the instance and a load balancer to stop sending it traffic. The fence runs *backwards* on purpose: a migrating instance can never wait for older instances to be retired (the orchestrator will not retire them until the new instance is ready, which requires migrating first) — so the **older instance stands itself down** instead.

**Ordering is semantic versioning**, with the details that are load-bearing rather than pedantic: pre-release precedence is the common path (`0.9.4-alpha.3` < `0.9.4-beta.1` < `0.9.4`), numeric pre-release identifiers compare numerically (`alpha.10` > `alpha.2`), and build metadata is ignored. An unparseable version is never guessed at — the instance refuses to migrate and reports the condition, because every wrong answer here is worse than stopping. The consumer's application version is recorded but takes no part in the ordering; requiring an application to be semantically versioned is not the framework's call to make.

**Where this binary's version comes from.** The assessor reads it from `ILibraryVersionProvider`. The Postgres driver registers that provider from a build-time constant (`$(Version)`, the same value the migration ledger records), whoever owns the DbContext: a host that registers its own `NpgsqlDataSource` and DbContext, which makes the driver skip its generated turnkey registration, still gets one. Registering your own provider first wins. A host with no provider at all, one that bypasses the driver entirely, stands down with a reason that names the missing registration, which is a different fact from an unparseable version and is reported as one.

```csharp{title="The library version is registered whoever owns the DbContext" description="A consumer that registers its own DbContext before .WithDriver.Postgres still gets ILibraryVersionProvider; an explicit registration wins; no provider at all is reported as the missing registration it is." category="Implementation" difficulty="INTERMEDIATE" tags=["Startup", "RollingUpgrades", "Drivers"] tests=["LibraryVersionRegistrationTests.Postgres_WhenTheConsumerRegisteredItsOwnDbContext_StillRegistersTheLibraryVersionAsync", "LibraryVersionRegistrationTests.Postgres_RegistersTheLibraryVersionAsTryAdd_SoAnExplicitRegistrationWinsAsync", "StartupAssessorTests.NoLibraryVersionProvider_StandsDownNamingTheMissingRegistrationAsync"]}
services.AddDbContext<OrdersDbContext>(o => o.UseNpgsql(myDataSource));   // consumer-owned
services.AddWhizbang().WithEFCore<OrdersDbContext>().WithDriver.Postgres;  // skips turnkey DbContext registration ...
// ... but ILibraryVersionProvider is registered all the same, so Assess can compare versions.
```

The verdict is **not a startup-only fact**. An instance that was current when it booted becomes obsolete the moment a newer peer migrates underneath it — so a lightweight watcher re-checks on the same signal-plus-poll footing as capability re-attempt, and standing down is a state an instance can enter at any time.

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
- **Only live peers must acknowledge.** An instance that stops heartbeating stops counting, so the wait is bounded by lease expiry rather than by the goodwill of a process that may already be dead. Evicted and stale peers are skipped; peers already on the same or newer version have nothing to stand by for.
- **A standing-by instance watches the migrator.** If the migrator dies rather than failing cleanly, its instance record goes stale, the wait ends and revival begins. Every path out of standby is bounded — success, clean failure, or a dead migrator.
- **Revival is not a second pipeline.** The migration is one transaction: a rollback leaves the ledger exactly as the standing-by instances last read it. Coming out of standby is **re-entering the pipeline at `Assess`** — the verdict comes back *same as me*, `Migrate` finds matching hashes and no-ops, capabilities are re-acquired, the data plane reopens. The [pipeline runner](startup-pipeline) is re-entrant for exactly this reason.

## Eviction: the fence behind the handshake

Bounding the wait by liveness handles the *decision*; it does not handle the *process*, which may still be running — a pod paused by a long collection or a brief partition comes back and carries on against a schema that has moved. For a breaking migration that is not survivable, so the migrator (or an operator) **evicts** the unresponsive peer: a durable tombstone recording who issued it and when, delivered through the instance's own next heartbeat, and enforced where effect happens — [capability acquisition refuses an evicted instance](capabilities-and-duties#winning-a-duty). A restarted pod draws a new instance id and is unevicted; the zombie keeps its id and stays fenced.

The full mechanics live in [Instance Liveness](../../fundamentals/workers/instance-liveness#eviction-reaping-is-a-fence-not-just-a-deletion).

## Verification

The behaviour above is fleet behaviour, so its tests are multi-instance end-to-end tests: each simulated instance is its own coordinator over its own connection, against a real database. `StandbyHandshakeE2ETests` covers the four paths by name — commit (peers drain, acknowledge, shut down), rollback (peers revive by re-entering the pipeline), a dead migrator (strands nobody), and an unresponsive peer (evicted, and the handshake completes without it).

## Related

- [The Startup Pipeline](startup-pipeline) — the step contract and the re-entrant runner
- [Capabilities and Duties](capabilities-and-duties) — the migrator duty and the eviction fence at election
- [Migration Tracking](../infrastructure/migrations) — the ledger, version auditing, never-downgrade
- [Instance Liveness](../../fundamentals/workers/instance-liveness) — heartbeats, standby, eviction
- [The Startup Status Surface](startup-status) — watching a mixed-version rollout instance by instance
