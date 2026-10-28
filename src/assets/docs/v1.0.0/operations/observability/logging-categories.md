---
title: Logging Categories
pageType: reference
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
version: 1.0.0
category: Observability
order: 4
description: >-
  Configure log levels for Whizbang's internal logging categories to control
  console output verbosity in development and production environments
tags: 'logging, log levels, categories, appsettings, observability, configuration, ILogger'
codeReferences:
  - src/Whizbang.Core/Dispatcher.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
  - src/Whizbang.Core/Workers/TransportConsumerWorker.cs
  - src/Whizbang.Core/Workers/OutboxPublishWorker.cs
  - src/Whizbang.Core/Workers/ClaimWorker.cs
  - src/Whizbang.Core/Workers/InboxDrainWorker.cs
  - src/Whizbang.Core/Workers/InboxDispatchWorker.cs
  - src/Whizbang.Core/Workers/InboxHandlerWorker.cs
  - src/Whizbang.Core/Tags/MessageTagProcessor.cs
  - src/Whizbang.Core/Observability/WhizbangStartupLog.cs
  - src/Whizbang.Data.EFCore.Postgres/WhizbangHostExtensions.cs
testReferences:
  - tests/Whizbang.Core.Component.Tests/Workers/InboxDrainWorkerGapTests.cs
  - tests/Whizbang.Core.Tests/Workers/InboxDispatchWorkerHeldLeaseTests.cs
  - tests/Whizbang.Core.Tests/Workers/InboxDispatchWorkerControlPlaneDropLogTests.cs
  - tests/Whizbang.Core.Component.Tests/Workers/InboxHandlerWorkerTests.cs
lastMaintainedCommit: '01f07906'
---

# Logging Categories

Whizbang uses .NET's standard `ILogger` infrastructure for all internal diagnostic logging. Each component writes to a named **logging category** that you can independently control via `appsettings.json`.

## Quick Start

Silence noisy Whizbang components in development by adding overrides to your `appsettings.Development.json`:

```json{title="Silence Noisy Categories" description="Suppress verbose startup, worker, and transport output" category="Configuration" difficulty="BEGINNER" tags=["Logging", "Configuration"]}
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Whizbang.Initialization": "None",
      "Whizbang.Core.Dispatcher": "None",
      "Whizbang.Core.Workers.PerspectiveWorker": "None",
      "Whizbang.Core.Workers.TransportConsumerWorker": "None",
      "Whizbang.Core.Workers.OutboxPublishWorker": "Warning",
      "Whizbang.Transports.RabbitMQ": "Warning"
    }
  }
}
```

To temporarily re-enable a category for debugging, set it to `"Debug"`:

```json{title="Debug a Specific Category" description="Enable debug output for a single component" category="Configuration" difficulty="BEGINNER" tags=["Logging", "Debugging"]}
{
  "Logging": {
    "LogLevel": {
      "Whizbang.Initialization": "Debug"
    }
  }
}
```

## Available Categories {#categories}

### Database Initialization

| Category | Description | Default Level |
|----------|-------------|---------------|
| `Whizbang.Initialization` | Top-level database initialization orchestration — schema creation, migrations, constraints, perspective registration, and maintenance. Emits a summary line at `Information` with elapsed time and migration count; all step-level detail is at `Debug`. | Information |
| `Whizbang.Startup` | Startup banner and one-time process identity output (`WhizbangStartupLog`). Suppress the banner via the `Whizbang:ShowBanner` configuration key instead of the log level if you only want the ASCII art gone. | Information |

### Dispatcher

| Category | Description | Default Level |
|----------|-------------|---------------|
| `Whizbang.Core.Dispatcher` | Dispatcher tag processing diagnostics — logs entry/exit of `_processTagsIfEnabledAsync` and tag processing mode decisions. | Debug |
| `Whizbang.Core.Dispatcher.Cascade` | Event cascade tracing — logs when dispatched events trigger cascaded handler invocations. | Debug |

### Workers

| Category | Description | Default Level |
|----------|-------------|---------------|
| `Whizbang.Core.Workers.PerspectiveWorker` | Perspective batch processing diagnostics — logs work item counts, stream/perspective grouping, and empty-batch warnings. | Debug |
| `Whizbang.Core.Workers.OutboxPublishWorker` | Outbox publish worker — startup/shutdown summary at `Information`; publish failures, DLQ promotions, and missing-transport conditions at `Warning`. | Information |
| `Whizbang.Core.Workers.ClaimWorker` | Work-claim poller — startup/shutdown and NOTIFY-gate reconnects at `Information`; tick failures and heartbeat problems at `Warning`. | Information |
| `Whizbang.Core.Workers.TransportConsumerWorker` | Transport consumer startup and subscription management. Logs a one-line summary at `Information` on start; per-destination and per-subscription detail at `Debug`. | Information |
| `Whizbang.Core.Workers.InboxDrainWorker` | Inbox drain: turns claimed stream ids into queued inbox rows. Working-set budget hand-backs at `Information`; drain and hand-back failures at `Warning`. See [Inbox pipeline events](#inbox-pipeline-events). | Information |
| `Whizbang.Core.Workers.InboxDispatchWorker` | Inbox dispatch and its lease keeper: dispatch failures, lease renewal failures, lapsed held rows and control-plane drops at `Warning`; skipped duplicate copies at `Debug`. | Information |
| `Whizbang.Core.Workers.InboxHandlerWorker` | Batched inbox commits: each failed commit (first five per flush, then a summary) at `Warning`. | Information |

### Transport

| Category | Description | Default Level |
|----------|-------------|---------------|
| `Whizbang.Transports.RabbitMQ` | Parent category for all RabbitMQ transport logging. Set to `Warning` to silence startup chatter while retaining error visibility. | Information |
| `Whizbang.Transports.RabbitMQ.RabbitMQTransport` | RabbitMQ connection lifecycle and per-subscription creation detail. | Debug |
| `Whizbang.Transports.RabbitMQ.RabbitMQConnectionRetry` | RabbitMQ connection establishment and retry attempts. | Information |
| `Whizbang.Transports.RabbitMQ.RabbitMQInfrastructureProvisioner` | RabbitMQ exchange and queue provisioning for owned domains. | Debug |

### Messaging

| Category | Description | Default Level |
|----------|-------------|---------------|
| `Whizbang.Core.Messaging.ReceptorInvoker` | Receptor invocation — logs handler resolution and execution. | Debug |
| `Whizbang.Core.Messaging.ScopedWorkCoordinatorStrategy` | Scoped work coordinator — logs batch processing within DI scopes. | Information |
| `Whizbang.Core.Messaging.ImmediateWorkCoordinatorStrategy` | Immediate work coordinator — logs direct dispatch processing. | Information |
| `Whizbang.Core.Messaging.IntervalWorkCoordinatorStrategy` | Interval work coordinator — logs timer-based batch processing. | Information |

### Tags & Security

| Category | Description | Default Level |
|----------|-------------|---------------|
| `Whizbang.Core.Tags.MessageTagProcessor` | Message tag processing — logs tag evaluation and notification dispatch. Can be very verbose in systems with tagged notifications. | Information |
| `Whizbang.Core.Security.SecurityContextHelper` | Security context propagation — logs JWT extraction and tenant resolution. | Information |
| `Whizbang.Core.Dispatch.DispatcherSecurityBuilder` | Security builder — logs security policy resolution during dispatch. | Debug |

### Perspectives

| Category | Description | Default Level |
|----------|-------------|---------------|
| `Whizbang.Core.Perspectives.Sync.PerspectiveSyncAwaiter` | Synchronous perspective await — logs when dispatchers wait for perspective projections to complete before returning. | Information |

### Tracing

| Category | Description | Default Level |
|----------|-------------|---------------|
| `Whizbang.Core.Tracing.Tracer` | Structured trace output — controlled separately via `TracingOptions`. See [Tracing](tracing) for configuration. | Information |

## Receptor Firing Diagnostics {#receptor-firing-diagnostics}

The receptor invoker logs each firing under `Whizbang.Core.Messaging.ReceptorInvoker`. See
[Exactly-once firing](../../fundamentals/receptors/exactly-once-firing.md) for the guarantee the entries
describe.

| EventId | Name | Level | When |
|---|---|---|---|
| 16 | `ReceptorFiring` | Debug | Immediately before a receptor is dispatched. |
| 17 | `ReceptorFired` | Debug | After it returns, from a `finally`, so a failure is still reported. |
| 18 | `ReceptorAlreadyFiredSkip` | Warning | The double-fire guardrail caught a duplicate. A healthy system logs none. |

Warnings reach the default `Information` level, so `ReceptorAlreadyFiredSkip` is visible without any change. To
trace every firing while you investigate, lower just this category:

```json{title="Tracing receptor firings" description="Lower only the receptor invoker's category to Debug" category="Configuration" difficulty="BEGINNER" tags=["Logging", "Receptors", "Diagnostics"]}
{
  "Logging": {
    "LogLevel": {
      "Whizbang.Core.Messaging.ReceptorInvoker": "Debug"
    }
  }
}
```

## Inbox Pipeline Events {#inbox-pipeline-events}

The inbox drain, dispatch and commit workers log the events below about the rows a process holds and
the commits it makes. See [Per-stream drain](../../fundamentals/work-coordinator/per-stream-drain#working-set-budget),
[Inbox dispatch](../../fundamentals/work-coordinator/inbox-dispatch#held-rows) and
[Handler commit](../../fundamentals/work-coordinator/handler-commit#commit-failures-logged) for what each
means.

| Category | EventId | Level | When |
|---|---|---|---|
| `InboxDrainWorker` | 62 | Information | The working set is full; fetched rows were handed back uncharged. |
| `InboxDrainWorker` | 63 | Warning | Handing back rows the working-set budget turned away failed. |
| `InboxDispatchWorker` | 11 | Warning | A control-plane message was dropped at the attempt bound; carries its last cause and last error. See [control-plane drops](../dead-letter-queue/internal-dlq#control-plane-drops). |
| `InboxDispatchWorker` | 78 | Warning | Renewing the leases of held rows failed. |
| `InboxDispatchWorker` | 79 | Warning | A held row used every lease renewal it is allowed in its state. |
| `InboxDispatchWorker` | 80 | Warning | Summary of lapses in one keeper pass beyond the first five. |
| `InboxDispatchWorker` | 81 | Warning | Handing back never-dispatched rows whose renewals ran out failed. |
| `InboxDispatchWorker` | 82 | Debug | A duplicate copy of a row, or a copy of a row no longer held, was skipped. |
| `InboxHandlerWorker` | 26 | Warning | A row's commit failed; carries the message id, type and error. |
| `InboxHandlerWorker` | 27 | Warning | Summary of commit failures in one flush beyond the first five. |
| `InboxHandlerWorker` | 28 | Warning | A commit failure names no request in the flush. |

Categories are prefixed `Whizbang.Core.Workers.`. Every Warning above reaches the default `Information` level.
{verified: InboxDrainWorkerGapTests.HandingBackFails_IsLoggedWithWhatItCostsAsync, InboxDispatchWorkerHeldLeaseTests.Keeper_ManyLapsesInOneSweep_LogTheFirstIndividually_ThenASummaryAsync, InboxDispatchWorkerControlPlaneDropLogTests.Drop_WithARecordedFailure_LogsTheErrorAndNamesItAsARecordedFailureAsync, InboxHandlerWorkerTests.ManyCommitFailuresInOneFlush_LogTheFirstIndividually_ThenOneSummaryOfTheRestAsync}

## Hierarchical Filtering {#hierarchy}

.NET logging categories are hierarchical. Setting a parent category affects all children:

```json{title="Silence All Whizbang Logging" description="Use hierarchical filtering to silence everything at once" category="Configuration" difficulty="INTERMEDIATE" tags=["Logging", "Configuration"]}
{
  "Logging": {
    "LogLevel": {
      "Whizbang": "Warning"
    }
  }
}
```

This sets **all** categories starting with `Whizbang` to `Warning`, including `Whizbang.Initialization`, `Whizbang.Core.Dispatcher`, `Whizbang.Transports.RabbitMQ`, etc. You can then selectively re-enable specific categories:

```json{title="Silence All, Enable One" description="Hierarchical filter with selective override" category="Configuration" difficulty="INTERMEDIATE" tags=["Logging", "Configuration"]}
{
  "Logging": {
    "LogLevel": {
      "Whizbang": "None",
      "Whizbang.Initialization": "Information"
    }
  }
}
```

## Log Levels Reference {#levels}

| Level | Use |
|-------|-----|
| `Trace` | Hot-path per-message breadcrumbs (e.g. `ImmediateWorkCoordinatorStrategy` dispatch steps) — off unless explicitly enabled |
| `Debug` | Step-level detail (individual migrations, SQL operations, batch grouping, per-subscription info) |
| `Information` | Summaries and milestones (initialization complete, worker started, batch sizes) |
| `Warning` | Recoverable issues (schema drift, failed maintenance, connection retries) |
| `Error` | Failures that abort an operation (migration failure, SQL errors) |
| `None` | Completely silent |

## Recommended Development Configuration {#recommended}

A good starting point for local development that keeps the console readable:

```json{title="Recommended Development Overrides" description="Balanced configuration for local development" category="Configuration" difficulty="BEGINNER" tags=["Logging", "Configuration", "Development"]}
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning",
      "Microsoft.EntityFrameworkCore.Database.Command": "Warning",
      "Npgsql": "Warning",
      "Whizbang.Initialization": "None",
      "Whizbang.Core.Dispatcher": "None",
      "Whizbang.Core.Workers.PerspectiveWorker": "None",
      "Whizbang.Core.Workers.TransportConsumerWorker": "None",
      "Whizbang.Core.Workers.OutboxPublishWorker": "Warning",
      "Whizbang.Core.Tags.MessageTagProcessor": "None",
      "Whizbang.Transports.RabbitMQ": "Warning"
    }
  }
}
```
