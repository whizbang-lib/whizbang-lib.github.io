---
title: "Trace Attributes"
version: 0.3.0
category: Observability
order: 3
description: "Apply [TraceHandler] and [TraceMessage] attributes to elevate tracing for specific handlers and messages"
tags: tracing, observability, debugging, attributes, handlers, messages, explicit
codeReferences:
  - src/Whizbang.Core/Tracing/TraceHandlerAttribute.cs
  - src/Whizbang.Core/Tracing/TraceMessageAttribute.cs
---

# Trace Attributes

Use `[TraceHandler]` and `[TraceMessage]` attributes to mark specific handlers or messages for elevated tracing. These items are always traced when verbosity is `Minimal` or higher, regardless of component filtering.

## Core Concept

When debugging a specific handler or message type, you want detailed traces for that item without enabling verbose tracing system-wide. Explicit trace attributes provide targeted debugging:

- **`[TraceHandler]`**: Applied to handler/receptor classes
- **`[TraceMessage]`**: Applied to event or command record types

Both attributes accept an optional verbosity level that determines the detail captured.

---

## TraceHandlerAttribute

Apply to handler classes to trace all messages they process:

```csharp
namespace Whizbang.Core.Tracing;

/// <summary>
/// Marks a handler for explicit tracing regardless of global settings.
/// </summary>
[AttributeUsage(AttributeTargets.Class, AllowMultiple = false, Inherited = false)]
public sealed class TraceHandlerAttribute : Attribute {
  /// <summary>
  /// The verbosity level for this handler's traces.
  /// </summary>
  public TraceVerbosity Verbosity { get; }

  /// <summary>
  /// Creates a TraceHandler attribute with the specified verbosity.
  /// </summary>
  /// <param name="verbosity">Verbosity level for traces. Defaults to Verbose.</param>
  public TraceHandlerAttribute(TraceVerbosity verbosity = TraceVerbosity.Verbose) {
    Verbosity = verbosity;
  }
}
```

### Usage

```csharp
// Trace with default Verbose level
[TraceHandler]
public class OrderReceptor : IReceptor<CreateOrder, OrderCreated> {
    public async Task<OrderCreated> HandleAsync(CreateOrder command, CancellationToken ct) {
        // Handler logic - all invocations traced
    }
}

// Trace with explicit Debug level for maximum detail
[TraceHandler(TraceVerbosity.Debug)]
public class PaymentHandler : IReceptor<ProcessPayment, PaymentResult> {
    public async Task<PaymentResult> HandleAsync(ProcessPayment command, CancellationToken ct) {
        // Handler logic - full payload and timing traced
    }
}
```

### What Gets Traced

When a handler has `[TraceHandler]`:

| Verbosity | Traced Information |
|-----------|-------------------|
| Minimal | Handler invoked, completion status, errors |
| Normal | + Lifecycle stages, duration |
| Verbose | + Message type, handler discovery |
| Debug | + Full payload, timing breakdown |

---

## TraceMessageAttribute

Apply to event or command types to trace all handlers that process them:

```csharp
namespace Whizbang.Core.Tracing;

/// <summary>
/// Marks a message type for explicit tracing regardless of global settings.
/// </summary>
[AttributeUsage(AttributeTargets.Class, AllowMultiple = false, Inherited = false)]
public sealed class TraceMessageAttribute : Attribute {
  /// <summary>
  /// The verbosity level for traces involving this message.
  /// </summary>
  public TraceVerbosity Verbosity { get; }

  /// <summary>
  /// Creates a TraceMessage attribute with the specified verbosity.
  /// </summary>
  /// <param name="verbosity">Verbosity level for traces. Defaults to Verbose.</param>
  public TraceMessageAttribute(TraceVerbosity verbosity = TraceVerbosity.Verbose) {
    Verbosity = verbosity;
  }
}
```

### Usage

```csharp
// Trace all handlers that receive this event
[TraceMessage]
public sealed record ReseedSystemEvent : EventBase<ReseedSystemEvent> {
    public required string OperationType { get; init; }
}

// Trace with Debug level
[TraceMessage(TraceVerbosity.Debug)]
public sealed record PaymentCompletedEvent : EventBase<PaymentCompletedEvent> {
    public required Guid PaymentId { get; init; }
    public required decimal Amount { get; init; }
}
```

### What Gets Traced

When a message has `[TraceMessage]`:

| Verbosity | Traced Information |
|-----------|-------------------|
| Minimal | Message dispatched, handler count, errors |
| Normal | + Per-handler completion, duration |
| Verbose | + Handler discovery details |
| Debug | + Full message payload |

---

## Log Output

Explicit traces are highlighted in logs:

```
[INF] [TRACE] Handler invocation: PaymentHandler (explicit via [TraceHandler])
[INF] [TRACE]   Message: ProcessPayment (CorrelationId: abc-123)
[INF] [TRACE]   Handler completed in 45.2ms (Success)

[INF] [TRACE] Message dispatched: ReseedSystemEvent (explicit via [TraceMessage])
[INF] [TRACE]   Found 3 handlers:
[INF] [TRACE]     - FilterHandler (completed: 12ms)
[INF] [TRACE]     - JobTemplateHandler (completed: 0.1ms, early return)
[INF] [TRACE]     - DraftJobsHandler (completed: 45ms)
```

Note the `[TRACE]` prefix and `Information` log level - these stand out from global traces which use `[trace]` prefix and `Debug` level.

---

## Priority Rules

When both attribute and config specify verbosity:

1. **Attribute verbosity wins** for that specific handler/message
2. **Global verbosity** applies to everything else
3. **Config `TracedHandlers`/`TracedMessages`** can override at runtime

Example:
```csharp
[TraceHandler(TraceVerbosity.Normal)]  // Attribute says Normal
public class OrderReceptor { }

// appsettings.json says Debug for all handlers matching "Order*"
"TracedHandlers": { "Order*": "Debug" }

// Result: OrderReceptor traces at Debug (config overrides attribute)
```

---

## OpenTelemetry Attributes

Explicit traces include special OTel tags:

| Tag | Value |
|-----|-------|
| `whizbang.trace.explicit` | `true` |
| `whizbang.trace.source` | `attribute` or `config` |
| `whizbang.trace.verbosity` | `Verbose`, `Debug`, etc. |

These allow filtering explicit traces in dashboards.

---

## Source Generator Integration

The source generators detect these attributes at compile time:

1. `ReceptorDiscoveryGenerator` extracts `[TraceHandler]` from handler classes
2. `MessageDiscoveryGenerator` extracts `[TraceMessage]` from message types
3. Generated registry includes `HasTraceAttribute` and `TraceVerbosity` flags
4. Runtime tracer uses this metadata without reflection

This ensures **zero reflection** and **AOT compatibility**.

---

## Best Practices

### DO

- Use `[TraceHandler]` when debugging a specific handler
- Use `[TraceMessage]` when tracking a message through multiple handlers
- Start with `Verbose` level, increase to `Debug` if needed
- Remove attributes after debugging (or leave for production debugging)

### DON'T

- Apply to every handler (use global settings instead)
- Use `Debug` verbosity in production (exposes payloads)
- Forget that attribute traces always output at `Minimal` or higher
- Mix with `TraceComponents.Explicit` incorrectly (they're complementary)

---

## Relationship with TraceComponents.Explicit

`TraceComponents.Explicit` is a component flag that says "only trace explicit items":

```csharp
options.Tracing.Components = TraceComponents.Explicit;
options.Tracing.Verbosity = TraceVerbosity.Minimal;
// Result: Only [TraceHandler] and [TraceMessage] items are traced
```

When using other components, explicit items are **also** traced:

```csharp
options.Tracing.Components = TraceComponents.Handlers;
options.Tracing.Verbosity = TraceVerbosity.Minimal;
// Result: Handler errors + all explicit items are traced
```

---

## Further Reading

- [Trace Verbosity](verbosity-levels.md) - Detail levels explained
- [Trace Components](components.md) - Component filtering
- [Tracing Configuration](configuration.md) - Runtime configuration

---

*Version 0.3.0 - Draft | Last Updated: 2026-02-27*
