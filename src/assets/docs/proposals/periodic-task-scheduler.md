---
title: Periodic Task Scheduler
category: Architecture & Design
order: 29
tags: workers, scheduler, backpressure, throttling, wakeups, connection-pressure, consolidation, run-permit
---

# Periodic Task Scheduler

Whizbang runs **33 background workers**. Twenty-three of them are the same shape: a loop that waits an interval, does a little work — usually a database query — and waits again. Each one schedules itself, on its own cadence, with no knowledge of the others.

Individually every one of them is reasonable. Collectively they are an uncoordinated fan-out into a shared database, and there is no single place to slow them down.

This proposal replaces self-scheduling workers with **registered periodic tasks** driven by one scheduler — so that wakeups can be coalesced, work can be classified, and the whole periodic surface can be throttled at one gate instead of thirty-three.

:::planned
Proposed capability, unreleased. It is a refactor of existing workers onto a new host, not new behaviour. The throttling it enables is described separately; this proposal is the seam that makes it tractable.
:::

## The failure this comes from

A fleet of fourteen services was brought up against a shared PostgreSQL server. The server sat at a flat 29% CPU and 62 connections for ten minutes. The moment the fleet started:

| | before | after |
|---|---|---|
| CPU | 29% | **99%** |
| connections | 62 | **272** |

Five services died within **four seconds of each other**, roughly 155 seconds after starting together. That synchrony is the signature of one shared resource, not five independent faults: every instance was blocked on the database, could not answer its liveness probe, and was killed for it. Each kill restarted the same work, so the load did not subside — it *ratcheted*.

Threads were never the constraint. An async worker awaiting `Task.Delay` holds no thread. The constraint was **database round-trips**, and their number is a direct function of how many independent timers exist and how little they know about each other.

## What is there today

Of the 33 background workers:

- **23 are periodic pollers** — a `Task.Delay` loop on a fixed or adaptive interval.
- **10 are genuinely event-driven** — they hold a `LISTEN` connection, drain a channel, or track the lifetime of a lease.

The periodic ones each own their cadence, their jitter (where they have any), their backoff (where they have any), and their own decision about whether the database is in a fit state to be queried. That last decision is almost always "yes", because a worker has no way to know otherwise.

There is a re-closable gate — `WhizbangRunPermit`, with `Running` / `Paused` / `Stopped` semantics — already implemented and tested. **Nothing in the codebase ever calls `Set()` on it.** The actuator exists; there is no governor, and no obvious place to put one.

## Design

### 1. Tasks are registered, not self-scheduled

A periodic task declares what it is and how often it wants to run. It does not own a loop.

```csharp
services.AddWhizbangPeriodicTask(new PeriodicTaskRegistration {
  Name      = "integrity-audit",
  Interval  = TimeSpan.FromMinutes(30),
  Class     = WorkClass.BackgroundScan,
  Jitter    = TimeSpan.FromMinutes(5),
  RunAsync  = (sp, ct) => sp.GetRequiredService<IIntegrityAudit>().RunOnceAsync(ct),
});
```

The scheduler owns the timer, the due-time bookkeeping, the jitter, and the dispatch.

### 2. Wakeups coalesce

Tasks due within the same window run together on one wakeup rather than waking the process 23 separate times. This does not reduce total work; it reduces the number of independent moments at which the process decides to touch the database, which is what makes the load bursty and hard to reason about.

### 3. Work classes are a property of the registration

Four classes, declared per task rather than inferred:

| Class | Meaning | Under pressure |
|---|---|---|
| `Critical` | pausing it causes harm | **never shed** |
| `Delivery` | the product doing its job | shed last |
| `BackgroundScan` | anti-entropy, statistics, reporting | shed first |
| `BackgroundCleanup` | reclaims resources | slowed, not stopped |

`Critical` is the **default for anything unclassified**, so a task added later cannot silently become pausable.

The `BackgroundCleanup` / `BackgroundScan` split matters more than it looks. Some background work *relieves* the pressure being measured — a reaper that deletes consumed rows, a prune that reclaims space. Shedding it under load makes bloat worse, which makes queries slower, which increases pressure. Cleanup gets a longer interval under pressure; it does not stop.

### 4. One gate

Because dispatch is centralised, a pressure signal has exactly one place to act:

```
PressureAggregator ──► scheduler ──► dispatch or defer, per task class
```

Wiring a permit into 23 workers means 23 opportunities to forget, and 23 more for every worker added afterwards. Wiring it into the scheduler means a task registered next year is throttled by construction.

## What stays as it is

The event-driven workers are not periodic and must not be folded in:

- **`PgSharedNotifyConnection`** holds the `LISTEN` connection — it is not polling, it is parked.
- **`LeaseRenewalWorker`** is bound to the lifetime of claimed work, not to a clock.
- **The channel-driven flush workers** wake on a channel write, which is already the ideal signal.
- **`ClaimWorker`** is deliberately special: a `NOTIFY`-driven wake with adaptive backoff on the hot path. Folding it into a generic scheduler would flatten behaviour that exists for good reasons.

Realistically **about 15 of the 23** collapse into the scheduler. That is the honest number; it is not 33, and claiming otherwise would oversell this.

## What this is not

- **It is not a reduction in work.** A task that must run every thirty seconds still runs every thirty seconds. The win is coordination, jitter and a throttle point — not volume. Volume reduction comes from elsewhere: gating startup reconciliation to one instance per service, and shedding scans under pressure.
- **It is not a general job system.** Durable, cross-instance scheduled work already exists in the temporal engine, with `wh_schedules`, leases and misfire policies. This is strictly for *in-process periodic maintenance* — the work every instance does for itself.
- **It is not a thread-count optimisation.** Async workers awaiting a delay hold no thread. Anyone approaching this expecting thread savings has the wrong model of the problem.

## Open questions

- **Should a task be able to opt out of coalescing?** A task with a tight latency requirement may want its own wakeup rather than being batched with others.
- **Does the scheduler need its own concurrency limit,** or does per-class pressure gating make that redundant? Running fifteen due tasks simultaneously is its own small thundering herd.
- **Per-instance or fleet-wide?** Local observation needs no coordination and is simplest. Fleet-wide via the signal bus is more correct — one instance's view of database pressure is really the fleet's — but adds a dependency. Local-first, bus as an optional amplifier, seems right.
- **How does a task report that it is *making things worse*?** A cleanup task that is failing repeatedly may need to be shed even though its class says slow-not-stop.

## Build sequence

1. **`PeriodicTaskRegistration` + `PeriodicTaskHost`** — registration, due-time bookkeeping, jitter, dispatch. No migrations yet; the host runs zero tasks and is inert.
2. **Migrate two low-risk tasks** (`TableStatisticsCollector`, a retention sweep) and lock their behaviour with regression tests before touching anything on the delivery path.
3. **Coalescing + per-class dispatch**, still with no pressure signal — classes are declared and honoured, but nothing sheds yet.
4. **Migrate the remaining background tasks.** Delivery-path workers move last, or not at all, depending on what the regression suite says.
5. **Attach the pressure signal** at the single gate. This is where the separate throttling work plugs in.

Each step is independently valuable and independently revertible. Step 5 is the point of the whole exercise, but steps 1–4 are worth doing even if the pressure work never lands, because a coalesced, classified, jittered periodic surface is easier to reason about than twenty-three private timers.
