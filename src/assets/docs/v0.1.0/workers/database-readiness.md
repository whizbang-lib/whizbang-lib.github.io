---
title: "Database Readiness"
version: 0.1.0
category: Workers
order: 3
description: "Database dependency coordination - IDatabaseReadinessCheck pattern, startup coordination, retry logic, and caching strategies"
tags: database-readiness, dependency-coordination, startup, retry-logic, health-checks
codeReferences:
  - src/Whizbang.Core/Messaging/IDatabaseReadinessCheck.cs
  - src/Whizbang.Data.Postgres/PostgresDatabaseReadinessCheck.cs
  - src/Whizbang.Core/Workers/PerspectiveWorker.cs
---

# Database Readiness

The **IDatabaseReadinessCheck** pattern provides a standard way for workers to coordinate with database availability during startup and runtime. It distinguishes between "database not ready yet" (expected during startup) and "database connection failed" (unexpected runtime error).

## Overview

### Why Database Readiness Checks?

**Without readiness checks**:
```csharp
// ❌ Worker starts immediately, database might not be ready
protected override async Task ExecuteAsync(CancellationToken ct) {
  while (!ct.IsCancellationRequested) {
    try {
      await _workCoordinator.ProcessWorkBatchAsync(...);
    } catch (Npgsql.NpgsqlException ex) {
      // Exception thrown - but is this:
      // - Startup (migrations not run yet)?
      // - Runtime failure (connection pool exhausted)?
      // - Server down (network issue)?
      // Can't distinguish - logs are confusing
      _logger.LogError(ex, "Failed to process work");
    }
  }
}
```

**With readiness checks**:
```csharp
// ✅ Worker coordinates with database availability
protected override async Task ExecuteAsync(CancellationToken ct) {
  while (!ct.IsCancellationRequested) {
    var isDatabaseReady = await _databaseReadinessCheck.IsReadyAsync(ct);
    if (!isDatabaseReady) {
      // ✅ Clear signal: database not ready (expected during startup)
      _logger.LogInformation("Database not ready, skipping processing");
      await Task.Delay(_pollingInterval, ct);
      continue;
    }

    // ✅ Database is ready - safe to process work
    try {
      await _workCoordinator.ProcessWorkBatchAsync(...);
    } catch (Npgsql.NpgsqlException ex) {
      // ✅ Now we know this is a runtime failure (not startup)
      _logger.LogError(ex, "Database connection failed during processing");
    }
  }
}
```

**Benefits**:
- ✅ **Distinguish startup from runtime failures**
- ✅ **Avoid exception noise** during startup (clean logs)
- ✅ **Graceful waiting** (poll until ready, don't crash)
- ✅ **Coordination** (multiple workers wait for same signal)
- ✅ **Observability** (track consecutive "not ready" checks)

---

## IDatabaseReadinessCheck Interface

**IDatabaseReadinessCheck.cs**:
```csharp
/// <summary>
/// Interface for checking whether the database is ready for work coordinator operations.
/// Implementations can check connectivity, schema availability, or other readiness criteria.
/// </summary>
/// <remarks>
/// This interface is used by workers to determine if database operations
/// should be attempted. When the database is not ready, work processing
/// is skipped and messages remain buffered in memory until the database becomes available.
///
/// Examples of readiness checks:
/// - PostgreSQL: Check if connection is available and required tables exist
/// - SQL Server: Check if database is accessible and schema is initialized
/// - Cassandra: Check if keyspace exists and is reachable
/// - MongoDB: Check if connection is established and collections exist
/// </remarks>
/// <docs>workers/database-readiness</docs>
public interface IDatabaseReadinessCheck {
  /// <summary>
  /// Checks if the database is ready for work coordinator operations.
  /// </summary>
  /// <param name="cancellationToken">Cancellation token to cancel the readiness check.</param>
  /// <returns>True if the database is ready, false otherwise.</returns>
  /// <remarks>
  /// This method should be fast and lightweight. If the check requires network I/O,
  /// consider implementing caching or circuit breaker patterns to avoid excessive overhead.
  /// </remarks>
  Task<bool> IsReadyAsync(CancellationToken cancellationToken = default);
}
```

**Contract**:
- Returns `true` if database is ready for operations
- Returns `false` if database is not ready (startup) or unavailable
- Should be **fast** (lightweight check)
- Should **not throw** exceptions (return `false` on error)
- Can use **caching** to avoid repeated network calls

---

## PostgreSQL Implementation

**PostgresDatabaseReadinessCheck.cs**:
```csharp
public class PostgresDatabaseReadinessCheck : IDatabaseReadinessCheck {
  private readonly IDbConnectionFactory _connectionFactory;
  private readonly ILogger<PostgresDatabaseReadinessCheck> _logger;

  private bool? _isReady;  // Cache result once ready

  public PostgresDatabaseReadinessCheck(
    IDbConnectionFactory connectionFactory,
    ILogger<PostgresDatabaseReadinessCheck> logger
  ) {
    _connectionFactory = connectionFactory;
    _logger = logger;
  }

  public async Task<bool> IsReadyAsync(CancellationToken ct = default) {
    // Once ready, stay ready (no need to re-check)
    if (_isReady == true) {
      return true;
    }

    try {
      await using var connection = _connectionFactory.CreateConnection();
      await connection.OpenAsync(ct);

      // Check for required tables
      var requiredTables = new[] {
        "wh_outbox",
        "wh_inbox",
        "wh_events",
        "wh_perspective_checkpoints"
      };

      foreach (var tableName in requiredTables) {
        var tableExists = await connection.ExecuteScalarAsync<bool>(
          """
          SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = @TableName
          )
          """,
          new { TableName = tableName },
          cancellationToken: ct
        );

        if (!tableExists) {
          _logger.LogDebug(
            "Database not ready: table '{TableName}' not found",
            tableName
          );
          _isReady = false;
          return false;
        }
      }

      // All tables exist - database is ready
      _logger.LogInformation("Database is ready");
      _isReady = true;
      return true;

    } catch (Npgsql.NpgsqlException ex) {
      _logger.LogDebug(
        "Database not ready: {Error}",
        ex.Message
      );
      _isReady = false;
      return false;
    }
  }
}
```

**Key Design Decisions**:
- **Cache `true` result**: Once ready, always ready (no need to re-check)
- **Don't cache `false` result**: Database may become ready later (retry on next call)
- **Check required tables**: Ensures migrations have run
- **Log at Debug level for `false`**: Avoid log noise during startup
- **Log at Information level for `true`**: Important milestone
- **Never throw**: Return `false` on any error

---

## Integration with Workers

### PerspectiveWorker Integration

**PerspectiveWorker.cs:98-121**:
```csharp
while (!stoppingToken.IsCancellationRequested) {
  try {
    // Check database readiness before attempting work coordinator call
    var isDatabaseReady = await _databaseReadinessCheck.IsReadyAsync(stoppingToken);
    if (!isDatabaseReady) {
      // Database not ready - skip ProcessWorkBatchAsync
      Interlocked.Increment(ref _consecutiveDatabaseNotReadyChecks);

      _logger.LogInformation(
        "Database not ready, skipping perspective checkpoint processing (consecutive checks: {ConsecutiveCount})",
        _consecutiveDatabaseNotReadyChecks
      );

      // Warn if database has been continuously unavailable
      if (_consecutiveDatabaseNotReadyChecks > 10) {
        _logger.LogWarning(
          "Database not ready for {ConsecutiveCount} consecutive polling cycles. Perspective worker is paused.",
          _consecutiveDatabaseNotReadyChecks
        );
      }

      // Wait before retry
      await Task.Delay(_options.PollingIntervalMilliseconds, stoppingToken);
      continue;
    }

    // Database is ready - reset consecutive counter
    Interlocked.Exchange(ref _consecutiveDatabaseNotReadyChecks, 0);

    await ProcessWorkBatchAsync(stoppingToken);
  } catch (Exception ex) when (ex is not OperationCanceledException) {
    _logger.LogError(ex, "Error processing perspective checkpoints");
  }
}
```

**Workflow**:
1. **Check readiness** before attempting database operations
2. **If not ready**:
   - Increment consecutive "not ready" counter
   - Log at Information level (expected during startup)
   - Warn if threshold exceeded (10 consecutive checks)
   - Wait polling interval, then retry
3. **If ready**:
   - Reset consecutive counter
   - Proceed with work processing
4. **On exception**:
   - Now known to be runtime failure (not startup issue)
   - Log at Error level

### Startup Processing Integration

**PerspectiveWorker.cs:82-94**:
```csharp
// Process any pending perspective checkpoints IMMEDIATELY on startup (before first polling delay)
try {
  _logger.LogDebug("Checking for pending perspective checkpoints on startup...");
  var isDatabaseReady = await _databaseReadinessCheck.IsReadyAsync(stoppingToken);
  if (isDatabaseReady) {
    await ProcessWorkBatchAsync(stoppingToken);
    _logger.LogDebug("Initial perspective checkpoint processing complete");
  } else {
    _logger.LogWarning("Database not ready on startup - skipping initial perspective checkpoint processing");
  }
} catch (Exception ex) when (ex is not OperationCanceledException) {
  _logger.LogError(ex, "Error processing initial perspective checkpoints on startup");
}
```

**Why important**:
- Worker checks readiness **before** attempting immediate startup processing
- If not ready, skip processing (don't crash worker)
- Worker will retry on first polling cycle

---

## Caching Strategies

### Strategy 1: Cache Once Ready (Recommended)

**PostgreSQL Example**:
```csharp
private bool? _isReady;

public async Task<bool> IsReadyAsync(CancellationToken ct = default) {
  if (_isReady == true) {
    return true;  // ✅ Cache hit - skip check
  }

  // Check database connectivity and schema
  var ready = await CheckDatabaseAsync(ct);

  if (ready) {
    _isReady = true;  // ✅ Cache for future calls
  }

  return ready;
}
```

**Rationale**:
- Once database is ready, it stays ready (during runtime)
- Database doesn't "become not ready" during normal operation
- Avoids repeated network calls after startup

### Strategy 2: Time-Based Caching

**Use Case**: Periodic health checks for monitoring dashboards.

```csharp
private bool? _isReady;
private DateTimeOffset? _lastCheck;
private static readonly TimeSpan CacheDuration = TimeSpan.FromMinutes(1);

public async Task<bool> IsReadyAsync(CancellationToken ct = default) {
  if (_isReady == true && _lastCheck.HasValue &&
      DateTimeOffset.UtcNow - _lastCheck.Value < CacheDuration) {
    return true;  // ✅ Cache hit within TTL
  }

  _lastCheck = DateTimeOffset.UtcNow;
  var ready = await CheckDatabaseAsync(ct);
  _isReady = ready;

  return ready;
}
```

**Rationale**:
- Provides periodic "heartbeat" check
- Detects database failures during runtime
- Balances performance vs observability

### Strategy 3: Circuit Breaker

**Use Case**: Avoid overwhelming unhealthy database with connection attempts.

```csharp
private CircuitBreakerState _state = CircuitBreakerState.Closed;
private int _consecutiveFailures;
private DateTimeOffset? _circuitOpenedAt;
private static readonly TimeSpan CircuitResetTimeout = TimeSpan.FromSeconds(30);

public async Task<bool> IsReadyAsync(CancellationToken ct = default) {
  // If circuit is open, wait for reset timeout
  if (_state == CircuitBreakerState.Open) {
    if (DateTimeOffset.UtcNow - _circuitOpenedAt! < CircuitResetTimeout) {
      return false;  // ✅ Circuit open - don't attempt check
    }

    _state = CircuitBreakerState.HalfOpen;
  }

  try {
    var ready = await CheckDatabaseAsync(ct);

    if (ready) {
      // Success - close circuit
      _state = CircuitBreakerState.Closed;
      _consecutiveFailures = 0;
      return true;
    } else {
      // Not ready - increment failures
      _consecutiveFailures++;

      if (_consecutiveFailures >= 5) {
        // Open circuit after 5 consecutive failures
        _state = CircuitBreakerState.Open;
        _circuitOpenedAt = DateTimeOffset.UtcNow;
        _logger.LogWarning("Circuit breaker opened after {Count} consecutive failures", _consecutiveFailures);
      }

      return false;
    }
  } catch (Exception ex) {
    _logger.LogDebug("Database check failed: {Error}", ex.Message);
    _consecutiveFailures++;

    if (_consecutiveFailures >= 5) {
      _state = CircuitBreakerState.Open;
      _circuitOpenedAt = DateTimeOffset.UtcNow;
    }

    return false;
  }
}

enum CircuitBreakerState { Closed, Open, HalfOpen }
```

**Benefits**:
- Prevents excessive connection attempts to unhealthy database
- Automatic recovery after timeout
- Reduces load on database during outages

---

## Configuration

**Service Registration**:
```csharp
// Program.cs
builder.Services.AddSingleton<IDatabaseReadinessCheck, PostgresDatabaseReadinessCheck>();
builder.Services.AddHostedService<PerspectiveWorker>();
```

**Options Pattern** (optional):
```csharp
public class DatabaseReadinessOptions {
  /// <summary>
  /// Required tables that must exist for database to be considered ready.
  /// </summary>
  public string[] RequiredTables { get; set; } = {
    "wh_outbox",
    "wh_inbox",
    "wh_events",
    "wh_perspective_checkpoints"
  };

  /// <summary>
  /// Cache duration for readiness check results.
  /// Null = cache indefinitely once ready (default)
  /// </summary>
  public TimeSpan? CacheDuration { get; set; } = null;

  /// <summary>
  /// Circuit breaker threshold (number of consecutive failures before opening circuit).
  /// Null = no circuit breaker (default)
  /// </summary>
  public int? CircuitBreakerThreshold { get; set; } = null;
}
```

**Configuration Example**:
```csharp
builder.Services.Configure<DatabaseReadinessOptions>(options => {
  options.RequiredTables = new[] {
    "wh_outbox",
    "wh_inbox",
    "wh_events",
    "wh_perspective_checkpoints",
    "wh_service_instances"  // Additional table
  };
  options.CacheDuration = TimeSpan.FromMinutes(5);  // Re-check every 5 minutes
});
```

---

## Health Checks Integration

**ASP.NET Core Health Checks**:
```csharp
public class DatabaseReadinessHealthCheck : IHealthCheck {
  private readonly IDatabaseReadinessCheck _readinessCheck;

  public DatabaseReadinessHealthCheck(IDatabaseReadinessCheck readinessCheck) {
    _readinessCheck = readinessCheck;
  }

  public async Task<HealthCheckResult> CheckHealthAsync(
    HealthCheckContext context,
    CancellationToken ct = default
  ) {
    var isReady = await _readinessCheck.IsReadyAsync(ct);

    return isReady
      ? HealthCheckResult.Healthy("Database is ready")
      : HealthCheckResult.Unhealthy("Database is not ready");
  }
}

// Program.cs
builder.Services.AddHealthChecks()
  .AddCheck<DatabaseReadinessHealthCheck>("database", tags: new[] { "ready" });

app.MapHealthChecks("/health/ready", new HealthCheckOptions {
  Predicate = check => check.Tags.Contains("ready")
});
```

**Kubernetes Integration**:
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: whizbang-worker
spec:
  containers:
  - name: worker
    image: whizbang:latest
    readinessProbe:
      httpGet:
        path: /health/ready
        port: 8080
      initialDelaySeconds: 5
      periodSeconds: 10
```

**Benefits**:
- Container orchestrator knows when pod is ready
- Traffic routing delayed until database is ready
- Automatic pod restart if database becomes unavailable

---

## Observability

### Metrics

**Track readiness state**:
```csharp
public class ObservableDatabaseReadinessCheck : IDatabaseReadinessCheck {
  private readonly IDatabaseReadinessCheck _inner;
  private readonly IMetrics _metrics;

  public async Task<bool> IsReadyAsync(CancellationToken ct = default) {
    var sw = Stopwatch.StartNew();
    var ready = await _inner.IsReadyAsync(ct);
    sw.Stop();

    _metrics.RecordGauge("database.readiness", ready ? 1 : 0);
    _metrics.RecordHistogram("database.readiness.check_duration_ms", sw.ElapsedMilliseconds);

    return ready;
  }
}
```

**Key Metrics**:
- `database.readiness` (gauge): 1 = ready, 0 = not ready
- `database.readiness.check_duration_ms` (histogram): Check latency
- `database.readiness.consecutive_failures` (counter): Track failure streaks

### Logging

**Log level guidance**:
```csharp
// ✅ GOOD: Log levels match severity
if (!isReady) {
  _logger.LogDebug("Database not ready: {Reason}", reason);  // Startup
} else {
  _logger.LogInformation("Database is ready");  // Milestone
}

if (consecutiveFailures > 10) {
  _logger.LogWarning("Database not ready for {Count} consecutive checks", consecutiveFailures);  // Alert
}
```

**❌ BAD: Logging "not ready" at Error level**:
```csharp
if (!isReady) {
  _logger.LogError("Database not ready");  // ❌ Creates noise during startup
}
```

---

## Testing

### Testing Readiness Check

```csharp
[Test]
public async Task IsReadyAsync_WithRunningDatabase_ReturnsTrueAsync() {
  // Arrange
  var dbCheck = new PostgresDatabaseReadinessCheck(_connectionFactory, _logger);

  // Act
  var isReady = await dbCheck.IsReadyAsync();

  // Assert
  await Assert.That(isReady).IsTrue();
}

[Test]
public async Task IsReadyAsync_WithMissingTables_ReturnsFalseAsync() {
  // Arrange
  var dbCheck = new PostgresDatabaseReadinessCheck(_emptyDbConnectionFactory, _logger);

  // Act
  var isReady = await dbCheck.IsReadyAsync();

  // Assert
  await Assert.That(isReady).IsFalse();
}
```

### Testing Worker Integration

```csharp
[Test]
public async Task Worker_DatabaseNotReady_SkipsProcessingAsync() {
  // Arrange
  var mockDbCheck = new Mock<IDatabaseReadinessCheck>();
  mockDbCheck.Setup(x => x.IsReadyAsync(It.IsAny<CancellationToken>()))
    .ReturnsAsync(false);

  var worker = new PerspectiveWorker(
    _instanceProvider,
    _scopeFactory,
    _options,
    mockDbCheck.Object,
    _logger
  );

  // Act
  await worker.StartAsync();
  await Task.Delay(TimeSpan.FromSeconds(2));  // Let worker poll
  await worker.StopAsync();

  // Assert - ProcessWorkBatchAsync should NOT have been called
  await Assert.That(worker.ConsecutiveDatabaseNotReadyChecks).IsGreaterThan(0);
}
```

---

## Best Practices

### DO ✅

- ✅ **Cache `true` result** - Once ready, always ready (during runtime)
- ✅ **Don't cache `false` result** - Database may become ready later
- ✅ **Check required tables** - Ensures migrations have run
- ✅ **Log at appropriate levels** - Debug for `false`, Information for `true`
- ✅ **Never throw exceptions** - Return `false` on error
- ✅ **Use circuit breaker** for high-frequency checks
- ✅ **Track consecutive failures** for alerting
- ✅ **Integrate with health checks** for Kubernetes readiness probes

### DON'T ❌

- ❌ Throw exceptions from `IsReadyAsync()` (return `false` instead)
- ❌ Log "not ready" at Error level (creates noise during startup)
- ❌ Cache `false` result indefinitely (prevents recovery)
- ❌ Make expensive checks (lightweight only)
- ❌ Skip readiness checks (workers will crash on startup)
- ❌ Ignore consecutive failures (could indicate larger problem)

---

## Troubleshooting

### Problem: Worker Keeps Reporting "Database Not Ready"

**Symptoms**: Logs show repeated "Database not ready" messages.

**Causes**:
1. Migrations haven't run yet
2. Required tables missing
3. Connection string incorrect
4. Database server not started

**Solution**:
```bash
# Check if database is accessible
psql -h localhost -U postgres -d whizbang -c "SELECT 1;"

# Check if required tables exist
psql -h localhost -U postgres -d whizbang -c "\dt wh_*"

# Run migrations
dotnet ef database update

# Check logs for specific table missing
grep "table '.*' not found" logs.txt
```

### Problem: False Positive (Reports Ready When Not)

**Symptoms**: Worker starts, then crashes with database errors.

**Causes**:
1. Check only verifies connectivity, not schema
2. Caching bug (cache `false` as `true`)

**Solution**: Enhance check to verify table existence:
```csharp
public async Task<bool> IsReadyAsync(CancellationToken ct = default) {
  // Don't just check connection - verify tables too
  var tableExists = await connection.ExecuteScalarAsync<bool>(
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'wh_outbox')",
    cancellationToken: ct
  );

  return tableExists;
}
```

### Problem: Performance Impact

**Symptoms**: High database load from readiness checks.

**Causes**:
1. No caching (checking every poll)
2. Expensive query (complex schema check)

**Solution**: Implement caching and lightweight checks:
```csharp
private bool? _isReady;

public async Task<bool> IsReadyAsync(CancellationToken ct = default) {
  if (_isReady == true) {
    return true;  // ✅ Skip check if already ready
  }

  // Lightweight check - just verify connection and one table
  var ready = await connection.ExecuteScalarAsync<bool>(
    "SELECT EXISTS (SELECT 1 FROM wh_outbox LIMIT 1)",
    cancellationToken: ct
  );

  if (ready) {
    _isReady = true;
  }

  return ready;
}
```

---

## Further Reading

**Related Workers**:
- [Perspective Worker](perspective-worker.md) - Background checkpoint processing
- [Execution Lifecycle](execution-lifecycle.md) - Startup/shutdown coordination

**Infrastructure**:
- [PostgreSQL Setup](../infrastructure/postgresql-setup.md) - Database initialization
- [Migrations](../data/migrations.md) - Schema management

**Testing**:
- [Integration Testing](../testing/integration.md) - Testing database integration

**Monitoring**:
- [Health Checks](../monitoring/health-checks.md) - Application health monitoring

---

*Version 0.1.0 - Foundation Release | Last Updated: 2025-12-21*
