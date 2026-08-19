---
title: The Startup Pipeline
pageType: concept
verifiedAgainstCommit: f1ff5bcf
verifiedDate: 2026-08-16
version: 1.0.0
category: Startup
order: 1
description: >-
  Startup as a declared, ordered pipeline of steps — the step contract,
  the framework's own steps, observation and interrogation hooks, and how
  readiness and the data-plane seams compose from it
tags: >-
  startup, pipeline, steps, ordering, readiness, hooks, observers,
  schema-ready-gate, lifecycle
codeReferences:
  - src/Whizbang.Core/Startup/StartupStepDescriptor.cs
  - src/Whizbang.Core/Startup/StartupPipelineRunner.cs
  - src/Whizbang.Core/Startup/StartupPipelineState.cs
  - src/Whizbang.Core/Startup/IStartupStepObserver.cs
  - src/Whizbang.Core/Startup/StartupPipelineHosting.cs
  - src/Whizbang.Core/Startup/StartupReadiness.cs
  - src/Whizbang.Core/Health/StartupPipelineHealthSource.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/ColdBootJourneyE2ETests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/TableRewriteJourneyE2ETests.cs
  - tests/Whizbang.Core.Tests/Startup/StartupPipelineRunnerTests.cs
  - tests/Whizbang.Core.Tests/Startup/StartupPipelineHooksTests.cs
  - tests/Whizbang.Core.Tests/Startup/StartupPipelineRunnerDutyTests.cs
  - tests/Whizbang.Core.Tests/Startup/StartupReadyCompositeTests.cs
  - tests/Whizbang.Core.Tests/Startup/StartupStepOrderResolverTests.cs
  - tests/Whizbang.Core.Tests/Health/StartupPipelineHealthSourceTests.cs
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
| `Assess` | every instance | — | yes | Compares this binary's library version against the migration ledger and produces a [verdict](rolling-upgrades#assess) before anything changes. A `StandDown` verdict fails the step, which keeps the pipeline incomplete and readiness withheld — not-ready-while-alive. |
| `Migrate` | `migrator` (duty) | `Await` | yes | Schema initialization under the advisory lock; completes when the schema-ready gate opens. Depends on `Assess`. |
| `Rewrite` | `maintainer` (duty) | `Skip` | **no** | [Requested table rewrites](../infrastructure/migrations#table-rewrites-run-post-ready-under-the-maintainer-duty) (`VACUUM FULL`) — post-ready and deliberately unbounded, because a half-finished rewrite is worse than a slow one. Nobody blocks on it. |

`Migrate` and `Rewrite` want opposite non-holder answers, which is why the behaviour is a declared field and not a global rule: every instance must wait for the schema to exist, and no instance should ever wait on a `VACUUM FULL`.

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

See [Database Readiness](../workers/database-readiness#ready-is-more-than-the-gate) for the composite's roster and the health-policy rows.

## Seams

While the pipeline runs, the data plane holds **at its own seams** rather than at the HTTP edge: `IDispatcher` refuses until `Migrate` completes (a dispatch needs the event store and outbox), and lens resolution refuses until the **read-model barrier** releases (`Migrate` *plus* the perspective startup scan). Both throw `WhizbangNotReadyException`, which HTTP layers map to 503; both are inert when no gate is registered, so fixtures behave exactly as before.

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
