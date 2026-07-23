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

```csharp{title="Health source contract" description="Each managed resource reports its own state, phase-aware" category="Implementation" difficulty="BEGINNER" tags=["Resilience","Health"] tests=["WhizbangHealthAggregatorTests.LenientDefault_Migrating_IsReadyAsync","SchemaHealthSourceTests.FaultedPhase_ReportsFaultedAsync"]}
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

Whizbang ships the sources for what it owns: `SchemaHealthSource` (→ `Migrating` while the gate is
closed, → `Faulted` on a wedged migration), `WorkerHealthSource` (→ `PausedByDesign` while held,
`Draining` on stop), and `ConnectivityHealthSource` — the reusable phase-aware reachability probe drivers
wire for the **event-store DB, transport, and offload**. An `AlwaysRequired` resource (the DB) reports a
failed probe as `Faulted` **even during a migration** (the migration needs it — the depended-on
dependency is never masked); a `RequiredWhenRunning` resource (transport, offload) is only probed while
`Running`. Register your own with `services.AddWhizbangHealthSource<T>()` — you never hand-roll a naive
`SELECT count(*)` that a migration would make fail.

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
| Operational / Starting / Connecting / Migrating / PausedByDesign / Draining | Healthy | **Healthy** |
| Degraded | Healthy | Degraded |
| Faulted | Healthy | Unhealthy |

Liveness never fails for an intentional state under any policy — an intentional or dependency-fault
state must never restart the pod. A genuine `Faulted` (transport dropped while `Ready`, offload
unreachable) still fails readiness — the policy never masks a real fault.

## Configuring / overriding

Switch a component (or everything) to the stricter posture — "not ready until fully up":

```csharp{title="Strict policy override" description="Hold a component out of rotation until fully ready" category="Configuration" difficulty="INTERMEDIATE" tags=["Resilience","Health"] tests=["WhizbangHealthDiTests.AddWhizbangManagedHealth_AppliesPolicyConfigurationAsync"]}
services.AddWhizbangManagedHealth(o => o.Components["schema"] = HealthPolicy.Strict);
```

The gate and the health check are independent: run-control decides *what is paused*; the health
source reports *whether the current state is the intended one*. See
[Managed-Resource Run-Control](managed-resource-run-control) and the
[availability gate](database-availability-middleware).
