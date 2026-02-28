---
title: "Metrics Configuration"
version: 0.3.0
category: Observability
order: 3
description: "Runtime configuration for Whizbang metrics including component filtering and tag control"
tags: metrics, configuration, observability, options, runtime
codeReferences:
  - src/Whizbang.Core/Tracing/MetricsOptions.cs
---

# Metrics Configuration

**MetricsOptions** provides runtime configuration for the Whizbang metrics system. Configure which components emit metrics, control tag cardinality, and customize histogram buckets.

## Quick Start

```csharp
services.AddWhizbang(options => {
  options.Metrics.Enabled = true;
  options.Metrics.Components = MetricComponents.Handlers | MetricComponents.Errors;
});
```

---

## MetricsOptions Class

```csharp
namespace Whizbang.Core.Tracing;

/// <summary>
/// Configuration options for the Whizbang metrics system.
/// </summary>
public sealed class MetricsOptions {
  /// <summary>Master switch for metrics collection.</summary>
  public bool Enabled { get; set; } = false;

  /// <summary>Which components emit metrics.</summary>
  public MetricComponents Components { get; set; } = MetricComponents.None;

  /// <summary>Meter name for OpenTelemetry integration.</summary>
  public string MeterName { get; set; } = "Whizbang";

  /// <summary>Meter version. Null uses assembly version.</summary>
  public string? MeterVersion { get; set; }

  /// <summary>Include handler name as a tag. Disable for high cardinality.</summary>
  public bool IncludeHandlerNameTag { get; set; } = true;

  /// <summary>Include message type as a tag. Disable for high cardinality.</summary>
  public bool IncludeMessageTypeTag { get; set; } = true;

  /// <summary>Histogram bucket boundaries for duration metrics (ms).</summary>
  public double[] DurationBuckets { get; set; } = [
    1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000
  ];

  /// <summary>Check if a specific component is enabled.</summary>
  public bool IsEnabled(MetricComponents component) {
    return Enabled && Components.HasFlag(component);
  }
}
```

---

## Configuration Options

### Enabled

Master switch for all metrics collection.

```csharp
options.Metrics.Enabled = true;  // Enable metrics
options.Metrics.Enabled = false; // Disable all metrics (default)
```

**Default**: `false` - Metrics are opt-in for production safety.

### Components

Which system components emit metrics. See [Metric Components](components.md) for details.

```csharp
// Enable specific components
options.Metrics.Components = MetricComponents.Handlers
                           | MetricComponents.EventStore
                           | MetricComponents.Errors;

// Enable all components (development only)
options.Metrics.Components = MetricComponents.All;
```

**Default**: `MetricComponents.None`

### MeterName

The meter name for OpenTelemetry integration.

```csharp
options.Metrics.MeterName = "Whizbang";       // default
options.Metrics.MeterName = "MyApp.Whizbang"; // custom prefix
```

**Default**: `"Whizbang"`

### MeterVersion

Optional meter version. When null, uses the assembly version.

```csharp
options.Metrics.MeterVersion = null;     // use assembly version (default)
options.Metrics.MeterVersion = "1.0.0";  // explicit version
```

**Default**: `null`

### IncludeHandlerNameTag

Whether to include handler name as a metric tag.

```csharp
options.Metrics.IncludeHandlerNameTag = true;  // include handler tag (default)
options.Metrics.IncludeHandlerNameTag = false; // omit for high cardinality
```

**Default**: `true`

**Warning**: With many handlers, this creates high-cardinality metrics which can increase storage costs. Disable in high-traffic production environments.

### IncludeMessageTypeTag

Whether to include message type as a metric tag.

```csharp
options.Metrics.IncludeMessageTypeTag = true;  // include message_type tag (default)
options.Metrics.IncludeMessageTypeTag = false; // omit for high cardinality
```

**Default**: `true`

**Warning**: With many message types, this creates high-cardinality metrics.

### DurationBuckets

Histogram bucket boundaries for duration metrics (in milliseconds).

```csharp
// Default buckets optimized for typical handler durations
options.Metrics.DurationBuckets = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

// Custom buckets for fast operations
options.Metrics.DurationBuckets = [0.1, 0.5, 1, 5, 10, 50, 100];

// Custom buckets for slow operations
options.Metrics.DurationBuckets = [100, 500, 1000, 5000, 10000, 30000, 60000];
```

**Default**: `[1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]`

---

## Configuration via appsettings.json

```json
{
  "Whizbang": {
    "Metrics": {
      "Enabled": true,
      "Components": ["Handlers", "EventStore", "Errors"],
      "MeterName": "Whizbang",
      "MeterVersion": null,
      "IncludeHandlerNameTag": true,
      "IncludeMessageTypeTag": true,
      "DurationBuckets": [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
    }
  }
}
```

---

## IsEnabled Method

Use `IsEnabled()` to check if a component should emit metrics:

```csharp
if (options.IsEnabled(MetricComponents.Handlers)) {
  // Record handler metrics
  WhizbangMetrics.HandlerInvocations.Add(1, tags);
}
```

The method returns `false` if:
- `Enabled` is `false` (master switch off)
- The component flag is not set in `Components`

---

## Environment-Specific Configuration

### Development

Full visibility for debugging:

```csharp
if (env.IsDevelopment()) {
  options.Metrics.Enabled = true;
  options.Metrics.Components = MetricComponents.All;
}
```

### Staging

Key components for pre-production testing:

```csharp
if (env.IsStaging()) {
  options.Metrics.Enabled = true;
  options.Metrics.Components = MetricComponents.Handlers
                             | MetricComponents.EventStore
                             | MetricComponents.Errors
                             | MetricComponents.Workers;
}
```

### Production

Minimal overhead with critical monitoring:

```csharp
if (env.IsProduction()) {
  options.Metrics.Enabled = true;
  options.Metrics.Components = MetricComponents.Handlers
                             | MetricComponents.Errors
                             | MetricComponents.Policies;
  options.Metrics.IncludeHandlerNameTag = false;
  options.Metrics.IncludeMessageTypeTag = false;
}
```

---

## High-Cardinality Mitigation

When you have many handlers or message types, metrics storage costs can increase significantly. Mitigate with:

```csharp
options.Metrics.Enabled = true;
options.Metrics.Components = MetricComponents.Handlers;

// Disable high-cardinality tags
options.Metrics.IncludeHandlerNameTag = false;
options.Metrics.IncludeMessageTypeTag = false;
```

This records aggregate metrics without per-handler/per-message breakdown.

---

## Runtime Configuration Updates

MetricsOptions supports `IOptionsMonitor<T>` for runtime configuration changes:

```csharp
public class HandlerMetrics : IHandlerMetrics {
  private readonly IOptionsMonitor<MetricsOptions> _options;

  public HandlerMetrics(IOptionsMonitor<MetricsOptions> options) {
    _options = options;
  }

  public void RecordInvocation(...) {
    // Reads current configuration on each call
    if (!_options.CurrentValue.IsEnabled(MetricComponents.Handlers)) {
      return;
    }
    // Record metrics...
  }
}
```

Changes to `appsettings.json` take effect without restart.

---

## Best Practices

### DO

- Start with `Enabled = false` in production defaults
- Use environment-specific configuration
- Disable high-cardinality tags in high-traffic systems
- Monitor metrics storage costs

### DON'T

- Enable `All` components in production
- Forget to check `IsEnabled()` before recording
- Use default configuration in all environments
- Assume metrics have zero overhead

---

## Further Reading

- [Metrics Overview](overview.md) - All available metrics
- [Metric Components](components.md) - Component details
- [Handler Metrics](handlers.md) - Handler instrumentation

---

*Version 0.3.0 - Draft | Last Updated: 2026-02-27*
