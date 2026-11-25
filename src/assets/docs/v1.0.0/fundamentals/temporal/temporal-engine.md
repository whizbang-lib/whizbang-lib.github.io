---
title: Temporal Engine
pageType: concept
version: 1.0.0
category: Fundamentals
order: 1
description: >-
  How the temporal engine fires scheduled and recurring work: the schedule worker's drain loop, which instance
  fires a schedule, why each fire is exactly-once, and how a schedule that does not fire is reported.
tags: 'temporal, scheduling, cron, recurring, schedule-worker, wh_schedules, observability'
codeReferences:
  - src/Whizbang.Core/Temporal/ScheduleWorker.cs
  - src/Whizbang.Core/Temporal/IScheduleClaimer.cs
  - src/Whizbang.Core/Temporal/TemporalOptions.cs
  - src/Whizbang.Core/Temporal/TemporalMetrics.cs
  - src/Whizbang.Core/Temporal/ScheduleOverdueReading.cs
  - src/Whizbang.Data.Postgres/Notifications/PgScheduleClaimer.cs
  - src/Whizbang.Data.Postgres/Notifications/PgScheduleDuePollSource.cs
  - src/Whizbang.Data.Postgres/Migrations/068_ClaimDueSchedules.sql
  - src/Whizbang.Data.Postgres/Migrations/579_TheOutboxDrainsInEmissionOrder.sql
  - src/Whizbang.Data.Postgres/Migrations/598_SchedulesWithNoLiveOwnerAreClaimed.sql
testReferences:
  - tests/Whizbang.Core.Component.Tests/Temporal/ScheduleWorkerTests.cs
  - tests/Whizbang.Core.Component.Tests/Temporal/ScheduleWorkerOverdueTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/TemporalScheduleClaimSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/TemporalScheduleOwnerlessClaimSqlTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/OwnershipByMapClaimSqlTests.Schedules.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PgScheduleClaimerIntegrationTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/PgScheduleDuePollSourceIntegrationTests.cs
---

# Temporal Engine

A schedule is a row in `wh_schedules`: an event to emit, a recurrence (one-shot, interval or cron) and the next time
it is due (`next_fire_at`). Schedules are created and managed through `IScheduleManager`. The design background is
in the [Temporal Engine proposal](/proposals/temporal-engine).

## How a schedule fires {#how-a-schedule-fires}

Every instance runs a `ScheduleWorker`. Its drain loop wakes in three ways:

- a `ScheduleDueSignal` on the [signal bus](/v1.0.0/fundamentals/signal-bus/signal-bus), rung when a schedule is
  created or changed and by the due-schedule poll source;
- an in-memory timer armed to the earliest fire time this instance may claim, so a schedule fires on time rather
  than at backstop latency;
- the backstop, every `Whizbang:Temporal:BackstopIntervalMilliseconds` (5 seconds by default), which catches a missed
  notification.

Each pass calls the provider's claim (`wh_claim_due_schedules` on PostgreSQL). For every due Active schedule it may
take, the claim, in one transaction, locks the row, emits the occurrence into the outbox through the same path as any
other event, advances `next_fire_at` (applying the misfire policy and any end bound), and records a row in
`wh_schedule_runs`. The database clock decides what is due, so clock skew between instances cannot fire a schedule
early.

## Which instance fires a schedule {#which-instance-fires-a-schedule}

Schedules ride the same ownership as the rest of the work, and the service's
[ownership-by-map switch](/v1.0.0/fundamentals/work-coordinator/partition-assignment#ownership-by-map) decides which
rule applies.

**Ownership by map (the default once every live instance supports it).** A schedule fires on the instance that owns
its partition in the published map (the schedule's `partition_number`), whatever its stream's stored owner says, and
whether or not the stream has been written to. Another instance never fires it.

**The legacy mode (the switch off).** A schedule on a stream pinned to an instance is that instance's to fire. It is
also claimable by **any** live instance when no live instance holds its stream:

| The schedule's stream | Who fires it |
|---|---|
| Pinned to this instance | This instance |
| Pinned to another live instance | That instance only |
| Pinned to an instance the [liveness rule](/v1.0.0/fundamentals/workers/instance-liveness) calls dead | Any live instance |
| Has no active-stream row, or one with no assigned instance | Any instance |
| None (a schedule created without a stream) | Any instance |

The first occurrence a schedule emits is usually the first write to its stream, and in the legacy mode that write
pins the stream to the instance that fired it, which owns it from then on. Which instance fires matters only for
spreading the work: the row lock (`FOR UPDATE SKIP LOCKED`) and the advance in the same transaction keep every fire
exactly-once whichever instance claims it. A second instance that reaches the row while it is locked skips it, and one
that reaches it after the commit finds it no longer due.

The claim, the timer's next-fire-time query and the due-schedule poll all apply the same switch and the same rule
(`wh_i_own` in map mode, `wh_schedule_owner_admits` otherwise), so an instance is woken for every schedule it may
claim and for no other.

:::note
Before migration 601 a schedule in the legacy mode was claimable only through its stream's pin. A schedule created on a fresh stream
(the framework's own integrity schedules use a control stream nothing else writes to) was therefore seen by no
instance and never fired, and neither did one whose stream's owner had died. In map mode the claim already fired it,
but the timer and the due poll still looked for the stream's pin and never woke for it, so it fired only on the
backstop. A schedule stuck this way fires once on the first pass after the upgrade: its missed occurrences coalesce
under the default misfire policy.
:::

## A schedule that does not fire is reported {#a-schedule-that-does-not-fire-is-reported}

On every drain pass the worker reads the Active schedules whose fire time passed more than
`Whizbang:Temporal:OverdueWarningMilliseconds` ago (60 seconds by default, twelve backstop intervals), whichever
instance owns them, since the failure this catches is precisely that none takes them. Paused schedules are not
counted; a schedule due within the bound is being fired and is not counted either.

- The reading is published on the `Whizbang.Temporal` meter as `whizbang.temporal.schedules.overdue` (the count) and
  `whizbang.temporal.schedules.overdue.oldest_age_seconds` (how long ago the oldest was due). Both read `0` when
  nothing is overdue and report no value while the reading is unknown (no database connection yet, or a failed read).
  See [Metrics](/v1.0.0/operations/observability/metrics#temporal).
- A warning names the oldest overdue schedule by key and id, with the count and its age, when the overdue set appears
  or changes (another schedule falls behind, or a different one becomes the oldest). It is not repeated on every pass.
  One information line says when the set clears.
- A failed read is logged as a warning and retried on the next pass.

Every instance reads the same table, so each reports the same overdue set. Setting the option to `0` or less turns
the check off.

**What an overdue schedule usually means:** the instance that owns it (its partition's owner in map mode, its stream's pin otherwise) is live but not firing (its worker
is disabled with `Whizbang:Temporal:Enabled=false`, or its run permit is closed), or the database refuses the claim
(the warning from the drain loop names the error).

## Configuration {#configuration}

| Key | Default | Purpose |
|---|---|---|
| `Whizbang:Temporal:Enabled` | `true` | Killswitch: the worker registers but never fires |
| `Whizbang:Temporal:BackstopIntervalMilliseconds` | `5000` | Reconcile cadence absent a doorbell |
| `Whizbang:Temporal:ClaimBatchLimit` | `100` | Schedules claimed per call; the pass drains in batches of this size |
| `Whizbang:Temporal:LeaseDurationSeconds` | `300` | Outbox lease of a spawned occurrence's first publish |
| `Whizbang:Temporal:OverdueWarningMilliseconds` | `60000` | How long past due a schedule may stay unfired before it is reported; `0` turns the check off |

A custom provider implements `IScheduleClaimer`: `ClaimDueSchedulesAsync`, `GetNextFireTimeAsync` and
`GetOverdueSchedulesAsync`, which returns `ScheduleOverdueReading.None` when nothing is overdue and `null` when it
cannot read.

{verified: OwnershipByMapClaimSqlTests.InMapMode_AScheduleWithNoLedgerRow_FiresOnItsPartitionsOwnerOnlyAsync, OwnershipByMapClaimSqlTests.InMapMode_TheNextFireTime_IsTheOwnedPartitionsSchedule_WithNoLedgerRowAsync, OwnershipByMapClaimSqlTests.InMapMode_TheDuePoll_RingsForTheOwnedPartitionsSchedule_WithNoLedgerRowAsync, TemporalScheduleOwnerlessClaimSqlTests.DueSchedule_OnAStreamNothingHasWritten_FiresOnce_AndPinsItsStreamToTheClaimerAsync, TemporalScheduleOwnerlessClaimSqlTests.DueSchedule_WhoseStreamIsPinnedToAnotherLiveInstance_IsLeftToThatInstanceAsync, TemporalScheduleOwnerlessClaimSqlTests.OwnerlessSchedule_ClaimedConcurrently_FiresExactlyOnceAsync, PgScheduleClaimerIntegrationTests.ACronScheduleCreatedOnAFreshStream_FiresOnceAcrossTwoInstancesAsync, ScheduleWorkerOverdueTests.CheckOverdue_AScheduleOverdueBeyondTheBound_WarnsOnce_AndPublishesItAsync, ScheduleWorkerOverdueTests.CheckOverdue_AnUnknownReading_LeavesTheGaugesEmptyAsync}
