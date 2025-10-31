---
title: Backups and Snapshots
category: Roadmap
status: planned
target_version: 1.1.0
order: 2
unreleased: true
tags: backups, snapshots, disaster-recovery, point-in-time-recovery
---

# Backups and Snapshots

⚠️ **FUTURE FEATURE - NOT YET RELEASED**

This documentation describes backup and snapshot support planned for v1.1.0.
These features are not available in the current release.

**Status**: Planned
**Target Version**: 1.1.0

---

## Overview

Whizbang will provide comprehensive backup and snapshot capabilities for disaster recovery, point-in-time restoration, and performance optimization.

## Event Store Backups

### Continuous Backup

**Automatic, incremental backups** of event streams:

```csharp{
title: "Backup Configuration"
description: "Configure automatic event store backups"
framework: "NET8"
category: "Backups"
difficulty: "INTERMEDIATE"
tags: ["Backups", "Disaster Recovery"]
nugetPackages: ["Whizbang.EventSourcing", "Whizbang.Backups"]
usingStatements: ["Whizbang", "Microsoft.Extensions.DependencyInjection"]
showLineNumbers: true
}
using Whizbang;
using Microsoft.Extensions.DependencyInjection;

services.AddWhizbang(options => {
    options.UseEventSourcing(es => {
        es.UsePostgres(connectionString);

        // Configure backups
        es.UseBackups(backup => {
            // Continuous backup to Azure Blob Storage
            backup.UseAzureBlobStorage(config => {
                config.ConnectionString = azureStorageConnectionString;
                config.ContainerName = "whizbang-backups";
            });

            // Backup every 5 minutes
            backup.Interval = TimeSpan.FromMinutes(5);

            // Retention policy
            backup.RetainFor = TimeSpan.FromDays(30);
            backup.PointInTimeRecovery = true;  // Keep transaction logs
        });
    });
});
```

**Backup Targets**:

- Azure Blob Storage
- AWS S3
- Google Cloud Storage
- Local file system
- Network share (SMB/NFS)

### Point-in-Time Recovery (PITR)

Restore event store to **any point in time**:

```csharp{
title: "Point-in-Time Recovery"
description: "Restore event store to specific timestamp"
framework: "NET8"
category: "Disaster Recovery"
difficulty: "ADVANCED"
tags: ["Backups", "Disaster Recovery", "PITR"]
nugetPackages: ["Whizbang.Backups"]
usingStatements: ["System", "System.Threading.Tasks", "Whizbang.Backups"]
showLineNumbers: true
}
using System;
using System.Threading.Tasks;
using Whizbang.Backups;

public class DisasterRecoveryService {
    private readonly IEventStoreBackupManager _backupManager;

    public DisasterRecoveryService(IEventStoreBackupManager backupManager) {
        _backupManager = backupManager;
    }

    public async Task RecoverToPointInTimeAsync(DateTimeOffset targetTime) {
        // Restore event store to specific timestamp
        await _backupManager.RestoreAsync(new RestoreOptions {
            TargetTime = targetTime,
            TargetDatabase = "whizbang_events_restored",
            VerifyIntegrity = true
        });

        // All events after targetTime are discarded
        // All events before targetTime are restored
    }

    public async Task RecoverLastGoodStateAsync() {
        // Find last known good backup
        var lastGood = await _backupManager.GetLastHealthyBackupAsync();

        await _backupManager.RestoreAsync(new RestoreOptions {
            BackupId = lastGood.Id,
            TargetDatabase = "whizbang_events"
        });
    }
}
```

### Backup Verification

Automatic verification of backup integrity:

```csharp{
title: "Backup Verification"
description: "Verify backup integrity automatically"
framework: "NET8"
category: "Backups"
difficulty: "INTERMEDIATE"
tags: ["Backups", "Verification"]
nugetPackages: ["Whizbang.Backups"]
usingStatements: ["Whizbang", "Microsoft.Extensions.DependencyInjection", "System"]
showLineNumbers: true
}
using System;
using Whizbang;
using Microsoft.Extensions.DependencyInjection;

services.AddWhizbang(options => {
    options.UseEventSourcing(es => {
        es.UseBackups(backup => {
            // Verify backups automatically
            backup.VerifyAfterBackup = true;

            // Restore to temporary database and validate
            backup.VerificationStrategy = BackupVerificationStrategy.FullRestore;

            // Alert on verification failure
            backup.OnVerificationFailed = async (backupId, error) => {
                await alertService.SendAsync($"Backup {backupId} verification failed: {error}");
            };
        });
    });
});
```

## Aggregate Snapshots

### Performance Optimization

**Snapshots** avoid replaying thousands of events for long-lived aggregates:

```csharp{
title: "Aggregate Snapshots"
description: "Configure snapshots for aggregates"
framework: "NET8"
category: "Snapshots"
difficulty: "INTERMEDIATE"
tags: ["Snapshots", "Performance", "Aggregates"]
nugetPackages: ["Whizbang.EventSourcing", "Whizbang.Snapshots"]
usingStatements: ["Whizbang", "Microsoft.Extensions.DependencyInjection", "System"]
showLineNumbers: true
}
using System;
using Whizbang;
using Microsoft.Extensions.DependencyInjection;

services.AddWhizbang(options => {
    options.UseEventSourcing(es => {
        es.UseSnapshots(snap => {
            // Snapshot every 100 events
            snap.SnapshotEvery = 100;

            // Store snapshots in same database as events
            snap.UsePostgres(connectionString);

            // Or use faster storage for snapshots
            snap.UseRedis(redisConnectionString);

            // Async snapshot creation (doesn't block aggregate saves)
            snap.CreateAsynchronously = true;
        });
    });
});
```

### Manual Snapshots

Create snapshots for specific aggregates:

```csharp{
title: "Manual Snapshot Creation"
description: "Create snapshots on demand"
framework: "NET8"
category: "Snapshots"
difficulty: "ADVANCED"
tags: ["Snapshots", "Aggregates"]
nugetPackages: ["Whizbang.EventSourcing", "Whizbang.Snapshots"]
usingStatements: ["System", "System.Threading.Tasks", "Whizbang.Snapshots"]
showLineNumbers: true
}
using System;
using System.Threading.Tasks;
using Whizbang.Snapshots;

public class SnapshotService {
    private readonly ISnapshotStore _snapshotStore;
    private readonly IRepository<Order> _orderRepository;

    public SnapshotService(ISnapshotStore snapshotStore, IRepository<Order> orderRepository) {
        _snapshotStore = snapshotStore;
        _orderRepository = orderRepository;
    }

    public async Task CreateSnapshotAsync(Guid orderId) {
        // Load aggregate
        var order = await _orderRepository.GetAsync(orderId);

        // Create snapshot
        await _snapshotStore.SaveSnapshotAsync(order);
    }

    public async Task RebuildSnapshotsForAllOrdersAsync() {
        // Rebuild all snapshots (e.g., after schema change)
        var orderIds = await GetAllOrderIdsAsync();

        foreach (var orderId in orderIds) {
            await CreateSnapshotAsync(orderId);
        }
    }
}
```

### Snapshot Schema Versioning

Handle snapshot schema changes:

```csharp{
title: "Snapshot Versioning"
description: "Handle evolving snapshot schemas"
framework: "NET8"
category: "Snapshots"
difficulty: "ADVANCED"
tags: ["Snapshots", "Versioning", "Schema Evolution"]
nugetPackages: ["Whizbang.Snapshots"]
usingStatements: ["System", "Whizbang.Snapshots"]
showLineNumbers: true
}
using System;
using Whizbang.Snapshots;

// V1 snapshot
public class OrderSnapshotV1 {
    public Guid Id { get; set; }
    public string Status { get; set; }
    public decimal Total { get; set; }
}

// V2 snapshot (added fields)
public class OrderSnapshotV2 {
    public Guid Id { get; set; }
    public string Status { get; set; }
    public decimal Total { get; set; }
    public DateTimeOffset PlacedAt { get; set; }  // New field
    public string Currency { get; set; }          // New field
}

// Upcaster converts V1 → V2
public class OrderSnapshotUpcaster : ISnapshotUpcaster<OrderSnapshotV1, OrderSnapshotV2> {
    public OrderSnapshotV2 Upcast(OrderSnapshotV1 oldSnapshot) {
        return new OrderSnapshotV2 {
            Id = oldSnapshot.Id,
            Status = oldSnapshot.Status,
            Total = oldSnapshot.Total,
            PlacedAt = DateTimeOffset.MinValue,  // Default for old snapshots
            Currency = "USD"                      // Default currency
        };
    }
}
```

## Projection Backups

### Rebuild vs. Backup

Projections can be **rebuilt from events**, but backups provide faster recovery:

```csharp{
title: "Projection Backup Strategy"
description: "Choose between rebuild and backup restore"
framework: "NET8"
category: "Projections"
difficulty: "INTERMEDIATE"
tags: ["Projections", "Backups", "Disaster Recovery"]
nugetPackages: ["Whizbang.Projections", "Whizbang.Backups"]
usingStatements: ["Whizbang", "Microsoft.Extensions.DependencyInjection", "System"]
showLineNumbers: true
}
using System;
using Whizbang;
using Microsoft.Extensions.DependencyInjection;

services.AddWhizbang(options => {
    options.UseProjections(proj => {
        proj.RegisterProjection<OrderHistoryProjection>(p => {
            // Strategy 1: Rebuild from events (slow but always correct)
            p.DisasterRecoveryStrategy = ProjectionRecoveryStrategy.RebuildFromEvents;

            // Strategy 2: Restore from backup (fast but needs regular backups)
            p.DisasterRecoveryStrategy = ProjectionRecoveryStrategy.RestoreFromBackup;
            p.BackupInterval = TimeSpan.FromHours(1);

            // Strategy 3: Hybrid (restore backup, then replay recent events)
            p.DisasterRecoveryStrategy = ProjectionRecoveryStrategy.Hybrid;
            p.BackupInterval = TimeSpan.FromHours(6);
        });
    });
});
```

### Projection Snapshots

Export projection state for analytics or migration:

```csharp{
title: "Projection Export"
description: "Export projection state for backup or analytics"
framework: "NET8"
category: "Projections"
difficulty: "INTERMEDIATE"
tags: ["Projections", "Backups", "Export"]
nugetPackages: ["Whizbang.Projections", "Whizbang.Backups"]
usingStatements: ["System", "System.Threading.Tasks", "Whizbang.Backups"]
showLineNumbers: true
}
using System;
using System.Threading.Tasks;
using Whizbang.Backups;

public class ProjectionBackupService {
    private readonly IProjectionBackupManager _backupManager;

    public ProjectionBackupService(IProjectionBackupManager backupManager) {
        _backupManager = backupManager;
    }

    public async Task BackupProjectionAsync<TProjection>() {
        // Export entire projection to Parquet file
        await _backupManager.ExportProjectionAsync<TProjection>(new ExportOptions {
            Format = ExportFormat.Parquet,
            Destination = "s3://backups/projections/order-history.parquet",
            Compression = CompressionType.Snappy
        });
    }

    public async Task RestoreProjectionAsync<TProjection>(string backupPath) {
        // Import projection from backup
        await _backupManager.ImportProjectionAsync<TProjection>(new ImportOptions {
            Source = backupPath,
            TruncateExisting = true  // Clear current data first
        });
    }
}
```

## Cross-Region Replication

Replicate event streams to multiple regions for disaster recovery:

```csharp{
title: "Cross-Region Replication"
description: "Replicate events to multiple regions"
framework: "NET8"
category: "Disaster Recovery"
difficulty: "ADVANCED"
tags: ["Replication", "Multi-Region", "Disaster Recovery"]
nugetPackages: ["Whizbang.EventSourcing", "Whizbang.Replication"]
usingStatements: ["Whizbang", "Microsoft.Extensions.DependencyInjection"]
showLineNumbers: true
}
using Whizbang;
using Microsoft.Extensions.DependencyInjection;

services.AddWhizbang(options => {
    options.UseEventSourcing(es => {
        // Primary region (US East)
        es.UsePostgres("Host=us-east.postgres.azure.com;...");

        // Replicate to secondary regions
        es.UseReplication(repl => {
            repl.ReplicateTo("us-west", "Host=us-west.postgres.azure.com;...");
            repl.ReplicateTo("eu-west", "Host=eu-west.postgres.azure.com;...");

            // Async replication (eventual consistency)
            repl.Mode = ReplicationMode.Asynchronous;

            // Failover configuration
            repl.AutomaticFailover = true;
            repl.HealthCheckInterval = TimeSpan.FromSeconds(10);
        });
    });
});
```

## Backup Monitoring

Monitor backup health and alert on issues:

```csharp{
title: "Backup Monitoring"
description: "Monitor and alert on backup health"
framework: "NET8"
category: "Observability"
difficulty: "INTERMEDIATE"
tags: ["Backups", "Monitoring", "Alerts"]
nugetPackages: ["Whizbang.Backups", "Whizbang.OpenTelemetry"]
usingStatements: ["Whizbang", "Microsoft.Extensions.DependencyInjection", "System"]
showLineNumbers: true
}
using System;
using Whizbang;
using Microsoft.Extensions.DependencyInjection;

services.AddWhizbang(options => {
    options.UseBackups(backup => {
        // Emit OpenTelemetry metrics
        backup.UseOpenTelemetry();

        // Alert on backup failures
        backup.OnBackupFailed = async (error) => {
            await alertService.SendAsync($"Backup failed: {error.Message}");
        };

        // Alert if backup hasn't run recently
        backup.AlertIfNoBackupFor = TimeSpan.FromHours(2);

        // Alert on low disk space
        backup.AlertIfStorageBelow = 10 * 1024 * 1024 * 1024;  // 10 GB
    });
});
```

**Metrics Emitted**:

- `whizbang.backup.duration` - How long backups take
- `whizbang.backup.size` - Backup size in bytes
- `whizbang.backup.success` - Backup success/failure count
- `whizbang.backup.verification_duration` - Verification time

## Next Steps

- [**Lakehouse Streaming**](./lakehouse-streaming.md) - Stream events to data lakes
- [**Observability**](../observability.md) - Monitor backup health
- [**Disaster Recovery**](./disaster-recovery.md) - Complete DR strategy

## Feedback Welcome

We're designing this feature now. What backup strategies do you need?

[Share your thoughts](https://github.com/whizbang-lib/whizbang/discussions)
