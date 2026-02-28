---
title: "Custom Trace Outputs"
version: 0.3.0
category: Observability
order: 5
description: "Implement ITraceOutput to create custom trace destinations beyond ILogger and OpenTelemetry"
tags: tracing, observability, custom, extensibility, output, opentelemetry, logging
codeReferences:
  - src/Whizbang.Core/Tracing/ITraceOutput.cs
  - src/Whizbang.Core/Tracing/TraceContext.cs
---

# Custom Trace Outputs

**ITraceOutput** is the abstraction for trace output destinations. Whizbang includes built-in outputs for ILogger and OpenTelemetry, but you can implement custom outputs for any destination.

## Core Concept

The tracing system separates **what** gets traced from **where** it goes:

- **Tracer** (ITracer): Determines what to trace based on configuration
- **Outputs** (ITraceOutput): Writes traces to destinations

Multiple outputs can be registered, and all receive trace events simultaneously.

---

## ITraceOutput Interface

```csharp
namespace Whizbang.Core.Tracing;

/// <summary>
/// Abstraction for trace output destinations.
/// </summary>
public interface ITraceOutput {
  /// <summary>
  /// Called when a trace operation begins.
  /// </summary>
  /// <param name="context">Context containing trace metadata.</param>
  void BeginTrace(TraceContext context);

  /// <summary>
  /// Called when a trace operation ends.
  /// </summary>
  /// <param name="context">Context containing trace metadata.</param>
  /// <param name="result">Result of the traced operation.</param>
  void EndTrace(TraceContext context, TraceResult result);
}
```

---

## TraceContext

Contains all metadata about a traced operation:

```csharp
namespace Whizbang.Core.Tracing;

/// <summary>
/// Context for a trace operation.
/// </summary>
public sealed class TraceContext {
  /// <summary>Message ID from envelope.</summary>
  public required Guid MessageId { get; init; }

  /// <summary>Correlation ID for distributed tracing.</summary>
  public required string CorrelationId { get; init; }

  /// <summary>Causation ID for event chain tracking.</summary>
  public string? CausationId { get; init; }

  /// <summary>Type name of the message being traced.</summary>
  public required string MessageType { get; init; }

  /// <summary>Handler name (null for message-level traces).</summary>
  public string? HandlerName { get; init; }

  /// <summary>Component being traced.</summary>
  public required TraceComponents Component { get; init; }

  /// <summary>Verbosity level for this trace.</summary>
  public required TraceVerbosity Verbosity { get; init; }

  /// <summary>Whether this is an explicit trace (attribute or config).</summary>
  public bool IsExplicit { get; init; }

  /// <summary>Source of explicit trace (attribute, config, or null).</summary>
  public string? ExplicitSource { get; init; }

  /// <summary>Hop count from envelope.</summary>
  public int HopCount { get; init; }

  /// <summary>Timestamp when trace began.</summary>
  public DateTimeOffset StartTime { get; init; }

  /// <summary>Custom properties for extensibility.</summary>
  public Dictionary<string, object?> Properties { get; } = new();
}
```

---

## TraceResult

Contains the outcome of a traced operation:

```csharp
namespace Whizbang.Core.Tracing;

/// <summary>
/// Result of a traced operation.
/// </summary>
public sealed class TraceResult {
  /// <summary>Whether the operation succeeded.</summary>
  public required bool Success { get; init; }

  /// <summary>Duration of the operation.</summary>
  public required TimeSpan Duration { get; init; }

  /// <summary>Exception if the operation failed.</summary>
  public Exception? Exception { get; init; }

  /// <summary>Result status (e.g., "Completed", "EarlyReturn", "Failed").</summary>
  public required string Status { get; init; }

  /// <summary>Custom properties for extensibility.</summary>
  public Dictionary<string, object?> Properties { get; } = new();
}
```

---

## Built-in Outputs

### LoggerTraceOutput

Writes structured logs via ILogger:

```csharp
public class LoggerTraceOutput : ITraceOutput {
  private readonly ILogger<LoggerTraceOutput> _logger;

  public void BeginTrace(TraceContext context) {
    var level = context.IsExplicit ? LogLevel.Information : LogLevel.Debug;
    var prefix = context.IsExplicit ? "[TRACE]" : "[trace]";

    _logger.Log(level, "{Prefix} {Component}: {MessageType} started",
        prefix, context.Component, context.MessageType);
  }

  public void EndTrace(TraceContext context, TraceResult result) {
    // ...
  }
}
```

### OpenTelemetryTraceOutput

Emits spans via System.Diagnostics.ActivitySource:

```csharp
public class OpenTelemetryTraceOutput : ITraceOutput {
  private static readonly ActivitySource _activitySource = new("Whizbang.Tracing");
  private readonly ConcurrentDictionary<Guid, Activity> _activities = new();

  public void BeginTrace(TraceContext context) {
    var activity = _activitySource.StartActivity(
        $"{context.Component}.{context.MessageType}",
        ActivityKind.Internal);

    if (activity != null) {
      activity.SetTag("whizbang.message.id", context.MessageId);
      activity.SetTag("whizbang.correlation_id", context.CorrelationId);
      activity.SetTag("whizbang.trace.explicit", context.IsExplicit);
      _activities[context.MessageId] = activity;
    }
  }

  public void EndTrace(TraceContext context, TraceResult result) {
    if (_activities.TryRemove(context.MessageId, out var activity)) {
      activity.SetTag("whizbang.duration_ms", result.Duration.TotalMilliseconds);
      activity.SetTag("whizbang.status", result.Status);
      activity.SetStatus(result.Success ? ActivityStatusCode.Ok : ActivityStatusCode.Error);
      activity.Dispose();
    }
  }
}
```

---

## Creating Custom Outputs

### Example: Console Output

```csharp
public class ConsoleTraceOutput : ITraceOutput {
  public void BeginTrace(TraceContext context) {
    Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] BEGIN: {context.MessageType}");
  }

  public void EndTrace(TraceContext context, TraceResult result) {
    var status = result.Success ? "OK" : "FAIL";
    Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] END: {context.MessageType} ({status}, {result.Duration.TotalMilliseconds:F2}ms)");
  }
}
```

### Example: Metrics Output

```csharp
public class MetricsTraceOutput : ITraceOutput {
  private readonly IMeterFactory _meterFactory;
  private readonly Counter<long> _traceCount;
  private readonly Histogram<double> _traceDuration;

  public MetricsTraceOutput(IMeterFactory meterFactory) {
    var meter = meterFactory.Create("Whizbang.Tracing");
    _traceCount = meter.CreateCounter<long>("whizbang.traces.count");
    _traceDuration = meter.CreateHistogram<double>("whizbang.traces.duration");
  }

  public void BeginTrace(TraceContext context) {
    // Nothing on begin
  }

  public void EndTrace(TraceContext context, TraceResult result) {
    var tags = new TagList {
      { "component", context.Component.ToString() },
      { "message_type", context.MessageType },
      { "success", result.Success }
    };

    _traceCount.Add(1, tags);
    _traceDuration.Record(result.Duration.TotalMilliseconds, tags);
  }
}
```

---

## Registration

Register outputs during startup:

```csharp
services.AddWhizbang(options => {
  options.Tracing.Verbosity = TraceVerbosity.Normal;
});

// Register built-in outputs
services.AddSingleton<ITraceOutput, LoggerTraceOutput>();
services.AddSingleton<ITraceOutput, OpenTelemetryTraceOutput>();

// Register custom output
services.AddSingleton<ITraceOutput, MetricsTraceOutput>();
```

All registered outputs receive trace events simultaneously.

---

## Best Practices

### DO

- Keep `BeginTrace` and `EndTrace` fast (avoid blocking I/O)
- Use `TraceContext.Properties` for custom data
- Thread-safe implementations (traces can be concurrent)
- Clean up resources (e.g., Activity disposal)

### DON'T

- Throw exceptions from outputs (will be logged and swallowed)
- Block on async operations in outputs
- Modify `TraceContext` or `TraceResult` (they're shared)
- Forget to register outputs with DI

---

## Further Reading

- [Tracing Configuration](configuration.md) - Enable/disable outputs
- [Trace Verbosity](verbosity-levels.md) - Control detail level
- [Aspire Integration](aspire-integration.md) - View traces in Aspire dashboard

---

*Version 0.3.0 - Draft | Last Updated: 2026-02-27*
