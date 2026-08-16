---
title: Database Readiness
pageType: concept
verifiedAgainstCommit: 0bc6065b
verifiedDate: 2026-08-05
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
  - src/Whizbang.Core/Workers/SchemaInitializationOptions.cs
  - src/Whizbang.Data.EFCore.Postgres/WhizbangDatabaseInitializerService.cs
  - src/Whizbang.Hosting.AspNet/DatabaseAvailabilityMiddleware.cs
  - src/Whizbang.Hosting.AspNet/AvailabilityGateMode.cs
  - src/Whizbang.Core/Workers/ClaimWorker.cs
testReferences:
  - tests/Whizbang.Hosting.AspNet.Tests/DatabaseAvailabilityMiddlewareTests.cs
  - tests/Whizbang.Hosting.AspNet.Tests/DatabaseAvailabilityMiddlewareExtensionsTests.cs
  - tests/Whizbang.Core.Tests/Workers/HeartbeatWorkerTests.cs
  - tests/Whizbang.Core.Tests/Workers/SchemaInitializationOptionsTests.cs
  - tests/Whizbang.Data.EFCore.Postgres.Tests/WhizbangDatabaseInitializerServiceTests.cs
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

The EFCore Postgres driver registers **`WhizbangDatabaseInitializerService`** — a plain `IHostedService` (not a `BackgroundService`). How its `StartAsync` behaves depends on `SchemaInitializationOptions.NonBlockingSchemaInit`:

- **Non-blocking (`NonBlockingSchemaInit = true`, the turnkey default)**: `StartAsync` returns immediately and initialization runs in the background. The host binds its port and can answer liveness probes while the gate stays closed until migrations succeed. An optional `SchemaInitializationOptions.MigrationTimeout` (default: none) treats a hung migration as failed so the pod doesn't sit alive-but-wedged forever.
- **Blocking (`NonBlockingSchemaInit = false`, opt-out)**: initialization runs inline in `StartAsync`, so the host does not finish starting (no HTTP port, no workers) until it completes.

Either way, the same initialization sequence runs:

```csharp{title="WhizbangDatabaseInitializerService initialization sequence" description="Migrations first, then best-effort partition recompute, then MarkReady" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "Initializer", "Startup"] tests=["WhizbangDatabaseInitializerServiceTests.Blocking_StartAsync_WaitsForInit_ThenMarksReadyAsync", "WhizbangDatabaseInitializerServiceTests.NonBlocking_StartAsync_ReturnsBeforeInit_ThenMarksReadyWhenDoneAsync"]}
private async Task _runInitializationAsync(CancellationToken cancellationToken) {
  // ISchemaInitializationRunner.RunAsync — delegates to
  // DbContextInitializationRegistry.InitializeAllAsync (with MigrationTimeout as a ceiling, if set)
  await _runMigrationsAsync(cancellationToken);

  // Best-effort: recompute partition_number columns that may have drifted across a
  // PartitionCount change. NEVER blocks MarkReady — workers can run on a stale partition
  // map (next claim cycle picks them up correctly via the live PartitionCount).
  await TryRecomputePartitionsAsync(cancellationToken);

  _schemaReadyGate.MarkReady();
}
```

**Ordering guarantees**:

1. **Migrations run first** (`ISchemaInitializationRunner.RunAsync`, which delegates to `DbContextInitializationRegistry.InitializeAllAsync`)
2. **Partition recompute is best-effort** — a failure logs a warning but does not block readiness
3. **`MarkReady` is called last** — only after the schema is provisioned

**On migration failure**: the gate is **not** marked ready (fail-closed), in either mode. In blocking mode `StartAsync` throws, host startup aborts, and workers never enter their main loops. In the non-blocking default the host stays alive (liveness green) but never becomes ready — the pod stays out of traffic rotation and the rollout fails cleanly instead of the pod being killed mid-migration; the failure also drives the managed run-control lifecycle into its fault path (when registered) so health reporting surfaces the failure. Either way, nothing runs against a broken schema.

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

Every database-touching worker gates on schema readiness:

- **Work coordination**: `ClaimWorker`, `HeartbeatWorker`, `MaintenanceWorker`, `LeaseRenewalWorker`
- **Inbox/outbox drain and flush**: `InboxDrainWorker`, `InboxDispatchWorker`, `InboxHandlerWorker`, `OutboxDrainWorker`, `OutboxPublishWorker`, `OutboxCompletionFlushWorker`, `PerspectiveCompletionFlushWorker`, `FailureFlushWorker`, `DeadLetterRecoveryWorker`
- **Perspectives and repair**: `PerspectiveWorker` (its startup scan — registry init, orphan reconcile, rewind repair — waits directly, not just implicitly through the gated `ClaimWorker`; see [Perspective Worker](perspective-worker.md)), `PerspectiveMigrationWorker`, `OrphanInboxJanitor`
- **Transport consumers**: `ServiceBusConsumerWorker` and `TransportConsumerWorker` — subscribing lets the broker *deliver*, and delivery lands in inbox tables the migration creates, so nothing subscribes before the gate opens — plus `TransportDeadLetterDrainWorker` and `BackupTickCoordinator`
- **Postgres notification stack**: `PgDurableSignalTailWorker` (its first act INSERTs this pod's cursor into `wh_signal_cursors`), `PgInstanceLifecycleMonitor` (death detection reads `wh_service_instances` — a death announced against a half-migrated fleet table would trigger takeover from garbage data), `PgDurableSignalRetentionWorker` (gated *before* its interval delay — the delay is a courtesy, not a barrier), and `PgCommitOrderStamperWorker` (its leader loop calls `stamp_pending_commit_sequences`, a function the migration defines)
- **Startup reconciliation**: `TypeDefinitionReconcilerHostedService` and the Dapper driver's message-type registry reconciliation — the latter no longer populates inline in `StartAsync`, which both raced a non-blocking initializer and stalled every later hosted service behind database work

Two notification services are **deliberately not gated**: `PgSharedNotifyConnection` and `PgWorkNotificationListener` use only `LISTEN`/`NOTIFY` and the session advisory alive-lock — no schema required — and the shared connection is the liveness substrate (`wh_live_instances` joins `pg_stat_activity` on its `application_name`), which startup stages that run *before* migrations need. Purely in-memory workers (e.g. `RecentlyProcessedEventCacheSweepWorker`) don't gate either — there is nothing database-shaped to wait for.

**Key difference from polling designs**: readiness is checked **once**, not per cycle. After the gate opens, transient database failures during runtime surface as ordinary exceptions with retry/backoff in each worker's loop — they are not conflated with "schema not ready yet."

---

## HTTP Availability Middleware

The ASP.NET hosting package includes **`DatabaseAvailabilityMiddleware`**, which returns `503 Service Unavailable` for gated requests until the gate signals ready — then becomes a pass-through. A configurable set of **exempt path prefixes** (default: `/alive`, `/health`, `/version` via `DatabaseAvailabilityMiddleware.DefaultExemptPaths`) always passes through, so liveness/readiness probes keep working while the schema initializes under non-blocking init:

```csharp{title="DatabaseAvailabilityMiddleware" description="503 until the schema gate is ready (probe paths exempt), pass-through afterwards" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "Middleware", "Availability"] tests=["DatabaseAvailabilityMiddlewareTests.NotReady_Returns503AndRetryAfterAsync", "DatabaseAvailabilityMiddlewareTests.Ready_DelegatesToNextAsync"]}
public class DatabaseAvailabilityMiddleware {
  // Probe endpoints are never gated
  public static readonly IReadOnlyList<string> DefaultExemptPaths = ["/alive", "/health", "/version"];

  private static readonly byte[] _responseBody = Encoding.UTF8.GetBytes(
    """{"error":"Service temporarily unavailable","reason":"schema_initializing"}""");

  public DatabaseAvailabilityMiddleware(
      RequestDelegate next, ISchemaReadyGate schemaReadyGate, IReadOnlyList<string>? exemptPaths = null,
      AvailabilityGateMode mode = AvailabilityGateMode.AllNonExempt) { /* ... */ }

  public async Task InvokeAsync(HttpContext context) {
    if (!_schemaReadyGate.IsReady && !_isExempt(context.Request.Path) && _isGated(context.Request.Method)) {
      context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
      context.Response.Headers.RetryAfter = "30";
      context.Response.ContentType = "application/json";
      await context.Response.Body.WriteAsync(_responseBody, context.RequestAborted);
      return;
    }

    await _next(context);
  }
}
```

Clients receive a JSON body with `"reason": "schema_initializing"` and a `Retry-After: 30` header while migrations run. `AvailabilityGateMode` selects what gets gated: `AllNonExempt` (default) 503s every non-exempt request; `MutationsOnly` 503s only unsafe methods (POST/PUT/PATCH/DELETE) so safe reads (GET/HEAD/OPTIONS) against read-model tables keep working during an event-store migration.

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

## Ready Is More Than the Gate

The schema gate answers one question — is the database migrated. **`IStartupReadySignal`** answers the broader one: is this instance *fully up*. It is a composite, marked by `StartupReadyService` on the `IHostedLifecycleService.StartedAsync` seam — the hook that runs only after every hosted service's `StartAsync` has returned — once two things hold:

1. **The startup pipeline's blocking steps have drained.** The runner announces its resolved plan before the first step executes, and `IStartupPipelineState.IsReady` becomes true when every planned *blocking* step reaches a terminal outcome without failure. Non-blocking steps live in the post-ready band and never gate it. A failed blocking step keeps readiness pending forever — the same fail-closed posture as the gate itself.
2. **Every registered `IStartupReadinessContributor` has answered.** The transport consumer workers contribute their `SubscriptionsReady` signal — a fact that existed before but nothing consumed — so "ready" now includes "actually subscribed", not merely "the workers started".

Programmatic consumers wait on it the same way workers wait on the gate:

```csharp{title="Waiting on the composite" description="IStartupReadySignal completes when the instance is fully up" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "Readiness", "Startup"]}
public sealed class AfterStartupWork(IStartupReadySignal ready) : BackgroundService {
  protected override async Task ExecuteAsync(CancellationToken stoppingToken) {
    await ready.WaitForReadyAsync(stoppingToken);
    // every blocking startup step drained, every transport subscribed
  }
}
```

For health, `ComponentState.Ready` sits between `Migrating` and `Operational` — distinct so a probe can tell "the schema is ready" from "the pipeline drained" — and is Healthy on readiness under **both** built-in policies, since Ready is precisely the state `HealthPolicy.Strict` holds a pod out of rotation waiting for.

## The Startup Status Surface

The question people ask during a slow boot is *"what is it doing right now?"* — and the pipeline can answer it over the host's own API surface. The surface is **opt-in** (publishing internal state is the host's decision, not a package reference's) and one call mounts it:

```csharp{title="Mounting the status endpoint" description="Opt-in, overridable route, host auth chains" category="Implementation" difficulty="INTERMEDIATE" tags=["Operations", "Workers", "Startup", "Status"]}
app.MapWhizbangStartupStatus();                              // GET /whizbang/startup
app.MapWhizbangStartupStatus("/ops/boot")                    // or wherever the host prefers
   .RequireAuthorization("ops");                             // inherits host auth — the framework adds none
```

The response has **two sections**, because the endpoint gets reached two ways. `instance` is the process that answered — current step, the ordered step list with outcome and duration, pipeline readiness and the composite `ready` — read from memory, exact and current. `fleet` is every live instance from `wh_service_instances`, each row carrying its own heartbeat age, supplied by the storage driver through `IStartupFleetStatusSource`.

The same report is available through the other two API extensions — each opt-in, each inside its package's own security model. FastEndpoints hosts declare an endpoint inheriting `WhizbangStartupStatusEndpointBase` (declaring it *is* the opt-in; `Roles()` / `Permissions()` apply as on any endpoint). HotChocolate hosts call `AddWhizbangStartupStatus()` to contribute the `whizbangStartup` query field (`[Authorize]` applies as elsewhere). All three serve the same `StartupStatusReport`, built by one shared `StartupStatusReporter` — the surfaces cannot drift apart in what they disclose. The minimal-API surface stays primary: a GraphQL schema whose build touches lens types may not be buildable during `Migrate` at all, and a diagnostic reachable only through the subsystem under diagnosis is not a diagnostic.

Three properties are load-bearing:

- **No shared failure domain.** Mapping registers the route with the availability gate's exemption set (`WhizbangAvailabilityExemptions`), so the endpoint answers *during* the migration it reports on — on whatever route the host chose. A startup endpoint that cannot answer until startup finishes is worthless precisely when it is wanted. One caution stays with the host: the authentication in front of it must not resolve roles from the database, or it blocks on the very migration the endpoint exists to report.
- **Terse by default.** The default projection is entirely framework-authored content. `reason` strings originate in exception messages — schema names, constraint names, raw driver text — and are a separate opt-in (`includeReasons: true`), not a verbosity dial.
- **Honest degradation.** Before the pipeline has begun the response says `started: false` — never an empty step list, because an empty run and a run that has not begun are different facts. The fleet section states *why* it is unavailable (no source registered, query failed) — never an empty list, because "no other instances" and "cannot see the other instances" mean opposite things during an incident.

## Troubleshooting

### Problem: Workers Never Start Processing

**Symptoms**: No worker log output beyond startup lines; no SQL activity; HTTP returns 503 with `"reason": "schema_initializing"`.

**Causes**:
1. Migrations failed or hit `MigrationTimeout` — the gate was never marked ready (host startup aborts in blocking mode; the host stays alive-but-never-ready in the non-blocking default)
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

*Version 1.0.0 - Foundation Release | Last Updated: 2026-08-05*
