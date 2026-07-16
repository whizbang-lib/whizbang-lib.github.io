---
title: Temporal Engine
category: Architecture & Design
order: 21
tags: temporal, scheduling, recurring, cron, saga-deadlines, signal-bus, wh_schedules
---

# Temporal Engine

Whizbang already fires *delayed* work — a failed message re-dispatches at `scheduled_for`, and a saga arms a watchdog that wakes it later. The **Temporal Engine** promotes that into one first-class mechanism: **scheduled events** (fire at a specific time), **recurring events** (cron or interval), and **saga/deadline timeouts** — all as time-triggered transitions on a single durable schedule table, dispatched over the [System Signal Bus](../fundamentals/signal-bus/signal-bus).

:::planned
The Temporal Engine is a proposed capability (unreleased, not yet started). It **generalizes the existing `scheduled_for` delayed-retry mechanism** and the sagas watchdog rather than replacing them — both become consumers of the same engine.
:::

## Motivation

Time-based behavior is currently spread across three bespoke mechanisms:

- **Delayed retry** — `wh_outbox`/`wh_inbox.scheduled_for` set by the failure-backoff procs; the claim gate skips rows until `scheduled_for <= NOW()`; a low-cadence backup tick emits `notify_scheduled_retry_due()` to wake the owning instance.
- **Saga deadlines** — `BaseSagaService` re-emits an `ISagaCompletionWatchdogTickEvent` into the outbox with `scheduled_for = now + budget` on every tick, re-arming until the saga completes or is abandoned.
- **Nothing first-class** for "run this at 09:00 every weekday" or "fire this once next Tuesday."

The Temporal Engine unifies these under **one engine, four time-triggered transitions**:

| Transition | Trigger | Meaning |
|---|---|---|
| **Birth** | `scheduled_for <= NOW()` | dispatch a scheduled event |
| **Death** | `expires_at <= NOW()` | self-destruct (ephemeral reaper — later phase) |
| **Recurrence** | `next_fire_at <= NOW()` | spawn an occurrence, advance the schedule |
| **Saga deadline** | `next_fire_at <= NOW()` | "if not done by T, fire the watchdog" |

The saga-deadline case is *free*: a saga timeout is just a recurring/one-shot schedule. Building this also gives Whizbang first-class scheduled + recurring events.

## What exists today (the seed)

- `wh_outbox.scheduled_for` / `wh_inbox.scheduled_for` (`TIMESTAMPTZ`, nullable) + the fluent `DispatchOptions.WithScheduledFor(...)`.
- The claim eligibility gate — `(scheduled_for IS NULL OR scheduled_for <= NOW())` in `claim_work` / `fetch_*_batch` / `claim_orphaned_*` (which also preserves FIFO-per-stream when an earlier message is future-scheduled).
- `notify_scheduled_retry_due()` (`049`) + the backup tick (`DefaultBackupTickRegistrar` → `BackupTickCoordinator`) — the exact "temporal wake" pattern the engine mirrors.
- The **F1 Signal Bus** — `ScheduleDueSignal` clones the `WorkAvailableSignals` pattern; a `PgScheduleDuePollSource` clones `PgWorkAvailablePollSourceBase`; the owning instance is targeted via `SignalTarget.Streams(...)` (→ `notify_instance_owners`) or `SignalTarget.Instance(...)`.
- The **sagas watchdog** (`BaseSagaService`, `DispatcherSagaEventEmitter.PublishAsync(evt, scheduledFor)`) — re-armed each tick today; backed onto `wh_schedules` by this engine.

## The engine: DB stores *when*, C# does the *timing*

**The database is the source of truth for time; C# triggers.** Deadlines live in `wh_schedules` (durable) and on the existing `scheduled_for`/`expires_at` columns; a C# worker triggers due items. There is **no DB-native scheduler** (`pg_cron`/triggers) — that is Postgres-only and often unavailable — so the engine is portable (Postgres, SQLite, in-memory).

- **DB-clock authority.** Due-eligibility is `next_fire_at <= NOW()` evaluated against the **DB clock** (matching the whole codebase's `NOW()` convention), so instance clock skew can't cause early/missed fires. The C# `TimeProvider` (BCL, `FakeTimeProvider` in tests) only decides *when to poll*.
- **Multi-instance = the existing model.** Schedules carry a `stream_id`/`partition_number`; ownership resolves via `wh_active_streams.assigned_instance_id` + the `calculate_instance_rank` partition-modulo formula. **Democratic — any instance fires, no leader/SPOF.** A due schedule is claimed with a leased `FOR UPDATE SKIP LOCKED`, and its occurrence is spawned + `next_fire_at` advanced in **one transaction** (so recurrence is double-spawn-safe).
- **NOTIFY-first — polling only as a backstop.** The healthy path does **no DB polling**. A schedule *mutation* (create / update / arm / `trigger-now`) emits a **targeted `ScheduleDueSignal` doorbell at commit** (via `notify_instance_owners` → the owning instance on the F1 signal bus); that instance loads the schedule and arms an **in-memory timer** (`TimeProvider`, OTel-gauged) that fires **exactly at `next_fire_at`**. A schedule becoming due is a *time* event — no DB row changes at `next_fire_at` — so the thing that "notices time passing" is the in-memory timer, per-instance and precise, **not** a DB poll. Polling is *only* the reconciliation backstop: a low-cadence `notify_schedules_due()` tick + a **`PgScheduleDuePollSource`** (adaptive via `INotifySignalingGate` — relaxed when NOTIFY is healthy, tight only when it's down, and the *sole* transport on NOTIFY-less providers like SQLite) catch missed notifies, no-NOTIFY drivers, and rebalance staleness. **KEY: the in-memory timer only decides *when to attempt*; the authoritative fire is the leased DB claim** — so staleness never double-fires or loses a fire.

## `wh_schedules` (migration `066`)

A durable schedule (survives restart): the recurrence rule, `next_fire_at`, bounds, and ownership. Additive `CREATE TABLE IF NOT EXISTS` in the style of `065`, plus a `notify_schedules_due()` function mirroring `049` (gate `next_fire_at <= NOW()`, `notify_instance_owners('schedule', stream_ids)`).

```sql{title="wh_schedules (sketch)" description="Durable schedule definition; occurrences are spawned events" category="Architecture" difficulty="INTERMEDIATE" tags=["Temporal","Scheduling"] framework="NET10"}
CREATE TABLE IF NOT EXISTS __SCHEMA__.wh_schedules (
  schedule_id          UUID PRIMARY KEY,
  schedule_key         TEXT,                 -- optional developer key (idempotent create-or-update)
  stream_id            UUID,                 -- ownership / partition routing
  partition_number     INTEGER NOT NULL DEFAULT 0,
  recurrence_kind      SMALLINT NOT NULL,    -- OneShot | Interval | Cron
  interval_ms          BIGINT,               -- for Interval
  cron                 TEXT,                 -- for Cron (with timezone)
  timezone             TEXT,
  next_fire_at         TIMESTAMPTZ NOT NULL,
  last_fire_at         TIMESTAMPTZ,
  until_at             TIMESTAMPTZ,          -- bound (optional)
  max_occurrences      BIGINT,               -- bound (optional)
  occurrence_count     BIGINT NOT NULL DEFAULT 0,
  misfire_policy       SMALLINT NOT NULL DEFAULT 0,  -- default Coalesce
  catch_up_shape       SMALLINT NOT NULL DEFAULT 0,  -- default Coalesce
  delivery_guarantee   SMALLINT NOT NULL DEFAULT 0,  -- AtLeastOnce (default) | AtMostOnce
  status               SMALLINT NOT NULL DEFAULT 0,  -- Active | Paused
  event_type           TEXT NOT NULL,        -- the occurrence event to spawn
  event_data           JSONB,
  scope                JSONB,                -- PerspectiveScope (tenant/user)
  version              BIGINT NOT NULL DEFAULT 0,     -- optimistic concurrency
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- partial index for the due-poll hot path:
CREATE INDEX IF NOT EXISTS ix_wh_schedules_due
  ON __SCHEMA__.wh_schedules (next_fire_at) WHERE status = 0;
```

**Durable schedule → (maybe-ephemeral) occurrence.** The schedule row is durable config; each occurrence it spawns is a normal event carrying its own declared mode — so a durable schedule can spawn ephemeral occurrences (e.g. a recurring "refresh dashboard" or "expire abandoned drafts" occurrence).

**Liveness is NOT the temporal engine's job.** Detecting whether a *service instance* is alive is owned by the **existing canonical heartbeat / instance-alive system** — `wh_service_instances`, `register_instance_heartbeat`, `claim_instance_alive_lock`, and the F1 `InstanceJoined` / `InstanceLeaving` / `InstanceDied` signals. The temporal engine **consumes** that system (for schedule ownership) and must never add a second mechanism that monitors the same thing. Any framework "is X still alive" need routes to the one heartbeat/alive-lock system.

## Recurrence: cron + interval

Both are supported. **Interval** (`every 30m/6h`) is deterministic and timezone-free. **Cron** (`0 9 * * MON-FRI`) is calendar-based and **timezone/DST-aware** (`timezone` column). `next_fire_at` is recomputed from the rule after each fire (bounded by `until_at`/`max_occurrences`).

## Misfire & catch-up (per-schedule)

When an instance was down while a fire was due:

- **Misfire policy** — per-schedule (Quartz-style), **default `Coalesce`** (fire once, resume at next). `CatchUp` (fire every missed occurrence) and `Skip` are opt-in.
- **Catch-up burst control** (for `CatchUp`) — a **lookback window** bounds how far back to replay; a **rate limit** (backpressure-aware) spreads the burst; a **max-count/coalesce** cap collapses the tail. **Catch-up shape is per-schedule, default coalesce** — replay-each (throttled + lookback-bounded) vs coalesce-into-one carrying the missed range/count.

## Firing semantics

- **Occurrence creation is exactly-once** — the claim + occurrence-spawn + `next_fire_at` advance happen in one transaction (leased `SKIP LOCKED`), so no double-spawn even under concurrent instances.
- **Delivery guarantee is per-schedule** — because redelivery can be *dangerous* for non-idempotent operations (a duplicate charge, a duplicate email), each schedule declares which side of the trade it wants:
  - **At-least-once (default)** — the occurrence flows through the normal pipeline with a deterministic occurrence-id (`schedule-id + occurrence#/fire-time`) and is **retried on failure**; the handler should be idempotent, so a rare redelivery is harmless. Choose this when a *miss* is worse than a *duplicate*.
  - **At-most-once** — the occurrence is dispatched **once and never redelivered** (no retry after dispatch). Choose this when a *duplicate* is worse than a *miss*: a dispatch failure is recorded in the run log (below) for an operator to act on, rather than silently retried.

  True cross-process *exactly-once* delivery is impossible — but occurrence **creation** is exactly-once, and delivery is the developer's dial between **never-miss** (at-least-once) and **never-duplicate** (at-most-once). The developer picks per schedule based on what the occurrence actually does.

## Run & failure log (`wh_schedule_runs`)

Every occurrence fire is recorded in a durable **`wh_schedule_runs`** table (migration `066`) for audit, debugging, and ops visibility — which schedule ran, when, the outcome, how long it took, the occurrence-id, the firing instance, and (on failure) the **error message + stack trace**. An operator can query "the last 20 runs of schedule K and why the failures failed"; the log also feeds the OTel metrics. Retention is bounded by a sweep (like the durable signal log). This is what makes the **at-most-once** delivery guarantee safe to offer — a non-retried failure is never silent; it lands here.

```sql{title="wh_schedule_runs (sketch)" description="Durable per-fire run/failure history with stack traces" category="Architecture" difficulty="INTERMEDIATE" tags=["Temporal","Observability"] framework="NET10"}
CREATE TABLE IF NOT EXISTS __SCHEMA__.wh_schedule_runs (
  run_id           BIGSERIAL PRIMARY KEY,
  schedule_id      UUID NOT NULL,
  occurrence_id    UUID NOT NULL,
  fired_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status           SMALLINT NOT NULL,        -- Success | Failed | Skipped(misfire) | TriggeredEarly
  duration_ms      INTEGER,
  error_message    TEXT,
  error_stacktrace TEXT,
  instance_id      UUID
);
CREATE INDEX IF NOT EXISTS ix_wh_schedule_runs_by_schedule
  ON __SCHEMA__.wh_schedule_runs (schedule_id, fired_at DESC);
```

## Schedule management

`cancel` / `pause` / `resume` / `update` / **`trigger-now`** / `query` — each a DB mutation + a `ScheduleDueSignal` doorbell to the owning instance (which reconciles its in-memory heap); any instance may issue the op, scoped by `PerspectiveScope`.

- **`trigger-now(scheduleId)`** fires a schedule's occurrence **immediately**, ahead of `next_fire_at` — for manual/ops runs, "run it now," and testing. It does **not** disturb the recurrence cadence: the next scheduled fire still lands on its own `next_fire_at` (the early run is recorded in the [run log](#run--failure-log-wh_schedule_runs) with status `TriggeredEarly`). It respects the schedule's delivery guarantee.
- **Identity = developer key + framework `ScheduleId`** (the key enables idempotent "ensure a schedule for K"; either identifies a schedule for these ops).
- **Cancel is cascade best-effort** — it also cancels still-cancellable in-flight occurrences (those still pending/undispatched) via a parent-schedule link, a reusable "cancel a pending event" primitive.
- Pause reuses the misfire policy for the paused gap; updates use optimistic concurrency (`version`).

## Saga deadlines

The sagas watchdog (`BaseSagaService.TryRecoverViaWatchdogTickAsync`, `DispatcherSagaEventEmitter.PublishAsync(evt, scheduledFor)`) is backed onto a first-class `wh_schedules` row (a one-shot re-armed schedule) instead of re-emitting a scheduled outbox event each tick — the same adaptive backoff (`SagaOptions.MinWatchdogDelay`…`MaxWatchdogDelay`, `MaxConsecutiveStalls`) applies.

## Declaration surface

Both **imperative** (`scheduler.Schedule(key, when, event)`, `ScheduleRecurring(key, cron|interval, event)`, `Cancel/Pause/Resume/Update`) and **declarative** (a registered recurring-job definition). "Scheduled" is a property **orthogonal** to Sourced/Ephemeral — you can schedule either.

## Relationship to ephemeral TTL

`scheduled_for` (birth) and `expires_at` (death) are the same temporal engine's two ends. For a **scheduled ephemeral event**, the TTL clock start is **configurable, default fire-time** (the event doesn't "exist" until it fires). The ephemeral reaper (later phase) is the death-side consumer.

## Related Documentation

- System Signal Bus — the doorbell transport this engine publishes/subscribes on
- Ephemeral Events — the death-side (`expires_at`) consumer of the same engine
- Sagas — the watchdog/deadline mechanism this engine backs
