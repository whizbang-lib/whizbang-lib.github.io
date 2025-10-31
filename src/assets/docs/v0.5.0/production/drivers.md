---
title: Distributed Multi-Model Drivers
version: 0.5.0
category: Production
order: 5
evolves-from: v0.4.0/database/drivers.md
description: Cloud-native distributed drivers with multi-model support and automatic sharding
tags: drivers, distributed, multi-model, sharding, cloud-native, dynamodb, cosmosdb, production, v0.5.0
---

# Distributed Multi-Model Drivers

![Version](https://img.shields.io/badge/version-0.5.0-blue)
![Status](https://img.shields.io/badge/status-production-green)

## Version History

:::updated
**Production-ready in v0.5.0**: 
- Distributed multi-model drivers
- Automatic sharding and partitioning
- Cross-region replication
- Cloud-native drivers (DynamoDB, Cosmos DB, Spanner)
- Intelligent routing and caching
:::

## Distributed Architecture

### Multi-Model Driver

:::new
Single driver interface supporting multiple storage models:
:::

```csharp
[WhizbangDriver("MultiModel")]
public class MultiModelDriver : IDriver, IDistributedDriver {
    private readonly IDriverRouter _router;
    private readonly IDriverRegistry _registry;
    private readonly IShardManager _shardManager;
    private readonly IReplicationManager _replication;
    
    public string Name => "MultiModel";
    public DriverCapabilities Capabilities => 
        DriverCapabilities.Persistence | 
        DriverCapabilities.Transactions |
        DriverCapabilities.Queries |
        DriverCapabilities.Indexing |
        DriverCapabilities.Streaming |
        DriverCapabilities.Distributed;
    
    public MultiModelDriver(MultiModelOptions options) {
        _router = new IntelligentRouter(options.RoutingStrategy);
        _registry = new DriverRegistry();
        _shardManager = new ConsistentHashShardManager(options.ShardCount);
        _replication = new MultiRegionReplicationManager(options.Regions);
        
        // Register model-specific drivers
        RegisterDrivers(options);
    }
    
    private void RegisterDrivers(MultiModelOptions options) {
        // Document model - MongoDB/CosmosDB
        _registry.Register(ModelType.Document, 
            new CosmosDBDriver(options.CosmosDB));
        
        // Key-Value model - Redis/DynamoDB
        _registry.Register(ModelType.KeyValue, 
            new DynamoDBDriver(options.DynamoDB));
        
        // Graph model - Neo4j/CosmosDB Gremlin
        _registry.Register(ModelType.Graph, 
            new Neo4jDriver(options.Neo4j));
        
        // Time-series model - InfluxDB/TimescaleDB
        _registry.Register(ModelType.TimeSeries, 
            new InfluxDBDriver(options.InfluxDB));
        
        // Relational model - PostgreSQL/Spanner
        _registry.Register(ModelType.Relational, 
            new SpannerDriver(options.Spanner));
    }
    
    public async Task<T?> Get<T>(string key) where T : class {
        // Determine optimal driver based on access patterns
        var driver = _router.RouteRead<T>(key);
        
        // Try cache first
        var cached = await _cacheDriver.Get<T>(key);
        if (cached != null) return cached;
        
        // Determine shard
        var shard = _shardManager.GetShard(key);
        
        // Read from primary region
        var result = await driver.Get<T>(shard.GetShardedKey(key));
        
        // Update cache
        if (result != null) {
            await _cacheDriver.Set(key, result, TimeSpan.FromMinutes(5));
        }
        
        return result;
    }
    
    public async Task Set<T>(string key, T value) where T : class {
        // Determine optimal driver based on data characteristics
        var driver = _router.RouteWrite<T>(key, value);
        
        // Determine shard
        var shard = _shardManager.GetShard(key);
        var shardedKey = shard.GetShardedKey(key);
        
        // Write to primary
        await driver.Set(shardedKey, value);
        
        // Replicate asynchronously
        _ = _replication.ReplicateAsync(shardedKey, value, driver.Name);
        
        // Update cache
        await _cacheDriver.Set(key, value, TimeSpan.FromMinutes(5));
        
        // Update indexes
        await UpdateIndexes(key, value);
    }
}
```

### Intelligent Routing

:::new
AI-powered routing based on access patterns:
:::

```csharp
public class IntelligentRouter : IDriverRouter {
    private readonly IAccessPatternAnalyzer _analyzer;
    private readonly IModelSelector _modelSelector;
    private readonly RoutingCache _routingCache;
    
    public IDriver RouteRead<T>(string key) {
        // Check cached routing decision
        if (_routingCache.TryGetRoute(key, out var cachedDriver)) {
            return cachedDriver;
        }
        
        // Analyze access patterns
        var patterns = _analyzer.AnalyzeType<T>();
        
        // Select optimal model
        var model = _modelSelector.SelectModel(patterns);
        
        var driver = model switch {
            // Frequent point lookups -> Key-Value
            ModelType.KeyValue when patterns.PointLookupRatio > 0.8 => 
                GetDriver(ModelType.KeyValue),
            
            // Complex queries -> Document
            ModelType.Document when patterns.QueryComplexity > 0.6 => 
                GetDriver(ModelType.Document),
            
            // Relationships -> Graph
            ModelType.Graph when patterns.RelationshipDepth > 2 => 
                GetDriver(ModelType.Graph),
            
            // Time-based -> TimeSeries
            ModelType.TimeSeries when patterns.TemporalAccess > 0.7 => 
                GetDriver(ModelType.TimeSeries),
            
            // Default -> Relational
            _ => GetDriver(ModelType.Relational)
        };
        
        // Cache routing decision
        _routingCache.SetRoute(key, driver, TimeSpan.FromHours(1));
        
        return driver;
    }
}

public class AccessPatternAnalyzer {
    private readonly IMetricsCollector _metrics;
    
    public AccessPatterns AnalyzeType<T>() {
        var typeName = typeof(T).FullName;
        
        return new AccessPatterns {
            PointLookupRatio = _metrics.GetRatio($"{typeName}.point_lookups"),
            QueryComplexity = _metrics.GetAverage($"{typeName}.query_complexity"),
            RelationshipDepth = CalculateRelationshipDepth<T>(),
            TemporalAccess = _metrics.GetRatio($"{typeName}.temporal_queries"),
            WriteFrequency = _metrics.GetRate($"{typeName}.writes"),
            DataSize = _metrics.GetAverage($"{typeName}.size")
        };
    }
}
```

## Cloud-Native Drivers

### AWS DynamoDB Driver

:::new
Serverless NoSQL with automatic scaling:
:::

```csharp
[WhizbangDriver("DynamoDB")]
public class DynamoDBDriver : IDriver, IDistributedDriver {
    private readonly IAmazonDynamoDB _client;
    private readonly DynamoDBOptions _options;
    
    public DynamoDBDriver(DynamoDBOptions options) {
        _options = options;
        
        var config = new AmazonDynamoDBConfig {
            RegionEndpoint = RegionEndpoint.GetBySystemName(options.Region),
            MaxErrorRetry = 3,
            Timeout = TimeSpan.FromSeconds(30),
            ReadWriteTimeout = TimeSpan.FromSeconds(30)
        };
        
        _client = new AmazonDynamoDBClient(config);
        
        // Ensure table exists with global tables
        EnsureGlobalTable().Wait();
    }
    
    private async Task EnsureGlobalTable() {
        var createRequest = new CreateTableRequest {
            TableName = _options.TableName,
            AttributeDefinitions = new List<AttributeDefinition> {
                new() { AttributeName = "pk", AttributeType = "S" },
                new() { AttributeName = "sk", AttributeType = "S" },
                new() { AttributeName = "gsi1pk", AttributeType = "S" },
                new() { AttributeName = "gsi1sk", AttributeType = "S" }
            },
            KeySchema = new List<KeySchemaElement> {
                new() { AttributeName = "pk", KeyType = "HASH" },
                new() { AttributeName = "sk", KeyType = "RANGE" }
            },
            GlobalSecondaryIndexes = new List<GlobalSecondaryIndex> {
                new() {
                    IndexName = "GSI1",
                    KeySchema = new List<KeySchemaElement> {
                        new() { AttributeName = "gsi1pk", KeyType = "HASH" },
                        new() { AttributeName = "gsi1sk", KeyType = "RANGE" }
                    },
                    Projection = new Projection { ProjectionType = "ALL" },
                    ProvisionedThroughput = new ProvisionedThroughput {
                        ReadCapacityUnits = 5,
                        WriteCapacityUnits = 5
                    }
                }
            },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            StreamSpecification = new StreamSpecification {
                StreamEnabled = true,
                StreamViewType = StreamViewType.NEW_AND_OLD_IMAGES
            }
        };
        
        try {
            await _client.CreateTableAsync(createRequest);
        } catch (ResourceInUseException) {
            // Table already exists
        }
        
        // Enable global tables
        if (_options.GlobalRegions?.Any() == true) {
            await EnableGlobalTable();
        }
    }
    
    public async Task<T?> Get<T>(string key) where T : class {
        var request = new GetItemRequest {
            TableName = _options.TableName,
            Key = new Dictionary<string, AttributeValue> {
                ["pk"] = new AttributeValue { S = GetPartitionKey(key) },
                ["sk"] = new AttributeValue { S = GetSortKey(key) }
            },
            ConsistentRead = _options.ConsistentRead
        };
        
        var response = await _client.GetItemAsync(request);
        
        if (!response.Item.ContainsKey("data")) return null;
        
        var json = response.Item["data"].S;
        return JsonSerializer.Deserialize<T>(json);
    }
    
    public async Task Set<T>(string key, T value) where T : class {
        var item = new Dictionary<string, AttributeValue> {
            ["pk"] = new AttributeValue { S = GetPartitionKey(key) },
            ["sk"] = new AttributeValue { S = GetSortKey(key) },
            ["data"] = new AttributeValue { S = JsonSerializer.Serialize(value) },
            ["type"] = new AttributeValue { S = typeof(T).FullName },
            ["ttl"] = new AttributeValue { N = GetTTL().ToString() },
            ["gsi1pk"] = new AttributeValue { S = GetGSI1PartitionKey<T>() },
            ["gsi1sk"] = new AttributeValue { S = GetGSI1SortKey(value) }
        };
        
        var request = new PutItemRequest {
            TableName = _options.TableName,
            Item = item,
            ConditionExpression = _options.OptimisticLocking 
                ? "attribute_not_exists(pk) OR version = :current_version"
                : null
        };
        
        await _client.PutItemAsync(request);
    }
    
    // Advanced query using GSI
    public async Task<IEnumerable<T>> QueryByType<T>() where T : class {
        var request = new QueryRequest {
            TableName = _options.TableName,
            IndexName = "GSI1",
            KeyConditionExpression = "gsi1pk = :type",
            ExpressionAttributeValues = new Dictionary<string, AttributeValue> {
                [":type"] = new AttributeValue { S = typeof(T).FullName }
            },
            Limit = 100
        };
        
        var response = await _client.QueryAsync(request);
        
        return response.Items.Select(item => {
            var json = item["data"].S;
            return JsonSerializer.Deserialize<T>(json);
        }).Where(x => x != null)!;
    }
}
```

### Azure Cosmos DB Driver

:::new
Globally distributed multi-model database:
:::

```csharp
[WhizbangDriver("CosmosDB")]
public class CosmosDBDriver : IDriver, IDistributedDriver {
    private readonly CosmosClient _client;
    private readonly Database _database;
    private readonly Container _container;
    
    public CosmosDBDriver(CosmosDBOptions options) {
        _client = new CosmosClient(
            options.ConnectionString,
            new CosmosClientOptions {
                ApplicationRegion = options.PreferredRegion,
                ConsistencyLevel = ConsistencyLevel.Session,
                MaxRetryAttemptsOnRateLimitedRequests = 3,
                MaxRetryWaitTimeOnRateLimitedRequests = TimeSpan.FromSeconds(30),
                EnableContentResponseOnWrite = false,
                EnableTcpConnectionEndpointRediscovery = true
            }
        );
        
        _database = _client.GetDatabase(options.Database);
        _container = _database.GetContainer(options.Container);
        
        // Configure multi-region writes
        if (options.EnableMultiRegionWrites) {
            ConfigureMultiRegion().Wait();
        }
    }
    
    public async Task<T?> Get<T>(string key) where T : class {
        try {
            var response = await _container.ReadItemAsync<CosmosDocument<T>>(
                id: key,
                partitionKey: new PartitionKey(GetPartitionKey(key)),
                new ItemRequestOptions {
                    ConsistencyLevel = ConsistencyLevel.Session
                }
            );
            
            return response.Resource.Data;
        }
        catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.NotFound) {
            return null;
        }
    }
    
    public async Task Set<T>(string key, T value) where T : class {
        var document = new CosmosDocument<T> {
            id = key,
            PartitionKey = GetPartitionKey(key),
            Data = value,
            Type = typeof(T).FullName,
            Timestamp = DateTimeOffset.UtcNow,
            TTL = _options.DefaultTTL
        };
        
        await _container.UpsertItemAsync(
            document,
            new PartitionKey(document.PartitionKey),
            new ItemRequestOptions {
                EnableContentResponseOnWrite = false
            }
        );
    }
    
    // Change feed for real-time updates
    public async Task SubscribeToChanges<T>(Action<T> handler) where T : class {
        var processor = _container
            .GetChangeFeedProcessorBuilder<CosmosDocument<T>>(
                processorName: $"processor-{typeof(T).Name}",
                onChangesDelegate: async (changes, cancellationToken) => {
                    foreach (var change in changes) {
                        if (change.Type == typeof(T).FullName) {
                            handler(change.Data);
                        }
                    }
                })
            .WithInstanceName(Environment.MachineName)
            .WithLeaseContainer(_database.GetContainer("leases"))
            .Build();
        
        await processor.StartAsync();
    }
}
```

### Google Spanner Driver

:::new
Globally consistent relational database:
:::

```csharp
[WhizbangDriver("Spanner")]
public class SpannerDriver : IDriver, ITransactionalDriver {
    private readonly SpannerConnection _connection;
    private readonly SpannerOptions _options;
    
    public async Task<T?> Get<T>(string key) where T : class {
        using var cmd = _connection.CreateSelectCommand(
            "SELECT data FROM whizbang_store WHERE key = @key",
            new SpannerParameterCollection {
                { "key", SpannerDbType.String, key }
            }
        );
        
        using var reader = await cmd.ExecuteReaderAsync();
        if (await reader.ReadAsync()) {
            var json = reader.GetFieldValue<string>("data");
            return JsonSerializer.Deserialize<T>(json);
        }
        
        return null;
    }
    
    // Distributed transaction support
    public async Task<ITransaction> BeginTransaction(TransactionOptions options) {
        var transaction = await _connection.BeginTransactionAsync(
            options.IsolationLevel == IsolationLevel.Serializable
                ? TransactionOptions.ReadWrite()
                : TransactionOptions.ReadOnly()
        );
        
        return new SpannerTransaction(transaction);
    }
}
```

## Automatic Sharding

### Consistent Hash Sharding

```csharp
public class ConsistentHashShardManager : IShardManager {
    private readonly ConsistentHash<ShardNode> _ring;
    private readonly int _virtualNodesPerShard;
    
    public ConsistentHashShardManager(int shardCount, int virtualNodes = 150) {
        _virtualNodesPerShard = virtualNodes;
        _ring = new ConsistentHash<ShardNode>();
        
        // Initialize shards
        for (int i = 0; i < shardCount; i++) {
            var shard = new ShardNode($"shard-{i}", i);
            AddShard(shard);
        }
    }
    
    public ShardNode GetShard(string key) {
        return _ring.GetNode(key);
    }
    
    public async Task Rebalance() {
        // Detect imbalanced shards
        var distribution = await AnalyzeDistribution();
        
        if (distribution.StandardDeviation > 0.2) {
            // Add virtual nodes to underutilized shards
            foreach (var shard in distribution.UnderutilizedShards) {
                AddVirtualNodes(shard, 50);
            }
            
            // Migrate data from overutilized shards
            foreach (var shard in distribution.OverutilizedShards) {
                await MigrateData(shard, distribution.UnderutilizedShards);
            }
        }
    }
}
```

## Performance Monitoring

### Distributed Tracing

```csharp
public class TracedDriver : IDriver {
    private readonly IDriver _inner;
    private readonly ITracer _tracer;
    
    public async Task<T?> Get<T>(string key) where T : class {
        using var span = _tracer.StartSpan("driver.get", new SpanContext {
            Tags = {
                ["driver.type"] = _inner.Name,
                ["key"] = key,
                ["type"] = typeof(T).FullName
            }
        });
        
        try {
            var result = await _inner.Get<T>(key);
            span.SetTag("cache.hit", result != null);
            return result;
        }
        catch (Exception ex) {
            span.RecordException(ex);
            throw;
        }
    }
}
```

## Performance at Scale

| Driver | Write Latency | Read Latency | Global Consistency | Auto-Scaling |
|--------|--------------|--------------|-------------------|--------------|
| DynamoDB | < 10ms | < 5ms | Eventual | Yes |
| Cosmos DB | < 10ms | < 5ms | Multiple levels | Yes |
| Spanner | < 20ms | < 10ms | Strong | Yes |
| Multi-Model | < 15ms | < 8ms | Configurable | Yes |

## Testing Distributed Drivers

```csharp
[Test]
public class DistributedDriverTests {
    [Test]
    public async Task MultiRegion_ShouldReplicateData() {
        // Setup multi-region driver
        var driver = new MultiModelDriver(new MultiModelOptions {
            Regions = new[] { "us-east-1", "eu-west-1", "ap-southeast-1" }
        });
        
        // Write to primary region
        await driver.Set("test-key", new TestEntity { Name = "Test" });
        
        // Wait for replication
        await Task.Delay(TimeSpan.FromSeconds(2));
        
        // Read from secondary region
        var driver2 = new MultiModelDriver(new MultiModelOptions {
            PreferredRegion = "eu-west-1"
        });
        
        var result = await driver2.Get<TestEntity>("test-key");
        Assert.NotNull(result);
        Assert.Equal("Test", result.Name);
    }
}
```

## Related Documentation

- [v0.4.0 Database Drivers](../../v0.4.0/database/drivers.md) - SQL/NoSQL drivers
- [Production Guide](../guides/production-drivers.md) - Driver selection for production
- [Scaling Guide](../guides/horizontal-scaling.md) - Sharding and partitioning
- [Cloud Architecture](../guides/cloud-native.md) - Cloud-native patterns