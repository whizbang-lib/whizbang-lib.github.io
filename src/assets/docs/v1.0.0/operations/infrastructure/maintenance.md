---
title: Maintenance Cycle
pageType: concept
version: 1.0.0
category: Infrastructure
order: 8
description: >-
  What the maintenance cycle's single database call does to the framework's work tables, why every purge in it must
  fit the call's command budget, and how the completed-inbox purge deletes at most a batch of rows per cycle so a large
  backlog drains over several cycles instead of stopping maintenance.
tags: >-
  operations, maintenance, retention, purge, inbox, completed inbox, wh_settings, batch, backlog,
  completed_inbox_purge_batch_size, CompletedInboxPurgeBatchSize, discarded on receive
codeReferences:
  - src/Whizbang.Data.Postgres/Migrations/366_CompletedInboxPurgeIsBounded.sql
  - src/Whizbang.Core/Workers/MaintenanceRetentionOptions.cs
  - src/Whizbang.Core/Workers/RetentionSettingsBridge.cs
  - src/Whizbang.Core/Workers/MaintenanceWorker.cs
  - src/Whizbang.Data.EFCore.Postgres/EFCoreWorkCoordinator.cs
testReferences:
  - tests/Whizbang.Data.EFCore.Postgres.Tests/MaintenanceTests.cs
  - tests/Whizbang.Core.Tests/Workers/RetentionSettingsValidationTests.cs
  - tests/Whizbang.Core.Tests/Workers/RetentionSettingsBridgeTests.cs
  - tests/Whizbang.Core.Tests/Workers/RetentionSettingsBindingTests.cs
  - tests/Whizbang.Core.Tests/Workers/HousekeepingHigherRankDeferralTests.cs
  - tests/Whizbang.Core.Tests/Workers/HousekeepingPersistedDeferralTests.cs
---

# Maintenance Cycle

Each maintenance cycle the `MaintenanceWorker` makes one database call, `wh_perform_maintenance`, that runs the
framework's SQL housekeeping in order: it purges completed outbox, inbox and perspective-event rows, purges inbox
rows that were never processed past `stuck_inbox_retention_days`, prunes old deduplication entries, abandoned
active-stream rows, expired eviction tombstones and settled dead letters, and reaps expired event-store rows. Each
task reports a row in the cycle's results (`purge_completed_inbox`, `purge_stuck_inbox` and so on), logged and
recorded as a per-task metric.

The windows and limits these tasks read are [database-side settings](../configuration/configuration-reference#database-side-settings)
in `wh_settings`, published from `Whizbang:Workers:Maintenance:Retention` before the call runs. With
`Whizbang:WorkCoordinator:DebugMode` on, the completed-row purges are skipped so completed rows stay for inspection.

After the call, in the same cycle, the worker runs its other sweeps: lifecycle-completion cleanup, the offload
sweep, the [perspective row retention sweeps](../../fundamentals/workers/maintenance-steps), bloat detection
([storage maintenance](storage-maintenance#how-bloat-is-measured)), the
[stuck-row sentinel](../observability/stuck-row-sentinel), and the
[maintenance steps](../../fundamentals/workers/maintenance-steps) other packages register.

## The call runs under one command budget {#one-command-budget}

`wh_perform_maintenance` is one statement from the host's point of view, and it runs as one transaction under the
work coordinator's fixed command budget (180 seconds on the EF Core driver, see
[command timeouts](../configuration/configuration-reference#command-timeouts)). If the call runs past that budget,
it is canceled: every task in it rolls back, including the ones that had finished. A cancellation is the one failure
no task can survive inside the call. Since migration 422 a task that raises an error is rolled back alone and the
others commit, and the worker runs the sweeps that follow the call whether or not the call succeeded
([a failed task does not stop the cycle](#a-failed-task-does-not-stop-the-cycle)).

So a task in the call must never do an amount of work that grows without limit with the size of a table. A task
whose work is bounded per cycle always finishes, and a backlog it cannot clear in one cycle is cleared over several.
Every purge in the call is bounded that way ([every purge is bounded](#every-purge-is-bounded)).

## The completed-inbox purge is bounded {#completed-inbox-purge-is-bounded}

{verified: MaintenanceTests.PerformMaintenance_PurgesAtMostTheBatchOfCompletedInboxRows_AndTheRestOnTheNextCycleAsync, MaintenanceTests.PerformMaintenance_ABatchSetBelowOne_StillPurgesOneRowPerCycleAsync, MaintenanceTests.PerformMaintenance_WithNoBatchSetting_PurgesUpToTheDefaultAsync, MaintenanceTests.Migration_SeedsTheCompletedInboxPurgeBatchDefaultAsync}

The completed-inbox purge (`purge_completed_inbox`) deletes at most `completed_inbox_purge_batch_size` completed
inbox rows per cycle, 50000 by default. Rows past the batch stay for the next cycle. Each row deleted takes its
`wh_inbox_state` row with it.

### Why it is bounded {#why-the-inbox-purge-is-bounded}

A completed inbox row is normally deleted the moment its message completes, so the purge usually has little to do.
The rows it exists for are the ones that are never completed that way:

- **Messages discarded on receive.** A message the consumer decides not to process, such as one addressed to
  another service (`foreign_target`) or one no receptor, perspective or lifecycle receptor on this service consumes
  (`no_local_consumer`), is stored already settled, with its body
  ([skipped messages are stored settled](../../messaging/transports/transport-consumer#skipped-messages)). Nothing
  else removes such a row: this purge is the only thing that deletes it.
- **Rows a refused store completes in place**
  ([the one refusal](../../messaging/transports/transport-consumer#refused-bodies)).

A service that receives a steady stream of messages meant for other services stores every one of them settled, so
it can build a large backlog of completed rows. Before migration 366 the purge deleted every completed row in one
statement. Once the backlog outgrew what one statement could delete inside the
[command budget](#one-command-budget), the call timed out, the whole cycle rolled back, and nothing was purged. The
next cycle faced a larger backlog and failed the same way, so the backlog only grew, and every sweep that runs after
the call (perspective row retention, lifecycle-completion cleanup, the offload sweep, bloat detection, the stuck-row
sentinel and registered maintenance steps) was skipped every cycle.

With a batch per cycle the call fits its budget whatever the backlog, and the backlog drains a batch at a time. The
batch is picked without an order: which completed row goes first does not matter, and sorting the backlog every
cycle would cost what the bound saves.

### How long a backlog takes to drain {#inbox-purge-drain-time}

Each cycle removes up to one batch, so a backlog drains at up to

> rows per hour = batch size x cycles per hour

At the default interval (`Whizbang:Workers:Maintenance:IntervalMinutes`, 10 minutes) a cycle can run six times an
hour, so the default batch of 50000 removes up to 300000 completed rows an hour, about 7.2 million a day, on top of
whatever new completed rows arrive. A backlog of 3 million completed rows clears in about ten hours.

That is a ceiling: while the service is busy, maintenance waits for an idle moment, up to the forced ceiling
(`Whizbang:Housekeeping:MaxDeferral`, one hour by default), so under sustained load a cycle can run as rarely as
once an hour ([housekeeping arbitration](../workers/housekeeping-arbitration)). The hour is measured from the first
deferral even while integrity work or dead-letter recovery holds the housekeeping slot
([a higher rank spends the ceiling](../workers/housekeeping-arbitration#a-higher-rank-spends-the-ceiling)), and across
restarts and redeploys, because the first deferral is held in the service's store
([the ceiling survives a restart](../workers/housekeeping-arbitration#the-ceiling-survives-a-restart)). If settled rows arrive faster than
the purge removes them, `purge_completed_inbox` reports the full batch every cycle and the table keeps growing.

### Tuning the batch {#inbox-purge-batch-tuning}

{verified: RetentionSettingsBindingTests.MaintenanceRetention_BindsFromItsEnvironmentVariablesAsync, RetentionSettingsBridgeTests.EachIntegerOption_PublishesItsKeyAsAnIntegerLiteralAsync, RetentionSettingsValidationTests.ACompletedInboxPurgeBatchBelowOne_IsRejectedByNameAsync, RetentionSettingsValidationTests.ACompletedInboxPurgeBatchOfOne_IsAcceptedAsync}

Set the batch with `Whizbang:Workers:Maintenance:Retention:CompletedInboxPurgeBatchSize`
(`Whizbang__Workers__Maintenance__Retention__CompletedInboxPurgeBatchSize`). Each cycle publishes it to
`wh_settings.completed_inbox_purge_batch_size` before the call runs; left unset, the stored value stands (50000, or
a value set in SQL).

```json{
title: "Raise the completed-inbox purge batch"
description: "Lets each maintenance cycle purge up to 100000 completed inbox rows, published to wh_settings.completed_inbox_purge_batch_size on the next cycle."
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["maintenance", "inbox", "retention", "wh_settings", "appsettings"]
tests: ["RetentionSettingsBindingTests.MaintenanceRetention_BindsFromItsEnvironmentVariablesAsync", "RetentionSettingsBridgeTests.EachIntegerOption_PublishesItsKeyAsAnIntegerLiteralAsync"]
}
{
  "Whizbang": {
    "Workers": {
      "Maintenance": {
        "Retention": {
          "CompletedInboxPurgeBatchSize": 100000
        }
      }
    }
  }
}
```

- **Watch `purge_completed_inbox`.** The task's row count and duration are logged and recorded every cycle. A count
  below the batch means the backlog is gone; the full batch every cycle means it is still draining.
- **Raise it to drain faster** while the purge's duration stays well inside the [command budget](#one-command-budget),
  since every other task in the call shares that budget. A purge that takes a large part of it leaves the rest of
  the call no room.
- **Lower it** if the purge's duration approaches the budget, for example on a small database or a slow disk.
- **The value must be 1 or greater.** A configured value below 1 is refused at startup, naming the key, because a
  batch of zero would never purge. A value below 1 written in SQL is treated as 1.
- **To keep completed rows, use debug mode** (`Whizbang:WorkCoordinator:DebugMode`), not a small batch. Debug mode
  is the only way to keep them.

## Every purge is bounded {#every-purge-is-bounded}

{verified: MaintenanceTests.PerformMaintenance_ABoundedPurge_DeletesAtMostItsBatch_AndTheRestOnTheNextCycleAsync, MaintenanceTests.PerformMaintenance_ABoundedPurgeSetBelowOne_StillDeletesOneRowPerCycleAsync, MaintenanceTests.PerformMaintenance_ABoundedPurgeWithNoSetting_DeletesUpToTheDefaultAsync, MaintenanceTests.Migration_SeedsEachPurgeBatchDefaultAsync, RetentionSettingsValidationTests.EveryOtherPurgeBatchBelowOne_IsRejectedByNameAsync, RetentionSettingsBridgeTests.EachIntegerOption_PublishesItsKeyAsAnIntegerLiteralAsync}

The [completed-inbox purge](#completed-inbox-purge-is-bounded) was the first purge given a batch. Since migration 421
the other four purges in the call delete at most their own batch per cycle too, and leave the rest for later cycles:

| Task | What it deletes | `wh_settings` key | Option (`Whizbang:Workers:Maintenance:Retention:`) |
|---|---|---|---|
| `purge_completed_outbox` | completed outbox rows | `completed_outbox_purge_batch_size` | `CompletedOutboxPurgeBatchSize` |
| `purge_stuck_inbox` | inbox rows never processed, leased or claimed, older than `stuck_inbox_retention_days` | `stuck_inbox_purge_batch_size` | `StuckInboxPurgeBatchSize` |
| `purge_completed_perspective_events` | completed perspective-event rows | `completed_perspective_event_purge_batch_size` | `CompletedPerspectiveEventPurgeBatchSize` |
| `purge_old_deduplication` | deduplication rows older than `dedup_retention_days` | `deduplication_purge_batch_size` | `DeduplicationPurgeBatchSize` |

Each batch is 50000 by default, seeded in `wh_settings` and used as the fallback when the row is missing. Each must be
`1` or greater: a configured value below `1` is refused at startup naming the key, and a value below `1` written in
SQL is treated as `1`, because a batch of zero would stop that purge for good. Debug mode
(`Whizbang:WorkCoordinator:DebugMode`) still keeps completed rows; a small batch is not the way to keep them.

Why: each of these was one unbounded delete inside the call, the shape that timed out the completed-inbox purge
before #2171. The deduplication table holds one row per message received within its window, so on a busy service it
is the largest table the purges read, and a backlog behind it could outgrow the [command budget](#one-command-budget)
the same way. Like the inbox batch, each batch is picked without an order, since sorting the backlog every cycle would
cost what the bound saves; the deduplication purge finds its aged rows through the `first_seen_at` index.

A backlog drains at up to `batch size x cycles per hour`, as for the inbox
([how long a backlog takes to drain](#inbox-purge-drain-time)): with the defaults, about 300000 rows an hour per purge,
7.2 million a day, when maintenance is not deferred. A service whose rows become eligible faster than that sees its
task report the full batch every cycle; raise that purge's batch while its duration stays well inside the budget, or
shorten the interval, as in [tuning the batch](#inbox-purge-batch-tuning).

```json{
title: "Raise the deduplication purge batch"
description: "Lets each maintenance cycle purge up to 100000 deduplication rows past their retention, published to wh_settings.deduplication_purge_batch_size on the next cycle."
category: "Configuration"
difficulty: "INTERMEDIATE"
tags: ["maintenance", "deduplication", "retention", "wh_settings", "appsettings"]
tests: ["RetentionSettingsBindingTests.MaintenanceRetention_BindsFromItsEnvironmentVariablesAsync", "RetentionSettingsBridgeTests.EachIntegerOption_PublishesItsKeyAsAnIntegerLiteralAsync"]
}
{
  "Whizbang": {
    "Workers": {
      "Maintenance": {
        "Retention": {
          "DeduplicationPurgeBatchSize": 100000
        }
      }
    }
  }
}
```

## A failed task does not stop the cycle {#a-failed-task-does-not-stop-the-cycle}

{verified: MaintenanceWorkerTaskIsolationTests.AFailedTask_IsLoggedByName_AndEveryLaterTaskStillRunsAsync, MaintenanceWorkerTaskIsolationTests.TheMaintenanceCallFailing_NamesItInTheWarningAsync, MaintenanceWorkerTaskIsolationTests.TheDestructionReadFailing_GivesTheReapNothing_AndTheCycleGoesOnAsync, MaintenanceWorkerTaskIsolationTests.ATaskTheDatabaseReportsFailed_IsLoggedAsAWarningByNameAsync, MaintenanceWorkerTaskIsolationTests.Cancellation_StillStopsTheCycleAsync, MaintenanceTests.PerformMaintenance_ATaskThatFails_IsReportedByName_AndTheTasksBeforeAndAfterItStillCommitAsync, MaintenanceTests.PerformMaintenance_TheDeduplicationTaskFailing_LeavesTheDeadLetterPurgeItsRetentionAsync}

A maintenance cycle is a list of named tasks, run in order, and each one runs on its own. When a task fails, the
worker logs a warning naming the task, with its exception, and runs the next task. The failed task runs again on the
next cycle. The tasks, in order:

`retention_settings_sync`, `reap_driven_snapshots`, `ephemeral_destruction_hooks`, `digest_epoch_closure`,
`integrity_traffic_sweep`, `perform_maintenance`, `lifecycle_completion_cleanup`, `handled_ledger_sweep`,
`ephemeral_pointer_prune`, `offload_claim_sweep`, `perspective_row_sweeps`, `table_rewrite_detection`,
`stuck_row_sentinel`, `exhausted_inbox_conclusion` and `maintenance_steps`.

Inside the call, each task of `wh_perform_maintenance` runs in its own block (migration 422). A task that raises an
error (a lock timeout, a deadlock, a setting its cast rejects) is rolled back alone and reported as its own row, with
0 rows and the status `failed: <error>`; the worker logs that row as a warning naming the task. The tasks before it
and after it run and commit with the call. Each task reads the settings it uses itself, so a failure in one cannot
leave another without its window.

What still holds:

- **Cancellation ends the cycle.** A canceled task is a host shutting down, not a failed task, so it is never logged
  and passed over. A call canceled by its command budget rolls back as a whole
  ([one command budget](#one-command-budget)); the worker then runs the sweeps after it.
- **The reap deletes only what the destruction hooks were given.** When reading the batch for the destruction hooks
  fails, the reap is given an empty set and nothing is reaped that cycle, rather than every eligible body. The
  PostDestruction hooks fire only after a maintenance call that returned.
- **A step you register is isolated the same way,** each step on its own ([maintenance steps](../../fundamentals/workers/maintenance-steps)).

Why: before #2174 a task that threw ended the cycle, and inside the call a task that raised rolled back every other
task with it. When the call timed out on a large backlog, a service ran none of the perspective row retention sweeps,
the lifecycle-completion cleanup, the offload sweep, bloat detection, the stuck-row sentinel or the registered steps
for days, although none of them depended on the call. The cycle being a list is what keeps it that way: a task added
to it is isolated without anyone remembering to catch its failure.

## Related

- [Database-side settings](../configuration/configuration-reference#database-side-settings)
- [Skipped messages are stored settled](../../messaging/transports/transport-consumer#skipped-messages)
- [Housekeeping arbitration](../workers/housekeeping-arbitration)
- [Maintenance steps](../../fundamentals/workers/maintenance-steps)
- [Storage maintenance](storage-maintenance)
