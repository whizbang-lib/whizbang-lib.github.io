---
title: Custom Health Checks
version: 1.0.0
category: Extensibility
order: 6
description: >-
  Implement custom health checks for transports, databases, external APIs, and
  custom services
tags: 'health-checks, monitoring, kubernetes, readiness, liveness'
codeReferences:
  - src/Whizbang.Core/Workers/ITransportReadinessCheck.cs
  - src/Whizbang.Core/Workers/DefaultTransportReadinessCheck.cs
---

# Custom Health Checks

**Custom health checks** enable monitoring application health for Kubernetes, load balancers, and observability tools. Implement checks for transports, databases, caches, external APIs, and custom services.

:::note
For built-in health checks, see [Health Checks](../infrastructure/health-checks.md). This guide focuses on **implementing custom health checks**.
:::

---

## Why Custom Health Checks?

**Built-in checks cover common scenarios**, but custom checks enable monitoring of:

| Component | Built-In Check | Custom Check |
|-----------|---------------|--------------|
| **Azure Service Bus** | ✅ Built-in | No customization needed |
| **PostgreSQL** | ✅ Built-in | No customization needed |
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

```csharp
using Microsoft.Extensions.Diagnostics.HealthChecks;

public interface IHealthCheck {
  Task<HealthCheckResult> CheckHealthAsync(
    HealthCheckContext context,
    CancellationToken ct = default
  );
}
```

**HealthCheckResult States**:
- **Healthy**: Service operational
- **Degraded**: Service operational but impaired
- **Unhealthy**: Service not operational

---

## Transport Health Checks

### Pattern 1: Kafka Transport Check

```csharp
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Confluent.Kafka;

public class KafkaHealthCheck : IHealthCheck {
  private readonly IProducer<string, string> _producer;
  private readonly ILogger<KafkaHealthCheck> _logger;

  public KafkaHealthCheck(
    IProducer<string, string> producer,
    ILogger<KafkaHealthCheck> logger
  ) {
    _producer = producer;
    _logger = logger;
  }

  public Task<HealthCheckResult> CheckHealthAsync(
    HealthCheckContext context,
    CancellationToken ct = default
  ) {
    try {
      // Get cluster metadata (verifies connectivity)
      var metadata = _producer.GetMetadata(TimeSpan.FromSeconds(5));
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

```csharp
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

```csharp
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
      await using var conn = new NpgsqlConnection(_connectionString);

      // Set connection timeout
      var csBuilder = new NpgsqlConnectionStringBuilder(_connectionString) {
        Timeout = _timeoutSeconds
      };
      conn.ConnectionString = csBuilder.ToString();

      await conn.OpenAsync(ct);

      // Execute simple query to verify connectivity
      await using var cmd = new NpgsqlCommand("SELECT 1", conn);
      await cmd.ExecuteScalarAsync(ct);

      // Check connection pool stats
      var poolStats = conn.GetConnectionState();

      return HealthCheckResult.Healthy(
        $"PostgreSQL healthy (pool: {poolStats})"
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

```csharp
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

```csharp
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

```csharp
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
- [Health Checks](../infrastructure/health-checks.md) - Built-in health checks

**Transports**:
- [Custom Transports](custom-transports.md) - Transport implementations

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
