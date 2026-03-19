---
title: Monitoring & Observability
version: 1.0.0
category: Advanced Topics
order: 6
description: >-
  Application monitoring - Application Insights, Prometheus, distributed
  tracing, metrics, and dashboards
tags: 'monitoring, observability, application-insights, prometheus, tracing, metrics'
---

# Monitoring & Observability

Comprehensive **monitoring and observability** for Whizbang applications - Application Insights, Prometheus metrics, distributed tracing, health checks, and dashboards.

---

## Observability Pillars

| Pillar | Tool | Purpose |
|--------|------|---------|
| **Logs** | Application Insights | Structured logging and queries |
| **Metrics** | Prometheus + Grafana | Time-series metrics and dashboards |
| **Traces** | Application Insights | Distributed tracing across services |
| **Health** | ASP.NET Health Checks | Service health and dependencies |

---

## Application Insights

### Setup

**Program.cs**:

```csharp
builder.Services.AddApplicationInsightsTelemetry(options => {
  options.ConnectionString = builder.Configuration["ApplicationInsights:ConnectionString"];
  options.EnableAdaptiveSampling = true;
  options.EnableDependencyTrackingTelemetryModule = true;
  options.EnablePerformanceCounterCollectionModule = true;
});

builder.Services.AddApplicationInsightsTelemetryProcessor<FilterHealthChecksTelemetryProcessor>();
```

**appsettings.json**:

```json
{
  "ApplicationInsights": {
    "ConnectionString": "InstrumentationKey=...;IngestionEndpoint=https://..."
  }
}
```

### Structured Logging

```csharp
public class CreateOrderReceptor : IReceptor<CreateOrder, OrderCreated> {
  private readonly ILogger<CreateOrderReceptor> _logger;

  public async Task<OrderCreated> HandleAsync(
    CreateOrder command,
    CancellationToken ct = default
  ) {
    using (_logger.BeginScope(new Dictionary<string, object> {
      ["OrderId"] = orderId,
      ["CustomerId"] = command.CustomerId
    })) {
      _logger.LogInformation(
        "Creating order for customer {CustomerId} with {ItemCount} items",
        command.CustomerId,
        command.Items.Length
      );

      try {
        // Process order...

        _logger.LogInformation(
          "Order {OrderId} created successfully with total amount {TotalAmount:C}",
          orderId,
          totalAmount
        );

        return new OrderCreated { OrderId = orderId, TotalAmount = totalAmount };
      } catch (Exception ex) {
        _logger.LogError(
          ex,
          "Failed to create order for customer {CustomerId}",
          command.CustomerId
        );
        throw;
      }
    }
  }
}
```

### Kusto Queries (Application Insights)

**Query 1: Error rate by operation**:

```kusto
requests
| where timestamp > ago(1h)
| summarize
    Total = count(),
    Errors = countif(success == false),
    ErrorRate = 100.0 * countif(success == false) / count()
  by name
| order by ErrorRate desc
```

**Query 2: P95 latency by operation**:

```kusto
requests
| where timestamp > ago(1h)
| summarize
    p50 = percentile(duration, 50),
    p95 = percentile(duration, 95),
    p99 = percentile(duration, 99)
  by name
| order by p95 desc
```

**Query 3: Failed operations with traces**:

```kusto
requests
| where timestamp > ago(1h) and success == false
| join kind=inner (
    traces
    | where timestamp > ago(1h)
  ) on operation_Id
| project
    timestamp,
    operation_Name,
    resultCode,
    message,
    customDimensions
| order by timestamp desc
```

---

## Prometheus Metrics

### Setup

**Program.cs**:

```csharp
builder.Services.AddOpenTelemetry()
  .WithMetrics(metrics => {
    metrics
      .AddMeter("Whizbang.*")
      .AddAspNetCoreInstrumentation()
      .AddHttpClientInstrumentation()
      .AddPrometheusExporter();
  });

app.MapPrometheusScrapingEndpoint();  // /metrics endpoint
```

### Custom Metrics

**OrderMetrics.cs**:

```csharp
using System.Diagnostics.Metrics;

public class OrderMetrics {
  private static readonly Meter Meter = new("Whizbang.OrderService");

  private static readonly Counter<long> OrdersCreated = Meter.CreateCounter<long>(
    "orders_created_total",
    description: "Total number of orders created"
  );

  private static readonly Histogram<double> OrderAmount = Meter.CreateHistogram<double>(
    "order_amount",
    unit: "USD",
    description: "Order amount distribution"
  );

  private static readonly ObservableGauge<int> ActiveOrders = Meter.CreateObservableGauge<int>(
    "active_orders",
    observeValue: () => GetActiveOrderCount(),
    description: "Current number of active orders"
  );

  public static void RecordOrderCreated(decimal amount) {
    OrdersCreated.Add(1);
    OrderAmount.Record((double)amount);
  }

  private static int GetActiveOrderCount() {
    // Query database for active orders
    return 0;  // Placeholder
  }
}
```

**Usage**:

```csharp
public async Task<OrderCreated> HandleAsync(
  CreateOrder command,
  CancellationToken ct = default
) {
  // Process order...

  OrderMetrics.RecordOrderCreated(totalAmount);

  return new OrderCreated { OrderId = orderId, TotalAmount = totalAmount };
}
```

### Prometheus Queries (PromQL)

**Query 1: Request rate (requests/second)**:

```promql
rate(http_requests_total[5m])
```

**Query 2: Error rate percentage**:

```promql
100 * (
  rate(http_requests_total{status=~"5.."}[5m])
  /
  rate(http_requests_total[5m])
)
```

**Query 3: P95 latency**:

```promql
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))
```

**Query 4: Orders created per minute**:

```promql
rate(orders_created_total[1m]) * 60
```

---

## Distributed Tracing

### Activity (W3C Trace Context)

**CreateOrderReceptor.cs**:

```csharp
public async Task<OrderCreated> HandleAsync(
  CreateOrder command,
  CancellationToken ct = default
) {
  using var activity = Activity.Current?.Source.StartActivity("CreateOrder");
  activity?.SetTag("order.customer_id", command.CustomerId);
  activity?.SetTag("order.item_count", command.Items.Length);

  try {
    // Process order...

    activity?.SetTag("order.total_amount", totalAmount);
    activity?.SetStatus(ActivityStatusCode.Ok);

    return new OrderCreated { OrderId = orderId, TotalAmount = totalAmount };
  } catch (Exception ex) {
    activity?.SetStatus(ActivityStatusCode.Error, ex.Message);
    throw;
  }
}
```

### Propagate Trace Context

**MessageEnvelope.cs**:

```csharp
public record MessageEnvelope {
  public required string MessageId { get; init; }
  public required string MessageType { get; init; }
  public required Dictionary<string, string> Headers { get; init; }

  public static MessageEnvelope CreateFromActivity(string messageId, string messageType) {
    var headers = new Dictionary<string, string>();

    // Propagate W3C Trace Context
    if (Activity.Current != null) {
      headers["traceparent"] = Activity.Current.Id ?? string.Empty;
      if (!string.IsNullOrEmpty(Activity.Current.TraceStateString)) {
        headers["tracestate"] = Activity.Current.TraceStateString;
      }
    }

    return new MessageEnvelope {
      MessageId = messageId,
      MessageType = messageType,
      Headers = headers
    };
  }
}
```

**ServiceBusPublisher.cs**:

```csharp
public async Task PublishAsync(object @event, CancellationToken ct = default) {
  var envelope = MessageEnvelope.CreateFromActivity(
    messageId: Guid.NewGuid().ToString(),
    messageType: @event.GetType().Name
  );

  var message = new ServiceBusMessage(JsonSerializer.SerializeToUtf8Bytes(@event)) {
    MessageId = envelope.MessageId,
    Subject = envelope.MessageType
  };

  // Propagate trace context in message properties
  foreach (var header in envelope.Headers) {
    message.ApplicationProperties[header.Key] = header.Value;
  }

  await _sender.SendMessageAsync(message, ct);
}
```

**ServiceBusProcessor.cs**:

```csharp
private async Task ProcessMessageAsync(ProcessMessageEventArgs args) {
  // Extract trace context from message
  var traceparent = args.Message.ApplicationProperties.GetValueOrDefault("traceparent") as string;

  Activity? activity = null;
  if (!string.IsNullOrEmpty(traceparent)) {
    activity = Activity.Current?.Source.StartActivity(
      "ProcessMessage",
      ActivityKind.Consumer,
      traceparent
    );
  }

  try {
    // Process message...

    await args.CompleteMessageAsync(args.Message);
  } finally {
    activity?.Dispose();
  }
}
```

---

## Health Checks

### Basic Health Checks

**Program.cs**:

```csharp
builder.Services.AddHealthChecks()
  .AddNpgSql(
    builder.Configuration["Database:ConnectionString"],
    name: "database",
    tags: ["db", "postgres"]
  )
  .AddAzureServiceBusTopic(
    builder.Configuration["AzureServiceBus:ConnectionString"],
    "orders",
    name: "servicebus",
    tags: ["messaging", "servicebus"]
  )
  .AddUrlGroup(
    new Uri("https://api.stripe.com/v1/health"),
    name: "stripe",
    tags: ["external", "payment"]
  );

app.MapHealthChecks("/health", new HealthCheckOptions {
  ResponseWriter = UIResponseWriter.WriteHealthCheckUIResponse
});

app.MapHealthChecks("/health/ready", new HealthCheckOptions {
  Predicate = check => check.Tags.Contains("ready")
});

app.MapHealthChecks("/health/live", new HealthCheckOptions {
  Predicate = _ => true
});
```

### Custom Health Check

**OrderServiceHealthCheck.cs**:

```csharp
public class OrderServiceHealthCheck : IHealthCheck {
  private readonly IDbConnection _db;

  public async Task<HealthCheckResult> CheckHealthAsync(
    HealthCheckContext context,
    CancellationToken ct = default
  ) {
    try {
      // Check database connectivity
      var count = await _db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM orders LIMIT 1");

      // Check outbox backlog
      var outboxBacklog = await _db.ExecuteScalarAsync<int>(
        "SELECT COUNT(*) FROM outbox WHERE processed_at IS NULL"
      );

      if (outboxBacklog > 10000) {
        return HealthCheckResult.Degraded(
          $"Outbox backlog is {outboxBacklog} messages",
          data: new Dictionary<string, object> {
            ["outbox_backlog"] = outboxBacklog
          }
        );
      }

      return HealthCheckResult.Healthy("Order service is healthy", data: new Dictionary<string, object> {
        ["outbox_backlog"] = outboxBacklog
      });
    } catch (Exception ex) {
      return HealthCheckResult.Unhealthy("Order service is unhealthy", ex);
    }
  }
}
```

**Registration**:

```csharp
builder.Services.AddHealthChecks()
  .AddCheck<OrderServiceHealthCheck>("order-service", tags: ["ready"]);
```

---

## Dashboards

### Grafana Dashboard (JSON)

**orders-dashboard.json**:

```json
{
  "dashboard": {
    "title": "Order Service Metrics",
    "panels": [
      {
        "title": "Request Rate",
        "targets": [
          {
            "expr": "rate(http_requests_total{service=\"order-service\"}[5m])"
          }
        ],
        "type": "graph"
      },
      {
        "title": "Error Rate",
        "targets": [
          {
            "expr": "100 * (rate(http_requests_total{service=\"order-service\",status=~\"5..\"}[5m]) / rate(http_requests_total{service=\"order-service\"}[5m]))"
          }
        ],
        "type": "graph"
      },
      {
        "title": "P95 Latency",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{service=\"order-service\"}[5m]))"
          }
        ],
        "type": "graph"
      },
      {
        "title": "Orders Created",
        "targets": [
          {
            "expr": "rate(orders_created_total[1m]) * 60"
          }
        ],
        "type": "graph"
      }
    ]
  }
}
```

### Azure Dashboard (KQL)

**orders-dashboard.kql**:

```kusto
// Request rate
requests
| where timestamp > ago(1h)
| summarize RequestRate = count() / 60.0 by bin(timestamp, 1m)
| render timechart

// Error rate
requests
| where timestamp > ago(1h)
| summarize
    Total = count(),
    Errors = countif(success == false)
  by bin(timestamp, 1m)
| extend ErrorRate = 100.0 * Errors / Total
| render timechart

// P95 latency
requests
| where timestamp > ago(1h)
| summarize p95 = percentile(duration, 95) by bin(timestamp, 1m)
| render timechart

// Top slow operations
requests
| where timestamp > ago(1h)
| summarize p95 = percentile(duration, 95) by name
| top 10 by p95 desc
| render barchart
```

---

## Alerts

### Prometheus Alerts

**alerts.yml**:

```yaml
groups:
  - name: order-service
    interval: 30s
    rules:
      - alert: HighErrorRate
        expr: |
          100 * (
            rate(http_requests_total{service="order-service",status=~"5.."}[5m])
            /
            rate(http_requests_total{service="order-service"}[5m])
          ) > 5
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate on Order Service"
          description: "Error rate is {{ $value }}% over the last 5 minutes"

      - alert: HighLatency
        expr: |
          histogram_quantile(0.95,
            rate(http_request_duration_seconds_bucket{service="order-service"}[5m])
          ) > 1.0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High latency on Order Service"
          description: "P95 latency is {{ $value }}s over the last 5 minutes"

      - alert: OutboxBacklog
        expr: outbox_backlog > 10000
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Outbox backlog is high"
          description: "Outbox has {{ $value }} unprocessed messages"
```

### Application Insights Alerts

**Azure CLI**:

```bash
# Create alert for error rate
az monitor metrics alert create \
  --name "High Error Rate" \
  --resource-group whizbang-rg \
  --scopes /subscriptions/.../resourceGroups/whizbang-rg/providers/Microsoft.Insights/components/whizbang-ai \
  --condition "count requests/failed > 50" \
  --window-size 5m \
  --evaluation-frequency 1m \
  --severity 2 \
  --description "Error rate exceeded 50 requests/5min"

# Create alert for P95 latency
az monitor metrics alert create \
  --name "High Latency" \
  --resource-group whizbang-rg \
  --scopes /subscriptions/.../resourceGroups/whizbang-rg/providers/Microsoft.Insights/components/whizbang-ai \
  --condition "percentile requests/duration > 1000" \
  --window-size 5m \
  --evaluation-frequency 1m \
  --severity 3 \
  --description "P95 latency exceeded 1 second"
```

---

## Log Aggregation

### Serilog with Sinks

**Program.cs**:

```csharp
using Serilog;
using Serilog.Sinks.ApplicationInsights.TelemetryConverters;

Log.Logger = new LoggerConfiguration()
  .MinimumLevel.Information()
  .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
  .Enrich.FromLogContext()
  .Enrich.WithMachineName()
  .Enrich.WithEnvironmentName()
  .WriteTo.Console(new JsonFormatter())
  .WriteTo.ApplicationInsights(
    builder.Configuration["ApplicationInsights:ConnectionString"],
    TelemetryConverter.Traces
  )
  .CreateLogger();

builder.Host.UseSerilog();
```

**appsettings.json**:

```json
{
  "Serilog": {
    "MinimumLevel": {
      "Default": "Information",
      "Override": {
        "Microsoft": "Warning",
        "System": "Warning"
      }
    }
  }
}
```

---

## Performance Monitoring

### BenchmarkDotNet Integration

**CreateOrderBenchmark.cs**:

```csharp
using BenchmarkDotNet.Attributes;
using BenchmarkDotNet.Running;

[MemoryDiagnoser]
[SimpleJob(warmupCount: 3, iterationCount: 10)]
public class CreateOrderBenchmark {
  private CreateOrderReceptor _receptor = null!;
  private CreateOrder _command = null!;

  [GlobalSetup]
  public void Setup() {
    _receptor = new CreateOrderReceptor(Mock.Of<IDbConnection>());
    _command = new CreateOrder {
      CustomerId = "cust-123",
      Items = [
        new OrderItem { ProductId = "prod-456", Quantity = 2, UnitPrice = 19.99m }
      ]
    };
  }

  [Benchmark]
  public async Task<OrderCreated> CreateOrder() {
    return await _receptor.HandleAsync(_command);
  }
}
```

**Run**:

```bash
dotnet run -c Release --project Benchmarks

# Output:
# | Method      | Mean     | Error   | StdDev | Allocated |
# |------------ |---------:|--------:|-------:|----------:|
# | CreateOrder | 125.3 μs | 2.34 μs | 2.19 μs |     512 B |
```

---

## Key Takeaways

✅ **Application Insights** - Logs, metrics, traces in one platform
✅ **Prometheus + Grafana** - Time-series metrics and dashboards
✅ **Distributed Tracing** - W3C Trace Context propagation
✅ **Health Checks** - Readiness and liveness probes
✅ **Custom Metrics** - Business-specific KPIs
✅ **Alerts** - Proactive incident detection
✅ **Structured Logging** - Queryable logs with context

---

## Monitoring Checklist

- [ ] Application Insights configured with connection string
- [ ] Prometheus metrics exported at `/metrics`
- [ ] Distributed tracing enabled with W3C Trace Context
- [ ] Health checks at `/health`, `/health/ready`, `/health/live`
- [ ] Custom metrics for business KPIs (orders created, revenue, etc.)
- [ ] Alerts configured for error rate, latency, backlog
- [ ] Dashboards created in Grafana and Azure Portal
- [ ] Log aggregation with Serilog
- [ ] Performance benchmarks with BenchmarkDotNet

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
