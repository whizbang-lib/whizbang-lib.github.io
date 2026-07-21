---
title: Database Readiness
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Workers
order: 3
description: >-
  Database dependency coordination - the ISchemaReadyGate signal, startup
  ordering via WhizbangDatabaseInitializerService, worker gating, and HTTP
  availability middleware
tags: >-
  database-readiness, schema-ready-gate, dependency-coordination, startup,
  migrations, health-checks
codeReferences:
  - src/Whizbang.Core/Workers/ISchemaReadyGate.cs
  - src/Whizbang.Data.EFCore.Postgres/WhizbangDatabaseInitializerService.cs
  - src/Whizbang.Hosting.AspNet/DatabaseAvailabilityMiddleware.cs
  - src/Whizbang.Core/Workers/ClaimWorker.cs
testReferences:
  - tests/Whizbang.Hosting.AspNet.Tests/DatabaseAvailabilityMiddlewareTests.cs
  - tests/Whizbang.Hosting.AspNet.Tests/DatabaseAvailabilityMiddlewareExtensionsTests.cs
  - tests/Whizbang.Core.Tests/Workers/HeartbeatWorkerTests.cs
lastMaintainedCommit: '01f07906'
---

# Database Readiness

Whizbang coordinates workers with database availability through the **`ISchemaReadyGate`** — a signal-based gate that workers await before issuing any SQL. The schema initializer marks the gate ready exactly once, after migrations succeed; until then, every database-touching worker blocks at the top of its `ExecuteAsync`.

:::updated
Earlier designs used a polling `IDatabaseReadinessCheck` interface that each worker invoked on every cycle. That interface has been removed. The shipped mechanism is the signal-based `ISchemaReadyGate` described on this page: workers wait once at startup instead of re-checking readiness per poll, and readiness is driven by the migration runner rather than by table-existence probes.
:::

## Overview

### Why a Readiness Gate?

**Without a gate**, workers race the migration runner:

- Workers registered before the driver's initializer can fire SQL against an unmigrated database
- Startup exceptions are indistinguishable from runtime failures
- Every worker needs its own retry/backoff for the "schema not there yet" window

**With `ISchemaReadyGate`**:

- Workers hold off on all SQL until migrations have completed
- Hosted-service **registration order stops mattering** — a worker whose `StartAsync` runs before the initializer still waits on the gate
- Migration failure keeps the gate closed, so workers never run against a broken schema
- One signal, many waiters — no polling, no per-worker readiness logic

---

## ISchemaReadyGate Interface

```csharp{title="ISchemaReadyGate Interface" description="Signal-based gate workers await before issuing SQL" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "ISchemaReadyGate", "Interface"]}
/// <summary>
/// Signal-based gate that workers await before issuing SQL against the database. The schema
/// initializer (typically WhizbangDatabaseInitializerService in the EFCore Postgres
/// driver) calls MarkReady after migrations succeed. Workers call
/// WaitForReadyAsync at the top of their ExecuteAsync so they hold off
/// on any SQL until the schema is provisioned.
/// </summary>
public interface ISchemaReadyGate {
  /// <summary>
  /// Awaits the schema-ready signal. Returns immediately when ready; otherwise blocks until
  /// MarkReady is called or the cancellation token fires.
  /// </summary>
  Task WaitForReadyAsync(CancellationToken cancellationToken);

  /// <summary>True once MarkReady has been called; pure synchronous query.</summary>
  bool IsReady { get; }

  /// <summary>
  /// Signals all waiters that the schema is provisioned. Idempotent — subsequent calls are
  /// no-ops. Called by the initializer in its StartAsync after migrations complete.
  /// </summary>
  void MarkReady();
}
```

**Contract**:

- `WaitForReadyAsync` returns immediately once ready; otherwise blocks until `MarkReady` or cancellation
- `MarkReady` is **idempotent** and **sticky** — waiters that arrive after the signal return immediately
- `IsReady` is a synchronous, allocation-free query (used by the HTTP middleware)

The default implementation, `SchemaReadyGate`, is a single `TaskCompletionSource` created with `RunContinuationsAsynchronously`; any number of waiters can await it.

---

## Who Marks the Gate Ready

The EFCore Postgres driver registers **`WhizbangDatabaseInitializerService`** — a plain `IHostedService` (not a `BackgroundService`), so its `StartAsync` **blocks host startup** until initialization completes:

```csharp{title="WhizbangDatabaseInitializerService.StartAsync" description="Migrations first, then best-effort partition recompute, then MarkReady" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "Initializer", "Startup"]}
public async Task StartAsync(CancellationToken cancellationToken) {
  await DbContextInitializationRegistry.InitializeAllAsync(
      _serviceProvider, _logger, cancellationToken);

  // Best-effort: recompute partition_number columns that may have drifted across a
  // PartitionCount change. NEVER blocks MarkReady — workers can run on a stale partition
  // map (next claim cycle picks them up correctly via the live PartitionCount).
  await _tryRecomputePartitionsAsync(cancellationToken);

  _schemaReadyGate.MarkReady();
}
```

**Ordering guarantees**:

1. **Migrations run first** (`DbContextInitializationRegistry.InitializeAllAsync`)
2. **Partition recompute is best-effort** — a failure logs a warning but does not block readiness
3. **`MarkReady` is called last** — only after the schema is provisioned

**On migration failure**: the gate is **not** marked ready. `StartAsync` throws, host startup aborts, and workers never enter their main loops. The system halts safely instead of running on a broken schema.

---

## How Workers Use the Gate

Database-touching workers await the gate once, at the top of `ExecuteAsync`, before their first SQL call. From `ClaimWorker`:

```csharp{title="ClaimWorker gate usage" description="Workers await the schema gate before their first SQL call" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "ClaimWorker", "Gate"]}
// Hold off on any SQL until the schema is provisioned. The driver's initializer
// (WhizbangDatabaseInitializerService) signals the gate after migrations succeed.
// This decouples worker startup from hosted-service registration order — even if
// this worker's StartAsync runs before the initializer, we still wait here.
try {
  await _schemaReadyGate.WaitForReadyAsync(stoppingToken);
} catch (OperationCanceledException) {
  return;
}
```

Workers that gate on schema readiness include `ClaimWorker`, `HeartbeatWorker`, `MaintenanceWorker`, `LeaseRenewalWorker`, the inbox/outbox drain and flush workers (`InboxDrainWorker`, `InboxDispatchWorker`, `InboxHandlerWorker`, `OutboxDrainWorker`, `OutboxPublishWorker`, `OutboxCompletionFlushWorker`, `PerspectiveCompletionFlushWorker`, `FailureFlushWorker`), and `DeadLetterRecoveryWorker`.

The `PerspectiveWorker` itself consumes work **channels** fed by `ClaimWorker` (see [Perspective Worker](perspective-worker.md)) — since the upstream claimer is gated, perspective processing implicitly starts only after the schema is ready.

**Key difference from polling designs**: readiness is checked **once**, not per cycle. After the gate opens, transient database failures during runtime surface as ordinary exceptions with retry/backoff in each worker's loop — they are not conflated with "schema not ready yet."

---

## HTTP Availability Middleware

The ASP.NET hosting package includes **`DatabaseAvailabilityMiddleware`**, which returns `503 Service Unavailable` until the gate signals ready — then becomes a pass-through:

```csharp{title="DatabaseAvailabilityMiddleware" description="503 until the schema gate is ready, pass-through afterwards" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "Middleware", "Availability"] tests=["DatabaseAvailabilityMiddlewareTests.NotReady_Returns503AndRetryAfterAsync", "DatabaseAvailabilityMiddlewareTests.Ready_DelegatesToNextAsync"]}
public class DatabaseAvailabilityMiddleware(RequestDelegate next, ISchemaReadyGate schemaReadyGate) {
  private static readonly byte[] _responseBody = Encoding.UTF8.GetBytes(
    """{"error":"Service temporarily unavailable","reason":"schema_initializing"}""");

  public async Task InvokeAsync(HttpContext context) {
    if (!schemaReadyGate.IsReady) {
      context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
      context.Response.Headers.RetryAfter = "30";
      context.Response.ContentType = "application/json";
      await context.Response.Body.WriteAsync(_responseBody, context.RequestAborted);
      return;
    }

    await next(context);
  }
}
```

Clients receive a JSON body with `"reason": "schema_initializing"` and a `Retry-After: 30` header while migrations run.

---

## Health Checks Integration

`ISchemaReadyGate.IsReady` composes naturally with ASP.NET Core health checks for Kubernetes readiness probes:

```csharp{title="Health Checks Integration" description="Expose schema readiness as an ASP.NET Core health check" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "Health", "Checks"]}
public class SchemaReadyHealthCheck : IHealthCheck {
  private readonly ISchemaReadyGate _gate;

  public SchemaReadyHealthCheck(ISchemaReadyGate gate) {
    _gate = gate;
  }

  public Task<HealthCheckResult> CheckHealthAsync(
    HealthCheckContext context,
    CancellationToken ct = default
  ) {
    return Task.FromResult(_gate.IsReady
      ? HealthCheckResult.Healthy("Schema is provisioned")
      : HealthCheckResult.Unhealthy("Schema is still initializing"));
  }
}

// Program.cs
builder.Services.AddHealthChecks()
  .AddCheck<SchemaReadyHealthCheck>("schema", tags: new[] { "ready" });

app.MapHealthChecks("/health/ready", new HealthCheckOptions {
  Predicate = check => check.Tags.Contains("ready")
});
```

**Kubernetes Integration**:

```yaml{title="Health Checks Integration (2)" description="Kubernetes readiness probe against the schema gate" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "Health", "Checks"]}
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

- Container orchestrator knows when the pod is ready
- Traffic routing is delayed until migrations complete
- The `DatabaseAvailabilityMiddleware` covers direct HTTP traffic in the same window

---

## Testing

Because the gate is a simple signal, tests wire workers with a pre-marked gate (or hold it closed to assert blocking behavior):

```csharp{title="Testing with SchemaReadyGate" description="Tests mark the gate ready before starting workers" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "Testing", "Gate"] tests=["HeartbeatWorkerTests.ExecuteAsync_FirstTick_CallsRecordHeartbeatWithProviderIdentityAsync", "HeartbeatWorkerTests.ExecuteAsync_BlocksOnSchemaGate_UntilMarkedReadyAsync"]}
[Test]
public async Task Worker_WithReadyGate_ProcessesWorkAsync() {
  // Arrange — gate ready, worker may issue SQL immediately
  var gate = new SchemaReadyGate();
  gate.MarkReady();

  var worker = new HeartbeatWorker(
    _scopeFactory,
    _instanceProvider,
    gate,
    Options.Create(new HeartbeatWorkerOptions { IntervalSeconds = 1 }),
    NullLogger<HeartbeatWorker>.Instance);

  // Act / Assert — worker enters its main loop without blocking
  await worker.StartAsync(CancellationToken.None);
}

[Test]
public async Task Worker_WithClosedGate_DoesNotTouchDatabaseAsync() {
  // Arrange — gate NEVER marked ready
  var gate = new SchemaReadyGate();
  var worker = new HeartbeatWorker(
    _scopeFactory,
    _instanceProvider,
    gate,
    Options.Create(new HeartbeatWorkerOptions()),
    NullLogger<HeartbeatWorker>.Instance);

  // Act
  await worker.StartAsync(CancellationToken.None);

  // Assert — no SQL was issued; the worker is parked on WaitForReadyAsync
  await Assert.That(gate.IsReady).IsFalse();
}
```

---

## Best Practices

### DO ✅

- ✅ **Await the gate before any SQL** in custom database-touching hosted services
- ✅ **Register the driver initializer** (done automatically by `AddWhizbang().WithDriver.Postgres`)
- ✅ **Use `DatabaseAvailabilityMiddleware`** (or an equivalent health check) so HTTP traffic waits for the schema
- ✅ **Let migration failures abort startup** — a closed gate is the safety mechanism, not a bug
- ✅ **Mark the gate ready in test fixtures** that bypass the real initializer

### DON'T ❌

- ❌ Poll `IsReady` in a loop from workers — `WaitForReadyAsync` is the intended wait primitive
- ❌ Call `MarkReady` from application code — that is the initializer's job (tests excepted)
- ❌ Treat post-ready database outages as a readiness concern — after the gate opens, failures are handled by each worker's retry/backoff
- ❌ Rely on hosted-service registration order for startup sequencing — the gate exists precisely so order doesn't matter

---

## Troubleshooting

### Problem: Workers Never Start Processing

**Symptoms**: No worker log output beyond startup lines; no SQL activity; HTTP returns 503 with `"reason": "schema_initializing"`.

**Causes**:
1. Migrations failed — the initializer threw and the gate was never marked ready
2. The driver initializer is not registered (custom DI setup that bypasses `AddWhizbang().WithDriver.Postgres`)
3. Test fixture constructed workers with a `SchemaReadyGate` that was never marked ready

**Solution**:
```bash{title="Problem: Workers Never Start Processing" description="Check migration output and gate state" category="Implementation" difficulty="BEGINNER" tags=["Operations", "Workers", "Problem:", "Workers"]}
# Check startup logs for migration errors (host aborts on initializer failure)
grep -i "migrat\|initializ" logs.txt

# Verify the database is reachable
psql -h localhost -U postgres -d whizbang -c "SELECT 1;"

# Verify Whizbang tables exist after a successful start
psql -h localhost -U postgres -d whizbang -c "\dt wh_*"
```

### Problem: SQL Fired Against Unmigrated Database

**Symptoms**: "relation does not exist" errors on startup.

**Causes**:
1. A custom hosted service issues SQL without awaiting `ISchemaReadyGate`
2. Application code runs queries during `ConfigureServices`/startup before the host starts

**Solution**: inject `ISchemaReadyGate` and await it first:
```csharp{title="Problem: SQL Fired Against Unmigrated Database" description="Gate custom services on schema readiness" category="Implementation" difficulty="BEGINNER" tags=["Operations", "Workers", "Problem:", "SQL"]}
protected override async Task ExecuteAsync(CancellationToken stoppingToken) {
  await _schemaReadyGate.WaitForReadyAsync(stoppingToken);
  // ... safe to issue SQL from here
}
```

---

## Further Reading

**Related Workers**:
- [Perspective Worker](perspective-worker.md) - Background perspective processing
- [Execution Lifecycle](execution-lifecycle.md) - Startup/shutdown coordination

**Infrastructure**:
- [Migrations](../infrastructure/migrations.md) - Schema management

**Monitoring**:
- [Health Checks](../infrastructure/health-checks.md) - Application health monitoring

---

*Version 1.0.0 - Foundation Release | Last Updated: 2026-07-16*
