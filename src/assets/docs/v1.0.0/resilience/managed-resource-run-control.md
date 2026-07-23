---
title: Managed-Resource Run-Control
pageType: guide
version: 1.0.0
category: Resilience
order: 3
description: The per-component killswitch — pause/resume/stop what Whizbang manages, driven by lifecycle phase and operator override
tags: 'run-control, killswitch, drain, lifecycle, migration, resilience'
codeReferences:
  - src/Whizbang.Core/RunControl/IWhizbangRunControl.cs
  - src/Whizbang.Core/RunControl/WhizbangRunController.cs
  - src/Whizbang.Core/RunControl/WhizbangRunPermit.cs
  - src/Whizbang.Core/RunControl/LifecyclePhaseWorker.cs
---

# Managed-Resource Run-Control

Run-control is the **enforcement** counterpart to [health](managed-resource-health): health *reports*
a resource's state; run-control *decides what is allowed to run*. It generalizes the one-way
`ISchemaReadyGate` (which gates only workers) into a per-component killswitch over every managed
resource — workers, transport-consume, the write path, offload — driven by the lifecycle phase, config,
and operator override.

The two halves can't disagree: the killswitch **sets** a resource's intentional state, and its health
source **mirrors** it (a controller-paused resource reports `PausedByDesign`, which is healthy by
default).

## Turnkey — you get this by default

`AddWhizbang()` registers the run-control plane and a driver worker that advances the lifecycle from
the schema gate:

- at startup → `Migrating` → the configured components are **Paused**;
- once migrations complete → `Ready` → they **resume**.

On failure the gate never opens, so the phase stays `Migrating` and the components stay paused — the
fail-closed behavior. No wiring required. (During a migration, workers are already held by the schema
gate; run-control makes it explicit and adds runtime/operator control and graceful drain.)

## The pieces

```csharp{title="Run-control contract" description="The per-component killswitch" category="Implementation" difficulty="BEGINNER" tags=["Resilience","RunControl"] tests=["WhizbangRunControllerTests.Transition_Migrating_PausesWorkers_KeepsReadsRunningAsync"]}
public enum RunState { Running, Paused, Stopped }
public enum LifecyclePhase { Starting, Migrating, Ready, Draining, Faulted }

public interface IWhizbangRunControl {          // one per managed resource
  string Component { get; }
  RunState Current { get; }
  ValueTask ApplyAsync(RunState desired, CancellationToken ct);
}
```

- **`WhizbangRunControlOptions`** resolves the desired `RunState` for a `(component, phase)`: an
  operator **override** wins; `Draining` stops everything; otherwise a phase-table entry; otherwise
  `Running`. `Default()` pauses `workers` / `transport-consume` / `writes` during a migration and
  leaves reads running.
- **`WhizbangRunController`** applies the resolved state to every control on a phase transition, and
  exposes an operator killswitch (`SetOverrideAsync`).
- **`WhizbangRunPermit`** is a re-closable gate a subsystem awaits in its loop (Running = open, Paused
  = blocks until resumed, Stopped = cancels/drains); **`RunPermitControl`** is the ready-made adapter
  that flips a permit from the controller. A subsystem opts into runtime control by registering a
  `RunPermitControl` and awaiting its permit.

## Operator control & overriding

```csharp{title="Operator killswitch" description="Force and clear a component's run-state at runtime" category="Configuration" difficulty="INTERMEDIATE" tags=["Resilience","RunControl"] tests=["WhizbangRunControllerTests.SetOverride_ForcesComponent_ThenClearRestoresPhaseAsync"]}
// Drain a transport for maintenance, regardless of phase:
await controller.SetOverrideAsync("transport-consume", RunState.Stopped, currentPhase, ct);
// …and restore it (clear the override → re-resolve under the current phase):
await controller.SetOverrideAsync("transport-consume", null, currentPhase, ct);
```

Change the phase policy via `services.AddWhizbangRunControl(o => …)`.
