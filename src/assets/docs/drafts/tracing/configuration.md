---
title: "Tracing Configuration"
version: 0.3.0
category: Observability
order: 4
description: "Configure tracing via appsettings.json with runtime updates via IOptionsMonitor"
tags: tracing, observability, configuration, appsettings, options, runtime
codeReferences:
  - src/Whizbang.Core/Tracing/TracingOptions.cs
---

# Tracing Configuration

**TracingOptions** provides runtime configuration for the tracing system. Configure via `appsettings.json` with live reload support via `IOptionsMonitor<TracingOptions>`.

## Core Concept

Tracing configuration can be changed at runtime without restarting the application:

- Adjust verbosity levels
- Enable/disable component tracing
- Target specific handlers or messages by name
- Enable/disable OpenTelemetry output

---

## TracingOptions Class

```csharp
namespace Whizbang.Core.Tracing;

/// <summary>
/// Runtime configuration options for the tracing system.
/// </summary>
public sealed class TracingOptions {
  /// <summary>
  /// Global verbosity level. Default: Off.
  /// </summary>
  public TraceVerbosity Verbosity { get; set; } = TraceVerbosity.Off;

  /// <summary>
  /// Components to trace. Default: None.
  /// </summary>
  public TraceComponents Components { get; set; } = TraceComponents.None;

  /// <summary>
  /// Enable OpenTelemetry span output. Default: true.
  /// </summary>
  public bool EnableOpenTelemetry { get; set; } = true;

  /// <summary>
  /// Enable structured logging output. Default: true.
  /// </summary>
  public bool EnableStructuredLogging { get; set; } = true;

  /// <summary>
  /// Handlers to trace with specific verbosity.
  /// Supports wildcards and namespaces.
  /// </summary>
  public Dictionary<string, TraceVerbosity> TracedHandlers { get; } = [];

  /// <summary>
  /// Messages to trace with specific verbosity.
  /// Supports wildcards and namespaces.
  /// </summary>
  public Dictionary<string, TraceVerbosity> TracedMessages { get; } = [];

  /// <summary>
  /// Checks if tracing is enabled for a given component.
  /// </summary>
  public bool IsEnabled(TraceComponents component) {
    return Verbosity != TraceVerbosity.Off && Components.HasFlag(component);
  }

  /// <summary>
  /// Checks if a trace at the specified verbosity level should be emitted.
  /// </summary>
  public bool ShouldTrace(TraceVerbosity requiredVerbosity) {
    return Verbosity != TraceVerbosity.Off && Verbosity >= requiredVerbosity;
  }
}
```

---

## Configuration via appsettings.json

:::new
Configuration binding is **AOT-compatible**. Whizbang uses manual property binding instead of reflection-based `ConfigurationBinder.Bind()`.
:::

### Basic Configuration

```json
{
  "Whizbang": {
    "Tracing": {
      "Verbosity": "Normal",
      "Components": "Handlers, EventStore",
      "EnableOpenTelemetry": true,
      "EnableStructuredLogging": true
    }
  }
}
```

The `Components` value is a comma-separated string parsed as a flags enum. Use `"All"` to enable all components.

### Targeting Specific Handlers

```json
{
  "Whizbang": {
    "Tracing": {
      "Verbosity": "Minimal",
      "TracedHandlers": {
        "OrderReceptor": "Debug",
        "Payment*": "Verbose",
        "MyApp.Orders.*": "Normal"
      }
    }
  }
}
```

### Targeting Specific Messages

```json
{
  "Whizbang": {
    "Tracing": {
      "Verbosity": "Minimal",
      "TracedMessages": {
        "ReseedSystemEvent": "Debug",
        "Create*Command": "Verbose",
        "MyApp.Events.*": "Normal"
      }
    }
  }
}
```

---

## Pattern Matching

Both `TracedHandlers` and `TracedMessages` support pattern matching:

| Pattern | Matches |
|---------|---------|
| `OrderReceptor` | Exact match only |
| `Order*` | `OrderReceptor`, `OrderValidator`, `OrderProcessor` |
| `*Handler` | Any type ending with `Handler` |
| `MyApp.Orders.*` | All types in `MyApp.Orders` namespace |
| `*` | Everything (use with caution) |

### Priority

When multiple patterns match:

1. **Exact match** wins over wildcards
2. **More specific patterns** win over broader ones
3. **Last defined** wins for equal specificity

---

## Programmatic Configuration

```csharp
services.AddWhizbang(options => {
  options.Tracing.Verbosity = TraceVerbosity.Normal;
  options.Tracing.Components = TraceComponents.Handlers | TraceComponents.EventStore;
  options.Tracing.EnableOpenTelemetry = true;

  options.Tracing.TracedHandlers["PaymentHandler"] = TraceVerbosity.Debug;
  options.Tracing.TracedMessages["ReseedSystemEvent"] = TraceVerbosity.Verbose;
});
```

---

## Runtime Configuration Changes

Use `IOptionsMonitor<TracingOptions>` for live configuration updates:

```csharp
public class MyService {
  private readonly IOptionsMonitor<TracingOptions> _tracingOptions;

  public MyService(IOptionsMonitor<TracingOptions> tracingOptions) {
    _tracingOptions = tracingOptions;

    // React to configuration changes
    _tracingOptions.OnChange(newOptions => {
      Console.WriteLine($"Tracing verbosity changed to: {newOptions.Verbosity}");
    });
  }

  public void DoWork() {
    // Always get current value
    var options = _tracingOptions.CurrentValue;
    if (options.Verbosity >= TraceVerbosity.Normal) {
      // Trace
    }
  }
}
```

---

## Environment-Specific Configuration

### Development (appsettings.Development.json)

```json
{
  "Whizbang": {
    "Tracing": {
      "Verbosity": "Verbose",
      "Components": "All",
      "EnableOpenTelemetry": true
    }
  }
}
```

### Production (appsettings.Production.json)

```json
{
  "Whizbang": {
    "Tracing": {
      "Verbosity": "Minimal",
      "Components": "Handlers, Errors",
      "EnableOpenTelemetry": true,
      "TracedHandlers": {
        "PaymentHandler": "Normal"
      }
    }
  }
}
```

---

## Helper Methods

TracingOptions provides helper methods for checking configuration:

```csharp
/// <summary>
/// Checks if tracing is enabled for a given component.
/// Returns true only if Verbosity is not Off AND the component flag is set.
/// </summary>
public bool IsEnabled(TraceComponents component) {
  return Verbosity != TraceVerbosity.Off && Components.HasFlag(component);
}

/// <summary>
/// Checks if a trace at the specified verbosity level should be emitted.
/// Returns true if the current Verbosity meets or exceeds the required level.
/// </summary>
public bool ShouldTrace(TraceVerbosity requiredVerbosity) {
  return Verbosity != TraceVerbosity.Off && Verbosity >= requiredVerbosity;
}
```

---

## Best Practices

### DO

- Use `Minimal` in production with targeted `TracedHandlers`
- Enable OpenTelemetry for distributed tracing
- Use environment-specific configurations
- Monitor configuration changes in production

### DON'T

- Set `Debug` verbosity in production
- Enable `All` components in production
- Forget that runtime changes affect all instances

---

## Further Reading

- [Trace Verbosity](verbosity-levels.md) - Detail levels explained
- [Trace Components](components.md) - Component filtering
- [Trace Attributes](attributes.md) - `[TraceHandler]` and `[TraceMessage]`

---

*Version 0.3.0 - Draft | Last Updated: 2026-03-01*
