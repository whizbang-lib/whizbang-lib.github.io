# Where Clause Explosion Algorithm

## Overview

Where clause explosion is the process of converting developer-friendly LINQ expressions into concrete lists of affected entity IDs. This transformation happens at event processing time and enables deterministic replay without re-executing complex queries.

## The Challenge

Traditional projection systems face a dilemma:

### Developer Experience vs. Performance
```csharp
// Developers want to write this:
return ProjectionResult.Update<OrderView>(
    where: o => o.CustomerId == evt.CustomerId && o.Status == "Pending",
    update: o => o.Status = "Cancelled"
);

// But systems need this for replay:
return new ExplodedOperation {
    AffectedEntityIds = [12345, 67890, 54321], // Concrete IDs
    UpdateAction = o => o.Status = "Cancelled"
};
```

The where clause explosion algorithm bridges this gap by executing the LINQ expression once during processing and storing the concrete results.

## Algorithm Overview

### Phase 1: Expression Analysis
```csharp
public class WhereClauseAnalyzer {
    public WhereClauseAnalysis Analyze<T>(Expression<Func<T, bool>> whereClause) {
        var visitor = new WhereClauseVisitor();
        visitor.Visit(whereClause);
        
        return new WhereClauseAnalysis {
            ReferencedProperties = visitor.Properties,
            HasConstants = visitor.HasConstants,
            HasParameters = visitor.HasParameters,
            ComplexityScore = visitor.ComplexityScore,
            EstimatedSelectivity = EstimateSelectivity(visitor)
        };
    }
}

public class WhereClauseVisitor : ExpressionVisitor {
    public List<string> Properties { get; } = new();
    public bool HasConstants { get; private set; }
    public bool HasParameters { get; private set; }
    public int ComplexityScore { get; private set; }
    
    protected override Expression VisitMember(MemberExpression node) {
        if (node.Expression?.Type != typeof(ParameterExpression)) {
            Properties.Add(node.Member.Name);
        }
        return base.VisitMember(node);
    }
    
    protected override Expression VisitConstant(ConstantExpression node) {
        HasConstants = true;
        return base.VisitConstant(node);
    }
    
    protected override Expression VisitParameter(ParameterExpression node) {
        HasParameters = true;
        return base.VisitParameter(node);
    }
    
    protected override Expression VisitBinary(BinaryExpression node) {
        ComplexityScore += GetOperatorComplexity(node.NodeType);
        return base.VisitBinary(node);
    }
}
```

### Phase 2: Query Optimization
```csharp
public class QueryOptimizer {
    public OptimizedQuery<T> OptimizeQuery<T>(
        Expression<Func<T, bool>> whereClause,
        WhereClauseAnalysis analysis) {
        
        // Determine optimal execution strategy
        var strategy = SelectExecutionStrategy(analysis);
        
        return strategy switch {
            ExecutionStrategy.IndexScan => OptimizeForIndexScan(whereClause, analysis),
            ExecutionStrategy.TableScan => OptimizeForTableScan(whereClause, analysis),
            ExecutionStrategy.PartitionedScan => OptimizeForPartitions(whereClause, analysis),
            ExecutionStrategy.CachedResult => GetCachedResult(whereClause),
            _ => throw new NotSupportedException($"Strategy {strategy} not supported")
        };
    }
    
    private ExecutionStrategy SelectExecutionStrategy(WhereClauseAnalysis analysis) {
        // High selectivity (few results expected) -> Index scan
        if (analysis.EstimatedSelectivity < 0.01) {
            return ExecutionStrategy.IndexScan;
        }
        
        // Medium selectivity -> Check for partitioning opportunities
        if (analysis.EstimatedSelectivity < 0.1 && analysis.HasPartitionKey) {
            return ExecutionStrategy.PartitionedScan;
        }
        
        // Low selectivity or complex query -> Table scan
        return ExecutionStrategy.TableScan;
    }
}
```

### Phase 3: Query Execution
```csharp
public class QueryExecutor {
    public async Task<long[]> ExecuteWhereClause<T>(
        Expression<Func<T, bool>> whereClause,
        OptimizedQuery<T> optimizedQuery) {
        
        var stopwatch = Stopwatch.StartNew();
        
        try {
            var results = await optimizedQuery.Strategy switch {
                ExecutionStrategy.IndexScan => ExecuteIndexScan(optimizedQuery),
                ExecutionStrategy.TableScan => ExecuteTableScan(optimizedQuery),
                ExecutionStrategy.PartitionedScan => ExecutePartitionedScan(optimizedQuery),
                ExecutionStrategy.CachedResult => Task.FromResult(optimizedQuery.CachedIds),
                _ => throw new NotSupportedException()
            };
            
            // Record performance metrics
            RecordQueryPerformance(whereClause, stopwatch.Elapsed, results.Length);
            
            return results;
            
        } catch (Exception ex) {
            RecordQueryFailure(whereClause, stopwatch.Elapsed, ex);
            throw;
        }
    }
    
    private async Task<long[]> ExecuteIndexScan<T>(OptimizedQuery<T> query) {
        // Use database indexes for efficient lookup
        return await _dbContext.Set<T>()
            .Where(query.OptimizedWhereClause)
            .Select(e => EF.Property<long>(e, \"Id\"))
            .ToArrayAsync();
    }
    
    private async Task<long[]> ExecutePartitionedScan<T>(OptimizedQuery<T> query) {
        // Execute across relevant partitions in parallel
        var partitionTasks = query.RelevantPartitions.Select(async partition => {
            return await _partitionedDbContext.GetPartition(partition)
                .Set<T>()
                .Where(query.OptimizedWhereClause)
                .Select(e => EF.Property<long>(e, \"Id\"))
                .ToArrayAsync();
        });
        
        var partitionResults = await Task.WhenAll(partitionTasks);
        return partitionResults.SelectMany(r => r).ToArray();
    }
}
```

### Phase 4: Result Caching
```csharp
public class QueryResultCache {
    private readonly IMemoryCache _cache;
    private readonly TimeSpan _defaultTtl = TimeSpan.FromMinutes(5);
    
    public async Task<long[]> GetOrExecuteQuery<T>(
        Expression<Func<T, bool>> whereClause,
        Func<Task<long[]>> executeQuery) {
        
        var cacheKey = GenerateCacheKey(whereClause);
        
        if (_cache.TryGetValue(cacheKey, out long[] cachedResult)) {
            return cachedResult;
        }
        
        var result = await executeQuery();
        
        // Cache based on result characteristics
        var ttl = CalculateTtl(result.Length, whereClause);
        _cache.Set(cacheKey, result, ttl);
        
        return result;
    }
    
    private string GenerateCacheKey<T>(Expression<Func<T, bool>> whereClause) {
        // Create stable hash of expression tree
        var expressionHash = ComputeExpressionHash(whereClause);
        var entityType = typeof(T).Name;
        var dataVersion = GetDataVersion<T>(); // Invalidate when data changes
        
        return $\"{entityType}:{expressionHash}:{dataVersion}\";
    }
    
    private TimeSpan CalculateTtl(int resultCount, LambdaExpression whereClause) {
        // Larger result sets cached longer (more expensive to recompute)
        var sizeFactor = Math.Log10(Math.Max(1, resultCount));
        
        // Complex queries cached longer
        var complexityFactor = EstimateComplexity(whereClause);
        
        var ttlSeconds = Math.Min(300, 30 * sizeFactor * complexityFactor); // Max 5 minutes
        return TimeSpan.FromSeconds(ttlSeconds);
    }
}
```

## Explosion Pipeline

### Complete End-to-End Process
```csharp
public class WhereClauseExploder {
    public async Task<ExplodedProjectionOperation> ExplodeProjectionResult(
        ProjectionResult projectionResult,
        IEvent sourceEvent,
        SequenceLease lease) {
        
        switch (projectionResult) {
            case UpdateProjectionResult update:
                return await ExplodeUpdateOperation(update, sourceEvent, lease);
                
            case UpsertProjectionResult upsert:
                return await ExplodeUpsertOperation(upsert, sourceEvent, lease);
                
            case BatchProjectionResult batch:
                return await ExplodeBatchOperation(batch, sourceEvent, lease);
                
            default:
                throw new NotSupportedException($\"Projection type {projectionResult.GetType()} not supported\");
        }
    }
    
    private async Task<ExplodedProjectionOperation> ExplodeUpdateOperation(
        UpdateProjectionResult update,
        IEvent sourceEvent,
        SequenceLease lease) {
        
        // Step 1: Analyze the where clause
        var analysis = _whereClauseAnalyzer.Analyze(update.WhereClause);
        
        // Step 2: Optimize query execution
        var optimizedQuery = _queryOptimizer.OptimizeQuery(update.WhereClause, analysis);
        
        // Step 3: Execute query to get affected IDs
        var affectedIds = await _queryExecutor.ExecuteWhereClause(update.WhereClause, optimizedQuery);
        
        // Step 4: Create exploded operation
        return new ExplodedProjectionOperation {
            Sequence = lease.SequenceNumber,
            OperationType = OperationType.Update,
            EntityType = update.EntityType.Name,
            AffectedEntityIds = affectedIds,
            UpdateAction = SerializeUpdateAction(update.UpdateAction),
            OriginalWhereClause = update.WhereClause.ToString(),
            SourceEventId = sourceEvent.Id,
            ProcessedAt = DateTime.UtcNow,
            
            // Metadata for debugging and optimization
            QueryAnalysis = analysis,
            ExecutionStats = new QueryExecutionStats {
                ExecutionTime = _queryExecutor.LastExecutionTime,
                Strategy = optimizedQuery.Strategy,
                ResultCount = affectedIds.Length,
                CacheHit = optimizedQuery.WasCacheHit
            }
        };
    }
}
```

## Performance Optimizations

### 1. Intelligent Caching
```csharp
public class IntelligentQueryCache {
    // Cache frequently executed queries
    public async Task<long[]> GetCachedOrExecute<T>(
        Expression<Func<T, bool>> whereClause,
        Func<Task<long[]>> executeQuery) {
        
        var querySignature = AnalyzeQuerySignature(whereClause);
        
        // Check for exact match first
        var exactKey = GenerateExactCacheKey(whereClause);
        if (_cache.TryGetValue(exactKey, out long[] exactResult)) {
            return exactResult;
        }
        
        // Check for similar queries that can be filtered
        var similarKey = GenerateSimilarCacheKey(querySignature);
        if (_cache.TryGetValue(similarKey, out CachedQueryResult similar)) {
            var filtered = FilterSimilarResult(similar, whereClause);
            if (filtered != null) {
                return filtered;
            }
        }
        
        var result = await executeQuery();
        
        // Cache with appropriate TTL and tags
        var cacheEntry = new CachedQueryResult {
            EntityIds = result,
            QuerySignature = querySignature,
            CachedAt = DateTime.UtcNow,
            InvalidationTags = GenerateInvalidationTags(whereClause)
        };
        
        _cache.Set(exactKey, result, CalculateTtl(result.Length));
        _cache.Set(similarKey, cacheEntry, CalculateTtl(result.Length));
        
        return result;
    }
}
```

### 2. Parallel Execution for Complex Queries
```csharp
public class ParallelQueryExecutor {
    public async Task<long[]> ExecuteComplexQuery<T>(
        Expression<Func<T, bool>> whereClause) {
        
        // Decompose complex AND/OR expressions
        var subExpressions = DecomposeExpression(whereClause);
        
        if (subExpressions.Count > 1) {
            // Execute sub-queries in parallel
            var subQueryTasks = subExpressions.Select(async subExpr => {
                return await ExecuteSimpleQuery(subExpr);
            });
            
            var subResults = await Task.WhenAll(subQueryTasks);
            
            // Combine results based on logical operators
            return CombineResults(subResults, whereClause);
        }
        
        return await ExecuteSimpleQuery(whereClause);
    }
    
    private long[] CombineResults(long[][] subResults, Expression whereClause) {
        // Analyze the expression to determine how to combine
        var combiner = AnalyzeCombinationLogic(whereClause);
        
        return combiner switch {
            CombinationLogic.And => IntersectResults(subResults),
            CombinationLogic.Or => UnionResults(subResults),
            CombinationLogic.Complex => EvaluateComplexLogic(subResults, whereClause),
            _ => throw new NotSupportedException()
        };
    }
}
```

### 3. Incremental Updates
```csharp
public class IncrementalQueryTracker {
    // Track changes to entities and invalidate affected queries
    public async Task OnEntityChanged<T>(T entity, string[] changedProperties) {
        var entityId = GetEntityId(entity);
        
        // Find queries that might be affected by this change
        var affectedQueries = await _queryIndex.GetQueriesAffectedBy<T>(changedProperties);
        
        foreach (var query in affectedQueries) {
            // Check if entity now matches/doesn't match the query
            var currentlyMatches = await EvaluateQueryForEntity(query, entity);
            var previouslyMatched = await _resultCache.EntityWasInResult(query, entityId);
            
            if (currentlyMatches != previouslyMatched) {
                // Result set changed - invalidate cache
                await _resultCache.InvalidateQuery(query);
                
                // Optionally update incrementally instead of full invalidation
                if (currentlyMatches) {
                    await _resultCache.AddEntityToResult(query, entityId);
                } else {
                    await _resultCache.RemoveEntityFromResult(query, entityId);
                }
            }
        }
    }
}
```

## Storage and Serialization

### Exploded Operation Storage
```csharp
public class ExplodedProjectionOperation {
    public long Sequence { get; set; }
    public OperationType OperationType { get; set; }
    public string EntityType { get; set; }
    public long[] AffectedEntityIds { get; set; }
    public byte[] SerializedUpdateAction { get; set; }
    public string OriginalWhereClause { get; set; }  // For debugging
    public Guid SourceEventId { get; set; }
    public DateTime ProcessedAt { get; set; }
    
    // Performance tracking
    public QueryExecutionStats ExecutionStats { get; set; }
    public WhereClauseAnalysis QueryAnalysis { get; set; }
}

// Efficient storage format
public class CompactOperationStorage {
    public async Task StoreOperation(ExplodedProjectionOperation operation) {
        // Compress entity ID arrays for large result sets
        var compressedIds = await CompressEntityIds(operation.AffectedEntityIds);
        
        // Use efficient serialization for update actions
        var compressedAction = await CompressUpdateAction(operation.SerializedUpdateAction);
        
        var storedOperation = new StoredOperation {
            Sequence = operation.Sequence,
            OperationType = (byte)operation.OperationType,
            EntityTypeHash = HashEntityType(operation.EntityType),
            CompressedEntityIds = compressedIds,
            CompressedUpdateAction = compressedAction,
            SourceEventId = operation.SourceEventId,
            ProcessedAt = operation.ProcessedAt
        };
        
        await _operationStore.InsertAsync(storedOperation);
        
        // Store detailed metadata separately for debugging
        if (_settings.StoreDebugMetadata) {
            await _metadataStore.InsertAsync(new OperationMetadata {
                Sequence = operation.Sequence,
                OriginalWhereClause = operation.OriginalWhereClause,
                ExecutionStats = operation.ExecutionStats,
                QueryAnalysis = operation.QueryAnalysis
            });
        }
    }
}
```

## Error Handling and Edge Cases

### 1. Empty Result Sets
```csharp
public async Task<ExplodedProjectionOperation> HandleEmptyResult(
    UpdateProjectionResult update,
    IEvent sourceEvent) {
    
    // Empty where clause result - create no-op operation
    return new ExplodedProjectionOperation {
        OperationType = OperationType.NoOp,
        EntityType = update.EntityType.Name,
        AffectedEntityIds = Array.Empty<long>(),
        SourceEventId = sourceEvent.Id,
        ProcessedAt = DateTime.UtcNow,
        
        Metadata = new OperationMetadata {
            OriginalWhereClause = update.WhereClause.ToString(),
            EmptyResultReason = \"No entities matched where clause\"
        }
    };
}
```

### 2. Large Result Sets
```csharp
public async Task<ExplodedProjectionOperation> HandleLargeResult(
    long[] affectedIds,
    UpdateProjectionResult update,
    IEvent sourceEvent) {
    
    if (affectedIds.Length > _settings.MaxEntityIdsPerOperation) {
        // Split into batches
        var batches = affectedIds
            .Chunk(_settings.MaxEntityIdsPerOperation)
            .ToArray();
        
        var batchOperations = batches.Select((batch, index) => 
            new ExplodedProjectionOperation {
                OperationType = OperationType.UpdateBatch,
                BatchIndex = index,
                BatchTotal = batches.Length,
                AffectedEntityIds = batch,
                // ... other properties
            }
        ).ToArray();
        
        return new ExplodedProjectionOperation {
            OperationType = OperationType.BatchContainer,
            BatchedOperations = batchOperations,
            SourceEventId = sourceEvent.Id
        };
    }
    
    return new ExplodedProjectionOperation {
        OperationType = OperationType.Update,
        AffectedEntityIds = affectedIds,
        // ... other properties
    };
}
```

### 3. Query Timeouts
```csharp
public async Task<long[]> ExecuteWithTimeout<T>(
    Expression<Func<T, bool>> whereClause,
    TimeSpan timeout) {
    
    using var cts = new CancellationTokenSource(timeout);
    
    try {
        return await _queryExecutor.ExecuteWhereClause(whereClause, cts.Token);
    }
    catch (OperationCanceledException) when (cts.Token.IsCancellationRequested) {
        // Query timed out - log and create fallback operation
        _logger.LogWarning($\"Query timeout for: {whereClause}\");
        
        // Option 1: Return empty result and retry later
        return Array.Empty<long>();
        
        // Option 2: Fall back to simpler query
        // var simplifiedQuery = SimplifyQuery(whereClause);
        // return await ExecuteWithTimeout(simplifiedQuery, timeout);
        
        // Option 3: Estimate result set and create placeholder
        // var estimatedIds = EstimateAffectedEntities(whereClause);
        // return estimatedIds;
    }
}
```

## Performance Characteristics

### Time Complexity
- **Simple Equality**: O(log n) with index
- **Range Queries**: O(log n + k) where k = result size
- **Complex Predicates**: O(n) table scan
- **Cached Queries**: O(1) lookup

### Space Complexity
- **Entity ID Storage**: O(k) where k = affected entities
- **Cache Storage**: O(c) where c = cached queries
- **Index Overhead**: O(n * i) where i = indexed properties

### Optimization Guidelines
1. **Use indexed properties** in where clauses
2. **Minimize result set size** with selective predicates
3. **Cache frequently used queries**
4. **Partition large tables** for parallel execution
5. **Monitor query performance** and adjust caching

## Benefits of Where Clause Explosion

### Developer Experience
- **Natural LINQ syntax** for projection updates
- **No manual ID management** required
- **Flexible query expressions** supported

### Performance
- **One-time query execution** per event
- **Deterministic replay** without re-querying
- **Optimized storage** with compressed ID arrays

### Reliability
- **Exact reproduction** of original results
- **Immune to schema changes** during replay
- **Clear audit trail** of affected entities

### Scalability
- **Parallel replay** possible with known ID sets
- **Efficient storage** with compression
- **Horizontal partitioning** support

The where clause explosion algorithm is a key innovation that enables Whizbang to provide both excellent developer experience and high performance at scale.