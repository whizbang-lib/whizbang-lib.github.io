---
title: "Metrics Overview"
version: 0.3.0
category: Observability
order: 1
description: "OpenTelemetry-compatible metrics for monitoring Whizbang applications with 44 built-in instruments"
tags: metrics, observability, opentelemetry, monitoring, counters, histograms
codeReferences:
  - src/Whizbang.Core/Tracing/WhizbangMetrics.cs
---

# Metrics Overview

**WhizbangMetrics** provides a comprehensive set of OpenTelemetry-compatible metrics instruments for monitoring your event-driven applications. All metrics are exposed through the standard `System.Diagnostics.Metrics` API, compatible with .NET Aspire, Azure Monitor, Prometheus, and other observability backends.

## Quick Start

```csharp
// Enable metrics with specific components
services.AddWhizbang(options => {
  options.Metrics.Enabled = true;
  options.Metrics.Components = MetricComponents.Handlers
                             | MetricComponents.EventStore
                             | MetricComponents.Errors;
});

// OpenTelemetry integration
services.AddOpenTelemetry()
  .WithMetrics(builder => builder
    .AddMeter("Whizbang"));
```

---

## Core Concepts

### The Whizbang Meter

All Whizbang metrics are published through a single meter named `"Whizbang"`:

```csharp
public static class WhizbangMetrics {
  public const string METER_NAME = "Whizbang";
  private static readonly Meter _meter = new(METER_NAME);
}
```

Subscribe to this meter in your observability backend to collect all Whizbang metrics.

### Component-Based Filtering

Metrics are organized by system component. Enable only what you need to minimize overhead:

| Component | What it tracks |
|-----------|----------------|
| `Handlers` | Handler invocations, duration, success/failure |
| `Dispatcher` | Message dispatch, receptor discovery |
| `Messages` | Messages dispatched and received |
| `Events` | Events stored and published |
| `Outbox` | Outbox writes, pending count, delivery latency |
| `Inbox` | Inbox received, pending, duplicates |
| `EventStore` | Read/write operations, latency |
| `Lifecycle` | Lifecycle stage transitions |
| `Perspectives` | Projection updates, lag |
| `Workers` | Background worker iterations |
| `Errors` | System errors and exceptions |
| `Policies` | Circuit breakers, retries |

See [Metric Components](components.md) for details.

---

## Metric Instruments

Whizbang provides 44 metric instruments across all components:

### Handler Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `whizbang.handler.invocations` | Counter | Total handler invocations |
| `whizbang.handler.successes` | Counter | Successful completions |
| `whizbang.handler.failures` | Counter | Failed executions |
| `whizbang.handler.early_returns` | Counter | Early returns (no action taken) |
| `whizbang.handler.duration` | Histogram | Execution duration in ms |
| `whizbang.handler.active` | UpDownCounter | Currently executing handlers |

### Dispatcher Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `whizbang.dispatch.total` | Counter | Total dispatches |
| `whizbang.dispatch.duration` | Histogram | Dispatch duration |
| `whizbang.receptor.discovered` | Counter | Receptors discovered per message |

### Message Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `whizbang.messages.dispatched` | Counter | Messages dispatched |
| `whizbang.messages.received` | Counter | Messages received |
| `whizbang.messages.processing_time` | Histogram | Message processing duration |

### Event Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `whizbang.events.stored` | Counter | Events written to store |
| `whizbang.events.published` | Counter | Events published |

### Outbox Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `whizbang.outbox.writes` | Counter | Outbox write operations |
| `whizbang.outbox.pending` | UpDownCounter | Messages awaiting delivery |
| `whizbang.outbox.batch_size` | Histogram | Batch sizes |
| `whizbang.outbox.delivery_latency` | Histogram | Time to delivery |

### Inbox Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `whizbang.inbox.received` | Counter | Messages received |
| `whizbang.inbox.pending` | UpDownCounter | Messages awaiting processing |
| `whizbang.inbox.batch_size` | Histogram | Batch sizes |
| `whizbang.inbox.processing_time` | Histogram | Processing duration |
| `whizbang.inbox.duplicates` | Counter | Duplicate messages detected |

### EventStore Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `whizbang.eventstore.appends` | Counter | Append operations |
| `whizbang.eventstore.reads` | Counter | Read operations |
| `whizbang.eventstore.events_per_append` | Histogram | Events per append |
| `whizbang.eventstore.read_latency` | Histogram | Read operation duration |
| `whizbang.eventstore.write_latency` | Histogram | Write operation duration |

### Lifecycle Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `whizbang.lifecycle.invocations` | Counter | Lifecycle stage invocations |
| `whizbang.lifecycle.duration` | Histogram | Stage execution duration |
| `whizbang.lifecycle.skipped` | Counter | Skipped stages |

### Perspective Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `whizbang.perspective.updates` | Counter | Projection updates |
| `whizbang.perspective.duration` | Histogram | Update duration |
| `whizbang.perspective.lag` | Histogram | Event processing lag |
| `whizbang.perspective.errors` | Counter | Projection errors |

### Worker Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `whizbang.worker.iterations` | Counter | Worker loop iterations |
| `whizbang.worker.idle_time` | Histogram | Time spent idle |
| `whizbang.worker.active` | UpDownCounter | Active workers |
| `whizbang.worker.errors` | Counter | Worker errors |

### Error Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `whizbang.errors.total` | Counter | Total errors |
| `whizbang.errors.unhandled` | Counter | Unhandled exceptions |

### Policy Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `whizbang.policy.circuit_breaks` | Counter | Circuit breaker activations |
| `whizbang.policy.retries` | Counter | Retry attempts |

### Security Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `whizbang.security.context_propagations` | Counter | Security context propagations |
| `whizbang.security.missing_context` | Counter | Missing security context |

### Tag Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `whizbang.tags.processed` | Counter | Tags processed |
| `whizbang.tags.duration` | Histogram | Tag processing duration |
| `whizbang.tags.errors` | Counter | Tag processing errors |

---

## Tags and Dimensions

Metrics include tags for filtering and grouping:

```csharp
// Handler metrics include:
// - handler: Handler type name
// - message_type: Message type name
// - status: Success, Failed, EarlyReturn, Cancelled

// Configuration controls tag cardinality
options.Metrics.IncludeHandlerNameTag = true;   // default: true
options.Metrics.IncludeMessageTypeTag = true;   // default: true
```

**Warning**: High-cardinality tags (many unique values) can increase storage costs. Disable handler/message tags in high-traffic production environments if needed.

---

## Integration Examples

### .NET Aspire

```csharp
// AppHost
var builder = DistributedApplication.CreateBuilder(args);
builder.AddOpenTelemetry()
  .WithMetricsExporter();
```

### Azure Monitor

```csharp
services.AddOpenTelemetry()
  .WithMetrics(builder => builder
    .AddMeter("Whizbang")
    .AddAzureMonitorMetricExporter());
```

### Prometheus

```csharp
services.AddOpenTelemetry()
  .WithMetrics(builder => builder
    .AddMeter("Whizbang")
    .AddPrometheusExporter());
```

---

## Further Reading

- [Metric Components](components.md) - Component-based filtering
- [Metrics Configuration](configuration.md) - Full configuration options
- [Handler Metrics](handlers.md) - Detailed handler instrumentation

---

*Version 0.3.0 - Draft | Last Updated: 2026-02-27*
