---
title: Tracing
version: 1.0.0
category: Observability
order: 1
description: >-
  Configure Whizbang's distributed tracing for handler invocations, message
  processing, and performance monitoring via OpenTelemetry and structured logging
tags: 'tracing, opentelemetry, observability, diagnostics, performance, telemetry'
codeReferences:
  - src/Whizbang.Core/Tracing/TracingOptions.cs
  - src/Whizbang.Core/Tracing/Tracer.cs
  - src/Whizbang.Core/Tracing/TraceComponents.cs
  - src/Whizbang.Core/Tracing/TraceVerbosity.cs
  - src/Whizbang.Core/Tracing/ITracer.cs
  - src/Whizbang.Core/Tracing/WhizbangTraceAttribute.cs
---

# Tracing

Whizbang provides comprehensive distributed tracing for message handlers, lifecycle stages, and background workers. Traces integrate with OpenTelemetry collectors (Aspire, Jaeger, Application Insights) and structured logging.

## Quick Start

```csharp{title="Enable Tracing" description="Configure tracing in AddWhizbang" category="Configuration" difficulty="BEGINNER" tags=["Tracing", "Configuration"]}
services.AddWhizbang(options => {
  options.Tracing.Verbosity = TraceVerbosity.Normal;
  options.Tracing.Components = TraceComponents.Handlers | TraceComponents.Errors;
});
```

## Configuration {#configuration}

### TracingOptions

The `TracingOptions` class controls all tracing behavior. Configure via `AddWhizbang()` or bind from `appsettings.json`.

```csharp{title="TracingOptions Properties" description="Full configuration reference for TracingOptions" category="Reference" difficulty="INTERMEDIATE" tags=["Tracing", "Configuration", "API"]}
services.AddWhizbang(options => {
  // Global verbosity level (default: Off)
  options.Tracing.Verbosity = TraceVerbosity.Verbose;

  // Which components emit traces (default: None)
  options.Tracing.Components = TraceComponents.All;

  // OpenTelemetry span emission (default: true)
  options.Tracing.EnableOpenTelemetry = true;

  // Structured logging via ILogger (default: true)
  options.Tracing.EnableStructuredLogging = true;

  // Emit parent spans for worker batch processing (default: false)
  options.Tracing.EnableWorkerBatchSpans = true;

  // Emit per-event spans for perspective processing (default: false)
  options.Tracing.EnablePerspectiveEventSpans = true;

  // Always trace specific handlers regardless of global verbosity
  options.Tracing.TracedHandlers["OrderReceptor"] = TraceVerbosity.Debug;
  options.Tracing.TracedHandlers["Payment*"] = TraceVerbosity.Verbose;

  // Always trace handlers receiving specific messages
  options.Tracing.TracedMessages["CreateOrderCommand"] = TraceVerbosity.Debug;
  options.Tracing.TracedMessages["*Event"] = TraceVerbosity.Normal;
});
```

### Configuration via appsettings.json

```json{title="appsettings.json Configuration" description="Bind tracing options from configuration" category="Configuration" difficulty="BEGINNER" tags=["Tracing", "Configuration", "JSON"]}
{
  "Whizbang": {
    "Tracing": {
      "Verbosity": "Verbose",
      "Components": "All",
      "EnableOpenTelemetry": true,
      "EnableStructuredLogging": true,
      "EnableWorkerBatchSpans": false,
      "EnablePerspectiveEventSpans": false,
      "TracedHandlers": {
        "OrderReceptor": "Debug",
        "Payment*": "Verbose"
      },
      "TracedMessages": {
        "ReseedSystemEvent": "Debug"
      }
    }
  }
}
```

### TracingOptions Properties Reference

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `Verbosity` | `TraceVerbosity` | `Off` | Global verbosity level |
| `Components` | `TraceComponents` | `None` | Which components emit traces |
| `EnableOpenTelemetry` | `bool` | `true` | Emit OpenTelemetry spans via ActivitySource |
| `EnableStructuredLogging` | `bool` | `true` | Emit structured logs via ILogger |
| `EnableWorkerBatchSpans` | `bool` | `false` | Emit parent spans for worker batches |
| `EnablePerspectiveEventSpans` | `bool` | `false` | Emit per-event spans in perspective processing |
| `TracedHandlers` | `Dictionary<string, TraceVerbosity>` | Empty | Handler patterns to always trace |
| `TracedMessages` | `Dictionary<string, TraceVerbosity>` | Empty | Message patterns to always trace |

## Tracer {#tracer}

The `Tracer` class implements `ITracer` and emits traces via OpenTelemetry ActivitySource and structured logging.

### ITracer Interface

```csharp{title="ITracer Interface" description="Core tracing interface for handler invocations" category="Reference" difficulty="INTERMEDIATE" tags=["Tracing", "Interface", "API"]}
public interface ITracer {
  void BeginHandlerTrace(
      string handlerName,
      string messageTypeName,
      int handlerCount,
      bool isExplicit);

  void EndHandlerTrace(
      string handlerName,
      string messageTypeName,
      HandlerStatus status,
      double durationMs,
      long startTimestamp,
      long endTimestamp,
      Exception? exception);
}
```

### Trace Output

The `Tracer` emits:

1. **OpenTelemetry Spans** - When `EnableOpenTelemetry` is true, creates `Activity` spans with tags:
   - `whizbang.handler.name` - Fully qualified handler name
   - `whizbang.message.type` - Message type name
   - `whizbang.handler.count` - Number of handlers for this message
   - `whizbang.trace.explicit` - Whether trace was elevated via configuration
   - `whizbang.handler.status` - Completion status
   - `whizbang.handler.duration_ms` - Execution duration

2. **Structured Logs** - When `EnableStructuredLogging` is true, uses source-generated `LoggerMessage`:
   - `[TRACE]` prefix for explicit/elevated traces (logged at Information level)
   - `[trace]` prefix for normal traces (logged at Debug level)

### Custom Tracer Implementation

Replace the default tracer for custom trace destinations:

```csharp{title="Custom Tracer" description="Implement ITracer for custom trace destinations" category="Extensibility" difficulty="ADVANCED" tags=["Tracing", "Extensibility", "Custom"]}
public class CustomTracer : ITracer {
  private readonly IMyTracingBackend _backend;

  public CustomTracer(IMyTracingBackend backend) {
    _backend = backend;
  }

  public void BeginHandlerTrace(
      string handlerName,
      string messageTypeName,
      int handlerCount,
      bool isExplicit) {
    _backend.StartSpan(handlerName, messageTypeName);
  }

  public void EndHandlerTrace(
      string handlerName,
      string messageTypeName,
      HandlerStatus status,
      double durationMs,
      long startTimestamp,
      long endTimestamp,
      Exception? exception) {
    _backend.EndSpan(handlerName, status, durationMs, exception);
  }
}

// Register in DI
services.AddSingleton<ITracer, CustomTracer>();
```

## TraceComponents {#components}

The `TraceComponents` flags enum controls which parts of Whizbang emit traces.

### Component Flags

| Component | Value | Description |
|-----------|-------|-------------|
| `None` | 0 | No tracing enabled |
| `Handlers` | 1 | Handler invocations, completions, failures |
| `Lifecycle` | 2 | Lifecycle stage transitions |
| `Dispatcher` | 4 | Dispatcher operations and receptor discovery |
| `Messages` | 8 | Message dispatch and routing |
| `Events` | 16 | Event creation and publishing |
| `Outbox` | 32 | Outbox writes and delivery |
| `Inbox` | 64 | Inbox reads and processing |
| `EventStore` | 128 | Event store reads and writes |
| `Perspectives` | 256 | Perspective updates and queries |
| `Tags` | 512 | Tag hook processing |
| `Security` | 1024 | Security context propagation |
| `Workers` | 2048 | Background worker operations |
| `Errors` | 4096 | Error and exception handling |

### Convenience Combinations

| Combination | Included Components |
|-------------|---------------------|
| `All` | All components enabled |
| `AllWithoutWorkers` | All except Workers (reduces noise) |
| `Core` | Handlers, Dispatcher, Messages |
| `Messaging` | Messages, Events, Outbox, Inbox |
| `Storage` | EventStore, Perspectives |
| `Production` | Handlers, Errors, Security |

### Usage Examples

```csharp{title="TraceComponents Configuration" description="Combine component flags for targeted tracing" category="Configuration" difficulty="BEGINNER" tags=["Tracing", "Components", "Configuration"]}
// Trace only handlers and errors
options.Tracing.Components = TraceComponents.Handlers | TraceComponents.Errors;

// Production defaults (recommended for production)
options.Tracing.Components = TraceComponents.Production;

// Debug everything except noisy workers
options.Tracing.Components = TraceComponents.AllWithoutWorkers;

// Core message processing only
options.Tracing.Components = TraceComponents.Core;

// Full debugging
options.Tracing.Components = TraceComponents.All;
```

## TraceVerbosity

Verbosity levels are hierarchical - higher levels include all output from lower levels.

| Level | Value | Description |
|-------|-------|-------------|
| `Off` | 0 | No tracing output |
| `Minimal` | 1 | Errors, failures, and explicit traces only |
| `Normal` | 2 | Command/Event lifecycle stage transitions |
| `Verbose` | 3 | Outbox/Inbox operations, handler discovery |
| `Debug` | 4 | Full payload, timing breakdown, perspectives |

## Explicit Tracing with [WhizbangTrace]

Mark types for **always-on tracing** regardless of global verbosity:

```csharp{title="WhizbangTrace Attribute" description="Mark types for explicit tracing" category="Usage" difficulty="BEGINNER" tags=["Tracing", "Attributes", "Explicit"]}
// Trace all invocations of this receptor
[WhizbangTrace]
public class OrderReceptor : IReceptor<CreateOrder, OrderCreated> {
  public ValueTask<OrderCreated> HandleAsync(
      CreateOrder message,
      CancellationToken ct) {
    // All invocations traced regardless of global verbosity
  }
}

// Trace at Debug verbosity for more detail
[WhizbangTrace(Verbosity = TraceVerbosity.Debug)]
public class PaymentReceptor : IReceptor<ProcessPayment, PaymentProcessed> {
  // Full payload and timing breakdown included
}

// Trace all handlers that receive this event
[WhizbangTrace]
public sealed record ReseedSystemEvent : EventBase<ReseedSystemEvent>;
```

### When Explicit Traces Are Elevated

Traces are marked as "explicit" when:

1. Handler or message has `[WhizbangTrace]` attribute
2. Handler matches a pattern in `TracedHandlers` dictionary
3. Message type matches a pattern in `TracedMessages` dictionary

Explicit traces:
- Are emitted at `Information` log level (instead of `Debug`)
- Include `whizbang.trace.explicit = true` tag in OpenTelemetry spans
- Allow filtering in dashboards (Aspire, Jaeger, App Insights)

## Pattern Matching

Handler and message patterns support wildcards:

```csharp{title="Pattern Matching Examples" description="Wildcard patterns for handler and message tracing" category="Configuration" difficulty="INTERMEDIATE" tags=["Tracing", "Patterns", "Configuration"]}
options.Tracing.TracedHandlers["OrderReceptor"] = TraceVerbosity.Debug;        // Exact match
options.Tracing.TracedHandlers["Payment*"] = TraceVerbosity.Verbose;           // Prefix wildcard
options.Tracing.TracedHandlers["*Receptor"] = TraceVerbosity.Normal;           // Suffix wildcard
options.Tracing.TracedHandlers["MyApp.Handlers.*"] = TraceVerbosity.Debug;     // Namespace wildcard

options.Tracing.TracedMessages["CreateOrderCommand"] = TraceVerbosity.Debug;   // Exact match
options.Tracing.TracedMessages["*Event"] = TraceVerbosity.Normal;              // Suffix wildcard
```

**Pattern Matching Rules**:
- Case-insensitive comparison
- `*` matches zero or more characters
- Patterns match fully qualified names or short names
- `OrderReceptor` matches `MyApp.Handlers.OrderReceptor`

## OpenTelemetry Integration

Whizbang traces integrate with any OpenTelemetry collector:

```csharp{title="OpenTelemetry Setup" description="Configure OpenTelemetry with Whizbang tracing" category="Configuration" difficulty="INTERMEDIATE" tags=["Tracing", "OpenTelemetry", "Aspire"]}
builder.Services.AddOpenTelemetry()
    .WithTracing(tracing => {
      tracing.AddSource("Whizbang.Tracing");  // Tracer spans
      tracing.AddSource("Whizbang.MessageTags");  // Tag hook spans
      tracing.AddAspireInstrumentation();
    });

builder.Services.AddWhizbang(options => {
  options.Tracing.Verbosity = TraceVerbosity.Normal;
  options.Tracing.Components = TraceComponents.Production;
  options.Tracing.EnableOpenTelemetry = true;
});
```

### Span Tags

All Whizbang spans include these tags:

| Tag | Description |
|-----|-------------|
| `whizbang.handler.name` | Fully qualified handler name |
| `whizbang.message.type` | Message type name |
| `whizbang.handler.count` | Number of handlers for message |
| `whizbang.trace.explicit` | Whether trace was elevated |
| `whizbang.handler.status` | `Completed`, `Failed`, `Skipped` |
| `whizbang.handler.duration_ms` | Execution duration in milliseconds |

### Exception Recording

When handlers fail, the span records:
- `ActivityStatusCode.Error` status
- Exception event with:
  - `exception.type` - Exception type name
  - `exception.message` - Exception message
  - `exception.stacktrace` - Full stack trace

## Best Practices

### Production Configuration

```csharp{title="Production Tracing" description="Recommended production tracing configuration" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Operations", "Observability", "C#", "Production", "Tracing"]}
services.AddWhizbang(options => {
  options.Tracing.Verbosity = TraceVerbosity.Minimal;
  options.Tracing.Components = TraceComponents.Production;
  options.Tracing.EnableOpenTelemetry = true;
  options.Tracing.EnableStructuredLogging = true;

  // Always trace critical handlers
  options.Tracing.TracedHandlers["PaymentReceptor"] = TraceVerbosity.Normal;
  options.Tracing.TracedHandlers["OrderReceptor"] = TraceVerbosity.Normal;
});
```

### Development Configuration

```csharp{title="Development Tracing" description="Verbose tracing for development" category="Best-Practices" difficulty="BEGINNER" tags=["Operations", "Observability", "C#", "Development", "Tracing"]}
services.AddWhizbang(options => {
  options.Tracing.Verbosity = TraceVerbosity.Debug;
  options.Tracing.Components = TraceComponents.AllWithoutWorkers;
  options.Tracing.EnableOpenTelemetry = true;
  options.Tracing.EnableStructuredLogging = true;
});
```

### Debugging Specific Issues

```csharp{title="Targeted Debugging" description="Enable verbose tracing for specific components" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Tracing", "Debugging", "Best-Practices"]}
// Debug perspective processing
options.Tracing.Verbosity = TraceVerbosity.Debug;
options.Tracing.Components = TraceComponents.Perspectives | TraceComponents.EventStore;
options.Tracing.EnablePerspectiveEventSpans = true;

// Debug specific handler
options.Tracing.TracedHandlers["ProblematicReceptor"] = TraceVerbosity.Debug;
```

## See Also

- [OpenTelemetry Integration](./opentelemetry-integration) - Tag-based telemetry and metrics
- [Observability & Message Hops](../../fundamentals/persistence/observability) - Hop-based distributed tracing
- [Message Tags](../../fundamentals/messages/message-tags) - Declarative cross-cutting concerns
