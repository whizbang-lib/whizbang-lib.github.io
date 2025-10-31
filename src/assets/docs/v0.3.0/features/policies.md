---
title: Stateful Policy Management
version: 0.3.0
category: Features
order: 3
evolves-from: v0.2.0/enhancements/policies.md
evolves-to: v0.5.0/production/policies.md
description: Persistent policy state, metrics, and dynamic configuration
tags: policies, state-management, metrics, monitoring, v0.3.0
---

# Stateful Policy Management

![Version](https://img.shields.io/badge/version-0.3.0-blue)
![Status](https://img.shields.io/badge/status-feature-orange)
![Next Update](https://img.shields.io/badge/next-v0.5.0-yellow)

## Version History

:::updated
**Enhanced in v0.3.0**: 
- Persistent policy state across restarts
- Comprehensive metrics and monitoring
- Dynamic policy reconfiguration
- Policy health checks
:::

:::planned
**Coming in v0.5.0**: 
- Distributed policy coordination
- Policy federation across services
- Advanced analytics and ML-based tuning

[See production features →](../../v0.5.0/production/policies.md)
:::

## State Management

### Persistent Circuit Breakers

:::new
Circuit breaker state survives restarts:
:::

```csharp
// Configure persistent state
services.AddPolicyState(options => {
    options.UseRedis("localhost:6379");
    options.StatePrefix = "whizbang:policies";
    options.StateTTL = TimeSpan.FromHours(24);
});

[CircuitBreaker(
    FailureThreshold = 0.5,
    SamplingDuration = 10,
    StatePersistence = true,  // New in v0.3.0
    StateKey = "order-service-breaker"
)]
public class OrderServiceReceptor : IReceptor<CallOrderService> {
    public async Task<OrderResult> Receive(CallOrderService cmd) {
        // Circuit state persisted to Redis
        // Survives process restarts
        // Shared across instances
        return await CallService(cmd);
    }
}
```

### Stateful Rate Limiting

:::new
Rate limits with persistent token buckets:
:::

```csharp
[RateLimit(
    TokenLimit = 1000,
    Window = TimeSpan.FromHour(1),
    StatePersistence = true,
    StateKey = "api-rate-limit",
    Scope = RateLimitScope.Global  // Across all instances
)]
public class ApiReceptor : IReceptor<ApiCall> { }

// Per-user rate limiting
[RateLimit(
    TokenLimit = 100,
    Window = TimeSpan.FromMinute(1),
    StatePersistence = true,
    StateKeyFactory = context => $"user:{context.UserId}",
    Scope = RateLimitScope.PerIdentity
)]
public class UserApiReceptor : IReceptor<UserApiCall> { }
```

### Cache State Management

:::new
Distributed cache with state tracking:
:::

```csharp
[Cache(
    Duration = 300,
    StateProvider = CacheStateProvider.Redis,
    EvictionPolicy = EvictionPolicy.LRU,
    MaxEntries = 10000,
    TrackHitRate = true  // New in v0.3.0
)]
public class ProductLens : IProductLens {
    public Product Focus(Guid productId) {
        // Cache state includes:
        // - Hit/miss rates
        // - Access patterns
        // - Memory usage
        return LoadProduct(productId);
    }
}
```

## Metrics and Monitoring

### Built-in Metrics

:::new
Comprehensive policy metrics out of the box:
:::

```csharp
// Automatic metrics for all policies
[EnablePolicyMetrics]
public class MonitoredReceptor : IReceptor<Command> { }

// Available metrics:
// - policy.executions.total
// - policy.executions.successful
// - policy.executions.failed
// - policy.duration.p50/p95/p99
// - retry.attempts.total
// - circuitbreaker.state.changes
// - ratelimit.rejections.total
// - cache.hit.rate
// - bulkhead.queue.length
```

### Custom Metrics

```csharp
public class CustomMetricsPolicy : IPolicyOf<IReceptor> {
    private readonly IMetricsCollector _metrics;
    
    public async Task<TResult> Execute<TResult>(
        Func<Task<TResult>> operation,
        IPolicyContext context
    ) {
        using var timer = _metrics.StartTimer("custom.policy.duration");
        
        try {
            var result = await operation();
            _metrics.Increment("custom.policy.success");
            return result;
        }
        catch (Exception ex) {
            _metrics.Increment($"custom.policy.failure.{ex.GetType().Name}");
            throw;
        }
    }
}
```

### Policy Dashboard

:::new
Real-time policy monitoring dashboard:
:::

```csharp
// Enable policy dashboard
services.AddPolicyDashboard(options => {
    options.Path = "/policies";
    options.RefreshInterval = TimeSpan.FromSeconds(5);
    options.ShowDetailedMetrics = true;
});

// Dashboard shows:
// - Policy execution rates
// - Success/failure ratios
// - Circuit breaker states
// - Rate limit utilization
// - Cache efficiency
// - Bulkhead saturation
```

## Dynamic Configuration

### Runtime Policy Updates

:::new
Change policy configuration without restart:
:::

```csharp
public interface IPolicyConfigurator {
    void Configure(string policyName, Action<PolicyBuilder> configure);
    void Disable(string policyName);
    void Enable(string policyName);
    PolicyState GetState(string policyName);
}

// Usage
public class PolicyController {
    private readonly IPolicyConfigurator _configurator;
    
    public void AdjustForLoad(SystemMetrics metrics) {
        if (metrics.CpuUsage > 80) {
            // Tighten rate limits under high load
            _configurator.Configure("ApiRateLimit", policy => {
                policy.UpdateRateLimit(50, TimeSpan.FromSecond(1));
            });
            
            // Reduce circuit breaker sensitivity
            _configurator.Configure("ServiceBreaker", policy => {
                policy.UpdateCircuitBreaker(threshold: 0.7);
            });
        }
    }
    
    public void EmergencyMode() {
        // Disable non-critical policies
        _configurator.Disable("CachePolicy");
        _configurator.Disable("OptimizationPolicy");
        
        // Strengthen critical policies
        _configurator.Configure("SecurityPolicy", policy => {
            policy.AddTimeout(1000);
            policy.AddRetry(5);
        });
    }
}
```

### Configuration Sources

```csharp
// Configuration from various sources
services.AddPolicyConfiguration(options => {
    options.Sources.Add(new JsonFileConfiguration("policies.json"));
    options.Sources.Add(new ConsulConfiguration("consul:8500"));
    options.Sources.Add(new EnvironmentConfiguration());
    options.ReloadOnChange = true;
    options.ReloadInterval = TimeSpan.FromMinutes(1);
});

// policies.json
{
  "policies": {
    "OrderProcessing": {
      "retry": { "attempts": 3, "backoff": "exponential" },
      "timeout": { "duration": 5000 },
      "circuitBreaker": { "threshold": 0.5 }
    }
  }
}
```

## Health Checks

### Policy Health Monitoring

:::new
Built-in health checks for policies:
:::

```csharp
services.AddHealthChecks()
    .AddPolicyHealth("OrderServiceBreaker", options => {
        options.UnhealthyWhenOpen = true;
        options.DegradedWhenHalfOpen = true;
    })
    .AddRateLimitHealth("ApiRateLimit", options => {
        options.UnhealthyUtilization = 0.95;
        options.DegradedUtilization = 0.8;
    })
    .AddCacheHealth("ProductCache", options => {
        options.MinimumHitRate = 0.7;
        options.MaximumMemoryMB = 500;
    });

// Health endpoint returns:
{
  "status": "Degraded",
  "policies": {
    "OrderServiceBreaker": {
      "status": "Healthy",
      "state": "Closed",
      "failureRate": 0.02
    },
    "ApiRateLimit": {
      "status": "Degraded",
      "utilization": 0.82,
      "tokensAvailable": 180
    },
    "ProductCache": {
      "status": "Healthy",
      "hitRate": 0.85,
      "memoryUsageMB": 234
    }
  }
}
```

## State Persistence Options

### Storage Providers

```csharp
// Redis (recommended for production)
services.AddPolicyState(options => {
    options.UseRedis(redis => {
        redis.ConnectionString = "localhost:6379";
        redis.Database = 0;
        redis.KeyPrefix = "whizbang:policies";
    });
});

// SQL Server
services.AddPolicyState(options => {
    options.UseSqlServer(sql => {
        sql.ConnectionString = "...";
        sql.Schema = "policies";
        sql.TablePrefix = "Policy";
    });
});

// In-Memory (for testing)
services.AddPolicyState(options => {
    options.UseInMemory();
});

// Custom provider
services.AddPolicyState(options => {
    options.UseCustom<MyStateProvider>();
});
```

## Testing Stateful Policies

```csharp
[Test]
public class StatefulPolicyTests {
    [Test]
    public async Task CircuitBreaker_StateShouldPersist() {
        // Arrange
        var stateProvider = new InMemoryStateProvider();
        var breaker = new CircuitBreakerPolicy(
            threshold: 0.5,
            stateProvider: stateProvider,
            stateKey: "test-breaker"
        );
        
        // Act - cause failures to open circuit
        for (int i = 0; i < 5; i++) {
            try {
                await breaker.Execute(() => throw new Exception(), new PolicyContext());
            } catch { }
        }
        
        // Create new instance with same state
        var breaker2 = new CircuitBreakerPolicy(
            threshold: 0.5,
            stateProvider: stateProvider,
            stateKey: "test-breaker"
        );
        
        // Assert - state persisted
        Assert.Equal(CircuitState.Open, breaker2.State);
    }
    
    [Test]
    public async Task Metrics_ShouldTrackExecution() {
        // Test metrics collection
    }
}
```

## Performance Impact

| Feature | Overhead | Notes |
|---------|----------|-------|
| State Persistence | < 5ms | Redis latency |
| Metrics Collection | < 100ns | In-memory counters |
| Health Checks | < 1ms | Cached for 1 second |
| Dynamic Config | < 10ms | Config reload time |

## Migration from v0.2.0

### New Requirements

- Redis or SQL Server for state persistence
- Metrics sink (Prometheus, AppInsights, etc.)
- Health check endpoint configuration

### Configuration Changes

```csharp
// v0.2.0
[CircuitBreaker(0.5, 10, 5, 30)]

// v0.3.0 - Add state persistence
[CircuitBreaker(
    FailureThreshold = 0.5,
    SamplingDuration = 10,
    MinimumThroughput = 5,
    BreakDuration = 30,
    StatePersistence = true,
    StateKey = "my-breaker"
)]
```

## Related Documentation

- [v0.2.0 Enhancements](../../v0.2.0/enhancements/policies.md) - Policy composition
- [v0.5.0 Production](../../v0.5.0/production/policies.md) - Distributed coordination
- [Monitoring Guide](../guides/policy-monitoring.md) - Setting up dashboards
- [State Management](../guides/state-management.md) - Persistence strategies