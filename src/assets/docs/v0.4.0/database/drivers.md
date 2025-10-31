---
title: Database Drivers
version: 0.4.0
category: Database
order: 2
evolves-from: v0.2.0/enhancements/drivers.md
evolves-to: v0.5.0/production/drivers.md
description: Production database drivers for SQL and NoSQL with JSONB support
tags: drivers, database, sql, nosql, postgresql, mongodb, redis, jsonb, v0.4.0
---

# Database Drivers

![Version](https://img.shields.io/badge/version-0.4.0-blue)
![Status](https://img.shields.io/badge/status-database-brown)
![Next Update](https://img.shields.io/badge/next-v0.5.0-yellow)

## Version History

:::updated
**Database support in v0.4.0**: 
- PostgreSQL driver with JSONB
- SQL Server and MySQL drivers
- MongoDB driver
- Redis driver for caching
- Connection pooling and retry logic
:::

:::planned
**Coming in v0.5.0**: 
- Distributed multi-model drivers
- Cross-region replication
- Automatic sharding
- Cloud-native drivers (DynamoDB, Cosmos DB)

[See production features →](../../v0.5.0/production/drivers.md)
:::

## SQL Drivers

### PostgreSQL Driver

:::new
Full PostgreSQL support with JSONB for flexible schemas:
:::

```csharp
[WhizbangDriver("PostgreSQL")]
public class PostgreSQLDriver : IDriver, IQueryableDriver, ITransactionalDriver {
    private readonly string _connectionString;
    private readonly NpgsqlDataSource _dataSource;
    
    public string Name => "PostgreSQL";
    public DriverCapabilities Capabilities => 
        DriverCapabilities.Persistence | 
        DriverCapabilities.Transactions |
        DriverCapabilities.Queries |
        DriverCapabilities.Indexing |
        DriverCapabilities.Streaming;
    
    public PostgreSQLDriver(PostgreSQLOptions options) {
        _connectionString = options.ConnectionString;
        
        // Configure connection pool
        var dataSourceBuilder = new NpgsqlDataSourceBuilder(_connectionString);
        dataSourceBuilder.EnableDynamicJson();
        dataSourceBuilder.ConnectionLifetime = 300; // 5 minutes
        dataSourceBuilder.MaxPoolSize = options.MaxPoolSize;
        
        _dataSource = dataSourceBuilder.Build();
        
        // Ensure table exists
        InitializeSchema().Wait();
    }
    
    private async Task InitializeSchema() {
        await using var conn = await _dataSource.OpenConnectionAsync();
        await using var cmd = conn.CreateCommand();
        
        cmd.CommandText = @"
            CREATE TABLE IF NOT EXISTS whizbang_store (
                key TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                data JSONB NOT NULL,
                metadata JSONB,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            
            CREATE INDEX IF NOT EXISTS idx_type ON whizbang_store(type);
            CREATE INDEX IF NOT EXISTS idx_data_gin ON whizbang_store USING GIN(data);
            CREATE INDEX IF NOT EXISTS idx_metadata_gin ON whizbang_store USING GIN(metadata);
        ";
        
        await cmd.ExecuteNonQueryAsync();
    }
    
    public async Task<T?> Get<T>(string key) where T : class {
        await using var conn = await _dataSource.OpenConnectionAsync();
        await using var cmd = conn.CreateCommand();
        
        cmd.CommandText = "SELECT data FROM whizbang_store WHERE key = @key";
        cmd.Parameters.AddWithValue("key", key);
        
        await using var reader = await cmd.ExecuteReaderAsync();
        if (await reader.ReadAsync()) {
            var json = reader.GetFieldValue<JsonDocument>(0);
            return JsonSerializer.Deserialize<T>(json.RootElement.GetRawText());
        }
        
        return null;
    }
    
    public async Task Set<T>(string key, T value) where T : class {
        await using var conn = await _dataSource.OpenConnectionAsync();
        await using var cmd = conn.CreateCommand();
        
        cmd.CommandText = @"
            INSERT INTO whizbang_store (key, type, data, metadata, updated_at)
            VALUES (@key, @type, @data, @metadata, NOW())
            ON CONFLICT (key) DO UPDATE 
            SET data = EXCLUDED.data,
                type = EXCLUDED.type,
                metadata = EXCLUDED.metadata,
                updated_at = NOW()
        ";
        
        cmd.Parameters.AddWithValue("key", key);
        cmd.Parameters.AddWithValue("type", typeof(T).FullName);
        cmd.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, 
            JsonSerializer.Serialize(value));
        cmd.Parameters.AddWithValue("metadata", NpgsqlDbType.Jsonb,
            JsonSerializer.Serialize(ExtractMetadata(value)));
        
        await cmd.ExecuteNonQueryAsync();
    }
    
    public async Task<IEnumerable<T>> Query<T>(Expression<Func<T, bool>> predicate) where T : class {
        var visitor = new JsonQueryVisitor();
        visitor.Visit(predicate);
        
        await using var conn = await _dataSource.OpenConnectionAsync();
        await using var cmd = conn.CreateCommand();
        
        cmd.CommandText = $@"
            SELECT data FROM whizbang_store 
            WHERE type = @type 
            AND data @> @filter::jsonb
        ";
        
        cmd.Parameters.AddWithValue("type", typeof(T).FullName);
        cmd.Parameters.AddWithValue("filter", visitor.GetJsonFilter());
        
        var results = new List<T>();
        await using var reader = await cmd.ExecuteReaderAsync();
        
        while (await reader.ReadAsync()) {
            var json = reader.GetFieldValue<JsonDocument>(0);
            var item = JsonSerializer.Deserialize<T>(json.RootElement.GetRawText());
            if (item != null) {
                results.Add(item);
            }
        }
        
        return results;
    }
}
```

### SQL Server Driver

:::new
SQL Server support with JSON columns:
:::

```csharp
[WhizbangDriver("SqlServer")]
public class SqlServerDriver : IDriver, ITransactionalDriver {
    private readonly string _connectionString;
    
    public async Task Set<T>(string key, T value) where T : class {
        using var conn = new SqlConnection(_connectionString);
        await conn.OpenAsync();
        
        var cmd = new SqlCommand(@"
            MERGE whizbang_store AS target
            USING (SELECT @key AS [key], @type AS [type], @data AS [data]) AS source
            ON target.[key] = source.[key]
            WHEN MATCHED THEN 
                UPDATE SET [data] = source.[data], 
                          [type] = source.[type],
                          updated_at = GETUTCDATE()
            WHEN NOT MATCHED THEN
                INSERT ([key], [type], [data], created_at, updated_at)
                VALUES (source.[key], source.[type], source.[data], 
                       GETUTCDATE(), GETUTCDATE());
        ", conn);
        
        cmd.Parameters.AddWithValue("@key", key);
        cmd.Parameters.AddWithValue("@type", typeof(T).FullName);
        cmd.Parameters.AddWithValue("@data", JsonSerializer.Serialize(value));
        
        await cmd.ExecuteNonQueryAsync();
    }
    
    public async Task<IEnumerable<T>> Query<T>(Expression<Func<T, bool>> predicate) where T : class {
        using var conn = new SqlConnection(_connectionString);
        await conn.OpenAsync();
        
        // Convert predicate to SQL JSON query
        var jsonPath = ConvertToJsonPath(predicate);
        
        var cmd = new SqlCommand($@"
            SELECT [data] 
            FROM whizbang_store
            WHERE [type] = @type
            AND JSON_VALUE([data], @jsonPath) IS NOT NULL
        ", conn);
        
        cmd.Parameters.AddWithValue("@type", typeof(T).FullName);
        cmd.Parameters.AddWithValue("@jsonPath", jsonPath);
        
        var results = new List<T>();
        using var reader = await cmd.ExecuteReaderAsync();
        
        while (await reader.ReadAsync()) {
            var json = reader.GetString(0);
            var item = JsonSerializer.Deserialize<T>(json);
            if (item != null) results.Add(item);
        }
        
        return results;
    }
}
```

## NoSQL Drivers

### MongoDB Driver

:::new
Native MongoDB support with BSON documents:
:::

```csharp
[WhizbangDriver("MongoDB")]
public class MongoDBDriver : IDriver, IQueryableDriver {
    private readonly IMongoDatabase _database;
    private readonly IMongoCollection<BsonDocument> _collection;
    
    public string Name => "MongoDB";
    public DriverCapabilities Capabilities => 
        DriverCapabilities.Persistence | 
        DriverCapabilities.Queries |
        DriverCapabilities.Indexing |
        DriverCapabilities.Streaming;
    
    public MongoDBDriver(MongoDBOptions options) {
        var client = new MongoClient(options.ConnectionString);
        _database = client.GetDatabase(options.Database);
        _collection = _database.GetCollection<BsonDocument>("whizbang_store");
        
        // Create indexes
        CreateIndexes().Wait();
    }
    
    private async Task CreateIndexes() {
        var indexKeys = Builders<BsonDocument>.IndexKeys;
        
        await _collection.Indexes.CreateManyAsync(new[] {
            new CreateIndexModel<BsonDocument>(indexKeys.Ascending("_key")),
            new CreateIndexModel<BsonDocument>(indexKeys.Ascending("_type")),
            new CreateIndexModel<BsonDocument>(indexKeys.Text("data"))
        });
    }
    
    public async Task<T?> Get<T>(string key) where T : class {
        var filter = Builders<BsonDocument>.Filter.Eq("_key", key);
        var document = await _collection.Find(filter).FirstOrDefaultAsync();
        
        if (document == null) return null;
        
        var json = document["data"].ToJson();
        return JsonSerializer.Deserialize<T>(json);
    }
    
    public async Task Set<T>(string key, T value) where T : class {
        var document = new BsonDocument {
            ["_key"] = key,
            ["_type"] = typeof(T).FullName,
            ["data"] = BsonDocument.Parse(JsonSerializer.Serialize(value)),
            ["metadata"] = BsonDocument.Parse(JsonSerializer.Serialize(ExtractMetadata(value))),
            ["updated_at"] = DateTime.UtcNow
        };
        
        var filter = Builders<BsonDocument>.Filter.Eq("_key", key);
        var options = new ReplaceOptions { IsUpsert = true };
        
        await _collection.ReplaceOneAsync(filter, document, options);
    }
    
    public async Task<IEnumerable<T>> Query<T>(Expression<Func<T, bool>> predicate) where T : class {
        // Convert expression to MongoDB filter
        var filter = ConvertToMongoFilter(predicate);
        var typeFilter = Builders<BsonDocument>.Filter.Eq("_type", typeof(T).FullName);
        var combinedFilter = Builders<BsonDocument>.Filter.And(typeFilter, filter);
        
        var documents = await _collection.Find(combinedFilter).ToListAsync();
        
        return documents.Select(doc => {
            var json = doc["data"].ToJson();
            return JsonSerializer.Deserialize<T>(json);
        }).Where(item => item != null)!;
    }
}
```

### Redis Driver

:::new
High-performance caching with Redis:
:::

```csharp
[WhizbangDriver("Redis")]
public class RedisDriver : IDriver {
    private readonly IConnectionMultiplexer _redis;
    private readonly IDatabase _db;
    private readonly RedisOptions _options;
    
    public string Name => "Redis";
    public DriverCapabilities Capabilities => 
        DriverCapabilities.Persistence | 
        DriverCapabilities.Streaming;
    
    public RedisDriver(RedisOptions options) {
        _options = options;
        
        var config = ConfigurationOptions.Parse(options.ConnectionString);
        config.AbortOnConnectFail = false;
        config.ConnectRetry = 3;
        config.ConnectTimeout = 5000;
        
        _redis = ConnectionMultiplexer.Connect(config);
        _db = _redis.GetDatabase(options.Database);
    }
    
    public async Task<T?> Get<T>(string key) where T : class {
        var value = await _db.StringGetAsync(key);
        
        if (value.IsNullOrEmpty) return null;
        
        return JsonSerializer.Deserialize<T>(value!);
    }
    
    public async Task Set<T>(string key, T value) where T : class {
        var json = JsonSerializer.Serialize(value);
        var expiry = _options.DefaultExpiry;
        
        await _db.StringSetAsync(key, json, expiry);
        
        // Update type index
        await _db.SetAddAsync($"type:{typeof(T).FullName}", key);
    }
    
    public async Task<IEnumerable<T>> GetAll<T>(string prefix = "") where T : class {
        var server = _redis.GetServer(_redis.GetEndPoints().First());
        var keys = server.Keys(pattern: $"{prefix}*").ToArray();
        
        if (!keys.Any()) return Enumerable.Empty<T>();
        
        var values = await _db.StringGetAsync(keys);
        
        return values
            .Where(v => !v.IsNullOrEmpty)
            .Select(v => JsonSerializer.Deserialize<T>(v!))
            .Where(item => item != null)!;
    }
    
    // Pub/Sub support for real-time updates
    public async Task Subscribe<T>(string channel, Action<T> handler) where T : class {
        var subscriber = _redis.GetSubscriber();
        
        await subscriber.SubscribeAsync(channel, (ch, message) => {
            var item = JsonSerializer.Deserialize<T>(message!);
            if (item != null) {
                handler(item);
            }
        });
    }
}
```

## Transaction Support

### Distributed Transactions

```csharp
public interface ITransactionalDriver : IDriver {
    Task<ITransaction> BeginTransaction(IsolationLevel isolation = IsolationLevel.ReadCommitted);
}

public class PostgreSQLTransaction : ITransaction {
    private readonly NpgsqlTransaction _transaction;
    private readonly NpgsqlConnection _connection;
    
    public async Task<T?> Get<T>(string key) where T : class {
        // All operations use the transaction's connection
        using var cmd = _connection.CreateCommand();
        cmd.Transaction = _transaction;
        cmd.CommandText = "SELECT data FROM whizbang_store WHERE key = @key";
        cmd.Parameters.AddWithValue("key", key);
        
        // ... execute within transaction
    }
    
    public async Task Commit() {
        await _transaction.CommitAsync();
    }
    
    public async Task Rollback() {
        await _transaction.RollbackAsync();
    }
}
```

## Connection Management

### Connection Pooling

```csharp
public class PooledDriverOptions {
    public int MinPoolSize { get; set; } = 5;
    public int MaxPoolSize { get; set; } = 100;
    public TimeSpan ConnectionLifetime { get; set; } = TimeSpan.FromMinutes(5);
    public TimeSpan ConnectionTimeout { get; set; } = TimeSpan.FromSeconds(30);
    public RetryPolicy RetryPolicy { get; set; } = new ExponentialBackoffRetry();
}
```

## Testing Database Drivers

```csharp
[Test]
public class DatabaseDriverTests {
    [Test]
    public async Task PostgreSQL_JsonbQuery_ShouldWork() {
        // Arrange
        var driver = new PostgreSQLDriver(new PostgreSQLOptions {
            ConnectionString = GetTestConnectionString()
        });
        
        await driver.Set("order:1", new Order {
            Id = Guid.NewGuid(),
            Customer = new Customer { Name = "John", Country = "USA" },
            Total = 99.99m
        });
        
        // Act - Query using JSONB
        var results = await driver.Query<Order>(o => 
            o.Customer.Country == "USA" && o.Total > 50);
        
        // Assert
        Assert.Equal(1, results.Count());
    }
}
```

## Performance Characteristics

| Driver | Write | Read | Query (indexed) | Transaction |
|--------|-------|------|-----------------|-------------|
| PostgreSQL | < 5ms | < 2ms | < 5ms | < 10ms |
| SQL Server | < 8ms | < 3ms | < 8ms | < 15ms |
| MongoDB | < 3ms | < 1ms | < 3ms | N/A |
| Redis | < 1ms | < 0.5ms | N/A | N/A |

## Migration from v0.2.0

### From File to Database

```csharp
// v0.2.0 - File driver
services.AddWhizbangDrivers(options => {
    options.UseFileDriver(file => {
        file.DataDirectory = "./data";
    });
});

// v0.4.0 - Database driver
services.AddWhizbangDrivers(options => {
    options.UsePostgreSQL(Configuration.GetConnectionString("WhizbangDb"));
});

// Migration tool
public class DriverMigration {
    public async Task MigrateFromFileToDB(IDriver source, IDriver target) {
        var allKeys = await source.GetAll<object>();
        foreach (var item in allKeys) {
            await target.Set(item.Key, item.Value);
        }
    }
}
```

## Related Documentation

- [v0.2.0 File Storage](../../v0.2.0/enhancements/drivers.md) - File-based drivers
- [v0.5.0 Production](../../v0.5.0/production/drivers.md) - Distributed drivers
- [Database Guide](../guides/database-selection.md) - Choosing the right database
- [Performance](../guides/database-performance.md) - Database optimization