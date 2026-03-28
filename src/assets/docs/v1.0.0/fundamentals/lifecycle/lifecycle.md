---
title: Lifecycle Management
version: 1.0.0
category: Core Concepts
order: 25
description: >-
  System lifecycle management commands - pause/resume processing for coordinated
  maintenance operations
tags: 'lifecycle, system-commands, maintenance, pause, resume'
codeReferences:
  - src/Whizbang.Core/Commands/System/SystemCommands.cs
lastMaintainedCommit: '01f07906'
---

# Lifecycle Management

Whizbang provides system-level lifecycle commands for coordinating maintenance operations across distributed services. These commands enable you to pause and resume message processing gracefully without dropping messages or losing state.

## System Commands Overview

System commands are framework-level commands that all services automatically subscribe to. They are routed via the `whizbang.system.commands` namespace and use the shared topic inbox strategy.

All services using `SharedTopicInboxStrategy` automatically include system commands in their subscription filter (`whizbang.system.commands.#`).

## Pause and Resume Processing {#pause-resume}

The `PauseProcessingCommand` and `ResumeProcessingCommand` enable coordinated pausing of message processing across all services in your distributed system.

### PauseProcessingCommand

Pauses message processing across all services. Useful for coordinated maintenance operations where you need to ensure no messages are being processed.

**Signature**:
```csharp{title="PauseProcessingCommand" description="PauseProcessingCommand" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lifecycle", "PauseProcessingCommand"]}
public record PauseProcessingCommand(
    int? DurationSeconds = null,
    string? Reason = null
) : ICommand;
```

**Parameters**:
- `DurationSeconds` - Optional duration in seconds after which processing resumes automatically. If `null`, processing remains paused until `ResumeProcessingCommand` is sent.
- `Reason` - Optional reason for pausing (for logging/audit purposes)

**Example: Pause for Database Migration**
```csharp{title="PauseProcessingCommand (2)" description="Example: Pause for Database Migration" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lifecycle", "PauseProcessingCommand"]}
// Pause processing for 10 minutes during database migration
await dispatcher.SendAsync(new PauseProcessingCommand(
    DurationSeconds: 600,
    Reason: "Database schema migration in progress"
));

// Perform migration
await MigrateDatabaseSchemaAsync();

// Resume manually (automatic resume will happen after 10 minutes if not called)
await dispatcher.SendAsync(new ResumeProcessingCommand(
    Reason: "Migration completed successfully"
));
```

**Example: Indefinite Pause**
```csharp{title="PauseProcessingCommand (3)" description="Example: Indefinite Pause" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lifecycle", "PauseProcessingCommand"]}
// Pause indefinitely (no automatic resume)
await dispatcher.SendAsync(new PauseProcessingCommand(
    DurationSeconds: null,
    Reason: "Emergency maintenance - waiting for manual resume"
));

// ... perform maintenance ...

// Must manually resume
await dispatcher.SendAsync(new ResumeProcessingCommand(
    Reason: "Emergency maintenance completed"
));
```

### ResumeProcessingCommand

Resumes message processing across all services after a pause.

**Signature**:
```csharp{title="ResumeProcessingCommand" description="ResumeProcessingCommand" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lifecycle", "ResumeProcessingCommand"]}
public record ResumeProcessingCommand(
    string? Reason = null
) : ICommand;
```

**Parameters**:
- `Reason` - Optional reason for resuming (for logging/audit purposes)

**Example: Manual Resume**
```csharp{title="ResumeProcessingCommand (2)" description="Example: Manual Resume" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lifecycle", "ResumeProcessingCommand"]}
// Resume after maintenance window
await dispatcher.SendAsync(new ResumeProcessingCommand(
    Reason: "Scheduled maintenance window completed"
));
```

## Behavior When Paused

When message processing is paused:

### Workers Stop Processing
- **Inbox workers** stop polling for new messages
- **Outbox workers** stop publishing messages to the transport
- **Perspective workers** stop processing events

### Messages Remain Queued
- Messages in the inbox are **not** lost - they remain in the transport queue
- Messages in the outbox are **not** lost - they remain in the database outbox table
- Events in perspectives remain at their current checkpoint

### Existing Work Completes
- In-flight message processing completes gracefully
- Current transactions are allowed to finish
- No abrupt cancellation of ongoing work

### Resume Behavior
When processing resumes:
- Workers restart polling
- Queued messages are processed in order
- Perspectives resume from their last checkpoint
- No message loss or duplication

## Use Cases

### 1. Database Migrations
Pause processing while applying schema changes:
```csharp{title="Database Migrations" description="Pause processing while applying schema changes:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lifecycle", "Database", "Migrations"]}
// Pause for migration
await dispatcher.SendAsync(new PauseProcessingCommand(
    DurationSeconds: 300,  // 5 minutes
    Reason: "Applying EF Core migration"
));

// Apply migration
await dbContext.Database.MigrateAsync();

// Resume
await dispatcher.SendAsync(new ResumeProcessingCommand(
    Reason: "Migration applied successfully"
));
```

### 2. Infrastructure Maintenance
Coordinate maintenance across services:
```csharp{title="Infrastructure Maintenance" description="Coordinate maintenance across services:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lifecycle", "Infrastructure", "Maintenance"]}
// Pause all services
await dispatcher.SendAsync(new PauseProcessingCommand(
    Reason: "Restarting RabbitMQ cluster"
));

// Perform infrastructure maintenance
await RestartRabbitMQClusterAsync();

// Resume all services
await dispatcher.SendAsync(new ResumeProcessingCommand(
    Reason: "RabbitMQ cluster restart complete"
));
```

### 3. Emergency Situations
Quickly pause processing during an incident:
```csharp{title="Emergency Situations" description="Quickly pause processing during an incident:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lifecycle", "Emergency", "Situations"]}
// Pause indefinitely
await dispatcher.SendAsync(new PauseProcessingCommand(
    DurationSeconds: null,
    Reason: "Investigating data corruption issue"
));

// Investigate and fix issue
await InvestigateAndFixIssueAsync();

// Resume when safe
await dispatcher.SendAsync(new ResumeProcessingCommand(
    Reason: "Data corruption issue resolved"
));
```

### 4. Coordinated Deployments
Pause before deploying breaking changes:
```csharp{title="Coordinated Deployments" description="Pause before deploying breaking changes:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lifecycle", "Coordinated", "Deployments"]}
// Pause processing
await dispatcher.SendAsync(new PauseProcessingCommand(
    DurationSeconds: 600,  // 10 minutes
    Reason: "Deploying breaking changes to v2.0"
));

// Deploy all services
await DeployAllServicesAsync();

// Resume
await dispatcher.SendAsync(new ResumeProcessingCommand(
    Reason: "Deployment complete, all services on v2.0"
));
```

## Best Practices

### Always Provide Reasons
Include descriptive reasons for auditing and troubleshooting:
```csharp{title="Always Provide Reasons" description="Include descriptive reasons for auditing and troubleshooting:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lifecycle", "Always", "Provide"]}
// ✅ Good - clear reason
await dispatcher.SendAsync(new PauseProcessingCommand(
    Reason: "Weekly maintenance window: 2024-03-15 02:00-04:00 UTC"
));

// ❌ Bad - no context
await dispatcher.SendAsync(new PauseProcessingCommand());
```

### Use Timeout for Safety
Set `DurationSeconds` to automatically resume in case manual resume fails:
```csharp{title="Use Timeout for Safety" description="Set DurationSeconds to automatically resume in case manual resume fails:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lifecycle", "Timeout", "Safety"]}
// ✅ Good - will auto-resume after 30 minutes
await dispatcher.SendAsync(new PauseProcessingCommand(
    DurationSeconds: 1800,
    Reason: "Database backup in progress"
));

// ⚠️ Risky - no automatic resume (manual resume required)
await dispatcher.SendAsync(new PauseProcessingCommand(
    DurationSeconds: null,
    Reason: "Manual maintenance"
));
```

### Implement Health Checks

> **Note**: `IProcessingStateMonitor` shown below is an aspirational pattern illustrating how you might expose pause state to health checks. This interface is not provided by the Whizbang library -- you would implement it in your application based on your pause/resume handler state.

Monitor paused state in your health check endpoints:
```csharp{title="Implement Health Checks" description="Monitor paused state in your health check endpoints:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lifecycle", "Implement", "Health"]}
public class ProcessingHealthCheck : IHealthCheck {
  private readonly IProcessingStateMonitor _monitor;

  public async Task<HealthCheckResult> CheckHealthAsync(
      HealthCheckContext context,
      CancellationToken ct = default) {

    if (_monitor.IsPaused) {
      return HealthCheckResult.Degraded(
        $"Processing paused: {_monitor.PauseReason}");
    }

    return HealthCheckResult.Healthy("Processing active");
  }
}
```

### Log Pause/Resume Events
Handle pause/resume commands with logging:
```csharp{title="Log Pause/Resume Events" description="Handle pause/resume commands with logging:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lifecycle", "Log", "Pause"]}
[FireAt(LifecycleStage.PostInboxInline)]
public class PauseResumeLogger : IReceptor<PauseProcessingCommand>,
                                  IReceptor<ResumeProcessingCommand> {
  private readonly ILogger<PauseResumeLogger> _logger;

  public ValueTask HandleAsync(PauseProcessingCommand cmd, CancellationToken ct) {
    _logger.LogWarning(
      "Processing PAUSED: {Reason}. Duration: {Duration} seconds",
      cmd.Reason ?? "No reason provided",
      cmd.DurationSeconds?.ToString() ?? "indefinite");
    return ValueTask.CompletedTask;
  }

  public ValueTask HandleAsync(ResumeProcessingCommand cmd, CancellationToken ct) {
    _logger.LogInformation(
      "Processing RESUMED: {Reason}",
      cmd.Reason ?? "No reason provided");
    return ValueTask.CompletedTask;
  }
}
```

### Test Pause/Resume Behavior
Verify your services handle pause correctly:
```csharp{title="Test Pause/Resume Behavior" description="Verify your services handle pause correctly:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lifecycle", "Test", "Pause"]}
[Test]
public async Task Service_WhenPaused_StopsProcessingMessagesAsync() {
  // Arrange - use lifecycle hooks to synchronize deterministically
  var pauseConfirmed = new TaskCompletionSource(
    TaskCreationOptions.RunContinuationsAsynchronously);
  var orderProcessed = new TaskCompletionSource(
    TaskCreationOptions.RunContinuationsAsynchronously);

  _lifecycleHooks.OnPaused += () => pauseConfirmed.TrySetResult();
  _lifecycleHooks.OnMessageProcessed += msg => {
    if (msg is CreateOrderCommand) orderProcessed.TrySetResult();
  };

  // Pause and wait for confirmation via hook
  await _dispatcher.SendAsync(new PauseProcessingCommand(
    Reason: "Test pause"));
  await pauseConfirmed.Task;

  // Act - send message while paused
  await _dispatcher.SendAsync(new CreateOrderCommand { /* ... */ });

  // Assert - message should be queued, not processed
  var order = await _orderLens.GetByIdAsync(orderId);
  await Assert.That(order).IsNull();  // Not processed yet

  // Resume and wait for processing via hook
  await _dispatcher.SendAsync(new ResumeProcessingCommand(
    Reason: "Test resume"));
  await orderProcessed.Task;

  order = await _orderLens.GetByIdAsync(orderId);
  await Assert.That(order).IsNotNull();  // Now processed
}
```

## Implementation Notes

### Service-Specific Handlers

> **Note**: `IWorkerCoordinator` shown below is an aspirational pattern illustrating how you might coordinate worker lifecycle in response to pause/resume commands. This interface is not provided by the Whizbang library -- you would implement it in your application to manage your specific worker infrastructure.

Each service should implement handlers for pause/resume commands:
```csharp{title="Service-Specific Handlers" description="Each service should implement handlers for pause/resume commands:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lifecycle", "Service-Specific", "Handlers"]}
public class PauseResumeHandler :
  IReceptor<PauseProcessingCommand>,
  IReceptor<ResumeProcessingCommand> {

  private readonly IWorkerCoordinator _workers;
  private readonly ILogger<PauseResumeHandler> _logger;

  public async ValueTask HandleAsync(
      PauseProcessingCommand cmd,
      CancellationToken ct) {

    _logger.LogWarning("Pausing workers: {Reason}", cmd.Reason);

    // Pause all workers
    await _workers.PauseAllAsync(ct);

    // Schedule automatic resume if duration specified
    if (cmd.DurationSeconds.HasValue) {
      _ = Task.Delay(
        TimeSpan.FromSeconds(cmd.DurationSeconds.Value),
        ct).ContinueWith(async _ => {
          _logger.LogInformation("Auto-resuming after {Seconds}s",
            cmd.DurationSeconds.Value);
          await _workers.ResumeAllAsync(CancellationToken.None);
        }, TaskScheduler.Default);
    }
  }

  public async ValueTask HandleAsync(
      ResumeProcessingCommand cmd,
      CancellationToken ct) {

    _logger.LogInformation("Resuming workers: {Reason}", cmd.Reason);
    await _workers.ResumeAllAsync(ct);
  }
}
```

### Graceful Shutdown
Combine with graceful shutdown for maintenance:
```csharp{title="Graceful Shutdown" description="Combine with graceful shutdown for maintenance:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Lifecycle", "Graceful", "Shutdown"]}
// In Program.cs
var lifetime = app.Services.GetRequiredService<IHostApplicationLifetime>();

lifetime.ApplicationStopping.Register(async () => {
  var dispatcher = app.Services.GetRequiredService<IDispatcher>();

  // Pause processing before shutdown
  await dispatcher.SendAsync(new PauseProcessingCommand(
    Reason: "Service shutting down for deployment"));

  // Intentional delay: gives the transport time to propagate the
  // pause command to all consumers before the host shuts down.
  // In production, tune this value based on your transport latency.
  await Task.Delay(2000);
});
```

## Related System Commands

Whizbang provides other system commands for distributed coordination:

### RebuildPerspectiveCommand
Rebuild one or more perspectives across all services:
```csharp{title="RebuildPerspectiveCommand" description="Rebuild one or more perspectives across all services:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lifecycle", "RebuildPerspectiveCommand"]}
await dispatcher.SendAsync(new RebuildPerspectiveCommand(
  PerspectiveNames: ["OrderSummary"],
  Mode: RebuildMode.BlueGreen,
  FromEventId: 12345L
));
```

See [Perspectives](../perspectives/perspectives.md#rebuild) for details.

### CancelPerspectiveRebuildCommand
Cancel an in-progress perspective rebuild:
```csharp{title="CancelPerspectiveRebuildCommand" description="Cancel an in-progress perspective rebuild:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lifecycle", "CancelPerspectiveRebuildCommand"]}
await dispatcher.SendAsync(new CancelPerspectiveRebuildCommand("OrderSummary"));
```

See [Perspectives](../perspectives/perspectives.md#rebuild) for details.

### ClearCacheCommand
Clear cached data across all services:
```csharp{title="ClearCacheCommand" description="Clear cached data across all services:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lifecycle", "ClearCacheCommand"]}
await dispatcher.SendAsync(new ClearCacheCommand(
  CacheKey: "product:*",
  CacheRegion: "products"
));
```

See [Components: Caching](../../data/caching.md#clear-cache) for details.

### DiagnosticsCommand
Collect diagnostics from all services:
```csharp{title="DiagnosticsCommand" description="Collect diagnostics from all services:" category="Architecture" difficulty="BEGINNER" tags=["Fundamentals", "Lifecycle", "DiagnosticsCommand"]}
await dispatcher.SendAsync(new DiagnosticsCommand(
  DiagnosticType.Full,
  CorrelationId: Guid.NewGuid()
));
```

#### DiagnosticType Values

| Value | Description |
|-------|-------------|
| `HealthCheck` | Basic health check - is the service responsive? |
| `ResourceMetrics` | Memory usage, thread count, and resource metrics. |
| `PipelineStatus` | Current state of message processing pipelines. |
| `PerspectiveStatus` | Perspective and projection state information. |
| `Full` | Full diagnostic dump including all above categories. |

See [Observability: Diagnostics](../../operations/observability/diagnostics.md#system-diagnostics) for details.

## See Also

- [System Commands](../dispatcher/routing.md#system-commands) - System command routing
- Workers - Worker lifecycle management
- [Perspectives](../perspectives/perspectives.md) - Perspective processing
- Inbox/Outbox - Message queuing behavior

---

*Version 1.0.0 - Foundation Release*
