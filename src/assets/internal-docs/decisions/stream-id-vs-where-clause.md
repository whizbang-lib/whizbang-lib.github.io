# ADR-001: Stream ID vs Where Clause Explosion

## Status
**Accepted** - Implemented in v0.1.0

## Context

Event sourcing frameworks traditionally organize events into streams identified by unique stream IDs (like MartenDB's approach). Each stream represents the event history for a specific aggregate or entity. Projections then subscribe to events and update read models based on the stream's aggregate ID.

However, this approach has limitations:
- **Rigid Boundaries**: Updates are constrained to single aggregates
- **Complex Cross-Stream Operations**: Updating multiple related entities requires complex coordination
- **Developer Overhead**: Manual stream ID management and aggregate design
- **Limited Query Flexibility**: Where clauses must be converted to stream lookups

Whizbang needed to decide between following the traditional stream-based approach or innovating with a where-clause-based system.

## Options Considered

### Option 1: Traditional Stream IDs (MartenDB Approach)

**How it works:**
```csharp
// Events stored in streams
Stream: "Order-12345"
Events: [OrderCreated, OrderShipped, OrderDelivered]

// Projections subscribe to streams
public class OrderProjection : IProjection {
    public void Apply(OrderCreated evt) {
        // Update order with ID = evt.OrderId
        var order = _store.Load<OrderView>(evt.OrderId);
        order.Status = "Created";
        _store.Store(order);
    }
}
```

**Pros:**
- Well-established pattern in event sourcing
- Clear ownership boundaries (one aggregate per stream)
- Efficient storage and retrieval by stream ID
- Proven scalability in production systems

**Cons:**
- Limited to single-aggregate updates
- Complex cross-aggregate operations require sagas
- Manual aggregate boundary design decisions
- Developer overhead in stream management
- Difficult to express complex business rules spanning multiple entities

### Option 2: Where Clause Explosion (Whizbang Innovation)

**How it works:**
```csharp
// Developers write natural LINQ expressions
return ProjectionResult.Update<OrderView>(
    where: o => o.CustomerId == evt.CustomerId && o.Status == "Pending",
    update: o => o.Status = "Cancelled"
);

// Framework explodes this to concrete IDs at runtime
StoredOperation {
    AffectedEntityIds: [12345, 67890, 54321], // Discovered by executing where clause
    UpdateAction: o => o.Status = "Cancelled"
}
```

**Pros:**
- Natural LINQ-based developer experience
- Flexible cross-entity updates without complex coordination
- No manual aggregate boundary decisions required
- Deterministic replay through concrete ID storage
- Supports complex business rules naturally

**Cons:**
- Novel approach with unknown edge cases
- Query execution overhead at write time
- More complex implementation than stream-based approach
- Storage overhead for entity ID arrays
- Potential performance issues with large result sets

### Option 3: Hybrid Approach

**How it works:**
```csharp
// Optional stream hints for performance
return ProjectionResult.Update<OrderView>(
    where: o => o.OrderId == evt.OrderId,
    update: o => o.Status = "Shipped",
    streamHint: evt.OrderId  // Framework can optimize using this
);
```

**Pros:**
- Best of both worlds: flexibility and performance
- Gradual migration path from traditional approaches
- Performance optimization opportunities

**Cons:**
- Additional complexity in implementation
- Confusing developer model (when to use hints?)
- Optimization benefits may not justify complexity

## Decision

**Chosen: Option 2 - Where Clause Explosion**

Whizbang will use where clause explosion as the primary approach for projection updates. This decision prioritizes developer experience and flexibility over proven patterns.

### Key Reasoning:

1. **Developer Experience**: LINQ expressions are more natural for .NET developers than explicit stream management
2. **Business Logic Flexibility**: Many real-world business rules span multiple entities and are difficult to express within stream boundaries
3. **Innovation Opportunity**: Whizbang can differentiate itself from existing frameworks
4. **Performance Mitigation**: Query execution overhead can be addressed through caching and optimization
5. **Deterministic Replay**: Storing concrete entity IDs ensures perfect replay regardless of data changes

## Consequences

### Positive Impacts

1. **Simplified Developer Model**
   ```csharp
   // Simple and expressive
   return ProjectionResult.Update<OrderView>(
       where: o => o.CustomerId == customerId && o.Status.In("Pending", "Processing"),
       update: o => o.Priority = "High"
   );
   ```

2. **Cross-Entity Operations**
   ```csharp
   // Update all related orders in one operation
   return ProjectionResult.Update<OrderView>(
       where: o => o.CustomerId == evt.CustomerId,
       update: o => o.CustomerTier = evt.NewTier
   );
   ```

3. **Business Rule Expression**
   ```csharp
   // Complex business rules expressed naturally
   return ProjectionResult.Update<ProductView>(
       where: p => p.Category == "Electronics" && p.Price > 100 && p.Stock < 10,
       update: p => p.RestockAlert = true
   );
   ```

### Negative Impacts

1. **Query Performance Overhead**
   - Each projection update requires query execution
   - Mitigation: Aggressive caching and query optimization

2. **Storage Overhead**
   - Entity ID arrays stored for each operation
   - Mitigation: Compression and efficient serialization

3. **Implementation Complexity**
   - More complex than stream-based approach
   - Requires sophisticated query execution and caching

4. **Unknown Edge Cases**
   - Novel approach may reveal unexpected issues
   - Mitigation: Comprehensive testing and gradual rollout

## Implementation Notes

### Core Components Required:

1. **Where Clause Analyzer**
   ```csharp
   public class WhereClauseAnalyzer {
       public WhereClauseAnalysis Analyze<T>(Expression<Func<T, bool>> whereClause);
   }
   ```

2. **Query Executor**
   ```csharp
   public class QueryExecutor {
       public async Task<long[]> ExecuteWhereClause<T>(Expression<Func<T, bool>> whereClause);
   }
   ```

3. **Operation Storage**
   ```csharp
   public class ExplodedProjectionOperation {
       public long[] AffectedEntityIds { get; set; }
       public byte[] SerializedUpdateAction { get; set; }
       public string OriginalWhereClause { get; set; } // For debugging
   }
   ```

4. **Caching Layer**
   ```csharp
   public class QueryResultCache {
       public async Task<long[]> GetOrExecuteQuery<T>(Expression<Func<T, bool>> whereClause, Func<Task<long[]>> executeQuery);
   }
   ```

### Performance Optimization Strategies:

1. **Query Result Caching**: Cache frequently executed where clauses
2. **Index Optimization**: Ensure database indexes support common where clause patterns
3. **Batch Processing**: Group multiple operations for efficiency
4. **Adaptive Timeouts**: Adjust based on query complexity and historical performance

### Monitoring Requirements:

1. **Query Performance Metrics**: Track execution time and result set sizes
2. **Cache Hit Rates**: Monitor caching effectiveness
3. **Storage Growth**: Track entity ID array storage overhead
4. **Error Rates**: Monitor query failures and edge cases

## Future Considerations

1. **Hybrid Mode**: May add optional stream hints for performance-critical scenarios
2. **Query Optimization**: Advanced query planning and optimization
3. **Cross-Database Support**: Ensure where clause explosion works across different storage engines
4. **Migration Tools**: Provide tools for migrating from stream-based systems

## Comparison with MartenDB

| Aspect | MartenDB (Stream ID) | Whizbang (Where Clause) |
|--------|---------------------|-------------------------|
| **Developer Experience** | Manual stream management | Natural LINQ expressions |
| **Cross-Entity Updates** | Complex sagas required | Simple where clauses |
| **Performance** | O(1) stream lookup | O(n) query execution |
| **Storage** | Minimal overhead | Entity ID array overhead |
| **Replay** | Stream order | Concrete entity IDs |
| **Flexibility** | Limited by streams | Unlimited query expressions |

This decision represents a fundamental architectural choice that differentiates Whizbang from traditional event sourcing frameworks. While it introduces implementation complexity, it provides significant advantages in developer experience and business logic flexibility.