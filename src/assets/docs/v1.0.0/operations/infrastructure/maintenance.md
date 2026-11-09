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
[command timeouts](../configuration/configuration-reference#command-timeouts)). If any task inside it runs past that budget, the
whole call is cancelled: every task in it rolls back, including the ones that had finished, and the cycle stops
there, so none of the sweeps that follow the call run in that cycle either.

So a task in the call must never do an amount of work that grows without limit with the size of a table. A task
whose work is bounded per cycle always finishes, and a backlog it cannot clear in one cycle is cleared over several.

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
once an hour ([housekeeping arbitration](../workers/housekeeping-arbitration)). If settled rows arrive faster than
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

## Related

- [Database-side settings](../configuration/configuration-reference#database-side-settings)
- [Skipped messages are stored settled](../../messaging/transports/transport-consumer#skipped-messages)
- [Housekeeping arbitration](../workers/housekeeping-arbitration)
- [Maintenance steps](../../fundamentals/workers/maintenance-steps)
- [Storage maintenance](storage-maintenance)
