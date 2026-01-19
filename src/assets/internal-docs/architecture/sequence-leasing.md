# Sequence Leasing Architecture

## Overview

Sequence leasing is Whizbang's innovative solution to maintaining strict event ordering while allowing expensive projection operations to run without blocking sequence generation. This approach enables high-throughput event processing while preserving deterministic replay capabilities.

## The Problem

Traditional event sourcing systems face a fundamental trade-off:

### Option 1: Serial Processing
```csharp
// Simple but slow - everything waits for the slowest operation
foreach (var evt in events) {
    var sequence = GetNextSequence();
    await ProcessProjection(evt, sequence); // Blocks everything
}
```

### Option 2: Parallel Processing with Gaps
```csharp
// Fast but creates sequence gaps that break replay
await Task.WhenAll(events.Select(async evt => {
    var sequence = GetNextSequence(); // May create gaps
    await ProcessProjection(evt, sequence);
}));
```

### The Whizbang Solution: Sequence Leasing
```csharp
// Best of both worlds - parallel execution with guaranteed ordering
await Task.WhenAll(events.Select(async evt => {
    var lease = await LeaseSequence();           // Reserve sequence upfront
    var result = await ProcessProjection(evt);   // Run in parallel
    await CommitWithLease(result, lease);        // Commit in order
}));
```

## Architecture Components

### 1. Sequence Generator
```csharp
public interface ISequenceGenerator {
    Task<long> GetNextAvailableSequence();
    Task<SequenceLease> LeaseSequence(TimeSpan duration);
    Task ReclaimSequence(long sequence);
}

public class SequenceGenerator : ISequenceGenerator {
    private long _currentSequence = 0;
    private readonly ConcurrentDictionary<long, SequenceLease> _activeLeases = new();
    
    public async Task<SequenceLease> LeaseSequence(TimeSpan duration) {
        var sequence = Interlocked.Increment(ref _currentSequence);
        var lease = new SequenceLease {
            SequenceNumber = sequence,
            LeasedAt = DateTime.UtcNow,
            ExpiresAt = DateTime.UtcNow.Add(duration),
            OperationId = Guid.NewGuid(),
            IsCommitted = false
        };
        
        _activeLeases[sequence] = lease;
        await _leaseStore.Store(lease);
        
        return lease;
    }
}
```

### 2. Sequence Lease
```csharp
public class SequenceLease {
    public long SequenceNumber { get; init; }
    public Guid OperationId { get; init; }
    public DateTime LeasedAt { get; init; }
    public DateTime ExpiresAt { get; init; }
    public bool IsCommitted { get; private set; }
    public bool IsExpired => DateTime.UtcNow > ExpiresAt;
    
    public async Task Commit() {
        if (IsExpired) {
            throw new LeaseExpiredException($"Lease {SequenceNumber} expired");
        }
        
        IsCommitted = true;
        await _leaseStore.MarkCommitted(SequenceNumber);
    }
    
    public async Task Release() {
        await _leaseStore.Release(SequenceNumber);
    }
}
```

### 3. Sequence Barrier
```csharp
public class SequenceBarrier {
    private readonly ConcurrentDictionary<long, TaskCompletionSource> _waiters = new();
    
    public async Task WaitForSequence(long sequence) {
        // Check if all lower sequences are committed
        var blockingLeases = await _leaseStore
            .GetActiveLeases()
            .Where(l => l.SequenceNumber < sequence && !l.IsCommitted)
            .ToArrayAsync();
            
        if (!blockingLeases.Any()) {
            return; // No blocking leases
        }
        
        // Wait for blocking leases to complete
        var tcs = new TaskCompletionSource();
        _waiters[sequence] = tcs;
        
        await tcs.Task;
    }
    
    public async Task ReleaseWaiters(long completedSequence) {
        var toRelease = _waiters
            .Where(kvp => kvp.Key > completedSequence)
            .ToArray();
            
        foreach (var (sequence, tcs) in toRelease) {
            // Check if this waiter can now proceed
            if (await CanProceed(sequence)) {
                _waiters.TryRemove(sequence, out _);
                tcs.SetResult();
            }
        }
    }
}
```

## Processing Pipeline

### 1. Lease Acquisition
```csharp
public async Task<ProjectionResult> ProcessProjectionWithLease(
    IEvent evt, 
    ProjectionResult projectionResult) {
    
    // Estimate processing time based on projection type and data size
    var estimatedDuration = EstimateProcessingTime(projectionResult);
    
    // Lease sequence upfront
    var lease = await _sequenceGenerator.LeaseSequence(estimatedDuration);
    
    try {
        // Process projection (potentially expensive operation)
        var explodedOperation = await ExplodeWhereClause(projectionResult, evt);
        
        // Wait for sequence order (other operations may be blocking)
        await _sequenceBarrier.WaitForSequence(lease.SequenceNumber);
        
        // Commit with leased sequence
        var finalOperation = explodedOperation.WithSequence(lease.SequenceNumber);
        await _operationStore.Store(finalOperation);
        await lease.Commit();
        
        // Release any waiting operations
        await _sequenceBarrier.ReleaseWaiters(lease.SequenceNumber);
        
        return finalOperation;
        
    } catch (Exception ex) {
        await lease.Release();
        throw;
    }
}
```

### 2. Where Clause Explosion (During Lease)
```csharp
private async Task<ExplodedProjectionOperation> ExplodeWhereClause(
    ProjectionResult projectionResult, 
    IEvent sourceEvent) {
    
    switch (projectionResult) {
        case UpdateProjectionResult update:
            // This is the expensive operation that runs during the lease
            var affectedIds = await _queryEngine
                .Query(update.EntityType)
                .Where(update.WhereClause)
                .Select(e => e.Id)
                .ToArrayAsync();
            
            return new ExplodedProjectionOperation {
                OperationType = OperationType.Update,
                EntityType = update.EntityType,
                AffectedEntityIds = affectedIds,
                UpdateAction = SerializeUpdateAction(update.UpdateAction),
                SourceEventId = sourceEvent.Id,
                // Sequence will be assigned when lease is committed
            };
            
        case UpsertProjectionResult upsert:
            return new ExplodedProjectionOperation {
                OperationType = OperationType.Upsert,
                EntityType = upsert.EntityType,
                EntityData = SerializeEntity(upsert.Entity),
                SourceEventId = sourceEvent.Id,
            };
    }
}
```

### 3. Adaptive Lease Duration
```csharp
public class AdaptiveLeaseManager {
    private readonly ConcurrentDictionary<string, PerformanceStats> _projectionStats = new();
    
    public TimeSpan EstimateProcessingTime(ProjectionResult projectionResult) {
        var projectionType = projectionResult.GetType().Name;
        var stats = _projectionStats.GetOrAdd(projectionType, _ => new PerformanceStats());
        
        // Base estimate on historical performance
        var baseEstimate = stats.AverageDuration;
        
        // Adjust for data size
        var sizeMultiplier = EstimateSizeMultiplier(projectionResult);
        var adjustedEstimate = TimeSpan.FromTicks((long)(baseEstimate.Ticks * sizeMultiplier));
        
        // Add safety buffer (2x) but cap at 10 minutes
        var withBuffer = TimeSpan.FromTicks(adjustedEstimate.Ticks * 2);
        return withBuffer > TimeSpan.FromMinutes(10) 
            ? TimeSpan.FromMinutes(10) 
            : withBuffer;
    }
    
    public void RecordPerformance(string projectionType, TimeSpan actualDuration) {
        var stats = _projectionStats.GetOrAdd(projectionType, _ => new PerformanceStats());
        stats.RecordDuration(actualDuration);
    }
}
```

## Storage Schema

### Lease Storage
```sql
CREATE TABLE SequenceLeases (
    SequenceNumber BIGINT PRIMARY KEY,
    OperationId UNIQUEIDENTIFIER NOT NULL,
    ProjectionType NVARCHAR(255) NOT NULL,
    LeasedAt DATETIME2 NOT NULL,
    ExpiresAt DATETIME2 NOT NULL,
    IsCommitted BIT NOT NULL DEFAULT 0,
    CommittedAt DATETIME2 NULL,
    
    INDEX IX_ExpiresAt (ExpiresAt) WHERE IsCommitted = 0,
    INDEX IX_SequenceNumber_Committed (SequenceNumber, IsCommitted)
);
```

### Operation Storage
```sql
CREATE TABLE ExplodedProjectionOperations (
    Sequence BIGINT PRIMARY KEY,
    OperationType TINYINT NOT NULL, -- Upsert=1, Update=2, Delete=3
    EntityType NVARCHAR(255) NOT NULL,
    AffectedEntityIds NVARCHAR(MAX) NOT NULL, -- JSON array
    OperationData NVARCHAR(MAX) NOT NULL,     -- Serialized operation
    SourceEventId UNIQUEIDENTIFIER NOT NULL,
    ProcessedAt DATETIME2 NOT NULL,
    
    INDEX IX_EntityType_Sequence (EntityType, Sequence),
    INDEX IX_SourceEventId (SourceEventId)
);
```

## Performance Characteristics

### Throughput
- **Lease Acquisition**: O(1) - simple counter increment
- **Where Clause Explosion**: O(n) where n = matching entities
- **Sequence Waiting**: O(1) with efficient waiter notification
- **Commit**: O(1) - simple flag update

### Memory Usage
- **Active Leases**: O(concurrent operations) - typically <1000
- **Waiting Operations**: O(blocked operations) - typically <100
- **Operation Cache**: Configurable LRU cache for replay

### Scalability
- **Horizontal**: Each node can lease sequences independently
- **Vertical**: Lock-free sequence generation scales with cores
- **Storage**: Operations can be partitioned by entity type or time

## Monitoring and Metrics

### Key Metrics
```csharp
public class SequenceLeaseMetrics {
    public long ActiveLeases { get; set; }
    public long ExpiredLeases { get; set; }
    public TimeSpan AverageLeaseUtilization { get; set; }
    public long WaitingOperations { get; set; }
    public TimeSpan AverageWaitTime { get; set; }
    
    // Performance indicators
    public double LeaseEfficiencyRatio => 
        (double)CommittedLeases / (CommittedLeases + ExpiredLeases);
        
    public bool IsPerformingWell => 
        LeaseEfficiencyRatio > 0.95 && 
        AverageWaitTime < TimeSpan.FromSeconds(1);
}
```

### Alerting Thresholds
- **Expired Lease Rate** > 5%: Lease durations too short
- **Average Wait Time** > 5 seconds: System overloaded
- **Active Leases** > 1000: Potential memory pressure
- **Sequence Gaps** > 100: Consider gap cleanup

## Benefits

### For Developers
- **Transparent**: Works behind the scenes, no API changes
- **Performant**: Parallel execution of expensive operations
- **Reliable**: Strong ordering guarantees maintained

### For System Performance
- **Throughput**: No blocking on slow operations
- **Latency**: Fast operations don't wait for slow ones
- **Scalability**: Horizontal scaling without coordination overhead

### For Operations
- **Deterministic**: Perfect replay capability
- **Monitorable**: Rich metrics and alerting
- **Recoverable**: Graceful handling of failures and timeouts

## Trade-offs

### Complexity
- **Implementation**: More complex than simple serial processing
- **Debugging**: Additional state to track (leases, waits)
- **Storage**: Additional tables for lease management

### Resource Usage
- **Memory**: Tracking active leases and waiters
- **Storage**: Lease metadata overhead
- **Processing**: Lease management overhead

### Edge Cases
- **Lease Expiration**: Requires careful handling
- **Clock Drift**: Lease timing across distributed nodes
- **Thundering Herd**: Many operations waiting on single lease

Despite these trade-offs, sequence leasing enables Whizbang to achieve both high performance and strong consistency guarantees - a significant advantage over traditional event sourcing frameworks.