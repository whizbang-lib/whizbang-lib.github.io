---
title: Custom Health Checks
pageType: guide
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Extensibility
order: 6
description: >-
  Implement custom health checks for transports, databases, external APIs, and
  custom services
tags: 'health-checks, monitoring, kubernetes, readiness, liveness'
codeReferences:
  - src/Whizbang.Core/Transports/ITransportReadinessCheck.cs
  - src/Whizbang.Core/Workers/DefaultTransportReadinessCheck.cs
  - src/Whizbang.Core/HealthChecks/SubscriptionHealthCheck.cs
testReferences:
  - tests/Whizbang.Core.Tests/Transports/TransportReadinessCheckTests.cs
  - tests/Whizbang.Core.Tests/Workers/DefaultTransportReadinessCheckTests.cs
  - tests/Whizbang.Core.Tests/HealthChecks/SubscriptionHealthCheckTests.cs
lastMaintainedCommit: '01f07906'
---

# Custom Health Checks

**Custom health checks** enable monitoring application health for Kubernetes, load balancers, and observability tools. Implement checks for transports, databases, caches, external APIs, and custom services.

:::note
For built-in health checks, see [Health Checks](../../operations/infrastructure/health-checks.md). This guide focuses on **implementing custom health checks**.
:::

---

## Why Custom Health Checks?

**Built-in checks cover common scenarios**, but custom checks enable monitoring of:

| Component | Built-In Check | Custom Check |
|-----------|---------------|--------------|
| **Azure Service Bus** | ✅ Built-in (`AzureServiceBusHealthCheck`) | No customization needed |
| **RabbitMQ** | ✅ Built-in (`RabbitMQHealthCheck`) | No customization needed |
| **PostgreSQL** | ✅ Built-in (`PostgresHealthCheck`) | No customization needed |
| **Transport subscriptions** | ✅ Built-in (`SubscriptionHealthCheck`) | No customization needed |
| **Redis** | ❌ Not included | ✅ Custom Redis check |
| **Kafka** | ❌ Not included | ✅ Custom Kafka check |
| **External APIs** | ❌ Not included | ✅ Custom HTTP check |
| **Custom Services** | ❌ Not included | ✅ Custom logic check |

**Use Cases**:
- ✅ Monitor transport connectivity
- ✅ Verify database availability
- ✅ Check external API dependencies
- ✅ Validate custom service health
- ✅ Kubernetes readiness/liveness probes

---

## IHealthCheck Interface

Whizbang uses the standard ASP.NET Core health check abstraction (`Microsoft.Extensions.Diagnostics.HealthChecks`) - custom checks plug into the same pipeline as the built-in ones:

```csharp{title="IHealthCheck Interface" description="IHealthCheck Interface" category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Extensibility", "IHealthCheck", "Interface"]}
using Microsoft.Extensions.Diagnostics.HealthChecks;

public interface IHealthCheck {
  Task<HealthCheckResult> CheckHealthAsync(
    HealthCheckContext context,
    CancellationToken cancellationToken = default
  );
}
```

**HealthCheckResult States**:
- **Healthy**: Service operational
- **Degraded**: Service operational but impaired
- **Unhealthy**: Service not operational

---

## Whizbang Extension Point: ITransportReadinessCheck

Separate from HTTP health endpoints, Whizbang has its own **transport readiness** hook. The outbox publisher worker consults `ITransportReadinessCheck` to decide whether to publish messages or keep them in the outbox (with renewed leases) until the transport becomes available:

```csharp{title="ITransportReadinessCheck Interface" description="Whizbang transport readiness extension point" category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Extensibility", "Readiness", "Transports"]}
namespace Whizbang.Core.Transports;

public interface ITransportReadinessCheck {
  // Should be fast and lightweight - cache or circuit-break any network I/O
  Task<bool> IsReadyAsync(CancellationToken cancellationToken = default);
}
```

The default implementation, `DefaultTransportReadinessCheck` (namespace `Whizbang.Core.Workers`), always returns `true` - appropriate for in-process transports. Transport packages ship real implementations (e.g. `ServiceBusReadinessCheck`, `RabbitMQReadinessCheck`). Implement this interface when writing a [custom transport](custom-transports.md) that can lose connectivity:

```csharp{title="Custom Readiness Check" description="Readiness check for a custom transport" category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Extensibility", "Readiness", "Transports"]}
public class KafkaReadinessCheck : ITransportReadinessCheck {
  private readonly IAdminClient _adminClient;

  public KafkaReadinessCheck(IAdminClient adminClient) {
    _adminClient = adminClient;
  }

  public Task<bool> IsReadyAsync(CancellationToken cancellationToken = default) {
    cancellationToken.ThrowIfCancellationRequested();
    try {
      var metadata = _adminClient.GetMetadata(TimeSpan.FromSeconds(2));
      return Task.FromResult(metadata.Brokers.Count > 0);
    } catch (KafkaException) {
      return Task.FromResult(false);
    }
  }
}
```

---

## Transport Health Checks

### Pattern 1: Kafka Transport Check

```csharp{title="Pattern 1: Kafka Transport Check" description="Pattern 1: Kafka Transport Check" category="Extensibility" difficulty="ADVANCED" tags=["Extending", "Extensibility", "Pattern", "Kafka"]}
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Confluent.Kafka;

public class KafkaHealthCheck : IHealthCheck {
  private readonly IAdminClient _adminClient;
  private readonly ILogger<KafkaHealthCheck> _logger;

  public KafkaHealthCheck(
    IAdminClient adminClient,
    ILogger<KafkaHealthCheck> logger
  ) {
    _adminClient = adminClient;
    _logger = logger;
  }

  public Task<HealthCheckResult> CheckHealthAsync(
    HealthCheckContext context,
    CancellationToken ct = default
  ) {
    try {
      // Get cluster metadata (verifies connectivity)
      var metadata = _adminClient.GetMetadata(TimeSpan.FromSeconds(5));
      var brokerCount = metadata.Brokers.Count;

      if (brokerCount == 0) {
        return Task.FromResult(HealthCheckResult.Unhealthy(
          "No Kafka brokers available"
        ));
      }

      return Task.FromResult(HealthCheckResult.Healthy(
        $"Kafka healthy, {brokerCount} brokers connected"
      ));

    } catch (KafkaException ex) {
      _logger.LogError(ex, "Kafka health check failed");
      return Task.FromResult(HealthCheckResult.Unhealthy(
        "Kafka cluster unreachable",
        ex
      ));
    }
  }
}
```

### Pattern 2: Redis Cache Check

```csharp{title="Pattern 2: Redis Cache Check" description="Pattern 2: Redis Cache Check" category="Extensibility" difficulty="ADVANCED" tags=["Extending", "Extensibility", "Pattern", "Redis"]}
using Microsoft.Extensions.Diagnostics.HealthChecks;
using StackExchange.Redis;

public class RedisHealthCheck : IHealthCheck {
  private readonly IConnectionMultiplexer _redis;

  public RedisHealthCheck(IConnectionMultiplexer redis) {
    _redis = redis;
  }

  public async Task<HealthCheckResult> CheckHealthAsync(
    HealthCheckContext context,
    CancellationToken ct = default
  ) {
    try {
      var db = _redis.GetDatabase();

      // Ping Redis
      var latency = await db.PingAsync();

      if (latency > TimeSpan.FromSeconds(1)) {
        return HealthCheckResult.Degraded(
          $"Redis responding slowly ({latency.TotalMilliseconds:F0}ms)"
        );
      }

      return HealthCheckResult.Healthy(
        $"Redis healthy ({latency.TotalMilliseconds:F0}ms latency)"
      );

    } catch (Exception ex) {
      return HealthCheckResult.Unhealthy(
        "Redis unavailable",
        ex
      );
    }
  }
}
```

---

## Database Health Checks

### Pattern 3: PostgreSQL Check (Advanced)

```csharp{title="Pattern 3: PostgreSQL Check (Advanced)" description="Pattern 3: PostgreSQL Check (Advanced)" category="Extensibility" difficulty="ADVANCED" tags=["Extending", "Extensibility", "Pattern", "PostgreSQL"]}
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Npgsql;

public class PostgresHealthCheck : IHealthCheck {
  private readonly string _connectionString;
  private readonly int _timeoutSeconds;

  public PostgresHealthCheck(string connectionString, int timeoutSeconds = 5) {
    _connectionString = connectionString;
    _timeoutSeconds = timeoutSeconds;
  }

  public async Task<HealthCheckResult> CheckHealthAsync(
    HealthCheckContext context,
    CancellationToken ct = default
  ) {
    try {
      // Set connection timeout
      var csBuilder = new NpgsqlConnectionStringBuilder(_connectionString) {
        Timeout = _timeoutSeconds
      };

      await using var conn = new NpgsqlConnection(csBuilder.ToString());
      await conn.OpenAsync(ct);

      // Execute simple query to verify connectivity
      await using var cmd = new NpgsqlCommand("SELECT 1", conn);
      await cmd.ExecuteScalarAsync(ct);

      return HealthCheckResult.Healthy(
        $"PostgreSQL healthy (state: {conn.State})"
      );

    } catch (TimeoutException ex) {
      return HealthCheckResult.Unhealthy(
        $"PostgreSQL connection timeout ({_timeoutSeconds}s)",
        ex
      );
    } catch (Exception ex) {
      return HealthCheckResult.Unhealthy(
        "PostgreSQL unavailable",
        ex
      );
    }
  }
}
```

---

## External API Health Checks

### Pattern 4: HTTP Dependency Check

```csharp{title="Pattern 4: HTTP Dependency Check" description="Pattern 4: HTTP Dependency Check" category="Extensibility" difficulty="ADVANCED" tags=["Extending", "Extensibility", "Pattern", "HTTP"]}
using Microsoft.Extensions.Diagnostics.HealthChecks;

public class ExternalApiHealthCheck : IHealthCheck {
  private readonly HttpClient _http;
  private readonly string _healthEndpoint;

  public ExternalApiHealthCheck(
    HttpClient http,
    string healthEndpoint = "/health"
  ) {
    _http = http;
    _healthEndpoint = healthEndpoint;
  }

  public async Task<HealthCheckResult> CheckHealthAsync(
    HealthCheckContext context,
    CancellationToken ct = default
  ) {
    try {
      var response = await _http.GetAsync(_healthEndpoint, ct);

      if (response.IsSuccessStatusCode) {
        return HealthCheckResult.Healthy(
          $"External API healthy (status {response.StatusCode})"
        );
      }

      return HealthCheckResult.Degraded(
        $"External API degraded (status {response.StatusCode})"
      );

    } catch (HttpRequestException ex) {
      return HealthCheckResult.Unhealthy(
        "External API unreachable",
        ex
      );
    }
  }
}
```

---

## Composite Health Checks

### Pattern 5: Multi-Component Check

```csharp{title="Pattern 5: Multi-Component Check" description="Pattern 5: Multi-Component Check" category="Extensibility" difficulty="ADVANCED" tags=["Extending", "Extensibility", "Pattern", "Multi-Component"]}
using Microsoft.Extensions.Diagnostics.HealthChecks;

public class WhizbangSystemHealthCheck : IHealthCheck {
  private readonly IEnumerable<IHealthCheck> _checks;

  public WhizbangSystemHealthCheck(IEnumerable<IHealthCheck> checks) {
    _checks = checks;
  }

  public async Task<HealthCheckResult> CheckHealthAsync(
    HealthCheckContext context,
    CancellationToken ct = default
  ) {
    var results = new List<(string Name, HealthCheckResult Result)>();

    foreach (var check in _checks) {
      var name = check.GetType().Name;
      var result = await check.CheckHealthAsync(context, ct);
      results.Add((name, result));
    }

    // Aggregate results
    var unhealthy = results.Where(r => r.Result.Status == HealthStatus.Unhealthy).ToList();
    var degraded = results.Where(r => r.Result.Status == HealthStatus.Degraded).ToList();

    if (unhealthy.Any()) {
      var failedChecks = string.Join(", ", unhealthy.Select(r => r.Name));
      return HealthCheckResult.Unhealthy(
        $"System unhealthy: {failedChecks} failed"
      );
    }

    if (degraded.Any()) {
      var degradedChecks = string.Join(", ", degraded.Select(r => r.Name));
      return HealthCheckResult.Degraded(
        $"System degraded: {degradedChecks} impaired"
      );
    }

    return HealthCheckResult.Healthy("All systems operational");
  }
}
```

---

## Registration and Configuration

```csharp{title="Registration and Configuration" description="Registration and Configuration" category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Extensibility", "Registration", "Configuration"]}
// Startup.cs
builder.Services.AddHealthChecks()
  .AddCheck<KafkaHealthCheck>("kafka", tags: new[] { "transport" })
  .AddCheck<RedisHealthCheck>("redis", tags: new[] { "cache" })
  .AddCheck<PostgresHealthCheck>("postgres", tags: new[] { "database" })
  .AddCheck<ExternalApiHealthCheck>("external_api", tags: new[] { "external" });

// Health check endpoint
app.MapHealthChecks("/health");

// Filtered endpoints (Kubernetes)
app.MapHealthChecks("/health/ready", new HealthCheckOptions {
  Predicate = check => check.Tags.Contains("transport") || check.Tags.Contains("database")
});

app.MapHealthChecks("/health/live", new HealthCheckOptions {
  Predicate = check => true  // All checks
});
```

---

## Best Practices

### DO ✅

- ✅ **Set timeouts** for external checks (5s max)
- ✅ **Use tags** for filtering (readiness vs liveness)
- ✅ **Return meaningful descriptions** in results
- ✅ **Handle exceptions gracefully** (Unhealthy state)
- ✅ **Test health checks** in isolation

### DON'T ❌

- ❌ Perform expensive operations (full table scans)
- ❌ Throw exceptions (return Unhealthy instead)
- ❌ Skip timeouts (infinite waits)
- ❌ Check every dependency (focus on critical)

---

## Further Reading

**Infrastructure**:
- [Health Checks](../../operations/infrastructure/health-checks.md) - Built-in health checks

**Transports**:
- [Custom Transports](custom-transports.md) - Transport implementations

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
