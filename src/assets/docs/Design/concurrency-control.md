---
title: Concurrency Control
category: Architecture & Design
order: 5
tags: concurrency, optimistic-locking, versioning, marten
---

# Concurrency Control

Whizbang provides flexible concurrency control mechanisms to handle concurrent updates to aggregates, supporting multiple strategies that developers can choose globally or per-operation.

## Concurrency Strategies

### A. Expected Version (Default)

**Standard event sourcing pattern** - explicitly specify the expected version:

```csharp
// Load aggregate at version 5
var order = await repository.Load<Order>(orderId);

// Make changes
order.AddItem(new OrderItem("Product", 10.00m));

// Save with expected version - will fail if current version != 5
await repository.Save(order, expectedVersion: 5);
```

**Benefits**:
- ✅ Detects all conflicts
- ✅ Standard event sourcing pattern
- ✅ Explicit and predictable

**Drawbacks**:
- ❌ Requires version tracking
- ❌ Manual conflict resolution

### B. Timestamp-Based (Last-Modified)

**HTTP-style semantics** using timestamps:

```csharp
var order = await repository.Load<Order>(orderId);
var lastModified = order.LastModified;

// Make changes
order.AddItem(new OrderItem("Product", 10.00m));

// Save with timestamp check
await repository.Save(order, ifNotModifiedSince: lastModified);
```

**Benefits**:
- ✅ Familiar HTTP semantics
- ✅ No version number tracking

**Drawbacks**:
- ❌ Clock skew potential
- ❌ Less precise than versions

### C. Automatic Retry with Conflict Resolution

**Smart retry with configurable resolution strategies**:

```csharp
// Configure automatic retry via policies
services.AddWhizbang(options => {
    options.Policies(policies => {
        // Default strategy for all operations
        policies.When(ctx => true)
                .Then(config => config.UseConcurrencyStrategy(ConcurrencyStrategy.AutomaticRetry))
                .And(config => config.SetRetryAttempts(3))
                .And(config => config.SetRetryDelay(TimeSpan.FromMilliseconds(100)));
        
        // Custom conflict resolution for Order aggregates
        policies.When(ctx => ctx.MatchesAggregate<Order>())
                .Then(config => config.SetConflictResolver((current, attempted) => {
                    // Custom merge logic
                    var merged = current.Copy();
                    merged.MergeChanges(attempted);
                    return merged;
                }));
    });
});

// Save with automatic retry
await repository.Save(order); // Retries automatically on conflict
```

**Benefits**:
- ✅ Handles most conflicts automatically
- ✅ Better developer experience
- ✅ Configurable retry policies

**Drawbacks**:
- ❌ Complex to implement
- ❌ Not all conflicts can be auto-resolved

## Marten-Inspired Extensions

Drawing from Marten's concurrency features, Whizbang also supports:

### D. Token-Based Concurrency

**Using opaque tokens** instead of version numbers:

```csharp
var (order, token) = await repository.LoadWithToken<Order>(orderId);

// Make changes
order.AddItem(new OrderItem("Product", 10.00m));

// Save with token
await repository.Save(order, concurrencyToken: token);
```

### E. Revision-Based Tracking

**Marten-style revision tracking** with metadata:

```csharp
public class Order : Aggregate {
    // Whizbang tracks revision automatically
    public int Revision { get; internal set; }
    public DateTime LastModified { get; internal set; }
    public string LastModifiedBy { get; internal set; }
}

await repository.Save(order, expectedRevision: order.Revision);
```

### F. Conditional Updates

**SQL-style conditional updates**:

```csharp
await repository.Save(order, condition: o => o.Status == OrderStatus.Pending);
// Only saves if order is still pending
```

## Policy-Driven Configuration

> **📋 Universal Configuration**: Whizbang uses the [**Policy Engine**](./policy-engine.md) as the universal configuration scoping mechanism. All concurrency strategies, retry policies, and conflict resolution rules are configured through policies rather than direct configuration methods.

### Basic Policy Configuration

**Configure concurrency strategies using the Policy Engine** - the universal configuration scoping mechanism:

```csharp
services.AddWhizbang(options => {
    options.Policies(policies => {
        // Global default strategy
        policies.When(ctx => true)
                .Then(config => config.UseConcurrencyStrategy(ConcurrencyStrategy.ExpectedVersion))
                .And(config => config.SetRetryAttempts(3))
                .And(config => config.SetRetryDelay(TimeSpan.FromMilliseconds(100)));
    });
});
```

### Advanced Policy Scenarios

**Combine multiple conditions for sophisticated concurrency control**:

```csharp
services.AddWhizbang(options => {
    options.Policies(policies => {
        // Orders get automatic retry with more attempts
        policies.When(ctx => ctx.MatchesAggregate<Order>())
                .Then(config => config.UseConcurrencyStrategy(ConcurrencyStrategy.AutomaticRetry))
                .And(config => config.SetRetryAttempts(5)); // Orders get more retries
        
        // Shopping carts use timestamp-based for simplicity
        policies.When(ctx => ctx.MatchesAggregate<ShoppingCart>())
                .Then(config => config.UseConcurrencyStrategy(ConcurrencyStrategy.TimestampBased));
        
        // High-volume commands get automatic retry
        policies.When(ctx => ctx.HasTag("high-volume"))
                .Then(config => config.UseConcurrencyStrategy(ConcurrencyStrategy.AutomaticRetry))
                .And(config => config.SetRetryAttempts(5));
        
        // Load testing uses relaxed concurrency
        policies.When(ctx => ctx.HasFlag(WhizbangFlags.LoadTesting))
                .Then(config => config.UseConcurrencyStrategy(ConcurrencyStrategy.LastWriteWins));
        
        // Environment-based strategies
        policies.When(ctx => ctx.Environment == "production")
                .Then(config => config.UseConcurrencyStrategy(ConcurrencyStrategy.ExpectedVersion))
                .And(config => config.SetRetryAttempts(3));
        
        policies.When(ctx => ctx.Environment == "development")
                .Then(config => config.UseConcurrencyStrategy(ConcurrencyStrategy.LastWriteWins)); // Relaxed for dev
        
        // Tenant-specific strategies
        policies.When(ctx => ctx.TenantId != null && ctx.HasTag("enterprise-tenant"))
                .Then(config => config.UseConcurrencyStrategy(ConcurrencyStrategy.ExpectedVersion))
         .And(config => config.SetRetryAttempts(5))
         .And(config => config.EnableStrictConflictResolution());
    });
});
```

### Runtime Policy Evaluation

**Policies are evaluated at runtime** based on the current context:

```csharp
// Policy evaluation happens automatically during save operations
await repository.Save(order, context => {
    context.WithTag("high-volume");        // Triggers high-volume policy
    context.WithFlag(WhizbangFlags.Production); // Triggers production policy
});

// Context determines which concurrency strategy is used
// No need to manually specify strategy - policies handle it
```

### Manual Override (When Needed)

**Override policies for exceptional cases**:

```csharp
// Explicit override for critical operations
await repository.Save(order, saveOptions => {
    saveOptions.OverrideConcurrencyStrategy(ConcurrencyStrategy.ExpectedVersion);
    saveOptions.SetExpectedVersion(5);
    saveOptions.BypassPolicies(); // Skip policy evaluation
});
```

## Conflict Resolution Strategies

### Built-in Resolvers

```csharp
services.AddWhizbang(options => {
    options.Policies(policies => {
        // Last-write-wins for Order aggregates
        policies.When(ctx => ctx.MatchesAggregate<Order>())
                .Then(config => config.SetConflictResolver(ConflictResolvers.LastWriteWins));
        
        // First-write-wins for Customer aggregates (reject conflicting changes)
        policies.When(ctx => ctx.MatchesAggregate<Customer>())
                .Then(config => config.SetConflictResolver(ConflictResolvers.FirstWriteWins));
        
        // Additive merge for ShoppingCart (combine collections)
        policies.When(ctx => ctx.MatchesAggregate<ShoppingCart>())
                .Then(config => config.SetConflictResolver(ConflictResolvers.AdditiveMerge));
    });
});
```

### Custom Conflict Resolvers via Policies

**Define custom conflict resolution logic through policies**:

```csharp
services.AddWhizbang(options => {
    options.Policies(policies => {
        // Custom resolver for Order aggregates
        policies.When(ctx => ctx.MatchesAggregate<Order>())
                .Then(config => config.SetConflictResolver((current, attempted) => {
                    var resolved = current.Copy();
                    
                    // Merge line items additively
                    foreach (var item in attempted.Items) {
                        if (!resolved.Items.Any(i => i.ProductId == item.ProductId)) {
                            resolved.AddItem(item);
                        }
                    }
                    
                    // Take latest shipping address
                    if (attempted.ShippingAddress != null) {
                        resolved.UpdateShippingAddress(attempted.ShippingAddress);
                    }
                    
                    return resolved;
                }));
    });
});
```

### Advanced Conflict Resolution

**Access full conflict context through policies**:

```csharp
services.AddWhizbang(options => {
    options.Policies(policies => {
        policies.When(ctx => ctx.MatchesAggregate<Order>())
                .Then(config => config.SetConflictResolver((context) => {
                    var current = context.CurrentVersion;
                    var attempted = context.AttemptedVersion;
                    var original = context.OriginalVersion; // Version when load started
                    
                    // Three-way merge using original as base
                    return ThreeWayMerge(original, current, attempted);
                }));
    });
});
});
```

## Implementation Details

### Concurrency Exception Handling

```csharp
public class ConcurrencyException : Exception {
    public string StreamId { get; }
    public int ExpectedVersion { get; }
    public int ActualVersion { get; }
    public Type AggregateType { get; }
    
    public ConcurrencyException(string streamId, int expectedVersion, int actualVersion, Type aggregateType)
        : base($"Concurrency conflict in {aggregateType.Name} stream {streamId}. Expected version {expectedVersion}, but current version is {actualVersion}") {
        StreamId = streamId;
        ExpectedVersion = expectedVersion;
        ActualVersion = actualVersion;
        AggregateType = aggregateType;
    }
}
```

### Retry Logic

```csharp
public class RetryPolicy {
    public int MaxAttempts { get; set; } = 3;
    public TimeSpan InitialDelay { get; set; } = TimeSpan.FromMilliseconds(100);
    public TimeSpan MaxDelay { get; set; } = TimeSpan.FromSeconds(1);
    public double BackoffMultiplier { get; set; } = 2.0;
    public RetryJitter Jitter { get; set; } = RetryJitter.Random;
}

// Example retry sequence:
// Attempt 1: 100ms + random(0-50ms)
// Attempt 2: 200ms + random(0-100ms)  
// Attempt 3: 400ms + random(0-200ms)
```

### Driver Interface

```csharp
public interface IConcurrencyDriver {
    Task<T> Load<T>(string streamId, ConcurrencyOptions options) where T : Aggregate;
    Task<(T Aggregate, ConcurrencyToken Token)> LoadWithToken<T>(string streamId) where T : Aggregate;
    
    Task Save<T>(T aggregate, ConcurrencyCheck check) where T : Aggregate;
    Task<SaveResult> TrySave<T>(T aggregate, ConcurrencyCheck check) where T : Aggregate;
    
    Task<ConflictResolutionResult> ResolveConflict<T>(
        T original, 
        T current, 
        T attempted, 
        ConflictResolver<T> resolver) where T : Aggregate;
}

public class ConcurrencyCheck {
    public ConcurrencyStrategy Strategy { get; set; }
    public int? ExpectedVersion { get; set; }
    public DateTime? IfNotModifiedSince { get; set; }
    public ConcurrencyToken? Token { get; set; }
    public Expression<Func<object, bool>>? Condition { get; set; }
}
```

## Performance Considerations

### Optimizations

1. **Version caching** - Cache current versions to reduce round trips
2. **Batch operations** - Group saves to reduce conflicts
3. **Read replicas** - Load from read replicas to reduce load on primary
4. **Conflict prediction** - Use heuristics to predict likely conflicts

### Monitoring

```csharp
services.AddWhizbang(options => {
    options.UseOptimisticConcurrency(concurrency => {
        concurrency.OnConflict = (context) => {
            // Log conflict for monitoring
            logger.LogWarning("Concurrency conflict in {StreamId}: {Conflict}", 
                context.StreamId, context.ConflictDescription);
            
            // Emit metrics
            metrics.IncrementCounter("whizbang.concurrency.conflicts", 
                new[] { ("aggregate_type", context.AggregateType.Name) });
        };
        
        concurrency.OnRetry = (context) => {
            logger.LogDebug("Retrying save for {StreamId}, attempt {Attempt}", 
                context.StreamId, context.AttemptNumber);
        };
    });
});
```

## Best Practices

### Strategy Selection Guidelines

1. **Expected Version** - Use for critical business operations requiring strict consistency
2. **Timestamp-Based** - Use for user-facing operations where UX matters more than strict consistency
3. **Automatic Retry** - Use for high-contention scenarios with predictable merge strategies
4. **Token-Based** - Use when integrating with external systems that provide tokens
5. **Conditional** - Use for operations that depend on specific business conditions

### Conflict Resolution Guidelines

1. **Keep resolvers fast** - Avoid heavy computation or I/O
2. **Test thoroughly** - Ensure resolvers handle edge cases
3. **Make resolvers deterministic** - Same inputs should produce same outputs
4. **Log conflicts** - Track conflict patterns for optimization
5. **Fallback to exceptions** - Don't resolve conflicts you can't handle safely

---

## Related Documentation

- [**Event Store & Projections**](./event-store-projections.md) - Storage architecture
- [**Domain Ownership**](./domain-ownership.md) - Command routing and ownership
- [**Performance Optimization**](./performance-optimization.md) - Scaling strategies