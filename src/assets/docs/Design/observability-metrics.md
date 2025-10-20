---
title: Observability & Metrics
category: Architecture & Design
order: 14
tags: observability, metrics, opentelemetry, monitoring, performance
---

# Observability & Metrics

Whizbang provides comprehensive observability with policy-driven metrics collection, OpenTelemetry integration, and custom field attributes for rich monitoring and debugging capabilities.

## Metrics Architecture

### Default Metrics (Always Enabled)

**Core performance and health metrics** essential for operation:

```csharp
// Command metrics
whizbang_command_duration_seconds{command_type, domain, handler_type, status}
whizbang_command_total{command_type, domain, status}

// Event metrics  
whizbang_event_published_total{event_type, domain, source_handler}
whizbang_event_processing_duration_seconds{event_type, handler_type, status}

// Projection metrics
whizbang_projection_lag_seconds{projection_name, partition}
whizbang_projection_events_processed_total{projection_name, event_type}
whizbang_projection_errors_total{projection_name, error_type}

// Infrastructure metrics
whizbang_event_store_append_duration_seconds{driver_type, operation}
whizbang_message_broker_publish_duration_seconds{broker_type, topic}
whizbang_message_broker_consume_duration_seconds{broker_type, topic}

// System health
whizbang_active_handlers_total{handler_type}
whizbang_memory_usage_bytes{component}
whizbang_cpu_usage_percent{component}
```

### Observability Levels

**Configurable detail levels** for different scenarios:

```csharp
public enum ObservabilityLevel {
    Minimal,    // Only essential metrics + errors
    Standard,   // Default metrics + basic timing
    Detailed,   // Additional context + custom fields  
    Verbose,    // Everything + debug information
    Debug       // Maximum detail for troubleshooting
}

services.AddWhizbang(options => {
    options.Policies(policies => {
        // Default observability configuration
        policies.When(ctx => true) // Matches all contexts
                .Then(config => config.SetObservabilityLevel(ObservabilityLevel.Standard))
                .And(config => config.EnableCustomFields());
        
        // Environment-specific policies
        policies.When(ctx => ctx.IsEnvironment("production"))
                .Then(config => config.SetObservabilityLevel(ObservabilityLevel.Standard))
                .And(config => config.SetSampleRate(0.1)); // 10% sampling in production
        
        policies.When(ctx => ctx.IsEnvironment("development"))
                .Then(config => config.SetObservabilityLevel(ObservabilityLevel.Verbose))
                .And(config => config.SetSampleRate(1.0)); // Full sampling in development
    });
});
```

## Policy-Driven Observability

### Context-Aware Metrics Collection

**Dynamic observability** based on message context and policies:

```csharp
services.AddWhizbang(options => {
    options.Observability(obs => {
        obs.Policies(policies => {
            // Verbose logging for critical customer journeys
            policies.When(ctx => ctx.HasTag("customer-vip"))
                    .Then(action => action.SetObservabilityLevel(ObservabilityLevel.Verbose))
                    .And(action => action.CaptureCustomFields())
                    .And(action => action.EnableDistributedTracing());
            
            // Detailed metrics for flagged debugging sessions
            policies.When(ctx => ctx.HasFlag(WhizbangFlags.VerboseOtel))
                    .Then(action => action.SetObservabilityLevel(ObservabilityLevel.Debug))
                    .And(action => action.CaptureMethodParameters())
                    .And(action => action.CaptureReturnValues());
                    
            // Minimal overhead for load testing
            policies.When(ctx => ctx.HasFlag(WhizbangFlags.LoadTesting))
                    .Then(action => action.SetObservabilityLevel(ObservabilityLevel.Minimal))
                    .And(action => action.DisableSlowMetrics());
                    
            // Enhanced monitoring for production critical paths
            policies.When(ctx => ctx.HasTag("critical-path") && ctx.HasFlag(WhizbangFlags.Production))
                    .Then(action => action.SetObservabilityLevel(ObservabilityLevel.Detailed))
                    .And(action => action.EnablePerformanceBudgetTracking())
                    .And(action => action.AlertOnAnomalies());
        });
    });
});
```

### Adaptive Sampling

**Smart sampling** based on context and system load:

```csharp
public class AdaptiveObservabilityPolicy : IObservabilityPolicy {
    public async Task<ObservabilityConfig> GetConfigAsync(MessageContext context) {
        var config = new ObservabilityConfig();
        
        // Always capture errors
        if (context.HasError) {
            config.Level = ObservabilityLevel.Verbose;
            config.SampleRate = 1.0;
            return config;
        }
        
        // Adaptive sampling based on system load
        var systemLoad = await _systemMetrics.GetCurrentLoadAsync();
        if (systemLoad > 0.8) {
            config.SampleRate = 0.01; // 1% when system is under stress
        } else if (systemLoad > 0.5) {
            config.SampleRate = 0.1;  // 10% when system is busy
        } else {
            config.SampleRate = 0.5;  // 50% when system is idle
        }
        
        // VIP customers always get full tracking
        if (context.HasTag("customer-vip")) {
            config.SampleRate = 1.0;
            config.Level = ObservabilityLevel.Detailed;
        }
        
        return config;
    }
}
```

## Custom Field Attributes

### Source Generation for Rich Metrics

**Automatically include relevant fields** in metrics via attributes:

```csharp
// Command with observability annotations
public record PlaceOrder(
    Guid OrderId,
    
    [ObservabilityField(MetricType.Label)] 
    Guid CustomerId,    // Include as metric label
    
    [ObservabilityField(MetricType.Measure)] 
    decimal Total,      // Include as measured value
    
    [ObservabilityField(MetricType.Label, Transform = "Range")] 
    decimal Total2,     // Transform to range (0-100, 100-500, etc.)
    
    [ObservabilityField(MetricType.Context)]
    string Region,      // Include in trace context only
    
    List<OrderItem> Items, // Not annotated - not included
    
    [SensitiveData]
    string PaymentToken // Marked sensitive - never included
);

// Generated metrics include custom fields
// whizbang_command_total{command_type="PlaceOrder", customer_id="123", total_range="100-500", region="us-west"}
// whizbang_command_duration_seconds{command_type="PlaceOrder", customer_id="123", total_range="100-500"}
```

### Field Transformation Options

**Smart field transformations** for better cardinality management:

```csharp
public enum FieldTransform {
    None,           // Use raw value
    Range,          // Convert numbers to ranges (0-100, 100-500, etc.)
    Hash,           // Hash sensitive identifiers
    Truncate,       // Truncate long strings
    Sanitize,       // Remove sensitive parts
    Category        // Map to predefined categories
}

[ObservabilityField(MetricType.Label, Transform = FieldTransform.Range, Ranges = "0,100,500,1000,5000")]
public decimal Total { get; set; }

[ObservabilityField(MetricType.Label, Transform = FieldTransform.Hash)]
public string CustomerId { get; set; } // Becomes hash for privacy

[ObservabilityField(MetricType.Label, Transform = FieldTransform.Category, 
    Categories = "standard,premium,enterprise")]
public string CustomerTier { get; set; }
```

### Generated Metric Collection

**Source generator creates metric collection code**:

```csharp
// Generated metric collection for PlaceOrder
[GeneratedCode("Whizbang.SourceGenerator")]
public partial class PlaceOrderMetricsCollector {
    public static void RecordCommandExecution(PlaceOrder command, CommandResult result, TimeSpan duration) {
        var labels = new Dictionary<string, object> {
            ["command_type"] = "PlaceOrder",
            ["customer_id"] = command.CustomerId.ToString(),
            ["total_range"] = TransformToRange(command.Total, new[] { 0, 100, 500, 1000, 5000 }),
            ["region"] = command.Region,
            ["status"] = result.Success ? "success" : "failure"
        };
        
        _commandDurationHistogram.Record(duration.TotalSeconds, labels);
        _commandTotalCounter.Add(1, labels);
        
        if (!result.Success) {
            _commandErrorsCounter.Add(1, labels.Concat(new[] {
                new KeyValuePair<string, object>("error_type", result.ErrorType)
            }));
        }
    }
    
    private static string TransformToRange(decimal value, decimal[] ranges) {
        for (int i = 0; i < ranges.Length - 1; i++) {
            if (value >= ranges[i] && value < ranges[i + 1]) {
                return $"{ranges[i]}-{ranges[i + 1]}";
            }
        }
        return $"{ranges[^1]}+";
    }
}
```

## OpenTelemetry Integration

### Comprehensive Instrumentation

**Full OpenTelemetry implementation** with Whizbang-specific semantics:

```csharp
services.AddWhizbang(options => {
    options.UseOpenTelemetry(otel => {
        otel.ConfigureTracing(tracing => {
            tracing.AddWhizbangInstrumentation()
                   .AddAspNetCoreInstrumentation()
                   .AddHttpClientInstrumentation()
                   .AddEntityFrameworkCoreInstrumentation();
                   
            // Whizbang-specific trace attributes
            tracing.SetSampler(new WhizbangAdaptiveSampler());
            tracing.AddProcessor<WhizbangSpanProcessor>();
        });
        
        otel.ConfigureMetrics(metrics => {
            metrics.AddWhizbangInstrumentation()
                   .AddRuntimeInstrumentation()
                   .AddAspNetCoreInstrumentation();
                   
            // Custom metric providers
            metrics.AddMeter("Whizbang.Commands");
            metrics.AddMeter("Whizbang.Events");
            metrics.AddMeter("Whizbang.Projections");
        });
        
        otel.ConfigureLogs(logs => {
            logs.AddWhizbangInstrumentation()
                .AddConsoleExporter()
                .AddOpenTelemetryProtocolExporter();
        });
    });
});
```

### Semantic Conventions

**Whizbang-specific OpenTelemetry semantic conventions**:

```csharp
public static class WhizbangSemanticConventions {
    // Span attributes
    public const string CommandType = "whizbang.command.type";
    public const string EventType = "whizbang.event.type";
    public const string ProjectionName = "whizbang.projection.name";
    public const string Domain = "whizbang.domain";
    public const string StreamId = "whizbang.stream.id";
    public const string StreamVersion = "whizbang.stream.version";
    public const string CorrelationId = "whizbang.correlation.id";
    public const string TenantId = "whizbang.tenant.id";
    
    // Metric attributes
    public const string HandlerType = "whizbang.handler.type";
    public const string DriverType = "whizbang.driver.type";
    public const string PolicyName = "whizbang.policy.name";
    public const string FlagValue = "whizbang.flags";
    
    // Resource attributes
    public const string ServiceDomain = "whizbang.service.domain";
    public const string ServiceVersion = "whizbang.service.version";
    public const string LibraryVersion = "whizbang.library.version";
}

// Usage in instrumentation
public class WhizbangCommandInstrumentation : IDisposable {
    public Activity? StartCommandActivity<T>(T command, MessageContext context) where T : ICommand {
        var activity = Activity.StartActivity($"Command {typeof(T).Name}");
        
        activity?.SetTag(WhizbangSemanticConventions.CommandType, typeof(T).Name);
        activity?.SetTag(WhizbangSemanticConventions.Domain, context.Domain);
        activity?.SetTag(WhizbangSemanticConventions.CorrelationId, context.CorrelationId);
        
        if (context.TenantId != null) {
            activity?.SetTag(WhizbangSemanticConventions.TenantId, context.TenantId);
        }
        
        // Add custom fields from annotations
        AddCustomFields(activity, command);
        
        return activity;
    }
}
```

## Performance Budget Integration

### Budget-Aware Observability

**Automatic performance budget tracking** with alerts:

```csharp
services.AddWhizbang(options => {
    options.Policies(policies => {
        // Performance budgets for specific handlers
        policies.When(ctx => ctx.MatchesHandler<PlaceOrderHandler>())
                .Then(config => config.SetPerformanceBudget(new PerformanceBudget {
                    MaxLatency = TimeSpan.FromMilliseconds(100),
                    MaxMemoryMB = 10,
                    MaxCpuMs = 50
                }))
                .And(config => config.OnBudgetViolation(async (violation) => {
                    // Increase observability for budget violations
                    await _observabilityService.IncreaseDetailLevel(
                        violation.HandlerType, 
                        ObservabilityLevel.Debug,
                        duration: TimeSpan.FromMinutes(10)
                    );
                    
                    // Alert on violations
                    await _alerting.SendBudgetViolationAlert(violation);
                }));
        
        // Default budget tracking settings
        policies.When(ctx => true) // Matches all contexts
                .Then(config => config.EnableBudgetTracking())
                .And(config => config.SetBudgetViolationSampleRate(1.0)); // Always capture violations
    });
});

// Generated budget tracking metrics
whizbang_performance_budget_violation_total{handler_type, budget_type, severity}
whizbang_performance_budget_utilization_ratio{handler_type, budget_type}
whizbang_performance_budget_headroom_seconds{handler_type}
```

## Distributed Tracing

### W3C Trace Context Propagation

**Standards-compliant distributed tracing**:

```csharp
public class WhizbangTraceContextPropagator : IMessageInterceptor {
    public async Task<TResponse> Intercept<TRequest, TResponse>(
        TRequest message,
        MessageContext context,
        MessageHandlerDelegate<TRequest, TResponse> next) {
        
        // Extract W3C trace context from message headers
        var traceParent = context.Headers.GetValueOrDefault("traceparent");
        var traceState = context.Headers.GetValueOrDefault("tracestate");
        
        Activity? activity = null;
        
        if (traceParent != null) {
            // Continue existing trace
            var traceContext = W3CTraceContext.Parse(traceParent, traceState);
            activity = Activity.StartActivity($"Handle {typeof(TRequest).Name}");
            activity?.SetParentId(traceContext.TraceId, traceContext.SpanId);
        } else {
            // Start new trace
            activity = Activity.StartActivity($"Handle {typeof(TRequest).Name}");
        }
        
        // Add Whizbang-specific context
        activity?.SetTag(WhizbangSemanticConventions.CommandType, typeof(TRequest).Name);
        activity?.SetTag(WhizbangSemanticConventions.CorrelationId, context.CorrelationId);
        activity?.SetTag(WhizbangSemanticConventions.Domain, context.Domain);
        
        // Enhance trace state with Whizbang context
        var enhancedTraceState = EnhanceTraceState(traceState, context);
        activity?.SetTag("tracestate", enhancedTraceState);
        
        try {
            var response = await next(message, context);
            activity?.SetTag("status", "success");
            return response;
        } catch (Exception ex) {
            activity?.SetTag("status", "error");
            activity?.SetTag("error.type", ex.GetType().Name);
            activity?.SetTag("error.message", ex.Message);
            throw;
        } finally {
            activity?.Dispose();
        }
    }
    
    private string EnhanceTraceState(string? existingTraceState, MessageContext context) {
        var whizbangState = new List<string>();
        
        if (context.CorrelationId != null) {
            whizbangState.Add($"correlation-id:{context.CorrelationId}");
        }
        
        if (context.Domain != null) {
            whizbangState.Add($"domain:{context.Domain}");
        }
        
        if (context.Flags != WhizbangFlags.None) {
            whizbangState.Add($"flags:{(long)context.Flags}");
        }
        
        var newTraceState = $"whizbang={string.Join(",", whizbangState)}";
        
        return string.IsNullOrEmpty(existingTraceState) 
            ? newTraceState 
            : $"{existingTraceState},{newTraceState}";
    }
}
```

## Monitoring Dashboards

### Pre-built Dashboard Configurations

**Ready-to-use monitoring dashboards** for popular platforms:

```json
// Grafana dashboard configuration
{
  "dashboard": {
    "title": "Whizbang Application Metrics",
    "panels": [
      {
        "title": "Command Processing Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(whizbang_command_total[5m])",
            "legendFormat": "{{command_type}} ({{domain}})"
          }
        ]
      },
      {
        "title": "Projection Lag",
        "type": "graph",
        "targets": [
          {
            "expr": "whizbang_projection_lag_seconds",
            "legendFormat": "{{projection_name}}"
          }
        ],
        "thresholds": [
          { "value": 300, "color": "yellow" },
          { "value": 600, "color": "red" }
        ]
      },
      {
        "title": "Performance Budget Violations",
        "type": "table",
        "targets": [
          {
            "expr": "increase(whizbang_performance_budget_violation_total[1h])",
            "format": "table"
          }
        ]
      }
    ]
  }
}
```

### Alert Rules

**Production-ready alerting rules**:

```yaml
# Prometheus alerting rules
groups:
  - name: whizbang.rules
    rules:
      - alert: ProjectionLagHigh
        expr: whizbang_projection_lag_seconds > 300
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Projection {{ $labels.projection_name }} is lagging"
          description: "Projection {{ $labels.projection_name }} has been lagging behind by {{ $value }} seconds for more than 5 minutes"
      
      - alert: CommandErrorRateHigh
        expr: rate(whizbang_command_errors_total[5m]) / rate(whizbang_command_total[5m]) > 0.05
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "High command error rate for {{ $labels.command_type }}"
          description: "Command {{ $labels.command_type }} error rate is {{ $value | humanizePercentage }}"
          
      - alert: PerformanceBudgetViolation
        expr: increase(whizbang_performance_budget_violation_total[10m]) > 5
        for: 0m
        labels:
          severity: warning
        annotations:
          summary: "Performance budget violations for {{ $labels.handler_type }}"
          description: "Handler {{ $labels.handler_type }} has violated its performance budget {{ $value }} times in the last 10 minutes"
```

## Best Practices

### Metric Design

1. **Control cardinality** - Avoid high-cardinality labels
2. **Use transformations** - Convert IDs to ranges or categories
3. **Standardize naming** - Follow OpenTelemetry conventions
4. **Include context** - Domain, tenant, and correlation information
5. **Monitor overhead** - Track observability performance impact

### Policy Configuration

1. **Start conservative** - Begin with standard observability level
2. **Use adaptive sampling** - Reduce overhead under load
3. **Prioritize critical paths** - Enhanced monitoring for important flows
4. **Handle errors specially** - Always capture error scenarios
5. **Regular review** - Adjust policies based on insights

### Dashboard Organization

1. **Layer dashboards** - Overview → Domain → Handler specific
2. **Use SLOs** - Define and track service level objectives
3. **Alert on trends** - Early warning indicators
4. **Include business metrics** - Connect technical to business impact
5. **Regular maintenance** - Keep dashboards current and useful

---

## Related Documentation

- [**Policy Engine**](./policy-engine.md) - How policies drive observability
- [**Flags & Tags System**](./flags-tags-system.md) - Cross-service context propagation
- [**Testing & Development Tools**](./testing-development-tools.md) - Testing observability features
- [**Deployment & Operations**](./deployment-operations.md) - Production monitoring setup