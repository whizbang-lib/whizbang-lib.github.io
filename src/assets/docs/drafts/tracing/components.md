---
title: "Trace Components"
version: 0.3.0
category: Observability
order: 2
description: "Filter which system components generate trace output using a flags-based picklist"
tags: tracing, observability, debugging, logging, components, filtering, flags
codeReferences:
  - src/Whizbang.Core/Tracing/TraceComponents.cs
---

# Trace Components

**TraceComponents** is a flags enum that controls which parts of the system generate trace output. Use it to focus on specific areas during debugging without being overwhelmed by unrelated traces.

## Core Concept

When tracing is enabled, different components generate output:
- **HTTP requests** flowing into the system
- **Commands and events** being created and dispatched
- **Handlers** being discovered and invoked
- **Outbox/Inbox** message operations
- **Event store** persistence

TraceComponents lets you selectively enable tracing for the components you're investigating.

---

## TraceComponents Flags Enum

```csharp
namespace Whizbang.Core.Tracing;

/// <summary>
/// Flags enum specifying which components should emit trace output.
/// </summary>
[Flags]
public enum TraceComponents {
  /// <summary>No component tracing enabled.</summary>
  None = 0,

  /// <summary>HTTP requests and responses at the API boundary.</summary>
  Http = 1,

  /// <summary>Command creation, dispatch, and completion.</summary>
  Commands = 2,

  /// <summary>Event creation, publishing, and cascading.</summary>
  Events = 4,

  /// <summary>Outbox write and delivery operations.</summary>
  Outbox = 8,

  /// <summary>Inbox message consumption and processing.</summary>
  Inbox = 16,

  /// <summary>Event store read and write operations.</summary>
  EventStore = 32,

  /// <summary>Handler discovery and invocation.</summary>
  Handlers = 64,

  /// <summary>Lifecycle stage transitions (PreExecute, Execute, PostExecute).</summary>
  Lifecycle = 128,

  /// <summary>Perspective updates and queries.</summary>
  Perspectives = 256,

  /// <summary>Only trace items marked with [TraceHandler] or [TraceMessage].</summary>
  Explicit = 512,

  /// <summary>All components enabled.</summary>
  All = Http | Commands | Events | Outbox | Inbox | EventStore | Handlers | Lifecycle | Perspectives
}
```

---

## Usage Patterns

### Configuration via appsettings.json

```json
{
  "Whizbang": {
    "Tracing": {
      "Verbosity": "Normal",
      "Components": ["Http", "Handlers", "EventStore"]
    }
  }
}
```

### Programmatic Configuration

```csharp
services.AddWhizbang(options => {
  options.Tracing.Components = TraceComponents.Http
                             | TraceComponents.Handlers
                             | TraceComponents.EventStore;
});
```

### Checking Component Flags

```csharp
// In tracer implementation
if (options.Components.HasFlag(TraceComponents.Handlers)) {
  // Emit handler discovery trace
}

// Combine with verbosity
if (options.Verbosity >= TraceVerbosity.Verbose
    && options.Components.HasFlag(TraceComponents.Inbox)) {
  // Emit detailed inbox trace
}
```

---

## Component Details

### Http (1)

Traces at the API boundary:
- Request received (method, path, headers)
- Response sent (status, duration)
- Request/response correlation

**Use when**: Debugging API latency or request routing.

### Commands (2)

Traces command lifecycle:
- Command created with payload
- Command dispatched to handler
- Command completed (success/failure)

**Use when**: Debugging command validation or handler selection.

### Events (4)

Traces event flow:
- Event created (source, payload)
- Event published to receptors
- Event cascade chain

**Use when**: Debugging event propagation or cascading.

### Outbox (8)

Traces outbound messaging:
- Outbox write (destination, message)
- Delivery attempt
- Delivery confirmation

**Use when**: Debugging cross-service communication.

### Inbox (16)

Traces inbound messaging:
- Message received from transport
- Message deserialized
- Message routed to handlers

**Use when**: Debugging message consumption issues.

### EventStore (32)

Traces persistence operations:
- Event store writes
- Stream reads
- Snapshot operations

**Use when**: Debugging persistence or event sourcing.

### Handlers (64)

Traces handler execution:
- Handler discovery (which handlers match)
- Handler invocation start
- Handler completion (duration, result)

**Use when**: Debugging handler selection or execution.

### Lifecycle (128)

Traces lifecycle stages:
- PreExecute phase
- Execute phase
- PostExecute phase
- Stage transitions

**Use when**: Debugging middleware or lifecycle hooks.

### Perspectives (256)

Traces read model updates:
- Perspective Apply calls
- Model mutations
- Persistence operations

**Use when**: Debugging projection updates.

### Explicit (512)

Only traces items with explicit markers:
- `[TraceHandler]` on handler classes
- `[TraceMessage]` on events/commands
- `TracedHandlers` config entries
- `TracedMessages` config entries

**Use when**: Production targeted debugging.

### All (1023)

All components enabled. Equivalent to combining all individual flags.

**Use when**: Local development with full visibility.

---

## Common Combinations

### Handler Debugging

Focus on handler execution and discovery:

```csharp
options.Tracing.Components = TraceComponents.Handlers | TraceComponents.Lifecycle;
```

### Message Flow

Track messages through the system:

```csharp
options.Tracing.Components = TraceComponents.Commands
                           | TraceComponents.Events
                           | TraceComponents.Outbox
                           | TraceComponents.Inbox;
```

### Persistence Operations

Focus on data storage:

```csharp
options.Tracing.Components = TraceComponents.EventStore | TraceComponents.Perspectives;
```

### Production Monitoring

Only explicit traces:

```csharp
options.Tracing.Components = TraceComponents.Explicit;
options.Tracing.Verbosity = TraceVerbosity.Minimal;
```

---

## Integration with Verbosity

Components and verbosity work together:

| Verbosity | Components Effect |
|-----------|-------------------|
| Off | No output regardless of components |
| Minimal | Only errors + Explicit flag items |
| Normal+ | Component filter applies fully |

**Example**:
```csharp
// Verbose verbosity, but only trace handlers
options.Tracing.Verbosity = TraceVerbosity.Verbose;
options.Tracing.Components = TraceComponents.Handlers;
// Result: Detailed handler traces only
```

---

## Best Practices

### DO

- Start with `Explicit` in production for minimal impact
- Combine related components (e.g., Outbox + Inbox for message flow)
- Use `All` only in local development
- Document which components are enabled per environment

### DON'T

- Enable all components in production
- Mix unrelated components (adds noise)
- Forget to disable after debugging
- Use component filtering as a security measure

---

## Further Reading

- [Trace Verbosity](verbosity-levels.md) - Control detail level
- [Trace Attributes](attributes.md) - `[TraceHandler]` and `[TraceMessage]`
- [Tracing Configuration](configuration.md) - Full configuration options

---

*Version 0.3.0 - Draft | Last Updated: 2026-02-27*
