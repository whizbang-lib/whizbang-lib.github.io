---
title: Managed-Resource Run-Control
pageType: guide
version: 1.0.0
category: Resilience
order: 3
description: The coordinated lifecycle state machine — each resource interprets the phase and acknowledges; plus the operator killswitch
tags: 'run-control, killswitch, lifecycle, state-machine, acknowledgement, drain, migration, resilience'
codeReferences:
  - src/Whizbang.Core/RunControl/LifecyclePhase.cs
  - src/Whizbang.Core/RunControl/IWhizbangRunControl.cs
  - src/Whizbang.Core/RunControl/WhizbangLifecycleCoordinator.cs
  - src/Whizbang.Core/RunControl/WhizbangLifecycleState.cs
  - src/Whizbang.Core/RunControl/IWhizbangKillswitch.cs
---

# Managed-Resource Run-Control

Run-control is the **enforcement** face of the managed-resource control plane (its partner is
[health](managed-resource-health)). Both are driven by **one thing**: a single lifecycle **state
machine** Whizbang owns and advances. Whizbang broadcasts the current phase; **each resource interprets
it for itself** (stay up, pause, drain, stop) and **acknowledges**. There is no central table deciding
what a phase means per component — only the resource knows (the DB stays up during a migration; a worker
drains on shutdown), so the resource owns the decision.

This generalizes the one-way `ISchemaReadyGate` (which gated only workers) into coordinated control over
every managed resource — workers, transport-consume, the write path, offload, temporal, the signal bus.

## The lifecycle state machine

```csharp{title="Lifecycle phases" description="The one state Whizbang owns and advances" category="Implementation" difficulty="BEGINNER" tags=["Resilience","RunControl"] tests=["LifecyclePhaseTests.TransitionalPhases_AreTransitional_NotSettledAsync","WhizbangLifecycleCoordinatorTests.Transition_BroadcastsToEveryParticipantAsync"]}
public enum LifecyclePhase {
  Starting,     // process booted (transitional)
  Connecting,   // network warmup — DB/transport/offload connecting, before the migration (transitional)
  Migrating,    // schema/data migration in progress (transitional)
  Running,      // fully operational (settled)
  Pausing, Paused, Resuming,        // pause/resume (transitional ⇄ settled)
  Stopping, Stopped,                // graceful shutdown
  Faulted,      // bounded window to record/report before dying (transitional)
  Halted        // terminal — reachable ONLY from Faulted (settled)
}
```

A **transitional** phase is the window in which the coordinator has broadcast the change and is awaiting
every resource's ack; the **settled** phase on the other side is "all acknowledged". `Connecting` sits
before `Migrating` because the migration needs a live DB connection. `Faulted → Halted` is a two-step
death: `Faulted` is a bounded window to log/emit/flush, *then* the terminal `Halted` (a graceful
shutdown ends in `Stopped`, never `Halted`).

## Each resource interprets the phase

```csharp{title="Run-control participant" description="A resource interprets the phase and acknowledges" category="Implementation" difficulty="BEGINNER" tags=["Resilience","RunControl"] tests=["WhizbangRunPermitTests.Adapter_DrivenByCoordinator_PausesThenRunsThenDrainsAsync"]}
public interface IWhizbangRunControl {
  string Component { get; }                                    // "workers", "transport", "event-store", ...
  // Interpret the phase for THIS resource, do the work, ack by completing. Mandatory — a resource
  // with nothing to do returns a completed task.
  ValueTask OnPhaseAsync(LifecyclePhase phase, CancellationToken cancellationToken);
}
```

`RunPermitControl` is the ready-made adapter that drives a re-closable `WhizbangRunPermit` a subsystem
awaits in its loop; `RunPermitControl.ForWorkers` is the common interpretation — **run** when `Running`,
**drain** (finish in-flight, take no new) on `Stopping`, otherwise **pause** (held during startup,
migration, and pause). Only the resource can express "drain", which is why interpretation lives there.

## Coordinated transitions — every resource acknowledges

```csharp{title="The coordinator" description="Broadcast, barrier, queue, timeout" category="Implementation" difficulty="INTERMEDIATE" tags=["Resilience","RunControl"] tests=["WhizbangLifecycleCoordinatorTests.Transition_Barrier_WaitsForAllAcksBeforeReturningAsync","WhizbangLifecycleCoordinatorTests.Transition_Queue_SerializesTransitionsAsync","WhizbangLifecycleCoordinatorTests.Transition_Timeout_RaisesAckTimeoutAsync"]}
// WhizbangLifecycleCoordinator coordinates each transition:
//   • Barrier  — invoke all resources, await ALL acks before returning.
//   • Timeout  — bound each ack by WhizbangLifecycleOptions.TransitionAckTimeout;
//                a timeout raises LifecycleAckTimeoutException.
//   • Queue    — serialize transitions; concurrent calls queue.
await lifecycle.AdvanceToAsync(LifecyclePhase.Migrating, ct); // broadcasts + awaits all acks
```

A resource that throws or times out surfaces to `WhizbangLifecycleState`, which owns the **fault path**:
it drives the system to `Faulted`, holds for `WhizbangLifecycleOptions.FaultRecordWindow` so resources can
record, then reaches terminal `Halted`.

```csharp{title="Fault path" description="A failed transition faults then halts" category="Implementation" difficulty="INTERMEDIATE" tags=["Resilience","RunControl"] tests=["WhizbangLifecycleStateTests.AdvanceTo_ParticipantThrows_FaultsThenHaltsAfterRecordWindowAsync"]}
// A participant that throws on a transition => Faulted (record window) => Halted.
// AdvanceToAsync does not rethrow — the fault is handled by the machine.
```

## Turnkey — you get this by default

`AddWhizbang()` registers the coordinator, the shared `IWhizbangLifecycleState`, options, and the
killswitch, plus a driver that advances the lifecycle from the schema gate: `Connecting → Migrating` at
startup (participants pause/stay-up per their own interpretation), `Running` once migrations complete.
If initialization never completes the gate never opens, so the phase stays `Migrating` — fail-closed.

## Operator killswitch

```csharp{title="Operator control" description="Pause/stop everything, or pin one component" category="Configuration" difficulty="INTERMEDIATE" tags=["Resilience","RunControl"] tests=["WhizbangKillswitchTests.PauseAsync_DrivesPausingThenPausedAsync","WhizbangKillswitchTests.OverrideComponent_PinsOneResource_IndependentOfSystemPhaseAsync"]}
// Coarse: drive the whole system through the machine.
await killswitch.PauseAsync();   // Pausing -> Paused (everything)
await killswitch.ResumeAsync();  // Resuming -> Running
await killswitch.StopAsync();    // Stopping -> Stopped

// Fine: pin ONE component independent of the system phase (e.g. drain a transport for maintenance).
await killswitch.OverrideComponentAsync("transport", LifecyclePhase.Stopping);
await killswitch.ClearComponentOverrideAsync("transport"); // back to the current system phase
```

A pinned component ignores system transitions until cleared; every change — coarse or fine — still goes
through the ack barrier. Tune the ack timeout / fault window via
`services.AddWhizbangRunControl(o => …)`.

See [Managed-Resource Health](managed-resource-health) for the observe face (the same phase decides what
each resource's health *means*) and the [availability gate](database-availability-middleware).
