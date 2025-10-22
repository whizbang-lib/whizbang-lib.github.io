---
title: Policy Engine
category: Architecture & Design
order: 12
tags: policy-engine, rules, behavior-modification, routing, configuration
---

# Policy Engine

Whizbang includes a sophisticated policy engine that enables flexible, rule-based configuration for routing, behavior modification, and system adaptation across the entire message lifecycle.

## Core Architecture

The Policy Engine is the **universal configuration scoping mechanism** for Whizbang. Rather than having separate configuration systems for each feature, policies provide a unified way to apply configuration based on context, conditions, and scope.

**Every configurable aspect of Whizbang can use policies** to determine when and how configuration should be applied:

- **Concurrency strategies** - Which concurrency approach to use based on message type/context
- **Observability levels** - How much detail to capture based on flags/environment
- **Performance budgets** - Different performance expectations for different scenarios
- **Serialization formats** - Which serializer to use for different drivers/contexts
- **Multi-tenancy isolation** - Tenant-specific behavior and storage strategies
- **Domain ownership** - Dynamic ownership rules based on context
- **Error handling** - Different resilience policies for different message types
- **Routing decisions** - Which handlers to use based on flags/tags
- **Security policies** - Authentication/authorization rules based on context

**Policies can evaluate any aspect of the system state**:
- **Message content** - Properties, types, values within commands/events
- **Message context** - Flags, tags, correlation IDs, tenant information
- **System state** - Current load, resource utilization, error rates
- **Environment** - Development, staging, production, feature flags
- **User context** - Authentication, authorization, user roles
- **Time-based conditions** - Business hours, maintenance windows, seasons
- **Domain context** - Which domain owns the message, cross-domain interactions
- **Infrastructure state** - Database health, message broker status
- **Custom conditions** - Any developer-defined evaluation criteria

> **📋 Message Context**: While policies can evaluate any system aspect, the [**Flags & Tags System**](./flags-tags-system.md) provides a convenient way to carry context through message flows.

## Configuration Architecture Principles

### Policy-Based vs Direct Configuration

**Policies handle behavioral configuration** that varies by context, environment, message type, or runtime conditions:

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Policy-Engine, Configuration, Behavioral-Configuration]
description: Policy-based vs direct configuration showing separation of infrastructure and behavioral settings
---
services.AddWhizbang(options => {
    // INFRASTRUCTURE CONFIGURATION (Direct)
    // - Connection strings, driver selection, basic setup
    options.UseEventStoreDriver<PostgresDriver>(connectionString);
    options.UseMessageBrokerDriver<KafkaDriver>(kafkaConfig);
    
    // BEHAVIORAL CONFIGURATION (Policy-Based)
    // - Strategies, levels, rules that change based on context
    options.Policies(policies => {
        // Environment-based behavior
        policies.When(ctx => ctx.IsEnvironment("production"))
                .Then(config => config.UseConcurrencyStrategy(ConcurrencyStrategy.ExpectedVersion))
                .And(config => config.SetObservabilityLevel(ObservabilityLevel.Standard));
        
        // Message type-based behavior
        policies.WhenMessageName(name => name.Contains("Payment"))
                .Then(config => config.SetStrictSecurity())
                .And(config => config.EnableDetailedAuditing());
        
        // Load/context-based behavior
        policies.When(ctx => ctx.HasFlag(WhizbangFlags.LoadTesting))
                .Then(config => config.UseOptimizedForThroughput());
    });
});
```

**When to use Policies vs Direct Configuration**:

| Configuration Type | Use Policies | Use Direct |
|-------------------|-------------|------------|
| **Concurrency Strategies** | ✅ Context-dependent | ❌ |
| **Observability Levels** | ✅ Environment/load dependent | ❌ |
| **Security Policies** | ✅ Message/tenant dependent | ❌ |
| **Performance Budgets** | ✅ Handler/context dependent | ❌ |
| **Multi-tenancy Strategy** | ✅ Tenant-type dependent | ❌ |
| **Connection Strings** | ❌ | ✅ Infrastructure |
| **Driver Selection** | ✅ Environment dependent | ✅ Simple cases |
| **Basic DI Registration** | ❌ | ✅ Infrastructure |

## Policy Engine Architecture

### Universal Configuration via Policies

**All Whizbang configuration can be scoped using policies**:

```csharp
---
category: Design
difficulty: ADVANCED
tags: [Design, Policy-Engine, Universal-Configuration, Complex-Policies]
description: Comprehensive example showing all Whizbang features configured through unified policy system
---
services.AddWhizbang(options => {
    options.Policies(policies => {
        // === CONCURRENCY STRATEGY POLICIES ===
        policies.When(ctx => ctx.MatchesMessage<HighVolumeCommand>())
                .Then(config => config.UseConcurrencyStrategy(ConcurrencyStrategy.AutomaticRetry))
                .And(config => config.SetMaxRetries(5));
                
        policies.When(ctx => ctx.HasTag("critical-transaction"))
                .Then(config => config.UseConcurrencyStrategy(ConcurrencyStrategy.ExpectedVersion))
                .And(config => config.SetIsolationLevel(IsolationLevel.Serializable));
        
        // === OBSERVABILITY POLICIES ===
        policies.When(ctx => ctx.HasFlag(WhizbangFlags.Production))
                .Then(config => config.SetObservabilityLevel(ObservabilityLevel.Standard))
                .And(config => config.SetSampleRate(0.1));
                
        policies.When(ctx => ctx.HasTag("customer-vip") || ctx.HasFlag(WhizbangFlags.VerboseLogging))
                .Then(config => config.SetObservabilityLevel(ObservabilityLevel.Verbose))
                .And(config => config.SetSampleRate(1.0))
                .And(config => config.EnableCustomFields());
        
        // === PERFORMANCE BUDGET POLICIES ===
        policies.WhenMessageName(name => name.EndsWith("Command"))
                .Then(config => config.SetPerformanceBudget(new PerformanceBudget {
                    MaxLatency = TimeSpan.FromMilliseconds(500),
                    MaxMemoryMB = 10
                }));
                
        policies.When(ctx => ctx.HasTag("real-time"))
                .Then(config => config.SetPerformanceBudget(new PerformanceBudget {
                    MaxLatency = TimeSpan.FromMilliseconds(50),
                    AlertOnViolation = true
                }));
        
        // === SERIALIZATION POLICIES ===
        policies.WhenDriverType<KafkaDriver>()
                .Then(config => config.UseSerializer<AvroSerializer>())
                .And(config => config.EnableCompression(CompressionType.Gzip));
                
        policies.WhenDriverType<PostgresDriver>()
                .Then(config => config.UseSerializer<JsonSerializer>())
                .And(config => config.EnableJsonbOptimizations());
        
        // === MULTI-TENANCY POLICIES ===
        policies.When(ctx => ctx.TenantId != null && ctx.HasTag("enterprise-tenant"))
                .Then(config => config.UseTenancyStrategy(TenancyStrategy.SeparateDatabases))
                .And(config => config.EnableTenantIsolation());
                
        policies.When(ctx => ctx.TenantId != null && ctx.HasTag("startup-tenant"))
                .Then(config => config.UseTenancyStrategy(TenancyStrategy.SingleDatabaseWithIsolation))
                .And(config => config.EnableSharedResources());
        
        // === ERROR HANDLING POLICIES ===
        policies.WhenMessageName(name => name.Contains("Payment"))
                .Then(config => config.UseResiliencePolicy(StrictRetryPolicy))
                .And(config => config.SetMaxRetries(3))
                .And(config => config.EnableCircuitBreaker());
                
        policies.When(ctx => ctx.HasFlag(WhizbangFlags.LoadTesting))
                .Then(config => config.UseResiliencePolicy(FastFailPolicy))
                .And(config => config.DisableRetries());
        
        // === ROUTING POLICIES ===
        policies.When(ctx => ctx.HasTag("customer-vip"))
                .Then(config => config.RouteToHandler<PremiumOrderHandler>())
                .And(config => config.SetPriority(MessagePriority.High));
                
        policies.When(ctx => ctx.SystemLoad > 0.8)
                .Then(config => config.RouteToHandler<LightweightOrderHandler>())
                .And(config => config.DeferNonCriticalProcessing());
        
        // === SECURITY POLICIES ===
        policies.When(ctx => ctx.HasTag("pci-data") || ctx.HasTag("sensitive"))
                .Then(config => config.RequireEncryption())
                .And(config => config.EnableAuditLogging())
                .And(config => config.RequireAuthorization("pci-access"));
                
        policies.When(ctx => ctx.IsEnvironment("production") && ctx.HasTag("external-api"))
                .Then(config => config.EnableRateLimiting(100, TimeSpan.FromMinutes(1)))
                .And(config => config.RequireApiKey());
    });
});
```

### Policy Combination Strategies

```csharp
---
category: Design
difficulty: ADVANCED
tags: [Design, Policy-Engine, Policy-Combination, Venn-Diagrams]
description: Advanced policy combination strategies using intersection, union, and exclusion operations
---
// Venn diagram-style policy combinations
policies.Combine(
    // Policy A: High-priority customers
    policies.When(ctx => ctx.HasTag("customer-vip")),
    
    // Policy B: Large orders with custom condition
    policies.When(ctx => ctx.MatchesEvent<OrderPlaced>() && ctx.GetEvent<OrderPlaced>()?.Total > 10000),
    
    // Combination strategies
    CombinationStrategy.Intersection  // Both A AND B
);

policies.Combine(
    policies.When(ctx => ctx.HasFlag(WhizbangFlags.LoadTesting)),
    policies.When(ctx => ctx.HasFlag(WhizbangFlags.DryRun)),
    CombinationStrategy.Union        // Either A OR B
);

policies.Combine(
    policies.When(ctx => ctx.HasTag("batch-import")),
    policies.When(ctx => ctx.HasFlag(WhizbangFlags.Migration)),
    CombinationStrategy.Exclusion    // A XOR B (one but not both)
);
```

### Canned/Static Policies

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Policy-Engine, Canned-Policies, Reusable-Patterns]
description: Pre-defined reusable policies for common scenarios with override capabilities
---
// Pre-defined policies for common scenarios
public static class WhizbangPolicies {
    public static Policy LoadTestingPolicy => new PolicyBuilder()
        .When(ctx => ctx.HasFlag(WhizbangFlags.LoadTesting))
        .Then(action => action.SkipProjections())
        .And(action => action.DisableSlowOperations())
        .And(action => action.AddTag("load-test-ignored"))
        .Build();
        
    public static Policy ProductionSafetyPolicy => new PolicyBuilder()
        .When(ctx => ctx.HasFlag(WhizbangFlags.Production))
        .Then(action => action.EnableDataScrubbing())
        .And(action => action.EnforceRateLimits())
        .And(action => action.EnableAuditLogging())
        .Build();
        
    public static Policy DevelopmentDebuggingPolicy => new PolicyBuilder()
        .When(ctx => ctx.HasFlag(WhizbangFlags.Development))
        .Then(action => action.EnableVerboseLogging())
        .And(action => action.EnableBreakpoints())
        .And(action => action.DisableTimeouts())
        .Build();
}

// Apply canned policies
services.AddWhizbang(options => {
    options.Policies(policies => {
        policies.Apply(WhizbangPolicies.LoadTestingPolicy);
        policies.Apply(WhizbangPolicies.ProductionSafetyPolicy);
        policies.Apply(WhizbangPolicies.DevelopmentDebuggingPolicy);
        
        // Custom policies can override or extend canned policies
        policies.When(ctx => ctx.HasTag("special-case"))
                .OverridePolicy(WhizbangPolicies.ProductionSafetyPolicy)
                .Then(action => action.DisableDataScrubbing()); // Override for this case
    });
});
```

## Advanced Policy Scenarios

### Cross-Service Flag Propagation

**Flags carry through entire message journey**:

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Policy-Engine, Cross-Service-Propagation, Debugging]
description: Flag propagation across service boundaries maintaining context through entire message journey
---
// Initial command with debugging flags
var command = new PlaceOrder(orderId, customerId, items);
await _mediator.Send(command, context => {
    context.WithFlags(WhizbangFlags.VerboseLogging | WhizbangFlags.TraceReplay)
           .WithTag("debug-session-123");
});

// Flags automatically propagate to:
// 1. Command handler execution
// 2. Event publishing
// 3. Cross-service event delivery
// 4. Projection updates
// 5. Saga execution

// Service 2 receives event with same flags
public class InventoryHandler : IEventHandler<OrderPlaced> {
    public async Task Handle(OrderPlaced @event, EventContext context) {
        // context.Flags contains VerboseLogging | TraceReplay
        // context.Tags contains "debug-session-123"
        
        if (context.HasFlag(WhizbangFlags.VerboseLogging)) {
            _logger.LogInformation("Processing order with verbose logging enabled");
        }
    }
}
```

### Data Scrubbing with Policy-Based Duplication

```csharp
---
category: Design
difficulty: ADVANCED
tags: [Design, Policy-Engine, Data-Scrubbing, Environment-Promotion]
description: Policy-based data scrubbing when promoting production data to QA environment
---
// Production to QA data flow with scrubbing
policies.When(ctx => ctx.HasTag("production-data") && ctx.HasFlag(WhizbangFlags.QA))
        .Then(action => action.DuplicateMessage())
        .And(action => action.ScrubSensitiveData())
        .And(action => action.AddFlag(WhizbangFlags.DataScrubbing))
        .And(action => action.RouteToEnvironment("qa"));

// Handler that applies scrubbing
public class DataScrubbingHandler : IMessageInterceptor {
    public async Task<TResponse> Intercept<TRequest, TResponse>(
        TRequest message, 
        MessageContext context, 
        MessageHandlerDelegate<TRequest, TResponse> next) {
        
        if (context.HasFlag(WhizbangFlags.DataScrubbing)) {
            message = _dataScrubber.Scrub(message);
        }
        
        return await next(message, context);
    }
}
```

### Dynamic Handler Routing

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Policy-Engine, Dynamic-Routing, Handler-Selection]
description: Dynamic handler routing based on flags and tags with conditional registration
---
// Route to different handlers based on flags/tags
policies.When(ctx => ctx.HasTag("high-value-customer"))
        .Then(action => action.RouteToHandler<PremiumOrderHandler>())
        .Else(action => action.RouteToHandler<StandardOrderHandler>());

policies.When(ctx => ctx.HasFlag(WhizbangFlags.LoadTesting))
        .Then(action => action.RouteToHandler<LoadTestOrderHandler>())
        .And(action => action.SkipProjections());

// Alternative handler registration
services.AddWhizbang(options => {
    options.RegisterHandler<PlaceOrder, StandardOrderHandler>(); // Default
    options.RegisterHandler<PlaceOrder, PremiumOrderHandler>(
        condition: ctx => ctx.Tags.Contains("high-value-customer"));
    options.RegisterHandler<PlaceOrder, LoadTestOrderHandler>(
        condition: ctx => ctx.Flags.HasFlag(WhizbangFlags.LoadTesting));
});
```

### IDE Debugging Support

```csharp
---
category: Design
difficulty: ADVANCED
tags: [Design, Policy-Engine, IDE-Integration, Debugging, Time-Travel]
description: Advanced debugging support with IDE integration, breakpoints, and state inspection
---
// IDE cursor/scrubbing mode
policies.When(ctx => ctx.HasFlag(WhizbangFlags.CursorMode))
        .Then(action => action.EnableStepByStepExecution())
        .And(action => action.CaptureStateSnapshots())
        .And(action => action.AllowTimeTravel());

// Breakpoint support
policies.When(ctx => ctx.HasFlag(WhizbangFlags.Breakpoint))
        .Then(action => action.PauseExecution())
        .And(action => action.NotifyIDE())
        .And(action => action.CaptureFullContext());

// State inspection
public class StateInspectionInterceptor : IMessageInterceptor {
    public async Task<TResponse> Intercept<TRequest, TResponse>(
        TRequest message,
        MessageContext context,
        MessageHandlerDelegate<TRequest, TResponse> next) {
        
        if (context.HasFlag(WhizbangFlags.CursorMode)) {
            await _stateCapture.CapturePreExecutionState(message, context);
        }
        
        var response = await next(message, context);
        
        if (context.HasFlag(WhizbangFlags.CursorMode)) {
            await _stateCapture.CapturePostExecutionState(response, context);
        }
        
        return response;
    }
}
```

## Policy Engine Implementation

### Core Interfaces

```csharp
---
category: Design
difficulty: ADVANCED
tags: [Design, Policy-Engine, Core-Interfaces, Implementation]
description: Core policy engine interfaces and action types for implementing the policy system
---
public interface IPolicyEngine {
    Task<PolicyResult> EvaluateAsync<T>(T message, MessageContext context);
    void RegisterPolicy(IPolicy policy);
    void RegisterPolicies(IEnumerable<IPolicy> policies);
    IPolicy CombinePolicies(IEnumerable<IPolicy> policies, CombinationStrategy strategy);
}

public interface IPolicy {
    string Name { get; }
    int Priority { get; }
    Task<bool> ShouldApplyAsync<T>(T message, MessageContext context);
    Task<PolicyAction[]> GetActionsAsync<T>(T message, MessageContext context);
}

public abstract class PolicyAction {
    public abstract Task ExecuteAsync<T>(T message, MessageContext context);
}

// Specific policy actions
public class RouteToHandlerAction<THandler> : PolicyAction { }
public class AddFlagAction : PolicyAction { }
public class AddTagAction : PolicyAction { }
public class SkipProjectionsAction : PolicyAction { }
public class EnableVerboseLoggingAction : PolicyAction { }
public class ScrubDataAction : PolicyAction { }
```

### Typed Policy Methods

**Context provides strongly-typed matching methods**:

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Policy-Engine, Message-Context, Strongly-Typed]
description: Typed policy methods with strongly-typed context matching and clean policy configuration
---
public class MessageContext {
    // Core properties
    public string CorrelationId { get; set; }
    public WhizbangFlags Flags { get; set; }
    public HashSet<string> Tags { get; set; }
    public string Environment { get; set; }
    public string TenantId { get; set; }
    public Type MessageType { get; set; }
    public Type AggregateType { get; set; }
    public Type HandlerType { get; set; }
    
    // Strongly-typed matching methods (for types)
    public bool MatchesMessage<T>() => MessageType == typeof(T);
    public bool MatchesEvent<T>() where T : IEvent => MessageType == typeof(T);
    public bool MatchesCommand<T>() where T : ICommand => MessageType == typeof(T);
    public bool MatchesAggregate<T>() where T : Aggregate => AggregateType == typeof(T);
    public bool MatchesHandler<T>() => HandlerType == typeof(T);
    public bool MatchesDriver<T>() => DriverType == typeof(T);
    
    // Convenience methods
    public bool HasFlag(WhizbangFlags flag) => Flags.HasFlag(flag);
    public bool HasTag(string tag) => Tags.Contains(tag);
    public bool IsEnvironment(string env) => Environment.Equals(env, StringComparison.OrdinalIgnoreCase);
}

// Simple policy builder
public interface IPolicyBuilder {
    IPolicyBuilder When(Func<MessageContext, bool> condition);
    IPolicyBuilder Then(Action<ConfigurationBuilder> action);
    IPolicyBuilder And(Action<ConfigurationBuilder> action);
}

// Clean, readable policy configuration
services.AddWhizbang(options => {
    options.Policies(policies => {
        // Type matching using context methods
        policies.When(ctx => ctx.MatchesMessage<PlaceOrder>())
                .Then(config => config.SetPerformanceBudget(orderBudget));
        
        policies.When(ctx => ctx.MatchesAggregate<Order>())
                .Then(config => config.UseConcurrencyStrategy(ConcurrencyStrategy.AutomaticRetry));
        
        policies.When(ctx => ctx.MatchesHandler<PaymentHandler>())
                .Then(config => config.RequireEncryption());
        
        // Conditional type matching with additional checks
        policies.When(ctx => ctx.MatchesEvent<OrderPlaced>() && 
                             ctx.GetEvent<OrderPlaced>()?.Total > 10000)
                .Then(config => config.EnableDetailedAuditing());
        
        // Pattern matching on message names
        policies.When(ctx => ctx.MessageType.Name.EndsWith("Command"))
                .Then(config => config.SetMaxLatency(TimeSpan.FromSeconds(1)));
        
        // Flag and tag conditions
        policies.When(ctx => ctx.HasFlag(WhizbangFlags.Production))
                .Then(config => config.SetObservabilityLevel(ObservabilityLevel.Standard));
        
        policies.When(ctx => ctx.HasTag("critical-path") && ctx.IsEnvironment("production"))
                .Then(config => config.SetObservabilityLevel(ObservabilityLevel.Detailed));
        
        // Complex tenant conditions
        policies.When(ctx => ctx.TenantId != null && ctx.HasTag("enterprise"))
                .Then(config => config.UseTenancyStrategy(TenancyStrategy.SeparateDatabases));
    });
});
```

### Policy Hashing & Tracing

**Every policy generates a deterministic hash** for tracing and debugging:

```csharp
---
category: Design
difficulty: ADVANCED
tags: [Design, Policy-Engine, Policy-Hashing, Debugging, Tracing]
description: Policy hashing and tracing infrastructure for debugging and policy identification
---
public interface IPolicy {
    string Name { get; }
    int Priority { get; }
    string PolicyHash { get; } // Deterministic hash of policy conditions & actions
    Task<bool> ShouldApplyAsync<T>(T message, MessageContext context);
    Task<PolicyAction[]> GetActionsAsync<T>(T message, MessageContext context);
}

// Policy hash generation
public class PolicyBuilder {
    public string GeneratePolicyHash() {
        var hashInput = new {
            Conditions = _conditions.Select(c => c.ToHashString()),
            Actions = _actions.Select(a => a.ToHashString()),
            Priority = _priority
        };
        
        using var sha = SHA256.Create();
        var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(hashInput)));
        return Convert.ToBase64String(bytes)[..8]; // Short hash for readability
    }
}

// Context carries applied policies
public class MessageContext {
    public string CorrelationId { get; set; }
    public WhizbangFlags Flags { get; set; }
    public HashSet<string> Tags { get; set; }
    
    // Policy tracking for debugging
    public List<AppliedPolicy> AppliedPolicies { get; set; } = new();
    public string ActivePolicyHash { get; set; } // Currently executing policy
    public Dictionary<string, object> PolicyDecisions { get; set; } = new();
}

public class AppliedPolicy {
    public string PolicyHash { get; set; }
    public string PolicyName { get; set; }
    public DateTimeOffset AppliedAt { get; set; }
    public Dictionary<string, object> Decisions { get; set; }
    public TimeSpan EvaluationTime { get; set; }
}
```

### Distributed Tracing Integration

**Policy decisions are traced through OpenTelemetry**:

```csharp
---
category: Design
difficulty: ADVANCED
tags: [Design, Policy-Engine, Distributed-Tracing, OpenTelemetry]
description: Distributed tracing integration showing policy decisions in OpenTelemetry traces
---
public class PolicyTracingInterceptor : IMessageInterceptor {
    public async Task<TResponse> Intercept<TRequest, TResponse>(
        TRequest message,
        MessageContext context,
        MessageHandlerDelegate<TRequest, TResponse> next) {
        
        using var activity = Activity.StartActivity("PolicyEvaluation");
        
        // Evaluate applicable policies
        var policies = await _policyEngine.EvaluateAsync(message, context);
        
        foreach (var policy in policies) {
            // Add policy hash to trace
            activity?.SetTag("whizbang.policy.hash", policy.PolicyHash);
            activity?.SetTag("whizbang.policy.name", policy.Name);
            
            // Track in context for debugging
            context.AppliedPolicies.Add(new AppliedPolicy {
                PolicyHash = policy.PolicyHash,
                PolicyName = policy.Name,
                AppliedAt = DateTimeOffset.UtcNow,
                Decisions = policy.GetDecisions()
            });
        }
        
        // Include policy hashes in trace state
        var traceState = $"policies={string.Join(',', policies.Select(p => p.PolicyHash))}";
        activity?.SetTag("tracestate", traceState);
        
        return await next(message, context);
    }
}

// Policy decisions visible in traces
// Trace: PlaceOrder -> OrderHandler
//   Tags:
//     whizbang.policy.hash: "Ab3d9F2x"
//     whizbang.policy.name: "HighValueOrderPolicy"
//     whizbang.decisions: { "concurrency": "ExpectedVersion", "observability": "Verbose" }
```

### IDE Integration via Source Generation

**Source generator creates policy metadata** for IDE tooling:

```csharp
---
category: Design
difficulty: ADVANCED
tags: [Design, Policy-Engine, Source-Generation, IDE-Integration]
description: Source-generated metadata enabling IDE navigation and policy impact analysis
---
// Generated policy metadata for IDE navigation
[GeneratedCode("Whizbang.SourceGenerator")]
public static class PolicyMetadata {
    // Map of types to affecting policies
    public static readonly Dictionary<Type, List<PolicyInfo>> TypePolicies = new() {
        [typeof(Order)] = new List<PolicyInfo> {
            new("Ab3d9F2x", "OrderConcurrencyPolicy", PolicyEffect.ConcurrencyStrategy),
            new("Cd5e8G3y", "OrderObservabilityPolicy", PolicyEffect.ObservabilityLevel),
            new("Ef7h2K4z", "OrderPerformanceBudget", PolicyEffect.PerformanceBudget)
        },
        [typeof(OrderPlaced)] = new List<PolicyInfo> {
            new("Gh9j4M5a", "EventRoutingPolicy", PolicyEffect.Routing),
            new("Ij2k6N7b", "EventSerializationPolicy", PolicyEffect.Serialization)
        },
        [typeof(OrderSummaryProjection)] = new List<PolicyInfo> {
            new("Kl4m8P9c", "ProjectionLagPolicy", PolicyEffect.Performance),
            new("Mn6o2Q1d", "ProjectionPartitioningPolicy", PolicyEffect.Partitioning)
        }
    };
    
    // Reverse mapping for "what does this policy affect?"
    public static readonly Dictionary<string, List<AffectedType>> PolicyEffects = new() {
        ["Ab3d9F2x"] = new List<AffectedType> {
            new(typeof(Order), "Aggregate", "Sets concurrency to ExpectedVersion"),
            new(typeof(PlaceOrder), "Command", "Inherits aggregate concurrency"),
            new(typeof(UpdateOrder), "Command", "Inherits aggregate concurrency")
        }
    };
    
    // Policy evaluation paths for debugging
    public static readonly Dictionary<string, PolicyEvaluationPath> PolicyPaths = new() {
        ["Ab3d9F2x"] = new PolicyEvaluationPath {
            Conditions = new[] { "AggregateType == Order" },
            Actions = new[] { "SetConcurrencyStrategy(ExpectedVersion)" },
            Priority = 100,
            Source = "OrderConcurrencyPolicy.cs:line 15"
        }
    };
}
```

### GitLens-Style IDE Experience

**Visual Studio/Rider extension shows policy effects inline**:

```csharp
// OrderAggregate.cs
public class Order : Aggregate { // 📋 3 policies affect this aggregate [hover for details]
    // PolicyLens: Ab3d9F2x (Concurrency: ExpectedVersion)
    // PolicyLens: Cd5e8G3y (Observability: Verbose for orders > $1000)  
    // PolicyLens: Ef7h2K4z (Performance Budget: 100ms max latency)
    
    public void PlaceOrder(CustomerId customerId, List<OrderItem> items) {
        // PolicyLens: This method triggers policies Ab3d9F2x, Gh9j4M5a
        Apply(new OrderPlaced(...));
    }
}

// OrderSummaryProjection.cs  
public class OrderSummaryProjection { // 📋 2 policies affect this projection
    // PolicyLens: Kl4m8P9c (Max lag: 5 minutes before alert)
    // PolicyLens: Mn6o2Q1d (Partitioned by CustomerId)
    
    public void Handle(OrderPlaced @event) { // PolicyLens: Routed by policy Gh9j4M5a
        // Update projection...
    }
}
```

### Policy Debugging Commands

**IDE commands for policy investigation**:

```csharp
// Right-click on any type/method in IDE:
// > Whizbang: Show Affecting Policies
// > Whizbang: Trace Policy Evaluation  
// > Whizbang: Simulate Policy Changes
// > Whizbang: Show Policy History (git blame for policies)

// Command palette:
// > Whizbang: What policies affect Order aggregate?
// > Whizbang: What does policy Ab3d9F2x affect?
// > Whizbang: Show policy evaluation for PlaceOrder command
// > Whizbang: Compare policies between environments
```

### Runtime Policy Debugging

**Access policy decisions at runtime**:

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Policy-Engine, Runtime-Debugging, HTTP-Headers]
description: Runtime policy debugging middleware exposing policy decisions through HTTP headers
---
public class PolicyDebugMiddleware {
    public async Task InvokeAsync(HttpContext context, RequestDelegate next) {
        // Inject policy debug header
        context.Response.OnStarting(() => {
            var messageContext = context.GetMessageContext();
            if (messageContext?.AppliedPolicies?.Any() == true) {
                var policyHashes = string.Join(",", 
                    messageContext.AppliedPolicies.Select(p => p.PolicyHash));
                context.Response.Headers["X-Whizbang-Policies"] = policyHashes;
                
                // Debug mode: include full policy decisions
                if (context.Request.Headers.ContainsKey("X-Debug-Policies")) {
                    context.Response.Headers["X-Whizbang-Policy-Decisions"] = 
                        JsonSerializer.Serialize(messageContext.PolicyDecisions);
                }
            }
            return Task.CompletedTask;
        });
        
        await next(context);
    }
}

// HTTP Response Headers:
// X-Whizbang-Policies: Ab3d9F2x,Cd5e8G3y,Ef7h2K4z
// X-Whizbang-Policy-Decisions: {"concurrency":"ExpectedVersion","observability":"Verbose"}
```

### Policy Evaluation Pipeline

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Policy-Engine, Pipeline, Pre-Post-Execution]
description: Policy evaluation pipeline with pre and post-execution action application
---
public class PolicyEvaluationPipeline : IMessageInterceptor {
    private readonly IPolicyEngine _policyEngine;
    
    public async Task<TResponse> Intercept<TRequest, TResponse>(
        TRequest message,
        MessageContext context,
        MessageHandlerDelegate<TRequest, TResponse> next) {
        
        // Evaluate policies before handler execution
        var policyResult = await _policyEngine.EvaluateAsync(message, context);
        
        // Apply pre-execution actions
        foreach (var action in policyResult.PreExecutionActions) {
            await action.ExecuteAsync(message, context);
        }
        
        // Execute handler (might be changed by policy)
        var response = await next(message, context);
        
        // Apply post-execution actions
        foreach (var action in policyResult.PostExecutionActions) {
            await action.ExecuteAsync(response, context);
        }
        
        return response;
    }
}
```

### Configuration Integration

```csharp
---
category: Design
difficulty: INTERMEDIATE
tags: [Design, Policy-Engine, Configuration-Integration, Environment-Based]
description: Environment-based policy loading with configuration integration and team-specific policies
---
// Environment-based policy loading
services.AddWhizbang(options => {
    options.Policies(policies => {
        // Load environment-specific policies
        if (_environment.IsProduction()) {
            policies.LoadFromConfiguration("Production");
            policies.Apply(WhizbangPolicies.ProductionSafetyPolicy);
        } else if (_environment.IsDevelopment()) {
            policies.LoadFromConfiguration("Development");
            policies.Apply(WhizbangPolicies.DevelopmentDebuggingPolicy);
        }
        
        // Load custom policies from configuration
        policies.LoadFromSection("CustomPolicies");
        
        // Team-specific canned policies
        policies.Apply(TeamPolicies.DataTeamStandardPolicies);
        policies.Apply(TeamPolicies.SecurityTeamCompliancePolicies);
    });
});

// Configuration example
{
  "Whizbang": {
    "Policies": {
      "Production": [
        {
          "Name": "ProductionDataScrubbing",
          "Condition": "HasFlag('Production') && HasTag('sensitive-data')",
          "Actions": [
            { "Type": "ScrubData", "Fields": ["SSN", "CreditCard"] },
            { "Type": "AddTag", "Value": "scrubbed" }
          ]
        }
      ]
    }
  }
}
```

## Best Practices

### Policy Design Guidelines

1. **Keep policies focused** - One policy per concern
2. **Use clear naming** - Policy names should describe their purpose
3. **Document side effects** - Policies can change behavior significantly
4. **Test policy interactions** - Multiple policies can interact unexpectedly
5. **Monitor policy performance** - Complex policies can impact performance

### Flag Usage Guidelines

1. **Use library flags first** - Prefer built-in flags over custom tags
2. **Document custom flags** - Make user-defined flags clear to the team
3. **Be conservative with propagation** - Not all flags should cross service boundaries
4. **Consider flag lifetime** - How long should flags persist in the system
5. **Audit flag usage** - Track which flags are used and where

### Security Considerations

1. **Validate flag sources** - Ensure flags come from trusted sources
2. **Limit dangerous flags** - SecurityBypass should be heavily restricted
3. **Audit policy changes** - Log all policy modifications
4. **Encrypt sensitive tags** - Some tags may contain sensitive information
5. **Principle of least privilege** - Policies should grant minimal necessary permissions

---

## Related Documentation

- [**Event Store & Projections**](./event-store-projections.md) - How policies affect storage and projections
- [**Domain Ownership**](./domain-ownership.md) - Policy-based routing and ownership
- [**Advanced Features**](./advanced-features.md) - Debugging and development tools integration