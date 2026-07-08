---
title: Logging Categories
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
  - src/Whizbang.Core/Workers/WorkCoordinatorPublisherWorker.cs
  - src/Whizbang.Core/Tags/MessageTagProcessor.cs
  - src/Whizbang.Data.EFCore.Postgres/WhizbangHostExtensions.cs
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
      "Whizbang.Core.Workers.WorkCoordinatorPublisherWorker": "None",
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

### Dispatcher

| Category | Description | Default Level |
|----------|-------------|---------------|
| `Whizbang.Core.Dispatcher` | Dispatcher tag processing diagnostics — logs entry/exit of `_processTagsIfEnabledAsync` and tag processing mode decisions. | Debug |
| `Whizbang.Core.Dispatcher.Cascade` | Event cascade tracing — logs when dispatched events trigger cascaded handler invocations. | Debug |

### Workers

| Category | Description | Default Level |
|----------|-------------|---------------|
| `Whizbang.Core.Workers.PerspectiveWorker` | Perspective batch processing diagnostics — logs work item counts, stream/perspective grouping, and empty-batch warnings. | Debug |
| `Whizbang.Core.Workers.WorkCoordinatorPublisherWorker` | Outbox/inbox publisher worker — logs batch publish cycle results (messages published, claimed, failed). Fires every polling interval (~1s) when there is activity. Summary at `Information` on startup/shutdown; per-cycle batch results at `Debug`. | Debug |
| `Whizbang.Core.Workers.TransportConsumerWorker` | Transport consumer startup and subscription management. Logs a one-line summary at `Information` on start; per-destination and per-subscription detail at `Debug`. | Information |

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
| `Trace` | Not used by Whizbang |
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
      "Whizbang.Core.Workers.WorkCoordinatorPublisherWorker": "None",
      "Whizbang.Core.Tags.MessageTagProcessor": "None",
      "Whizbang.Transports.RabbitMQ": "Warning"
    }
  }
}
```
