---
title: Health Checks
version: 1.0.0
category: Infrastructure
order: 2
description: >-
  Application health monitoring with built-in health checks for transports,
  databases, and custom components
tags: >-
  health-checks, monitoring, readiness, liveness, aspire-dashboard,
  observability
codeReferences:
  - src/Whizbang.Transports.AzureServiceBus/AzureServiceBusHealthCheck.cs
  - src/Whizbang.Data.Dapper.Postgres/PostgresHealthCheck.cs
  - src/Whizbang.Hosting.Azure.ServiceBus/ServiceBusReadinessCheck.cs
  - src/Whizbang.Core/Transports/ITransportReadinessCheck.cs
---

# Health Checks

**Health checks** provide real-time monitoring of application health and dependency availability. Whizbang includes built-in health checks for transports, databases, and infrastructure components with seamless integration into .NET Aspire dashboards and Kubernetes readiness probes.

## Why Health Checks?

**Health checks prevent cascading failures** in distributed systems:

| Use Case | Description | Benefit |
|----------|-------------|---------|
| **Kubernetes Readiness** | Prevent routing traffic to unhealthy instances | Zero-downtime deployments |
| **Load Balancer Health** | Remove unhealthy instances from pool | High availability |
| **Circuit Breakers** | Detect downstream failures early | Fault isolation |
| **Aspire Dashboard** | Real-time health visualization | Faster troubleshooting |
| **Startup Validation** | Verify dependencies before accepting traffic | Fail-fast on misconfiguration |
| **Monitoring Alerts** | Trigger alerts when dependencies fail | Proactive incident response |

**Whizbang Health Checks**:
- ✅ **Transport Connectivity** - Azure Service Bus, In-Memory
- ✅ **Database Connectivity** - PostgreSQL, SQL Server
- ✅ **Custom Checks** - Extensible `IHealthCheck` pattern
- ✅ **Caching** - Avoid excessive health check overhead
- ✅ **Aspire Integration** - Auto-wired dashboard monitoring

---

## Architecture

### Health Check Flow

```
┌────────────────────────────────────────────────────────┐
│  Health Check Endpoint: /health                        │
│  (Kubernetes readiness, load balancer, monitoring)     │
└────────────────┬───────────────────────────────────────┘
                 │
                 │ HTTP GET /health
                 ▼
┌────────────────────────────────────────────────────────┐
│  Microsoft.Extensions.Diagnostics.HealthChecks         │
│  (Built into ASP.NET Core)                             │
│                                                         │
│  Executes all registered health checks in parallel:    │
│  ├─ AzureServiceBusHealthCheck                         │
│  ├─ PostgresHealthCheck                                │
│  ├─ CustomHealthCheck                                  │
│  └─ ...                                                 │
└────────────────┬───────────────────────────────────────┘
                 │
                 │ Aggregate results
                 ▼
┌────────────────────────────────────────────────────────┐
│  Health Check Response                                 │
│                                                         │
│  {                                                      │
│    "status": "Healthy",           // or Degraded, Unhealthy
│    "results": {                                         │
│      "azure_servicebus": {                              │
│        "status": "Healthy",                             │
│        "description": "Transport is available"          │
│      },                                                 │
│      "postgres": {                                      │
│        "status": "Healthy",                             │
│        "description": "Database is accessible"          │
│      }                                                  │
│    }                                                    │
│  }                                                      │
└────────────────────────────────────────────────────────┘
```

---

## Built-In Health Checks

### 1. Azure Service Bus Health Check

**Purpose**: Verify transport is available and connected.

**Usage**:
```csharp{title="Azure Service Bus Health Check" description="Demonstrates azure Service Bus Health Check" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Infrastructure", "Azure", "Service"]}
using Whizbang.Transports.AzureServiceBus;

builder.Services.AddAzureServiceBusTransport(connectionString);
builder.Services.AddAzureServiceBusHealthChecks();  // ⭐ Register health check

// Expose health endpoint
app.MapHealthChecks("/health");
```

**Implementation**:
```csharp{title="Azure Service Bus Health Check - AzureServiceBusHealthCheck" description="Implementation:" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Infrastructure", "Azure", "Service"]}
public class AzureServiceBusHealthCheck(ITransport transport) : IHealthCheck {
  public Task<HealthCheckResult> CheckHealthAsync(
    HealthCheckContext context,
    CancellationToken cancellationToken
  ) {
    // Verify transport is Azure Service Bus
    if (transport is not AzureServiceBusTransport) {
      return Task.FromResult(
        HealthCheckResult.Degraded("Transport is not Azure Service Bus")
      );
    }

    // Transport is instantiated and not disposed
    return Task.FromResult(
      HealthCheckResult.Healthy("Azure Service Bus transport is available")
    );
  }
}
```

**Status Levels**:
- **Healthy**: Transport instantiated and available
- **Degraded**: Wrong transport type registered
- **Unhealthy**: Transport disposed or unavailable

### 2. PostgreSQL Health Check

**Purpose**: Verify database connectivity and query execution.

**Usage**:
```csharp{title="PostgreSQL Health Check" description="Demonstrates postgreSQL Health Check" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Infrastructure", "PostgreSQL", "Health"]}
using Whizbang.Data.Dapper.Postgres;

builder.Services.AddPostgresConnection(connectionString);
builder.Services.AddPostgresHealthChecks();  // ⭐ Register health check

app.MapHealthChecks("/health");
```

**Implementation**:
```csharp{title="PostgreSQL Health Check - PostgresHealthCheck" description="Implementation:" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Infrastructure", "PostgreSQL", "Health"]}
public class PostgresHealthCheck(IDbConnectionFactory connectionFactory) : IHealthCheck {
  public async Task<HealthCheckResult> CheckHealthAsync(
    HealthCheckContext context,
    CancellationToken cancellationToken
  ) {
    try {
      using var connection = await connectionFactory.CreateConnectionAsync(cancellationToken);

      // Execute simple query to verify database is accessible
      _ = await connection.ExecuteScalarAsync("SELECT 1");

      return HealthCheckResult.Healthy("PostgreSQL database is accessible");
    } catch (Exception ex) {
      return HealthCheckResult.Unhealthy("PostgreSQL database is not accessible", ex);
    }
  }
}
```

**What It Checks**:
- ✅ Connection factory can create connections
- ✅ Database accepts queries
- ✅ Network connectivity to database

**Status Levels**:
- **Healthy**: Database accessible and responsive
- **Unhealthy**: Connection failed or query timed out

### 3. Service Bus Readiness Check

**Purpose**: Cached transport readiness check with initialization verification.

**Usage**:
```csharp{title="Service Bus Readiness Check" description="Demonstrates service Bus Readiness Check" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Infrastructure", "Service", "Bus"]}
using Whizbang.Hosting.Azure.ServiceBus;

builder.Services.AddSingleton<ITransportReadinessCheck, ServiceBusReadinessCheck>();

// Use in startup validation
var readinessCheck = app.Services.GetRequiredService<ITransportReadinessCheck>();
if (!await readinessCheck.IsReadyAsync()) {
  throw new InvalidOperationException("Service Bus is not ready");
}
```

**Implementation**:
```csharp{title="Service Bus Readiness Check - ServiceBusReadinessCheck" description="Implementation:" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Infrastructure", "Service", "Bus"]}
public class ServiceBusReadinessCheck : ITransportReadinessCheck {
  private DateTimeOffset? _lastSuccessfulCheck;
  private readonly TimeSpan _cacheDuration = TimeSpan.FromSeconds(30);

  public async Task<bool> IsReadyAsync(CancellationToken cancellationToken) {
    // 1. Check if transport initialized
    if (!_transport.IsInitialized) {
      return false;
    }

    // 2. Check cache (30-second TTL)
    if (_lastSuccessfulCheck.HasValue &&
        DateTimeOffset.UtcNow - _lastSuccessfulCheck.Value < _cacheDuration) {
      return true;  // Cached result
    }

    // 3. Verify ServiceBusClient is open
    if (_client.IsClosed) {
      return false;
    }

    // 4. Cache successful check
    _lastSuccessfulCheck = DateTimeOffset.UtcNow;
    return true;
  }
}
```

**Benefits**:
- 30-second cache reduces health check overhead
- Verifies transport initialization (not just registration)
- Thread-safe with double-checked locking

---

## Registration Patterns

### Basic Registration

```csharp{title="Basic Registration" description="Demonstrates basic Registration" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Infrastructure", "Basic", "Registration"]}
builder.Services.AddHealthChecks()
  .AddCheck<AzureServiceBusHealthCheck>("azure_servicebus")
  .AddCheck<PostgresHealthCheck>("postgres");

app.MapHealthChecks("/health");
```

**Endpoint Output**:
```json{title="Basic Registration (2)" description="Endpoint Output:" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Infrastructure", "Basic", "Registration"]}
{
  "status": "Healthy",
  "results": {
    "azure_servicebus": {
      "status": "Healthy",
      "description": "Azure Service Bus transport is available"
    },
    "postgres": {
      "status": "Healthy",
      "description": "PostgreSQL database is accessible"
    }
  }
}
```

### Detailed Health Checks

```csharp{title="Detailed Health Checks" description="Demonstrates detailed Health Checks" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Infrastructure", "Detailed", "Health"]}
builder.Services.AddHealthChecks()
  .AddCheck<AzureServiceBusHealthCheck>(
    name: "azure_servicebus",
    failureStatus: HealthStatus.Degraded,  // Degraded instead of Unhealthy
    tags: ["ready", "live"]  // Kubernetes readiness and liveness
  )
  .AddCheck<PostgresHealthCheck>(
    name: "postgres",
    failureStatus: HealthStatus.Unhealthy,
    tags: ["ready"]  // Required for readiness, not liveness
  );

// Readiness endpoint (includes postgres)
app.MapHealthChecks("/health/ready", new HealthCheckOptions {
  Predicate = check => check.Tags.Contains("ready")
});

// Liveness endpoint (excludes postgres)
app.MapHealthChecks("/health/live", new HealthCheckOptions {
  Predicate = check => check.Tags.Contains("live")
});
```

**Kubernetes Usage**:
```yaml{title="Detailed Health Checks (2)" description="Kubernetes Usage:" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Infrastructure", "Detailed", "Health"]}
# deployment.yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /health/ready
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 5
```

---

## Custom Health Checks

### Implementing IHealthCheck

```csharp{title="Implementing IHealthCheck" description="Demonstrates implementing IHealthCheck" category="Configuration" difficulty="ADVANCED" tags=["Operations", "Infrastructure", "Implementing", "IHealthCheck"]}
using Microsoft.Extensions.Diagnostics.HealthChecks;

public class RedisHealthCheck : IHealthCheck {
  private readonly IConnectionMultiplexer _redis;

  public RedisHealthCheck(IConnectionMultiplexer redis) {
    _redis = redis;
  }

  public async Task<HealthCheckResult> CheckHealthAsync(
    HealthCheckContext context,
    CancellationToken cancellationToken = default
  ) {
    try {
      // Check Redis connectivity
      var db = _redis.GetDatabase();
      await db.PingAsync();

      // Check specific keys if needed
      var keyExists = await db.KeyExistsAsync("health-check-key");

      var data = new Dictionary<string, object> {
        { "connected", true },
        { "endpoints", _redis.GetEndPoints().Length }
      };

      return HealthCheckResult.Healthy(
        "Redis is accessible",
        data: data
      );
    } catch (Exception ex) {
      return HealthCheckResult.Unhealthy(
        "Redis is not accessible",
        exception: ex
      );
    }
  }
}
```

**Registration**:
```csharp{title="Implementing IHealthCheck (2)" description="Registration:" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Infrastructure", "Implementing", "IHealthCheck"]}
builder.Services.AddSingleton<IConnectionMultiplexer>(/* Redis connection */);
builder.Services.AddHealthChecks()
  .AddCheck<RedisHealthCheck>("redis");
```

### Timeout and Failure Handling

```csharp{title="Timeout and Failure Handling" description="Demonstrates timeout and Failure Handling" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Infrastructure", "Timeout", "Failure"]}
public class ExternalApiHealthCheck : IHealthCheck {
  private readonly HttpClient _httpClient;
  private readonly TimeSpan _timeout = TimeSpan.FromSeconds(5);

  public async Task<HealthCheckResult> CheckHealthAsync(
    HealthCheckContext context,
    CancellationToken cancellationToken
  ) {
    using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
    cts.CancelAfter(_timeout);

    try {
      var response = await _httpClient.GetAsync("/health", cts.Token);

      if (response.IsSuccessStatusCode) {
        return HealthCheckResult.Healthy("External API is responsive");
      }

      return HealthCheckResult.Degraded(
        $"External API returned {response.StatusCode}"
      );
    } catch (OperationCanceledException) {
      return HealthCheckResult.Degraded("External API timed out after 5 seconds");
    } catch (Exception ex) {
      return HealthCheckResult.Unhealthy("External API is not accessible", ex);
    }
  }
}
```

---

## Aspire Dashboard Integration

### Automatic Health Monitoring

When using .NET Aspire, health checks are automatically wired to the dashboard:

```csharp{title="Automatic Health Monitoring" description="When using ." category="Configuration" difficulty="BEGINNER" tags=["Operations", "Infrastructure", "Automatic", "Health"]}
// Service Program.cs
builder.AddServiceDefaults();  // ⭐ Enables Aspire integration

builder.Services.AddHealthChecks()
  .AddCheck<AzureServiceBusHealthCheck>("azure_servicebus")
  .AddCheck<PostgresHealthCheck>("postgres");

var app = builder.Build();
app.MapDefaultEndpoints();  // ⭐ Exposes /health endpoint

app.Run();
```

**Aspire Dashboard** (http://localhost:15888):
- **Resources Tab**: Shows service health status (🟢 Healthy, 🟡 Degraded, 🔴 Unhealthy)
- **Health History**: Track health over time
- **Failure Alerts**: Visual indicators for unhealthy services

---

## Advanced Patterns

### Startup Health Check

```csharp{title="Startup Health Check" description="Demonstrates startup Health Check" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Infrastructure", "Startup", "Health"]}
var builder = WebApplication.CreateBuilder(args);

// Register services and health checks
builder.Services.AddAzureServiceBusTransport(connectionString);
builder.Services.AddHealthChecks()
  .AddCheck<AzureServiceBusHealthCheck>("azure_servicebus");

var app = builder.Build();

// Validate health BEFORE accepting traffic
var healthCheckService = app.Services.GetRequiredService<HealthCheckService>();
var healthReport = await healthCheckService.CheckHealthAsync();

if (healthReport.Status != HealthStatus.Healthy) {
  Console.WriteLine("❌ Application is not healthy - failing startup");
  Console.WriteLine($"Status: {healthReport.Status}");

  foreach (var (key, entry) in healthReport.Entries) {
    if (entry.Status != HealthStatus.Healthy) {
      Console.WriteLine($"  - {key}: {entry.Status} - {entry.Description}");
    }
  }

  Environment.Exit(1);  // Fail fast
}

Console.WriteLine("✅ All health checks passed - starting application");
app.Run();
```

**Benefit**: Prevent application from starting if dependencies are unavailable.

### Cached Health Checks

```csharp{title="Cached Health Checks" description="Demonstrates cached Health Checks" category="Configuration" difficulty="ADVANCED" tags=["Operations", "Infrastructure", "Cached", "Health"]}
public class CachedDatabaseHealthCheck : IHealthCheck {
  private readonly IDbConnectionFactory _connectionFactory;
  private DateTimeOffset? _lastCheck;
  private HealthCheckResult? _cachedResult;
  private readonly TimeSpan _cacheDuration = TimeSpan.FromMinutes(1);
  private readonly SemaphoreSlim _lock = new(1, 1);

  public async Task<HealthCheckResult> CheckHealthAsync(
    HealthCheckContext context,
    CancellationToken cancellationToken
  ) {
    // Return cached result if available and fresh
    if (_cachedResult != null &&
        _lastCheck.HasValue &&
        DateTimeOffset.UtcNow - _lastCheck.Value < _cacheDuration) {
      return _cachedResult;
    }

    await _lock.WaitAsync(cancellationToken);
    try {
      // Double-check cache after acquiring lock
      if (_cachedResult != null &&
          _lastCheck.HasValue &&
          DateTimeOffset.UtcNow - _lastCheck.Value < _cacheDuration) {
        return _cachedResult;
      }

      // Perform actual health check
      using var connection = await _connectionFactory.CreateConnectionAsync(cancellationToken);
      _ = await connection.ExecuteScalarAsync("SELECT 1");

      _cachedResult = HealthCheckResult.Healthy("Database is accessible");
      _lastCheck = DateTimeOffset.UtcNow;

      return _cachedResult;
    } catch (Exception ex) {
      _cachedResult = HealthCheckResult.Unhealthy("Database is not accessible", ex);
      _lastCheck = DateTimeOffset.UtcNow;
      return _cachedResult;
    } finally {
      _lock.Release();
    }
  }
}
```

**Use Case**: Reduce database load from frequent health checks (Kubernetes polls every 5-10 seconds).

### Composite Health Checks

```csharp{title="Composite Health Checks" description="Demonstrates composite Health Checks" category="Configuration" difficulty="ADVANCED" tags=["Operations", "Infrastructure", "Composite", "Health"]}
public class ApplicationHealthCheck : IHealthCheck {
  private readonly IHealthCheck[] _checks;

  public ApplicationHealthCheck(
    AzureServiceBusHealthCheck transportCheck,
    PostgresHealthCheck databaseCheck,
    RedisHealthCheck cacheCheck
  ) {
    _checks = new IHealthCheck[] { transportCheck, databaseCheck, cacheCheck };
  }

  public async Task<HealthCheckResult> CheckHealthAsync(
    HealthCheckContext context,
    CancellationToken cancellationToken
  ) {
    var tasks = _checks.Select(check =>
      check.CheckHealthAsync(context, cancellationToken)
    );

    var results = await Task.WhenAll(tasks);

    var unhealthyResults = results.Where(r => r.Status == HealthStatus.Unhealthy).ToList();
    var degradedResults = results.Where(r => r.Status == HealthStatus.Degraded).ToList();

    if (unhealthyResults.Any()) {
      return HealthCheckResult.Unhealthy(
        $"{unhealthyResults.Count} component(s) unhealthy"
      );
    }

    if (degradedResults.Any()) {
      return HealthCheckResult.Degraded(
        $"{degradedResults.Count} component(s) degraded"
      );
    }

    return HealthCheckResult.Healthy("All components healthy");
  }
}
```

---

## Best Practices

### DO ✅

- ✅ **Register health checks for all dependencies** (database, cache, transport)
- ✅ **Use tags for readiness vs liveness** (readiness includes dependencies, liveness doesn't)
- ✅ **Cache expensive checks** (database queries, external API calls)
- ✅ **Use timeouts** to prevent health checks from blocking
- ✅ **Validate health on startup** (fail fast if misconfigured)
- ✅ **Monitor health in Aspire dashboard** during development
- ✅ **Return detailed status** (Healthy, Degraded, Unhealthy with descriptions)

### DON'T ❌

- ❌ Perform expensive operations in health checks (use caching)
- ❌ Include authentication in liveness checks (should always succeed if app is running)
- ❌ Ignore health check failures in logs (investigate and fix)
- ❌ Use default `/healthz` endpoint (configure specific paths like `/health/ready`)
- ❌ Skip health checks for "optional" dependencies (mark as Degraded instead)
- ❌ Block application startup on non-critical dependencies

---

## Troubleshooting

### Problem: Health Check Always Returns Unhealthy

**Symptoms**: Health endpoint returns 503 Service Unavailable.

**Causes**:
1. Dependency actually unavailable (database down, Service Bus unreachable)
2. Health check timeout too short
3. Caching not working (re-checking every request)

**Solution**:
```csharp{title="Problem: Health Check Always Returns Unhealthy" description="Demonstrates problem: Health Check Always Returns Unhealthy" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Infrastructure", "Problem:", "Health"]}
// 1. Check logs for actual failure reason
var healthReport = await healthCheckService.CheckHealthAsync();
foreach (var (key, entry) in healthReport.Entries) {
  logger.LogError("Health check {Name}: {Status} - {Description} - {Exception}",
    key, entry.Status, entry.Description, entry.Exception);
}

// 2. Increase timeout
builder.Services.AddHealthChecks()
  .AddCheck<PostgresHealthCheck>("postgres", timeout: TimeSpan.FromSeconds(30));

// 3. Verify caching logic
if (_lastCheck.HasValue) {
  var age = DateTimeOffset.UtcNow - _lastCheck.Value;
  logger.LogDebug("Cache age: {Age}, Duration: {Duration}", age, _cacheDuration);
}
```

### Problem: Kubernetes Keeps Restarting Pod

**Symptoms**: Pod repeatedly restarted with "Liveness probe failed" in events.

**Cause**: Liveness check includes database or external dependencies (shouldn't).

**Solution**:
```csharp{title="Problem: Kubernetes Keeps Restarting Pod" description="Demonstrates problem: Kubernetes Keeps Restarting Pod" category="Configuration" difficulty="BEGINNER" tags=["Operations", "Infrastructure", "Problem:", "Kubernetes"]}
// Liveness should only check app is running (no external dependencies)
builder.Services.AddHealthChecks()
  .AddCheck("self", () => HealthCheckResult.Healthy("App is running"), tags: ["live"])
  .AddCheck<PostgresHealthCheck>("postgres", tags: ["ready"]);  // Readiness only

// Separate endpoints
app.MapHealthChecks("/health/live", new HealthCheckOptions {
  Predicate = check => check.Tags.Contains("live")
});

app.MapHealthChecks("/health/ready", new HealthCheckOptions {
  Predicate = check => check.Tags.Contains("ready")
});
```

### Problem: Health Checks Cause Database Overload

**Symptoms**: Database CPU spikes from health check queries.

**Cause**: Kubernetes polling every 5 seconds across 100 pods = 20 queries/second.

**Solution**:
```csharp{title="Problem: Health Checks Cause Database Overload" description="Demonstrates problem: Health Checks Cause Database Overload" category="Configuration" difficulty="INTERMEDIATE" tags=["Operations", "Infrastructure", "Problem:", "Health"]}
// Add caching to reduce database load
public class CachedPostgresHealthCheck : PostgresHealthCheck {
  private DateTimeOffset? _lastCheck;
  private HealthCheckResult? _cachedResult;
  private readonly TimeSpan _cacheDuration = TimeSpan.FromSeconds(30);  // ⭐ Cache for 30 seconds

  public override async Task<HealthCheckResult> CheckHealthAsync(...) {
    if (_cachedResult != null &&
        _lastCheck.HasValue &&
        DateTimeOffset.UtcNow - _lastCheck.Value < _cacheDuration) {
      return _cachedResult;  // Return cached result
    }

    _cachedResult = await base.CheckHealthAsync(context, cancellationToken);
    _lastCheck = DateTimeOffset.UtcNow;
    return _cachedResult;
  }
}
```

---

## Further Reading

**Infrastructure**:
- [Aspire Integration](aspire-integration.md) - .NET Aspire orchestration and dashboard
- [Policies](policies.md) - Policy-based routing and decisions

**Transports**:
- [Azure Service Bus Transport](../../messaging/transports/azure-service-bus.md) - Transport health checks

**Data Access**:
- [Dapper + PostgreSQL](../data/dapper-postgres.md) - Database health checks

**External Resources**:
- [ASP.NET Core Health Checks](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/health-checks)
- [Kubernetes Liveness and Readiness Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
