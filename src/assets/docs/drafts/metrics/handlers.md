---
title: "Handler Metrics"
version: 0.3.0
category: Observability
order: 4
description: "Instrumentation for tracking handler invocations, duration, and outcomes"
tags: metrics, handlers, observability, instrumentation, performance
codeReferences:
  - src/Whizbang.Core/Tracing/HandlerMetrics.cs
  - src/Whizbang.Core/Tracing/IHandlerMetrics.cs
---

# Handler Metrics

**HandlerMetrics** provides instrumentation for tracking handler invocations, execution duration, and outcomes. It integrates with OpenTelemetry-compatible observability backends.

## IHandlerMetrics Interface

```csharp
namespace Whizbang.Core.Tracing;

/// <summary>
/// Interface for recording handler invocation metrics.
/// </summary>
public interface IHandlerMetrics {
  /// <summary>
  /// Records metrics for a handler invocation.
  /// </summary>
  void RecordInvocation(
    string handlerName,
    string messageTypeName,
    HandlerStatus status,
    double durationMs,
    long startTimestamp,
    long endTimestamp);
}
```

---

## HandlerStatus Enum

```csharp
/// <summary>
/// Outcome status for a handler invocation.
/// </summary>
public enum HandlerStatus {
  /// <summary>Handler completed successfully.</summary>
  Success,

  /// <summary>Handler threw an exception.</summary>
  Failed,

  /// <summary>Handler returned early without action.</summary>
  EarlyReturn,

  /// <summary>Handler was cancelled via CancellationToken.</summary>
  Cancelled
}
```

---

## Usage

Handler metrics are automatically recorded by the generated dispatcher code. You can also record metrics manually:

```csharp
public class MyWorker {
  private readonly IHandlerMetrics _metrics;

  public MyWorker(IHandlerMetrics metrics) {
    _metrics = metrics;
  }

  public async Task ProcessAsync() {
    var startTimestamp = Stopwatch.GetTimestamp();
    var status = HandlerStatus.Success;

    try {
      await DoWorkAsync();
    } catch {
      status = HandlerStatus.Failed;
      throw;
    } finally {
      var endTimestamp = Stopwatch.GetTimestamp();
      var elapsed = Stopwatch.GetElapsedTime(startTimestamp, endTimestamp);

      _metrics.RecordInvocation(
        handlerName: nameof(MyWorker),
        messageTypeName: "CustomMessage",
        status: status,
        durationMs: elapsed.TotalMilliseconds,
        startTimestamp: startTimestamp,
        endTimestamp: endTimestamp);
    }
  }
}
```

---

## Recorded Metrics

When enabled, `HandlerMetrics` records:

| Metric | Type | Description |
|--------|------|-------------|
| `whizbang.handler.invocations` | Counter | Total handler invocations |
| `whizbang.handler.successes` | Counter | Successful completions |
| `whizbang.handler.failures` | Counter | Failed executions |
| `whizbang.handler.early_returns` | Counter | Early returns |
| `whizbang.handler.duration` | Histogram | Execution duration in ms |
| `whizbang.handler.active` | UpDownCounter | Currently executing |

### Tags

Each metric includes tags for filtering:

| Tag | Description | Configurable |
|-----|-------------|--------------|
| `handler` | Handler type name | `IncludeHandlerNameTag` |
| `message_type` | Message type name | `IncludeMessageTypeTag` |
| `status` | Outcome status | Always included |

---

## NullHandlerMetrics

A no-op implementation for when metrics are disabled:

```csharp
/// <summary>
/// Null object pattern implementation that does nothing.
/// </summary>
public sealed class NullHandlerMetrics : IHandlerMetrics {
  public static readonly NullHandlerMetrics Instance = new();

  private NullHandlerMetrics() { }

  public void RecordInvocation(
    string handlerName,
    string messageTypeName,
    HandlerStatus status,
    double durationMs,
    long startTimestamp,
    long endTimestamp) {
    // No-op
  }
}
```

**Use case**: When `MetricsOptions.Enabled` is `false`, the DI container provides `NullHandlerMetrics` to eliminate overhead.

---

## Configuration

Enable handler metrics via `MetricsOptions`:

```csharp
services.AddWhizbang(options => {
  options.Metrics.Enabled = true;
  options.Metrics.Components = MetricComponents.Handlers;

  // Optional: control tag cardinality
  options.Metrics.IncludeHandlerNameTag = true;
  options.Metrics.IncludeMessageTypeTag = true;
});
```

Or via appsettings.json:

```json
{
  "Whizbang": {
    "Metrics": {
      "Enabled": true,
      "Components": ["Handlers"]
    }
  }
}
```

---

## Implementation Details

### Component Checking

`HandlerMetrics` checks if the Handlers component is enabled before recording:

```csharp
public void RecordInvocation(...) {
  if (!_options.CurrentValue.IsEnabled(MetricComponents.Handlers)) {
    return; // Early return when disabled
  }

  // Record metrics...
}
```

### Tag Building

Tags are conditionally built based on configuration:

```csharp
var tags = new TagList {
  { "status", status.ToString() }
};

if (_options.CurrentValue.IncludeHandlerNameTag) {
  tags.Add("handler", handlerName);
}

if (_options.CurrentValue.IncludeMessageTypeTag) {
  tags.Add("message_type", messageTypeName);
}
```

### Status-Specific Counters

Different counters are incremented based on status:

```csharp
switch (status) {
  case HandlerStatus.Success:
    WhizbangMetrics.HandlerSuccesses.Add(1, tags);
    break;
  case HandlerStatus.Failed:
    WhizbangMetrics.HandlerFailures.Add(1, tags);
    break;
  case HandlerStatus.EarlyReturn:
    WhizbangMetrics.HandlerEarlyReturns.Add(1, tags);
    break;
}
```

---

## Integration with Generated Code

The source-generated dispatcher automatically instruments handlers:

```csharp
// Generated code (simplified)
public async Task<TResult> InvokeAsync<TMessage, TResult>(...) {
  var startTimestamp = Stopwatch.GetTimestamp();
  _handlerMetrics.RecordActive(1); // Increment active

  try {
    var result = await handler.HandleAsync(message, ct);
    RecordInvocation(HandlerStatus.Success, ...);
    return result;
  } catch (OperationCanceledException) {
    RecordInvocation(HandlerStatus.Cancelled, ...);
    throw;
  } catch {
    RecordInvocation(HandlerStatus.Failed, ...);
    throw;
  } finally {
    _handlerMetrics.RecordActive(-1); // Decrement active
  }
}
```

---

## Observability Backend Integration

### .NET Aspire

Handler metrics appear in the Aspire dashboard automatically:

```csharp
var builder = DistributedApplication.CreateBuilder(args);
builder.AddOpenTelemetry()
  .WithMetricsExporter();
```

### Grafana Dashboard Query

Example PromQL for handler success rate:

```promql
sum(rate(whizbang_handler_successes_total[5m]))
/
sum(rate(whizbang_handler_invocations_total[5m]))
```

### Azure Monitor Alert

Create alerts on handler failure rate:

```kusto
customMetrics
| where name == "whizbang.handler.failures"
| summarize sum(value) by handler, bin(timestamp, 5m)
| where sum_value > 10
```

---

## Best Practices

### DO

- Enable handler metrics for critical handlers
- Monitor failure rates and duration
- Set up alerts on high failure counts
- Track active handler count for backpressure

### DON'T

- Enable all tags in high-traffic systems
- Ignore handler duration trends
- Forget to monitor early returns (may indicate issues)
- Use metrics as the only debugging tool

---

## Further Reading

- [Metrics Overview](overview.md) - All available metrics
- [Metrics Configuration](configuration.md) - Configuration options
- [Metric Components](components.md) - Component filtering

---

*Version 0.3.0 - Draft | Last Updated: 2026-02-27*
