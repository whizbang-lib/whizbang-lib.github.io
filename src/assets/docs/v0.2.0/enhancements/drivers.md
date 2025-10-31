---
title: File Storage Drivers
version: 0.2.0
category: Enhancements
order: 3
evolves-from: v0.1.0/components/drivers.md
evolves-to: v0.4.0/database/drivers.md
description: Persistent file-based storage with JSON serialization and basic indexing
tags: drivers, file-storage, persistence, json, indexing, v0.2.0
---

# File Storage Drivers

![Version](https://img.shields.io/badge/version-0.2.0-blue)
![Status](https://img.shields.io/badge/status-enhanced-green)
![Next Update](https://img.shields.io/badge/next-v0.4.0-yellow)

## Version History

:::updated
**Enhanced in v0.2.0**: 
- File-based persistent storage
- JSON and binary serialization
- Basic indexing for queries
- Atomic write operations
:::

:::planned
**Coming in v0.4.0**: 
- Full SQL database drivers (PostgreSQL, SQL Server, MySQL)
- NoSQL drivers (MongoDB, Redis, Cassandra)
- JSONB support for flexible schemas
- Query optimization with indexes

[See database features →](../../v0.4.0/database/drivers.md)
:::

## New Features in v0.2.0

### File-Based Driver

:::new
Persistent storage using efficient file formats:
:::

```csharp
[WhizbangDriver("File")]
public class FileDriver : IDriver {
    private readonly FileDriverOptions _options;
    private readonly ISerializer _serializer;
    private readonly FileIndex _index;
    private readonly object _writeLock = new();
    
    public string Name => "File";
    public DriverCapabilities Capabilities => 
        DriverCapabilities.Persistence | 
        DriverCapabilities.Indexing;
    
    public FileDriver(FileDriverOptions options) {
        _options = options;
        _serializer = CreateSerializer(options.Format);
        _index = new FileIndex(Path.Combine(options.DataDirectory, ".index"));
        
        // Ensure directory exists
        Directory.CreateDirectory(options.DataDirectory);
        
        // Load index on startup
        _index.Load();
    }
    
    public async Task<T?> Get<T>(string key) where T : class {
        var filePath = GetFilePath(key);
        
        if (!File.Exists(filePath)) {
            return null;
        }
        
        var data = await File.ReadAllBytesAsync(filePath);
        
        if (_options.Compression) {
            data = Decompress(data);
        }
        
        return _serializer.Deserialize<T>(data);
    }
    
    public async Task Set<T>(string key, T value) where T : class {
        var filePath = GetFilePath(key);
        var directory = Path.GetDirectoryName(filePath);
        
        // Ensure subdirectory exists
        Directory.CreateDirectory(directory!);
        
        var data = _serializer.Serialize(value);
        
        if (_options.Compression) {
            data = Compress(data);
        }
        
        // Atomic write with temp file
        var tempPath = $"{filePath}.tmp";
        await File.WriteAllBytesAsync(tempPath, data);
        
        lock (_writeLock) {
            File.Move(tempPath, filePath, true);
            _index.Add(key, value.GetType(), GetMetadata(value));
        }
    }
    
    private string GetFilePath(string key) {
        // Convert key to safe file path
        var safeName = key.Replace(':', '/');
        return Path.Combine(_options.DataDirectory, $"{safeName}.{_options.Extension}");
    }
}
```

### Serialization Options

:::new
Support for multiple serialization formats:
:::

```csharp
public enum SerializationFormat {
    Json,
    MessagePack,
    Protobuf,
    Binary
}

public class JsonSerializer : ISerializer {
    private readonly JsonSerializerOptions _options;
    
    public JsonSerializer() {
        _options = new JsonSerializerOptions {
            WriteIndented = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            Converters = { new JsonStringEnumConverter() }
        };
    }
    
    public byte[] Serialize<T>(T value) {
        return JsonSerializer.SerializeToUtf8Bytes(value, _options);
    }
    
    public T Deserialize<T>(byte[] data) {
        return JsonSerializer.Deserialize<T>(data, _options)!;
    }
}

public class MessagePackSerializer : ISerializer {
    private readonly MessagePackSerializerOptions _options;
    
    public MessagePackSerializer() {
        _options = MessagePackSerializerOptions.Standard
            .WithCompression(MessagePackCompression.Lz4BlockArray);
    }
    
    public byte[] Serialize<T>(T value) {
        return MessagePack.MessagePackSerializer.Serialize(value, _options);
    }
    
    public T Deserialize<T>(byte[] data) {
        return MessagePack.MessagePackSerializer.Deserialize<T>(data, _options);
    }
}
```

### Basic Indexing

:::new
Index support for efficient queries:
:::

```csharp
public class FileIndex {
    private readonly string _indexPath;
    private readonly Dictionary<string, IndexEntry> _entries = new();
    private readonly Dictionary<string, HashSet<string>> _typeIndex = new();
    private readonly Dictionary<string, Dictionary<string, HashSet<string>>> _propertyIndex = new();
    
    public void Add(string key, Type type, Dictionary<string, object> metadata) {
        var entry = new IndexEntry {
            Key = key,
            Type = type.FullName,
            LastModified = DateTime.UtcNow,
            Metadata = metadata
        };
        
        _entries[key] = entry;
        
        // Update type index
        if (!_typeIndex.ContainsKey(type.FullName)) {
            _typeIndex[type.FullName] = new HashSet<string>();
        }
        _typeIndex[type.FullName].Add(key);
        
        // Update property indexes
        foreach (var (propName, propValue) in metadata) {
            if (!_propertyIndex.ContainsKey(propName)) {
                _propertyIndex[propName] = new Dictionary<string, HashSet<string>>();
            }
            
            var valueStr = propValue?.ToString() ?? "";
            if (!_propertyIndex[propName].ContainsKey(valueStr)) {
                _propertyIndex[propName][valueStr] = new HashSet<string>();
            }
            
            _propertyIndex[propName][valueStr].Add(key);
        }
    }
    
    public IEnumerable<string> FindByType(Type type) {
        return _typeIndex.TryGetValue(type.FullName, out var keys) 
            ? keys 
            : Enumerable.Empty<string>();
    }
    
    public IEnumerable<string> FindByProperty(string propertyName, object value) {
        if (_propertyIndex.TryGetValue(propertyName, out var valueIndex)) {
            var valueStr = value?.ToString() ?? "";
            if (valueIndex.TryGetValue(valueStr, out var keys)) {
                return keys;
            }
        }
        return Enumerable.Empty<string>();
    }
    
    public async Task Save() {
        var json = JsonSerializer.Serialize(_entries);
        await File.WriteAllTextAsync(_indexPath, json);
    }
    
    public async Task Load() {
        if (!File.Exists(_indexPath)) return;
        
        var json = await File.ReadAllTextAsync(_indexPath);
        var entries = JsonSerializer.Deserialize<Dictionary<string, IndexEntry>>(json);
        
        // Rebuild indexes
        foreach (var (key, entry) in entries!) {
            _entries[key] = entry;
            RebuildIndexesForEntry(key, entry);
        }
    }
}
```

### Query Support

:::new
Basic query capabilities using indexes:
:::

```csharp
public interface IQueryableDriver : IDriver {
    Task<IEnumerable<T>> Query<T>(Expression<Func<T, bool>> predicate) where T : class;
    Task<IEnumerable<T>> QueryByType<T>() where T : class;
}

public class QueryableFileDriver : FileDriver, IQueryableDriver {
    public async Task<IEnumerable<T>> Query<T>(Expression<Func<T, bool>> predicate) where T : class {
        // Simple property equality queries
        if (predicate.Body is BinaryExpression binary && 
            binary.NodeType == ExpressionType.Equal) {
            
            if (binary.Left is MemberExpression member) {
                var propertyName = member.Member.Name;
                var value = GetValue(binary.Right);
                
                // Use index for fast lookup
                var keys = _index.FindByProperty(propertyName, value);
                
                var results = new List<T>();
                foreach (var key in keys) {
                    var item = await Get<T>(key);
                    if (item != null) {
                        results.Add(item);
                    }
                }
                return results;
            }
        }
        
        // Fallback to scanning all items of type
        var allItems = await QueryByType<T>();
        var compiled = predicate.Compile();
        return allItems.Where(compiled);
    }
    
    public async Task<IEnumerable<T>> QueryByType<T>() where T : class {
        var keys = _index.FindByType(typeof(T));
        var results = new List<T>();
        
        foreach (var key in keys) {
            var item = await Get<T>(key);
            if (item != null) {
                results.Add(item);
            }
        }
        
        return results;
    }
}
```

### Configuration

```csharp
public class FileDriverOptions {
    public string DataDirectory { get; set; } = "./data";
    public SerializationFormat Format { get; set; } = SerializationFormat.Json;
    public bool Compression { get; set; } = false;
    public string Extension { get; set; } = "json";
    public bool AutoSaveIndex { get; set; } = true;
    public TimeSpan IndexSaveInterval { get; set; } = TimeSpan.FromMinutes(1);
}

// Registration
services.AddWhizbangDrivers(options => {
    options.UseFileDriver(file => {
        file.DataDirectory = "./data/whizbang";
        file.Format = SerializationFormat.MessagePack;
        file.Compression = true;
        file.Extension = "msgpack";
    });
});
```

## Atomic Operations

### Write Atomicity

```csharp
public class AtomicFileDriver : FileDriver {
    public async Task<bool> CompareAndSwap<T>(string key, T expected, T value) where T : class {
        var lockPath = $"{GetFilePath(key)}.lock";
        
        // Acquire exclusive lock
        using var lockFile = new FileStream(lockPath, FileMode.Create, 
            FileAccess.Write, FileShare.None);
        
        try {
            var current = await Get<T>(key);
            
            // Compare current with expected
            if (!Equals(current, expected)) {
                return false;
            }
            
            // Perform atomic update
            await Set(key, value);
            return true;
        }
        finally {
            lockFile.Close();
            File.Delete(lockPath);
        }
    }
}
```

## Performance Optimization

### Write Batching

```csharp
public class BatchingFileDriver : FileDriver {
    private readonly Channel<WriteOperation> _writeQueue;
    private readonly Task _batchProcessor;
    
    public BatchingFileDriver(FileDriverOptions options) : base(options) {
        _writeQueue = Channel.CreateUnbounded<WriteOperation>();
        _batchProcessor = ProcessBatches();
    }
    
    public override async Task Set<T>(string key, T value) where T : class {
        var operation = new WriteOperation(key, value);
        await _writeQueue.Writer.WriteAsync(operation);
        await operation.Completion.Task;
    }
    
    private async Task ProcessBatches() {
        while (await _writeQueue.Reader.WaitToReadAsync()) {
            var batch = new List<WriteOperation>();
            
            // Collect batch
            while (_writeQueue.Reader.TryRead(out var op) && batch.Count < 100) {
                batch.Add(op);
            }
            
            // Process batch atomically
            await ProcessBatch(batch);
            
            // Complete operations
            foreach (var op in batch) {
                op.Completion.SetResult(true);
            }
        }
    }
}
```

## Testing File Drivers

```csharp
[Test]
public class FileDriverTests {
    private string _testDirectory;
    private FileDriver _driver;
    
    [SetUp]
    public void Setup() {
        _testDirectory = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        _driver = new FileDriver(new FileDriverOptions {
            DataDirectory = _testDirectory,
            Format = SerializationFormat.Json
        });
    }
    
    [TearDown]
    public void TearDown() {
        Directory.Delete(_testDirectory, recursive: true);
    }
    
    [Test]
    public async Task Data_ShouldPersistAcrossRestarts() {
        // Arrange
        await _driver.Set("test", new TestEntity { Name = "Test" });
        
        // Act - create new driver instance
        var driver2 = new FileDriver(new FileDriverOptions {
            DataDirectory = _testDirectory
        });
        var result = await driver2.Get<TestEntity>("test");
        
        // Assert
        Assert.NotNull(result);
        Assert.Equal("Test", result.Name);
    }
}
```

## Performance Characteristics

| Operation | v0.1.0 (Memory) | v0.2.0 (File) | Notes |
|-----------|-----------------|---------------|-------|
| Get | < 100ns | < 1ms | Disk I/O |
| Set | < 500ns | < 5ms | Atomic write |
| Query (indexed) | N/A | < 2ms | Using index |
| Query (scan) | < 1ms | < 100ms | Full scan |

## Migration from v0.1.0

### Configuration Changes

```csharp
// v0.1.0 - In-memory only
services.AddWhizbangDrivers(options => {
    options.UseInMemory();
});

// v0.2.0 - File persistence
services.AddWhizbangDrivers(options => {
    options.UseFileDriver(file => {
        file.DataDirectory = "./data";
    });
});
```

## Related Documentation

- [v0.1.0 Foundation](../../v0.1.0/components/drivers.md) - In-memory driver
- [v0.4.0 Databases](../../v0.4.0/database/drivers.md) - SQL/NoSQL drivers
- [Storage Guide](../guides/storage-configuration.md) - Configuration options
- [Performance](../guides/driver-performance.md) - Optimization tips