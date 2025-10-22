---
title: Projection Management
category: Architecture & Design
order: 7
tags: projections, backfilling, checkpoints, system-events, rebuilding
---

# Projection Management

Whizbang provides comprehensive projection management including checkpoints, backfilling strategies, system events for on-demand rebuilds, and flexible storage options.

## Checkpoint Storage

Projections track their progress through **checkpoint storage**, supporting multiple strategies:

### A. Same Database (Default)

**Transactional consistency** - checkpoints and projections updated together:

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Projections, Checkpoints, Configuration]
description: Configuration for transactional checkpoint storage with projections
---
services.AddProjection<OrderSummaryProjection>(options => {
    options.CheckpointStorage = CheckpointStorage.SameDatabase;
});

// Implementation: Single transaction
await using var transaction = await database.BeginTransactionAsync();
await projectionStore.UpdateProjection(orderSummary, transaction);
await checkpointStore.SaveCheckpoint(position, transaction);
await transaction.CommitAsync();
```

**Benefits**:
- ✅ Exactly-once processing guarantee
- ✅ Simple consistency model
- ✅ No external dependencies

**Drawbacks**:
- ❌ Tight coupling to projection database
- ❌ Limited to single database systems

### B. Separate Metadata Store

**Flexible checkpoint storage** separate from projection data:

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Projections, Checkpoints, Redis, Eventually-Consistent]
description: Configuration for separate checkpoint storage using Redis or other stores
---
services.AddProjection<OrderSummaryProjection>(options => {
    options.CheckpointStorage = CheckpointStorage.Separate;
    options.CheckpointStore = CheckpointStore.Redis; // or CosmosDB, DynamoDB
});

// Implementation: Two-phase with compensation
try {
    await projectionStore.UpdateProjection(orderSummary);
    await checkpointStore.SaveCheckpoint(position);
} catch {
    // Compensation: projection will be updated again on replay
    // Idempotent handlers ensure correctness
}
```

**Benefits**:
- ✅ Optimized checkpoint storage (Redis, DynamoDB)
- ✅ Cross-database projections supported
- ✅ Better performance for high-throughput scenarios

**Drawbacks**:
- ❌ Eventually consistent
- ❌ Requires idempotent projection handlers

### Checkpoint Configuration

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Projections, Configuration, Global-Settings]
description: Global checkpoint configuration and storage options
---
services.AddWhizbang(options => {
    options.Projections(projections => {
        // Global checkpoint settings
        projections.DefaultCheckpointStorage = CheckpointStorage.SameDatabase;
        projections.CheckpointFrequency = CheckpointFrequency.EveryEvent; // or EveryNEvents(10)
        
        // Checkpoint stores
        projections.UseRedisCheckpoints("localhost:6379");
        projections.UseCosmosCheckpoints("connection-string");
        projections.UseSqlCheckpoints("connection-string");
    });
});
```

## Snapshot Management

### A. Automatic Snapshots (Default)

**Configurable automatic snapshotting** for projections:

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Projections, Snapshots, Automatic-Management]
description: Automatic snapshot configuration with frequency and retention policies
---
services.AddProjection<CustomerSummaryProjection>(options => {
    options.Snapshots(snapshots => {
        snapshots.Strategy = SnapshotStrategy.Automatic;
        snapshots.Frequency = SnapshotFrequency.EveryNEvents(1000);
        snapshots.RetentionPolicy = SnapshotRetention.KeepLast(5);
    });
});
```

### B. Manual Snapshots

**Developer-controlled snapshotting**:

```csharp
---
category: Design
difficulty: ADVANCED
tags: [Design, Projections, Snapshots, Manual-Control]
description: Manual snapshot control with custom triggers and restoration logic
---
public class CustomerSummaryProjection : IProjectionHandler<CustomerRegistered>,
                                        IProjectionHandler<CustomerUpdated>,
                                        ISnapshotProvider<CustomerSummarySnapshot> {
    
    public CustomerSummary State { get; private set; }
    
    public async Task Handle(CustomerRegistered @event, ProjectionContext context) {
        State = new CustomerSummary {
            CustomerId = @event.CustomerId,
            Name = @event.Name,
            Email = @event.Email,
            RegisteredAt = @event.RegisteredAt
        };
        
        await context.Store(@event.CustomerId.ToString(), State);
    }
    
    // Manual snapshot creation
    [Snapshot(TriggerOn = typeof(CustomerMilestoneReached))]
    public CustomerSummarySnapshot CreateSnapshot() {
        return new CustomerSummarySnapshot {
            CustomerId = State.CustomerId,
            Name = State.Name,
            TotalOrders = State.TotalOrders,
            LifetimeValue = State.LifetimeValue,
            SnapshotVersion = State.Version
        };
    }
    
    public void RestoreFromSnapshot(CustomerSummarySnapshot snapshot) {
        State = new CustomerSummary {
            CustomerId = snapshot.CustomerId,
            Name = snapshot.Name,
            TotalOrders = snapshot.TotalOrders,
            LifetimeValue = snapshot.LifetimeValue,
            Version = snapshot.SnapshotVersion
        };
    }
}
```

### C. No Snapshots

**Opt out of snapshotting** for simple projections:

```csharp
---
category: Design
difficulty: BEGINNER
tags: [Design, Projections, Snapshots, Simple-Projections]
description: Disabling snapshots for simple projections that don't need them
---
services.AddProjection<SimpleEventLogProjection>(options => {
    options.Snapshots(snapshots => {
        snapshots.Strategy = SnapshotStrategy.None;
    });
});
```

## Backfilling Strategies

### A. Declarative Backfilling

**Simple configuration-based backfilling**:

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Projections, Backfilling, Declarative-Configuration]
description: Declarative backfilling configuration with date ranges and batch settings
---
services.AddProjection<OrderHistoryProjection>(options => {
    options.Backfill(backfill => {
        backfill.StartFrom = DateTimeOffset.Parse("2024-01-01");
        backfill.AutoStart = true;
        backfill.BatchSize = 1000;
        backfill.MaxConcurrency = 4;
    });
});

// Or backfill everything
services.AddProjection<NewAnalyticsProjection>(options => {
    options.BackfillFromBeginning();
});
```

### B. Imperative Backfilling

**Programmatic control over backfilling**:

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Projections, Backfilling, REST-API]
description: REST API controller for programmatic projection backfilling
---
public class BackfillController : ControllerBase {
    private readonly IProjectionManager _projectionManager;
    
    [HttpPost("projections/{projectionName}/backfill")]
    public async Task<IActionResult> BackfillProjection(
        string projectionName,
        BackfillRequest request) {
        
        var options = new BackfillOptions {
            FromDate = request.FromDate,
            ToDate = request.ToDate,
            BatchSize = request.BatchSize ?? 1000,
            IsAtomic = request.IsAtomic ?? false,
            OnProgress = (progress) => {
                // Real-time progress updates via SignalR
                _hubContext.Clients.All.SendAsync("BackfillProgress", progress);
            }
        };
        
        var result = await _projectionManager.BackfillAsync(projectionName, options);
        return Ok(result);
    }
}
```

### System Events for On-Demand Backfilling

**Event-driven backfill requests**:

```csharp
---
category: Design
difficulty: ADVANCED
tags: [Design, Projections, System-Events, Event-Driven-Backfill]
description: System events for on-demand projection backfilling with criteria
---
// System event to trigger backfilling
public record ProjectionBackfillRequested(
    string ProjectionName,
    DateTimeOffset? FromDate,
    DateTimeOffset? ToDate,
    bool IsAtomic,
    BackfillCriteria Criteria,
    string RequestedBy
) : ISystemEvent;

```csharp
---
category: Design
difficulty: ADVANCED
tags: [Design, Projections, System-Events, Event-Handlers]
description: System event handler for processing backfill requests
---
// System event handler
public class ProjectionBackfillHandler : ISystemEventHandler<ProjectionBackfillRequested> {
    public async Task Handle(ProjectionBackfillRequested @event, SystemEventContext context) {
        var options = new BackfillOptions {
            FromDate = @event.FromDate,
            ToDate = @event.ToDate,
            IsAtomic = @event.IsAtomic,
            Criteria = @event.Criteria,
            RequestId = context.CorrelationId
        };
        
        await _projectionManager.BackfillAsync(@event.ProjectionName, options);
        
        // Emit completion event
        await context.PublishSystemEvent(new ProjectionBackfillCompleted(
            @event.ProjectionName,
            options.FromDate,
            options.ToDate,
            context.CorrelationId
        ));
    }
}

// Trigger backfill via system event
await _systemEventPublisher.PublishAsync(new ProjectionBackfillRequested(
    ProjectionName: "order-summary",
    FromDate: DateTimeOffset.Parse("2024-01-01"),
    ToDate: null, // To current
    IsAtomic: true,
    Criteria: BackfillCriteria.FullRebuild,
    RequestedBy: "admin-user"
));
```

### Backfill Criteria Options

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Projections, Backfilling, Criteria-Options]
description: Comprehensive backfill criteria options for different scenarios
---
public enum BackfillCriteria {
    // Date-based backfill
    DateRange,              // Specific date range
    FromDate,               // From date to current
    LastNDays,              // Last N days only
    
    // Event-based backfill  
    EventNumberRange,       // Specific event number range
    FromEventNumber,        // From event number to current
    LastNEvents,            // Last N events only
    
    // Full rebuild options
    FullRebuild,            // Complete rebuild from beginning
    IncrementalUpdate,      // Only missing/updated events
    
    // Custom criteria
    CustomPredicate         // Custom filter expression
}

// Usage examples
services.AddProjection<OrderSummaryProjection>(options => {
    options.Backfill(backfill => {
        backfill.Criteria = BackfillCriteria.LastNDays;
        backfill.CriteriaValue = 30; // Last 30 days
    });
});

// System event with custom criteria
await _systemEvents.PublishAsync(new ProjectionBackfillRequested(
    ProjectionName: "analytics",
    FromDate: null,
    ToDate: null,
    IsAtomic: false,
    Criteria: BackfillCriteria.CustomPredicate,
    RequestedBy: "system"
) {
    CustomPredicate = @event => @event.EventType.StartsWith("Order") && 
                               @event.Metadata["source"] == "web-api"
});
```

## Advanced Backfill Features

### Parallel Processing

```csharp
---
category: Design
difficulty: ADVANCED
tags: [Design, Projections, Backfilling, Parallel-Processing]
description: Parallel backfill processing with partitioning and concurrency control
---
services.AddProjection<AnalyticsProjection>(options => {
    options.Backfill(backfill => {
        backfill.Strategy = BackfillStrategy.Parallel;
        backfill.PartitionBy = @event => @event.StreamId.GetHashCode() % 8;
        backfill.MaxConcurrency = 8;
        backfill.BatchSize = 500;
    });
});
```

### Progress Tracking

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Projections, Backfilling, Progress-Tracking]
description: Real-time progress tracking for backfill operations
---
public class BackfillProgressTracker {
    public async Task TrackProgress(string projectionName, CancellationToken cancellationToken) {
        await foreach (var progress in _projectionManager.GetBackfillProgress(projectionName, cancellationToken)) {
            Console.WriteLine($"Backfill progress: {progress.EventsProcessed}/{progress.TotalEvents} " +
                            $"({progress.PercentComplete:F1}%) - ETA: {progress.EstimatedTimeRemaining}");
        }
    }
}
```

### Rollback Support

```csharp
---
category: Design
difficulty: ADVANCED
tags: [Design, Projections, Backfilling, Rollback-Support]
description: Rollback support for failed backfill operations with backup creation
---
// Rollback to previous version if backfill fails
services.AddProjection<OrderSummaryProjection>(options => {
    options.Backfill(backfill => {
        backfill.EnableRollback = true;
        backfill.RollbackOnFailure = true;
        backfill.CreateBackupBeforeBackfill = true;
    });
});

// Manual rollback API
await _projectionManager.RollbackProjection("order-summary", toVersion: previousVersion);
```

## System Event Integration

### Built-in System Events

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Projections, System-Events, Lifecycle-Management]
description: Built-in system events for projection lifecycle monitoring
---
// Projection lifecycle events
public record ProjectionStarted(string ProjectionName, DateTimeOffset StartedAt);
public record ProjectionStopped(string ProjectionName, DateTimeOffset StoppedAt);
public record ProjectionFailed(string ProjectionName, Exception Error, DateTimeOffset FailedAt);

// Backfill events
public record ProjectionBackfillStarted(string ProjectionName, BackfillOptions Options);
public record ProjectionBackfillProgress(string ProjectionName, BackfillProgress Progress);
public record ProjectionBackfillCompleted(string ProjectionName, BackfillResult Result);
public record ProjectionBackfillFailed(string ProjectionName, Exception Error);

// Checkpoint events
public record ProjectionCheckpointSaved(string ProjectionName, long Position);
public record ProjectionCheckpointRestored(string ProjectionName, long Position);

// Snapshot events
public record ProjectionSnapshotCreated(string ProjectionName, long EventVersion);
public record ProjectionSnapshotRestored(string ProjectionName, long EventVersion);
```

### Custom System Event Handlers

```csharp
---
category: Design
difficulty: ADVANCED
tags: [Design, Projections, System-Events, Monitoring]
description: Custom system event handlers for projection monitoring and alerting
---
public class ProjectionMonitoringHandler : 
    ISystemEventHandler<ProjectionFailed>,
    ISystemEventHandler<ProjectionBackfillCompleted> {
    
    public async Task Handle(ProjectionFailed @event, SystemEventContext context) {
        // Alert on projection failures
        await _alerting.SendAlert($"Projection {@event.ProjectionName} failed: {@event.Error.Message}");
        
        // Automatic retry for transient failures
        if (IsTransientError(@event.Error)) {
            await context.PublishSystemEvent(new ProjectionRestartRequested(
                @event.ProjectionName,
                retryAttempt: context.GetRetryAttempt() + 1
            ));
        }
    }
    
    public async Task Handle(ProjectionBackfillCompleted @event, SystemEventContext context) {
        // Update projection metadata
        await _projectionMetadata.MarkBackfillComplete(@event.ProjectionName, @event.Result);
        
        // Notify stakeholders
        await _notifications.NotifyBackfillComplete(@event.ProjectionName);
    }
}
```

## API Reference

### IProjectionManager Interface

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Projections, Management-API, Interfaces]
description: Comprehensive projection management API interface
---
public interface IProjectionManager {
    // Lifecycle management
    Task StartProjection(string projectionName);
    Task StopProjection(string projectionName);
    Task RestartProjection(string projectionName);
    
    // Backfilling
    Task<BackfillResult> BackfillAsync(string projectionName, BackfillOptions options);
    IAsyncEnumerable<BackfillProgress> GetBackfillProgress(string projectionName, CancellationToken cancellationToken);
    Task CancelBackfill(string projectionName);
    
    // Snapshots
    Task<SnapshotResult> CreateSnapshot(string projectionName);
    Task<SnapshotResult> RestoreFromSnapshot(string projectionName, long snapshotVersion);
    Task<IEnumerable<SnapshotInfo>> GetSnapshots(string projectionName);
    
    // Checkpoints
    Task<long> GetCurrentCheckpoint(string projectionName);
    Task ResetCheckpoint(string projectionName, long position);
    
    // Status and monitoring
    Task<ProjectionStatus> GetStatus(string projectionName);
    Task<IEnumerable<ProjectionInfo>> GetAllProjections();
    Task<ProjectionHealth> GetHealth(string projectionName);
}
```

### Configuration Extensions

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Projections, Extension-Methods, Fluent-API]
description: Extension methods for fluent projection configuration API
---
public static class ProjectionConfigurationExtensions {
    public static IProjectionBuilder<T> BackfillFromBeginning<T>(this IProjectionBuilder<T> builder) 
        where T : class;
    
    public static IProjectionBuilder<T> BackfillFrom<T>(this IProjectionBuilder<T> builder, DateTimeOffset from) 
        where T : class;
    
    public static IProjectionBuilder<T> WithSnapshots<T>(this IProjectionBuilder<T> builder, 
        Action<SnapshotConfiguration> configure) where T : class;
    
    public static IProjectionBuilder<T> WithCheckpoints<T>(this IProjectionBuilder<T> builder, 
        Action<CheckpointConfiguration> configure) where T : class;
    
    public static IProjectionBuilder<T> OnSystemEvent<T, TEvent>(this IProjectionBuilder<T> builder, 
        Func<TEvent, Task> handler) where T : class where TEvent : ISystemEvent;
}
```

## Best Practices

### Projection Design

1. **Keep projections focused** - One projection per query need
2. **Make handlers idempotent** - Support replay scenarios
3. **Handle missing data gracefully** - Events may be out of order
4. **Version projection schemas** - Enable evolution over time

### Backfill Planning

1. **Test backfills in staging** - Verify performance and correctness
2. **Use atomic rebuilds** for critical projections
3. **Monitor resource usage** during large backfills
4. **Plan for rollback scenarios** if backfill fails

### Checkpoint Strategy

1. **Use same-database checkpoints** for consistency-critical projections
2. **Use separate checkpoints** for high-throughput scenarios
3. **Checkpoint frequently** to minimize replay overhead
4. **Monitor checkpoint lag** for early failure detection

---

## Related Documentation

- [**Event Store & Projections**](./event-store-projections.md) - Core storage architecture
- [**Multi-Tenancy**](./multi-tenancy.md) - Tenant-aware projection management
- [**Performance Optimization**](./performance-optimization.md) - Scaling projection processing