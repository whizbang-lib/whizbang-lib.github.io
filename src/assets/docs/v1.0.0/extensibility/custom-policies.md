---
title: Custom Policies
version: 1.0.0
category: Extensibility
order: 5
description: >-
  Advanced policy patterns - weighted policies, dynamic registration, async
  evaluation, caching, and A/B testing
tags: >-
  policies, custom-policy-engine, weighted-policies, async-policies,
  policy-caching
codeReferences:
  - src/Whizbang.Core/Policies/IPolicyEngine.cs
  - src/Whizbang.Core/Policies/PolicyEngine.cs
  - src/Whizbang.Core/Policies/PolicyConfiguration.cs
---

# Custom Policies

**Custom policies** extend the basic policy system with advanced patterns like weighted evaluation, priority-based matching, async predicates (database lookups), dynamic registration, caching, and A/B testing.

:::note
For basic policy usage, see [Policy-Based Routing](../infrastructure/policies.md). This guide focuses on **advanced policy extensibility**.
:::

---

## Why Custom Policy Patterns?

**Built-in PolicyEngine uses first-match evaluation**, but some scenarios benefit from custom patterns:

| Scenario | Standard PolicyEngine | Custom Pattern |
|----------|----------------------|----------------|
| **First-Match Evaluation** | ✅ Perfect fit | No customization needed |
| **Weighted/Priority Policies** | ❌ No priorities | ✅ Weighted policy engine |
| **Async Predicates** | ❌ Sync only | ✅ Async policy engine |
| **Policy Caching** | ❌ Evaluate every time | ✅ Cached policy results |
| **Dynamic Registration** | ❌ Static at startup | ✅ Runtime policy updates |
| **A/B Testing** | ❌ No traffic splitting | ✅ Percentage-based routing |

**When to customize**:
- ✅ Complex policy priority/weighting
- ✅ Async predicates (database, API calls)
- ✅ Dynamic policy updates (feature flags)
- ✅ High-frequency evaluation (caching needed)
- ✅ A/B testing / canary deployments

---

## Weighted Policy Engine

### Pattern 1: Priority-Based Evaluation

**Use Case**: Policies have explicit priorities instead of first-match.

```csharp
using Whizbang.Core.Policies;

public class WeightedPolicyEngine : IPolicyEngine {
  private readonly List<WeightedPolicy> _policies = [];
  private readonly ILogger<WeightedPolicyEngine> _logger;

  public WeightedPolicyEngine(ILogger<WeightedPolicyEngine> logger) {
    _logger = logger;
  }

  public void AddPolicy(
    string name,
    Func<PolicyContext, bool> predicate,
    Action<PolicyConfiguration> configure,
    int priority = 0  // ← Custom parameter
  ) {
    _policies.Add(new WeightedPolicy {
      Name = name,
      Predicate = predicate,
      Configure = configure,
      Priority = priority
    });

    // Sort by priority (highest first)
    _policies.Sort((a, b) => b.Priority.CompareTo(a.Priority));

    _logger.LogDebug(
      "Added policy {PolicyName} with priority {Priority}",
      name,
      priority
    );
  }

  // Standard AddPolicy delegates to weighted version
  void IPolicyEngine.AddPolicy(
    string name,
    Func<PolicyContext, bool> predicate,
    Action<PolicyConfiguration> configure
  ) {
    AddPolicy(name, predicate, configure, priority: 0);
  }

  public async Task<PolicyConfiguration?> MatchAsync(PolicyContext context) {
    foreach (var policy in _policies) {  // Ordered by priority
      try {
        if (policy.Predicate(context)) {
          var config = new PolicyConfiguration();
          policy.Configure(config);

          context.Trail.RecordDecision(
            policyName: policy.Name,
            rule: $"Priority: {policy.Priority}",
            matched: true,
            configuration: config,
            reason: $"Matched with priority {policy.Priority}"
          );

          return config;
        }

      } catch (Exception ex) {
        context.Trail.RecordDecision(
          policyName: policy.Name,
          rule: $"Priority: {policy.Priority}",
          matched: false,
          configuration: null,
          reason: $"Evaluation failed: {ex.Message}"
        );
      }
    }

    return null;  // No match
  }

  private class WeightedPolicy {
    public required string Name { get; init; }
    public required Func<PolicyContext, bool> Predicate { get; init; }
    public required Action<PolicyConfiguration> Configure { get; init; }
    public int Priority { get; init; }
  }
}
```

**Usage**:
```csharp
var engine = new WeightedPolicyEngine(logger);

// High-priority tenant routing (priority 100)
engine.AddPolicy(
  name: "PremiumTenantRouting",
  predicate: ctx => ctx.GetMetadata("tier")?.ToString() == "premium",
  configure: config => config.PublishToServiceBus("premium-events"),
  priority: 100  // ← Evaluated first
);

// Medium-priority standard routing (priority 50)
engine.AddPolicy(
  name: "StandardRouting",
  predicate: ctx => true,
  configure: config => config.PublishToServiceBus("standard-events"),
  priority: 50
);

// Evaluation: PremiumTenantRouting checked first (higher priority)
```

---

## Async Policy Engine

### Pattern 2: Async Predicate Evaluation

**Use Case**: Predicates need database lookups, API calls, feature flags.

```csharp
using Whizbang.Core.Policies;

public class AsyncPolicyEngine : IPolicyEngine {
  private readonly List<AsyncPolicy> _policies = [];
  private readonly ILogger<AsyncPolicyEngine> _logger;

  public AsyncPolicyEngine(ILogger<AsyncPolicyEngine> logger) {
    _logger = logger;
  }

  /// <summary>
  /// Add async policy with async predicate.
  /// </summary>
  public void AddAsyncPolicy(
    string name,
    Func<PolicyContext, CancellationToken, Task<bool>> asyncPredicate,
    Action<PolicyConfiguration> configure
  ) {
    _policies.Add(new AsyncPolicy {
      Name = name,
      AsyncPredicate = asyncPredicate,
      Configure = configure
    });
  }

  // Standard AddPolicy wraps sync predicate in async
  void IPolicyEngine.AddPolicy(
    string name,
    Func<PolicyContext, bool> predicate,
    Action<PolicyConfiguration> configure
  ) {
    AddAsyncPolicy(
      name,
      asyncPredicate: (ctx, ct) => Task.FromResult(predicate(ctx)),
      configure
    );
  }

  public async Task<PolicyConfiguration?> MatchAsync(
    PolicyContext context,
    CancellationToken ct = default
  ) {
    foreach (var policy in _policies) {
      try {
        if (await policy.AsyncPredicate(context, ct)) {
          var config = new PolicyConfiguration();
          policy.Configure(config);

          context.Trail.RecordDecision(
            policyName: policy.Name,
            rule: "Async evaluation",
            matched: true,
            configuration: config,
            reason: "Async predicate matched"
          );

          return config;
        }

      } catch (Exception ex) {
        context.Trail.RecordDecision(
          policyName: policy.Name,
          rule: "Async evaluation",
          matched: false,
          configuration: null,
          reason: $"Async evaluation failed: {ex.Message}"
        );
      }
    }

    return null;
  }

  // Overload standard MatchAsync
  Task<PolicyConfiguration?> IPolicyEngine.MatchAsync(PolicyContext context) =>
    MatchAsync(context, CancellationToken.None);

  private class AsyncPolicy {
    public required string Name { get; init; }
    public required Func<PolicyContext, CancellationToken, Task<bool>> AsyncPredicate { get; init; }
    public required Action<PolicyConfiguration> Configure { get; init; }
  }
}
```

**Usage**:
```csharp
var engine = new AsyncPolicyEngine(logger);

// Async predicate: lookup feature flag from database
engine.AddAsyncPolicy(
  name: "FeatureFlagRouting",
  asyncPredicate: async (ctx, ct) => {
    var featureService = ctx.GetService<IFeatureFlagService>();
    return await featureService.IsEnabledAsync("new-routing", ct);
  },
  configure: config => config.PublishToServiceBus("new-events")
);

// Async predicate: lookup tenant configuration
engine.AddAsyncPolicy(
  name: "TenantConfigRouting",
  asyncPredicate: async (ctx, ct) => {
    var tenantId = ctx.GetMetadata("tenantId")?.ToString();
    if (tenantId is null) return false;

    var tenantService = ctx.GetService<ITenantService>();
    var tenant = await tenantService.GetTenantAsync(tenantId, ct);

    return tenant?.IsActive == true;
  },
  configure: config => config.PublishToServiceBus("active-tenant-events")
);
```

---

## Cached Policy Engine

### Pattern 3: Policy Result Caching

**Use Case**: Reduce policy evaluation overhead for high-frequency messages.

```csharp
using Whizbang.Core.Policies;
using Microsoft.Extensions.Caching.Memory;

public class CachedPolicyEngine : IPolicyEngine {
  private readonly IPolicyEngine _innerEngine;
  private readonly IMemoryCache _cache;
  private readonly ILogger<CachedPolicyEngine> _logger;

  private static readonly MemoryCacheEntryOptions CacheOptions = new() {
    AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5),
    SlidingExpiration = TimeSpan.FromMinutes(1)
  };

  public CachedPolicyEngine(
    IPolicyEngine innerEngine,
    IMemoryCache cache,
    ILogger<CachedPolicyEngine> logger
  ) {
    _innerEngine = innerEngine;
    _cache = cache;
    _logger = logger;
  }

  void IPolicyEngine.AddPolicy(
    string name,
    Func<PolicyContext, bool> predicate,
    Action<PolicyConfiguration> configure
  ) {
    _innerEngine.AddPolicy(name, predicate, configure);
  }

  public async Task<PolicyConfiguration?> MatchAsync(PolicyContext context) {
    // Generate cache key from context
    var cacheKey = GenerateCacheKey(context);

    // Try cache first
    if (_cache.TryGetValue(cacheKey, out PolicyConfiguration? cached)) {
      _logger.LogDebug(
        "Policy cache hit for key {CacheKey}",
        cacheKey
      );
      return cached;
    }

    // Cache miss - evaluate policies
    _logger.LogDebug(
      "Policy cache miss for key {CacheKey}, evaluating policies",
      cacheKey
    );

    var config = await _innerEngine.MatchAsync(context);

    // Cache result (including null)
    _cache.Set(cacheKey, config, CacheOptions);

    return config;
  }

  private static string GenerateCacheKey(PolicyContext context) {
    // Cache key based on message type + metadata
    var tenantId = context.GetMetadata("tenantId")?.ToString() ?? "default";
    var environment = context.Environment;
    var messageType = context.MessageType.Name;

    return $"policy:{messageType}:{tenantId}:{environment}";
  }

  /// <summary>
  /// Clear policy cache (e.g., after policy updates).
  /// </summary>
  public void ClearCache() {
    if (_cache is MemoryCache memoryCache) {
      memoryCache.Compact(1.0);  // Remove 100% of entries
      _logger.LogInformation("Policy cache cleared");
    }
  }
}
```

**Usage**:
```csharp
var baseEngine = new PolicyEngine();
var cachedEngine = new CachedPolicyEngine(baseEngine, memoryCache, logger);

// Add policies to base engine
baseEngine.AddPolicy(...);

// Use cached engine - first call evaluates, subsequent calls use cache
var config1 = await cachedEngine.MatchAsync(context);  // Cache miss - evaluate
var config2 = await cachedEngine.MatchAsync(context);  // Cache hit - instant

// Clear cache after policy updates
cachedEngine.ClearCache();
```

**Performance**:
- **Cache Hit**: ~1µs (memory lookup)
- **Cache Miss**: ~100µs (full evaluation)
- **Improvement**: ~100x for cached scenarios

---

## Dynamic Policy Registration

### Pattern 4: Runtime Policy Updates

**Use Case**: Add/remove policies at runtime based on feature flags, tenant config.

```csharp
using Whizbang.Core.Policies;

public class DynamicPolicyEngine : IPolicyEngine {
  private readonly List<Policy> _policies = [];
  private readonly ReaderWriterLockSlim _lock = new();
  private readonly ILogger<DynamicPolicyEngine> _logger;

  public DynamicPolicyEngine(ILogger<DynamicPolicyEngine> logger) {
    _logger = logger;
  }

  void IPolicyEngine.AddPolicy(
    string name,
    Func<PolicyContext, bool> predicate,
    Action<PolicyConfiguration> configure
  ) {
    _lock.EnterWriteLock();
    try {
      _policies.Add(new Policy {
        Name = name,
        Predicate = predicate,
        Configure = configure
      });

      _logger.LogInformation("Added policy {PolicyName}", name);
    } finally {
      _lock.ExitWriteLock();
    }
  }

  /// <summary>
  /// Remove policy by name (custom method).
  /// </summary>
  public bool RemovePolicy(string name) {
    _lock.EnterWriteLock();
    try {
      var removed = _policies.RemoveAll(p => p.Name == name);

      if (removed > 0) {
        _logger.LogInformation("Removed policy {PolicyName}", name);
        return true;
      }

      return false;
    } finally {
      _lock.ExitWriteLock();
    }
  }

  public async Task<PolicyConfiguration?> MatchAsync(PolicyContext context) {
    _lock.EnterReadLock();
    try {
      foreach (var policy in _policies) {
        try {
          if (policy.Predicate(context)) {
            var config = new PolicyConfiguration();
            policy.Configure(config);
            return config;
          }
        } catch (Exception ex) {
          _logger.LogWarning(
            ex,
            "Policy {PolicyName} evaluation failed",
            policy.Name
          );
        }
      }

      return null;
    } finally {
      _lock.ExitReadLock();
    }
  }

  private class Policy {
    public required string Name { get; init; }
    public required Func<PolicyContext, bool> Predicate { get; init; }
    public required Action<PolicyConfiguration> Configure { get; init; }
  }
}
```

**Usage**:
```csharp
var engine = new DynamicPolicyEngine(logger);

// Add initial policies
engine.AddPolicy("DefaultRouting", ctx => true, config => config.PublishToServiceBus("default"));

// Runtime: Add tenant-specific policy when tenant onboards
await OnTenantOnboardedAsync(tenantId: "tenant-a");

public async Task OnTenantOnboardedAsync(string tenantId) {
  engine.AddPolicy(
    name: $"Tenant{tenantId}Routing",
    predicate: ctx => ctx.GetMetadata("tenantId")?.ToString() == tenantId,
    configure: config => config.PublishToServiceBus($"{tenantId}-events")
  );
}

// Runtime: Remove policy when tenant offboards
await OnTenantOffboardedAsync(tenantId: "tenant-a");

public async Task OnTenantOffboardedAsync(string tenantId) {
  engine.RemovePolicy($"Tenant{tenantId}Routing");
}
```

---

## A/B Testing Policy Engine

### Pattern 5: Percentage-Based Traffic Splitting

**Use Case**: Route X% of traffic to new feature for canary/gradual rollout.

```csharp
using Whizbang.Core.Policies;

public class ABTestingPolicyEngine : IPolicyEngine {
  private readonly IPolicyEngine _innerEngine;
  private readonly ILogger<ABTestingPolicyEngine> _logger;
  private readonly Dictionary<string, ABTestConfig> _abTests = [];

  public ABTestingPolicyEngine(
    IPolicyEngine innerEngine,
    ILogger<ABTestingPolicyEngine> logger
  ) {
    _innerEngine = innerEngine;
    _logger = logger;
  }

  /// <summary>
  /// Configure A/B test: route percentage of traffic to variant.
  /// </summary>
  public void ConfigureABTest(
    string testName,
    double percentageToVariant,  // 0.0 - 100.0
    Action<PolicyConfiguration> variantConfig,
    Action<PolicyConfiguration> controlConfig
  ) {
    _abTests[testName] = new ABTestConfig {
      TestName = testName,
      PercentageToVariant = percentageToVariant,
      VariantConfig = variantConfig,
      ControlConfig = controlConfig
    };

    _logger.LogInformation(
      "Configured A/B test {TestName}: {Percentage}% to variant",
      testName,
      percentageToVariant
    );
  }

  void IPolicyEngine.AddPolicy(
    string name,
    Func<PolicyContext, bool> predicate,
    Action<PolicyConfiguration> configure
  ) {
    _innerEngine.AddPolicy(name, predicate, configure);
  }

  public async Task<PolicyConfiguration?> MatchAsync(PolicyContext context) {
    // Check if message participates in A/B test
    var testName = context.GetMetadata("abTestName")?.ToString();

    if (testName != null && _abTests.TryGetValue(testName, out var abTest)) {
      // Determine variant via consistent hashing (same message → same variant)
      var messageId = context.Envelope?.MessageId.Value.ToString() ?? Guid.NewGuid().ToString();
      var hash = Math.Abs(messageId.GetHashCode());
      var percentage = (hash % 100);  // 0-99

      bool isVariant = percentage < abTest.PercentageToVariant;

      var config = new PolicyConfiguration();
      if (isVariant) {
        abTest.VariantConfig(config);
        _logger.LogDebug(
          "A/B test {TestName}: Routed to VARIANT (hash {Hash}%)",
          testName,
          percentage
        );
      } else {
        abTest.ControlConfig(config);
        _logger.LogDebug(
          "A/B test {TestName}: Routed to CONTROL (hash {Hash}%)",
          testName,
          percentage
        );
      }

      return config;
    }

    // No A/B test - use standard policy evaluation
    return await _innerEngine.MatchAsync(context);
  }

  private class ABTestConfig {
    public required string TestName { get; init; }
    public double PercentageToVariant { get; init; }
    public required Action<PolicyConfiguration> VariantConfig { get; init; }
    public required Action<PolicyConfiguration> ControlConfig { get; init; }
  }
}
```

**Usage**:
```csharp
var baseEngine = new PolicyEngine();
var abEngine = new ABTestingPolicyEngine(baseEngine, logger);

// Configure A/B test: 10% to new routing, 90% to old routing
abEngine.ConfigureABTest(
  testName: "new-routing-experiment",
  percentageToVariant: 10.0,
  variantConfig: config => config.PublishToServiceBus("new-events"),  // 10%
  controlConfig: config => config.PublishToServiceBus("old-events")   // 90%
);

// Messages with abTestName metadata participate in A/B test
var context = PolicyContextPool.Rent(
  message: message,
  envelope: envelope,
  services: services,
  environment: "production"
);

// Add A/B test metadata
context.Envelope.Metadata["abTestName"] = "new-routing-experiment";

// Evaluation: 10% → new-events, 90% → old-events (consistent per message ID)
var config = await abEngine.MatchAsync(context);
```

---

## Testing Custom Policies

### Testing Weighted Policies

```csharp
public class WeightedPolicyEngineTests {
  [Test]
  public async Task MatchAsync_HighPriorityMatchesFirst_SkipsLowerPriorityAsync() {
    // Arrange
    var logger = new NullLogger<WeightedPolicyEngine>();
    var engine = new WeightedPolicyEngine(logger);

    engine.AddPolicy(
      name: "LowPriority",
      predicate: ctx => true,  // Would match
      configure: config => config.PublishToServiceBus("low"),
      priority: 10
    );

    engine.AddPolicy(
      name: "HighPriority",
      predicate: ctx => true,  // Matches first
      configure: config => config.PublishToServiceBus("high"),
      priority: 100
    );

    var context = new PolicyContext(new TestMessage(), null, null, "test");

    // Act
    var result = await engine.MatchAsync(context);

    // Assert - HighPriority matched (higher priority)
    await Assert.That(result).IsNotNull();
    await Assert.That(result!.PublishTargets[0].Destination).IsEqualTo("high");
  }
}
```

### Testing Async Policies

```csharp
public class AsyncPolicyEngineTests {
  [Test]
  public async Task MatchAsync_AsyncPredicate_CallsDatabaseAsync() {
    // Arrange
    var logger = new NullLogger<AsyncPolicyEngine>();
    var engine = new AsyncPolicyEngine(logger);

    var dbCallCount = 0;

    engine.AddAsyncPolicy(
      name: "DatabasePolicy",
      asyncPredicate: async (ctx, ct) => {
        dbCallCount++;  // Track async call
        await Task.Delay(10, ct);  // Simulate database
        return true;
      },
      configure: config => config.PublishToServiceBus("test")
    );

    var context = new PolicyContext(new TestMessage(), null, null, "test");

    // Act
    var result = await engine.MatchAsync(context);

    // Assert - Async predicate executed
    await Assert.That(result).IsNotNull();
    await Assert.That(dbCallCount).IsEqualTo(1);
  }
}
```

### Testing Cached Policies

```csharp
public class CachedPolicyEngineTests {
  [Test]
  public async Task MatchAsync_SecondCall_UsesCacheAsync() {
    // Arrange
    var baseEngine = new PolicyEngine();
    var memoryCache = new MemoryCache(new MemoryCacheOptions());
    var logger = new NullLogger<CachedPolicyEngine>();
    var cachedEngine = new CachedPolicyEngine(baseEngine, memoryCache, logger);

    var evaluationCount = 0;

    baseEngine.AddPolicy(
      name: "TestPolicy",
      predicate: ctx => {
        evaluationCount++;  // Track evaluations
        return true;
      },
      configure: config => config.PublishToServiceBus("test")
    );

    var context = new PolicyContext(new TestMessage(), null, null, "test");

    // Act - First call (cache miss)
    var result1 = await cachedEngine.MatchAsync(context);

    // Act - Second call (cache hit)
    var result2 = await cachedEngine.MatchAsync(context);

    // Assert - Only evaluated once (cached)
    await Assert.That(result1).IsNotNull();
    await Assert.That(result2).IsNotNull();
    await Assert.That(evaluationCount).IsEqualTo(1);  // Not 2!
  }
}
```

---

## Best Practices

### DO ✅

- ✅ **Wrap base PolicyEngine** for compatibility
- ✅ **Use thread-safe collections** for dynamic policies
- ✅ **Cache policy results** for high-frequency scenarios
- ✅ **Log policy decisions** via PolicyDecisionTrail
- ✅ **Test async predicates** with real dependencies
- ✅ **Clear cache after updates** (dynamic policies)
- ✅ **Use consistent hashing** for A/B tests

### DON'T ❌

- ❌ Block async operations in predicates
- ❌ Throw exceptions from predicates (caught and logged)
- ❌ Cache results with tenant-specific data (isolation issue)
- ❌ Skip thread safety for dynamic policies
- ❌ Use reflection in predicates (breaks AOT)
- ❌ Forget to invalidate cache after policy changes

---

## Further Reading

**Infrastructure**:
- [Policy-Based Routing](../infrastructure/policies.md) - Basic policy usage
- [Object Pooling](../infrastructure/pooling.md) - PolicyContext pooling

**Core Concepts**:
- [Message Context](../core-concepts/message-context.md) - Envelope metadata

**Advanced**:
- [Multi-Tenancy](../advanced/multi-tenancy.md) - Tenant isolation patterns
- [Performance Tuning](../advanced/performance-tuning.md) - Optimization strategies

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
