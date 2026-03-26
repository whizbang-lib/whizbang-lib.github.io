---
title: Diagnostics
version: 1.0.0
category: Observability
order: 3
description: >-
  System diagnostics and health monitoring for Whizbang applications using
  the DiagnosticsCommand for collecting health, resource, and pipeline status
tags: 'diagnostics, health-check, monitoring, system-commands, observability'
codeReferences:
  - src/Whizbang.Core/Commands/System/SystemCommands.cs
---

# Diagnostics

Whizbang provides system-level diagnostics through the `DiagnosticsCommand`, enabling you to collect health checks, resource metrics, pipeline status, and perspective state from all services in your distributed system.

## Quick Start

```csharp{title="Send Diagnostics Command" description="Collect diagnostics from all services" category="Usage" difficulty="BEGINNER" tags=["Diagnostics", "System-Commands"]}
// Collect health checks from all services
await dispatcher.SendAsync(new DiagnosticsCommand(DiagnosticType.HealthCheck));

// Collect full diagnostics with correlation ID
var correlationId = Guid.NewGuid();
await dispatcher.SendAsync(new DiagnosticsCommand(
    DiagnosticType.Full,
    correlationId
));
```

## System Diagnostics {#system-diagnostics}

### DiagnosticsCommand

The `DiagnosticsCommand` is a system command that broadcasts diagnostic requests to all services. Each service that implements a handler for `DiagnosticsCommand` can respond with its current state.

```csharp{title="DiagnosticsCommand Definition" description="System command for collecting diagnostics" category="Reference" difficulty="BEGINNER" tags=["Diagnostics", "System-Commands", "API"]}
public record DiagnosticsCommand(
    DiagnosticType Type,
    Guid? CorrelationId = null
) : ICommand;
```

**Properties**:

| Property | Type | Description |
|----------|------|-------------|
| `Type` | `DiagnosticType` | Type of diagnostics to collect |
| `CorrelationId` | `Guid?` | Optional correlation ID for tracking responses |

### DiagnosticType Enum

The `DiagnosticType` enum specifies what information services should report:

| Type | Description | Typical Response Time |
|------|-------------|----------------------|
| `HealthCheck` | Basic health check - is the service responsive? | < 100ms |
| `ResourceMetrics` | Memory usage, thread count, resource metrics | < 200ms |
| `PipelineStatus` | Current state of message processing pipelines | < 500ms |
| `PerspectiveStatus` | Perspective and projection state information | < 1s |
| `Full` | Full diagnostic dump including all categories | 1-3s |

```csharp{title="DiagnosticType Values" description="Available diagnostic types" category="Reference" difficulty="BEGINNER" tags=["Diagnostics", "Types"]}
public enum DiagnosticType {
  HealthCheck,
  ResourceMetrics,
  PipelineStatus,
  PerspectiveStatus,
  Full
}
```

## Implementing Diagnostic Handlers

Services implement handlers for `DiagnosticsCommand` to report their status. The handler should examine the `DiagnosticType` and respond appropriately.

### Health Check Handler

```csharp{title="Health Check Handler" description="Implement health check diagnostics" category="Usage" difficulty="BEGINNER" tags=["Diagnostics", "Health-Check", "Handlers"]}
public class DiagnosticsReceptor : IReceptor<DiagnosticsCommand, DiagnosticResponse> {
  private readonly IServiceHealthProvider _healthProvider;
  private readonly ILogger<DiagnosticsReceptor> _logger;

  public DiagnosticsReceptor(
      IServiceHealthProvider healthProvider,
      ILogger<DiagnosticsReceptor> logger) {
    _healthProvider = healthProvider;
    _logger = logger;
  }

  public async ValueTask<DiagnosticResponse> HandleAsync(
      DiagnosticsCommand command,
      CancellationToken ct) {

    _logger.LogInformation(
        "Received diagnostics request: {Type}, CorrelationId: {CorrelationId}",
        command.Type,
        command.CorrelationId);

    var response = command.Type switch {
      DiagnosticType.HealthCheck => await _collectHealthCheckAsync(ct),
      DiagnosticType.ResourceMetrics => await _collectResourceMetricsAsync(ct),
      DiagnosticType.PipelineStatus => await _collectPipelineStatusAsync(ct),
      DiagnosticType.PerspectiveStatus => await _collectPerspectiveStatusAsync(ct),
      DiagnosticType.Full => await _collectFullDiagnosticsAsync(ct),
      _ => DiagnosticResponse.Unknown(command.CorrelationId)
    };

    return response;
  }

  private async ValueTask<DiagnosticResponse> _collectHealthCheckAsync(
      CancellationToken ct) {
    var isHealthy = await _healthProvider.IsHealthyAsync(ct);

    return new DiagnosticResponse(
        ServiceName: Environment.MachineName,
        Status: isHealthy ? "Healthy" : "Unhealthy",
        Timestamp: DateTimeOffset.UtcNow,
        Details: new Dictionary<string, object> {
          ["uptime"] = _healthProvider.GetUptime(),
          ["version"] = _healthProvider.GetVersion()
        }
    );
  }

  private async ValueTask<DiagnosticResponse> _collectResourceMetricsAsync(
      CancellationToken ct) {
    var process = Process.GetCurrentProcess();

    return new DiagnosticResponse(
        ServiceName: Environment.MachineName,
        Status: "OK",
        Timestamp: DateTimeOffset.UtcNow,
        Details: new Dictionary<string, object> {
          ["memory_mb"] = process.WorkingSet64 / 1024 / 1024,
          ["thread_count"] = process.Threads.Count,
          ["handle_count"] = process.HandleCount,
          ["cpu_time_ms"] = process.TotalProcessorTime.TotalMilliseconds
        }
    );
  }

  private async ValueTask<DiagnosticResponse> _collectPipelineStatusAsync(
      CancellationToken ct) {
    // Collect information about message processing pipelines
    // This is application-specific
    return DiagnosticResponse.NotImplemented();
  }

  private async ValueTask<DiagnosticResponse> _collectPerspectiveStatusAsync(
      CancellationToken ct) {
    // Collect information about perspective state
    // This is application-specific
    return DiagnosticResponse.NotImplemented();
  }

  private async ValueTask<DiagnosticResponse> _collectFullDiagnosticsAsync(
      CancellationToken ct) {
    var health = await _collectHealthCheckAsync(ct);
    var resources = await _collectResourceMetricsAsync(ct);
    var pipeline = await _collectPipelineStatusAsync(ct);
    var perspectives = await _collectPerspectiveStatusAsync(ct);

    // Merge all diagnostic information
    var allDetails = new Dictionary<string, object>();
    foreach (var detail in health.Details.Concat(resources.Details)
        .Concat(pipeline.Details).Concat(perspectives.Details)) {
      allDetails[detail.Key] = detail.Value;
    }

    return new DiagnosticResponse(
        ServiceName: Environment.MachineName,
        Status: "Full",
        Timestamp: DateTimeOffset.UtcNow,
        Details: allDetails
    );
  }
}
```

### DiagnosticResponse Event

Create a response event to publish diagnostic results:

```csharp{title="DiagnosticResponse Event" description="Event for publishing diagnostic results" category="Usage" difficulty="BEGINNER" tags=["Diagnostics", "Events"]}
public record DiagnosticResponse(
    string ServiceName,
    string Status,
    DateTimeOffset Timestamp,
    IReadOnlyDictionary<string, object> Details,
    Guid? CorrelationId = null
) : IEvent {

  public static DiagnosticResponse Unknown(Guid? correlationId) {
    return new DiagnosticResponse(
        ServiceName: Environment.MachineName,
        Status: "Unknown",
        Timestamp: DateTimeOffset.UtcNow,
        Details: new Dictionary<string, object>(),
        CorrelationId: correlationId
    );
  }

  public static DiagnosticResponse NotImplemented() {
    return new DiagnosticResponse(
        ServiceName: Environment.MachineName,
        Status: "NotImplemented",
        Timestamp: DateTimeOffset.UtcNow,
        Details: new Dictionary<string, object> {
          ["message"] = "This diagnostic type is not implemented by this service"
        }
    );
  }
}
```

## Broadcasting Diagnostics

System commands use the `whizbang.system.commands` routing namespace, which all services automatically subscribe to when using `SharedTopicInboxStrategy`.

```csharp{title="Broadcast Diagnostics Request" description="Send diagnostics command to all services" category="Usage" difficulty="BEGINNER" tags=["Diagnostics", "System-Commands", "Broadcasting"]}
public class DiagnosticsController : ControllerBase {
  private readonly IDispatcher _dispatcher;

  public DiagnosticsController(IDispatcher dispatcher) {
    _dispatcher = dispatcher;
  }

  [HttpPost("diagnostics/health")]
  public async Task<IActionResult> CheckHealthAsync(
      CancellationToken ct) {
    var correlationId = Guid.NewGuid();

    // Send command to all services
    await _dispatcher.SendAsync(
        new DiagnosticsCommand(DiagnosticType.HealthCheck, correlationId),
        ct
    );

    // Responses will be published as DiagnosticResponse events
    // Services can collect these via a perspective or event handler
    return Accepted(new { correlationId });
  }

  [HttpPost("diagnostics/full")]
  public async Task<IActionResult> CollectFullDiagnosticsAsync(
      CancellationToken ct) {
    var correlationId = Guid.NewGuid();

    await _dispatcher.SendAsync(
        new DiagnosticsCommand(DiagnosticType.Full, correlationId),
        ct
    );

    return Accepted(new { correlationId });
  }
}
```

## Collecting Diagnostic Responses

Use a perspective to aggregate diagnostic responses from all services:

```csharp{title="Diagnostic Collector Perspective" description="Aggregate diagnostic responses" category="Usage" difficulty="INTERMEDIATE" tags=["Diagnostics", "Perspectives", "Aggregation"]}
public class DiagnosticCollectorPerspective : IPerspective {
  private readonly Dictionary<string, DiagnosticResponse> _responses = new();

  public void Apply(DiagnosticResponse response) {
    // Store response by service name
    _responses[response.ServiceName] = response;
  }

  public IReadOnlyDictionary<string, DiagnosticResponse> GetAllResponses() {
    return _responses;
  }

  public IEnumerable<DiagnosticResponse> GetResponsesByCorrelation(
      Guid correlationId) {
    return _responses.Values
        .Where(r => r.CorrelationId == correlationId);
  }

  public bool AreAllServicesHealthy() {
    return _responses.Values.All(r => r.Status == "Healthy");
  }
}
```

## Monitoring Dashboard Integration

Integrate diagnostics with monitoring dashboards:

```csharp{title="Dashboard Diagnostics" description="Expose diagnostics via API" category="Usage" difficulty="INTERMEDIATE" tags=["Operations", "Observability", "C#", "Dashboard", "Diagnostics"]}
public class SystemDiagnosticsHub : Hub {
  private readonly IDispatcher _dispatcher;
  private readonly ILens<DiagnosticCollectorPerspective> _diagnosticsLens;

  public SystemDiagnosticsHub(
      IDispatcher dispatcher,
      ILens<DiagnosticCollectorPerspective> diagnosticsLens) {
    _dispatcher = dispatcher;
    _diagnosticsLens = diagnosticsLens;
  }

  public async Task RequestSystemHealthAsync() {
    var correlationId = Guid.NewGuid();

    // Broadcast health check to all services
    await _dispatcher.SendAsync(
        new DiagnosticsCommand(DiagnosticType.HealthCheck, correlationId)
    );

    // Wait briefly for responses to accumulate
    await Task.Delay(TimeSpan.FromSeconds(2));

    // Query perspective for aggregated results
    var perspective = await _diagnosticsLens.QueryAsync();
    var responses = perspective.GetResponsesByCorrelation(correlationId);

    // Push to dashboard
    await Clients.Caller.SendAsync(
        "HealthCheckResults",
        responses
    );
  }

  public async Task RequestFullDiagnosticsAsync() {
    var correlationId = Guid.NewGuid();

    await _dispatcher.SendAsync(
        new DiagnosticsCommand(DiagnosticType.Full, correlationId)
    );

    await Task.Delay(TimeSpan.FromSeconds(5));

    var perspective = await _diagnosticsLens.QueryAsync();
    var responses = perspective.GetResponsesByCorrelation(correlationId);

    await Clients.Caller.SendAsync(
        "FullDiagnosticResults",
        responses
    );
  }
}
```

## Resource Metrics Collection

Advanced resource metrics collection:

```csharp{title="Resource Metrics" description="Collect detailed resource metrics" category="Usage" difficulty="ADVANCED" tags=["Diagnostics", "Metrics", "Resources"]}
public class ResourceMetricsCollector {
  public async ValueTask<Dictionary<string, object>> CollectAsync(
      CancellationToken ct) {
    var process = Process.GetCurrentProcess();
    var metrics = new Dictionary<string, object>();

    // Memory metrics
    metrics["memory_working_set_mb"] = process.WorkingSet64 / 1024 / 1024;
    metrics["memory_private_mb"] = process.PrivateMemorySize64 / 1024 / 1024;
    metrics["memory_virtual_mb"] = process.VirtualMemorySize64 / 1024 / 1024;

    // GC metrics
    var gcMemory = GC.GetTotalMemory(forceFullCollection: false);
    metrics["gc_memory_mb"] = gcMemory / 1024 / 1024;
    metrics["gc_gen0_collections"] = GC.CollectionCount(0);
    metrics["gc_gen1_collections"] = GC.CollectionCount(1);
    metrics["gc_gen2_collections"] = GC.CollectionCount(2);

    // Thread metrics
    metrics["thread_count"] = process.Threads.Count;
    metrics["thread_pool_available"] = ThreadPool.PendingWorkItemCount;

    // CPU metrics
    metrics["cpu_time_ms"] = process.TotalProcessorTime.TotalMilliseconds;
    metrics["cpu_privileged_time_ms"] =
        process.PrivilegedProcessorTime.TotalMilliseconds;
    metrics["cpu_user_time_ms"] =
        process.UserProcessorTime.TotalMilliseconds;

    // Handle metrics
    metrics["handle_count"] = process.HandleCount;

    // Uptime
    var uptime = DateTime.UtcNow - process.StartTime.ToUniversalTime();
    metrics["uptime_seconds"] = (long)uptime.TotalSeconds;

    return metrics;
  }
}
```

## Best Practices

### Diagnostic Handler Design

```csharp{title="Diagnostic Handler Best Practices" description="Best practices for implementing diagnostic handlers" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Diagnostics", "Best-Practices"]}
public class DiagnosticsReceptor : IReceptor<DiagnosticsCommand, DiagnosticResponse> {
  // DO: Implement timeouts for diagnostic collection
  private static readonly TimeSpan HealthCheckTimeout = TimeSpan.FromSeconds(5);
  private static readonly TimeSpan FullDiagnosticsTimeout = TimeSpan.FromSeconds(30);

  public async ValueTask<DiagnosticResponse> HandleAsync(
      DiagnosticsCommand command,
      CancellationToken ct) {

    // DO: Use appropriate timeout based on diagnostic type
    var timeout = command.Type switch {
      DiagnosticType.HealthCheck => HealthCheckTimeout,
      DiagnosticType.Full => FullDiagnosticsTimeout,
      _ => TimeSpan.FromSeconds(10)
    };

    using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
    cts.CancelAfter(timeout);

    try {
      // DO: Wrap diagnostic collection in try-catch
      return await _collectDiagnosticsAsync(command, cts.Token);
    } catch (OperationCanceledException) {
      // DO: Return timeout response instead of throwing
      return DiagnosticResponse.Timeout(command.CorrelationId);
    } catch (Exception ex) {
      // DO: Return error response instead of throwing
      return DiagnosticResponse.Error(command.CorrelationId, ex.Message);
    }
  }

  // DO: Keep health checks lightweight
  private async ValueTask<DiagnosticResponse> _collectHealthCheckAsync(
      CancellationToken ct) {
    // Don't perform expensive operations in health checks
    // Just verify the service can respond
    return DiagnosticResponse.Healthy();
  }

  // DON'T: Perform expensive operations in health checks
  // private async Task _healthCheckDontDoThis() {
  //   await _database.PingAsync();  // Bad - could timeout
  //   await _externalApi.TestAsync();  // Bad - network dependency
  // }
}
```

### Correlation and Aggregation

```csharp{title="Correlation Best Practices" description="Best practices for correlating diagnostic responses" category="Best-Practices" difficulty="INTERMEDIATE" tags=["Diagnostics", "Best-Practices", "Correlation"]}
// DO: Always use correlation IDs for request-response tracking
var correlationId = Guid.NewGuid();
await dispatcher.SendAsync(
    new DiagnosticsCommand(DiagnosticType.HealthCheck, correlationId)
);

// DO: Store correlation ID for later aggregation
_diagnosticRequests[correlationId] = new DiagnosticRequest {
  RequestedAt = DateTimeOffset.UtcNow,
  Type = DiagnosticType.HealthCheck,
  ExpectedResponses = _knownServiceCount
};

// DO: Set reasonable timeouts for response collection
await Task.Delay(TimeSpan.FromSeconds(2));

// DO: Handle partial responses gracefully
var responses = perspective.GetResponsesByCorrelation(correlationId);
if (responses.Count() < _knownServiceCount) {
  _logger.LogWarning(
      "Received {Count} of {Expected} diagnostic responses",
      responses.Count(),
      _knownServiceCount);
}
```

### Performance Considerations

1. **Health Check Performance**: Keep health checks under 100ms - they may be called frequently
2. **Full Diagnostics**: Limit full diagnostics to admin/debug scenarios - can be expensive
3. **Response Aggregation**: Use perspectives to aggregate responses over time
4. **Timeout Handling**: Always implement timeouts to prevent hanging operations
5. **Error Handling**: Return diagnostic errors instead of throwing - helps identify partial failures

## See Also

- [Tracing](./tracing) - Handler-level distributed tracing
- [OpenTelemetry Integration](./opentelemetry-integration) - Metrics and telemetry
- [System Commands](../../fundamentals/dispatcher/routing#system-commands) - System command routing
- [Perspectives](../../fundamentals/perspectives/perspectives) - State aggregation patterns
