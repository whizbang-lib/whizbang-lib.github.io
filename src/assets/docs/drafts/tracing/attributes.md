---
title: "Trace Attributes"
version: 0.3.0
category: Observability
order: 3
description: "Apply [WhizbangTrace] attribute to elevate tracing for specific receptors, messages, or perspectives"
tags: tracing, observability, debugging, attributes, handlers, messages, explicit
codeReferences:
  - src/Whizbang.Core/Tracing/WhizbangTraceAttribute.cs
  - src/Whizbang.Core/Tracing/TraceVerbosity.cs
---

# Trace Attributes

Use the `[WhizbangTrace]` attribute to mark specific types for elevated tracing. These items are always traced when verbosity is `Minimal` or higher, regardless of component filtering.

## Core Concept

When debugging a specific handler or message type, you want detailed traces for that item without enabling verbose tracing system-wide. The `[WhizbangTrace]` attribute provides targeted debugging:

**Supported Targets**:
- **Receptors** - traces all invocations of this handler
- **Events/Commands** (planned) - traces all handlers that receive this message
- **Perspectives** (planned) - traces perspective processing

The attribute accepts an optional verbosity level that determines the detail captured.

---

## WhizbangTraceAttribute

Apply to types to trace all relevant operations:

```csharp
namespace Whizbang.Core.Tracing;

/// <summary>
/// Marks a type for explicit tracing regardless of global settings.
/// </summary>
[AttributeUsage(
  AttributeTargets.Class,  // Receptors, Perspectives, Events, Commands
  AllowMultiple = false,
  Inherited = false)]
public sealed class WhizbangTraceAttribute : Attribute {
  /// <summary>
  /// The verbosity level for this type's traces.
  /// </summary>
  public TraceVerbosity Verbosity { get; init; } = TraceVerbosity.Normal;
}
```

### Tracing Receptors

```csharp
// Trace with default Normal level
[WhizbangTrace]
public class OrderReceptor : IReceptor<CreateOrder, OrderCreated> {
  public async ValueTask<OrderCreated> HandleAsync(CreateOrder command, CancellationToken ct) {
    // Handler logic - all invocations traced
  }
}

// Trace with explicit Debug level for maximum detail
[WhizbangTrace(Verbosity = TraceVerbosity.Debug)]
public class PaymentHandler : IReceptor<ProcessPayment, PaymentResult> {
  public async ValueTask<PaymentResult> HandleAsync(ProcessPayment command, CancellationToken ct) {
    // Handler logic - full payload and timing traced
  }
}
```

### Tracing Messages (Planned)

```csharp
// Trace all handlers that receive this event
[WhizbangTrace]
public sealed record ReseedSystemEvent : EventBase<ReseedSystemEvent> {
  public required string OperationType { get; init; }
}

// Trace with Debug level
[WhizbangTrace(Verbosity = TraceVerbosity.Debug)]
public sealed record PaymentCompletedEvent : EventBase<PaymentCompletedEvent> {
  public required Guid PaymentId { get; init; }
  public required decimal Amount { get; init; }
}
```

### What Gets Traced

When a type has `[WhizbangTrace]`:

| Verbosity | Traced Information |
|-----------|-------------------|
| Minimal | Invocation, completion status, errors |
| Normal | + Lifecycle stages, duration |
| Verbose | + Handler discovery, outbox/inbox |
| Debug | + Full payload, timing breakdown |

---

## Log Output

Explicit traces are highlighted in logs with `Information` level and `[TRACE]` prefix:

```
[INF] [TRACE] Handler invocation: PaymentHandler for ProcessPayment (1 handlers) - explicit via [WhizbangTrace]
[INF] [TRACE] Handler completed: PaymentHandler for ProcessPayment - Success in 45.20ms - explicit
```

This stands out from global traces which use `[trace]` prefix and `Debug` level.

---

## Priority Rules

When both attribute and config specify verbosity:

1. **Attribute** ensures the handler is traced when verbosity is `Minimal` or higher
2. **Config `TracedHandlers`/`TracedMessages`** can provide additional pattern-based tracing
3. Both are complementary - explicit attributes guarantee tracing

Example:
```csharp
[WhizbangTrace(Verbosity = TraceVerbosity.Normal)]  // Always traced
public class OrderReceptor { }

// appsettings.json adds pattern-based tracing
"TracedHandlers": { "Payment*": {} }

// Result: OrderReceptor traced (attribute), Payment* handlers traced (config)
```

---

## OpenTelemetry Tags

Explicit traces include special OTel tags:

| Tag | Value |
|-----|-------|
| `whizbang.trace.explicit` | `true` |
| `whizbang.handler.name` | Fully qualified handler name |
| `whizbang.message.type` | Message type being handled |
| `whizbang.handler.status` | `Success`, `Failed`, `Cancelled` |
| `whizbang.handler.duration_ms` | Execution time |

These allow filtering explicit traces in dashboards like Aspire, Jaeger, or App Insights.

---

## Source Generator Integration

The source generators detect `[WhizbangTrace]` at compile time:

1. `ReceptorDiscoveryGenerator` extracts `[WhizbangTrace]` from receptor classes
2. Generated registry includes `HasTraceAttribute` flag
3. Runtime tracer uses this metadata without reflection
4. `isExplicit: true` passed to `BeginHandlerTrace` for traced receptors

This ensures **zero reflection** and **AOT compatibility**.

---

## Best Practices

### DO

- Use `[WhizbangTrace]` when debugging a specific handler
- Start with `Normal` verbosity, increase to `Debug` if needed
- Leave on production handlers that benefit from always-on tracing
- Filter in Aspire/Jaeger using `whizbang.trace.explicit=true`

### DON'T

- Apply to every handler (use global settings instead)
- Use `Debug` verbosity in production (exposes payloads)
- Forget that traces require `Verbosity >= Minimal` globally

---

## Configuration-Based Tracing

For runtime control without code changes, use `TracedHandlers`/`TracedMessages` in configuration:

```json
{
  "Whizbang": {
    "Tracing": {
      "Verbosity": "Minimal",
      "TracedHandlers": {
        "OrderReceptor": {},
        "Payment*": {}
      },
      "TracedMessages": {
        "*ImportantEvent": {}
      }
    }
  }
}
```

See [Tracing Configuration](configuration.md) for details.

---

## Further Reading

- [Trace Verbosity](verbosity-levels.md) - Detail levels explained
- [Trace Components](components.md) - Component filtering
- [Tracing Configuration](configuration.md) - Runtime configuration
- [Tracing Overview](overview.md) - Getting started

---

*Version 0.3.0 - Draft | Last Updated: 2026-03-01*
