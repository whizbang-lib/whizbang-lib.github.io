---
title: OpenTelemetry Integration
version: 1.0.0
category: Observability
order: 2
description: >-
  Integrate Whizbang with OpenTelemetry for distributed tracing and metrics
  via message tag hooks - automatic span and metric emission for tagged messages
tags: 'opentelemetry, tracing, metrics, observability, telemetry, tags'
codeReferences:
  - src/Whizbang.Observability/Hooks/OpenTelemetrySpanHook.cs
  - src/Whizbang.Observability/Hooks/OpenTelemetryMetricHook.cs
  - src/Whizbang.Observability/DependencyInjection/ObservabilityTagExtensions.cs
---

# OpenTelemetry Integration

Whizbang integrates with OpenTelemetry through message tag hooks, providing automatic span creation and metric recording for tagged messages. This enables distributed tracing and metrics collection without polluting business logic.

## Quick Start

```csharp{title="Enable OpenTelemetry Hooks" description="Register OpenTelemetry hooks in AddWhizbang" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Observability", "C#", "Enable", "OpenTelemetry"]}
services.AddWhizbang(options => {
  // Register both span and metric hooks
  options.Tags.UseOpenTelemetry();
});

// Configure OpenTelemetry SDK
builder.Services.AddOpenTelemetry()
    .WithTracing(tracing => {
      tracing.AddSource("Whizbang.MessageTags");
    })
    .WithMetrics(metrics => {
      metrics.AddMeter("Whizbang.MessageTags");
    });
```

## Registration {#registration}

### ObservabilityTagExtensions

The `ObservabilityTagExtensions` class provides extension methods for registering OpenTelemetry hooks with the message tag system.

```csharp{title="ObservabilityTagExtensions Methods" description="Extension methods for OpenTelemetry hook registration" category="Reference" difficulty="BEGINNER" tags=["OpenTelemetry", "Registration", "API"]}
services.AddWhizbang(options => {
  // Register all OpenTelemetry hooks (spans + metrics)
  options.Tags.UseOpenTelemetry();

  // Or register individually with custom priority
  options.Tags.UseOpenTelemetryTracing(priority: -50);
  options.Tags.UseOpenTelemetryMetrics(priority: -50);
});
```

### Available Extension Methods

| Method | Description |
|--------|-------------|
| `UseOpenTelemetry()` | Registers both `OpenTelemetrySpanHook` and `OpenTelemetryMetricHook` |
| `UseOpenTelemetryTracing(priority)` | Registers only `OpenTelemetrySpanHook` with optional priority |
| `UseOpenTelemetryMetrics(priority)` | Registers only `OpenTelemetryMetricHook` with optional priority |

### Manual Hook Registration

For custom configuration, register hooks individually:

```csharp{title="Manual Hook Registration" description="Register hooks with custom priority" category="Configuration" difficulty="INTERMEDIATE" tags=["OpenTelemetry", "Registration", "Priority"]}
services.AddWhizbang(options => {
  // Register with specific priority (lower runs first)
  options.Tags.UseHook<TelemetryTagAttribute, OpenTelemetrySpanHook>(priority: -100);
  options.Tags.UseHook<MetricTagAttribute, OpenTelemetryMetricHook>(priority: -100);
});
```

## OpenTelemetrySpanHook

The `OpenTelemetrySpanHook` creates OpenTelemetry spans for messages marked with `TelemetryTagAttribute`.

### Usage

```csharp{title="TelemetryTag Usage" description="Mark events for OpenTelemetry span creation" category="Usage" difficulty="BEGINNER" tags=["OpenTelemetry", "Spans", "Telemetry"]}
// Mark an event for telemetry
[TelemetryTag(
    Tag = "payment-processed",
    SpanName = "ProcessPayment",
    Kind = SpanKind.Internal)]
public record PaymentProcessedEvent(
    Guid PaymentId,
    decimal Amount,
    string Currency) : IEvent;

// Include specific properties in span attributes
[TelemetryTag(
    Tag = "order-created",
    SpanName = "CreateOrder",
    Properties = ["OrderId", "CustomerId", "Total"])]
public record OrderCreatedEvent(
    Guid OrderId,
    Guid CustomerId,
    decimal Total,
    string InternalNotes) : IEvent;  // InternalNotes NOT included in span
```

### TelemetryTagAttribute Properties

| Property | Type | Description |
|----------|------|-------------|
| `Tag` | `string` | Required unique identifier for the telemetry event |
| `SpanName` | `string?` | OpenTelemetry span name (defaults to `Tag` if not specified) |
| `Kind` | `SpanKind` | Span kind for tracing (default: `Internal`) |
| `Properties` | `string[]?` | Properties to extract into span attributes |
| `RecordAsEvent` | `bool` | Also record as an Activity event (default: `false`) |

### SpanKind Values

| Value | Description |
|-------|-------------|
| `Internal` | Internal operation within a service (default) |
| `Server` | Server-side handling of a request |
| `Client` | Client-side of an outgoing request |
| `Producer` | Initiator of an asynchronous message |
| `Consumer` | Handler of an asynchronous message |

### Generated Span Attributes

The hook automatically adds these span attributes:

| Attribute | Description |
|-----------|-------------|
| `messaging.system` | Always `"whizbang"` |
| `messaging.operation` | Always `"process"` |
| `whizbang.tag` | The tag identifier |
| `whizbang.message_type` | Full type name of the message |
| `whizbang.scope.*` | Scope values (tenant, user, etc.) |
| `whizbang.payload.*` | Extracted property values |

### Example Span Output

```json{title="Example Span" description="OpenTelemetry span generated by hook" category="Example" difficulty="BEGINNER" tags=["OpenTelemetry", "Spans", "Example"]}
{
  "traceId": "abc123...",
  "spanId": "def456...",
  "name": "ProcessPayment",
  "kind": "INTERNAL",
  "attributes": {
    "messaging.system": "whizbang",
    "messaging.operation": "process",
    "whizbang.tag": "payment-processed",
    "whizbang.message_type": "MyApp.Events.PaymentProcessedEvent",
    "whizbang.scope.tenantid": "tenant-123",
    "whizbang.scope.userid": "user-456",
    "whizbang.payload.paymentid": "pay-789",
    "whizbang.payload.amount": "99.99",
    "whizbang.payload.currency": "USD"
  }
}
```

## OpenTelemetryMetricHook {#metrics}

The `OpenTelemetryMetricHook` records metrics for messages marked with `MetricTagAttribute`.

### Usage

```csharp{title="MetricTag Usage" description="Mark events for OpenTelemetry metric recording" category="Usage" difficulty="BEGINNER" tags=["OpenTelemetry", "Metrics", "Telemetry"]}
// Counter metric - increments on each event
[MetricTag(
    Tag = "order-created",
    MetricName = "orders.created",
    Type = MetricType.Counter)]
public record OrderCreatedEvent(Guid OrderId, string TenantId) : IEvent;

// Histogram metric - records a value from the event
[MetricTag(
    Tag = "order-amount",
    MetricName = "orders.amount",
    Type = MetricType.Histogram,
    ValueProperty = "Amount",
    Unit = "USD")]
public record OrderCompletedEvent(
    Guid OrderId,
    decimal Amount,
    string TenantId) : IEvent;

// Counter with dimensions
[MetricTag(
    Tag = "payment-processed",
    MetricName = "payments.processed",
    Type = MetricType.Counter,
    Properties = ["PaymentMethod", "Currency"])]
public record PaymentProcessedEvent(
    Guid PaymentId,
    string PaymentMethod,
    string Currency) : IEvent;
```

### MetricTagAttribute Properties

| Property | Type | Description |
|----------|------|-------------|
| `Tag` | `string` | Required unique identifier |
| `MetricName` | `string` | Metric name for monitoring system |
| `Type` | `MetricType` | Type of metric to record |
| `ValueProperty` | `string?` | Property to extract value from (for Histogram/Gauge) |
| `Unit` | `string?` | Optional unit of measurement |
| `Properties` | `string[]?` | Properties to use as metric dimensions |

### MetricType Values

| Value | Description |
|-------|-------------|
| `Counter` | Monotonically increasing value (e.g., request count) |
| `Histogram` | Distribution of values (e.g., response times, amounts) |
| `Gauge` | Point-in-time value (e.g., queue depth) |

### Metric Dimensions

Properties specified in `Properties` array become metric dimensions:

```csharp{title="Metric Dimensions" description="Add dimensions to metrics for segmentation" category="Usage" difficulty="INTERMEDIATE" tags=["OpenTelemetry", "Metrics", "Dimensions"]}
[MetricTag(
    Tag = "api-call",
    MetricName = "api.requests",
    Type = MetricType.Counter,
    Properties = ["Endpoint", "Method", "StatusCode"])]
public record ApiRequestCompletedEvent(
    string Endpoint,
    string Method,
    int StatusCode,
    double DurationMs) : IEvent;

// Generates metric with dimensions:
// api.requests{endpoint="/api/orders",method="POST",statuscode="200"} = 1
```

### Scope Dimensions

Scope values (tenant, user, correlation ID) are automatically added as dimensions:

```csharp{title="Scope Dimensions" description="Automatic scope-based metric dimensions" category="Usage" difficulty="INTERMEDIATE" tags=["OpenTelemetry", "Metrics", "Scope"]}
// Event with metric tag
[MetricTag(Tag = "order-created", MetricName = "orders.created", Type = MetricType.Counter)]
public record OrderCreatedEvent(Guid OrderId) : IEvent;

// When processed with scope:
// scope = { TenantId = "tenant-123", UserId = "user-456" }

// Generates metric with scope dimensions:
// orders.created{tenantid="tenant-123",userid="user-456"} = 1
```

## Complete Integration Example

```csharp{title="Complete OpenTelemetry Setup" description="Full OpenTelemetry integration with Whizbang" category="Example" difficulty="INTERMEDIATE" tags=["OpenTelemetry", "Configuration", "Example"]}
// Program.cs
var builder = WebApplication.CreateBuilder(args);

// Configure OpenTelemetry
builder.Services.AddOpenTelemetry()
    .WithTracing(tracing => {
      tracing.AddSource("Whizbang.Tracing");      // Tracer spans
      tracing.AddSource("Whizbang.MessageTags");  // Tag hook spans
      tracing.AddOtlpExporter();
    })
    .WithMetrics(metrics => {
      metrics.AddMeter("Whizbang.MessageTags");   // Tag hook metrics
      metrics.AddOtlpExporter();
    });

// Configure Whizbang
builder.Services.AddWhizbang(options => {
  // Enable handler-level tracing
  options.Tracing.Verbosity = TraceVerbosity.Normal;
  options.Tracing.Components = TraceComponents.Handlers | TraceComponents.Errors;
  options.Tracing.EnableOpenTelemetry = true;

  // Enable tag-based telemetry
  options.Tags.UseOpenTelemetry();
});
```

```csharp{title="Tagged Events" description="Events with telemetry and metric tags" category="Example" difficulty="BEGINNER" tags=["OpenTelemetry", "Events", "Tags"]}
// Telemetry for distributed tracing
[TelemetryTag(
    Tag = "order-submitted",
    SpanName = "SubmitOrder",
    Kind = SpanKind.Producer,
    Properties = ["OrderId", "CustomerId"])]
// Metric for monitoring
[MetricTag(
    Tag = "order-submitted-metric",
    MetricName = "orders.submitted",
    Type = MetricType.Counter)]
public record OrderSubmittedEvent(
    Guid OrderId,
    Guid CustomerId,
    decimal TotalAmount) : IEvent;

[TelemetryTag(Tag = "order-completed", SpanName = "CompleteOrder")]
[MetricTag(
    Tag = "order-amount",
    MetricName = "orders.revenue",
    Type = MetricType.Histogram,
    ValueProperty = "TotalAmount",
    Unit = "USD",
    Properties = ["Currency"])]
public record OrderCompletedEvent(
    Guid OrderId,
    decimal TotalAmount,
    string Currency) : IEvent;
```

## Aspire Dashboard Integration

For .NET Aspire projects, traces and metrics appear automatically in the Aspire dashboard:

```csharp{title="Aspire Integration" description="Configure OpenTelemetry for Aspire dashboard" category="Configuration" difficulty="BEGINNER" tags=["OpenTelemetry", "Aspire", "Configuration"]}
// ServiceDefaults project
public static IHostApplicationBuilder AddServiceDefaults(
    this IHostApplicationBuilder builder) {

  builder.ConfigureOpenTelemetry();

  builder.Services.AddOpenTelemetry()
      .WithTracing(tracing => {
        tracing.AddSource("Whizbang.Tracing");
        tracing.AddSource("Whizbang.MessageTags");
      })
      .WithMetrics(metrics => {
        metrics.AddMeter("Whizbang.MessageTags");
      });

  return builder;
}
```

## Best Practices

### Tagging Strategy

```csharp{title="Tagging Best Practices" description="Recommended patterns for telemetry tags" category="Best-Practices" difficulty="INTERMEDIATE" tags=["OpenTelemetry", "Best-Practices", "Tags"]}
// DO: Use descriptive, consistent tag names
[TelemetryTag(Tag = "orders.payment-processed", SpanName = "ProcessOrderPayment")]

// DO: Include relevant properties for debugging
[TelemetryTag(Tag = "order-created", Properties = ["OrderId", "CustomerId"])]

// DO: Use appropriate span kinds
[TelemetryTag(Tag = "external-api-call", Kind = SpanKind.Client)]
[TelemetryTag(Tag = "message-published", Kind = SpanKind.Producer)]
[TelemetryTag(Tag = "message-consumed", Kind = SpanKind.Consumer)]

// DO: Add meaningful dimensions to metrics
[MetricTag(MetricName = "api.latency", Properties = ["Endpoint", "Method"])]

// DON'T: Include sensitive data in properties
// [TelemetryTag(Properties = ["CreditCardNumber"])]  // Bad!

// DON'T: Create high-cardinality dimensions
// [MetricTag(Properties = ["RequestId"])]  // Bad - unique per request!
```

### Performance Considerations

1. **Limit Properties**: Only include essential properties - each adds overhead
2. **Avoid High Cardinality**: Metric dimensions with many unique values (e.g., request IDs) cause memory issues
3. **Use Sampling**: Configure OpenTelemetry sampling for high-volume services
4. **Scope Dimensions**: Be mindful that scope values become dimensions automatically

## See Also

- [Tracing](./tracing) - Handler-level distributed tracing
- [Message Tags](../../fundamentals/messages/message-tags) - Tag system overview
- [Observability & Message Hops](../../fundamentals/persistence/observability) - Hop-based tracing
