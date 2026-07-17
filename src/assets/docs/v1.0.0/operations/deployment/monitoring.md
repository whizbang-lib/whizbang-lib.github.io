---
title: Monitoring & Observability
pageType: guide
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Advanced Topics
order: 6
description: >-
  Application monitoring - Application Insights, Prometheus, distributed
  tracing, metrics, and dashboards
tags: 'monitoring, observability, application-insights, prometheus, tracing, metrics'
codeReferences:
  - src/Whizbang.Core/Observability/WhizbangActivitySource.cs
  - src/Whizbang.Core/Observability/WhizbangMetrics.cs
  - src/Whizbang.Core/Observability/DispatcherMetrics.cs
  - src/Whizbang.Core/Observability/TableStatisticsMetrics.cs
  - src/Whizbang.Core/HealthChecks/SubscriptionHealthCheck.cs
testReferences:
  - tests/Whizbang.Observability.Tests/WhizbangActivitySourceTests.cs
  - tests/Whizbang.Core.Tests/Observability/TableStatisticsMetricsTests.cs
  - tests/Whizbang.Core.Tests/Observability/DispatcherMetricsTests.cs
  - tests/Whizbang.Core.Tests/HealthChecks/SubscriptionHealthCheckTests.cs
lastMaintainedCommit: '01f07906'
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

```csharp{title="Setup" description="Setup" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Setup"]}
builder.Services.AddApplicationInsightsTelemetry(options => {
  options.ConnectionString = builder.Configuration["ApplicationInsights:ConnectionString"];
  options.EnableAdaptiveSampling = true;
  options.EnableDependencyTrackingTelemetryModule = true;
  options.EnablePerformanceCounterCollectionModule = true;
});

builder.Services.AddApplicationInsightsTelemetryProcessor<FilterHealthChecksTelemetryProcessor>();
```

**appsettings.json**:

```json{title="Setup (2)" description="**appsettings." category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Setup"]}
{
  "ApplicationInsights": {
    "ConnectionString": "InstrumentationKey=...;IngestionEndpoint=https://..."
  }
}
```

### Structured Logging

```csharp{title="Structured Logging" description="Structured Logging" category="Configuration" difficulty="ADVANCED" tags=["Operations", "Deployment", "Structured", "Logging"]}
public class CreateOrderReceptor(
  IDispatcher dispatcher,
  ILogger<CreateOrderReceptor> logger) : IReceptor<CreateOrderCommand, OrderCreatedEvent> {

  public async ValueTask<OrderCreatedEvent> HandleAsync(
    CreateOrderCommand command,
    CancellationToken cancellationToken = default
  ) {
    using (logger.BeginScope(new Dictionary<string, object> {
      ["OrderId"] = command.OrderId,
      ["CustomerId"] = command.CustomerId
    })) {
      logger.LogInformation(
        "Creating order for customer {CustomerId} with {ItemCount} items",
        command.CustomerId,
        command.LineItems.Count
      );

      try {
        // Process order...
        var orderCreated = new OrderCreatedEvent {
          OrderId = command.OrderId,
          CustomerId = command.CustomerId,
          LineItems = command.LineItems,
          TotalAmount = command.TotalAmount,
          CreatedAt = DateTime.UtcNow
        };

        await dispatcher.PublishAsync(orderCreated);

        logger.LogInformation(
          "Order {OrderId} created successfully with total amount {TotalAmount:C}",
          command.OrderId,
          command.TotalAmount
        );

        return orderCreated;
      } catch (Exception ex) {
        logger.LogError(
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

```csharp{title="Setup (3)" description="Setup (3)" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Setup"]}
builder.Services.AddOpenTelemetry()
  .WithMetrics(metrics => {
    metrics
      .AddMeter("Whizbang.*")  // Wildcard subscribes all Whizbang meters
      .AddAspNetCoreInstrumentation()
      .AddHttpClientInstrumentation()
      .AddPrometheusExporter();
  });

app.MapPrometheusScrapingEndpoint();  // /metrics endpoint
```

The `Whizbang.*` wildcard picks up the library's meters, including `Whizbang.Dispatcher`, `Whizbang.WorkCoordinator`, `Whizbang.Perspectives`, `Whizbang.Transport`, `Whizbang.Lifecycle`, `Whizbang.DeadLetters`, and `Whizbang.TableStatistics` (queue depth / table size gauges). Instrument names follow the `whizbang.<component>.<measurement>` convention, e.g. `whizbang.dispatcher.send.duration`, `whizbang.work_coordinator.process_batch.duration`, `whizbang.queue.estimated_depth`. Add your own app meters explicitly (e.g. `.AddMeter("ECommerce.OrderService")`).

### Custom Metrics

**OrderMetrics.cs**:

```csharp{title="Custom Metrics" description="**OrderMetrics." category="Configuration" difficulty="ADVANCED" tags=["Operations", "Deployment", "Custom", "Metrics"]}
using System.Diagnostics.Metrics;

public class OrderMetrics {
  // Use your app's namespace, not "Whizbang.*" - that prefix belongs to the library's meters
  private static readonly Meter Meter = new("ECommerce.OrderService");

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

```csharp{title="Custom Metrics (2)" description="Custom Metrics" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Custom", "Metrics"]}
public async ValueTask<OrderCreatedEvent> HandleAsync(
  CreateOrderCommand command,
  CancellationToken cancellationToken = default
) {
  // Process order...

  OrderMetrics.RecordOrderCreated(command.TotalAmount);

  return new OrderCreatedEvent {
    OrderId = command.OrderId,
    CustomerId = command.CustomerId,
    LineItems = command.LineItems,
    TotalAmount = command.TotalAmount,
    CreatedAt = DateTime.UtcNow
  };
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

### Register Whizbang Activity Sources

Whizbang emits OpenTelemetry spans through named `ActivitySource`s (see `WhizbangActivitySource`). Register them with your tracer provider:

```csharp{title="Register Whizbang Activity Sources" description="OpenTelemetry tracing setup with Whizbang sources" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Tracing", "OpenTelemetry"]}
builder.Services.AddOpenTelemetry()
  .WithTracing(tracing => {
    tracing
      .AddSource("Whizbang.Execution")   // Dispatch activities (parent spans)
      .AddSource("Whizbang.Tracing")     // Handler traces (child spans for [WhizbangTrace])
      .AddSource("Whizbang.Transport")   // Transport operations
      .AddSource("Whizbang.Hosting")     // Hosting/infrastructure operations
      .AddAspNetCoreInstrumentation()
      .AddHttpClientInstrumentation();
  });
```

Span emission is controlled by `TracingOptions` (`options.Tracing.EnableOpenTelemetry`, on by default, plus `Verbosity` / `Components`) - see [Tracing](../observability/tracing) and [Verbosity Levels](../observability/verbosity-levels).

### Trace Context Propagation Is Automatic

You do **not** hand-roll trace propagation with Whizbang. Every message travels inside a `MessageEnvelope` (`Whizbang.Core.Observability`) that carries `MessageId`, per-service `MessageHop`s with `CorrelationId` and `CausationId`, and the dispatch context - across the outbox, the transport, and the inbox. The consuming side restores the context before your receptors run, so spans from different services join the same trace.

### Custom Spans in Receptors

Add your own child spans with a private `ActivitySource` when you need business-level detail:

```csharp{title="Custom Spans in Receptors" description="App-level ActivitySource for business spans" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "Activity", "W3C"]}
public class CreateOrderReceptor(IDispatcher dispatcher) : IReceptor<CreateOrderCommand, OrderCreatedEvent> {
  private static readonly ActivitySource Source = new("ECommerce.OrderService");

  public async ValueTask<OrderCreatedEvent> HandleAsync(
    CreateOrderCommand command,
    CancellationToken cancellationToken = default
  ) {
    using var activity = Source.StartActivity("CreateOrder");
    activity?.SetTag("order.customer_id", command.CustomerId.ToString());
    activity?.SetTag("order.item_count", command.LineItems.Count);

    try {
      // Process order...
      var orderCreated = new OrderCreatedEvent {
        OrderId = command.OrderId,
        CustomerId = command.CustomerId,
        LineItems = command.LineItems,
        TotalAmount = command.TotalAmount,
        CreatedAt = DateTime.UtcNow
      };

      await dispatcher.PublishAsync(orderCreated);

      activity?.SetTag("order.total_amount", command.TotalAmount);
      activity?.SetStatus(ActivityStatusCode.Ok);

      return orderCreated;
    } catch (Exception ex) {
      activity?.SetStatus(ActivityStatusCode.Error, ex.Message);
      throw;
    }
  }
}
```

Remember to register the app-level source too: `tracing.AddSource("ECommerce.OrderService")`. Because Whizbang already created the parent activity for the dispatch, your span nests inside the distributed trace automatically.

---

## Health Checks

### Basic Health Checks

**Program.cs**:

```csharp{title="Basic Health Checks" description="Basic Health Checks" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Basic", "Health"]}
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

### Built-In Whizbang Health Checks

Whizbang packages register named checks on the standard health-check pipeline automatically:

| Check name | Package | Reports |
|------------|---------|---------|
| `subscriptions` | Whizbang.Core | Transport subscription state (`Degraded` when some subscriptions are down, `Unhealthy` when all are) |
| `whizbang_postgres` | Whizbang.Data.Dapper.Postgres | Postgres storage connectivity |
| `azure_servicebus` | Whizbang.Transports.AzureServiceBus | Azure Service Bus connectivity |
| `rabbitmq` | Whizbang.Transports.RabbitMQ (opt-in via `AddRabbitMQHealthChecks()`) | RabbitMQ connectivity |

The `subscriptions` check is tagged `transport`, so you can include it in a readiness predicate with `check => check.Tags.Contains("transport")`.

### Custom Health Check

**OrderServiceHealthCheck.cs**:

```csharp{title="Custom Health Check" description="**OrderServiceHealthCheck." category="Configuration" difficulty="ADVANCED" tags=["Operations", "Deployment", "Custom", "Health"]}
public class OrderServiceHealthCheck : IHealthCheck {
  private readonly IDbConnection _db;

  public async Task<HealthCheckResult> CheckHealthAsync(
    HealthCheckContext context,
    CancellationToken ct = default
  ) {
    try {
      // Check database connectivity
      var count = await _db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM orders LIMIT 1");

      // Check outbox backlog (Whizbang's internal outbox table)
      var outboxBacklog = await _db.ExecuteScalarAsync<int>(
        "SELECT COUNT(*) FROM wh_outbox WHERE processed_at IS NULL"
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

```csharp{title="Custom Health Check (2)" description="Registration:" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "Custom", "Health"]}
builder.Services.AddHealthChecks()
  .AddCheck<OrderServiceHealthCheck>("order-service", tags: ["ready"]);
```

---

## Dashboards

### Grafana Dashboard (JSON)

**orders-dashboard.json**:

```json{title="Grafana Dashboard (JSON)" description="**orders-dashboard." category="Configuration" difficulty="ADVANCED" tags=["Operations", "Deployment", "Grafana", "Dashboard"]}
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

```yaml{title="Prometheus Alerts" description="Prometheus Alerts" category="Configuration" difficulty="ADVANCED" tags=["Operations", "Deployment", "Prometheus", "Alerts"]}
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
        expr: whizbang_queue_estimated_depth{queue_name="outbox"} > 10000
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Outbox backlog is high"
          description: "Outbox has {{ $value }} unprocessed messages"
```

### Application Insights Alerts

**Azure CLI**:

```bash{title="Application Insights Alerts" description="Application Insights Alerts" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "Application", "Insights"]}
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

```csharp{title="Serilog with Sinks" description="Serilog with Sinks" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "Serilog", "Sinks"]}
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

```json{title="Serilog with Sinks (2)" description="**appsettings." category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "Serilog", "Sinks"]}
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

```csharp{title="BenchmarkDotNet Integration" description="**CreateOrderBenchmark." category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Deployment", "BenchmarkDotNet", "Integration"]}
using BenchmarkDotNet.Attributes;
using BenchmarkDotNet.Running;

[MemoryDiagnoser]
[SimpleJob(warmupCount: 3, iterationCount: 10)]
public class CreateOrderBenchmark {
  private CreateOrderReceptor _receptor = null!;
  private CreateOrderCommand _command = null!;

  [GlobalSetup]
  public void Setup() {
    _receptor = new CreateOrderReceptor(
      new TestDispatcher(),  // recording IDispatcher fake
      NullLogger<CreateOrderReceptor>.Instance);

    _command = new CreateOrderCommand {
      OrderId = OrderId.New(),
      CustomerId = CustomerId.New(),
      LineItems = [
        new OrderLineItem {
          ProductId = ProductId.New(),
          ProductName = "Widget",
          Quantity = 2,
          UnitPrice = 19.99m
        }
      ],
      TotalAmount = 39.98m
    };
  }

  [Benchmark]
  public async Task<OrderCreatedEvent> CreateOrder() {
    return await _receptor.HandleAsync(_command);
  }
}
```

**Run**:

```bash{title="BenchmarkDotNet Integration (2)" description="BenchmarkDotNet Integration" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Deployment", "BenchmarkDotNet", "Integration"]}
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
