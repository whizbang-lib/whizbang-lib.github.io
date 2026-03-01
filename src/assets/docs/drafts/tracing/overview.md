---
title: "Tracing Overview"
version: 0.3.0
category: Observability
order: 1
description: "End-to-end distributed tracing for Whizbang message handling with OpenTelemetry integration"
tags: tracing, observability, debugging, opentelemetry, distributed-tracing, monitoring
codeReferences:
  - src/Whizbang.Core/Tracing/ITracer.cs
  - src/Whizbang.Core/Tracing/Tracer.cs
  - src/Whizbang.Core/Tracing/HandlerStatus.cs
---

# Tracing Overview

Whizbang provides comprehensive distributed tracing across the entire message lifecycle. Traces flow from HTTP requests through handlers to perspectives, giving complete visibility into message processing.

## Core Capabilities

- **Production-ready**: Configurable for development and production use
- **Runtime configuration**: Change tracing settings without redeployment
- **Verbosity levels**: From minimal error-only to full debug detail
- **Component filtering**: Choose what to trace (handlers, outbox, inbox, etc.)
- **End-to-end correlation**: Full journey visibility via W3C TraceParent
- **Zero reflection**: All via source generators (AOT compatible)

---

## Trace Flow

```
HTTP Request → Command → Outbox → Event Store → Inbox → Handler → Perspectives → Response
     │           │         │           │          │        │          │
     └───────────┴─────────┴───────────┴──────────┴────────┴──────────┘
                          All traced with correlation
```

Each stage can be independently enabled/disabled via [component filtering](components.md).

---

## Quick Start

### Enable Tracing

```csharp
services.AddWhizbang(options => {
  options.Tracing.Verbosity = TraceVerbosity.Verbose;
  options.Tracing.Components = TraceComponents.Handlers | TraceComponents.EventStore;
});
```

### Configure OpenTelemetry

```csharp
services.AddOpenTelemetry()
  .WithTracing(builder => builder
    .AddSource("Whizbang.Tracing")
    .AddAspireInstrumentation()
    .AddConsoleExporter());
```

### Mark Specific Handlers

```csharp
[TraceHandler(TraceVerbosity.Debug)]
public class OrderReceptor : IReceptor<CreateOrder, OrderCreated> {
  // Always traced at Debug level
}
```

---

## Tracing Methods

| Method | Applied To | Behavior |
|--------|------------|----------|
| `[TraceHandler(Verbosity)]` | Handler class | Always traces this handler |
| `[TraceMessage(Verbosity)]` | IEvent/ICommand | Always traces this message |
| Config: `TracedHandlers` | Runtime | Target specific handlers by name |
| Config: `TracedMessages` | Runtime | Target specific messages by name |
| Config: `Verbosity` | Runtime | Global baseline for all components |

Explicit markers (`[TraceHandler]`, `[TraceMessage]`, config patterns) **always trace** regardless of global verbosity.

---

## Handler Status

When tracing handlers, the completion status is recorded:

```csharp
public enum HandlerStatus {
  Success,      // Handler completed successfully
  Failed,       // Handler threw an exception
  EarlyReturn,  // Handler returned early (skipped processing)
  Cancelled     // Handler was cancelled via CancellationToken
}
```

This status is included in both logs and OpenTelemetry spans.

---

## Log Output Examples

### Normal Tracing

```
[DBG] [trace] Handler invocation: OrderReceptor
[DBG] [trace]   Message: CreateOrder (CorrelationId: abc-123)
[DBG] [trace] Handler completed: OrderReceptor in 12.5ms (Success)
```

### Explicit Tracing (with `[TraceHandler]`)

```
[INF] [TRACE] Handler invocation: PaymentHandler (explicit via [TraceHandler])
[INF] [TRACE]   Message: ProcessPayment (CorrelationId: def-456)
[INF] [TRACE] Handler completed: PaymentHandler in 45.2ms (Success)
```

Note: Explicit traces use `[TRACE]` prefix and Information level to stand out.

---

## OpenTelemetry Integration

Whizbang uses `System.Diagnostics.ActivitySource` for OpenTelemetry integration:

### Activity Source

```csharp
// Whizbang emits spans to this activity source
ActivitySource: "Whizbang.Tracing"
```

### Standard Tags

| Tag | Description |
|-----|-------------|
| `whizbang.message.id` | Message ID from envelope |
| `whizbang.correlation_id` | Correlation ID for distributed tracing |
| `whizbang.trace.explicit` | `true` for `[TraceHandler]`/`[TraceMessage]` |
| `whizbang.trace.source` | `attribute` or `config` |
| `whizbang.handler` | Handler name |
| `whizbang.message_type` | Message type name |
| `whizbang.duration_ms` | Duration in milliseconds |
| `whizbang.status` | Completion status |

### Filtering Explicit Traces

In Aspire, Jaeger, or any OTel-compatible dashboard:

```
whizbang.trace.explicit == true
```

---

## Architecture

### Key Types

| Type | Purpose |
|------|---------|
| `ITracer` | Main interface for tracing decisions and coordination |
| `ITraceOutput` | Abstraction for trace output destinations |
| `LoggerTraceOutput` | Outputs traces to ILogger |
| `OpenTelemetryTraceOutput` | Outputs traces to OTel spans |
| `TraceContext` | Trace metadata (IDs, component, verbosity) |
| `TraceResult` | Trace completion (status, duration, exception) |
| `HandlerStatus` | Enum for handler completion status |

### Registration

```csharp
// Registered by AddWhizbang()
services.AddSingleton<ITracer, Tracer>();
services.AddSingleton<ITraceOutput, LoggerTraceOutput>();
services.AddSingleton<ITraceOutput, OpenTelemetryTraceOutput>();
```

---

## Configuration Options

```json
{
  "Whizbang": {
    "Tracing": {
      "Verbosity": "Verbose",
      "Components": ["Handlers", "EventStore"],

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

See [Configuration](configuration.md) for full options.

---

## Further Reading

- [Verbosity Levels](verbosity-levels.md) - Detail levels explained
- [Trace Components](components.md) - Component filtering
- [Trace Attributes](attributes.md) - `[TraceHandler]` and `[TraceMessage]`
- [Configuration](configuration.md) - Runtime configuration
- [Custom Outputs](custom-outputs.md) - Create custom trace destinations

---

*Version 0.3.0 - Draft | Last Updated: 2026-02-28*
