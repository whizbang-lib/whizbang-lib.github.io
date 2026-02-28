---
title: "Metric Components"
version: 0.3.0
category: Observability
order: 2
description: "Filter which system components emit metrics using a flags-based picklist"
tags: metrics, observability, components, filtering, flags, opentelemetry
codeReferences:
  - src/Whizbang.Core/Tracing/MetricComponents.cs
---

# Metric Components

**MetricComponents** is a flags enum that controls which parts of the system emit metrics. Use it to focus on specific areas and minimize overhead in production environments.

## Core Concept

Different system components generate metrics:
- **Handlers** processing commands and events
- **Dispatcher** routing messages
- **Outbox/Inbox** message operations
- **Event store** persistence
- **Workers** background processing

MetricComponents lets you selectively enable metrics for the components you want to monitor.

---

## MetricComponents Flags Enum

```csharp
namespace Whizbang.Core.Tracing;

/// <summary>
/// Flags enum specifying which components should emit metrics.
/// </summary>
[Flags]
public enum MetricComponents {
  /// <summary>No component metrics enabled.</summary>
  None = 0,

  /// <summary>Handler invocations, duration, success/failure.</summary>
  Handlers = 1 << 0,      // 1

  /// <summary>Message dispatch and receptor discovery.</summary>
  Dispatcher = 1 << 1,    // 2

  /// <summary>Messages dispatched and received.</summary>
  Messages = 1 << 2,      // 4

  /// <summary>Events stored and published.</summary>
  Events = 1 << 3,        // 8

  /// <summary>Outbox writes, pending, delivery.</summary>
  Outbox = 1 << 4,        // 16

  /// <summary>Inbox received, pending, duplicates.</summary>
  Inbox = 1 << 5,         // 32

  /// <summary>Event store reads and writes.</summary>
  EventStore = 1 << 6,    // 64

  /// <summary>Lifecycle stage transitions.</summary>
  Lifecycle = 1 << 7,     // 128

  /// <summary>Perspective updates and lag.</summary>
  Perspectives = 1 << 8,  // 256

  /// <summary>Tag processing operations.</summary>
  Tags = 1 << 9,          // 512

  /// <summary>Security context propagation.</summary>
  Security = 1 << 10,     // 1024

  /// <summary>Background worker operations.</summary>
  Workers = 1 << 11,      // 2048

  /// <summary>Error and exception tracking.</summary>
  Errors = 1 << 12,       // 4096

  /// <summary>Circuit breaker and retry policies.</summary>
  Policies = 1 << 13,     // 8192

  /// <summary>All components enabled.</summary>
  All = Handlers | Dispatcher | Messages | Events | Outbox | Inbox |
        EventStore | Lifecycle | Perspectives | Tags | Security |
        Workers | Errors | Policies  // 16383
}
```

---

## Usage Patterns

### Configuration via appsettings.json

```json
{
  "Whizbang": {
    "Metrics": {
      "Enabled": true,
      "Components": ["Handlers", "EventStore", "Errors"]
    }
  }
}
```

### Programmatic Configuration

```csharp
services.AddWhizbang(options => {
  options.Metrics.Enabled = true;
  options.Metrics.Components = MetricComponents.Handlers
                             | MetricComponents.EventStore
                             | MetricComponents.Errors;
});
```

### Checking Component Flags

```csharp
// In metrics implementation
if (options.IsEnabled(MetricComponents.Handlers)) {
  // Record handler metric
  WhizbangMetrics.HandlerInvocations.Add(1, tags);
}
```

---

## Component Details

### Handlers (1)

Tracks handler execution:
- Total invocations
- Success/failure counts
- Execution duration
- Active handler count

**Use when**: Monitoring handler performance and reliability.

### Dispatcher (2)

Tracks message routing:
- Dispatch operations
- Receptor discovery
- Routing decisions

**Use when**: Debugging message routing or handler selection.

### Messages (4)

Tracks message flow:
- Messages dispatched
- Messages received
- Processing time

**Use when**: Monitoring overall message throughput.

### Events (8)

Tracks event operations:
- Events stored
- Events published

**Use when**: Monitoring event sourcing operations.

### Outbox (16)

Tracks outbound messaging:
- Outbox writes
- Pending count
- Batch sizes
- Delivery latency

**Use when**: Monitoring reliable delivery and backpressure.

### Inbox (32)

Tracks inbound messaging:
- Messages received
- Pending count
- Batch sizes
- Processing time
- Duplicate detection

**Use when**: Monitoring message consumption and idempotency.

### EventStore (64)

Tracks persistence operations:
- Append operations
- Read operations
- Events per append
- Read/write latency

**Use when**: Monitoring event store performance.

### Lifecycle (128)

Tracks lifecycle stages:
- Stage invocations
- Stage duration
- Skipped stages

**Use when**: Monitoring middleware and hooks.

### Perspectives (256)

Tracks read model updates:
- Projection updates
- Update duration
- Processing lag
- Projection errors

**Use when**: Monitoring read model health.

### Tags (512)

Tracks tag processing:
- Tags processed
- Processing duration
- Tag errors

**Use when**: Monitoring custom tag hooks.

### Security (1024)

Tracks security operations:
- Context propagations
- Missing context warnings

**Use when**: Monitoring security context flow.

### Workers (2048)

Tracks background workers:
- Worker iterations
- Idle time
- Active workers
- Worker errors

**Use when**: Monitoring background processing health.

### Errors (4096)

Tracks system errors:
- Total errors
- Unhandled exceptions

**Use when**: Monitoring system reliability.

### Policies (8192)

Tracks resilience policies:
- Circuit breaker activations
- Retry attempts

**Use when**: Monitoring resilience policy behavior.

### All (16383)

All components enabled. Combines all individual flags.

**Use when**: Development environments with full visibility.

---

## Common Combinations

### Production Monitoring

Focus on critical paths:

```csharp
options.Metrics.Components = MetricComponents.Handlers
                           | MetricComponents.EventStore
                           | MetricComponents.Errors
                           | MetricComponents.Policies;
```

### Message Flow Analysis

Track messages through the system:

```csharp
options.Metrics.Components = MetricComponents.Messages
                           | MetricComponents.Events
                           | MetricComponents.Outbox
                           | MetricComponents.Inbox;
```

### Persistence Monitoring

Focus on data storage:

```csharp
options.Metrics.Components = MetricComponents.EventStore
                           | MetricComponents.Perspectives;
```

### Worker Health

Monitor background processing:

```csharp
options.Metrics.Components = MetricComponents.Workers
                           | MetricComponents.Errors;
```

### Full Development Visibility

Everything enabled:

```csharp
options.Metrics.Components = MetricComponents.All;
```

---

## Bitwise Operations

### Adding Components

```csharp
var components = MetricComponents.Handlers;
components |= MetricComponents.Errors;
// Result: Handlers | Errors
```

### Removing Components

```csharp
var components = MetricComponents.All;
components &= ~MetricComponents.Messages;
// Result: All except Messages
```

### Toggling Components

```csharp
var components = MetricComponents.Handlers | MetricComponents.Errors;
components ^= MetricComponents.Errors;
// Result: Handlers only
```

### Checking Components

```csharp
var components = MetricComponents.Handlers | MetricComponents.Errors;
bool hasHandlers = components.HasFlag(MetricComponents.Handlers); // true
bool hasInbox = components.HasFlag(MetricComponents.Inbox);       // false
```

---

## Best Practices

### DO

- Start with minimal components in production
- Add components incrementally during debugging
- Use `Handlers | Errors` as a baseline
- Document component selection per environment

### DON'T

- Enable `All` in production (high overhead)
- Forget to disable after debugging
- Mix unrelated components (adds noise)
- Use metrics for security enforcement

---

## Further Reading

- [Metrics Overview](overview.md) - All available metrics
- [Metrics Configuration](configuration.md) - Full configuration options
- [Trace Components](../tracing/components.md) - Similar pattern for tracing

---

*Version 0.3.0 - Draft | Last Updated: 2026-02-27*
