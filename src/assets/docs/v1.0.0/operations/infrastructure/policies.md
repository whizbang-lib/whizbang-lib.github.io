---
title: Policy-Based Routing
version: 1.0.0
category: Infrastructure
order: 4
description: >-
  Dynamic message routing and configuration via predicate-based policies -
  multi-tenancy, environment-based routing, and execution strategies
tags: >-
  policies, routing, multi-tenancy, execution-strategy, policy-engine,
  decision-trail
codeReferences:
  - src/Whizbang.Core/Policies/PolicyEngine.cs
  - src/Whizbang.Core/Policies/PolicyContext.cs
  - src/Whizbang.Core/Policies/PolicyDecisionTrail.cs
  - src/Whizbang.Core/Policies/PolicyConfiguration.cs
---

# Policy-Based Routing

**Policy-based routing** enables dynamic message configuration based on runtime conditions. Policies evaluate message context (type, aggregate ID, tenant, environment) and return routing configuration (topics, execution strategies, partitioning) without hardcoding business logic into handlers.

## Why Policies?

**Policies decouple routing decisions from business logic**:

| Without Policies | With Policies | Benefit |
|------------------|---------------|---------|
| **Hardcoded Routes** | Dynamic predicates | Flexible configuration |
| **If/Else Chains** | First-match evaluation | Clean code |
| **Per-Handler Config** | Centralized policy engine | Single source of truth |
| **No Audit Trail** | PolicyDecisionTrail | Full observability |
| **Multi-Tenant Logic Scattered** | Tenant-based policies | Centralized multi-tenancy |

**Use Cases**:
- ✅ **Multi-Tenancy** - Route messages to tenant-specific topics/databases
- ✅ **Environment-Based Routing** - Different config for dev/staging/prod
- ✅ **Aggregate-Based Partitioning** - Route by OrderId, CustomerId, etc.
- ✅ **Execution Strategies** - Serial vs parallel based on message type
- ✅ **Feature Flags** - Enable/disable routing based on tags/metadata

---

## Architecture

### Policy Evaluation Flow

```
┌────────────────────────────────────────────────────────┐
│  Message Processing                                    │
│                                                         │
│  1. Rent PolicyContext from pool                       │
│     context = PolicyContextPool.Rent(message, ...)     │
│                                                         │
│  2. Evaluate policies                                  │
│     config = await policyEngine.MatchAsync(context)    │
│                                                         │
│  3. Use configuration                                  │
│     - Topic routing                                    │
│     - Execution strategy                               │
│     - Partitioning                                     │
│     - Concurrency                                      │
└────────────────────────────────────────────────────────┘

PolicyEngine Evaluation:

┌────────────────────────────────────────────────────────┐
│  PolicyEngine.MatchAsync(context)                      │
│                                                         │
│  Policies evaluated in order (first match wins):       │
│  ├─ Policy 1: TenantRouting                            │
│  │  ├─ Predicate: context.GetMetadata("tenantId") == "tenant-a"
│  │  ├─ Matched: ✅                                     │
│  │  └─ Configuration: Topic = "tenant-a-events"        │
│  │                                                      │
│  │  ⭐ RETURN (first match - skip remaining policies)  │
│  │                                                      │
│  ├─ Policy 2: EnvironmentRouting (skipped)             │
│  └─ Policy 3: DefaultRouting (skipped)                 │
└────────────────────────────────────────────────────────┘

PolicyDecisionTrail (Observability):

┌────────────────────────────────────────────────────────┐
│  context.Trail.Decisions                               │
│                                                         │
│  [0] PolicyName: "TenantRouting"                       │
│      Rule: "tenantId == tenant-a"                      │
│      Matched: ✅                                       │
│      Configuration: { Topic: "tenant-a-events" }       │
│      Reason: "Tenant-based routing matched"            │
│      Timestamp: 2024-12-12T10:30:45Z                   │
│                                                         │
│  [1] PolicyName: "EnvironmentRouting"                  │
│      Rule: "environment == production"                 │
│      Matched: ❌                                       │
│      Reason: "Environment is development"              │
│      Timestamp: 2024-12-12T10:30:45Z                   │
└────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. PolicyEngine

**Purpose**: Evaluates policies in order, returns first match.

**Registration**:
```csharp
builder.Services.AddSingleton<IPolicyEngine, PolicyEngine>();
```

**Usage**:
```csharp
var policyEngine = new PolicyEngine();

// Add policies (evaluated in order)
policyEngine.AddPolicy(
  name: "TenantRouting",
  predicate: context =>
    context.GetMetadata("tenantId")?.ToString() == "tenant-a",
  configure: config =>
    config.PublishToServiceBus("tenant-a-events")
);

policyEngine.AddPolicy(
  name: "DefaultRouting",
  predicate: context => true,  // Always matches (fallback)
  configure: config =>
    config.PublishToServiceBus("default-events")
);

// Evaluate policies
var config = await policyEngine.MatchAsync(context);
```

**Evaluation Rules**:
- Policies evaluated in registration order
- First matched policy returns configuration
- Subsequent policies skipped
- If no policies match, returns `null`

### 2. PolicyContext

**Purpose**: Universal context with message, envelope, services, environment.

**Properties**:
```csharp
public class PolicyContext {
  public object Message { get; }              // The message being processed
  public Type MessageType { get; }            // Runtime type of message
  public IMessageEnvelope? Envelope { get; }  // Envelope with metadata
  public IServiceProvider? Services { get; }  // DI container
  public string Environment { get; }          // "development", "production", etc.
  public DateTimeOffset ExecutionTime { get; } // When processing started
  public PolicyDecisionTrail Trail { get; }   // Decision audit trail
}
```

**Helper Methods**:
```csharp
// Service resolution
var repository = context.GetService<IOrderRepository>();

// Metadata access
var tenantId = context.GetMetadata("tenantId");
var hasHighPriority = context.HasTag("high-priority");
var isUrgent = context.HasFlag(MessageFlags.Urgent);

// Aggregate matching
bool isOrderMessage = context.MatchesAggregate<Order>();

// Aggregate ID extraction (zero reflection)
var orderId = context.GetAggregateId();  // Requires [AggregateId] attribute
```

**Pooling**:
```csharp
// Rent from pool
var context = PolicyContextPool.Rent(message, envelope, services, "production");

try {
  var config = await policyEngine.MatchAsync(context);
  // Use config...
} finally {
  // Always return to pool
  PolicyContextPool.Return(context);
}
```

### 3. PolicyDecisionTrail

**Purpose**: Records all policy decisions for debugging and time-travel.

**Usage**:
```csharp
// Automatic recording by PolicyEngine
context.Trail.RecordDecision(
  policyName: "TenantRouting",
  rule: "tenantId == tenant-a",
  matched: true,
  configuration: config,
  reason: "Tenant-based routing matched"
);

// Query trail
var matchedPolicies = context.Trail.GetMatchedRules();
var unmatchedPolicies = context.Trail.GetUnmatchedRules();

foreach (var decision in context.Trail.Decisions) {
  Console.WriteLine($"{decision.PolicyName}: {decision.Matched} - {decision.Reason}");
}
```

**Benefits**:
- **Debugging**: See why specific configuration was applied
- **Auditing**: Track policy decisions over time
- **Time-Travel**: Replay message processing with decision history

### 4. PolicyConfiguration

**Purpose**: Routing and execution configuration returned by matched policy.

**Properties**:
```csharp
public class PolicyConfiguration {
  // Publishing (outbound)
  public List<PublishTarget> PublishTargets { get; }

  // Subscribing (inbound)
  public List<SubscriptionTarget> SubscriptionTargets { get; }

  // Stream configuration
  public string? Topic { get; }
  public string? StreamKey { get; }

  // Execution strategy
  public Type? ExecutionStrategyType { get; }
  public Type? PartitionRouterType { get; }
  public int? PartitionCount { get; }
  public int? MaxConcurrency { get; }

  // Persistence size limits
  public int? MaxDataSizeBytes { get; }
  public bool SuppressSizeWarnings { get; }
  public bool ThrowOnSizeExceeded { get; }
}
```

**Fluent API**:
```csharp
configure: config => config
  .PublishToServiceBus("order-events")
  .UseStreamKey("order-{aggregateId}")
  .UseExecutionStrategy<SerialExecutor>()
  .UsePartitionRouter<HashPartitionRouter>()
  .WithPartitions(count: 100)
  .WithConcurrency(maxConcurrency: 10)
  .WithPersistenceSize(maxDataSizeBytes: 7000, throwOnExceeded: true)
```

---

## Common Policies

### 1. Multi-Tenant Routing

```csharp
policyEngine.AddPolicy(
  name: "TenantARouting",
  predicate: context =>
    context.GetMetadata("tenantId")?.ToString() == "tenant-a",
  configure: config => config
    .PublishToServiceBus("tenant-a-events")
    .UseStreamKey("tenant-a-{aggregateId}")
);

policyEngine.AddPolicy(
  name: "TenantBRouting",
  predicate: context =>
    context.GetMetadata("tenantId")?.ToString() == "tenant-b",
  configure: config => config
    .PublishToServiceBus("tenant-b-events")
    .UseStreamKey("tenant-b-{aggregateId}")
);

// Fallback for unknown tenants
policyEngine.AddPolicy(
  name: "DefaultTenantRouting",
  predicate: context => true,
  configure: config => config
    .PublishToServiceBus("default-events")
);
```

### 2. Environment-Based Routing

```csharp
policyEngine.AddPolicy(
  name: "ProductionRouting",
  predicate: context => context.Environment == "production",
  configure: config => config
    .PublishToServiceBus("prod-events")
    .WithConcurrency(maxConcurrency: 50)
);

policyEngine.AddPolicy(
  name: "StagingRouting",
  predicate: context => context.Environment == "staging",
  configure: config => config
    .PublishToServiceBus("staging-events")
    .WithConcurrency(maxConcurrency: 10)
);

policyEngine.AddPolicy(
  name: "DevelopmentRouting",
  predicate: context => context.Environment == "development",
  configure: config => config
    .PublishToServiceBus("dev-events")
    .WithConcurrency(maxConcurrency: 1)  // Serial processing in dev
);
```

### 3. Aggregate-Based Partitioning

```csharp
policyEngine.AddPolicy(
  name: "OrderPartitioning",
  predicate: context => context.MatchesAggregate<Order>(),
  configure: config => config
    .UseStreamKey("order-{aggregateId}")
    .UsePartitionRouter<HashPartitionRouter>()
    .WithPartitions(count: 100)
);

policyEngine.AddPolicy(
  name: "CustomerPartitioning",
  predicate: context => context.MatchesAggregate<Customer>(),
  configure: config => config
    .UseStreamKey("customer-{aggregateId}")
    .UsePartitionRouter<HashPartitionRouter>()
    .WithPartitions(count: 50)
);
```

### 4. Message Type-Based Execution

```csharp
policyEngine.AddPolicy(
  name: "BulkImportExecutionStrategy",
  predicate: context => context.MessageType.Name.Contains("BulkImport"),
  configure: config => config
    .UseExecutionStrategy<ParallelExecutor>()
    .WithConcurrency(maxConcurrency: 100)
);

policyEngine.AddPolicy(
  name: "OrderExecutionStrategy",
  predicate: context => context.MessageType.Name.Contains("Order"),
  configure: config => config
    .UseExecutionStrategy<SerialExecutor>()  // Strict ordering for orders
);
```

### 5. Tag-Based Routing

```csharp
policyEngine.AddPolicy(
  name: "HighPriorityRouting",
  predicate: context => context.HasTag("high-priority"),
  configure: config => config
    .PublishToServiceBus("priority-events")
    .WithConcurrency(maxConcurrency: 100)
);

policyEngine.AddPolicy(
  name: "ArchivalRouting",
  predicate: context => context.HasTag("archival"),
  configure: config => config
    .PublishToServiceBus("archive-events")
    .WithConcurrency(maxConcurrency: 1)  // Low priority
);
```

---

## Advanced Patterns

### Composite Policies

```csharp
policyEngine.AddPolicy(
  name: "HighValueOrderRouting",
  predicate: context => {
    // Complex predicate with multiple conditions
    bool isOrder = context.MatchesAggregate<Order>();
    bool isHighValue = context.GetMetadata("totalAmount") is decimal amount && amount > 10000;
    bool isProduction = context.Environment == "production";

    return isOrder && isHighValue && isProduction;
  },
  configure: config => config
    .PublishToServiceBus("high-value-orders")
    .UseExecutionStrategy<SerialExecutor>()
    .WithConcurrency(maxConcurrency: 1)
);
```

### Service-Injected Policies

```csharp
policyEngine.AddPolicy(
  name: "FeatureFlagRouting",
  predicate: context => {
    // Resolve service from context
    var featureFlags = context.GetService<IFeatureFlagService>();

    // Check feature flag
    return featureFlags.IsEnabled("new-event-routing");
  },
  configure: config => config
    .PublishToServiceBus("new-events-topic")
);
```

### Time-Based Policies

```csharp
policyEngine.AddPolicy(
  name: "PeakHoursRouting",
  predicate: context => {
    var hour = context.ExecutionTime.Hour;
    bool isPeakHours = hour >= 9 && hour <= 17;  // 9 AM - 5 PM

    return isPeakHours;
  },
  configure: config => config
    .WithConcurrency(maxConcurrency: 100)  // High concurrency during peak
);

policyEngine.AddPolicy(
  name: "OffHoursRouting",
  predicate: context => true,  // Fallback
  configure: config => config
    .WithConcurrency(maxConcurrency: 10)  // Lower concurrency off-peak
);
```

---

## Testing Policies

### Unit Testing Predicates

```csharp
[Test]
public async Task TenantARouting_WithTenantA_MatchesAsync() {
  // Arrange
  var context = new PolicyContext(
    message: new CreateOrder(),
    envelope: CreateEnvelope(metadata: new Dictionary<string, object> {
      ["tenantId"] = "tenant-a"
    }),
    services: null,
    environment: "production"
  );

  var policyEngine = new PolicyEngine();
  policyEngine.AddPolicy(
    name: "TenantARouting",
    predicate: ctx => ctx.GetMetadata("tenantId")?.ToString() == "tenant-a",
    configure: config => config.PublishToServiceBus("tenant-a-events")
  );

  // Act
  var result = await policyEngine.MatchAsync(context);

  // Assert
  await Assert.That(result).IsNotNull();
  await Assert.That(result!.PublishTargets).HasCount().EqualTo(1);
  await Assert.That(result.PublishTargets[0].Destination).IsEqualTo("tenant-a-events");
}
```

### Testing Policy Order

```csharp
[Test]
public async Task PolicyEngine_FirstMatchWins_SkipsSubsequentPoliciesAsync() {
  // Arrange
  var context = new PolicyContext(new CreateOrder(), null, null, "production");

  var policyEngine = new PolicyEngine();

  policyEngine.AddPolicy("FirstPolicy",
    predicate: ctx => true,  // Always matches
    configure: config => config.PublishToServiceBus("first-topic")
  );

  policyEngine.AddPolicy("SecondPolicy",
    predicate: ctx => true,  // Would match, but skipped
    configure: config => config.PublishToServiceBus("second-topic")
  );

  // Act
  var result = await policyEngine.MatchAsync(context);

  // Assert
  await Assert.That(result!.PublishTargets[0].Destination).IsEqualTo("first-topic");

  // Verify decision trail
  var matched = context.Trail.GetMatchedRules().ToList();
  await Assert.That(matched).HasCount().EqualTo(1);
  await Assert.That(matched[0].PolicyName).IsEqualTo("FirstPolicy");
}
```

### Testing PolicyDecisionTrail

```csharp
[Test]
public async Task PolicyEngine_RecordsDecisionTrail_ForAllPoliciesAsync() {
  // Arrange
  var context = new PolicyContext(new CreateOrder(), null, null, "production");

  var policyEngine = new PolicyEngine();
  policyEngine.AddPolicy("Policy1", ctx => false, config => { });
  policyEngine.AddPolicy("Policy2", ctx => true, config => { });

  // Act
  await policyEngine.MatchAsync(context);

  // Assert
  var decisions = context.Trail.Decisions.ToList();
  await Assert.That(decisions).HasCount().EqualTo(2);

  // First policy did not match
  await Assert.That(decisions[0].PolicyName).IsEqualTo("Policy1");
  await Assert.That(decisions[0].Matched).IsFalse();

  // Second policy matched
  await Assert.That(decisions[1].PolicyName).IsEqualTo("Policy2");
  await Assert.That(decisions[1].Matched).IsTrue();
}
```

---

## Best Practices

### DO ✅

- ✅ **Register policies in order of specificity** (most specific first, fallback last)
- ✅ **Use descriptive policy names** for clarity in decision trails
- ✅ **Return contexts to pool** after policy evaluation
- ✅ **Test policies with various inputs** (unit test predicates)
- ✅ **Use service injection** for complex predicates (feature flags, config)
- ✅ **Add fallback policy** with `predicate: ctx => true` at end
- ✅ **Monitor PolicyDecisionTrail** in logs for debugging

### DON'T ❌

- ❌ Perform expensive operations in predicates (database queries, API calls)
- ❌ Mutate context in predicates (side effects)
- ❌ Throw exceptions in predicates (they're caught and logged as failures)
- ❌ Skip returning contexts to pool (memory leak)
- ❌ Hardcode business logic in predicates (use services instead)
- ❌ Use policies for non-routing concerns (keep focused on configuration)

---

## Troubleshooting

### Problem: No Policy Matches, Null Configuration

**Symptoms**: `MatchAsync()` returns `null`, no configuration applied.

**Cause**: No policies registered or all predicates return `false`.

**Solution**:
```csharp
// Add fallback policy
policyEngine.AddPolicy(
  name: "DefaultPolicy",
  predicate: context => true,  // Always matches (last resort)
  configure: config => config
    .PublishToServiceBus("default-events")
);

// Verify policies registered
var config = await policyEngine.MatchAsync(context);
if (config is null) {
  logger.LogWarning("No policy matched for message {MessageType}", context.MessageType.Name);

  // Check decision trail
  foreach (var decision in context.Trail.Decisions) {
    logger.LogDebug("Policy {PolicyName}: {Matched} - {Reason}",
      decision.PolicyName, decision.Matched, decision.Reason);
  }
}
```

### Problem: Wrong Policy Matched

**Symptoms**: Unexpected configuration returned.

**Cause**: Policy order incorrect (fallback registered before specific policies).

**Solution**:
```csharp
// ❌ WRONG: Fallback first (always matches)
policyEngine.AddPolicy("Fallback", ctx => true, config => config.PublishToServiceBus("default"));
policyEngine.AddPolicy("Specific", ctx => ctx.HasTag("high-priority"), config => config.PublishToServiceBus("priority"));

// ✅ CORRECT: Specific first, fallback last
policyEngine.AddPolicy("Specific", ctx => ctx.HasTag("high-priority"), config => config.PublishToServiceBus("priority"));
policyEngine.AddPolicy("Fallback", ctx => true, config => config.PublishToServiceBus("default"));
```

### Problem: Predicate Throws Exception

**Symptoms**: Policy skipped with error in decision trail.

**Cause**: Exception thrown in predicate.

**Solution**:
```csharp
// Predicate exception is caught and logged
policyEngine.AddPolicy(
  name: "FaultyPolicy",
  predicate: context => {
    var metadata = context.GetMetadata("value");
    return (int)metadata! > 100;  // NullReferenceException if missing
  },
  configure: config => { }
);

// Decision trail shows failure
// PolicyName: "FaultyPolicy"
// Matched: false
// Reason: "Evaluation failed: Object reference not set to an instance of an object"

// FIX: Null-safe predicate
policyEngine.AddPolicy(
  name: "SafePolicy",
  predicate: context => {
    var metadata = context.GetMetadata("value");
    return metadata is int value && value > 100;  // ✅ Null-safe
  },
  configure: config => { }
);
```

---

## Further Reading

**Infrastructure**:
- [Object Pooling](pooling.md) - PolicyContext pooling for performance
- [Aspire Integration](aspire-integration.md) - Service configuration injection

**Core Concepts**:
- [Message Context](../core-concepts/message-context.md) - MessageId, CorrelationId, CausationId
- [Observability](../core-concepts/observability.md) - Distributed tracing with hops

**Source Generators**:
- [Aggregate IDs](../source-generators/aggregate-ids.md) - Zero-reflection aggregate ID extraction

**Advanced**:
- [Multi-Tenancy](../advanced/multi-tenancy.md) - Tenant isolation patterns

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
