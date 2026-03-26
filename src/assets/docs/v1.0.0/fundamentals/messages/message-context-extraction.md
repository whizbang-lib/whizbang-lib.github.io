---
title: Message Context Extraction
version: 1.0.0
category: Core Concepts
order: 7
description: >-
  Extract trace context and security scope from message envelopes using
  EnvelopeContextExtractor - the single source of truth for context extraction
tags: 'context-extraction, envelope, tracing, opentelemetry, scope, security, hops'
codeReferences:
  - src/Whizbang.Core/Observability/EnvelopeContextExtractor.cs
---

# Message Context Extraction

`EnvelopeContextExtractor` is a static helper that extracts both **tracing context** (OpenTelemetry `ActivityContext`) and **security scope** (`IScopeContext`) from message envelope hops. It consolidates extraction logic that would otherwise be duplicated across workers, invokers, and consumers.

## Why a Dedicated Extractor?

Message envelopes carry a list of `MessageHop` entries - each hop records metadata about the message at a point in its journey. Extracting usable context from these hops requires:

1. **Trace context**: Parsing `TraceParent` from the last hop for distributed tracing
2. **Security scope**: Merging `ScopeDelta` from all "Current" hops to rebuild the full `IScopeContext`

Without `EnvelopeContextExtractor`, every worker and invoker would repeat this logic. The extractor provides a **single source of truth**.

---

## API

### ExtractedContext

The extraction result is a lightweight readonly record struct:

```csharp{title="ExtractedContext" description="Result of extracting context from envelope hops" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Messages", "Extraction", "ExtractedContext"]}
public readonly record struct ExtractedContext(
    ActivityContext TraceContext,  // For OpenTelemetry trace correlation
    IScopeContext? Scope);        // Security scope (null if none found)
```

### ExtractFromEnvelope

The primary entry point - extracts context directly from an envelope:

```csharp{title="ExtractFromEnvelope" description="Extract context from a message envelope" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Messages", "Extraction", "Envelope"]}
public static ExtractedContext ExtractFromEnvelope(IMessageEnvelope envelope);
```

### ExtractFromHops

Lower-level method when you already have the hop list:

```csharp{title="ExtractFromHops" description="Extract context from message hops" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Messages", "Extraction", "Hops"]}
public static ExtractedContext ExtractFromHops(IReadOnlyList<MessageHop>? hops);
```

Returns `default` `ActivityContext` and `null` scope when hops is null or empty.

### Focused Extractors

For cases where only one type of context is needed:

```csharp{title="Focused Extractors" description="Extract trace or scope context individually" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Extraction", "Trace", "Scope"]}
// Trace context only (ActivityContext from last hop's TraceParent)
public static ActivityContext ExtractTraceContext(IReadOnlyList<MessageHop>? hops);

// Security scope only (merged ScopeDelta from all Current hops)
public static IScopeContext? ExtractScope(IReadOnlyList<MessageHop>? hops);
```

---

## How Extraction Works

### Trace Context Extraction

Distributed tracing relies on W3C `traceparent` headers. The extractor reads `TraceParent` from the **last hop** that has one, linking the worker's processing span back to the original HTTP request:

```
Hop 1: TraceParent = "00-abc...def-1234...5678-01"  (HTTP origin)
Hop 2: TraceParent = null                            (internal hop)
Hop 3: TraceParent = "00-abc...def-9abc...def0-01"  (outbox publish)
                                        ↑
                              ExtractTraceContext uses this one
```

The extracted `ActivityContext` is used to set the parent for new `Activity` spans, preserving the distributed trace across service boundaries.

### Security Scope Extraction

Security context is rebuilt by **merging `ScopeDelta`** from all hops where `Type == HopType.Current`:

```
Hop 1 (Current): ScopeDelta { UserId = "alice", TenantId = "acme" }
Hop 2 (Current): ScopeDelta { Roles = ["Admin"], Permissions = [...] }
                        ↓
               MergedScope = ApplyTo() chain
                        ↓
         ImmutableScopeContext(mergedScope, shouldPropagate: true)
```

The merged scope is wrapped in an `ImmutableScopeContext` with `ShouldPropagate = true`, enabling security context to cascade to child messages via `CascadeContext.GetSecurityFromAmbient()`.

---

## Usage

### In a Worker or Consumer

```csharp{title="Worker Usage" description="Extracting context in a message worker" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Extraction", "Worker"]}
public class OrderEventWorker {
    public async Task ProcessAsync(IMessageEnvelope envelope, CancellationToken ct) {
        // Extract both trace and security context
        var extracted = EnvelopeContextExtractor.ExtractFromEnvelope(envelope);

        // Link OpenTelemetry span to original trace
        using var activity = ActivitySource.StartActivity(
            "ProcessOrderEvent",
            ActivityKind.Consumer,
            extracted.TraceContext);

        // Set ambient security scope
        if (extracted.Scope is not null) {
            ScopeContextAccessor.CurrentContext = extracted.Scope;
        }

        // Process the message with full context available
        await HandleOrderEventAsync(envelope, ct);
    }
}
```

### Trace Context Only

```csharp{title="Trace Context Only" description="Extracting only trace context for telemetry" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Extraction", "Trace"]}
var traceContext = EnvelopeContextExtractor.ExtractTraceContext(envelope.Hops);

using var activity = ActivitySource.StartActivity(
    "MyOperation",
    ActivityKind.Consumer,
    traceContext);
```

### Security Scope Only

```csharp{title="Security Scope Only" description="Extracting only security scope" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Extraction", "Scope"]}
var scope = EnvelopeContextExtractor.ExtractScope(envelope.Hops);

if (scope is not null) {
    var tenantId = scope.Scope.TenantId;
    var userId = scope.Scope.UserId;
    // Use for authorization or multi-tenant filtering
}
```

---

## Integration with CascadeContext

`EnvelopeContextExtractor` and `CascadeContextFactory` work together but serve different roles:

| Concern | Tool | Purpose |
|---------|------|---------|
| **Extract** trace + scope from hops | `EnvelopeContextExtractor` | Low-level hop parsing |
| **Create** propagation context for children | `CascadeContextFactory` | High-level context creation with enrichment |

`CascadeContextFactory.FromEnvelope()` uses envelope-level APIs (`GetCorrelationId()`, `GetCurrentScope()`) rather than calling `EnvelopeContextExtractor` directly. The extractor is primarily used by workers and invokers that need the raw `ActivityContext` and `IScopeContext` for ambient setup before processing begins.

---

## Best Practices

### DO

- Use `ExtractFromEnvelope` as the default entry point
- Set `ScopeContextAccessor.CurrentContext` from the extracted scope before processing
- Link `ActivityContext` to new spans for end-to-end distributed tracing
- Handle null scope gracefully (unauthenticated or system messages have no scope)

### DON'T

- Manually parse `TraceParent` strings - let the extractor handle `ActivityContext.TryParse`
- Skip scope extraction in workers - downstream code may rely on ambient security
- Assume hops are always present - the extractor safely returns defaults for null/empty hops

---

## Further Reading

- [Cascade Context & Security Propagation](cascade-context.md) - How extracted context feeds into child message creation
- [Message Context & Tracing](message-context.md) - MessageId, CorrelationId, CausationId fundamentals
- [Message Envelopes](../../messaging/message-envelopes.md) - Hop structure and envelope lifecycle

---

*Version 1.0.0 - Foundation Release | Last Updated: 2026-03-26*
