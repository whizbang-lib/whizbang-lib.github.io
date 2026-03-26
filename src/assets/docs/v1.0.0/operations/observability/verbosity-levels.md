---
title: Trace Verbosity Levels
version: 1.0.0
category: Tracing
order: 1
description: >-
  Hierarchical verbosity levels for controlling trace output detail, from minimal
  error-only tracing to full debug output with payloads and timing
tags: 'tracing, verbosity, observability, diagnostics, configuration'
codeReferences:
  - src/Whizbang.Core/Tracing/TraceVerbosity.cs
  - src/Whizbang.Core/Tracing/TracingOptions.cs
lastMaintainedCommit: '01f07906'
---

# Trace Verbosity Levels

The `TraceVerbosity` enum controls how much detail Whizbang emits in traces. Verbosity levels are hierarchical - higher levels include all output from lower levels.

## Namespace

```csharp{title="Namespace" description="Namespace" category="Troubleshooting" difficulty="BEGINNER" tags=["Operations", "Observability", "Namespace"]}
using Whizbang.Core.Tracing;
```

## Verbosity Levels

| Level | Value | Description |
|-------|-------|-------------|
| `Off` | 0 | No tracing output |
| `Minimal` | 1 | Errors, failures, and explicitly marked traces only |
| `Normal` | 2 | Command/Event lifecycle stage transitions |
| `Verbose` | 3 | Outbox/Inbox operations, handler discovery |
| `Debug` | 4 | Full payload, timing breakdown, perspectives |

## Level Details

### Off

No tracing output is emitted. Use this in production when tracing overhead must be eliminated entirely.

```csharp{title="Disable Tracing" description="Turn off all trace output" category="Configuration" difficulty="BEGINNER" tags=["Tracing", "Configuration"]}
services.AddWhizbang(options => {
  options.Tracing.Verbosity = TraceVerbosity.Off;
});
```

### Minimal

Emits traces only for:

- Errors and failures
- Handlers or messages explicitly marked with `[WhizbangTrace]`
- Handlers or messages matching patterns in `TracedHandlers` or `TracedMessages`

```csharp{title="Minimal Verbosity" description="Trace only errors and explicit markers" category="Configuration" difficulty="BEGINNER" tags=["Tracing", "Configuration"]}
services.AddWhizbang(options => {
  options.Tracing.Verbosity = TraceVerbosity.Minimal;
  options.Tracing.Components = TraceComponents.Production;

  // Explicitly trace specific handlers
  options.Tracing.TracedHandlers["PaymentReceptor"] = TraceVerbosity.Minimal;
});
```

**Recommended for**: Production environments where you only need error visibility and specific handler monitoring.

### Normal

Includes `Minimal` plus:

- Command and event lifecycle stage transitions
- Handler invocation begin/end markers
- Basic timing information

```csharp{title="Normal Verbosity" description="Include lifecycle transitions" category="Configuration" difficulty="BEGINNER" tags=["Tracing", "Configuration"]}
services.AddWhizbang(options => {
  options.Tracing.Verbosity = TraceVerbosity.Normal;
  options.Tracing.Components = TraceComponents.Handlers | TraceComponents.Lifecycle;
});
```

**Recommended for**: Production environments where you need to track message flow without excessive detail.

### Verbose

Includes `Normal` plus:

- Handler discovery and routing decisions
- Outbox write and delivery operations
- Inbox read and processing operations
- Service resolution details

```csharp{title="Verbose Verbosity" description="Include outbox/inbox and handler discovery" category="Configuration" difficulty="INTERMEDIATE" tags=["Tracing", "Configuration"]}
services.AddWhizbang(options => {
  options.Tracing.Verbosity = TraceVerbosity.Verbose;
  options.Tracing.Components = TraceComponents.AllWithoutWorkers;
});
```

**Recommended for**: Staging environments or debugging message delivery issues.

### Debug

Includes `Verbose` plus:

- Full message payloads (serialized)
- Detailed timing breakdowns
- Perspective state changes
- Internal decision points

```csharp{title="Debug Verbosity" description="Full payload and timing breakdown" category="Configuration" difficulty="INTERMEDIATE" tags=["Tracing", "Configuration"]}
services.AddWhizbang(options => {
  options.Tracing.Verbosity = TraceVerbosity.Debug;
  options.Tracing.Components = TraceComponents.All;
  options.Tracing.EnablePerspectiveEventSpans = true;
});
```

**Recommended for**: Local development and deep debugging. Avoid in production due to performance impact and potential PII exposure.

## Hierarchical Behavior

Higher verbosity levels automatically include all output from lower levels:

```
Debug (4) includes:
  - Verbose (3) which includes:
    - Normal (2) which includes:
      - Minimal (1) which includes:
        - Errors and explicit traces
```

This means setting `TraceVerbosity.Verbose` automatically includes lifecycle transitions (`Normal`) and error traces (`Minimal`).

## Configuration via appsettings.json

```json{title="appsettings.json Verbosity" description="Configure verbosity from configuration" category="Configuration" difficulty="BEGINNER" tags=["Tracing", "Configuration", "JSON"]}
{
  "Whizbang": {
    "Tracing": {
      "Verbosity": "Normal"
    }
  }
}
```

Valid string values: `"Off"`, `"Minimal"`, `"Normal"`, `"Verbose"`, `"Debug"`

## Per-Handler Verbosity Override

Override verbosity for specific handlers regardless of global setting:

```csharp{title="Handler-Specific Verbosity" description="Override verbosity for specific handlers" category="Configuration" difficulty="INTERMEDIATE" tags=["Tracing", "Configuration", "Handlers"]}
services.AddWhizbang(options => {
  options.Tracing.Verbosity = TraceVerbosity.Minimal;  // Global: minimal
  options.Tracing.Components = TraceComponents.Handlers;

  // Override for specific handlers
  options.Tracing.TracedHandlers["PaymentReceptor"] = TraceVerbosity.Debug;
  options.Tracing.TracedHandlers["Order*"] = TraceVerbosity.Verbose;
});
```

## Per-Message Verbosity Override

Override verbosity based on message type:

```csharp{title="Message-Specific Verbosity" description="Override verbosity for specific message types" category="Configuration" difficulty="INTERMEDIATE" tags=["Tracing", "Configuration", "Messages"]}
services.AddWhizbang(options => {
  options.Tracing.Verbosity = TraceVerbosity.Minimal;
  options.Tracing.Components = TraceComponents.Messages;

  // Debug all payment-related messages
  options.Tracing.TracedMessages["*PaymentCommand"] = TraceVerbosity.Debug;
  options.Tracing.TracedMessages["PaymentProcessed"] = TraceVerbosity.Verbose;
});
```

## Verbosity and ShouldTrace

The `TracingOptions.ShouldTrace()` method checks if a trace at a given level should be emitted:

```csharp{title="ShouldTrace Method" description="Check if trace should be emitted at verbosity level" category="Reference" difficulty="ADVANCED" tags=["Tracing", "API"]}
// Returns true if current verbosity meets or exceeds required level
if (options.ShouldTrace(TraceVerbosity.Verbose)) {
  // Emit verbose-level trace
}
```

## Best Practices

### Production

```csharp{title="Production Verbosity" description="Recommended production configuration" category="Best-Practices" difficulty="BEGINNER" tags=["Tracing", "Production"]}
options.Tracing.Verbosity = TraceVerbosity.Minimal;
options.Tracing.Components = TraceComponents.Production;

// Explicitly trace critical paths
options.Tracing.TracedHandlers["PaymentReceptor"] = TraceVerbosity.Normal;
```

### Development

```csharp{title="Development Verbosity" description="Recommended development configuration" category="Best-Practices" difficulty="BEGINNER" tags=["Tracing", "Development"]}
options.Tracing.Verbosity = TraceVerbosity.Debug;
options.Tracing.Components = TraceComponents.AllWithoutWorkers;
```

### Debugging Specific Issues

```csharp{title="Targeted Debugging" description="Debug specific handlers with elevated verbosity" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Tracing", "Debugging"]}
options.Tracing.Verbosity = TraceVerbosity.Minimal;
options.Tracing.TracedHandlers["ProblematicHandler"] = TraceVerbosity.Debug;
```

## See Also

- [Tracing Configuration](./tracing) - Full tracing configuration reference
- [TraceComponents](./tracing#components) - Control which components emit traces
- [WhizbangTrace Attribute](./tracing#explicit-tracing-with-whizbangtrace) - Mark types for explicit tracing
