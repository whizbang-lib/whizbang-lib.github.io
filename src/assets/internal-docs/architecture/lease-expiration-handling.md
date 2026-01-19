# Lease Expiration Handling

## Overview

Lease expiration is a critical failure scenario in the sequence leasing system. When a lease expires, the system must maintain ordering guarantees while minimizing data loss and performance impact. This document details the comprehensive strategy for handling expired leases.

## Expiration Scenarios

### 1. Normal Expiration (Operation Timeout)
```csharp
// Operation takes longer than estimated
var lease = await _sequenceLeaser.LeaseSequence(TimeSpan.FromMinutes(2));

try {
    var result = await ProcessProjection(evt); // Takes 5 minutes!
    await CommitWithLease(result, lease);      // Fails - lease expired
} catch (LeaseExpiredException ex) {
    // Handle gracefully
}
```

### 2. Crashed Operation
```csharp
// Process crashes during operation
var lease = await _sequenceLeaser.LeaseSequence(TimeSpan.FromMinutes(5));
// ... process crashes here ...
// Lease cleanup service will handle the expired lease
```

### 3. Network Partition
```csharp
// Process is alive but can't communicate with lease manager
var lease = await _sequenceLeaser.LeaseSequence(TimeSpan.FromMinutes(3));
// ... network partition occurs ...
// Operation completes but can't commit
```

## Recovery Strategies

### Strategy 1: Sequence Gap Management (Recommended)
```csharp
public class SequenceGapManager {
    public async Task HandleExpiredLease(SequenceLease expiredLease) {
        var gapRecord = new SequenceGap {
            SequenceNumber = expiredLease.SequenceNumber,
            OperationId = expiredLease.OperationId,
            CreatedAt = DateTime.UtcNow,
            Reason = \"Lease expired\",
            OriginalLeaseExpiry = expiredLease.ExpiresAt,
            ProjectionType = expiredLease.ProjectionType
        };
        
        await _gapStore.CreateGap(gapRecord);
        await _sequenceBarrier.ReleaseWaiters(expiredLease.SequenceNumber);
        
        _metrics.RecordExpiredLease(expiredLease);
        _logger.LogWarning($\"Created sequence gap for expired lease {expiredLease.SequenceNumber}\");
    }
    
    public async Task<bool> IsSequenceGap(long sequence) {
        return await _gapStore.IsGap(sequence);
    }
    
    public async Task FillGapIfPossible(long sequence, ExplodedProjectionOperation operation) {
        var gap = await _gapStore.GetGap(sequence);
        if (gap != null && gap.CanBeFilled(operation)) {
            await _operationStore.Store(operation.WithSequence(sequence));
            await _gapStore.FillGap(sequence);
            
            _logger.LogInfo($\"Filled sequence gap {sequence} with recovered operation\");
        }
    }
}
```

### Strategy 2: Operation Retry with New Sequence
```csharp
public class OperationRetryManager {
    public async Task<bool> TryRetryExpiredOperation(SequenceLease expiredLease) {
        // Check if operation completed but couldn't commit
        var operationResult = await _operationTracker.GetCompletedResult(expiredLease.OperationId);
        
        if (operationResult != null) {
            // Operation finished - retry with new sequence
            var newLease = await _sequenceLeaser.LeaseSequence(TimeSpan.FromMinutes(1));
            
            try {
                var retryOperation = operationResult.CloneWithNewSequence(newLease.SequenceNumber);
                await _operationStore.Store(retryOperation);
                await newLease.Commit();
                
                _metrics.RecordSuccessfulRetry(expiredLease.SequenceNumber, newLease.SequenceNumber);
                _logger.LogInfo($\"Retried operation from {expiredLease.SequenceNumber} to {newLease.SequenceNumber}\");
                
                return true;
            } catch (Exception ex) {
                await newLease.Release();
                _logger.LogError(ex, $\"Failed to retry operation {expiredLease.OperationId}\");
                throw;
            }
        }
        
        return false;
    }
}
```

### Strategy 3: Partial Work Recovery
```csharp
public class PartialWorkRecovery {
    public async Task<ExplodedProjectionOperation> RecoverPartialWork(SequenceLease expiredLease) {
        var partialWork = await _workTracker.GetPartialWork(expiredLease.OperationId);
        
        if (partialWork?.WhereClauseResult != null) {
            // Where clause was executed but operation not committed
            var newLease = await _sequenceLeaser.LeaseSequence(TimeSpan.FromMinutes(1));
            
            var recoveredOperation = new ExplodedProjectionOperation {
                Sequence = newLease.SequenceNumber,
                OperationType = partialWork.OperationType,
                EntityType = partialWork.EntityType,
                AffectedEntityIds = partialWork.WhereClauseResult,
                UpdateAction = partialWork.SerializedUpdateAction,
                SourceEventId = partialWork.SourceEventId,
                ProcessedAt = DateTime.UtcNow,
                
                RecoveryMetadata = new RecoveryMetadata {
                    OriginalSequence = expiredLease.SequenceNumber,
                    OriginalOperationId = expiredLease.OperationId,
                    RecoveredAt = DateTime.UtcNow,
                    RecoveryType = RecoveryType.PartialWork
                }
            };
            
            await _operationStore.Store(recoveredOperation);
            await newLease.Commit();
            
            return recoveredOperation;
        }
        
        return null; // No recoverable work
    }
}
```

## Comprehensive Expiration Handler

### Lease Cleanup Service
```csharp
public class LeaseCleanupService : BackgroundService {
    private readonly TimeSpan _cleanupInterval = TimeSpan.FromSeconds(30);
    
    protected override async Task ExecuteAsync(CancellationToken stoppingToken) {
        while (!stoppingToken.IsCancellationRequested) {
            try {
                await ProcessExpiredLeases();
                await Task.Delay(_cleanupInterval, stoppingToken);
            } catch (Exception ex) {
                _logger.LogError(ex, \"Error in lease cleanup service\");
                await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken); // Back off on error
            }
        }
    }
    
    private async Task ProcessExpiredLeases() {
        var expiredLeases = await _leaseStore.GetExpiredLeases();
        
        if (!expiredLeases.Any()) {
            return;
        }
        
        _logger.LogInformation($\"Processing {expiredLeases.Count} expired leases\");
        
        // Process in sequence order to maintain causality
        var orderedLeases = expiredLeases.OrderBy(l => l.SequenceNumber);
        
        foreach (var lease in orderedLeases) {
            await ProcessSingleExpiredLease(lease);
        }
    }
    
    private async Task ProcessSingleExpiredLease(SequenceLease expiredLease) {
        try {
            var recoverySteps = new List<IRecoveryStep> {
                new PartialWorkRecoveryStep(),
                new OperationRetryStep(),
                new SequenceGapStep() // Fallback
            };
            
            foreach (var step in recoverySteps) {
                var result = await step.TryRecover(expiredLease);
                if (result.Success) {
                    _metrics.RecordRecoverySuccess(expiredLease, step.GetType().Name);
                    return;
                }
            }
            
            // All recovery attempts failed
            _logger.LogError($\"All recovery attempts failed for lease {expiredLease.SequenceNumber}\");
            _metrics.RecordRecoveryFailure(expiredLease);
            
        } finally {
            // Always clean up the lease record
            await _leaseStore.Remove(expiredLease.SequenceNumber);
        }
    }
}
```

### Recovery Steps Implementation
```csharp
public interface IRecoveryStep {
    Task<RecoveryResult> TryRecover(SequenceLease expiredLease);
}

public class PartialWorkRecoveryStep : IRecoveryStep {
    public async Task<RecoveryResult> TryRecover(SequenceLease expiredLease) {
        var partialWork = await _workTracker.GetPartialWork(expiredLease.OperationId);
        
        if (partialWork?.IsRecoverable == true) {
            var recovered = await _partialWorkRecovery.RecoverPartialWork(expiredLease);
            return RecoveryResult.Success(\"Recovered from partial work\");
        }
        
        return RecoveryResult.Failed(\"No recoverable partial work\");
    }
}

public class OperationRetryStep : IRecoveryStep {
    public async Task<RecoveryResult> TryRecover(SequenceLease expiredLease) {
        var success = await _retryManager.TryRetryExpiredOperation(expiredLease);
        
        return success 
            ? RecoveryResult.Success(\"Retried completed operation\")
            : RecoveryResult.Failed(\"No completed operation to retry\");
    }
}

public class SequenceGapStep : IRecoveryStep {
    public async Task<RecoveryResult> TryRecover(SequenceLease expiredLease) {
        await _gapManager.HandleExpiredLease(expiredLease);
        return RecoveryResult.Success(\"Created sequence gap\");
    }
}
```

## Cascading Failure Prevention

### Timeout Escalation
```csharp
public class TimeoutEscalationManager {
    public async Task HandleCascadingTimeouts(IEnumerable<SequenceLease> expiredLeases) {
        var cascadeCount = expiredLeases.Count();
        
        if (cascadeCount > _settings.CascadeThreshold) {
            _logger.LogError($\"Cascading timeout detected: {cascadeCount} expired leases\");
            
            // Emergency measures
            await EnterTimeoutRecoveryMode();
            
            // Process in smaller batches to prevent overwhelming
            var batches = expiredLeases.Chunk(_settings.RecoveryBatchSize);
            
            foreach (var batch in batches) {
                await ProcessExpiredBatch(batch);
                await Task.Delay(_settings.RecoveryBatchDelay); // Throttle processing
            }
            
            await ExitTimeoutRecoveryMode();
        } else {
            // Normal processing
            foreach (var lease in expiredLeases.OrderBy(l => l.SequenceNumber)) {
                await ProcessSingleExpiredLease(lease);
            }
        }
    }
    
    private async Task EnterTimeoutRecoveryMode() {
        // Temporarily increase lease durations
        _leaseSettings.DefaultLeaseDuration *= 2;
        
        // Reduce query complexity thresholds
        _querySettings.MaxComplexityScore /= 2;
        
        // Enable aggressive caching
        _cacheSettings.EnableEmergencyMode = true;
        
        _logger.LogWarning(\"Entered timeout recovery mode\");
    }
}
```

### Resource Cleanup
```csharp
public class ResourceCleanupManager {
    public async Task CleanupExpiredLease(SequenceLease expiredLease) {
        var cleanupTasks = new List<Task>();
        
        // 1. Clean up any locks held by the operation
        cleanupTasks.Add(CleanupEntityLocks(expiredLease.OperationId));
        
        // 2. Release any reserved resources
        cleanupTasks.Add(CleanupReservedResources(expiredLease.OperationId));
        
        // 3. Clean up temporary storage
        cleanupTasks.Add(CleanupTemporaryStorage(expiredLease.OperationId));
        
        // 4. Clean up database connections
        cleanupTasks.Add(CleanupDatabaseConnections(expiredLease.OperationId));
        
        // 5. Clean up cache entries
        cleanupTasks.Add(CleanupCacheEntries(expiredLease.OperationId));
        
        await Task.WhenAll(cleanupTasks);
    }
    
    private async Task CleanupEntityLocks(Guid operationId) {
        var locks = await _lockManager.GetLocksForOperation(operationId);
        
        foreach (var lockId in locks) {
            await _lockManager.ReleaseLock(lockId);
            _logger.LogDebug($\"Released lock {lockId} for expired operation {operationId}\");
        }
    }
    
    private async Task CleanupTemporaryStorage(Guid operationId) {
        var tempFiles = await _tempStorage.GetFilesForOperation(operationId);
        
        foreach (var file in tempFiles) {
            await _tempStorage.DeleteFile(file);
            _logger.LogDebug($\"Deleted temp file {file} for expired operation {operationId}\");
        }
    }
}
```

## Edge Cases and Special Handling

### Race Condition: Commit During Expiration
```csharp
public class ExpirationRaceHandler {
    private readonly ConcurrentDictionary<long, object> _commitLocks = new();
    
    public async Task<bool> TryCommitNearExpiry(ExplodedProjectionOperation operation, SequenceLease lease) {
        var lockKey = lease.SequenceNumber;
        
        using var lockScope = await AcquireCommitLock(lockKey);
        
        // Double-check lease hasn't expired while acquiring lock
        if (lease.IsExpired) {
            _logger.LogWarning($\"Lease {lease.SequenceNumber} expired during commit attempt\");
            return false;
        }
        
        // Check if expiration handler is already processing this lease
        if (await _cleanupService.IsProcessingLease(lease.SequenceNumber)) {
            _logger.LogWarning($\"Lease {lease.SequenceNumber} is being cleaned up, cannot commit\");
            return false;
        }
        
        try {
            await _operationStore.Store(operation);
            await lease.Commit();
            
            _logger.LogInfo($\"Successfully committed operation with near-expired lease {lease.SequenceNumber}\");
            return true;
            
        } catch (Exception ex) {
            _logger.LogError(ex, $\"Failed to commit operation with lease {lease.SequenceNumber}\");
            return false;
        }
    }
}
```

### Multiple Process Coordination
```csharp
public class DistributedLeaseCleanup {
    public async Task<bool> TryAcquireCleanupLock(long sequenceNumber) {
        var lockKey = $\"cleanup-lease-{sequenceNumber}\";
        var lockValue = Environment.MachineName + \"-\" + Environment.ProcessId;
        var lockExpiry = TimeSpan.FromMinutes(5);
        
        // Use distributed lock to ensure only one process cleans up
        var acquired = await _distributedLock.TryAcquireLock(lockKey, lockValue, lockExpiry);
        
        if (acquired) {
            _logger.LogDebug($\"Acquired cleanup lock for lease {sequenceNumber}\");
        } else {
            _logger.LogDebug($\"Another process is cleaning up lease {sequenceNumber}\");
        }
        
        return acquired;
    }
    
    public async Task ProcessExpiredLease(SequenceLease expiredLease) {
        if (await TryAcquireCleanupLock(expiredLease.SequenceNumber)) {
            try {
                await _leaseCleanupService.ProcessSingleExpiredLease(expiredLease);
            } finally {
                await _distributedLock.ReleaseLock($\"cleanup-lease-{expiredLease.SequenceNumber}\");
            }
        }
    }
}
```

### Partial Network Failures
```csharp
public class NetworkFailureHandler {
    public async Task HandlePartialNetworkFailure(SequenceLease lease) {
        // Operation completed but can't communicate with central store
        var localResult = await _localOperationCache.GetResult(lease.OperationId);
        
        if (localResult != null) {
            // Store locally and sync when network recovers
            await _localOperationCache.StoreForLaterSync(localResult);
            
            // Try to extend lease if possible
            var extended = await TryExtendLease(lease, TimeSpan.FromMinutes(10));
            
            if (extended) {
                // Schedule retry
                _backgroundRetryService.ScheduleRetry(lease.OperationId, TimeSpan.FromMinutes(5));
            } else {
                // Mark for manual recovery
                await _manualRecoveryQueue.Add(new ManualRecoveryItem {
                    OriginalSequence = lease.SequenceNumber,
                    OperationId = lease.OperationId,
                    LocalResult = localResult,
                    FailureReason = \"Network partition during commit\"
                });
            }
        }
    }
}
```

## Monitoring and Alerting

### Key Metrics for Lease Expiration
```csharp
public class LeaseExpirationMetrics {
    public void RecordExpiredLease(SequenceLease lease, RecoveryOutcome outcome) {
        // Core metrics
        _meterProvider.GetMeter(\"Whizbang.Leasing\")
            .CreateCounter<long>(\"expired_leases_total\")
            .Add(1, new TagList {
                { \"projection_type\", lease.ProjectionType },
                { \"recovery_outcome\", outcome.ToString() }
            });
        
        // Duration tracking
        var leaseDuration = lease.ExpiresAt - lease.LeasedAt;
        var overrun = DateTime.UtcNow - lease.ExpiresAt;
        
        _meterProvider.GetMeter(\"Whizbang.Leasing\")
            .CreateHistogram<double>(\"lease_overrun_seconds\")
            .Record(overrun.TotalSeconds, new TagList {
                { \"projection_type\", lease.ProjectionType }
            });
    }
    
    public void RecordRecoverySuccess(SequenceLease lease, string recoveryMethod) {
        _meterProvider.GetMeter(\"Whizbang.Leasing\")
            .CreateCounter<long>(\"recovery_success_total\")
            .Add(1, new TagList {
                { \"method\", recoveryMethod },
                { \"projection_type\", lease.ProjectionType }
            });
    }
}
```

### Alert Conditions
```csharp
public class LeaseExpirationAlerting {
    public async Task CheckAlertConditions() {
        var metrics = await _metricsCollector.GetLeaseMetrics(TimeSpan.FromHours(1));
        
        // High expiration rate
        if (metrics.ExpirationRate > 0.05) { // 5%
            await _alertManager.SendAlert(AlertLevel.Warning, 
                $\"High lease expiration rate: {metrics.ExpirationRate:P}\");
        }
        
        // Cascading failures
        if (metrics.ConcurrentExpiredLeases > 10) {
            await _alertManager.SendAlert(AlertLevel.Critical,
                $\"Cascading lease failures detected: {metrics.ConcurrentExpiredLeases} concurrent\");
        }
        
        // Recovery failures
        if (metrics.RecoveryFailureRate > 0.01) { // 1%
            await _alertManager.SendAlert(AlertLevel.Warning,
                $\"Lease recovery failures: {metrics.RecoveryFailureRate:P}\");
        }
        
        // Sequence gaps accumulating
        if (metrics.SequenceGapCount > 100) {
            await _alertManager.SendAlert(AlertLevel.Warning,
                $\"Large number of sequence gaps: {metrics.SequenceGapCount}\");
        }
    }
}
```

## Recovery Performance Optimization

### Adaptive Recovery Strategies
```csharp
public class AdaptiveRecoveryManager {
    public async Task<IRecoveryStep[]> SelectOptimalRecoverySteps(SequenceLease expiredLease) {
        var context = await BuildRecoveryContext(expiredLease);
        
        // Select strategy based on system state and historical performance
        return context.SystemLoad switch {
            SystemLoad.Low => new IRecoveryStep[] {
                new PartialWorkRecoveryStep(),
                new OperationRetryStep(),
                new SequenceGapStep()
            },
            
            SystemLoad.Medium => new IRecoveryStep[] {
                new PartialWorkRecoveryStep(),
                new SequenceGapStep() // Skip expensive retry
            },
            
            SystemLoad.High => new IRecoveryStep[] {
                new SequenceGapStep() // Just create gap, minimize processing
            },
            
            _ => new IRecoveryStep[] { new SequenceGapStep() }
        };
    }
    
    private async Task<RecoveryContext> BuildRecoveryContext(SequenceLease expiredLease) {
        var metrics = await _systemMetrics.GetCurrentMetrics();
        
        return new RecoveryContext {
            SystemLoad = ClassifySystemLoad(metrics),
            ProjectionType = expiredLease.ProjectionType,
            TimeSinceExpiry = DateTime.UtcNow - expiredLease.ExpiresAt,
            HistoricalRecoverySuccess = await GetHistoricalRecoveryRate(expiredLease.ProjectionType)
        };
    }
}
```

## Summary

Lease expiration handling in Whizbang follows a multi-layered approach:

1. **Prevention**: Adaptive lease durations and monitoring
2. **Detection**: Continuous cleanup service with distributed coordination
3. **Recovery**: Multiple strategies from simple gaps to complex partial work recovery
4. **Cleanup**: Comprehensive resource cleanup and state management
5. **Monitoring**: Rich metrics and alerting for operational visibility

This comprehensive approach ensures that lease expiration, while disruptive, does not compromise system integrity or performance. The system gracefully degrades and recovers, maintaining the core guarantees of deterministic replay and event ordering even in failure scenarios.