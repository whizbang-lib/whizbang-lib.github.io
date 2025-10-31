---
title: Ledger Persistence
version: 0.2.0
category: Enhancements
order: 2
evolves-from: v0.1.0/components/ledger.md
evolves-to: v0.3.0/features/ledger.md
description: File-based persistence, event streams, versioning, and snapshots
tags: ledger, persistence, streams, snapshots, v0.2.0
---

# Ledger Persistence

![Version](https://img.shields.io/badge/version-0.2.0-blue)
![Status](https://img.shields.io/badge/status-enhanced-green)
![Next Update](https://img.shields.io/badge/next-v0.3.0-yellow)

## Version History

:::updated
**Enhanced in v0.2.0**: 
- File-based persistent storage
- Event streams with versioning
- Basic snapshot support
- Async streaming APIs
:::

:::planned
**Coming in v0.3.0**: 
- Full event sourcing with aggregates
- Projection management
- Time-travel queries
- Event replay and rebuilding

[See event sourcing features →](../../v0.3.0/features/ledger.md)
:::

## New Features in v0.2.0

### Persistent Storage

:::new
Events now persist to disk using an efficient file format:
:::

```csharp
// Configure file-based ledger
services.AddLedger(options => {
    options.UseFileStorage(file => {
        file.DataDirectory = "./data/events";
        file.MaxFileSize = 100_000_000; // 100MB per file
        file.Compression = CompressionLevel.Optimal;
        file.FlushInterval = TimeSpan.FromSeconds(1);
    });
});

public class FileLedger : ILedger {
    private readonly FileEventStore _store;
    
    public async Task<EventPosition> Append(string streamId, IEvent @event) {
        // Events are written to append-only log files
        // Each file has an index for fast seeking
        var entry = new EventEntry {
            StreamId = streamId,
            EventType = @event.GetType().AssemblyQualifiedName,
            EventData = JsonSerializer.Serialize(@event),
            Metadata = CreateMetadata(@event),
            Timestamp = DateTimeOffset.UtcNow
        };
        
        return await _store.Append(entry);
    }
}
```

### Event Streams

:::new
Events are now organized into streams:
:::

```csharp
public interface IStreamedLedger : ILedger {
    // Append to a specific stream
    Task<StreamVersion> Append(string streamId, IEvent @event, ExpectedVersion version);
    
    // Read a specific stream
    IAsyncEnumerable<EventEnvelope> ReadStream(string streamId, StreamPosition from = default);
    
    // Read all events across streams
    IAsyncEnumerable<EventEnvelope> ReadAll(GlobalPosition from = default);
    
    // Get stream metadata
    Task<StreamMetadata> GetStreamMetadata(string streamId);
}

// Usage
public class OrderAggregate {
    private readonly IStreamedLedger _ledger;
    private readonly string _streamId;
    
    public async Task CreateOrder(CreateOrder cmd) {
        var @event = new OrderCreated {
            OrderId = cmd.OrderId,
            CustomerId = cmd.CustomerId,
            Items = cmd.Items
        };
        
        // Append to order-specific stream
        await _ledger.Append(
            streamId: $"order-{cmd.OrderId}",
            @event: @event,
            version: ExpectedVersion.NoStream
        );
    }
    
    public async Task<Order> LoadOrder(Guid orderId) {
        var order = new Order();
        
        // Read all events for this order
        await foreach (var envelope in _ledger.ReadStream($"order-{orderId}")) {
            order.Apply(envelope.Event);
        }
        
        return order;
    }
}
```

### Stream Versioning

:::new
Optimistic concurrency control via stream versions:
:::

```csharp
public enum ExpectedVersion {
    Any = -2,        // Don't check version
    NoStream = -1,   // Stream shouldn't exist
    EmptyStream = 0  // Stream should be empty
}

public class ConcurrentOrderUpdates {
    private readonly IStreamedLedger _ledger;
    
    public async Task UpdateOrder(Guid orderId, UpdateOrder cmd) {
        var streamId = $"order-{orderId}";
        
        // Read current version
        var metadata = await _ledger.GetStreamMetadata(streamId);
        var currentVersion = metadata.Version;
        
        // Create event
        var @event = new OrderUpdated {
            OrderId = orderId,
            Changes = cmd.Changes
        };
        
        try {
            // Append with version check
            await _ledger.Append(streamId, @event, currentVersion);
        }
        catch (WrongExpectedVersionException ex) {
            // Handle concurrent modification
            throw new ConcurrentUpdateException(
                $"Order {orderId} was modified by another process"
            );
        }
    }
}
```

### Snapshots

:::new
Basic snapshot support for long event streams:
:::

```csharp
public interface ISnapshotStore {
    Task SaveSnapshot(string streamId, object snapshot, StreamVersion version);
    Task<SnapshotEnvelope?> GetSnapshot(string streamId);
}

public class SnapshotLedger : IStreamedLedger {
    private readonly IStreamedLedger _inner;
    private readonly ISnapshotStore _snapshots;
    
    public async Task<T> LoadWithSnapshot<T>(string streamId) where T : IAggregate, new() {
        var aggregate = new T();
        
        // Try to load from snapshot
        var snapshot = await _snapshots.GetSnapshot(streamId);
        if (snapshot != null) {
            aggregate.RestoreFromSnapshot(snapshot.Data);
            
            // Read events after snapshot
            await foreach (var envelope in _inner.ReadStream(streamId, snapshot.Version)) {
                aggregate.Apply(envelope.Event);
            }
        } else {
            // No snapshot, read all events
            await foreach (var envelope in _inner.ReadStream(streamId)) {
                aggregate.Apply(envelope.Event);
            }
        }
        
        return aggregate;
    }
    
    public async Task SaveWithSnapshot<T>(T aggregate) where T : IAggregate {
        var streamId = aggregate.GetStreamId();
        
        // Save events
        foreach (var @event in aggregate.GetUncommittedEvents()) {
            await _inner.Append(streamId, @event, aggregate.Version);
        }
        
        // Create snapshot every 100 events
        if (aggregate.Version % 100 == 0) {
            var snapshot = aggregate.CreateSnapshot();
            await _snapshots.SaveSnapshot(streamId, snapshot, aggregate.Version);
        }
    }
}
```

### Async Streaming

:::new
Efficient async enumeration for large event streams:
:::

```csharp
public class EventProcessor {
    private readonly IStreamedLedger _ledger;
    
    public async Task ProcessAllEvents(CancellationToken ct) {
        var position = GlobalPosition.Start;
        
        // Stream events efficiently without loading all into memory
        await foreach (var envelope in _ledger.ReadAll(position).WithCancellation(ct)) {
            await ProcessEvent(envelope.Event);
            
            // Save checkpoint periodically
            if (envelope.Position.Offset % 1000 == 0) {
                await SaveCheckpoint(envelope.Position);
            }
        }
    }
    
    public async IAsyncEnumerable<OrderSummary> StreamOrderSummaries(
        [EnumeratorCancellation] CancellationToken ct = default) {
        
        await foreach (var envelope in _ledger.ReadAll().WithCancellation(ct)) {
            if (envelope.Event is OrderCreated created) {
                yield return new OrderSummary {
                    OrderId = created.OrderId,
                    Total = created.Total,
                    Timestamp = envelope.Timestamp
                };
            }
        }
    }
}
```

## File Storage Format

### Event File Structure

```
data/events/
├── 00000001.events     # Event data files (append-only)
├── 00000001.index      # Position index for seeking
├── 00000002.events
├── 00000002.index
├── streams.db          # Stream metadata
└── checkpoints.db      # Consumer checkpoints
```

### Event Entry Format

```csharp
// Binary format for efficient storage
[StructLayout(LayoutKind.Sequential, Pack = 1)]
public struct EventHeader {
    public uint Magic;           // 0xEVNT
    public uint Version;         // Format version
    public long Position;        // Global position
    public long Timestamp;       // Unix timestamp
    public int StreamIdLength;   // Stream ID byte length
    public int EventTypeLength;  // Type name byte length
    public int DataLength;       // Event data byte length
    public int MetadataLength;   // Metadata byte length
    public uint Checksum;        // CRC32 checksum
}
// Followed by: StreamId, EventType, Data, Metadata (all UTF-8)
```

## Performance Improvements

### Buffered Writes

```csharp
public class BufferedLedger : IStreamedLedger {
    private readonly Channel<EventWrite> _writeBuffer;
    
    public async Task<StreamVersion> Append(string streamId, IEvent @event, ExpectedVersion version) {
        // Buffer writes for batch processing
        var write = new EventWrite(streamId, @event, version);
        await _writeBuffer.Writer.WriteAsync(write);
        return await write.Completion.Task;
    }
    
    private async Task ProcessWrites() {
        var batch = new List<EventWrite>(capacity: 100);
        
        while (await _writeBuffer.Reader.WaitToReadAsync()) {
            // Collect batch
            while (_writeBuffer.Reader.TryRead(out var write) && batch.Count < 100) {
                batch.Add(write);
            }
            
            // Write batch to disk
            await WriteBatch(batch);
            
            // Complete tasks
            foreach (var write in batch) {
                write.Completion.SetResult(write.ResultVersion);
            }
            
            batch.Clear();
        }
    }
}
```

## Testing Enhanced Ledger

```csharp
[Test]
public class PersistentLedgerTests {
    [Test]
    public async Task Events_ShouldPersistAcrossRestarts() {
        // Arrange
        var dataDir = Path.GetTempPath() + Guid.NewGuid();
        var ledger1 = new FileLedger(dataDir);
        
        // Act - write events
        await ledger1.Append("stream-1", new TestEvent { Data = "test" });
        await ledger1.Dispose();
        
        // Act - read after restart
        var ledger2 = new FileLedger(dataDir);
        var events = await ledger2.ReadStream("stream-1").ToListAsync();
        
        // Assert
        Assert.Equal(1, events.Count);
        Assert.Equal("test", ((TestEvent)events[0].Event).Data);
    }
    
    [Test]
    public async Task ConcurrentAppend_ShouldDetectConflicts() {
        // Test optimistic concurrency control
    }
}
```

## Migration from v0.1.0

### Breaking Changes

- `Append` now requires a stream ID
- `Read` returns `IAsyncEnumerable` instead of `IEnumerable`

### Migration Steps

```csharp
// v0.1.0
await ledger.Append(@event);
var events = ledger.Read();

// v0.2.0
await ledger.Append("default-stream", @event, ExpectedVersion.Any);
var events = await ledger.ReadAll().ToListAsync();
```

## Performance Characteristics

| Operation | v0.1.0 | v0.2.0 | Notes |
|-----------|--------|--------|-------|
| Append | < 1μs | < 10ms | Disk I/O |
| Read 1K events | < 1ms | < 5ms | From cache |
| Read 100K events | OOM | < 100ms | Streaming |
| Restart recovery | N/A | < 1s | Index loading |

## Related Documentation

- [v0.1.0 Foundation](../../v0.1.0/components/ledger.md) - Basic ledger
- [v0.3.0 Event Sourcing](../../v0.3.0/features/ledger.md) - Full ES/CQRS
- [Storage Guide](../guides/storage-configuration.md) - File storage setup
- [Performance](../guides/ledger-performance.md) - Optimization tips