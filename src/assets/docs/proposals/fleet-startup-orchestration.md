---
title: Fleet Startup Orchestration
category: Architecture & Design
order: 28
tags: startup, orchestration, storm-control, leader-election, transport-discovery, admission-control, backpressure, liveness, readiness, thundering-herd
---

# Fleet Startup Orchestration

Whizbang bounds what a *single instance* does at startup. It does not bound what a *fleet* does. Every instance independently decides to migrate, reconcile, audit, recover and drain the moment it boots — and each of those decisions is individually reasonable. Collectively, on a shared database, they are a thundering herd that can prevent the very startup they are part of.

This proposal closes that gap: the framework should coordinate startup **across** instances the way it already coordinates work within one.

:::planned
Proposed capability, unreleased. It builds almost entirely on machinery Whizbang already has — the [Managed-Resource Health](managed-resource-health) lifecycle phases, the system signal bus, the `wh_settings` compare-and-swap watermark, and advisory-lock claiming. What is missing is not primitives but *fleet-level* application of them.
:::

## The failure this comes from

A fourteen-service deployment was brought up simultaneously against one shared PostgreSQL server. The observed sequence, in order:

1. Every service began its startup work at once — schema initialization, type-definition reconciliation, maintenance, and the stream-integrity audit.
2. Disk IOPS on the shared server pinned at **100%**, CPU at **96%**.
3. Health endpoints — including one that performs *no I/O at all* — stopped answering inside their probe timeouts, because the pods' thread pools were saturated by their own background work.
4. Liveness probes killed the pods. Restarts re-ran the same startup work. Pods accumulated **50–66 restarts overnight and completed nothing.**
5. Deployment gates timed out waiting for readiness and rolled services back, handing the next attempt the same conditions.

Every individual component behaved as designed. The system still could not start. Bringing the fleet up **in waves, gated on readiness and IOPS headroom**, worked — done by hand, from outside the framework. That manual procedure is the specification for this feature.

### What has already been fixed

Three contributing framework behaviours were corrected while diagnosing this, and they bound the *volume* of startup work:

- The integrity audit now runs **once per service per cycle** rather than once per replica, claimed through a `wh_settings` watermark CAS.
- Control-plane messages are **dropped rather than durably dead-lettered**, so a failure burst cannot become a backlog that every later boot replays.
- The worker pipeline **establishes a thread-pool floor**, so Whizbang's own workers cannot starve the host's HTTP pipeline into a liveness kill.

Those are necessary and insufficient. They reduce per-instance cost; they do not coordinate instances. A fleet of correctly-bounded services can still overwhelm a shared dependency simply by starting together.

## Design

### 1. Startup admission control

The core addition. Expensive startup phases become **admitted work** rather than unconditional work: an instance asks for permission before running a phase, and proceeds when the fleet has capacity.

- Phases are declared, not ad-hoc: schema migration, historical reconciliation, deep audit, dead-letter replay, perspective rebuild.
- Admission is **per service and per phase**, with a concurrency budget (default: a small number fleet-wide, not per pod).
- A denied instance does not fail — it defers, reports the phase as pending through the existing health surface, and retries. This is the wave behaviour, automated.
- Admission slots are **leased**, not held: a pod killed mid-phase releases its slot on lease expiry rather than deadlocking the fleet.

The `wh_settings` CAS watermark already used by the audit gate and the deep-prune scheduler generalizes directly into this; nothing new is needed at the storage layer.

### 2. Transport-side discovery and election

Today every coordination primitive is **database-anchored**: instance registration, stream ownership (modulo-rank over `wh_active_streams`), leader roles, and the signal bus (PostgreSQL `LISTEN`/`NOTIFY`). That is a clean design with one structural weakness — *when the database is the thing under stress, the coordination that would relieve the stress is the first casualty.* The fleet loses its ability to organize precisely when organizing matters most.

The proposal is a **transport-backed `ISignalTransport`** (Azure Service Bus / RabbitMQ) alongside the existing PostgreSQL one, so instances can:

- discover peers and announce liveness without a database round-trip;
- elect a coordinator for fleet-level decisions when the database is degraded;
- propagate a **stress signal** (see below) even while database latency is pathological.

The signal bus was built transport-agnostic for exactly this: `ISignalSource` / `ISignalTransport` are DI seams, and the wire format is a doorbell-not-data marker, so a second transport is an addition rather than a redesign. Election must remain **advisory** — the database stays the authority for anything requiring exactly-once semantics; transport election decides *who coordinates*, never *who owns a stream*.

### 3. Dependency-stress backpressure

Admission control bounds concurrency, but a fixed budget cannot know how much a *particular* database can take. Instances should measure and adapt:

- Sample real signals already available — command latency, timeout rate, and the connection-pool gate's saturation.
- Feed them into an **additive-increase / multiplicative-decrease** controller that widens the startup budget while the dependency is healthy and collapses it sharply when it is not.
- Publish the stress verdict on the signal bus so the fleet backs off **together** rather than each instance discovering saturation independently — the difference between a coordinated retreat and fourteen simultaneous retries.

This is the piece that makes the manual "wait for IOPS below 70%" gate unnecessary.

### 4. Probes must report intent, never data conditions

The outage's proximate cause deserves stating as a design rule, because it is easy to get wrong and expensive when wrong:

> **A liveness probe answers "is this process wedged?" — nothing else.** It must not depend on a database query, a queue depth, or any condition that only the running process can resolve. Restarting a process cannot fix a backlog; it can only discard the progress that was clearing it.

Whizbang's `HealthPolicy` already encodes this (liveness is Healthy for every lifecycle state, so an intentional state or a dependency fault never triggers a restart). The gap is that a consumer can bypass it by hand-rolling checks. Startup orchestration should make the correct wiring the *turnkey* path — `AddWhizbangManagedHealthChecks()` plus the driver's own connectivity sources — and the documentation should state the rule plainly enough that no one re-derives it from an incident.

Readiness, correspondingly, reports **serve-ability**: an instance deferring a startup phase is *not ready and not broken*, and must be distinguishable from one that has failed.

## What this is not

- **Not a scheduler.** Kubernetes decides where and when pods run. This decides what they may *do* once running.
- **Not a distributed lock service.** Admission slots are advisory leases with expiry, not mutual-exclusion guarantees. Correctness-critical exclusivity keeps using the database primitives that already provide it.
- **Not a replacement for capacity.** A dependency too small for its fleet stays too small; this converts a self-sustaining failure into honest, observable queueing.

## Open questions

- **Budget defaults.** Fleet-wide concurrency of one is safest and slowest. Is the right default a small constant, or derived from the observed instance count?
- **Coordinator scope.** One coordinator per service, or one per shared dependency? The failure was *cross-service* contention on one database, which argues for the dependency — but services do not currently share a coordination namespace.
- **Migration ordering.** Should admission understand dependencies between services, or is per-dependency backpressure sufficient? The manual recovery used arbitrary wave membership and worked, which suggests ordering may be unnecessary.
- **Transport election trade-off.** A second election path is a second thing that can be wrong. Is advisory-only election worth the complexity, versus accepting that a degraded database means degraded coordination?

## Build sequence

Each increment is independently valuable and independently shippable:

1. **Admission control** over the existing settings-CAS primitive, applied first to the heaviest phase (historical reconciliation), then to audit, dead-letter replay and rebuild. Highest value alone: it is the automated form of the wave procedure that actually recovered the fleet.
2. **Stress signal + AIMD backpressure**, driven by metrics already collected, published over the existing bus.
3. **Transport-backed signal transport**, enabling discovery and stress propagation without the database.
4. **Advisory transport election**, only if (3) proves the transport path reliable enough to depend on.

Increments 1 and 2 address the observed failure completely. Increments 3 and 4 address the harder case where the database itself is the casualty — worth building, worth building last.
