---
title: "Trace Verbosity Levels"
version: 0.3.0
category: Observability
order: 1
description: "Configure tracing detail levels from minimal production logging to full debug output with payload inspection"
tags: tracing, observability, debugging, logging, verbosity, opentelemetry, diagnostics
codeReferences:
  - src/Whizbang.Core/Tracing/TraceVerbosity.cs
---

# Trace Verbosity Levels

**TraceVerbosity** controls how much detail is captured when tracing message flows through the system. Choose the appropriate level based on your environment and debugging needs.

## Core Concept

Tracing generates detailed information about message dispatch, handler invocation, and event flow. The verbosity level determines what gets recorded:

- **Production**: Use `Off` or `Minimal` to capture only errors and explicitly marked handlers
- **Staging**: Use `Normal` to see lifecycle transitions without overwhelming detail
- **Development**: Use `Verbose` or `Debug` for full visibility into system behavior

---

## TraceVerbosity Enum

```csharp
namespace Whizbang.Core.Tracing;

/// <summary>
/// Controls the detail level of tracing output.
/// </summary>
/// <remarks>
/// <para>
/// Verbosity levels are hierarchical - each level includes everything from lower levels.
/// Explicit traces (via [TraceHandler] or [TraceMessage] attributes) are always captured
/// at Minimal or higher, regardless of the global verbosity setting.
/// </para>
/// </remarks>
public enum TraceVerbosity {
  /// <summary>
  /// No tracing output. Use in production when tracing overhead must be eliminated.
  /// </summary>
  Off = 0,

  /// <summary>
  /// Errors, failures, and explicitly marked items only.
  /// Captures [TraceHandler] and [TraceMessage] attributed types.
  /// Recommended for production monitoring.
  /// </summary>
  Minimal = 1,

  /// <summary>
  /// Command/event lifecycle stage transitions.
  /// Shows message creation, dispatch, and completion without internal details.
  /// </summary>
  Normal = 2,

  /// <summary>
  /// Outbox/inbox operations and handler discovery.
  /// Shows which handlers were found and invoked for each message.
  /// </summary>
  Verbose = 3,

  /// <summary>
  /// Full payload inspection, timing breakdown, and perspective updates.
  /// Maximum detail for debugging complex scenarios.
  /// </summary>
  Debug = 4
}
```

---

## Level Details

### Off (0) - No Tracing

**Use in**: Production when tracing overhead is unacceptable

```json
{
  "Whizbang": {
    "Tracing": {
      "Verbosity": "Off"
    }
  }
}
```

- No tracing output
- Zero overhead path
- `[TraceHandler]` and `[TraceMessage]` attributes are ignored

---

### Minimal (1) - Errors and Explicit Only

**Use in**: Production with targeted debugging

```json
{
  "Whizbang": {
    "Tracing": {
      "Verbosity": "Minimal"
    }
  }
}
```

**What's traced**:
- Errors and exceptions during message processing
- Handler failures with stack traces
- Items marked with `[TraceHandler]` or `[TraceMessage]`
- Items configured in `TracedHandlers` or `TracedMessages`

**Log example**:
```
[ERR] Handler failed: OrderReceptor threw InvalidOperationException
[INF] [TRACE] Handler invocation: PaymentHandler (explicit)
```

---

### Normal (2) - Lifecycle Transitions

**Use in**: Staging or QA environments

```json
{
  "Whizbang": {
    "Tracing": {
      "Verbosity": "Normal"
    }
  }
}
```

**What's traced** (includes Minimal):
- Message creation and dispatch start
- Lifecycle stage transitions (PreExecute, Execute, PostExecute)
- Handler completion with success/failure status
- Total processing time

**Log example**:
```
[DBG] Message dispatched: CreateOrderCommand (CorrelationId: abc-123)
[DBG] Lifecycle stage: PreExecute -> Execute
[DBG] Handler completed: OrderReceptor in 45ms (Success)
```

---

### Verbose (3) - Operations and Discovery

**Use in**: Development or issue investigation

```json
{
  "Whizbang": {
    "Tracing": {
      "Verbosity": "Verbose"
    }
  }
}
```

**What's traced** (includes Normal):
- Outbox write operations
- Inbox message reads
- Handler discovery results (which handlers matched)
- Event store operations
- Cascade chain tracking

**Log example**:
```
[DBG] Handler discovery: Found 3 handlers for OrderCreatedEvent:
      - NotificationHandler
      - InventoryHandler
      - AnalyticsHandler
[DBG] Outbox write: OrderCreatedEvent -> kafka://orders (MessageId: xyz-789)
[DBG] Event store: Persisted 2 events for stream order-123
```

---

### Debug (4) - Full Detail

**Use in**: Local development only

```json
{
  "Whizbang": {
    "Tracing": {
      "Verbosity": "Debug"
    }
  }
}
```

**What's traced** (includes Verbose):
- Full message payloads (serialized JSON)
- Timing breakdown per operation
- Perspective updates and queries
- Hop chain details from envelope
- Internal state transitions

**Log example**:
```
[DBG] Message payload: {"orderId":"123","items":[...]}
[DBG] Timing breakdown:
      - Deserialize: 2ms
      - Handler lookup: 1ms
      - Execute: 42ms
      - Perspective update: 5ms
[DBG] Hops: api-gateway -> order-service -> payment-service
```

---

## Hierarchical Behavior

Each verbosity level includes all output from lower levels:

| Level | Off | Minimal | Normal | Verbose | Debug |
|-------|-----|---------|--------|---------|-------|
| Errors & failures | - | Yes | Yes | Yes | Yes |
| Explicit traces | - | Yes | Yes | Yes | Yes |
| Lifecycle stages | - | - | Yes | Yes | Yes |
| Handler discovery | - | - | - | Yes | Yes |
| Outbox/Inbox ops | - | - | - | Yes | Yes |
| Full payloads | - | - | - | - | Yes |

---

## Explicit Traces Always Win

When a handler or message is explicitly marked for tracing, it's captured at `Minimal` or higher regardless of what component filters are set:

```csharp
[TraceHandler(TraceVerbosity.Debug)]  // Always traces at Debug level
public class PaymentReceptor : IReceptor<ProcessPayment, PaymentProcessed> {
    // ...
}

[TraceMessage(TraceVerbosity.Verbose)]  // Always traces at Verbose level
public sealed record ReseedSystemEvent : EventBase<ReseedSystemEvent> {
    // ...
}
```

The attribute's verbosity level determines the detail captured for that specific item, even when global verbosity is lower.

---

## Runtime Configuration

Verbosity can be changed at runtime via `IOptionsMonitor<TracingOptions>`:

```json
{
  "Whizbang": {
    "Tracing": {
      "Verbosity": "Normal",
      "TracedHandlers": {
        "PaymentHandler": "Debug"
      },
      "TracedMessages": {
        "ReseedSystemEvent": "Verbose"
      }
    }
  }
}
```

Changes take effect immediately without restart.

---

## Best Practices

### DO

- Start with `Off` in production, enable `Minimal` for targeted debugging
- Use `[TraceHandler]` on handlers you're actively debugging
- Configure `TracedHandlers` in appsettings for runtime control
- Review trace output in local .NET Aspire dashboard before production

### DON'T

- Run `Debug` verbosity in production (performance impact)
- Leave `Verbose` enabled after debugging is complete
- Trace all handlers simultaneously in production
- Include sensitive data in message payloads when tracing is enabled

---

## Further Reading

- [Trace Components](components.md) - Filter which components generate traces
- [Trace Attributes](attributes.md) - `[TraceHandler]` and `[TraceMessage]` usage
- [Tracing Configuration](configuration.md) - Full configuration options
- [Custom Trace Outputs](custom-outputs.md) - Implement `ITraceOutput` for custom destinations

---

*Version 0.3.0 - Draft | Last Updated: 2026-02-27*
