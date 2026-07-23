---
title: Managed-Resource Control Plane — Run-Control & Health
category: Architecture & Design
order: 27
tags: health, run-control, killswitch, liveness, readiness, lifecycle, resilience, migration, transport, offload, drain, health-policy, kubernetes, startup-ordering
---

# Managed-Resource Control Plane — Run-Control & Health

Whizbang manages a set of infrastructure resources on the consumer's behalf — the event-store
database, the message transport, the body-offload store, the worker pipeline, schema
initialization, the signal bus, the temporal engine. Today, whether those resources are "healthy"
is decided by whatever ad-hoc `IHealthCheck` a consumer wires up — usually a naive probe (a `SELECT
count(*)`, a connectivity ping) that has **no idea what state Whizbang is intentionally in**. So a
resource that is *intentionally* migrating, starting, or paused gets reported as **Unhealthy**, and
everything downstream — Kubernetes readiness, a deploy pipeline's rollout gate — treats a
by-design state as a failure.

But observing is only half of it. Whizbang doesn't just *report* on these resources — it *controls*
whether each one is **allowed to run** at all: workers wait on the schema gate, the transport
consumer can be drained, an offload can be disabled. So the managed-resource abstraction has **two
symmetric halves**, keyed to the same components and driven by the same lifecycle state + config:

- **Run-control (killswitch)** — a hook that lets the framework **start / pause / stop** each
  resource. This is the enforcement half: it decides *what is allowed to run*.
- **Health** — a hook that reports the resulting state. This is the observe half.

The killswitch **sets** the intentional state; the health hook **reports** it (a resource paused by
the killswitch reports `PausedByDesign` ⇒ healthy-by-design). `ISchemaReadyGate` is today's single,
hard-wired instance of the run-control half (gate whether *workers* may run); this proposal
generalizes it to **every** managed resource and pairs it with state-relative health.

**This proposal makes both halves first-class and gives Whizbang a first-class hand in defining
them.** The default health policy treats intentional states (Starting / Migrating / PausedByDesign)
as **healthy** — so a service the framework has intentionally paused parts of stays *ready and
serving what it can* during a long startup migration instead of being torn down.

:::planned
Proposed capability (unreleased). It generalizes the health signal introduced with the opt-in
non-blocking schema init (`ISchemaReadyGate` +
`SchemaReadyHealthCheck` + `DatabaseAvailabilityMiddleware`): that shipped a single, binary
"schema ready?" check hard-wired to report **Unhealthy** while migrating. This proposal reframes
that as one instance of a general rule and corrects the default so *migrating is healthy*.
:::

## The problem — health with no notion of state

A concrete, common failure mode (no consumer specifics — this is generic Kubernetes + a large
one-time migration):

1. A service ships a schema change whose one-time migration is longer than the k8s startup-probe
   budget. With non-blocking schema init the pod
   binds its port and answers `/alive` immediately, so k8s does **not** kill it. Good.
2. But the pod's **readiness** (`/health`) stays red for the whole migration — by our own design,
   plus because the naive DB/transport health checks query tables that are mid-rebuild (locked, or
   not created yet) and **time out**.
3. The deploy orchestrator (Helm `--wait --timeout` / `--atomic`, `kubectl rollout status`) waits
   on readiness, times out, and **rolls the deployment back** — killing the migration pod
   mid-flight. On a large store this loops: the migration never gets to finish.

The startup-probe kill was fixed by keeping `/alive` green. The rollback is a *different* actor
(the deploy pipeline) watching a *different* signal (readiness) — and the root cause is that
**"migrating" and "starting" are reported as "unhealthy" when they are neither.** A migration in
progress is a service operating **correctly for the state it is intentionally in**.

## The principle

> Health is not "is every subsystem fully operational." Health is **"is this resource operating
> correctly for the state it is intentionally in right now."** Only the resource can say whether it
> is *broken*; only the framework knows whether the current state is *intended*; the operator's
> config has the final say over what each state means for each probe.

That yields a clean separation of duties, and two rules that keep it honest:

- **Provider answers "am I broken?"** — only the Service Bus adapter knows if the broker is
  reachable; only the blob adapter knows if the offload store answers. It reports raw state,
  including whether it has been *intentionally* paused/not-yet-started.
- **Framework answers "is this state intended?"** — it knows the lifecycle (Starting → Migrating →
  Ready → Paused/Draining) and, via config, maps each `(component, state, probe)` to the effective
  result. It may **override** a raw report when the state makes it expected.
- **Intentional ≠ broken.** `Migrating`-and-progressing is healthy; `Migrating`-and-*stalled* is
  not. `PausedByDesign` is healthy; a transport connection that *actually* dropped while the system
  is `Ready` is not. Real faults still surface — the policy never blindly returns green.

The gate is not the health check. `ISchemaReadyGate` (and its generalization here) decides **what
is paused**; the health source reports **whether the current state is the intended one**. Today
those are fused — `SchemaReadyHealthCheck` returns Unhealthy exactly when the gate is closed — which
is the specific bug this proposal removes.

## Run-control — Whizbang decides what may run

The enforcement half. Each managed resource exposes a run-control hook so the framework can
**start / pause / stop** it; Whizbang drives those transitions from the lifecycle phase, config, and
operator commands.

```csharp
/// <docs>resilience/managed-resource-run-control</docs>
public interface IWhizbangRunControl {
  /// Same component id space as IWhizbangHealthSource: "transport", "workers", "offload", ...
  string Component { get; }
  RunState Current { get; }
  /// Framework asks the resource to enter the desired run-state (idempotent).
  ValueTask ApplyAsync(RunState desired, CancellationToken cancellationToken);
}

public enum RunState {
  Running,   // permitted to do work
  Paused,    // intentionally held, resumable — the resource reports ComponentState.PausedByDesign
  Stopped    // intentionally shut (drained for shutdown / operator killswitch)
}
```

A central run-controller resolves the **desired** run-state per component from
`WhizbangRunControlOptions` — a `(component × lifecycle-phase)` table plus operator overrides — and
applies it whenever the phase changes:

```csharp
public sealed class WhizbangRunControlOptions {
  // Desired run-state per component per phase. Default (shown) pauses processing + writes during a
  // migration while leaving read-only paths alone; empty entries inherit Running.
  //   Migrating: workers=Paused, transport-consume=Paused, writes=Paused; reads unaffected.
  //   Draining:  everything => Stopped (graceful shutdown).
  public IDictionary<(string Component, LifecyclePhase Phase), RunState> Phases { get; }
  // Operator killswitch — force a component's run-state regardless of phase (config or runtime signal).
  public IDictionary<string, RunState> Overrides { get; }
}
```

Two rules mirror the health side:

- **The killswitch is the authority; health is the mirror.** When the controller pauses a resource,
  that resource's health source reports `PausedByDesign`, which the default policy maps to healthy.
  Control and observation never disagree because one drives the other.
- **Run-control is component-scoped and reversible.** Pausing the transport consumer doesn't stop
  the HTTP read path; resuming is a phase transition or an operator signal, not a restart. This is
  what lets "serve reads, pause writes + processing during migration" be expressed declaratively
  instead of by taking the whole pod down.

This is the generalized, enforced form of the invariant: *"never run Whizbang against an unmigrated
schema"* is the run-controller holding workers/writes at `Paused` until the schema phase clears —
now available for **every** managed resource, and drivable by an operator (drain a transport,
disable an offload, quiesce a service for maintenance) without a redeploy.

## Layer 1 — a health hook on every managed interface

Each Whizbang-managed resource contributes a health source. Consumers **register**, they don't
hand-roll:

```csharp
/// <docs>resilience/managed-resource-health</docs>
public interface IWhizbangHealthSource {
  /// Stable component id: "event-store", "transport", "offload", "workers", "schema", "signal-bus", ...
  string Component { get; }
  ValueTask<ComponentHealth> ReportAsync(CancellationToken cancellationToken);
}

public readonly record struct ComponentHealth(ComponentState State, string? Detail = null);

public enum ComponentState {
  Operational,      // running normally
  Starting,         // coming up (connecting, warming) — intentional, transient
  Migrating,        // schema/data migration in progress — intentional
  PausedByDesign,   // gated/drained on purpose (e.g. workers held on the schema gate)
  Degraded,         // working but impaired (slow, partial) — still serves
  Faulted           // genuinely broken — a real fault
}
```

Resources and what their source knows:

| Component | `Operational` | Intentional state | `Faulted` |
|---|---|---|---|
| **event-store / DB** | reachable, schema current | `Migrating` (tables rebuilding), `Starting` | connection dead |
| **transport** (Service Bus / RabbitMQ) | broker connected | `Starting` (connecting), `PausedByDesign` (drained) | broker unreachable while `Ready` |
| **offload** (blob claim-check) | store reachable | `Starting` | store unreachable while running |
| **workers** | pumping | `PausedByDesign` (held on gate) | pump crash-looping |
| **schema / migration** | applied + verified | `Migrating` (progressing) | migration failed / **stalled** |
| **signal bus / temporal** | listening / scheduling | `Starting` | channel/listen dead while `Ready` |

Nobody writes a `SELECT count(*)` against Whizbang's own tables to infer messaging health — the
transport source reports the *transport's* state, and the event-store source reports `Migrating`
instead of letting a locked table read as a fault.

## Layer 2 — the framework overrides raw reports via policy

The framework aggregates every source, layers in the current lifecycle state, and maps each
`(component × state × probe)` to a Healthy / Degraded / Unhealthy result for **liveness** and
**readiness** separately. `WhizbangHealthOptions` is that mapping table:

```csharp
public sealed class WhizbangHealthOptions {
  // Default policy — intentional states are healthy/ready.
  public HealthPolicy Default { get; set; } = HealthPolicy.Lenient;

  // Per-component overrides, e.g. keep offload strict even at startup.
  public IDictionary<string, HealthPolicy> Components { get; } = new Dictionary<string, HealthPolicy>();
}

// A policy is a map: (ComponentState, Probe) -> HealthStatus.
// Lenient (default): Starting/Migrating/PausedByDesign => Healthy on BOTH probes;
//                    Degraded => Healthy (readiness) ; Faulted => Unhealthy.
// Strict:            Migrating/Starting => Unhealthy on readiness (pod held out of rotation),
//                    still Healthy on liveness (never let a probe kill a progressing pod).
```

The **default is Lenient** — the behavior this proposal argues for: *migrating is healthy, so the
pod is Ready and serving during migration.* An operator who wants the max-safe "out of rotation
until fully migrated" posture flips the schema/DB component (or everything) to Strict.

**Liveness is never gated on an intentional state under any policy.** A `Migrating`, `Starting`, or
`PausedByDesign` resource is *alive*; only a truly wedged process should fail liveness (which is
why the [progress watchdog](#the-stall-guard) — not a fixed timeout — is what turns a stalled
migration into `Faulted`).

Whizbang ships the aggregating liveness/readiness contributions that plug into the ASP.NET health
system, so a consumer registers **one** Whizbang health contributor. App-specific checks (a
SignalR backplane, the consumer's own dependencies) remain the consumer's and compose alongside.

## What this resolves

- **The rollback goes away without touching the deploy pipeline.** With the Lenient default the pod
  reports **Ready during migration** (its DB/transport sources report intentional states, not
  faults), so the rollout completes and the migration finishes in place.
- **Workers stay gated by design** (the generalized schema gate) — event processing is paused, and
  reported `PausedByDesign` = healthy, *not* "not running = broken."
- **Reads serve; writes/processing wait.** The event-store body-split touches the log tables, not
  the read-model (`wh_per_*`) tables, so read traffic is served while the migration runs; write and
  processing paths stay gated. See [selective availability](#selective-availability).
- **The invariant is preserved.** "Never run Whizbang against an unmigrated schema" was always the
  *gate's* job; the gate stays closed. This proposal only stops *misreporting a closed gate as a
  failure.*

## Related pieces that read the same lifecycle state {#selective-availability}

Two companions consume the same lifecycle-state source so the whole picture is consistent:

- **Selective availability middleware.** `DatabaseAvailabilityMiddleware` today returns `503` for
  *every* non-probe path while the gate is closed. It becomes **opt-in / selective**: gate only the
  configured schema-dependent paths (or, simplest, "block mutations, allow reads"), reading the
  lifecycle state rather than a raw gate bool. Reads flow during migration; writes get a clean
  `503 { "reason": "schema_migrating" }`.
- **The stall guard.** {#the-stall-guard} The migration source reports `Migrating` while it is
  *making progress*, and only flips to `Faulted` when progress **stalls** past a configured window —
  a no-progress watchdog, not a fixed total-time ceiling. This is what makes "a migration may take
  as long as it needs, as long as it is progressing" a real guarantee: an unbounded-but-progressing
  migration stays healthy; a genuinely wedged one (deadlock, lock-wait) is caught and fails
  liveness so the rollout ends cleanly. It requires the long backfill steps to emit a progress
  heartbeat (batched work + a step/row counter), surfaced as a metric and in the health `Detail`.

## Configuration

```jsonc
// appsettings — defaults shown; every service inherits Lenient unless it opts out.
"Whizbang": {
  "Health": {
    "Default": "Lenient",                 // Migrating/Starting/PausedByDesign => Healthy on both probes
    "Components": {
      "offload": "Strict"                 // e.g. never consider the blob store "healthy" while it can't be reached
    },
    "MigrationStallSeconds": 300          // no-progress window before Migrating => Faulted
  }
}
```

## Build increments (docs-first → strict TDD → PR)

Both tracks share **one lifecycle-state source** (generalized from `ISchemaReadyGate`): run-control
reads it to decide *what may run*; health reads it to decide *what a state means*.

**Health track**
1. **Health contract + aggregator + policy.** `IWhizbangHealthSource`, `ComponentHealth`/
   `ComponentState`, `WhizbangHealthOptions` (Lenient default), the aggregator, and the
   liveness/readiness contributions wired into the ASP.NET health system.
2. **Schema/migration source** — `Migrating ⇒ Ready` by default, `Faulted` on failure/stall.
   Supersedes `SchemaReadyHealthCheck`'s always-Unhealthy-while-gated behavior. *(This is the
   increment that reverses the deploy-rollback failure mode.)*
3. **Transport, offload, worker, DB/event-store sources**; deprecate consumer-side naive checks
   (ship the framework equivalents).
4. **Selective availability middleware** + **stall guard / progress heartbeat**, both reading the
   shared lifecycle state.

**Run-control track** (parallel; same components, same lifecycle source)
5. **Run-control contract + controller.** `IWhizbangRunControl`/`RunState`, the central
   run-controller, and `WhizbangRunControlOptions` (phase table + operator overrides). Generalize
   `ISchemaReadyGate` (workers-wait-on-schema) into the first adapter behind this contract.
6. **Per-component run-control adapters** — workers, transport-consume, the write/append path, and
   offload — pausing/resuming on phase transitions and honoring operator killswitch overrides
   (config + runtime signal via the signal bus).

## Invariants to lock (regression tests)

- Liveness never fails for `Starting` / `Migrating` / `PausedByDesign` under **any** policy.
- Lenient default: a `Migrating` schema source ⇒ readiness **Healthy**; a `Faulted` (or
  stall-detected) schema source ⇒ readiness **Unhealthy**.
- A genuine fault outside an intentional state (transport dropped while `Ready`, offload
  unreachable while running) ⇒ **Unhealthy** — the policy never masks a real fault.
- Strict override on a single component changes only that component's mapping; others stay Lenient.
- The gate and the health source are independent: the gate stays closed across the whole migration
  while the health source reports `Healthy (Migrating)`.

*Run-control:*

- Entering `Migrating` transitions the configured components (workers / transport-consume / writes)
  to `Paused` and leaves read-only paths `Running`; clearing the phase returns them to `Running`
  without a restart.
- A component the controller pauses reports `ComponentState.PausedByDesign` from its health source —
  control and observation never disagree.
- An operator override forces a component's run-state regardless of phase; removing the override
  restores the phase-driven state.
- `Draining` transitions every component to `Stopped` for graceful shutdown.
